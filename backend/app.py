import asyncio
import json
import os
import re
import shutil
import sys
import threading
import subprocess
import time
import urllib.parse
from pathlib import Path
from typing import Optional, List
import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from concurrent.futures import ThreadPoolExecutor
from starlette.responses import Response

from backend.config import (
    config, AppConfig, FRONTEND_DIR, YT_DLP_PATH, FFMPEG_PATH, KID3_CLI_PATH,
    YTM_BAT_PATH, YTM_OGG_BAT_PATH, TEMP_DOWNLOAD_DIR, DEFAULT_EXPORT_DIR,
    DESKTOP_EXPORT_DIR, DOWNLOADS_EXPORT_DIR, MUSIC_EXPORT_DIR, PREVIEW_CACHE_DIR,
    DEFAULT_VIDEO_EXPORT_DIR, DESKTOP_VIDEO_EXPORT_DIR, DOWNLOADS_VIDEO_EXPORT_DIR, VIDEOS_SYSTEM_EXPORT_DIR,
    save_config
)
from backend.downloader import download_manager
from backend.tagger import (
    get_album_info, uniformize_album, export_album, export_all_temp_albums, delete_temp_album,
    open_in_explorer, AUDIO_EXTENSIONS, safe_rmtree,
    get_missing_tracks_details, integrate_substitute_track,
    save_pending_substitutes, clear_pending_substitutes,
    save_editor_draft, clear_editor_draft, clean_artist_name,
    extract_embedded_cover, consolidate_album_cover, parse_track_filename,
    invalidate_album_cache, sanitize_folder_name
)
from backend.ytm_client import (
    extract_ytm_browse_id, browse_ytm_innertube, search_ytm_innertube, search_ytm_continuation,
    browse_artist_discography
)
from backend.genre_service import detect_genre
from backend.logger import get_logger, get_log_info, clear_log_file
from backend.library_indexer import (
    library_indexer, smart_matcher, normalize_text, DISC_SUBFOLDER_RE, COVER_NAMES,
    extract_album_tags_priority
)
from backend.library_curator import (
    find_missing_albums_for_artist, audit_collection_health, apply_harmonization_fixes
)
from backend.library_sync import (
    synchronize_collection, library_watcher, set_sync_event_callback, set_sync_status_callback,
    set_library_updated_callback, heal_imports_folder
)
from backend.video_indexer import video_indexer, VIDEO_EXTENSIONS, generate_rip_audio_cover
from backend.video_sync import synchronize_videos, set_video_sync_callback, set_video_status_callback, clean_video_title
from backend.tool_updater import get_yt_dlp_status, update_yt_dlp, background_startup_check
from backend.library_migrator import check_migration_needed, execute_migration
from backend.playlist_manager import playlist_manager
from backend.playback_stats import playback_stats
from backend.app_updater import (
    check_app_update,
    start_download_update,
    get_download_progress,
    launch_installer,
    open_release_in_browser
)

logger = get_logger(__name__)

app = FastAPI(title="SoundStash API", version="3.2.0")

# WebSocket Connection Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)

ws_manager = ConnectionManager()
download_manager.set_log_callback(ws_manager.broadcast)

main_loop: Optional[asyncio.AbstractEventLoop] = None

def dispatch_sync_notification(color: str, message: str, detail: str = ""):
    payload = {
        "type": "sync_event",
        "color": color,
        "message": message,
        "detail": detail,
        "timestamp": time.time()
    }
    global main_loop
    try:
        if main_loop and main_loop.is_running():
            asyncio.run_coroutine_threadsafe(ws_manager.broadcast(payload), main_loop)
        else:
            try:
                curr_loop = asyncio.get_running_loop()
                if curr_loop.is_running():
                    asyncio.run_coroutine_threadsafe(ws_manager.broadcast(payload), curr_loop)
            except RuntimeError:
                pass
    except Exception as e:
        logger.debug(f"Erreur dispatch_sync_notification: {e}")

set_sync_event_callback(dispatch_sync_notification)
set_video_sync_callback(dispatch_sync_notification)

def dispatch_sync_status(active: bool, task: str, title: str = "", detail: str = ""):
    payload = {
        "type": "sync_status",
        "active": active,
        "task": task,
        "title": title,
        "detail": detail,
        "timestamp": time.time()
    }
    global main_loop
    try:
        if main_loop and main_loop.is_running():
            asyncio.run_coroutine_threadsafe(ws_manager.broadcast(payload), main_loop)
        else:
            try:
                curr_loop = asyncio.get_running_loop()
                if curr_loop.is_running():
                    asyncio.run_coroutine_threadsafe(ws_manager.broadcast(payload), curr_loop)
            except RuntimeError:
                pass
    except Exception as e:
        logger.debug(f"Erreur dispatch_sync_status: {e}")

set_sync_status_callback(dispatch_sync_status)
set_video_status_callback(dispatch_sync_status)

def dispatch_library_updated():
    payload = {
        "type": "library_updated",
        "albums_count": len(library_indexer.albums),
        "artists_count": len(library_indexer.artists_map),
        "timestamp": time.time()
    }
    global main_loop
    try:
        if main_loop and main_loop.is_running():
            asyncio.run_coroutine_threadsafe(ws_manager.broadcast(payload), main_loop)
        else:
            try:
                curr_loop = asyncio.get_running_loop()
                if curr_loop.is_running():
                    asyncio.run_coroutine_threadsafe(ws_manager.broadcast(payload), curr_loop)
            except RuntimeError:
                pass
    except Exception as e:
        logger.debug(f"Erreur dispatch_library_updated: {e}")

set_library_updated_callback(dispatch_library_updated)


def silence_winerror_10054(loop, context):
    """
    Gestionnaire d'exceptions pour ignorer WinError 10054 (Connection reset by peer)
    et BrokenPipeError, courants sous Windows lors de la mise en veille ou de la coupure de socket réseau locale.
    """
    exc = context.get('exception')
    if isinstance(exc, (ConnectionResetError, BrokenPipeError)):
        if getattr(exc, 'winerror', None) == 10054 or getattr(exc, 'errno', None) in (32, 10054):
            return
    msg = str(context.get('message', ''))
    if '10054' in msg or 'Connection reset' in msg or 'Broken pipe' in msg:
        return
    try:
        loop.default_exception_handler(context)
    except Exception:
        pass


@app.on_event("startup")
async def app_startup_sync_watcher():
    global main_loop
    main_loop = asyncio.get_running_loop()
    if sys.platform.startswith("win"):
        try:
            main_loop.set_exception_handler(silence_winerror_10054)
            logger.info("Gestionnaire d'exceptions asyncio Windows (anti-WinError 10054 veille) activé.")
        except Exception as e:
            logger.debug(f"Impossible d'activer silence_winerror_10054: {e}")
    if not library_watcher.is_alive():
        library_watcher.start()
    if getattr(config, "auto_update_yt_dlp", True):
        asyncio.create_task(background_startup_check())
    asyncio.create_task(asyncio.to_thread(library_indexer.ensure_tracks_indexed))

@app.on_event("shutdown")
async def app_shutdown_sync_watcher():
    library_watcher.stop()


# Modèles Pydantic pour requêtes
class DownloadRequest(BaseModel):
    url: str
    title: Optional[str] = None
    format: str = "m4a"
    quality: str = "128K"
    video_quality: Optional[str] = None
    auto_retag: bool = True
    naming_pattern: str = "{track:02d} {title}"
    clean_titles: bool = True
    is_playlist: Optional[bool] = None
    custom_album: Optional[str] = None
    custom_artist: Optional[str] = None
    origin_album: Optional[str] = None
    thumbnail_url: Optional[str] = None
    is_external: Optional[bool] = None

class LocalImportRequest(BaseModel):
    paths: List[str]
    target_folder_name: Optional[str] = None

class ExportCustomRequest(BaseModel):
    source_path: str
    target_dir: str
    delete_source: bool = True

class RetagRequest(BaseModel):
    album_dir: str
    custom_album: Optional[str] = None
    custom_artist: Optional[str] = None
    custom_year: Optional[str] = None
    custom_genre: Optional[str] = None
    rename_files: bool = True
    naming_pattern: str = "{track:02d} {title}"
    clean_titles: bool = True
    custom_tracks: Optional[List[dict]] = None
    is_playlist: Optional[bool] = None

class ExportRequest(BaseModel):
    album_dir: str
    target_base_dir: Optional[str] = None
    delete_temp: bool = True
    custom_album: Optional[str] = None
    custom_artist: Optional[str] = None
    custom_year: Optional[str] = None
    custom_genre: Optional[str] = None
    custom_tracks: Optional[List[dict]] = None
    is_playlist: Optional[bool] = None
    is_concert: Optional[bool] = None
    conflict_policy: Optional[str] = None

class ExportAllRequest(BaseModel):
    target_base_dir: Optional[str] = None
    delete_temp: bool = True
    conflict_policy: Optional[str] = None

class ResolveExportDestinationRequest(BaseModel):
    album_dir: str
    conflict_policy: Optional[str] = None

class ActionPathRequest(BaseModel):
    path: str

class ExtractAudioRequest(BaseModel):
    path: str
    artist: Optional[str] = None
    title: Optional[str] = None

class UpdateConfigRequest(BaseModel):
    export_dir: Optional[str] = None
    video_export_dir: Optional[str] = None
    video_library_dir: Optional[str] = None
    library_dir: Optional[str] = None
    default_video_quality: Optional[str] = None
    auto_sync_videos: Optional[bool] = None
    smart_export: Optional[bool] = None
    smart_export_conflict_policy: Optional[str] = None
    naming_pattern: Optional[str] = None
    delete_temp_after_export: Optional[bool] = None
    cooldown_album: Optional[int] = None
    cooldown_single: Optional[int] = None
    minimize_to_tray_on_close: Optional[bool] = None
    minimize_to_tray_on_minimize: Optional[bool] = None
    has_seen_tray_notice: Optional[bool] = None
    auto_update_yt_dlp: Optional[bool] = None
    auto_check_app_updates: Optional[bool] = None

class MatchSearchItem(BaseModel):
    title: str
    artist: Optional[str] = ""
    type: Optional[str] = "album"
    id: Optional[str] = None
    url: Optional[str] = None

class MatchSearchRequest(BaseModel):
    items: List[MatchSearchItem]

class HarmonizeRequest(BaseModel):
    fixes: List[dict]

class BrowseFolderRequest(BaseModel):
    initial_dir: Optional[str] = None

class LibraryScanRequest(BaseModel):
    library_dir: Optional[str] = None

class SubstituteItem(BaseModel):
    track_number: int
    video_id: str
    title: str
    artist: str
    duration: Optional[str] = None

class SavePendingSubstitutesRequest(BaseModel):
    album_dir: str
    substitutes: dict

class SaveEditorDraftRequest(BaseModel):
    album_dir: str
    draft: dict

class ClearEditorDraftRequest(BaseModel):
    album_dir: str

class DownloadAppUpdateRequest(BaseModel):
    download_url: str
    asset_name: Optional[str] = None
    version: Optional[str] = "latest"

class OpenBrowserRequest(BaseModel):
    url: Optional[str] = None

class InstallAppUpdateRequest(BaseModel):
    installer_path: Optional[str] = None

class ReconstituteRequest(BaseModel):
    album_dir: str
    substitutes: List[SubstituteItem]
    custom_album: Optional[str] = None
    custom_artist: Optional[str] = None
    custom_year: Optional[str] = None
    custom_genre: Optional[str] = None

class CheckMigrationRequest(BaseModel):
    type: str  # "music" or "video"
    new_path: str

class ExecuteMigrationRequest(BaseModel):
    type: str  # "music" or "video"
    source_path: str
    target_path: str

class CreatePlaylistRequest(BaseModel):
    name: str
    description: Optional[str] = ""
    items: Optional[List[dict]] = None
    cover_url: Optional[str] = None
    is_smart: Optional[bool] = False
    smart_type: Optional[str] = None
    smart_criteria: Optional[dict] = None

class SmartPlaylistGenerateRequest(BaseModel):
    name: str
    smart_type: str
    criteria: Optional[dict] = None

class UpdatePlaylistCoverRequest(BaseModel):
    cover_url: str

class RecordPlayRequest(BaseModel):
    path: str
    title: Optional[str] = ""
    artist: Optional[str] = ""
    album: Optional[str] = ""
    genre: Optional[str] = ""
    duration: Optional[float] = 0.0
    type: Optional[str] = "audio"

class UpdatePlaylistRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    items: Optional[List[dict]] = None
    cover_url: Optional[str] = None

class AddPlaylistItemsRequest(BaseModel):
    items: List[dict]

class ReorderPlaylistRequest(BaseModel):
    item_ids: List[str]

class TrashItemRequest(BaseModel):
    path: str
    type: Optional[str] = "auto"

class BatchGenreRequest(BaseModel):
    albums: List[str]
    genre: str

# Routes

@app.get("/")
async def get_index():
    index_path = FRONTEND_DIR / "index.html"
    if not index_path.exists():
        return HTMLResponse("<h1>Frontend non trouvé</h1>", status_code=404)
    return FileResponse(
        str(index_path),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )

@app.get("/favicon.ico")
async def get_favicon():
    fav_p = FRONTEND_DIR / "favicon.svg"
    if fav_p.exists():
        return FileResponse(str(fav_p), media_type="image/svg+xml")
    return HTMLResponse("", status_code=204)

@app.get("/.well-known/appspecific/com.chrome.devtools.json")
async def get_chrome_devtools():
    return {}

@app.get("/api/config")
async def get_configuration():
    return {
        "temp_download_dir": config.temp_download_dir,
        "export_dir": config.export_dir,
        "video_export_dir": config.video_export_dir,
        "video_library_dir": config.video_library_dir,
        "library_dir": config.library_dir,
        "smart_export": config.smart_export,
        "smart_export_conflict_policy": config.smart_export_conflict_policy,
        "default_format": config.default_format,
        "default_quality": config.default_quality,
        "default_video_quality": getattr(config, "default_video_quality", "1080p"),
        "auto_sync_videos": getattr(config, "auto_sync_videos", True),
        "auto_retag": config.auto_retag,
        "naming_pattern": config.naming_pattern,
        "delete_temp_after_export": config.delete_temp_after_export,
        "quick_paths": {
            "desktop": str(DESKTOP_EXPORT_DIR.resolve()),
            "downloads": str(DOWNLOADS_EXPORT_DIR.resolve()),
            "music": str(MUSIC_EXPORT_DIR.resolve()),
            "video_desktop": str(DESKTOP_VIDEO_EXPORT_DIR.resolve()),
            "video_downloads": str(DOWNLOADS_VIDEO_EXPORT_DIR.resolve()),
            "video_system": str(VIDEOS_SYSTEM_EXPORT_DIR.resolve())
        },
        "tools": {
            "yt_dlp": YT_DLP_PATH,
            "ffmpeg": FFMPEG_PATH,
            "kid3_cli": KID3_CLI_PATH,
            "ytm_bat": str(YTM_BAT_PATH.resolve()),
            "ytm_ogg_bat": str(YTM_OGG_BAT_PATH.resolve())
        },
        "cooldown_album": config.cooldown_album,
        "cooldown_single": config.cooldown_single,
        "minimize_to_tray_on_close": config.minimize_to_tray_on_close,
        "minimize_to_tray_on_minimize": config.minimize_to_tray_on_minimize,
        "has_seen_tray_notice": config.has_seen_tray_notice,
        "auto_update_yt_dlp": getattr(config, "auto_update_yt_dlp", True),
        "auto_check_app_updates": getattr(config, "auto_check_app_updates", True)
    }

@app.post("/api/config")
async def update_configuration(req: UpdateConfigRequest):
    if req.export_dir is not None and req.export_dir.strip():
        config.export_dir = req.export_dir.strip()
    if req.video_export_dir is not None and req.video_export_dir.strip():
        config.video_export_dir = req.video_export_dir.strip()
    if "video_library_dir" in req.model_fields_set:
        config.video_library_dir = req.video_library_dir.strip() if (req.video_library_dir and req.video_library_dir.strip()) else None
    if "library_dir" in req.model_fields_set:
        config.library_dir = req.library_dir.strip() if (req.library_dir and req.library_dir.strip()) else None
    if req.default_video_quality is not None and req.default_video_quality.strip():
        config.default_video_quality = req.default_video_quality.strip()
    if req.auto_sync_videos is not None:
        config.auto_sync_videos = req.auto_sync_videos
    if req.smart_export is not None:
        config.smart_export = req.smart_export
    if req.smart_export_conflict_policy is not None:
        config.smart_export_conflict_policy = req.smart_export_conflict_policy
    if req.naming_pattern is not None:
        config.naming_pattern = req.naming_pattern
    if req.delete_temp_after_export is not None:
        config.delete_temp_after_export = req.delete_temp_after_export
    if req.cooldown_album is not None:
        config.cooldown_album = max(0, req.cooldown_album)
    if req.cooldown_single is not None:
        config.cooldown_single = max(0, req.cooldown_single)
    if req.minimize_to_tray_on_close is not None:
        config.minimize_to_tray_on_close = req.minimize_to_tray_on_close
    if req.minimize_to_tray_on_minimize is not None:
        config.minimize_to_tray_on_minimize = req.minimize_to_tray_on_minimize
    if req.has_seen_tray_notice is not None:
        config.has_seen_tray_notice = req.has_seen_tray_notice
    if req.auto_update_yt_dlp is not None:
        config.auto_update_yt_dlp = req.auto_update_yt_dlp
    if req.auto_check_app_updates is not None:
        config.auto_check_app_updates = req.auto_check_app_updates
    save_config(config)
    return {"success": True, "config": config.dict()}

@app.get("/api/tools/yt-dlp/status")
async def get_yt_dlp_status_endpoint():
    """Retourne l'état, version et timestamp de la dernière vérification de yt-dlp."""
    return get_yt_dlp_status()

@app.post("/api/tools/yt-dlp/update")
async def update_yt_dlp_endpoint():
    """Déclenche la mise à jour manuelle immédiate de yt-dlp."""
    return await update_yt_dlp(force=True)

@app.get("/api/app/update/check")
async def check_app_update_endpoint():
    """Vérifie si une nouvelle release de SoundStash est disponible sur GitHub."""
    return await check_app_update()

@app.post("/api/app/update/download")
async def download_app_update_endpoint(req: DownloadAppUpdateRequest):
    """Télécharge l'exécutable de mise à jour en arrière-plan."""
    return await start_download_update(req.download_url, req.asset_name, req.version)

@app.get("/api/app/update/progress")
async def get_app_update_progress_endpoint():
    """Retourne la progression du téléchargement de la mise à jour."""
    return get_download_progress()

@app.post("/api/app/update/install")
async def install_app_update_endpoint(req: InstallAppUpdateRequest):
    """Lance l'exécutable d'installation téléchargé."""
    return launch_installer(req.installer_path)

@app.post("/api/app/update/open-browser")
async def open_browser_release_endpoint(req: OpenBrowserRequest):
    """Ouvre la page de release GitHub dans le navigateur par défaut."""
    return open_release_in_browser(req.url)

@app.post("/api/app/reset")
async def reset_application():
    """Réinitialise la configuration aux valeurs d'usine, supprime les brouillons et vide le cache."""
    try:
        default_cfg = AppConfig()
        for k, v in default_cfg.dict().items():
            setattr(config, k, v)
        save_config(config)

        deleted_drafts = 0
        if TEMP_DOWNLOAD_DIR.exists():
            for item in TEMP_DOWNLOAD_DIR.iterdir():
                if item.is_dir():
                    ed_file = item / ".editor_draft.json"
                    rp_file = item / ".reconstitute_pending.json"
                    if ed_file.exists():
                        try:
                            ed_file.unlink()
                            deleted_drafts += 1
                        except Exception as e:
                            print(f"[Reset] Erreur suppression brouillon {ed_file}: {e}")
                    if rp_file.exists():
                        try:
                            rp_file.unlink()
                            deleted_drafts += 1
                        except Exception as e:
                            print(f"[Reset] Erreur suppression sélection {rp_file}: {e}")

        if PREVIEW_CACHE_DIR.exists():
            try:
                safe_rmtree(PREVIEW_CACHE_DIR)
                PREVIEW_CACHE_DIR.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                print(f"[Reset] Erreur purge cache aperçu: {e}")

        return {
            "success": True,
            "message": "Application réinitialisée aux réglages d'usine avec succès.",
            "deleted_drafts": deleted_drafts,
            "config": config.dict()
        }
    except Exception as exc:
        print(f"[Reset] Erreur globale lors de la réinitialisation: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))

def is_youtube_url(url: str) -> bool:
    """Vérifie strictement que l'URL appartient au domaine YouTube ou YouTube Music."""
    if not url:
        return False
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url.strip())
        host = (parsed.hostname or "").lower()
        return (
            host == "youtube.com" or
            host.endswith(".youtube.com") or
            host == "youtu.be" or
            host.endswith(".youtu.be")
        )
    except Exception:
        return False

@app.post("/api/download")
async def trigger_download(req: DownloadRequest):
    is_ext = req.is_external if req.is_external is not None else (not is_youtube_url(req.url))

    res = download_manager.enqueue_download(
        url=req.url,
        title=req.title,
        audio_format=req.format,
        audio_quality=req.quality,
        auto_retag=req.auto_retag,
        naming_pattern=req.naming_pattern,
        clean_titles=req.clean_titles,
        is_playlist=req.is_playlist,
        custom_album=req.custom_album,
        custom_artist=clean_artist_name(req.custom_artist) if req.custom_artist else None,
        origin_album=req.origin_album,
        thumbnail_url=req.thumbnail_url,
        video_quality=req.video_quality,
        is_external=is_ext
    )
    return res


@app.get("/api/search")
async def search_endpoint(query: str = Query(..., min_length=1), filter_type: str = "all"):
    clean_q = query.strip()
    if not clean_q:
        return {"results": [], "continuation": None}

    # 1. Essai prioritaire via l'API officielle YouTube Music Innertube
    innertube_res = await search_ytm_innertube(clean_q, filter_type)
    if innertube_res and innertube_res.get("results"):
        return innertube_res

    # 2. Fallback robuste via yt-dlp si Innertube n'a pas répondu
    search_query = clean_q
    if filter_type == "artist":
        search_query += " official artist"
    elif filter_type == "album":
        if "album" not in clean_q.lower():
            search_query += " album official"
    elif filter_type == "playlist":
        if "playlist" not in clean_q.lower():
            search_query += " playlist"
    elif filter_type == "track":
        if "song" not in clean_q.lower() and "audio" not in clean_q.lower():
            search_query += " audio"
    elif filter_type == "video":
        if "clip" not in clean_q.lower() and "video" not in clean_q.lower():
            search_query += " clip officiel"

    cmd = [
        YT_DLP_PATH,
        "--flat-playlist",
        "--dump-single-json",
        "--skip-download",
        "--no-warnings",
        "--ignore-errors",
        f"ytsearch20:{search_query}"
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=35.0)

        if not stdout:
            err_msg = stderr.decode("utf-8", errors="ignore").strip() if stderr else "Aucun résultat trouvé."
            return {"results": [], "continuation": None, "error": err_msg}

        data = json.loads(stdout.decode("utf-8", errors="ignore"))
        entries = data.get("entries") or []

        results = []
        for item in entries:
            if not item:
                continue
            item_id = item.get("id") or ""
            title = item.get("title") or "Titre inconnu"
            uploader = clean_artist_name(item.get("uploader") or item.get("channel") or item.get("artist") or "Artiste inconnu")
            duration_sec = item.get("duration")
            duration_str = None
            if duration_sec and isinstance(duration_sec, (int, float)):
                hrs = int(duration_sec // 3600)
                mins = int((duration_sec % 3600) // 60)
                secs = int(duration_sec % 60)
                duration_str = f"{hrs}:{mins:02d}:{secs:02d}" if hrs > 0 else f"{mins}:{secs:02d}"

            raw_url = item.get("url") or ""
            if raw_url.startswith("http"):
                url = raw_url
            elif item_id:
                if item.get("_type") == "playlist" or item_id.startswith("PL") or item_id.startswith("OLAK"):
                    url = f"https://music.youtube.com/playlist?list={item_id}"
                else:
                    url = f"https://music.youtube.com/watch?v={item_id}"
            else:
                url = raw_url

            thumbs = item.get("thumbnails") or []
            thumb_url = thumbs[-1].get("url") if thumbs else (item.get("thumbnail") or f"https://i.ytimg.com/vi/{item_id}/hqdefault.jpg")

            title_lower = title.lower()
            is_clip = any(k in title_lower for k in ["clip", "video", "vidéo", "live"])

            # Détection concert / live / œuvre longue
            is_concert = False
            if (duration_sec and duration_sec >= 1200) or bool(re.search(
                r"\b(full\s+concert|live\s+at|live\s+in|concert\s+complet|live\s+tour|festival\s+live|live\s+session|live\s+show|en\s+concert)\b",
                title_lower
            )):
                is_concert = True

            item_type = "track"
            if item.get("_type") == "playlist" or "playlist" in url or item_id.startswith("PL") or item_id.startswith("OLAK") or item_id.startswith("MPREb_"):
                item_type = "album" if (item_id.startswith("OLAK") or item_id.startswith("MPREb_")) else "playlist"
            elif is_concert or is_clip or filter_type == "video":
                item_type = "video"
            elif filter_type == "album":
                item_type = "album"
            elif filter_type == "track":
                item_type = "track"

            # Si filter_type spécifique, respecter le filtrage strict
            if filter_type != "all" and item_type != filter_type:
                continue

            results.append({
                "id": item_id,
                "title": title,
                "artist": uploader,
                "duration": duration_str,
                "url": url,
                "thumbnail": thumb_url,
                "type": item_type,
                "is_concert": is_concert
            })

        return {"results": results, "continuation": None}
    except asyncio.TimeoutError:
        return {"results": [], "continuation": None, "error": "La recherche a expiré."}
    except Exception as e:
        return {"results": [], "continuation": None, "error": f"Erreur lors de la recherche : {str(e)}"}

@app.get("/api/search/more")
async def search_more_endpoint(continuation: str = Query(..., min_length=1), filter_type: str = "all"):
    """
    Charge le lot suivant de résultats de recherche (pagination continue Innertube).
    """
    clean_token = continuation.strip()
    if not clean_token:
        return {"results": [], "continuation": None}
    data = await search_ytm_continuation(clean_token, filter_type=filter_type)
    return data

@app.get("/api/artist/discography")
async def get_artist_discography(browse_id: str = Query(...), artist_name: str = Query("")):
    """
    Récupère la discographie officielle 100% authentique d'un artiste (albums, singles, EPs).
    Élimine 100% des albums hommages, reprises et tiers portant le nom de l'artiste dans le titre.
    """
    clean_id = browse_id.strip()
    if not clean_id:
        return {"results": [], "artist": artist_name, "error": "Identifiant d'artiste manquant", "official": True}
    try:
        res = await browse_artist_discography(clean_id, artist_name)
        return res
    except Exception as e:
        logger.error(f"Erreur chargement discographie artiste '{artist_name}' ({clean_id}): {e}", exc_info=True)
        return {"results": [], "artist": artist_name, "error": str(e), "official": True}

@app.get("/api/album/preview")
async def preview_album_endpoint(url: str = Query(..., min_length=1)):
    """
    Inspecte un album ou une playlist pour :
    1. Obtenir la liste exacte des pistes officielles
    2. Détecter si certaines pistes sont grisées, supprimées ou indisponibles
    3. Préparer les IDs pour la pré-écoute
    """
    clean_url = url.strip()

    # 1. Essai prioritaire via YouTube Music Innertube pour playlists et albums
    browse_id = extract_ytm_browse_id(clean_url)
    if browse_id:
        try:
            ytm_data = await browse_ytm_innertube(browse_id)
            if ytm_data and ytm_data.get("tracks"):
                match_counts = smart_matcher.enrich_preview_tracks(
                    ytm_data["tracks"],
                    album_artist=ytm_data.get("artist") or "",
                    album_title=ytm_data.get("title") or ""
                )
                ytm_data["owned_tracks_count"] = match_counts["owned_count"]
                ytm_data["diff_duration_tracks_count"] = match_counts["different_duration_count"]
                ytm_data["diff_version_tracks_count"] = match_counts["different_version_count"]
                ytm_data["suspicious_artist_tracks_count"] = match_counts["suspicious_artist_count"]
                ytm_data["missing_for_album_count"] = match_counts.get("missing_for_album_count", 0)
                ytm_data["matched_album_name"] = match_counts.get("matched_album_name")
                ytm_data["total_matched_tracks_count"] = match_counts["total_matched"]
                return ytm_data
        except Exception as e:
            print(f"Erreur InnerTube browse preview ({browse_id}): {e}")

    # 2. Fallback via yt-dlp pour les autres URLs (YouTube standard, etc.)
    cmd = [
        YT_DLP_PATH,
        "--flat-playlist",
        "--dump-single-json",
        "--skip-download",
        "--no-warnings",
        "--ignore-errors",
        "--yes-playlist",
        clean_url
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=35.0)

        if not stdout:
            return {"success": False, "message": "Impossible de charger les informations de cet album."}

        data = json.loads(stdout.decode("utf-8", errors="ignore"))
        album_title = data.get("title") or "Album / Playlist"
        album_artist = clean_artist_name(data.get("uploader") or data.get("channel") or "Artiste inconnu")

        entries = data.get("entries") or []
        if not entries and data.get("id"):
            entries = [data]

        tracks = []
        available_count = 0

        for idx, entry in enumerate(entries, start=1):
            if not entry:
                tracks.append({
                    "track_number": idx,
                    "title": f"Piste {idx:02d} (Indisponible)",
                    "artist": album_artist,
                    "duration": None,
                    "is_available": False,
                    "video_id": None
                })
                continue

            track_title = entry.get("title") or ""
            track_id = entry.get("id") or ""
            track_artist = clean_artist_name(entry.get("uploader") or entry.get("channel") or album_artist)
            duration_sec = entry.get("duration")

            is_unavailable = (
                not track_title or
                track_title.strip() in ["[Private video]", "[Deleted video]", "NA"] or
                entry.get("availability") in ["private", "unlisted_subscriber_only"] or
                not track_id
            )

            is_available = not is_unavailable
            if is_available:
                available_count += 1

            dur_str = None
            if duration_sec and isinstance(duration_sec, (int, float)):
                mins = int(duration_sec // 60)
                secs = int(duration_sec % 60)
                dur_str = f"{mins}:{secs:02d}"

            tracks.append({
                "track_number": idx,
                "title": track_title or f"Piste {idx:02d}",
                "artist": track_artist,
                "album": entry.get("album"),
                "duration": dur_str,
                "is_available": is_available,
                "video_id": track_id
            })

        total_tracks = len(tracks)
        missing_count = total_tracks - available_count

        match_counts = smart_matcher.enrich_preview_tracks(
            tracks,
            album_artist=album_artist,
            album_title=album_title
        )

        return {
            "success": True,
            "title": album_title,
            "artist": album_artist,
            "total_tracks": total_tracks,
            "available_tracks": available_count,
            "missing_count": missing_count,
            "owned_tracks_count": match_counts["owned_count"],
            "diff_duration_tracks_count": match_counts["different_duration_count"],
            "diff_version_tracks_count": match_counts["different_version_count"],
            "suspicious_artist_tracks_count": match_counts["suspicious_artist_count"],
            "missing_for_album_count": match_counts.get("missing_for_album_count", 0),
            "matched_album_name": match_counts.get("matched_album_name"),
            "total_matched_tracks_count": match_counts["total_matched"],
            "is_complete": missing_count == 0,
            "tracks": tracks
        }
    except Exception as e:
        return {"success": False, "message": str(e)}

_audio_stream_url_cache = {}

@app.get("/api/stream")
async def stream_track_endpoint(request: Request, id: str = Query(..., min_length=1)):
    """
    Diffuse le flux audio direct d'un morceau YouTube Music pour la pré-écoute dans le lecteur intégré.
    Proxifie le flux vers 127.0.0.1 pour éliminer la censure CORS du Web Audio API (égaliseur / visualiseur).
    """
    video_id = id.strip()
    if not re.match(r'^[a-zA-Z0-9_-]{11}$', video_id):
        raise HTTPException(status_code=400, detail="Identifiant média invalide.")

    # 1. Vérifier si le morceau ou clip est déjà présent dans le cache disque
    preview_dir = Path(PREVIEW_CACHE_DIR)
    if preview_dir.exists():
        for ext, mtype in [(".webm", "audio/webm"), (".opus", "audio/ogg"), (".m4a", "audio/mp4")]:
            cached = preview_dir / f"{video_id}{ext}"
            if cached.exists() and cached.stat().st_size > 50000:
                return FileResponse(path=str(cached), media_type=mtype, filename=f"{video_id}{ext}")

    # 2. Récupérer l'URL directe du flux audio (mise en cache mémoire de 1 heure)
    now = time.time()
    stream_url = None
    if video_id in _audio_stream_url_cache:
        cached_url, exp = _audio_stream_url_cache[video_id]
        if now < exp:
            stream_url = cached_url
        else:
            del _audio_stream_url_cache[video_id]

    if not stream_url:
        cmd = [
            YT_DLP_PATH,
            "-4",
            "--no-warnings",
            "--quiet",
            "-g",
            "-f", "ba/251/140/b",
            f"https://www.youtube.com/watch?v={video_id}"
        ]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=25.0)
            raw = stdout.decode("utf-8", errors="ignore").strip()
            stream_url = next((line.strip() for line in raw.splitlines() if line.strip().startswith("http")), None)
            if stream_url:
                _audio_stream_url_cache[video_id] = (stream_url, now + 3600)
            else:
                err_msg = stderr.decode("utf-8", errors="ignore").strip()
                logger.warning(f"Flux audio introuvable pour {video_id}: {err_msg}")
                raise HTTPException(status_code=404, detail="Flux audio introuvable.")
        except asyncio.TimeoutError:
            logger.error(f"Timeout (25s) lors de l'extraction audio de {video_id}")
            raise HTTPException(status_code=504, detail="Délai d'attente dépassé pour l'extraction audio.")
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Erreur d'extraction audio {video_id}: {e}")
            raise HTTPException(status_code=500, detail=f"Erreur d'extraction audio : {str(e)}")

    # 3. Proxification locale HTTP avec transmission transparente des plages d'octets (Range/Seeking)
    upstream_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    range_header = request.headers.get("range")
    if range_header:
        upstream_headers["Range"] = range_header
    else:
        # Crucial pour Google Video : sans Range, les flux audio YouTube retournent 403 Forbidden
        upstream_headers["Range"] = "bytes=0-"

    try:
        client = httpx.AsyncClient(timeout=20.0, follow_redirects=True)
        req = client.build_request("GET", stream_url, headers=upstream_headers)
        resp = await client.send(req, stream=True)

        # Si le flux mis en cache a expiré ou a été rejeté (ex: 403 Forbidden), invalider et renouveler
        if resp.status_code >= 400 and video_id in _audio_stream_url_cache:
            logger.warning(f"URL de flux audio expirée/rejetée ({resp.status_code}) pour {video_id}, renouvellement...")
            del _audio_stream_url_cache[video_id]
            await resp.aclose()
            cmd = [
                YT_DLP_PATH,
                "-4",
                "--no-warnings",
                "--quiet",
                "-g",
                "-f", "ba/251/140/b",
                f"https://www.youtube.com/watch?v={video_id}"
            ]
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=25.0)
            raw = stdout.decode("utf-8", errors="ignore").strip()
            fresh_url = next((line.strip() for line in raw.splitlines() if line.strip().startswith("http")), None)
            if fresh_url:
                _audio_stream_url_cache[video_id] = (fresh_url, time.time() + 3600)
                req = client.build_request("GET", fresh_url, headers=upstream_headers)
                resp = await client.send(req, stream=True)

        # Repli ultime infaillible : si le flux direct Google Video échoue (code >= 400), diffuser directement via le pipe stdout de yt-dlp
        if resp.status_code >= 400:
            logger.warning(f"Repli sur streaming yt-dlp direct pour {video_id} (code {resp.status_code})")
            await resp.aclose()
            await client.aclose()
            dlp_cmd = [
                YT_DLP_PATH,
                "-4",
                "--no-warnings",
                "--quiet",
                "-f", "ba/251/140/b",
                "-o", "-",
                f"https://www.youtube.com/watch?v={video_id}"
            ]
            dlp_proc = await asyncio.create_subprocess_exec(
                *dlp_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL
            )
            async def aiter_dlp_stream():
                try:
                    while True:
                        chunk = await dlp_proc.stdout.read(32 * 1024)
                        if not chunk:
                            break
                        yield chunk
                finally:
                    try:
                        dlp_proc.kill()
                    except Exception:
                        pass

            dlp_headers = {
                "Accept-Ranges": "bytes",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
                "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0"
            }
            return StreamingResponse(
                aiter_dlp_stream(),
                status_code=200,
                media_type="audio/webm",
                headers=dlp_headers
            )

        resp_headers = {
            "Accept-Ranges": "bytes",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
            "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0"
        }
        for h in ["content-range", "content-length", "content-type"]:
            if h in resp.headers:
                resp_headers[h.title()] = resp.headers[h]

        media_type = resp.headers.get("content-type", "audio/webm")

        async def aiter_stream():
            try:
                async for chunk in resp.aiter_bytes(chunk_size=32 * 1024):
                    yield chunk
            finally:
                await resp.aclose()
                await client.aclose()

        return StreamingResponse(
            aiter_stream(),
            status_code=resp.status_code,
            media_type=media_type,
            headers=resp_headers
        )
    except Exception as e:
        logger.error(f"Erreur proxy streaming audio {video_id}: {e}")
        raise HTTPException(status_code=502, detail=f"Erreur passerelle audio : {str(e)}")

@app.get("/api/video/stream")
async def stream_video_endpoint(id: str = Query(..., min_length=1)):
    """
    Récupère ou diffuse le flux vidéo/audio d'un clip en format WebM haute qualité
    pour le lecteur vidéo natif HTML5 intégré (évite les blocages YouTube Error 150).
    """
    video_id = id.strip()
    if not re.match(r'^[a-zA-Z0-9_-]{11}$', video_id):
        raise HTTPException(status_code=400, detail="Identifiant média invalide.")
    preview_dir = Path(PREVIEW_CACHE_DIR)
    preview_dir.mkdir(parents=True, exist_ok=True)
    cache_file = preview_dir / f"{video_id}.webm"
    part_file = preview_dir / f"{video_id}.webm.part"

    # 1. Si le clip a déjà été entièrement téléchargé et mis en cache
    if cache_file.exists() and cache_file.stat().st_size > 50000:
        return FileResponse(
            path=str(cache_file),
            media_type="video/webm",
            filename=f"{video_id}.webm"
        )

    # 2. Diffusion à la volée avec yt-dlp + ffmpeg
    cmd = [
        YT_DLP_PATH,
        "-4",
        "--no-warnings",
        "-f", "bv*[height<=720]+ba/b",
        "-o", "-",
        "--quiet",
        f"https://www.youtube.com/watch?v={video_id}"
    ]
    if Path(FFMPEG_PATH).exists():
        cmd.insert(2, "--ffmpeg-location")
        cmd.insert(3, str(FFMPEG_PATH))

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL
        )

        async def iter_video_stream():
            try:
                with open(part_file, "wb") as f_out:
                    while True:
                        chunk = await proc.stdout.read(64 * 1024)
                        if not chunk:
                            break
                        f_out.write(chunk)
                        yield chunk
                # Téléchargement terminé avec succès : renommer en .webm pour le cache
                if part_file.exists() and part_file.stat().st_size > 50000:
                    try:
                        if cache_file.exists():
                            cache_file.unlink()
                        part_file.rename(cache_file)
                    except Exception:
                        pass
            except (asyncio.CancelledError, GeneratorExit):
                pass
            finally:
                try:
                    proc.kill()
                except Exception:
                    pass
                try:
                    await proc.wait()
                except Exception:
                    pass
                # Si le fichier partiel est incomplet et le stream a été interrompu
                if part_file.exists() and not cache_file.exists():
                    try:
                        part_file.unlink()
                    except Exception:
                        pass

        return StreamingResponse(
            iter_video_stream(),
            media_type="video/webm",
            headers={
                "Accept-Ranges": "none",
                "Cache-Control": "no-cache"
            }
        )
    except Exception as e:
        logger.error(f"Erreur streaming vidéo : {e}")
        raise HTTPException(status_code=500, detail=str(e))

AUDIO_MIME_TYPES = {
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".opus": "audio/opus",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".aac": "audio/aac",
    ".wma": "audio/x-ms-wma"
}

def _is_safe_audio_path(file_path: Path) -> bool:
    try:
        resolved = file_path.resolve()
        allowed = []
        if config.library_dir and Path(config.library_dir).exists():
            allowed.append(Path(config.library_dir).resolve())
        if config.temp_download_dir and Path(config.temp_download_dir).exists():
            allowed.append(Path(config.temp_download_dir).resolve())
        if config.export_dir and Path(config.export_dir).exists():
            allowed.append(Path(config.export_dir).resolve())
        allowed.append(Path(TEMP_DOWNLOAD_DIR).resolve())

        return any(str(resolved).startswith(str(a)) for a in allowed)
    except Exception:
        return False

@app.get("/api/audio/stream-local")
async def stream_local_audio_endpoint(request: Request, path: str = Query(..., min_length=1)):
    """
    Diffuse un fichier audio local (collection ou temporaire) avec support natif
    du saut temporel (HTTP Range bytes) pour le lecteur audio intégré.
    """
    clean_p = path.strip()
    if not clean_p:
        raise HTTPException(status_code=400, detail="Chemin de fichier audio requis.")

    p = Path(clean_p)
    if not p.is_file():
        raise HTTPException(status_code=404, detail="Fichier audio introuvable.")

    if not _is_safe_audio_path(p):
        raise HTTPException(status_code=403, detail="Accès non autorisé en dehors des dossiers musicaux configurés.")

    ext = p.suffix.lower()
    media_type = AUDIO_MIME_TYPES.get(ext, "audio/mp4")
    file_size = p.stat().st_size

    range_header = request.headers.get("Range")
    if range_header:
        range_match = re.match(r"^bytes=(\d+)-(\d*)$", range_header.strip())
        if range_match:
            start = int(range_match.group(1))
            end_str = range_match.group(2)
            end = int(end_str) if end_str else file_size - 1
            if start >= file_size or end >= file_size or start > end:
                raise HTTPException(
                    status_code=416,
                    detail="Requested range not satisfiable",
                    headers={"Content-Range": f"bytes */{file_size}"}
                )

            chunk_size = end - start + 1

            def iter_file_chunk():
                with open(p, "rb") as f:
                    f.seek(start)
                    remaining = chunk_size
                    buf_size = 64 * 1024
                    while remaining > 0:
                        chunk = f.read(min(remaining, buf_size))
                        if not chunk:
                            break
                        remaining -= len(chunk)
                        yield chunk

            headers = {
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
                "Content-Type": media_type
            }
            return StreamingResponse(iter_file_chunk(), status_code=206, headers=headers)

    return FileResponse(
        path=str(p),
        media_type=media_type,
        filename=p.name,
        headers={"Accept-Ranges": "bytes", "Content-Length": str(file_size)}
    )

@app.get("/api/audio/stream")
async def stream_audio_universal_endpoint(
    request: Request,
    path: Optional[str] = Query(None),
    video_id: Optional[str] = Query(None),
    id: Optional[str] = Query(None)
):
    """
    Point d'entrée universel de streaming audio pour SoundStash.
    - Si 'path' est spécifié : diffuse le fichier audio local (collection ou temporaire).
    - Si 'video_id' ou 'id' est spécifié : diffuse le flux audio en ligne YouTube Music.
    """
    if path and path.strip():
        return await stream_local_audio_endpoint(request, path=path.strip())
    vid = (video_id or id or "").strip()
    if vid:
        return await stream_track_endpoint(request, id=vid)
    raise HTTPException(status_code=400, detail="Paramètre 'path' ou 'id'/'video_id' requis pour la diffusion audio.")

@app.get("/api/audio/cover")
async def get_local_album_cover_endpoint(path: str = Query(..., min_length=1)):
    """
    Renvoie la pochette d'un album local (cover.jpg, folder.jpg, etc.)
    ou le placeholder SVG si aucune image n'est présente.
    """
    clean_p = path.strip()
    if not clean_p:
        raise HTTPException(status_code=400, detail="Chemin d'album requis.")

    p = Path(clean_p)
    if not p.is_dir() and p.is_file():
        p = p.parent

    if not _is_safe_audio_path(p):
        raise HTTPException(status_code=403, detail="Accès non autorisé.")

    placeholder = FRONTEND_DIR / "placeholder-cover.svg"
    if not placeholder.is_file():
        placeholder = FRONTEND_DIR / "placeholder-cover.png"

    if not p.is_dir():
        if placeholder.is_file():
            return FileResponse(path=str(placeholder), media_type="image/svg+xml" if placeholder.suffix == ".svg" else "image/png")
        raise HTTPException(status_code=404, detail="Dossier d'album introuvable.")

    for cover_name in ("cover.jpg", "cover.png", "cover.jpeg", "folder.jpg", "folder.png", "front.jpg", "front.png"):
        candidate = p / cover_name
        if candidate.is_file() and candidate.stat().st_size > 0:
            m_type = "image/png" if candidate.suffix.lower() == ".png" else "image/jpeg"
            return FileResponse(path=str(candidate), media_type=m_type)

    # Vérifier s'il existe une autre image dans le dossier
    try:
        loose_images = [f for f in p.iterdir() if f.is_file() and f.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]
        if loose_images:
            best_img = loose_images[0]
            m_type = "image/png" if best_img.suffix.lower() == ".png" else "image/jpeg"
            return FileResponse(path=str(best_img), media_type=m_type)
    except Exception:
        pass

    # Si aucun fichier image n'est présent, tenter d'extraire la pochette intégrée depuis un fichier audio
    try:
        audio_files = [f for f in p.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS]
        if audio_files:
            target_cover = p / "cover.jpg"
            for af in audio_files:
                if extract_embedded_cover(af, target_cover):
                    # Actualiser le statut has_cover dans library_indexer
                    p_str = str(p.resolve())
                    for alb in library_indexer.albums:
                        if alb.path == str(p) or str(Path(alb.path).resolve()) == p_str:
                            alb.cover_file = str(target_cover)
                    return FileResponse(path=str(target_cover), media_type="image/jpeg")
    except Exception as e:
        logger.warning(f"Erreur extraction à la volée pochette intégrée pour {p}: {e}")

    # Si toujours aucune image, vérifier s'il existe une vidéo correspondante pour cet album / single
    try:
        audio_files = [f for f in p.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS]
        target_cover = p / "cover.jpg"
        matched_video: Optional[Path] = None

        # 1. Vérifier si une vidéo est présente directement dans le dossier
        local_vids = [f for f in p.iterdir() if f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS]
        if local_vids:
            matched_video = local_vids[0]

        # 2. Chercher dans la vidéothèque locale (Mes Vidéos)
        if not matched_video:
            v_dir = video_indexer.get_video_dir()
            candidate_artists = [p.parent.name, p.name]
            for cand_art in candidate_artists:
                cand_v_dir = v_dir / cand_art
                if cand_v_dir.exists() and cand_v_dir.is_dir():
                    v_files = [f for f in cand_v_dir.iterdir() if f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS]
                    if v_files:
                        # Chercher d'abord une correspondance avec le nom d'un des fichiers audio
                        for af in audio_files:
                            stem_lower = af.stem.lower()
                            for vf in v_files:
                                vf_stem_lower = vf.stem.lower()
                                if vf_stem_lower in stem_lower or stem_lower in vf_stem_lower:
                                    matched_video = vf
                                    break
                            if matched_video:
                                break
                        # Sinon prendre la première vidéo de cet artiste
                        if not matched_video:
                            matched_video = v_files[0]
                if matched_video:
                    break

        if matched_video:
            thumb = video_indexer.get_thumbnail_path(matched_video)
            if thumb and thumb.exists() and thumb.suffix.lower() != ".svg":
                # Génération de la pochette collector 1:1 avec le macaron 'Hype Sticker'
                target_artist = p.parent.name if p.name.lower() in {"singles & rips", "singles", "singles and rips"} else p.name
                generate_rip_audio_cover(thumb, target_cover, artist_name=target_artist, subtitle="Single Vidéo")

                # Intégrer également la pochette dans les fichiers audio sans image avec Kid3
                if Path(KID3_CLI_PATH).exists() and audio_files and target_cover.exists():
                    for af in audio_files:
                        try:
                            subprocess.run([
                                str(KID3_CLI_PATH),
                                "-c", f'set picture:"{target_cover.resolve()}" ""',
                                "-c", "save",
                                str(af.resolve())
                            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=8)
                        except Exception:
                            pass
                # Actualiser library_indexer
                p_str = str(p.resolve())
                for alb in library_indexer.albums:
                    if alb.path == str(p) or str(Path(alb.path).resolve()) == p_str:
                        alb.cover_file = str(target_cover)
                return FileResponse(path=str(target_cover), media_type="image/jpeg")
    except Exception as e:
        logger.warning(f"Erreur recherche vidéo pour pochette audio {p}: {e}")

    if placeholder.is_file():
        return FileResponse(path=str(placeholder), media_type="image/svg+xml" if placeholder.suffix == ".svg" else "image/png")
    raise HTTPException(status_code=404, detail="Pochette introuvable.")

@app.get("/api/queue")
async def get_queue_endpoint():
    return download_manager.get_queue_state()

@app.post("/api/queue/cancel-current")
@app.post("/api/cancel")
async def cancel_current_endpoint():
    canceled = download_manager.cancel_current()
    return {"success": canceled}

@app.post("/api/queue/cancel-all")
async def cancel_all_endpoint():
    canceled = download_manager.cancel_all()
    return {"success": canceled}

@app.delete("/api/queue/{task_id}")
async def remove_queue_item_endpoint(task_id: str):
    removed = download_manager.cancel_download(task_id)
    return {"success": removed}

def _scan_albums_in_dir(base_dir: Path) -> list:
    if not base_dir.exists():
        return []
    albums = []
    for item in base_dir.iterdir():
        if item.is_dir():
            if item.name.lower() in {"previews", ".cache", "cache", "_cache", "_external", "_hors_analyse"} or item.name.startswith("."):
                continue
            media_files = [f for f in item.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS]
            media_count = len(media_files)
            if media_count > 0:
                is_video = any(f.suffix.lower() in {".mp4", ".mkv", ".webm", ".avi", ".mov"} for f in media_files) or any(k in item.name.lower() for k in ["[vidéo]", "[video]", "[concert]"])
                is_concert = "[concert]" in item.name.lower() or (is_video and any(w in item.name.lower() for w in ["concert", "live", "bercy", "tour", "festival", "show"]))
                albums.append({
                    "name": item.name,
                    "path": str(item.resolve()),
                    "track_count": media_count,
                    "is_video": is_video,
                    "is_concert": is_concert,
                    "mtime": item.stat().st_mtime
                })
            else:
                sub_has_media = False
                for sub in item.iterdir():
                    if sub.is_dir():
                        sub_media = [f for f in sub.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS]
                        sub_count = len(sub_media)
                        if sub_count > 0:
                            sub_has_media = True
                            sub_is_video = any(f.suffix.lower() in {".mp4", ".mkv", ".webm", ".avi", ".mov"} for f in sub_media) or any(k in sub.name.lower() for k in ["[vidéo]", "[video]", "[concert]"])
                            sub_is_concert = "[concert]" in sub.name.lower() or (sub_is_video and any(w in sub.name.lower() for w in ["concert", "live", "bercy", "tour", "festival", "show"]))
                            albums.append({
                                "name": f"{item.name} / {sub.name}",
                                "path": str(sub.resolve()),
                                "track_count": sub_count,
                                "is_video": sub_is_video,
                                "is_concert": sub_is_concert,
                                "mtime": sub.stat().st_mtime
                            })
    albums.sort(key=lambda a: a["mtime"], reverse=True)
    return albums

@app.get("/api/albums")
async def list_albums():
    temp_dir = Path(config.temp_download_dir)
    return {
        "temp_albums": _scan_albums_in_dir(temp_dir)
    }

ALL_SUPPORTED_MEDIA = AUDIO_EXTENSIONS | {".mp4", ".mkv", ".webm", ".avi", ".mov"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

INVALID_ARTISTS = {"", "artiste inconnu", "unknown artist", "unknown", "na", "extrait video"}
INVALID_ALBUMS = {"", "album inconnu", "extrait video", "unknown album", "unknown", "na"}

def _is_tag_valid(art: Optional[str], alb: Optional[str]):
    a = (art or "").strip().lower()
    b = (alb or "").strip().lower()
    art_ok = bool(a and a not in INVALID_ARTISTS)
    alb_ok = bool(b and b not in INVALID_ALBUMS)
    missing = []
    if not art_ok:
        missing.append("Artiste")
    if not alb_ok:
        missing.append("Titre")
    return (art_ok and alb_ok), missing

@app.get("/api/albums/external")
async def list_external_albums():
    """
    Scanne le dossier temp_downloads/_external pour les téléchargements tiers
    et les imports locaux. Vérifie la complétude des tags (Artiste & Titre requis pour la bibliothèque).
    """
    temp_dir = Path(config.temp_download_dir)
    ext_dir = temp_dir / "_external"
    hors_dir = temp_dir / "_Hors_Analyse"

    hors_count = 0
    if hors_dir.exists():
        hors_count = sum(1 for f in hors_dir.rglob("*") if f.is_file())

    ext_dir.mkdir(parents=True, exist_ok=True)
    hors_dir.mkdir(parents=True, exist_ok=True)

    albums = []
    for item in ext_dir.iterdir():
        if item.is_dir():
            if item.name.startswith("."):
                continue
            media_files = [f for f in item.iterdir() if f.is_file() and f.suffix.lower() in ALL_SUPPORTED_MEDIA]
            if not media_files:
                for sub in item.iterdir():
                    if sub.is_dir() and not sub.name.startswith("."):
                        sub_media = [f for f in sub.iterdir() if f.is_file() and f.suffix.lower() in ALL_SUPPORTED_MEDIA]
                        if sub_media:
                            info = get_album_info(sub)
                            art = (info.get("album_artist") or "").strip()
                            alb = (info.get("album_name") or "").strip()
                            is_valid, missing = _is_tag_valid(art, alb)
                            albums.append({
                                "name": f"{item.name} / {sub.name}",
                                "title": alb or sub.name,
                                "artist": art or "Artiste inconnu",
                                "path": str(sub.resolve()),
                                "track_count": len(sub_media),
                                "has_cover": bool(info.get("cover_art")),
                                "cover_url": f"/api/audio/cover?path={urllib.parse.quote(str(sub.resolve()))}",
                                "is_ready_for_library": is_valid,
                                "missing_tags": missing,
                                "mtime": sub.stat().st_mtime
                            })
            else:
                info = get_album_info(item)
                art = (info.get("album_artist") or "").strip()
                alb = (info.get("album_name") or "").strip()
                is_valid, missing = _is_tag_valid(art, alb)
                albums.append({
                    "name": item.name,
                    "title": alb or item.name,
                    "artist": art or "Artiste inconnu",
                    "path": str(item.resolve()),
                    "track_count": len(media_files),
                    "has_cover": bool(info.get("cover_art")),
                    "cover_url": f"/api/audio/cover?path={urllib.parse.quote(str(item.resolve()))}",
                    "is_ready_for_library": is_valid,
                    "missing_tags": missing,
                    "mtime": item.stat().st_mtime
                })
        elif item.is_file() and item.suffix.lower() in ALL_SUPPORTED_MEDIA:
            folder = ext_dir / sanitize_folder_name(item.stem)
            folder.mkdir(parents=True, exist_ok=True)
            try:
                dest = folder / item.name
                shutil.move(str(item), str(dest))
                info = get_album_info(folder)
                art = (info.get("album_artist") or "").strip()
                alb = (info.get("album_name") or "").strip()
                is_valid, missing = _is_tag_valid(art, alb)
                albums.append({
                    "name": folder.name,
                    "title": alb or folder.name,
                    "artist": art or "Artiste inconnu",
                    "path": str(folder.resolve()),
                    "track_count": 1,
                    "has_cover": bool(info.get("cover_art")),
                    "cover_url": f"/api/audio/cover?path={urllib.parse.quote(str(folder.resolve()))}",
                    "is_ready_for_library": is_valid,
                    "missing_tags": missing,
                    "mtime": folder.stat().st_mtime
                })
            except Exception as e:
                logger.warning(f"Auto-wrap external file {item}: {e}")

    albums.sort(key=lambda a: a["mtime"], reverse=True)
    return {
        "external_albums": albums,
        "hors_analyse_count": hors_count,
        "external_dir": str(ext_dir.resolve()),
        "hors_analyse_dir": str(hors_dir.resolve())
    }

@app.post("/api/library/import-local")
async def import_local_endpoint(req: LocalImportRequest):
    """
    Importe des fichiers ou dossiers locaux.
    Copie quasi-instantanément ce qui est fourni tel quel dans le sas '_imports'
    à la racine de la collection musicale configurée (ou dossier temporaire en repli).
    Déclenche ensuite la synchronisation asynchrone qui organise, tague et classe
    les morceaux dans 'Artiste / Album / XX - Titre.ext'.
    """
    if not req.paths:
        raise HTTPException(status_code=400, detail="Aucun chemin fourni pour l'import.")

    # Déterminer la racine cible de la collection musicale
    lib_dir = Path(config.library_dir) if (config.library_dir and Path(config.library_dir).is_dir()) else None
    if not lib_dir:
        lib_dir = Path(config.temp_download_dir)

    imports_dir = lib_dir / "_imports"
    imports_dir.mkdir(parents=True, exist_ok=True)

    copied_items = 0

    for path_str in req.paths:
        p = Path(path_str.strip('"\' '))
        if not p.exists():
            continue

        try:
            if p.is_file():
                dest = imports_dir / p.name
                if dest.exists() and dest.resolve() != p.resolve():
                    dest = imports_dir / f"{p.stem}_{int(time.time() * 1000) % 100000}{p.suffix}"
                if dest.resolve() != p.resolve():
                    shutil.copy2(str(p), str(dest))
                copied_items += 1

            elif p.is_dir():
                target_folder = imports_dir / (sanitize_folder_name(req.target_folder_name) if req.target_folder_name else p.name)
                if target_folder.exists() and target_folder.resolve() != p.resolve():
                    target_folder = imports_dir / f"{target_folder.name}_{int(time.time() * 1000) % 100000}"
                target_folder.mkdir(parents=True, exist_ok=True)
                shutil.copytree(str(p), str(target_folder), dirs_exist_ok=True)
                copied_items += 1
        except Exception as e:
            logger.error(f"Erreur copie locale vers _imports pour '{p}': {e}", exc_info=True)

    # Déclencher immédiatement le traitement prioritaire du sas _imports puis la veille de fond
    def _run_priority_import_sync():
        try:
            # 1. Priorité absolue : extraction, classement et indexation immédiate de _imports (~2ms)
            heal_imports_folder(lib_dir, notify_cb=dispatch_sync_notification)

            # 2. Synchronisation globale en tâche de fond pour l'intégrité du reste de la collection
            synchronize_collection(library_dir=str(lib_dir), is_automatic=True)
        except Exception as err:
            logger.error(f"Erreur synchronisation prioritaire post-import _imports : {err}", exc_info=True)

    threading.Thread(target=_run_priority_import_sync, daemon=True).start()

    msg = f"{copied_items} élément(s) déposé(s) dans _imports. Intégration prioritaire en cours..."
    return {
        "success": True,
        "imported_count": copied_items,
        "staging_dir": str(imports_dir.resolve()),
        "message": msg
    }

@app.post("/api/album/export-custom")
async def export_custom_endpoint(req: ExportCustomRequest):
    """
    Exporte un album ou dossier temporaire vers n'importe quel emplacement spécifié par l'utilisateur
    (clé USB, bureau, dossier personnalisé, etc.).
    """
    if not req.source_path or not req.target_dir:
        raise HTTPException(status_code=400, detail="Chemin source et dossier cible requis.")
    src = Path(req.source_path).resolve()
    tgt = Path(req.target_dir).resolve()
    if not src.exists():
        raise HTTPException(status_code=404, detail="Dossier source introuvable.")
    if not tgt.exists() or not tgt.is_dir():
        raise HTTPException(status_code=400, detail="Dossier cible introuvable ou inaccessible.")

    dest_folder = tgt / src.name
    if dest_folder.exists():
        dest_folder = tgt / f"{src.name}_{int(time.time())}"

    try:
        shutil.copytree(str(src), str(dest_folder))
        if req.delete_source:
            safe_rmtree(src)
            dispatch_library_updated()
        return {
            "success": True,
            "target_path": str(dest_folder),
            "message": f"Exporté avec succès vers {dest_folder.name}"
        }
    except Exception as e:
        logger.error(f"Erreur export custom : {e}")
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'exportation personnalisée : {str(e)}")

@app.get("/api/genre/detect")
async def detect_genre_endpoint(
    artist: str = Query(..., min_length=1),
    title: str = Query(..., min_length=1),
    is_album: bool = Query(False)
):
    genre = await detect_genre(artist=artist, title_or_album=title, is_album=is_album)
    return {"success": True, "genre": genre}

@app.get("/api/album/info")
async def get_album_details(path: str = Query(...)):
    if not path.strip():
        raise HTTPException(status_code=400, detail="Chemin d'album requis")
    album_p = Path(path)
    if not album_p.exists() or not album_p.is_dir():
        # Repli intelligent : chercher si le dossier a été renommé ou existe sous une variante dans le même dossier parent
        parent_p = album_p.parent
        if parent_p.exists() and parent_p.is_dir():
            target_norm = normalize_text(album_p.name)
            for sub in parent_p.iterdir():
                if sub.is_dir() and (normalize_text(sub.name) == target_norm or target_norm in normalize_text(sub.name)):
                    album_p = sub
                    break
        if not album_p.exists() or not album_p.is_dir():
            raise HTTPException(status_code=404, detail="Dossier d'album introuvable")
    return get_album_info(album_p)

@app.post("/api/album/retag")
async def retag_album(req: RetagRequest):
    if not req.album_dir.strip():
        raise HTTPException(status_code=400, detail="Chemin d'album requis")
    album_p = Path(req.album_dir)
    if not album_p.exists() or not album_p.is_dir():
        raise HTTPException(status_code=404, detail="Dossier d'album introuvable")
    
    res = uniformize_album(
        album_dir=album_p,
        custom_album=req.custom_album,
        custom_artist=clean_artist_name(req.custom_artist) if req.custom_artist else None,
        custom_year=req.custom_year,
        custom_genre=req.custom_genre,
        rename_files=req.rename_files,
        naming_pattern=req.naming_pattern,
        clean_titles=req.clean_titles,
        custom_tracks=req.custom_tracks,
        is_playlist=req.is_playlist
    )
    if res.get("success"):
        clear_editor_draft(album_p)
        new_album_dir = Path(res.get("album_dir", album_p))
        invalidate_album_cache(album_p)
        invalidate_album_cache(new_album_dir)
        if config.library_dir and Path(config.library_dir).exists():
            try:
                lib_resolved = str(Path(config.library_dir).resolve())
                if str(new_album_dir.resolve()).startswith(lib_resolved) or str(album_p.resolve()).startswith(lib_resolved):
                    if new_album_dir.resolve() != album_p.resolve():
                        library_indexer.remove_album_by_path(album_p)
                    library_indexer.add_or_update_album(new_album_dir)
            except Exception as e:
                logger.warning(f"Erreur mise à jour indexothèque après retag : {e}")
    return res

@app.post("/api/album/save-draft")
async def save_editor_draft_endpoint(req: SaveEditorDraftRequest):
    if not req.album_dir.strip():
        raise HTTPException(status_code=400, detail="Chemin d'album requis")
    album_p = Path(req.album_dir)
    if not album_p.exists() or not album_p.is_dir():
        raise HTTPException(status_code=404, detail="Dossier d'album introuvable")
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, save_editor_draft, album_p, req.draft)

@app.post("/api/album/clear-draft")
async def clear_editor_draft_endpoint(req: ClearEditorDraftRequest):
    if not req.album_dir.strip():
        raise HTTPException(status_code=400, detail="Chemin d'album requis")
    album_p = Path(req.album_dir)
    if not album_p.exists() or not album_p.is_dir():
        raise HTTPException(status_code=404, detail="Dossier d'album introuvable")
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, clear_editor_draft, album_p)

@app.get("/api/album/missing-details")
async def get_album_missing_details(path: str = Query(...)):
    if not path.strip():
        raise HTTPException(status_code=400, detail="Chemin d'album requis")
    album_p = Path(path)
    if not album_p.exists() or not album_p.is_dir():
        raise HTTPException(status_code=404, detail="Dossier d'album introuvable")
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, get_missing_tracks_details, album_p)

@app.post("/api/album/save-pending-substitutes")
async def save_pending_substitutes_endpoint(req: SavePendingSubstitutesRequest):
    if not req.album_dir.strip():
        raise HTTPException(status_code=400, detail="Chemin d'album requis")
    album_p = Path(req.album_dir)
    if not album_p.exists() or not album_p.is_dir():
        raise HTTPException(status_code=404, detail="Dossier d'album introuvable")
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, save_pending_substitutes, album_p, req.substitutes)

@app.post("/api/album/reconstitute")
async def reconstitute_album(req: ReconstituteRequest):
    if not req.album_dir.strip():
        raise HTTPException(status_code=400, detail="Chemin d'album requis")
    album_p = Path(req.album_dir)
    if not album_p.exists() or not album_p.is_dir():
        raise HTTPException(status_code=404, detail="Dossier d'album introuvable")

    if not req.substitutes:
        return {"success": False, "message": "Aucun substitut fourni"}

    info = get_album_info(album_p)
    total_tracks = info.get("max_track") or len(info.get("tracks", []))
    album_name = req.custom_album or info.get("album_name")
    album_artist = clean_artist_name(req.custom_artist or info.get("album_artist"))
    year = req.custom_year or info.get("year")
    genre = req.custom_genre or info.get("genre")

    loop = asyncio.get_event_loop()
    results = []
    for sub in req.substitutes:
        def do_integrate():
            return integrate_substitute_track(
                album_dir=album_p,
                track_number=sub.track_number,
                total_tracks=total_tracks,
                video_id=sub.video_id,
                title=sub.title,
                artist=sub.artist,
                album_name=album_name,
                album_artist=album_artist,
                year=year,
                genre=genre
            )
        res = await loop.run_in_executor(None, do_integrate)
        results.append(res)

    # Nettoyer les substituts intégrés du fichier de persistance .reconstitute_pending.json
    integrated_nums = {sub.track_number for sub in req.substitutes}
    pending_file = album_p / ".reconstitute_pending.json"
    if pending_file.exists():
        try:
            with open(pending_file, "r", encoding="utf-8") as pf:
                cur_pending = json.load(pf)
            new_pending = {k: v for k, v in cur_pending.items() if int(k) not in integrated_nums}
            if new_pending:
                with open(pending_file, "w", encoding="utf-8") as pf:
                    json.dump(new_pending, pf, ensure_ascii=False, indent=2)
            else:
                pending_file.unlink()
        except Exception:
            pass

    updated_info = get_album_info(album_p)
    remaining_missing = len(updated_info.get("missing_tracks", []))

    return {
        "success": all(r.get("success") for r in results),
        "results": results,
        "remaining_missing": remaining_missing,
        "album": updated_info
    }

folder_picker_executor = ThreadPoolExecutor(max_workers=1)
_folder_picker_lock = threading.Lock()

def _pick_folder_sync(initial_dir: str = "") -> str:
    # 1. Sous Windows : utiliser PowerShell avec FolderBrowserDialog modal au premier plan
    if os.name == "nt":
        try:
            ps_code = (
                "$ErrorActionPreference = 'SilentlyContinue'; "
                "Add-Type -AssemblyName System.Windows.Forms; "
                "$dlg = New-Object System.Windows.Forms.FolderBrowserDialog; "
                "$dlg.Description = 'Sélectionnez un dossier'; "
                "$dlg.ShowNewFolderButton = $true; "
            )
            if initial_dir and os.path.isdir(initial_dir):
                clean_init = initial_dir.replace("'", "''")
                ps_code += f"$dlg.SelectedPath = '{clean_init}'; "
            ps_code += "if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::WriteLine($dlg.SelectedPath) }"

            res = subprocess.run(
                ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps_code],
                capture_output=True,
                text=True,
                timeout=120
            )
            out = res.stdout.strip()
            if out and os.path.isdir(out):
                return str(Path(out).resolve())
            return ""
        except Exception as e:
            logger.warning(f"Erreur FolderBrowserDialog PowerShell: {e}")

    # 2. Repli Tkinter pour les autres environnements
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes('-topmost', True)
        selected = filedialog.askdirectory(
            initialdir=initial_dir if initial_dir and Path(initial_dir).exists() else None,
            title="Sélectionnez un dossier"
        )
        root.destroy()
        return str(Path(selected).resolve()) if selected else ""
    except Exception as e:
        logger.warning(f"Erreur tkinter filedialog: {e}")
        return ""

@app.post("/api/browse-folder")
async def browse_folder_endpoint(req: BrowseFolderRequest):
    loop = asyncio.get_event_loop()
    selected_path = await loop.run_in_executor(folder_picker_executor, _pick_folder_sync, req.initial_dir or "")
    return {"path": selected_path}

def purge_all_temp_files():
    temp_dir = Path(config.temp_download_dir)
    if temp_dir.exists():
        for item in temp_dir.iterdir():
            try:
                if item.is_dir():
                    safe_rmtree(item)
                elif item.is_file():
                    item.unlink()
            except Exception as e:
                print(f"Erreur purge temp {item}: {e}")

@app.post("/api/album/export")
async def export_album_endpoint(req: ExportRequest):
    if not req.album_dir or not req.album_dir.strip():
        raise HTTPException(status_code=400, detail="Dossier d'album source invalide ou vide.")
    album_p = Path(req.album_dir)
    temp_dir = Path(config.temp_download_dir).resolve()
    resolved_album = album_p.resolve()
    if resolved_album == temp_dir or not resolved_album.is_relative_to(temp_dir):
        raise HTTPException(status_code=400, detail="Seuls les sous-dossiers du dossier temporaire peuvent être exportés.")
    if not album_p.exists() or not album_p.is_dir():
        raise HTTPException(status_code=404, detail="Dossier d'album source introuvable.")

    if "_external" in str(album_p.resolve()):
        art = (req.custom_artist or "").strip()
        alb = (req.custom_album or "").strip()
        if not art or not alb:
            info = get_album_info(album_p)
            if not art:
                art = (info.get("album_artist") or "").strip()
            if not alb:
                alb = (info.get("album_name") or "").strip()
        valid, missing = _is_tag_valid(art, alb)
        if not valid:
            raise HTTPException(
                status_code=400,
                detail=f"Tags obligatoires manquants : L'Artiste et le Titre de l'album doivent être renseignés pour exporter vers la bibliothèque musicale (manquant : {' & '.join(missing)})."
            )

    try:
        
        target_base = Path(req.target_base_dir) if req.target_base_dir else None
        res = export_album(
            album_dir=album_p,
            target_base_dir=target_base,
            delete_temp=req.delete_temp,
            custom_album=req.custom_album,
            custom_artist=clean_artist_name(req.custom_artist) if req.custom_artist else None,
            custom_year=req.custom_year,
            custom_genre=req.custom_genre,
            custom_tracks=req.custom_tracks,
            is_playlist=req.is_playlist,
            is_concert=req.is_concert,
            conflict_policy=req.conflict_policy
        )
        # Actualiser immédiatement la bibliothèque et supprimer le dossier source si demandé
        if res.get("success"):
            if res.get("export_dir"):
                try:
                    library_indexer.add_or_update_album(res["export_dir"])
                except Exception as e:
                    logger.warning(f"Erreur actualisation indexothèque post-export : {e}")
            if req.delete_temp and album_p.exists():
                import gc
                gc.collect()
                safe_rmtree(album_p)
            dispatch_library_updated()
        return res
    except Exception as e:
        return {"success": False, "message": f"Erreur lors de l'export : {str(e)}"}

@app.delete("/api/album/temp")
async def delete_temp_endpoint(req: ActionPathRequest):
    if not req.path or not req.path.strip():
        raise HTTPException(status_code=400, detail="Chemin requis.")
    album_p = Path(req.path)
    temp_dir = Path(config.temp_download_dir).resolve()
    resolved_album = album_p.resolve()
    ext_dir = (temp_dir / "_external").resolve()
    hors_dir = (temp_dir / "_Hors_Analyse").resolve()
    if resolved_album in (temp_dir, ext_dir, hors_dir) or not resolved_album.is_relative_to(temp_dir):
        raise HTTPException(status_code=400, detail="Seuls les sous-dossiers d'albums temporaires peuvent être supprimés.")
    
    res = delete_temp_album(album_p)
    if res.get("success"):
        dispatch_library_updated()
    return res

@app.delete("/api/album/exported")
async def delete_exported_album_endpoint(req: ActionPathRequest):
    album_p = Path(req.path).resolve()
    export_dir = Path(config.export_dir).resolve()
    video_export_dir = Path(config.video_export_dir).resolve()
    is_in_music = album_p.is_relative_to(export_dir)
    is_in_video = album_p.is_relative_to(video_export_dir)
    if not (is_in_music or is_in_video):
        raise HTTPException(status_code=400, detail="Le dossier n'est pas dans le dossier d'exportation.")

    if album_p.exists() and album_p.is_dir():
        try:
            safe_rmtree(album_p)
            # Si le dossier parent (Artiste) est maintenant vide, on le supprime aussi
            parent = album_p.parent
            base_dir = video_export_dir if is_in_video else export_dir
            if parent != base_dir and parent.exists() and not any(parent.iterdir()):
                safe_rmtree(parent)
            return {"success": True, "message": "Album exporté supprimé avec succès."}
        except Exception as e:
            return {"success": False, "message": str(e)}
    return {"success": False, "message": "Dossier introuvable."}

@app.post("/api/exported/clear")
async def clear_all_exported_endpoint():
    export_dir = Path(config.export_dir).resolve()
    if not export_dir.exists():
        return {"success": True, "message": "Le dossier d'exportation n'existe pas."}
    
    deleted_count = 0
    try:
        for item in export_dir.iterdir():
            if item.is_dir():
                safe_rmtree(item)
                deleted_count += 1
            elif item.is_file():
                item.unlink()
                deleted_count += 1
        return {"success": True, "deleted_count": deleted_count, "message": f"{deleted_count} élément(s) supprimé(s) du dossier d'exportation."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors du nettoyage : {str(e)}")

@app.post("/api/temp/clear")
async def clear_all_temp_endpoint():
    target_dirs = []
    if config.temp_download_dir:
        p = Path(config.temp_download_dir).resolve()
        if p not in target_dirs:
            target_dirs.append(p)
    if TEMP_DOWNLOAD_DIR:
        p = TEMP_DOWNLOAD_DIR.resolve()
        if p not in target_dirs:
            target_dirs.append(p)

    deleted_count = 0
    try:
        for t_dir in target_dirs:
            if not t_dir.exists():
                continue
            for item in t_dir.iterdir():
                if item.name.startswith(".library_cache"):
                    continue
                if item.is_dir():
                    safe_rmtree(item)
                    deleted_count += 1
                elif item.is_file():
                    item.unlink()
                    deleted_count += 1
        dispatch_library_updated()
        return {"success": True, "deleted_count": deleted_count, "message": f"{deleted_count} élément(s) supprimé(s) du dossier temporaire."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors du nettoyage : {str(e)}")

@app.post("/api/temp/export-all")
async def export_all_temp_endpoint(req: ExportAllRequest):
    target_base = Path(req.target_base_dir) if req.target_base_dir else None
    temp_dir = Path(config.temp_download_dir)
    res = export_all_temp_albums(
        temp_base_dir=temp_dir,
        target_base_dir=target_base,
        delete_temp=req.delete_temp,
        conflict_policy=req.conflict_policy
    )
    if res.get("success"):
        dispatch_library_updated()
    return res

@app.post("/api/album/open-folder")
async def open_folder_endpoint(req: ActionPathRequest):
    if not req.path.strip():
        raise HTTPException(status_code=400, detail="Chemin requis.")
    success = open_in_explorer(req.path)
    if not success:
        raise HTTPException(status_code=500, detail="Impossible d'ouvrir l'explorateur.")
    return {"success": True}

@app.get("/api/cover")
async def get_cover_image(path: str = Query(...)):
    if not path.strip():
        raise HTTPException(status_code=400, detail="Chemin requis.")
    target = Path(path).resolve()
    if not _is_safe_audio_path(target):
        raise HTTPException(status_code=403, detail="Accès refusé.")
        
    if target.exists() and target.is_file():
        m_type = "image/png" if target.suffix.lower() == ".png" else "image/jpeg"
        return FileResponse(str(target), media_type=m_type)
    raise HTTPException(status_code=404, detail="Image de couverture introuvable")

# Cache mémoire simple pour les pochettes proxy (jusqu'à 300 images)
_COVER_CACHE = {}
_COVER_CACHE_MAX = 300

@app.get("/api/proxy-cover")
async def proxy_cover_image(url: str = Query(...)):
    """
    Relais mandataire sécurisé pour les miniatures Google CDN/YouTube Music.
    Permet de contourner les blocages de Referer ou les erreurs 429 du CDN Google.
    """
    if not url.startswith("https://") or not any(d in url for d in ["googleusercontent.com", "ytimg.com", "ggpht.com", "youtube.com"]):
        raise HTTPException(status_code=400, detail="URL d'image non autorisée")

    if url in _COVER_CACHE:
        content_bytes, content_type = _COVER_CACHE[url]
        return Response(
            content=content_bytes,
            media_type=content_type,
            headers={"Cache-Control": "public, max-age=86400"}
        )

    try:
        clean_headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        }
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=clean_headers)
            if resp.status_code == 200:
                content_type = resp.headers.get("content-type", "image/jpeg")
                content = resp.content
                if len(_COVER_CACHE) >= _COVER_CACHE_MAX:
                    first_key = next(iter(_COVER_CACHE))
                    del _COVER_CACHE[first_key]
                _COVER_CACHE[url] = (content, content_type)
                return Response(
                    content=content,
                    media_type=content_type,
                    headers={"Cache-Control": "public, max-age=86400"}
                )
            else:
                if "=w544-h544-" in url:
                    fallback_url = url.replace("=w544-h544-", "=w226-h226-")
                    resp_fb = await client.get(fallback_url, headers=clean_headers)
                    if resp_fb.status_code == 200:
                        content_type = resp_fb.headers.get("content-type", "image/jpeg")
                        content = resp_fb.content
                        if len(_COVER_CACHE) >= _COVER_CACHE_MAX:
                            first_key = next(iter(_COVER_CACHE))
                            del _COVER_CACHE[first_key]
                        _COVER_CACHE[url] = (content, content_type)
                        return Response(
                            content=content,
                            media_type=content_type,
                            headers={"Cache-Control": "public, max-age=86400"}
                        )
                raise HTTPException(status_code=resp.status_code, detail="Erreur chargement image CDN")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Échec du relais d'image : {str(e)}")


class ApplyCoverRequest(BaseModel):
    album_path: str
    cover_url: str
    embed_in_tags: bool = True


@app.get("/api/album/search-covers")
async def search_album_covers_endpoint(
    artist: Optional[str] = Query(None),
    album: Optional[str] = Query(None),
    query: Optional[str] = Query(None)
):
    """
    Recherche des pochettes d'albums officielles haute résolution sur YouTube Music.
    """
    search_q = (query or "").strip()
    if not search_q:
        art = (artist or "").strip()
        alb = (album or "").strip()
        search_q = f"{art} {alb}".strip()
    if not search_q:
        raise HTTPException(status_code=400, detail="Terme de recherche d'album requis.")

    try:
        raw_results = await search_ytm_innertube(query=search_q, filter_type="album")
        items = raw_results.get("results", []) or raw_results.get("items", [])

        candidates = []
        for item in items:
            thumb = item.get("thumbnail") or item.get("cover_url") or ""
            if thumb and "googleusercontent.com" in thumb:
                hi_res_thumb = re.sub(r'=w\d+-h\d+[^=]*$', '=w800-h800-l90-rj', thumb)
                if not hi_res_thumb.endswith("=w800-h800-l90-rj"):
                    hi_res_thumb = f"{thumb}=w800-h800-l90-rj" if "=" not in thumb else re.sub(r'=[^=]+$', '=w800-h800-l90-rj', thumb)
            else:
                hi_res_thumb = thumb

            if hi_res_thumb:
                candidates.append({
                    "title": item.get("title", ""),
                    "artist": item.get("artist", ""),
                    "year": item.get("year", ""),
                    "track_count": item.get("track_count"),
                    "thumbnail": hi_res_thumb,
                    "browse_id": item.get("id") or item.get("browse_id", "")
                })

        return {"query": search_q, "candidates": candidates, "total": len(candidates)}
    except Exception as e:
        logger.warning(f"Erreur recherche pochettes YTM pour '{search_q}': {e}")
        return {"query": search_q, "candidates": [], "total": 0, "error": str(e)}


@app.post("/api/album/apply-cover")
async def apply_album_cover_endpoint(req: ApplyCoverRequest):
    """
    Télécharge une pochette officielle depuis YouTube Music,
    l'enregistre sous 'cover.jpg' dans le dossier de l'album,
    et optionnellement l'injecte dans les tags audio via Kid3-CLI.
    """
    clean_path = req.album_path.strip()
    if not clean_path:
        raise HTTPException(status_code=400, detail="Chemin d'album requis.")
    p = Path(clean_path).resolve()
    if not p.is_dir():
        raise HTTPException(status_code=404, detail="Dossier d'album introuvable.")
    if not _is_safe_audio_path(p):
        raise HTTPException(status_code=403, detail="Accès non autorisé hors des répertoires configurés.")

    cover_url = req.cover_url.strip()
    if not cover_url.startswith("http://") and not cover_url.startswith("https://"):
        raise HTTPException(status_code=400, detail="URL de pochette invalide.")

    try:
        clean_headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        }
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(cover_url, headers=clean_headers)
            if resp.status_code != 200 or len(resp.content) < 1000:
                raise HTTPException(status_code=400, detail="Impossible de télécharger l'image depuis l'URL fournie.")
            img_bytes = resp.content
    except Exception as e:
        logger.warning(f"Erreur téléchargement pochette YTM : {e}")
        raise HTTPException(status_code=500, detail=f"Erreur lors du téléchargement de la pochette : {e}")

    target_cover = p / "cover.jpg"
    try:
        with open(target_cover, "wb") as f:
            f.write(img_bytes)
        logger.info(f"Pochette sauvegardée avec succès : {target_cover} ({len(img_bytes)} octets)")
    except Exception as e:
        logger.error(f"Impossible d'écrire cover.jpg dans {p} : {e}")
        raise HTTPException(status_code=500, detail=f"Écriture disque impossible : {e}")

    # Injection dans les tags audio si demandé via Kid3-CLI
    audio_files = [f for f in p.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS]
    if req.embed_in_tags and audio_files and Path(KID3_CLI_PATH).exists():
        try:
            kid3_args = [str(KID3_CLI_PATH), "-c", f'set picture:"{str(target_cover.resolve())}" ""']
            for af in audio_files:
                kid3_args.append(str(af.resolve()))
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, subprocess.run, kid3_args, {"capture_output": True, "timeout": 30})
            logger.info(f"Pochette injectée dans les tags de {len(audio_files)} fichier(s) via Kid3.")
        except Exception as e:
            logger.warning(f"Avertissement injection pochette Kid3 : {e}")

    # Mettre à jour l'indexothèque en mémoire et cache
    for alb in library_indexer.albums:
        if alb.path == str(p) or Path(alb.path).resolve() == p:
            alb.cover_file = str(target_cover)
    library_indexer._save_to_cache()
    invalidate_album_cache(p)

    return {
        "success": True,
        "album_path": str(p),
        "cover_url": f"/api/audio/cover?path={urllib.parse.quote(str(p))}&t={int(time.time()*1000)}"
    }


@app.post("/api/library/extract-embedded-covers")
async def extract_embedded_covers_endpoint(source: str = Query("library")):
    """
    Parcourt l'ensemble des albums indexés (ou temporaires) qui n'ont pas de jaquette disque
    et extrait leur pochette intégrée en multi-threading avec notifications temps réel.
    """
    cover_names_set = {"cover.jpg", "cover.png", "cover.jpeg", "folder.jpg", "folder.png", "front.jpg", "front.png"}
    target_albums = []

    if source == "library":
        for alb in list(library_indexer.albums):
            alb_p = Path(alb.path)
            if not alb_p.is_dir():
                continue
            has_cov = any((alb_p / cname).is_file() for cname in cover_names_set)
            if not has_cov:
                target_albums.append((alb, alb_p))
    else:
        temp_dirs = []
        if config.temp_download_dir and os.path.isdir(config.temp_download_dir):
            temp_dirs.append(Path(config.temp_download_dir))
        if Path(TEMP_DOWNLOAD_DIR).exists() and Path(TEMP_DOWNLOAD_DIR).resolve() not in [d.resolve() for d in temp_dirs]:
            temp_dirs.append(Path(TEMP_DOWNLOAD_DIR))
        seen = set()
        for t_dir in temp_dirs:
            for item in t_dir.iterdir():
                if item.is_dir() and not item.name.startswith(".") and item.name.lower() not in {"previews", ".cache", "cache"}:
                    p_str = str(item.resolve())
                    if p_str in seen:
                        continue
                    seen.add(p_str)
                    has_cov = any((item / cname).is_file() for cname in cover_names_set)
                    if not has_cov:
                        target_albums.append((None, item))

    total = len(target_albums)
    if total == 0:
        if source == "library":
            try:
                library_indexer._save_to_cache()
            except Exception:
                pass
        await ws_manager.broadcast({
            "type": "cover_extraction_completed",
            "extracted_count": 0,
            "total": 0
        })
        return {
            "success": True,
            "total": 0,
            "total_without_cover_file": 0,
            "extracted_count": 0,
            "remaining": 0,
            "message": "Toutes les jaquettes sont déjà présentes."
        }

    extracted_count = 0
    loop = asyncio.get_event_loop()
    executor = ThreadPoolExecutor(max_workers=4)

    try:
        for idx, (alb_obj, album_dir) in enumerate(target_albums, 1):
            res_cov = await loop.run_in_executor(executor, consolidate_album_cover, album_dir)
            if res_cov and Path(res_cov).is_file():
                extracted_count += 1
                if alb_obj:
                    alb_obj.cover_file = str(res_cov)

            album_label = (alb_obj.album or alb_obj.title) if alb_obj else album_dir.name
            await ws_manager.broadcast({
                "type": "cover_extraction_progress",
                "extracted": idx,
                "total": total,
                "album": album_label
            })
    finally:
        executor.shutdown(wait=False)

    if source == "library" and extracted_count > 0:
        try:
            library_indexer._save_to_cache()
        except Exception as e:
            logger.warning(f"Erreur sauvegarde cache indexothèque après extraction jaquettes: {e}")

    await ws_manager.broadcast({
        "type": "cover_extraction_completed",
        "extracted_count": extracted_count,
        "total": total
    })

    return {
        "success": True,
        "total": total,
        "total_without_cover_file": total,
        "extracted_count": extracted_count,
        "remaining": total - extracted_count
    }


@app.get("/api/logs/info")
async def get_logs_information():
    """Retourne la taille du fichier de log et le nombre de fichiers rotatifs."""
    return get_log_info()


@app.post("/api/logs/clear")
async def clear_logs_endpoint():
    """Vide le fichier de log principal et supprime les archives rotatives."""
    freed = clear_log_file()
    logger.info(f"Journal des logs vidé par l'utilisateur ({freed} octets libérés)")
    return {"success": True, "freed_bytes": freed}


@app.post("/api/logs/open-folder")
async def open_logs_folder_endpoint():
    """Ouvre le dossier des journaux de logs dans l'explorateur de fichiers."""
    info = get_log_info()
    log_dir = Path(info.get("log_dir", ""))
    if log_dir.exists():
        open_in_explorer(str(log_dir))
        return {"success": True}
    return {"success": False, "error": "Dossier de logs introuvable"}


class MusicBrainzLookupRequest(BaseModel):
    album: str
    artist: str

@app.post("/api/musicbrainz/lookup")
async def musicbrainz_lookup(req: MusicBrainzLookupRequest):
    """
    Interroge MusicBrainz pour obtenir les crédits d'artistes par piste d'un album.
    Retourne un dict { position: artist_credit_string } pour chaque piste trouvée.
    """
    headers = {"User-Agent": "SoundStash/3.0.1 (contact@soundstash.local)"}
    search_url = "https://musicbrainz.org/ws/2/release/"
    params = {
        "query": f'release:"{req.album}" AND artist:"{req.artist}"',
        "fmt": "json",
        "limit": 5
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Étape 1 : chercher la release
            r = await client.get(search_url, params=params, headers=headers)
            r.raise_for_status()
            data = r.json()
            releases = data.get("releases", [])
            if not releases:
                return {"success": False, "message": "Aucun album trouvé sur MusicBrainz."}

            # Prendre la release avec le score le plus élevé
            best = max(releases, key=lambda x: x.get("score", 0))
            release_id = best["id"]

            # Étape 2 : récupérer les crédits de piste de cette release
            detail_url = f"https://musicbrainz.org/ws/2/release/{release_id}"
            r2 = await client.get(detail_url, params={"inc": "recordings+artist-credits", "fmt": "json"}, headers=headers)
            r2.raise_for_status()
            detail = r2.json()

        # Construire la map position -> artiste
        track_credits = {}
        position_offset = 0
        for medium in detail.get("media", []):
            for track in medium.get("tracks", []):
                pos = track.get("position", 0) + position_offset
                rec = track.get("recording", {})
                credits = rec.get("artist-credit", [])
                artist_str = ""
                for c in credits:
                    if isinstance(c, dict):
                        name = c.get("name") or c.get("artist", {}).get("name", "")
                        joinphrase = c.get("joinphrase", "")
                        artist_str += name + joinphrase
                if artist_str:
                    track_credits[str(pos)] = artist_str.strip()
            # Pour les albums multi-disques, les positions peuvent se réinitialiser par medium
            # On utilise l'offset pour les rendre globales
            position_offset += medium.get("track-count", 0)

        return {
            "success": True,
            "release_id": release_id,
            "release_title": best.get("title", ""),
            "track_credits": track_credits
        }
    except httpx.TimeoutException:
        return {"success": False, "message": "Délai d'attente MusicBrainz dépassé."}
# ==========================================
# Endpoints de Collection Musicale, Gap Finder & Curation
# ==========================================

@app.get("/api/library/info")
async def get_library_info():
    """Retourne les métriques globales et l'état d'indexation de la collection."""
    return library_indexer.get_stats()

@app.post("/api/library/scan")
async def scan_library_endpoint(req: Optional[LibraryScanRequest] = None):
    """Déclenche une réindexation asynchrone complète de la collection."""
    target_dir = None
    if req and req.library_dir and req.library_dir.strip():
        clean_dir = req.library_dir.strip()
        if os.path.isdir(clean_dir):
            config.library_dir = clean_dir
            save_config(config)
            target_dir = clean_dir
        else:
            return {
                "status": "error",
                "error": f"Le dossier spécifié n'existe pas : {clean_dir}",
                "albums_count": 0,
                "artists_count": 0,
                "duration_seconds": 0
            }
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, library_indexer.scan, True, target_dir)
    dispatch_library_updated()
    return result

@app.post("/api/library/match-search")
async def match_search_endpoint(req: MatchSearchRequest):
    """
    Associe chaque résultat de recherche ou d'album à son statut exact en direct :
    'downloading', 'queued', 'temp', 'exported', 'owned_library' ou None.
    """
    queue_state = download_manager.get_queue_state()
    current_item = queue_state.get("current")
    queued_items = queue_state.get("queue", [])

    results = []
    for item in req.items:
        match_info = smart_matcher.match_item(
            title=item.title,
            artist=item.artist or "",
            item_type=item.type or "album",
            url=item.url,
            current_downloading_item=current_item,
            queued_items=queued_items
        )
        results.append({
            "id": item.id,
            "title": item.title,
            "status": match_info.get("status"),
            "label": match_info.get("label"),
            "badge_class": match_info.get("badge_class"),
            "local_path": match_info.get("local_path"),
            "matched_album": match_info.get("matched_album")
        })
    return {"matches": results}

@app.get("/api/library/artists")
async def get_library_artists():
    """Retourne la liste des artistes répertoriés dans la collection avec leurs albums."""
    return {"artists": library_indexer.list_artists()}

@app.get("/api/library/tag-suggestions")
async def get_library_tag_suggestions_endpoint():
    """
    Retourne les référentiels de tags de la collection musicale maître
    pour l'autocomplétion dans l'Éditeur de tags (artistes, albums, genres, années, liaisons).
    """
    if hasattr(library_indexer, "get_tag_suggestions"):
        return library_indexer.get_tag_suggestions()
    return {
        "artists": [],
        "albums": [],
        "genres": [],
        "years": [],
        "artist_albums_map": {},
        "album_details": {},
        "total_collection_albums": 0
    }

@app.get("/api/library/albums")
async def get_library_albums(source: str = Query("library")):
    """
    Retourne la liste complète des albums avec métadonnées unifiées.
    source='library' : collection musicale principale
    source='temp' : dossier temporaire de téléchargement
    source='all' : collection + temporaire combinés
    """
    albums_data = []
    is_lib_configured = bool(config.library_dir and os.path.isdir(config.library_dir))
    seen_paths = set()

    if source in ("temp", "all"):
        temp_dirs = []
        if config.temp_download_dir and os.path.isdir(config.temp_download_dir):
            temp_dirs.append(Path(config.temp_download_dir))
        if Path(TEMP_DOWNLOAD_DIR).exists() and Path(TEMP_DOWNLOAD_DIR).resolve() not in [d.resolve() for d in temp_dirs]:
            temp_dirs.append(Path(TEMP_DOWNLOAD_DIR))

        for t_dir in temp_dirs:
            if not t_dir.exists():
                continue
            for item in t_dir.iterdir():
                if item.is_dir() and not item.name.startswith(".") and item.name.lower() not in {"previews", ".cache", "cache"}:
                    p_str = str(item.resolve())
                    if p_str in seen_paths:
                        continue
                    audio_files = [f for f in item.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS]
                    if not audio_files:
                        for sub in item.iterdir():
                            if sub.is_dir():
                                sub_audio = [f for f in sub.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS]
                                if sub_audio:
                                    sub_p_str = str(sub.resolve())
                                    if sub_p_str not in seen_paths:
                                        seen_paths.add(sub_p_str)
                                        has_cov = any(cf.name.lower() in COVER_NAMES for cf in sub.iterdir() if cf.is_file())
                                        sub_tags = extract_album_tags_priority(sub, sub_audio)
                                        sub_art = sub_tags.get("artist") or item.name
                                        sub_alb = sub_tags.get("album") or sub.name
                                        albums_data.append({
                                            "title": sub_alb,
                                            "artist": sub_art,
                                            "path": sub_p_str,
                                            "tracks_count": len(sub_audio),
                                            "has_cover": has_cov,
                                            "year": sub_tags.get("year"),
                                            "genre": sub_tags.get("genre"),
                                            "source": "temp"
                                        })
                    else:
                        seen_paths.add(p_str)
                        has_cov = any(cf.name.lower() in COVER_NAMES for cf in item.iterdir() if cf.is_file())
                        tags_meta = extract_album_tags_priority(item, audio_files)
                        folder_name = item.name
                        folder_art = "Artiste inconnu"
                        folder_alb = folder_name
                        if " - " in folder_name:
                            parts = folder_name.split(" - ", 1)
                            folder_art = parts[0].strip()
                            folder_alb = parts[1].strip()

                        art_name = tags_meta.get("artist") or folder_art
                        alb_title = tags_meta.get("album") or folder_alb
                        inf_year = tags_meta.get("year")
                        inf_genre = tags_meta.get("genre")

                        albums_data.append({
                            "title": alb_title,
                            "artist": art_name,
                            "path": p_str,
                            "tracks_count": len(audio_files),
                            "has_cover": has_cov,
                            "year": inf_year,
                            "genre": inf_genre,
                            "source": "temp"
                        })

    def _classify_type(title: str, path: str, track_count: int) -> str:
        t = (title or "").lower()
        p = (path or "").lower()
        if "[playlist]" in t or "[playlist]" in p or "playlist" in t:
            return "playlist"
        if (
            "singles & rips" in t
            or "singles & rips" in p
            or "[rip]" in t
            or "[audio rip]" in t
            or "extrait vidéo" in t
            or "extrait video" in t
        ):
            return "rip"
        if "[single]" in t or "[single]" in p or "singles" in t or track_count <= 2:
            return "single"
        return "album"

    if source in ("library", "all"):
        for alb in library_indexer.albums:
            alb_p_str = str(Path(alb.path).resolve())
            if alb_p_str in seen_paths:
                continue
            seen_paths.add(alb_p_str)
            alb_title = getattr(alb, "album", "") or getattr(alb, "title", "")
            alb_tracks = getattr(alb, "track_count", 0)
            albums_data.append({
                "title": alb_title,
                "artist": alb.artist,
                "path": alb.path,
                "tracks_count": alb_tracks,
                "has_cover": bool(alb.cover_file),
                "year": getattr(alb, "year", None),
                "genre": getattr(alb, "genre", None),
                "album_type": _classify_type(alb_title, alb.path, alb_tracks),
                "source": getattr(alb, "source", "library")
            })

    for item in albums_data:
        if "album_type" not in item:
            item["album_type"] = _classify_type(item.get("title", ""), item.get("path", ""), item.get("tracks_count", 0))

    albums_data.sort(key=lambda a: ((a["artist"] or "").lower(), (a["title"] or "").lower()))
    return {
        "albums": albums_data,
        "source": source,
        "library_configured": is_lib_configured,
        "total": len(albums_data),
        "library_albums_count": len(library_indexer.albums)
    }

@app.post("/api/albums/batch-genre")
async def batch_genre_endpoint(req: BatchGenreRequest):
    """
    Applique un tag de genre à une liste d'albums (ou playlists) par lot ou à l'unité.
    """
    clean_genre = (req.genre or "").strip()
    if not clean_genre:
        raise HTTPException(status_code=400, detail="Le genre ne peut pas être vide.")
    if not req.albums:
        raise HTTPException(status_code=400, detail="Aucun album fourni.")

    from backend.tagger import apply_genre_to_album

    updated_count = 0
    total_tracks_updated = 0
    errors = []

    for alb_path in req.albums:
        res = apply_genre_to_album(alb_path, clean_genre)
        if res.get("success"):
            updated_count += 1
            total_tracks_updated += res.get("tracks_updated", 0)
        else:
            errors.append({"album": alb_path, "error": res.get("message", "Erreur inconnue")})

    return {
        "success": True,
        "genre": clean_genre,
        "updated_albums_count": updated_count,
        "total_tracks_updated": total_tracks_updated,
        "errors": errors
    }


@app.get("/api/library/catalog")
async def get_library_catalog(source: str = Query("library")):
    """
    Retourne l'intégralité du catalogue (albums et tous leurs morceaux)
    scanné de façon ultra-rapide (< 40ms) pour la vue 'Tout'.
    """
    is_lib_configured = bool(config.library_dir and os.path.isdir(config.library_dir))
    albums_catalog = []

    if source == "temp" or (source == "library" and not is_lib_configured):
        temp_dirs = []
        if config.temp_download_dir and os.path.isdir(config.temp_download_dir):
            temp_dirs.append(Path(config.temp_download_dir))
        if Path(TEMP_DOWNLOAD_DIR).exists() and Path(TEMP_DOWNLOAD_DIR).resolve() not in [d.resolve() for d in temp_dirs]:
            temp_dirs.append(Path(TEMP_DOWNLOAD_DIR))

        seen_paths = set()
        for t_dir in temp_dirs:
            for item in t_dir.iterdir():
                if item.is_dir() and not item.name.startswith(".") and item.name.lower() not in {"previews", ".cache", "cache"}:
                    p_str = str(item.resolve())
                    if p_str in seen_paths:
                        continue
                    seen_paths.add(p_str)

                    audio_files = [f for f in item.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS]
                    tags_meta = extract_album_tags_priority(item, audio_files)
                    folder_name = item.name
                    folder_art = "Artiste inconnu"
                    folder_alb = folder_name
                    if " - " in folder_name:
                        parts = folder_name.split(" - ", 1)
                        folder_art = parts[0].strip()
                        folder_alb = parts[1].strip()

                    art_name = tags_meta.get("artist") or folder_art
                    alb_title = tags_meta.get("album") or folder_alb
                    inf_year = tags_meta.get("year")
                    inf_genre = tags_meta.get("genre")
                    from backend.library_indexer import extract_album_tracks_fast
                    track_dur_map = {tr.filename: tr.duration_str for tr in extract_album_tracks_fast(item)}

                    alb_tracks = []
                    for f in audio_files:
                        num, title = parse_track_filename(f.name)
                        ext = f.suffix.upper().replace('.', '')
                        alb_tracks.append({
                            "track_number": f"{num:02d}" if num else "",
                            "title": title,
                            "artist": art_name,
                            "album": alb_title,
                            "album_path": p_str,
                            "year": str(inf_year) if inf_year else "",
                            "genre": inf_genre or "",
                            "duration": track_dur_map.get(f.name, ""),
                            "filepath": str(f.resolve()),
                            "format": ext,
                            "stream_url": f"/api/audio/stream-local?path={urllib.parse.quote(str(f.resolve()))}",
                            "cover_url": f"/api/audio/cover?path={urllib.parse.quote(p_str)}"
                        })
                    alb_tracks.sort(key=lambda t: (int(t["track_number"]) if t["track_number"].isdigit() else 999, t["title"].lower()))

                    if alb_tracks:
                        albums_catalog.append({
                            "title": alb_title,
                            "artist": art_name,
                            "path": p_str,
                            "tracks_count": len(alb_tracks),
                            "has_cover": any(cf.name.lower() in COVER_NAMES for cf in item.iterdir() if cf.is_file()),
                            "cover_url": f"/api/audio/cover?path={urllib.parse.quote(p_str)}",
                            "year": inf_year,
                            "genre": inf_genre,
                            "source": "temp",
                            "tracks": alb_tracks
                        })
    else:
        for alb in library_indexer.albums:
            p = alb.path
            if not os.path.isdir(p):
                continue
            alb_tracks = []
            dur_map = {tr.filename: tr.duration_str for tr in getattr(alb, "tracks", [])}

            def scan_dir(dir_path):
                try:
                    for entry in os.scandir(dir_path):
                        if entry.is_file() and os.path.splitext(entry.name)[1].lower() in AUDIO_EXTENSIONS:
                            num, title = parse_track_filename(entry.name)
                            ext = os.path.splitext(entry.name)[1].upper().replace('.', '')
                            alb_tracks.append({
                                "track_number": f"{num:02d}" if num else "",
                                "title": title,
                                "artist": alb.artist,
                                "album": alb.album,
                                "album_path": p,
                                "year": str(alb.year) if alb.year else "",
                                "genre": alb.genre or "",
                                "duration": dur_map.get(entry.name, ""),
                                "filepath": entry.path,
                                "format": ext,
                                "stream_url": f"/api/audio/stream-local?path={urllib.parse.quote(entry.path)}",
                                "cover_url": f"/api/audio/cover?path={urllib.parse.quote(p)}"
                            })
                        elif entry.is_dir() and DISC_SUBFOLDER_RE.match(entry.name):
                            scan_dir(entry.path)
                except Exception:
                    pass

            scan_dir(p)
            alb_tracks.sort(key=lambda t: (int(t["track_number"]) if t["track_number"].isdigit() else 999, t["title"].lower()))

            albums_catalog.append({
                "title": getattr(alb, "album", "") or getattr(alb, "title", ""),
                "artist": alb.artist,
                "path": alb.path,
                "tracks_count": len(alb_tracks),
                "has_cover": bool(alb.cover_file),
                "cover_url": f"/api/audio/cover?path={urllib.parse.quote(alb.path)}",
                "year": getattr(alb, "year", None),
                "genre": getattr(alb, "genre", None),
                "source": getattr(alb, "source", "library"),
                "tracks": alb_tracks
            })

    albums_catalog.sort(key=lambda a: ((a["artist"] or "").lower(), (a["title"] or "").lower()))
    total_tracks = sum(len(a["tracks"]) for a in albums_catalog)

    return {
        "albums": albums_catalog,
        "source": source,
        "library_configured": is_lib_configured,
        "total_albums": len(albums_catalog),
        "total_tracks": total_tracks
    }

@app.get("/api/collection/all-tracks")
async def get_all_collection_tracks_endpoint(source: str = Query("library")):
    """
    Retourne la liste plate de tous les morceaux de la collection
    prêts pour lecture instantanée dans la playlist 'Tout'.
    Exécution ultra-rapide (< 60ms) sans I/O Mutagen.
    """
    cat = await get_library_catalog(source=source)
    tracks = []
    for alb in cat.get("albums", []):
        cover = alb.get("cover_url") or "/static/placeholder-cover.svg"
        alb_title = alb.get("title") or ""
        alb_artist = alb.get("artist") or ""
        alb_path = alb.get("path") or ""
        for idx, t in enumerate(alb.get("tracks", [])):
            fp = t.get("filepath", "")
            tracks.append({
                "id": f"collection-{alb_path}-{idx}",
                "type": "audio",
                "title": t.get("title") or f"Piste {idx + 1}",
                "artist": t.get("artist") or alb_artist,
                "album": t.get("album") or alb_title,
                "album_path": alb_path,
                "duration": t.get("duration") or "--:--",
                "duration_seconds": 0,
                "path": fp,
                "filepath": fp,
                "rel_path": fp,
                "stream_url": t.get("stream_url") or f"/api/audio/stream-local?path={urllib.parse.quote(fp)}",
                "cover_url": cover,
                "thumbnail_url": cover,
                "track_number": t.get("track_number") or (idx + 1),
                "format": t.get("format") or "M4A"
            })
    return {
        "status": "success",
        "tracks": tracks,
        "total": len(tracks),
        "albums_count": len(cat.get("albums", []))
    }

@app.get("/api/library/artist/missing-albums")
async def get_artist_missing_albums(artist_name: str = Query(..., min_length=1), browse_id: Optional[str] = Query(None)):
    """
    Compare la discographie officielle YouTube Music d'un artiste avec la collection locale
    et renvoie la liste des albums manquants avec boutons de téléchargement direct (Gap Finder).
    """
    clean_art = artist_name.strip()
    clean_id = browse_id.strip() if browse_id else None
    res = await find_missing_albums_for_artist(clean_art, clean_id)
    return res

@app.get("/api/library/audit")
async def audit_library_endpoint(library_dir: Optional[str] = Query(None)):
    """Diagnostique la santé de la collection (pollution Topic, jaquettes manquantes, incohérences)."""
    loop = asyncio.get_event_loop()
    res = await loop.run_in_executor(None, audit_collection_health, library_dir)
    return res

@app.post("/api/library/harmonize")
async def harmonize_library_endpoint(req: HarmonizeRequest):
    """Applique les corrections d'harmonisation validées par l'utilisateur."""
    loop = asyncio.get_event_loop()
    res = await loop.run_in_executor(None, apply_harmonization_fixes, req.fixes)
    return res

@app.post("/api/library/synchronize")
async def synchronize_library_endpoint(
    library_dir: Optional[str] = Query(None),
    is_automatic: bool = Query(True)
):
    """Déclenche une synchronisation et auto-harmonisation Tags -> Fichiers de la collection."""
    loop = asyncio.get_event_loop()
    res = await loop.run_in_executor(None, synchronize_collection, library_dir, None, is_automatic)
    return res

@app.post("/api/library/check-migration")
async def check_migration_endpoint(req: CheckMigrationRequest):
    """Vérifie si des médias sont présents dans l'ancien emplacement lors d'un changement de bibliothèque."""
    loop = asyncio.get_event_loop()
    res = await loop.run_in_executor(None, check_migration_needed, req.type, req.new_path)
    return res

@app.post("/api/library/migrate")
async def execute_migration_endpoint(req: ExecuteMigrationRequest):
    """Déplace et organise automatiquement les médias de l'ancien vers le nouveau dossier."""
    loop = asyncio.get_event_loop()
    res = await loop.run_in_executor(None, execute_migration, req.type, req.source_path, req.target_path)
    return res

@app.post("/api/library/resolve-export-destination")
async def resolve_export_destination_endpoint(req: ResolveExportDestinationRequest):
    """Prévisualise la destination intelligente avant d'effectuer l'exportation."""
    if not req.album_dir or not req.album_dir.strip():
        raise HTTPException(status_code=400, detail="Dossier d'album source requis.")
    p = Path(req.album_dir)
    if not p.exists() or not p.is_dir():
        raise HTTPException(status_code=404, detail="Dossier d'album source introuvable.")
    info = get_album_info(p)
    tracks = info.get("tracks", [])
    is_video = any(Path(t["filepath"]).suffix.lower() in {".mp4", ".mkv", ".webm"} for t in tracks)
    is_pl = info.get("is_playlist", False)
    clean_art = clean_artist_name(info["album_artist"] or ("Various Artists" if is_pl else "Artiste Inconnu"))
    album_name = info["album_name"] or p.name
    is_single = (album_name == "Singles & Rips")

    policy = req.conflict_policy or getattr(config, "smart_export_conflict_policy", "merge")
    res = library_indexer.resolve_smart_export_path(
        artist_name=clean_art,
        album_name=album_name,
        is_single=is_single,
        is_playlist=is_pl,
        conflict_policy=policy
    )
    res["is_video"] = is_video
    return res

def send_video_range(file_path: Path, start: int, end: int, chunk_size: int = 1024 * 1024):
    with open(file_path, mode="rb") as file_like:
        file_like.seek(start)
        bytes_to_read = end - start + 1
        while bytes_to_read > 0:
            read_size = min(chunk_size, bytes_to_read)
            data = file_like.read(read_size)
            if not data:
                break
            bytes_to_read -= len(data)
            yield data

@app.get("/api/videos/catalog")
async def get_videos_catalog(force_refresh: bool = False):
    """Retourne le catalogue complet des clips et vidéos de la vidéothèque."""
    return video_indexer.scan_catalog(force_refresh=force_refresh)

def _resolve_video_file(path_str: str) -> Path:
    if not path_str or str(path_str).strip().lower() in ("undefined", "null", ""):
        return Path("__not_found__")
    clean_str = str(path_str).strip()
    p = Path(clean_str)
    if p.is_absolute() and p.exists():
        return p.resolve()
    clean_rel = clean_str.lstrip("/\\")
    temp_cand = Path(config.temp_download_dir) / clean_rel
    if temp_cand.exists():
        return temp_cand.resolve()
    vid_cand = video_indexer.get_video_dir() / clean_rel
    if vid_cand.exists():
        return vid_cand.resolve()
    if config.video_export_dir:
        exp_cand = Path(config.video_export_dir) / clean_rel
        if exp_cand.exists():
            return exp_cand.resolve()
    if Path(clean_rel).exists():
        return Path(clean_rel).resolve()
    return (video_indexer.get_video_dir() / clean_rel).resolve()


@app.get("/api/videos/thumbnail")
async def get_video_thumbnail(path: str = Query(...)):
    """Sert ou génère à la volée la miniature 16:9 d'un fichier vidéo."""
    p = _resolve_video_file(path)
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="Fichier vidéo introuvable")
    thumb = video_indexer.get_thumbnail_path(p)
    if thumb.exists():
        media_type = "image/svg+xml" if thumb.suffix.lower() == ".svg" else "image/jpeg"
        return FileResponse(str(thumb), media_type=media_type)
    return HTMLResponse("", status_code=204)

@app.get("/api/videos/stream")
async def stream_video(request: Request, path: str = Query(...)):
    """Streaming HTTP vidéo haute performance avec support des Range requests (206 Partial Content)."""
    p = _resolve_video_file(path)
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="Fichier vidéo introuvable")

    file_size = p.stat().st_size
    range_header = request.headers.get("range")
    content_type = "video/mp4"
    if p.suffix.lower() == ".webm":
        content_type = "video/webm"
    elif p.suffix.lower() == ".mkv":
        content_type = "video/x-matroska"

    if range_header:
        parts = range_header.replace("bytes=", "").split("-")
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1
        end = min(end, file_size - 1)
        content_length = end - start + 1

        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(content_length),
            "Content-Type": content_type,
        }
        return StreamingResponse(
            send_video_range(p, start, end),
            headers=headers,
            status_code=206
        )

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(file_size),
        "Content-Type": content_type,
    }
    return FileResponse(str(p), headers=headers, media_type=content_type)

@app.post("/api/videos/extract-audio")
async def extract_audio_from_video_endpoint(req: ExtractAudioRequest):
    """Extrait sans perte de qualité la piste sonore d'une vidéo en M4A vers la collection musicale."""
    p = _resolve_video_file(req.path)
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="Fichier vidéo introuvable")

    # Protection stricte : l'extraction audio est interdite pour les concerts et lives complets
    is_concert = (
        "concerts" in [part.lower() for part in p.parts]
        or "concert" in p.name.lower()
        or bool(re.search(r"\b(full\s+concert|live\s+at|live\s+in|concert\s+complet|live\s+tour|festival\s+live|en\s+concert)\b", p.name, re.IGNORECASE))
    )
    if is_concert:
        raise HTTPException(status_code=400, detail="L'extraction audio n'a aucun sens pour des concerts ou lives complets de longue durée et n'est pas autorisée.")

    target_base = Path(config.library_dir or config.export_dir)
    v_dir = video_indexer.get_video_dir()
    
    # Résolution de l'artiste
    artist = (req.artist or "").strip()
    if not artist or artist.lower() in ("artiste inconnu", "artiste", "inconnu"):
        try:
            rel = p.relative_to(v_dir)
            artist = rel.parts[0] if len(rel.parts) > 1 else "Artiste Inconnu"
        except Exception:
            artist = "Artiste Inconnu"

    artist_clean = clean_artist_name(artist)

    # Résolution du titre
    raw_title = (req.title or "").strip()
    if not raw_title or raw_title.lower() in ("clip vidéo", "video", "clip"):
        raw_title = p.stem
    title_clean = clean_video_title(raw_title)

    # Nettoyage si le titre commence par "Artiste - "
    prefix = f"{artist_clean} - "
    if title_clean.lower().startswith(prefix.lower()):
        title_clean = title_clean[len(prefix):].strip()

    dest_artist_dir = target_base / artist_clean / "Singles & Rips"
    dest_artist_dir.mkdir(parents=True, exist_ok=True)
    out_audio = dest_artist_dir / f"{title_clean}.m4a"
    if out_audio.exists():
        out_audio = dest_artist_dir / f"{title_clean}_{int(time.time())}.m4a"

    cmd = [
        FFMPEG_PATH,
        "-y",
        "-i", str(p),
        "-vn",
        "-c:a", "aac",
        "-b:a", "256k",
        str(out_audio)
    ]
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=60)
    if res.returncode != 0 or not out_audio.exists():
        raise HTTPException(status_code=500, detail=f"Échec extraction ffmpeg: {res.stderr[:200]}")

    # Récupération / génération de la miniature représentative (anti-écran noir)
    thumb_path = video_indexer.get_thumbnail_path(p)
    has_thumb = thumb_path and thumb_path.exists() and thumb_path.suffix.lower() != ".svg"

    # Génération de la pochette collector 1:1 avec le macaron 'Hype Sticker'
    dest_cover = dest_artist_dir / "cover.jpg"
    if has_thumb:
        generate_rip_audio_cover(thumb_path, dest_cover, artist_name=artist_clean, subtitle="Single Vidéo")

    picture_to_embed = dest_cover if dest_cover.exists() else (thumb_path if has_thumb else None)

    if Path(KID3_CLI_PATH).exists():
        kid3_cmds = [
            str(KID3_CLI_PATH),
            "-c", f'set artist "{artist_clean}"',
            "-c", f'set title "{title_clean}"',
            "-c", f'set album "Singles & Rips"',
        ]
        if picture_to_embed and picture_to_embed.exists():
            kid3_cmds.extend(["-c", f'set picture:"{picture_to_embed.resolve()}" ""'])
        kid3_cmds.extend(["-c", "save", str(out_audio.resolve())])
        try:
            subprocess.run(kid3_cmds, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
        except Exception as e:
            logger.warning(f"Erreur taggage Kid3 lors de l'extraction audio: {e}")

    # Invalider le cache disque de l'album et actualiser l'indexeur immédiatement
    invalidate_album_cache(dest_artist_dir)
    library_indexer.add_or_update_album(dest_artist_dir)

    return {
        "success": True,
        "audio_path": str(out_audio),
        "message": f"Piste audio « {title_clean} » extraite avec succès dans « {artist_clean} / Singles & Rips » !"
    }

@app.post("/api/videos/synchronize")
async def synchronize_videos_endpoint():
    """Déclenche la normalisation et le rangement automatique des vidéos."""
    res = synchronize_videos()
    return res

@app.get("/api/system/busy-status")
async def get_system_busy_status():
    """Vérifie si des opérations critiques d'écriture de fichiers sont activement en cours."""
    from backend.library_sync import is_library_syncing
    from backend.video_sync import is_video_syncing
    from backend.library_migrator import is_migrating

    is_downloading = bool(download_manager.is_downloading or (download_manager.queue and len(download_manager.queue) > 0))
    is_lib_sync = bool(is_library_syncing())
    is_vid_sync = bool(is_video_syncing())
    is_migr = bool(is_migrating())

    is_busy = is_downloading or is_lib_sync or is_vid_sync or is_migr

    details = []
    if is_downloading:
        details.append("Téléchargement ou conversion en cours")
    if is_lib_sync:
        details.append("Synchronisation et organisation de la collection musicale")
    if is_vid_sync:
        details.append("Synchronisation et organisation de la vidéothèque")
    if is_migr:
        details.append("Migration et déplacement de fichiers")

    return {
        "busy": is_busy,
        "is_downloading": is_downloading,
        "is_library_syncing": is_lib_sync,
        "is_video_syncing": is_vid_sync,
        "is_migrating": is_migr,
        "details": details,
        "message": " • ".join(details) if details else ""
    }

@app.post("/api/system/graceful-shutdown")
async def graceful_shutdown_endpoint():
    """
    Arrête proprement et en toute sécurité les synchronisations et téléchargements en cours
    à un point non critique (entre deux fichiers/albums) avant la fermeture de l'application.
    """
    from backend.library_sync import request_library_sync_stop, is_library_syncing
    from backend.video_sync import request_video_sync_stop, is_video_syncing
    from backend.library_migrator import request_migrator_stop, is_migrating

    logger.info("🛑 Arrêt propre (graceful shutdown) sollicité : interruption sécurisée en cours...")
    request_library_sync_stop()
    request_video_sync_stop()
    request_migrator_stop()
    download_manager.cancel_all()

    # Attente asynchrone sécurisée que les opérations actives terminent leur micro-opération unitaire (fichier en cours)
    start_time = time.time()
    while time.time() - start_time < 3.5:
        if not is_library_syncing() and not is_video_syncing() and not is_migrating() and not download_manager.is_downloading:
            break
        await asyncio.sleep(0.1)

    still_busy = bool(is_library_syncing() or is_video_syncing() or is_migrating() or download_manager.is_downloading)
    elapsed = time.time() - start_time
    logger.info(f"🛑 Arrêt propre terminé en {elapsed:.2f}s (opérations résiduelles: {still_busy})")
    return {
        "success": True,
        "ready_to_quit": True,
        "clean": not still_busy,
        "elapsed_seconds": round(elapsed, 2)
    }

def move_to_recycle_bin(target_path: Path) -> bool:
    """Déplace de façon sûre un fichier ou dossier dans la Corbeille Windows."""
    if not target_path.exists():
        return False
    try:
        esc_path = str(target_path.resolve()).replace("'", "''")
        if target_path.is_dir():
            ps_code = f"Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('{esc_path}', 'OnlyErrorDialogs', 'SendToRecycleBin')"
        else:
            ps_code = f"Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('{esc_path}', 'OnlyErrorDialogs', 'SendToRecycleBin')"
        subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_code], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
        return not target_path.exists()
    except Exception as e:
        logger.warning(f"Erreur PowerShell SendToRecycleBin pour {target_path}: {e}")
        return False

@app.get("/api/library/item-info")
async def get_library_item_info_endpoint(path: str = Query(...)):
    """Retourne la taille, le nombre de fichiers et les informations détaillées d'un élément pour la boîte de dialogue de suppression."""
    p = Path(path).resolve()
    if not p.exists():
        raise HTTPException(status_code=404, detail="Élément introuvable sur le disque.")

    total_bytes = 0
    file_count = 0
    item_type = "file"
    if p.is_dir():
        item_type = "album"
        try:
            for root, dirs, files in os.walk(p):
                for f in files:
                    fp = Path(root) / f
                    try:
                        total_bytes += fp.stat().st_size
                        file_count += 1
                    except Exception:
                        pass
        except Exception:
            pass
    else:
        try:
            total_bytes = p.stat().st_size
            file_count = 1
            if p.suffix.lower() in VIDEO_EXTENSIONS:
                item_type = "video"
            elif p.suffix.lower() in AUDIO_EXTENSIONS:
                item_type = "track"
        except Exception:
            pass

    if total_bytes < 1024 * 1024:
        size_str = f"{total_bytes / 1024:.1f} Ko"
    elif total_bytes < 1024 * 1024 * 1024:
        size_str = f"{total_bytes / (1024 * 1024):.1f} Mo"
    else:
        size_str = f"{total_bytes / (1024 * 1024 * 1024):.2f} Go"

    return {
        "name": p.name,
        "path": str(p),
        "exists": True,
        "is_dir": p.is_dir(),
        "type": item_type,
        "file_count": file_count,
        "size_bytes": total_bytes,
        "size_formatted": size_str
    }

@app.post("/api/library/trash")
async def trash_library_item_endpoint(req: TrashItemRequest):
    """
    Suppression sécurisée : déplace l'élément spécifié (album, piste ou vidéo)
    vers la Corbeille Windows (sans suppression définitive) et met à jour instantanément (0 ms)
    l'indexothèque en mémoire et son cache disque.
    """
    if not req.path or not req.path.strip():
        raise HTTPException(status_code=400, detail="Chemin requis.")

    p = Path(req.path).resolve()
    if not p.exists():
        # Si le fichier a déjà été recyclé par Electron shell.trashItem avant l'appel API
        library_indexer.remove_album_by_path(p)
        video_indexer.remove_video_by_path(p)
        return {"success": True, "already_removed": True, "message": "Élément retiré de l'index."}

    total_bytes = 0
    if p.is_dir():
        for root, dirs, files in os.walk(p):
            for f in files:
                try:
                    total_bytes += (Path(root) / f).stat().st_size
                except Exception:
                    pass
    else:
        total_bytes = p.stat().st_size

    ok = move_to_recycle_bin(p)
    if not ok and p.exists():
        raise HTTPException(status_code=500, detail="Impossible de déplacer l'élément vers la Corbeille Windows.")

    # Mise à jour 0ms des index
    library_indexer.remove_album_by_path(p)
    video_indexer.remove_video_by_path(p)

    # Nettoyage du dossier parent artiste si désormais complètement vide
    try:
        parent = p.parent
        if parent.exists() and parent.is_dir() and not any(parent.iterdir()):
            move_to_recycle_bin(parent)
    except Exception:
        pass

    logger.info(f"Élément envoyé dans la Corbeille Windows : {p} (Taille : {total_bytes} octets)")
    return {
        "success": True,
        "path": str(p),
        "freed_bytes": total_bytes,
        "message": f"'{p.name}' a été déplacé vers la Corbeille Windows."
    }

@app.get("/api/library/tree")
async def get_library_tree_endpoint():
    """
    Fournit l'arborescence complète Artistes -> Albums et Vidéos
    pour l'explorateur de collection de l'Atelier.
    """
    artists_map = {}
    for alb in library_indexer.albums:
        art = alb.artist or "Artiste Inconnu"
        if art not in artists_map:
            artists_map[art] = []
        artists_map[art].append({
            "title": getattr(alb, "album", "") or getattr(alb, "title", ""),
            "path": alb.path,
            "tracks_count": getattr(alb, "track_count", 0),
            "year": getattr(alb, "year", None),
            "genre": getattr(alb, "genre", None),
            "has_cover": bool(alb.cover_file),
            "cover_url": f"/api/audio/cover?path={urllib.parse.quote(alb.path)}"
        })

    def _alb_year_key(a):
        y = a.get("year")
        try:
            return (int(str(y).strip()) if y else 9999, (a.get("title") or "").lower())
        except (ValueError, TypeError):
            return (9999, (a.get("title") or "").lower())

    artists_list = []
    for art, albs in sorted(artists_map.items(), key=lambda x: x[0].lower()):
        albs.sort(key=_alb_year_key)
        artists_list.append({
            "name": art,
            "artist": art,
            "albums_count": len(albs),
            "tracks_count": sum(a["tracks_count"] for a in albs),
            "albums": albs
        })

    videos_cat = video_indexer.scan_catalog()
    raw_videos = videos_cat.get("videos", [])
    
    # Grouper les clips vidéo par artiste pour l'arborescence Atelier
    v_artists_map = {}
    for v in raw_videos:
        vart = v.get("artist") or "Clips Divers"
        if vart not in v_artists_map:
            v_artists_map[vart] = []
        v_artists_map[vart].append(v)

    video_tree = []
    for vart, vids in sorted(v_artists_map.items(), key=lambda x: x[0].lower()):
        video_tree.append({
            "artist": vart,
            "name": vart,
            "count": len(vids),
            "videos": vids
        })

    total_albs = len(library_indexer.albums)
    total_vids = len(raw_videos)

    return {
        "library_configured": bool(config.library_dir and os.path.isdir(config.library_dir)),
        "library_dir": config.library_dir,
        "video_dir": str(video_indexer.get_video_dir()),
        "artists": artists_list,
        "music": artists_list,
        "total_artists": len(artists_list),
        "total_albums": total_albs,
        "music_albums_count": total_albs,
        "videos": video_tree,
        "raw_videos": raw_videos,
        "video_artists": videos_cat.get("artists", []),
        "total_videos": total_vids,
        "videos_count": total_vids
    }

# --- Routes Playlists Mixtes (Audio + Vidéo) ---

@app.get("/api/playlists")
async def list_playlists_endpoint():
    """Retourne la liste résumée de toutes les playlists utilisateur et l'état de la collection système."""
    playlists = playlist_manager.list_playlists()
    all_albums = library_indexer.get_all_albums() if hasattr(library_indexer, "get_all_albums") else getattr(library_indexer, "albums", [])
    has_system = len(all_albums) > 0
    return {
        "playlists": playlists,
        "has_system_playlist": has_system,
        "total_count": len(playlists) + (1 if has_system else 0)
    }

@app.get("/api/playlists/preset-covers")
async def get_preset_covers_endpoint():
    """Retourne la liste des pochettes thématiques vectorielles disponibles."""
    return {"covers": playlist_manager.get_preset_covers()}

@app.get("/api/playlists/{playlist_id}")
async def get_playlist_endpoint(playlist_id: str):
    """Retourne une playlist complète avec ses pistes mixtes (audio + vidéo)."""
    pl = playlist_manager.get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist introuvable.")
    return pl

@app.post("/api/playlists")
async def create_playlist_endpoint(req: CreatePlaylistRequest):
    """Crée une nouvelle playlist utilisateur."""
    pl = playlist_manager.create_playlist(
        req.name,
        req.description or "",
        req.items,
        cover_url=req.cover_url,
        is_smart=req.is_smart or False,
        smart_type=req.smart_type,
        smart_criteria=req.smart_criteria
    )
    return {"success": True, "playlist": pl, **pl}

@app.post("/api/playlists/smart-generate")
async def smart_generate_playlist_endpoint(req: SmartPlaylistGenerateRequest):
    """Génère automatiquement une playlist intelligente (top écoutes, multi-genres, aléatoire, etc.)."""
    albums = library_indexer.get_all_albums() if hasattr(library_indexer, "get_all_albums") else getattr(library_indexer, "albums", [])
    pl = playlist_manager.generate_smart_playlist(
        req.name,
        req.smart_type,
        req.criteria or {},
        albums,
        video_indexer
    )
    return {"success": True, "playlist": pl, **pl}

@app.put("/api/playlists/{playlist_id}/cover")
async def update_playlist_cover_endpoint(playlist_id: str, req: UpdatePlaylistCoverRequest):
    """Met à jour la pochette d'une playlist existante."""
    pl = playlist_manager.update_cover(playlist_id, req.cover_url)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist introuvable.")
    return {"success": True, "playlist": pl, **pl}

@app.put("/api/playlists/{playlist_id}")
async def update_playlist_endpoint(playlist_id: str, req: UpdatePlaylistRequest):
    """Met à jour le nom, description ou pistes d'une playlist."""
    pl = playlist_manager.update_playlist(playlist_id, req.name, req.description, req.items, cover_url=req.cover_url)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist introuvable.")
    return {"success": True, "playlist": pl, **pl}

@app.delete("/api/playlists/{playlist_id}")
async def delete_playlist_endpoint(playlist_id: str):
    """Supprime une playlist utilisateur."""
    ok = playlist_manager.delete_playlist(playlist_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Playlist introuvable ou échec de suppression.")
    return {"success": True, "message": "Playlist supprimée avec succès."}

@app.post("/api/playlists/{playlist_id}/items")
async def add_playlist_items_endpoint(playlist_id: str, req: AddPlaylistItemsRequest):
    """Ajoute des pistes audio ou clips vidéo à une playlist avec filtrage anti-doublon."""
    res = playlist_manager.add_items(playlist_id, req.items)
    if not res.get("success"):
        raise HTTPException(status_code=404, detail="Playlist introuvable.")
    return res

@app.delete("/api/playlists/{playlist_id}/items/{item_id}")
async def remove_playlist_item_endpoint(playlist_id: str, item_id: str):
    """Retire une piste ou un clip vidéo d'une playlist."""
    pl = playlist_manager.remove_item(playlist_id, item_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist introuvable.")
    return {"success": True, "playlist": pl, **pl}

@app.put("/api/playlists/{playlist_id}/reorder")
async def reorder_playlist_items_endpoint(playlist_id: str, req: ReorderPlaylistRequest):
    """Réordonne les éléments d'une playlist."""
    pl = playlist_manager.reorder_items(playlist_id, req.item_ids)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist introuvable.")
    return {"success": True, "playlist": pl, **pl}

@app.post("/api/playlists/{playlist_id}/refresh")
async def refresh_smart_playlist_endpoint(playlist_id: str):
    """Actualise le contenu d'une Smart Playlist avec les écoutes et statistiques les plus récentes."""
    all_albums = library_indexer.get_all_albums() if hasattr(library_indexer, "get_all_albums") else getattr(library_indexer, "albums", [])
    pl = playlist_manager.refresh_smart_playlist(playlist_id, all_albums, video_indexer=video_indexer)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist introuvable.")
    return {"success": True, "playlist": pl, **pl}

# --- Routes Statistiques d'Écoute (Playback Stats) ---

@app.post("/api/stats/track-played")
async def record_track_played_endpoint(req: RecordPlayRequest):
    """Enregistre une écoute de piste pour alimenter les statistiques et smart playlists."""
    entry = playback_stats.record_play(
        req.path,
        title=req.title or "",
        artist=req.artist or "",
        album=req.album or "",
        genre=req.genre or "",
        duration=req.duration or 0.0,
        media_type=req.type or "audio"
    )
    return {"success": True, "entry": entry}

@app.get("/api/stats/top-tracks")
async def get_top_tracks_endpoint(limit: int = 50, genre: Optional[str] = None):
    """Retourne les pistes les plus écoutées."""
    return {"tracks": playback_stats.get_top_played(limit=limit, genre=genre)}

@app.get("/api/stats/summary")
async def get_stats_summary_endpoint():
    """Retourne un résumé global des écoutes."""
    return playback_stats.get_stats_summary()

@app.get("/api/genres/list")
async def get_library_genres_endpoint():
    """Retourne la liste triée des genres disponibles dans la bibliothèque et référentiels."""
    genres = set()
    for alb in getattr(library_indexer, "albums", []):
        g = alb.get("genre") if isinstance(alb, dict) else getattr(alb, "genre", None)
        if g and str(g).strip():
            genres.add(str(g).strip())
    common_genres = [
        "Rock", "Hard Rock", "Metal", "Heavy Metal", "Synthwave", "Cyberpunk",
        "Pop", "Chanson française", "Variété française", "Électro", "Electronic",
        "Hip-Hop", "Rap", "Jazz", "Blues", "B.O. / Soundtrack", "Bande Originale",
        "Retrogaming", "Jeu Vidéo", "Classique", "Ambient", "Chill", "R&B", "Disco"
    ]
    for cg in common_genres:
        genres.add(cg)
    return {"genres": sorted(list(genres))}

@app.websocket("/ws/logs")
async def websocket_logs_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        # Envoyer l'état actuel de la file au client nouvellement connecté
        q_state = download_manager.get_queue_state()
        await websocket.send_json({
            "type": "queue_update",
            "queue": q_state.get("queue", []),
            "current": q_state.get("current", None),
            "is_downloading": q_state.get("is_downloading", False)
        })
        while True:
            await websocket.receive_text()
    except (WebSocketDisconnect, ConnectionResetError, BrokenPipeError):
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)

class NoCacheStaticFiles(StaticFiles):
    def file_response(self, *args, **kwargs) -> Response:
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp

if FRONTEND_DIR.exists():
    app.mount("/static", NoCacheStaticFiles(directory=str(FRONTEND_DIR)), name="static")

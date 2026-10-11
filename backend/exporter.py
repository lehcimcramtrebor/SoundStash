import os
import re
import sys
import time
import shutil
import asyncio
import threading
import subprocess
import concurrent.futures
from pathlib import Path
from typing import List, Dict, Any, Optional, Callable, Tuple

from backend.config import FFMPEG_PATH, config
from backend.library_indexer import sanitize_folder_name, library_indexer
from backend.video_indexer import video_indexer
from backend.logger import get_logger

logger = get_logger(__name__)

# Extensions audio et vidéo reconnues
AUDIO_EXTENSIONS = {".mp3", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wav", ".wma"}
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v"}

def sanitize_filename(name: str) -> str:
    """Nettoie un nom de fichier pour Windows et systèmes de fichiers FAT32/exFAT."""
    sanitized = re.sub(r'[\\/*?:"<>|]', "_", str(name or "")).strip().rstrip('.')
    reserved = {'CON', 'PRN', 'AUX', 'NUL'} | {f'COM{i}' for i in range(1, 10)} | {f'LPT{i}' for i in range(1, 10)}
    if sanitized.upper() in reserved:
        sanitized = f"_{sanitized}"
    return sanitized if sanitized else "Piste"

def get_default_desktop_export_dir(export_name: str = "") -> Path:
    """Retourne le dossier d'exportation par défaut sur le Bureau de l'utilisateur."""
    desktop = Path.home() / "Desktop"
    if not desktop.exists():
        user_profile = os.environ.get("USERPROFILE")
        if user_profile:
            alt = Path(user_profile) / "Desktop"
            if alt.exists():
                desktop = alt
    
    clean_name = sanitize_folder_name(export_name.strip()) if export_name.strip() else ""
    folder_name = f"Export SoundStash {clean_name}".strip() if clean_name else "Export SoundStash"
    return desktop / folder_name


class ExportManager:
    """Gestionnaire singleton d'exportation de médias avec conversion audio/vidéo."""

    def __init__(self):
        self.lock = threading.Lock()
        self.is_running = False
        self.cancel_requested = False
        self.worker_thread: Optional[threading.Thread] = None

        self.status = "idle"  # idle | running | completed | error | cancelled
        self.export_name = ""
        self.destination_dir = ""
        self.total_items = 0
        self.processed_items = 0
        self.current_item_title = ""
        self.current_item_artist = ""
        self.percent = 0.0
        self.errors: List[str] = []
        self.audio_exported_count = 0
        self.video_exported_count = 0
        self.start_time: float = 0.0
        self.elapsed_sec: float = 0.0
        self.last_error_message: str = ""
        self.max_workers = min(max(2, (os.cpu_count() or 4)), 12)
        self._last_notify_time: float = 0.0
        
        self.broadcast_callback: Optional[Callable[[dict], Any]] = None

    def set_broadcast_callback(self, cb: Callable[[dict], Any]):
        self.broadcast_callback = cb

    def _notify_progress(self):
        """Envoie l'état courant via le callback WebSocket s'il est configuré."""
        if not self.broadcast_callback:
            return
        payload = {
            "type": "export_progress",
            "data": self.get_status()
        }
        try:
            res = self.broadcast_callback(payload)
            if asyncio.iscoroutine(res):
                # Si le callback retourne une coroutine dans un thread, l'exécuter si loop
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        asyncio.run_coroutine_threadsafe(res, loop)
                except Exception:
                    pass
        except Exception as e:
            logger.debug(f"Erreur notification progress export: {e}")

    def _throttled_notify_progress(self, min_interval: float = 0.08):
        """Envoie l'état courant avec un intervalle minimum pour fluidifier le WebSocket."""
        now = time.time()
        with self.lock:
            should_send = (now - self._last_notify_time >= min_interval) or (self.processed_items >= self.total_items)
            if should_send:
                self._last_notify_time = now
        if should_send:
            self._notify_progress()

    def get_status(self) -> Dict[str, Any]:
        """Retourne un instantané de l'état d'export."""
        with self.lock:
            elapsed = time.time() - self.start_time if (self.is_running and self.start_time > 0) else self.elapsed_sec
            return {
                "is_running": self.is_running,
                "status": self.status,
                "export_name": self.export_name,
                "destination_dir": self.destination_dir,
                "total_items": self.total_items,
                "processed_items": self.processed_items,
                "max_workers": getattr(self, "max_workers", 1),
                "current_item_title": self.current_item_title,
                "current_item_artist": self.current_item_artist,
                "percent": round(self.percent, 1),
                "errors": list(self.errors),
                "errors_count": len(self.errors),
                "audio_exported_count": self.audio_exported_count,
                "video_exported_count": self.video_exported_count,
                "elapsed_sec": round(elapsed, 1),
                "last_error_message": self.last_error_message
            }

    def cancel_export(self) -> bool:
        """Demande l'arrêt immédiat de la tâche d'export en cours."""
        with self.lock:
            if not self.is_running:
                return False
            self.cancel_requested = True
            self.status = "cancelling"
            logger.info("Annulation demandée pour l'exportation.")
        self._notify_progress()
        return True

    def estimate_selection(self, items: List[Dict[str, Any]], export_all_library: bool = False, destination_dir: str = "") -> Dict[str, Any]:
        """Calcule le nombre d'éléments, la taille estimée et l'espace libre sur la destination."""
        resolved_items = self._resolve_items(items, export_all_library)
        total_items = len(resolved_items)
        audio_count = sum(1 for it in resolved_items if it.get("item_type") == "track")
        video_count = sum(1 for it in resolved_items if it.get("item_type") == "video")

        total_bytes = 0
        for it in resolved_items:
            src = Path(it.get("source_path", ""))
            try:
                if src.is_file():
                    total_bytes += src.stat().st_size
            except Exception:
                pass

        # Calcul de l'espace disque disponible
        dest_path = Path(destination_dir.strip()) if destination_dir.strip() else get_default_desktop_export_dir()
        target_check_dir = dest_path
        while not target_check_dir.exists() and target_check_dir.parent != target_check_dir:
            target_check_dir = target_check_dir.parent

        free_bytes = 0
        try:
            usage = shutil.disk_usage(str(target_check_dir))
            free_bytes = usage.free
        except Exception:
            try:
                usage = shutil.disk_usage(os.environ.get("USERPROFILE", "."))
                free_bytes = usage.free
            except Exception:
                pass

        has_enough_space = (free_bytes >= (total_bytes + 100 * 1024 * 1024)) if free_bytes > 0 else True

        return {
            "total_items": total_items,
            "audio_count": audio_count,
            "video_count": video_count,
            "estimated_size_bytes": total_bytes,
            "estimated_size_mb": round(total_bytes / (1024 * 1024), 1),
            "estimated_size_gb": round(total_bytes / (1024 * 1024 * 1024), 2),
            "destination_free_bytes": free_bytes,
            "destination_free_gb": round(free_bytes / (1024 * 1024 * 1024), 2),
            "has_enough_space": has_enough_space,
            "resolved_destination": str(dest_path)
        }

    def _resolve_items(self, items: List[Dict[str, Any]], export_all_library: bool) -> List[Dict[str, Any]]:
        """Résout la liste complète des pistes et vidéos à partir des sélections (albums, morceaux, etc.)."""
        resolved: List[Dict[str, Any]] = []
        seen_paths = set()

        if export_all_library:
            # Exporter tous les albums indexés de la bibliothèque
            try:
                all_albums = library_indexer.get_all_albums()
                for alb in all_albums:
                    alb_path = Path(alb.path)
                    alb_title = getattr(alb, "album", None) or getattr(alb, "title", None) or alb_path.name
                    alb_artist = getattr(alb, "artist", None) or "Artiste Inconnu"
                    alb_year = str(getattr(alb, "year", "") or "")
                    alb_genre = getattr(alb, "genre", "") or ""
                    tracks = alb.tracks or []
                    for idx, t in enumerate(tracks, start=1):
                        track_file = alb_path / getattr(t, "filename", "")
                        if track_file.exists() and str(track_file) not in seen_paths:
                            seen_paths.add(str(track_file))
                            resolved.append({
                                "source_path": str(track_file),
                                "item_type": "track",
                                "title": getattr(t, "title", "") or track_file.stem,
                                "artist": alb_artist,
                                "album": alb_title,
                                "year": alb_year,
                                "genre": alb_genre,
                                "track_num": idx,
                                "album_path": str(alb_path)
                            })
            except Exception as e:
                logger.error(f"Erreur lors de la résolution de toute la bibliothèque pour export: {e}")
            return resolved

        for raw in items:
            raw_type = raw.get("type", "track")  # "album" | "track" | "video"
            raw_path = raw.get("path")
            if not raw_path:
                continue

            path_obj = Path(raw_path)
            if not path_obj.exists():
                continue

            if raw_type == "album":
                # Album entier : explorer tous les fichiers audio du dossier
                try:
                    # Récupérer les métadonnées de l'album depuis l'indexeur si possible
                    alb_meta = next((a for a in library_indexer.get_all_albums() if Path(a.path).resolve() == path_obj.resolve()), None)
                    alb_title = (getattr(alb_meta, "album", None) or getattr(alb_meta, "title", None) or raw.get("title") or path_obj.name) if alb_meta else (raw.get("title") or path_obj.name)
                    alb_artist = getattr(alb_meta, "artist", None) or raw.get("artist") or "Artiste Inconnu"
                    alb_year = str(getattr(alb_meta, "year", "") or raw.get("year") or "")
                    alb_genre = getattr(alb_meta, "genre", "") or raw.get("genre") or ""

                    # Explorer tous les fichiers audio du dossier et sous-dossiers (multi-disques)
                    audio_files = [f for f in path_obj.rglob("*") if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS]
                    audio_files.sort(key=lambda x: str(x).lower())

                    # Map des titres de pistes indexées par nom de fichier
                    tracks_meta_map = {}
                    if alb_meta and alb_meta.tracks:
                        for t in alb_meta.tracks:
                            if hasattr(t, "filename") and t.filename:
                                tracks_meta_map[t.filename.lower()] = t

                    for idx, f in enumerate(audio_files, start=1):
                        f_str = str(f)
                        if f_str not in seen_paths:
                            seen_paths.add(f_str)
                            t_meta = tracks_meta_map.get(f.name.lower())
                            t_title = getattr(t_meta, "title", "") if t_meta else ""
                            if not t_title:
                                t_title = f.stem

                            resolved.append({
                                "source_path": f_str,
                                "item_type": "track",
                                "title": t_title,
                                "artist": alb_artist,
                                "album": alb_title,
                                "year": alb_year,
                                "genre": alb_genre,
                                "track_num": idx,
                                "album_path": str(path_obj)
                            })
                except Exception as e:
                    logger.warning(f"Impossible de lire l'album {path_obj} pour export: {e}")

            elif raw_type == "video":
                v_str = str(path_obj)
                if v_str not in seen_paths:
                    seen_paths.add(v_str)
                    resolved.append({
                        "source_path": v_str,
                        "item_type": "video",
                        "title": raw.get("title") or path_obj.stem,
                        "artist": raw.get("artist") or "Artiste Inconnu",
                        "album": "Vidéothèque",
                        "year": "",
                        "genre": "",
                        "track_num": 1,
                        "album_path": None
                    })

            else:  # "track"
                t_str = str(path_obj)
                if t_str not in seen_paths:
                    seen_paths.add(t_str)
                    parent_dir = path_obj.parent
                    resolved.append({
                        "source_path": t_str,
                        "item_type": "track",
                        "title": raw.get("title") or path_obj.stem,
                        "artist": raw.get("artist") or (parent_dir.parent.name if parent_dir else "Artiste Inconnu"),
                        "album": raw.get("album") or (parent_dir.name if parent_dir else "Album Inconnu"),
                        "year": str(raw.get("year") or ""),
                        "genre": raw.get("genre") or "",
                        "track_num": raw.get("track_num") or 1,
                        "album_path": str(parent_dir) if parent_dir.is_dir() else None
                    })

        return resolved

    def start_export(self, config_payload: Dict[str, Any]) -> Dict[str, Any]:
        """Démarre le processus d'exportation dans un thread d'arrière-plan."""
        with self.lock:
            if self.is_running:
                return {"success": False, "detail": "Une tâche d'exportation est déjà en cours d'exécution."}

            self.is_running = True
            self.cancel_requested = False
            self.status = "running"
            self.export_name = (config_payload.get("export_name") or "Export").strip()
            dest_dir_str = (config_payload.get("destination_dir") or "").strip()
            
            if dest_dir_str:
                self.destination_dir = str(Path(dest_dir_str))
            else:
                self.destination_dir = str(get_default_desktop_export_dir(self.export_name))

            self.processed_items = 0
            self.total_items = 0
            self.percent = 0.0
            self.errors = []
            self.audio_exported_count = 0
            self.video_exported_count = 0
            self.start_time = time.time()
            self.elapsed_sec = 0.0
            self.last_error_message = ""

        # Lancement dans un thread démon
        self.worker_thread = threading.Thread(
            target=self._run_export_worker,
            args=(config_payload,),
            daemon=True,
            name="ExportWorker"
        )
        self.worker_thread.start()

        self._notify_progress()
        return {
            "success": True,
            "export_name": self.export_name,
            "destination_dir": self.destination_dir
        }

    def _run_export_worker(self, config_payload: Dict[str, Any]):
        """Exécution multithreadée haute performance de l'exportation et conversion."""
        raw_workers = config_payload.get("workers")
        cpu_cores = os.cpu_count() or 4
        self.max_workers = int(raw_workers) if raw_workers else min(max(2, cpu_cores), 12)

        logger.info(f"Démarrage de l'exportation vers '{self.destination_dir}' avec {self.max_workers} threads parallèles (CPU: {cpu_cores} cœurs, Nom: {self.export_name})")
        audio_mode = config_payload.get("audio_mode", "copy")  # "copy" | "convert"
        audio_format = (config_payload.get("audio_format", "mp3") or "mp3").lower()  # mp3, aac, ogg, flac, opus
        audio_bitrate = config_payload.get("audio_bitrate", "320k") or "320k"
        video_mode = config_payload.get("video_mode", "copy")  # "copy" | "extract_audio"
        folder_structure = config_payload.get("folder_structure", "artist_album_track")  # artist_album_track | artist_album_combined | flat
        copy_cover_art = bool(config_payload.get("copy_cover_art", True))
        generate_playlist = bool(config_payload.get("generate_playlist", True))
        raw_items = config_payload.get("items", [])
        export_all_library = bool(config_payload.get("export_all_library", False))

        resolved_items = self._resolve_items(raw_items, export_all_library)
        with self.lock:
            self.total_items = len(resolved_items)

        if self.total_items == 0:
            with self.lock:
                self.is_running = False
                self.status = "error"
                self.last_error_message = "Aucun élément valide à exporter n'a été trouvé."
            self._notify_progress()
            return

        dest_root = Path(self.destination_dir)
        audio_dest_dir = dest_root / "Audio"
        video_dest_dir = dest_root / "Video"

        try:
            dest_root.mkdir(parents=True, exist_ok=True)
            audio_dest_dir.mkdir(parents=True, exist_ok=True)
            video_dest_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            with self.lock:
                self.is_running = False
                self.status = "error"
                self.last_error_message = f"Impossible de créer le dossier de destination : {e}"
            self._notify_progress()
            return

        copied_covers_albums = set()
        copied_covers_lock = threading.Lock()
        playlist_tracks: List[Tuple[int, str]] = []
        playlist_lock = threading.Lock()
        seen_dest_files = set()
        seen_dest_lock = threading.Lock()

        def _process_item(idx: int, item: Dict[str, Any]):
            if self.cancel_requested:
                return

            item_type = item.get("item_type", "track")
            src_path = Path(item.get("source_path", ""))
            title = item.get("title") or src_path.stem
            artist = item.get("artist") or "Artiste Inconnu"
            album = item.get("album") or "Album Inconnu"
            track_num = item.get("track_num", idx)
            album_path = item.get("album_path")

            with self.lock:
                self.current_item_title = title
                self.current_item_artist = artist

            if not src_path.exists():
                err_msg = f"Fichier source introuvable : {src_path.name}"
                logger.warning(err_msg)
                with self.lock:
                    self.errors.append(err_msg)
                    self.processed_items += 1
                    self.percent = (self.processed_items / self.total_items) * 100.0
                self._throttled_notify_progress()
                return

            try:
                # -------------------------------------------------------------
                # TRAITEMENT AUDIO
                # -------------------------------------------------------------
                if item_type == "track":
                    clean_art = sanitize_folder_name(artist)
                    clean_alb = sanitize_folder_name(album)
                    clean_title = sanitize_filename(title)
                    try:
                        t_num_int = int(str(track_num).split('/')[0])
                        t_num_prefix = f"{t_num_int:02d}"
                    except Exception:
                        t_num_prefix = sanitize_filename(str(track_num)) if str(track_num).strip() else f"{idx:02d}"

                    # Extension de sortie
                    target_ext = f".{audio_format}" if audio_mode == "convert" else src_path.suffix.lower()

                    # Détermination du chemin relatif / dossier selon folder_structure
                    if folder_structure == "artist_album_combined":
                        target_folder = audio_dest_dir / f"{clean_art} - {clean_alb}"
                        target_filename = f"{t_num_prefix} - {clean_title}{target_ext}"
                    elif folder_structure == "flat":
                        target_folder = audio_dest_dir
                        target_filename = f"{clean_art} - {clean_alb} - {t_num_prefix} - {clean_title}{target_ext}"
                    else:  # "artist_album_track" (Par défaut)
                        target_folder = audio_dest_dir / clean_art / clean_alb
                        target_filename = f"{t_num_prefix} - {clean_title}{target_ext}"

                    try:
                        target_folder.mkdir(parents=True, exist_ok=True)
                    except Exception:
                        pass

                    target_file = target_folder / target_filename
                    with seen_dest_lock:
                        target_file_str = str(target_file).lower()
                        if target_file_str in seen_dest_files:
                            target_filename = f"{t_num_prefix} - {clean_title}_{idx}{target_ext}"
                            target_file = target_folder / target_filename
                        seen_dest_files.add(str(target_file).lower())

                    # Copie ou Reconversion
                    if audio_mode == "copy" or (audio_mode == "convert" and src_path.suffix.lower() == target_ext):
                        shutil.copy2(src_path, target_file)
                    else:
                        self._convert_audio_ffmpeg(
                            src_path=src_path,
                            dest_path=target_file,
                            fmt=audio_format,
                            bitrate=audio_bitrate,
                            meta=item
                        )

                    # Enregistrement pour la playlist M3U8 avec son index d'origine
                    try:
                        rel_p = target_file.relative_to(audio_dest_dir)
                        with playlist_lock:
                            playlist_tracks.append((idx, str(rel_p).replace("\\", "/")))
                    except Exception:
                        pass

                    # Copie de la pochette cover.jpg pour l'album
                    if copy_cover_art and album_path:
                        should_copy_cover = False
                        with copied_covers_lock:
                            if album_path not in copied_covers_albums:
                                copied_covers_albums.add(album_path)
                                should_copy_cover = True
                        if should_copy_cover:
                            self._copy_album_cover_art(Path(album_path), target_folder)

                    with self.lock:
                        self.audio_exported_count += 1

                # -------------------------------------------------------------
                # TRAITEMENT VIDÉO
                # -------------------------------------------------------------
                elif item_type == "video":
                    clean_art = sanitize_folder_name(artist)
                    clean_title = sanitize_filename(title)

                    if video_mode == "extract_audio":
                        target_folder = audio_dest_dir / "Vidéos Rips"
                        target_folder.mkdir(parents=True, exist_ok=True)
                        target_filename = f"{clean_art} - {clean_title}.mp3"
                        target_file = target_folder / target_filename
                        with seen_dest_lock:
                            if str(target_file).lower() in seen_dest_files:
                                target_file = target_folder / f"{clean_art} - {clean_title}_{idx}.mp3"
                            seen_dest_files.add(str(target_file).lower())

                        self._extract_audio_from_video_ffmpeg(src_path, target_file, item)
                        try:
                            rel_p = target_file.relative_to(audio_dest_dir)
                            with playlist_lock:
                                playlist_tracks.append((idx, str(rel_p).replace("\\", "/")))
                        except Exception:
                            pass
                        with self.lock:
                            self.audio_exported_count += 1
                    else:
                        target_filename = f"{clean_art} - {clean_title}{src_path.suffix.lower()}"
                        target_file = video_dest_dir / target_filename
                        with seen_dest_lock:
                            if str(target_file).lower() in seen_dest_files:
                                target_file = video_dest_dir / f"{clean_art} - {clean_title}_{idx}{src_path.suffix.lower()}"
                            seen_dest_files.add(str(target_file).lower())

                        shutil.copy2(src_path, target_file)
                        with self.lock:
                            self.video_exported_count += 1

            except Exception as item_err:
                err_msg = f"Erreur export '{title}' : {item_err}"
                logger.error(err_msg)
                with self.lock:
                    self.errors.append(err_msg)

            finally:
                with self.lock:
                    self.processed_items += 1
                    self.percent = (self.processed_items / self.total_items) * 100.0
                self._throttled_notify_progress()

        # Exécution en parallèle via ThreadPoolExecutor
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers, thread_name_prefix="ExportWorker") as executor:
            futures = [executor.submit(_process_item, idx, item) for idx, item in enumerate(resolved_items, start=1)]
            for future in concurrent.futures.as_completed(futures):
                if self.cancel_requested:
                    logger.info("Export interrompu par l'utilisateur, arrêt des tâches.")
                    executor.shutdown(wait=False, cancel_futures=True)
                    break

        if self.cancel_requested:
            with self.lock:
                self.status = "cancelled"
                self.is_running = False
                self.elapsed_sec = time.time() - self.start_time
            self._notify_progress()
            return

        # Génération finale de la playlist M3U8 si demandée (triée dans l'ordre initial)
        if generate_playlist and playlist_tracks:
            try:
                playlist_tracks.sort(key=lambda x: x[0])
                clean_exp_name = sanitize_filename(self.export_name) or "SoundStash"
                m3u_file = audio_dest_dir / f"Playlist - {clean_exp_name}.m3u8"
                with open(m3u_file, "w", encoding="utf-8") as f:
                    f.write("#EXTM3U\n")
                    f.write(f"#PLAYLIST:Export SoundStash - {clean_exp_name}\n\n")
                    for _, track_rel in playlist_tracks:
                        f.write(f"{track_rel}\n")
                logger.info(f"Playlist M3U8 générée : {m3u_file}")
            except Exception as pl_err:
                logger.warn(f"Impossible de créer la playlist M3U8: {pl_err}")

        # Nettoyer les sous-dossiers vides s'il n'y a eu aucun média de ce type
        try:
            if not any(video_dest_dir.iterdir()):
                video_dest_dir.rmdir()
        except Exception:
            pass
        try:
            if not any(audio_dest_dir.iterdir()):
                audio_dest_dir.rmdir()
        except Exception:
            pass

        with self.lock:
            self.processed_items = self.total_items
            self.percent = 100.0
            self.is_running = False
            self.status = "completed" if len(self.errors) < self.total_items else "error"
            self.elapsed_sec = time.time() - self.start_time

        logger.info(f"Exportation terminée en {round(self.elapsed_sec, 1)}s ({self.max_workers} threads). Audio: {self.audio_exported_count}, Vidéo: {self.video_exported_count}, Erreurs: {len(self.errors)}")
        self._notify_progress()

    def _convert_audio_ffmpeg(self, src_path: Path, dest_path: Path, fmt: str, bitrate: str, meta: Dict[str, Any]):
        """Convertit une piste audio avec FFmpeg en injectant les métadonnées et la pochette."""
        codec_map = {
            "mp3": "libmp3lame",
            "aac": "aac",
            "ogg": "libvorbis",
            "flac": "flac",
            "opus": "libopus"
        }
        codec = codec_map.get(fmt, "libmp3lame")

        cmd = [
            str(FFMPEG_PATH),
            "-y",
            "-i", str(src_path),
            "-c:a", codec
        ]

        if fmt in {"mp3", "aac", "opus"}:
            cmd.extend(["-b:a", bitrate])
        elif fmt == "ogg":
            # Mapper les bitrates OGG vers qualité Vorbis
            q = "6" if "192" in bitrate else ("8" if "256" in bitrate or "320" in bitrate else "4")
            cmd.extend(["-qscale:a", q])

        # Conserver ou forcer les métadonnées
        cmd.extend([
            "-map_metadata", "0",
            "-metadata", f"title={meta.get('title', '')}",
            "-metadata", f"artist={meta.get('artist', '')}",
            "-metadata", f"album={meta.get('album', '')}"
        ])
        if meta.get("year"):
            cmd.extend(["-metadata", f"date={meta.get('year')}"])
        if meta.get("genre"):
            cmd.extend(["-metadata", f"genre={meta.get('genre')}"])
        if meta.get("track_num"):
            cmd.extend(["-metadata", f"track={meta.get('track_num')}"])

        if fmt == "mp3":
            cmd.extend(["-id3v2_version", "3"])

        cmd.append(str(dest_path))

        res = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        )
        if res.returncode != 0:
            err_details = res.stderr.decode("utf-8", errors="replace")[-300:]
            raise RuntimeError(f"FFmpeg error code {res.returncode}: {err_details}")

    def _extract_audio_from_video_ffmpeg(self, src_path: Path, dest_path: Path, meta: Dict[str, Any]):
        """Extrait la piste audio d'un clip ou concert vidéo en MP3 320 kbps."""
        cmd = [
            str(FFMPEG_PATH),
            "-y",
            "-i", str(src_path),
            "-vn",
            "-c:a", "libmp3lame",
            "-b:a", "320k",
            "-map_metadata", "0",
            "-metadata", f"title={meta.get('title', '')}",
            "-metadata", f"artist={meta.get('artist', '')}",
            "-metadata", f"album={meta.get('album', 'Vidéos SoundStash')}",
            "-id3v2_version", "3",
            str(dest_path)
        ]
        res = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        )
        if res.returncode != 0:
            err_details = res.stderr.decode("utf-8", errors="replace")[-300:]
            raise RuntimeError(f"FFmpeg extraction error: {err_details}")

    def _copy_album_cover_art(self, album_dir: Path, target_folder: Path):
        """Recherche et copie l'image de couverture d'origine dans le dossier exporté."""
        if not album_dir.exists() or not album_dir.is_dir():
            return
        cover_names = ["cover.jpg", "cover.png", "folder.jpg", "folder.png", "album.jpg", "front.jpg"]
        for cn in cover_names:
            cp = album_dir / cn
            if cp.is_file():
                try:
                    shutil.copy2(cp, target_folder / "cover.jpg")
                    return
                except Exception:
                    pass
        # Recherche alternative d'un fichier image quelconque dans l'album
        for img in album_dir.glob("*.jpg"):
            try:
                shutil.copy2(img, target_folder / "cover.jpg")
                return
            except Exception:
                pass


# Instance singleton globale
export_manager = ExportManager()

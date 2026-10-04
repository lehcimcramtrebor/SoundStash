import asyncio
import json
import os
import re
import shutil
import uuid
import time
import tempfile
import atexit
from pathlib import Path
from typing import Callable, Optional
from backend.config import YTM_BAT_PATH, YTM_OGG_BAT_PATH, YT_DLP_PATH, FFMPEG_PATH, TEMP_DOWNLOAD_DIR, config, get_effective_cookies_file
from backend.tagger import (
    uniformize_album, get_album_info, consolidate_album_cover,
    AUDIO_EXTENSIONS, safe_rmtree, is_empty_or_na, is_playlist_url, sanitize_folder_name,
    clean_artist_name
)

VIDEO_EXTENSIONS = {".mp4", ".mkv", ".webm"}
ALL_MEDIA_EXTENSIONS = AUDIO_EXTENSIONS | VIDEO_EXTENSIONS

from backend.ytm_client import extract_ytm_browse_id, browse_ytm_innertube
from backend.logger import get_logger

logger = get_logger(__name__)

def _get_download_lock_paths() -> list[Path]:
    """Retourne les chemins des fichiers de verrouillage interrogés par l'installeur NSIS."""
    paths = []
    try:
        paths.append(Path(tempfile.gettempdir()) / "soundstash_download.lock")
    except Exception:
        pass
    local_appdata = os.environ.get("LOCALAPPDATA")
    if local_appdata:
        try:
            paths.append(Path(local_appdata) / "SoundStash" / "download.lock")
        except Exception:
            pass
    return paths

def set_download_lock_state(active: bool, task_info: str = ""):
    """Crée ou supprime le fichier flag indiquant un téléchargement en cours pour l'installeur NSIS."""
    for lock_path in _get_download_lock_paths():
        try:
            if active:
                lock_path.parent.mkdir(parents=True, exist_ok=True)
                lock_path.write_text(
                    f"active={active}\ntimestamp={time.time()}\npid={os.getpid()}\ninfo={task_info}\n",
                    encoding="utf-8"
                )
            else:
                if lock_path.exists():
                    lock_path.unlink(missing_ok=True)
        except Exception as e:
            logger.debug(f"Erreur gestion flag lock ({lock_path}): {e}")

# Nettoyage automatique au déchargement du processus
atexit.register(lambda: set_download_lock_state(False))

class DownloadManager:
    def __init__(self):
        self.is_downloading = False
        set_download_lock_state(False)
        self.current_process: Optional[asyncio.subprocess.Process] = None
        self.log_callback: Optional[Callable[[dict], None]] = None
        self.current_album_dir: Optional[Path] = None
        self.queue: list[dict] = []
        self.current_task: Optional[dict] = None
        self.worker_task: Optional[asyncio.Task] = None

    def set_log_callback(self, callback: Callable[[dict], None]):
        self.log_callback = callback

    async def broadcast(self, event_type: str, data: dict):
        if self.log_callback:
            try:
                if asyncio.iscoroutinefunction(self.log_callback):
                    await self.log_callback({"type": event_type, **data})
                else:
                    self.log_callback({"type": event_type, **data})
            except Exception as e:
                logger.error(f"Broadcast WebSocket: {e}")

    def get_queue_state(self) -> dict:
        return {
            "is_downloading": self.is_downloading,
            "current": self.current_task,
            "queue": list(self.queue),
            "queue_count": len(self.queue)
        }

    async def broadcast_queue(self):
        await self.broadcast("queue_update", self.get_queue_state())

    def enqueue_download(
        self,
        url: str,
        title: Optional[str] = None,
        audio_format: str = "m4a",
        audio_quality: str = "128K",
        auto_retag: bool = True,
        naming_pattern: str = "{track:02d} {title}",
        clean_titles: bool = True,
        is_playlist: Optional[bool] = None,
        custom_album: Optional[str] = None,
        custom_artist: Optional[str] = None,
        origin_album: Optional[str] = None,
        thumbnail_url: Optional[str] = None,
        video_quality: Optional[str] = None,
        is_external: bool = False
    ) -> dict:
        clean_art = clean_artist_name(custom_artist) if custom_artist else None
        effective_title = (title or custom_album or origin_album or "").strip()
        task = {
            "id": uuid.uuid4().hex[:8],
            "url": url,
            "title": effective_title,
            "format": audio_format,
            "quality": audio_quality,
            "video_quality": video_quality or getattr(config, "default_video_quality", "1080p"),
            "auto_retag": auto_retag,
            "naming_pattern": naming_pattern,
            "clean_titles": clean_titles,
            "is_playlist": is_playlist,
            "custom_album": custom_album,
            "custom_artist": clean_art,
            "origin_album": origin_album,
            "thumbnail_url": thumbnail_url,
            "is_external": is_external,
            "status": "queued"
        }
        self.queue.append(task)

        # Si le worker ne tourne pas actuellement, on le démarre
        try:
            loop = asyncio.get_running_loop()
            if not self.is_downloading or self.worker_task is None or self.worker_task.done():
                self.worker_task = loop.create_task(self._process_queue())
            loop.create_task(self.broadcast_queue())
        except RuntimeError:
            pass

        return {
            "success": True,
            "task": task,
            "queue_count": len(self.queue),
            "is_downloading": self.is_downloading
        }

    async def _process_queue(self):
        self.is_downloading = True
        set_download_lock_state(True, "File d'attente de téléchargement active")
        try:
            while self.queue:
                task = self.queue.pop(0)
                self.current_task = task
                task["status"] = "downloading"
                task_title = task.get("custom_album") or task.get("title") or task.get("url") or "Tâche"
                set_download_lock_state(True, f"Téléchargement : {task_title}")
                await self.broadcast_queue()

                await self._execute_download(task)

                self.current_task = None
                if self.queue:
                    # ── Cooldown anti rate-limit YouTube ──────────────────────────
                    # Pause entre les téléchargements pour éviter un blocage IP.
                    task_was_playlist = task.get("is_playlist") or (
                        "playlist" in task.get("url", "").lower()
                    )
                    cooldown = config.cooldown_album if task_was_playlist else config.cooldown_single
                    if cooldown > 0:
                        await self.broadcast("status", {
                            "status": "info",
                            "message": f"⏳ Pause anti rate-limit : {cooldown}s avant le prochain téléchargement...",
                            "task_id": task["id"]
                        })
                        logger.info(f"Cooldown {cooldown}s avant prochain téléchargement (type={'playlist/album' if task_was_playlist else 'single'})")
                        await asyncio.sleep(cooldown)
                    await self.broadcast_queue()

        finally:
            self.is_downloading = False
            self.current_task = None
            self.current_process = None
            set_download_lock_state(False)
            await self.broadcast_queue()
            await self.broadcast("status", {
                "status": "queue_completed",
                "message": "Tous les téléchargements de la file d'attente sont terminés !"
            })

    async def _execute_download(self, task: dict) -> dict:
        url = task["url"]
        audio_format = task["format"]
        audio_quality = task["quality"]
        auto_retag = task["auto_retag"]
        naming_pattern = task["naming_pattern"]
        clean_titles = task["clean_titles"]

        self.current_album_dir = None
        base_temp_dir = Path(config.temp_download_dir)
        base_temp_dir.mkdir(parents=True, exist_ok=True)
        is_external = bool(task.get("is_external"))
        temp_dir = (base_temp_dir / "_external") if is_external else base_temp_dir
        temp_dir.mkdir(parents=True, exist_ok=True)

        task_is_playlist = task.get("is_playlist")
        # Sanctuarisation : une URL contenant OLAK ou MPREB_ est un album studio officiel certifié, jamais une playlist
        if "OLAK" in url.upper() or "MPREB_" in url.upper():
            task_is_playlist = False
        elif task_is_playlist is None:
            task_is_playlist = is_playlist_url(url)

        # Résolution proactive des playlists YouTube Music pour télécharger directement
        # les versions audio officielles actives et éviter les redirections yt-dlp
        batch_file_path = None
        if task_is_playlist:
            browse_id = extract_ytm_browse_id(url)
            if browse_id:
                try:
                    await self.broadcast("log", {
                        "text": f"[SoundStash] Analyse de la discographie ({browse_id})...",
                        "progress": None
                    })
                    ytm_info = await browse_ytm_innertube(browse_id)
                    if ytm_info and ytm_info.get("tracks"):
                        task["ytm_info"] = ytm_info
                        active_tracks = [t for t in ytm_info["tracks"] if t.get("is_available") and t.get("video_id")]
                        if active_tracks:
                            batch_file = temp_dir / f"ytm_batch_{task['id']}.txt"
                            with open(batch_file, "w", encoding="utf-8") as bf:
                                for tr in active_tracks:
                                    bf.write(f"https://www.youtube.com/watch?v={tr['video_id']}\n")
                            batch_file_path = batch_file
                            if not task.get("custom_album") and ytm_info.get("title"):
                                task["custom_album"] = ytm_info["title"]
                            if not task.get("thumbnail_url") and ytm_info.get("thumbnail"):
                                task["thumbnail_url"] = ytm_info["thumbnail"]
                            if not task.get("custom_artist") and ytm_info.get("artist") and ytm_info["artist"] != "Artiste inconnu":
                                task["custom_artist"] = clean_artist_name(ytm_info["artist"])
                            await self.broadcast("log", {
                                "text": f"[SoundStash] {len(active_tracks)} pistes officielles actives resolues dans la playlist.",
                                "progress": None
                            })
                except Exception as e:
                    logger.warning(f"Résolution playlist YTM: {e}")

        is_video = audio_format.lower() == "mp4"
        is_single = not task_is_playlist and ("watch?v=" in url.lower() or "youtu.be/" in url.lower() or "/shorts/" in url.lower())

        if is_video:
            script_name = "yt-dlp (Vidéo MP4)"
            
            cmd_args = [YT_DLP_PATH, '-4', '--newline', '--windows-filenames']
            if Path(FFMPEG_PATH).exists():
                cmd_args += ['--ffmpeg-location', FFMPEG_PATH]
            
            pl_flag = ""
            extra_args = ""
            if batch_file_path:
                extra_args = '--autonumber-start 1'
            else:
                pl_flag = "--yes-playlist" if task_is_playlist else "--no-playlist"

            if pl_flag:
                cmd_args.append(pl_flag)  # '--yes-playlist' ou '--no-playlist'
            
            vq = str(task.get("video_quality") or getattr(config, "default_video_quality", "1080p")).lower()
            if "2160" in vq or "4k" in vq:
                fmt_str = 'bv*[vcodec^=avc1][height<=2160]+ba[ext=m4a]/bv*[height<=2160][ext=mp4]+ba[ext=m4a]/b[height<=2160][ext=mp4]/best'
            elif "1440" in vq or "2k" in vq:
                fmt_str = 'bv*[vcodec^=avc1][height<=1440]+ba[ext=m4a]/bv*[height<=1440][ext=mp4]+ba[ext=m4a]/b[height<=1440][ext=mp4]/best'
            elif "720" in vq:
                fmt_str = 'bv*[vcodec^=avc1][height<=720]+ba[ext=m4a]/bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/best'
            elif "best" in vq:
                fmt_str = 'bv*[vcodec^=avc1]+ba[ext=m4a]/bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best'
            else:  # 1080p par défaut
                fmt_str = 'bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a]/bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/best[height<=1080]/best'

            cmd_args += [
                '-f', fmt_str, '--merge-output-format', 'mp4',
                '--socket-timeout', '30',
                '--extractor-args', 'youtube:player_client=android,web'
            ]
            cmd_args += ['--embed-metadata', '--write-thumbnail', '--convert-thumbnails', 'jpg']
            cmd_args += ['--parse-metadata', '%(title)s:%(artist)s - %(title)s']
            cmd_args += ['--parse-metadata', '%(channel,uploader)s:%(artist)s']
            
            out_tmpl_video = f'{temp_dir}/%(artist,uploader)s - %(title)s [Vidéo]/%(autonumber)02d %(artist,uploader)s - %(title)s.%(ext)s' if batch_file_path else f'{temp_dir}/%(artist,uploader)s - %(title)s [Vidéo]/%(artist,uploader)s - %(title)s.%(ext)s'
            cmd_args += ['-o', out_tmpl_video]
            
            if extra_args:
                cmd_args += extra_args.split()  # '--autonumber-start 1' → ['--autonumber-start', '1']
                
            if batch_file_path:
                cmd_args += ['-a', str(batch_file_path)]
            else:
                cmd_args.append(url)
        else:
            if audio_format.lower() in ["ogg", "vorbis"]:
                script_name = "yt-dlp (Audio OGG)"
                a_format = "vorbis"
            else:
                script_name = "yt-dlp (Audio AAC)"
                a_format = "aac"

            # Pour le format AAC, prioriser le flux natif Premium 141 (256k AAC m4a sans réencodage)
            audio_format_selector = '141/ba[ext=m4a]/ba/b' if a_format == "aac" else 'ba/b'
            cmd_args = [
                YT_DLP_PATH, '-x', '-f', audio_format_selector, '--ignore-errors', '--newline', '--windows-filenames',
                '--socket-timeout', '30',
                '--extractor-args', 'youtube:player_client=android,web'
            ]
            if Path(FFMPEG_PATH).exists():
                cmd_args += ['--ffmpeg-location', FFMPEG_PATH]
            
            # Détection de session connectée (cookies) : bascule automatique en haute fidélité (256K max)
            effective_cookies = get_effective_cookies_file()
            raw_quality = (audio_quality or getattr(config, "default_quality", "auto")).lower()
            if raw_quality in ["auto", "max", "best", ""]:
                if effective_cookies and getattr(config, "max_audio_quality_when_signed", True):
                    eff_quality = "256K"
                    logger.info("Qualité Auto + Session YouTube active : sélection maximale sans perte (256K AAC).")
                else:
                    eff_quality = "0"  # Meilleure qualité de la source yt-dlp
            else:
                eff_quality = audio_quality

            if eff_quality != "0":
                cmd_args += ['--audio-format', a_format, '--audio-quality', eff_quality]
            else:
                cmd_args += ['--audio-format', a_format, '--audio-quality', '0']
            cmd_args += ['--embed-metadata', '--embed-thumbnail', '--write-thumbnail', '--convert-thumbnails', 'jpg']
            cmd_args += ['--parse-metadata', 'playlist_index:%(track_number)s']
            cmd_args += ['--parse-metadata', '%(title)s:%(artist)s - %(title)s']
            # Pour les playlists, ne pas écraser l'artiste par le channel YouTube :
            # chaque piste a son propre artiste extrait par yt-dlp et le channel est
            # souvent un tiers (ex: "Ferris Durandochine") qui n'a rien à voir.
            if not task_is_playlist:
                cmd_args += ['--parse-metadata', '%(channel,uploader)s:%(artist)s']
            cmd_args += ['--parse-metadata', '%(artist)s:%(album_artist)s']
            if not is_external:
                cmd_args += ['--parse-metadata', '%(album|Extrait Video)s:%(album)s']
            cmd_args += ['--parse-metadata', '%(release_date>%Y,upload_date>%Y,release_year)s:%(date)s']
            cmd_args += ['--parse-metadata', '%(release_date>%Y,upload_date>%Y,release_year)s:%(year)s']
            cmd_args += ['--parse-metadata', 'Source yt-dlp:%(comment)s']
            cmd_args += ['--postprocessor-args', 'ffmpeg:-metadata comment= -metadata description= -metadata synopsis=']

            if task_is_playlist:
                custom_pl_title = task.get("custom_album")
                if not custom_pl_title or is_empty_or_na(custom_pl_title):
                    custom_pl_title = "Playlist"
                if not re.search(r'\s*\[playlist\]\s*$', custom_pl_title, flags=re.IGNORECASE):
                    custom_pl_title = f"{custom_pl_title} [Playlist]"
                    task["custom_album"] = custom_pl_title
                safe_pl = sanitize_folder_name(custom_pl_title)
                
                if batch_file_path:
                    out_template = f'{temp_dir}/{safe_pl}/%(autonumber)02d %(title)s.%(ext)s'
                else:
                    out_template = f'{temp_dir}/{safe_pl}/%(playlist_index)02d %(title)s.%(ext)s'

            if batch_file_path:
                cmd_args += ['-a', str(batch_file_path)]
                if task_is_playlist:
                    cmd_args += ['-o', out_template, '--autonumber-start', '1']
            else:
                cmd_args.append(url)
                if task_is_playlist:
                    cmd_args.append('--yes-playlist')
                    cmd_args += ['-o', out_template]
                    cmd_args += ['--parse-metadata', 'playlist_index:%(track_number)s']
                elif 'watch?v=' in url and not is_playlist_url(url):
                    cmd_args.append('--no-playlist')
                    
            if '-o' not in cmd_args:
                if is_external and not task_is_playlist:
                    default_template = f'{temp_dir}/%(title)s/%(title)s.%(ext)s'
                else:
                    default_template = f'{temp_dir}/%(album,playlist_title,title)s/%(playlist_index)02d %(title)s.%(ext)s'
                cmd_args += ['-o', default_template]

            if task.get('custom_artist') and not is_empty_or_na(task['custom_artist']):
                safe_artist = sanitize_folder_name(clean_artist_name(task['custom_artist']))
                cmd_args += ['--parse-metadata', f'{safe_artist}:%(album_artist)s']

        # Injection automatique des cookies de session YouTube si configurés
        effective_cookies = get_effective_cookies_file()
        if effective_cookies:
            cmd_args += ['--cookies', str(effective_cookies)]
            logger.info(f"Authentification YouTube active via cookies : '{effective_cookies.name}'")

        # Snapshot des dossiers contenant des fichiers média avant téléchargement
        def get_media_subdirs():
            res = set()
            for d in temp_dir.iterdir():
                if d.is_dir():
                    if any(f.suffix.lower() in ALL_MEDIA_EXTENSIONS for f in d.iterdir() if f.is_file()):
                        res.add(d.resolve())
            return res

        before_subdirs = get_media_subdirs()
        # Tracker aussi le nombre de fichiers pour détecter les changements dans les dossiers existants
        before_file_counts = {d: sum(1 for f in d.iterdir() if f.is_file() and f.suffix.lower() in ALL_MEDIA_EXTENSIONS) for d in before_subdirs}

        await self.broadcast("status", {
            "status": "started",
            "message": f"Démarrage via {script_name} : {url}",
            "task_id": task["id"],
            "url": url,
            "is_playlist": task_is_playlist,
            "is_single": is_single,
            "is_video": is_video,
            "remaining_in_queue": len(self.queue)
        })
        logger.info(f"Téléchargement démarré | url={url} | cmd={cmd_args[0]} | task={task['id']}")

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd_args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT
            )
            self.current_process = process

            error_403_count = 0
            bot_detected = False
            _leftover = ""  # Buffer pour les lignes incomplètes entre les chunks

            while True:
                # Lecture par chunks : yt-dlp envoie les lignes de progression avec \r
                # (carriage return sans \n) — readline() ne les verrait jamais en temps réel.
                chunk = await process.stdout.read(4096)
                if not chunk:
                    break

                # Décoder et combiner avec le reste du chunk précédent
                decoded = _leftover + chunk.decode("utf-8", errors="replace")
                # Splitter sur \r ET \n (les deux sont utilisés par yt-dlp)
                parts = re.split(r"[\r\n]", decoded)
                # Le dernier élément est potentiellement incomplet → le garder pour le prochain chunk
                _leftover = parts[-1]

                for decoded_line in parts[:-1]:
                    decoded_line = decoded_line.strip()
                    if not decoded_line:
                        continue

                    line_lower = decoded_line.lower()
                    # Détecter les blocages anti-bot / rate limits YouTube
                    if ("confirm you" in line_lower and "bot" in line_lower) or \
                       ("not a bot" in line_lower) or \
                       ("too many requests" in line_lower) or \
                       ("unusual traffic" in line_lower) or \
                       ("automated queries" in line_lower) or \
                       ("429" in line_lower and "error" in line_lower):
                        bot_detected = True

                    # Compter les erreurs HTTP 403 pour améliorer le diagnostic final
                    if "403" in decoded_line and "error" in line_lower:
                        error_403_count += 1

                    progress_info = self._parse_progress_line(decoded_line)

                    await self.broadcast("log", {
                        "text": decoded_line,
                        "progress": progress_info,
                        "task_id": task["id"]
                    })

            # Traiter le dernier fragment s'il reste quelque chose
            if _leftover.strip():
                decoded_line = _leftover.strip()
                line_lower = decoded_line.lower()
                if ("confirm you" in line_lower and "bot" in line_lower) or \
                   ("not a bot" in line_lower) or \
                   ("too many requests" in line_lower) or \
                   ("unusual traffic" in line_lower) or \
                   ("automated queries" in line_lower) or \
                   ("429" in line_lower and "error" in line_lower):
                    bot_detected = True
                if "403" in decoded_line and "error" in line_lower:
                    error_403_count += 1
                progress_info = self._parse_progress_line(decoded_line)
                await self.broadcast("log", {"text": decoded_line, "progress": progress_info, "task_id": task["id"]})

            await process.wait()

            if batch_file_path and batch_file_path.exists():
                try:
                    batch_file_path.unlink()
                except Exception:
                    pass

            after_subdirs = get_media_subdirs()
            new_subdirs = list(after_subdirs - before_subdirs)
            # Détecter aussi les dossiers existants qui ont reçu de nouveaux fichiers
            for d in after_subdirs & before_subdirs:
                after_count = sum(1 for f in d.iterdir() if f.is_file() and f.suffix.lower() in ALL_MEDIA_EXTENSIONS)
                if after_count > before_file_counts.get(d, 0):
                    if d not in new_subdirs:
                        new_subdirs.append(d)
                        logger.info(f"Dossier existant mis à jour : '{d.name}' ({before_file_counts.get(d, 0)} → {after_count} fichiers)")

            if process.returncode != 0:
                has_audio = bool(new_subdirs) or any(
                    any(f.suffix.lower() in ALL_MEDIA_EXTENSIONS for f in d.iterdir() if f.is_file())
                    for d in after_subdirs
                )
                if not has_audio:
                    # Échec total sans aucun fichier téléchargé
                    album_display_title = task.get("title") or task.get("custom_album") or ""
                    if bot_detected:
                        logger.error(f"Échec total du téléchargement : Détection anti-bot YouTube ('Sign in to confirm you're not a bot') | url={url}")
                        err_reason = "bot_detected"
                        err_msg = (
                            "Téléchargement bloqué par la protection anti-bot de YouTube. "
                            "Patientez quelques minutes avant de relancer un téléchargement."
                        )
                    elif error_403_count > 0:
                        logger.error(f"Échec total du téléchargement (HTTP 403 Forbidden sur {error_403_count} tentatives) | url={url}")
                        err_reason = "http_403"
                        err_msg = f"Le téléchargement a été refusé par YouTube (Erreur HTTP 403 Forbidden sur {error_403_count} tentative(s))."
                    else:
                        logger.error(f"Échec total du téléchargement (code {process.returncode}) | aucun média audio récupéré | url={url}")
                        err_reason = "unknown"
                        err_msg = f"Le téléchargement a échoué (code {process.returncode}). Aucun fichier n'a pu être récupéré."

                    for d in temp_dir.iterdir():
                        if d.is_dir() and d.name not in {"_external", "_Hors_Analyse"}:
                            if not any(f.suffix.lower() in ALL_MEDIA_EXTENSIONS for f in d.iterdir() if f.is_file()):
                                safe_rmtree(d)
                    await self.broadcast("status", {
                        "status": "error",
                        "reason": err_reason,
                        "message": err_msg,
                        "album_title": album_display_title,
                        "task_id": task["id"],
                        "remaining_in_queue": len(self.queue)
                    })
                    return {"success": False, "message": err_msg, "reason": err_reason}
                else:
                    # Succès partiel : certaines vidéos de la playlist étaient inaccessibles, mais des morceaux ont été téléchargés !
                    part_msg = "Certaines pistes de la sélection étaient indisponibles sur la source. Finalisation et retaggage des pistes récupérées..."
                    if bot_detected:
                        part_msg = "Certaines pistes ont été bloquées par la protection anti-bot YouTube. Finalisation des pistes récupérées..."
                    await self.broadcast("status", {
                        "status": "info",
                        "message": part_msg,
                        "task_id": task["id"]
                    })

            # ── Identifier le dossier album téléchargé ──────────────────────────
            # Stratégie en 4 étapes avec logging complet pour diagnostiquer les ratés :
            #   1. custom_album exact (sanitized)
            #   2. custom_album sans suffixe [Playlist]
            #   3. custom_album par correspondance partielle dans les noms de dossiers
            #   4. Nouveau dossier audio apparu pendant le téléchargement (mtime le + récent)
            #   5. Fallback : dossier audio le plus récemment modifié parmi tous
            album_dir = None

            # Log de l'état des dossiers pour diagnostic
            all_dirs_now = [d for d in temp_dir.iterdir() if d.is_dir()]
            logger.info(f"Détection album_dir | custom_album='{task.get('custom_album')}' | "
                       f"new_subdirs={[d.name for d in new_subdirs]} | "
                       f"tous_dossiers={[d.name for d in all_dirs_now]}")

            if task.get("custom_album"):
                # Étape 1 : nom exact sanitisé
                candidate = temp_dir / sanitize_folder_name(task["custom_album"])
                if candidate.exists() and any(f.suffix.lower() in ALL_MEDIA_EXTENSIONS for f in candidate.iterdir() if f.is_file()):
                    album_dir = candidate
                    logger.info(f"album_dir trouvé (exact) : '{candidate.name}'")

                if not album_dir:
                    # Étape 2 : sans suffixe [Playlist]
                    base_name = re.sub(r'\s*\[playlist\]\s*$', '', task["custom_album"], flags=re.IGNORECASE).strip()
                    candidate_base = temp_dir / sanitize_folder_name(base_name)
                    if candidate_base.exists() and any(f.suffix.lower() in ALL_MEDIA_EXTENSIONS for f in candidate_base.iterdir() if f.is_file()):
                        album_dir = candidate_base
                        logger.info(f"album_dir trouvé (sans [Playlist]) : '{candidate_base.name}'")

                if not album_dir:
                    # Étape 3 : correspondance partielle — chercher dans tous les nouveaux dossiers
                    # dont le nom contient des mots-clés du custom_album
                    custom_words = set(re.sub(r'[^\w\s]', ' ', task["custom_album"].lower()).split())
                    custom_words -= {'the', 'le', 'la', 'les', 'de', 'du', 'des', 'et', 'a'}
                    best_match = None
                    best_score = 0
                    candidates = new_subdirs if new_subdirs else [d for d in all_dirs_now if any(f.suffix.lower() in ALL_MEDIA_EXTENSIONS for f in d.iterdir() if f.is_file())]
                    for d in candidates:
                        d_words = set(re.sub(r'[^\w\s]', ' ', d.name.lower()).split())
                        common = custom_words & d_words
                        score = len(common) / max(len(custom_words), 1)
                        if score > best_score:
                            best_score = score
                            best_match = d
                    if best_match and best_score >= 0.4:
                        album_dir = best_match
                        logger.info(f"album_dir trouvé (partiel, score={best_score:.0%}) : '{best_match.name}'")
                    elif best_match:
                        logger.warning(f"Correspondance partielle trop faible (score={best_score:.0%}) pour '{task.get('custom_album')}' → candidat rejeté : '{best_match.name}'")

            if not album_dir:
                if new_subdirs:
                    # Étape 4 : nouveau dossier trié par mtime décroissant (le plus récent = téléchargement actuel)
                    new_subdirs_sorted = sorted(new_subdirs, key=lambda d: d.stat().st_mtime, reverse=True)
                    album_dir = new_subdirs_sorted[0]
                    logger.info(f"album_dir trouvé (nouveau dossier, mtime) : '{album_dir.name}'" +
                               (f" | {len(new_subdirs)} candidats" if len(new_subdirs) > 1 else ""))
                else:
                    # Étape 5 : fallback sur le dossier audio le plus récemment modifié
                    all_audio_dirs = [d for d in all_dirs_now if any(f.suffix.lower() in ALL_MEDIA_EXTENSIONS for f in d.iterdir() if f.is_file())]
                    if all_audio_dirs:
                        album_dir = max(all_audio_dirs, key=lambda d: d.stat().st_mtime)
                        logger.warning(f"album_dir fallback mtime : '{album_dir.name}' (aucun nouveau dossier détecté)")
                    else:
                        logger.error(f"album_dir introuvable — aucun dossier audio dans temp_dir | url={url}")

            # Consolider les dossiers d'images/miniatures résiduels sans fichiers audio
            non_audio_dirs = [d for d in temp_dir.iterdir() if d.is_dir() and not any(f.suffix.lower() in ALL_MEDIA_EXTENSIONS for f in d.iterdir() if f.is_file())]
            if album_dir and album_dir.exists():
                target_cover = album_dir / "cover.jpg"
                if non_audio_dirs:
                    for nad in non_audio_dirs:
                        for img in nad.iterdir():
                            if img.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
                                if not target_cover.exists():
                                    try:
                                        shutil.copy2(str(img), str(target_cover))
                                    except Exception:
                                        pass
                        safe_rmtree(nad)
                # Si une URL de pochette officielle a été fournie (ex: pour une playlist), la télécharger comme cover.jpg
                if task.get("thumbnail_url"):
                    def download_thumbnail_sync(url, dest):
                        import urllib.request
                        req = urllib.request.Request(
                            url,
                            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
                        )
                        with urllib.request.urlopen(req, timeout=10) as resp, open(dest, "wb") as out_f:
                            out_f.write(resp.read())
                    
                    try:
                        await asyncio.to_thread(download_thumbnail_sync, task["thumbnail_url"], str(target_cover))
                    except Exception as e:
                        thumb_url = task.get("thumbnail_url", "?")
                        logger.warning(f"Téléchargement pochette {thumb_url}: {e}")

                if not target_cover.exists():
                    for f in temp_dir.iterdir():
                        if f.is_file() and f.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
                            try:
                                shutil.copy2(str(f), str(target_cover))
                                f.unlink()
                                break
                            except Exception:
                                pass

                consolidate_album_cover(album_dir)

            self.current_album_dir = album_dir
            album_data = None

            if album_dir and album_dir.exists():
                if task.get("ytm_info"):
                    try:
                        meta_file = album_dir / ".album_meta.json"
                        with open(meta_file, "w", encoding="utf-8") as mf:
                            json.dump(task["ytm_info"], mf, ensure_ascii=False, indent=2)
                        logger.info(f"Métadonnées de playlist YTM enregistrées dans '{meta_file.name}'")
                    except Exception as e:
                        logger.warning(f"Sauvegarde .album_meta.json: {e}")

                if auto_retag:
                    await self.broadcast("status", {
                        "status": "tagging",
                        "message": f"Uniformisation des tags (Kid3) dans le dossier temporaire : {album_dir.name}...",
                        "task_id": task["id"]
                    })
                    uniformize_res = uniformize_album(
                        album_dir=album_dir,
                        custom_album=task.get("custom_album"),
                        custom_artist=clean_artist_name(task.get("custom_artist")) if task.get("custom_artist") else None,
                        rename_files=True,
                        naming_pattern=naming_pattern,
                        clean_titles=clean_titles,
                        is_playlist=task_is_playlist,
                        origin_album=task.get("origin_album")
                    )
                    if uniformize_res.get("success") and uniformize_res.get("album_dir"):
                        album_dir = Path(uniformize_res["album_dir"])
                        self.current_album_dir = album_dir
                    await self.broadcast("tag_result", uniformize_res)

                # Sécurité supplémentaire si le dossier s'appelle encore NA
                if album_dir.exists() and is_empty_or_na(album_dir.name):
                    info_check = get_album_info(album_dir)
                    tracks_check = info_check.get("tracks", [])
                    if tracks_check:
                        if len(tracks_check) == 1:
                            target_safe_name = f"{info_check['album_artist']} - {tracks_check[0]['title']} [AUDIO RIP]"
                        elif task_is_playlist:
                            target_safe_name = info_check['album_name'] if info_check['album_artist'] in {"Various Artists", "Artiste inconnu"} else f"{info_check['album_artist']} - {info_check['album_name']}"
                        else:
                            target_safe_name = f"{info_check['album_artist']} - {info_check['album_name']}"
                        clean_dir_target = album_dir.parent / sanitize_folder_name(target_safe_name)
                        if not clean_dir_target.exists():
                            try:
                                album_dir.rename(clean_dir_target)
                                album_dir = clean_dir_target
                                self.current_album_dir = album_dir
                            except Exception:
                                pass

                album_data = get_album_info(album_dir)

            # ── Dossier fantôme : aucun fichier audio téléchargé ────────────────
            # Cas typique : toutes les pistes ont retourné HTTP 403 Forbidden
            # (contenu géo-restreint, DRM, ou compte sans abonnement requis).
            # On supprime le dossier vide et on signale l'erreur clairement.
            if album_data is None or not album_data.get("tracks"):
                if album_dir and album_dir.exists():
                    try:
                        safe_rmtree(album_dir)
                    except Exception:
                        pass
                if error_403_count > 0:
                    err_msg = (
                        f"Aucun fichier audio n'a pu être téléchargé "
                        f"({error_403_count} piste(s) bloquée(s) par erreur 403 — accès refusé par le serveur distant). "
                        "Ce contenu est probablement géo-restreint ou protégé par DRM."
                    )
                    logger.error(f"Phantom folder — {error_403_count} erreur(s) 403 | url={url}")
                else:
                    err_msg = (
                        "Aucun fichier audio n'a pu être téléchargé. "
                        "Vérifiez que l'URL est accessible et que les contenus sont disponibles dans votre région."
                    )
                    logger.error(f"Phantom folder — 0 fichier audio téléchargé | url={url}")
                await self.broadcast("status", {
                    "status": "error",
                    "message": err_msg,
                    "task_id": task["id"],
                    "remaining_in_queue": len(self.queue)
                })
                return {"success": False, "message": err_msg}

            warning_msg = album_data.get("warning") if album_data else None

            # Avertissement de succès partiel si certaines pistes ont été bloquées par 403
            if error_403_count > 0:
                partial_warn = f"{error_403_count} piste(s) ont été ignorées (erreur 403 — accès refusé par le serveur distant)."
                warning_msg = f"{warning_msg} | {partial_warn}" if warning_msg else partial_warn
                logger.warning(f"Succès partiel — {error_403_count} piste(s) 403 ignorée(s) | url={url}")

            track_count = len(album_data.get("tracks", [])) if album_data else 0
            logger.info(f"Téléchargement terminé | album='{album_data.get('album_name', '?')}' | {track_count} piste(s) | url={url}")

            await self.broadcast("status", {
                "status": "finished",
                "message": "Téléchargement terminé dans le dossier temporaire !",
                "album": album_data,
                "warning": warning_msg,
                "task_id": task["id"],
                "remaining_in_queue": len(self.queue)
            })

            return {"success": True, "album": album_data, "warning": warning_msg}

        except Exception as e:
            logger.error(f"Exception inattendue lors du téléchargement | url={url} | {e}", exc_info=True)
            if batch_file_path and batch_file_path.exists():
                try:
                    batch_file_path.unlink()
                except Exception:
                    pass
            await self.broadcast("status", {
                "status": "error",
                "message": str(e),
                "task_id": task["id"],
                "remaining_in_queue": len(self.queue)
            })
            return {"success": False, "message": str(e)}

    def _parse_progress_line(self, line: str) -> dict:
        info = {}
        pct_match = re.search(r"(\d{1,3}(?:\.\d+)?)%", line)
        if pct_match:
            info["percent"] = float(pct_match.group(1))

        speed_match = re.search(r"at\s+([0-9\.]+[kMG]iB/s)", line)
        if speed_match:
            info["speed"] = speed_match.group(1)

        eta_match = re.search(r"ETA\s+(\d+:\d+)", line)
        if eta_match:
            info["eta"] = eta_match.group(1)

        item_match = re.search(r"Downloading (?:item|video|track)?\s*(\d+)\s+of\s+(\d+)", line, re.IGNORECASE)
        if item_match:
            info["item_current"] = int(item_match.group(1))
            info["item_total"] = int(item_match.group(2))

        return info

    def cancel_current(self) -> bool:
        if self.current_process and self.is_downloading:
            try:
                import subprocess
                pid = self.current_process.pid
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True)
                return True
            except Exception as e:
                logger.warning(f"Annulation téléchargement: {e}")
                try:
                    self.current_process.kill()
                except Exception:
                    pass
                return True
        return False

    def cancel_all(self) -> bool:
        self.queue.clear()
        canceled = self.cancel_current()
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.broadcast_queue())
        except RuntimeError:
            pass
        return canceled

    def remove_from_queue(self, task_id: str) -> bool:
        initial_len = len(self.queue)
        self.queue = [t for t in self.queue if t.get("id") != task_id]
        removed = len(self.queue) < initial_len
        if removed:
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self.broadcast_queue())
            except RuntimeError:
                pass
        return removed

    def cancel_download(self, task_id: str) -> bool:
        """Annule une tâche qu'elle soit en cours de téléchargement actif ou en attente dans la file."""
        if self.current_task and self.current_task.get("id") == task_id:
            return self.cancel_current()
        return self.remove_from_queue(task_id)

download_manager = DownloadManager()


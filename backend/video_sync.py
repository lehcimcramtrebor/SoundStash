"""
Module de Synchronisation et d'Harmonisation Permanente de la Vidéothèque (Video-Sync).

Garantit que l'arborescence physique des vidéos musicales est parfaitement ordonnée :
1. Rangement automatique des clips vidéo déposés en vrac à la racine vers 'Vidéothèque / [Artiste] / [Titre].mp4'.
2. Nettoyage automatique des titres parasites dans les noms de fichiers (Official Video, Clip, 1080p, etc.).
3. Taggage propre des métadonnées MP4 via Kid3-CLI.
4. Déplacement conjoint des miniatures compagnons (JPG/PNG/WEBP).
5. Nettoyage des dossiers d'artistes devenus vides.
6. Émission d'événements de notification en temps réel.
"""

import os
import re
import time
import stat
import shutil
import threading
from pathlib import Path
from typing import Optional, Callable, Dict, List, Tuple, Any

from backend.config import config, KID3_CLI_PATH
from backend.logger import get_logger
from backend.video_indexer import video_indexer, VIDEO_EXTENSIONS, probe_video_metadata

logger = get_logger(__name__)

_video_sync_lock = threading.Lock()
_video_stop_requested = threading.Event()
_video_event_callback: Optional[Callable[[str, str, str], None]] = None
_video_status_callback: Optional[Callable[[bool, str, str, str], None]] = None

def is_video_syncing() -> bool:
    """Indique si une synchronisation ou un rangement de la vidéothèque est activement en cours."""
    return _video_sync_lock.locked()

def request_video_sync_stop():
    """Demande l'interruption propre de la synchronisation vidéo au prochain point non critique."""
    global _video_stop_requested
    _video_stop_requested.set()
    logger.info("🛑 Signal d'interruption propre envoyé à VideoSync.")

def is_video_stop_requested() -> bool:
    return _video_stop_requested.is_set()

def set_video_sync_callback(cb: Callable[[str, str, str], None]):
    """Définit le callback pour émettre les toasts temps réel de synchronisation vidéo."""
    global _video_event_callback
    _video_event_callback = cb

def set_video_status_callback(cb: Callable[[bool, str, str, str], None]):
    """Définit le callback pour émettre les changements de statut actif/inactif de synchronisation vidéo."""
    global _video_status_callback
    _video_status_callback = cb

def dispatch_video_notification(level: str, title: str, message: str):
    if _video_event_callback:
        try:
            _video_event_callback(level, title, message)
        except Exception as e:
            logger.debug(f"Erreur callback notification vidéo: {e}")

def sanitize_folder_name(s: str) -> str:
    """Nettoie un nom de dossier pour Windows."""
    if not s:
        return "Clips Divers"
    clean = re.sub(r'[<>:"/\\|?*]', '_', str(s)).strip().strip('.')
    clean = re.sub(r'\s+', ' ', clean)
    return clean if clean else "Clips Divers"

def clean_video_title(raw_title: str) -> str:
    """Retire toutes les mentions parasites des titres de clips YouTube."""
    if not raw_title:
        return ""
    cleaned = raw_title
    # Variantes Clip Officiel
    cleaned = re.sub(
        r"\s*[\(\[](?:clip\s+officiel|official\s+clip)(?:[,\s\-]+(?:hd|4k|hq|\d+p|remaster(?:ed)?))*[)\]]",
        "",
        cleaned,
        flags=re.IGNORECASE
    )
    # Variantes Official Video / Music Video
    cleaned = re.sub(
        r"\s*[\(\[](?:(?:official\s+)?(?:(?:hd|4k|hq|uhd)\s+)?(?:music\s+video|video|audio|lyric\s+video|visualizer|mv|clip|vidéo)(?:[,\s\-]+(?:remaster(?:ed)?|hd|4k|hq|\d+p))*)[)\]]",
        "",
        cleaned,
        flags=re.IGNORECASE
    )
    cleaned = re.sub(
        r"\s*[\(\[](?:(?:official\s+)?live\s+(?:video|clip|session|stream)|video\s+live)[)\]]",
        "",
        cleaned,
        flags=re.IGNORECASE
    )
    cleaned = re.sub(r'\s*\[(?:1080p|720p|4k|2160p|hd)\]', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned or raw_title.strip()

def _is_file_accessible(path: Path) -> bool:
    """Vérifie si un fichier n'est pas verrouillé par un téléchargement ou une copie Windows."""
    try:
        if not path.is_file() or path.stat().st_size == 0:
            return False
        with open(path, "rb") as f:
            f.read(512)
        return True
    except (IOError, PermissionError):
        return False

def tag_video_file(video_path: Path, artist: str, title: str):
    """Injecte proprement les tags Artiste et Titre dans le fichier MP4 via Kid3-CLI."""
    if not video_path.exists() or not Path(KID3_CLI_PATH).exists():
        return
    try:
        cmd = [
            KID3_CLI_PATH,
            "-c", f'set artist "{artist}"',
            "-c", f'set title "{title}"',
            "-c", f'set album "Clips Vidéos"',
            str(video_path)
        ]
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=6)
    except Exception as e:
        logger.debug(f"Erreur tag_video_file sur {video_path.name}: {e}")

def heal_loose_videos(video_dir: Path) -> int:
    """
    Rangement automatique des vidéos orphelines déposées en vrac à la racine de la vidéothèque.
    Détecte 'Artiste - Titre.mp4', crée le dossier 'Artiste/' et déplace le fichier.
    """
    if not video_dir.exists() or not video_dir.is_dir():
        return 0

    healed_count = 0
    try:
        for entry in list(video_dir.iterdir()):
            if _video_stop_requested.is_set():
                logger.info("🛑 Arrêt propre VideoSync (heal_loose_videos).")
                break
            if entry.is_file() and entry.suffix.lower() in VIDEO_EXTENSIONS:
                if not _is_file_accessible(entry):
                    continue

                stem = entry.stem
                artist = "Clips Divers"
                title = stem

                if " - " in stem:
                    parts = stem.split(" - ", 1)
                    artist = sanitize_folder_name(parts[0].strip())
                    title = clean_video_title(parts[1].strip())
                else:
                    title = clean_video_title(stem)

                meta = probe_video_metadata(entry)
                dur_sec = meta.get("duration", 0.0)
                has_concert_dur = dur_sec >= 600.0  # >= 10 minutes (la durée met la puce à l'oreille : concert et non simple clip)
                has_concert_kw = bool(re.search(
                    r"\b(concert|live|tour|festival|show|session|recital|spectacle|acoustique|unplugged|en\s+public|in\s+concert|full\s+concert|concert\s+complet)\b",
                    stem,
                    re.IGNORECASE
                ))
                is_concert = has_concert_dur or has_concert_kw
                target_dir = video_dir / artist / "Concerts" if is_concert else video_dir / artist
                target_dir.mkdir(parents=True, exist_ok=True)

                safe_title = sanitize_folder_name(title)
                target_file = target_dir / f"{safe_title}{entry.suffix.lower()}"

                # Éviter d'écraser un fichier existant identique
                if target_file.exists() and target_file != entry:
                    target_file = target_dir / f"{safe_title}_{int(time.time())}{entry.suffix.lower()}"

                shutil.move(str(entry), str(target_file))

                # Déplacer aussi la miniature compagnon si elle existe à la racine
                for img_ext in [".jpg", ".png", ".webp"]:
                    companion = entry.with_suffix(img_ext)
                    if companion.exists() and companion.is_file():
                        target_thumb = target_dir / f"{safe_title}{img_ext}"
                        try:
                            shutil.move(str(companion), str(target_thumb))
                        except Exception:
                            pass

                tag_video_file(target_file, artist, title)
                healed_count += 1
                dispatch_video_notification(
                    "orange",
                    "Rangement concert" if is_concert else "Rangement clip vidéo",
                    f"'{title}' rangé sous '{artist}{'/Concerts' if is_concert else ''}'"
                )

    except Exception as e:
        logger.error(f"Erreur heal_loose_videos: {e}")

    return healed_count

def heal_misnamed_videos(video_dir: Path) -> int:
    """Nettoie les noms de fichiers vidéo au sein des dossiers artistes s'ils contiennent des mentions parasites."""
    if not video_dir.exists() or not video_dir.is_dir():
        return 0

    renamed_count = 0
    try:
        for artist_dir in video_dir.iterdir():
            if _video_stop_requested.is_set():
                logger.info("🛑 Arrêt propre VideoSync (heal_misnamed_videos).")
                break
            if artist_dir.is_dir() and not artist_dir.name.startswith("."):
                dirs_to_check = [artist_dir]
                concerts_sub = artist_dir / "Concerts"
                if concerts_sub.exists() and concerts_sub.is_dir():
                    dirs_to_check.append(concerts_sub)

                for cur_dir in dirs_to_check:
                    for vid in list(cur_dir.iterdir()):
                        if _video_stop_requested.is_set():
                            break
                        if vid.is_file() and vid.suffix.lower() in VIDEO_EXTENSIONS:
                            clean_name = clean_video_title(vid.stem)
                            if clean_name and clean_name != vid.stem:
                                safe_name = sanitize_folder_name(clean_name)
                                target = cur_dir / f"{safe_name}{vid.suffix.lower()}"
                                if not target.exists():
                                    vid.rename(target)
                                    # Renommer la miniature compagnon associée
                                    for img_ext in [".jpg", ".png", ".webp"]:
                                        companion = vid.with_suffix(img_ext)
                                        if companion.exists():
                                            companion.rename(cur_dir / f"{safe_name}{img_ext}")
                                    renamed_count += 1
    except Exception as e:
        logger.error(f"Erreur heal_misnamed_videos: {e}")

    return renamed_count

def clean_empty_video_dirs(video_dir: Path) -> int:
    """Supprime les dossiers d'artistes vides dans la vidéothèque."""
    if not video_dir.exists() or not video_dir.is_dir():
        return 0

    deleted = 0
    try:
        for artist_dir in list(video_dir.iterdir()):
            if artist_dir.is_dir() and not artist_dir.name.startswith("."):
                items = [
                    f for f in artist_dir.iterdir()
                    if not f.name.startswith(".") and f.name.lower() not in {"desktop.ini", "thumbs.db"}
                ]
                if not items:
                    for residual in artist_dir.iterdir():
                        try:
                            os.chmod(str(residual), stat.S_IWRITE)
                            residual.unlink(missing_ok=True)
                        except Exception:
                            pass
                    try:
                        os.chmod(str(artist_dir), stat.S_IWRITE)
                        artist_dir.rmdir()
                        deleted += 1
                    except Exception as e:
                        logger.debug(f"Impossible de supprimer dossier vidéo vide {artist_dir.name}: {e}")
    except Exception as e:
        logger.error(f"Erreur clean_empty_video_dirs: {e}")

    return deleted

def clean_temporary_artifacts(video_dir: Path) -> int:
    """Nettoie les résidus temporaires de téléchargement (.part, .ytdl, etc.) dans toute la vidéothèque."""
    if not video_dir.exists() or not video_dir.is_dir():
        return 0

    cleaned = 0
    try:
        for root, _, files in os.walk(video_dir):
            if _video_stop_requested.is_set():
                break
            for f in files:
                f_lower = f.lower()
                if (
                    any(f_lower.endswith(ext) for ext in [".part", ".ytdl", ".tmp", ".temp", ".crdownload"])
                    or (".mp4.part" in f_lower)
                ):
                    p = Path(root) / f
                    try:
                        os.chmod(str(p), stat.S_IWRITE)
                        p.unlink(missing_ok=True)
                        cleaned += 1
                        logger.info(f"Résidu temporaire purgé de la vidéothèque: {p.name}")
                    except Exception as e:
                        logger.warning(f"Impossible de purger résidu {p.name}: {e}")
    except Exception as e:
        logger.error(f"Erreur clean_temporary_artifacts: {e}")

    return cleaned

def synchronize_videos() -> Dict[str, Any]:
    """Exécute un cycle complet de synchronisation de la vidéothèque."""
    with _video_sync_lock:
        _video_stop_requested.clear()
        video_dir = video_indexer.get_video_dir()
        if not video_dir.exists():
            return {"success": False, "message": "Dossier vidéo introuvable."}

        if _video_status_callback:
            try:
                _video_status_callback(True, "video_sync", "Hub Vidéos", f"Analyse & auto-organisation de {video_dir.name}...")
            except Exception:
                pass

        try:
            cleaned_artifacts = clean_temporary_artifacts(video_dir) if not _video_stop_requested.is_set() else 0
            loose_count = heal_loose_videos(video_dir)
            renamed_count = heal_misnamed_videos(video_dir) if not _video_stop_requested.is_set() else 0
            empty_cleaned = clean_empty_video_dirs(video_dir) if not _video_stop_requested.is_set() else 0

            total_actions = loose_count + renamed_count + cleaned_artifacts

            if total_actions > 0 and not _video_stop_requested.is_set():
                video_indexer.invalidate_cache()
                dispatch_video_notification(
                    "green",
                    "Vidéothèque 100% synchronisée",
                    f"{total_actions} action(s) de rangement et normalisation effectuée(s)."
                )

            return {
                "success": True,
                "interrupted": _video_stop_requested.is_set(),
                "loose_videos_healed": loose_count,
                "misnamed_renamed": renamed_count,
                "empty_dirs_cleaned": empty_cleaned,
                "total_actions": total_actions
            }
        finally:
            _video_stop_requested.clear()
            if _video_status_callback:
                try:
                    _video_status_callback(False, "video_sync", "Hub Vidéos", "Synchronisation terminée")
                except Exception:
                    pass

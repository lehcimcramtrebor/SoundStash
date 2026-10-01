"""
Module d'Assistant de Migration et de Rapatriement de Bibliothèque (SoundStash).

Permet de détecter la présence de fichiers audio ou vidéo dans un ancien emplacement
(ex: 'Bureau/Musique SoundStash' ou 'Bureau/Vidéos SoundStash' par défaut) lors de la configuration
d'une nouvelle bibliothèque personnalisée.

En accord avec la philosophie Tag-First de l'application, les fichiers migrés
sont automatiquement déplacés et rigoureusement organisés par Artiste / Album (audio)
ou Artiste (vidéos), puis les dossiers résiduels vides sont nettoyés.
"""

import os
import shutil
import re
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

from backend.config import config, DEFAULT_EXPORT_DIR, DEFAULT_VIDEO_EXPORT_DIR
from backend.logger import get_logger
from backend.tagger import (
    AUDIO_EXTENSIONS, clean_artist_name, get_track_metadata,
    consolidate_album_cover
)
from backend.library_sync import sanitize_name, synchronize_collection
from backend.library_indexer import library_indexer
from backend.video_indexer import video_indexer, VIDEO_EXTENSIONS

import threading

logger = get_logger(__name__)

_migration_lock = threading.Lock()
_migrator_stop_requested = threading.Event()

def is_migrating() -> bool:
    """Indique si une opération de migration de fichiers est activement en cours."""
    return _migration_lock.locked()

def request_migrator_stop():
    """Demande l'interruption propre de la migration au prochain album/fichier."""
    global _migrator_stop_requested
    _migrator_stop_requested.set()
    logger.info("🛑 Signal d'interruption propre envoyé à LibraryMigrator.")

def is_migrator_stop_requested() -> bool:
    return _migrator_stop_requested.is_set()

def _is_empty_or_ignored(p: Path) -> bool:
    """Vérifie si un chemin est ignoré (dossiers cachés/système)."""
    return p.name.startswith(".") or p.name.startswith("$") or p.name == "System Volume Information"

def _find_audio_files(directory: Path) -> List[Path]:
    """Trouve récursivement tous les fichiers audio accessibles."""
    audio_files: List[Path] = []
    if not directory.is_dir():
        return audio_files
    for root, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if not _is_empty_or_ignored(Path(d))]
        for f in files:
            ext = Path(f).suffix.lower()
            if ext in AUDIO_EXTENSIONS:
                audio_files.append(Path(root) / f)
    return audio_files

def _find_video_files(directory: Path) -> List[Path]:
    """Trouve récursivement tous les fichiers vidéo accessibles."""
    video_files: List[Path] = []
    if not directory.is_dir():
        return video_files
    for root, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if not _is_empty_or_ignored(Path(d))]
        for f in files:
            ext = Path(f).suffix.lower()
            if ext in VIDEO_EXTENSIONS:
                video_files.append(Path(root) / f)
    return video_files

def _clean_empty_folders(root_dir: Path):
    """Supprime récursivement les dossiers vides dans root_dir, et root_dir s'il devient vide."""
    if not root_dir.exists() or not root_dir.is_dir():
        return
    for current_dir, dirs, files in os.walk(root_dir, topdown=False):
        p = Path(current_dir)
        # Ne supprimer que si aucun fichier restant
        try:
            non_hidden = [f for f in p.iterdir() if not f.name.startswith(".")]
            if not non_hidden:
                # Supprimer les éventuels résidus cachés (.DS_Store, thumbs.db)
                for res in list(p.iterdir()):
                    try:
                        res.unlink()
                    except Exception:
                        pass
                p.rmdir()
                logger.info(f"Nettoyage dossier vide : {p}")
        except Exception:
            pass

def check_migration_needed(migration_type: str, new_path: str) -> Dict[str, Any]:
    """
    Vérifie si un ancien dossier contient des médias nécessitant une migration
    vers le nouveau dossier new_path.
    """
    if not new_path or not new_path.strip():
        return {"needs_migration": False}

    target = Path(new_path.strip()).resolve()

    if migration_type == "music":
        # Dossier source actuel : library_dir configuré, sinon export_dir en cours, sinon défaut
        active_src = config.library_dir or config.export_dir or str(DEFAULT_EXPORT_DIR)
        source = Path(active_src).resolve()

        if source == target or str(source).casefold() == str(target).casefold() or not source.is_dir():
            return {"needs_migration": False}

        # Ne pas migrer si la source est parent ou sous-dossier de la cible
        if source in target.parents or target in source.parents:
            return {"needs_migration": False}

        audio_files = _find_audio_files(source)
        if not audio_files:
            return {"needs_migration": False}

        # Décompte des albums (dossiers uniques contenant des pistes audio)
        album_dirs = {f.parent for f in audio_files}
        albums_count = len(album_dirs)
        files_count = len(audio_files)

        return {
            "needs_migration": True,
            "type": "music",
            "source_path": str(source),
            "target_path": str(target),
            "albums_count": albums_count,
            "files_count": files_count,
            "summary": f"{albums_count} album(s) ({files_count} pistes audio)"
        }

    elif migration_type == "video":
        active_src = config.video_library_dir or config.video_export_dir or str(DEFAULT_VIDEO_EXPORT_DIR)
        source = Path(active_src).resolve()

        if source == target or str(source).casefold() == str(target).casefold() or not source.is_dir():
            return {"needs_migration": False}

        if source in target.parents or target in source.parents:
            return {"needs_migration": False}

        video_files = _find_video_files(source)
        if not video_files:
            return {"needs_migration": False}

        videos_count = len(video_files)
        return {
            "needs_migration": True,
            "type": "video",
            "source_path": str(source),
            "target_path": str(target),
            "videos_count": videos_count,
            "files_count": videos_count,
            "summary": f"{videos_count} clip(s) vidéo"
        }

    return {"needs_migration": False}


def execute_migration(migration_type: str, source_path: str, target_path: str) -> Dict[str, Any]:
    """
    Exécute le déplacement et l'organisation automatique des fichiers média
    depuis source_path vers target_path.
    """
    with _migration_lock:
        _migrator_stop_requested.clear()
        try:
            return _do_execute_migration(migration_type, source_path, target_path)
        finally:
            _migrator_stop_requested.clear()

def _do_execute_migration(migration_type: str, source_path: str, target_path: str) -> Dict[str, Any]:
    source = Path(source_path).resolve()
    target = Path(target_path).resolve()

    if not source.is_dir():
        return {"success": False, "error": f"Dossier source introuvable : {source}"}

    target.mkdir(parents=True, exist_ok=True)

    if migration_type == "music":
        audio_files = _find_audio_files(source)
        if not audio_files:
            return {"success": True, "moved_count": 0, "message": "Aucun fichier audio à migrer."}

        # Grouper les pistes par dossier pour préserver les albums
        dirs_map: Dict[Path, List[Path]] = {}
        for af in audio_files:
            dirs_map.setdefault(af.parent, []).append(af)

        moved_tracks = 0
        moved_albums = 0

        for album_dir, tracks in dirs_map.items():
            if _migrator_stop_requested.is_set():
                logger.info("🛑 Arrêt propre LibraryMigrator (musique).")
                break
            # Extraire les métadonnées de l'album
            sample_artists = []
            sample_albums = []
            for t in tracks[:4]:
                try:
                    meta = get_track_metadata(t)
                    if meta.get("artist"):
                        sample_artists.append(meta["artist"].strip())
                    if meta.get("album"):
                        sample_albums.append(meta["album"].strip())
                except Exception:
                    pass

            # Résolution de l'artiste et de l'album
            if sample_artists:
                raw_artist = max(set(sample_artists), key=sample_artists.count)
            else:
                # Si le dossier parent est un nom d'artiste, ou dossier 'Artiste - Album'
                if " - " in album_dir.name:
                    raw_artist = album_dir.name.split(" - ", 1)[0].strip()
                elif album_dir.parent != source and album_dir.parent.name:
                    raw_artist = album_dir.parent.name
                else:
                    raw_artist = "Artiste Inconnu"

            if sample_albums:
                raw_album = max(set(sample_albums), key=sample_albums.count)
            else:
                if " - " in album_dir.name:
                    raw_album = album_dir.name.split(" - ", 1)[1].strip()
                else:
                    raw_album = album_dir.name

            artist_clean = clean_artist_name(raw_artist)
            safe_artist = sanitize_name(artist_clean)
            safe_album = sanitize_name(raw_album)

            dest_album_dir = target / safe_artist / safe_album
            dest_album_dir.mkdir(parents=True, exist_ok=True)

            # Déplacer toutes les pistes audio
            for t in tracks:
                dest_file = dest_album_dir / t.name
                if dest_file.exists():
                    if dest_file.stat().st_size == t.stat().st_size:
                        try:
                            t.unlink()
                        except Exception:
                            pass
                        moved_tracks += 1
                        continue
                    else:
                        dest_file = dest_album_dir / f"{t.stem}_migrated{t.suffix}"

                try:
                    shutil.move(str(t), str(dest_file))
                    moved_tracks += 1
                except Exception as e:
                    logger.error(f"Erreur déplacement {t.name}: {e}")

            # Déplacer les images et pochettes compagnons (cover.jpg, folder.jpg)
            for img in album_dir.iterdir():
                if img.is_file() and img.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
                    dest_img = dest_album_dir / img.name
                    if not dest_img.exists():
                        try:
                            shutil.move(str(img), str(dest_img))
                        except Exception:
                            pass

            moved_albums += 1

        # Lancer l'harmonisation finale Tag-First
        try:
            synchronize_collection(target)
        except Exception as e:
            logger.warning(f"Erreur auto-harmonisation post-migration : {e}")

        # Nettoyer les dossiers résiduels vides dans l'ancienne source
        _clean_empty_folders(source)

        # Mettre à jour l'indexeur (protégé contre les répertoires temporaires de tests)
        try:
            import tempfile
            target_res = target.resolve()
            t_sys = Path(tempfile.gettempdir()).resolve()
            is_temp = (t_sys == target_res or t_sys in target_res.parents or "tmp" in target_res.name.lower())
            if not is_temp:
                library_indexer.scan(force=True, custom_dir=str(target), save_cache=True)
            else:
                logger.info("Répertoire cible de test temporaire détecté : saut de la réindexation de la collection.")
        except Exception as e:
            logger.warning(f"Erreur indexation post-migration : {e}")

        logger.info(f"Migration Musique réussie : {moved_albums} album(s), {moved_tracks} piste(s) déplacé(s) vers {target}")
        return {
            "success": True,
            "type": "music",
            "moved_count": moved_albums,
            "files_count": moved_tracks,
            "message": f"{moved_albums} album(s) ({moved_tracks} pistes) déplacé(s) et classé(s) avec succès !"
        }

    elif migration_type == "video":
        video_files = _find_video_files(source)
        if not video_files:
            return {"success": True, "moved_count": 0, "message": "Aucune vidéo à migrer."}

        moved_videos = 0

        for vf in video_files:
            if _migrator_stop_requested.is_set():
                logger.info("🛑 Arrêt propre LibraryMigrator (vidéo).")
                break
            # Résolution de l'artiste et du titre propre
            rel = vf.relative_to(source)
            if len(rel.parts) > 1:
                artist_name = rel.parts[0]
                title_name = vf.stem
            else:
                parts = vf.stem.split(" - ", 1)
                if len(parts) == 2:
                    artist_name = parts[0].strip()
                    title_name = parts[1].strip()
                else:
                    artist_name = "Clips Divers"
                    title_name = vf.stem

            title_clean = re.sub(
                r"\s*[\(\[](?:(?:official\s+)?(?:(?:hd|4k|hq|uhd)\s+)?(?:music\s+video|video|audio|lyric\s+video|visualizer|mv|clip|vidéo)(?:[,\s]+(?:remaster(?:ed)?|hd|4k|hq|\d+p))*)[)\]]",
                "",
                title_name,
                flags=re.IGNORECASE
            ).strip()

            safe_artist = sanitize_name(artist_name)
            safe_title = sanitize_name(title_clean)
            dest_artist_dir = target / safe_artist
            dest_artist_dir.mkdir(parents=True, exist_ok=True)

            dest_filename = f"{safe_artist} - {safe_title}{vf.suffix}"
            dest_file = dest_artist_dir / dest_filename
            if dest_file.exists() and dest_file.stat().st_size == vf.stat().st_size:
                try:
                    vf.unlink()
                except Exception:
                    pass
                moved_videos += 1
                continue

            try:
                shutil.move(str(vf), str(dest_file))
                moved_videos += 1
            except Exception as e:
                logger.error(f"Erreur déplacement vidéo {vf.name}: {e}")
                continue

            # Déplacer la miniature ou fichiers compagnons associés
            companion_candidates = [
                vf.with_suffix(".jpg"),
                vf.with_suffix(".png"),
                vf.with_suffix(".webp"),
                vf.with_suffix(".info.json")
            ]
            for comp in companion_candidates:
                if comp.exists() and comp.is_file():
                    dest_comp = dest_artist_dir / f"{safe_artist} - {safe_title}{comp.suffix}"
                    try:
                        shutil.move(str(comp), str(dest_comp))
                    except Exception:
                        pass

        # Nettoyage des dossiers vides
        _clean_empty_folders(source)

        # Invalidation et réindexation du catalogue vidéo
        try:
            video_indexer.invalidate_cache()
            video_indexer.scan_catalog(force_refresh=True)
        except Exception as e:
            logger.warning(f"Erreur réindexation vidéos post-migration : {e}")

        logger.info(f"Migration Vidéo réussie : {moved_videos} clip(s) déplacé(s) vers {target}")
        return {
            "success": True,
            "type": "video",
            "moved_count": moved_videos,
            "files_count": moved_videos,
            "message": f"{moved_videos} clip(s) vidéo déplacé(s) et classé(s) avec succès !"
        }

    return {"success": False, "error": f"Type de migration inconnu : {migration_type}"}

"""
Module de Synchronisation et Auto-Harmonisation Permanente Collection (Tags ➔ Fichiers).

Garantit que l'arborescence physique sur disque est le reflet strict et permanent
des métadonnées audio :
1. Rangement automatique des pistes orphelines/en vrac dans 'Artiste / Album / XX - Titre.ext'.
2. Réalignement automatique des albums déplacés sous le mauvais artiste.
3. Harmonisation des noms de dossiers d'albums selon le tag officiel.
4. Surveillance d'arrière-plan silencieuse (veille à 0% CPU, détection ultra-légère).
5. Émission d'événements de synchronisation pour les notifications flottantes (orange/vert).
"""

import os
import re
import time
import stat
import shutil
import threading
from pathlib import Path
from typing import Optional, Callable, Dict, List, Tuple, Any

import json
from backend.config import config, CONFIG_DIR
from backend.logger import get_logger
from backend.tagger import (
    get_track_metadata, clean_artist_name, clean_track_title,
    AUDIO_EXTENSIONS, consolidate_album_cover, sanitize_path,
    normalize_cover_artwork, sanitize_folder_name
)
from backend.library_indexer import library_indexer, normalize_text, DISC_SUBFOLDER_RE
from backend.video_indexer import video_indexer, VIDEO_EXTENSIONS, probe_video_metadata
from backend.video_sync import clean_video_title, tag_video_file, dispatch_video_notification

logger = get_logger(__name__)

_sync_lock = threading.Lock()
_sync_stop_requested = threading.Event()
_global_event_callback: Optional[Callable[[str, str, str], None]] = None
_global_status_callback: Optional[Callable[[bool, str, str, str], None]] = None
_global_library_updated_callback: Optional[Callable[[], None]] = None

# Empreinte de structure persistée du dernier sync réussi sans action.
# Permet de sauter les phases heal_* coûteuses si rien n'a changé structurellement,
# y compris lors du redémarrage de l'application.
_FINGERPRINT_FILE = CONFIG_DIR / ".sync_fingerprint.json"

def _load_persisted_fingerprint() -> Optional[Tuple]:
    try:
        if _FINGERPRINT_FILE.exists():
            with open(_FINGERPRINT_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    return tuple((item[0], tuple(item[1])) for item in data)
    except Exception as e:
        logger.debug(f"Erreur chargement empreinte persistée: {e}")
    return None

def _save_persisted_fingerprint(fp: Optional[Tuple]):
    try:
        if fp is None:
            if _FINGERPRINT_FILE.exists():
                _FINGERPRINT_FILE.unlink()
        else:
            _FINGERPRINT_FILE.parent.mkdir(parents=True, exist_ok=True)
            with open(_FINGERPRINT_FILE, "w", encoding="utf-8") as f:
                json.dump([[item[0], list(item[1])] for item in fp], f)
    except Exception as e:
        logger.debug(f"Erreur sauvegarde empreinte persistée: {e}")

_last_clean_sync_signature: Optional[Tuple] = _load_persisted_fingerprint()

def is_library_syncing() -> bool:
    """Indique si une synchronisation ou un rangement de la bibliothèque musicale est activement en cours."""
    return _sync_lock.locked()

def request_library_sync_stop():
    """Demande l'interruption propre de la synchronisation au prochain point sûr (entre deux fichiers/albums)."""
    global _sync_stop_requested
    _sync_stop_requested.set()
    logger.info("🛑 Signal d'interruption propre envoyé à LibrarySync (arrêt au prochain point non critique).")

def is_library_sync_stop_requested() -> bool:
    return _sync_stop_requested.is_set()

def set_sync_event_callback(cb: Callable[[str, str, str], None]):
    """Définit le callback global pour émettre les notifications de synchronisation."""
    global _global_event_callback
    _global_event_callback = cb

def set_sync_status_callback(cb: Callable[[bool, str, str, str], None]):
    """Définit le callback global pour émettre les changements de statut actif/inactif de synchronisation musicale."""
    global _global_status_callback
    _global_status_callback = cb

def set_library_updated_callback(cb: Callable[[], None]):
    """Définit le callback global déclenché lorsque la bibliothèque musicale est réindexée ou modifiée."""
    global _global_library_updated_callback
    _global_library_updated_callback = cb

def sanitize_name(s: str) -> str:
    """Nettoie un nom de dossier ou de fichier pour le système de fichiers Windows."""
    if not s:
        return "Inconnu"
    clean = re.sub(r'[<>:"/\\|?*]', '_', str(s)).strip().strip('.')
    # Supprimer les underscores multiples ou espaces résiduels
    clean = re.sub(r'\s+', ' ', clean)
    return clean if clean else "Inconnu"

def _is_file_accessible(path: Path) -> bool:
    """Vérifie si un fichier n'est pas verrouillé par une copie Windows en cours."""
    try:
        if not path.is_file() or path.stat().st_size == 0:
            return False
        with open(path, "rb") as f:
            f.read(512)
        return True
    except (IOError, PermissionError):
        return False

def safe_clean_empty_artist_dir(artist_dir: Path) -> bool:
    """
    Supprime un dossier d'artiste s'il ne contient plus aucun album ou fichier audio/média utile,
    même si Windows y a laissé des fichiers système/cachés (desktop.ini, Thumbs.db, ehthumbs.db).
    """
    if not artist_dir.is_dir():
        return False
    try:
        meaningful = [
            f for f in artist_dir.iterdir()
            if not f.name.startswith(".") and f.name.lower() not in {"desktop.ini", "thumbs.db", "ehthumbs.db"}
        ]
        if meaningful:
            return False

        # Retirer les attributs lecture seule/système sur les fichiers résiduels et sur le dossier
        for item in artist_dir.iterdir():
            try:
                os.chmod(str(item), stat.S_IWRITE)
                item.unlink(missing_ok=True)
            except Exception:
                pass

        try:
            os.chmod(str(artist_dir), stat.S_IWRITE)
            artist_dir.rmdir()
            return True
        except Exception:
            shutil.rmtree(str(artist_dir), ignore_errors=True)
            return not artist_dir.exists()
    except Exception as e:
        logger.debug(f"Impossible de supprimer le dossier vide '{artist_dir.name}': {e}")
        return False

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

def _cleanup_empty_dirs(root_dir: Path):
    """Supprime récursivement les sous-dossiers vides à l'intérieur d'un dossier racine."""
    if not root_dir.is_dir():
        return
    for dirpath, dirnames, filenames in os.walk(str(root_dir), topdown=False):
        dp = Path(dirpath)
        if dp == root_dir:
            continue
        try:
            entries = [f for f in dp.iterdir() if f.name.lower() not in {"desktop.ini", "thumbs.db", "ehthumbs.db"}]
            if not entries:
                for f in dp.iterdir():
                    try:
                        os.chmod(str(f), stat.S_IWRITE)
                        f.unlink(missing_ok=True)
                    except Exception:
                        pass
                os.chmod(str(dp), stat.S_IWRITE)
                dp.rmdir()
        except Exception:
            pass

def _compute_structure_fingerprint(library_dir: Path) -> Optional[Tuple]:
    """
    Calcule une empreinte ultra-légère (< 5ms) de la structure artiste/album.
    Seuls les noms de dossiers et le nombre de sous-entrées sont utilisés —
    aucun fichier audio n'est ouvert. Utilisée pour détecter si la structure
    a changé depuis le dernier sync propre.
    """
    if not library_dir.is_dir():
        return None
    entries = []
    try:
        with os.scandir(str(library_dir)) as it:
            for artist in sorted(it, key=lambda e: e.name):
                if not artist.is_dir() or artist.name.startswith(".") or artist.name.lower() == "_imports":
                    continue
                try:
                    album_names = tuple(sorted(
                        e.name for e in os.scandir(artist.path)
                        if os.path.isdir(os.path.join(artist.path, e.name)) and not e.name.startswith(".")
                    ))
                    entries.append((artist.name, album_names))
                except Exception:
                    entries.append((artist.name, ()))
    except Exception:
        return None
    return tuple(entries)

def heal_empty_artist_dirs(library_dir: Path) -> int:
    """Balaye les dossiers artistes de niveau 1 et supprime ceux qui sont orphelins ou vides."""
    if not library_dir.is_dir():
        return 0
    cleaned_count = 0
    for entry in list(library_dir.iterdir()):
        if entry.is_dir() and not entry.name.startswith(".") and entry.name.lower() != "_imports":
            if safe_clean_empty_artist_dir(entry):
                cleaned_count += 1
                logger.info(f"Dossier d'artiste orphelin/vide supprimé : '{entry.name}'")
    return cleaned_count

def is_real_video_file(file_path: Path) -> bool:
    """Détermine si un fichier est une véritable vidéo musicale (et non un simple conteneur audio)."""
    if not file_path.exists() or not file_path.is_file():
        return False
    ext = file_path.suffix.lower()
    if ext in {".avi", ".mov", ".m4v"}:
        return True
    if ext in VIDEO_EXTENSIONS:
        try:
            meta = probe_video_metadata(file_path)
            # Si ffprobe détecte une résolution vidéo (width > 0 & height > 0)
            if meta.get("width", 0) > 0 and meta.get("height", 0) > 0:
                return True
            # Si ffprobe a extrait une durée mais pas de flux vidéo, il s'agit d'audio pur encapsulé
            if meta.get("duration", 0.0) > 0 and meta.get("width", 0) == 0:
                return False
            return True
        except Exception:
            return True
    return False

def route_video_to_videotheque(
    video_file: Path,
    preferred_artist: Optional[str] = None,
    preferred_title: Optional[str] = None,
    is_concert_hint: Optional[bool] = None
) -> Optional[Path]:
    """
    Déplace et range automatiquement un fichier vidéo dans la Vidéothèque locale :
    - Déduit le nom de l'artiste et le titre
    - Détecte clip vs concert (durée >= 10 min ou mots-clés)
    - Place dans Vidéothèque / Artiste / Concerts ou Vidéothèque / Artiste
    - Tague le fichier et déplace les miniatures compagnons
    """
    if not video_file.exists() or not video_file.is_file():
        return None
    try:
        video_dir = video_indexer.get_video_dir()
        meta = probe_video_metadata(video_file)
        dur_sec = meta.get("duration", 0.0)

        stem = video_file.stem
        artist = preferred_artist or ""
        title = preferred_title or ""

        if not artist or artist.lower() in {"inconnu", "unknown", "artiste inconnu", "singles & rips", "clips divers"}:
            try:
                t_meta = get_track_metadata(video_file)
                artist = clean_artist_name(t_meta.get("album_artist") or t_meta.get("artist") or "")
                if not title:
                    title = t_meta.get("title") or ""
            except Exception:
                pass

        if not artist or artist.lower() in {"inconnu", "unknown", "artiste inconnu", "singles & rips", "clips divers"}:
            if " - " in stem:
                parts = stem.split(" - ", 1)
                artist = clean_artist_name(parts[0].strip())
                if not title:
                    title = parts[1].strip()
            elif video_file.parent.name.lower() not in {"_imports", "singles & rips", "singles and rips", "temp"}:
                artist = clean_artist_name(video_file.parent.name)

        if not artist or artist.lower() in {"inconnu", "unknown", "artiste inconnu", "singles & rips", "clips divers"}:
            artist = "Artiste inconnu"

        if not title:
            if " - " in stem:
                title = stem.split(" - ", 1)[1].strip()
            else:
                title = stem

        title = clean_video_title(title)

        # Détection Concert vs Clip :
        # 1. Durée >= 10 minutes (600s) -> met la puce à l'oreille : c'est un concert et non un clip
        # 2. Mots-clés concert / live / tour / festival...
        # 3. Indice ou sous-dossier explicite
        has_concert_duration = dur_sec >= 600.0
        has_concert_keywords = bool(re.search(
            r"\b(concert|live|tour|festival|show|session|recital|spectacle|acoustique|unplugged|en\s+public|in\s+concert|full\s+concert|concert\s+complet)\b",
            f"{stem} {video_file.parent.name}",
            re.IGNORECASE
        ))
        is_concert = is_concert_hint if is_concert_hint is not None else (has_concert_duration or has_concert_keywords)

        target_dir = video_dir / artist / "Concerts" if is_concert else video_dir / artist
        target_dir.mkdir(parents=True, exist_ok=True)

        safe_title = sanitize_folder_name(title) or sanitize_folder_name(stem)
        target_file = target_dir / f"{safe_title}{video_file.suffix.lower()}"
        if target_file.exists() and target_file.resolve() != video_file.resolve():
            target_file = target_dir / f"{safe_title}_{int(time.time())}{video_file.suffix.lower()}"

        shutil.move(str(video_file), str(target_file))

        # Déplacer aussi la miniature compagnon éventuelle (.jpg, .png, .webp)
        for img_ext in [".jpg", ".png", ".webp"]:
            companion = video_file.with_suffix(img_ext)
            if companion.exists() and companion.is_file():
                comp_dest = target_dir / f"{safe_title}{img_ext}"
                try:
                    shutil.move(str(companion), str(comp_dest))
                except Exception:
                    pass

        tag_video_file(target_file, artist, title)
        video_indexer.invalidate_cache()

        dispatch_video_notification(
            "orange",
            "Rangement concert" if is_concert else "Rangement clip vidéo",
            f"'{title}' rangé sous '{artist}{'/Concerts' if is_concert else ''}'"
        )
        return target_file
    except Exception as e:
        logger.error(f"Erreur routage vidéo vers vidéothèque pour '{video_file.name}': {e}", exc_info=True)
        return None

def heal_imports_folder(
    library_dir: Path,
    notify_cb: Optional[Callable[[str, str, str], None]] = None
) -> int:
    """
    Scanne le sas '_imports' à la racine de la collection.
    Lit les métadonnées de chaque fichier audio ou vidéo.
    - Les vidéos sont immédiatement redirigées vers la Vidéothèque (Clips ou Concerts selon durée/mots-clés).
    - Les fichiers audio sont classés proprement vers 'Artiste / Album / XX - Titre.ext'.
    Isole les fichiers non-médias éventuels dans '_imports/_Hors_Analyse',
    nettoie les dossiers vides, et supprime '_imports' une fois vidé.
    """
    imports_dir = library_dir / "_imports"
    if not imports_dir.is_dir():
        return 0

    actions_count = 0
    video_items: List[Path] = []
    audio_items: List[Path] = []
    other_items: List[Path] = []

    for root, dirs, files in os.walk(str(imports_dir)):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d.lower() != "_hors_analyse"]
        for f in files:
            p = Path(root) / f
            if not _is_file_accessible(p):
                continue
            ext = p.suffix.lower()
            if ext in VIDEO_EXTENSIONS:
                if is_real_video_file(p):
                    video_items.append(p)
                else:
                    audio_items.append(p)
            elif ext in AUDIO_EXTENSIONS:
                audio_items.append(p)
            elif ext in IMAGE_EXTENSIONS or ext in {".lrc", ".cue", ".m3u", ".m3u8"}:
                pass
            else:
                other_items.append(p)

    # 1. Rangement immédiat des vidéos vers la Vidéothèque locale (clips ou concerts)
    for vf in video_items:
        if _sync_stop_requested.is_set():
            break
        dest = route_video_to_videotheque(vf)
        if dest:
            actions_count += 1

    if not audio_items and not video_items:
        _cleanup_empty_dirs(imports_dir)
        safe_clean_empty_artist_dir(imports_dir)
        return actions_count

    groups: Dict[Tuple[str, str], List[Tuple[Path, dict]]] = {}
    for af in audio_items:
        try:
            meta = get_track_metadata(af)
            artist = clean_artist_name(meta.get("album_artist") or meta.get("artist") or "")
            raw_alb = meta.get("raw_album", "").strip()
            album = raw_alb or meta.get("album", "").strip()
            if album.lower() in {"inconnu", "unknown", "album inconnu", "singles & rips", "singles and rips"}:
                album = ""

            rel_parts = af.relative_to(imports_dir).parts
            if not artist or artist.lower() in {"inconnu", "unknown", "artiste inconnu"}:
                if len(rel_parts) >= 3:
                    artist = clean_artist_name(rel_parts[0])
                    if not album:
                        album = rel_parts[1]
                elif len(rel_parts) == 2:
                    folder_name = rel_parts[0]
                    if " - " in folder_name:
                        sp = folder_name.split(" - ", 1)
                        artist = clean_artist_name(sp[0].strip())
                        if not album:
                            album = sp[1].strip()
                    else:
                        parts = af.stem.split(" - ", 1)
                        if len(parts) == 2 and len(parts[0].strip()) > 1:
                            artist = clean_artist_name(parts[0].strip())
                        else:
                            artist = clean_artist_name(folder_name)
                else:
                    parts = af.stem.split(" - ", 1)
                    if len(parts) == 2 and len(parts[0].strip()) > 1:
                        artist = clean_artist_name(parts[0].strip())
                    else:
                        artist = "Artiste inconnu"

            if not album:
                if len(rel_parts) >= 3:
                    album = rel_parts[1]
                elif len(rel_parts) == 2:
                    folder_name = rel_parts[0]
                    if " - " in folder_name:
                        sp = folder_name.split(" - ", 1)
                        album = sp[1].strip()
                    else:
                        album = folder_name
                else:
                    album = "Singles & Rips"

            key = (artist, album)
            if key not in groups:
                groups[key] = []
            groups[key].append((af, meta))
        except Exception as e:
            logger.warning(f"Erreur métadonnées import '{af.name}': {e}")

    for (artist, album), file_tuples in groups.items():
        if _sync_stop_requested.is_set():
            break
        try:
            safe_artist = sanitize_name(artist)
            safe_album = sanitize_name(album)
            target_album_dir = library_dir / safe_artist / safe_album
            target_album_dir.mkdir(parents=True, exist_ok=True)

            moved_in_group = 0
            for src_file, meta in file_tuples:
                if _sync_stop_requested.is_set():
                    break
                track_num_str = meta.get("track_number", "")
                m_num = re.match(r"^(\d+)", str(track_num_str).strip())
                track_num = int(m_num.group(1)) if m_num else None

                raw_title = meta.get("title", "").strip() or src_file.stem
                clean_title = clean_track_title(raw_title)

                ext = src_file.suffix.lower()
                if track_num and track_num > 0:
                    dest_filename = f"{track_num:02d} - {sanitize_name(clean_title)}{ext}"
                else:
                    dest_filename = f"{sanitize_name(clean_title)}{ext}"

                dest_file_path = target_album_dir / dest_filename
                if dest_file_path.exists() and dest_file_path.resolve() != src_file.resolve():
                    dest_filename = f"{src_file.stem}_1{ext}"
                    dest_file_path = target_album_dir / dest_filename

                if src_file.resolve() != dest_file_path.resolve():
                    shutil.move(str(src_file), str(dest_file_path))
                    moved_in_group += 1

            for src_file, _ in file_tuples:
                src_parent = src_file.parent
                if src_parent.exists() and src_parent != library_dir and src_parent != imports_dir:
                    for cand in list(src_parent.iterdir()):
                        if cand.is_file():
                            c_ext = cand.suffix.lower()
                            if c_ext in IMAGE_EXTENSIONS:
                                target_cover = target_album_dir / "cover.jpg"
                                if not target_cover.exists():
                                    try:
                                        shutil.move(str(cand), str(target_cover))
                                    except Exception:
                                        pass
                                else:
                                    try:
                                        cand.unlink(missing_ok=True)
                                    except Exception:
                                        pass
                            elif c_ext in {".lrc", ".cue", ".m3u", ".m3u8"}:
                                target_aux = target_album_dir / cand.name
                                if not target_aux.exists():
                                    try:
                                        shutil.move(str(cand), str(target_aux))
                                    except Exception:
                                        pass

            consolidate_album_cover(target_album_dir)

            # Priorité absolue : intégration instantanée de l'album dans l'indexeur (~2ms)
            try:
                library_indexer.add_or_update_album(target_album_dir)
            except Exception as e:
                logger.debug(f"Erreur indexation immédiate album {target_album_dir.name}: {e}")

            if moved_in_group > 0:
                actions_count += 1
                msg = f"⚡ Import prioritaire : {moved_in_group} piste(s) intégrée(s) dans '{artist} / {album}'"
                logger.info(msg)
                if notify_cb:
                    notify_cb("green", msg, str(target_album_dir))

        except Exception as e:
            logger.error(f"Erreur classement groupe import '{artist} / {album}': {e}", exc_info=True)

    if other_items:
        quarantine_dir = imports_dir / "_Hors_Analyse"
        quarantine_dir.mkdir(parents=True, exist_ok=True)
        for non_media in other_items:
            try:
                if non_media.exists() and non_media.is_file():
                    dest_q = quarantine_dir / non_media.name
                    if not dest_q.exists():
                        shutil.move(str(non_media), str(dest_q))
            except Exception:
                pass

    _cleanup_empty_dirs(imports_dir)
    safe_clean_empty_artist_dir(imports_dir)

    # Déclencher le rafraîchissement immédiat de l'interface dès la fin de l'import prioritaire
    if actions_count > 0 and _global_library_updated_callback:
        try:
            _global_library_updated_callback()
        except Exception as e:
            logger.debug(f"Erreur callback mise à jour immédiate post-import: {e}")

    return actions_count

def heal_loose_tracks(
    library_dir: Path,
    notify_cb: Optional[Callable[[str, str, str], None]] = None
) -> int:

    """
    Détecte et range automatiquement les fichiers audio orphelins (déposés en vrac
    à la racine de la collection ou dans un dossier d'artiste sans sous-dossier album).
    """
    if not library_dir.is_dir():
        return 0

    actions_count = 0
    loose_files: List[Path] = []

    # 1. Pistes situées directement à la racine de la collection
    for item in library_dir.iterdir():
        if item.is_file() and item.suffix.lower() in AUDIO_EXTENSIONS:
            if _is_file_accessible(item):
                loose_files.append(item)

    # 2. Pistes situées directement dans un dossier d'artiste de niveau 1 (sans dossier album)
    for artist_dir in library_dir.iterdir():
        if artist_dir.is_dir() and not artist_dir.name.startswith("."):
            for item in artist_dir.iterdir():
                if item.is_file() and item.suffix.lower() in AUDIO_EXTENSIONS:
                    if _is_file_accessible(item):
                        loose_files.append(item)

    if not loose_files:
        return 0

    # Grouper les pistes par (Artiste, Album)
    groups: Dict[Tuple[str, str], List[Tuple[Path, dict]]] = {}
    for f in loose_files:
        try:
            meta = get_track_metadata(f)
            artist = clean_artist_name(meta.get("album_artist") or meta.get("artist") or "")
            album = meta.get("album", "").strip()

            # Replis intelligents si métadonnées absentes
            if not artist or artist.lower() in {"inconnu", "unknown", "artiste inconnu"}:
                if f.parent != library_dir and f.parent.name:
                    artist = clean_artist_name(f.parent.name)
                else:
                    # Tenter d'extraire depuis 'Artiste - Titre'
                    parts = f.stem.split(" - ", 1)
                    if len(parts) == 2 and len(parts[0].strip()) > 1:
                        artist = clean_artist_name(parts[0].strip())
                    else:
                        artist = "Artiste inconnu"

            if not album or album.lower() in {"inconnu", "unknown", "album inconnu"}:
                album = "Singles & Rips"

            key = (artist, album)
            if key not in groups:
                groups[key] = []
            groups[key].append((f, meta))
        except Exception as e:
            logger.warning(f"Erreur lecture métadonnées de piste orpheline '{f.name}': {e}")

    # Rangement physique pour chaque groupe
    for (artist, album), file_tuples in groups.items():
        if _sync_stop_requested.is_set():
            logger.info("heal_loose_tracks : arrêt propre demandé à un point sûr.")
            break
        try:
            safe_artist = sanitize_name(artist)
            safe_album = sanitize_name(album)
            target_album_dir = library_dir / safe_artist / safe_album
            target_album_dir.mkdir(parents=True, exist_ok=True)

            moved_count = 0
            for src_file, meta in file_tuples:
                if _sync_stop_requested.is_set():
                    logger.info("heal_loose_tracks : arrêt propre entre deux pistes.")
                    break
                track_num_str = meta.get("track_number", "")
                m_num = re.match(r"^(\d+)", str(track_num_str).strip())
                track_num = int(m_num.group(1)) if m_num else None

                raw_title = meta.get("title", "").strip() or src_file.stem
                clean_title = clean_track_title(raw_title)

                ext = src_file.suffix.lower()
                if track_num and track_num > 0:
                    dest_filename = f"{track_num:02d} - {sanitize_name(clean_title)}{ext}"
                else:
                    dest_filename = f"{sanitize_name(clean_title)}{ext}"

                dest_file_path = target_album_dir / dest_filename
                
                # Éviter d'écraser un fichier existant si collision
                if dest_file_path.exists() and dest_file_path.resolve() != src_file.resolve():
                    dest_filename = f"{src_file.stem}_1{ext}"
                    dest_file_path = target_album_dir / dest_filename

                if src_file.resolve() != dest_file_path.resolve():
                    shutil.move(str(src_file), str(dest_file_path))
                    moved_count += 1

            # Chercher si une image de pochette était présente aux côtés des fichiers orphelins
            for src_file, _ in file_tuples:
                for img_ext in [".jpg", ".jpeg", ".png", ".webp"]:
                    for img_name in ["cover", "folder", "front", src_file.stem]:
                        cand = src_file.parent / f"{img_name}{img_ext}"
                        if cand.exists() and cand.is_file() and not (target_album_dir / "cover.jpg").exists():
                            try:
                                shutil.copy2(str(cand), str(target_album_dir / "cover.jpg"))
                            except Exception:
                                pass

            # Consolider la pochette de l'album
            consolidate_album_cover(target_album_dir)

            if moved_count > 0:
                actions_count += 1
                msg = f"📁 Rangement automatique : {moved_count} piste(s) orpheline(s) classée(s) dans '{artist} / {album}'"
                logger.info(msg)
                if notify_cb:
                    notify_cb("orange", msg, str(target_album_dir))

        except Exception as e:
            logger.error(f"Erreur lors du rangement des pistes orphelines ({artist} - {album}) : {e}", exc_info=True)

    return actions_count

def heal_misplaced_albums(
    library_dir: Path,
    notify_cb: Optional[Callable[[str, str, str], None]] = None
) -> int:
    """
    Analyse les dossiers d'albums et détecte si le dossier parent d'artiste
    ne correspond pas à l'artiste issu des tags audio (ex: Renaud sous Francis Cabrel).
    Si discordance, déplace l'album vers le dossier d'artiste conforme.
    """
    if not library_dir.is_dir():
        return 0

    actions_count = 0

    # Dictionnaire mémoire instantané des albums déjà indexés pour éviter tout I/O disque
    known_map = {str(Path(a.path).resolve()).lower(): a for a in library_indexer.albums}

    # Parcourir les dossiers de niveau 1 (dossiers artistes supposés)
    for artist_dir in list(library_dir.iterdir()):
        if _sync_stop_requested.is_set():
            logger.info("heal_misplaced_albums : arrêt propre demandé.")
            break
        if not artist_dir.is_dir() or artist_dir.name.startswith(".") or artist_dir.name.lower() == "_imports":
            continue

        parent_artist_name = artist_dir.name.strip()

        # Parcourir les sous-dossiers de cet artiste (dossiers albums)
        for album_dir in list(artist_dir.iterdir()):
            if _sync_stop_requested.is_set():
                break
            if not album_dir.is_dir() or album_dir.name.startswith("."):
                continue

            # Fast-path instantané (< 0.01ms) via l'indexothèque en mémoire :
            # Si l'album est déjà indexé et que son artiste correspond au dossier parent,
            # on évite complètement d'ouvrir et lire les tags audio sur le disque Google Drive.
            alb_key = str(album_dir.resolve()).lower()
            indexed = known_map.get(alb_key)
            if indexed and indexed.artist:
                norm_parent = normalize_text(parent_artist_name)
                norm_indexed = normalize_text(clean_artist_name(indexed.artist))
                if norm_parent.replace(" ", "") == norm_indexed.replace(" ", ""):
                    continue

            # Trouver des fichiers audio
            audio_files = [f for f in album_dir.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS]
            if not audio_files:
                # Vérifier sous-dossiers CD 1, CD 2...
                for sub in album_dir.iterdir():
                    if sub.is_dir() and DISC_SUBFOLDER_RE.match(sub.name):
                        audio_files.extend([f for f in sub.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS])

            if not audio_files:
                continue

            # Échantillonner 3 fichiers audio pour identifier l'artiste réel
            sample_artists = []
            sample_albums = []
            for af in audio_files[:3]:
                try:
                    meta = get_track_metadata(af)
                    art = clean_artist_name(meta.get("album_artist") or meta.get("artist") or "")
                    alb = meta.get("album", "").strip()
                    if art:
                        sample_artists.append(art)
                    if alb:
                        sample_albums.append(alb)
                except Exception:
                    pass

            if not sample_artists:
                continue

            tag_artist = max(set(sample_artists), key=sample_artists.count)
            tag_album = max(set(sample_albums), key=sample_albums.count) if sample_albums else album_dir.name

            # Si l'artiste du dossier parent diverge de l'artiste des tags
            norm_parent = normalize_text(parent_artist_name)
            norm_tag = normalize_text(tag_artist)

            # Tolérance ponctuation / espaces sans slash (ex: 'ACDC' vs 'AC/DC')
            if norm_parent.replace(" ", "") == norm_tag.replace(" ", ""):
                continue

            if norm_tag in {"artiste inconnu", "inconnu", "unknown", "unknown artist"}:
                continue

            if norm_tag and norm_parent != norm_tag:
                # Éviter les faux-positifs 'Various Artists' pour les compilations multi-artistes
                if len(set(sample_artists)) > 1 and norm_parent in {"compilations", "various artists", "divers"}:
                    continue

                safe_tag_artist = sanitize_name(tag_artist)
                target_artist_dir = library_dir / safe_tag_artist
                target_album_dir = target_artist_dir / album_dir.name

                try:
                    target_artist_dir.mkdir(parents=True, exist_ok=True)

                    # Si le dossier de destination existe déjà (fusion d'albums)
                    if target_album_dir.exists() and target_album_dir.resolve() != album_dir.resolve():
                        # Déplacer fichier par fichier
                        for f in album_dir.iterdir():
                            dest_f = target_album_dir / f.name
                            if not dest_f.exists():
                                shutil.move(str(f), str(dest_f))
                        shutil.rmtree(str(album_dir), ignore_errors=True)
                    else:
                        shutil.move(str(album_dir), str(target_album_dir))

                    # Nettoyer l'ancien dossier artiste s'il est désormais vide
                    safe_clean_empty_artist_dir(artist_dir)


                    actions_count += 1
                    msg = f"🔄 Réalignement : '{album_dir.name}' replacé sous '{tag_artist}' (au lieu de '{parent_artist_name}')"
                    logger.info(msg)
                    if notify_cb:
                        notify_cb("orange", msg, str(target_album_dir))

                except Exception as e:
                    logger.error(f"Erreur déplacement album mal placé '{album_dir.name}': {e}", exc_info=True)

    return actions_count

def heal_misnamed_albums(
    library_dir: Path,
    notify_cb: Optional[Callable[[str, str, str], None]] = None
) -> int:
    """
    Harmonise le nom du dossier de l'album s'il diverge du tag 'album' des pistes.
    Ex: dossier 'Renaud - Morgane' renommé en 'Morgane de toi'.
    """
    if not library_dir.is_dir():
        return 0

    actions_count = 0

    # Dictionnaire mémoire instantané des albums déjà indexés pour éviter tout I/O disque
    known_map = {str(Path(a.path).resolve()).lower(): a for a in library_indexer.albums}

    for artist_dir in library_dir.iterdir():
        if _sync_stop_requested.is_set():
            logger.info("heal_misnamed_albums : arrêt propre demandé.")
            break
        if not artist_dir.is_dir() or artist_dir.name.startswith(".") or artist_dir.name.lower() == "_imports":
            continue

        for album_dir in artist_dir.iterdir():
            if _sync_stop_requested.is_set():
                break
            if not album_dir.is_dir() or album_dir.name.startswith("."):
                continue

            # Fast-path instantané (< 0.01ms) via l'indexothèque en mémoire :
            alb_key = str(album_dir.resolve()).lower()
            indexed = known_map.get(alb_key)
            if indexed and indexed.album:
                safe_alb = sanitize_name(indexed.album)
                if safe_alb and album_dir.name == safe_alb:
                    continue

            audio_files = [f for f in album_dir.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS]
            if not audio_files:
                for sub in album_dir.iterdir():
                    if sub.is_dir() and DISC_SUBFOLDER_RE.match(sub.name):
                        audio_files.extend([f for f in sub.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS])

            if not audio_files:
                continue

            sample_albums = []
            for af in audio_files[:3]:
                try:
                    meta = get_track_metadata(af)
                    alb = meta.get("album", "").strip()
                    if alb and alb.lower() not in {"singles & rips", "inconnu", "unknown album"}:
                        sample_albums.append(alb)
                except Exception:
                    pass

            if not sample_albums:
                continue

            tag_album = max(set(sample_albums), key=sample_albums.count)
            safe_album_name = sanitize_name(tag_album)

            # Si le nom du dossier est différent du tag album (en ignorant majuscules/minuscules strictes si équivalents)
            if safe_album_name and album_dir.name != safe_album_name:
                # Si le nom du dossier commence par "Artiste - " (format ancien pollué), le nettoyer
                norm_dir = normalize_text(album_dir.name)
                norm_tag = normalize_text(safe_album_name)

                # Si le dossier a une discordance réelle (ex: préfixé Artiste - Album dans un dossier artiste)
                should_rename = False
                if " - " in album_dir.name:
                    p = album_dir.name.split(" - ", 1)
                    if normalize_text(p[0].strip()) == normalize_text(artist_dir.name):
                        should_rename = True
                elif norm_dir != norm_tag:
                    should_rename = True

                if should_rename:
                    target_path = album_dir.parent / safe_album_name
                    if not target_path.exists():
                        try:
                            album_dir.rename(target_path)
                            actions_count += 1
                            msg = f"✏️ Harmonisation : Dossier renommé en '{safe_album_name}' (au lieu de '{album_dir.name}')"
                            logger.info(msg)
                            if notify_cb:
                                notify_cb("orange", msg, str(target_path))
                        except Exception as e:
                            logger.warning(f"Impossible de renommer le dossier '{album_dir.name}' vers '{safe_album_name}': {e}")

    return actions_count

def heal_album_covers(
    library_dir: Path,
    notify_cb: Optional[Callable[[str, str, str], None]] = None
) -> int:
    """
    Phase 5 : Analyse et normalisation des jaquettes d'albums en plein carré 1:1 (Full Bleed).
    Élimine les bandes latérales pillarbox (issues des rips YouTube) et réinjecte
    l'image 1:1 dans les tags audio pour un affichage propre sur CloudBeats et les lecteurs mobiles.
    Grâce au fichier marqueur '.cover_normalized', cette passe est quasi-instantanée (< 5ms)
    sur les albums déjà traités.
    """
    if not library_dir.is_dir():
        return 0

    healed_count = 0
    try:
        with os.scandir(str(library_dir)) as it_artists:
            for artist_entry in it_artists:
                if _sync_stop_requested.is_set():
                    break
                if not artist_entry.is_dir() or artist_entry.name.startswith(".") or artist_entry.name.lower() == "_imports":
                    continue

                try:
                    with os.scandir(artist_entry.path) as it_albums:
                        for album_entry in it_albums:
                            if _sync_stop_requested.is_set():
                                break
                            if not album_entry.is_dir() or album_entry.name.startswith("."):
                                continue

                            album_dir = Path(album_entry.path)
                            cov = album_dir / "cover.jpg"
                            if not cov.exists():
                                cov_alt = album_dir / "folder.jpg"
                                if cov_alt.exists():
                                    cov = cov_alt

                            marker = album_dir / ".cover_normalized"
                            if cov.exists() and marker.exists():
                                try:
                                    if marker.stat().st_mtime >= cov.stat().st_mtime:
                                        continue
                                except Exception:
                                    pass

                            if not cov.exists():
                                try:
                                    cov_str = consolidate_album_cover(album_dir)
                                    if cov_str:
                                        cov = Path(cov_str)
                                except Exception:
                                    continue

                            if cov.exists():
                                try:
                                    if normalize_cover_artwork(cov, embed_in_tracks=True):
                                        healed_count += 1
                                        if notify_cb:
                                            notify_cb("orange", f"🖼️ Pochette 1:1 plein carré normalisée : {album_dir.name}", str(album_dir))
                                except Exception as err:
                                    logger.debug(f"Erreur heal_album_covers pour '{album_dir.name}': {err}")

                except Exception as err:
                    logger.debug(f"Erreur scan albums pour '{artist_entry.name}': {err}")

    except Exception as e:
        logger.warning(f"Erreur lors de la phase heal_album_covers: {e}")

    return healed_count

def heal_misplaced_videos(
    library_dir: Path,
    notify_cb: Optional[Callable[[str, str, str], None]] = None
) -> int:
    """
    Rapatrie automatiquement les fichiers vidéo qui auraient été déposés ou classés
    par erreur dans la bibliothèque audio (notamment sous 'Singles & Rips' ou à la racine d'un artiste)
    vers la Vidéothèque locale (clips ou concerts selon durée/mots-clés).
    """
    if not library_dir.is_dir():
        return 0

    actions_count = 0
    # Scanne tous les fichiers de la bibliothèque musicale
    for root, dirs, files in os.walk(str(library_dir)):
        if _sync_stop_requested.is_set():
            break
        dirs[:] = [d for d in dirs if not d.startswith(".") and d.lower() not in {"_hors_analyse", "_imports", "previews", "cache", ".cache"}]
        for f in files:
            p = Path(root) / f
            ext = p.suffix.lower()
            if ext in VIDEO_EXTENSIONS and is_real_video_file(p):
                try:
                    rel = p.relative_to(library_dir)
                    artist_hint = None
                    if len(rel.parts) >= 2 and rel.parts[0].lower() not in {"singles & rips", "temp", "_imports"}:
                        artist_hint = rel.parts[0]

                    dest = route_video_to_videotheque(p, preferred_artist=artist_hint)
                    if dest:
                        actions_count += 1
                        msg = f"🎬 Rapatriement vidéo vers la Vidéothèque : '{p.name}' rangé dans '{dest.parent.name}'"
                        logger.info(msg)
                        if notify_cb:
                            notify_cb("orange", msg, str(dest))

                        # Nettoyer le dossier parent s'il est devenu vide (ex: Singles & Rips vidé)
                        parent = p.parent
                        try:
                            if parent != library_dir and not any(parent.iterdir()):
                                parent.rmdir()
                        except Exception:
                            pass
                except Exception as err:
                    logger.debug(f"Erreur rapatriement vidéo {p.name}: {err}")

    if actions_count > 0:
        video_indexer.invalidate_cache()
    return actions_count

def synchronize_collection(
    library_dir: Optional[str | Path] = None,
    notify_cb: Optional[Callable[[str, str, str], None]] = None,
    is_automatic: bool = False
) -> dict:
    """
    Exécute le cycle complet d'analyse, harmonisation et auto-réparation de la collection.
    Émet les événements oranges au fur et à mesure et l'événement vert final (sauf en veille automatique si 0 action).
    """
    global _global_event_callback
    eff_notify = notify_cb or _global_event_callback

    target_dir = Path(library_dir) if library_dir else (Path(config.library_dir) if config.library_dir else None)
    if not target_dir or not target_dir.is_dir():
        return {"status": "skipped", "reason": "no_library_dir", "actions_count": 0}

    # Empêcher les synchronisations concurrentes sur le même répertoire
    if not _sync_lock.acquire(blocking=False):
        logger.debug("Synchronisation déjà en cours, passe ignorée.")
        return {"status": "in_progress", "actions_count": 0}

    _sync_stop_requested.clear()
    total_actions = 0
    start_time = time.perf_counter()
    global _last_clean_sync_signature

    if _global_status_callback:
        try:
            _global_status_callback(True, "music_sync", "Collection Musique", f"Analyse & auto-organisation de {target_dir.name}...")
        except Exception:
            pass

    try:
        # ── Optimisation Phase 125 : empreinte de structure ──────────────────────────
        # En mode automatique, si la structure des dossiers artiste/album n'a pas changé
        # depuis le dernier sync propre, on saute les phases heal_* coûteuses (qui lisent
        # les tags audio) et on ne fait qu'un scan incrémental ultra-rapide.
        # En mode manuel (bouton Synchroniser), on force toujours le cycle complet.
        current_fingerprint = _compute_structure_fingerprint(target_dir)
        structure_unchanged = (
            is_automatic
            and current_fingerprint is not None
            and _last_clean_sync_signature is not None
            and current_fingerprint == _last_clean_sync_signature
        )

        if structure_unchanged:
            logger.debug("Sync auto : structure inchangée — phases heal skippées, scan incrémental uniquement.")
            # Phase 4 légère : nettoyer les dossiers artistes vides (stat() only, rapide)
            total_actions += heal_empty_artist_dirs(target_dir)
        else:
            # Phase 0 : Rangement et intégration immédiate du sas _imports
            total_actions += heal_imports_folder(target_dir, eff_notify)
            if _sync_stop_requested.is_set():
                logger.info("🛑 Arrêt propre LibrarySync validé après Phase 0 (_imports).")
                return {"status": "interrupted_cleanly", "actions_count": total_actions}

            # Phase 0.5 : Rapatriement automatique des vidéos égarées dans la collection audio vers la Vidéothèque
            total_actions += heal_misplaced_videos(target_dir, eff_notify)
            if _sync_stop_requested.is_set():
                logger.info("🛑 Arrêt propre LibrarySync validé après Phase 0.5 (vidéos).")
                return {"status": "interrupted_cleanly", "actions_count": total_actions}

            # Phase 1 : Rangement des pistes orphelines (en vrac)
            total_actions += heal_loose_tracks(target_dir, eff_notify)
            if _sync_stop_requested.is_set():
                logger.info("🛑 Arrêt propre LibrarySync validé après Phase 1.")
                return {"status": "interrupted_cleanly", "actions_count": total_actions}

            # Phase 2 : Réalignement des dossiers d'albums mal placés
            total_actions += heal_misplaced_albums(target_dir, eff_notify)
            if _sync_stop_requested.is_set():
                logger.info("🛑 Arrêt propre LibrarySync validé après Phase 2.")
                return {"status": "interrupted_cleanly", "actions_count": total_actions}

            # Phase 3 : Harmonisation des noms de dossiers d'albums
            total_actions += heal_misnamed_albums(target_dir, eff_notify)
            if _sync_stop_requested.is_set():
                logger.info("🛑 Arrêt propre LibrarySync validé après Phase 3.")
                return {"status": "interrupted_cleanly", "actions_count": total_actions}

            # Phase 4 : Nettoyage automatique des dossiers artistes orphelins ou vides
            total_actions += heal_empty_artist_dirs(target_dir)

            # Phase 5 : Normalisation plein carré 1:1 des jaquettes (anti-pillarbox)
            total_actions += heal_album_covers(target_dir, eff_notify)
            if _sync_stop_requested.is_set():
                logger.info("🛑 Arrêt propre LibrarySync validé après Phase 5.")
                return {"status": "interrupted_cleanly", "actions_count": total_actions}

        # Mémoriser la signature si le cycle complet n'a généré aucune action
        if total_actions == 0 and current_fingerprint is not None:
            _last_clean_sync_signature = current_fingerprint
            _save_persisted_fingerprint(current_fingerprint)
        elif total_actions > 0:
            # La structure a changé (heals ont agi) → invalider la signature pour forcer le prochain cycle complet
            _last_clean_sync_signature = None
            _save_persisted_fingerprint(None)

        # Mesurer l'état avant réconciliation
        prev_albums_count = len(library_indexer.albums)

        # Si l'arrêt n'a pas été demandé, mettre à jour l'index incrémentalement.
        # Phase 125 : on utilise force=False — le scan incrémental est désormais fiable
        # (vérifie mtime AVANT de lire les fichiers audio → quasi-instantané si rien n'a changé).
        # Les phases heal_* précédentes ont déjà déplacé/renommé les dossiers concernés,
        # ce qui met à jour leur mtime → ils seront correctement re-scannés.
        if not _sync_stop_requested.is_set():
            library_indexer.scan(force=False, custom_dir=str(target_dir))
            if _global_library_updated_callback:
                try:
                    _global_library_updated_callback()
                except Exception as e:
                    logger.debug(f"Erreur callback _global_library_updated_callback: {e}")

        new_albums_count = len(library_indexer.albums)
        duration = time.perf_counter() - start_time
        logger.info(f"Synchronisation de la collection terminée : {total_actions} action(s) menée(s), {new_albums_count} albums indexés en {duration:.2f}s.")

        # Notification finale verte (silencieuse en mode automatique si aucune modification physique ni action requise)
        if eff_notify:
            if total_actions > 0:
                final_msg = f"Collection 100% synchronisée : {total_actions} élément(s) remis en ordre conforme aux tags !"
                eff_notify("green", final_msg, str(target_dir))
            elif new_albums_count != prev_albums_count:
                diff = new_albums_count - prev_albums_count
                if diff > 0:
                    final_msg = f"Collection actualisée : +{diff} nouvel(s) album(s) détecté(s) ({new_albums_count} au total)"
                else:
                    final_msg = f"Collection actualisée : {abs(diff)} album(s) retiré(s) ({new_albums_count} au total)"
                eff_notify("green", final_msg, str(target_dir))
            elif not is_automatic:
                final_msg = f"Collection 100% synchronisée : Tous les dossiers et fichiers sont conformes ({new_albums_count} albums)"
                eff_notify("green", final_msg, str(target_dir))

        return {
            "status": "success",
            "actions_count": total_actions,
            "albums_count": new_albums_count,
            "duration_seconds": round(duration, 2),
            "library_dir": str(target_dir)
        }

    except Exception as e:
        logger.error(f"Erreur durant la synchronisation de collection : {e}", exc_info=True)
        return {"status": "error", "error": str(e), "actions_count": total_actions}
    finally:
        _sync_stop_requested.clear()
        _sync_lock.release()
        if _global_status_callback:
            try:
                _global_status_callback(False, "music_sync", "Collection Musique", "Synchronisation terminée")
            except Exception:
                pass

class LibraryWatcher(threading.Thread):
    """
    Moniteur d'arrière-plan silencieux et basse consommation (0% CPU).
    Surveille périodiquement les modifications externes sur le répertoire de collection
    en comparant les signatures de surface des fichiers audio (taille, mtime) et de la structure de dossiers,
    sans être perturbé par les timestamps mtime volatils des dossiers modifiés par Windows/Google Drive.
    """
    def __init__(self, check_interval: float = 2.0):
        super().__init__(name="LibraryWatcherThread", daemon=True)
        self.check_interval = check_interval
        self._running = True
        self._last_signature: Optional[Tuple] = None

    def stop(self):
        self._running = False

    def compute_signature(self, target_dir: Path) -> Optional[Tuple]:
        """
        Calcule une signature légère de surface (< 4ms) sans ouvrir les tags audio :
        - Dossiers : simple nom de structure (l'évolution du mtime dossier est ignorée pour éliminer les faux positifs).
        - Fichiers audio : nom, taille et mtime réel (à tous les niveaux : racine, artiste, album et sous-dossiers disque).
        """
        if not target_dir.is_dir():
            return None
        entries = []
        try:
            with os.scandir(str(target_dir)) as it:
                for entry in it:
                    if entry.name.startswith("."):
                        continue
                    try:
                        if entry.is_dir():
                            entries.append((entry.name, "", 1, 0, 0))
                            with os.scandir(entry.path) as sub_it:
                                for sub in sub_it:
                                    if sub.name.startswith("."):
                                        continue
                                    try:
                                        if sub.is_dir():
                                            entries.append((entry.name, sub.name, 1, 0, 0))
                                            with os.scandir(sub.path) as album_it:
                                                for item in album_it:
                                                    if item.name.startswith("."):
                                                        continue
                                                    try:
                                                        if item.is_file():
                                                            if Path(item.name).suffix.lower() in AUDIO_EXTENSIONS:
                                                                ist = item.stat()
                                                                entries.append((entry.name, f"{sub.name}/{item.name}", 0, round(ist.st_mtime), ist.st_size))
                                                        elif item.is_dir():
                                                            entries.append((entry.name, f"{sub.name}/{item.name}", 1, 0, 0))
                                                            with os.scandir(item.path) as disc_it:
                                                                for d_item in disc_it:
                                                                    if not d_item.name.startswith(".") and d_item.is_file():
                                                                        if Path(d_item.name).suffix.lower() in AUDIO_EXTENSIONS:
                                                                            dst = d_item.stat()
                                                                            entries.append((entry.name, f"{sub.name}/{item.name}/{d_item.name}", 0, round(dst.st_mtime), dst.st_size))
                                                    except Exception:
                                                        pass
                                        elif sub.is_file():
                                            if Path(sub.name).suffix.lower() in AUDIO_EXTENSIONS:
                                                sub_st = sub.stat()
                                                entries.append((entry.name, sub.name, 0, round(sub_st.st_mtime), sub_st.st_size))
                                    except Exception:
                                        pass
                        elif entry.is_file():
                            if Path(entry.name).suffix.lower() in AUDIO_EXTENSIONS:
                                st = entry.stat()
                                entries.append((entry.name, "", 0, round(st.st_mtime), st.st_size))
                    except Exception:
                        pass
        except Exception:
            return None
        entries.sort()
        return tuple(entries)

    def run(self):
        logger.info(f"Démarrage du moniteur d'arrière-plan de collection (intervalle: {self.check_interval}s).")
        # Attendre 2 secondes au démarrage initial pour laisser le serveur et l'indexation s'initialiser
        time.sleep(2.0)

        stable_cycles = 0
        while self._running:
            try:
                lib_dir = config.library_dir
                if lib_dir and os.path.isdir(lib_dir):
                    target_path = Path(lib_dir)
                    sig = self.compute_signature(target_path)

                    if self._last_signature is None:
                        self._last_signature = sig
                        stable_cycles = 0
                        # Réconciliation proactive au démarrage : vérifier si des fichiers ont été ajoutés/supprimés hors ligne.
                        # Phase 125 : on utilise force=False — le scan incrémental détecte les vrais changements via mtime,
                        # sans relire les fichiers audio des albums inchangés → quasi-instantané si rien n'a changé.
                        prev_cnt = len(library_indexer.albums)
                        scan_res = library_indexer.scan(force=False, custom_dir=str(target_path))
                        new_cnt = scan_res.get("albums_count", len(library_indexer.albums))
                        if new_cnt != prev_cnt:
                            logger.info(f"Réconciliation hors-ligne au démarrage : {prev_cnt} -> {new_cnt} album(s).")
                            if _global_library_updated_callback:
                                try:
                                    _global_library_updated_callback()
                                except Exception:
                                    pass
                        # Exécuter aussi une vérification d'auto-organisation silencieuse si nécessaire
                        synchronize_collection(target_path, is_automatic=True)
                        self._last_signature = self.compute_signature(target_path)
                    elif sig != self._last_signature:
                        stable_cycles = 0
                        is_deletion = bool(self._last_signature and len(sig) < len(self._last_signature))
                        logger.info(f"Changement détecté dans la collection musicale (suppression={is_deletion})...")
                        if not is_deletion:
                            time.sleep(1.2)
                        else:
                            time.sleep(0.1)

                        res = synchronize_collection(target_path, is_automatic=True)
                        if res.get("status") != "in_progress":
                            self._last_signature = self.compute_signature(target_path)
                    else:
                        stable_cycles += 1
                else:
                    stable_cycles += 1

            except Exception as e:
                logger.debug(f"Exception dans LibraryWatcher: {e}")

            # Rythme adaptatif éco-responsable (évite le matraquage disque en cas d'inactivité de 1h-2h) :
            if stable_cycles > 60:
                current_interval = 30.0
            elif stable_cycles > 30:
                current_interval = 15.0
            elif stable_cycles > 10:
                current_interval = 5.0
            else:
                current_interval = self.check_interval

            # Veille non bloquante par tranches de 0.5s pour réactivité à l'arrêt
            sleep_slices = max(1, int(current_interval / 0.5))
            for _ in range(sleep_slices):
                if not self._running:
                    break
                time.sleep(0.5)

# Instance singleton du moniteur
library_watcher = LibraryWatcher()

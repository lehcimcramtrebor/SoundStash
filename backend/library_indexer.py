import os
import re
import json
import time
import shutil
import struct
import unicodedata
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple
from pydantic import BaseModel

from backend.config import config, TEMP_DOWNLOAD_DIR, CONFIG_DIR
from backend.logger import get_logger

logger = get_logger(__name__)

ID3_GENRES = [
    'Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop',
    'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock',
    'Techno', 'Industrial', 'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack',
    'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance',
    'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise',
    'AlternRock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop',
    'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial', 'Electronic',
    'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta', 'Top 40',
    'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave',
    'Psychadelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz',
    'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock'
]

def clean_genre_str(g: Optional[str]) -> Optional[str]:
    """Nettoie une chaîne de genre ou convertit un identifiant numérique ID3."""
    if not g:
        return None
    g = g.strip().strip('\x00')
    m = re.match(r'^\(?(\d+)\)?$', g)
    if m:
        idx = int(m.group(1))
        if idx < len(ID3_GENRES):
            return ID3_GENRES[idx]
    return g if g else None

def parse_duration_to_seconds(dur_val: Any) -> Optional[int]:
    """Convertit une durée (int, float, 'M:SS', 'H:MM:SS') en secondes entières."""
    if dur_val is None:
        return None
    if isinstance(dur_val, (int, float)):
        return int(round(dur_val))
    if isinstance(dur_val, str):
        parts = dur_val.strip().split(":")
        try:
            if len(parts) == 2:
                return int(parts[0]) * 60 + int(parts[1])
            if len(parts) == 3:
                return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        except (ValueError, TypeError):
            pass
    return None

def extract_audio_tags_fast(filepath: Path) -> dict:
    """
    Extrait ultra-rapidement (< 2ms) l'ensemble des tags audio réels directement
    depuis un fichier audio (MP4/M4A, MP3 ID3v2, FLAC, OGG/OPUS) sans sous-processus.
    Retourne : {'artist': str, 'album': str, 'year': str, 'genre': str, 'title': str, 'duration': str, 'duration_sec': Optional[int]}
    """
    meta = {'artist': '', 'album': '', 'year': '', 'genre': '', 'title': '', 'duration': '', 'duration_sec': None}
    try:
        p = Path(filepath)
        if not p.is_file():
            return meta
        with open(p, 'rb') as f:
            hdr = f.read(16)
            if len(hdr) < 12:
                return meta

            # MP4 / M4A / AAC
            if hdr[4:8] == b'ftyp':
                f.seek(0, 2)
                file_sz = f.tell()
                f.seek(0)
                data = f.read(min(file_sz, 1024 * 1024))
                if file_sz > 1024 * 1024:
                    tail_sz = min(file_sz, 2 * 1024 * 1024)
                    f.seek(file_sz - tail_sz)
                    data += f.read(tail_sz)

                atom_map = [
                    (b'aART', 'artist'),
                    (b'\xa9ART', 'artist'),
                    (b'\xa9alb', 'album'),
                    (b'\xa9day', 'year'),
                    (b'\xa9nam', 'title'),
                    (b'\xa9gen', 'genre')
                ]
                for atom_key, field in atom_map:
                    if meta[field]:
                        continue
                    idx = data.find(atom_key)
                    if idx != -1:
                        d_idx = data.find(b'data', idx)
                        if d_idx != -1 and d_idx - idx < 40:
                            asz = struct.unpack('>I', data[d_idx-4:d_idx])[0]
                            if asz > 16:
                                raw = data[d_idx+12 : d_idx-4+asz].decode('utf-8', errors='replace').strip()
                                if raw:
                                    if field == 'year':
                                        m = re.search(r'\b(19\d\d|20\d\d)\b', raw)
                                        if m:
                                            meta[field] = m.group(1)
                                        else:
                                            meta[field] = raw[:4]
                                    elif field == 'genre':
                                        meta[field] = clean_genre_str(raw) or ""
                                    else:
                                        meta[field] = raw

                if not meta['genre']:
                    idx2 = data.find(b'gnre')
                    if idx2 != -1:
                        d_idx2 = data.find(b'data', idx2)
                        if d_idx2 != -1 and d_idx2 - idx2 < 40:
                            code = struct.unpack('>H', data[d_idx2+12:d_idx2+14])[0]
                            if code > 0:
                                meta['genre'] = clean_genre_str(str(code - 1)) or ""

                # Extraction ultra-rapide de la durée MP4/M4A via l'atome mvhd
                idx_m = data.find(b'mvhd')
                if idx_m != -1:
                    v = data[idx_m + 4]
                    if v == 0 and len(data) >= idx_m + 24:
                        ts, dur = struct.unpack('>II', data[idx_m + 16 : idx_m + 24])
                        if ts > 0:
                            sec = int(round(dur / ts))
                            meta['duration_sec'] = sec
                            m, s = divmod(sec, 60)
                            meta['duration'] = f"{m}:{s:02d}"
                    elif v == 1 and len(data) >= idx_m + 36:
                        ts = struct.unpack('>I', data[idx_m + 24 : idx_m + 28])[0]
                        dur = struct.unpack('>Q', data[idx_m + 28 : idx_m + 36])[0]
                        if ts > 0:
                            sec = int(round(dur / ts))
                            meta['duration_sec'] = sec
                            m, s = divmod(sec, 60)
                            meta['duration'] = f"{m}:{s:02d}"

            # MP3 (ID3v2)
            elif hdr[:3] == b'ID3':
                f.seek(0)
                id3_hdr = f.read(10)
                tag_sz = ((id3_hdr[6] & 0x7f) << 21) | ((id3_hdr[7] & 0x7f) << 14) | ((id3_hdr[8] & 0x7f) << 7) | (id3_hdr[9] & 0x7f)
                data = f.read(min(tag_sz, 2 * 1024 * 1024))

                def _read_frame(fr_id: bytes) -> str:
                    idx = data.find(fr_id)
                    if idx != -1:
                        fsz = struct.unpack('>I', data[idx+4:idx+8])[0]
                        payload = data[idx+10 : idx+10+fsz]
                        if payload:
                            enc = payload[0]
                            raw = payload[1:]
                            try:
                                if enc == 1:
                                    s = raw.decode('utf-16', errors='replace')
                                elif enc == 2:
                                    s = raw.decode('utf-16-be', errors='replace')
                                elif enc == 3:
                                    s = raw.decode('utf-8', errors='replace')
                                else:
                                    s = raw.decode('latin-1', errors='replace')
                                return s.strip('\x00').strip()
                            except Exception:
                                pass
                    return ''

                meta['artist'] = _read_frame(b'TPE2') or _read_frame(b'TPE1')
                meta['album'] = _read_frame(b'TALB')
                meta['title'] = _read_frame(b'TIT2')
                y_raw = _read_frame(b'TDRC') or _read_frame(b'TYER')
                if y_raw:
                    m = re.search(r'\b(19\d\d|20\d\d)\b', y_raw)
                    meta['year'] = m.group(1) if m else y_raw[:4]
                meta['genre'] = clean_genre_str(_read_frame(b'TCON')) or ""

                tlen_str = _read_frame(b'TLEN')
                if tlen_str and tlen_str.isdigit():
                    sec = int(round(int(tlen_str) / 1000))
                    meta['duration_sec'] = sec
                    m, s = divmod(sec, 60)
                    meta['duration'] = f"{m}:{s:02d}"

            # FLAC
            elif hdr[:4] == b'fLaC':
                try:
                    f.seek(4)
                    blk_hdr = f.read(4)
                    if blk_hdr and (blk_hdr[0] & 0x7F) == 0:
                        streaminfo = f.read(34)
                        if len(streaminfo) >= 18:
                            b = streaminfo[10:18]
                            sr = (b[0] << 12) | (b[1] << 4) | (b[2] >> 4)
                            total_samples = ((b[3] & 0x0F) << 32) | (b[4] << 24) | (b[5] << 16) | (b[6] << 8) | b[7]
                            if sr > 0 and total_samples > 0:
                                sec = int(round(total_samples / sr))
                                meta['duration_sec'] = sec
                                m, s = divmod(sec, 60)
                                meta['duration'] = f"{m}:{s:02d}"
                except Exception:
                    pass
                f.seek(0)
                data = f.read(128 * 1024)
                for line in data.split(b'\n'):
                    if b'=' in line:
                        k, v = line.split(b'=', 1)
                        k_s = k.decode('utf-8', errors='ignore').strip().lower()
                        v_s = v.decode('utf-8', errors='replace').strip('\x00').strip()
                        if k_s in ('albumartist', 'album artist', 'artist') and not meta['artist']:
                            meta['artist'] = v_s
                        elif k_s == 'album' and not meta['album']:
                            meta['album'] = v_s
                        elif k_s in ('date', 'year') and not meta['year']:
                            m = re.search(r'\b(19\d\d|20\d\d)\b', v_s)
                            meta['year'] = m.group(1) if m else v_s[:4]
                        elif k_s == 'genre' and not meta['genre']:
                            meta['genre'] = clean_genre_str(v_s) or ""
                        elif k_s == 'title' and not meta['title']:
                            meta['title'] = v_s

            # OGG / OPUS
            elif hdr[:4] == b'OggS':
                f.seek(0)
                data = f.read(64 * 1024)
                for line in data.split(b'\n'):
                    if b'=' in line:
                        k, v = line.split(b'=', 1)
                        k_s = k.decode('utf-8', errors='ignore').strip().lower()
                        v_s = v.decode('utf-8', errors='replace').strip('\x00').strip()
                        if k_s in ('albumartist', 'album artist', 'artist') and not meta['artist']:
                            meta['artist'] = v_s
                        elif k_s == 'album' and not meta['album']:
                            meta['album'] = v_s
                        elif k_s in ('date', 'year') and not meta['year']:
                            m = re.search(r'\b(19\d\d|20\d\d)\b', v_s)
                            meta['year'] = m.group(1) if m else v_s[:4]
                        elif k_s == 'genre' and not meta['genre']:
                            meta['genre'] = clean_genre_str(v_s) or ""
                        elif k_s == 'title' and not meta['title']:
                            meta['title'] = v_s

        if meta['duration_sec'] is None:
            try:
                from backend.tagger import get_audio_duration_fast
                dur_fast = get_audio_duration_fast(p)
                if dur_fast:
                    meta['duration'] = dur_fast
                    meta['duration_sec'] = parse_duration_to_seconds(dur_fast)
            except Exception:
                pass
    except Exception:
        pass
    return meta

def extract_album_tags_priority(folder: Path, audio_files: List[Path]) -> dict:
    """
    Extrait les métadonnées d'un album avec priorité absolue selon la demande utilisateur :
    1. .album_meta.json si présent avec tags valides
    2. Tags audio réels extraits des premières pistes audio (avec consensus pour éviter les intros/guests)
    """
    result = {"artist": "", "album": "", "year": "", "genre": ""}

    # 1. Vérifier .album_meta.json
    meta_json = folder / ".album_meta.json"
    if meta_json.is_file():
        try:
            with open(meta_json, "r", encoding="utf-8") as mf:
                md = json.load(mf)
                art = (md.get("artist") or md.get("album_artist") or "").strip()
                alb = (md.get("album") or md.get("title") or "").strip()
                yr = str(md.get("year") or "").strip()
                gnr = (md.get("genre") or "").strip()
                if art and art.lower() not in {"inconnu", "unknown", "artiste inconnu"}:
                    result["artist"] = art
                if alb and alb.lower() not in {"inconnu", "unknown", "unknown album", "sans titre"}:
                    result["album"] = alb
                if yr:
                    result["year"] = yr
                if gnr:
                    result["genre"] = gnr
                if result["artist"] and result["album"]:
                    return result
        except Exception:
            pass

    # 2. Inspecter les premières pistes audio pour consensus
    artists_found = []
    albums_found = []
    years_found = []
    genres_found = []

    for af in audio_files[:4]:
        p = Path(af)
        if not p.is_file():
            continue
        tags = extract_audio_tags_fast(p)
        art = (tags.get("artist") or "").strip()
        alb = (tags.get("album") or "").strip()
        yr = (tags.get("year") or "").strip()
        gnr = (tags.get("genre") or "").strip()

        if art and art.lower() not in {"inconnu", "unknown", "artiste inconnu"}:
            artists_found.append(art)
        if alb and alb.lower() not in {"inconnu", "unknown", "unknown album", "sans titre"}:
            albums_found.append(alb)
        if yr and not result["year"]:
            years_found.append(yr)
        if gnr and not result["genre"]:
            genres_found.append(gnr)

    parent_artist = folder.parent.name if folder.parent and folder.parent.name else ""
    folder_name = folder.name

    if artists_found:
        # Si un des artistes trouvés correspond au dossier parent (ex: Root / Metallica / Album) ou au dossier d'album
        matched_art = None
        for a in artists_found:
            if parent_artist and (a.lower() == parent_artist.lower() or parent_artist.lower() in a.lower()):
                matched_art = a
                break
            if folder_name and a.lower() in folder_name.lower():
                matched_art = a
                break
        if matched_art:
            result["artist"] = matched_art
        else:
            # Artiste majoritaire parmi les pistes inspectées
            result["artist"] = max(set(artists_found), key=artists_found.count)

    if albums_found:
        result["album"] = max(set(albums_found), key=albums_found.count)
    if years_found:
        result["year"] = max(set(years_found), key=years_found.count)
    if genres_found:
        result["genre"] = max(set(genres_found), key=genres_found.count)

    return result

def extract_audio_genre_fast(filepath: Path) -> Optional[str]:
    """Extrait ultra-rapidement le genre depuis un fichier audio."""
    tags = extract_audio_tags_fast(filepath)
    return tags.get("genre") or None

AUDIO_EXTENSIONS = {".mp3", ".m4a", ".flac", ".ogg", ".opus", ".aac", ".wma", ".wav", ".mp4", ".mkv", ".webm"}
COVER_NAMES = {"cover.jpg", "cover.png", "folder.jpg", "folder.png", "front.jpg", "front.png"}
DISC_SUBFOLDER_RE = re.compile(r'^(?:cd|disc|disque|part|volume|vol\.?)\s*[-_]?\s*(\d+)$', re.IGNORECASE)

EDITION_NOISE_PATTERNS = [
    r"\s*[\(\[][^\)\]]*(?:deluxe|remaster|anniversary|expanded|edition|version|reissue|re-issue|bonus|collector|legacy|box\s*set|soundtrack|ost)[^\)\]]*[\)\]]",
    r"\s*-\s*(?:deluxe|remastered|expanded|bonus|live|topic|th[eè]me).*$",
    r"\s*(?:[\-–—]\s*|\()(?:topic|th[eè]me)\)?\s*$",
    r"\s*[\(\[](?:explicit|clean|mono|stereo|bonus|single|ep|live(?:[\s@].+)?)[)\]]"
]

_WINDOWS_RESERVED = {'CON', 'PRN', 'AUX', 'NUL'} | {f'COM{i}' for i in range(1,10)} | {f'LPT{i}' for i in range(1,10)}

def sanitize_folder_name(name: str) -> str:
    """Remplace les caractères interdits pour les dossiers Windows."""
    sanitized = re.sub(r'[\\/*?:"<>|]', "_", str(name or "")).strip().rstrip('.')
    if sanitized.upper() in _WINDOWS_RESERVED:
        sanitized = f"_{sanitized}"
    return sanitized if sanitized else "Inconnu"

def normalize_text(text: Optional[str]) -> str:
    """
    Normalise une chaîne pour une comparaison tolérante :
    - Minuscules
    - Retrait des suffixes YouTube auto-générés (- Topic, - Thème)
    - Élagage des mentions d'éditions (Deluxe, 10th Anniversary, Remastered...)
    - Décomposition Unicode et suppression des accents (NFKD)
    - Remplacement des symboles (& -> and, + -> and)
    - Retrait des articles initiaux (the, les, le, la, l', un, une, der, die, das)
    - Suppression de la ponctuation et des caractères spéciaux
    - Compression des espaces multiples
    """
    if not text:
        return ""
    s = str(text).strip().lower()

    # Retrait préalable des suffixes topic / thème
    s = re.sub(r"\s*(?:[\-–—]\s*|\()(?:topic|th[eè]me)\)?\s*$", "", s, flags=re.IGNORECASE)

    # Élimination des mentions d'éditions entre parenthèses ou crochets AVANT décomposition
    orig_s = s
    for pat in EDITION_NOISE_PATTERNS:
        s = re.sub(pat, "", s, flags=re.IGNORECASE)

    # Si le nettoyage a tout vidé (ex: album nommé 'Super Deluxe'), on restaure la chaîne de base
    if not s.strip():
        s = orig_s

    # Remplacement des tirets et slashs par des espaces pour isoler les articles/titres
    s = s.replace("-", " ").replace("–", " ").replace("—", " ").replace("/", " ")
    s = s.replace("&", " and ").replace("+", " and ")

    # Suppression des accents (NFKD)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))

    # Retrait des articles initiaux courants
    s = re.sub(r"^(?:the|les?|la|l'|une?|un|der|die|das)\s+", "", s)

    # Suppression des caractères non-alphanumériques (sauf espaces)
    s = re.sub(r"[^a-z0-9\s]", " ", s)

    # Espaces multiples
    s = re.sub(r"\s+", " ", s).strip()
    return s

def calculate_token_similarity(s1: str, s2: str) -> float:
    """Calcule l'indice de Jaccard sur les ensembles de mots (Token Set Ratio) avec normalisation tolérante."""
    if not s1 or not s2:
        return 0.0
    norm1 = normalize_text(s1)
    norm2 = normalize_text(s2)
    if not norm1 or not norm2:
        return 0.0
    tokens1 = set(norm1.split())
    tokens2 = set(norm2.split())
    if not tokens1 or not tokens2:
        return 0.0
    intersection = tokens1.intersection(tokens2)
    union = tokens1.union(tokens2)
    return len(intersection) / len(union)

# Alias pour compatibilité
token_similarity = calculate_token_similarity

TRACK_VERSION_NOISE_PATTERNS = [
    r"\s*[\(\[][^\)\]]*(?:remix|mix|edit|version|extended|radio|club|instrumental|acoustic|live|vip|rework|dub|feat|ft\.|featuring|clean|explicit|bonus|remaster|deluxe|intro|outro|orchestral|slowed|speed|sped)[^\)\]]*[\)\]]",
    r"\s*-\s*(?:extended|radio|club|original|vip|dub|acoustic|instrumental|album|single)?\s*(?:mix|edit|remix|version|live|rework|instrumental|dub|vip).*$",
    r"\s*[\(\[][^\)\]]*[\)\]]$"
]

def extract_base_title(title: str) -> str:
    """
    Extrait la base brute d'un titre en retirant les numéros de piste et
    les mentions de version/éditions/remix pour la détection 'Autre version'.
    """
    if not title:
        return ""
    s = re.sub(r'^\d+\s*[-.]*\s*', '', str(title)).strip()
    orig = s
    for pat in TRACK_VERSION_NOISE_PATTERNS:
        s_sub = re.sub(pat, '', s, flags=re.IGNORECASE).strip()
        if len(s_sub) >= 2:
            s = s_sub
    norm = normalize_text(s)
    return norm if norm else normalize_text(orig)

LIVE_REGEX = re.compile(r'\b(?:live(?:\s+(?:at|in|from|version|session|acoustic|tour|20\d\d|19\d\d))?|concert|en\s+public|unplugged)\b', re.IGNORECASE)
INST_REGEX = re.compile(r'\b(?:instrumental|inst\b|karaoke|a\s*cappella|acapella)\b', re.IGNORECASE)
EXPLICIT_REGEX = re.compile(r'\b(?:explicit|dirty)\b', re.IGNORECASE)
CLEAN_REGEX = re.compile(r'\b(?:clean|radio\s*edit|censored)\b', re.IGNORECASE)

ALBUM_EDITION_WORDS = {
    "edition", "deluxe", "anniversary", "remaster", "remastered", "expanded",
    "special", "collector", "collectors", "version", "reissue", "bonus", "complete",
    "super", "box", "set", "vol", "volume", "lp", "cd", "explicit", "clean", "tour", "original"
}


class IndexedTrack(BaseModel):
    title: str = ""
    norm_title: str = ""
    base_title: str = ""
    duration_sec: Optional[int] = None
    duration_str: str = ""
    bitrate_kbps: Optional[int] = None
    filename: str = ""

class IndexedAlbum(BaseModel):
    path: str
    folder_name: str
    artist: str
    album: str
    year: Optional[str] = None
    genre: Optional[str] = None
    track_count: int = 0
    cover_file: Optional[str] = None
    mtime: float = 0.0
    norm_artist: str = ""
    norm_album: str = ""
    source: str = "library"  # "library", "export", "temp"
    tracks: List[IndexedTrack] = []

def extract_album_tracks_fast(folder: Path | str) -> List[IndexedTrack]:
    """
    Extrait ultra-rapidement les pistes d'un album avec titre, titre normalisé,
    durée en secondes et formatée (< 5ms par album) pour le croisement intelligent.
    """
    folder_p = Path(folder)
    if not folder_p.is_dir():
        return []

    audio_files: List[Path] = []
    try:
        disc_subnames = []
        for it in folder_p.iterdir():
            if it.is_file() and it.suffix.lower() in AUDIO_EXTENSIONS:
                audio_files.append(it)
            elif it.is_dir() and DISC_SUBFOLDER_RE.match(it.name):
                disc_subnames.append(it)

        disc_subnames.sort(key=lambda x: x.name.lower())
        for d in disc_subnames:
            for it in d.iterdir():
                if it.is_file() and it.suffix.lower() in AUDIO_EXTENSIONS:
                    audio_files.append(it)
    except Exception:
        return []

    if not audio_files:
        return []

    tracks: List[IndexedTrack] = []
    for f in audio_files:
        try:
            tags = extract_audio_tags_fast(f)
            tit = (tags.get("title") or "").strip()
            if not tit:
                from backend.tagger import parse_track_filename
                _, tit = parse_track_filename(f.name)
            if not tit:
                tit = f.stem

            dur_sec = tags.get("duration_sec")
            dur_str = tags.get("duration") or ""
            if dur_sec is None and dur_str:
                dur_sec = parse_duration_to_seconds(dur_str)
            elif dur_sec is not None and not dur_str:
                m, s = divmod(dur_sec, 60)
                dur_str = f"{m}:{s:02d}"

            clean_tit = re.sub(r'^\d+\s*[-.]*\s*', '', tit).strip()
            norm_tit = normalize_text(clean_tit)
            base_tit = extract_base_title(clean_tit) or norm_tit

            bitrate_kbps = None
            try:
                if dur_sec and dur_sec > 0:
                    sz = f.stat().st_size
                    bitrate_kbps = int((sz * 8) / (dur_sec * 1000))
            except Exception:
                pass

            tracks.append(IndexedTrack(
                title=tit,
                norm_title=norm_tit,
                base_title=base_tit,
                duration_sec=dur_sec,
                duration_str=dur_str,
                bitrate_kbps=bitrate_kbps,
                filename=f.name
            ))
        except Exception:
            pass

    return tracks


class LibraryIndexer:
    """
    Moteur d'indexation ultra-rapide et non-bloquant de la collection musicale.
    Maintient un cache mémoire et disque pour un temps de réponse de 0ms.
    """
    def __init__(self):
        self.cache_file = CONFIG_DIR / ".library_cache.json"
        self.albums: List[IndexedAlbum] = []
        self.artists_map: Dict[str, List[IndexedAlbum]] = {}
        self._tracks_by_title: Dict[str, List[Tuple[IndexedAlbum, IndexedTrack]]] = {}
        self._tracks_by_base: Dict[str, List[Tuple[IndexedAlbum, IndexedTrack]]] = {}
        self.is_scanning = False
        self.last_scanned_at: Optional[float] = None
        self._load_from_cache()

    def _load_from_cache(self):
        """Charge le cache disque si disponible."""
        # Migration automatique de l'ancien emplacement si présent dans TEMP_DOWNLOAD_DIR
        if not self.cache_file.exists():
            legacy_cache = TEMP_DOWNLOAD_DIR / ".library_cache.json"
            if legacy_cache.exists():
                try:
                    self.cache_file.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(legacy_cache, self.cache_file)
                    logger.info(f"Migration du cache bibliothèque depuis {legacy_cache} vers {self.cache_file}")
                except Exception as e:
                    logger.warning(f"Impossible de migrer l'ancien cache bibliothèque : {e}")

        if not self.cache_file.exists():
            return
        try:
            with open(self.cache_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.last_scanned_at = data.get("scanned_at")
            raw_albums = data.get("albums", [])
            import tempfile
            sys_temp = str(Path(tempfile.gettempdir()).resolve()).lower()
            valid_albums = []
            had_stale = False

            for item in raw_albums:
                p_str = item.get("path", "")
                if not p_str or not os.path.isdir(p_str):
                    had_stale = True
                    continue
                p_norm = str(Path(p_str).resolve()).lower()
                if p_norm.startswith(sys_temp) or "test_ytm" in p_norm:
                    had_stale = True
                    continue
                valid_albums.append(IndexedAlbum(**item))

            self.albums = valid_albums
            if had_stale:
                logger.info(f"Indexothèque : Nettoyage proactif de dossiers fantômes ou temporaires du cache ({len(raw_albums)} -> {len(self.albums)} albums).")
                self._save_to_cache()

            # Note : l'enrichissement automatique des genres au démarrage a été supprimé (Phase 125)
            # pour éviter les lectures disque à chaque lancement. Les genres sont désormais extraits
            # uniquement lors d'un scan explicite (quand le mtime d'un dossier a changé).

            self._rebuild_index()
            logger.info(f"Indexothèque : {len(self.albums)} albums rechargés depuis le cache (0ms).")
        except Exception as e:
            logger.warning(f"Erreur chargement cache bibliothèque : {e}")
            self.albums = []
            self._rebuild_index()

    def _save_to_cache(self):
        """Sauvegarde les albums indexés dans le fichier cache."""
        try:
            self.cache_file.parent.mkdir(parents=True, exist_ok=True)
            data = {
                "scanned_at": self.last_scanned_at,
                "albums": [a.dict() for a in self.albums]
            }
            with open(self.cache_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            logger.info(f"Cache de la collection persisté dans {self.cache_file} ({len(self.albums)} albums).")

            # Maintenir également synchronisé le cache AppData uniquement pour le cache officiel
            if self.cache_file.name == ".library_cache.json" and "tmp" not in str(self.cache_file).lower():
                appdata_cache = Path.home() / "AppData/Roaming/SoundStash/.library_cache.json"
                if self.cache_file.resolve() != appdata_cache.resolve() and appdata_cache.parent.exists():
                    try:
                        shutil.copy2(self.cache_file, appdata_cache)
                    except Exception:
                        pass
                local_cache = Path(".library_cache.json")
                if self.cache_file.resolve() != local_cache.resolve() and local_cache.parent.exists():
                    try:
                        shutil.copy2(self.cache_file, local_cache)
                    except Exception:
                        pass
        except Exception as e:
            logger.warning(f"Erreur écriture cache bibliothèque : {e}")

    def get_all_albums(self) -> List[IndexedAlbum]:
        """Retourne la liste complète des albums indexés."""
        return list(self.albums)

    def get_tag_suggestions(self) -> dict:
        """
        Génère un dictionnaire complet des tags de la collection musicale
        pour alimenter l'autocomplétion intelligente de l'Éditeur de tags :
        - Artistes uniques de la collection (casse originale préservée)
        - Albums uniques de la collection
        - Genres musicaux uniques
        - Années d'albums uniques
        - Table d'association Artiste -> Liste d'Albums
        """
        artists_set = set()
        albums_set = set()
        genres_set = set()
        years_set = set()
        artist_albums = {}
        album_details = {}

        for alb in self.albums:
            art = (getattr(alb, "artist", None) or "").strip()
            title = (getattr(alb, "album", None) or getattr(alb, "title", None) or "").strip()
            genre = (getattr(alb, "genre", None) or "").strip()
            year = (getattr(alb, "year", None) or "").strip()

            if art and art.lower() not in {"artiste inconnu", "unknown artist", "unknown", "na"}:
                artists_set.add(art)
                if art not in artist_albums:
                    artist_albums[art] = set()
                if title and title.lower() not in {"album inconnu", "unknown album", "singles & rips"}:
                    artist_albums[art].add(title)

            if title and title.lower() not in {"album inconnu", "unknown album", "singles & rips"}:
                albums_set.add(title)
                if art and title:
                    album_details[f"{art} - {title}".lower()] = {
                        "artist": art,
                        "album": title,
                        "year": year if re.match(r'^(?:19|20)\d{2}$', year) else "",
                        "genre": genre if genre.lower() not in {"inconnu", "unknown", "na"} else ""
                    }

            if genre and genre.lower() not in {"inconnu", "unknown", "na"}:
                genres_set.add(genre)

            if year and re.match(r'^(?:19|20)\d{2}$', year):
                years_set.add(year)

        common_genres = [
            "Variété française", "Chanson française", "Pop", "Pop Rock", "Rock",
            "Hard Rock", "Metal", "Heavy Metal", "Électronique", "Dance", "Electro",
            "Synthwave", "Disco", "Funk", "Soul", "R&B", "Hip-Hop", "Rap français",
            "Rap", "Jazz", "Blues", "Classique", "Reggae", "Folk", "Acoustique",
            "Bande originale", "Musiques du monde", "Ambiance"
        ]
        for g in common_genres:
            genres_set.add(g)

        sorted_artists = sorted(artists_set, key=lambda s: unicodedata.normalize('NFKD', s).lower())
        sorted_albums = sorted(albums_set, key=lambda s: unicodedata.normalize('NFKD', s).lower())
        sorted_genres = sorted(genres_set, key=lambda s: unicodedata.normalize('NFKD', s).lower())
        sorted_years = sorted(years_set, reverse=True)
        sorted_artist_map = {
            art: sorted(albs, key=lambda s: unicodedata.normalize('NFKD', s).lower())
            for art, albs in artist_albums.items()
        }

        return {
            "artists": sorted_artists,
            "albums": sorted_albums,
            "genres": sorted_genres,
            "years": sorted_years,
            "artist_albums": sorted_artist_map,
            "artist_albums_map": sorted_artist_map,
            "album_details": album_details,
            "total_collection_albums": len(self.albums)
        }

    def _rebuild_index(self):
        """Reconstruit la table de hachage par artiste et par titre de morceau (exact et base)."""
        self.artists_map.clear()
        self._tracks_by_title.clear()
        self._tracks_by_base.clear()
        for alb in self.albums:
            key = alb.norm_artist or "inconnu"
            if key not in self.artists_map:
                self.artists_map[key] = []
            self.artists_map[key].append(alb)

            for tr in getattr(alb, "tracks", []):
                if tr.norm_title:
                    if tr.norm_title not in self._tracks_by_title:
                        self._tracks_by_title[tr.norm_title] = []
                    self._tracks_by_title[tr.norm_title].append((alb, tr))

                base_t = getattr(tr, "base_title", None) or extract_base_title(tr.title or tr.norm_title)
                if base_t:
                    if base_t not in self._tracks_by_base:
                        self._tracks_by_base[base_t] = []
                    self._tracks_by_base[base_t].append((alb, tr))

    def ensure_tracks_indexed(self, force: bool = False):
        """S'assure que les morceaux de tous les albums sont extraits et indexés."""
        needs_save = False
        for alb in self.albums:
            if force or not getattr(alb, "tracks", None):
                p = Path(alb.path)
                if p.is_dir():
                    extracted = extract_album_tracks_fast(p)
                    if extracted:
                        alb.tracks = extracted
                        needs_save = True

        if needs_save:
            self._rebuild_index()
            self._save_to_cache()

    def get_track_candidates(self, norm_title: str, base_title: str = "") -> List[Tuple[IndexedAlbum, IndexedTrack]]:
        """
        Retourne tous les candidats de pistes correspondant au titre normalisé ou à la base de titre.
        Conserve l'ordre de priorité (titre exact d'abord, puis variantes de base).
        """
        if not norm_title and not base_title:
            return []

        seen = set()
        candidates: List[Tuple[IndexedAlbum, IndexedTrack]] = []

        def add_cands(cand_list):
            for alb, tr in cand_list:
                key = (alb.path, tr.filename or tr.title)
                if key not in seen:
                    seen.add(key)
                    candidates.append((alb, tr))

        # 1. Correspondance exacte sur titre normalisé
        if norm_title and norm_title in self._tracks_by_title:
            add_cands(self._tracks_by_title[norm_title])

        # 2. Correspondance sur base de titre (éditions / versions / variantes)
        if base_title and base_title in self._tracks_by_base:
            add_cands(self._tracks_by_base[base_title])

        # 3. Nettoyage de bruits d'éditions/versions ou de numéros de pistes en début de titre
        clean_t = re.sub(r'^\d+\s*[-.]*\s*', '', norm_title).strip()
        for pat in EDITION_NOISE_PATTERNS:
            clean_t = re.sub(pat, '', clean_t, flags=re.IGNORECASE).strip()

        if clean_t and clean_t in self._tracks_by_title:
            add_cands(self._tracks_by_title[clean_t])

        # 4. Tolérance sur sous-chaîne proche
        if len(norm_title) >= 4 and len(candidates) < 10:
            for k, tr_list in self._tracks_by_title.items():
                if len(k) >= 4 and (norm_title in k or k in norm_title):
                    ratio = min(len(norm_title), len(k)) / max(len(norm_title), len(k))
                    if ratio >= 0.70:
                        add_cands(tr_list)

        return candidates

    def scan(self, force: bool = False, custom_dir: Optional[str] = None, save_cache: bool = True) -> dict:
        """
        Scanne le dossier de bibliothèque maître (library_dir), le dossier d'exportation (export_dir)
        et le dossier temporaire (temp_download_dir) de manière incrémentale.
        Peut scanner un dossier spécifique si custom_dir est renseigné.
        """
        if self.is_scanning:
            return {"status": "already_scanning", "count": len(self.albums)}

        self.is_scanning = True
        start_time = time.perf_counter()

        try:
            # Vérifier si custom_dir est un dossier temporaire ou un dossier de test
            is_temp_scan = False
            if custom_dir:
                import tempfile
                try:
                    c_res = Path(custom_dir).resolve()
                    t_sys = Path(tempfile.gettempdir()).resolve()
                    if t_sys == c_res or t_sys in c_res.parents or "tmp" in c_res.name.lower():
                        is_temp_scan = True
                except Exception:
                    pass

            dirs_to_scan = []
            lib_p = Path(custom_dir) if (custom_dir and os.path.isdir(custom_dir)) else (Path(config.library_dir) if (config.library_dir and os.path.isdir(config.library_dir)) else None)
            if lib_p:
                dirs_to_scan.append((lib_p, "library"))

            if not custom_dir and config.export_dir and os.path.isdir(config.export_dir) and (not lib_p or str(lib_p.resolve()) != str(Path(config.export_dir).resolve())):
                dirs_to_scan.append((Path(config.export_dir), "export"))

            existing_cache: Dict[str, IndexedAlbum] = {a.path: a for a in self.albums} if not force else {}
            updated_albums: List[IndexedAlbum] = []

            for root_path, source in dirs_to_scan:
                self._scan_directory(root_path, source, existing_cache, updated_albums)

            # Toujours mettre a jour l'instance en memoire pour le caller
            self.albums = updated_albums
            self.last_scanned_at = time.time()
            self._rebuild_index()

            # Ne jamais ecraser le cache disque principal si c'est un scan temporaire / test
            can_save = save_cache and (not is_temp_scan or self.cache_file.name != ".library_cache.json")
            if can_save:
                self._save_to_cache()

            duration = time.perf_counter() - start_time
            count_scanned = len(self.albums)
            logger.info(f"Indexation terminée : {count_scanned} albums indexés en {duration:.2f}s (temp={is_temp_scan}).")
            return {
                "status": "success",
                "albums_count": len(self.albums),
                "artists_count": len(self.artists_map),
                "duration_seconds": round(duration, 2),
                "scanned_at": self.last_scanned_at
            }
        except Exception as e:
            logger.error(f"Erreur durant l'indexation de la collection : {e}", exc_info=True)
            return {"status": "error", "error": str(e), "albums_count": len(self.albums)}
        finally:
            self.is_scanning = False

    def _scan_directory(
        self,
        root_path: Path,
        source: str,
        existing_cache: Dict[str, IndexedAlbum],
        out_list: List[IndexedAlbum]
    ):
        """Scanne récursivement un répertoire pour identifier les dossiers d'albums."""
        try:
            for dirpath, dirnames, filenames in os.walk(str(root_path)):
                # Éviter les dossiers cachés et le sas d'import temporaire
                dirnames[:] = [d for d in dirnames if not d.startswith(".") and d.lower() != "_imports"]

                folder_p = Path(dirpath)
                audio_files = [f for f in filenames if Path(f).suffix.lower() in AUDIO_EXTENSIONS]

                # Détecter la présence éventuelle de sous-dossiers multi-disques (CD 1, CD 2, etc.)
                disc_subnames = [d for d in dirnames if DISC_SUBFOLDER_RE.match(d)]
                disc_audio_files = []
                if disc_subnames:
                    # Ne pas descendre dans les sous-dossiers de disques comme des albums séparés
                    dirnames[:] = [d for d in dirnames if not DISC_SUBFOLDER_RE.match(d)]
                    def _disc_k(d_name: str):
                        m = DISC_SUBFOLDER_RE.match(d_name)
                        return int(m.group(1)) if (m and m.group(1)) else 999
                    disc_subnames.sort(key=_disc_k)
                    for d_sub in disc_subnames:
                        ds_p = folder_p / d_sub
                        try:
                            for sf in os.listdir(ds_p):
                                if (ds_p / sf).is_file() and Path(sf).suffix.lower() in AUDIO_EXTENSIONS:
                                    disc_audio_files.append(ds_p / sf)
                        except Exception:
                            pass

                all_audio_count = len(audio_files) + len(disc_audio_files)
                if all_audio_count == 0:
                    continue

                mtime = folder_p.stat().st_mtime
                p_str = str(folder_p)

                # ── OPTIMISATION CRITIQUE : vérifier le cache mtime AVANT toute lecture disque ──
                # Pour les albums multi-disques, on prend le max(mtime dossier parent, sous-dossiers CDs)
                effective_mtime = mtime
                if disc_subnames:
                    for d_sub in disc_subnames:
                        try:
                            sub_mtime = (folder_p / d_sub).stat().st_mtime
                            if sub_mtime > effective_mtime:
                                effective_mtime = sub_mtime
                        except Exception:
                            pass

                if p_str in existing_cache and existing_cache[p_str].mtime == effective_mtime:
                    # Dossier inchangé : réutiliser le cache sans aucune lecture de fichier audio
                    cached_item = existing_cache[p_str]
                    cached_item.source = source
                    out_list.append(cached_item)
                    continue
                # ── FIN OPTIMISATION ──

                # Dossier nouveau ou modifié : extraire les tags audio réels
                all_audios = [(folder_p / f) for f in audio_files] + disc_audio_files
                tags_meta = extract_album_tags_priority(folder_p, all_audios)

                sample_audio = all_audios[0] if all_audios else None
                folder_artist, folder_album = self._infer_artist_album(folder_p, root_path, sample_audio)

                # Priorité tags réels sur nom de dossier
                artist = tags_meta.get("artist") or folder_artist
                album = tags_meta.get("album") or folder_album

                cover_file = None
                for cf in filenames:
                    if cf.lower() in COVER_NAMES:
                        cover_file = str(folder_p / cf)
                        break

                # Si pas de cover à la racine mais présent dans un sous-dossier CD
                if not cover_file and disc_subnames:
                    for d_sub in disc_subnames:
                        ds_p = folder_p / d_sub
                        try:
                            for cf in os.listdir(ds_p):
                                if cf.lower() in COVER_NAMES and (ds_p / cf).is_file():
                                    cover_file = str(ds_p / cf)
                                    break
                            if cover_file:
                                break
                        except Exception:
                            pass

                # Déduire l'année : priorité aux tags réels, sinon regex nom de dossier
                inferred_year = tags_meta.get("year")
                if not inferred_year:
                    year_m = re.search(r"[\(\[](\d{4})[\)\]]|\b(19\d\d|20\d\d)\b", folder_p.name)
                    if year_m:
                        inferred_year = year_m.group(1) or year_m.group(2)

                inferred_genre = tags_meta.get("genre")

                item_tracks = extract_album_tracks_fast(folder_p)
                item = IndexedAlbum(
                    path=p_str,
                    folder_name=folder_p.name,
                    artist=artist,
                    album=album,
                    year=inferred_year,
                    genre=inferred_genre,
                    track_count=all_audio_count,
                    cover_file=cover_file,
                    mtime=mtime,
                    norm_artist=normalize_text(artist),
                    norm_album=normalize_text(album),
                    source=source,
                    tracks=item_tracks
                )
                out_list.append(item)
        except Exception as e:
            logger.warning(f"Erreur scan dossier {root_path}: {e}")

    def _infer_artist_album(self, folder: Path, root: Path, sample_audio: Optional[Path] = None) -> Tuple[str, str]:
        """
        Déduit l'artiste et l'album en PRIORITÉ depuis les tags audio,
        puis depuis .album_meta.json, et en dernier recours depuis les noms de dossiers.
        """
        # 1. Priorité aux tags du premier fichier audio
        if sample_audio and sample_audio.is_file():
            tags = extract_audio_tags_fast(sample_audio)
            art = (tags.get("artist") or "").strip()
            alb = (tags.get("album") or "").strip()
            if art and alb and art.lower() not in {"inconnu", "unknown", "artiste inconnu"}:
                return art, alb

        # 2. Priorité aux métadonnées .album_meta.json
        meta_json = folder / ".album_meta.json"
        if meta_json.is_file():
            try:
                with open(meta_json, "r", encoding="utf-8") as mf:
                    md = json.load(mf)
                    art = (md.get("artist") or md.get("album_artist") or "").strip()
                    alb = (md.get("album") or md.get("title") or "").strip()
                    if art and alb and art.lower() not in {"inconnu", "unknown", "artiste inconnu"}:
                        return art, alb
            except Exception:
                pass

        # 3. Dernier recours : déduction depuis l'arborescence de dossiers
        rel = folder.relative_to(root)
        parts = rel.parts

        # Si le dossier analysé est lui-même un sous-dossier de disque (ex: Root / Artiste / Album / CD 1)
        if len(parts) >= 3 and DISC_SUBFOLDER_RE.match(folder.name):
            return parts[-3].strip(), parts[-2].strip()
        elif len(parts) == 2 and DISC_SUBFOLDER_RE.match(folder.name):
            return "Artiste inconnu", parts[-2].strip()

        if len(parts) >= 2:
            # Format classique: Root / Artiste / Album
            return parts[-2].strip(), parts[-1].strip()

        folder_name = folder.name
        # Format Artiste - Album
        if " - " in folder_name:
            sub = folder_name.split(" - ", 1)
            return sub[0].strip(), sub[1].strip()

        # Format Album seul ou dossier plat
        return "Artiste inconnu", folder_name.strip()

    def get_stats(self) -> dict:
        """Retourne les métriques globales de la bibliothèque."""
        return {
            "library_dir": config.library_dir,
            "export_dir": config.export_dir,
            "albums_count": len(self.albums),
            "artists_count": len(self.artists_map),
            "last_scanned_at": self.last_scanned_at,
            "is_scanning": self.is_scanning
        }

    def list_artists(self) -> List[dict]:
        """Retourne la liste ordonnée des artistes possédés avec leur nombre d'albums."""
        res = []
        for norm_art, albs in self.artists_map.items():
            if not albs:
                continue
            display_name = albs[0].artist
            res.append({
                "artist": display_name,
                "norm_artist": norm_art,
                "album_count": len(albs),
                "albums": [{"title": a.album, "path": a.path, "track_count": a.track_count, "source": a.source} for a in albs]
            })
        return sorted(res, key=lambda x: x["artist"].lower())

    def resolve_smart_export_path(
        self,
        artist_name: str,
        album_name: str,
        is_single: bool = False,
        is_playlist: bool = False,
        conflict_policy: str = "merge"
    ) -> dict:
        """
        Détermine intelligemment le chemin d'exportation optimal dans la bibliothèque musicale maître
        (library_dir) ou dans export_dir en repli.
        - Harmonise le nom du dossier d'artiste avec les artistes déjà présents dans la collection.
        - Détecte les conflits d'albums existants et applique la politique (merge / distinct / overwrite).
        - Gère les singles et playlists.
        """
        use_smart = bool(config.library_dir and os.path.isdir(config.library_dir) and getattr(config, "smart_export", True))
        base_dir_str = config.library_dir if use_smart else config.export_dir
        base_dir = Path(base_dir_str)

        clean_art = str(artist_name or "").strip()
        clean_art = re.sub(r"\s*(?:[\-–—]\s*|\()(?:topic|th[eè]me)\)?\s*$", "", clean_art, flags=re.IGNORECASE).strip()
        norm_art = normalize_text(clean_art)

        # 1. Résolution de l'artiste existant
        target_artist_name = sanitize_folder_name(clean_art) if clean_art else "Artiste Inconnu"
        matched_existing_artist = False
        existing_artist_dir = None

        if base_dir.exists() and norm_art:
            try:
                for item in base_dir.iterdir():
                    if item.is_dir() and not item.name.startswith("."):
                        item_norm = normalize_text(item.name)
                        if item_norm:
                            if item_norm == norm_art or calculate_token_similarity(item_norm, norm_art) >= 0.85:
                                target_artist_name = item.name
                                matched_existing_artist = True
                                existing_artist_dir = item
                                break
            except Exception as e:
                logger.warning(f"Erreur parcours dossiers artistes dans {base_dir}: {e}")

        # 2. Résolution du sous-dossier album / single / playlist
        clean_alb = str(album_name or "").strip()
        norm_alb = normalize_text(clean_alb)

        if is_playlist and (target_artist_name in {"Various Artists", "Artiste Inconnu"} or not clean_art):
            artist_folder = base_dir / "Various Artists"
            target_album_name = sanitize_folder_name(clean_alb) or "Playlist"
            dest_dir = artist_folder / target_album_name
        elif is_single:
            artist_folder = base_dir / target_artist_name
            singles_folder_name = "Singles & Rips"
            if existing_artist_dir and existing_artist_dir.exists():
                for sub in existing_artist_dir.iterdir():
                    if sub.is_dir() and sub.name.lower() in {"singles", "singles & rips", "singles and rips"}:
                        singles_folder_name = sub.name
                        break
            target_album_name = singles_folder_name
            dest_dir = artist_folder / singles_folder_name
        else:
            artist_folder = base_dir / target_artist_name
            target_album_name = sanitize_folder_name(clean_alb) or "Album"
            dest_dir = artist_folder / target_album_name

            # Vérifier si l'album existe déjà (par nom exact, normalisé ou similarité)
            existing_album_dir = None
            if existing_artist_dir and existing_artist_dir.exists():
                for sub in existing_artist_dir.iterdir():
                    if sub.is_dir() and not sub.name.startswith("."):
                        sub_norm = normalize_text(sub.name)
                        if sub_norm == norm_alb or sub.name.lower() == clean_alb.lower() or calculate_token_similarity(sub_norm, norm_alb) >= 0.90:
                            existing_album_dir = sub
                            target_album_name = sub.name
                            dest_dir = sub
                            break

        # 3. Gestion de conflit si le dossier de destination existe déjà
        conflict = False
        existing_tracks_count = 0
        if dest_dir.exists() and not is_single:
            try:
                existing_tracks = [f for f in dest_dir.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS]
                if existing_tracks:
                    conflict = True
                    existing_tracks_count = len(existing_tracks)
                    if conflict_policy == "distinct":
                        base_name = target_album_name
                        counter = 2
                        candidate_dest = artist_folder / f"{base_name} (YTM)"
                        while candidate_dest.exists():
                            candidate_dest = artist_folder / f"{base_name} (YTM {counter})"
                            counter += 1
                        dest_dir = candidate_dest
                        target_album_name = dest_dir.name
            except Exception:
                pass

        return {
            "is_smart": use_smart,
            "base_dir": str(base_dir),
            "dest_dir": str(dest_dir.resolve()) if dest_dir.parent.exists() else str(dest_dir),
            "artist_folder": target_artist_name,
            "matched_existing_artist": matched_existing_artist,
            "album_folder": target_album_name,
            "conflict": conflict,
            "existing_tracks_count": existing_tracks_count,
            "conflict_policy": conflict_policy
        }

    def add_or_update_album(self, album_path: Path | str) -> Optional[IndexedAlbum]:
        """
        Met à jour ou ajoute un album dans l'index en mémoire et sauvegarde le cache
        immédiatement de façon incrémentale (~2ms). Zéro latence !
        """
        p = Path(album_path)
        if not p.exists() or not p.is_dir():
            return None

        audio_files = []
        cover_file = None
        for f in p.iterdir():
            if f.is_file():
                if f.suffix.lower() in AUDIO_EXTENSIONS:
                    audio_files.append(f)
                elif f.name.lower() in COVER_NAMES and not cover_file:
                    cover_file = str(f)

        if not audio_files:
            return None

        # Priorité absolue aux tags audio réels et .album_meta.json
        tags_meta = extract_album_tags_priority(p, audio_files)

        folder_art = p.parent.name if p.parent != p else "Inconnu"
        folder_alb = p.name
        if " - " in folder_alb and folder_art in {"Inconnu", "_imports", "temp_downloads"}:
            parts = folder_alb.split(" - ", 1)
            folder_art = parts[0].strip()
            folder_alb = parts[1].strip()

        artist_name = tags_meta.get("artist") or folder_art
        album_name = tags_meta.get("album") or folder_alb

        inferred_year = tags_meta.get("year")
        if not inferred_year:
            year_m = re.search(r"[\(\[](\d{4})[\)\]]|\b(19\d\d|20\d\d)\b", album_name)
            if year_m:
                inferred_year = year_m.group(1) or year_m.group(2)

        inferred_genre = tags_meta.get("genre")

        norm_art = normalize_text(artist_name)
        norm_alb = normalize_text(album_name)

        indexed_tracks = extract_album_tracks_fast(p)
        indexed = IndexedAlbum(
            path=str(p.resolve()),
            folder_name=p.name,
            artist=artist_name,
            album=album_name,
            year=inferred_year,
            genre=inferred_genre,
            track_count=len(audio_files),
            cover_file=cover_file,
            mtime=p.stat().st_mtime,
            norm_artist=norm_art,
            norm_album=norm_alb,
            source="library",
            tracks=indexed_tracks
        )

        resolved_str = str(p.resolve())
        self.albums = [a for a in self.albums if str(Path(a.path).resolve()) != resolved_str]
        self.albums.append(indexed)
        self._rebuild_index()
        self._save_to_cache()
        logger.info(f"Indexothèque : Album mis à jour instantanément dans le cache -> {album_name} ({len(audio_files)} pistes)")
        return indexed

    def remove_album_by_path(self, album_path: Path | str):
        """Retire un album de l'index en mémoire et met à jour le cache disque."""
        try:
            target_str = str(Path(album_path).resolve())
            self.albums = [a for a in self.albums if str(Path(a.path).resolve()) != target_str]
            self._rebuild_index()
            self._save_to_cache()
            logger.info(f"Indexothèque : Ancien chemin d'album retiré du cache -> {album_path}")
        except Exception as e:
            logger.warning(f"Erreur suppression album du cache {album_path}: {e}")

    def update_album_genre(self, album_path: Path | str, new_genre: str):
        """Met à jour le genre d'un album en mémoire et dans le cache sans réindexation lourde."""
        try:
            norm_p = str(Path(album_path).resolve()).lower()
            updated = False
            for alb in self.albums:
                if str(Path(alb.path).resolve()).lower() == norm_p:
                    alb.genre = new_genre
                    try:
                        alb.mtime = Path(alb.path).stat().st_mtime
                    except Exception:
                        pass
                    updated = True
                    break
            if updated:
                self._save_to_cache()
                logger.info(f"Indexothèque : Genre mis à jour pour '{album_path}' -> {new_genre}")
        except Exception as e:
            logger.warning(f"Erreur mise à jour genre album {album_path}: {e}")

    def invalidate_cache(self):
        """Invalide le cache de la bibliothèque et force un re-scan."""
        try:
            if self.cache_file.exists():
                self.cache_file.unlink()
        except Exception:
            pass
        self.albums.clear()
        self.artists_map.clear()
        self.last_scanned_at = None
        self._save_to_cache()


class SmartMatcher:
    """
    Moteur de croisement et d'attribution de badges de statut :
    - 'downloading' : En cours de téléchargement
    - 'queued' : En file d'attente
    - 'temp' : Présent dans temp_downloads/
    - 'exported' : Présent dans le dossier d'export
    - 'owned_library' : Présent dans la collection personnelle
    """
    def __init__(self, indexer: LibraryIndexer):
        self.indexer = indexer

    @staticmethod
    def _normalize_url(u: Optional[str]) -> str:
        if not u:
            return ""
        clean = str(u).strip()
        # 1. Extraction ID de playlist YouTube si présent (ex: list=PLxyz...)
        if "list=" in clean:
            match = re.search(r"[?&]list=([a-zA-Z0-9_\-]+)", clean)
            if match:
                return f"playlist:{match.group(1)}"

        # 2. Extraction ID vidéo YouTube (watch?v=XYZ, youtu.be/XYZ, shorts/XYZ, embed/XYZ)
        if "watch?v=" in clean or "watch/" in clean:
            match = re.search(r"(?:[?&]v=|watch/)([a-zA-Z0-9_\-]+)", clean)
            if match:
                return f"video:{match.group(1)}"
        if "youtu.be/" in clean:
            match = re.search(r"youtu\.be/([a-zA-Z0-9_\-]+)", clean)
            if match:
                return f"video:{match.group(1)}"
        if "/shorts/" in clean:
            match = re.search(r"/shorts/([a-zA-Z0-9_\-]+)", clean)
            if match:
                return f"video:{match.group(1)}"

        # 3. Repli générique nettoyé
        clean = clean.lower().replace("https://", "").replace("http://", "").replace("www.", "").replace("music.", "")
        clean = clean.split("&")[0].split("#")[0].rstrip("/")
        return clean

    def match_item(
        self,
        title: str,
        artist: str = "",
        item_type: str = "album",
        url: Optional[str] = None,
        current_downloading_item: Optional[dict] = None,
        downloading_url_or_title: Optional[str] = None,
        queued_items: Optional[List[dict]] = None
    ) -> dict:
        """
        Détermine le statut d'un élément (recherche, discographie) par rapport au système.
        """
        norm_title = normalize_text(title)
        norm_art = normalize_text(artist)
        norm_item_url = self._normalize_url(url)

        # 1. Vérification téléchargement en cours / file d'attente
        if norm_item_url:
            # L'élément possède une URL YouTube canonique (résultat de recherche en ligne).
            # L'URL est le SEUL critère objectif et certain : deux vidéos différentes ou deux playlists
            # d'un même artiste ne doivent JAMAIS être confondues sous prétexte d'un titre similaire !

            # 1.1 Téléchargement en cours
            curr_url = None
            if isinstance(current_downloading_item, dict):
                curr_url = self._normalize_url(current_downloading_item.get("url"))
            elif downloading_url_or_title and ("youtube.com" in downloading_url_or_title or "youtu.be" in downloading_url_or_title):
                curr_url = self._normalize_url(downloading_url_or_title)

            if curr_url and curr_url == norm_item_url:
                return {"status": "downloading", "label": "⚡ En cours", "badge_class": "badge-status-downloading"}

            # 1.2 File d'attente
            if queued_items:
                for q in queued_items:
                    if isinstance(q, dict):
                        q_url = self._normalize_url(q.get("url"))
                        if q_url and q_url == norm_item_url:
                            return {"status": "queued", "label": "⏳ En file", "badge_class": "badge-status-queued"}

            # NOTA BENE : L'élément possède une URL et celle-ci ne correspond ni à la tâche en cours
            # ni aux tâches en file. Il n'est donc ni en cours ni en file.
            # On NE PASSE PAS au match par titre ci-dessous pour éviter de faux positifs entre vidéos
            # ayant des titres proches chez le même artiste (ex: synthwave compilations).
        else:
            # 2. Repli par titre/artiste UNIQUEMENT pour les éléments qui n'ont aucune URL
            curr_title = ""
            curr_art = ""
            if isinstance(current_downloading_item, dict):
                curr_title = current_downloading_item.get("title") or current_downloading_item.get("custom_album") or ""
                curr_art = current_downloading_item.get("custom_artist") or ""
            elif downloading_url_or_title and not ("youtube.com" in downloading_url_or_title or "youtu.be" in downloading_url_or_title):
                curr_title = downloading_url_or_title

            norm_down = normalize_text(curr_title)
            if norm_down and len(norm_down) >= 3 and norm_title and len(norm_title) >= 3:
                is_match = (norm_title == norm_down)
                if not is_match and calculate_token_similarity(norm_title, norm_down) >= 0.90:
                    is_match = True

                if is_match:
                    norm_curr_art = normalize_text(curr_art)
                    if not (norm_art and norm_curr_art and norm_art != norm_curr_art and calculate_token_similarity(norm_art, norm_curr_art) < 0.70):
                        return {"status": "downloading", "label": "⚡ En cours", "badge_class": "badge-status-downloading"}

            if queued_items and norm_title and len(norm_title) >= 3:
                for q in queued_items:
                    if not isinstance(q, dict):
                        continue
                    q_title_raw = q.get("title") or q.get("custom_album") or ""
                    q_title = normalize_text(q_title_raw)
                    if not q_title or len(q_title) < 3:
                        continue

                    is_match = (norm_title == q_title)
                    if not is_match and calculate_token_similarity(norm_title, q_title) >= 0.90:
                        is_match = True

                    if is_match:
                        q_art = normalize_text(q.get("custom_artist") or "")
                        if norm_art and q_art and norm_art != q_art and calculate_token_similarity(norm_art, q_art) < 0.70:
                            continue
                        return {"status": "queued", "label": "⏳ En file", "badge_class": "badge-status-queued"}


        # 3. Traitement spécialisé selon le type d'élément (Artiste / Piste / Vidéo)
        if item_type == "artist":
            art_name = title or artist
            n_art = normalize_text(art_name)
            if n_art:
                matched_albs = []
                if n_art in self.indexer.artists_map:
                    matched_albs = self.indexer.artists_map[n_art]
                else:
                    for k, albs in self.indexer.artists_map.items():
                        if k == n_art or (len(n_art) >= 4 and (k in n_art or n_art in k)) or calculate_token_similarity(n_art, k) >= 0.80:
                            matched_albs = albs
                            break
                if matched_albs:
                    count = len(matched_albs)
                    lbl = f"💿 {count} album{'s' if count > 1 else ''} dans votre collection"
                    return {
                        "status": "owned_library",
                        "label": lbl,
                        "badge_class": "badge-status-owned",
                        "local_path": matched_albs[0].path if matched_albs else None,
                        "matched_album": matched_albs[0].album if matched_albs else None
                    }
            return {"status": None, "label": None, "badge_class": None}

        if item_type in ("track", "video"):
            trk_match = self.match_track(title=title, duration_sec=None, artist=artist)
            if trk_match and trk_match.get("is_owned") and trk_match.get("match_status") in ("owned", "different_duration"):
                st = "temp" if trk_match.get("source") == "temp" else ("exported" if trk_match.get("source") == "export" else "owned_library")
                return {
                    "status": st,
                    "label": trk_match.get("badge_label") or "✓ Piste possédée",
                    "badge_class": trk_match.get("badge_class") or "badge-status-owned",
                    "local_path": trk_match.get("owned_path"),
                    "matched_album": trk_match.get("owned_album")
                }

        # 4. Vérification dans la bibliothèque indexée (Collection, Export) pour albums/playlists/fallback
        best_match = self._find_best_album_match(norm_art, norm_title)
        if best_match:
            source = best_match.source
            if source == "export":
                return {
                    "status": "exported",
                    "label": "💾 Exporté",
                    "badge_class": "badge-status-exported",
                    "local_path": best_match.path,
                    "matched_album": best_match.album
                }
            elif source == "library":
                return {
                    "status": "owned_library",
                    "label": "💿 Dans ma collection",
                    "badge_class": "badge-status-owned",
                    "local_path": best_match.path,
                    "matched_album": best_match.album
                }

        # 5. Vérification dans temp_downloads/
        temp_match = self._find_temp_match(norm_title, norm_art)
        if temp_match:
            return {
                "status": "temp",
                "label": "📁 Temporaire",
                "badge_class": "badge-status-temp",
                "local_path": str(temp_match)
            }

        return {"status": None, "label": None, "badge_class": None}

    def _find_best_album_match(self, norm_art: str, norm_title: str) -> Optional[IndexedAlbum]:
        """Recherche le meilleur album correspondant dans l'index."""
        if not norm_title:
            return None

        candidates = []
        seen_paths = set()

        # Stratégie 1 : Recherche de candidats par artiste (exact et variantes/collaborations)
        if norm_art:
            # Correspondance directe
            if norm_art in self.indexer.artists_map:
                for a in self.indexer.artists_map[norm_art]:
                    if a.path not in seen_paths:
                        seen_paths.add(a.path)
                        candidates.append(a)

            # Chercher si un artiste connu a une similarité forte ou contient l'artiste (ex: feat, multi-artistes)
            for k, albs in self.indexer.artists_map.items():
                if k == norm_art:
                    continue
                match_artist = False
                if (norm_art in k) or (len(k) >= 4 and k in norm_art):
                    match_artist = True
                elif calculate_token_similarity(norm_art, k) >= 0.70:
                    match_artist = True

                if match_artist:
                    for a in albs:
                        if a.path not in seen_paths:
                            seen_paths.add(a.path)
                            candidates.append(a)

        # Si pas de candidat par artiste, tester tous les albums
        if not candidates:
            candidates = self.indexer.albums

        best_album = None
        best_score = 0.0

        for alb in candidates:
            score = self._compute_similarity(norm_art, norm_title, alb)
            if score > best_score:
                best_score = score
                best_album = alb

        # Filet de sécurité : si aucun match probant (>= 0.80) n'a été trouvé parmi les candidats restreints,
        # tester l'ensemble de la bibliothèque (au cas où l'artiste en ligne diffère du tag local,
        # ex: Various Artists, multi-artistes ou nom de chaîne/groupe)
        if best_score < 0.80 and candidates is not self.indexer.albums:
            for alb in self.indexer.albums:
                if alb.path in seen_paths:
                    continue
                score = self._compute_similarity(norm_art, norm_title, alb)
                if score > best_score:
                    best_score = score
                    best_album = alb

        # Seuil de tolérance pour valider l'association
        if best_score >= 0.80:
            return best_album

        return None

    def _compute_similarity(self, norm_art: str, norm_title: str, alb: IndexedAlbum) -> float:
        """Calcule un score de similarité entre la requête et un album indexé."""
        is_art_match = (
            not norm_art
            or not alb.norm_artist
            or norm_art == alb.norm_artist
            or norm_art in alb.norm_artist
            or alb.norm_artist in norm_art
        )

        # Égalité exacte du titre
        if norm_title == alb.norm_album:
            if is_art_match:
                return 1.0
            art_sim = calculate_token_similarity(norm_art, alb.norm_artist)
            return max(0.85, 0.7 + (art_sim * 0.3))

        # Similarité avec nettoyage des mots d'éditions/rééditions non parenthésés
        tokens1 = set(norm_title.split())
        tokens2 = set(alb.norm_album.split())
        clean_t1 = tokens1 - ALBUM_EDITION_WORDS
        clean_t2 = tokens2 - ALBUM_EDITION_WORDS
        if clean_t1 and clean_t2:
            clean_sim = len(clean_t1 & clean_t2) / len(clean_t1 | clean_t2)
            if clean_sim >= 0.80 or (clean_t1 == clean_t2 and len(clean_t1) >= 1):
                if is_art_match:
                    return max(0.88, 0.75 + (clean_sim * 0.20))
                art_sim = calculate_token_similarity(norm_art, alb.norm_artist)
                if art_sim >= 0.70:
                    return (clean_sim * 0.7) + (art_sim * 0.3)

        # Inclusion préfixe ou sous-ensemble complet de mots quand l'artiste concorde
        if is_art_match and min(len(norm_title), len(alb.norm_album)) >= 4:
            if norm_title.startswith(alb.norm_album) or alb.norm_album.startswith(norm_title):
                diff_tokens = (tokens1 ^ tokens2) - ALBUM_EDITION_WORDS
                if len(diff_tokens) <= 1:
                    return 0.88

        # Inclusion avec ratio de longueur significatif (ex: titre contenant une édition élaguée)
        if (norm_title in alb.norm_album or alb.norm_album in norm_title) and min(len(norm_title), len(alb.norm_album)) >= 4:
            ratio = min(len(norm_title), len(alb.norm_album)) / max(len(norm_title), len(alb.norm_album))
            if ratio >= 0.70:
                if is_art_match:
                    return 0.90 * ratio
                art_sim = calculate_token_similarity(norm_art, alb.norm_artist)
                return (0.90 * ratio * 0.7) + (art_sim * 0.3)

        # Indice de similarité de tokens standard
        title_sim = calculate_token_similarity(norm_title, alb.norm_album)
        if title_sim >= 0.80:
            if norm_art and alb.norm_artist:
                art_sim = 0.95 if is_art_match else calculate_token_similarity(norm_art, alb.norm_artist)
                return (title_sim * 0.7) + (art_sim * 0.3)
            return title_sim * 0.85

        return 0.0

    def _find_temp_match(self, norm_title: str, norm_art: str) -> Optional[Path]:
        """Vérifie si un album correspondant est actuellement dans temp_downloads/."""
        if not norm_title:
            return None

        target_dirs = []
        if config.temp_download_dir:
            p = Path(config.temp_download_dir).resolve()
            if p not in target_dirs:
                target_dirs.append(p)
        if TEMP_DOWNLOAD_DIR:
            p = TEMP_DOWNLOAD_DIR.resolve()
            if p not in target_dirs:
                target_dirs.append(p)

        for t_dir in target_dirs:
            if not t_dir.exists():
                continue
            try:
                for item in t_dir.iterdir():
                    if item.is_dir() and not item.name.startswith(".") and item.name.lower() not in {"previews", ".cache", "cache"}:
                        n_folder = normalize_text(item.name)
                        # Correspondance directe au 1er niveau
                        if norm_title == n_folder or norm_title in n_folder or n_folder in norm_title:
                            return item
                        if calculate_token_similarity(norm_title, n_folder) >= 0.80:
                            return item

                        # Parcours des sous-dossiers (structure standard Artiste/Album)
                        try:
                            for sub in item.iterdir():
                                if sub.is_dir() and not sub.name.startswith("."):
                                    n_sub = normalize_text(sub.name)
                                    if norm_title == n_sub or norm_title in n_sub or n_sub in norm_title or calculate_token_similarity(norm_title, n_sub) >= 0.80:
                                        if not norm_art or norm_art in n_folder or n_folder in norm_art or calculate_token_similarity(norm_art, n_folder) >= 0.70:
                                            return sub
                        except Exception:
                            pass
            except Exception:
                pass
        return None

    def match_track(
        self,
        title: str,
        duration_sec: Optional[int] = None,
        artist: str = "",
        album_title: str = ""
    ) -> Optional[dict]:
        """
        Vérifie si une piste est déjà possédée dans la collection et qualifie son statut :
        1. 'owned' : Titre identique ET durée identique à 1 ou 2 secondes près (|dur1 - dur2| <= 2)
        2. 'different_duration' : Titre identique MAIS durée différente (|dur1 - dur2| > 2)
        3. 'different_version' : Titre plus long ou court avec la même base (ou variantes remix/edit)
        """
        if not title:
            return None

        clean_tit = re.sub(r'^\d+\s*[-.]*\s*', '', title).strip()
        norm_title = normalize_text(clean_tit)
        if not norm_title:
            return None

        base_title = extract_base_title(clean_tit) or norm_title

        # S'assurer que les pistes de la collection sont indexées
        self.indexer.ensure_tracks_indexed()

        candidates = self.indexer.get_track_candidates(norm_title, base_title)
        if not candidates:
            return None

        norm_art = normalize_text(artist)

        exact_match = None
        diff_duration_match = None
        diff_version_match = None
        suspicious_artist_match = None

        for alb, tr in candidates:
            # Compatibilité d'artiste (évite les collisions sur titres homonymes d'artistes différents)
            is_compat = True
            if norm_art and alb.norm_artist:
                is_compat = (
                    norm_art == alb.norm_artist
                    or norm_art in alb.norm_artist
                    or alb.norm_artist in norm_art
                    or "various" in norm_art
                    or "various" in alb.norm_artist
                    or calculate_token_similarity(norm_art, alb.norm_artist) >= 0.40
                )

            cand_clean = re.sub(r'^\d+\s*[-.]*\s*', '', tr.title or "").strip()
            cand_norm = tr.norm_title or normalize_text(cand_clean)
            cand_base = getattr(tr, "base_title", None) or extract_base_title(cand_clean) or cand_norm

            is_exact_title = (norm_title == cand_norm)
            is_base_equal = bool(base_title and cand_base and base_title == cand_base)

            # Vérification de durée
            dur_diff = None
            if duration_sec is not None and tr.duration_sec is not None:
                dur_diff = abs(duration_sec - tr.duration_sec)

            track_info = {
                "is_owned": True,
                "owned_album": alb.album,
                "owned_artist": alb.artist,
                "owned_title": tr.title,
                "owned_duration": tr.duration_str,
                "owned_path": str(Path(alb.path) / tr.filename),
                "bitrate_kbps": getattr(tr, "bitrate_kbps", None),
                "source": alb.source
            }

            # Si l'artiste n'est pas compatible : vérifier si c'est un doublon potentiel / autre artiste
            if not is_compat:
                if (is_exact_title or is_base_equal) and dur_diff is not None and dur_diff <= 2:
                    if not suspicious_artist_match:
                        info_susp = dict(track_info)
                        info_susp["is_owned"] = False
                        info_susp["match_status"] = "suspicious_artist"
                        info_susp["badge_label"] = "🔍 Autre artiste ?"
                        info_susp["badge_class"] = "badge-track-suspicious-artist"
                        suspicious_artist_match = info_susp
                continue

            # 1. Titre identique
            if is_exact_title:
                if dur_diff is not None:
                    if dur_diff <= 2:
                        track_info["match_status"] = "owned"
                        track_info["badge_label"] = "✓ Piste possédée"
                        track_info["badge_class"] = "badge-track-owned"
                        return track_info
                    else:
                        if not diff_duration_match:
                            track_info["match_status"] = "different_duration"
                            track_info["badge_label"] = "⏱️ Autre durée"
                            track_info["badge_class"] = "badge-track-different-duration"
                            diff_duration_match = track_info
                else:
                    track_info["match_status"] = "owned"
                    track_info["badge_label"] = "✓ Piste possédée"
                    track_info["badge_class"] = "badge-track-owned"
                    if not exact_match:
                        exact_match = track_info
                continue

            # 2. Base de titre identique ou variante (titre plus long/court avec même base)
            is_variant = False
            if is_base_equal:
                is_variant = True
            elif base_title and cand_base and min(len(base_title), len(cand_base)) >= 4:
                if base_title in cand_base or cand_base in base_title:
                    ratio = min(len(base_title), len(cand_base)) / max(len(base_title), len(cand_base))
                    if ratio >= 0.40:
                        is_variant = True
                elif calculate_token_similarity(base_title, cand_base) >= 0.70:
                    is_variant = True

            if is_variant and not diff_version_match:
                track_info["match_status"] = "different_version"
                track_info["badge_label"] = "🔀 Autre version"
                track_info["badge_class"] = "badge-track-different-version"
                diff_version_match = track_info

        if exact_match:
            return exact_match
        if diff_duration_match:
            return diff_duration_match
        if diff_version_match:
            return diff_version_match
        if suspicious_artist_match:
            return suspicious_artist_match

        return None

    def enrich_preview_tracks(
        self,
        tracks: List[dict],
        album_artist: str = "",
        album_title: str = ""
    ) -> dict:
        """
        Enrichit la liste des pistes d'un album / playlist prévisualisé
        avec le statut principal et les badges sémantiques (Live, Instrumentale, Upgrade, Explicit, Complète album).
        """
        counts = {
            "owned_count": 0,
            "different_duration_count": 0,
            "different_version_count": 0,
            "suspicious_artist_count": 0,
            "missing_for_album_count": 0,
            "total_matched": 0,
            "matched_album_name": None
        }
        if not tracks:
            return counts

        self.indexer.ensure_tracks_indexed()

        # Vérification si l'album existe déjà partiellement dans la bibliothèque
        matched_album = self._find_best_album_match(normalize_text(album_artist), normalize_text(album_title))
        if matched_album:
            counts["matched_album_name"] = matched_album.album

        for t in tracks:
            t_title = t.get("title") or ""
            t_dur_str = t.get("duration")
            t_dur_sec = parse_duration_to_seconds(t_dur_str)
            t_artist = t.get("artist") or album_artist

            # Détection sémantique sur le titre en ligne (Explicit / Clean / Live / Instrumental)
            is_explicit = bool(EXPLICIT_REGEX.search(t_title))
            is_clean = bool(CLEAN_REGEX.search(t_title))
            is_online_live = bool(LIVE_REGEX.search(t_title))
            is_online_inst = bool(INST_REGEX.search(t_title))

            if is_explicit:
                t["tag_content"] = "🔞 Explicit"
                t["tag_content_tooltip"] = "Version explicite non-censurée"
            elif is_clean:
                t["tag_content"] = "🛡️ Clean Edit"
                t["tag_content_tooltip"] = "Version radio edit / propre"

            if is_online_inst:
                inst_m = INST_REGEX.search(t_title).group(0).lower()
                lbl = "🎤 A cappella" if ("cappella" in inst_m or "acapella" in inst_m) else ("🎹 Karaoké" if "karaoke" in inst_m else "🎹 Instrumentale")
                t["tag_inst"] = lbl
                t["tag_inst_tooltip"] = f"Déclinaison {lbl}"

            match = self.match_track(
                title=t_title,
                duration_sec=t_dur_sec,
                artist=t_artist,
                album_title=album_title
            )
            if match:
                st = match["match_status"]
                t["is_owned"] = match.get("is_owned", True)
                t["match_status"] = st
                t["badge_label"] = match["badge_label"]
                t["badge_class"] = match["badge_class"]
                t["owned_album"] = match["owned_album"]
                t["owned_artist"] = match["owned_artist"]
                t["owned_title"] = match["owned_title"]
                t["owned_duration"] = match["owned_duration"]
                counts["total_matched"] += 1
                if st == "owned":
                    counts["owned_count"] += 1
                elif st == "different_duration":
                    counts["different_duration_count"] += 1
                elif st == "different_version":
                    counts["different_version_count"] += 1
                elif st == "suspicious_artist":
                    counts["suspicious_artist_count"] += 1

                # Nuance Live vs Studio
                is_local_live = bool(LIVE_REGEX.search(match.get("owned_title") or ""))
                if is_online_live and not is_local_live:
                    t["tag_live"] = "🎙️ Live / Concert"
                    t["tag_live_tooltip"] = f"Version live/concert en ligne (votre version dans '{match['owned_album']}' est studio)"
                elif not is_online_live and is_local_live:
                    t["tag_live"] = "💿 Studio"
                    t["tag_live_tooltip"] = f"Version studio en ligne (votre version dans '{match['owned_album']}' est un live)"
                elif is_online_live and is_local_live:
                    t["tag_live"] = "🎙️ Live"
                    t["tag_live_tooltip"] = "Version live/concert"

                # Nuance Qualité supérieure / Upgrade
                local_br = match.get("bitrate_kbps")
                if local_br and local_br < 150:
                    t["tag_upgrade"] = "💎 Qualité sup."
                    t["tag_upgrade_tooltip"] = f"Qualité supérieure en ligne disponible (votre version locale est en ~{local_br} kbps)"
            else:
                t["is_owned"] = False
                t["match_status"] = None
                if is_online_live:
                    t["tag_live"] = "🎙️ Live"
                    t["tag_live_tooltip"] = "Enregistrement en concert / public"

                # Détection morceau manquant pour compléter un album possédé
                if matched_album:
                    t["is_missing_track"] = True
                    t["missing_album_name"] = matched_album.album
                    t["missing_album_path"] = matched_album.path
                    counts["missing_for_album_count"] += 1

        # Si aucune piste n'était possédée du tout, ce n'est pas un album incomplet
        if counts["owned_count"] == 0 and counts["different_duration_count"] == 0:
            counts["missing_for_album_count"] = 0
            for t in tracks:
                t["is_missing_track"] = False

        return counts


# Instance singleton globale
library_indexer = LibraryIndexer()
smart_matcher = SmartMatcher(library_indexer)

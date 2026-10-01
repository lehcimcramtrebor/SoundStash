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

def extract_audio_tags_fast(filepath: Path) -> dict:
    """
    Extrait ultra-rapidement (< 2ms) l'ensemble des tags audio réels directement
    depuis un fichier audio (MP4/M4A, MP3 ID3v2, FLAC, OGG/OPUS) sans sous-processus.
    Retourne : {'artist': str, 'album': str, 'year': str, 'genre': str, 'title': str}
    """
    meta = {'artist': '', 'album': '', 'year': '', 'genre': '', 'title': ''}
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
                    if meta[field] and field != 'artist':
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

            # FLAC
            elif hdr[:4] == b'fLaC':
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

    except Exception:
        pass
    return meta

def extract_album_tags_priority(folder: Path, audio_files: List[Path]) -> dict:
    """
    Extrait les métadonnées d'un album avec priorité absolue selon la demande utilisateur :
    1. .album_meta.json si présent avec tags valides
    2. Tags audio réels extraits ultra-rapidement des 2 premières pistes audio
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

    # 2. Inspecter les 2 premières pistes audio
    for af in audio_files[:2]:
        p = Path(af)
        if not p.is_file():
            continue
        tags = extract_audio_tags_fast(p)
        art = (tags.get("artist") or "").strip()
        alb = (tags.get("album") or "").strip()
        yr = (tags.get("year") or "").strip()
        gnr = (tags.get("genre") or "").strip()

        if not result["artist"] and art and art.lower() not in {"inconnu", "unknown", "artiste inconnu"}:
            result["artist"] = art
        if not result["album"] and alb and alb.lower() not in {"inconnu", "unknown", "unknown album", "sans titre"}:
            result["album"] = alb
        if not result["year"] and yr:
            result["year"] = yr
        if not result["genre"] and gnr:
            result["genre"] = gnr

        if result["artist"] and result["album"]:
            break

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


class LibraryIndexer:
    """
    Moteur d'indexation ultra-rapide et non-bloquant de la collection musicale.
    Maintient un cache mémoire et disque pour un temps de réponse de 0ms.
    """
    def __init__(self):
        self.cache_file = CONFIG_DIR / ".library_cache.json"
        self.albums: List[IndexedAlbum] = []
        self.artists_map: Dict[str, List[IndexedAlbum]] = {}
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
        """Reconstruit la table de hachage par artiste."""
        self.artists_map.clear()
        for alb in self.albums:
            key = alb.norm_artist or "inconnu"
            if key not in self.artists_map:
                self.artists_map[key] = []
            self.artists_map[key].append(alb)

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
                    source=source
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
            source="library"
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

    def match_item(
        self,
        title: str,
        artist: str = "",
        item_type: str = "album",
        downloading_url_or_title: Optional[str] = None,
        queued_items: Optional[List[dict]] = None
    ) -> dict:
        """
        Détermine le statut d'un élément (recherche, discographie) par rapport au système.
        """
        norm_title = normalize_text(title)
        norm_art = normalize_text(artist)

        # 1. Vérification téléchargement en cours
        if downloading_url_or_title:
            norm_down = normalize_text(downloading_url_or_title)
            if (norm_title and norm_title in norm_down) or (norm_down and norm_down in norm_title):
                return {"status": "downloading", "label": "⚡ En cours", "badge_class": "badge-status-downloading"}

        # 2. Vérification file d'attente
        if queued_items:
            for q in queued_items:
                q_title = normalize_text(q.get("title") or "")
                if norm_title and (norm_title == q_title or norm_title in q_title or q_title in norm_title):
                    return {"status": "queued", "label": "⏳ En file", "badge_class": "badge-status-queued"}

        # 3. Vérification dans la bibliothèque indexée (Collection, Export)
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

        # 4. Vérification dans temp_downloads/
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

        # Inclusion avec ratio de longueur significatif (ex: titre contenant une édition élaguée)
        if (norm_title in alb.norm_album or alb.norm_album in norm_title) and min(len(norm_title), len(alb.norm_album)) >= 4:
            ratio = min(len(norm_title), len(alb.norm_album)) / max(len(norm_title), len(alb.norm_album))
            if ratio >= 0.70:
                if is_art_match:
                    return 0.90 * ratio
                art_sim = calculate_token_similarity(norm_art, alb.norm_artist)
                return (0.90 * ratio * 0.7) + (art_sim * 0.3)

        # Indice de similarité de tokens
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


# Instance singleton globale
library_indexer = LibraryIndexer()
smart_matcher = SmartMatcher(library_indexer)

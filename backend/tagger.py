import json
import os
import re
import shutil
import stat
import struct
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional, Dict, Tuple
from backend.config import KID3_CLI_PATH, config, YT_DLP_PATH, FFMPEG_PATH, FFPROBE_PATH
from backend.genre_service import detect_genre_sync
from backend.library_indexer import library_indexer, DISC_SUBFOLDER_RE, normalize_text
from backend.logger import get_logger

logger = get_logger(__name__)

AUDIO_EXTENSIONS = {".m4a", ".ogg", ".mp3", ".flac", ".opus", ".aac", ".wav", ".wma", ".mp4", ".mkv", ".webm"}

def safe_rmtree(target_path: str | Path) -> bool:
    """Supprime un dossier récursivement sous Windows en déverrouillant les attributs de lecture seule et permissions."""
    p = Path(target_path)
    if not p.exists():
        return True

    def on_rm_error(func, path, exc_info):
        try:
            os.chmod(path, stat.S_IWRITE | stat.S_IREAD)
            func(path)
        except Exception:
            pass

    for attempt in range(4):
        try:
            shutil.rmtree(str(p), onerror=on_rm_error)
            if not p.exists():
                return True
        except Exception:
            pass

        if p.exists():
            try:
                subprocess.run(["cmd.exe", "/c", "rmdir", "/s", "/q", str(p.resolve())], capture_output=True, timeout=5)
                if not p.exists():
                    return True
            except Exception:
                pass

        if p.exists() and attempt < 3:
            import gc
            gc.collect()
            time.sleep(0.3 * (attempt + 1))

    if p.exists():
        logger.warning(f"Impossible de supprimer le dossier : {p}")
        return False

    return True

def is_empty_or_na(val: Optional[str]) -> bool:
    """Vérifie si une chaîne de métadonnées est vide ou équivalente à 'NA'."""
    if not val:
        return True
    v = str(val).strip().upper()
    return v in {
        "NA", "N/A", "NONE", "UNKNOWN", "UNKNOWN ARTIST", "UNKNOWN ALBUM",
        "INCONNU", "ARTISTE INCONNU", "ALBUM INCONNU", "UNDEFINED", "NULL"
    }

def is_playlist_url(url: str) -> bool:
    """Détermine si une URL correspond à une playlist (et non à un album officiel studio OLAK/MPREb_)."""
    if not url:
        return False
    u = url.upper()
    if "OLAK" in u or "MPREB_" in u:
        return False
    m = re.search(r"[?&]list=([^&]+)", url, re.IGNORECASE)
    if m:
        list_id = m.group(1).upper()
        if list_id.startswith("OLAK"):
            return False
        # Si c'est une lecture individuelle (watch?v=) accompagnée d'une radio auto-générée (list=RD... ou list=UL...),
        # l'utilisateur écoute un morceau unique et le lecteur enchaîne : ce n'est PAS une playlist voulue.
        if ("WATCH?V=" in u or "WATCH/" in u) and (list_id.startswith("RD") or list_id.startswith("UL")):
            return False
        return True
def classify_album_type(
    title: str = "",
    path: str = "",
    track_count: int = 0,
    is_concert: bool = False,
    is_playlist: bool = False
) -> str:
    """
    Détermine de manière robuste et déterministe le type d'un album ou regroupement :
    - 'album' (Album Studio officiel)
    - 'single' (Single / EP, 1 à 3 pistes ou tag explicite [Single])
    - 'rip' (Rips Audio vidéo, conteneur Singles & Rips)
    - 'playlist' (Playlist)
    - 'concert' (Concert & Live)
    """
    # 1. Choix manuel forcé enregistré dans le dossier
    if path:
        try:
            p_dir = Path(path)
            if p_dir.is_file():
                p_dir = p_dir.parent
            type_file = p_dir / ".album_type"
            if type_file.exists():
                forced = type_file.read_text(encoding="utf-8").strip().lower()
                if forced in ("album", "single", "rip", "playlist", "concert"):
                    return forced
        except Exception:
            pass

    if is_concert:
        return "concert"

    t = (title or "").lower()
    p = (path or "").lower()

    # 2. Playlists
    if is_playlist or "[playlist]" in t or "[playlist]" in p or "playlist" in t:
        return "playlist"

    # 3. Rips audio
    if (
        "singles & rips" in t
        or "singles & rips" in p
        or "singles et rips" in t
        or "singles et rips" in p
        or "[rip]" in t
        or "[audio rip]" in t
        or "extrait vidéo" in t
        or "extrait video" in t
    ):
        return "rip"

    # 4. Bouclier absolu : un album avec plus de 3 titres ne peut JAMAIS être un single
    # (ex: "Singles Collection", "The Singles", compilations de singles)
    if track_count > 3:
        return "album"

    # 5. Tag explicite entre crochets [Single] ou [single]
    if "[single]" in t or "[single]" in p:
        return "single"

    # 6. Format court naturel (1 à 3 pistes)
    if 0 < track_count <= 3:
        return "single"

    return "album"

# Expressions régulières pour nettoyer les titres pollués YouTube
NOISE_PATTERNS = [
    r"\s*[\(\[](?:(?:official\s+)?(?:(?:hd|4k|hq|uhd)\s+)?(?:music\s+video|video|audio|lyric\s+video|visualizer|mv|track|clip|vid[ée]o)(?:[,\s]+(?:remaster(?:ed)?|hd|4k|hq|\d+p))*)[)\]]",
    r"\s*[\(\[](?:clip(?:\s+officiel)?|vid[ée]o(?:\s+officielle)?|audio(?:\s+officiel)?)(?:[,\s]+(?:remaster(?:ed)?|hd|4k|hq|\d+p))*[)\]]",
    r"\s*[\(\[](?:(?:4k|1080p|720p|hd|hdr|uhd|hq|full\s*hd)[\s,]+)?(?:paroles|lyrics|visualizer|remaster(?:ed)?(?:\s+\d{4})?)(?:[,\s]+(?:60fps|\d+fps|hdr))*[)\]]",
    r"\s*[\(\[](?:(?:4k|1080p|720p|hd|hdr|uhd|hq|full\s*hd)(?:[,\s]+(?:60fps|\d+fps|hdr))*|\d+fps)[)\]]",
    r"\s*[\(\[](?:(?:official\s+)?live\s+(?:video|clip|session|stream)|video\s+live)[)\]]",
    r"\s*[\(\[](?:ft\.|feat\.)\s*(?:\[[^\]]*\]|\([^\)]*\)|[^)\]])*[)\]]",
    r"\s*[\(\[](?:avec)\s*(?:\[[^\]]*\]|\([^\)]*\)|[^)\]])*[)\]]",
    r"\s*[\(\[](?:officiel|official)[\)\]]",
    r"^\s*-\s*",
    r"\s*-\s*$",
    r"\s{2,}"
]

def clean_artist_name(artist: Optional[str]) -> str:
    """
    Nettoie un nom d'artiste en éliminant les suffixes auto-générés par YouTube
    tels que ' - Topic', ' - Thème', ' - Theme', ' (Topic)' ainsi que les mentions
    parasites de chaînes officielles telles que ' [Officiel]', ' (Officiel)', ' Officiel',
    ' [Official]', ' - Official', ' VEVO', etc.
    Ex: 'Les Ogres de Barback [Officiel]' -> 'Les Ogres de Barback'
        'Renaud - Thème' -> 'Renaud'
    """
    if not artist:
        return ""
    s = str(artist).strip()
    cleaned = re.sub(
        r"\s*(?:[\-–—:\/]\s*|[\(\[])\s*(?:topic|th[eè]me|theme|officiel|official|clip\s+officiel|cha[iî]ne\s+officielle|official\s+channel)\s*[\)\]]?\s*$",
        "",
        s,
        flags=re.IGNORECASE
    ).strip()
    cleaned = re.sub(
        r"\s+(?:officiel|official|topic|th[eè]me|theme)\s*$",
        "",
        cleaned,
        flags=re.IGNORECASE
    ).strip()
    cleaned = re.sub(r"\s+vevo\s*$", "", cleaned, flags=re.IGNORECASE).strip()
    if cleaned.lower().endswith("vevo") and len(cleaned) > 5 and not cleaned.lower().startswith("vevo"):
        cleaned = cleaned[:-4].strip()
    return cleaned if cleaned else s

def extract_artist_and_title(raw_title: str, existing_artist: str = "", uploader: str = "") -> tuple[str, str]:
    """
    Extrait et nettoie l'artiste et le titre depuis le nom brut d'une vidéo YouTube.
    Ex: 'Renaud - Toujours debout (Clip officiel)' -> ('Renaud', 'Toujours debout')
    """
    cleaned_raw = raw_title.strip()
    # Enlever un éventuel numéro de piste initial '01 - ' ou '01 ' (ne pas écraser les titres commençant par un nombre comme '500 connards' ou '1984')
    m_num = re.match(r"^(?:0[1-9]|[1-9]\d?)\s*[-_.]\s*(.+)$|^(?:0[1-9])\s+(?![0-9])(.+)$", cleaned_raw)
    if m_num:
        cleaned_raw = (m_num.group(1) or m_num.group(2)).strip()

    # Nettoyer les parasites YouTube du titre
    cleaned_title = clean_track_title(cleaned_raw, preserve_feat=True)

    # Assainir systématiquement existing_artist et uploader de tout suffixe Topic/Thème/Officiel
    clean_exist = clean_artist_name(existing_artist)
    clean_up = clean_artist_name(uploader)

    # Rechercher un séparateur Artiste - Titre (ou –, —, :)
    sep_match = re.match(r"^(.+?)\s+[\-–—:]\s+(.+)$", cleaned_title)
    if sep_match:
        cand_artist = clean_artist_name(sep_match.group(1).strip())
        cand_title = sep_match.group(2).strip()
        if cand_artist and cand_title:
            if is_empty_or_na(clean_exist) or clean_exist.lower() in cand_artist.lower() or cand_artist.lower() in clean_exist.lower():
                artist = cand_artist if is_empty_or_na(clean_exist) else clean_exist
                return clean_artist_name(artist), clean_track_title(cand_title, preserve_feat=True)

    artist = clean_exist if not is_empty_or_na(clean_exist) else ""
    if not artist and clean_up and not is_empty_or_na(clean_up):
        artist = clean_up

    if not artist:
        artist = "Artiste inconnu"

    return clean_artist_name(artist), cleaned_title

def clean_track_title(title: str, preserve_feat: bool = True) -> str:
    """Nettoie le titre d'une piste de toutes les mentions parasites typiques de YouTube."""
    cleaned = title.strip()
    
    fm = re.search(r"[\(\[](?:ft\.|feat\.)\s*((?:\[[^\]]*\]|\([^\)]*\)|[^)\]])+)[)\]]", cleaned, re.IGNORECASE)
    am = re.search(r"[\(\[](?:avec)\s+((?:\[[^\]]*\]|\([^\)]*\)|[^)\]])+)[)\]]", cleaned, re.IGNORECASE)
    feat_artist = fm.group(1).strip() if fm else (am.group(1).strip() if am else "")

    if feat_artist:
        clean_cand = re.sub(r"[\[\(\]\)\-_]", "", feat_artist).strip().lower()
        if clean_cand in {"officiel", "official", "topic", "thème", "theme", "clip", "video", "vidéo", "audio", "vevo"}:
            feat_artist = ""

    feat_str = f" (feat. {feat_artist})" if feat_artist and preserve_feat else ""

    for pattern in NOISE_PATTERNS:
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE)
    
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = re.sub(r"^[\s\-–—]+|[\s\-–—]+$", "", cleaned).strip()

    if feat_str and feat_str.lower() not in cleaned.lower():
        cleaned += feat_str
        
    return cleaned

# Alias pour compatibilité
clean_title = clean_track_title

def parse_track_filename(filename: str) -> tuple[Optional[int], str]:
    """Tente d'extraire le numéro de piste et le titre depuis le nom de fichier."""
    stem = Path(filename).stem
    match = re.match(r"^(\d{1,3})[\s\.\-_]+(.+)$", stem)
    if match:
        try:
            return int(match.group(1)), match.group(2).strip()
        except ValueError:
            pass
    return None, stem

def sanitize_folder_name(name: str) -> str:
    """Remplace les caractères interdits pour les dossiers Windows."""
    sanitized = re.sub(r'[\\/*?:"<>|]', "_", name).strip().rstrip('.')
    _WINDOWS_RESERVED = {'CON', 'PRN', 'AUX', 'NUL'} | {f'COM{i}' for i in range(1,10)} | {f'LPT{i}' for i in range(1,10)}
    if sanitized.upper() in _WINDOWS_RESERVED:
        sanitized = f"_{sanitized}"
    return sanitized if sanitized else "Inconnu"

# Séparateurs de collaboration dans un nom d'artiste d'album.
# On n'utilise que feat./ft./featuring/avec/with car & et , peuvent faire
# partie du nom officiel d'un groupe (Simon & Garfunkel, Earth Wind & Fire…).
# Le pattern exige un espace AVANT le mot-clé pour éviter les faux positifs
# dans des syllabes (ex : « Daft » contient « ft »).
_FEAT_PATTERN = re.compile(
    r"\s+(?:feat\.?|ft\.?|featuring|avec|with)\s+\S.+$",
    flags=re.IGNORECASE
)

# Mots-clés indiquant qu'un album est une compilation multi-artistes
_COMPILATION_KEYWORDS = re.compile(
    r"\b(?:compilation|greatest\s+hits?|best\s+of|anthologie|collection|"
    r"les?\s+plus\s+belles?|les?\s+meilleur|100\s+|vol(?:ume)?\.?\s*\d|"
    r"playlist|mix)\b",
    flags=re.IGNORECASE
)

# Mots-clés de nettoyage pour bandes originales et compilations (OST / Soundtracks)
_SOUNDTRACK_NOISE_PATTERN = re.compile(
    r'\b(original\s+motion\s+picture\s+soundtrack|music\s+from\s+the\s+motion\s+picture|original\s+soundtrack|bande\s+originale\s+du\s+film|bande\s+originale|motion\s+picture\s+soundtrack|original\s+score|soundtrack|b\.o\.?|ost|score)\b',
    re.IGNORECASE
)

def extract_core_album_title(album: str) -> Tuple[str, bool]:
    """
    Extrait le titre fondamental d'un album en nettoyant les mentions de BO / OST.
    Ex: 'Original Motion Picture Soundtrack OVER THE TOP' -> ('OVER THE TOP', True)
    """
    if not album:
        return "", False
    is_ost = bool(_SOUNDTRACK_NOISE_PATTERN.search(album))
    cleaned = _SOUNDTRACK_NOISE_PATTERN.sub("", album)
    cleaned = re.sub(r'[\(\)\[\]\:\-_]+', ' ', cleaned).strip()
    cleaned = re.sub(r'\s+', ' ', cleaned)
    return cleaned, is_ost

# Cache MusicBrainz : (album_lower, artist_lower) -> {position_str: artist_credit}
_MB_TRACK_ARTISTS_CACHE: Dict[Tuple[str, str], Optional[Dict[str, str]]] = {}
_MB_TRACKS_CACHE: Dict[Tuple[str, str], Optional[Dict[int, Dict[str, str]]]] = {}

# MusicBrainz exige ce format : AppName/version (email) — sans email, les requêtes sont rejetées
_MB_HEADERS = {"User-Agent": "SoundStash/4.0.1 (soundstash@helmicretro.local)"}

_LAST_MB_REQUEST_TIME = 0

def fetch_musicbrainz_track_artists_sync(
    album: str,
    artist: str,
    expected_track_count: Optional[int] = None
) -> Optional[Dict[str, str]]:
    """
    Interroge MusicBrainz pour récupérer les crédits d'artistes et les durées par position de piste
    d'un album donné. Retourne un dict {position_str: artist_credit} ou None si pas trouvé.
    Les résultats sont mis en cache pour éviter les appels redondants.
    Intègre une recherche multicandidats tolérante aux OST, compilations et inversions de titres.
    """
    if is_empty_or_na(album) or is_empty_or_na(artist):
        return None
    cache_key = (album.lower().strip(), artist.lower().strip())
    if cache_key in _MB_TRACK_ARTISTS_CACHE:
        return _MB_TRACK_ARTISTS_CACHE[cache_key]

    logger.info(f"MusicBrainz lookup : '{album}' / '{artist}' (pistes attendues: {expected_track_count})")
    try:
        def mb_get(url: str):
            """Effectue un GET MusicBrainz avec retry sur 503 (rate limit)."""
            global _LAST_MB_REQUEST_TIME
            for attempt in range(2):
                elapsed = time.time() - _LAST_MB_REQUEST_TIME
                if elapsed < 1.1:
                    time.sleep(1.1 - elapsed)
                
                req = urllib.request.Request(url, headers=_MB_HEADERS)
                try:
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        _LAST_MB_REQUEST_TIME = time.time()
                        return json.loads(resp.read().decode("utf-8", errors="ignore"))
                except urllib.error.HTTPError as e:
                    _LAST_MB_REQUEST_TIME = time.time()
                    if e.code == 503 and attempt == 0:
                        logger.warning(f"MusicBrainz 503 rate-limit, retry dans 1.5s ({url[:60]})")
                        time.sleep(1.5)
                        _LAST_MB_REQUEST_TIME = time.time()
                    else:
                        raise
            return {}

        core_title, is_ost = extract_core_album_title(album)
        is_va = artist.lower() in {"various artists", "various", "artiste inconnu", "divers artistes", "soundtrack", "ost"} or is_ost

        # Stratégie multicandidats pour maximiser les chances de correspondance exacte
        query_candidates = []
        if not is_va:
            query_candidates.append(f'release:"{album}" AND artist:"{artist}"')
        
        if is_va:
            query_candidates.append(f'release:"{album}" AND (artist:"Various Artists" OR soundtrack)')
            query_candidates.append(f'release:"{album}"')
        else:
            query_candidates.append(f'release:"{album}"')

        if core_title and core_title.lower() != album.lower():
            if is_va:
                query_candidates.append(f'release:"{core_title}" AND (artist:"Various Artists" OR soundtrack)')
                query_candidates.append(f'release:({core_title}) AND soundtrack')
                query_candidates.append(f'release:"{core_title}"')
            else:
                query_candidates.append(f'release:"{core_title}" AND artist:"{artist}"')
                query_candidates.append(f'release:"{core_title}"')

        # Fallback par termes de recherche Lucene sans contrainte de guillemets stricts
        target_text = core_title if core_title else album
        target_clean = re.sub(r'[^\w\s]', ' ', target_text).strip()
        if target_clean:
            if is_va:
                query_candidates.append(f'release:({target_clean}) AND (soundtrack OR "Various Artists")')
            else:
                query_candidates.append(f'release:({target_clean}) AND artist:({artist})')

        releases = []
        for q_str in query_candidates:
            q_enc = urllib.parse.quote(q_str)
            search_url = f"https://musicbrainz.org/ws/2/release/?query={q_enc}&fmt=json&limit=5"
            data = mb_get(search_url)
            cur_releases = data.get("releases", [])
            if cur_releases:
                releases = cur_releases
                logger.info(f"MusicBrainz : release(s) trouvée(s) avec la requête '{q_str}'")
                break

        if not releases:
            logger.info(f"MusicBrainz : aucune release trouvée pour '{album}' / '{artist}'")
            _MB_TRACK_ARTISTS_CACHE[cache_key] = None
            _MB_TRACKS_CACHE[cache_key] = None
            return None

        if expected_track_count and expected_track_count > 0:
            best = sorted(
                releases,
                key=lambda x: (
                    -x.get("score", 0),
                    abs((x.get("track-count") or 0) - expected_track_count)
                )
            )[0]
        else:
            best = max(releases, key=lambda x: x.get("score", 0))

        release_id = best["id"]
        logger.info(f"MusicBrainz : release retenue '{best.get('title')}' (id={release_id}, score={best.get('score')}, pistes={best.get('track-count')})")

        time.sleep(1.1)
        detail_url = f"https://musicbrainz.org/ws/2/release/{release_id}?inc=recordings+artist-credits&fmt=json"
        detail = mb_get(detail_url)

        track_credits: Dict[str, str] = {}
        all_tracks_info: Dict[int, Dict[str, str]] = {}
        position_offset = 0
        for medium in detail.get("media", []):
            for track in medium.get("tracks", []):
                pos = track.get("position", 0) + position_offset
                rec = track.get("recording", {})
                track_title = track.get("title") or rec.get("title", "")
                credits = rec.get("artist-credit", []) or track.get("artist-credit", [])
                artist_str = ""
                for c in credits:
                    if isinstance(c, dict):
                        name = c.get("name") or c.get("artist", {}).get("name", "")
                        artist_str += name + c.get("joinphrase", "")
                if artist_str:
                    track_credits[str(pos)] = artist_str.strip()

                # Extraction de la durée originale
                length_ms = track.get("length") or rec.get("length")
                dur_str = ""
                if length_ms and isinstance(length_ms, (int, float)) and length_ms > 0:
                    total_sec = round(length_ms / 1000)
                    if total_sec >= 3600:
                        dur_str = f"{total_sec // 3600}:{(total_sec % 3600) // 60:02d}:{total_sec % 60:02d}"
                    else:
                        dur_str = f"{total_sec // 60}:{total_sec % 60:02d}"

                if pos > 0 and track_title:
                    all_tracks_info[pos] = {
                        "title": track_title.strip(),
                        "artist": artist_str.strip() if artist_str else artist,
                        "duration": dur_str
                    }
            position_offset += medium.get("track-count", 0)

        feat_tracks = {k: v for k, v in track_credits.items() if v.lower() != artist.lower()}
        if feat_tracks:
            logger.info(f"MusicBrainz : {len(feat_tracks)} piste(s) avec feat. détecté(s) : " +
                       ", ".join(f"#{k}={v}" for k, v in sorted(feat_tracks.items(), key=lambda x: int(x[0]))))
        else:
            logger.info(f"MusicBrainz : {len(track_credits)} pistes, aucun feat. différent de l'artiste album")

        result = track_credits if track_credits else None
        _MB_TRACK_ARTISTS_CACHE[cache_key] = result
        _MB_TRACKS_CACHE[cache_key] = all_tracks_info if all_tracks_info else None
        return result
    except Exception as e:
        logger.warning(f"MusicBrainz erreur pour '{album}' / '{artist}' : {e}")
        _MB_TRACK_ARTISTS_CACHE[cache_key] = None
        _MB_TRACKS_CACHE[cache_key] = None
        return None

def fetch_musicbrainz_release_tracks_sync(
    album: str,
    artist: str,
    expected_track_count: Optional[int] = None
) -> Optional[Dict[int, Dict[str, str]]]:
    """
    Retourne un dictionnaire {position_num: {'title': str, 'artist': str, 'duration': str}} pour un album donné via MusicBrainz.
    """
    if is_empty_or_na(album) or is_empty_or_na(artist):
        return None
    cache_key = (album.lower().strip(), artist.lower().strip())
    if cache_key in _MB_TRACKS_CACHE and _MB_TRACKS_CACHE[cache_key] is not None:
        return _MB_TRACKS_CACHE[cache_key]
    fetch_musicbrainz_track_artists_sync(album, artist, expected_track_count=expected_track_count)
    return _MB_TRACKS_CACHE.get(cache_key)

def strip_feat_from_artist(artist: str) -> str:
    """
    Retire toute mention de collaboration (feat., ft., &, avec...) du nom d'artiste
    d'ALBUM pour ne conserver que l'artiste principal.
    Exemple : 'Renaud feat. Axelle Red' -> 'Renaud'
              'Stromae & Lorde'          -> 'Stromae'
    NE PAS utiliser sur le tag 'artist' d'une piste individuelle.
    """
    if not artist:
        return artist
    cleaned = _FEAT_PATTERN.sub("", artist).strip()
    # Sécurité : si le nettoyage a tout effacé, retourner l'original
    return cleaned if cleaned else artist

def sanitize_path(path_input: str | Path) -> Path:
    """Nettoie un chemin complet en remplaçant les caractères interdits sous Windows dans chaque sous-dossier."""
    p = Path(path_input)
    parts = list(p.parts)
    if not parts:
        return p
    clean_parts = []
    if p.is_absolute():
        clean_parts.append(parts[0]) # Préserve la racine (ex: C:\)
        start_idx = 1
    else:
        start_idx = 0
    for part in parts[start_idx:]:
        clean_part = re.sub(r'[<>:"/\\|?*]', '_', part).strip()
        clean_parts.append(clean_part if clean_part else '_')
    return Path(*clean_parts)

def extract_4digit_year(val: str) -> str:
    """Extrait strictement une année valide sur 4 chiffres (YYYY) entre 1900 et 2099."""
    if not val:
        return ""
    val_str = str(val).strip()
    # Recherche 19xx ou 20xx
    m = re.search(r'\b(19\d\d|20\d\d)\b', val_str)
    if m:
        return m.group(1)
    # Format YYYYMMDD ou YYYY-MM-DD commençant par 19xx ou 20xx
    m2 = re.match(r'^(19\d\d|20\d\d)', val_str)
    if m2:
        return m2.group(1)
    return ""

def get_audio_info_fast(filepath: Path | str) -> tuple[str, Optional[int], str]:
    """
    Extrait la durée ('M:SS' ou 'H:MM:SS'), le débit en kbps (int) et le format ('M4A', 'MP3', etc.).
    Lit l'en-tête MP4/M4A/AAC en Python pur (< 0.5ms) avec fallback ffprobe pour les autres formats.
    """
    p = Path(filepath)
    if not p.is_file():
        return "", None, ""
    
    ext = p.suffix.lower()
    fmt = ext.lstrip(".").upper() if ext else "AUDIO"
    sec: Optional[float] = None
    file_sz = 0
    try:
        file_sz = p.stat().st_size
    except Exception:
        pass

    if ext in {".m4a", ".mp4", ".aac"}:
        try:
            with open(p, "rb") as f:
                data = f.read(250000)
                idx = data.find(b"mvhd")
                if idx != -1:
                    version = data[idx + 4]
                    if version == 0:
                        timescale, duration = struct.unpack(">II", data[idx + 16 : idx + 24])
                        if timescale > 0:
                            sec = duration / timescale
                    elif version == 1:
                        timescale = struct.unpack(">I", data[idx + 24 : idx + 28])[0]
                        duration = struct.unpack(">Q", data[idx + 28 : idx + 36])[0]
                        if timescale > 0:
                            sec = duration / timescale
        except Exception:
            pass

    # Repli via ffprobe pour les autres formats (MP3, FLAC, OGG, WAV, etc.) ou si non trouvé
    if sec is None and Path(FFPROBE_PATH).exists():
        try:
            res = subprocess.run(
                [str(FFPROBE_PATH), "-v", "error", "-show_entries", "format=duration,bit_rate", "-of", "default=noprint_wrappers=1:nokey=1", str(p.resolve())],
                capture_output=True,
                text=True,
                timeout=4
            )
            raw_lines = [l.strip() for l in res.stdout.strip().splitlines() if l.strip()]
            if raw_lines:
                try:
                    sec = float(raw_lines[0])
                except ValueError:
                    pass
                if len(raw_lines) > 1 and raw_lines[1].isdigit():
                    br = int(int(raw_lines[1]) / 1000)
                    if br > 0:
                        m, s = divmod(int(sec), 60)
                        dur_str = f"{m // 60}:{m % 60:02d}:{s:02d}" if m >= 60 else f"{m}:{s:02d}"
                        return dur_str, br, fmt
        except Exception:
            pass

    dur_str = ""
    bitrate_kbps = None
    if sec is not None and sec > 0:
        m, s = divmod(int(sec), 60)
        dur_str = f"{m // 60}:{m % 60:02d}:{s:02d}" if m >= 60 else f"{m}:{s:02d}"
        if file_sz > 0:
            bitrate_kbps = int(round((file_sz * 8) / (sec * 1000)))

    return dur_str, bitrate_kbps, fmt

def get_audio_duration_fast(filepath: Path | str) -> str:
    """Extrait la durée d'un fichier audio en format 'M:SS' ou 'H:MM:SS'."""
    dur, _, _ = get_audio_info_fast(filepath)
    return dur

KID3_FIELD_MAP = {
    'titre': 'title', 'title': 'title',
    'artiste': 'artist', 'artist': 'artist',
    'album': 'album',
    'artiste de l\'album': 'album_artist', 'artiste de l’album': 'album_artist', 'album artist': 'album_artist',
    'numéro de piste': 'track_number', 'numero de piste': 'track_number', 'track number': 'track_number', 'track': 'track_number',
    'genre': 'genre',
    'date': 'year', 'année': 'year', 'annee': 'year', 'year': 'year',
    'commentaire': 'comment', 'comment': 'comment'
}

def _finalize_track_metadata(file_path: Path, raw_fields: dict) -> dict:
    """Normalise et nettoie les métadonnées brutes extraites d'un fichier audio."""
    num, fallback_title = parse_track_filename(file_path.name)
    title = raw_fields.get("title", "")
    if is_empty_or_na(title):
        title = fallback_title

    track_number = raw_fields.get("track_number", "")
    if not track_number and num:
        track_number = str(num)

    # Découpage intelligent Artiste / Titre si l'artiste est NA ou si le titre contient 'Artiste - Titre'
    cur_artist = "" if is_empty_or_na(raw_fields.get("artist")) else clean_artist_name(raw_fields.get("artist", ""))
    art, tit = extract_artist_and_title(title, existing_artist=cur_artist)
    artist = clean_artist_name(art)
    title = tit

    raw_album = raw_fields.get("album", "")
    album = raw_album
    if is_empty_or_na(album) or album in {"Extrait Vidéo", "Extrait Video"}:
        album = "Singles & Rips"

    album_artist = raw_fields.get("album_artist", "")
    if is_empty_or_na(album_artist):
        album_artist = artist
    else:
        album_artist = clean_artist_name(album_artist)

    year = raw_fields.get("year", "")
    if year:
        year = extract_4digit_year(year)

    is_vid = file_path.suffix.lower() in {".mp4", ".mkv", ".webm", ".avi", ".mov"}

    dur_str, bitrate_val, fmt_val = get_audio_info_fast(file_path)

    return {
        "filename": file_path.name,
        "filepath": str(file_path.resolve()),
        "is_video": is_vid,
        "type": "video" if is_vid else "audio",
        "title": title,
        "artist": artist,
        "album": album,
        "raw_album": raw_album,
        "album_artist": album_artist,
        "year": year or "",
        "track_number": str(track_number) if track_number else "",
        "genre": raw_fields.get("genre", ""),
        "comment": raw_fields.get("comment", ""),
        "duration": dur_str,
        "bitrate": bitrate_val,
        "format": fmt_val
    }

def get_track_metadata(file_path: Path) -> dict:
    """Récupère les métadonnées d'un fichier audio via kid3-cli en parsant 'get all'."""
    if not file_path.exists():
        return {
            "filename": file_path.name,
            "filepath": str(file_path.resolve()),
            "title": "", "artist": "", "album": "", "raw_album": "",
            "album_artist": "", "year": "", "track_number": "",
            "genre": "", "comment": "", "duration": "", "bitrate": None, "format": ""
        }

    raw_fields = {}
    try:
        res = subprocess.run(
            [KID3_CLI_PATH, "-c", "get all", str(file_path.resolve())],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30
        )
        for line in res.stdout.splitlines():
            m = re.match(r'^\s{2}(.+?)\s{2,}(.+)$', line)
            if m:
                key = m.group(1).strip().lower()
                val = m.group(2).strip()
                if key in KID3_FIELD_MAP:
                    dest_field = KID3_FIELD_MAP[key]
                    raw_fields[dest_field] = val
    except subprocess.TimeoutExpired:
        logger.warning(f"Timeout (30s) pour kid3-cli get_all sur {file_path.name}")
    except Exception as e:
        logger.error(f"kid3-cli get_all sur {file_path.name}: {e}")

    return _finalize_track_metadata(file_path, raw_fields)

def parse_kid3_batch_stdout(stdout: str) -> dict[str, dict]:
    """Parse la sortie de kid3-cli issue d'une session batch multi-fichiers avec select."""
    results = {}
    current_name = None
    current_fields = {}

    for line in stdout.splitlines():
        m_name = re.match(r'^\s*Nom\s*:\s*(.+)$', line, re.IGNORECASE)
        if m_name:
            if current_name:
                results[current_name] = current_fields
            current_name = m_name.group(1).strip()
            current_fields = {}
            continue

        m_field = re.match(r'^\s{2}(.+?)\s{2,}(.+)$', line)
        if m_field and current_name is not None:
            key = m_field.group(1).strip().lower()
            val = m_field.group(2).strip()
            if key in KID3_FIELD_MAP:
                dest = KID3_FIELD_MAP[key]
                current_fields[dest] = val

    if current_name:
        results[current_name] = current_fields

    return results

def get_album_tracks_metadata_batch(audio_files: list[Path]) -> list[dict]:
    """
    Récupère les métadonnées de plusieurs fichiers audio en une seule session batch kid3-cli via stdin.
    Accélération spectaculaire (de ~8s à ~180ms pour 60 fichiers) par rapport à des appels individuels.
    Repli automatique par fichier en cas d'omission.
    """
    if not audio_files:
        return []
    if len(audio_files) == 1:
        return [get_track_metadata(audio_files[0])]

    # Regroupement par dossier parent (gère les albums multi-CDs avec sous-dossiers CD 1, CD 2...)
    by_parent: dict[Path, list[Path]] = {}
    for f in audio_files:
        by_parent.setdefault(f.parent, []).append(f)

    all_parsed: dict[str, dict] = {}
    try:
        for parent_dir, files in by_parent.items():
            cmds = [f'cd "{parent_dir.resolve()}"']
            for f in files:
                cmds.append('select none')
                cmds.append(f'select "{f.name}"')
                cmds.append('get all')
            cmds.append('exit')
            input_text = '\n'.join(cmds) + '\n'

            res = subprocess.run(
                [KID3_CLI_PATH],
                input=input_text,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=30
            )
            parsed = parse_kid3_batch_stdout(res.stdout)
            for fn, fields in parsed.items():
                all_parsed[str((parent_dir / fn).resolve()).lower()] = fields
    except Exception as e:
        logger.warning(f"Erreur session batch kid3-cli ({e}), repli séquentiel...")
        return [get_track_metadata(f) for f in audio_files]

    tracks = []
    for f in audio_files:
        key = str(f.resolve()).lower()
        if key in all_parsed:
            tracks.append(_finalize_track_metadata(f, all_parsed[key]))
        else:
            # Repli individuel garanti si le fichier n'a pas été capturé dans le flux batch
            tracks.append(get_track_metadata(f))

    return tracks


def format_title_with_origin(
    title: str,
    orig_album: Optional[str] = None,
    is_video: bool = False
) -> str:
    """
    Formate le titre pour un single, rip ou titre de playlist :
    - Piste issue d'un album studio : Titre (Nom Album Origine)
    - Piste extraite d'une vidéo/clip ou sans album : Titre [AUDIO RIP]
    - Single officiel autonome : Titre [Single]
    
    Nettoie intelligemment les doublons et préserve le titre sans répétitions.
    """
    if not title:
        return ""

    clean_t = title.strip()

    # Nettoyer les mentions éventuelles en fin de titre comme [RIP], [AUDIO RIP], [Single], [Extrait Vidéo], [Vidéo]
    existing_badge_match = re.search(r'\s*\[(AUDIO\s*RIP|RIP|Single|Extrait\s*Vid[eé]o|Vid[eé]o)\]\s*$', clean_t, flags=re.IGNORECASE)
    existing_badge = None
    if existing_badge_match:
        existing_badge = existing_badge_match.group(1).upper()
        clean_t = clean_t[:existing_badge_match.start()].strip()

    # Si c'est une vidéo complète (MP4), ne pas forcer de badge audio rip
    if is_video:
        return clean_t

    # Analyse de l'album d'origine
    clean_orig = orig_album.strip() if orig_album and not is_empty_or_na(orig_album) else None

    # Filtrer les albums génériques ou invalides
    if clean_orig:
        lower_orig = clean_orig.lower()
        if lower_orig in {
            "singles & rips", "singles and rips", "singles", "extrait vidéo",
            "extrait video", "na", "n/a", "unknown", "unknown album",
            "inconnu", "audio rip", "rip"
        }:
            clean_orig = None

    # Si le titre se termine déjà par un nom d'album entre parenthèses (ex: "Les bobos (Rouge Sang)"), ne pas rajouter [AUDIO RIP]
    has_parenthesized_album = bool(re.search(r'\([^\)]+\)$', clean_t))
    if has_parenthesized_album and (not existing_badge or existing_badge == "AUDIO RIP"):
        return clean_t

    # Déterminer la mention appropriée
    if clean_orig:
        # Est-ce un single officiel autonome ? (ex: "Titre - Single", "Single", ou l'album a le même nom que le titre)
        is_single_release = (
            clean_orig.lower().endswith(" - single") or
            clean_orig.lower() == "single" or
            re.sub(r'\s*-\s*Single$', '', clean_orig, flags=re.IGNORECASE).strip().lower() == clean_t.lower() or
            (existing_badge and "SINGLE" in existing_badge)
        )
        if is_single_release:
            suffix = "[Single]"
        else:
            # Vrai album studio : on met (Nom Album)
            orig_parenthesized = f"({clean_orig})"
            if clean_t.endswith(orig_parenthesized) or f"({clean_orig.lower()})" in clean_t.lower():
                return clean_t
            suffix = orig_parenthesized
    else:
        # Aucun album d'origine trouvé ou extrait d'un clip/vidéo
        if existing_badge and "SINGLE" in existing_badge:
            suffix = "[Single]"
        elif has_parenthesized_album:
            return clean_t
        else:
            suffix = "[AUDIO RIP]"

    # Si le titre finit déjà par ce suffixe, ne pas dupliquer
    if clean_t.endswith(suffix):
        return clean_t

    return f"{clean_t} {suffix}"

def extract_embedded_cover(audio_file: Path, target_cover_path: Path) -> bool:
    """
    Extrait la jaquette intégrée (embedded picture) d'un fichier audio (.m4a, .mp3, .flac, etc.)
    vers target_cover_path à l'aide de ffmpeg.
    """
    if not audio_file.exists() or not audio_file.is_file():
        return False
    if not Path(FFMPEG_PATH).exists():
        return False
    try:
        target_cover_path.parent.mkdir(parents=True, exist_ok=True)
        cmd = [
            str(FFMPEG_PATH),
            "-y",
            "-i", str(audio_file.resolve()),
            "-an",
            "-vcodec", "copy",
            str(target_cover_path.resolve())
        ]
        res = subprocess.run(cmd, capture_output=True, timeout=8)
        if target_cover_path.exists() and target_cover_path.stat().st_size > 1000:
            logger.info(f"Pochette intégrée extraite avec succès depuis '{audio_file.name}' -> '{target_cover_path.name}' ({target_cover_path.stat().st_size} bytes)")
            return True
        elif target_cover_path.exists():
            target_cover_path.unlink()
    except Exception as e:
        logger.warning(f"Erreur extraction pochette intégrée depuis '{audio_file.name}' : {e}")
    return False

def consolidate_album_cover(album_dir: Path) -> Optional[str]:
    """
    Consolide les pochettes d'un album :
    - S'assure qu'un fichier cover.jpg existe à la racine du dossier d'album.
    - Supprime tous les fichiers images individuels par piste (ex: '01 Titre.jpg', '02 Titre.jpg').
    - Si aucun fichier image n'existe, extrait la jaquette intégrée depuis les pistes audio.
    - Retourne le chemin absolu de la pochette principale.
    """
    if not album_dir.exists() or not album_dir.is_dir():
        return None

    target_cover = album_dir / "cover.jpg"
    images = [f for f in album_dir.iterdir() if f.is_file() and f.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]

    if images and not target_cover.exists():
        for img in images:
            if img.stem.lower() in {"cover", "folder", "thumb", "front"}:
                try:
                    shutil.copy2(str(img), str(target_cover))
                    break
                except Exception:
                    pass
        if not target_cover.exists() and images:
            try:
                shutil.copy2(str(images[0]), str(target_cover))
            except Exception:
                pass

    # Vérifier aussi si des sous-dossiers de disques (CD 1, CD 2...) contiennent une pochette
    if not target_cover.exists():
        for d in album_dir.iterdir():
            if d.is_dir() and DISC_SUBFOLDER_RE.match(d.name):
                sub_imgs = [f for f in d.iterdir() if f.is_file() and f.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]
                if sub_imgs:
                    for img in sub_imgs:
                        if img.stem.lower() in {"cover", "folder", "thumb", "front"}:
                            try:
                                shutil.copy2(str(img), str(target_cover))
                                break
                            except Exception:
                                pass
                    if not target_cover.exists():
                        try:
                            shutil.copy2(str(sub_imgs[0]), str(target_cover))
                        except Exception:
                            pass
                if target_cover.exists():
                    break

    # Vérifier aussi si un dossier frère 'Unknown Album' a une image
    if not target_cover.exists():
        unknown_dir = album_dir.parent / "Unknown Album"
        if unknown_dir.exists() and unknown_dir.is_dir():
            for f in unknown_dir.iterdir():
                if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
                    try:
                        shutil.copy2(str(f), str(target_cover))
                        break
                    except Exception:
                        pass

    # Si toujours aucune jaquette sur disque, extraire la pochette intégrée depuis les pistes audio
    if not target_cover.exists():
        audio_files = [f for f in album_dir.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS]
        if not audio_files:
            for d in album_dir.iterdir():
                if d.is_dir() and DISC_SUBFOLDER_RE.match(d.name):
                    audio_files.extend([f for f in d.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS])
        for af in audio_files:
            if extract_embedded_cover(af, target_cover):
                break

    # Si toujours aucune jaquette sur disque, chercher s'il y a un fichier vidéo compagnon dans le dossier
    if not target_cover.exists():
        try:
            from backend.video_indexer import VIDEO_EXTENSIONS, extract_thumbnail_from_video, generate_rip_audio_cover
            video_files = [f for f in album_dir.iterdir() if f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS]
            for vf in video_files:
                temp_thumb = album_dir / "_temp_video_thumb.jpg"
                if extract_thumbnail_from_video(vf, temp_thumb):
                    art = album_dir.parent.name if album_dir.name.lower() in {"singles & rips", "singles", "singles and rips"} else album_dir.name
                    generate_rip_audio_cover(temp_thumb, target_cover, artist_name=art, subtitle="Single Vidéo")
                    try:
                        temp_thumb.unlink()
                    except Exception:
                        pass
                    break
        except Exception:
            pass

    # Supprimer les images individuelles par piste (garder uniquement cover.jpg / folder.jpg)
    for img in album_dir.iterdir():
        if img.is_file() and img.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
            if img.name.lower() not in {"cover.jpg", "folder.jpg"}:
                try:
                    img.unlink()
                except Exception:
                    pass

    # Phase d'auto-normalisation 1:1 : élimine le pillarbox (bandes latérales YouTube) et met à jour les tags
    if target_cover.exists():
        try:
            normalize_cover_artwork(target_cover, embed_in_tracks=True)
        except Exception as e:
            logger.debug(f"Erreur normalize_cover_artwork dans consolidate_album_cover: {e}")

    return str(target_cover.resolve()) if target_cover.exists() else None

def normalize_cover_artwork(
    cover_path: Path | str,
    embed_in_tracks: bool = True
) -> bool:
    """
    Détecte et normalise automatiquement les jaquettes présentant des bandes
    latérales (pillarbox 9:16) ou horizontales (letterbox 16:9), typiques des
    téléchargements YouTube, pour les convertir en plein carré 1:1 (Full Bleed).
    Réinjecte la nouvelle pochette 1:1 dans les tags des pistes de l'album via kid3-cli
    pour un affichage optimal et sans marge sur les applications mobiles (CloudBeats).
    """
    cov = Path(cover_path)
    if not cov.exists() or not cov.is_file():
        return False

    album_dir = cov.parent
    marker = album_dir / ".cover_normalized"
    if marker.exists() and marker.stat().st_mtime >= cov.stat().st_mtime:
        return False

    try:
        from PIL import Image
        import numpy as np

        with Image.open(cov) as im:
            w, h = im.size
            if w < 100 or h < 100:
                return False

            # RÈGLE D'OR ABSOLUE : JAMAIS la hauteur (y: 0 -> h) ne doit être tronquée.
            # Tous les éléments visuels cruciaux (titre, artiste, détails) s'étendent sur toute la hauteur.
            # Seule la largeur (axe horizontal x) est ajustée pour atteindre le format carré 1:1.

            # 1. Si déjà carré (tolérance 2px), aucun traitement : jaquette parfaite
            if abs(w - h) <= 2:
                return False

            square_img = None

            # 2. Cas horizontal / panoramique (w > h, ex: miniatures 16:9 YouTube) :
            # La hauteur h est 100% conservée (y de 0 à h).
            # On découpe le carré centré de dimension h x h, ce qui élimine les bandes latérales
            # tout en préservant l'intégralité du visuel vertical d'origine.
            if w > h:
                cx = (w - h) // 2
                square_img = im.crop((cx, 0, cx + h, h))
            else:
                # 3. Cas vertical (h > w) : la hauteur est sacrée et ne doit pas être coupée.
                # On ajuste la largeur vers h pour un format carré sans aucune perte en haut ni en bas.
                square_img = im.resize((h, h), Image.Resampling.LANCZOS)

            if square_img is not None:
                square_img.save(cov, "JPEG", quality=95)
                logger.info(f"Pochette normalisée 1:1 plein carré pour l'album : {album_dir.name}")

                if embed_in_tracks and Path(KID3_CLI_PATH).exists():
                    audio_files = [f for f in album_dir.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS]
                    for d in album_dir.iterdir():
                        if d.is_dir() and DISC_SUBFOLDER_RE.match(d.name):
                            audio_files.extend([f for f in d.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS])
                    if audio_files:
                        cmd = [str(KID3_CLI_PATH), "-c", f'set picture:"{str(cov.resolve())}" ""'] + [str(af.resolve()) for af in audio_files]
                        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
                        logger.info(f"Tags audio mis à jour avec la pochette 1:1 ({len(audio_files)} pistes) dans {album_dir.name}")

                try:
                    marker.touch()
                except Exception:
                    pass
                return True

            try:
                marker.touch()
            except Exception:
                pass
            return False

    except Exception as e:
        logger.warning(f"Erreur normalisation jaquette pour {album_dir.name}: {e}")
        return False

def extract_track_num(track: dict) -> Optional[int]:
    """Extrait le numéro de piste depuis le nom de fichier ou les métadonnées."""
    num, _ = parse_track_filename(track.get("filename", ""))
    if num is not None and num > 0:
        return num
    tn = track.get("track_number")
    if tn:
        m = re.match(r"^(\d+)", str(tn).strip())
        if m:
            val = int(m.group(1))
            if val > 0:
                return val
    return None

def check_track_gaps(tracks: list) -> tuple[list[int], int]:
    """
    Vérifie s'il y a des trous dans la numérotation des pistes.
    Retourne (liste_des_pistes_manquantes, max_track_num).
    Exemple: pour des pistes 01, 03, 04 -> ([2], 4).
    """
    if not tracks or len(tracks) <= 1:
        return [], len(tracks)

    track_nums = set()
    total_from_meta = 0
    for t in tracks:
        num = extract_track_num(t)
        if num is not None and num > 0:
            track_nums.add(num)
        tn = t.get("track_number", "")
        m = re.match(r"^\d+/(\d+)$", str(tn).strip())
        if m:
            total_from_meta = max(total_from_meta, int(m.group(1)))

    if not track_nums:
        return [], len(tracks)

    max_num = max(track_nums)
    if total_from_meta > max_num:
        max_num = total_from_meta

    # Si max_num est disproportionné par rapport au nombre de pistes
    if max_num > len(tracks) + 50:
        return [], len(tracks)

    missing = [n for n in range(1, max_num + 1) if n not in track_nums]
    return missing, max_num

# Cache mémoire haute performance pour get_album_info :
# p_key -> (dir_mtime, file_count, draft_mtime, playlist_meta_mtime, result_dict)
_ALBUM_INFO_CACHE: dict[str, tuple[float, int, float, float, dict]] = {}

def invalidate_album_cache(album_dir: Optional[Path | str] = None) -> None:
    """
    Invalide le cache mémoire des infos d'albums.
    Si album_dir est fourni, invalide ce dossier et ses sous-dossiers.
    Sinon, vide tout le cache.
    """
    global _ALBUM_INFO_CACHE
    if album_dir is None:
        _ALBUM_INFO_CACHE.clear()
        return
    try:
        p_norm = str(Path(album_dir).resolve()).lower()
        keys_to_remove = [k for k in _ALBUM_INFO_CACHE if k == p_norm or k.startswith(p_norm) or p_norm.startswith(k)]
        for k in keys_to_remove:
            _ALBUM_INFO_CACHE.pop(k, None)
    except Exception:
        _ALBUM_INFO_CACHE.clear()

def get_album_info(album_dir: Path | str) -> dict:
    """Inspecte un dossier d'album ou un fichier média unique et retourne la liste des morceaux et métadonnées globales."""
    if not album_dir or not str(album_dir).strip():
        return {"error": "Chemin d'album invalide ou vide", "tracks": []}

    p = Path(album_dir)
    if not p.exists():
        return {"error": "Dossier ou fichier introuvable", "tracks": []}

    is_single_file_mode = p.is_file()
    if is_single_file_mode:
        album_dir = p.parent
        audio_files = [p]
    else:
        album_dir = p
        audio_files = [f for f in album_dir.iterdir() if f.is_file() and f.suffix.lower() in (AUDIO_EXTENSIONS | {".avi", ".mov", ".m4v"})]

    p_key = str(p.resolve()).lower()
    try:
        dir_mtime = p.stat().st_mtime
    except Exception:
        dir_mtime = 0.0

    target_dir = p.parent if is_single_file_mode else p
    draft_file = target_dir / ".editor_draft.json"
    draft_mtime = draft_file.stat().st_mtime if draft_file.exists() else 0.0

    meta_file = target_dir / ".playlist_meta.json"
    meta_mtime = meta_file.stat().st_mtime if meta_file.exists() else 0.0
    
    def sort_key(f: Path):
        num, _ = parse_track_filename(f.name)
        return (0, num) if num is not None else (1, f.name.lower())
    
    audio_files.sort(key=sort_key)

    is_multidisc_virtual = False
    if not audio_files:
        disc_subfolders = [d for d in album_dir.iterdir() if d.is_dir() and DISC_SUBFOLDER_RE.match(d.name)]
        if disc_subfolders:
            is_multidisc_virtual = True
            def disc_k(d: Path):
                m = DISC_SUBFOLDER_RE.match(d.name)
                return int(m.group(1)) if (m and m.group(1)) else 999
            disc_subfolders.sort(key=disc_k)
            for d in disc_subfolders:
                sub_audio = [f for f in d.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS]
                sub_audio.sort(key=sort_key)
                audio_files.extend(sub_audio)

    # Vérification ultra-rapide dans le cache mémoire st_mtime (< 0.5ms)
    if p_key in _ALBUM_INFO_CACHE:
        c_dmtime, c_count, c_draft_mtime, c_meta_mtime, cached_data = _ALBUM_INFO_CACHE[p_key]
        if (c_dmtime == dir_mtime and c_count == len(audio_files) and 
            c_draft_mtime == draft_mtime and c_meta_mtime == meta_mtime):
            return cached_data

    tracks = get_album_tracks_metadata_batch(audio_files)
    if is_multidisc_virtual:
        for idx, t in enumerate(tracks, start=1):
            t["track"] = str(idx)
            t["total_tracks"] = str(len(tracks))
    
    valid_albums = [t["album"] for t in tracks if not is_empty_or_na(t["album"])]
    valid_artists = [clean_artist_name(t["artist"]) for t in tracks if not is_empty_or_na(t["artist"])]
    valid_album_artists = [clean_artist_name(t["album_artist"]) for t in tracks if not is_empty_or_na(t["album_artist"])]
    years = [extract_4digit_year(t["year"]) for t in tracks if t["year"]]
    years = [y for y in years if y]
    genres = [t["genre"] for t in tracks if t["genre"] and not is_empty_or_na(t["genre"])]

    cover_art = consolidate_album_cover(album_dir)

    is_playlist_folder = False
    saved_playlist_title = None
    if meta_file.exists():
        try:
            with open(meta_file, "r", encoding="utf-8") as f:
                meta_data = json.load(f)
                is_playlist_folder = bool(meta_data.get("is_playlist"))
                saved_playlist_title = meta_data.get("playlist_title")
        except Exception:
            is_playlist_folder = True
    elif "[playlist]" in album_dir.name.lower() or (len(tracks) > 1 and len(set(valid_albums)) > 1):
        is_playlist_folder = True

    if is_playlist_folder:
        if saved_playlist_title and not is_empty_or_na(saved_playlist_title):
            album_name = saved_playlist_title
        elif not is_empty_or_na(album_dir.name):
            clean_name = album_dir.name
            clean_name = re.sub(r'\s*\[(Playlist|Mix|Compilation)\]', '', clean_name, flags=re.IGNORECASE).strip()
            if " - " in clean_name and valid_album_artists:
                top_art = max(set(valid_album_artists), key=valid_album_artists.count)
                parts = clean_name.split(" - ", 1)
                if parts[0].strip().lower() == top_art.lower():
                    clean_name = parts[1].strip()
            album_name = clean_name if not is_empty_or_na(clean_name) else "Playlist"
        else:
            album_name = "Playlist"

        if not re.search(r'\s*\[playlist\]\s*$', album_name, flags=re.IGNORECASE):
            album_name = f"{album_name} [Playlist]"

        if valid_album_artists and any(a not in {"Various Artists", "Artiste inconnu"} for a in valid_album_artists):
            top_alb_art = max(set(valid_album_artists), key=valid_album_artists.count)
            if top_alb_art and top_alb_art not in {"Various Artists", "Artiste inconnu"}:
                album_artist = clean_artist_name(top_alb_art)
            elif valid_artists:
                from collections import Counter
                counts = Counter(valid_artists)
                top_artist, top_count = counts.most_common(1)[0]
                if top_count / len(valid_artists) >= 0.70:
                    album_artist = clean_artist_name(top_artist)
                else:
                    album_artist = "Various Artists"
            else:
                album_artist = "Various Artists"
        elif valid_artists:
            from collections import Counter
            counts = Counter(valid_artists)
            top_artist, top_count = counts.most_common(1)[0]
            if top_count / len(valid_artists) >= 0.70:
                album_artist = clean_artist_name(top_artist)
            else:
                album_artist = "Various Artists"
        else:
            album_artist = "Various Artists"
    else:
        real_albums = [a for a in valid_albums if a not in {"Singles & Rips", "Extrait Vidéo", "Extrait Video"}]
        if real_albums:
            album_name = max(set(real_albums), key=real_albums.count)
        elif not is_empty_or_na(album_dir.name) and not any(k in album_dir.name.lower() for k in ["[audio rip]", "[rip]", "[extrait vidéo]", "[extrait video]", "[vidéo]", "[video]"]):
            album_name = album_dir.name
        else:
            album_name = "Singles & Rips"

        if valid_album_artists:
            album_artist = max(set(valid_album_artists), key=valid_album_artists.count)
        elif valid_artists:
            album_artist = max(set(valid_artists), key=valid_artists.count)
        else:
            album_artist = "Artiste inconnu"
        album_artist = clean_artist_name(album_artist)

    year = max(set(years), key=years.count) if years else ""
    # Prioriser un genre culturel spécifique (ex: Variété française) s'il est présent aux côtés de genres génériques (Pop)
    if genres:
        specific_genres = [g for g in genres if g.lower() not in {"pop", "rock", "alternatif", "alternative"}]
        if specific_genres:
            genre = max(set(specific_genres), key=specific_genres.count)
        else:
            genre = max(set(genres), key=genres.count)
    else:
        genre = ""

    if not genre and not is_playlist_folder and album_name not in {"Singles & Rips", "Extrait Vidéo"}:
        auto_alb_g = detect_genre_sync(album_artist, album_name, is_album=True)
        if not auto_alb_g and tracks:
            auto_alb_g = detect_genre_sync(album_artist, tracks[0].get("title", ""), is_album=False)
        if auto_alb_g:
            genre = auto_alb_g
    elif not genre and is_playlist_folder and album_artist and album_artist not in {"Various Artists", "Artiste inconnu"}:
        auto_alb_g = detect_genre_sync(album_artist, "", is_album=False)
        if auto_alb_g:
            genre = auto_alb_g

    missing_tracks, max_track = check_track_gaps(tracks)
    warning = None
    if missing_tracks and not is_playlist_folder:
        missing_str = ", ".join(f"{n:02d}" for n in missing_tracks)
        warning = f"Pistes manquantes détectées ({len(missing_tracks)}) : {missing_str}. L'album ou la playlist semble incomplet sur la source."

    editor_draft = None
    if draft_file.exists():
        try:
            with open(draft_file, "r", encoding="utf-8") as df:
                editor_draft = json.load(df)
        except Exception as e:
            logger.warning(f"Lecture .editor_draft.json: {e}")

    CONCERT_KEYWORDS_RE = re.compile(
        r'\b(concert|live|tour|festival|show|session|recital|spectacle|acoustique|unplugged|en\s+public|in\s+concert|full\s+concert|concert\s+complet)\b',
        re.IGNORECASE
    )
    is_video_folder = (
        "[vidéo]" in str(album_dir).lower()
        or "[video]" in str(album_dir).lower()
        or any(f.suffix.lower() in {".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v"} for f in audio_files)
    )
    is_concert = False
    if is_video_folder:
        dir_name = album_dir.name.lower()
        parent_name = album_dir.parent.name.lower()
        if "concert" in dir_name or "concerts" in parent_name or CONCERT_KEYWORDS_RE.search(album_dir.name):
            is_concert = True
        else:
            for tr in tracks:
                tr_title = tr.get("title", "")
                if CONCERT_KEYWORDS_RE.search(tr_title):
                    is_concert = True
                    break
                dur_str = tr.get("duration", "")
                if dur_str:
                    parts = [int(p) for p in dur_str.split(":") if p.isdigit()]
                    if len(parts) >= 3 or (len(parts) == 2 and parts[0] >= 10):
                        is_concert = True
                        break

    if is_single_file_mode:
        album_name = p.stem
        if tracks:
            album_artist = tracks[0].get("artist") or "Artiste inconnu"
            year = tracks[0].get("year") or ""
            genre = tracks[0].get("genre") or ""

    # Détection ou lecture du type d'album (Auto vs Manuel)
    target_check_dir = p.parent if is_single_file_mode else album_dir
    manual_type = None
    type_file = target_check_dir / ".album_type"
    if type_file.exists():
        try:
            val = type_file.read_text(encoding="utf-8").strip().lower()
            if val in ("album", "single", "rip", "playlist", "concert"):
                manual_type = val
        except Exception:
            pass

    detected_type = manual_type or classify_album_type(
        title=album_name,
        path=str(target_check_dir),
        track_count=len(tracks),
        is_concert=is_concert,
        is_playlist=is_playlist_folder
    )

    result_info = {
        "album_dir": str(p.resolve()) if is_single_file_mode else str(album_dir.resolve()),
        "is_single_file": is_single_file_mode,
        "album_name": album_name,
        "album_artist": album_artist,
        "year": year,
        "genre": genre,
        "total_tracks": len(tracks),
        "max_track": max_track,
        "missing_tracks": [] if (is_playlist_folder or is_single_file_mode) else missing_tracks,
        "warning": warning,
        "cover_art": cover_art,
        "tracks": tracks,
        "is_playlist": is_playlist_folder,
        "is_video": is_video_folder,
        "is_concert": is_concert,
        "album_type": detected_type,
        "is_manual_type": bool(manual_type),
        "manual_type": manual_type,
        "editor_draft": editor_draft
    }
    _ALBUM_INFO_CACHE[p_key] = (dir_mtime, len(audio_files), draft_mtime, meta_mtime, result_info)
    return result_info

def save_editor_draft(album_dir: Path, draft: dict) -> dict:
    if not album_dir.exists() or not album_dir.is_dir():
        return {"success": False, "message": f"Dossier {album_dir} introuvable"}
    draft_file = album_dir / ".editor_draft.json"
    try:
        with open(draft_file, "w", encoding="utf-8") as df:
            json.dump(draft, df, ensure_ascii=False, indent=2)
        invalidate_album_cache(album_dir)
        return {"success": True}
    except Exception as e:
        logger.warning(f"Erreur écriture .editor_draft.json: {e}")
        return {"success": False, "message": str(e)}

def clear_editor_draft(album_dir: Path) -> dict:
    draft_file = album_dir / ".editor_draft.json"
    if draft_file.exists():
        try:
            draft_file.unlink()
        except Exception as e:
            logger.warning(f"Suppression .editor_draft.json: {e}")
    invalidate_album_cache(album_dir)
    return {"success": True}

def _kid3_escape(value: str) -> str:
    """Échappe les guillemets pour les commandes Kid3."""
    return str(value).replace('"', '\\"')

def get_missing_tracks_details(album_dir: Path) -> dict:
    """
    Inspecte un dossier d'album incomplet, identifie les pistes manquantes,
    et tente de résoudre leurs titres/artistes attendus via MusicBrainz
    pour pré-remplir la recherche de substituts.
    """
    if not album_dir.exists() or not album_dir.is_dir():
        return {"success": False, "message": f"Dossier {album_dir} introuvable", "missing_tracks": []}

    info = get_album_info(album_dir)
    missing = info.get("missing_tracks", [])
    max_track = info.get("max_track", len(info.get("tracks", [])))
    album_name = info.get("album_name", "")
    album_artist = info.get("album_artist", "")
    cover_art = info.get("cover_art")

    # Vérifier si des métadonnées locales d'album existent (.album_meta.json)
    local_meta_tracks = {}
    meta_file = album_dir / ".album_meta.json"
    if meta_file.exists():
        try:
            with open(meta_file, "r", encoding="utf-8") as mf:
                local_meta = json.load(mf)
                for tr in local_meta.get("tracks", []):
                    tn = tr.get("track_number")
                    if tn:
                        local_meta_tracks[tn] = tr
        except Exception as e:
            logger.warning(f"Lecture .album_meta.json: {e}")

    # Vérifier si des substituts en attente sont déjà mémorisés (.reconstitute_pending.json)
    pending_substitutes = {}
    pending_file = album_dir / ".reconstitute_pending.json"
    if pending_file.exists():
        try:
            with open(pending_file, "r", encoding="utf-8") as pf:
                pending_substitutes = json.load(pf)
        except Exception as e:
            logger.warning(f"Lecture .reconstitute_pending.json: {e}")

    mb_tracks = fetch_musicbrainz_release_tracks_sync(album_name, album_artist, expected_track_count=max_track)

    core_album, is_ost = extract_core_album_title(album_name)
    clean_album = core_album if core_album else album_name
    is_va = album_artist.lower() in {"various artists", "various", "artiste inconnu", "divers artistes", "soundtrack", "ost"}

    missing_details = []
    for num in missing:
        mb_info = mb_tracks.get(num) if mb_tracks else None
        local_tr = local_meta_tracks.get(num)

        exp_title = (mb_info.get("title") if mb_info else None) or (local_tr.get("title") if local_tr else None) or f"Piste {num:02d}"
        exp_artist = (mb_info.get("artist") if mb_info else None) or (local_tr.get("artist") if local_tr else None) or (clean_album if is_va else album_artist)
        exp_duration = (mb_info.get("duration") if mb_info else None) or (local_tr.get("duration") if local_tr else None) or ""

        # Élaboration intelligente et chirurgicale de la requête de recherche YouTube
        if exp_title and not exp_title.startswith("Piste "):
            # Si nous avons le vrai titre identifié (ex: Gypsy Soul)
            if exp_artist and exp_artist.lower() not in {"various artists", "various", "artiste inconnu", "divers artistes"}:
                query = f"{exp_artist} {exp_title}".strip()
            else:
                query = f"{clean_album} {exp_title}".strip()
        else:
            # Si le titre n'est pas encore identifié
            if is_ost:
                query = f"{clean_album} soundtrack track {num}".strip()
            elif is_va:
                query = f"{clean_album} track {num}".strip()
            else:
                query = f"{album_artist} {clean_album} track {num}".strip()

        missing_details.append({
            "track_number": num,
            "expected_title": exp_title,
            "expected_artist": exp_artist,
            "expected_duration": exp_duration,
            "search_query": query
        })

    return {
        "success": True,
        "album_dir": str(album_dir.resolve()),
        "album_name": album_name,
        "album_artist": album_artist,
        "year": info.get("year", ""),
        "genre": info.get("genre", ""),
        "cover_art": cover_art,
        "total_tracks": max_track,
        "existing_count": len(info.get("tracks", [])),
        "missing_count": len(missing),
        "missing_tracks": missing_details,
        "pending_substitutes": pending_substitutes
    }

def save_pending_substitutes(album_dir: Path, substitutes: dict) -> dict:
    if not album_dir.exists() or not album_dir.is_dir():
        return {"success": False, "message": f"Dossier {album_dir} introuvable"}
    pending_file = album_dir / ".reconstitute_pending.json"
    try:
        with open(pending_file, "w", encoding="utf-8") as pf:
            json.dump(substitutes, pf, ensure_ascii=False, indent=2)
        invalidate_album_cache(album_dir)
        return {"success": True}
    except Exception as e:
        return {"success": False, "message": str(e)}

def clear_pending_substitutes(album_dir: Path) -> dict:
    pending_file = album_dir / ".reconstitute_pending.json"
    if pending_file.exists():
        try:
            pending_file.unlink()
        except Exception as e:
            logger.warning(f"Suppression .reconstitute_pending.json: {e}")
    invalidate_album_cache(album_dir)
    return {"success": True}

def integrate_substitute_track(
    album_dir: Path,
    track_number: int,
    total_tracks: int,
    video_id: str,
    title: str,
    artist: str,
    album_name: Optional[str] = None,
    album_artist: Optional[str] = None,
    year: Optional[str] = None,
    genre: Optional[str] = None
) -> dict:
    """
    Télécharge une piste de substitution individuelle via yt-dlp,
    lui applique la mention '[Piste substituée]' dans son tag de titre et nom de fichier,
    lui injecte les métadonnées globales de l'album cible via kid3-cli,
    et l'intègre au bon numéro de piste dans le dossier de l'album.
    """
    if not album_dir or not str(album_dir).strip():
        return {"success": False, "message": "Chemin d'album invalide ou vide"}

    p = Path(album_dir)
    if not p.exists() or not p.is_dir():
        return {"success": False, "message": f"Dossier {album_dir} introuvable"}
    album_dir = p

    info = get_album_info(album_dir)
    final_album = album_name or info.get("album_name") or "Album inconnu"
    final_album_artist = album_artist or info.get("album_artist") or "Various Artists"
    final_year = year or info.get("year") or ""
    final_genre = genre or info.get("genre") or ""

    clean_tit = clean_track_title(title)
    clean_tit = re.sub(r'\s*\[(Piste substituée|Substitut)\]\s*$', '', clean_tit, flags=re.IGNORECASE).strip()
    final_title = f"{clean_tit} [Piste substituée]"

    safe_title = re.sub(r'[\\/*?:"<>|]', "", final_title).strip()
    if not safe_title:
        safe_title = f"Piste {track_number:02d} [Piste substituée]"

    # Détection dynamique du format audio du reste de l'album pour cohérence parfaite
    existing_audio = [f for f in album_dir.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS and not f.name.startswith("__temp_sub")]
    if existing_audio:
        detected_ext = existing_audio[0].suffix.lstrip(".").lower()
    else:
        detected_ext = getattr(config, "default_format", "m4a").lower()

    fmt_map = {
        "m4a": "m4a",
        "mp3": "mp3",
        "flac": "flac",
        "opus": "opus",
        "ogg": "vorbis",
        "wav": "wav",
        "aac": "aac"
    }
    target_format = fmt_map.get(detected_ext, "m4a")
    target_quality = "0" if target_format == "flac" else getattr(config, "default_quality", "128K")

    temp_stem = f"__temp_sub_{track_number}_{int(time.time())}"
    temp_tmpl = str(album_dir / f"{temp_stem}.%(ext)s")
    video_url = f"https://music.youtube.com/watch?v={video_id}"

    cmd_args = [
        YT_DLP_PATH,
        "-x",
        "-f", "ba",
        "--audio-format", target_format,
        "--audio-quality", target_quality,
        "--windows-filenames",
        "--no-playlist",
        "-o", temp_tmpl
    ]
    if Path(FFMPEG_PATH).exists():
        cmd_args += ["--ffmpeg-location", FFMPEG_PATH]
    cmd_args.append(video_url)

    logger.info(f"Téléchargement du substitut #{track_number} ({video_id}) via yt-dlp...")
    try:
        res = subprocess.run(cmd_args, capture_output=True, text=True, timeout=120)
        if res.returncode != 0:
            logger.error(f"yt-dlp error pour substitut #{track_number}: {res.stderr}")
            return {"success": False, "message": f"Erreur de téléchargement : {res.stderr[:200]}"}
    except Exception as e:
        logger.error(f"Exception lors du téléchargement du substitut #{track_number}: {e}")
        return {"success": False, "message": str(e)}

    downloaded_files = [f for f in album_dir.iterdir() if f.name.startswith(temp_stem) and f.suffix.lower() in AUDIO_EXTENSIONS]
    if not downloaded_files:
        return {"success": False, "message": "Fichier audio téléchargé introuvable après yt-dlp"}

    temp_audio = downloaded_files[0]
    ext = temp_audio.suffix
    dest_filename = f"{track_number:02d} {safe_title}{ext}"
    dest_path = album_dir / dest_filename

    tag_num_str = f"{track_number:02d}/{total_tracks:02d}"
    kid3_cmds = [
        KID3_CLI_PATH,
        "-c", f"select \"{temp_audio.name}\"",
        "-c", f"set title \"{_kid3_escape(final_title)}\"",
        "-c", f"set artist \"{_kid3_escape(artist)}\"",
        "-c", f"set album \"{_kid3_escape(final_album)}\"",
        "-c", f"set 'album artist' \"{_kid3_escape(final_album_artist)}\"",
        "-c", f"set 'track number' \"{tag_num_str}\"",
        "-c", f"set 'disc number' \"1/1\"",
        "-c", "set comment \"\""
    ]
    if final_year:
        kid3_cmds.extend(["-c", f"set year \"{_kid3_escape(final_year)}\""])
    if final_genre:
        kid3_cmds.extend(["-c", f"set genre \"{_kid3_escape(final_genre)}\""])

    target_cover = album_dir / "cover.jpg"
    if not target_cover.exists():
        target_cover = album_dir / "folder.jpg"
    if target_cover.exists():
        kid3_cmds.extend(["-c", f"set picture:\"{_kid3_escape(str(target_cover.resolve()))}\" \"\""])

    kid3_cmds.extend(["-c", "save"])

    try:
        subprocess.run(kid3_cmds, cwd=str(album_dir), capture_output=True, text=True, check=True, timeout=30)
    except Exception as e:
        logger.error(f"kid3-cli error on substitute track #{track_number}: {e}")

    if dest_path.exists() and dest_path.resolve() != temp_audio.resolve():
        try:
            dest_path.unlink()
        except Exception:
            pass
    try:
        temp_audio.rename(dest_path)
    except Exception as e:
        logger.error(f"Erreur renommage substitut {temp_audio.name} -> {dest_path.name}: {e}")
        dest_filename = temp_audio.name

    for img in album_dir.glob(f"{temp_stem}.*"):
        try:
            img.unlink()
        except Exception:
            pass

    invalidate_album_cache(album_dir)
    logger.info(f"Substitut #{track_number} intégré avec succès : {dest_filename}")
    return {
        "success": True,
        "track_number": track_number,
        "filename": dest_filename,
        "title": final_title,
        "artist": artist
    }

def uniformize_album(
    album_dir: Path | str,
    custom_album: Optional[str] = None,
    custom_artist: Optional[str] = None,
    custom_year: Optional[str] = None,
    custom_genre: Optional[str] = None,
    rename_files: bool = True,
    naming_pattern: str = "{track:02d} {title}",
    clean_titles: bool = True,
    custom_tracks: Optional[list] = None,
    is_playlist: Optional[bool] = None,
    origin_album: Optional[str] = None,
    custom_album_type: Optional[str] = None
) -> dict:
    """Applique le retaggage uniforme sur toutes les pistes d'un album ou d'une playlist via kid3-cli."""
    if not album_dir or not str(album_dir).strip():
        return {"success": False, "message": "Chemin d'album invalide ou vide."}
    p = Path(album_dir)
    if not p.exists():
        return {"success": False, "message": "Dossier ou fichier introuvable."}
    is_single_file_mode = p.is_file()
    album_dir = p.parent if is_single_file_mode else p

    info = get_album_info(p)
    tracks = info.get("tracks", [])
    if not tracks:
        return {"success": False, "message": "Aucun fichier média trouvé dans le dossier."}

    # ── Déduplication automatique renforcée ─────────────────────────────────
    # yt-dlp télécharge parfois la même piste deux fois (anomalie YouTube).
    # Trois niveaux de détection :
    #   1. Titre normalisé identique (sans accents, ponctuation, espaces)
    #   2. Taille de fichier identique au byte près (même contenu, titres légèrement différents)
    #   3. Taille quasi-identique (<1% d'écart) + titre similaire (≥70% de mots communs)
    dedup_warnings = []
    tracks_to_remove = []
    _GENERIC_ARTISTS = {"na", "n/a", "various artists", "artiste inconnu", ""}

    def _artist_quality(t: dict) -> int:
        """Score de qualité de l'artiste (plus élevé = meilleur)."""
        a = (t.get("artist") or "").strip().lower()
        if a in _GENERIC_ARTISTS:
            return 0
        if a.endswith("- topic") or a.endswith("-topic"):
            return 1
        return 2

    # Table de translittération pour normaliser les accents
    _ACCENT_MAP = str.maketrans(
        "àâäéèêëîïôùûüç", "aaaeeeeiioouuc"
    )

    def _normalize_title(title: str) -> str:
        """Normalise un titre : minuscules, sans accents, sans ponctuation, espaces uniques."""
        t = (title or "").lower().translate(_ACCENT_MAP)
        t = re.sub(r"[^\w\s]", " ", t)   # ponctuation → espace
        t = re.sub(r"\s+", " ", t).strip()
        return t

    def _file_size(t: dict) -> int:
        """Retourne la taille du fichier audio en bytes (0 si inaccessible)."""
        try:
            return Path(t["filepath"]).stat().st_size
        except Exception:
            return 0

    def _title_similarity(a: str, b: str) -> float:
        """Ratio de mots communs entre deux titres normalisés (0.0 – 1.0)."""
        wa = set(_normalize_title(a).split())
        wb = set(_normalize_title(b).split())
        if not wa or not wb:
            return 0.0
        return len(wa & wb) / max(len(wa), len(wb))

    def _is_duplicate(t1: dict, t2: dict) -> bool:
        """Retourne True si t1 et t2 sont des doublons selon les 3 critères."""
        # Critère 1 : titre normalisé identique
        if _normalize_title(t1.get("title", "")) == _normalize_title(t2.get("title", "")):
            return True
        # Critère 2 : taille identique au byte près ET titre ayant une parenté évidente (≥30% mots communs ou inclusion)
        s1, s2 = _file_size(t1), _file_size(t2)
        if s1 > 0 and s1 == s2:
            norm1 = _normalize_title(t1.get("title", ""))
            norm2 = _normalize_title(t2.get("title", ""))
            sim = _title_similarity(t1.get("title", ""), t2.get("title", ""))
            if sim >= 0.30 or (norm1 and norm1 in norm2) or (norm2 and norm2 in norm1):
                logger.info(f"Doublon par taille exacte et titre similaire : '{t1.get('title')}' == '{t2.get('title')}' ({s1} bytes)")
                return True
        # Critère 3 : taille très proche (<1%) + titre similaire (≥70% mots communs)
        if s1 > 0 and s2 > 0:
            size_diff_pct = abs(s1 - s2) / max(s1, s2)
            sim = _title_similarity(t1.get("title", ""), t2.get("title", ""))
            if size_diff_pct < 0.002 and sim >= 0.85:
                logger.info(f"Doublon probable (taille Δ={size_diff_pct:.3%}, sim={sim:.0%}) : "
                           f"'{t1.get('title')}' ≈ '{t2.get('title')}'")
                return True
        return False

    # Comparer chaque paire de pistes
    n = len(tracks)
    removed_set = set()
    for i in range(n):
        if i in removed_set:
            continue
        for j in range(i + 1, n):
            if j in removed_set:
                continue
            if _is_duplicate(tracks[i], tracks[j]):
                # Garder la piste avec le meilleur artiste ; en cas d'égalité, garder la première (i)
                if _artist_quality(tracks[j]) > _artist_quality(tracks[i]):
                    removed_set.add(i)
                    break  # tracks[i] supprimé, passer au prochain i
                else:
                    removed_set.add(j)

    tracks_to_remove = [tracks[k] for k in removed_set]

    if tracks_to_remove:
        removed_titles = []
        for dup in tracks_to_remove:
            dup_path = Path(dup["filepath"])
            removed_titles.append(dup_path.name)
            logger.warning(
                f"Doublon supprimé : '{dup_path.name}' "
                f"(artiste='{dup.get('artist')}', taille={_file_size(dup):,} bytes, qualité={_artist_quality(dup)})"
            )
            try:
                dup_path.unlink(missing_ok=True)
            except Exception as e:
                logger.error(f"Impossible de supprimer le doublon {dup_path.name}: {e}")
        dedup_warnings.append(
            f"Doublon(s) supprimé(s) automatiquement : {', '.join(removed_titles)}"
        )
        logger.warning(f"Déduplication : {len(tracks_to_remove)} doublon(s) supprimé(s) dans '{album_dir.name}'")
        # Rechargement pour recalculer les numéros de pistes
        info = get_album_info(album_dir)
        tracks = info.get("tracks", [])

    if is_playlist is None:
        is_playlist = info.get("is_playlist", False)

    is_single = len(tracks) == 1 and not is_playlist
    has_video = any(Path(t["filepath"]).suffix.lower() in {".mp4", ".mkv", ".webm"} for t in tracks)

    # Pour un single, on mémorise l'album natif extrait par yt-dlp AVANT de l'écraser par "Singles & Rips"
    # afin de pouvoir le mentionner comme album d'origine dans le titre et le tag 'original album'.
    native_album_name = info["album_name"]

    final_album = custom_album.strip() if custom_album and not is_empty_or_na(custom_album) else info["album_name"]
    if is_empty_or_na(final_album) or (is_single and final_album in {"Extrait Vidéo", "Extrait Video"}):
        final_album = "Singles & Rips" if is_single else info["album_name"]
        if is_empty_or_na(final_album):
            final_album = "Playlist" if is_playlist else "Singles & Rips"

    # Si c'est un single et que l'album résolu n'est PAS déjà "Singles & Rips",
    # forcer le conteneur "Singles & Rips" et conserver l'album studio comme album d'origine.
    _is_singles_rips = final_album.lower() == "singles & rips"
    if is_single and not _is_singles_rips:
        # Sauvegarder le nom de l'album studio comme album d'origine (si origin_album non fourni)
        if not origin_album and not is_empty_or_na(final_album):
            origin_album = final_album
        final_album = "Singles & Rips"

    if is_playlist:
        if not re.search(r'\s*\[playlist\]\s*$', final_album, flags=re.IGNORECASE):
            final_album = f"{final_album} [Playlist]"
    else:
        # Nettoyage rigoureux de tout suffixe [Playlist] résiduel si ce n'est pas une playlist
        final_album = re.sub(r'\s*\[(Playlist|Mix|Compilation)\]\s*$', '', final_album, flags=re.IGNORECASE).strip()

    final_artist = custom_artist.strip() if custom_artist and not is_empty_or_na(custom_artist) else info["album_artist"]
    final_artist = clean_artist_name(final_artist)
    # ── Pour les playlists sans custom_artist, le album_artist des tags est souvent le
    # nom du channel YouTube de la première piste (ex: "Ferris Durandochine") et non un
    # vrai artiste d'album. On analyse la diversité d'artistes parmi les pistes.
    if is_playlist and (not custom_artist or is_empty_or_na(custom_artist)):
        piste_artist_set = {
            clean_artist_name(t.get("artist") or "").strip().lower()
            for t in tracks
            if not is_empty_or_na(t.get("artist"))
        }
        # Retirer les noms génériques qui ne comptent pas
        piste_artist_set -= {"na", "n/a", "various artists", "artiste inconnu", ""}
        if len(piste_artist_set) == 1:
            # Toutes les pistes ont le même artiste → l'utiliser
            final_artist = clean_artist_name(next((t.get("artist") or "").strip() for t in tracks if not is_empty_or_na(t.get("artist"))))
        else:
            # Artistes variés → Various Artists
            final_artist = "Various Artists"
    if is_empty_or_na(final_artist):
        final_artist = "Various Artists" if is_playlist else "Artiste inconnu"
    final_artist = clean_artist_name(final_artist)

    # ── Nettoyage feat. pour les albums studio ────────────────────────────────
    # Pour un album studio, on ne conserve que l'artiste principal dans le tag
    # 'album artist' et le nom de dossier. Le feat. reste intact dans chaque
    # tag 'artist' de piste individuelle (géré plus bas dans la boucle).
    # On ne touche pas aux playlists (l'artiste peut être "Various Artists" légitimement).
    if not is_playlist and final_artist not in {"Various Artists", "Artiste inconnu"}:
        final_artist = clean_artist_name(strip_feat_from_artist(final_artist))

    # ── Détection automatique des compilations ───────────────────────────────
    # Si plus de 30 % des pistes ont un artiste distinct de final_artist,
    # l'album est une compilation → forcer Various Artists pour garder le
    # dossier unifié sous Various Artists (et éviter une scission dans les players).
    # NOTE CRITIQUE : Si l'utilisateur a explicitement fourni custom_artist (édition manuelle dans l'éditeur de tags),
    # son choix est souverain et ne doit JAMAIS être écrasé par "Various Artists".
    has_custom_artist = bool(custom_artist and not is_empty_or_na(custom_artist))
    if not has_custom_artist and not is_playlist and not is_single and final_artist not in {"Various Artists", "Artiste inconnu"}:
        piste_artists = [
            (t.get("artist") or "").strip().lower()
            for t in tracks
            if not is_empty_or_na(t.get("artist"))
        ]
        if piste_artists:
            main_lower = final_artist.lower()
            different = sum(
                1 for a in piste_artists
                if a and main_lower not in a and a not in main_lower
            )
            # Un album n'est une compilation Various Artists que si plus de 30% des pistes diffèrent de l'artiste principal.
            # Même si le titre contient "Greatest Hits", "Best Of" ou "Collection", s'il s'agit d'un artiste unique,
            # il conserve impérativement le nom de son artiste.
            if different / len(piste_artists) > 0.30:
                final_artist = "Various Artists"

    final_year = extract_4digit_year(custom_year) if custom_year else info["year"]
    final_genre = custom_genre.strip() if custom_genre and not is_empty_or_na(custom_genre) else (info.get("genre") or "")

    # Si c'est un album studio complet et qu'aucun genre n'est défini, résoudre le genre officiel de l'album
    if not is_playlist and not is_single and not final_genre:
        detected_alb_genre = detect_genre_sync(final_artist, final_album, is_album=True)
        if not detected_alb_genre and tracks:
            first_t_title = tracks[0].get("title", "")
            detected_alb_genre = detect_genre_sync(final_artist, first_t_title, is_album=False)
        if detected_alb_genre:
            final_genre = detected_alb_genre

    # Indexation des pistes personnalisées (si fournies par le frontend)
    custom_by_file = {}
    custom_by_idx = {}
    if custom_tracks:
        for idx, ct in enumerate(custom_tracks, start=1):
            fn = ct.get("filename")
            if fn:
                custom_by_file[fn] = ct
            custom_by_idx[idx] = ct

    # Déterminer si les pistes ont des numéros d'origine distincts et valides
    orig_nums = [extract_track_num(t) for t in tracks]
    has_valid_orig_nums = (
        all(n is not None and n > 0 for n in orig_nums) and
        len(set(orig_nums)) == len(tracks)
    )

    if has_valid_orig_nums and not is_playlist:
        max_track_num = max(orig_nums)
        for t in tracks:
            m = re.match(r"^\d+/(\d+)$", str(t.get("track_number", "")).strip())
            if m:
                max_track_num = max(max_track_num, int(m.group(1)))
        total_for_tag = max(len(tracks), max_track_num)
    else:
        total_for_tag = len(tracks)

    updated_tracks = []

    # ── Lookup MusicBrainz automatique pour les albums studio ────────────────
    # Seulement pour les albums studio (pas playlists, pas singles) et seulement
    # si yt-dlp n'a pas déjà capturé des artistes diversifiés par piste.
    # Permet de récupérer les vrais crédits feat. que YTM n'embed pas toujours.
    mb_track_artists: Optional[Dict[str, str]] = None
    if not is_playlist and not is_single and final_artist not in {"Various Artists", "Artiste inconnu"}:
        # Vérifier si toutes les pistes ont le même artiste (symptôme d'un manque de feat.)
        piste_artists_set = {
            (t.get("artist") or "").strip().lower()
            for t in tracks
            if not is_empty_or_na(t.get("artist"))
        }
        all_same_artist = len(piste_artists_set) <= 1
        if all_same_artist:
            mb_track_artists = fetch_musicbrainz_track_artists_sync(final_album, final_artist)

    for index, track in enumerate(tracks, start=1):
        old_path = Path(track["filepath"])
        ext = old_path.suffix

        custom_t = custom_by_file.get(old_path.name) or custom_by_idx.get(index, {})
        current_title = custom_t.get("title") or track["title"]
        # Priorité : custom frontend > MB > yt-dlp > album artist
        track_artist = clean_artist_name(custom_t.get("artist") or track["artist"] or final_artist)
        if mb_track_artists and not custom_t.get("artist"):
            # Utiliser la position de piste pour chercher dans les crédits MB
            mb_artist = mb_track_artists.get(str(index))
            if mb_artist and not is_empty_or_na(mb_artist):
                track_artist = clean_artist_name(mb_artist)
        if is_empty_or_na(track_artist):
            track_artist = final_artist
        track_artist = clean_artist_name(track_artist)

        # Séparation intelligente si le titre contient encore le séparateur Artiste - Titre
        art, tit = extract_artist_and_title(current_title, existing_artist=track_artist)
        if is_empty_or_na(track_artist) or track_artist == "Artiste inconnu":
            track_artist = clean_artist_name(art)
        track_artist = clean_artist_name(track_artist)
        clean_tit = clean_track_title(tit) if clean_titles else tit
        clean_tit = (clean_tit or "").strip() or "Sans titre"

        # Gestion des mentions d'album d'origine et badges pour singles, rips et playlists
        track_orig_album = None
        if is_single or is_playlist:
            track_orig_album = (
                custom_t.get("origin_album") or
                origin_album or
                track.get("origin_album") or
                track.get("raw_album") or
                track.get("album") or
                (native_album_name if is_single and not is_empty_or_na(native_album_name) else None)
            )
            # Pour une playlist, si l'album d'origine détecté est identique au nom de la playlist,
            # on vérifie le raw_album pour trouver le véritable album studio
            if is_playlist and track_orig_album and track_orig_album.lower() == final_album.lower():
                raw = track.get("raw_album")
                track_orig_album = raw if (raw and raw.lower() != final_album.lower()) else None

            final_title = format_title_with_origin(
                title=clean_tit,
                orig_album=track_orig_album,
                is_video=has_video
            )
        else:
            # RÈGLE D'OR : Pour les albums studio complets, le titre de base reste pur.
            # EXCEPTION : si la piste a un artiste supplémentaire (feat.) par rapport à
            # l'album, on l'indique dans le titre sous la forme (feat. X) pour que le
            # player l'affiche correctement sans briser l'unité de l'album.
            final_title = clean_tit
            track_a_low = track_artist.lower().strip()
            album_a_low = final_artist.lower().strip() if not is_empty_or_na(final_artist) else ""
            # On détecte un feat. quand l'artiste de piste contient l'artiste d'album
            # mais en comporte d'autres
            has_feat = (
                album_a_low and
                album_a_low in track_a_low and
                track_a_low != album_a_low
            )
            if has_feat:
                # Extraire la partie "feat." depuis track_artist en retirant l'artiste principal
                feat_part = re.sub(
                    rf"{re.escape(final_artist)}",
                    "",
                    track_artist,
                    flags=re.IGNORECASE
                ).strip()
                # Nettoyer d'éventuels séparateurs restants aux extrémités
                feat_part = re.sub(r"^(?:feat\.?|ft\.?|featuring|et|and|avec|&|,)\s*", "", feat_part, flags=re.IGNORECASE).strip()
                feat_part = re.sub(r"\s*(?:feat\.?|ft\.?|featuring|et|and|avec|&|,)$", "", feat_part, flags=re.IGNORECASE).strip()
                # Garde-fou absolu contre les résidus parasites (ex: '[Officiel]', 'Officiel', 'Topic', etc.)
                clean_feat_check = re.sub(r"[\[\(\]\)\-_]", "", feat_part).strip().lower()
                if clean_feat_check in {"officiel", "official", "topic", "thème", "theme", "clip", "video", "vidéo", "audio", "vevo", ""}:
                    feat_part = ""
                # Si le titre ne contient pas déjà un feat. et que feat_part est valide, l'ajouter
                if feat_part and feat_part.lower() != track_artist.lower() and "(feat." not in final_title.lower():
                    final_title = f"{final_title} (feat. {feat_part})"
        
        if is_single:
            track_num_str = ""
            tag_num_cmd = ["-c", "set 'track number' ''", "-c", "set 'disc number' ''"]
        elif is_playlist:
            custom_num = custom_t.get("track_number")
            if custom_num is not None:
                try:
                    track_idx = int(custom_num)
                except (ValueError, TypeError):
                    track_idx = index
            else:
                track_idx = index
            track_num_str = f"{track_idx:02d}/{len(tracks):02d}"
            tag_num_cmd = ["-c", f"set 'track number' \"{track_num_str}\"", "-c", "set 'disc number' \"1/1\""]
        else:
            custom_num = custom_t.get("track_number")
            if custom_num is not None:
                try:
                    track_idx = int(custom_num)
                except (ValueError, TypeError):
                    track_idx = orig_nums[index - 1] if has_valid_orig_nums else index
            else:
                track_idx = orig_nums[index - 1] if has_valid_orig_nums else index
            track_num_str = f"{track_idx:02d}/{total_for_tag:02d}"
            tag_num_cmd = ["-c", f"set 'track number' \"{track_num_str}\"", "-c", "set 'disc number' \"1/1\""]

        cmd = [
            KID3_CLI_PATH,
            "-c", f"select \"{old_path.name}\"",
            "-c", f"set title \"{_kid3_escape(final_title)}\"",
            "-c", f"set artist \"{_kid3_escape(track_artist)}\"",
            "-c", f"set album \"{_kid3_escape(final_album)}\"",
            "-c", f"set 'album artist' \"{_kid3_escape(final_artist)}\"",
            *tag_num_cmd,
            "-c", "set comment \"\""
        ]

        if (is_single or is_playlist) and track_orig_album and not is_empty_or_na(track_orig_album):
            clean_oa = track_orig_album.strip()
            if clean_oa.lower() not in {"singles & rips", "extrait vidéo", "extrait video", "na", "n/a", "unknown"}:
                cmd.extend(["-c", f"set 'original album' \"{_kid3_escape(clean_oa)}\""])

        if final_year:
            cmd.extend(["-c", f"set year \"{_kid3_escape(final_year)}\""])

        # Détermination du genre spécifique de la piste
        track_genre = custom_t.get("genre")
        if is_empty_or_na(track_genre):
            if is_playlist or is_single:
                auto_track_g = detect_genre_sync(track_artist, clean_tit, is_album=False)
                track_genre = auto_track_g if auto_track_g else (final_genre or "")
            else:
                track_genre = final_genre or ""

        # Harmonisation mono-artiste : si le genre global est culturellement spécifique
        # (ex: "Variété française") et que la piste a reçu un tag générique ("Pop" ou "Rock"),
        # harmoniser la piste sur le genre spécifique lorsque c'est le même artiste.
        if final_genre and final_genre.lower() not in {"pop", "rock", "alternatif", "alternative"}:
            if track_genre and track_genre.lower() in {"pop", "rock", "alternatif", "alternative"}:
                if track_artist and final_artist and (track_artist.lower().strip() == final_artist.lower().strip() or final_artist.lower().strip() in track_artist.lower().strip()):
                    track_genre = final_genre

        if track_genre:
            cmd.extend(["-c", f"set genre \"{_kid3_escape(track_genre)}\""])

        cmd.extend(["-c", "save"])

        try:
            subprocess.run(cmd, cwd=str(album_dir), capture_output=True, text=True, check=True, timeout=30)
        except subprocess.TimeoutExpired:
            logger.warning(f"Timeout (30s) pour kid3-cli tag sur {old_path.name}")
        except Exception as e:
            logger.error(f"kid3-cli tag sur {old_path.name}: {e}")

        new_path = old_path
        if rename_files:
            safe_title = re.sub(r'[\\/*?:"<>|]', "", final_title).strip()
            if not safe_title or safe_title.startswith("(") or safe_title.startswith("["):
                safe_title = f"Sans titre {safe_title}".strip()
            if is_single:
                safe_artist = re.sub(r'[\\/*?:"<>|]', "_", final_artist).strip() or "Artiste inconnu"
                new_filename = f"{safe_artist} - {safe_title}{ext}"
            else:
                new_filename = naming_pattern.format(track=track_idx, title=safe_title) + ext

            new_path = album_dir / new_filename
            if new_path != old_path:
                try:
                    if new_path.exists() and new_path.resolve() != old_path.resolve():
                        new_filename = f"{new_path.stem}_2{ext}"
                        new_path = album_dir / new_filename
                    if not new_path.exists():
                        old_path.rename(new_path)
                    else:
                        temp_path = album_dir / f"__temp_{track_idx if not is_single else 1}{ext}"
                        old_path.rename(temp_path)
                        temp_path.rename(new_path)
                except Exception as e:
                    logger.error(f"Renommage {old_path.name} -> {new_filename}: {e}")
                    new_path = old_path

        updated_tracks.append({
            "index": 1 if is_single else track_idx,
            "title": final_title,
            "artist": track_artist,
            "album": final_album,
            "album_artist": final_artist,
            "track_number": track_num_str,
            "year": final_year,
            "genre": track_genre or final_genre or "",
            "filename": new_path.name
        })

    # Renommer le dossier selon le contexte :
    # Si l'album est déjà dans la bibliothèque dans un sous-dossier d'artiste (ex: Ma Collection / Artiste / Album),
    # respecter scrupuleusement la hiérarchie existante : NE JAMAIS préfixer par le nom d'artiste !
    current_dir = album_dir
    parent_p = current_dir.parent

    is_inside_artist_folder = False
    parent_norm = normalize_text(parent_p.name)
    artist_norm = normalize_text(final_artist)
    if parent_norm and artist_norm and (parent_norm == artist_norm or parent_norm in artist_norm or artist_norm in parent_norm):
        is_inside_artist_folder = True

    lib_root = Path(config.library_dir) if (config.library_dir and os.path.isdir(config.library_dir)) else None
    exp_root = Path(config.export_dir) if (config.export_dir and os.path.isdir(config.export_dir)) else None
    for root_candidate in (lib_root, exp_root):
        if root_candidate:
            try:
                rel = current_dir.resolve().relative_to(root_candidate.resolve())
                if len(rel.parts) >= 2:
                    is_inside_artist_folder = True
                    break
            except Exception:
                pass

    if is_inside_artist_folder:
        # Respect strict de la hiérarchie de collection : JAMAIS de préfixe Artiste dans le dossier Album
        if is_single and len(updated_tracks) == 1:
            first_t = updated_tracks[0]
            safe_single_title = re.sub(r'\s*\[(AUDIO RIP|RIP|Vidéo|Video|Single)\]', '', first_t['title'], flags=re.IGNORECASE).strip()
            badge = "[Vidéo]" if has_video else ("[Single]" if ("[single]" in first_t['title'].lower() or ("(" in first_t['title'] and ")" in first_t['title'])) else "[AUDIO RIP]")
            folder_label = f"{safe_single_title} {badge}"
        else:
            folder_label = final_album
    else:
        # Dossier plat temporaire (ex: TEMP_DOWNLOAD_DIR) : format 'Artiste - Album'
        if is_single and len(updated_tracks) == 1:
            first_t = updated_tracks[0]
            safe_single_title = re.sub(r'\s*\[(AUDIO RIP|RIP|Vidéo|Video|Single)\]', '', first_t['title'], flags=re.IGNORECASE).strip()
            if has_video:
                badge = "[Vidéo]"
            elif "[single]" in first_t['title'].lower() or ("(" in first_t['title'] and ")" in first_t['title']):
                badge = "[Single]"
            else:
                badge = "[AUDIO RIP]"
            folder_label = f"{final_artist} - {safe_single_title} {badge}"
        elif is_playlist:
            if final_artist and final_artist not in {"Various Artists", "Artiste inconnu"}:
                folder_label = f"{final_artist} - {final_album}"
            else:
                folder_label = final_album
        elif final_artist and not is_empty_or_na(final_artist):
            folder_label = f"{final_artist} - {final_album}"
        else:
            folder_label = final_album

    if is_single_file_mode:
        # En mode fichier unique (ex: vidéo ou clip individuel), on ne renomme JAMAIS le dossier parent !
        # Si l'artiste a changé et qu'on est dans la vidéothèque :
        final_file = new_path
        if final_artist and final_artist not in {"Artiste inconnu", "Various Artists"}:
            from backend.library_sync import sanitize_name
            from backend.video_indexer import video_indexer
            v_dir = video_indexer.get_video_dir()
            try:
                if v_dir and v_dir.exists() and final_file.resolve().is_relative_to(v_dir.resolve()):
                    is_concert_dest = "concert" in str(final_file.parent).lower() or "[concert]" in str(final_file).lower() or is_concert
                    dest_parent = v_dir / sanitize_name(final_artist) / ("Concerts" if is_concert_dest else "")
                    dest_parent.mkdir(parents=True, exist_ok=True)
                    target_file = dest_parent / final_file.name
                    if target_file.resolve() != final_file.resolve():
                        if target_file.exists():
                            target_file.unlink()
                        shutil.move(str(final_file), str(target_file))
                        # Déplacer aussi les miniatures compagnes si présentes
                        for ext_t in [".jpg", ".png", ".webp"]:
                            old_thumb = final_file.with_suffix(ext_t)
                            if old_thumb.exists():
                                new_thumb = target_file.with_suffix(ext_t)
                                shutil.move(str(old_thumb), str(new_thumb))
                        # Nettoyer l'ancien dossier s'il est vide
                        old_p = final_file.parent
                        if old_p.exists() and not any(old_p.iterdir()):
                            try: old_p.rmdir()
                            except Exception: pass
                        final_file = target_file
            except Exception as e:
                logger.warning(f"Routage fichier unique post-retag: {e}")
        
        # Invalider le cache vidéo
        try:
            from backend.video_indexer import video_indexer
            video_indexer.invalidate_cache()
        except Exception:
            pass

        # Enregistrer ou supprimer le marqueur de type d'album (.album_type)
        if custom_album_type:
            cat = custom_album_type.strip().lower()
            type_f = final_file.parent / ".album_type"
            if cat in ("album", "single", "rip", "playlist", "concert"):
                try:
                    type_f.write_text(cat, encoding="utf-8")
                except Exception:
                    pass
            elif cat == "auto" and type_f.exists():
                try:
                    type_f.unlink()
                except Exception:
                    pass

        invalidate_album_cache(p)
        invalidate_album_cache(final_file)

        return {
            "success": True,
            "album_dir": str(final_file.resolve()),
            "tracks": updated_tracks,
            "is_single_file": True,
            "is_playlist": is_playlist,
            "dedup_warning": None
        }

    if is_inside_artist_folder:
        safe_album_name = sanitize_folder_name(folder_label)
        safe_artist_name = sanitize_folder_name(final_artist) if (final_artist and not is_empty_or_na(final_artist)) else parent_p.name
        
        # Le dossier racine de la collection est le parent du dossier d'artiste
        collection_root = parent_p.parent
        target_artist_dir = collection_root / safe_artist_name
        target_album_dir = target_artist_dir / safe_album_name
        
        # Si le dossier d'album ou le dossier d'artiste a changé de nom
        if target_album_dir.resolve() != current_dir.resolve() or target_album_dir.name != current_dir.name or target_artist_dir.resolve() != parent_p.resolve():
            target_artist_dir.mkdir(parents=True, exist_ok=True)
            if not target_album_dir.exists():
                try:
                    current_dir.rename(target_album_dir)
                    current_dir = target_album_dir
                except Exception as e:
                    logger.warning(f"Déplacement dossier album {current_dir.name} -> {target_album_dir}: {e}")
            elif target_album_dir.resolve() != current_dir.resolve():
                for item in list(current_dir.iterdir()):
                    dest_item = target_album_dir / item.name
                    if not dest_item.exists():
                        try:
                            shutil.move(str(item), str(dest_item))
                        except Exception:
                            pass
                try:
                    if not any(current_dir.iterdir()):
                        current_dir.rmdir()
                except Exception:
                    pass
                current_dir = target_album_dir

            # Nettoyer l'ancien dossier d'artiste s'il est devenu vide
            if parent_p.exists() and parent_p.resolve() != target_artist_dir.resolve():
                try:
                    remaining = [f for f in parent_p.iterdir() if f.name.lower() not in {"desktop.ini", "thumbs.db"}]
                    if not remaining:
                        safe_rmtree(parent_p)
                except Exception:
                    pass
    else:
        # Mode plat temporaire (ex: TEMP_DOWNLOAD_DIR)
        safe_dir_name = sanitize_folder_name(folder_label)
        if safe_dir_name and safe_dir_name != current_dir.name:
            new_dir = current_dir.parent / safe_dir_name
            if not new_dir.exists():
                try:
                    current_dir.rename(new_dir)
                    current_dir = new_dir
                except Exception as e:
                    logger.warning(f"Renommage dossier {current_dir.name}:  -> {safe_dir_name}: {e}")

    # Enregistrer ou supprimer le marqueur de playlist selon le mode
    meta_file = current_dir / ".playlist_meta.json"
    if is_playlist:
        try:
            import json
            with open(meta_file, "w", encoding="utf-8") as f:
                json.dump({"is_playlist": True, "playlist_title": final_album}, f)
        except Exception:
            pass
    else:
        if meta_file.exists():
            try:
                meta_file.unlink()
            except Exception:
                pass

    # Enregistrer ou supprimer le marqueur de type d'album (.album_type)
    type_file = current_dir / ".album_type"
    if custom_album_type:
        cat = custom_album_type.strip().lower()
        if cat in ("album", "single", "rip", "playlist", "concert"):
            try:
                type_file.write_text(cat, encoding="utf-8")
            except Exception as e:
                logger.warning(f"Erreur écriture .album_type : {e}")
        elif cat == "auto" and type_file.exists():
            try:
                type_file.unlink()
            except Exception:
                pass

    dedup_warning_msg = " | ".join(dedup_warnings) if dedup_warnings else None

    logger.info(
        f"TAGS ENREGISTRÉS | Artiste='{final_artist}' | Album='{final_album}' | "
        f"Année='{final_year}' | Genre='{final_genre}' | Pistes={len(updated_tracks)} | "
        f"Dossier='{current_dir.name}'"
    )

    invalidate_album_cache(album_dir)
    invalidate_album_cache(current_dir)

    return {
        "success": True,
        "album": final_album,
        "album_artist": final_artist,
        "year": final_year,
        "album_dir": str(current_dir.resolve()),
        "tracks": updated_tracks,
        "is_playlist": is_playlist,
        "warning": dedup_warning_msg
    }

def export_album(
    album_dir: Path | str,
    target_base_dir: Optional[Path] = None,
    delete_temp: bool = False,
    custom_album: Optional[str] = None,
    custom_artist: Optional[str] = None,
    custom_year: Optional[str] = None,
    custom_genre: Optional[str] = None,
    custom_tracks: Optional[list] = None,
    is_playlist: Optional[bool] = None,
    is_concert: Optional[bool] = None,
    conflict_policy: Optional[str] = None
) -> dict:
    """
    Exporte un album finalisé dans la structure :
    - Musique (Smart Export activé) : Intégration directe dans la collection musicale avec harmonisation et fusion/distinct.
    - Musique standard : <target_base_dir> / <Artiste> / <Album> / <pistes>
    - Playlists multi-artistes : <target_base_dir> / Various Artists / <Playlist> / <pistes>
    - Vidéos Clips : <target_base_dir> / <Artiste> / <vidéos>
    - Vidéos Concerts / Lives : <target_base_dir> / <Artiste> / Concerts / <vidéos>
    """
    if not album_dir or not str(album_dir).strip():
        return {"success": False, "message": "Dossier d'album source invalide ou vide."}
    p = Path(album_dir)
    if not p.exists() or not p.is_dir():
        return {"success": False, "message": "Dossier d'album source introuvable."}
    album_dir = p
    if custom_album or custom_artist or custom_tracks or is_playlist is not None:
        res = uniformize_album(
            album_dir=album_dir,
            custom_album=custom_album,
            custom_artist=custom_artist,
            custom_year=custom_year,
            custom_genre=custom_genre,
            custom_tracks=custom_tracks,
            is_playlist=is_playlist
        )
        if res.get("success") and res.get("album_dir"):
            album_dir = Path(res["album_dir"])

    info = get_album_info(album_dir)
    tracks = info.get("tracks", [])
    if not tracks:
        return {"success": False, "message": "Aucun fichier à exporter."}

    # Détecter si le dossier contient des fichiers vidéo (.mp4, .mkv, .webm)
    is_video_folder = any(Path(t["filepath"]).suffix.lower() in {".mp4", ".mkv", ".webm"} for t in tracks)
    is_pl = is_playlist if is_playlist is not None else info.get("is_playlist", False)

    raw_art = custom_artist or info.get("album_artist") or ("Various Artists" if is_pl else "Artiste Inconnu")
    clean_art = clean_artist_name(raw_art)
    artist_name = sanitize_folder_name(clean_art)

    raw_alb = custom_album or info.get("album_name") or album_dir.name
    album_name = sanitize_folder_name(raw_alb)

    eff_policy = (conflict_policy or getattr(config, "smart_export_conflict_policy", "merge")).lower()
    if eff_policy not in {"merge", "overwrite", "distinct"}:
        eff_policy = "merge"

    smart_res = None
    # Vérifier si le Smart Export vers la collection musicale est applicable
    is_smart_active = getattr(config, "smart_export", True) and bool(config.library_dir)
    target_str = str(target_base_dir).strip() if target_base_dir else ""
    lib_str = str(config.library_dir).strip() if config.library_dir else ""
    exp_str = str(config.export_dir).strip() if config.export_dir else ""

    use_smart = (
        not is_video_folder
        and is_smart_active
        and (
            not target_base_dir
            or target_str == lib_str
            or target_str == exp_str
        )
    )

    if use_smart:
        is_single = (album_name == "Singles & Rips")
        smart_res = library_indexer.resolve_smart_export_path(
            artist_name=clean_art,
            album_name=album_name,
            is_single=is_single,
            is_playlist=is_pl,
            conflict_policy=eff_policy
        )
        dest_dir = Path(smart_res["dest_dir"])
        artist_name = smart_res["artist_folder"]
        album_name = smart_res["album_folder"]
    else:
        if not target_base_dir:
            target_base_dir = Path(config.video_export_dir if is_video_folder else config.export_dir)

        clean_target_base = sanitize_path(target_base_dir)

        if is_video_folder:
            # Vérifier si c'est un concert / live
            is_concert_dest = False
            if is_concert is True:
                is_concert_dest = True
            elif is_concert is None:
                is_concert_dest = (
                    "[concert]" in str(album_dir).lower()
                    or "concert" in album_name.lower()
                    or any(t.get("duration", 0) >= 600 for t in tracks)
                    or any(re.search(r"\b(concert|live|tour|festival|show|session|recital|spectacle|acoustique|unplugged|en\s+public|in\s+concert|full\s+concert|concert\s+complet)\b", t.get("title", ""), re.IGNORECASE) for t in tracks)
                )

            if is_concert_dest:
                dest_dir = clean_target_base / artist_name / "Concerts"
            else:
                dest_dir = clean_target_base / artist_name
        elif is_pl and (artist_name in {"Various Artists", "Artiste Inconnu"} or is_empty_or_na(info["album_artist"])):
            # Pour les playlists multi-artistes, destination dans Musique YTM / Various Artists / <Playlist> /
            dest_dir = clean_target_base / "Various Artists" / album_name
        else:
            # Pour la musique et playlists à artiste dédié, destination dans Musique YTM / <Artiste> / <Album ou Playlist> /
            dest_dir = clean_target_base / artist_name / album_name

    dest_dir.mkdir(parents=True, exist_ok=True)

    # Consolidation de la pochette avant export
    consolidate_album_cover(album_dir)

    exported_files = []
    for item in album_dir.iterdir():
        if item.is_file():
            # Ne jamais exporter de fichiers cachés ou de métadonnées temporaires (.playlist_meta.json)
            if item.name.startswith("."):
                if delete_temp:
                    try:
                        os.chmod(str(item), stat.S_IWRITE)
                        item.unlink(missing_ok=True)
                    except Exception:
                        pass
                continue
            # Ne jamais exporter de résidus temporaires de téléchargement (.part, .ytdl, .tmp, etc.)
            is_temp_artifact = (
                any(item.name.lower().endswith(ext) for ext in [".part", ".ytdl", ".tmp", ".temp", ".crdownload"])
                or (".mp4.part" in item.name.lower())
            )
            if is_temp_artifact:
                if delete_temp:
                    try:
                        os.chmod(str(item), stat.S_IWRITE)
                        item.unlink(missing_ok=True)
                    except Exception:
                        pass
                continue
            # Ne jamais exporter de vignettes individuelles par titre
            if item.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"} and item.name.lower() not in {"cover.jpg", "folder.jpg"}:
                continue
            # Pour le conteneur 'Singles & Rips', chaque morceau a son image intégrée dans ses métadonnées audio
            if album_name == "Singles & Rips" and item.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
                if delete_temp:
                    try:
                        os.chmod(str(item), stat.S_IWRITE)
                        item.unlink(missing_ok=True)
                    except Exception:
                        pass
                continue
            dest_file = dest_dir / item.name
            if dest_file.exists():
                if eff_policy == "merge" and dest_file.stat().st_size > 0:
                    # En mode merge, conserver la piste existante de la bibliothèque sans l'écraser
                    logger.info(f"Smart Export (merge) : Piste existante conservée -> {dest_file.name}")
                    if delete_temp:
                        try:
                            os.chmod(str(item), stat.S_IWRITE)
                            item.unlink(missing_ok=True)
                        except Exception:
                            pass
                    exported_files.append(item.name)
                    continue
                else:
                    try:
                        os.chmod(str(dest_file), stat.S_IWRITE)
                        dest_file.unlink(missing_ok=True)
                    except Exception:
                        pass
            try:
                shutil.copy2(str(item), str(dest_file))
            except Exception as e:
                logger.error(f"Échec copie {item.name}: {e}")
                continue
            if delete_temp:
                for attempt in range(4):
                    try:
                        os.chmod(str(item), stat.S_IWRITE)
                        item.unlink(missing_ok=True)
                        break
                    except Exception as e:
                        if attempt < 3:
                            import gc
                            gc.collect()
                            time.sleep(0.25 * (attempt + 1))
                        else:
                            logger.warning(f"Suppression temp {item.name}: {e}")
            exported_files.append(item.name)

    if delete_temp and album_dir.exists():
        import gc
        gc.collect()
        safe_rmtree(album_dir)

    # Mise à jour incrémentale immédiate du cache de la bibliothèque
    if not is_video_folder and dest_dir.exists():
        try:
            library_indexer.add_or_update_album(dest_dir)
        except Exception as e:
            logger.warning(f"Erreur mise à jour indexothèque après export : {e}")

    if exported_files:
        logger.info(
            f"EXPORT TERMINÉ | Smart={'OUI' if smart_res else 'NON'} | Artiste='{artist_name}' | Album='{album_name}' | "
            f"Fichiers exportés={len(exported_files)} | Source='{album_dir.name}' | "
            f"Destination='{dest_dir.resolve()}'"
        )
    else:
        logger.warning(
            f"EXPORT VIDE | Artiste='{artist_name}' | Album='{album_name}' | "
            f"0 fichier copié | Source='{album_dir.name}' | Destination='{dest_dir.resolve()}'"
        )

    invalidate_album_cache(album_dir)
    invalidate_album_cache(dest_dir)

    return {
        "success": True,
        "export_dir": str(dest_dir.resolve()),
        "artist": artist_name,
        "album": album_name if not is_video_folder else "Vidéos",
        "files_count": len(exported_files),
        "is_smart": bool(smart_res and smart_res.get("is_smart")),
        "conflict": bool(smart_res and smart_res.get("conflict")),
        "conflict_policy": eff_policy
    }

def export_all_temp_albums(
    temp_base_dir: Path,
    target_base_dir: Optional[Path] = None,
    delete_temp: bool = True,
    conflict_policy: Optional[str] = None
) -> dict:
    """
    Exporte tous les albums présents dans temp_base_dir.
    Chaque dossier est exporté selon son type :
    - Les vidéos complètes vers Vidéos YTM / <Artiste> /
    - Les musiques vers Musique YTM ou directement dans la collection avec l'Export Intelligent
    Si delete_temp est True, purge intégralement temp_base_dir après l'exportation.
    """
    if not temp_base_dir.exists() or not temp_base_dir.is_dir():
        return {"success": False, "message": "Dossier temporaire introuvable."}

    album_dirs = []
    for item in temp_base_dir.iterdir():
        if item.is_dir():
            has_media = any(f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS for f in item.iterdir())
            if has_media:
                album_dirs.append(item)

    if not album_dirs:
        return {"success": False, "message": "Aucun album contenant des fichiers audio ou vidéo dans le dossier temporaire."}

    is_smart_active = getattr(config, "smart_export", True) and bool(config.library_dir)
    default_audio_target = Path(config.library_dir) if is_smart_active else Path(config.export_dir)
    effective_audio_target = target_base_dir or default_audio_target

    results = []
    for alb in album_dirs:
        # Chaque album détecte son propre type (vidéo ou musique) et choisit le bon dossier.
        # Si target_base_dir est fourni, il s'applique uniquement aux albums AUDIO.
        # Les albums vidéo (.mp4/.mkv/.webm) vont toujours dans config.video_export_dir,
        # quel que soit le target_base_dir fourni par l'appelant.
        alb_info = get_album_info(alb)
        alb_tracks = alb_info.get("tracks", [])
        alb_is_video = any(Path(t["filepath"]).suffix.lower() in {".mp4", ".mkv", ".webm"} for t in alb_tracks)
        effective_target = None if alb_is_video else effective_audio_target
        res = export_album(alb, target_base_dir=effective_target, delete_temp=delete_temp, conflict_policy=conflict_policy)
        results.append(res)

    if delete_temp and temp_base_dir.exists():
        for item in temp_base_dir.iterdir():
            try:
                if item.is_dir():
                    safe_rmtree(item)
                elif item.is_file():
                    item.unlink()
            except Exception as e:
                logger.warning(f"Erreur purge temp après export-all {item}: {e}")

    invalidate_album_cache()

    successful = [r for r in results if r.get("success")]
    logger.info(
        f"EXPORT TOUT TERMINÉ | {len(successful)}/{len(album_dirs)} album(s) exporté(s) | "
        f"Purge temp={delete_temp} | Destination de base='{target_base_dir or config.export_dir}'"
    )
    return {
        "success": len(successful) > 0,
        "exported_albums_count": len(successful),
        "total_attempted": len(album_dirs),
        "details": results
    }

def delete_temp_album(album_dir: Path) -> dict:
    """Supprime un album du dossier temporaire de travail."""
    if album_dir.exists() and album_dir.is_dir():
        invalidate_album_cache(album_dir)
        success = safe_rmtree(album_dir)
        if success:
            logger.info(f"SUPPRESSION DOSSIER TEMP | '{album_dir.name}' supprimé avec succès.")
            return {"success": True, "message": "Dossier temporaire supprimé."}
        logger.warning(f"SUPPRESSION DOSSIER TEMP ÉCHOUÉE | Impossible de supprimer '{album_dir.name}'.")
        return {"success": False, "message": "Impossible de supprimer complètement le dossier temporaire."}
    return {"success": False, "message": "Dossier introuvable."}

def open_in_explorer(path: str) -> bool:
    """Ouvre l'explorateur Windows sur le dossier spécifié et l'amène au premier plan."""
    target = Path(path).resolve()
    if not target.exists():
        return False
    try:
        subprocess.Popen(f'explorer.exe "{target}"')
        folder_title = target.name
        ps_cmd = (
            f"$ws = New-Object -ComObject WScript.Shell; "
            f"for ($i = 0; $i -lt 8; $i++) {{ "
            f"  Start-Sleep -Milliseconds 150; "
            f"  if ($ws.AppActivate('{folder_title}')) {{ break }} "
            f"}}"
        )
        subprocess.Popen(["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps_cmd])
        return True
    except Exception as e:
        logger.error(f"Ouverture explorateur: {e}")
        return False

def apply_genre_to_album(album_dir: Path | str, genre: str) -> dict:
    """
    Applique le tag de genre à tous les fichiers audio d'un album ou d'une playlist via kid3-cli
    sans toucher aux titres, artistes ou noms de fichiers.
    """
    if not album_dir or not str(album_dir).strip():
        return {"success": False, "message": "Chemin d'album invalide."}
    p = Path(album_dir)
    if not p.exists() or not p.is_dir():
        return {"success": False, "message": "Dossier d'album introuvable."}

    clean_g = str(genre).strip()

    audio_files = []
    for root, _, files in os.walk(p):
        for f in files:
            if Path(f).suffix.lower() in AUDIO_EXTENSIONS:
                audio_files.append(Path(root) / f)

    if not audio_files:
        return {"success": False, "message": "Aucun fichier audio trouvé dans cet album."}

    try:
        cmd = [KID3_CLI_PATH]
        escaped_g = _kid3_escape(clean_g)
        cmd.extend(["-c", f"set genre \"{escaped_g}\""])
        for af in audio_files:
            cmd.append(str(af.resolve()))
        cmd.extend(["-c", "save"])

        proc = subprocess.run(cmd, cwd=str(p), capture_output=True, text=True, timeout=30)
        if proc.returncode != 0:
            logger.warning(f"kid3-cli set genre warning on {p.name}: {proc.stderr}")
    except Exception as e:
        logger.error(f"Erreur kid3-cli lors de l'application du genre sur {p.name} : {e}")
        return {"success": False, "message": str(e)}

    invalidate_album_cache(p)
    if hasattr(library_indexer, "update_album_genre"):
        library_indexer.update_album_genre(p, clean_g)

    return {
        "success": True,
        "album_dir": str(p),
        "genre": clean_g,
        "tracks_updated": len(audio_files)
    }



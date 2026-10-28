import asyncio
import re
import urllib.parse
import unicodedata
from typing import Optional, List, Dict, Any
import httpx

CHIP_PARAMS = {
    "artist": "EgWKAQIgAWoSEAkQBBADEAUQChAQEBEQFRAO",
    "album": "EgWKAQIYAWoSEAUQCRAKEAMQEBAEEA4QFRAR",
    "playlist": "EgeKAQQoAEABahIQBRAJEAoQAxAQEAQQDhAVEBE=",
    "track": "EgWKAQIIAWoSEAUQCRAKEAMQEBAEEA4QFRAR",
    "video": "EgWKAQIQAWoSEAUQCRAKEAMQEBAEEA4QFRAR"
}

# --- Version du navigateur simulé ---
# Mettre à jour ces valeurs si YouTube rejette les requêtes (réponses vides)
_CHROME_VERSION = "131.0.0.0"
_YTM_CLIENT_VERSION = "1.20241120.01.00"

YTM_HEADERS = {
    "User-Agent": f"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{_CHROME_VERSION} Safari/537.36",
    "Referer": "https://music.youtube.com/",
    "Origin": "https://music.youtube.com",
    "Content-Type": "application/json"
}

from backend.tagger import clean_artist_name

def extract_ytm_browse_id(url_or_id: Optional[str]) -> Optional[str]:
    """
    Extrait l'identifiant browseId YouTube Music (ex: VLPL..., MPREb_..., OLAK5uy_...)
    à partir d'une URL de playlist, d'album ou d'un identifiant direct.
    """
    if not url_or_id:
        return None
    s = url_or_id.strip()
    m_list = re.search(r'[?&]list=([a-zA-Z0-9_-]+)', s)
    if m_list:
        lid = m_list.group(1)
        return f"VL{lid}" if not lid.startswith("VL") else lid
    m_browse = re.search(r'/browse/([a-zA-Z0-9_-]+)', s)
    if m_browse:
        return m_browse.group(1)
    if s.startswith("PL") or s.startswith("OLAK") or s.startswith("RD"):
        return f"VL{s}"
    if s.startswith("VL") or s.startswith("MPREb_"):
        return s
    return None

_SENTINEL = object()  # Sentinelle pour distinguer "pas trouvé" de valeurs falsy (False, 0, "")

def _find_first_key(obj: Any, key: str) -> Any:
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for v in obj.values():
            res = _find_first_key(v, key)
            if res is not _SENTINEL:
                return res
    elif isinstance(obj, list):
        for it in obj:
            res = _find_first_key(it, key)
            if res is not _SENTINEL:
                return res
    return _SENTINEL


def _find_all_key(obj: Any, key: str):
    if isinstance(obj, dict):
        if key in obj:
            yield obj[key]
        for v in obj.values():
            yield from _find_all_key(v, key)
    elif isinstance(obj, list):
        for it in obj:
            yield from _find_all_key(it, key)

def _upgrade_ytm_thumbnail(thumb_url: str) -> str:
    """
    Rehausse les miniatures YouTube Music (googleusercontent / ggpht) de basse résolution
    (ex: w60-h60, w120-h120) vers du 544x544 net pour la grille de recherche.
    """
    if not thumb_url:
        return ""
    if thumb_url.startswith("//"):
        thumb_url = "https:" + thumb_url
    if "googleusercontent.com" in thumb_url or "ggpht.com" in thumb_url:
        thumb_url = re.sub(r"=w\d+-h\d+[^=]*$", "=w544-h544-l90-rj", thumb_url)
    return thumb_url


def _parse_innertube_item(renderer: dict, default_artist: Optional[str] = None) -> Optional[dict]:
    flex = renderer.get("flexColumns", [])
    if not flex:
        return None

    # Titre & Endpoint
    col0_runs = flex[0].get("musicResponsiveListItemFlexColumnRenderer", {}).get("text", {}).get("runs", [])
    if not col0_runs:
        return None
    title = "".join(r.get("text", "") for r in col0_runs).strip() or "Sans titre"

    nav_endpoint = col0_runs[0].get("navigationEndpoint") or renderer.get("navigationEndpoint") or {}
    browse_id = nav_endpoint.get("browseEndpoint", {}).get("browseId", "")
    watch_ep = nav_endpoint.get("watchEndpoint", {})
    video_id = watch_ep.get("videoId", "")
    playlist_id = watch_ep.get("playlistId", "")

    # Extraction depuis l'overlay (bouton de lecture) si disponible
    overlay_play = (
        renderer.get("overlay", {})
                .get("musicItemThumbnailOverlayRenderer", {})
                .get("content", {})
                .get("musicPlayButtonRenderer", {})
                .get("playNavigationEndpoint", {})
    )
    overlay_playlist_id = (
        overlay_play.get("watchPlaylistEndpoint", {}).get("playlistId") or
        overlay_play.get("watchEndpoint", {}).get("playlistId", "")
    )
    overlay_video_id = overlay_play.get("watchEndpoint", {}).get("videoId", "")

    if not playlist_id and overlay_playlist_id:
        playlist_id = overlay_playlist_id
    if not video_id and overlay_video_id:
        video_id = overlay_video_id

    # Extraction du musicVideoType interne officiel (ATV = piste audio, OMV/UGC = vidéo/clip)
    watch_cfg = (
        watch_ep.get("watchEndpointMusicSupportedConfigs", {}).get("watchEndpointMusicConfig", {}) or
        overlay_play.get("watchEndpoint", {}).get("watchEndpointMusicSupportedConfigs", {}).get("watchEndpointMusicConfig", {})
    )
    music_video_type = watch_cfg.get("musicVideoType", "")

    # Éliminer les podcasts
    if music_video_type == "MUSIC_VIDEO_TYPE_PODCAST_EPISODE":
        return None

    # Colonnes de métadonnées (flex[1:] découpées par puces séparatrices '•' ou changement de colonne)
    col1_runs = []
    for c_idx, col_obj in enumerate(flex[1:]):
        c_runs = col_obj.get("musicResponsiveListItemFlexColumnRenderer", {}).get("text", {}).get("runs", [])
        if c_runs:
            if col1_runs:
                col1_runs.append({"text": "•"})
            col1_runs.extend(c_runs)
    col1_text = "".join(r.get("text", "") for r in col1_runs).strip()

    browse_page_type = (
        nav_endpoint.get("browseEndpoint", {})
                    .get("browseEndpointContextSupportedConfigs", {})
                    .get("browseEndpointContextMusicConfig", {})
                    .get("pageType", "")
    )

    # Détection et parsing des profils d'artistes
    is_artist = (browse_page_type in ["MUSIC_PAGE_TYPE_ARTIST", "MUSIC_PAGE_TYPE_USER_CHANNEL"] and not video_id and not playlist_id)
    if not is_artist and any(col1_text.lower().startswith(k) for k in ["artiste", "profil"]) and not video_id and not playlist_id:
        is_artist = True

    if is_artist:
        thumb_renderer = renderer.get("thumbnail", {})
        thumbs = (
            thumb_renderer.get("musicThumbnailRenderer", {}).get("thumbnail", {}).get("thumbnails", [])
            or thumb_renderer.get("thumbnails", [])
        )
        thumb_url = _upgrade_ytm_thumbnail(thumbs[-1].get("url", "") if thumbs else "")
        clean_name = clean_artist_name(title)
        url = f"https://music.youtube.com/channel/{browse_id}" if browse_id else f"https://music.youtube.com/search?q={urllib.parse.quote(clean_name)}"
        return {
            "id": browse_id or clean_name,
            "title": clean_name,
            "artist": clean_name,
            "album": None,
            "year": None,
            "track_count": None,
            "duration": None,
            "subscribers": col1_text if col1_text else None,
            "url": url,
            "thumbnail": thumb_url,
            "type": "artist",
            "subtype": None
        }
    
    segments = []
    cur_segment = []
    for r in col1_runs:
        t = r.get("text", "")
        if t.strip() == "•":
            if cur_segment:
                segments.append(cur_segment)
                cur_segment = []
        else:
            cur_segment.append(r)
    if cur_segment:
        segments.append(cur_segment)

    detected_type = None
    release_subtype = None
    subtype_explicit = False
    explicit_track_tag = False
    artist_name = None
    album_name = None
    year_str = None
    duration_str = None
    track_count_str = None

    for s_idx, seg in enumerate(segments):
        seg_text = "".join(r.get("text", "") for r in seg).strip()
        if not seg_text:
            continue
        seg_lower = seg_text.lower()

        # Podcasts ou épisodes à ignorer
        if s_idx == 0 and any(k in seg_lower for k in ["podcast", "épisode", "episode"]):
            return None

        # Tags de type explicites
        if seg_lower in ["album", "ep", "single", "mini-album"]:
            detected_type = "album"
            release_subtype = "ep" if seg_lower == "mini-album" else seg_lower
            subtype_explicit = True
            continue
        elif seg_lower in ["playlist"]:
            detected_type = "playlist"
            continue
        elif seg_lower in ["titre", "morceau", "chanson", "song", "track"]:
            detected_type = "track"
            explicit_track_tag = True
            continue
        elif seg_lower in ["vidéo", "video", "clip"]:
            detected_type = "video"
            continue
        elif seg_lower in ["artiste", "profil", "artist", "chaîne", "channel"]:
            continue

        # Durée (ex: 3:45, 1:12:30)
        if re.match(r"^\d{1,2}:\d{2}(:\d{2})?$", seg_text):
            duration_str = seg_text
            continue

        # Année (ex: 1994, 2024)
        if re.match(r"^(19\d\d|20\d\d)$", seg_text):
            year_str = seg_text
            continue

        # Nombre de pistes (ex: 14 titres)
        if re.match(r"^\d+\s*(titres|pistes|morceaux|chansons|songs|tracks)$", seg_lower):
            track_count_str = seg_text
            continue

        # Ignorer les compteurs de popularité (vues, abonnés, auditeurs, lectures)
        if any(k in seg_lower for k in ["vues", "views", "abonnés", "auditeurs", "lectures"]):
            continue

        # Analyse par pageType des endpoints de navigation
        page_types = [
            r.get("navigationEndpoint", {})
             .get("browseEndpoint", {})
             .get("browseEndpointContextSupportedConfigs", {})
             .get("browseEndpointContextMusicConfig", {})
             .get("pageType", "")
            for r in seg if r.get("navigationEndpoint")
        ]

        if "MUSIC_PAGE_TYPE_ARTIST" in page_types or "MUSIC_PAGE_TYPE_USER_CHANNEL" in page_types:
            if not artist_name:
                artist_name = seg_text
            continue

        if "MUSIC_PAGE_TYPE_ALBUM" in page_types:
            if not album_name:
                album_name = seg_text
            continue

        # Fallback heuristique si pas de pageType explicite
        if not artist_name:
            artist_name = seg_text
        elif not album_name:
            album_name = seg_text

    # Fallback durée depuis fixedColumns si non présente dans flexColumns
    if not duration_str:
        fixed_cols = renderer.get("fixedColumns", [])
        if fixed_cols:
            f_runs = fixed_cols[0].get("musicResponsiveListItemFixedColumnRenderer", {}).get("text", {}).get("runs", [])
            if f_runs:
                f_txt = "".join(r.get("text", "") for r in f_runs).strip()
                if re.match(r"^\d{1,2}:\d{2}(:\d{2})?$", f_txt):
                    duration_str = f_txt

    # Si aucun artiste n'a été extrait des segments, hériter de l'artiste de la carte parente
    if not artist_name and default_artist:
        artist_name = default_artist
    if not artist_name:
        artist_name = "Artiste inconnu"
    else:
        artist_name = clean_artist_name(artist_name)

    # Détermination du type final (avec priorité aux enums YouTube)
    if not detected_type:
        if music_video_type == "MUSIC_VIDEO_TYPE_ATV":
            detected_type = "track"
        elif music_video_type in ["MUSIC_VIDEO_TYPE_OMV", "MUSIC_VIDEO_TYPE_UGC"]:
            detected_type = "video"
        elif playlist_id:
            detected_type = "album" if playlist_id.startswith("OLAK") else "playlist"
        elif browse_id:
            detected_type = "album" if ("MPREb_" in browse_id or "OLAK" in browse_id) else "playlist"
        elif video_id:
            title_lower = title.lower()
            detected_type = "video" if any(k in title_lower for k in ["clip", "video", "vidéo", "live"]) else "track"

    # Sanctuarisation absolue OLAK vs PL
    if (playlist_id and playlist_id.startswith("OLAK")) or (browse_id and ("MPREb_" in browse_id or "OLAK" in browse_id)):
        detected_type = "album"
    elif (playlist_id and playlist_id.startswith("PL")) or (browse_id and browse_id.startswith("VLPL")):
        detected_type = "playlist"

    # Heuristique sur le titre pour EP / Single si le sous-type d'album n'était pas explicite
    if detected_type == "album" and not release_subtype and title:
        if re.search(r"(?:[\(\[\-–—]\s*|\b)ep(?:\s*[\)\]]|\s*$)", title, re.IGNORECASE):
            release_subtype = "ep"
        elif re.search(r"(?:[\(\[\-–—]\s*|\b)single(?:\s*[\)\]]|\s*$)", title, re.IGNORECASE):
            release_subtype = "single"

    thumb_renderer = renderer.get("thumbnail", {})
    thumbs = (
        thumb_renderer.get("musicThumbnailRenderer", {}).get("thumbnail", {}).get("thumbnails", [])
        or thumb_renderer.get("thumbnails", [])
    )
    thumb_url = _upgrade_ytm_thumbnail(thumbs[-1].get("url", "") if thumbs else "")

    url = ""
    if playlist_id:
        url = f"https://music.youtube.com/playlist?list={playlist_id}"
    elif browse_id:
        if browse_id.startswith("VLOLAK5uy_") or browse_id.startswith("VLPL"):
            url = f"https://music.youtube.com/playlist?list={browse_id[2:]}"
        else:
            url = f"https://music.youtube.com/browse/{browse_id}"
    elif video_id:
        url = f"https://music.youtube.com/watch?v={video_id}"

    if not url:
        return None

    # Détection concert / live / œuvre longue :
    # Ne jamais muter une piste audio officielle d'album (MUSIC_VIDEO_TYPE_ATV ou tag Titre explicite) en vidéo !
    is_audio_only_track = (music_video_type == "MUSIC_VIDEO_TYPE_ATV" or explicit_track_tag)
    is_concert = False
    if not is_audio_only_track and (detected_type in ("video", "track") or not detected_type) and not playlist_id and not (browse_id and "OLAK" in str(browse_id)):
        if duration_str:
            dur_parts = duration_str.split(":")
            if len(dur_parts) >= 3:
                is_concert = True
            elif len(dur_parts) == 2 and dur_parts[0].isdigit() and int(dur_parts[0]) >= 20:
                is_concert = True
        if not is_concert and title:
            if re.search(r"\b(full\s+concert|live\s+at|live\s+in|concert\s+complet|live\s+tour|festival\s+live|live\s+session|live\s+show|en\s+concert)\b", title, re.IGNORECASE):
                is_concert = True

    if is_concert:
        detected_type = "video"

    item_dict = {
        "id": video_id or playlist_id or browse_id,
        "title": title,
        "artist": artist_name,
        "album": album_name,
        "year": year_str,
        "track_count": track_count_str,
        "duration": duration_str,
        "url": url,
        "thumbnail": thumb_url,
        "type": detected_type or "track",
        "subtype": release_subtype or ("album" if (detected_type == "album") else None),
        "subtype_explicit": subtype_explicit,
        "is_concert": is_concert
    }
    if item_dict["type"] == "album" and track_count_str:
        _reconcile_album_subtype(item_dict)
    return item_dict


def _parse_music_card_shelf(mcs: dict) -> tuple[Optional[dict], Optional[str]]:
    """
    Extrait la carte 'Résultat principal' (Top Result) contenue dans un musicCardShelfRenderer
    et détermine proprement le nom de l'artiste à transmettre aux sous-éléments éventuels.
    """
    if not mcs or not isinstance(mcs, dict):
        return None, None

    title_runs = mcs.get("title", {}).get("runs", [])
    if not title_runs:
        return None, None
    title = "".join(r.get("text", "") for r in title_runs).strip()
    if not title:
        return None, None

    nav_endpoint = title_runs[0].get("navigationEndpoint") or mcs.get("onTap") or {}
    browse_id = nav_endpoint.get("browseEndpoint", {}).get("browseId", "")
    watch_ep = nav_endpoint.get("watchEndpoint", {})
    video_id = watch_ep.get("videoId", "")
    playlist_id = watch_ep.get("playlistId", "")

    watch_cfg = watch_ep.get("watchEndpointMusicSupportedConfigs", {}).get("watchEndpointMusicConfig", {})
    music_video_type = watch_cfg.get("musicVideoType", "")
    if music_video_type == "MUSIC_VIDEO_TYPE_PODCAST_EPISODE":
        return None, None

    browse_page_type = (
        nav_endpoint.get("browseEndpoint", {})
                    .get("browseEndpointContextSupportedConfigs", {})
                    .get("browseEndpointContextMusicConfig", {})
                    .get("pageType", "")
    )

    sub_runs = mcs.get("subtitle", {}).get("runs", [])
    sub_text = "".join(r.get("text", "") for r in sub_runs).strip()

    thumb_renderer = mcs.get("thumbnail", {})
    thumbs = (
        thumb_renderer.get("musicThumbnailRenderer", {}).get("thumbnail", {}).get("thumbnails", [])
        or thumb_renderer.get("thumbnails", [])
    )
    thumb_url = _upgrade_ytm_thumbnail(thumbs[-1].get("url", "") if thumbs else "")

    is_artist = (browse_page_type in ["MUSIC_PAGE_TYPE_ARTIST", "MUSIC_PAGE_TYPE_USER_CHANNEL"] and not video_id and not playlist_id)
    if not is_artist and any(sub_text.lower().startswith(k) for k in ["artiste", "profil"]) and not video_id and not playlist_id:
        is_artist = True

    if is_artist:
        clean_name = clean_artist_name(title)
        url = f"https://music.youtube.com/channel/{browse_id}" if browse_id else f"https://music.youtube.com/search?q={urllib.parse.quote(clean_name)}"
        return {
            "id": browse_id or clean_name,
            "title": clean_name,
            "artist": clean_name,
            "album": None,
            "year": None,
            "track_count": None,
            "duration": None,
            "subscribers": sub_text if sub_text else None,
            "url": url,
            "thumbnail": thumb_url,
            "type": "artist",
            "subtype": None
        }, clean_name

    # Si ce n'est pas un profil artiste, inspecter les boutons (ex: lecture d'album OLAK ou piste vidéo)
    for btn in mcs.get("buttons", []):
        b_renderer = btn.get("buttonRenderer", {})
        for cmd_key in ("command", "navigationEndpoint", "serviceEndpoint"):
            cmd = b_renderer.get(cmd_key, {})
            if not playlist_id:
                cand_pl = (
                    cmd.get("watchPlaylistEndpoint", {}).get("playlistId") or
                    cmd.get("watchEndpoint", {}).get("playlistId", "")
                )
                if cand_pl and not cand_pl.startswith("RD"):
                    playlist_id = cand_pl
            if not video_id:
                video_id = cmd.get("watchEndpoint", {}).get("videoId", "")
            if not browse_id:
                browse_id = cmd.get("browseEndpoint", {}).get("browseId", "")

    # Découpage par segments '•' du sous-titre de la carte principale
    segments = []
    cur_segment = []
    for r in sub_runs:
        t = r.get("text", "")
        if t.strip() == "•":
            if cur_segment:
                segments.append(cur_segment)
                cur_segment = []
        else:
            cur_segment.append(r)
    if cur_segment:
        segments.append(cur_segment)

    detected_type = None
    release_subtype = None
    subtype_explicit = False
    explicit_track_tag = False
    artist_name = None
    album_name = None
    year_str = None
    duration_str = None
    track_count_str = None

    for s_idx, seg in enumerate(segments):
        seg_text = "".join(r.get("text", "") for r in seg).strip()
        if not seg_text:
            continue
        seg_lower = seg_text.lower()
        if s_idx == 0 and any(k in seg_lower for k in ["podcast", "épisode", "episode"]):
            return None, None
        if seg_lower in ["album", "ep", "single", "mini-album"]:
            detected_type = "album"
            release_subtype = "ep" if seg_lower == "mini-album" else seg_lower
            subtype_explicit = True
            continue
        elif seg_lower in ["playlist"]:
            detected_type = "playlist"
            continue
        elif seg_lower in ["titre", "morceau", "chanson", "song", "track"]:
            detected_type = "track"
            explicit_track_tag = True
            continue
        elif seg_lower in ["vidéo", "video", "clip"]:
            detected_type = "video"
            continue
        elif seg_lower in ["artiste", "profil", "artist", "chaîne", "channel"]:
            continue

        if re.match(r"^\d{1,2}:\d{2}(:\d{2})?$", seg_text):
            duration_str = seg_text
            continue
        if re.match(r"^(19\d\d|20\d\d)$", seg_text):
            year_str = seg_text
            continue
        if re.match(r"^\d+\s*(titres|pistes|morceaux|chansons|songs|tracks)$", seg_lower):
            track_count_str = seg_text
            continue
        if any(k in seg_lower for k in ["vues", "views", "abonnés", "auditeurs", "lectures"]):
            continue

        page_types = [
            r.get("navigationEndpoint", {})
             .get("browseEndpoint", {})
             .get("browseEndpointContextSupportedConfigs", {})
             .get("browseEndpointContextMusicConfig", {})
             .get("pageType", "")
            for r in seg if r.get("navigationEndpoint")
        ]
        if "MUSIC_PAGE_TYPE_ARTIST" in page_types or "MUSIC_PAGE_TYPE_USER_CHANNEL" in page_types:
            if not artist_name:
                artist_name = seg_text
            continue
        if "MUSIC_PAGE_TYPE_ALBUM" in page_types:
            if not album_name:
                album_name = seg_text
            continue
        if not artist_name:
            artist_name = seg_text
        elif not album_name:
            album_name = seg_text

    artist_clean = clean_artist_name(artist_name) if artist_name else "Artiste inconnu"

    if not detected_type:
        if music_video_type == "MUSIC_VIDEO_TYPE_ATV":
            detected_type = "track"
        elif music_video_type in ["MUSIC_VIDEO_TYPE_OMV", "MUSIC_VIDEO_TYPE_UGC"]:
            detected_type = "video"
        elif playlist_id:
            detected_type = "album" if playlist_id.startswith("OLAK") else "playlist"
        elif browse_id:
            detected_type = "album" if ("MPREb_" in browse_id or "OLAK" in browse_id) else "playlist"
        elif video_id:
            detected_type = "video" if any(k in title.lower() for k in ["clip", "video", "vidéo", "live"]) else "track"

    if (playlist_id and playlist_id.startswith("OLAK")) or (browse_id and ("MPREb_" in browse_id or "OLAK" in browse_id)):
        detected_type = "album"
    elif (playlist_id and playlist_id.startswith("PL")) or (browse_id and browse_id.startswith("VLPL")):
        detected_type = "playlist"

    url = ""
    if browse_id and browse_id.startswith("MPREb_"):
        url = f"https://music.youtube.com/browse/{browse_id}"
    elif playlist_id:
        url = f"https://music.youtube.com/playlist?list={playlist_id}"
    elif browse_id:
        if browse_id.startswith("VLOLAK5uy_") or browse_id.startswith("VLPL"):
            url = f"https://music.youtube.com/playlist?list={browse_id[2:]}"
        else:
            url = f"https://music.youtube.com/browse/{browse_id}"
    elif video_id:
        url = f"https://music.youtube.com/watch?v={video_id}"

    if not url:
        return None, (artist_clean if artist_clean != "Artiste inconnu" else None)

    is_audio_only_track = (music_video_type == "MUSIC_VIDEO_TYPE_ATV" or explicit_track_tag)
    is_concert = False
    if not is_audio_only_track and (detected_type in ("video", "track") or not detected_type) and not playlist_id and not (browse_id and ("OLAK" in str(browse_id) or "MPREb_" in str(browse_id))):
        if duration_str:
            dur_parts = duration_str.split(":")
            if len(dur_parts) >= 3 or (len(dur_parts) == 2 and dur_parts[0].isdigit() and int(dur_parts[0]) >= 20):
                is_concert = True
        if not is_concert and title and re.search(r"\b(full\s+concert|live\s+at|live\s+in|concert\s+complet|live\s+tour|festival\s+live|live\s+session|live\s+show|en\s+concert)\b", title, re.IGNORECASE):
            is_concert = True
    if is_concert:
        detected_type = "video"

    card_item = {
        "id": (browse_id if detected_type == "album" and browse_id else None) or video_id or playlist_id or browse_id,
        "title": title,
        "artist": artist_clean,
        "album": album_name or (title if detected_type == "album" else None),
        "year": year_str,
        "track_count": track_count_str,
        "duration": duration_str,
        "url": url,
        "thumbnail": thumb_url,
        "type": detected_type or "track",
        "subtype": release_subtype or ("album" if (detected_type == "album") else None),
        "subtype_explicit": subtype_explicit,
        "is_concert": is_concert
    }
    if card_item["type"] == "album" and track_count_str:
        _reconcile_album_subtype(card_item)
    return card_item, (artist_clean if artist_clean != "Artiste inconnu" else None)


def _reconcile_album_subtype(item: dict):
    """
    Harmonise le sous-type d'une sortie ('album', 'ep', 'single') avec son nombre réel
    de pistes et les métadonnées officielles afin d'éviter qu'un EP de 4-6 titres soit
    étiqueté 'Single' (cas fréquent des carrousels YTM 'Singles et EP') ou qu'un single
    de 1-2 titres porte le badge 'Album'.
    """
    if not item or item.get("type") != "album":
        return
    tc_str = str(item.get("track_count") or "")
    m = re.search(r"(\d+)", tc_str)
    if not m:
        return
    cnt = int(m.group(1))
    if cnt <= 0:
        return

    cur_sub = (item.get("subtype") or "album").lower()
    explicit = bool(item.get("subtype_explicit"))

    if cnt == 1:
        item["subtype"] = "single"
    elif 2 <= cnt <= 3:
        if cur_sub != "ep" and not (explicit and cur_sub == "album"):
            item["subtype"] = "single"
    elif 4 <= cnt <= 6:
        if cur_sub == "single" or (cur_sub == "album" and not explicit and cnt <= 5):
            item["subtype"] = "ep"
    elif cnt >= 7:
        if cur_sub in ("single", "ep") and not (explicit and cur_sub == "ep" and cnt <= 7):
            item["subtype"] = "album"


_TRACK_COUNT_CACHE: Dict[str, Any] = {}

async def _fetch_single_item_track_count(client: httpx.AsyncClient, item: dict):
    item_type = item.get("type")
    if item_type not in ["album", "playlist"]:
        return
    if item.get("track_count") and (item_type != "album" or (item.get("subtype_explicit") and item.get("year"))):
        _reconcile_album_subtype(item)
        return

    browse_id = extract_ytm_browse_id(item.get("id") or item.get("url"))
    if not browse_id:
        return

    if browse_id in _TRACK_COUNT_CACHE:
        cached = _TRACK_COUNT_CACHE[browse_id]
        if isinstance(cached, dict):
            if cached.get("track_count") and not item.get("track_count"):
                item["track_count"] = cached["track_count"]
            if cached.get("year") and not item.get("year"):
                item["year"] = cached["year"]
            if item_type == "album" and cached.get("subtype"):
                item["subtype"] = cached["subtype"]
                item["subtype_explicit"] = True
        elif isinstance(cached, str) and not item.get("track_count"):
            item["track_count"] = cached
        _reconcile_album_subtype(item)
        return

    api_url = "https://music.youtube.com/youtubei/v1/browse?prettyPrint=false"
    payload = {
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": _YTM_CLIENT_VERSION,
                "hl": "fr",
                "gl": "FR"
            }
        },
        "browseId": browse_id
    }
    try:
        resp = await client.post(api_url, json=payload, headers=YTM_HEADERS)
        if resp.status_code == 200:
            data = resp.json()
            track_count = None
            browse_subtype = None
            browse_year = None

            # 0. Extraire le sous-type officiel (Album / EP / Single) et l'année depuis le header browse
            hdr1 = _find_first_key(data, "musicResponsiveHeaderRenderer")
            hdr2 = _find_first_key(data, "musicDetailHeaderRenderer")
            hdr = hdr1 if hdr1 is not _SENTINEL else (hdr2 if hdr2 is not _SENTINEL else {})
            if isinstance(hdr, dict):
                for r in hdr.get("subtitle", {}).get("runs", []):
                    txt = r.get("text", "").strip()
                    if not txt:
                        continue
                    txt_l = txt.lower()
                    if txt_l in ("album", "ep", "single", "mini-album"):
                        browse_subtype = "ep" if txt_l == "mini-album" else txt_l
                    elif re.match(r"^(19\d\d|20\d\d)$", txt):
                        browse_year = txt

            # 1. Chercher dans secondSubtitle (ex: "13 titres • 1 heure 14 minutes")
            for sec in _find_all_key(data, "secondSubtitle"):
                for r in sec.get("runs", []):
                    m = re.search(r"(\d+)\s*(titres|pistes|morceaux|chansons|songs|tracks)", r.get("text", ""), re.IGNORECASE)
                    if m:
                        cnt = int(m.group(1))
                        track_count = f"{cnt} titre" if cnt == 1 else f"{cnt} titres"
                        break
                if track_count:
                    break

            # 2. Fallback : compter les musicResponsiveListItemRenderer
            if not track_count:
                renderers = list(_find_all_key(data, "musicResponsiveListItemRenderer"))
                if renderers:
                    cnt = len(renderers)
                    track_count = f"{cnt} titre" if cnt == 1 else f"{cnt} titres"

            if track_count:
                item["track_count"] = track_count
            if browse_year and not item.get("year"):
                item["year"] = browse_year
            if item_type == "album" and browse_subtype:
                item["subtype"] = browse_subtype
                item["subtype_explicit"] = True

            _reconcile_album_subtype(item)

            if track_count or browse_subtype or browse_year:
                _TRACK_COUNT_CACHE[browse_id] = {
                    "track_count": track_count,
                    "subtype": item.get("subtype") if item_type == "album" else None,
                    "year": browse_year
                }
    except Exception:
        pass

async def _enrich_track_counts(items: list):
    to_enrich = [
        x for x in items
        if x.get("type") in ["album", "playlist"] and (
            not x.get("track_count") or (x.get("type") == "album" and not x.get("subtype_explicit"))
        )
    ]
    if to_enrich:
        try:
            limits = httpx.Limits(max_connections=25, max_keepalive_connections=20)
            async with httpx.AsyncClient(timeout=4.5, limits=limits) as client:
                tasks = [_fetch_single_item_track_count(client, it) for it in to_enrich]
                await asyncio.gather(*tasks, return_exceptions=True)
        except Exception:
            pass
    for it in items:
        if it.get("type") == "album":
            _reconcile_album_subtype(it)

def generate_query_variants(query: str) -> List[str]:
    """
    Génère des variantes pertinentes de la requête de recherche pour pallier
    les différences de tokenisation de YouTube Music (espacements autour de &,
    tirets, barres obliques, apostrophes, accents).
    Limite le nombre de variantes à 3 au maximum pour préserver la latence.
    """
    clean = re.sub(r"\s+", " ", query).strip()
    if not clean:
        return []

    variants = [clean]
    seen = {clean.lower()}

    def add_variant(v: str):
        v_clean = re.sub(r"\s+", " ", v).strip()
        if v_clean and v_clean.lower() not in seen:
            seen.add(v_clean.lower())
            variants.append(v_clean)

    # 1. Gestion de l'esperluette (&) et des conjonctions (and, et)
    if "&" in clean:
        add_variant(re.sub(r"\s*&\s*", "&", clean))
        add_variant(re.sub(r"\s*&\s*", " & ", clean))
        add_variant(re.sub(r"\s*&\s*", " and ", clean))
    elif re.search(r"\b(?:and|et)\b", clean, flags=re.IGNORECASE):
        add_variant(re.sub(r"\s*\b(?:and|et)\b\s*", " & ", clean, flags=re.IGNORECASE))
        add_variant(re.sub(r"\s*\b(?:and|et)\b\s*", "&", clean, flags=re.IGNORECASE))

    # 2. Gestion de la barre oblique (/)
    if "/" in clean:
        add_variant(re.sub(r"\s*/\s*", " ", clean))
        add_variant(re.sub(r"\s*/\s*", "", clean))
        add_variant(re.sub(r"\s*/\s*", "-", clean))

    # 3. Gestion du tiret (-) entre mots/chiffres
    if "-" in clean:
        add_variant(re.sub(r"\s*-\s*", " ", clean))
        add_variant(re.sub(r"\s*-\s*", "", clean))

    # 4. Gestion des apostrophes (' ou ’)
    if "'" in clean or "’" in clean:
        add_variant(re.sub(r"['’]", "", clean))

    # 5. Gestion des accents (diacritiques)
    unaccented = unicodedata.normalize("NFKD", clean).encode("ASCII", "ignore").decode("utf-8")
    if unaccented.lower() != clean.lower():
        add_variant(unaccented)

    return variants[:3]


def _normalize_for_search_ranking(text: Optional[str]) -> str:
    """
    Normalisation tolérante pour le scoring de pertinence artiste.
    """
    if not text:
        return ""
    s = unicodedata.normalize("NFKD", str(text)).encode("ASCII", "ignore").decode("utf-8")
    s = re.sub(r"\s*(?:[\-–—]\s*|\()(?:topic|th[eè]me)\)?\s*$", "", s, flags=re.IGNORECASE)
    s = s.lower().replace("&", " and ").replace("+", " and ")
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


_TRIBUTE_POLLUTION_RE = re.compile(
    r"\b(tribute|hommage|karaoke|karaok[eé]|8[\s-]*bit|lullaby|lullabies|piano\s+covers?|"
    r"string\s+quartet|vitamin\s+string|made\s+famous\s+by|originally\s+performed\s+by|"
    r"in\s+the\s+style\s+of|cover\s+band)\b",
    re.IGNORECASE
)


def _score_search_item(
    it: dict,
    q_norm: str,
    q_no_space: str,
    q_tokens: set,
    query_wants_tribute: bool,
    pos: int,
    weight: float = 1.0
) -> float:
    """
    Calcule un score de pertinence composite pour classer les résultats de recherche :
    - Respecte le rang initial YouTube Music comme base
    - Favorise les correspondances exactes d'artiste, de titre ou du couple (artiste + titre)
    - Pénalise fortement les hommages, karaokés et reprises tiers non sollicités
    """
    pos_score = max(1, 30 - pos)
    score = pos_score * weight

    item_type = it.get("type") or "track"
    title_raw = it.get("title") or ""
    art_raw = it.get("artist") or (title_raw if item_type == "artist" else "")

    art_norm = _normalize_for_search_ranking(art_raw)
    art_no_space = art_norm.replace(" ", "")
    title_norm = _normalize_for_search_ranking(title_raw)
    title_no_space = title_norm.replace(" ", "")

    if item_type == "artist" and (art_norm == q_norm or art_no_space == q_no_space):
        score += 42.0

    if art_norm:
        if art_norm == q_norm or art_no_space == q_no_space:
            score += 28.0
        elif q_norm and (q_norm in art_norm or art_norm in q_norm):
            score += 14.0

    if title_norm and item_type != "artist":
        if title_norm == q_norm or title_no_space == q_no_space:
            score += 22.0
        elif q_norm and q_norm in title_norm:
            score += 10.0

    # Bonus fort lorsque la requête combine Artiste + Titre (ex: 'Daft Punk Discovery')
    if q_tokens and len(q_tokens) >= 2 and art_norm and title_norm:
        combined_tokens = set((art_norm + " " + title_norm).split())
        overlap = len(q_tokens & combined_tokens) / len(q_tokens)
        if overlap >= 0.99:
            score += 32.0
        elif overlap >= 0.75:
            score += 18.0

    # Pénalisation des hommages / karaokés / reprises tiers si non demandés dans la requête
    if not query_wants_tribute:
        if _TRIBUTE_POLLUTION_RE.search(art_raw) or _TRIBUTE_POLLUTION_RE.search(title_raw):
            score -= 35.0

    return score


def _item_matches_filter_type(parsed: dict, filter_type: str) -> bool:
    item_id = parsed.get("id", "") or ""
    p_type = parsed.get("type", "")
    if filter_type == "artist":
        return p_type == "artist"
    if filter_type in ("album", "ep", "single"):
        return p_type == "album" and not (item_id.startswith("PL") and not item_id.startswith("OLAK"))
    if filter_type == "playlist":
        return p_type == "playlist" and "OLAK" not in item_id and "MPREb_" not in item_id
    if filter_type == "track":
        return p_type == "track"
    if filter_type == "video":
        return p_type == "video"
    return True


async def _single_search_ytm_innertube(query: str, filter_type: str = "all") -> dict:
    """
    Exécute une requête unitaire brute vers l'API Innertube de YouTube Music.
    """
    url = "https://music.youtube.com/youtubei/v1/search?prettyPrint=false"
    payload = {
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": _YTM_CLIENT_VERSION,
                "hl": "fr",
                "gl": "FR"
            }
        },
        "query": query
    }
    effective_chip = "album" if filter_type in ("album", "ep", "single") else filter_type
    if effective_chip in CHIP_PARAMS:
        payload["params"] = CHIP_PARAMS[effective_chip]

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.post(url, json=payload, headers=YTM_HEADERS)
            if resp.status_code != 200:
                return {"results": [], "continuation": None}
            try:
                data = resp.json()
            except Exception:
                print(f"Erreur décodage JSON Innertube search (CAPTCHA/rate-limit ?)")
                return {"results": [], "continuation": None}
    except Exception as e:
        print(f"Erreur requête Innertube YTM search: {e}")
        return {"results": [], "continuation": None}

    tabs = data.get("contents", {}).get("tabbedSearchResultsRenderer", {}).get("tabs", [])
    first_tab = tabs[0] if tabs else {}
    slr = first_tab.get("tabRenderer", {}).get("content", {}).get("sectionListRenderer", {})

    contents = slr.get("contents", [])

    all_items = []
    seen_urls = set()
    continuation_token = None

    for section in contents:
        items = []
        def_art = None
        if "musicShelfRenderer" in section:
            msr = section["musicShelfRenderer"]
            items = msr.get("contents", [])
            conts = msr.get("continuations", [])
            if conts and not continuation_token:
                continuation_token = conts[0].get("nextContinuationData", {}).get("continuation")
        elif "itemSectionRenderer" in section:
            items = section["itemSectionRenderer"].get("contents", [])
        elif "musicCardShelfRenderer" in section:
            mcs = section["musicCardShelfRenderer"]
            top_card, card_artist = _parse_music_card_shelf(mcs)
            def_art = card_artist
            if top_card and top_card.get("url") and top_card["url"] not in seen_urls:
                if _item_matches_filter_type(top_card, filter_type):
                    seen_urls.add(top_card["url"])
                    all_items.append(top_card)
            items = mcs.get("contents", [])

        for it in items:
            renderer = it.get("musicResponsiveListItemRenderer")
            if renderer:
                parsed = _parse_innertube_item(renderer, default_artist=def_art)
                if parsed and parsed["url"] not in seen_urls:
                    seen_urls.add(parsed["url"])
                    if not _item_matches_filter_type(parsed, filter_type):
                        continue
                    all_items.append(parsed)

    if not continuation_token:
        conts = slr.get("continuations", [])
        if conts:
            continuation_token = conts[0].get("nextContinuationData", {}).get("continuation")

    return {"results": all_items, "continuation": continuation_token}


async def search_ytm_innertube(query: str, filter_type: str = "all", multi_variant: bool = True) -> dict:
    """
    Interroge l'API officielle YouTube Music Web (Innertube WEB_REMIX) avec exploration
    multi-variantes transparente (gestion des symboles, espacements, tirets et accents).
    Fusionne, dédouble et classe par pertinence croisée avec enrichissement de pistes.
    """
    clean_q = query.strip()
    if not clean_q:
        return {"results": [], "continuation": None}

    variants = generate_query_variants(clean_q) if multi_variant else [clean_q]

    q_norm = _normalize_for_search_ranking(clean_q)
    q_no_space = q_norm.replace(" ", "")
    q_tokens = set(q_norm.split()) if q_norm else set()
    query_wants_tribute = bool(_TRIBUTE_POLLUTION_RE.search(clean_q))

    # Exécution d'une ou plusieurs variantes (+ recherche parallèle du profil artiste si filtre album/ep/single)
    artist_probe_res = None
    if filter_type in ("album", "ep", "single"):
        tasks = [_single_search_ytm_innertube(v, filter_type) for v in variants]
        tasks.append(_single_search_ytm_innertube(variants[0], "artist"))
        responses = await asyncio.gather(*tasks, return_exceptions=True)
        if responses and isinstance(responses[-1], dict):
            artist_probe_res = responses[-1]
        search_responses = responses[:-1]
        valid_responses = [r for r in search_responses if isinstance(r, dict) and r.get("results")]
    elif len(variants) <= 1:
        res = await _single_search_ytm_innertube(variants[0], filter_type)
        valid_responses = [res] if (res and res.get("results")) else []
    else:
        tasks = [_single_search_ytm_innertube(v, filter_type) for v in variants]
        responses = await asyncio.gather(*tasks, return_exceptions=True)
        valid_responses = [r for r in responses if isinstance(r, dict) and r.get("results")]

    if not valid_responses and not (artist_probe_res and artist_probe_res.get("results")):
        return {"results": [], "continuation": None}

    id_scores = {}
    item_map = {}
    best_continuation = None

    for q_idx, r in enumerate(valid_responses):
        items = r.get("results", [])
        conts = r.get("continuation")
        if q_idx == 0 and conts:
            best_continuation = conts
        elif not best_continuation and conts:
            best_continuation = conts

        weight = 1.25 if q_idx == 0 else 1.0
        for pos, it in enumerate(items):
            key = it.get("url") or it.get("id") or f"{it.get('type')}:{it.get('title')}:{it.get('artist')}"
            if key not in item_map:
                item_map[key] = it
            score = _score_search_item(it, q_norm, q_no_space, q_tokens, query_wants_tribute, pos, weight)
            id_scores[key] = id_scores.get(key, 0.0) + score

    sorted_keys = sorted(item_map.keys(), key=lambda k: id_scores.get(k, 0.0), reverse=True)
    all_ranked = [item_map[k] for k in sorted_keys]

    # Si l'utilisateur a cherché le nom exact d'un artiste en mode album/ep/single ou all,
    # enrichir avec la discographie officielle certifiée de cet artiste (car le chip 'album'
    # de YouTube Music ne cherche que dans le titre de l'album et renvoie des singles tiers !).
    official_disco_items = []
    if filter_type in ("album", "ep", "single", "all") and not query_wants_tribute:
        cand_artists = []
        if artist_probe_res and artist_probe_res.get("results"):
            cand_artists.extend(artist_probe_res["results"])
        cand_artists.extend([x for x in all_ranked if x.get("type") == "artist"])

        matched_artist = None
        for ca in cand_artists:
            ca_id = str(ca.get("id") or "")
            ca_name = ca.get("title") or ca.get("artist") or ""
            ca_norm = _normalize_for_search_ranking(ca_name)
            ca_no_space = ca_norm.replace(" ", "")
            if ca_id.startswith("UC") and ca_norm and (ca_norm == q_norm or ca_no_space == q_no_space):
                matched_artist = ca
                break

        if matched_artist:
            try:
                disco_data = await browse_artist_discography(
                    matched_artist["id"],
                    matched_artist.get("title") or matched_artist.get("artist") or clean_q,
                    enrich=False
                )
                official_disco_items = disco_data.get("results") or []
            except Exception:
                official_disco_items = []

    if filter_type != "all":
        if official_disco_items and filter_type in ("album", "ep", "single"):
            disco_lps = [x for x in official_disco_items if x.get("subtype") == "album"]
            disco_short = [x for x in official_disco_items if x.get("subtype") in ("ep", "single")]
            if filter_type in ("ep", "single"):
                prioritized_disco = disco_short[:28] + disco_lps[:12]
            else:
                prioritized_disco = disco_lps[:24] + disco_short[:16]

            merged_albums = []
            seen_ids = set()
            seen_title_artist = set()
            for it in prioritized_disco + all_ranked:
                uid = it.get("id") or it.get("url")
                ta_key = (
                    _normalize_for_search_ranking(it.get("title")),
                    _normalize_for_search_ranking(it.get("artist"))
                )
                if uid and uid in seen_ids:
                    continue
                if ta_key[0] and ta_key in seen_title_artist:
                    continue
                if uid:
                    seen_ids.add(uid)
                if ta_key[0]:
                    seen_title_artist.add(ta_key)
                merged_albums.append(it)
            final_list = merged_albums[:40]
        else:
            final_list = all_ranked[:35]

        if filter_type in ["album", "ep", "single", "playlist"]:
            await _enrich_track_counts(final_list)
        return {"results": final_list, "continuation": best_continuation}

    # Mode "all" avec équilibrage des catégories et préservation du meilleur résultat en tête
    artists = [x for x in all_ranked if x["type"] == "artist"]
    raw_albums = [x for x in all_ranked if x["type"] == "album"]
    if official_disco_items:
        albums = []
        seen_alb = set()
        for alb in official_disco_items[:10] + raw_albums:
            tk = (_normalize_for_search_ranking(alb.get("title")), _normalize_for_search_ranking(alb.get("artist")))
            if tk not in seen_alb:
                seen_alb.add(tk)
                albums.append(alb)
    else:
        albums = raw_albums
    playlists = [x for x in all_ranked if x["type"] == "playlist"]
    tracks = [x for x in all_ranked if x["type"] == "track"]
    videos = [x for x in all_ranked if x["type"] == "video"]

    combined = []
    # Placer le meilleur résultat global (ex: album exact cherché ou profil artiste) en #1
    if all_ranked:
        combined.append(all_ranked[0])
    if artists and artists[0] not in combined:
        combined.append(artists[0])

    for i in range(8):
        if i < len(albums) and albums[i] not in combined:
            combined.append(albums[i])
        if i < len(tracks) and tracks[i] not in combined:
            combined.append(tracks[i])
        if i < len(videos) and videos[i] not in combined:
            combined.append(videos[i])
        if i < len(playlists) and playlists[i] not in combined:
            combined.append(playlists[i])

    if len(combined) < 30:
        for it in all_ranked:
            if it not in combined:
                combined.append(it)
            if len(combined) >= 30:
                break

    await _enrich_track_counts(combined)
    return {"results": combined, "continuation": best_continuation}

async def search_ytm_continuation(continuation_token: str, filter_type: str = "all") -> dict:
    """
    Récupère le lot suivant de résultats de recherche via un continuation token Innertube.
    Permet une pagination infinie par tranches de 20 éléments avec ré-extraction du prochain token.
    """
    if not continuation_token:
        return {"results": [], "continuation": None}

    url = f"https://music.youtube.com/youtubei/v1/search?continuation={continuation_token}&prettyPrint=false"
    payload = {
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": _YTM_CLIENT_VERSION,
                "hl": "fr",
                "gl": "FR"
            }
        }
    }

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.post(url, json=payload, headers=YTM_HEADERS)
            if resp.status_code != 200:
                return {"results": [], "continuation": None}
            try:
                data = resp.json()
            except Exception:
                return {"results": [], "continuation": None}
    except Exception as e:
        print(f"Erreur requête Innertube YTM continuation: {e}")
        return {"results": [], "continuation": None}

    cc = data.get("continuationContents", {})
    shelf = cc.get("musicShelfContinuation") or cc.get("sectionListContinuation") or cc.get("musicPlaylistShelfContinuation")
    if not shelf:
        for k, v in cc.items():
            if isinstance(v, dict) and ("contents" in v or "continuations" in v):
                shelf = v
                break
    shelf = shelf or {}

    items_raw = shelf.get("contents", [])
    parsed_items = []
    seen_urls = set()

    for it in items_raw:
        renderer = it.get("musicResponsiveListItemRenderer")
        if renderer:
            parsed = _parse_innertube_item(renderer)
            if parsed and parsed["url"] not in seen_urls:
                seen_urls.add(parsed["url"])
                if not _item_matches_filter_type(parsed, filter_type):
                    continue
                parsed_items.append(parsed)

    next_token = None
    conts = shelf.get("continuations", [])
    if conts:
        next_token = conts[0].get("nextContinuationData", {}).get("continuation")

    if filter_type in ["album", "ep", "single", "playlist", "all"]:
        await _enrich_track_counts(parsed_items)

    return {"results": parsed_items, "continuation": next_token}

async def browse_ytm_innertube(url_or_id: str) -> Optional[dict]:
    """
    Explore une playlist ou un album directement via YouTube Music Innertube WEB_REMIX.
    Retourne la liste des pistes exactes, les identifiants vidéo actifs, le statut réel
    de disponibilité et les métadonnées officielles complètes.
    """
    browse_id = extract_ytm_browse_id(url_or_id)
    if not browse_id:
        return None

    api_url = "https://music.youtube.com/youtubei/v1/browse?prettyPrint=false"
    payload = {
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": _YTM_CLIENT_VERSION,
                "hl": "fr",
                "gl": "FR"
            }
        },
        "browseId": browse_id
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(api_url, json=payload, headers=YTM_HEADERS)
            if resp.status_code != 200:
                return None
            try:
                data = resp.json()
            except Exception:
                print(f"Erreur décodage JSON Innertube browse (CAPTCHA/rate-limit ?)")
                return None
    except Exception as e:
        print(f"Erreur requête Innertube YTM browse ({browse_id}): {e}")
        return None


    # Extraction du titre
    mf = data.get("microformat", {}).get("microformatDataRenderer", {})
    title = mf.get("title")

    hdr1 = _find_first_key(data, "musicResponsiveHeaderRenderer")
    hdr2 = _find_first_key(data, "musicDetailHeaderRenderer")
    hdr = hdr1 if hdr1 is not _SENTINEL else (hdr2 if hdr2 is not _SENTINEL else {})
    if not title:
        t_runs = hdr.get("title", {}).get("runs", [])
        if t_runs:
            title = t_runs[0].get("text")
    if not title:
        title = "Album / Playlist"

    # Extraction de l'artiste principal, du sous-type (album/ep/single) et de l'année
    artist = "Artiste inconnu"
    release_subtype = "album"
    year_val = None

    strap_runs = hdr.get("straplineTextOne", {}).get("runs", [])
    if strap_runs:
        artist = clean_artist_name(strap_runs[0].get("text"))

    sub_runs = hdr.get("subtitle", {}).get("runs", [])
    for r in sub_runs:
        txt = r.get("text", "").strip()
        if not txt:
            continue
        txt_lower = txt.lower()
        if txt_lower in ["ep", "single", "album"]:
            release_subtype = txt_lower
        elif re.match(r"^(19\d\d|20\d\d)$", txt):
            year_val = txt
        nav = r.get("navigationEndpoint", {})
        pt = (
            nav.get("browseEndpoint", {})
               .get("browseEndpointContextSupportedConfigs", {})
               .get("browseEndpointContextMusicConfig", {})
               .get("pageType")
        )
        if pt == "MUSIC_PAGE_TYPE_ARTIST" and artist == "Artiste inconnu":
            artist = clean_artist_name(txt)

    # Thumbnail HD
    thumb_url = ""
    if mf.get("thumbnail", {}).get("thumbnails"):
        thumb_url = mf["thumbnail"]["thumbnails"][-1].get("url", "")
    elif hdr.get("thumbnail"):
        th_list = hdr["thumbnail"].get("musicThumbnailRenderer", {}).get("thumbnail", {}).get("thumbnails", [])
        if not th_list and hdr["thumbnail"].get("thumbnails"):
            th_list = hdr["thumbnail"].get("thumbnails", [])
        if th_list:
            thumb_url = th_list[-1].get("url", "")
    if thumb_url.startswith("//"):
        thumb_url = "https:" + thumb_url

    # Extraction des pistes
    tracks = []
    avail_count = 0
    raw_renderers = list(_find_all_key(data, "musicResponsiveListItemRenderer"))

    artist_counts: Dict[str, int] = {}
    album_counts: Dict[str, int] = {}

    for idx, it in enumerate(raw_renderers, 1):
        flex = it.get("flexColumns", [])
        if not flex:
            continue

        # Titre de la piste (colonne 0)
        t_runs = flex[0].get("musicResponsiveListItemFlexColumnRenderer", {}).get("text", {}).get("runs", [])
        t_name = t_runs[0].get("text") if t_runs else f"Piste {idx}"

        # Extraction du videoId
        play_nav = (
            it.get("overlay", {})
              .get("musicItemThumbnailOverlayRenderer", {})
              .get("content", {})
              .get("musicPlayButtonRenderer", {})
              .get("playNavigationEndpoint", {})
        )
        vid = play_nav.get("watchEndpoint", {}).get("videoId")
        if not vid:
            vid = it.get("playlistItemData", {}).get("videoId")

        dur_text = None
        fixed_cols = it.get("fixedColumns", [])
        if fixed_cols:
            f_runs = fixed_cols[0].get("musicResponsiveListItemFixedColumnRenderer", {}).get("text", {}).get("runs", [])
            if f_runs:
                dur_text = f_runs[0].get("text")

        track_artist = "Artiste inconnu"
        album_name = None
        for col in flex[1:]:
            col_runs = col.get("musicResponsiveListItemFlexColumnRenderer", {}).get("text", {}).get("runs", [])
            for r in col_runs:
                txt = r.get("text", "").strip()
                if not txt or txt == "•":
                    continue
                nav = r.get("navigationEndpoint", {})
                pt = (
                    nav.get("browseEndpoint", {})
                       .get("browseEndpointContextSupportedConfigs", {})
                       .get("browseEndpointContextMusicConfig", {})
                       .get("pageType")
                )
                if pt == "MUSIC_PAGE_TYPE_ARTIST":
                    if track_artist == "Artiste inconnu":
                        track_artist = clean_artist_name(txt)
                elif pt == "MUSIC_PAGE_TYPE_ALBUM":
                    if not album_name:
                        album_name = txt
                        album_counts[txt] = album_counts.get(txt, 0) + 1

        if track_artist == "Artiste inconnu" and len(flex) > 1:
            col1 = flex[1].get("musicResponsiveListItemFlexColumnRenderer", {}).get("text", {}).get("runs", [])
            if col1:
                track_artist = clean_artist_name(col1[0].get("text", "").strip())

        if track_artist == "Artiste inconnu" and artist and artist != "Artiste inconnu":
            track_artist = clean_artist_name(artist)
        else:
            track_artist = clean_artist_name(track_artist)

        if track_artist and track_artist != "Artiste inconnu":
            artist_counts[track_artist] = artist_counts.get(track_artist, 0) + 1

        # Détection précise de l'indisponibilité (pistes grisées / indisponibles)
        display_policy = str(it.get("musicItemRendererDisplayPolicy") or "")
        is_greyed_out = any(flag in display_policy for flag in ["GREY_OUT", "GRAY_OUT", "UNAVAILABLE", "DISABLED", "RESTRICTED"])
        is_disabled = bool(it.get("isDisabled", False))

        # Sur YouTube Music, une piste jouable possède un playNavigationEndpoint actif dans le musicPlayButtonRenderer
        # ou un navigationEndpoint avec watchEndpoint dans le titre.
        title_nav = t_runs[0].get("navigationEndpoint", {}) if t_runs else {}
        has_title_watch = bool(title_nav.get("watchEndpoint", {}).get("videoId"))
        has_play_watch = bool(play_nav.get("watchEndpoint", {}).get("videoId"))
        has_playable_endpoint = has_title_watch or has_play_watch

        is_unavailable_title = (
            not t_name or
            t_name.strip() in ["[Private video]", "[Deleted video]", "[Vidéo supprimée]", "[Vidéo privée]", "NA"] or
            "vidéo indisponible" in t_name.lower() or
            "titre indisponible" in t_name.lower()
        )

        is_avail = (
            not is_greyed_out and
            not is_disabled and
            not is_unavailable_title and
            bool(vid) and
            has_playable_endpoint
        )
        if is_avail:
            avail_count += 1

        tracks.append({
            "track_number": idx,
            "title": t_name,
            "artist": track_artist,
            "album": album_name,
            "duration": dur_text,
            "is_available": is_avail,
            "video_id": vid if is_avail else None
        })

    # Si le titre de l'en-tête n'a pas été trouvé (ex: vue VLOLAK...), déduire depuis les pistes
    if (not title or title == "Album / Playlist") and album_counts:
        majority_album = max(album_counts.items(), key=lambda x: x[1])[0]
        title = majority_album

    # Déduction intelligente de l'artiste général
    if not artist or artist == "Artiste inconnu":
        if len(artist_counts) >= 3:
            artist = "Various Artists"
        elif artist_counts:
            majority_artist = max(artist_counts.items(), key=lambda x: x[1])[0]
            artist = clean_artist_name(majority_artist)
    else:
        artist = clean_artist_name(artist)

    total_tracks = len(tracks)
    missing_count = total_tracks - avail_count

    return {
        "success": True,
        "title": title,
        "artist": artist,
        "year": year_val,
        "subtype": release_subtype,
        "thumbnail": thumb_url,
        "total_tracks": total_tracks,
        "available_tracks": avail_count,
        "missing_count": missing_count,
        "is_complete": missing_count == 0,
        "tracks": tracks
    }


async def browse_artist_discography(browse_id: str, artist_name: str = "", enrich: bool = True) -> dict:
    """
    Explore la discographie officielle complète d'un artiste via son identifiant de chaîne Innertube.
    Extrait 100% des albums officiels, singles et EPs de l'artiste sans aucune pollution tiers ni hommages.
    """
    artist_name = clean_artist_name(artist_name)
    url = "https://music.youtube.com/youtubei/v1/browse?prettyPrint=false"
    payload = {
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": _YTM_CLIENT_VERSION,
                "hl": "fr",
                "gl": "FR"
            }
        },
        "browseId": browse_id
    }
    
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, json=payload, headers=YTM_HEADERS)
            data = resp.json()
    except Exception as e:
        return {"results": [], "artist": artist_name, "error": str(e), "official": True}

    tabs = data.get("contents", {}).get("singleColumnBrowseResultsRenderer", {}).get("tabs", [])
    if not tabs:
        return {"results": [], "artist": artist_name, "official": True}
    contents = tabs[0].get("tabRenderer", {}).get("content", {}).get("sectionListRenderer", {}).get("contents", [])
    
    album_endpoint = None
    single_endpoint = None
    direct_album_items = []
    direct_single_items = []

    for sec in contents:
        car = sec.get("musicCarouselShelfRenderer", {})
        if not car:
            continue
        header_title = car.get("header", {}).get("musicCarouselShelfBasicHeaderRenderer", {}).get("title", {}).get("runs", [{}])[0].get("text", "").lower()
        more_btn = car.get("header", {}).get("musicCarouselShelfBasicHeaderRenderer", {}).get("moreContentButton", {}).get("buttonRenderer", {}).get("navigationEndpoint", {}).get("browseEndpoint", {})
        
        if "album" in header_title:
            if more_btn and more_btn.get("browseId"):
                album_endpoint = more_btn
            else:
                direct_album_items = car.get("contents", [])
        elif "single" in header_title or "ep" in header_title:
            if more_btn and more_btn.get("browseId"):
                single_endpoint = more_btn
            else:
                direct_single_items = car.get("contents", [])

    results = []

    def parse_two_row_item(it, default_subtype="album"):
        m = it.get("musicTwoRowItemRenderer", {})
        if not m:
            return None
        title = m.get("title", {}).get("runs", [{}])[0].get("text", "")
        if not title:
            return None
        
        sub_runs = m.get("subtitle", {}).get("runs", [])
        sub_text = "".join(r.get("text", "") for r in sub_runs).strip()
        
        year_str = None
        subtype = default_subtype
        subtype_explicit = False
        sub_lower = sub_text.lower()
        if "single" in sub_lower:
            subtype = "single"
            subtype_explicit = True
        elif "ep" in sub_lower or "mini-album" in sub_lower:
            subtype = "ep"
            subtype_explicit = True
        elif "album" in sub_lower:
            subtype = "album"
            subtype_explicit = True

        m_year = re.search(r"\b(19\d\d|20\d\d)\b", sub_text)
        if m_year:
            year_str = m_year.group(1)

        nav = m.get("navigationEndpoint", {}).get("browseEndpoint", {})
        target_browse_id = nav.get("browseId", "")
        
        url_link = ""
        if target_browse_id:
            if target_browse_id.startswith("VLOLAK5uy_") or target_browse_id.startswith("VLPL"):
                url_link = f"https://music.youtube.com/playlist?list={target_browse_id[2:]}"
            else:
                url_link = f"https://music.youtube.com/browse/{target_browse_id}"
        
        thumb_renderer = m.get("thumbnailRenderer", {}).get("musicThumbnailRenderer", {}).get("thumbnail", {})
        thumbs = thumb_renderer.get("thumbnails", [])
        thumb_url = _upgrade_ytm_thumbnail(thumbs[-1].get("url", "") if thumbs else "")

        return {
            "id": target_browse_id or title,
            "title": title,
            "artist": artist_name,
            "artists": [artist_name] if artist_name else [],
            "album": title,
            "year": year_str,
            "track_count": None,
            "duration": None,
            "url": url_link,
            "thumbnail": thumb_url,
            "type": "album",
            "subtype": subtype,
            "subtype_explicit": subtype_explicit
        }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            # 1. Albums complets
            if album_endpoint and album_endpoint.get("browseId"):
                p = {
                    "context": {"client": {"clientName": "WEB_REMIX", "clientVersion": _YTM_CLIENT_VERSION, "hl": "fr", "gl": "FR"}},
                    "browseId": album_endpoint["browseId"],
                    "params": album_endpoint.get("params", "")
                }
                r = await client.post(url, json=p, headers=YTM_HEADERS)
                d = r.json()
                for it in _find_all_key(d, "musicTwoRowItemRenderer"):
                    item_dict = parse_two_row_item({"musicTwoRowItemRenderer": it}, default_subtype="album")
                    if item_dict:
                        item_dict["subtype_explicit"] = True
                        results.append(item_dict)
            elif direct_album_items:
                for it in direct_album_items:
                    item_dict = parse_two_row_item(it, default_subtype="album")
                    if item_dict:
                        item_dict["subtype_explicit"] = True
                        results.append(item_dict)

            # 2. Singles & EPs
            if single_endpoint and single_endpoint.get("browseId"):
                p = {
                    "context": {"client": {"clientName": "WEB_REMIX", "clientVersion": _YTM_CLIENT_VERSION, "hl": "fr", "gl": "FR"}},
                    "browseId": single_endpoint["browseId"],
                    "params": single_endpoint.get("params", "")
                }
                r = await client.post(url, json=p, headers=YTM_HEADERS)
                d = r.json()
                for it in _find_all_key(d, "musicTwoRowItemRenderer"):
                    item_dict = parse_two_row_item({"musicTwoRowItemRenderer": it}, default_subtype="single")
                    if item_dict:
                        results.append(item_dict)
            elif direct_single_items:
                for it in direct_single_items:
                    item_dict = parse_two_row_item(it, default_subtype="single")
                    if item_dict:
                        results.append(item_dict)
    except Exception:
        pass

    # Déduplication par titre + année
    seen = set()
    deduped = []
    for it in results:
        key = (it["title"].lower(), it["year"])
        if key not in seen:
            seen.add(key)
            deduped.append(it)

    # Enrichissement du nombre de pistes
    if deduped and enrich:
        await _enrich_track_counts(deduped)

    return {"results": deduped, "artist": artist_name, "browse_id": browse_id, "official": True}


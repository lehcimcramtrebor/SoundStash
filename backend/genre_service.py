import asyncio
import json
import re
import urllib.parse
import urllib.request
from typing import Optional, Dict, Tuple
import httpx

# Cache mémoire pour éviter les requêtes redondantes
# Clé : (artist_normalized, title_normalized, is_album)
_GENRE_CACHE: Dict[Tuple[str, str, bool], Optional[str]] = {}

GENRE_TRANSLATIONS = {
    "french pop": "Variété française",
    "chanson française": "Variété française",
    "chanson francaise": "Variété française",
    "soundtrack": "Bande originale",
    "soundtracks": "Bande originale",
    "electronic": "Musique électronique",
    "electronica": "Musique électronique",
    "hip-hop/rap": "Hip-hop/Rap",
    "hip hop/rap": "Hip-hop/Rap",
    "hip-hop": "Hip-hop/Rap",
    "rap": "Hip-hop/Rap",
    "r&b/soul": "R&B/Soul",
    "classical": "Classique",
    "musique classique": "Classique",
    "world": "Musiques du monde",
    "world music": "Musiques du monde",
    "children's music": "Jeunesse",
    "holiday": "Fêtes",
    "hard rock": "Hard Rock",
    "heavy metal": "Metal"
}

GENERIC_GENRES = {"pop", "rock", "alternatif", "alternative"}

def clean_term_for_search(term: Optional[str]) -> str:
    """Nettoie un titre ou nom d'album en retirant les parenthèses ou crochets de suffixes."""
    if not term:
        return ""
    # Retirer [Single], [AUDIO RIP], [Playlist], (Nom Album), etc.
    s = re.sub(r'\[.*?\]', '', term)
    s = re.sub(r'\(.*?\)', '', s)
    s = re.sub(r'^\d+\s*[-_.]\s*', '', s) # retirer numéros de piste au début
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def _normalize_genre_name(genre: Optional[str]) -> Optional[str]:
    if not genre or not genre.strip():
        return None
    g = genre.strip()
    g_lower = g.lower()
    if g_lower in GENRE_TRANSLATIONS:
        return GENRE_TRANSLATIONS[g_lower]
    return g

def _select_best_genre_from_results(results: list, clean_artist: str) -> Optional[str]:
    """
    Sélectionne le meilleur genre parmi les résultats iTunes en priorisant
    les genres culturels authentiques (Variété française, Chanson française, etc.)
    et les genres spécifiques par rapport aux étiquettes génériques (Pop, Rock).
    """
    if not results:
        return None
        
    art_lower = clean_artist.lower().strip()
    artist_results = []
    for r in results:
        res_art = r.get("artistName", "").lower().strip()
        if art_lower and (art_lower in res_art or res_art in art_lower):
            artist_results.append(r)
            
    target_results = artist_results if artist_results else results
    
    normalized_genres = []
    for r in target_results:
        g = _normalize_genre_name(r.get("primaryGenreName"))
        if g and g not in normalized_genres:
            normalized_genres.append(g)
            
    if not normalized_genres:
        return None
        
    # 1. Priorité absolue aux genres culturels français / francophones
    for g in normalized_genres:
        gl = g.lower()
        if "variété" in gl or "variete" in gl or "chanson" in gl or "french pop" in gl:
            return "Variété française"
            
    # 2. Priorité aux genres spécifiques non-génériques (Rap, Soundtrack, Electro, etc.)
    for g in normalized_genres:
        if g.lower() not in GENERIC_GENRES:
            return g
            
    # 3. Fallback sur le premier genre disponible (ex: Pop, Rock)
    return normalized_genres[0]

def _fetch_artist_official_genre_sync(clean_artist: str) -> Optional[str]:
    """Interroge l'entité musicArtist pour récupérer le genre officiel de l'artiste."""
    if not clean_artist or clean_artist in {"Artiste inconnu", "Various Artists"}:
        return None
    try:
        quoted = urllib.parse.quote(clean_artist)
        url = f"https://itunes.apple.com/search?term={quoted}&media=music&entity=musicArtist&limit=3&country=FR"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SoundStash/3.0"})
        with urllib.request.urlopen(req, timeout=2.5) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                results = data.get("results", [])
                art_lower = clean_artist.lower().strip()
                for r in results:
                    res_art = r.get("artistName", "").lower().strip()
                    if art_lower and (art_lower in res_art or res_art in art_lower):
                        return _normalize_genre_name(r.get("primaryGenreName"))
                if results:
                    return _normalize_genre_name(results[0].get("primaryGenreName"))
    except Exception:
        pass
    return None

async def _fetch_artist_official_genre_async(clean_artist: str) -> Optional[str]:
    """Interroge l'entité musicArtist en asynchrone pour récupérer le genre officiel de l'artiste."""
    if not clean_artist or clean_artist in {"Artiste inconnu", "Various Artists"}:
        return None
    try:
        quoted = urllib.parse.quote(clean_artist)
        url = f"https://itunes.apple.com/search?term={quoted}&media=music&entity=musicArtist&limit=3&country=FR"
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SoundStash/3.0"}
        async with httpx.AsyncClient(timeout=2.5) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                results = data.get("results", [])
                art_lower = clean_artist.lower().strip()
                for r in results:
                    res_art = r.get("artistName", "").lower().strip()
                    if art_lower and (art_lower in res_art or res_art in art_lower):
                        return _normalize_genre_name(r.get("primaryGenreName"))
                if results:
                    return _normalize_genre_name(results[0].get("primaryGenreName"))
    except Exception:
        pass
    return None

def detect_genre_sync(artist: str, title_or_album: str, is_album: bool = False) -> Optional[str]:
    """
    Détecte de manière synchrone le genre musical officiel via l'API Apple Music / iTunes Catalog.
    Utilisé notamment dans uniformize_album.
    """
    clean_artist = clean_term_for_search(artist)
    clean_item = clean_term_for_search(title_or_album)

    if not clean_item and not clean_artist:
        return None

    cache_key = (clean_artist.lower(), clean_item.lower(), is_album)
    if cache_key in _GENRE_CACHE:
        return _GENRE_CACHE[cache_key]

    entity = "album" if is_album else "song"
    search_query = f"{clean_artist} {clean_item}".strip()
    quoted_query = urllib.parse.quote(search_query)

    url = f"https://itunes.apple.com/search?term={quoted_query}&media=music&entity={entity}&limit=5&country=FR"
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SoundStash/3.0"}

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=3.5) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                results = data.get("results", [])
                genre = _select_best_genre_from_results(results, clean_artist)
                
                # Si le genre trouvé est générique (Pop/Rock) ou inexistant, vérifier le genre officiel de l'artiste
                if (not genre or genre.lower() in GENERIC_GENRES) and clean_artist:
                    artist_genre = _fetch_artist_official_genre_sync(clean_artist)
                    if artist_genre and (artist_genre.lower() not in GENERIC_GENRES or not genre):
                        genre = artist_genre

                if genre:
                    _GENRE_CACHE[cache_key] = genre
                    return genre
    except Exception:
        pass

    # Fallback ultime sur l'artiste si pas de résultat pour le titre
    if clean_artist and clean_artist not in {"Artiste inconnu", "Various Artists"}:
        artist_genre = _fetch_artist_official_genre_sync(clean_artist)
        if artist_genre:
            _GENRE_CACHE[cache_key] = artist_genre
            return artist_genre

    _GENRE_CACHE[cache_key] = None
    return None

async def detect_genre(artist: str, title_or_album: str, is_album: bool = False) -> Optional[str]:
    """
    Détecte de manière asynchrone le genre musical officiel via l'API Apple Music / iTunes Catalog.
    """
    clean_artist = clean_term_for_search(artist)
    clean_item = clean_term_for_search(title_or_album)

    if not clean_item and not clean_artist:
        return None

    cache_key = (clean_artist.lower(), clean_item.lower(), is_album)
    if cache_key in _GENRE_CACHE:
        return _GENRE_CACHE[cache_key]

    entity = "album" if is_album else "song"
    search_query = f"{clean_artist} {clean_item}".strip()
    quoted_query = urllib.parse.quote(search_query)

    url = f"https://itunes.apple.com/search?term={quoted_query}&media=music&entity={entity}&limit=5&country=FR"
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SoundStash/3.0"}

    try:
        async with httpx.AsyncClient(timeout=3.5) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                results = data.get("results", [])
                genre = _select_best_genre_from_results(results, clean_artist)

                # Si le genre trouvé est générique (Pop/Rock) ou inexistant, vérifier le genre officiel de l'artiste
                if (not genre or genre.lower() in GENERIC_GENRES) and clean_artist:
                    artist_genre = await _fetch_artist_official_genre_async(clean_artist)
                    if artist_genre and (artist_genre.lower() not in GENERIC_GENRES or not genre):
                        genre = artist_genre

                if genre:
                    _GENRE_CACHE[cache_key] = genre
                    return genre
    except Exception:
        pass

    # Fallback ultime sur l'artiste si pas de résultat pour le titre
    if clean_artist and clean_artist not in {"Artiste inconnu", "Various Artists"}:
        artist_genre = await _fetch_artist_official_genre_async(clean_artist)
        if artist_genre:
            _GENRE_CACHE[cache_key] = artist_genre
            return artist_genre

    _GENRE_CACHE[cache_key] = None
    return None

def clear_genre_cache() -> None:
    """Vide le cache mémoire des genres."""
    global _GENRE_CACHE
    _GENRE_CACHE.clear()

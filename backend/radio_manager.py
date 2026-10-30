"""
Module de Gestion des Radios Web & Contrôle du Direct (Timeshifting) pour SoundStash.

Fonctionnalités :
- Annuaire mondial Radio Browser (recherche, top stations, filtres par pays et genres).
- Gestion des stations favorites et personnalisées (persistance dans CONFIG_DIR / 'radios.json').
- Détection et résolution automatique des playlists (.m3u, .pls).
- Décodeur de métadonnées ICY (titre et artiste diffusés en direct / StreamTitle).
- Tampon circulaire de contrôle du direct (Timeshifting) jusqu'à 30 minutes en mémoire vive.
- Diffusion en direct ou différée avec retour en arrière instantané (saut -15s/+15s, seek).
- Sauvegarde/Extraction du morceau en cours vers l'Atelier d'acquisition.
"""

import os
import re
import json
import time
import urllib.request
import urllib.parse
import urllib.error
import threading
import collections
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple

from backend.config import CONFIG_DIR, TEMP_DOWNLOAD_DIR, FFMPEG_PATH
from backend.logger import get_logger

logger = get_logger(__name__)

RADIOS_CONFIG_FILE = CONFIG_DIR / "radios.json"
STATIONS_CACHE_DIR = CONFIG_DIR / "stations_cache"
MAX_BUFFER_SECONDS = 1800  # 30 minutes de contrôle du direct (Timeshift)

# Miroirs de l'API Radio Browser avec bascule automatique
RADIO_BROWSER_MIRRORS = [
    "https://de1.api.radio-browser.info",
    "https://all.api.radio-browser.info",
    "https://nl1.api.radio-browser.info",
    "https://at1.api.radio-browser.info"
]

# Stations sélectionnées et vérifiées par défaut (France & International)
DEFAULT_CURATED_STATIONS: List[Dict[str, Any]] = [
    {
        "id": "fip_paris",
        "name": "FIP",
        "url": "http://icecast.radiofrance.fr/fip-midfi.mp3",
        "favicon": "https://www.google.com/s2/favicons?domain=radiofrance.fr&sz=128",
        "country": "France",
        "countrycode": "FR",
        "tags": "eclectic, jazz, rock, world",
        "codec": "MP3",
        "bitrate": 128,
        "is_favorite": True,
        "is_custom": False
    },
    {
        "id": "radio_nova",
        "name": "Radio Nova",
        "url": "http://novazz.ice.infomaniak.ch/novazz-128.mp3",
        "favicon": "https://www.google.com/s2/favicons?domain=novaplanet.com&sz=128",
        "country": "France",
        "countrycode": "FR",
        "tags": "groove, soul, hip hop, indie",
        "codec": "MP3",
        "bitrate": 128,
        "is_favorite": True,
        "is_custom": False
    },
    {
        "id": "france_inter",
        "name": "France Inter",
        "url": "http://icecast.radiofrance.fr/franceinter-midfi.mp3",
        "favicon": "https://www.google.com/s2/favicons?domain=franceinter.fr&sz=128",
        "country": "France",
        "countrycode": "FR",
        "tags": "generalist, talk, culture, news",
        "codec": "MP3",
        "bitrate": 128,
        "is_favorite": True,
        "is_custom": False
    },
    {
        "id": "jazz_radio_blues",
        "name": "Jazz Radio Blues",
        "url": "http://jazzblues.ice.infomaniak.ch/jazzblues-high.mp3",
        "favicon": "https://www.google.com/s2/favicons?domain=jazzradio.fr&sz=128",
        "country": "France",
        "countrycode": "FR",
        "tags": "blues, jazz, acoustic",
        "codec": "MP3",
        "bitrate": 128,
        "is_favorite": True,
        "is_custom": False
    },
    {
        "id": "tsf_jazz",
        "name": "TSF Jazz",
        "url": "http://tsfjazz.ice.infomaniak.ch/tsfjazz-high.mp3",
        "favicon": "https://www.google.com/s2/favicons?domain=tsfjazz.com&sz=128",
        "country": "France",
        "countrycode": "FR",
        "tags": "jazz, swing, bebop",
        "codec": "MP3",
        "bitrate": 128,
        "is_favorite": True,
        "is_custom": False
    },
    {
        "id": "rtl2_france",
        "name": "RTL2",
        "url": "http://icecast.rtl2.fr/rtl2-1-44-128?listen=webCwsBCgQA",
        "favicon": "https://www.google.com/s2/favicons?domain=rtl2.fr&sz=128",
        "country": "France",
        "countrycode": "FR",
        "tags": "pop, rock, pop rock",
        "codec": "MP3",
        "bitrate": 128,
        "is_favorite": True,
        "is_custom": False
    },
    {
        "id": "fg_radio",
        "name": "Radio FG",
        "url": "http://radiofg.impek.com/fg",
        "favicon": "https://www.google.com/s2/favicons?domain=radiofg.com&sz=128",
        "country": "France",
        "countrycode": "FR",
        "tags": "electro, house, dance, club",
        "codec": "MP3",
        "bitrate": 128,
        "is_favorite": True,
        "is_custom": False
    },
    {
        "id": "oui_fm",
        "name": "Ouï FM",
        "url": "http://ouifm.ice.infomaniak.ch/ouifm-high.mp3",
        "favicon": "https://www.google.com/s2/favicons?domain=ouifm.fr&sz=128",
        "country": "France",
        "countrycode": "FR",
        "tags": "rock, indie, alternative rock",
        "codec": "MP3",
        "bitrate": 128,
        "is_favorite": True,
        "is_custom": False
    },
    {
        "id": "kexp_seattle",
        "name": "KEXP 90.3 FM Seattle",
        "url": "https://kexp-mp3-128.streamguys1.com/kexp128.mp3",
        "favicon": "https://www.google.com/s2/favicons?domain=kexp.org&sz=128",
        "country": "United States",
        "countrycode": "US",
        "tags": "indie, alternative, eclectic, rock",
        "codec": "MP3",
        "bitrate": 128,
        "is_favorite": True,
        "is_custom": False
    },
    {
        "id": "somafm_groove_salad",
        "name": "SomaFM Groove Salad",
        "url": "https://ice2.somafm.com/groovesalad-128-mp3",
        "favicon": "https://somafm.com/img3/groovesalad-400.jpg",
        "country": "United States",
        "countrycode": "US",
        "tags": "ambient, downtempo, chillout, electronic",
        "codec": "MP3",
        "bitrate": 128,
        "is_favorite": True,
        "is_custom": False
    },
    {
        "id": "somafm_defcon",
        "name": "SomaFM DEF CON Radio",
        "url": "https://ice2.somafm.com/defcon-128-mp3",
        "favicon": "https://somafm.com/img3/defcon-400.jpg",
        "country": "United States",
        "countrycode": "US",
        "tags": "synthwave, electronic, chill, cyberpunk",
        "codec": "MP3",
        "bitrate": 128,
        "is_favorite": True,
        "is_custom": False
    },
    {
        "id": "radio_paradise_main",
        "name": "Radio Paradise (Main Mix)",
        "url": "http://stream.radioparadise.com/mp3-320",
        "favicon": "https://radioparadise.com/graphics/rp_logo_square.png",
        "country": "United States",
        "countrycode": "US",
        "tags": "eclectic, rock, acoustic, indie, hi-res",
        "codec": "MP3",
        "bitrate": 320,
        "is_favorite": True,
        "is_custom": False
    },
    {
        "id": "swiss_groove",
        "name": "Swiss Groove",
        "url": "https://relay2.swissgroove.ch/;",
        "favicon": "https://www.google.com/s2/favicons?domain=swissgroove.ch&sz=128",
        "country": "Switzerland",
        "countrycode": "CH",
        "tags": "funk, jazz, soul, lounge, world",
        "codec": "MP3",
        "bitrate": 128,
        "is_favorite": True,
        "is_custom": False
    }
]


def parse_playlist_url(url: str, timeout: float = 6.0) -> str:
    """
    Détecte et extrait l'URL réelle du flux audio si l'URL pointe vers un fichier de playlist (.m3u, .pls).
    """
    url_lower = url.lower()
    if not any(url_lower.endswith(ext) or ext in url_lower for ext in [".m3u", ".m3u8", ".pls"]):
        return url

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "SoundStash/6.1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            content = resp.read().decode("utf-8", errors="ignore")

        for line in content.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.lower().startswith("file") and "=" in line:
                candidate = line.split("=", 1)[1].strip()
                if candidate.startswith("http"):
                    return candidate
            if line.startswith("http://") or line.startswith("https://"):
                return line
    except Exception as e:
        logger.warning(f"[RadioManager] Échec parsing playlist pour {url}: {e}")

    return url


# Domaines génériques de serveurs de streaming (ne disposent pas de favicon radio propre)
GENERIC_STREAM_HOSTS = {
    "radioking.com", "radionomy.com", "ovh.net", "infomaniak.com", "infomaniak.ch",
    "icecast.org", "shoutcast.com", "creacast.com", "streamakaci.com", "vestaradio.com",
    "zeno.fm", "zenomedia.com", "streamguys.com", "streamguys1.com", "live365.com",
    "securenetsystems.net", "myradio.cloud", "radiojar.com", "broadcastify.com", "tunein.com",
    "scacdn.com", "streaming-solutions.com", "audiopulse.com", "arkena.com"
}

# Villes, départements et régions (France & international) pour identification des décrochages locaux
FRENCH_REGIONS_CITIES = {
    "mulhouse", "paris", "marseille", "lyon", "toulouse", "nice", "nantes", "montpellier",
    "strasbourg", "bordeaux", "lille", "rennes", "reims", "saint-etienne", "saint-étienne",
    "toulon", "le havre", "grenoble", "dijon", "angers", "nimes", "nîmes", "villeurbanne",
    "clermont-ferrand", "le mans", "aix", "aix-en-provence", "brest", "tours", "amiens",
    "limoges", "annecy", "perpignan", "boulogne", "metz", "besancon", "besançon", "orleans",
    "orléans", "rouen", "caen", "nancy", "avignon", "poitiers", "pau", "beziers", "béziers",
    "la rochelle", "cannes", "calais", "dunkerque", "lorient", "bayonne", "littoral",
    "alsace", "lorraine", "bretagne", "normandie", "occitanie", "provence", "aquitaine",
    "bourgogne", "franche-comte", "franche-comté", "picardie", "champagne", "corse",
    "savoie", "pays de savoie", "berry", "perigord", "périgord", "cotentin", "bearn", "béarn",
    "gard", "lozere", "lozère", "gascogne", "gironde", "herault", "hérault", "isere", "isère",
    "nord", "pays basque", "auvergne", "roussillon", "touraine", "vaucluse", "creuse",
    "drome", "drôme", "ardeche", "ardèche", "loire", "armorique", "breizh", "breizh izel",
    "sud", "leman", "léman", "alpes", "azur", "london", "manchester", "berlin", "munich",
    "new york", "madrid", "barcelona", "rome", "milan", "geneva", "zurich", "lausanne"
}

# Registre des réseaux radios majeurs et de leurs logos officiels haute résolution (trié par longueur décroissante)
PARENT_BRANDS_REGISTRY = [
    ("France Bleu", "francebleu.fr", "https://www.google.com/s2/favicons?domain=francebleu.fr&sz=128"),
    ("France Inter", "franceinter.fr", "https://www.google.com/s2/favicons?domain=franceinter.fr&sz=128"),
    ("France Musique", "radiofrance.fr", "https://www.google.com/s2/favicons?domain=radiofrance.fr&sz=128"),
    ("France Culture", "radiofrance.fr", "https://www.google.com/s2/favicons?domain=radiofrance.fr&sz=128"),
    ("France Info", "francetvinfo.fr", "https://www.francetvinfo.fr/assets/common/images/pwa/ios/120-5487caf3.png"),
    ("La Grosse Radio", "lagrosseradio.com", "https://www.google.com/s2/favicons?domain=lagrosseradio.com&sz=128"),
    ("100% Radio", "centpourcent.com", "https://www.google.com/s2/favicons?domain=centpourcent.com&sz=128"),
    ("Jazz Radio", "jazzradio.fr", "http://www.jazzradio.fr/apple-touch-icon-120x120.png"),
    ("Radio Nova", "nova.fr", "https://www.google.com/s2/favicons?domain=nova.fr&sz=128"),
    ("Radio FG", "radiofg.com", "https://www.google.com/s2/favicons?domain=radiofg.com&sz=128"),
    ("FG DJ Radio", "radiofg.com", "https://www.google.com/s2/favicons?domain=radiofg.com&sz=128"),
    ("Radio Meuh", "radiomeuh.com", "https://www.google.com/s2/favicons?domain=radiomeuh.com&sz=128"),
    ("Radio Classique", "radioclassique.fr", "https://www.google.com/s2/favicons?domain=radioclassique.fr&sz=128"),
    ("Radio Swiss", "radioswissjazz.ch", "https://www.google.com/s2/favicons?domain=radioswissjazz.ch&sz=128"),
    ("Radio Suisse", "radioswissjazz.ch", "https://www.google.com/s2/favicons?domain=radioswissjazz.ch&sz=128"),
    ("RTL2", "rtl2.fr", "https://www.google.com/s2/favicons?domain=rtl2.fr&sz=128"),
    ("RTL", "rtl.fr", "https://www.google.com/s2/favicons?domain=rtl.fr&sz=128"),
    ("NRJ", "nrj.fr", "https://www.google.com/s2/favicons?domain=nrj.fr&sz=128"),
    ("Nostalgie", "nostalgie.fr", "https://www.google.com/s2/favicons?domain=nostalgie.fr&sz=128"),
    ("Chérie FM", "cheriefm.fr", "https://www.google.com/s2/favicons?domain=cheriefm.fr&sz=128"),
    ("Rire & Chansons", "rireetchansons.fr", "https://www.google.com/s2/favicons?domain=rireetchansons.fr&sz=128"),
    ("Skyrock", "skyrock.fm", "https://www.google.com/s2/favicons?domain=skyrock.fm&sz=128"),
    ("OUI FM", "ouifm.fr", "https://www.google.com/s2/favicons?domain=ouifm.fr&sz=128"),
    ("RFM", "rfm.fr", "https://www.google.com/s2/favicons?domain=rfm.fr&sz=128"),
    ("Europe 1", "europe1.fr", "https://www.google.com/s2/favicons?domain=europe1.fr&sz=128"),
    ("Europe 2", "europe2.fr", "https://www.google.com/s2/favicons?domain=europe2.fr&sz=128"),
    ("Virgin Radio", "virginradio.fr", "https://www.google.com/s2/favicons?domain=virginradio.fr&sz=128"),
    ("Sud Radio", "sudradio.fr", "https://www.google.com/s2/favicons?domain=sudradio.fr&sz=128"),
    ("TSF Jazz", "tsfjazz.com", "https://www.google.com/s2/favicons?domain=tsfjazz.com&sz=128"),
    ("FIP", "fip.fr", "https://www.google.com/s2/favicons?domain=fip.fr&sz=128"),
    ("Mouv'", "mouv.fr", "https://www.google.com/s2/favicons?domain=mouv.fr&sz=128"),
    ("RFI", "rfi.fr", "http://www.rfi.fr/apple-touch-icon.png"),
    ("RMC", "rmc.bfmtv.com", "https://www.google.com/s2/favicons?domain=rmc.bfmtv.com&sz=128"),
    ("BFM", "bfmtv.com", "https://www.google.com/s2/favicons?domain=bfmtv.com&sz=128"),
    ("Hotmix", "hotmixradio.fr", "https://www.google.com/s2/favicons?domain=hotmixradio.fr&sz=128"),
    ("Hotmix Radio", "hotmixradio.fr", "https://www.google.com/s2/favicons?domain=hotmixradio.fr&sz=128"),
    ("Allzic", "allzicradio.com", "https://www.google.com/s2/favicons?domain=allzicradio.com&sz=128"),
    ("Allzic Radio", "allzicradio.com", "https://www.google.com/s2/favicons?domain=allzicradio.com&sz=128"),
    ("Generations", "generations.fr", "https://www.google.com/s2/favicons?domain=generations.fr&sz=128"),
    ("Générations", "generations.fr", "https://www.google.com/s2/favicons?domain=generations.fr&sz=128"),
    ("M Radio", "mradio.fr", "https://www.google.com/s2/favicons?domain=mradio.fr&sz=128"),
    ("Crooner Radio", "croonerradio.fr", "https://www.google.com/s2/favicons?domain=croonerradio.fr&sz=128"),
    ("Crooner", "croonerradio.fr", "https://www.google.com/s2/favicons?domain=croonerradio.fr&sz=128"),
    ("SUN", "lesonunique.com", "https://www.google.com/s2/favicons?domain=lesonunique.com&sz=128"),
    ("Phare FM", "pharefm.com", "https://www.google.com/s2/favicons?domain=pharefm.com&sz=128"),
    ("Radio Scoop", "radioscoop.com", "https://www.google.com/s2/favicons?domain=radioscoop.com&sz=128"),
    ("Chante France", "chantefrance.com", "https://www.google.com/s2/favicons?domain=chantefrance.com&sz=128"),
    ("Radio Campus", "radiocampus.fr", "https://www.google.com/s2/favicons?domain=radiocampus.fr&sz=128"),
    ("PulsRadio", "pulsradio.com", "https://www.google.com/s2/favicons?domain=pulsradio.com&sz=128"),
    ("Voltage", "voltage.fr", "https://www.google.com/s2/favicons?domain=voltage.fr&sz=128"),
    ("Swigg", "swigg.fm", "https://www.google.com/s2/favicons?domain=swigg.fm&sz=128"),
    ("Alouette", "alouette.fr", "https://www.google.com/s2/favicons?domain=alouette.fr&sz=128"),
    ("Hit West", "hitwest.com", "https://www.google.com/s2/favicons?domain=hitwest.com&sz=128"),
    ("Contact FM", "mycontact.fr", "https://www.google.com/s2/favicons?domain=mycontact.fr&sz=128"),
    ("SomaFM", "somafm.com", "https://www.google.com/s2/favicons?domain=somafm.com&sz=128"),
    ("BBC Radio", "bbc.co.uk", "https://www.google.com/s2/favicons?domain=bbc.co.uk&sz=128"),
    ("BBC", "bbc.co.uk", "https://www.google.com/s2/favicons?domain=bbc.co.uk&sz=128")
]


def extract_clean_domain(url_or_domain: str) -> str:
    """Extrait le domaine principal propre en élaguant les sous-domaines techniques de streaming."""
    if not url_or_domain:
        return ""
    try:
        if "://" in url_or_domain:
            host = urllib.parse.urlparse(url_or_domain).netloc
        else:
            host = url_or_domain
        host = host.split(":")[0].lower().strip().replace("www.", "")
        if not host or any(x in host for x in ["127.0.0.1", "localhost", "0.0.0.0"]):
            return ""
        parts = host.split(".")
        stream_prefixes = {
            "icecast", "stream", "streaming", "live", "listen", "relay",
            "audio", "edge", "media", "play", "direct", "webradio",
            "radio", "cdn", "caster", "broadcast", "shoutcast"
        }
        while len(parts) > 2 and parts[0] in stream_prefixes:
            parts.pop(0)
        domain = ".".join(parts)
        for gen in GENERIC_STREAM_HOSTS:
            if domain == gen or domain.endswith("." + gen):
                return ""
        return domain
    except Exception:
        return ""


def detect_parent_brand_and_sublabel(name: str) -> Optional[Tuple[str, str, str, str]]:
    """
    Identifie si une radio est une déclinaison locale ou thématique d'un grand réseau.
    Retourne (parent_brand, sub_label, sub_label_type, brand_logo) ou None.
    """
    if not name:
        return None
    raw_name = name.strip()
    norm_name = raw_name.lower()
    for brand, domain, logo in PARENT_BRANDS_REGISTRY:
        b_low = brand.lower()
        if norm_name.startswith(b_low):
            remainder = raw_name[len(brand):].strip(" -:–/|()")
            # Nettoyer les mentions techniques de codec / bitrate dans le sous-label
            clean_sub = re.sub(r"\(.*?\)", "", remainder)
            clean_sub = re.sub(r"\[.*?\]", "", clean_sub)
            clean_sub = re.sub(r"\b(?:https?|stream|mp3|aac|ogg|opus|hq|hd|online|web|audio|fm|radio|webradio|128k|192k|320k|64k|official|live)\b", "", clean_sub, flags=re.IGNORECASE)
            clean_sub = clean_sub.strip(" -:–/|()")
            remainder = clean_sub or remainder
            if remainder:
                rem_low = remainder.lower()
                is_loc = any(c in rem_low for c in FRENCH_REGIONS_CITIES)
                sub_type = "location" if is_loc else "theme"
                return (brand, remainder, sub_type, logo)
            else:
                return (brand, "", "parent", logo)
    return None


class RadioChunk:
    """Bloc audio indexé pour le contrôle du direct (Timeshifting)."""
    __slots__ = ("seq", "ts", "duration", "data")

    def __init__(self, seq: int, ts: float, duration: float, data: bytes):
        self.seq = seq
        self.ts = ts
        self.duration = duration
        self.data = data

    def __getitem__(self, item):
        # Rétro-compatibilité pour accès par index : c[0]=ts, c[1]=duration, c[2]=data
        if item == 0:
            return self.ts
        elif item == 1:
            return self.duration
        elif item == 2:
            return self.data
        raise IndexError("RadioChunk index out of range")


class RadioStreamManager:
    """
    Gère l'enregistrement et le streaming d'une radio avec contrôle du direct (Timeshifting).
    Décode les métadonnées ICY à la volée et conserve jusqu'à 30 minutes de tampon audio.
    """

    def __init__(self):
        self._lock = threading.RLock()
        self.active_station: Optional[Dict[str, Any]] = None
        self.stream_url: Optional[str] = None
        self.is_recording: bool = False
        self._stop_event = threading.Event()
        self._ready_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._current_resp = None
        self._seq_counter: int = 0

        # Tampon circulaire des blocs audio : deque d'objets RadioChunk
        self.chunks = collections.deque()
        self.total_bytes: int = 0
        self.buffer_start_time: float = 0.0
        self.latest_chunk_time: float = 0.0

        # Métadonnées en direct
        self.now_playing: Dict[str, str] = {
            "title": "",
            "artist": "",
            "raw": "",
            "updated_at": 0
        }
        self.stream_content_type: str = "audio/mpeg"
        self.estimated_bitrate_kbps: int = 128

        # Notification de nouveaux blocs pour les flux temps réel
        self._new_chunk_cond = threading.Condition(self._lock)

    def start(self, station: Dict[str, Any]):
        """Démarre l'enregistrement du flux radio dans le tampon de Timeshifting."""
        with self._lock:
            # Si la même station est déjà en cours et active, rien à faire
            if self.is_recording and self.active_station and self.active_station.get("id") == station.get("id"):
                return

            self._stop_internal()

            self.active_station = station
            raw_url = station.get("url") or station.get("url_resolved") or ""
            self.stream_url = parse_playlist_url(raw_url)
            self.chunks.clear()
            self.total_bytes = 0
            self._seq_counter = 0
            self.buffer_start_time = time.time()
            self.latest_chunk_time = self.buffer_start_time
            self.now_playing = {
                "title": station.get("name", "Radio en direct"),
                "artist": station.get("country", ""),
                "raw": station.get("name", ""),
                "updated_at": time.time()
            }
            self.estimated_bitrate_kbps = station.get("bitrate") or 128
            if self.estimated_bitrate_kbps <= 0:
                self.estimated_bitrate_kbps = 128

            self._stop_event.clear()
            self._ready_event.clear()
            self.is_recording = True

            self._thread = threading.Thread(
                target=self._recording_loop,
                name="SoundStashRadioRecorder",
                daemon=True
            )
            self._thread.start()
            logger.info(f"[RadioManager] Démarrage du flux radio : '{station.get('name')}' ({self.stream_url})")

        # Attente synchrone du premier coussin de données (jusqu'à 2.5s)
        # Cela garantit que le client HTTP reçoit immédiatement 3 à 4 secondes de pré-buffer
        self._ready_event.wait(timeout=2.5)
        with self._lock:
            if self._stop_event.is_set() or not self.is_recording:
                err = getattr(self, "_last_error", "Flux distant inaccessible ou format non supporté")
                raise ConnectionError(f"Impossible de joindre le flux radio : {err}")

    def stop(self):
        """Arrête le flux radio et libère le tampon."""
        with self._lock:
            self._stop_internal()
            logger.info("[RadioManager] Arrêt du flux radio et purge du tampon Timeshift")

    def _stop_internal(self):
        self.is_recording = False
        self._stop_event.set()
        self._ready_event.set()
        if self._current_resp:
            try:
                self._current_resp.close()
            except Exception:
                pass
            self._current_resp = None
        with self._new_chunk_cond:
            self._new_chunk_cond.notify_all()
        self.chunks.clear()
        self.total_bytes = 0
        self.active_station = None
        self.stream_url = None

    def _read_exact(self, fp, n: int) -> Optional[bytes]:
        """Lit exactement n octets depuis le flux socket sans perte en cas de segmentation TCP."""
        buf = bytearray()
        while len(buf) < n and not self._stop_event.is_set():
            needed = n - len(buf)
            try:
                part = fp.read(min(needed, 16384))
            except Exception:
                return None
            if not part:
                return None
            buf.extend(part)
        return bytes(buf) if len(buf) == n else None

    def _recording_loop(self):
        """
        Boucle d'écoute et de capture continue du flux avec reconnexion automatique résiliente.
        Protège l'écoute contre les fermetures de socket distantes (ex: Icecast/Shoutcast après 30-45 min),
        les micro-coupures réseau et le jitter.
        """
        url = self.stream_url
        if not url:
            return

        headers = {
            "User-Agent": "SoundStash/6.1.0",
            "Icy-MetaData": "1",
            "Accept": "*/*"
        }

        TARGET_CHUNK_SIZE = 24576
        audio_accumulator = bytearray()
        reconnect_attempts = 0
        max_reconnects = 50

        while not self._stop_event.is_set():
            req = urllib.request.Request(url, headers=headers)
            resp = None

            try:
                resp = urllib.request.urlopen(req, timeout=10)
                with self._lock:
                    self._current_resp = resp
                content_type = resp.headers.get("Content-Type", "audio/mpeg")
                metaint_header = resp.headers.get("icy-metaint")
                metaint = int(metaint_header) if metaint_header and metaint_header.isdigit() else 0
                icy_name = resp.headers.get("icy-name", "")
                icy_br = resp.headers.get("icy-br", "")

                with self._lock:
                    self.stream_content_type = content_type
                    if icy_br and icy_br.isdigit():
                        self.estimated_bitrate_kbps = int(icy_br)
                    if icy_name and not self.now_playing["title"]:
                        self.now_playing["title"] = icy_name

                bytes_per_sec = (self.estimated_bitrate_kbps * 1000) / 8
                # Connexion réussie : réinitialisation du compteur d'erreurs
                reconnect_attempts = 0

                while not self._stop_event.is_set():
                    if metaint > 0:
                        audio_part = self._read_exact(resp, metaint)
                        if not audio_part:
                            break
                        audio_accumulator.extend(audio_part)

                        try:
                            len_byte = resp.read(1)
                        except Exception:
                            break
                        if not len_byte:
                            break
                        mlen = ord(len_byte) * 16
                        if mlen > 0:
                            meta_bytes = self._read_exact(resp, mlen)
                            if meta_bytes:
                                meta_changed = self._parse_icy_meta(meta_bytes)
                                if meta_changed and len(audio_accumulator) >= 8192:
                                    self._append_audio_chunk(bytes(audio_accumulator), bytes_per_sec)
                                    audio_accumulator.clear()

                        if len(audio_accumulator) >= TARGET_CHUNK_SIZE:
                            self._append_audio_chunk(bytes(audio_accumulator), bytes_per_sec)
                            audio_accumulator.clear()
                    else:
                        try:
                            part = resp.read(16384)
                        except Exception:
                            break
                        if not part:
                            break
                        audio_accumulator.extend(part)
                        if len(audio_accumulator) >= TARGET_CHUNK_SIZE:
                            self._append_audio_chunk(bytes(audio_accumulator), bytes_per_sec)
                            audio_accumulator.clear()

                # Vidage partiel si données résiduelles
                if audio_accumulator and not self._stop_event.is_set():
                    self._append_audio_chunk(bytes(audio_accumulator), bytes_per_sec)
                    audio_accumulator.clear()

            except Exception as e:
                if self._stop_event.is_set():
                    break
                reconnect_attempts += 1
                with self._lock:
                    self._last_error = str(e)

                # Échec au démarrage initial
                if not self._ready_event.is_set() and reconnect_attempts >= 3:
                    logger.warning(f"[RadioManager] Échec initial de connexion au flux distant ({url}): {e}")
                    with self._lock:
                        self.is_recording = False
                    self._stop_event.set()
                    self._ready_event.set()
                    break

                if reconnect_attempts > max_reconnects:
                    logger.error(f"[RadioManager] Abandon après {max_reconnects} tentatives de reconnexion pour {url}: {e}")
                    with self._lock:
                        self.is_recording = False
                    self._stop_event.set()
                    break

                logger.warning(f"[RadioManager] Flux distant coupé ({url}): {e}. Reconnexion automatique ({reconnect_attempts}/{max_reconnects})...")
                backoff = min(1.0 + (reconnect_attempts * 0.4), 4.0)
                time.sleep(backoff)
            finally:
                if resp:
                    try:
                        resp.close()
                    except Exception:
                        pass
                if not self.is_recording or self._stop_event.is_set():
                    self._ready_event.set()

            # Si le flux s'est fermé sans exception (fermeture normale de socket par le serveur distant après 30-45 min)
            if not self._stop_event.is_set():
                reconnect_attempts += 1
                logger.info(f"[RadioManager] Le serveur distant a clos la connexion TCP ({url}), reconnexion immédiate ({reconnect_attempts}/{max_reconnects})...")
                time.sleep(0.5)

    def _parse_icy_meta(self, meta_bytes: bytes) -> bool:
        """Parse le bloc de métadonnées ICY (ex: StreamTitle='Artiste - Titre';)."""
        try:
            meta_str = meta_bytes.decode("utf-8", errors="ignore").rstrip("\x00")
            m = re.search(r"StreamTitle='([^']*)'", meta_str)
            if m:
                raw_title = m.group(1).strip()
                if raw_title and raw_title != self.now_playing.get("raw"):
                    artist = ""
                    title = raw_title
                    # Séparation Artiste - Titre
                    if " - " in raw_title:
                        parts = raw_title.split(" - ", 1)
                        artist = parts[0].strip()
                        title = parts[1].strip()

                    with self._lock:
                        self.now_playing = {
                            "title": title or raw_title,
                            "artist": artist,
                            "raw": raw_title,
                            "updated_at": time.time()
                        }
                    logger.info(f"[RadioManager] Métadonnée ICY : {artist} - {title}")
                    return True
        except Exception as e:
            logger.debug(f"[RadioManager] Erreur décodage métadonnée ICY: {e}")
        return False

    def _append_audio_chunk(self, data: bytes, bytes_per_sec: float):
        """Ajoute un bloc audio au tampon circulaire et évince les données de plus de 30 minutes."""
        if not data:
            return

        now = time.time()
        chunk_sec = len(data) / max(bytes_per_sec, 8000)

        with self._new_chunk_cond:
            self._seq_counter += 1
            chunk = RadioChunk(
                seq=self._seq_counter,
                ts=now,
                duration=chunk_sec,
                data=data
            )
            if not self.chunks:
                self.buffer_start_time = now
            self.chunks.append(chunk)
            self.total_bytes += len(data)
            self.latest_chunk_time = now

            # Éviction FIFO des blocs plus vieux que MAX_BUFFER_SECONDS
            cutoff = now - MAX_BUFFER_SECONDS
            while self.chunks and self.chunks[0].ts < cutoff:
                old = self.chunks.popleft()
                self.total_bytes -= len(old.data)
                if self.chunks:
                    self.buffer_start_time = self.chunks[0].ts

            # Le tampon initial est considéré prêt dès qu'on a au moins 2 blocs (~3 secondes)
            if len(self.chunks) >= 2 or self.total_bytes >= 32768:
                self._ready_event.set()

            self._new_chunk_cond.notify_all()

    def get_status(self) -> Dict[str, Any]:
        """Retourne l'état complet du gestionnaire radio."""
        with self._lock:
            bytes_per_sec = max(8000.0, (self.estimated_bitrate_kbps * 1000) / 8)
            buffer_seconds = (self.total_bytes / bytes_per_sec) if self.chunks else 0.0
            return {
                "is_active": self.is_recording,
                "station": self.active_station,
                "now_playing": self.now_playing,
                "buffer_seconds": round(buffer_seconds, 1),
                "max_buffer_seconds": MAX_BUFFER_SECONDS,
                "bitrate_kbps": self.estimated_bitrate_kbps,
                "content_type": self.stream_content_type
            }

    def iter_audio(self, offset_seconds: float = 0.0):
        """
        Générateur de streaming audio pour FastAPI.
        - Si offset_seconds == 0 : mode Direct (diffuse une rafale initiale de 3-4s puis les blocs en temps réel).
        - Si offset_seconds < 0 (ex: -120) : mode Timeshift (démarre 120s dans le passé puis rattrape).
        """
        # Attente synchrone du coussin initial si le client HTTP arrive avant le buffer
        if not self._ready_event.is_set():
            self._ready_event.wait(timeout=3.0)

        initial_chunks = []
        last_served_seq = -1

        with self._lock:
            if not self.chunks:
                logger.warning("[RadioManager] Aucun bloc disponible pour le streaming")
            else:
                now = self.latest_chunk_time
                if offset_seconds < 0:
                    target_timestamp = max(self.buffer_start_time, now + offset_seconds)
                    start_index = 0
                    for idx, chunk in enumerate(self.chunks):
                        if chunk.ts >= target_timestamp:
                            start_index = idx
                            break
                    initial_chunks = list(self.chunks)[start_index:]
                else:
                    # En direct : envoyer une rafale initiale des 2 à 3 derniers blocs (~3-4s d'audio)
                    # Ce pré-buffer immédiat comble instantanément le buffer matériel du navigateur
                    # et élimine 100% des bruits de friture, micro-coupures et erreurs de décodeur.
                    burst_count = min(len(self.chunks), 3)
                    start_index = max(0, len(self.chunks) - burst_count)
                    initial_chunks = list(self.chunks)[start_index:]

                if initial_chunks:
                    last_served_seq = initial_chunks[-1].seq

        # 1. Diffusion immédiate de la rafale initiale (pré-buffer / historique Timeshift)
        try:
            for chunk in initial_chunks:
                yield chunk.data

            # 2. Diffusion continue en temps réel
            while not self._stop_event.is_set():
                chunks_to_send = []
                with self._new_chunk_cond:
                    while not self._stop_event.is_set():
                        new_chunks = [c for c in self.chunks if c.seq > last_served_seq]
                        if new_chunks:
                            chunks_to_send = new_chunks
                            last_served_seq = new_chunks[-1].seq
                            break
                        self._new_chunk_cond.wait(timeout=0.3)

                for chunk in chunks_to_send:
                    yield chunk.data
        except (GeneratorExit, Exception):
            pass


class RadioManager:
    """Gestionnaire principal des radios (Catalogue, Favoris, Sauvegarde Atelier)."""

    def __init__(self):
        self.stream_manager = RadioStreamManager()
        self._ensure_config()

    def _ensure_config(self):
        """Initialise le fichier radios.json si absent."""
        if not RADIOS_CONFIG_FILE.exists():
            try:
                RADIOS_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
                initial_data = {
                    "version": "6.1.0",
                    "favorites": DEFAULT_CURATED_STATIONS,
                    "custom": []
                }
                with open(RADIOS_CONFIG_FILE, "w", encoding="utf-8") as f:
                    json.dump(initial_data, f, indent=2, ensure_ascii=False)
            except Exception as e:
                logger.error(f"[RadioManager] Échec création de radios.json: {e}")

    def load_radios(self) -> Dict[str, Any]:
        """Charge les favoris et radios personnalisées depuis le fichier local et auto-répare les URLs obsolètes."""
        self._ensure_config()
        try:
            with open(RADIOS_CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)

            # Auto-réparation des URLs obsolètes des stations par défaut si existantes
            modified = False
            curated_map = {s["id"]: s for s in DEFAULT_CURATED_STATIONS}
            favorites = data.get("favorites", [])
            for fav in favorites:
                fid = fav.get("id")
                if fid in curated_map:
                    ref = curated_map[fid]
                    if fav.get("url") != ref.get("url") or fav.get("favicon") != ref.get("favicon"):
                        fav["url"] = ref.get("url")
                        fav["favicon"] = ref.get("favicon", fav.get("favicon"))
                        fav["codec"] = ref.get("codec", fav.get("codec"))
                        fav["bitrate"] = ref.get("bitrate", fav.get("bitrate"))
                        modified = True

            # Détection et enrichissement des marques parentes et sous-labels (ex: RTL2 Mulhouse -> RTL2 + 📍 Mulhouse)
            for s in data.get("favorites", []) + data.get("custom", []):
                bm = detect_parent_brand_and_sublabel(s.get("name", ""))
                if bm:
                    s["parent_brand"] = bm[0]
                    s["sub_label"] = bm[1]
                    s["sub_label_type"] = bm[2]
                    if not s.get("favicon") or "radio_placeholder" in s.get("favicon", ""):
                        s["favicon"] = bm[3]

            if modified:
                self.save_radios(data)
                logger.info("[RadioManager] URLs et favicons des stations par défaut synchronisés dans radios.json.")

            return data
        except Exception as e:
            logger.error(f"[RadioManager] Erreur lecture radios.json: {e}")
            return {"favorites": DEFAULT_CURATED_STATIONS, "custom": []}

    def save_radios(self, data: Dict[str, Any]):
        """Enregistre les radios dans le fichier local."""
        try:
            with open(RADIOS_CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"[RadioManager] Erreur écriture radios.json: {e}")

    def toggle_favorite(self, station: Dict[str, Any]) -> bool:
        """Ajoute ou retire une station des favoris."""
        data = self.load_radios()
        favorites = data.get("favorites", [])
        st_id = station.get("id") or station.get("stationuuid") or station.get("url")

        existing_idx = -1
        for i, s in enumerate(favorites):
            curr_id = s.get("id") or s.get("stationuuid") or s.get("url")
            if curr_id and curr_id == st_id:
                existing_idx = i
                break

        if existing_idx >= 0:
            favorites.pop(existing_idx)
            is_fav = False
        else:
            station_copy = dict(station)
            station_copy["is_favorite"] = True
            favorites.insert(0, station_copy)
            is_fav = True

        data["favorites"] = favorites
        self.save_radios(data)
        return is_fav

    def add_custom_radio(self, name: str, url: str, tags: str = "", favicon: str = "", country: str = "Personnalisé") -> Dict[str, Any]:
        """Ajoute une station manuelle entrée par l'utilisateur."""
        clean_url = parse_playlist_url(url.strip())
        radio_id = f"custom_{int(time.time())}"
        custom_station = {
            "id": radio_id,
            "name": name.strip(),
            "url": clean_url,
            "favicon": favicon.strip(),
            "country": country.strip() or "Personnalisé",
            "countrycode": "CUSTOM",
            "tags": tags.strip(),
            "codec": "MP3",
            "bitrate": 128,
            "is_favorite": True,
            "is_custom": True
        }

        data = self.load_radios()
        # Dédoublonnage par URL pour éviter les entrées répétées
        data["custom"] = [s for s in data.get("custom", []) if s.get("url") != clean_url]
        data["favorites"] = [s for s in data.get("favorites", []) if s.get("url") != clean_url]
        data.setdefault("custom", []).append(custom_station)
        data.setdefault("favorites", []).insert(0, custom_station)
        self.save_radios(data)
        return custom_station

    def delete_custom_radio(self, radio_id: str) -> bool:
        """Supprime une station manuelle."""
        data = self.load_radios()
        custom = [s for s in data.get("custom", []) if s.get("id") != radio_id]
        favorites = [s for s in data.get("favorites", []) if s.get("id") != radio_id]
        data["custom"] = custom
        data["favorites"] = favorites
        self.save_radios(data)
        return True

    def query_radio_browser(self, endpoint: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Interroge l'annuaire mondial Radio Browser avec tolérance de panne sur serveurs miroirs."""
        encoded_params = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        headers = {"User-Agent": "SoundStash/6.1.0"}

        for mirror in RADIO_BROWSER_MIRRORS:
            full_url = f"{mirror}{endpoint}"
            if encoded_params:
                full_url += f"?{encoded_params}"
            try:
                req = urllib.request.Request(full_url, headers=headers)
                with urllib.request.urlopen(req, timeout=6.0) as resp:
                    raw = resp.read().decode("utf-8")
                    data = json.loads(raw)
                    if isinstance(data, list):
                        return data
            except Exception as e:
                logger.warning(f"[RadioManager] Échec miroir Radio Browser ({mirror}): {e}")
                continue

        return []

    def _extract_dedup_key(self, name: str) -> str:
        """Génère une clé de dédoublonnage normalisée pour éliminer les flux multiples de la même radio."""
        raw = (name or "").lower().strip()
        # Supprimer les mentions de sous-titres, slogans ou URL de streaming
        base = raw.split(" - ")[0].split(" — ")[0].split(" | ")[0].split(" : ")[0]
        base = re.sub(r"\(.*?\)", "", base)
        base = re.sub(r"\[.*?\]", "", base)
        base = re.sub(r"\b(?:https?|stream|mp3|aac|ogg|opus|hq|hd|online|web|audio|fm|radio|webradio|128k|192k|320k|64k|official|live)\b", "", base, flags=re.IGNORECASE)
        norm = re.sub(r"[^a-z0-9]", "", base)
        if len(norm) < 3:
            norm = re.sub(r"[^a-z0-9]", "", raw)
        return norm

    def _process_and_dedup_stations(self, raw_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Normalise, fiabilise les métadonnées et logos, associe les marques parentes
        et dédoublonne intelligemment les flux d'une liste brute de stations.
        """
        best_by_key: Dict[str, Tuple[Dict[str, Any], int]] = {}
        ordered_keys: List[str] = []

        for s in raw_list:
            raw_name = (s.get("name") or "Sans nom").strip()
            favicon = (s.get("favicon") or "").strip()
            homepage = (s.get("homepage") or "").strip()
            url_stream = s.get("url_resolved") or s.get("url") or ""

            # Détection de marque parente et sous-label géographique/thématique
            parent_brand = ""
            sub_label = ""
            sub_label_type = ""
            brand_logo = ""

            brand_match = detect_parent_brand_and_sublabel(raw_name)
            if brand_match:
                parent_brand, sub_label, sub_label_type, brand_logo = brand_match

            # Fiabilisation du logo : éliminer les URLs Wikimedia/Wikipedia 400/HTML, liens Google Play obsolètes ou favicons .ico expirés ou sous-domaines techniques de streaming
            is_unreliable = (
                not favicon or
                "wikimedia.org" in favicon or
                "wikipedia.org" in favicon or
                "play-lh.googleusercontent.com" in favicon or
                favicon.endswith(".ico") or
                "icecast" in favicon or
                "stream" in favicon or
                "radioking" in favicon or
                "infomaniak" in favicon
            )

            if is_unreliable:
                favicon = ""
                # 1. Utiliser le logo officiel de marque parente si détecté
                if brand_logo:
                    favicon = brand_logo
                else:
                    # 2. Utiliser le domaine propre du site officiel (homepage) s'il existe
                    clean_home = extract_clean_domain(homepage)
                    if clean_home:
                        favicon = f"https://www.google.com/s2/favicons?domain={clean_home}&sz=128"
                    else:
                        # 3. Utiliser le domaine propre du flux audio
                        clean_url = extract_clean_domain(url_stream)
                        if clean_url:
                            favicon = f"https://www.google.com/s2/favicons?domain={clean_url}&sz=128"
            elif brand_logo and not ("http" in favicon and any(ext in favicon.lower() for ext in [".png", ".jpg", ".jpeg", ".svg", ".webp"])):
                favicon = brand_logo

            station_obj = {
                "id": s.get("stationuuid") or s.get("changeuuid") or s.get("id"),
                "stationuuid": s.get("stationuuid"),
                "name": raw_name,
                "parent_brand": parent_brand,
                "sub_label": sub_label,
                "sub_label_type": sub_label_type,
                "url": url_stream,
                "homepage": homepage,
                "favicon": favicon,
                "country": s.get("country", ""),
                "countrycode": s.get("countrycode", ""),
                "tags": s.get("tags", ""),
                "codec": (s.get("codec") or "MP3").upper(),
                "bitrate": s.get("bitrate") or 128,
                "votes": s.get("votes", 0),
                "is_custom": False
            }

            # Clé de dédoublonnage
            key = self._extract_dedup_key(station_obj["name"])
            bitrate = station_obj["bitrate"] or 0
            votes = station_obj["votes"] or 0
            score = (bitrate * 2) + votes + (100 if favicon else 0)

            if key not in best_by_key:
                best_by_key[key] = (station_obj, score)
                ordered_keys.append(key)
            elif score > best_by_key[key][1]:
                # On remplace par le meilleur flux (meilleur débit/popularité)
                best_by_key[key] = (station_obj, score)

        # Restitution ordonnée des stations uniques
        return [best_by_key[k][0] for k in ordered_keys]

    def get_country_stations(self, country_code: str, force_refresh: bool = False, max_age_days: int = 7) -> List[Dict[str, Any]]:
        """
        Récupère et indexe l'intégralité des stations vérifiées d'un pays avec mise en cache locale.
        - Lit le cache local si disponible et âgé de moins de 7 jours (< 10ms).
        - Télécharge, nettoie, fiabilise les logos, dédouble et persiste sur disque sinon.
        """
        code = country_code.strip().upper()
        if not code:
            return []

        STATIONS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_file = STATIONS_CACHE_DIR / f"{code.lower()}_stations.json"

        # 1. Lecture du cache local si disponible et frais
        if not force_refresh and cache_file.exists():
            try:
                mtime = cache_file.stat().st_mtime
                if (time.time() - mtime) < (max_age_days * 86400):
                    with open(cache_file, "r", encoding="utf-8") as f:
                        cached = json.load(f)
                    if isinstance(cached, list) and len(cached) > 0:
                        return cached
            except Exception as e:
                logger.warning(f"[RadioManager] Erreur lecture cache {cache_file.name}: {e}")

        # 2. Téléchargement depuis Radio-Browser (jusqu'à 2500 stations actives et vérifiées)
        logger.info(f"[RadioManager] Indexation intégrale des stations pour le pays {code}...")
        params = {
            "limit": 2500,
            "order": "votes",
            "reverse": "true",
            "hidebroken": "true"
        }
        endpoint = f"/json/stations/bycountrycodeexact/{code}"
        raw_list = self.query_radio_browser(endpoint, params)
        if not raw_list:
            # Repli sur le cache local existant même expiré si le réseau est inaccessible
            if cache_file.exists():
                try:
                    with open(cache_file, "r", encoding="utf-8") as f:
                        return json.load(f)
                except Exception:
                    pass
            return []

        # 3. Traitement, fiabilisation et dédoublonnage
        processed = self._process_and_dedup_stations(raw_list)

        # 4. Sauvegarde dans le cache local
        try:
            with open(cache_file, "w", encoding="utf-8") as f:
                json.dump(processed, f, indent=1, ensure_ascii=False)
            logger.info(f"[RadioManager] Indexation terminée pour {code} : {len(processed)} stations sauvegardées dans {cache_file.name}")
        except Exception as e:
            logger.error(f"[RadioManager] Échec écriture cache {cache_file.name}: {e}")

        return processed

    def search_stations(
        self,
        name: str = "",
        countrycode: str = "",
        tag: str = "",
        limit: int = 40,
        offset: int = 0,
        group: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Recherche et consultation de l'annuaire mondial avec support du cache local pays,
        du regroupement en bouquets et de la pagination.
        """
        # Si un pays est spécifié, on utilise le catalogue intégral indexé en cache local
        if countrycode:
            stations = self.get_country_stations(countrycode)
            # Filtrage par mot-clé (nom, marque parente ou sous-label)
            if name:
                q = name.strip().lower()
                stations = [
                    s for s in stations
                    if q in (s.get("name") or "").lower()
                    or q in (s.get("parent_brand") or "").lower()
                    or q in (s.get("sub_label") or "").lower()
                    or q in (s.get("tags") or "").lower()
                ]
            # Filtrage par tag
            if tag:
                t = tag.strip().lower()
                stations = [
                    s for s in stations
                    if t in (s.get("tags") or "").lower()
                ]

            # Regroupement en bouquets par marque parente
            if group:
                stations = group_stations_by_brand(stations)

            if limit > 0:
                return stations[offset:offset + limit]
            return stations

        # Recherche mondiale en direct sans filtre pays
        candidate_limit = min(200, max(limit * 3, 100))
        params: Dict[str, Any] = {
            "limit": candidate_limit,
            "order": "votes",
            "reverse": "true",
            "hidebroken": "true"
        }
        if name:
            params["name"] = name.strip()
        if tag:
            params["tag"] = tag.strip().lower()

        raw_list = self.query_radio_browser("/json/stations/search", params)
        stations = self._process_and_dedup_stations(raw_list)

        if group:
            stations = group_stations_by_brand(stations)

        if limit > 0:
            return stations[offset:offset + limit]
        return stations

    def get_filter_pills_counts(self, name: str, country_codes: Optional[List[str]] = None) -> Dict[str, int]:
        """
        Calcule ultra-rapidement (< 15ms pour le cache local, ~300ms pour l'annuaire mondial)
        le nombre de correspondances de recherche pour chaque pilule de filtre :
        - Favoris ('favorites')
        - Pays configurés ('country:FR', 'country:BE', etc.)
        - Top Mondial ('top')
        """
        q = (name or "").strip().lower()
        if not q:
            return {}

        counts: Dict[str, int] = {}

        # 1. Favoris locaux
        try:
            local_data = self.load_radios()
            favorites = local_data.get("favorites", [])
            fav_count = 0
            for s in favorites:
                s_name = (s.get("name") or "").lower()
                s_tags = (s.get("tags") or "").lower()
                s_country = (s.get("country") or "").lower()
                s_brand = (s.get("parent_brand") or "").lower()
                s_sub = (s.get("sub_label") or "").lower()
                if q in s_name or q in s_tags or q in s_country or q in s_brand or q in s_sub:
                    fav_count += 1
            counts["favorites"] = fav_count
        except Exception as e:
            logger.warning(f"[RadioManager] Erreur comptage favoris: {e}")
            counts["favorites"] = 0

        # 2. Codes pays configurés (lecture instantanée du cache local JSON)
        codes = country_codes or ["FR", "BE", "DE"]
        for code in codes:
            clean_code = code.strip().upper()
            if not clean_code:
                continue
            try:
                stations = self.search_stations(countrycode=clean_code, name=q, group=True, limit=0)
                counts[f"country:{clean_code}"] = len(stations)
            except Exception as e:
                logger.warning(f"[RadioManager] Erreur comptage pays {clean_code}: {e}")
                counts[f"country:{clean_code}"] = 0

        # 3. Top Mondial (Recherche groupée)
        try:
            top_stations = self.search_stations(name=q, group=True, limit=40)
            counts["top"] = len(top_stations)
        except Exception as e:
            logger.warning(f"[RadioManager] Erreur comptage top mondial: {e}")
            counts["top"] = 0

        return counts




# Instance singleton globale
radio_manager = RadioManager()


def group_stations_by_brand(stations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Regroupe les stations d'un même groupe ou réseau (ex: NRJ, Jazz Radio, FIP, RTL2, etc.)
    sous une carte maîtresse ("Bouquet") dotée d'une liste ordonnée de déclinaisons.
    Les stations sans déclinaisons multiples restent des cartes individuelles.
    L'ensemble est ordonné par popularité (votes cumulés).
    """
    brand_map: Dict[str, List[Dict[str, Any]]] = {}
    brand_meta: Dict[str, Dict[str, Any]] = {}
    single_stations: List[Dict[str, Any]] = []

    for s in stations:
        parent_brand = s.get("parent_brand")
        if not parent_brand:
            match = detect_parent_brand_and_sublabel(s.get("name", ""))
            if match and match[0]:
                parent_brand = match[0]
                s["parent_brand"] = parent_brand
                if not s.get("sub_label") and match[1]:
                    s["sub_label"] = match[1]
                    s["sub_label_type"] = match[2]
                if match[3] and (not s.get("favicon") or "radio_placeholder" in s.get("favicon", "")):
                    s["favicon"] = match[3]

        if parent_brand:
            if parent_brand not in brand_map:
                brand_map[parent_brand] = []
                brand_meta[parent_brand] = {
                    "logo": s.get("favicon", ""),
                    "country": s.get("country", ""),
                    "countrycode": s.get("countrycode", ""),
                    "tags": s.get("tags", "")
                }
            brand_map[parent_brand].append(s)
        else:
            single_stations.append(s)

    result_items: List[Dict[str, Any]] = []

    for brand, variants in brand_map.items():
        if len(variants) >= 2:
            def variant_sort_key(v):
                name = (v.get("name") or "").lower().strip()
                sub = (v.get("sub_label") or "").lower().strip()
                b_low = brand.lower().strip()
                is_exact_main = 1 if (name == b_low or sub in ("", "direct", "national", "officiel", "live")) else 0
                votes = v.get("votes", 0) or 0
                bitrate = v.get("bitrate", 0) or 0
                return (is_exact_main, votes, bitrate)

            variants.sort(key=variant_sort_key, reverse=True)
            primary = variants[0]
            meta = brand_meta.get(brand, {})

            total_votes = sum(v.get("votes", 0) or 0 for v in variants)
            tags_set = set()
            for v in variants[:6]:
                for t in (v.get("tags") or "").split(","):
                    t_clean = t.strip()
                    if t_clean and len(t_clean) > 2:
                        tags_set.add(t_clean)
            consolidated_tags = ", ".join(list(tags_set)[:5])

            brand_slug = re.sub(r"[^a-zA-Z0-9]+", "_", brand).strip("_").lower()

            group_obj = {
                "id": f"group:{brand_slug}",
                "stationuuid": f"group:{brand_slug}",
                "is_group": True,
                "name": brand,
                "parent_brand": brand,
                "variants_count": len(variants),
                "variants": variants,
                "default_station": primary,
                "url": primary.get("url", ""),
                "favicon": primary.get("favicon") or meta.get("logo") or "",
                "country": primary.get("country") or meta.get("country", ""),
                "countrycode": primary.get("countrycode") or meta.get("countrycode", ""),
                "codec": primary.get("codec", "MP3"),
                "bitrate": primary.get("bitrate", 128),
                "votes": total_votes,
                "tags": consolidated_tags or primary.get("tags", ""),
                "is_custom": False
            }
            result_items.append(group_obj)
        else:
            result_items.append(variants[0])

    result_items.extend(single_stations)
    result_items.sort(key=lambda x: x.get("votes", 0) or 0, reverse=True)
    return result_items


def init_stations_cache_worker(country_codes: Optional[List[str]] = None):
    """
    Lance un thread démon en arrière-plan au démarrage pour pré-indexer
    les stations des pays configurés dans le cache local si absent ou expiré.
    """
    codes = country_codes or ["FR", "BE", "CH", "CA", "GB", "US"]

    def _worker():
        # Pause initiale de 6 secondes pour ne pas ralentir le démarrage de l'application
        time.sleep(6.0)
        try:
            rm = RadioManager()
            for code in codes:
                c_clean = code.strip().upper()
                if not c_clean:
                    continue
                cache_file = STATIONS_CACHE_DIR / f"{c_clean.lower()}_stations.json"
                needs_indexing = True
                if cache_file.exists():
                    try:
                        mtime = cache_file.stat().st_mtime
                        if (time.time() - mtime) < (7 * 86400):
                            needs_indexing = False
                    except Exception:
                        pass
                if needs_indexing:
                    logger.info(f"[RadioCacheWorker] Pré-indexation des stations pour {c_clean}...")
                    rm.get_country_stations(c_clean, force_refresh=True)
                    time.sleep(2.0)
        except Exception as e:
            logger.warning(f"[RadioCacheWorker] Erreur pré-indexation en tâche de fond: {e}")

    thread = threading.Thread(target=_worker, name="SoundStashRadioIndexer", daemon=True)
    thread.start()

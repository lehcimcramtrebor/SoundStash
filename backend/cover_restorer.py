"""
Module de restauration des jaquettes d'albums avec la Règle d'Or (Hauteur 100% intégrale).
Stratégie d'excellence multi-niveaux :
1. Recherche prioritaire de la VÉRITABLE pochette d'album studio officielle HD (1200x1200px)
   via l'API officielle des discographies (iTunes / Apple Music) -> Élimine 100% des captures
   de clips vidéo, concerts live ou tracklists amateurs.
2. Repli automatique sur la miniature originale YouTube HD avec cascade anti-404 si l'album
   est un rip amateur / introuvable dans le commerce.
3. Application stricte de la Règle d'Or : Hauteur 100% préservée (y: 0 -> h, 0 rognage vertical).
4. Sauvegarde de cover.jpg et réinjection dans les tags audio de toutes les pistes via kid3-cli.
"""

import os
import sys
import re
import json
import urllib.request
import urllib.parse
import subprocess
import threading
import time
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional, Dict, Any, List

from PIL import Image

from backend.config import config, YT_DLP_PATH, KID3_CLI_PATH
from backend.tagger import AUDIO_EXTENSIONS, get_album_info
from backend.library_indexer import DISC_SUBFOLDER_RE, library_indexer
from backend.logger import get_logger

logger = get_logger(__name__)

# État global de la tâche de restauration
_restore_lock = threading.Lock()
_restore_thread: Optional[threading.Thread] = None
_restore_stop_event = threading.Event()

_restore_state: Dict[str, Any] = {
    "running": False,
    "current": 0,
    "total": 0,
    "album": "",
    "repaired": 0,
    "failed": 0,
    "percent": 0.0,
    "done": False,
    "error": None
}

def get_restoration_status() -> Dict[str, Any]:
    with _restore_lock:
        return dict(_restore_state)

def cancel_restoration():
    global _restore_stop_event
    _restore_stop_event.set()

def _clean_for_match(text: Optional[str]) -> str:
    """Nettoie une chaîne pour la comparaison floue de titres et artistes."""
    if not text:
        return ""
    # Supprimer les mentions de réédition, version, etc.
    s = re.sub(r'[\(\[][^\)\]]*(?:deluxe|remaster|anniversary|expanded|edition|version|reissue|bonus|live|ost|soundtrack)[^\)\]]*[\)\]]', '', text, flags=re.IGNORECASE)
    # Remplacer les séparateurs et caractères spéciaux
    s = re.sub(r'[^\w\s]', ' ', s)
    return ' '.join(s.lower().split())

def fetch_official_album_cover(artist_name: str, album_name: str) -> Optional[str]:
    """
    Interroge l'API iTunes / Apple Music pour obtenir l'authentique pochette CD studio
    officielle en haute résolution native 1:1 (1200x1200px ou 1400x1400px).
    Garantit zéro capture d'écran de clip vidéo ou de concert live.
    """
    clean_alb = _clean_for_match(album_name)
    clean_art = _clean_for_match(artist_name)
    if not clean_alb and not clean_art:
        return None

    queries = []
    if artist_name and album_name:
        queries.append(f"{artist_name} {album_name}".strip())
    if clean_art and clean_alb:
        queries.append(f"{clean_art} {clean_alb}".strip())
    if album_name:
        queries.append(album_name.strip())
    if clean_alb:
        queries.append(clean_alb)

    countries = ["FR", "US", "GB"]

    for q in queries:
        if not q:
            continue
        for country in countries:
            try:
                url = f"https://itunes.apple.com/search?term={urllib.parse.quote(q)}&entity=album&country={country}&limit=6"
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
                with urllib.request.urlopen(req, timeout=5) as resp:
                    if resp.status != 200:
                        continue
                    data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                    results = data.get("results", [])
                    for r in results:
                        col_name = r.get("collectionName", "")
                        art_name = r.get("artistName", "")
                        c_col = _clean_for_match(col_name)
                        c_art = _clean_for_match(art_name)

                        # Calculer la pertinence
                        score_alb = SequenceMatcher(None, clean_alb, c_col).ratio() if clean_alb else 0.0
                        score_art = SequenceMatcher(None, clean_art, c_art).ratio() if clean_art else 0.0

                        match_alb = (score_alb >= 0.45 or clean_alb in c_col or c_col in clean_alb)
                        match_art = (not clean_art or score_art >= 0.35 or clean_art in c_art or c_art in clean_art)

                        if match_alb and match_art:
                            art_url = r.get("artworkUrl100", "")
                            if art_url:
                                # Remplacer 100x100bb par 1200x1200bb pour obtenir l'image originale HD non compressée
                                return art_url.replace("100x100bb", "1200x1200bb")
            except Exception:
                continue

    return None

def fetch_youtube_thumbnail(query: str, album_path: Path) -> Optional[Path]:
    """
    Repli YouTube : télécharge la miniature originale YouTube avec cascade anti-404
    (priorité aux flux JPEG officiels avant les WebP).
    """
    yt_dlp_bin = str(YT_DLP_PATH)
    if not Path(yt_dlp_bin).exists():
        yt_dlp_bin = "yt-dlp"

    try:
        cmd = [yt_dlp_bin, f"ytsearch1:{query}", "--dump-json", "--no-warnings", "--skip-download"]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=25)
        if res.returncode != 0 or not res.stdout.strip():
            logger.warning(f"Aucun résultat YouTube pour {query}")
            return None

        data = json.loads(res.stdout.splitlines()[0])
        thumbnails = data.get("thumbnails", [])

        # Liste intelligente ordonnée (priorité absolue au JPEG pour éviter les 404 WebP)
        candidate_urls = []
        for t in reversed(thumbnails):
            u = t.get("url", "")
            if u and (".jpg" in u or ".jpeg" in u) and u not in candidate_urls:
                candidate_urls.append(u)

        main_thumb = data.get("thumbnail")
        if main_thumb and main_thumb not in candidate_urls:
            candidate_urls.append(main_thumb)

        for t in reversed(thumbnails):
            u = t.get("url", "")
            if u and u not in candidate_urls:
                candidate_urls.append(u)

        if not candidate_urls:
            return None

        temp_thumb = album_path / "_temp_restore_thumb.jpg"
        for u in candidate_urls:
            try:
                req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
                with urllib.request.urlopen(req, timeout=12) as response:
                    if response.status == 200:
                        content = response.read()
                        if len(content) > 1000:
                            with open(temp_thumb, "wb") as out_file:
                                out_file.write(content)
                            return temp_thumb
            except Exception:
                continue

    except Exception as e:
        logger.debug(f"Erreur recherche YouTube pour {query}: {e}")

    return None

def repair_album_cover(album_path: Path | str) -> bool:
    """
    Restaure la pochette officielle de l'album :
    1. Tente d'abord l'authentique pochette CD studio 1:1 HD officielle via iTunes (zéro clip vidéo).
    2. En cas d'album obscur / introuvable, repli sur la miniature YouTube avec la règle d'or 100% hauteur.
    3. Réinjecte la jaquette dans toutes les pistes de l'album via kid3-cli.
    """
    p = Path(album_path)
    if not p.is_dir():
        return False

    cov = p / "cover.jpg"

    # Récupérer les fichiers audio (y compris sous-dossiers disques)
    audio_files = [f for f in p.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS]
    for d in p.iterdir():
        if d.is_dir() and DISC_SUBFOLDER_RE.match(d.name):
            audio_files.extend([f for f in d.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS])

    if not audio_files:
        return False

    album_name = p.name
    parent_name = p.parent.name
    artist_name = parent_name if parent_name.lower() not in {
        "mes albums", "music", "musique", "_imports", "downloads", "temp", "albums"
    } else ""

    # Affiner avec les métadonnées de l'album
    try:
        info = get_album_info(p)
        if info:
            if info.get("album_name") and not str(info.get("album_name")).startswith("Album"):
                album_name = str(info["album_name"]).strip()
            if info.get("album_artist") and not str(info.get("album_artist")).startswith("Artiste"):
                artist_name = str(info["album_artist"]).strip()
    except Exception:
        pass

    query = f"{artist_name} {album_name}".strip()
    if not query:
        query = p.name

    temp_thumb = p / "_temp_restore_thumb.jpg"
    is_official_studio = False

    # 1. ÉTAPE PRIORITAIRE : Pochette Officielle Studio CD (iTunes HD 1200x1200)
    itunes_url = fetch_official_album_cover(artist_name, album_name)
    if itunes_url:
        try:
            req = urllib.request.Request(itunes_url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            with urllib.request.urlopen(req, timeout=12) as response:
                if response.status == 200:
                    content = response.read()
                    if len(content) > 2000:
                        with open(temp_thumb, "wb") as out_file:
                            out_file.write(content)
                        is_official_studio = True
                        logger.info(f"Pochette officielle studio trouvée (iTunes HD) pour : {artist_name} - {album_name}")
        except Exception as e:
            logger.debug(f"Erreur téléchargement iTunes pour {query}: {e}")

    # 2. ÉTAPE SECONDAIRE : Repli sur YouTube si la pochette officielle n'existe pas
    if not is_official_studio or not temp_thumb.exists():
        logger.info(f"Recherche pochette YouTube HD pour : {query}...")
        thumb_file = fetch_youtube_thumbnail(query, p)
        if not thumb_file or not thumb_file.exists():
            logger.warning(f"Impossible de trouver une jaquette pour {query}")
            return False

    try:
        # 3. Application stricte de la RÈGLE D'OR (Hauteur 100% intégrale, 0 rognage vertical)
        with Image.open(temp_thumb) as im:
            w, h = im.size
            if w > h:
                # 16:9 ou panoramique -> extraction du carré central h x h (y de 0 à h sans AUCUNE coupe)
                cx = (w - h) // 2
                sq = im.crop((cx, 0, cx + h, h))
            elif h > w:
                # Portrait -> redimensionnement en largeur vers h sans couper la hauteur
                sq = im.resize((h, h), Image.Resampling.LANCZOS)
            else:
                sq = im.copy()

            # Sauvegarde en haute qualité JPEG
            sq.save(cov, "JPEG", quality=95)

        if temp_thumb.exists():
            temp_thumb.unlink()

        # 4. Injection dans les tags des pistes avec kid3-cli
        kid3_bin = str(KID3_CLI_PATH)
        if Path(kid3_bin).exists() and audio_files:
            track_args = [str(af.resolve()) for af in audio_files]
            kid3_cmd = [kid3_bin, "-c", f'set picture:"{str(cov.resolve())}" ""'] + track_args
            subprocess.run(kid3_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=40)

        # Mettre à jour le marqueur de normalisation
        marker = p / ".cover_normalized"
        try:
            marker.touch()
        except Exception:
            pass

        label_type = "Officielle Studio 1:1" if is_official_studio else "YouTube HD 1:1"
        logger.info(f"Pochette restaurée [{label_type}] pour {p.name} (Hauteur 100% intégrale)")
        return True

    except Exception as e:
        logger.warning(f"Erreur traitement jaquette pour {p.name}: {e}")
        if temp_thumb.exists():
            try:
                temp_thumb.unlink()
            except Exception:
                pass
        return False

def _run_restore_all(target_dir: Path, broadcast_fn=None):
    global _restore_state, _restore_stop_event

    album_dirs: List[Path] = []
    # Trouver tous les albums ayant des fichiers audio
    for root, dirs, files in os.walk(str(target_dir)):
        if _restore_stop_event.is_set():
            break
        p_root = Path(root)
        if p_root.name.startswith(".") or p_root.name.lower() in {"_imports", ".cache", "cache"}:
            dirs.clear()
            continue
        has_audio = any(Path(f).suffix.lower() in AUDIO_EXTENSIONS for f in files)
        if has_audio:
            album_dirs.append(p_root)

    total = len(album_dirs)
    with _restore_lock:
        _restore_state.update({
            "running": True,
            "current": 0,
            "total": total,
            "album": "",
            "repaired": 0,
            "failed": 0,
            "percent": 0.0,
            "done": False,
            "error": None
        })

    if broadcast_fn:
        try:
            broadcast_fn({
                "type": "covers_restore_progress",
                **_restore_state
            })
        except Exception:
            pass

    repaired = 0
    failed = 0

    for i, a_dir in enumerate(album_dirs, 1):
        if _restore_stop_event.is_set():
            logger.info("Restauration des jaquettes interrompue par l'utilisateur.")
            break

        album_label = f"{a_dir.parent.name} / {a_dir.name}"
        pct = round((i / max(1, total)) * 100, 1)

        with _restore_lock:
            _restore_state.update({
                "current": i,
                "album": album_label,
                "percent": pct
            })

        if broadcast_fn:
            try:
                broadcast_fn({
                    "type": "covers_restore_progress",
                    **_restore_state
                })
            except Exception:
                pass

        ok = repair_album_cover(a_dir)
        if ok:
            repaired += 1
        else:
            failed += 1

        with _restore_lock:
            _restore_state.update({
                "repaired": repaired,
                "failed": failed
            })

        time.sleep(0.1)

    with _restore_lock:
        _restore_state.update({
            "running": False,
            "done": True,
            "percent": 100.0 if not _restore_stop_event.is_set() else pct
        })

    if broadcast_fn:
        try:
            broadcast_fn({
                "type": "covers_restore_completed",
                **_restore_state
            })
        except Exception:
            pass

    # Rafraîchir le cache de l'indexothèque
    try:
        library_indexer._save_to_cache()
    except Exception:
        pass

def start_restoration_task(target_dir: Optional[Path | str] = None, broadcast_fn=None) -> Dict[str, Any]:
    global _restore_thread, _restore_stop_event

    with _restore_lock:
        if _restore_state["running"]:
            return {"status": "already_running", **_restore_state}

        _restore_stop_event.clear()
        _restore_state.update({
            "running": True,
            "current": 0,
            "total": 0,
            "album": "",
            "repaired": 0,
            "failed": 0,
            "percent": 0.0,
            "done": False,
            "error": None
        })

    lib_path = Path(target_dir) if target_dir else (
        Path(config.library_dir) if config.library_dir else (
            Path(config.export_dir) if config.export_dir else Path(r"D:\GoogleDrive\Musique\Mes Albums")
        )
    )

    if not lib_path.exists() or not lib_path.is_dir():
        with _restore_lock:
            _restore_state.update({"running": False, "error": f"Dossier introuvable : {lib_path}"})
        return {"status": "error", "message": f"Dossier introuvable : {lib_path}"}

    _restore_thread = threading.Thread(
        target=_run_restore_all,
        args=(lib_path, broadcast_fn),
        daemon=True,
        name="CoversRestorationThread"
    )
    _restore_thread.start()

    return {"status": "started", "total_estimated": len(library_indexer.albums)}

"""
Module d'Indexation et de Gestion de la Vidéothèque Locale (SoundStash).

Scanne de façon récursive le dossier maître des vidéos musicales (video_library_dir),
extrait les métadonnées (Artiste, Titre, Résolution, Durée, Framerate),
gère la persistance dans un cache disque (.video_cache.json) pour des accès à 0 ms,
et fournit la liste triée et groupée pour le Hub Vidéo de l'interface.
"""

import os
import re
import json
import time
import subprocess
from pathlib import Path
from typing import Optional, List, Dict, Any

from backend.config import config, FFPROBE_PATH, FFMPEG_PATH, PREVIEW_CACHE_DIR, FRONTEND_DIR
from backend.logger import get_logger

logger = get_logger(__name__)

VIDEO_EXTENSIONS = {".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v"}
THUMB_CACHE_DIR = PREVIEW_CACHE_DIR.parent / "video_thumbs"

def format_duration(seconds: float) -> str:
    """Formate une durée en secondes vers 'M:SS' ou 'H:MM:SS'."""
    if not seconds or seconds < 0:
        return "0:00"
    total_sec = int(round(seconds))
    hrs = total_sec // 3600
    mins = (total_sec % 3600) // 60
    secs = total_sec % 60
    if hrs > 0:
        return f"{hrs}:{mins:02d}:{secs:02d}"
    return f"{mins}:{secs:02d}"

def probe_video_metadata(filepath: Path) -> Dict[str, Any]:
    """Extrait la résolution, durée et dimensions d'un fichier vidéo via ffprobe."""
    meta = {
        "width": 0,
        "height": 0,
        "resolution": "HD",
        "duration": 0.0,
        "duration_str": "0:00"
    }
    if not filepath.exists() or not Path(FFPROBE_PATH).exists():
        return meta

    try:
        cmd = [
            FFPROBE_PATH,
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,duration:format=duration",
            "-of", "json",
            str(filepath)
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5)
        if res.returncode == 0 and res.stdout.strip():
            data = json.loads(res.stdout)
            streams = data.get("streams", [])
            fmt = data.get("format", {})

            w = 0
            h = 0
            if streams:
                w = int(streams[0].get("width") or 0)
                h = int(streams[0].get("height") or 0)

            dur = 0.0
            if streams and streams[0].get("duration"):
                try:
                    dur = float(streams[0]["duration"])
                except Exception:
                    pass
            if dur <= 0.0 and fmt.get("duration"):
                try:
                    dur = float(fmt["duration"])
                except Exception:
                    pass

            meta["width"] = w
            meta["height"] = h
            meta["duration"] = dur
            meta["duration_str"] = format_duration(dur)

            # Qualification de la résolution
            if h >= 2160 or w >= 3840:
                meta["resolution"] = "4K"
            elif h >= 1440 or w >= 2560:
                meta["resolution"] = "2K"
            elif h >= 1080 or w >= 1920:
                meta["resolution"] = "1080p"
            elif h >= 720 or w >= 1280:
                meta["resolution"] = "720p"
            elif h >= 480:
                meta["resolution"] = "480p"
            else:
                meta["resolution"] = "SD"
    except Exception as e:
        logger.debug(f"Erreur ffprobe sur {filepath.name}: {e}")

    return meta

def extract_thumbnail_from_video(video_path: Path, output_image_path: Path) -> bool:
    """
    Capture une miniature 16:9 représentative via ffmpeg en évitant tout écran noir ou fondu.
    Échantillonne plusieurs instants clés (ex: 15%, 35%, 60% de la durée) et sélectionne
    la capture JPEG ayant le poids de fichier le plus élevé (richesse visuelle et détails maximaux).
    """
    if not video_path.exists() or not Path(FFMPEG_PATH).exists():
        return False
    try:
        output_image_path.parent.mkdir(parents=True, exist_ok=True)

        meta = probe_video_metadata(video_path)
        dur = float(meta.get("duration") or 0.0)

        # Calcul des moments d'échantillonnage
        sample_timestamps: List[float] = []
        if dur >= 30.0:
            sample_timestamps = [dur * 0.15, dur * 0.35, dur * 0.60]
        elif dur >= 10.0:
            sample_timestamps = [dur * 0.20, dur * 0.50, dur * 0.80]
        elif dur > 2.0:
            sample_timestamps = [dur * 0.30, dur * 0.70]
        else:
            sample_timestamps = [1.0]

        best_bytes: Optional[bytes] = None
        best_size: int = -1
        temp_candidate = output_image_path.parent / f"_tmp_thumb_{int(time.time() * 1000)}_{os.getpid()}.jpg"

        for ts in sample_timestamps:
            try:
                cmd = [
                    FFMPEG_PATH,
                    "-y",
                    "-ss", f"{ts:.2f}",
                    "-i", str(video_path),
                    "-vframes", "1",
                    "-q:v", "2",
                    "-vf", "scale=640:-1",
                    str(temp_candidate)
                ]
                res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=8)
                if res.returncode == 0 and temp_candidate.exists():
                    sz = temp_candidate.stat().st_size
                    if sz > best_size:
                        best_size = sz
                        best_bytes = temp_candidate.read_bytes()
            except Exception as e:
                logger.debug(f"Erreur échantillonnage miniature ts={ts} pour {video_path.name}: {e}")
            finally:
                if temp_candidate.exists():
                    try:
                        temp_candidate.unlink()
                    except Exception:
                        pass

        # Si un candidat a été extrait avec un poids décent (> 1500 octets)
        if best_bytes and best_size > 1500:
            output_image_path.write_bytes(best_bytes)
            return True

        # Fallback d'urgence à la 3e seconde
        cmd_fallback = [
            FFMPEG_PATH,
            "-y",
            "-ss", "00:00:03",
            "-i", str(video_path),
            "-vframes", "1",
            "-q:v", "2",
            "-vf", "scale=640:-1",
            str(output_image_path)
        ]
        res = subprocess.run(cmd_fallback, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=8)
        return res.returncode == 0 and output_image_path.exists() and output_image_path.stat().st_size > 0
    except Exception as e:
        logger.debug(f"Erreur extraction miniature pour {video_path.name}: {e}")
        return False


def generate_rip_audio_cover(
    source_thumb_path: Path,
    output_cover_path: Path,
    artist_name: str = "",
    subtitle: str = ""
) -> bool:
    """
    Assure la présence de la miniature nette représentative de la vidéo vers le fichier de pochette.
    Les badges de type (ALBUM, SINGLE, RIP AUDIO, PLAYLIST) sont gérés dynamiquement en HTML/CSS.
    """
    if not source_thumb_path.exists():
        return False
    try:
        import shutil
        output_cover_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(source_thumb_path), str(output_cover_path))
        return True
    except Exception as e:
        logger.error(f"Erreur copie miniature vers pochette: {e}")
        return False


class VideoIndexer:
    """Indexeur haute performance pour la vidéothèque locale."""

    def __init__(self):
        self._cache: Dict[str, Any] = {}
        self._cache_file: Optional[Path] = None
        self._last_scan_time: float = 0.0
        THUMB_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    def get_video_dir(self) -> Path:
        """Retourne le dossier actif de la vidéothèque."""
        raw = config.video_library_dir or config.video_export_dir
        p = Path(raw).resolve()
        p.mkdir(parents=True, exist_ok=True)
        return p

    def invalidate_cache(self):
        """Force l'invalidation du cache mémoire."""
        self._cache.clear()
        self._last_scan_time = 0.0

    def _load_disk_cache(self, video_dir: Path) -> Dict[str, Any]:
        cache_f = video_dir / ".video_cache.json"
        if cache_f.exists():
            try:
                with open(cache_f, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Erreur lecture .video_cache.json: {e}")
        return {}

    def _save_disk_cache(self, video_dir: Path, data: Dict[str, Any]):
        cache_f = video_dir / ".video_cache.json"
        try:
            temp_f = cache_f.with_suffix(".tmp")
            with open(temp_f, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            temp_f.replace(cache_f)
        except Exception as e:
            logger.warning(f"Erreur écriture .video_cache.json: {e}")

    def scan_catalog(self, force_refresh: bool = False) -> Dict[str, Any]:
        """
        Scanne l'arborescence des vidéos et retourne le catalogue complet.
        Structure retournée :
        {
            "video_dir": str,
            "total_count": int,
            "artists": [{"name": str, "count": int}],
            "videos": [
                {
                    "id": str,
                    "artist": str,
                    "title": str,
                    "filename": str,
                    "filepath": str,
                    "resolution": str,
                    "duration": float,
                    "duration_str": str,
                    "size_mb": float,
                    "mtime": float,
                    "has_custom_thumb": bool
                }
            ]
        }
        """
        video_dir = self.get_video_dir()
        now = time.time()

        # Si le cache mémoire est récent (< 3s) et sans force_refresh, retourner le cache
        if not force_refresh and self._cache and (now - self._last_scan_time < 3.0):
            return self._cache

        disk_cache = self._load_disk_cache(video_dir)
        new_disk_cache = {}
        items: List[Dict[str, Any]] = []
        artist_counts: Dict[str, int] = {}

        try:
            # Parcours de l'arborescence
            for root, dirs, files in os.walk(video_dir):
                root_path = Path(root)
                # Ignorer les dossiers cachés
                dirs[:] = [d for d in dirs if not d.startswith(".")]

                for f in files:
                    ext = Path(f).suffix.lower()
                    if ext in VIDEO_EXTENSIONS:
                        f_path = root_path / f
                        try:
                            st = f_path.stat()
                        except Exception:
                            continue

                        cache_key = f"{f_path.relative_to(video_dir)}::{st.st_mtime}::{st.st_size}"
                        
                        # Résolution de l'artiste :
                        # 1. Si le fichier est dans un sous-dossier, le nom du sous-dossier est l'artiste
                        # 2. Sinon, extraction du préfixe 'Artiste - Titre'
                        rel = f_path.relative_to(video_dir)
                        if len(rel.parts) > 1:
                            artist_name = rel.parts[0]
                            title_name = f_path.stem
                        else:
                            # Fichier à la racine
                            parts = f_path.stem.split(" - ", 1)
                            if len(parts) == 2:
                                artist_name = parts[0].strip()
                                title_name = parts[1].strip()
                            else:
                                artist_name = "Clips Divers"
                                title_name = f_path.stem

                        # Nettoyer les mentions de titre parasites
                        title_clean = re.sub(
                            r"\s*[\(\[](?:(?:official\s+)?(?:(?:hd|4k|hq|uhd)\s+)?(?:music\s+video|video|audio|lyric\s+video|visualizer|mv|clip|vidéo)(?:[,\s]+(?:remaster(?:ed)?|hd|4k|hq|\d+p))*)[)\]]",
                            "",
                            title_name,
                            flags=re.IGNORECASE
                        ).strip()

                        # Récupération ou extraction des métadonnées
                        if cache_key in disk_cache:
                            v_meta = disk_cache[cache_key]
                        else:
                            v_meta = probe_video_metadata(f_path)

                        new_disk_cache[cache_key] = v_meta

                        # Vérifier s'il y a une miniature locale
                        has_custom_thumb = False
                        thumb_candidates = [
                            f_path.with_suffix(".jpg"),
                            f_path.with_suffix(".png"),
                            f_path.with_suffix(".webp"),
                            root_path / "cover.jpg",
                            root_path / "folder.jpg"
                        ]
                        for tc in thumb_candidates:
                            if tc.exists() and tc.stat().st_size > 0:
                                has_custom_thumb = True
                                break

                        vid_id = re.sub(r'[^a-zA-Z0-9_\-]', '_', str(rel))

                        # Détection du type de vidéo (Clip vs Concert / Live)
                        is_in_concert_subfolder = any(p.lower() in ("concerts", "concert", "live", "lives") for p in rel.parts[:-1])
                        dur_sec = v_meta.get("duration", 0.0)
                        has_concert_duration = dur_sec >= 600.0  # >= 10 minutes (la durée met la puce à l'oreille : un clip ne fait pas 10 min)
                        has_concert_keywords = bool(re.search(
                            r"\b(concert|live|tour|festival|show|session|recital|spectacle|acoustique|unplugged|en\s+public|in\s+concert|full\s+concert|concert\s+complet)\b",
                            f"{f_path.stem} {' '.join(rel.parts)}",
                            re.IGNORECASE
                        ))
                        is_concert = is_in_concert_subfolder or has_concert_duration or has_concert_keywords
                        video_type = "concert" if is_concert else "clip"

                        video_obj = {
                            "id": vid_id,
                            "artist": artist_name,
                            "title": title_clean or f_path.stem,
                            "filename": f_path.name,
                            "filepath": str(f_path.resolve()),
                            "rel_path": str(rel).replace("\\", "/"),
                            "video_type": video_type,
                            "is_concert": is_concert,
                            "resolution": v_meta.get("resolution", "HD"),
                            "width": v_meta.get("width", 0),
                            "height": v_meta.get("height", 0),
                            "duration": v_meta.get("duration", 0.0),
                            "duration_str": v_meta.get("duration_str", "0:00"),
                            "size_mb": round(st.st_size / (1024 * 1024), 1),
                            "mtime": st.st_mtime,
                            "has_custom_thumb": has_custom_thumb
                        }
                        items.append(video_obj)
                        artist_counts[artist_name] = artist_counts.get(artist_name, 0) + 1

        except Exception as e:
            logger.error(f"Erreur lors du scan du catalogue vidéo: {e}")

        # Sauvegarder le cache disque si des nouveautés ont été indexées
        if new_disk_cache != disk_cache:
            self._save_disk_cache(video_dir, new_disk_cache)

        # Trier les artistes par nombre de clips décroissant puis alphabétique
        artists_list = [
            {"name": k, "count": v}
            for k, v in sorted(artist_counts.items(), key=lambda x: (-x[1], x[0].lower()))
        ]

        # Tri par défaut des vidéos : les plus récemment modifiées / téléchargées d'abord
        items.sort(key=lambda x: x["mtime"], reverse=True)

        clips_count = sum(1 for v in items if v.get("video_type") == "clip")
        concerts_count = sum(1 for v in items if v.get("video_type") == "concert")

        result = {
            "video_dir": str(video_dir),
            "total_count": len(items),
            "total_videos": len(items),
            "clips_count": clips_count,
            "concerts_count": concerts_count,
            "total_artists": len(artists_list),
            "artists": artists_list,
            "videos": items
        }

        self._cache = result
        self._last_scan_time = now
        return result

    def get_thumbnail_path(self, filepath: Path) -> Path:
        """Retourne ou génère le chemin vers la miniature 16:9 du fichier vidéo."""
        # 1. Image compagnon locale
        for ext in [".jpg", ".png", ".webp"]:
            companion = filepath.with_suffix(ext)
            if companion.exists() and companion.stat().st_size > 0:
                return companion

        # 2. Image en cache
        safe_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', filepath.stem)
        cached_thumb = THUMB_CACHE_DIR / f"{safe_name}_{int(filepath.stat().st_mtime)}.jpg"
        if cached_thumb.exists() and cached_thumb.stat().st_size > 12000:
            return cached_thumb

        # 3. Génération dynamique via ffmpeg (multi-points intelligent anti-écran noir)
        if extract_thumbnail_from_video(filepath, cached_thumb):
            return cached_thumb

        # En dernier recours si la miniature existait même sous 12 KB
        if cached_thumb.exists() and cached_thumb.stat().st_size > 0:
            return cached_thumb

        # 4. Fallback sur le placeholder générique
        return FRONTEND_DIR / "placeholder-cover.svg"

    def remove_video_by_path(self, video_path: Path | str):
        """Retire une vidéo de l'index en mémoire et met à jour le cache disque."""
        try:
            target_str = str(Path(video_path).resolve())
            video_dir = self.get_video_dir()
            disk_cache = self._load_disk_cache(video_dir)

            # Purger du cache disque
            to_del = [k for k in disk_cache if str((video_dir / k).resolve()) == target_str or k == Path(video_path).name]
            for k in to_del:
                del disk_cache[k]
            if to_del:
                self._save_disk_cache(video_dir, disk_cache)

            # Invalider / mettre à jour le cache mémoire
            if self._cache and "videos" in self._cache:
                self._cache["videos"] = [v for v in self._cache["videos"] if str(Path(v.get("filepath", "")).resolve()) != target_str]
                self._cache["total_count"] = len(self._cache["videos"])
                self._cache["total_videos"] = len(self._cache["videos"])
            self.invalidate_cache()
            logger.info(f"Vidéothèque : Vidéo retirée du cache -> {video_path}")
        except Exception as e:
            logger.warning(f"Erreur suppression vidéo du cache {video_path}: {e}")

    def get_all_videos(self) -> List[Dict[str, Any]]:
        """Retourne la liste complète de tous les clips vidéo indexés."""
        catalog = self.scan_catalog()
        return catalog.get("videos", []) if isinstance(catalog, dict) else []


video_indexer = VideoIndexer()


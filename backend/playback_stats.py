"""
Module de Statistiques de Lecture et d'Historique pour SoundStash.
Mémorise les écoutes de morceaux dans CONFIG_DIR / 'playback_stats.json' pour
permettre la génération de playlists intelligentes ("Les plus écoutés", "Pépites oubliées").
"""

import json
import time
from pathlib import Path
from typing import Dict, Any, List, Optional

from backend.config import CONFIG_DIR
from backend.logger import get_logger

logger = get_logger(__name__)

STATS_FILE = CONFIG_DIR / "playback_stats.json"

class PlaybackStatsManager:
    """Gestionnaire persistant des écoutes et du classement des morceaux."""

    def __init__(self):
        self.stats_file = STATS_FILE
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._load()

    def _load(self):
        if self.stats_file.exists():
            try:
                with open(self.stats_file, "r", encoding="utf-8") as f:
                    self._cache = json.load(f)
            except Exception as e:
                logger.warning(f"Impossible de lire playback_stats.json : {e}")
                self._cache = {}
        else:
            self._cache = {}

    def _save(self):
        try:
            CONFIG_DIR.mkdir(parents=True, exist_ok=True)
            with open(self.stats_file, "w", encoding="utf-8") as f:
                json.dump(self._cache, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Erreur sauvegarde playback_stats.json : {e}")

    def record_play(self, path: str, title: str = "", artist: str = "", album: str = "", genre: str = "", duration: float = 0.0, media_type: str = "audio") -> Dict[str, Any]:
        """Incrémente le compteur de lecture pour une piste donnée."""
        try:
            norm_key = str(Path(path).resolve()).lower() if path else f"{artist.strip().lower()} - {title.strip().lower()}"
        except Exception:
            norm_key = str(path).lower() if path else f"{artist.strip().lower()} - {title.strip().lower()}"

        now = int(time.time())

        entry = self._cache.get(norm_key, {
            "path": path,
            "type": media_type or "audio",
            "title": title or "Titre inconnu",
            "artist": artist or "Artiste inconnu",
            "album": album or "",
            "genre": genre or "",
            "duration": duration,
            "play_count": 0,
            "first_played": now,
            "last_played": now
        })

        entry["play_count"] = entry.get("play_count", 0) + 1
        entry["last_played"] = now
        entry["type"] = media_type or entry.get("type", "audio")
        if title: entry["title"] = title
        if artist: entry["artist"] = artist
        if album: entry["album"] = album
        if genre: entry["genre"] = genre
        if duration > 0: entry["duration"] = duration

        self._cache[norm_key] = entry
        self._save()
        logger.info(f"Écoute enregistrée : '{entry['title']}' ({entry['artist']}) -> {entry['play_count']} écoute(s)")
        return entry

    def get_top_played(self, limit: int = 50, genre: Optional[str] = None, existing_only: bool = True) -> List[Dict[str, Any]]:
        """Retourne les pistes les plus écoutées, optionnellement filtrées par genre et vérifiées sur disque."""
        tracks = list(self._cache.values())
        if genre and genre.strip():
            target_g = genre.strip().lower()
            tracks = [t for t in tracks if target_g in str(t.get("genre", "")).lower()]

        if existing_only:
            valid_tracks = []
            for t in tracks:
                p = t.get("path")
                if p:
                    try:
                        if Path(p).is_file():
                            valid_tracks.append(t)
                    except Exception:
                        pass
            tracks = valid_tracks

        tracks.sort(key=lambda t: (t.get("play_count", 0), t.get("last_played", 0)), reverse=True)
        return tracks[:limit] if (limit and limit > 0) else tracks

    def prune_missing_files(self) -> int:
        """Nettoie l'historique des écoutes en supprimant les entrées de fichiers n'existant plus sur le disque."""
        keys_to_remove = []
        for k, v in self._cache.items():
            p = v.get("path")
            if p:
                try:
                    if not Path(p).is_file():
                        keys_to_remove.append(k)
                except Exception:
                    keys_to_remove.append(k)
            else:
                keys_to_remove.append(k)

        if keys_to_remove:
            for k in keys_to_remove:
                self._cache.pop(k, None)
            self._save()
            logger.info(f"Playback stats : {len(keys_to_remove)} piste(s) supprimée(s) du disque retirée(s) de l'historique.")
        return len(keys_to_remove)

    def remap_album_paths(self, old_dir: str | Path, new_dir: str | Path) -> int:
        """Remappe les chemins des pistes dans l'historique lors d'un renommage de dossier d'album."""
        try:
            old_str = str(Path(old_dir).resolve()).lower().rstrip("\\/")
            new_p = Path(new_dir).resolve()
            new_str = str(new_p).rstrip("\\/")
        except Exception:
            old_str = str(old_dir).lower().rstrip("\\/")
            new_str = str(new_dir).rstrip("\\/")

        if old_str == str(new_str).lower():
            return 0

        updated_count = 0
        new_cache = {}
        for k, v in self._cache.items():
            orig_p = v.get("path")
            if orig_p:
                try:
                    norm_orig = str(Path(orig_p).resolve())
                except Exception:
                    norm_orig = str(orig_p)

                if norm_orig.lower().startswith(old_str):
                    sub_path = norm_orig[len(old_str):].lstrip("\\/")
                    remapped_path = str(new_p / sub_path)
                    v["path"] = remapped_path
                    try:
                        new_k = str(Path(remapped_path).resolve()).lower()
                    except Exception:
                        new_k = remapped_path.lower()
                    new_cache[new_k] = v
                    updated_count += 1
                    continue

            new_cache[k] = v

        if updated_count > 0:
            self._cache = new_cache
            self._save()
            logger.info(f"Playback stats : {updated_count} piste(s) remappée(s) de '{old_str}' vers '{new_str}'.")

        return updated_count

    def get_stats_summary(self) -> Dict[str, Any]:
        """Retourne un résumé global des écoutes."""
        total_plays = sum(t.get("play_count", 0) for t in self._cache.values())
        return {
            "unique_tracks": len(self._cache),
            "total_plays": total_plays
        }

playback_stats = PlaybackStatsManager()


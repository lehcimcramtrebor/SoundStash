"""
Module de Gestion des Playlists Utilisateur Mixtes (Audio + Vidéo) pour SoundStash.

Gère la création, persistance, édition, réordonnancement et suppression des playlists
personnalisées au format JSON dans CONFIG_DIR / 'playlists'.
Supporte nativement le mixage de pistes audio et de clips vidéo, le filtrage anti-doublon,
la génération de playlists intelligentes et l'attribution de pochettes thématiques.
"""

import os
import re
import json
import time
import random
import urllib.parse
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple

from backend.config import CONFIG_DIR
from backend.logger import get_logger
from backend.playback_stats import playback_stats

logger = get_logger(__name__)

PLAYLISTS_DIR = CONFIG_DIR / "playlists"

def _format_sec_to_time(seconds: float) -> str:
    """Formate des secondes en 'M:SS' ou 'H:MM:SS'."""
    if not seconds or seconds < 0:
        return "0:00"
    total_sec = int(round(seconds))
    hrs = total_sec // 3600
    mins = (total_sec % 3600) // 60
    secs = total_sec % 60
    if hrs > 0:
        return f"{hrs}:{mins:02d}:{secs:02d}"
    return f"{mins}:{secs:02d}"

def _parse_duration_to_sec(val: Any) -> float:
    """Convertit une durée (secondes int/float ou chaîne 'M:SS'/'H:MM:SS') en secondes (float)."""
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val) if val >= 0 else 0.0
    s = str(val).strip()
    if not s:
        return 0.0
    if ":" in s:
        parts = s.split(":")
        try:
            if len(parts) == 2:
                return float(int(parts[0]) * 60 + float(parts[1]))
            elif len(parts) == 3:
                return float(int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2]))
        except Exception:
            return 0.0
    try:
        return max(0.0, float(s))
    except (ValueError, TypeError):
        return 0.0

class PlaylistManager:
    """Gestionnaire central des playlists utilisateur."""

    def __init__(self):
        self.playlists_dir = PLAYLISTS_DIR
        self._ensure_dir()

    def _ensure_dir(self):
        try:
            self.playlists_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            logger.warning(f"Impossible de créer le dossier playlists : {e}")

    def _get_playlist_path(self, playlist_id: str) -> Path:
        safe_id = re.sub(r'[^a-zA-Z0-9_\-]', '', playlist_id)
        return self.playlists_dir / f"{safe_id}.json"

    def list_playlists(self) -> List[Dict[str, Any]]:
        """Retourne la liste résumée de toutes les playlists existantes."""
        self._ensure_dir()
        results = []
        if not self.playlists_dir.exists():
            return results

        for p_file in self.playlists_dir.glob("*.json"):
            try:
                with open(p_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                
                items = data.get("items", [])
                audio_count = sum(1 for it in items if it.get("type") == "audio")
                video_count = sum(1 for it in items if it.get("type") == "video")
                total_duration = sum(_parse_duration_to_sec(it.get("duration") or it.get("duration_seconds")) for it in items)

                cover_url = data.get("cover_url")
                if not cover_url and items:
                    for it in items:
                        cov = it.get("cover_url") or it.get("thumbnail_url")
                        if cov:
                            cover_url = cov
                            break

                results.append({
                    "id": data.get("id", p_file.stem),
                    "name": data.get("name", "Sans titre"),
                    "description": data.get("description", ""),
                    "track_count": len(items),
                    "items_count": len(items),
                    "audio_count": audio_count,
                    "video_count": video_count,
                    "total_duration": total_duration,
                    "total_duration_str": _format_sec_to_time(total_duration),
                    "cover_url": cover_url,
                    "cover_collage": cover_url,
                    "is_smart": data.get("is_smart", False),
                    "smart_type": data.get("smart_type"),
                    "created_at": data.get("created_at", int(time.time())),
                    "updated_at": data.get("updated_at", int(time.time()))
                })
            except Exception as e:
                logger.warning(f"Erreur lecture playlist {p_file.name}: {e}")

        # Trier par date de modification décroissante
        results.sort(key=lambda p: p.get("updated_at", 0), reverse=True)
        return results

    def get_playlist(self, playlist_id: str) -> Optional[Dict[str, Any]]:
        """Retourne le contenu exhaustif d'une playlist avec ses pistes."""
        p_file = self._get_playlist_path(playlist_id)
        if not p_file.exists():
            return None

        try:
            with open(p_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            items = data.get("items", [])
            for it in items:
                if not it.get("path"):
                    cand = it.get("filepath") or it.get("rel_path")
                    if not cand and (it.get("thumbnail_url") or it.get("cover_url")):
                        target = it.get("thumbnail_url") or it.get("cover_url") or ""
                        if "path=" in target:
                            try:
                                cand = urllib.parse.unquote(target.split("path=")[1].split("&")[0])
                            except Exception:
                                pass
                    if cand:
                        it["path"] = cand

                dur = _parse_duration_to_sec(it.get("duration") or it.get("duration_seconds"))
                if not it.get("duration_str"):
                    it["duration_str"] = _format_sec_to_time(dur)

            audio_count = sum(1 for it in items if it.get("type") == "audio")
            video_count = sum(1 for it in items if it.get("type") == "video")
            total_duration = sum(_parse_duration_to_sec(it.get("duration") or it.get("duration_seconds")) for it in items)

            data["track_count"] = len(items)
            data["items_count"] = len(items)
            data["audio_count"] = audio_count
            data["video_count"] = video_count
            data["total_duration"] = total_duration
            data["total_duration_str"] = _format_sec_to_time(total_duration)


            cov = data.get("cover_url")
            if not cov and items:
                for it in items:
                    c = it.get("cover_url") or it.get("thumbnail_url")
                    if c:
                        cov = c
                        break
            data["cover_url"] = cov
            data["cover_collage"] = cov

            return data
        except Exception as e:
            logger.error(f"Erreur lecture playlist {playlist_id}: {e}")
            return None

    def create_playlist(self, name: str, description: str = "", items: Optional[List[Dict[str, Any]]] = None, cover_url: Optional[str] = None, is_smart: bool = False, smart_type: Optional[str] = None, smart_criteria: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Crée une nouvelle playlist et l'enregistre sur disque."""
        self._ensure_dir()
        pl_id = f"pl_{int(time.time() * 1000)}"
        clean_name = name.strip() if name and name.strip() else "Nouvelle Playlist"
        
        now = int(time.time())
        processed_items = []
        if items:
            for idx, it in enumerate(items):
                it_copy = dict(it)
                if not it_copy.get("id"):
                    it_copy["id"] = f"item_{now}_{idx}"
                processed_items.append(it_copy)

        resolved_cover = cover_url.strip() if cover_url and cover_url.strip() else None
        if not resolved_cover:
            for it in processed_items:
                if it.get("cover_url"):
                    resolved_cover = it.get("cover_url")
                    break
                if it.get("thumbnail_url"):
                    resolved_cover = it.get("thumbnail_url")
                    break

        data = {
            "id": pl_id,
            "name": clean_name,
            "description": description.strip() if description else "",
            "created_at": now,
            "updated_at": now,
            "cover_url": resolved_cover,
            "is_smart": is_smart,
            "smart_type": smart_type,
            "smart_criteria": smart_criteria or {},
            "items": processed_items
        }

        p_file = self._get_playlist_path(pl_id)
        with open(p_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        logger.info(f"Playlist créée : '{clean_name}' ({pl_id}) avec {len(processed_items)} pistes (cover: {resolved_cover})")
        return self.get_playlist(pl_id) or data

    def update_playlist(self, playlist_id: str, name: Optional[str] = None, description: Optional[str] = None, items: Optional[List[Dict[str, Any]]] = None, cover_url: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Met à jour les métadonnées ou le contenu d'une playlist."""
        data = self.get_playlist(playlist_id)
        if not data:
            return None

        now = int(time.time())
        if name is not None and name.strip():
            data["name"] = name.strip()
        if description is not None:
            data["description"] = description.strip()
        if cover_url is not None:
            data["cover_url"] = cover_url.strip() if cover_url.strip() else None

        if items is not None:
            processed = []
            for idx, it in enumerate(items):
                it_copy = dict(it)
                if not it_copy.get("id"):
                    it_copy["id"] = f"item_{now}_{idx}"
                processed.append(it_copy)
            data["items"] = processed

            # Mettre à jour la cover par défaut si aucune cover explicite n'était configurée
            if not data.get("cover_url"):
                auto_cover = None
                for it in data["items"]:
                    if it.get("cover_url"):
                        auto_cover = it.get("cover_url")
                        break
                    if it.get("thumbnail_url"):
                        auto_cover = it.get("thumbnail_url")
                        break
                data["cover_url"] = auto_cover

        data["updated_at"] = now
        p_file = self._get_playlist_path(playlist_id)
        with open(p_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        logger.info(f"Playlist mise à jour : '{data['name']}' ({playlist_id})")
        return self.get_playlist(playlist_id)

    def update_cover(self, playlist_id: str, cover_url: str) -> Optional[Dict[str, Any]]:
        """Attribue ou remplace la pochette personnalisée d'une playlist."""
        return self.update_playlist(playlist_id, cover_url=cover_url)

    def delete_playlist(self, playlist_id: str) -> bool:
        """Supprime une playlist utilisateur."""
        p_file = self._get_playlist_path(playlist_id)
        if p_file.exists():
            try:
                p_file.unlink()
                logger.info(f"Playlist supprimée : {playlist_id}")
                return True
            except Exception as e:
                logger.error(f"Erreur suppression playlist {playlist_id}: {e}")
                return False
        return False

    def add_items(self, playlist_id: str, new_items: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Ajoute une ou plusieurs pistes (audio ou vidéo) à une playlist existante, en filtrant strictement les doublons."""
        data = self.get_playlist(playlist_id)
        if not data:
            return {
                "success": False,
                "message": "Playlist introuvable",
                "added_count": 0,
                "duplicates_count": 0,
                "playlist": None
            }

        items = data.get("items", [])
        now = int(time.time())
        added_count = 0
        duplicates_count = 0
        rejected_concerts_count = 0

        # Indexer les pistes existantes pour recherche O(1)
        existing_paths = set()
        existing_signatures = set()
        for it in items:
            p = it.get("path")
            if p:
                try:
                    existing_paths.add(str(Path(p).resolve()).lower())
                except Exception:
                    existing_paths.add(str(p).lower())
            art = (it.get("artist") or "").strip().lower()
            tit = (it.get("title") or "").strip().lower()
            if art and tit:
                existing_signatures.add((art, tit))

        for idx, it in enumerate(new_items):
            it_path = it.get("path") or it.get("filepath") or it.get("rel_path")
            if not it_path and (it.get("thumbnail_url") or it.get("cover_url")):
                target = it.get("thumbnail_url") or it.get("cover_url") or ""
                if "path=" in target:
                    try:
                        it_path = urllib.parse.unquote(target.split("path=")[1].split("&")[0])
                    except Exception:
                        pass

            norm_path = ""
            if it_path:
                try:
                    norm_path = str(Path(it_path).resolve()).lower()
                except Exception:
                    norm_path = str(it_path).lower()

            it_art = (it.get("artist") or "").strip().lower()
            it_tit = (it.get("title") or "").strip().lower()
            sig = (it_art, it_tit) if (it_art and it_tit) else None

            # Vérification anti-doublon stricte
            is_dup = False
            if norm_path and norm_path in existing_paths:
                is_dup = True
            elif sig and sig in existing_signatures:
                is_dup = True

            # Exclusion stricte des Concerts et Œuvres Longues des playlists
            if it.get("video_type") == "concert" or it.get("is_concert") or "/concerts/" in norm_path or "\\concerts\\" in norm_path:
                logger.info(f"🚫 Concert/Live exclu de la playlist : {it.get('title')}")
                rejected_concerts_count += 1
                continue

            if is_dup:
                duplicates_count += 1
                continue

            it_copy = dict(it)
            if it_path and not it_copy.get("path"):
                it_copy["path"] = it_path
            it_copy["id"] = f"item_{now}_{len(items) + idx}"
            items.append(it_copy)
            if norm_path: existing_paths.add(norm_path)
            if sig: existing_signatures.add(sig)
            added_count += 1

        # Mise à jour cover par défaut si aucune cover n'est définie
        if not data.get("cover_url") and items:
            for it in items:
                if it.get("cover_url"):
                    data["cover_url"] = it.get("cover_url")
                    break
                if it.get("thumbnail_url"):
                    data["cover_url"] = it.get("thumbnail_url")
                    break

        data["items"] = items
        data["updated_at"] = now
        data["track_count"] = len(items)
        data["items_count"] = len(items)
        data["audio_count"] = sum(1 for x in items if x.get("type") == "audio")
        data["video_count"] = sum(1 for x in items if x.get("type") == "video")
        total_duration = sum(_parse_duration_to_sec(x.get("duration") or x.get("duration_seconds")) for x in items)
        data["total_duration"] = total_duration
        data["total_duration_str"] = _format_sec_to_time(total_duration)

        p_file = self._get_playlist_path(playlist_id)
        with open(p_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        logger.info(f"{added_count} piste(s) ajoutée(s) ({duplicates_count} doublons ignorés) à la playlist '{data['name']}' ({playlist_id})")
        return {
            "success": True,
            "added_count": added_count,
            "duplicates_count": duplicates_count,
            "rejected_concerts_count": rejected_concerts_count,
            "playlist": self.get_playlist(playlist_id)
        }

    def remove_item(self, playlist_id: str, item_id: str) -> Optional[Dict[str, Any]]:
        """Retire une piste d'une playlist."""
        data = self.get_playlist(playlist_id)
        if not data:
            return None

        items = data.get("items", [])
        new_items = [it for it in items if str(it.get("id")) != str(item_id)]
        if len(new_items) == len(items):
            return data

        data["items"] = new_items
        data["updated_at"] = int(time.time())

        # Si la cover venait d'une pochette automatique et a disparu
        if not data.get("cover_url") or not str(data.get("cover_url", "")).startswith("/static/playlist_covers/"):
            cover_url = None
            for it in new_items:
                if it.get("cover_url"):
                    cover_url = it.get("cover_url")
                    break
                if it.get("thumbnail_url"):
                    cover_url = it.get("thumbnail_url")
                    break
            data["cover_url"] = cover_url

        p_file = self._get_playlist_path(playlist_id)
        with open(p_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        logger.info(f"Piste {item_id} retirée de la playlist '{data['name']}'")
        return self.get_playlist(playlist_id)

    def reorder_items(self, playlist_id: str, ordered_item_ids: List[str]) -> Optional[Dict[str, Any]]:
        """Réordonne les pistes d'une playlist selon la liste ordonnée des identifiants."""
        data = self.get_playlist(playlist_id)
        if not data:
            return None

        items = data.get("items", [])
        items_by_id = {str(it.get("id")): it for it in items}

        reordered = []
        for it_id in ordered_item_ids:
            if it_id in items_by_id:
                reordered.append(items_by_id[it_id])

        seen = set(ordered_item_ids)
        for it in items:
            if str(it.get("id")) not in seen:
                reordered.append(it)

        data["items"] = reordered
        data["updated_at"] = int(time.time())

        p_file = self._get_playlist_path(playlist_id)
        with open(p_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        return self.get_playlist(playlist_id)

    def _compute_smart_items(self, smart_type: str, criteria: Dict[str, Any], library_albums: List[Dict[str, Any]], video_indexer: Any = None) -> Tuple[List[Dict[str, Any]], str, Optional[str]]:
        """Calcule les pistes et métadonnées d'une playlist intelligente sans écriture disque."""
        limit = int(criteria.get("limit") or 50)
        cover_url = criteria.get("cover_url")
        selected_items = []

        def _extract_tracks_sample(candidate_albums: list, target_count: int = 80) -> list:
            """Extrait ultra-rapidement un échantillon ciblé de pistes sans bloquer sur l'ensemble de la bibliothèque."""
            sample_tracks = []
            shuffled_albs = list(candidate_albums)
            random.shuffle(shuffled_albs)

            for alb in shuffled_albs:
                if len(sample_tracks) >= target_count:
                    break
                if isinstance(alb, dict):
                    alb_title = alb.get("title", "") or alb.get("album", "")
                    alb_art = alb.get("artist", "")
                    alb_genre = alb.get("genre", "")
                    alb_year = alb.get("year")
                    alb_path = alb.get("path", "")
                    alb_tracks = alb.get("tracks", [])
                else:
                    alb_title = getattr(alb, "album", "") or getattr(alb, "title", "")
                    alb_art = getattr(alb, "artist", "")
                    alb_genre = getattr(alb, "genre", "")
                    alb_year = getattr(alb, "year", None)
                    alb_path = getattr(alb, "path", "")
                    alb_tracks = getattr(alb, "tracks", [])

                cov = f"/api/audio/cover?path={urllib.parse.quote(alb_path)}" if alb_path else None

                if not alb_tracks and alb_path:
                    try:
                        from backend.tagger import get_album_info
                        info = get_album_info(alb_path)
                        alb_tracks = info.get("tracks", []) if isinstance(info, dict) else []
                    except Exception:
                        alb_tracks = []

                for trk in (alb_tracks or []):
                    t_copy = dict(trk)
                    t_copy["type"] = "audio"
                    t_copy["album_title"] = alb_title
                    t_copy["album_path"] = alb_path
                    t_copy["album_genre"] = alb_genre
                    t_copy["album_year"] = alb_year
                    if not t_copy.get("cover_url"):
                        t_copy["cover_url"] = cov
                    if not t_copy.get("artist"):
                        t_copy["artist"] = alb_art
                    sample_tracks.append(t_copy)

            return sample_tracks

        # 2. Application de la logique intelligente par type
        if smart_type == "top_played":
            top_stats = playback_stats.get_top_played(limit=limit, genre=criteria.get("genre"))
            for s in top_stats:
                is_vid = s.get("type") == "video"
                p = s.get("path", "")
                if is_vid:
                    if "/concerts/" in p.lower() or "\\concerts\\" in p.lower() or s.get("duration", 0) >= 1200:
                        continue
                    thumb = f"/api/videos/thumbnail?path={urllib.parse.quote(p)}" if p else "/static/placeholder-cover.svg"
                    selected_items.append({
                        "type": "video",
                        "title": s.get("title", "Clip Vidéo"),
                        "artist": s.get("artist", "Artiste"),
                        "album_title": s.get("album", "Clip Vidéo"),
                        "path": p,
                        "duration_seconds": s.get("duration", 0),
                        "thumbnail_url": thumb,
                        "cover_url": thumb
                    })
                else:
                    cov = f"/api/audio/cover?path={urllib.parse.quote(p)}" if p else "/static/placeholder-cover.svg"
                    selected_items.append({
                        "type": "audio",
                        "title": s.get("title", "Titre"),
                        "artist": s.get("artist", "Artiste"),
                        "album_title": s.get("album", ""),
                        "path": p,
                        "duration_seconds": s.get("duration", 0),
                        "cover_url": cov
                    })
            # Si pas assez d'historique, compléter avec un échantillon de la bibliothèque
            if len(selected_items) < limit and library_albums:
                sample = _extract_tracks_sample(library_albums, target_count=(limit - len(selected_items)) * 3)
                top_paths = {it.get("path") for it in selected_items if it.get("path")}
                remaining = [t for t in sample if t.get("path") not in top_paths]
                random.shuffle(remaining)
                selected_items.extend(remaining[:limit - len(selected_items)])

        elif smart_type == "genres":
            target_genres = [g.strip().lower() for g in criteria.get("genres", []) if g and g.strip()]
            candidate_albs = []
            for a in library_albums:
                g = (a.get("genre") if isinstance(a, dict) else getattr(a, "genre", "")) or ""
                if any(tg in g.lower() for tg in target_genres):
                    candidate_albs.append(a)
            if not candidate_albs:
                candidate_albs = library_albums
            sample = _extract_tracks_sample(candidate_albs, target_count=limit * 3)
            matched = []
            for t in sample:
                t_g = (t.get("genre") or t.get("album_genre") or "").lower()
                if not target_genres or any(tg in t_g for tg in target_genres):
                    matched.append(t)
            random.shuffle(matched)
            selected_items = matched[:limit]

        elif smart_type == "top_genres":
            target_genres = [g.strip().lower() for g in criteria.get("genres", []) if g and g.strip()]
            top_stats = playback_stats.get_top_played(limit=limit * 2)
            for s in top_stats:
                if any(tg in (s.get("genre") or "").lower() for tg in target_genres):
                    cov = f"/api/audio/cover?path={urllib.parse.quote(s.get('path'))}" if s.get("path") else "/static/placeholder-cover.svg"
                    selected_items.append({
                        "type": "audio",
                        "title": s.get("title", "Titre"),
                        "artist": s.get("artist", "Artiste"),
                        "album_title": s.get("album", ""),
                        "path": s.get("path", ""),
                        "duration_seconds": s.get("duration", 0),
                        "cover_url": cov
                    })
            if len(selected_items) < limit and library_albums:
                candidate_albs = [a for a in library_albums if any(tg in ((a.get("genre") if isinstance(a, dict) else getattr(a, "genre", "")) or "").lower() for tg in target_genres)] or library_albums
                sample = _extract_tracks_sample(candidate_albs, target_count=limit * 3)
                seen_paths = {it.get("path") for it in selected_items}
                other_matched = [t for t in sample if t.get("path") not in seen_paths]
                random.shuffle(other_matched)
                selected_items.extend(other_matched[:limit - len(selected_items)])

        elif smart_type == "random_mix":
            sample = _extract_tracks_sample(library_albums, target_count=limit * 2)
            random.shuffle(sample)
            selected_items = sample[:limit]

        elif smart_type == "decade":
            target_dec = int(criteria.get("decade") or 1980)
            candidate_albs = []
            for a in library_albums:
                try:
                    y = int((a.get("year") if isinstance(a, dict) else getattr(a, "year", 0)) or 0)
                    if target_dec <= y <= target_dec + 9:
                        candidate_albs.append(a)
                except Exception:
                    pass
            if not candidate_albs:
                candidate_albs = library_albums
            sample = _extract_tracks_sample(candidate_albs, target_count=limit * 3)
            dec_tracks = []
            for t in sample:
                try:
                    y = int(t.get("year") or t.get("album_year") or 0)
                    if target_dec <= y <= target_dec + 9:
                        dec_tracks.append(t)
                except Exception:
                    pass
            if not dec_tracks:
                dec_tracks = sample
            random.shuffle(dec_tracks)
            selected_items = dec_tracks[:limit]

        elif smart_type == "unplayed":
            sample = _extract_tracks_sample(library_albums, target_count=limit * 3)
            stats_cache = playback_stats._cache
            unplayed = [t for t in sample if t.get("path") not in stats_cache or stats_cache[t.get("path")].get("play_count", 0) == 0]
            if not unplayed:
                unplayed = sample
            random.shuffle(unplayed)
            selected_items = unplayed[:limit]

        elif smart_type == "videos_mix" and video_indexer:
            # Clips vidéo 16:9 uniquement (exclusion des concerts)
            all_videos = video_indexer.get_all_videos() if hasattr(video_indexer, "get_all_videos") else []
            v_items = []
            for v in all_videos:
                if v.get("video_type") == "concert" or v.get("is_concert"):
                    continue
                v_items.append({
                    "id": f"vid_{int(time.time())}_{len(v_items)}",
                    "type": "video",
                    "title": v.get("title", ""),
                    "artist": v.get("artist", ""),
                    "album_title": "Clip Vidéo 16:9",
                    "duration": v.get("duration", 0),
                    "duration_str": v.get("duration_str", "0:00"),
                    "path": v.get("path", ""),
                    "cover_url": v.get("thumbnail_url") or "/static/placeholder-cover.svg"
                })
            random.shuffle(v_items)
            selected_items = v_items[:limit]

        desc = criteria.get("description") or f"Playlist intelligente générée ({smart_type}) • {len(selected_items)} titres"

        # Déterminer la pochette par défaut selon le type si aucune n'a été spécifiée
        if not cover_url:
            SMART_COVERS = {
                "top_played": "/static/playlist_covers/vintage_vinyl.svg",
                "genres": "/static/playlist_covers/instrument_guitar.svg",
                "top_genres": "/static/playlist_covers/synthwave_sunset.svg",
                "random_mix": "/static/playlist_covers/vintage_boombox.svg",
                "decade": "/static/playlist_covers/vintage_cassette.svg",
                "unplayed": "/static/playlist_covers/ambient_galaxy.svg",
                "videos_mix": "/static/playlist_covers/cinema_clapperboard.svg"
            }
            cover_url = SMART_COVERS.get(smart_type)

        return selected_items, desc, cover_url

    def generate_smart_playlist(self, name: str, smart_type: str, criteria: Dict[str, Any], library_albums: List[Dict[str, Any]], video_indexer: Any = None) -> Dict[str, Any]:
        """Génère automatiquement une playlist intelligente basée sur des critères dynamiques."""
        selected_items, desc, cover_url = self._compute_smart_items(
            smart_type=smart_type,
            criteria=criteria,
            library_albums=library_albums,
            video_indexer=video_indexer
        )
        return self.create_playlist(
            name=name,
            description=desc,
            items=selected_items,
            cover_url=cover_url,
            is_smart=True,
            smart_type=smart_type,
            smart_criteria=criteria
        )

    def get_preset_covers(self) -> List[Dict[str, Any]]:
        """Retourne la liste des pochettes thématiques vectorielles disponibles."""
        covers_dir = Path(__file__).resolve().parent.parent / "frontend" / "playlist_covers"
        results = []
        if not covers_dir.exists():
            return results

        META = {
            "retrogaming_arcade.svg": ("Arcade 80s", "retrogaming", "🕹️"),
            "retrogaming_cartridge.svg": ("Cartouche 16-Bit", "retrogaming", "🕹️"),
            "retrogaming_controller.svg": ("Manette Rétro Classic", "retrogaming", "🕹️"),
            "gaming_modern.svg": ("Gamepad Cyber Néon", "gaming", "🎮"),
            "gaming_headset.svg": ("Casque Gamer RGB", "gaming", "🎮"),
            "eight_bit_handheld.svg": ("Console 8-Bit Portable", "eight_bit", "👾"),
            "eight_bit_pixel_heart.svg": ("Pixel Art 8-Bit Life", "eight_bit", "👾"),
            "cinema_clapperboard.svg": ("Clap Cinéma 35mm", "cinema", "🎬"),
            "cinema_projector.svg": ("Projecteur Salle Obscure", "cinema", "🎬"),
            "cinema_orchestra.svg": ("Grand Orchestre B.O.", "cinema", "🎬"),
            "cinema_scifi.svg": ("Space Sci-Fi Thriller", "cinema", "🎬"),
            "instrument_guitar.svg": ("Guitare Électrique Neon", "instruments", "🎸"),
            "instrument_synth.svg": ("Synthétiseur Analogique 80s", "instruments", "🎸"),
            "instrument_saxophone.svg": ("Saxophone Jazz Club", "instruments", "🎸"),
            "vehicle_outrun.svg": ("Supercar Outrun Sunset", "vehicles", "🏎️"),
            "vehicle_cyber_bike.svg": ("Cyber Moto Cruising", "vehicles", "🏎️"),
            "synthwave_sunset.svg": ("Sunset Néon & Palmiers", "synthwave", "🌆"),
            "synthwave_grid.svg": ("Grille Wireframe 3D", "synthwave", "🌆"),
            "vintage_cassette.svg": ("Cassette Audio C60", "vintage", "📼"),
            "vintage_vinyl.svg": ("Disque Vinyle 33 Tours", "vintage", "📼"),
            "vintage_boombox.svg": ("Ghetto-Blaster 80s", "vintage", "📼"),
            "ambient_galaxy.svg": ("Nébuleuse Galaxie", "chill", "🌌"),
        }

        for f in sorted(covers_dir.glob("*.svg")):
            info = META.get(f.name, (f.stem.replace("_", " ").title(), "general", "🎵"))
            results.append({
                "id": f.name,
                "title": info[0],
                "category": info[1],
                "icon": info[2],
                "url": f"/static/playlist_covers/{f.name}"
            })
        return results

    def refresh_smart_playlist(self, playlist_id: str, library_albums: List[Dict[str, Any]], video_indexer: Any = None) -> Optional[Dict[str, Any]]:
        """Recalcule et met à jour le contenu d'une playlist intelligente existante selon les dernières écoutes et critères sans créer de doublon."""
        data = self.get_playlist(playlist_id)
        if not data:
            return None
        if not data.get("is_smart"):
            return data

        smart_type = data.get("smart_type") or "top_played"
        smart_criteria = data.get("smart_criteria", {})

        new_items, desc, _ = self._compute_smart_items(
            smart_type=smart_type,
            criteria=smart_criteria,
            library_albums=library_albums,
            video_indexer=video_indexer
        )
        data["items"] = new_items
        data["updated_at"] = int(time.time())

        p_file = self._get_playlist_path(playlist_id)
        with open(p_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        logger.info(f"Smart Playlist actualisée sur place (sans doublon) : '{data['name']}' ({playlist_id}) avec {len(new_items)} pistes")
        return self.get_playlist(playlist_id)


playlist_manager = PlaylistManager()

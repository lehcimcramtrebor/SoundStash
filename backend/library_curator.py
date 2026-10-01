import os
import re
import json
import shutil
import subprocess
from pathlib import Path
from typing import Optional, List, Dict, Any

from backend.config import config, KID3_CLI_PATH
from backend.logger import get_logger
from backend.library_indexer import (
    library_indexer, smart_matcher, normalize_text, AUDIO_EXTENSIONS, COVER_NAMES, DISC_SUBFOLDER_RE
)
from backend.ytm_client import browse_artist_discography, search_ytm_innertube, clean_artist_name
from backend.tagger import clean_track_title, _kid3_escape, parse_track_filename, consolidate_album_cover, safe_rmtree

logger = get_logger(__name__)

TOPIC_PATTERNS = [
    r"\s*[\-–—]\s*(?:topic|th[eè]me)\s*$",
    r"\s*[\(\[](?:topic|th[eè]me)[)\]]\s*$"
]

async def find_missing_albums_for_artist(artist_name: str, browse_id: Optional[str] = None) -> dict:
    """
    Compare la discographie officielle YouTube Music d'un artiste avec la collection locale
    pour identifier tous les albums manquants avec possibilité de complétion en 1 clic.
    """
    clean_artist = clean_artist_name(artist_name).strip()
    if not clean_artist:
        return {"error": "Nom d'artiste invalide", "missing_albums": [], "owned_albums": []}

    # 1. Si pas de browse_id fourni, rechercher la chaîne officielle de l'artiste
    if not browse_id:
        try:
            search_res = await search_ytm_innertube(clean_artist, filter_type="artists")
            items = search_res.get("results", [])
            for it in items:
                if it.get("type") == "artist" and it.get("id"):
                    browse_id = it["id"]
                    break
            # Fallback : premier résultat artiste
            if not browse_id and items:
                browse_id = items[0].get("id")
        except Exception as e:
            logger.warning(f"Erreur recherche browse_id pour '{clean_artist}': {e}")

    if not browse_id:
        return {
            "artist": clean_artist,
            "browse_id": None,
            "error": f"Impossible de localiser la fiche officielle pour '{clean_artist}'.",
            "missing_albums": [],
            "owned_albums": [],
            "total_official": 0,
            "owned_count": 0,
            "missing_count": 0
        }

    # 2. Récupérer la discographie officielle (100% authentique)
    try:
        discography = await browse_artist_discography(browse_id, clean_artist)
    except Exception as e:
        logger.error(f"Erreur récupération discographie pour '{clean_artist}': {e}", exc_info=True)
        return {
            "artist": clean_artist,
            "browse_id": browse_id,
            "error": f"Erreur lors du chargement de la discographie : {str(e)}",
            "missing_albums": [],
            "owned_albums": [],
            "total_official": 0,
            "owned_count": 0,
            "missing_count": 0
        }

    all_releases = discography.get("results", [])

    missing_albums = []
    owned_albums = []

    # 3. Comparaison croisée intelligente avec la bibliothèque
    for item in all_releases:
        title = item.get("title", "")
        # Vérification du statut via SmartMatcher
        match_info = smart_matcher.match_item(
            title=title,
            artist=clean_artist,
            item_type=item.get("type", "album")
        )
        status = match_info.get("status")
        
        item_entry = {
            "id": item.get("id"),
            "title": title,
            "artist": clean_artist,
            "year": item.get("year"),
            "thumbnail": item.get("thumbnail"),
            "url": item.get("url"),
            "type": item.get("type", "album"),
            "status": status,
            "badge_label": match_info.get("label"),
            "badge_class": match_info.get("badge_class"),
            "local_path": match_info.get("local_path")
        }

        if status in ("owned_library", "exported", "temp", "downloading", "queued"):
            owned_albums.append(item_entry)
        else:
            missing_albums.append(item_entry)

    logger.info(
        f"Gap Finder [{clean_artist}] : {len(all_releases)} sorties officielles trouvées "
        f"-> {len(owned_albums)} possédées, {len(missing_albums)} manquantes."
    )

    return {
        "artist": clean_artist,
        "browse_id": browse_id,
        "total_official": len(all_releases),
        "owned_count": len(owned_albums),
        "missing_count": len(missing_albums),
        "missing_albums": missing_albums,
        "owned_albums": owned_albums
    }


def audit_collection_health(library_dir: Optional[str] = None) -> dict:
    """
    Diagnostique les anomalies de métadonnées et de structure de la collection :
    1. Résidus YouTube Topic (- Topic, - Thème)
    2. Pochettes manquantes (aucun cover.jpg/folder.jpg)
    3. Incohérences de nommage d'artiste (ex: AC/DC et AC-DC)
    4. Numérotation ou tags manquants
    """
    target_dir = library_dir or config.library_dir or config.export_dir
    if not target_dir or not os.path.isdir(target_dir):
        return {"error": "Aucun dossier de collection spécifié ou accessible.", "issues": []}

    root_p = Path(target_dir)
    issues: List[Dict[str, Any]] = []
    scanned_albums_count = 0
    artists_found: Dict[str, List[str]] = {}

    issue_id_counter = 0
    checked_topic_paths: set = set()

    try:
        for dirpath, dirnames, filenames in os.walk(str(root_p)):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            folder_p = Path(dirpath)
            folder_name = folder_p.name

            # Détecter si ce dossier contient des sous-dossiers multi-disques (CD 1, CD 2, etc.)
            disc_subs = [folder_p / d for d in dirnames if DISC_SUBFOLDER_RE.match(d)]
            disc_audio_list = []
            disc_sub_names = []
            if disc_subs:
                # Éviter que os.walk ne descende dans CD 1 / CD 2 comme des albums séparés
                dirnames[:] = [d for d in dirnames if not DISC_SUBFOLDER_RE.match(d)]
                
                def disc_k(d: Path):
                    m = DISC_SUBFOLDER_RE.match(d.name)
                    return int(m.group(1)) if (m and m.group(1)) else 999
                disc_subs.sort(key=disc_k)

                for ds in disc_subs:
                    sub_aud = [f for f in ds.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS]
                    disc_sub_names.append(f"{ds.name} ({len(sub_aud)} pistes)")
                    disc_audio_list.extend(sub_aud)

            audio_files = [f for f in filenames if Path(f).suffix.lower() in AUDIO_EXTENSIONS]
            total_audio_count = len(audio_files) + len(disc_audio_list)
            if total_audio_count == 0:
                continue

            scanned_albums_count += 1

            # 1. Alerte de fractionnement multi-disques
            if disc_subs and len(disc_audio_list) > 0:
                issue_id_counter += 1
                issues.append({
                    "id": f"issue_{issue_id_counter}",
                    "type": "multidisc_fragmentation",
                    "severity": "warning",
                    "badge_label": "Multi-CDs",
                    "badge_class": "audit-badge-multidisc",
                    "target_path": str(folder_p),
                    "current_value": f"{len(disc_subs)} sous-dossiers : {', '.join(disc_sub_names)}",
                    "suggested_value": f"Aplatir en 1 dossier racine ({len(disc_audio_list)} pistes continues 01..{len(disc_audio_list):02d})",
                    "description": f"L'album '{folder_name}' est fractionné en {len(disc_subs)} disques distincts ({', '.join(d.name for d in disc_subs)}). Harmonisation en album continu standard."
                })

            # 2. Vérifier la pollution Topic dans le nom de dossier de l'album ou du dossier parent d'artiste
            targets_to_check = [folder_p]
            if len(folder_p.relative_to(root_p).parts) >= 2 and folder_p.parent != root_p:
                targets_to_check.append(folder_p.parent)

            for target in targets_to_check:
                if str(target) in checked_topic_paths:
                    continue
                name_to_check = target.name
                for pat in TOPIC_PATTERNS:
                    if re.search(pat, name_to_check, flags=re.IGNORECASE):
                        checked_topic_paths.add(str(target))
                        issue_id_counter += 1
                        cleaned_name = re.sub(pat, "", name_to_check, flags=re.IGNORECASE).strip()
                        issues.append({
                            "id": f"issue_{issue_id_counter}",
                            "type": "topic_pollution",
                            "severity": "warning",
                            "badge_label": "Suffixe Topic",
                            "badge_class": "audit-badge-topic",
                            "target_path": str(target),
                            "current_value": name_to_check,
                            "suggested_value": cleaned_name,
                            "description": f"Dossier pollué par le suffixe Topic : '{name_to_check}' -> '{cleaned_name}'"
                        })
                        break

            # 3. Vérifier la présence d'une pochette d'album
            has_cover = any(f.lower() in COVER_NAMES for f in filenames)
            if not has_cover and disc_subs:
                for ds in disc_subs:
                    if any(f.name.lower() in COVER_NAMES for f in ds.iterdir() if f.is_file()):
                        has_cover = True
                        break
            if not has_cover:
                issue_id_counter += 1
                issues.append({
                    "id": f"issue_{issue_id_counter}",
                    "type": "missing_cover",
                    "severity": "info",
                    "badge_label": "Pochette manquante",
                    "badge_class": "audit-badge-cover",
                    "target_path": str(folder_p),
                    "current_value": "Aucun cover.jpg / folder.jpg",
                    "suggested_value": "Télécharger ou extraire une cover haute résolution",
                    "description": f"L'album '{folder_name}' n'a pas d'image de pochette locale."
                })

            # 4. Vérifier les titres bruités dans les fichiers audio de l'album
            all_check_files = [(folder_p / af) for af in audio_files] + disc_audio_list
            for af_p in all_check_files:
                raw_stem = af_p.stem
                stem_no_num = re.sub(r"^(?:cd|disc)?\s*\d{1,2}\s*[-._]\s*", "", raw_stem, flags=re.IGNORECASE)
                stem_no_num = re.sub(r"^\d{1,3}\s*[\.\-–—]\s*", "", stem_no_num).strip()
                cleaned_title = clean_track_title(stem_no_num)
                if cleaned_title != stem_no_num and len(cleaned_title) >= 2:
                    issue_id_counter += 1
                    issues.append({
                        "id": f"issue_{issue_id_counter}",
                        "type": "noisy_title",
                        "severity": "info",
                        "badge_label": "Mention parasite",
                        "badge_class": "audit-badge-noise",
                        "target_path": str(af_p),
                        "current_value": stem_no_num,
                        "suggested_value": cleaned_title,
                        "description": f"Piste polluée par des mentions parasites : '{stem_no_num}' -> '{cleaned_title}'"
                    })

            # 4. Enregistrer l'artiste pour détecter les incohérences typographiques
            rel = folder_p.relative_to(root_p)
            if len(rel.parts) >= 2:
                art_name = rel.parts[-2].strip()
            elif " - " in folder_name:
                art_name = folder_name.split(" - ", 1)[0].strip()
            else:
                art_name = ""

            if art_name:
                norm_art = normalize_text(art_name)
                if norm_art:
                    if norm_art not in artists_found:
                        artists_found[norm_art] = []
                    if art_name not in artists_found[norm_art]:
                        artists_found[norm_art].append(art_name)

        # 4. Traiter les incohérences de nommage d'artiste
        for norm_art, variants in artists_found.items():
            if len(variants) > 1:
                # Plusieurs variantes typographiques pour le même artiste normalisé
                main_variant = max(variants, key=len)
                for var in variants:
                    if var != main_variant:
                        issue_id_counter += 1
                        issues.append({
                            "id": f"issue_{issue_id_counter}",
                            "type": "inconsistent_artist",
                            "severity": "warning",
                            "badge_label": "Graphie Artiste",
                            "badge_class": "audit-badge-artist",
                            "target_path": str(root_p / var),
                            "current_value": var,
                            "suggested_value": main_variant,
                            "description": f"Variation de graphie détectée : '{var}' vs '{main_variant}'"
                        })

    except Exception as e:
        logger.error(f"Erreur pendant l'audit de collection : {e}", exc_info=True)
        return {"success": False, "status": "error", "error": str(e), "issues": []}

    logger.info(f"Audit de collection : {scanned_albums_count} albums analysés, {len(issues)} anomalies détectées.")

    return {
        "success": True,
        "status": "success",
        "scanned_albums_count": scanned_albums_count,
        "issues_count": len(issues),
        "issues": issues
    }


def apply_harmonization_fixes(fixes: List[dict]) -> dict:
    """
    Applique de manière sécurisée les corrections sélectionnées par l'utilisateur.
    Chaque action est tracée et exécutée avec vérification préalable.
    """
    success_count = 0
    errors: List[str] = []

    for fix in fixes:
        fix_type = fix.get("type")
        target_path = fix.get("target_path")
        suggested = fix.get("suggested_value")

        if not target_path or not os.path.exists(target_path):
            continue

        p = Path(target_path)

        try:
            if fix_type == "topic_pollution" and p.is_dir() and suggested:
                new_path = p.parent / suggested
                if not new_path.exists():
                    p.rename(new_path)
                    success_count += 1
                    logger.info(f"Harmonisation [Topic Cleaned] : {p.name} -> {suggested}")
                elif new_path != p:
                    # Fusion intelligente si le dossier assaini existe déjà
                    for sub in p.iterdir():
                        dest = new_path / sub.name
                        if not dest.exists():
                            sub.rename(dest)
                    if not any(p.iterdir()):
                        p.rmdir()
                    success_count += 1
                    logger.info(f"Harmonisation [Topic Merged] : {p.name} fusionné dans {suggested}")
                else:
                    errors.append(f"Le dossier cible '{suggested}' est identique.")

            elif fix_type == "inconsistent_artist" and p.is_dir() and suggested:
                new_path = p.parent / suggested
                # Fusion des dossiers d'artiste si le dossier cible existe déjà
                if new_path.exists() and new_path != p:
                    for sub in p.iterdir():
                        dest = new_path / sub.name
                        if not dest.exists():
                            sub.rename(dest)
                    # Supprimer l'ancien dossier vide
                    if not any(p.iterdir()):
                        p.rmdir()
                    success_count += 1
                    logger.info(f"Harmonisation [Artist Merged] : {p.name} fusionné dans {suggested}")
                else:
                    p.rename(new_path)
                    success_count += 1
                    logger.info(f"Harmonisation [Artist Renamed] : {p.name} -> {suggested}")

            elif fix_type == "noisy_title" and p.is_file() and suggested:
                cmd = [
                    KID3_CLI_PATH,
                    "-c", f"set title \"{_kid3_escape(suggested)}\"",
                    "-c", "save",
                    str(p.resolve())
                ]
                subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=20)
                success_count += 1
                logger.info(f"Harmonisation [Title Cleaned] : {p.name} -> {suggested}")

            elif fix_type == "multidisc_fragmentation" and p.is_dir():
                disc_subs = [d for d in p.iterdir() if d.is_dir() and DISC_SUBFOLDER_RE.match(d.name)]
                def disc_k(d: Path):
                    m = DISC_SUBFOLDER_RE.match(d.name)
                    return int(m.group(1)) if (m and m.group(1)) else 999
                disc_subs.sort(key=disc_k)

                def audio_sort_k(f: Path):
                    num, _ = parse_track_filename(f.name)
                    return (0, num) if num is not None else (1, f.name.lower())

                all_disc_tracks = []
                for ds in disc_subs:
                    sub_aud = [f for f in ds.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS]
                    sub_aud.sort(key=audio_sort_k)
                    for f in sub_aud:
                        all_disc_tracks.append((ds, f))

                total_tracks = len(all_disc_tracks)
                if total_tracks == 0:
                    continue

                # S'assurer qu'une pochette existe à la racine
                target_cover = p / "cover.jpg"
                if not target_cover.exists():
                    for ds in disc_subs:
                        for f in ds.iterdir():
                            if f.is_file() and f.name.lower() in COVER_NAMES:
                                try:
                                    shutil.copy2(str(f), str(target_cover))
                                    break
                                except Exception:
                                    pass
                        if target_cover.exists():
                            break

                # Déplacer, renommer et retagger chaque piste en séquence 01..total
                for seq_num, (ds, af) in enumerate(all_disc_tracks, start=1):
                    num, raw_title = parse_track_filename(af.name)
                    clean_t = clean_track_title(raw_title)
                    if not clean_t:
                        clean_t = af.stem
                    clean_t = re.sub(r"^(?:cd|disc)?\s*\d{1,2}\s*[-._]\s*", "", clean_t, flags=re.IGNORECASE)
                    clean_t = re.sub(r"^\d{1,3}\s*[\.\-–—]\s*", "", clean_t).strip()
                    if not clean_t:
                        clean_t = f"Piste {seq_num}"

                    ext = af.suffix.lower()
                    new_filename = f"{seq_num:02d} {clean_t}{ext}"
                    dest_path = p / new_filename

                    # Déplacement vers la racine de l'album
                    if af != dest_path:
                        if dest_path.exists():
                            temp_dest = p / f"__temp_{seq_num:02d}_{clean_t}{ext}"
                            shutil.move(str(af), str(temp_dest))
                            shutil.move(str(temp_dest), str(dest_path))
                        else:
                            shutil.move(str(af), str(dest_path))

                    # Taguer avec Kid3 (piste, total, discnumber=1/1, titre)
                    if Path(KID3_CLI_PATH).exists():
                        try:
                            cmd = [
                                KID3_CLI_PATH,
                                "-c", f'set track "{seq_num}/{total_tracks}"',
                                "-c", 'set discnumber "1/1"',
                                "-c", f'set title "{_kid3_escape(clean_t)}"',
                                "-c", "save",
                                str(dest_path.resolve())
                            ]
                            subprocess.run(cmd, capture_output=True, text=True, timeout=20)
                        except Exception as e:
                            logger.warning(f"Erreur tag Kid3 sur '{dest_path.name}': {e}")

                # Nettoyer les fichiers résiduels et supprimer les sous-dossiers de disques
                for ds in disc_subs:
                    if ds.exists():
                        for rem_f in list(ds.iterdir()):
                            if rem_f.is_file():
                                if rem_f.suffix.lower() not in {".ini", ".db", ".m3u", ".m3u8", ".nfo", ".sfv", ".log", ".txt", ".jpg", ".png"}:
                                    try:
                                        shutil.move(str(rem_f), str(p / rem_f.name))
                                    except Exception:
                                        pass
                        safe_rmtree(ds)

                consolidate_album_cover(p)
                success_count += 1
                logger.info(f"Harmonisation [Multi-CD Flattened] : {p.name} aplati ({total_tracks} pistes, 01..{total_tracks:02d}).")

        except Exception as e:
            err_msg = f"Erreur application fix sur '{p.name}': {e}"
            logger.error(err_msg)
            errors.append(err_msg)

    # Réindexer la bibliothèque après modification
    library_indexer.scan(force=True)

    return {
        "success": len(errors) == 0,
        "success_count": success_count,
        "errors": errors
    }

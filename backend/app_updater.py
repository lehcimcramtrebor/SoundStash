"""
Module de détection et mise à jour applicative de SoundStash via GitHub Releases.
Dépôt officiel : https://github.com/lehcimcramtrebor/SoundStash
"""

import os
import sys
import re
import json
import asyncio
import logging
import subprocess
import webbrowser
from pathlib import Path
from typing import Dict, Any, Optional

import httpx

from backend.config import config, CONFIG_DIR, TEMP_DOWNLOAD_DIR

logger = logging.getLogger("soundstash_updater")

CURRENT_APP_VERSION = "3.2.1"
GITHUB_REPO = "lehcimcramtrebor/SoundStash"
GITHUB_API_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
GITHUB_RELEASES_URL = f"https://github.com/{GITHUB_REPO}/releases"

UPDATES_DIR = Path(config.temp_download_dir if config.temp_download_dir else TEMP_DOWNLOAD_DIR) / "updates"

_download_lock = asyncio.Lock()
_update_download_task: Optional[asyncio.Task] = None

_update_progress: Dict[str, Any] = {
    "status": "idle",       # "idle", "downloading", "completed", "error"
    "downloaded_bytes": 0,
    "total_bytes": 0,
    "percent": 0.0,
    "percentage": 0.0,
    "installer_path": "",
    "version": "",
    "error": ""
}

def parse_semver(ver_str: str) -> tuple:
    """Extrait un tuple de nombres (major, minor, patch) depuis une chaîne comme 'v3.2.0' ou '3.2.1-beta'."""
    clean = ver_str.strip().lstrip("vV")
    matches = re.findall(r'\d+', clean)
    if not matches:
        return (0, 0, 0)
    nums = [int(m) for m in matches[:3]]
    while len(nums) < 3:
        nums.append(0)
    return tuple(nums)

async def check_app_update(current_version: Optional[str] = None) -> Dict[str, Any]:
    """
    Interroge l'API GitHub pour récupérer la dernière release publiée.
    Compare sémantiquement avec la version locale.
    """
    local_version = current_version or CURRENT_APP_VERSION
    try:
        headers = {
            "User-Agent": f"SoundStash/{CURRENT_APP_VERSION}",
            "Accept": "application/vnd.github.v3+json"
        }
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(GITHUB_API_URL, headers=headers)
            if resp.status_code != 200:
                return {
                    "status": "error",
                    "error": f"GitHub API HTTP {resp.status_code}",
                    "current_version": local_version,
                    "update_available": False
                }
            data = resp.json()

        tag_name = data.get("tag_name", "").strip()
        remote_semver = parse_semver(tag_name)
        current_semver = parse_semver(local_version)

        update_available = (remote_semver > current_semver)

        # Recherche de l'asset d'installation Windows (.exe)
        assets = data.get("assets", [])
        installer_asset = None
        for a in assets:
            name = a.get("name", "").lower()
            if name.endswith(".exe") and ("setup" in name or "soundstash" in name):
                installer_asset = a
                break
        if not installer_asset and assets:
            for a in assets:
                if a.get("name", "").lower().endswith(".exe"):
                    installer_asset = a
                    break

        return {
            "status": "success",
            "update_available": update_available,
            "current_version": local_version,
            "latest_version": tag_name.lstrip("vV"),
            "latest_tag": tag_name,
            "release_name": data.get("name") or f"SoundStash {tag_name}",
            "release_notes": data.get("body", ""),
            "html_url": data.get("html_url") or GITHUB_RELEASES_URL,
            "published_at": data.get("published_at", ""),
            "download_url": installer_asset.get("browser_download_url") if installer_asset else "",
            "asset_name": installer_asset.get("name") if installer_asset else "",
            "asset_size": installer_asset.get("size", 0) if installer_asset else 0,
            "has_installer": bool(installer_asset)
        }
    except Exception as e:
        logger.warning(f"Erreur vérification mise à jour SoundStash: {e}")
        return {
            "status": "error",
            "error": str(e),
            "current_version": local_version,
            "update_available": False
        }

async def start_download_update(download_url: str, asset_name: str, version: str) -> Dict[str, Any]:
    """Télécharge le fichier d'installation en tâche de fond avec suivi de progression."""
    global _update_progress, _update_download_task

    if _update_progress["status"] == "downloading":
        return {"status": "already_downloading", "progress": _update_progress}

    UPDATES_DIR.mkdir(parents=True, exist_ok=True)
    target_file = UPDATES_DIR / (asset_name or f"SoundStash-Setup-{version}.exe")

    _update_progress = {
        "status": "downloading",
        "downloaded_bytes": 0,
        "total_bytes": 0,
        "percent": 0.0,
        "percentage": 0.0,
        "installer_path": str(target_file.resolve()),
        "version": version,
        "error": ""
    }

    async def _download_worker():
        try:
            headers = {"User-Agent": f"SoundStash/{CURRENT_APP_VERSION}"}
            async with httpx.AsyncClient(timeout=180.0, follow_redirects=True) as client:
                async with client.stream("GET", download_url, headers=headers) as resp:
                    if resp.status_code != 200:
                        raise Exception(f"HTTP {resp.status_code} lors du téléchargement de l'exécutable")

                    total = int(resp.headers.get("content-length", 0))
                    _update_progress["total_bytes"] = total
                    downloaded = 0

                    with open(target_file, "wb") as f:
                        async for chunk in resp.aiter_bytes(chunk_size=65536):
                            if not chunk:
                                continue
                            f.write(chunk)
                            downloaded += len(chunk)
                            _update_progress["downloaded_bytes"] = downloaded
                            if total > 0:
                                p = round((downloaded / total) * 100, 1)
                                _update_progress["percent"] = p
                                _update_progress["percentage"] = p

            _update_progress["status"] = "completed"
            _update_progress["percent"] = 100.0
            _update_progress["percentage"] = 100.0
            logger.info(f"Téléchargement mise à jour réussi : {target_file}")
        except Exception as e:
            logger.error(f"Erreur téléchargement mise à jour : {e}")
            _update_progress["status"] = "error"
            _update_progress["error"] = str(e)

    _update_download_task = asyncio.create_task(_download_worker())
    return {"status": "started", "progress": _update_progress}

def get_download_progress() -> Dict[str, Any]:
    return _update_progress

def launch_installer(installer_path: Optional[str] = None) -> Dict[str, Any]:
    """Exécute l'installeur téléchargé et prépare l'arrêt propre de SoundStash."""
    path_to_run = installer_path or _update_progress.get("installer_path")
    if not path_to_run or not os.path.isfile(path_to_run):
        return {"success": False, "status": "error", "error": "Fichier d'installation introuvable sur le disque"}

    try:
        DETACHED_PROCESS = 0x00000008
        subprocess.Popen([path_to_run], creationflags=DETACHED_PROCESS, close_fds=True)
        return {"success": True, "status": "success", "message": "Installeur lancé avec succès"}
    except Exception as e:
        logger.error(f"Erreur lancement installeur {path_to_run}: {e}")
        return {"success": False, "status": "error", "error": str(e)}

def open_release_in_browser(url: Optional[str] = None) -> Dict[str, Any]:
    """Ouvre l'URL de la release GitHub dans le navigateur Web de l'utilisateur."""
    target_url = url or GITHUB_RELEASES_URL
    try:
        webbrowser.open(target_url)
        return {"status": "success", "url": target_url}
    except Exception as e:
        logger.error(f"Erreur ouverture navigateur pour {target_url}: {e}")
        return {"status": "error", "error": str(e)}

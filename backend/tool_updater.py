import subprocess
import asyncio
import logging
import time
import json
from pathlib import Path
from typing import Dict, Any, Optional

from backend.config import YT_DLP_PATH, CONFIG_DIR

logger = logging.getLogger("ytm_tool_updater")

YT_DLP_UPDATE_STATE_FILE = CONFIG_DIR / "yt_dlp_update_state.json"

_update_lock = asyncio.Lock()
_is_updating = False

def get_yt_dlp_version() -> str:
    """Récupère la version actuelle de yt-dlp."""
    try:
        res = subprocess.run(
            [YT_DLP_PATH, "--version"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False
        )
        if res.returncode == 0:
            return res.stdout.strip()
    except Exception as e:
        logger.warning(f"Impossible de lire la version de yt-dlp: {e}")
    return "Inconnue"

def load_update_state() -> Dict[str, Any]:
    if YT_DLP_UPDATE_STATE_FILE.exists():
        try:
            with open(YT_DLP_UPDATE_STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "last_check_timestamp": 0,
        "last_check_status": "Jamais vérifié",
        "last_version": None
    }

def save_update_state(state: Dict[str, Any]):
    try:
        YT_DLP_UPDATE_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(YT_DLP_UPDATE_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.warning(f"Impossible de sauvegarder l'état de mise à jour: {e}")

def get_yt_dlp_status() -> Dict[str, Any]:
    state = load_update_state()
    current_ver = get_yt_dlp_version()
    last_check_ts = state.get("last_check_timestamp", 0)
    last_check_date = time.strftime("%d/%m/%Y %H:%M", time.localtime(last_check_ts)) if last_check_ts > 0 else "Jamais"
    return {
        "path": YT_DLP_PATH,
        "version": current_ver,
        "last_check_timestamp": last_check_ts,
        "last_check_date": last_check_date,
        "last_check_status": state.get("last_check_status", "Prêt"),
        "is_updating": _is_updating
    }

async def update_yt_dlp(force: bool = False) -> Dict[str, Any]:
    global _is_updating
    if _is_updating:
        return {
            "success": False,
            "message": "Une vérification ou mise à jour de yt-dlp est déjà en cours."
        }

    async with _update_lock:
        _is_updating = True
        old_version = get_yt_dlp_version()
        state = load_update_state()
        try:
            logger.info("Démarrage de la vérification de mise à jour yt-dlp...")
            loop = asyncio.get_running_loop()

            def run_update():
                return subprocess.run(
                    [YT_DLP_PATH, "-U"],
                    capture_output=True,
                    text=True,
                    timeout=90,
                    check=False
                )

            res = await loop.run_in_executor(None, run_update)
            output = (res.stdout or "") + (res.stderr or "")
            new_version = get_yt_dlp_version()

            was_updated = (res.returncode == 0 and ("Updated" in output or "Updating to" in output or (new_version != old_version and new_version != "Inconnue")))
            is_up_to_date = "is up to date" in output.lower() or "latest version" in output.lower()

            if was_updated:
                status_msg = f"Mis à jour vers {new_version}"
                logger.info(f"yt-dlp mis à jour avec succès : {old_version} -> {new_version}")
            elif is_up_to_date:
                status_msg = f"À jour ({new_version})"
                logger.info(f"yt-dlp est déjà à jour ({new_version})")
            elif res.returncode == 0:
                status_msg = f"Vérifié ({new_version})"
            else:
                status_msg = f"Erreur code {res.returncode}"
                logger.warning(f"Erreur mise à jour yt-dlp: {output}")

            state["last_check_timestamp"] = int(time.time())
            state["last_check_status"] = status_msg
            state["last_version"] = new_version
            save_update_state(state)

            return {
                "success": res.returncode == 0,
                "updated": was_updated,
                "is_up_to_date": is_up_to_date,
                "old_version": old_version,
                "new_version": new_version,
                "output": output.strip(),
                "status_msg": status_msg
            }
        except subprocess.TimeoutExpired:
            logger.error("Délai d'attente dépassé (timeout) lors de la mise à jour de yt-dlp.")
            state["last_check_status"] = "Délai dépassé (timeout réseau)"
            save_update_state(state)
            return {
                "success": False,
                "message": "Délai réseau dépassé lors de la vérification de yt-dlp."
            }
        except Exception as e:
            logger.error(f"Exception lors de la mise à jour yt-dlp: {e}")
            state["last_check_status"] = f"Erreur: {str(e)[:50]}"
            save_update_state(state)
            return {
                "success": False,
                "message": f"Erreur lors de la mise à jour : {str(e)}"
            }
        finally:
            _is_updating = False

async def background_startup_check(cooldown_seconds: int = 86400):
    """
    Vérification asynchrone au démarrage de l'app :
    - Attend 8 secondes après le lancement pour libérer complètement le CPU et le réseau lors du boot
    - Vérifie le cooldown de 24h
    - Met à jour yt-dlp en arrière-plan sans bloquer
    """
    try:
        await asyncio.sleep(8)
        state = load_update_state()
        last_check = state.get("last_check_timestamp", 0)
        now = int(time.time())
        if (now - last_check) < cooldown_seconds:
            logger.info(f"Vérification yt-dlp ignorée (dernier check il y a {(now - last_check) // 3600}h, cooldown {cooldown_seconds // 3600}h)")
            return

        logger.info("Vérification planifiée de yt-dlp en arrière-plan...")
        res = await update_yt_dlp(force=False)
        if res.get("updated"):
            logger.info(f"✨ Auto-Update yt-dlp terminé : {res.get('new_version')}")
    except Exception as e:
        logger.debug(f"Vérification yt-dlp en tâche de fond ignorée ou échouée: {e}")

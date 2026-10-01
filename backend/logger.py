"""
Module de logging centralisé pour SoundStash.
Écrit dans logs/soundstash.log (fichiers tournants, max 5 Mo × 3 fichiers).
Usage dans n'importe quel module backend :
    from backend.logger import get_logger
    logger = get_logger(__name__)
    logger.info("message")
    logger.warning("attention")
    logger.error("erreur", exc_info=True)  # inclut la traceback
"""
import os
import logging
import logging.handlers
from pathlib import Path

# Résolution du dossier de logs : priorité à SOUNDSTASH_LOG_DIR, puis STASH_LOG_DIR, puis YTM_LOG_DIR, puis PROJECT_ROOT/logs
if os.environ.get("SOUNDSTASH_LOG_DIR"):
    _LOG_DIR = Path(os.environ["SOUNDSTASH_LOG_DIR"]).resolve()
elif os.environ.get("STASH_LOG_DIR"):
    _LOG_DIR = Path(os.environ["STASH_LOG_DIR"]).resolve()
elif os.environ.get("YTM_LOG_DIR"):
    _LOG_DIR = Path(os.environ["YTM_LOG_DIR"]).resolve()
elif os.environ.get("SOUNDSTASH_PROJECT_ROOT"):
    _LOG_DIR = Path(os.environ["SOUNDSTASH_PROJECT_ROOT"]).resolve() / "logs"
elif os.environ.get("STASH_PROJECT_ROOT"):
    _LOG_DIR = Path(os.environ["STASH_PROJECT_ROOT"]).resolve() / "logs"
elif os.environ.get("YTM_PROJECT_ROOT"):
    _LOG_DIR = Path(os.environ["YTM_PROJECT_ROOT"]).resolve() / "logs"
else:
    _LOG_DIR = Path(__file__).resolve().parent.parent / "logs"

try:
    _LOG_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    # Fallback sécurisé sur AppData si permissions restreintes (ex: dossier d'installation Program Files)
    _LOG_DIR = Path(os.environ.get("APPDATA", str(Path.home()))) / "SoundStash" / "logs"
    _LOG_DIR.mkdir(parents=True, exist_ok=True)

_LOG_FILE = _LOG_DIR / "soundstash.log"

# Format commun : date heure | niveau | module | message
_FORMATTER = logging.Formatter(
    fmt="%(asctime)s | %(levelname)-8s | %(name)-20s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)

def _build_root_logger() -> logging.Logger:
    root = logging.getLogger("soundstash")
    if root.handlers:
        return root  # Déjà initialisé
    root.setLevel(logging.DEBUG)

    # Handler fichier : rotating 5 Mo × 3 fichiers, UTF-8
    fh = logging.handlers.RotatingFileHandler(
        _LOG_FILE,
        maxBytes=5 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8"
    )
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(_FORMATTER)
    root.addHandler(fh)

    # Handler console : uniquement WARNING et plus
    ch = logging.StreamHandler()
    ch.setLevel(logging.WARNING)
    ch.setFormatter(_FORMATTER)
    root.addHandler(ch)

    return root


_root_logger = _build_root_logger()


def get_logger(name: str) -> logging.Logger:
    """
    Retourne un logger enfant du logger racine soundstash.
    name : typiquement __name__ du module appelant.
    """
    # Normaliser le nom : retirer le préfixe 'backend.' pour lisibilité
    short_name = name.replace("backend.", "").replace("__main__", "main")
    return _root_logger.getChild(short_name)


def get_log_info() -> dict:
    """
    Retourne les informations sur l'espace occupé par les logs :
    taille totale en octets, nombre de fichiers, chemin du log principal et du dossier.
    """
    total_bytes = 0
    file_count = 0
    active_log_file = _LOG_FILE
    if _LOG_FILE.exists():
        total_bytes += _LOG_FILE.stat().st_size
        file_count += 1
    for i in range(1, 4):
        rot = _LOG_DIR / f"soundstash.log.{i}"
        if rot.exists():
            total_bytes += rot.stat().st_size
            file_count += 1

    return {
        "total_bytes": total_bytes,
        "file_count": file_count,
        "log_file": str(active_log_file),
        "log_dir": str(_LOG_DIR)
    }


def clear_log_file() -> int:
    """
    Vide le fichier de log principal et supprime les archives rotatives (.1, .2, .3).
    Retourne le nombre d'octets libérés.
    """
    freed = 0
    if _LOG_FILE.exists():
        try:
            freed += _LOG_FILE.stat().st_size
            with open(_LOG_FILE, "w", encoding="utf-8") as f:
                f.write("")
        except Exception:
            pass
    for i in range(1, 4):
        rot = _LOG_DIR / f"soundstash.log.{i}"
        if rot.exists():
            try:
                freed += rot.stat().st_size
                rot.unlink()
            except Exception:
                pass
    return freed



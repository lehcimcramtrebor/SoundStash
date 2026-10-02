import os
import shutil
import json
from pathlib import Path
from typing import Optional
from pydantic import BaseModel, validator

# Chemins de base du projet
if os.environ.get("SOUNDSTASH_PROJECT_ROOT"):
    PROJECT_ROOT = Path(os.environ["SOUNDSTASH_PROJECT_ROOT"]).resolve()
elif os.environ.get("STASH_PROJECT_ROOT"):
    PROJECT_ROOT = Path(os.environ["STASH_PROJECT_ROOT"]).resolve()
elif os.environ.get("YTM_PROJECT_ROOT"):
    PROJECT_ROOT = Path(os.environ["YTM_PROJECT_ROOT"]).resolve()
else:
    PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Dossier de données utilisateur persistant (APPDATA / userData)
def _resolve_user_data_dir() -> Path:
    if os.environ.get("SOUNDSTASH_CONFIG_DIR"):
        return Path(os.environ["SOUNDSTASH_CONFIG_DIR"]).resolve()
    if os.environ.get("STASH_CONFIG_DIR"):
        return Path(os.environ["STASH_CONFIG_DIR"]).resolve()
    if os.environ.get("YTM_CONFIG_DIR"):
        return Path(os.environ["YTM_CONFIG_DIR"]).resolve()
    if os.environ.get("APPDATA"):
        target = Path(os.environ["APPDATA"]).resolve() / "SoundStash"
        target.mkdir(parents=True, exist_ok=True)
        return target
    target = Path.home() / ".soundstash"
    target.mkdir(parents=True, exist_ok=True)
    return target

# Détection du mode packagé (resources, AppData/Local/Temp, ou variable explicite)
_is_packaged = bool(
    os.environ.get("SOUNDSTASH_CONFIG_DIR")
    or os.environ.get("STASH_CONFIG_DIR")
    or os.environ.get("YTM_CONFIG_DIR")
    or "resources" in str(PROJECT_ROOT).lower()
    or "temp" in str(PROJECT_ROOT).lower()
)

if _is_packaged:
    CONFIG_DIR = _resolve_user_data_dir()
else:
    CONFIG_DIR = PROJECT_ROOT

CONFIG_FILE = Path(os.environ["SOUNDSTASH_CONFIG_FILE"]).resolve() if os.environ.get("SOUNDSTASH_CONFIG_FILE") else (
    Path(os.environ["STASH_CONFIG_FILE"]).resolve() if os.environ.get("STASH_CONFIG_FILE") else (
        Path(os.environ["YTM_CONFIG_FILE"]).resolve() if os.environ.get("YTM_CONFIG_FILE") else (CONFIG_DIR / 'config.json')
    )
)

BIN_DIR = PROJECT_ROOT / "bin"
KID3_DIR = BIN_DIR / "kid3"
FRONTEND_DIR = PROJECT_ROOT / "frontend"
SCRIPTS_DIR = PROJECT_ROOT / "scripts"

if os.environ.get("SOUNDSTASH_TEMP_DIR"):
    TEMP_DOWNLOAD_DIR = Path(os.environ["SOUNDSTASH_TEMP_DIR"]).resolve()
elif os.environ.get("STASH_TEMP_DIR"):
    TEMP_DOWNLOAD_DIR = Path(os.environ["STASH_TEMP_DIR"]).resolve()
elif os.environ.get("YTM_TEMP_DIR"):
    TEMP_DOWNLOAD_DIR = Path(os.environ["YTM_TEMP_DIR"]).resolve()
else:
    TEMP_DOWNLOAD_DIR = (CONFIG_DIR if _is_packaged else PROJECT_ROOT) / "temp_downloads"

# Cache persistant pour les extraits et vidéos (ne pollue pas temp_downloads)
if os.environ.get("SOUNDSTASH_CACHE_DIR"):
    PREVIEW_CACHE_DIR = Path(os.environ["SOUNDSTASH_CACHE_DIR"]).resolve() / "previews"
elif os.environ.get("STASH_CACHE_DIR"):
    PREVIEW_CACHE_DIR = Path(os.environ["STASH_CACHE_DIR"]).resolve() / "previews"
elif os.environ.get("YTM_CACHE_DIR"):
    PREVIEW_CACHE_DIR = Path(os.environ["YTM_CACHE_DIR"]).resolve() / "previews"
else:
    PREVIEW_CACHE_DIR = CONFIG_DIR / ".cache" / "previews"

# Scripts de téléchargement locaux
YTM_BAT_PATH = SCRIPTS_DIR / "ytm.bat"
YTM_OGG_BAT_PATH = SCRIPTS_DIR / "ytm_ogg.bat"

# Dossier d'exportation final par défaut et dossiers système rapides
USER_PROFILE_DIR = Path(os.environ.get("USERPROFILE", str(Path.home())))
DEFAULT_EXPORT_DIR = USER_PROFILE_DIR / "Desktop" / "Musique SoundStash"
DESKTOP_EXPORT_DIR = USER_PROFILE_DIR / "Desktop" / "Musique SoundStash"
DOWNLOADS_EXPORT_DIR = USER_PROFILE_DIR / "Downloads" / "Musique SoundStash"
MUSIC_EXPORT_DIR = USER_PROFILE_DIR / "Music"

# Dossiers d'exportation dédiés pour les vidéos complètes MP4
DEFAULT_VIDEO_EXPORT_DIR = USER_PROFILE_DIR / "Desktop" / "Vidéos SoundStash"
DESKTOP_VIDEO_EXPORT_DIR = USER_PROFILE_DIR / "Desktop" / "Vidéos SoundStash"
DOWNLOADS_VIDEO_EXPORT_DIR = USER_PROFILE_DIR / "Downloads" / "Vidéos SoundStash"
VIDEOS_SYSTEM_EXPORT_DIR = USER_PROFILE_DIR / "Videos" / "Vidéos SoundStash"

# Détection des exécutables : priorité absolue aux binaires intégrés dans le projet (bin/)
def resolve_tool(local_file: Path, fallback_name: str) -> str:
    if local_file.exists():
        return str(local_file.resolve())
    found = shutil.which(fallback_name)
    if found:
        return found
    print(f"WARNING: {fallback_name} introuvable dans bin/ ni dans PATH")
    return fallback_name

YT_DLP_PATH = resolve_tool(BIN_DIR / "yt-dlp.exe", "yt-dlp")
FFMPEG_PATH = resolve_tool(BIN_DIR / "ffmpeg.exe", "ffmpeg")
FFPROBE_PATH = resolve_tool(BIN_DIR / "ffprobe.exe", "ffprobe")
KID3_CLI_PATH = resolve_tool(KID3_DIR / "kid3-cli.exe", "kid3-cli")

class AppConfig(BaseModel):
    temp_download_dir: str = str(TEMP_DOWNLOAD_DIR)
    export_dir: str = str(DEFAULT_EXPORT_DIR)
    video_export_dir: str = str(DEFAULT_VIDEO_EXPORT_DIR)
    video_library_dir: Optional[str] = None
    library_dir: Optional[str] = None
    default_format: str = "m4a"
    default_quality: str = "128K"
    default_video_quality: str = "1080p"  # "2160p", "1440p", "1080p", "720p", "best"
    auto_retag: bool = True
    clean_titles: bool = True
    naming_pattern: str = "{track:02d} {title}"
    delete_temp_after_export: bool = True
    auto_sync_videos: bool = True
    # Export Intelligent vers la collection maître (si library_dir est configuré)
    smart_export: bool = True
    smart_export_conflict_policy: str = "merge"  # "merge", "distinct", "overwrite"
    # Pauses anti rate-limit YouTube (en secondes)
    cooldown_album: int = 30       # Pause après un album ou une playlist complète
    cooldown_single: int = 10      # Pause après un titre seul / audio rip / vidéo
    # Réduction dans la zone de notification (Systray près de l'horloge)
    minimize_to_tray_on_close: bool = True
    minimize_to_tray_on_minimize: bool = True
    has_seen_tray_notice: bool = False
    # Démarrage en plein écran & Fondu audio progressif
    start_in_fullscreen: bool = True
    audio_fader_enabled: bool = True
    audio_fader_duration: float = 0.5
    # Auto-mise à jour en tâche de fond de yt-dlp (cooldown 24h)
    auto_update_yt_dlp: bool = True
    # Auto-vérification des mises à jour de SoundStash (GitHub releases)
    auto_check_app_updates: bool = True

    @validator('export_dir', 'video_export_dir', 'video_library_dir', 'library_dir', pre=True)
    def ensure_parent_exists(cls, v):
        if not v:
            return v
        p = Path(v)
        if not p.parent.exists():
            try:
                p.parent.mkdir(parents=True, exist_ok=True)
            except Exception:
                pass  # On tente la création, si ça échoue on laisse le chemin tel quel
        return str(p)

def load_config() -> AppConfig:
    """Charge la config depuis config.json si elle existe, sinon tente le fallback projet ou retourne les valeurs par défaut."""
    # 1. Vérifier le fichier principal (CONFIG_FILE dans CONFIG_DIR / UserData)
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return AppConfig(**data)
        except Exception as e:
            print(f"WARNING: Erreur lecture {CONFIG_FILE}: {e}")

    # 2. Si non trouvé dans CONFIG_FILE (ex: premier démarrage après packaging),
    # tenter de migrer depuis le template ou la config de secours (PROJECT_ROOT / config.json)
    fallback_file = PROJECT_ROOT / 'config.json'
    if fallback_file != CONFIG_FILE and fallback_file.exists():
        try:
            with open(fallback_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            cfg = AppConfig(**data)
            save_config(cfg)
            return cfg
        except Exception as e:
            print(f"WARNING: Erreur lecture fallback {fallback_file}: {e}")

    return AppConfig()

def save_config(cfg: AppConfig):
    """Sauvegarde la config dans config.json de façon atomique et sécurisée."""
    try:
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(cfg.dict(), f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"WARNING: Impossible de sauvegarder config.json dans {CONFIG_FILE}: {e}")

config = load_config()

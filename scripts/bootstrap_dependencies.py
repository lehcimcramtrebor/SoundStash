#!/usr/bin/env python3
"""
SoundStash - Bootstrap Dependencies
Automated downloader for external runtime tools (yt-dlp, ffmpeg, kid3-cli).
Used to initialize a newly cloned repository without storing large binaries in git.
"""

import os
import sys
import shutil
import zipfile
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BIN_DIR = PROJECT_ROOT / "bin"
KID3_DIR = BIN_DIR / "kid3"

# Official download URLs
YT_DLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
FFMPEG_ZIP_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
KID3_ZIP_URL = "https://download.kde.org/stable/kid3/3.9.6/kid3-3.9.6-win.zip"
RCEDIT_URL = "https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe"
PYTHON_EMBED_URL = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip"
PYTHON_RUNTIME_DIR = PROJECT_ROOT / "python_runtime"


def download_with_progress(url: str, dest_path: Path):
    print(f"[*] Téléchargement depuis : {url}")
    print(f"    -> Destination : {dest_path}")
    
    def reporthook(block_num, block_size, total_size):
        if total_size > 0:
            downloaded = block_num * block_size
            percent = min(100.0, downloaded * 100.0 / total_size)
            mb_down = downloaded / (1024 * 1024)
            mb_tot = total_size / (1024 * 1024)
            sys.stdout.write(f"\r    Progression : {percent:5.1f}% [{mb_down:6.1f} Mo / {mb_tot:6.1f} Mo]")
            sys.stdout.flush()

    dest_path.parent.mkdir(parents=True, exist_ok=True)
    temp_dest = dest_path.with_suffix(".downloading")
    try:
        urllib.request.urlretrieve(url, str(temp_dest), reporthook=reporthook)
        print()
        if temp_dest.exists():
            if dest_path.exists():
                dest_path.unlink()
            temp_dest.rename(dest_path)
    except Exception as e:
        if temp_dest.exists():
            temp_dest.unlink()
        raise e


def setup_yt_dlp():
    target = BIN_DIR / "yt-dlp.exe"
    if target.exists() and target.stat().st_size > 1000000:
        print(f"[OK] yt-dlp.exe est déjà présent ({target.stat().st_size / (1024*1024):.1f} Mo)")
        return
    print("\n--- Installation de yt-dlp ---")
    download_with_progress(YT_DLP_URL, target)
    print("[OK] yt-dlp.exe installé avec succès.")


def setup_ffmpeg():
    target_ffmpeg = BIN_DIR / "ffmpeg.exe"
    target_ffprobe = BIN_DIR / "ffprobe.exe"
    if target_ffmpeg.exists() and target_ffprobe.exists():
        print(f"[OK] FFmpeg & FFprobe sont déjà présents.")
        return

    print("\n--- Installation de FFmpeg & FFprobe ---")
    temp_zip = BIN_DIR / "ffmpeg_temp.zip"
    try:
        download_with_progress(FFMPEG_ZIP_URL, temp_zip)
        print("[*] Extraction de ffmpeg.exe et ffprobe.exe...")
        with zipfile.ZipFile(temp_zip, 'r') as zf:
            for member in zf.namelist():
                base_name = Path(member).name.lower()
                if base_name in ("ffmpeg.exe", "ffprobe.exe"):
                    source = zf.open(member)
                    target = BIN_DIR / base_name
                    with open(target, "wb") as f_out:
                        shutil.copyfileobj(source, f_out)
                    print(f"    Extrait : {target.name}")
        print("[OK] FFmpeg configuré avec succès.")
    finally:
        if temp_zip.exists():
            temp_zip.unlink()


def setup_kid3():
    target_cli = KID3_DIR / "kid3-cli.exe"
    if target_cli.exists():
        print(f"[OK] Kid3-CLI est déjà présent.")
        return

    print("\n--- Installation de Kid3 Audio Tagger ---")
    temp_zip = BIN_DIR / "kid3_temp.zip"
    try:
        download_with_progress(KID3_ZIP_URL, temp_zip)
        print("[*] Extraction de la suite Kid3...")
        KID3_DIR.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(temp_zip, 'r') as zf:
            # Identifier le préfixe de dossier dans le zip
            for member in zf.infolist():
                # Enlever le premier niveau de dossier du zip pour extraire directement dans KID3_DIR
                parts = Path(member.filename).parts
                if len(parts) > 1:
                    rel_path = Path(*parts[1:])
                    dest_file = KID3_DIR / rel_path
                    if member.is_dir():
                        dest_file.mkdir(parents=True, exist_ok=True)
                    else:
                        dest_file.parent.mkdir(parents=True, exist_ok=True)
                        with zf.open(member) as src, open(dest_file, "wb") as dst:
                            shutil.copyfileobj(src, dst)
        print("[OK] Kid3 configuré avec succès.")
    finally:
        if temp_zip.exists():
            temp_zip.unlink()


def setup_rcedit():
    target = BIN_DIR / "rcedit-x64.exe"
    if target.exists() and target.stat().st_size > 500000:
        print(f"[OK] rcedit-x64.exe est déjà présent ({target.stat().st_size / (1024*1024):.1f} Mo)")
        return

    print("\n--- Installation de rcedit (Injection métadonnées & icône PE Windows) ---")
    download_with_progress(RCEDIT_URL, target)
    print("[OK] rcedit-x64.exe configuré avec succès.")


def setup_python_runtime():
    target_py = PYTHON_RUNTIME_DIR / "python.exe"
    site_packages = PYTHON_RUNTIME_DIR / "Lib" / "site-packages"

    if target_py.exists() and (site_packages / "fastapi").exists():
        print(f"[OK] python_runtime embarqué est complet et opérationnel.")
        return

    print("\n--- Initialisation de python_runtime embarqué pour la compilation ---")
    PYTHON_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

    if not target_py.exists():
        temp_zip = PROJECT_ROOT / "python_embed_temp.zip"
        try:
            print("[*] Téléchargement du runtime Python 3.11 Windows officiel...")
            download_with_progress(PYTHON_EMBED_URL, temp_zip)
            print("[*] Extraction de python_runtime...")
            with zipfile.ZipFile(temp_zip, 'r') as zf:
                zf.extractall(PYTHON_RUNTIME_DIR)
            print("[OK] Fichiers Python de base extraits.")
        finally:
            if temp_zip.exists():
                temp_zip.unlink()

    # Configuration de python311._pth pour autoriser site-packages
    pth_files = list(PYTHON_RUNTIME_DIR.glob("*._pth"))
    for pth in pth_files:
        try:
            content = pth.read_text(encoding="utf-8")
            lines = content.splitlines()
            new_lines = []
            has_site_packages = False
            has_import_site = False
            for line in lines:
                stripped = line.strip()
                if stripped in ("#import site", "import site"):
                    new_lines.append("import site")
                    has_import_site = True
                else:
                    new_lines.append(line)
                if "site-packages" in stripped:
                    has_site_packages = True
            if not has_site_packages:
                new_lines.append(r"Lib\site-packages")
            if not has_import_site:
                new_lines.append("import site")
            pth.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
            print(f"[*] Fichier {pth.name} configuré (import site & site-packages activés).")
        except Exception as e:
            print(f"[!] Avertissement configuration {pth.name}: {e}")

    # Installer les dépendances dans python_runtime/Lib/site-packages
    req_file = PROJECT_ROOT / "requirements.txt"
    if req_file.exists():
        print("[*] Installation des paquets requis dans python_runtime\\Lib\\site-packages...")
        site_packages.mkdir(parents=True, exist_ok=True)
        import subprocess
        cmd = [
            sys.executable, "-m", "pip", "install",
            "-r", str(req_file),
            "--target", str(site_packages),
            "--no-user"
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode == 0:
            print("[OK] Dépendances installées avec succès dans python_runtime.")
        else:
            print(f"[!] Avertissement installation dépendances python_runtime: {res.stderr.strip()}")


def main():
    print("=" * 60)
    print("SoundStash - Initialisation & Téléchargement des Outils")
    print("=" * 60)
    BIN_DIR.mkdir(parents=True, exist_ok=True)

    try:
        setup_yt_dlp()
        setup_ffmpeg()
        setup_kid3()
        setup_rcedit()
        setup_python_runtime()
        print("\n" + "=" * 60)
        print("Toutes les dépendances autonomes de SoundStash sont prêtes !")
        print("=" * 60)
    except Exception as e:
        print(f"\n[ERREUR] Échec de l'initialisation : {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

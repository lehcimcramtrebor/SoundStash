import shutil
import hashlib
import os
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
LOCALAPPDATA = os.environ.get("LOCALAPPDATA", "")
INSTALLED_SOUNDSTASH = Path(LOCALAPPDATA) / "Programs" / "SoundStash" / "resources"
DIST_RESOURCES = ROOT / "dist" / "win-unpacked" / "resources"

print("=== DEPLOIEMENT & SYNCHRONISATION POST-AUDIT INTEGRAL 100% ===")

files_to_sync = [
    ("frontend/index.html", "frontend/index.html"),
    ("frontend/app.js", "frontend/app.js"),
    ("frontend/style.css", "frontend/style.css"),
    ("frontend/favicon.svg", "frontend/favicon.svg"),
    ("frontend/icon.svg", "frontend/icon.svg"),
    ("frontend/icon.ico", "frontend/icon.ico"),
    ("frontend/icon.png", "frontend/icon.png"),
    ("frontend/soundstash_logo.png", "frontend/soundstash_logo.png"),
    ("build/icon.ico", "build/icon.ico"),
    ("build/icon.png", "build/icon.png"),
    ("backend/library_indexer.py", "backend/library_indexer.py"),
    ("backend/library_sync.py", "backend/library_sync.py"),
    ("backend/video_sync.py", "backend/video_sync.py"),
    ("backend/library_migrator.py", "backend/library_migrator.py"),
    ("backend/config.py", "backend/config.py"),
    ("backend/app.py", "backend/app.py"),
    ("backend/playlist_manager.py", "backend/playlist_manager.py"),
    ("backend/playback_stats.py", "backend/playback_stats.py"),
    ("backend/video_indexer.py", "backend/video_indexer.py"),
    ("backend/tool_updater.py", "backend/tool_updater.py"),
    ("backend/logger.py", "backend/logger.py"),
    ("backend/genre_service.py", "backend/genre_service.py"),
    ("backend/tagger.py", "backend/tagger.py"),
    ("backend/downloader.py", "backend/downloader.py"),
]

# Ajouter dynamiquement toutes les pochettes vectorielles
covers_dir = ROOT / "frontend" / "playlist_covers"
if covers_dir.exists():
    for f in covers_dir.glob("*.svg"):
        files_to_sync.append((f"frontend/playlist_covers/{f.name}", f"frontend/playlist_covers/{f.name}"))

# Ajouter dynamiquement tous les modules CSS découpés
css_dir = ROOT / "frontend" / "css"
if css_dir.exists():
    for f in sorted(css_dir.glob("*.css")):
        files_to_sync.append((f"frontend/css/{f.name}", f"frontend/css/{f.name}"))

# Ajouter dynamiquement tous les modules JS découpés
js_dir = ROOT / "frontend" / "js"
if js_dir.exists():
    for f in sorted(js_dir.rglob("*.js")):
        rel = f.relative_to(ROOT).as_posix()
        files_to_sync.append((rel, rel))

targets = [DIST_RESOURCES, INSTALLED_SOUNDSTASH]

for target_dir in targets:
    if not target_dir.exists():
        print(f"  [SKIP] Target inexistant: {target_dir}")
        continue
    for src_rel, dest_rel in files_to_sync:
        src = ROOT / src_rel
        dest = target_dir / dest_rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        print(f"  ✓ Copié: {src_rel} -> {dest}")

# Empaqueter et déployer app.asar (main.js, preload.js, package.json, icons)
import tempfile, subprocess
print("\n=== RE-PACKAGING APP.ASAR (ELECTRON CORE) ===")
with tempfile.TemporaryDirectory() as td:
    asar_staging = Path(td)
    (asar_staging / "build").mkdir()
    shutil.copy2(ROOT / "build" / "icon.ico", asar_staging / "build" / "icon.ico")
    shutil.copy2(ROOT / "build" / "icon.png", asar_staging / "build" / "icon.png")
    shutil.copy2(ROOT / "main.js", asar_staging / "main.js")
    shutil.copy2(ROOT / "preload.js", asar_staging / "preload.js")
    shutil.copy2(ROOT / "package.json", asar_staging / "package.json")

    packed_asar = Path(td) / "app.asar"
    res = subprocess.run(["npx.cmd", "asar", "pack", str(asar_staging), str(packed_asar)], capture_output=True, text=True, shell=True)
    if res.returncode == 0 and packed_asar.exists():
        for target_dir in targets:
            if target_dir.exists():
                dest_asar = target_dir / "app.asar"
                shutil.copy2(packed_asar, dest_asar)
                print(f"  ✓ app.asar déployé -> {dest_asar}")
    else:
        print(f"  [AVERTISSEMENT] Échec création app.asar : {res.stderr}")

def get_sha256(path):
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()

print("\n=== VERIFICATION CONCORDANCE SHA256 ===")
all_verified = True

for _, rel in files_to_sync:
    p_src = ROOT / rel
    p_dist = DIST_RESOURCES / rel
    p_inst = INSTALLED_STASH / rel if INSTALLED_STASH.exists() else None
    
    h_src = get_sha256(p_src)
    h_dist = get_sha256(p_dist) if p_dist.exists() else "ABSENT"
    h_inst = get_sha256(p_inst) if (p_inst and p_inst.exists()) else "N/A"
    
    match = (h_src == h_dist) and (h_inst == "N/A" or h_src == h_inst)
    status = "OK" if match else "MISMATCH"
    print(f"  [{status}] {rel:<30} (SRC: {h_src[:12]} | DIST: {h_dist[:12]} | INST: {h_inst[:12]})")
    if not match:
        all_verified = False

# Vérification app.asar
asar_dist = DIST_RESOURCES / "app.asar"
asar_inst = INSTALLED_STASH / "app.asar" if INSTALLED_STASH.exists() else None
if asar_dist.exists():
    h_ad = get_sha256(asar_dist)
    h_ai = get_sha256(asar_inst) if (asar_inst and asar_inst.exists()) else "N/A"
    m_asar = (h_ai == "N/A" or h_ad == h_ai)
    st_asar = "OK" if m_asar else "MISMATCH"
    print(f"  [{st_asar}] {'app.asar (electron core)':<30} (DIST: {h_ad[:12]} | INST: {h_ai[:12]})")
    if not m_asar:
        all_verified = False

if all_verified:
    print("\n✓ SUCCES : Tous les composants sont synchronisés et validés par SHA256 à 100%.")
else:
    raise RuntimeError("Erreur de concordance SHA256 détectée !")

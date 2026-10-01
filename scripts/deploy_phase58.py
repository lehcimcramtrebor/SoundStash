import shutil
import hashlib
import os
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
LOCALAPPDATA = os.environ.get("LOCALAPPDATA", "")
INSTALLED_RESOURCES = Path(LOCALAPPDATA) / "Programs" / "SoundStash" / "resources"
DIST_RESOURCES = ROOT / "dist" / "win-unpacked" / "resources"

print("=== DEPLOIEMENT PHASE 58 (RACCOURCIS, MOLETTE VOLUME & MINUTEUR VEILLE) ===")

files_to_sync = [
    ("frontend/index.html", "frontend/index.html"),
    ("frontend/app.js", "frontend/app.js"),
    ("frontend/style.css", "frontend/style.css"),
]

targets = [DIST_RESOURCES, INSTALLED_RESOURCES]

for target_dir in targets:
    for src_rel, dest_rel in files_to_sync:
        src = ROOT / src_rel
        dest = target_dir / dest_rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        print(f"  ✓ Copié: {src_rel} -> {dest}")

def get_sha256(path):
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()

print("\n=== VERIFICATION CONCORDANCE SHA256 ===")
all_verified = True
all_items = [
    (rel, DIST_RESOURCES / rel, INSTALLED_RESOURCES / rel)
    for _, rel in files_to_sync
]

for label, p_dist, p_inst in all_items:
    h_dist = get_sha256(p_dist)
    h_inst = get_sha256(p_inst)
    match = (h_dist == h_inst)
    status = "OK" if match else "MISMATCH"
    print(f"  [{status}] {label} (SHA: {h_dist[:16]}...)")
    if not match:
        all_verified = False

if all_verified:
    print("\n✓ SUCCES : Tous les fichiers sont rigoureusement identiques et validés par empreinte SHA256.")
else:
    raise RuntimeError("Erreur de concordance SHA256 détectée !")

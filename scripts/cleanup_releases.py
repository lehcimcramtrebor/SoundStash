import os
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

print("=== MENAGE DES ANCIENNES RELEASES DANS DIST ===")

if not DIST.exists():
    print("Dossier dist inexistant.")
    sys.exit(0)

# Fichiers à supprimer : anciennes versions 1.4.x et anciens artefacts
deleted_files = []
total_bytes_freed = 0

for item in DIST.iterdir():
    if item.is_file():
        # Détecter versions 1.4.x
        if "1.4." in item.name or item.name in ["builder-debug.yml", "builder-effective-config.yaml"]:
            sz = item.stat().st_size
            total_bytes_freed += sz
            item.unlink()
            deleted_files.append((item.name, sz))
            print(f"  🗑️ Supprimé : {item.name} ({sz / (1024*1024):.2f} Mo)")
        # Supprimer aussi les anciens binaires 2.0.0 pour un build tout propre
        elif "2.0.0" in item.name:
            sz = item.stat().st_size
            total_bytes_freed += sz
            item.unlink()
            deleted_files.append((item.name, sz))
            print(f"  🗑️ Supprimé (pour re-build frais) : {item.name} ({sz / (1024*1024):.2f} Mo)")

print(f"\n✓ Ménage terminé : {len(deleted_files)} fichiers supprimés.")
print(f"✓ Espace disque libéré : {total_bytes_freed / (1024*1024):.2f} Mo ({total_bytes_freed / (1024*1024*1024):.2f} Go)")

import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from backend.config import config
from backend.cover_restorer import repair_album_cover, _run_restore_all

if __name__ == "__main__":
    if len(sys.argv) > 1:
        arg = sys.argv[1].strip()
        if arg == "--all":
            export_path = (
                Path(config.library_dir) if config.library_dir else (
                    Path(config.export_dir) if config.export_dir else Path(r"D:\GoogleDrive\Musique\Mes Albums")
                )
            )
            print(f"Lancement de la restauration intégrale sur : {export_path}")
            _run_restore_all(export_path, broadcast_fn=lambda s: print(f"[{s.get('current')}/{s.get('total')}] {s.get('percent')}% - {s.get('album')}"))
        else:
            target_dir = Path(arg)
            ok = repair_album_cover(target_dir)
            print(f"Résultat : {'Succès' if ok else 'Échec'}")
    else:
        print("Usage:")
        print("  python scripts/repair_covers.py --all                      # Restaure toute la collection")
        print("  python scripts/repair_covers.py <chemin_dossier_album>     # Restaure un album spécifique")

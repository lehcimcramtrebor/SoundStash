import os
import sys
import time
import subprocess
import urllib.request
from pathlib import Path

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
OUTPUT_DIR = Path(r"C:\Users\miche\.gemini\antigravity\brain\058353d3-7e85-44af-978a-b4f362fced4b\audit_screenshots")
USER_DATA_DIR = Path(r"C:\Users\miche\AppData\Local\Temp\chrome_audit")
PORT = 8001

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
USER_DATA_DIR.mkdir(parents=True, exist_ok=True)

VIEWS = [
    # 1. Rechercher (Initial)
    ("01_search_initial_dark", "/?tab=tab-search&theme=dark"),
    ("01_search_initial_light", "/?tab=tab-search&theme=light"),

    # 2. Télécharger
    ("02_download_dark", "/?tab=tab-download&theme=dark"),
    ("02_download_light", "/?tab=tab-download&theme=light"),

    # 3. Uniformiser & Éditer (Nouvelle mise en page Option A)
    ("03_editor_dark", "/?tab=tab-editor&theme=dark"),
    ("03_editor_light", "/?tab=tab-editor&theme=light"),

    # 4. Panneau Export dans l'Éditeur
    ("04_editor_export_dark", "/?tab=tab-editor&theme=dark&modal=export"),
    ("04_editor_export_light", "/?tab=tab-editor&theme=light&modal=export"),

    # 5. Dossier Temporaire
    ("05_temp_dark", "/?tab=tab-library&theme=dark"),
    ("05_temp_light", "/?tab=tab-library&theme=light"),

    # 6. Paramètres
    ("06_settings_dark", "/?tab=tab-settings&theme=dark"),
    ("06_settings_light", "/?tab=tab-settings&theme=light"),

    # 7. Modale d'Aperçu Pistes
    ("07_modal_preview_dark", "/?tab=tab-search&theme=dark&modal=preview"),
    ("07_modal_preview_light", "/?tab=tab-search&theme=light&modal=preview"),

    # 8. Recherche avec résultats (Pulp Fiction)
    ("08_search_results_dark", "/?tab=tab-search&theme=dark&search=pulp+fiction"),
    ("08_search_results_light", "/?tab=tab-search&theme=light&search=pulp+fiction"),

    # 9. Recherche Albums avec bouton "Voir plus de résultats"
    ("09_search_albums_more_dark", "/?tab=tab-search&theme=dark&search=daft+punk&filter=album"),
    ("09_search_albums_more_light", "/?tab=tab-search&theme=light&search=daft+punk&filter=album"),

    # 10. Recherche après clic sur "Voir plus de résultats" (40 résultats)
    ("10_search_loaded_more_dark", "/?tab=tab-search&theme=dark&search=daft+punk&filter=album&loadmore=true"),
    ("10_search_loaded_more_light", "/?tab=tab-search&theme=light&search=daft+punk&filter=album&loadmore=true"),
]

def wait_for_server(port, max_wait=20):
    url = f"http://127.0.0.1:{port}/api/config"
    start = time.time()
    while time.time() - start < max_wait:
        try:
            with urllib.request.urlopen(url, timeout=1) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.4)
    return False

def capture_view(name, query_path):
    target_url = f"http://127.0.0.1:{PORT}{query_path}"
    out_file = OUTPUT_DIR / f"{name}.png"

    # Délai d'attente pour que les données asynchrones se chargent
    if "loadmore=true" in query_path:
        delay_ms = 5500
    elif "search=" in query_path or "modal=preview" in query_path:
        delay_ms = 3500
    else:
        delay_ms = 1000

    cmd = [
        CHROME_PATH,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        f"--window-size=1280,850",
        f"--user-data-dir={USER_DATA_DIR}",
        f"--virtual-time-budget={delay_ms}",
        f"--screenshot={out_file}",
        target_url
    ]

    res = subprocess.run(cmd, capture_output=True, text=True)
    if out_file.exists() and out_file.stat().st_size > 5000:
        print(f"  [OK] {name} ({out_file.stat().st_size // 1024} Ko)")
        return True
    else:
        print(f"  [FAIL] {name}: {res.stderr[:200]}")
        return False

def main():
    print(f"--- Démarrage de la capture d'audit sur {len(VIEWS)} vues ---")
    python_exe = sys.executable

    # Lancer FastAPI
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    server_proc = subprocess.Popen(
        [python_exe, "-m", "uvicorn", "backend.app:app", "--port", str(PORT), "--log-level", "warning"],
        cwd=Path(__file__).resolve().parent.parent,
        env=env
    )

    try:
        print(f"Attente du serveur FastAPI sur le port {PORT}...")
        if not wait_for_server(PORT):
            print("ERREUR: Le serveur n'a pas répondu à temps.")
            return

        print("Serveur prêt. Capture des écrans en cours...")
        for name, query in VIEWS:
            capture_view(name, query)

        print("\nToutes les captures sont terminées dans :", OUTPUT_DIR)
    finally:
        server_proc.terminate()
        try:
            server_proc.wait(timeout=3)
        except Exception:
            server_proc.kill()
        print("Serveur de capture arrêté.")

if __name__ == "__main__":
    main()

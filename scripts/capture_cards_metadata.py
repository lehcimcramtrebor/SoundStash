import os
import sys
import time
import subprocess
import urllib.request
from pathlib import Path

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
OUTPUT_DIR = Path(r"C:\Users\miche\.gemini\antigravity\brain\058353d3-7e85-44af-978a-b4f362fced4b\audit_screenshots")
USER_DATA_DIR = Path(r"C:\Users\miche\AppData\Local\Temp\chrome_tall_audit")
PORT = 8006

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
USER_DATA_DIR.mkdir(parents=True, exist_ok=True)

VIEWS = [
    # Vue haute (1280x1100) montrant le contenu complet des cartes avec leurs badges de pistes
    ("23_albums_sorted_tracks_cards_dark", "/?tab=tab-search&theme=dark&search=daft+punk&filter=album&sort=tracks-desc"),
    ("23_albums_sorted_tracks_cards_light", "/?tab=tab-search&theme=light&search=daft+punk&filter=album&sort=tracks-desc"),
    ("24_albums_subfilter_singles_cards_dark", "/?tab=tab-search&theme=dark&search=daft+punk&filter=album&subfilter=single_ep"),
    ("24_albums_subfilter_singles_cards_light", "/?tab=tab-search&theme=light&search=daft+punk&filter=album&subfilter=single_ep"),
]

def wait_for_server(port, max_wait=30):
    url = f"http://127.0.0.1:{port}/api/config"
    start = time.time()
    while time.time() - start < max_wait:
        try:
            with urllib.request.urlopen(url, timeout=1) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.5)
    return False

def capture_view(name, query_path):
    target_url = f"http://127.0.0.1:{PORT}{query_path}"
    out_file = OUTPUT_DIR / f"{name}.png"
    delay_ms = 5000

    cmd = [
        CHROME_PATH,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--window-size=1280,1100",
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
    print(f"--- Démarrage de la capture des cartes détaillées ({len(VIEWS)} vues) ---")
    python_exe = sys.executable
    root_dir = Path(__file__).resolve().parent.parent

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONPATH"] = str(root_dir)
    server_proc = subprocess.Popen(
        [python_exe, "-m", "uvicorn", "backend.app:app", "--port", str(PORT)],
        cwd=root_dir,
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

import os
import sys
import time
import subprocess
import urllib.request
from pathlib import Path

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
OUTPUT_DIR = Path(r"C:\Users\miche\.gemini\antigravity\brain\058353d3-7e85-44af-978a-b4f362fced4b\audit_screenshots")
PORT = 8011

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

VIEWS = [
    # 1. Atelier avec roue crantée dans le header
    ("37_dark_atelier_with_settings_gear", "/?tab=tab-search&theme=dark"),
    # 2. Mode Lecteur avec roue crantée dans le header
    ("38_dark_player_with_settings_gear", "/?player=true&theme=dark"),
    # 3. Modale Paramètres - Sous-onglet 1 : Musique (Dark & Light)
    ("39_dark_settings_music_subtab", "/?modal=settings&subtab=subtab-music&theme=dark"),
    ("40_light_settings_music_subtab", "/?modal=settings&subtab=subtab-music&theme=light"),
    # 4. Modale Paramètres - Sous-onglet 2 : Vidéos
    ("41_dark_settings_video_subtab", "/?modal=settings&subtab=subtab-video&theme=dark"),
    # 5. Modale Paramètres - Sous-onglet 3 : Système
    ("42_dark_settings_system_subtab", "/?modal=settings&subtab=subtab-system&theme=dark"),
    # 6. Modale Paramètres - Sous-onglet 4 : Maintenance
    ("43_dark_settings_maintenance_subtab", "/?modal=settings&subtab=subtab-maintenance&theme=dark"),
]

def is_server_running(port):
    url = f"http://127.0.0.1:{port}/api/config"
    try:
        with urllib.request.urlopen(url, timeout=1) as resp:
            return resp.status == 200
    except Exception:
        return False

def wait_for_server(port, max_wait=15):
    start = time.time()
    while time.time() - start < max_wait:
        if is_server_running(port):
            return True
        time.sleep(0.3)
    return False

def capture_view(name, query_path):
    target_url = f"http://127.0.0.1:{PORT}{query_path}"
    out_file = OUTPUT_DIR / f"{name}.png"
    user_data = f"C:\\Users\\miche\\AppData\\Local\\Temp\\chrome_sub_{os.getpid()}_{name}"

    cmd = [
        CHROME_PATH,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--window-size=1280,850",
        f"--user-data-dir={user_data}",
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
    print(f"--- Démarrage de la capture des nouveaux paramètres sur {len(VIEWS)} vues ---")
    server_proc = None

    if not is_server_running(PORT):
        print(f"Lancement du serveur FastAPI sur le port {PORT}...")
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        server_proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "backend.app:app", "--port", str(PORT), "--log-level", "warning"],
            cwd=Path(__file__).resolve().parent.parent,
            env=env
        )
        if not wait_for_server(PORT):
            print("ERREUR: Le serveur n'a pas répondu.")
            return
    else:
        print(f"Serveur déjà actif sur le port {PORT}.")

    try:
        for name, query in VIEWS:
            capture_view(name, query)
        print("\nToutes les captures sont terminées dans :", OUTPUT_DIR)
    finally:
        if server_proc:
            server_proc.terminate()
            try:
                server_proc.wait(timeout=3)
            except Exception:
                server_proc.kill()
            print("Serveur arrêté.")

if __name__ == "__main__":
    main()

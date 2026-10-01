import os
import sys
import time
import subprocess
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
OUTPUT_DIR = Path(r"C:\Users\miche\.gemini\antigravity\brain\058353d3-7e85-44af-978a-b4f362fced4b\audit_screenshots")
PORT = 8012

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

VIEWS = [
    ("54_dark_editor_collection_tree", "/?tab=tab-editor&editorTree=true&theme=dark"),
    ("55_dark_player_playlists_subtab", "/?player=true&playerView=playlists&theme=dark"),
    ("56_dark_universal_playlist_modal", "/?tab=tab-editor&modal=playlist-picker&theme=dark"),
    ("57_dark_recycle_bin_confirm_modal", "/?tab=tab-editor&modal=trash-confirm&theme=dark"),
    ("58_light_editor_collection_tree", "/?tab=tab-editor&editorTree=true&theme=light"),
    ("59_light_player_playlists_subtab", "/?player=true&playerView=playlists&theme=light"),
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
    user_data = f"C:\\Users\\miche\\AppData\\Local\\Temp\\chrome_p4849_{os.getpid()}_{name}"

    cmd = [
        CHROME_PATH,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--window-size=1280,850",
        "--virtual-time-budget=2000",
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
    print(f"--- Démarrage de la capture d'audit Phases 48 & 49 sur {len(VIEWS)} vues ---")
    server_proc = None

    if not is_server_running(PORT):
        print(f"Lancement du serveur FastAPI sur le port {PORT}...")
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        server_proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "backend.app:app", "--port", str(PORT), "--log-level", "warning"],
            cwd=str(Path(__file__).resolve().parent.parent),
            env=env
        )
        if not wait_for_server(PORT):
            print("ERREUR: Le serveur n'a pas répondu.")
            return
    else:
        print(f"Serveur déjà actif sur le port {PORT}.")

    try:
        # Créer au préalable une playlist d'exemple si aucune n'existe pour avoir un visuel riche
        from backend.playlist_manager import playlist_manager
        playlists = playlist_manager.list_playlists()
        if not playlists:
            print("Création d'une playlist mixte de démonstration pour les captures...")
            playlist_manager.create_playlist(
                "Best of Chill & Visuals",
                "Sélection hybride pistes audio haute fidélité et clips officiels",
                [
                    {
                        "id": "trk_01",
                        "type": "audio",
                        "title": "Around the World",
                        "artist": "Daft Punk",
                        "album": "Homework",
                        "duration": 429,
                        "file_path": "mock_homework.mp3",
                        "cover_url": "/static/placeholder-cover.svg"
                    },
                    {
                        "id": "vid_01",
                        "type": "video",
                        "title": "Starboy (Official Music Video)",
                        "artist": "The Weeknd ft. Daft Punk",
                        "album": "Starboy",
                        "duration": 230,
                        "file_path": "mock_starboy.mp4",
                        "thumbnail_url": "/static/placeholder-cover.svg"
                    }
                ]
            )

        for name, query in VIEWS:
            capture_view(name, query)
        print("\nToutes les captures sont terminées avec succès dans :", OUTPUT_DIR)
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

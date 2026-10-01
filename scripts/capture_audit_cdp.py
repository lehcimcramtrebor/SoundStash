import json
import base64
import urllib.request
import websocket
import subprocess
import time
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
OUTPUT_DIR = Path(r"C:\Users\miche\.gemini\antigravity\brain\058353d3-7e85-44af-978a-b4f362fced4b\audit_screenshots")
PORT = 8016

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# 1. Start server
env = os.environ.copy()
env["PYTHONUNBUFFERED"] = "1"
server_proc = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "backend.app:app", "--port", str(PORT), "--log-level", "warning"],
    cwd=str(Path(__file__).resolve().parent.parent),
    env=env
)

time.sleep(2)

# Ensure sample playlist exists
from backend.playlist_manager import playlist_manager
if not playlist_manager.list_playlists():
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

# Start chrome with remote debugging
chrome_proc = subprocess.Popen([
    CHROME_PATH,
    "--headless=new",
    "--remote-debugging-port=9223",
    "--remote-allow-origins=*",
    "--disable-gpu",
    "--no-sandbox",
    "--window-size=1280,850",
    "about:blank"
])
time.sleep(1.5)

try:
    with urllib.request.urlopen("http://127.0.0.1:9223/json") as resp:
        tabs = json.loads(resp.read().decode())
    ws_url = tabs[0]["webSocketDebuggerUrl"]

    ws = websocket.create_connection(ws_url)
    ws.send(json.dumps({"id": 1, "method": "Page.enable"}))
    ws.send(json.dumps({"id": 2, "method": "Runtime.enable"}))
    ws.send(json.dumps({"id": 3, "method": "Emulation.setDeviceMetricsOverride", "params": {
        "width": 1280, "height": 850, "deviceScaleFactor": 1, "mobile": False
    }}))

    def capture(name, url_path, wait_selector, extra_wait=1.0):
        url = f"http://127.0.0.1:{PORT}{url_path}"
        print(f"Navigating to: {name} -> {url}")
        ws.send(json.dumps({"id": 10, "method": "Page.navigate", "params": {"url": url}}))
        
        # Wait for selector
        start = time.time()
        while time.time() - start < 8:
            ws.send(json.dumps({
                "id": 11,
                "method": "Runtime.evaluate",
                "params": {"expression": f"Boolean(document.querySelector('{wait_selector}'))"}
            }))
            res = json.loads(ws.recv())
            if res.get("id") == 11 and res.get("result", {}).get("result", {}).get("value") is True:
                break
            time.sleep(0.2)
        
        time.sleep(extra_wait)
        
        # Screenshot
        ws.send(json.dumps({"id": 20, "method": "Page.captureScreenshot", "params": {"format": "png"}}))
        while True:
            res = json.loads(ws.recv())
            if res.get("id") == 20:
                data = res["result"]["data"]
                out_path = OUTPUT_DIR / f"{name}.png"
                with open(out_path, "wb") as f:
                    f.write(base64.b64decode(data))
                print(f"  [OK] Saved {out_path.name} ({out_path.stat().st_size // 1024} Ko)")
                break

    capture("55_dark_player_playlists_subtab", "/?player=true&playerView=playlists&theme=dark", "#playlists-grid-container .playlist-card, #playlists-grid-container .empty-state")
    capture("54_dark_editor_collection_tree", "/?tab=tab-editor&editorTree=true&theme=dark", "#editor-tree-container .tree-artist-node, #editor-tree-container p")
    capture("56_dark_universal_playlist_modal", "/?tab=tab-editor&modal=playlist-picker&theme=dark", "#add-to-playlist-modal-backdrop.active")
    capture("57_dark_recycle_bin_confirm_modal", "/?tab=tab-editor&modal=trash-confirm&theme=dark", "#close-confirm-modal, #custom-modal-backdrop.active")
    capture("58_light_editor_collection_tree", "/?tab=tab-editor&editorTree=true&theme=light", "#editor-tree-container .tree-artist-node, #editor-tree-container p")
    capture("59_light_player_playlists_subtab", "/?player=true&playerView=playlists&theme=light", "#playlists-grid-container .playlist-card, #playlists-grid-container .empty-state")

finally:
    chrome_proc.terminate()
    server_proc.terminate()
    print("Done capture.")

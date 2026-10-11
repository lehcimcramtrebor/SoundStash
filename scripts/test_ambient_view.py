import json
import base64
import urllib.request
import websocket
import subprocess
import time
import os
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
PORT = 8058
CDP_PORT = 9268

env = os.environ.copy()
env["PYTHONUNBUFFERED"] = "1"
server_proc = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "backend.app:app", "--port", str(PORT), "--log-level", "warning"],
    cwd=str(ROOT),
    env=env
)
time.sleep(2.5)

chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
chrome_proc = subprocess.Popen(
    [
        chrome_path,
        f"--remote-debugging-port={CDP_PORT}",
        "--remote-allow-origins=*",
        "--headless=new",
        "--disable-gpu",
        "--window-size=1600,900",
        f"http://localhost:{PORT}"
    ],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL
)
time.sleep(2.5)

class CDPClient:
    def __init__(self, port):
        self.port = port
        self.ws = None
        self.msg_id = 0

    def connect(self):
        targets_url = f"http://localhost:{self.port}/json"
        req = urllib.request.urlopen(targets_url)
        targets = json.loads(req.read().decode())
        page_target = next(t for t in targets if t.get("type") == "page")
        ws_url = page_target["webSocketDebuggerUrl"]
        self.ws = websocket.create_connection(ws_url, timeout=10)

    def send(self, method, params=None):
        self.msg_id += 1
        msg = {"id": self.msg_id, "method": method}
        if params:
            msg["params"] = params
        self.ws.send(json.dumps(msg))
        while True:
            res = json.loads(self.ws.recv())
            if res.get("id") == self.msg_id:
                return res.get("result", {})

    def evaluate(self, expr):
        res = self.send("Runtime.evaluate", {
            "expression": expr,
            "returnByValue": True,
            "awaitPromise": True
        })
        val = res.get("result", {}).get("value")
        return val

try:
    cdp = CDPClient(CDP_PORT)
    cdp.connect()
    time.sleep(2.0)

    # 1. Start playback of an album
    res1 = cdp.evaluate("""
    (async () => {
        const ap = window.AudioPlayer;
        if (!ap) return "NO_AP";
        const albums = ap.libraryAlbums;
        if (!albums || !albums.length) return "NO_ALBUMS: " + JSON.stringify(albums);
        await ap.loadAlbum(albums[0].path, { autoPlay: true, startTrackIndex: 0, isCollection: true, switchView: false });
        return {
            title: ap.currentAlbum ? ap.currentAlbum.title : null,
            isPlaying: ap.isPlaying,
            view: ap.currentView,
            isAlbumDetailOpen: ap.isAlbumDetailOpen,
            detailPath: ap.detailAlbumPath,
            activeSubtab: document.querySelector(".player-subtab-btn.active") ? document.querySelector(".player-subtab-btn.active").getAttribute("data-pview") : null
        };
    })()
    """)
    print("Step 1 (Play album):", res1)
    time.sleep(1.0)

    # 2. Press N or call goToNowPlaying
    res2 = cdp.evaluate("""
    (() => {
        window.goToNowPlaying();
        const ap = window.AudioPlayer;
        return {
            view: ap.currentView,
            isAlbumDetailOpen: ap.isAlbumDetailOpen,
            detailPath: ap.detailAlbumPath,
            activeSubtab: document.querySelector(".player-subtab-btn.active") ? document.querySelector(".player-subtab-btn.active").getAttribute("data-pview") : null
        };
    })()
    """)
    print("Step 2 (goToNowPlaying):", res2)
    time.sleep(1.0)

    # 3. Enter ambient mode
    res3 = cdp.evaluate("""
    (() => {
        window.AmbientVisualizer.enter();
        const ap = window.AudioPlayer;
        return {
            isAmbient: window.AmbientVisualizer.isActive,
            bodyAmbientClass: document.body.classList.contains("ambient-mode-active"),
            view: ap.currentView,
            isAlbumDetailOpen: ap.isAlbumDetailOpen,
            detailPath: ap.detailAlbumPath,
            activeSubtab: document.querySelector(".player-subtab-btn.active") ? document.querySelector(".player-subtab-btn.active").getAttribute("data-pview") : null
        };
    })()
    """)
    print("Step 3 (Enter ambient):", res3)
    time.sleep(1.0)

    # 4. Exit ambient mode
    res4 = cdp.evaluate("""
    (() => {
        window.AmbientVisualizer.exit();
        const ap = window.AudioPlayer;
        return {
            isAmbient: window.AmbientVisualizer.isActive,
            bodyAmbientClass: document.body.classList.contains("ambient-mode-active"),
            view: ap.currentView,
            isAlbumDetailOpen: ap.isAlbumDetailOpen,
            detailPath: ap.detailAlbumPath,
            activeSubtab: document.querySelector(".player-subtab-btn.active") ? document.querySelector(".player-subtab-btn.active").getAttribute("data-pview") : null
        };
    })()
    """)
    print("Step 4 (Exit ambient):", res4)

    # 5. What if user presses N inside ambient mode?
    res5 = cdp.evaluate("""
    (() => {
        window.AmbientVisualizer.enter();
        // Simulate pressing N key
        const event = new KeyboardEvent("keydown", { key: "n", bubbles: true, cancelable: true });
        window.dispatchEvent(event);
        const ap = window.AudioPlayer;
        return {
            isAmbient: window.AmbientVisualizer.isActive,
            view: ap.currentView,
            isAlbumDetailOpen: ap.isAlbumDetailOpen,
            activeSubtab: document.querySelector(".player-subtab-btn.active") ? document.querySelector(".player-subtab-btn.active").getAttribute("data-pview") : null
        };
    })()
    """)
    print("Step 5 (Press N inside ambient mode):", res5)

    # 6. What if user was on setView('now-playing')?
    res6 = cdp.evaluate("""
    (() => {
        window.AmbientVisualizer.exit();
        const ap = window.AudioPlayer;
        ap.setView("now-playing");
        return {
            view: ap.currentView,
            activeSubtab: document.querySelector(".player-subtab-btn.active") ? document.querySelector(".player-subtab-btn.active").getAttribute("data-pview") : null,
            nowPlayingDisplay: document.getElementById("player-view-now-playing") ? document.getElementById("player-view-now-playing").style.display : null,
            albumsDisplay: document.getElementById("player-view-albums") ? document.getElementById("player-view-albums").style.display : null
        };
    })()
    """)
    print("Step 6 (SetView now-playing):", res6)

    # 7. Enter and exit ambient when on now-playing
    res7 = cdp.evaluate("""
    (() => {
        window.AmbientVisualizer.enter();
        window.AmbientVisualizer.exit();
        const ap = window.AudioPlayer;
        return {
            view: ap.currentView,
            activeSubtab: document.querySelector(".player-subtab-btn.active") ? document.querySelector(".player-subtab-btn.active").getAttribute("data-pview") : null,
            nowPlayingDisplay: document.getElementById("player-view-now-playing") ? document.getElementById("player-view-now-playing").style.display : null,
            albumsDisplay: document.getElementById("player-view-albums") ? document.getElementById("player-view-albums").style.display : null
        };
    })()
    """)
    print("Step 7 (Enter and exit when on now-playing):", res7)

finally:
    try:
        chrome_proc.terminate()
        server_proc.terminate()
    except Exception:
        pass

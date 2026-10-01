import json
import base64
import urllib.request
import websocket
import subprocess
import time
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = Path(r"C:\Users\miche\.gemini\antigravity\brain\058353d3-7e85-44af-978a-b4f362fced4b\audit_screenshots")
PORT = 8017
CDP_PORT = 9223

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# 1. Start backend server
env = os.environ.copy()
env["PYTHONUNBUFFERED"] = "1"
server_proc = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "backend.app:app", "--port", str(PORT), "--log-level", "warning"],
    cwd=str(ROOT),
    env=env
)
time.sleep(2)

# 2. Launch headless Chrome with CDP
chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
chrome_proc = subprocess.Popen(
    [
        chrome_path,
        f"--remote-debugging-port={CDP_PORT}",
        "--remote-allow-origins=*",
        "--headless=new",
        "--disable-gpu",
        "--window-size=937,1024",
        f"http://localhost:{PORT}"
    ],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL
)
time.sleep(2)

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
        payload = {"id": self.msg_id, "method": method}
        if params:
            payload["params"] = params
        self.ws.send(json.dumps(payload))
        while True:
            res = json.loads(self.ws.recv())
            if res.get("id") == self.msg_id:
                return res.get("result", {})

    def evaluate(self, expression):
        res = self.send("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True
        })
        return res.get("result", {}).get("value")

    def capture_screenshot(self, output_path):
        res = self.send("Page.captureScreenshot", {"format": "png"})
        data = base64.b64decode(res["data"])
        with open(output_path, "wb") as f:
            f.write(data)
        print(f"Captured: {output_path.name}")

    def close(self):
        if self.ws:
            self.ws.close()

try:
    cdp = CDPClient(CDP_PORT)
    cdp.connect()
    time.sleep(1)

    # Test 1: Verify elements and open video modal
    print("Testing Video Modal with Cast Button...")
    eval_script = """
    (() => {
        const item = {
            id: "vid_test",
            title: "Renaud - Toujours debout (Clip Officiel)",
            artist: "Renaud",
            url: "https://www.youtube.com/watch?v=mock",
            thumbnail: "/static/placeholder-cover.svg"
        };
        window.openVideoModal(item);
        const castBtn = document.getElementById("video-cast-btn");
        const video = document.getElementById("video-modal-player");
        const headerAmbBtn = document.getElementById("btn-ambient-mode");
        return {
            hasCastBtn: Boolean(castBtn && castBtn.offsetParent !== null),
            controlsList: video.getAttribute("controlsList"),
            hasNoRemotePlayback: video.getAttribute("controlsList")?.includes("noremoteplayback"),
            hasDisablePiP: video.hasAttribute("disablePictureInPicture"),
            isHeaderAmbientHidden: Boolean(!headerAmbBtn || headerAmbBtn.offsetParent === null || window.getComputedStyle(headerAmbBtn).display === "none")
        };
    })()
    """
    res1 = cdp.evaluate(eval_script)
    print("Test 1 Result:", res1)
    time.sleep(1)
    cdp.capture_screenshot(OUTPUT_DIR / "60_video_grand_theater_with_cast_button.png")

    # Test 2: Enter Mode Ambiance and check video PiP position (active)
    print("Testing Mode Ambiance Video PiP positioning (Active)...")
    eval_ambient = """
    (() => {
        window.AmbientVisualizer.enter();
        const dialog = document.getElementById("video-theater-dialog");
        const rect = dialog.getBoundingClientRect();
        const computed = window.getComputedStyle(dialog);
        const badge = document.querySelector(".ambient-badge");
        const badgeRect = badge ? badge.getBoundingClientRect() : null;

        return {
            isAmbientActive: document.body.classList.contains("ambient-mode-active"),
            rect: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height },
            windowHeight: window.innerHeight,
            bottomCss: computed.bottom,
            topCss: computed.top,
            badgeRect: badgeRect ? { top: badgeRect.top, bottom: badgeRect.bottom, left: badgeRect.left } : null,
            isCollidingWithBadge: badgeRect ? (rect.top < badgeRect.bottom && rect.left < badgeRect.right && rect.right > badgeRect.left) : false
        };
    })()
    """
    res2 = cdp.evaluate(eval_ambient)
    print("Test 2 Result (Ambient Mode Positioning Active):", json.dumps(res2, indent=2))
    time.sleep(1)
    cdp.capture_screenshot(OUTPUT_DIR / "61_video_ambient_mode_bottom_left_pip.png")

    # Test 2b: Test Idle State (descends all the way to bottom)
    print("Testing Mode Ambiance Video PiP positioning (Idle - Descends to bottom)...")
    eval_idle = """
    (() => {
        document.body.classList.add("ambient-idle");
        const dialog = document.getElementById("video-theater-dialog");
        const rect = dialog.getBoundingClientRect();
        return {
            isIdle: document.body.classList.contains("ambient-idle"),
            rect: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height },
            distanceFromBottom: window.innerHeight - rect.bottom
        };
    })()
    """
    res2b = cdp.evaluate(eval_idle)
    print("Test 2b Result (Idle Descent):", json.dumps(res2b, indent=2))
    time.sleep(1)
    cdp.capture_screenshot(OUTPUT_DIR / "63_video_ambient_mode_idle_flush_bottom.png")

    # Test 3: Click PiP vignette in ambient mode to exit and return to grand theater
    print("Testing Click to exit ambient mode and return to theater...")
    cdp.evaluate("""
    (() => {
        document.getElementById("video-theater-dialog").click();
    })()
    """)
    time.sleep(1)
    eval_return = """
    (() => {
        return {
            isAmbientActive: document.body.classList.contains("ambient-mode-active"),
            isVideoActive: document.body.classList.contains("video-playback-active"),
            dialogRect: document.getElementById("video-theater-dialog").getBoundingClientRect()
        };
    })()
    """
    res3 = cdp.evaluate(eval_return)
    print("Test 3 Result (Restored Theater):", res3)
    cdp.capture_screenshot(OUTPUT_DIR / "62_video_theater_restored_from_pip.png")

    cdp.close()
    print("All tests completed successfully!")

finally:
    try:
        chrome_proc.terminate()
    except Exception:
        pass
    try:
        server_proc.terminate()
    except Exception:
        pass

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
sys.stdout.reconfigure(encoding="utf-8")
OUTPUT_DIR = Path(r"C:\Users\miche\.gemini\antigravity\brain\058353d3-7e85-44af-978a-b4f362fced4b\audit_screenshots")
PORT = 8025
CDP_PORT = 9231

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# 1. Start backend server
env = os.environ.copy()
env["PYTHONUNBUFFERED"] = "1"
server_proc = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "backend.app:app", "--port", str(PORT), "--log-level", "warning"],
    cwd=str(ROOT),
    env=env
)
time.sleep(2.5)

# 2. Launch headless Chrome with CDP
chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
chrome_proc = subprocess.Popen(
    [
        chrome_path,
        f"--remote-debugging-port={CDP_PORT}",
        "--remote-allow-origins=*",
        "--headless=new",
        "--disable-gpu",
        "--window-size=1200,900",
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

    # Ouvrir la vidéo et passer en Mode Ambiance
    cdp.evaluate("""
    (() => {
        openVideoModal({
            id: 'mock_vid_test',
            title: 'Renaud - Toujours debout (Clip Officiel)',
            artist: 'Renaud',
            url: 'https://www.youtube.com/watch?v=mock_vid_test',
            thumbnail: '/static/placeholder-cover.svg'
        });
        const v = document.getElementById('video-modal-player');
        if (v) {
            Object.defineProperty(v, 'paused', { value: false, configurable: true });
            Object.defineProperty(v, 'readyState', { value: 4, configurable: true });
            Object.defineProperty(v, 'currentTime', { value: 42, configurable: true });
            Object.defineProperty(v, 'duration', { value: 240, configurable: true });
            v.dispatchEvent(new Event('play'));
        }
        if (window.AmbientVisualizer) {
            window.AmbientVisualizer.enter();
        }
    })()
    """)
    time.sleep(1)

    # Injecter les styles raffinés des satellites extérieurs
    cdp.evaluate("""
    (() => {
        let style = document.getElementById('refined-arrow-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'refined-arrow-style';
            document.head.appendChild(style);
        }
        style.innerHTML = `
            body.ambient-mode-active .video-dialog {
                overflow: visible !important;
            }
            body.ambient-mode-active .video-modal-body,
            body.ambient-mode-active .video-player-container,
            body.ambient-mode-active .video-modal-player {
                border-radius: 10px;
                overflow: hidden !important;
            }
            .video-ambient-nav {
                position: absolute;
                inset: -52px;
                pointer-events: none;
                z-index: 35;
                opacity: 1 !important;
            }
            /* Pont invisible pour préserver le hover quand la souris sort de la boîte vidéo vers la flèche */
            body.ambient-mode-active .video-dialog::before {
                content: '';
                position: absolute;
                inset: -54px;
                z-index: 10;
                pointer-events: auto;
            }
            .video-modal-body {
                position: relative;
                z-index: 15;
            }
            .video-ambient-nav {
                z-index: 30;
            }
            .btn-ambient-arrow {
                position: absolute;
                width: 42px;
                height: 42px;
                border-radius: 50%;
                background: rgba(6, 9, 20, 0.94);
                border: 2px solid #00f0ff;
                color: #00f0ff;
                box-shadow: 0 0 20px rgba(0, 240, 255, 0.7), 0 4px 14px rgba(0, 0, 0, 0.8), inset 0 0 10px rgba(0, 240, 255, 0.25);
                display: none;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                pointer-events: auto;
                outline: none;
                transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), background 0.2s ease, box-shadow 0.2s ease;
            }
            .btn-ambient-arrow:hover {
                background: #00f0ff;
                color: #05070f;
                box-shadow: 0 0 28px rgba(0, 240, 255, 1), 0 0 12px #ffffff;
                transform: scale(1.15);
            }
            .btn-ambient-arrow.arrow-left {
                left: -48px;
                top: 50%;
                transform: translateY(-50%);
            }
            .btn-ambient-arrow.arrow-left:hover {
                transform: translateY(-50%) scale(1.15);
            }
            .btn-ambient-arrow.arrow-right {
                right: -48px;
                top: 50%;
                transform: translateY(-50%);
            }
            .btn-ambient-arrow.arrow-right:hover {
                transform: translateY(-50%) scale(1.15);
            }
            .btn-ambient-arrow.arrow-up {
                top: -48px;
                left: 50%;
                transform: translateX(-50%);
            }
            .btn-ambient-arrow.arrow-up:hover {
                transform: translateX(-50%) scale(1.15);
            }
            .btn-ambient-arrow.arrow-down {
                bottom: -48px;
                left: 50%;
                transform: translateX(-50%);
            }
            .btn-ambient-arrow.arrow-down:hover {
                transform: translateX(-50%) scale(1.15);
            }
        `;
    })()
    """)
    time.sleep(0.5)

    # 1. Capture Position Centre-Bas (Flèches Gauche, Droite, Haut)
    cdp.evaluate("window.setVideoAmbientPosition('bottom-center')")
    time.sleep(0.5)
    cdp.capture_screenshot(OUTPUT_DIR / "73_refined_pos_bottom_center.png")

    # 2. Capture Position Gauche (Flèche Droite seule)
    cdp.evaluate("window.setVideoAmbientPosition('bottom-left')")
    time.sleep(0.5)
    cdp.capture_screenshot(OUTPUT_DIR / "74_refined_pos_bottom_left.png")

    # 3. Capture Position Droite (Flèche Gauche seule)
    cdp.evaluate("window.setVideoAmbientPosition('bottom-right')")
    time.sleep(0.5)
    cdp.capture_screenshot(OUTPUT_DIR / "75_refined_pos_bottom_right.png")

    # 4. Capture Position Grand Centre (Flèche Bas seule)
    cdp.evaluate("window.setVideoAmbientPosition('center')")
    time.sleep(0.5)
    cdp.capture_screenshot(OUTPUT_DIR / "76_refined_pos_grand_center.png")

    print("Capture des 4 positions raffinées réussie !")

finally:
    cdp.close()
    chrome_proc.kill()
    server_proc.kill()

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
PORT = 8023
CDP_PORT = 9229

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

    # Forcer la visibilité des flèches pour le test
    cdp.evaluate("""
    (() => {
        const nav = document.getElementById('video-ambient-nav');
        if (nav) nav.style.opacity = '1';
    })()
    """)

    # Test Variante A : OUTSIDE (Satellites flottants extérieurs)
    cdp.evaluate("""
    (() => {
        let style = document.getElementById('test-arrow-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'test-arrow-style';
            document.head.appendChild(style);
        }
        style.innerHTML = `
            body.ambient-mode-active .video-dialog {
                overflow: visible !important;
            }
            body.ambient-mode-active .video-modal-body {
                border-radius: 10px;
                overflow: hidden !important;
            }
            .video-ambient-nav {
                position: absolute;
                inset: -54px;
                pointer-events: none;
                z-index: 35;
                opacity: 1 !important;
            }
            .video-ambient-nav::before {
                content: '';
                position: absolute;
                inset: 0;
                pointer-events: auto;
                z-index: -1;
            }
            .btn-ambient-arrow {
                position: absolute;
                width: 42px;
                height: 42px;
                border-radius: 50%;
                background: rgba(8, 12, 24, 0.94);
                border: 2px solid #00f0ff;
                color: #00f0ff;
                box-shadow: 0 0 20px rgba(0, 240, 255, 0.75), 0 4px 16px rgba(0, 0, 0, 0.8), inset 0 0 10px rgba(0, 240, 255, 0.3);
                display: none;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                pointer-events: auto;
                outline: none;
            }
            .btn-ambient-arrow.arrow-left {
                left: -50px;
                top: 50%;
                transform: translateY(-50%);
            }
            .btn-ambient-arrow.arrow-right {
                right: -50px;
                top: 50%;
                transform: translateY(-50%);
            }
            .btn-ambient-arrow.arrow-up {
                top: -50px;
                left: 50%;
                transform: translateX(-50%);
            }
            .btn-ambient-arrow.arrow-down {
                bottom: -50px;
                left: 50%;
                transform: translateX(-50%);
            }
            body.ambient-mode-active .video-dialog.ambient-pos-bottom-center #btn-ambient-move-left,
            body.ambient-mode-active .video-dialog.ambient-pos-bottom-center #btn-ambient-move-right,
            body.ambient-mode-active .video-dialog.ambient-pos-bottom-center #btn-ambient-move-up {
                display: flex !important;
            }
        `;
    })()
    """)
    time.sleep(0.5)
    cdp.capture_screenshot(OUTPUT_DIR / "70_variant_outside_satellites.png")

    # Test Variante B : INSIDE (Intérieur avec marge propre 14px)
    cdp.evaluate("""
    (() => {
        const style = document.getElementById('test-arrow-style');
        style.innerHTML = `
            body.ambient-mode-active .video-dialog {
                overflow: hidden !important;
            }
            .video-ambient-nav {
                position: absolute;
                inset: 0;
                pointer-events: none;
                z-index: 35;
                opacity: 1 !important;
            }
            .btn-ambient-arrow {
                position: absolute;
                width: 38px;
                height: 38px;
                border-radius: 50%;
                background: rgba(8, 12, 24, 0.88);
                border: 2px solid #00f0ff;
                color: #00f0ff;
                box-shadow: 0 0 16px rgba(0, 240, 255, 0.65), 0 4px 14px rgba(0, 0, 0, 0.7);
                display: none;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                pointer-events: auto;
                outline: none;
            }
            .btn-ambient-arrow.arrow-left {
                left: 14px;
                top: 50%;
                transform: translateY(-50%);
            }
            .btn-ambient-arrow.arrow-right {
                right: 14px;
                top: 50%;
                transform: translateY(-50%);
            }
            .btn-ambient-arrow.arrow-up {
                top: 14px;
                left: 50%;
                transform: translateX(-50%);
            }
            .btn-ambient-arrow.arrow-down {
                bottom: 14px;
                left: 50%;
                transform: translateX(-50%);
            }
            body.ambient-mode-active .video-dialog.ambient-pos-bottom-center #btn-ambient-move-left,
            body.ambient-mode-active .video-dialog.ambient-pos-bottom-center #btn-ambient-move-right,
            body.ambient-mode-active .video-dialog.ambient-pos-bottom-center #btn-ambient-move-up {
                display: flex !important;
            }
        `;
    })()
    """)
    time.sleep(0.5)
    cdp.capture_screenshot(OUTPUT_DIR / "71_variant_inside_inset.png")

    # Test Variante C : Floating Top-Center Controls / D-Pad Dock
    cdp.evaluate("""
    (() => {
        const style = document.getElementById('test-arrow-style');
        style.innerHTML = `
            body.ambient-mode-active .video-dialog {
                overflow: visible !important;
            }
            body.ambient-mode-active .video-modal-body {
                border-radius: 10px;
                overflow: hidden !important;
            }
            .video-ambient-nav {
                position: absolute;
                top: -46px;
                left: 50%;
                transform: translateX(-50%);
                display: flex !important;
                gap: 8px;
                background: rgba(8, 12, 24, 0.92);
                border: 1.5px solid #00f0ff;
                padding: 4px 10px;
                border-radius: 30px;
                box-shadow: 0 0 20px rgba(0, 240, 255, 0.6), 0 4px 16px rgba(0,0,0,0.8);
                pointer-events: auto;
                z-index: 40;
                opacity: 1 !important;
            }
            .btn-ambient-arrow {
                position: static !important;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                background: rgba(0, 240, 255, 0.1);
                border: 1px solid rgba(0, 240, 255, 0.6);
                color: #00f0ff;
                display: none;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                outline: none;
                transition: all 0.2s ease;
            }
            .btn-ambient-arrow:hover {
                background: #00f0ff;
                color: #05070f;
                box-shadow: 0 0 15px #00f0ff;
            }
            body.ambient-mode-active .video-dialog.ambient-pos-bottom-center #btn-ambient-move-left,
            body.ambient-mode-active .video-dialog.ambient-pos-bottom-center #btn-ambient-move-right,
            body.ambient-mode-active .video-dialog.ambient-pos-bottom-center #btn-ambient-move-up {
                display: flex !important;
            }
        `;
    })()
    """)
    time.sleep(0.5)
    cdp.capture_screenshot(OUTPUT_DIR / "72_variant_top_dock_pill.png")

    print("Test terminé avec succès !")

finally:
    cdp.close()
    chrome_proc.kill()
    server_proc.kill()

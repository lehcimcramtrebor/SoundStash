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
OUTPUT_DIR = Path(r"C:\Users\miche\Documents\GitHub\SoundStash")
SCREENSHOTS_DIR = Path(r"C:\Users\miche\.gemini\antigravity\brain\394f195b-cdad-4848-aa3b-3af134a2c231\screenshots")
PORT = 8057
CDP_PORT = 9267

SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

print("=== TEST AUTOMATISÉ : PHASE 163 - SUPPRESSION DU ZOOM SURVOL SOUS-ONGLET EN COURS D'ÉCOUTE ===")

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
        payload = {"id": self.msg_id, "method": method}
        if params:
            payload["params"] = params
        self.ws.send(json.dumps(payload))
        while True:
            resp = json.loads(self.ws.recv())
            if resp.get("id") == self.msg_id:
                return resp.get("result")

    def eval(self, expr):
        res = self.send("Runtime.evaluate", {
            "expression": expr,
            "returnByValue": True,
            "awaitPromise": True
        })
        if "exceptionDetails" in res:
            raise RuntimeError(res["exceptionDetails"])
        return res.get("result", {}).get("value")

    def screenshot(self, path, clip=None):
        params = {"format": "png"}
        if clip:
            params["clip"] = clip
        res = self.send("Page.captureScreenshot", params)
        data = base64.b64decode(res["data"])
        with open(path, "wb") as f:
            f.write(data)

try:
    cdp = CDPClient(CDP_PORT)
    cdp.connect()

    time.sleep(3)

    # Fermer l'assistant de bienvenue
    cdp.eval("""(() => {
        const wiz = document.getElementById("welcome-wizard-backdrop");
        if (wiz) wiz.style.display = "none";
        try { localStorage.setItem("soundstash_welcome_dismissed", "true"); } catch (_) {}
    })()""")
    time.sleep(0.5)

    # Activer l'état is-playing sur #player-subtab-now-playing
    btn_info = cdp.eval("""(() => {
        const btn = document.getElementById("player-subtab-now-playing");
        if (!btn) return { error: "bouton introuvable" };
        btn.classList.add("is-playing");
        const rect = btn.getBoundingClientRect();
        return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            centerX: rect.x + rect.width / 2,
            centerY: rect.y + rect.height / 2
        };
    })()""")

    print(f"Bouton trouvé aux coordonnées : {btn_info}")

    # Simuler le survol souris sur le bouton via Input.dispatchMouseEvent
    cdp.send("Input.dispatchMouseEvent", {
        "type": "mouseMoved",
        "x": btn_info["centerX"],
        "y": btn_info["centerY"]
    })
    time.sleep(0.3)

    hover_info = cdp.eval("""(() => {
        const btn = document.getElementById("player-subtab-now-playing");
        const style = window.getComputedStyle(btn);
        const rect = btn.getBoundingClientRect();
        return {
            transform: style.transform,
            height: rect.height,
            top: rect.top,
            borderColor: style.borderColor,
            boxShadow: style.boxShadow
        };
    })()""")

    print("Résultat au survol :")
    print(f"  - transform: {hover_info.get('transform')} (attendu: 'none')")
    print(f"  - border-color: {hover_info.get('borderColor')}")
    print(f"  - box-shadow: {hover_info.get('boxShadow')}")
    print(f"  - height: {hover_info.get('height')}px")

    assert hover_info.get("transform") == "none", f"Erreur: transform doit être 'none', reçu: {hover_info.get('transform')}"
    print("=> VALIDATION : Aucun zoom ou translation au survol !")

    # Capture d'écran ciblée de la zone des sous-onglets
    clip_area = {
        "x": max(0, btn_info["x"] - 250),
        "y": max(0, btn_info["y"] - 30),
        "width": min(1600, btn_info["width"] + 300),
        "height": 100,
        "scale": 1
    }
    screenshot_path = SCREENSHOTS_DIR / "phase163_subtab_hover_no_zoom.png"
    cdp.screenshot(screenshot_path, clip=clip_area)
    print(f"Capture enregistrée : {screenshot_path.name}")

finally:
    chrome_proc.kill()
    server_proc.kill()

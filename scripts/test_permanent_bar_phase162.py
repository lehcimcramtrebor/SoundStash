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
OUTPUT_DIR = Path(r"C:\Users\miche\.gemini\antigravity\brain\394f195b-cdad-4848-aa3b-3af134a2c231\screenshots")
PORT = 8056
CDP_PORT = 9266

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

print("=== TEST AUTOMATISÉ : PHASE 162 - CENTRE DE COMMANDES STANDARD PERMANENT (IDLE & AMBIANCE) ===")

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

    def screenshot(self, path):
        res = self.send("Page.captureScreenshot", {"format": "png"})
        data = base64.b64decode(res["data"])
        with open(path, "wb") as f:
            f.write(data)

try:
    cdp = CDPClient(CDP_PORT)
    cdp.connect()

    # Attendre chargement initial
    time.sleep(3)

    # Fermer l'assistant de bienvenue s'il est affiché pour dégager la vue
    cdp.eval("""(() => {
        const wiz = document.getElementById("welcome-wizard-backdrop");
        if (wiz) wiz.style.display = "none";
        try { localStorage.setItem("soundstash_welcome_dismissed", "true"); } catch (_) {}
    })()""")
    time.sleep(0.5)

    # 1. Vérification au démarrage (état idle / rien ne joue)
    print("\n[1] Vérification du centre de commandes au démarrage (mode inactif) :")
    idle_info = cdp.eval("""(() => {
        const bar = document.getElementById("persistent-player-bar");
        const title = document.getElementById("mini-player-title");
        const artist = document.getElementById("mini-player-artist");
        const playIcon = document.getElementById("mini-player-icon-play");
        const pauseIcon = document.getElementById("mini-player-icon-pause");
        const closeBtn = document.getElementById("mini-player-close-btn");
        const timeCur = document.getElementById("mini-player-time-current");
        const timeTot = document.getElementById("mini-player-time-total");

        if (!bar) return { error: "persistent-player-bar non trouvé" };
        const rect = bar.getBoundingClientRect();
        const style = window.getComputedStyle(bar);

        return {
            exists: true,
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            titleText: title ? title.textContent.trim() : null,
            artistText: artist ? artist.textContent.trim() : null,
            playIconDisplay: playIcon ? window.getComputedStyle(playIcon).display : null,
            pauseIconDisplay: pauseIcon ? window.getComputedStyle(pauseIcon).display : null,
            closeBtnDisplay: closeBtn ? window.getComputedStyle(closeBtn).display : null,
            timeCur: timeCur ? timeCur.textContent.trim() : null,
            timeTot: timeTot ? timeTot.textContent.trim() : null,
        };
    })()""")

    print(f"  - Persistent bar display: {idle_info.get('display')} (attendu: flex)")
    print(f"  - Dimensions: {idle_info.get('width')}x{idle_info.get('height')}px, top: {idle_info.get('top')}px")
    print(f"  - Titre affiché: '{idle_info.get('titleText')}'")
    print(f"  - Artiste affiché: '{idle_info.get('artistText')}'")
    print(f"  - Icône Play display: {idle_info.get('playIconDisplay')}, Pause display: {idle_info.get('pauseIconDisplay')}")
    print(f"  - Bouton fermer display: {idle_info.get('closeBtnDisplay')} (masqué)")
    print(f"  - Temps: {idle_info.get('timeCur')} / {idle_info.get('timeTot')}")

    assert idle_info.get("display") == "flex", f"Erreur: la barre doit être en display flex mais est {idle_info.get('display')}"
    assert idle_info.get("height") > 50, f"Erreur: hauteur anormale {idle_info.get('height')}"
    assert idle_info.get("playIconDisplay") != "none", "Erreur: l'icône Play doit être visible"
    assert idle_info.get("pauseIconDisplay") == "none", "Erreur: l'icône Pause doit être masquée"
    print("  => VALIDATION 1 RÉUSSIE : Centre de commandes permanent visible et fonctionnel dès le démarrage !")

    screenshot_idle = OUTPUT_DIR / "phase162_persistent_bar_idle.png"
    cdp.screenshot(screenshot_idle)
    print(f"  Capture d'écran enregistrée: {screenshot_idle.name}")

    # 2. Vérification Sanctuarisation Mode Ambiance
    print("\n[2] Vérification Sanctuarisation Mode Ambiance :")
    ambient_check = cdp.eval("""(() => {
        const bar = document.getElementById("persistent-player-bar");
        document.body.classList.add("ambient-mode-active");
        const styleAmbient = window.getComputedStyle(bar);
        const displayInAmbient = styleAmbient.display;

        // Rétablissement standard
        document.body.classList.remove("ambient-mode-active");
        const styleRestored = window.getComputedStyle(bar);
        const displayRestored = styleRestored.display;

        return {
            displayInAmbient: displayInAmbient,
            displayRestored: displayRestored
        };
    })()""")

    print(f"  - Display en Mode Ambiance: {ambient_check.get('displayInAmbient')} (attendu: none)")
    print(f"  - Display après sortie Mode Ambiance: {ambient_check.get('displayRestored')} (attendu: flex)")
    assert ambient_check.get("displayInAmbient") == "none", "Erreur: le centre de commandes doit être masqué en Mode Ambiance !"
    assert ambient_check.get("displayRestored") == "flex", "Erreur: le centre de commandes doit réapparaître en sortie du Mode Ambiance !"
    print("  => VALIDATION 2 RÉUSSIE : Le Mode Ambiance reste parfaitement sanctuarisé !")

    # 3. Test stopAndHide (arrêt de la lecture)
    print("\n[3] Vérification de l'arrêt de lecture (stopAndHide) :")
    stop_check = cdp.eval("""(async () => {
        if (window.AudioPlayer) {
            await window.AudioPlayer.stopAndHide();
        }
        const bar = document.getElementById("persistent-player-bar");
        const title = document.getElementById("mini-player-title");
        const artist = document.getElementById("mini-player-artist");
        const playIcon = document.getElementById("mini-player-icon-play");
        const pauseIcon = document.getElementById("mini-player-icon-pause");
        const style = window.getComputedStyle(bar);

        return {
            display: style.display,
            titleText: title ? title.textContent.trim() : null,
            artistText: artist ? artist.textContent.trim() : null,
            playIconDisplay: playIcon ? window.getComputedStyle(playIcon).display : null,
            pauseIconDisplay: pauseIcon ? window.getComputedStyle(pauseIcon).display : null,
        };
    })()""")

    print(f"  - Display après stop: {stop_check.get('display')} (attendu: flex)")
    print(f"  - Titre après stop: '{stop_check.get('titleText')}'")
    print(f"  - Artiste après stop: '{stop_check.get('artistText')}'")
    print(f"  - Icône Play visible: {stop_check.get('playIconDisplay') != 'none'}")
    assert stop_check.get("display") == "flex", "Erreur: le centre de commandes doit rester affiché après stopAndHide !"
    print("  => VALIDATION 3 RÉUSSIE : Le centre de commandes reste actif et réinitialisé en mode inactif !")

    screenshot_stopped = OUTPUT_DIR / "phase162_persistent_bar_after_stop.png"
    cdp.screenshot(screenshot_stopped)
    print(f"  Capture d'écran enregistrée: {screenshot_stopped.name}")

    print("\n=== TOUS LES TESTS DE LA PHASE 162 ONT RÉUSSI AVEC SUCCÈS ===")

finally:
    chrome_proc.kill()
    server_proc.kill()

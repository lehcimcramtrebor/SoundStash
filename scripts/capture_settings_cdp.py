import os
import sys
import json
import time
import base64
import subprocess
import urllib.request
from pathlib import Path
import websocket

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
OUTPUT_DIR = Path(r"C:\Users\miche\.gemini\antigravity\brain\058353d3-7e85-44af-978a-b4f362fced4b\audit_screenshots")
PORT = 8015
DEBUG_PORT = 9225
BASE_URL = f"http://127.0.0.1:{PORT}"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

class CDPClient:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=10)
        self.msg_id = 0

    def call(self, method, params=None):
        self.msg_id += 1
        payload = {"id": self.msg_id, "method": method, "params": params or {}}
        self.ws.send(json.dumps(payload))
        while True:
            resp = json.loads(self.ws.recv())
            if resp.get("id") == self.msg_id:
                return resp.get("result", {})

    def evaluate(self, expression):
        res = self.call("Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True})
        return res.get("result", {}).get("value")

    def capture_screenshot(self, output_path):
        res = self.call("Page.captureScreenshot", {"format": "png"})
        data = base64.b64decode(res["data"])
        with open(output_path, "wb") as f:
            f.write(data)
        print(f"  [OK] Enregistré : {output_path.name} ({len(data) // 1024} Ko)")

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass

def wait_for_server(port, timeout=15):
    start = time.time()
    while time.time() - start < timeout:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/config", timeout=1) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.3)
    return False

def get_page_ws_url(debug_port):
    with urllib.request.urlopen(f"http://127.0.0.1:{debug_port}/json") as r:
        tabs = json.loads(r.read())
        for tab in tabs:
            if tab.get("type") == "page" and "webSocketDebuggerUrl" in tab:
                return tab["webSocketDebuggerUrl"]
    raise RuntimeError("Aucun onglet de page trouvé sur Chrome")

def main():
    print(f"=== Capture précise via Chrome CDP sur http://127.0.0.1:{PORT} ===")
    
    server_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.app:app", "--port", str(PORT), "--log-level", "warning"],
        cwd=str(Path(__file__).resolve().parent.parent)
    )

    chrome_proc = None
    cdp = None
    try:
        if not wait_for_server(PORT):
            print("ERREUR: Le serveur backend n'a pas répondu.")
            return

        print("Lancement de Chrome headless avec DevTools...")
        chrome_user_dir = f"C:\\Users\\miche\\AppData\\Local\\Temp\\chrome_cdp_{os.getpid()}"
        chrome_proc = subprocess.Popen([
            CHROME_PATH,
            "--headless=new",
            f"--remote-debugging-port={DEBUG_PORT}",
            "--remote-allow-origins=*",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--hide-scrollbars",
            "--window-size=1280,850",
            f"--user-data-dir={chrome_user_dir}",
            f"{BASE_URL}/?theme=dark"
        ])

        time.sleep(2.0)
        ws_url = get_page_ws_url(DEBUG_PORT)
        cdp = CDPClient(ws_url)
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")

        print("1. Capture Atelier avec roue crantée...")
        time.sleep(1.0)
        cdp.capture_screenshot(OUTPUT_DIR / "37_dark_atelier_with_settings_gear.png")

        print("2. Capture Mode Lecteur avec roue crantée...")
        cdp.evaluate("switchMode('player')")
        time.sleep(1.0)
        cdp.capture_screenshot(OUTPUT_DIR / "38_dark_player_with_settings_gear.png")

        print("3. Retour Atelier & Ouverture Modale Paramètres (Sous-onglet Musique Dark)...")
        cdp.evaluate("switchMode('atelier')")
        time.sleep(0.5)
        cdp.evaluate("openSettingsModal('subtab-music')")
        time.sleep(0.8)
        cdp.capture_screenshot(OUTPUT_DIR / "39_dark_settings_music_subtab.png")

        print("4. Capture Modale Paramètres Musique (Thème Clair)...")
        cdp.evaluate("document.documentElement.setAttribute('data-theme', 'light')")
        time.sleep(0.6)
        cdp.capture_screenshot(OUTPUT_DIR / "40_light_settings_music_subtab.png")

        print("5. Retour Dark & Sous-onglet Hub Vidéos...")
        cdp.evaluate("document.documentElement.setAttribute('data-theme', 'dark')")
        cdp.evaluate("switchSettingsSubtab('subtab-video')")
        time.sleep(0.6)
        cdp.capture_screenshot(OUTPUT_DIR / "41_dark_settings_video_subtab.png")

        print("6. Sous-onglet Système & Préférences...")
        cdp.evaluate("switchSettingsSubtab('subtab-system')")
        time.sleep(0.6)
        cdp.capture_screenshot(OUTPUT_DIR / "42_dark_settings_system_subtab.png")

        print("7. Sous-onglet Diagnostic & Maintenance...")
        cdp.evaluate("switchSettingsSubtab('subtab-maintenance')")
        time.sleep(0.8)
        cdp.capture_screenshot(OUTPUT_DIR / "43_dark_settings_maintenance_subtab.png")

        print("\nToutes les captures CDP ont réussi avec succès !")

    finally:
        if cdp:
            cdp.close()
        if chrome_proc:
            chrome_proc.terminate()
            try:
                chrome_proc.wait(timeout=2)
            except Exception:
                chrome_proc.kill()
        if server_proc:
            server_proc.terminate()
            try:
                server_proc.wait(timeout=2)
            except Exception:
                server_proc.kill()
        print("Nettoyage terminé.")

if __name__ == "__main__":
    main()

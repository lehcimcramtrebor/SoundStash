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
PORT = 8016
DEBUG_PORT = 9226
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
    print(f"=== Capture Toast au Premier Plan via Chrome CDP ({PORT}) ===")
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

        chrome_user_dir = f"C:\\Users\\miche\\AppData\Local\\Temp\\chrome_cdp_toast_{os.getpid()}"
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
            f"{BASE_URL}/"
        ])

        time.sleep(2.0)
        ws_url = get_page_ws_url(DEBUG_PORT)
        cdp = CDPClient(ws_url)
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")

        # 1. Dark Mode : Ouvrir la modale paramètres et déclencher un toast de succès
        print("1. Dark Mode : Ouverture modale Paramètres + Toast de succès...")
        cdp.evaluate("""
            document.documentElement.setAttribute('data-theme', 'dark');
            openSettingsModal();
            showToast("Paramètres enregistrés avec succès.", "success");
        """)
        time.sleep(0.8)
        cdp.capture_screenshot(OUTPUT_DIR / "46_dark_settings_with_toast.png")

        # 2. Light Mode : Même vue avec le thème clair
        print("2. Light Mode : Modale Paramètres + Toast en mode clair...")
        cdp.evaluate("""
            document.documentElement.setAttribute('data-theme', 'light');
            showToast("Bibliothèque musicale synchronisée (283 albums).", "info");
        """)
        time.sleep(0.8)
        cdp.capture_screenshot(OUTPUT_DIR / "47_light_settings_with_toast.png")

        print("=== Captures terminées avec succès ===")

    finally:
        if cdp:
            cdp.close()
        if chrome_proc:
            chrome_proc.terminate()
            chrome_proc.wait(timeout=3)
        if server_proc:
            server_proc.terminate()
            server_proc.wait(timeout=3)

if __name__ == "__main__":
    main()

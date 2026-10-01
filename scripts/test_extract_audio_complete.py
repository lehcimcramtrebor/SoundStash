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
sys.path.insert(0, str(ROOT))
sys.stdout.reconfigure(encoding="utf-8")
OUTPUT_DIR = Path(r"C:\Users\miche\.gemini\antigravity\brain\058353d3-7e85-44af-978a-b4f362fced4b\audit_screenshots")
PORT = 8031
CDP_PORT = 9243

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

print("=== TEST EXTRACTION AUDIO DEPUIS LE LECTEUR VIDEO ===")

# Démarrer serveur backend
env = os.environ.copy()
env["PYTHONUNBUFFERED"] = "1"
server_proc = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "backend.app:app", "--port", str(PORT), "--log-level", "warning"],
    cwd=str(ROOT),
    env=env
)
time.sleep(2.5)

# Lancer Chrome
chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
chrome_proc = subprocess.Popen(
    [
        chrome_path,
        f"--remote-debugging-port={CDP_PORT}",
        "--remote-allow-origins=*",
        "--headless=new",
        "--disable-gpu",
        "--window-size=1280,920",
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
        print(f"  📸 Capture enregistrée: {output_path.name}")

try:
    cdp = CDPClient(CDP_PORT)
    cdp.connect()
    time.sleep(1.5)

    # 1. Masquer l'assistant si présent et charger la vidéo dans la modale
    print("[1/3] Chargement du clip vidéo local dans le lecteur cinéma...")
    cdp.evaluate("""
        closeWelcomeWizard();
        document.getElementById('welcome-wizard-backdrop').style.display = 'none';
        openLocalVideoModal({
            title: 'Renaud - Toujours debout',
            artist: 'Renaud',
            rel_path: 'Renaud/Renaud - Toujours debout.mp4',
            filepath: 'D:/GoogleDrive/Musique/Mes Vidéos/Renaud/Renaud - Toujours debout.mp4'
        });
    """)
    time.sleep(1)

    # Vérifier que le bouton d'extraction est bien présent et visible
    btn_visible = cdp.evaluate("""
        const btn = document.getElementById('video-modal-extract-audio-btn');
        Boolean(btn && btn.style.display !== 'none' && !btn.disabled)
    """)
    assert btn_visible is True, "Le bouton d'extraction audio doit être visible"
    print("  ✓ Bouton [Extraire en Audio (.m4a)] visible et prêt.")
    cdp.capture_screenshot(OUTPUT_DIR / "92_video_modal_before_extract.png")

    # 2. Cliquer sur le bouton d'extraction audio
    print("[2/3] Clic sur [Extraire en Audio (.m4a)]...")
    cdp.evaluate("""
        document.getElementById('video-modal-extract-audio-btn').click();
    """)
    # Attendre la fin de l'extraction ffmpeg (~3 secondes)
    time.sleep(4)

    # Vérifier les toasts affichés
    toasts = cdp.evaluate("""
        Array.from(document.querySelectorAll('.toast')).map(t => t.textContent.trim())
    """)
    print("  Toasts reçus:", toasts)

    has_success_toast = any("extraite avec succès" in t for t in toasts)
    assert has_success_toast is True, f"Attendu toast de succès, reçu: {toasts}"
    print("  ✓ Toast de succès affiché sans erreur de communication !")
    cdp.capture_screenshot(OUTPUT_DIR / "93_video_modal_extract_success.png")

    # 3. Vérifier sur le disque que le fichier m4a existe
    print("[3/3] Vérification physique du fichier M4A extrait...")
    extracted_file = Path(r"D:\GoogleDrive\Musique\Mes Albums\Renaud\Singles & Rips\Toujours debout.m4a")
    assert extracted_file.exists(), f"Fichier {extracted_file} introuvable sur disque"
    file_size_mb = extracted_file.stat().st_size / (1024 * 1024)
    print(f"  ✓ Fichier audio présent: {extracted_file.name} ({file_size_mb:.2f} Mo)")
    assert file_size_mb > 1.0, "La taille du fichier M4A doit être > 1 Mo"

    print("\n=== TEST D'EXTRACTION AUDIO VALIDE AVEC SUCCES A 100% ===")

finally:
    try:
        chrome_proc.terminate()
        chrome_proc.wait(timeout=2)
    except Exception:
        pass
    try:
        server_proc.terminate()
        server_proc.wait(timeout=2)
    except Exception:
        pass

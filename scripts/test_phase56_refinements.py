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
PORT = 8032
CDP_PORT = 9244

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

print("=== TEST SUITE : PHASE 56 ERGONOMIE, THEME CLAIR/SOMBRE & WATCHER ===")

# Démarrer serveur backend
env = os.environ.copy()
env["PYTHONUNBUFFERED"] = "1"
server_proc = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "backend.app:app", "--port", str(PORT), "--log-level", "warning"],
    cwd=str(ROOT),
    env=env
)
time.sleep(2.5)

# Lancer Chrome Headless
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
            resp = json.loads(self.ws.recv())
            if resp.get("id") == self.msg_id:
                return resp.get("result", {})

    def evaluate(self, expr):
        res = self.send("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
        return res.get("result", {}).get("value")

    def capture_screenshot(self, filename):
        res = self.send("Page.captureScreenshot", {"format": "png"})
        data = base64.b64decode(res["data"])
        out_path = OUTPUT_DIR / filename
        out_path.write_bytes(data)
        print(f"  📸 Capture enregistrée: {filename}")
        return out_path

    def close(self):
        if self.ws:
            self.ws.close()

try:
    cdp = CDPClient(CDP_PORT)
    cdp.connect()
    time.sleep(1.5)

    print("\n[1/5] Vérification de l'En-tête et du Switch Mode Lecteur (Mode Sombre)...")
    has_switch = cdp.evaluate("Boolean(document.getElementById('player-mode-switch-group'))")
    has_checkbox = cdp.evaluate("Boolean(document.getElementById('player-mode-switch-input'))")
    has_fullscreen = cdp.evaluate("Boolean(document.querySelector('.header-actions #floating-fullscreen-btn'))")
    print(f"  ✓ Switch group présent: {has_switch}")
    print(f"  ✓ Checkbox switch présente: {has_checkbox}")
    print(f"  ✓ Bouton plein écran intégré dans header-actions: {has_fullscreen}")
    assert has_switch and has_checkbox and has_fullscreen, "Éléments d'en-tête manquants"
    cdp.capture_screenshot("94_header_dark_mode_with_switch.png")

    print("\n[2/5] Test de la bascule interactive du Switch Mode Lecteur...")
    cdp.evaluate("document.getElementById('player-mode-switch-input').click()")
    time.sleep(0.5)
    is_player_active = cdp.evaluate("document.body.classList.contains('player-mode-active')")
    switch_checked = cdp.evaluate("document.getElementById('player-mode-switch-input').checked")
    switch_has_active_class = cdp.evaluate("document.getElementById('player-mode-switch-group').classList.contains('active')")
    print(f"  ✓ Mode lecteur activé: {is_player_active}, Switch checked: {switch_checked}, Class active: {switch_has_active_class}")
    assert is_player_active and switch_checked and switch_has_active_class, "Échec de bascule Mode Lecteur ON"
    cdp.capture_screenshot("95_player_mode_active_switch.png")

    # Revenir en mode Atelier
    cdp.evaluate("document.getElementById('player-mode-switch-input').click()")
    time.sleep(0.5)
    is_player_active_off = cdp.evaluate("document.body.classList.contains('player-mode-active')")
    print(f"  ✓ Retour à l'Atelier validé: {not is_player_active_off}")

    print("\n[3/5] Test du Thème Clair : En-tête, Manuel d'Aide & Assistant d'Accueil...")
    # Basculer en mode clair
    cdp.evaluate("document.documentElement.setAttribute('data-theme', 'light'); localStorage.setItem('ytm_theme', 'light');")
    time.sleep(0.5)
    cdp.capture_screenshot("96_header_light_mode.png")

    # S'assurer que le wizard d'accueil initial est fermé avant d'ouvrir le grand guide
    cdp.evaluate("if (typeof closeWelcomeWizard === 'function') closeWelcomeWizard();")
    time.sleep(0.3)

    # Ouvrir le grand manuel d'utilisation via le bouton d'aide du header
    cdp.evaluate("document.getElementById('btn-header-help').click()")
    time.sleep(0.6)
    dialog_bg = cdp.evaluate("window.getComputedStyle(document.querySelector('.user-guide-dialog')).backgroundColor")
    title_color = cdp.evaluate("window.getComputedStyle(document.querySelector('.user-guide-title')).color")
    print(f"  ✓ Guide ouvert en mode clair - Fond: {dialog_bg}, Couleur titre: {title_color}")
    cdp.capture_screenshot("97_user_guide_light_mode_clean.png")

    # Fermer le guide
    cdp.evaluate("document.getElementById('close-user-guide-btn').click()")
    time.sleep(0.4)

    # Ouvrir l'assistant d'accueil
    cdp.evaluate("openWelcomeWizard()")
    time.sleep(0.6)
    wizard_bg = cdp.evaluate("window.getComputedStyle(document.querySelector('.welcome-wizard-dialog')).backgroundColor")
    wizard_title_col = cdp.evaluate("window.getComputedStyle(document.querySelector('.welcome-wizard-title')).color")
    print(f"  ✓ Wizard ouvert en mode clair - Fond: {wizard_bg}, Couleur titre: {wizard_title_col}")
    cdp.capture_screenshot("98_welcome_wizard_light_mode_clean.png")

    # Fermer le wizard
    cdp.evaluate("closeWelcomeWizard()")
    time.sleep(0.4)

    print("\n[4/5] Test du Bouton d'Extraction Discret & Modale de Confirmation...")
    # Rétablir le thème sombre
    cdp.evaluate("document.documentElement.setAttribute('data-theme', 'dark'); localStorage.setItem('ytm_theme', 'dark');")
    time.sleep(0.3)

    # Ouvrir le lecteur vidéo avec un clip local
    cdp.evaluate("""
        const clipItem = {
            title: "Renaud - Toujours debout",
            artist: "Renaud",
            rel_path: "Renaud/Renaud - Toujours debout.mp4",
            url: "/api/videos/stream?path=Renaud/Renaud%20-%20Toujours%20debout.mp4",
            is_local: true
        };
        openLocalVideoModal(clipItem);
    """)
    time.sleep(1.0)

    btn_classes = cdp.evaluate("document.getElementById('video-modal-extract-audio-btn').className")
    print(f"  ✓ Classes du bouton d'extraction: {btn_classes}")
    assert "btn-video-extract-audio" in btn_classes, "La classe btn-video-extract-audio doit être présente"
    cdp.capture_screenshot("99_video_modal_discreet_extract_btn.png")

    # Cliquer sur le bouton d'extraction
    cdp.evaluate("document.getElementById('video-modal-extract-audio-btn').click()")
    time.sleep(0.5)

    confirm_modal_active = cdp.evaluate("document.getElementById('custom-modal-backdrop').classList.contains('active')")
    confirm_title = cdp.evaluate("document.getElementById('modal-title').textContent")
    confirm_msg = cdp.evaluate("document.getElementById('modal-message').textContent")
    print(f"  ✓ Modale de confirmation active: {confirm_modal_active}")
    print(f"  ✓ Titre confirmation: '{confirm_title}'")
    print(f"  ✓ Message confirmation: '{confirm_msg}'")
    assert confirm_modal_active, "La modale de confirmation doit s'ouvrir"
    assert "Extraire la piste audio" in confirm_title, "Titre de confirmation attendu"
    assert "Singles & Rips" in confirm_msg, "Destination attendue dans le message"
    cdp.capture_screenshot("100_extract_audio_confirm_modal.png")

    # Cliquer Annuler
    cdp.evaluate("document.getElementById('modal-btn-cancel').click()")
    time.sleep(0.5)
    confirm_closed = not cdp.evaluate("document.getElementById('custom-modal-backdrop').classList.contains('active')")
    print(f"  ✓ Modale refermée après Annuler: {confirm_closed}")
    assert confirm_closed, "La modale de confirmation doit se refermer après Annuler"

    # Fermer le modal vidéo
    cdp.evaluate("closeVideoModal(true)")
    time.sleep(0.4)

    print("\n[5/5] Vérification de la Sensibilité du Watcher (Insensibilité aux dossiers)...")
    from backend.library_sync import LibraryWatcher
    import tempfile

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        artist_dir = tmp_path / "Artiste Test"
        artist_dir.mkdir()
        album_dir = artist_dir / "Album Test"
        album_dir.mkdir()
        audio_file = album_dir / "01 - Piste.m4a"
        audio_file.write_bytes(b"fake audio data 12345")

        watcher = LibraryWatcher(check_interval=60.0)
        sig1 = watcher.compute_signature(tmp_path)

        # Modifier le mtime d'un DOSSIER sans toucher aux fichiers audio
        new_time = time.time() - 3600
        os.utime(str(artist_dir), (new_time, new_time))
        os.utime(str(album_dir), (new_time, new_time))
        sig2 = watcher.compute_signature(tmp_path)

        print(f"  ✓ Test signature après modification mtime dossier: sig1 == sig2 ? {sig1 == sig2}")
        assert sig1 == sig2, "La signature ne doit PAS changer lors d'une simple variation mtime de dossier !"

        # Modifier un fichier audio réel
        os.utime(str(audio_file), (new_time, new_time))
        sig3 = watcher.compute_signature(tmp_path)
        print(f"  ✓ Test signature après modification mtime fichier audio: sig1 != sig3 ? {sig1 != sig3}")
        assert sig1 != sig3, "La signature DOIT changer lors d'une variation d'un fichier audio !"

    print("\n=== TOUS LES TESTS DE LA PHASE 56 SONT VALIDES AVEC SUCCES A 100% ===")

finally:
    cdp.close()
    chrome_proc.terminate()
    server_proc.terminate()
    try:
        chrome_proc.wait(timeout=3)
        server_proc.wait(timeout=3)
    except Exception:
        pass

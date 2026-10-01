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
OUTPUT_DIR = Path(r"C:\Users\miche\.gemini\antigravity\brain\058353d3-7e85-44af-978a-b4f362fced4b\audit_screenshots")
PORT = 8034
CDP_PORT = 9246

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

print("=== TEST SUITE : PHASE 58 RACCOURCIS, MOLETTE VOLUME & MINUTEUR DE VEILLE ===")

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

    # Fermer le wizard s'il est actif
    cdp.evaluate("if (typeof closeWelcomeWizard === 'function') closeWelcomeWizard();")
    time.sleep(0.3)

    print("\n[1/5] Vérification de la présence des éléments UI...")
    has_btn_main = cdp.evaluate("Boolean(document.getElementById('player-btn-sleep-timer'))")
    has_btn_mini = cdp.evaluate("Boolean(document.getElementById('mini-player-sleep-btn'))")
    has_modal = cdp.evaluate("Boolean(document.getElementById('sleep-timer-modal-backdrop'))")
    print(f"  ✓ Bouton veille grand lecteur: {has_btn_main}")
    print(f"  ✓ Bouton veille mini-barre: {has_btn_mini}")
    print(f"  ✓ Modale minuteur de veille: {has_modal}")
    assert has_btn_main and has_btn_mini and has_modal, "Éléments UI du minuteur de veille manquants"

    print("\n[2/5] Test des Raccourcis Clavier Bureau (Space, Arrows, Mute)...")
    # Configurer une fausse piste audio
    cdp.evaluate("""
        AudioPlayer.audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
        AudioPlayer.audio.currentTime = 30;
        AudioPlayer.setVolume(0.80);
        AudioPlayer.isMuted = false;
    """)

    # Test Flèche Droite (seek +5s)
    cur_before_seek = cdp.evaluate("AudioPlayer.audio.currentTime")
    cdp.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))")
    cur_after_seek_fwd = cdp.evaluate("AudioPlayer.audio.currentTime")
    print(f"  ✓ Avance +5s via Flèche Droite : {cur_before_seek}s -> {cur_after_seek_fwd}s")
    assert cur_after_seek_fwd == cur_before_seek + 5, "Flèche Droite doit avancer de 5s"

    # Test Flèche Gauche (seek -5s)
    cdp.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))")
    cur_after_seek_bwd = cdp.evaluate("AudioPlayer.audio.currentTime")
    print(f"  ✓ Recul -5s via Flèche Gauche : {cur_after_seek_fwd}s -> {cur_after_seek_bwd}s")
    assert cur_after_seek_bwd == cur_after_seek_fwd - 5, "Flèche Gauche doit reculer de 5s"

    # Test Flèche Haut (Volume +5%)
    vol_before_up = cdp.evaluate("AudioPlayer.volume")
    cdp.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))")
    vol_after_up = cdp.evaluate("AudioPlayer.volume")
    print(f"  ✓ Volume +5% via Flèche Haut : {vol_before_up:.2f} -> {vol_after_up:.2f}")
    assert abs(vol_after_up - (vol_before_up + 0.05)) < 0.01, "Flèche Haut doit monter le volume de 0.05"

    # Test Flèche Bas (Volume -5%)
    cdp.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))")
    vol_after_down = cdp.evaluate("AudioPlayer.volume")
    print(f"  ✓ Volume -5% via Flèche Bas : {vol_after_up:.2f} -> {vol_after_down:.2f}")
    assert abs(vol_after_down - vol_before_up) < 0.01, "Flèche Bas doit baisser le volume de 0.05"

    # Test Touche M (Mute toggle)
    cdp.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }))")
    muted_state = cdp.evaluate("AudioPlayer.isMuted")
    print(f"  ✓ Touche M (Coupure son) : isMuted = {muted_state}")
    assert muted_state is True, "Touche M doit couper le son"
    cdp.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }))")
    unmuted_state = cdp.evaluate("AudioPlayer.isMuted")
    print(f"  ✓ Touche M (Rétablissement son) : isMuted = {unmuted_state}")
    assert unmuted_state is False, "Touche M doit rétablir le son"

    # Test non-interférence : focus sur input
    no_conflict_res = cdp.evaluate("""
        (() => {
            const inp = document.getElementById("player-search-input");
            if (!inp) return true;
            inp.focus();
            const wasPlaying = AudioPlayer.isPlaying;
            inp.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
            inp.blur();
            return AudioPlayer.isPlaying === wasPlaying;
        })()
    """)
    print(f"  ✓ Non-interférence touche Espace dans champ de saisie texte: {no_conflict_res}")
    assert no_conflict_res is True, "La touche Espace dans un champ texte ne doit pas couper la lecture"

    print("\n[3/5] Test du Réglage de Volume à la Molette de la Souris...")
    wheel_res = cdp.evaluate("""
        (() => {
            AudioPlayer.setVolume(0.70);
            const v0 = AudioPlayer.volume;
            const volRow = document.querySelector('.player-volume-row');
            volRow.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
            const vUp = AudioPlayer.volume;
            volRow.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
            const vDown = AudioPlayer.volume;
            return { v0, vUp, vDown };
        })()
    """)
    print(f"  ✓ Molette Volume: départ={wheel_res['v0']}, haut={wheel_res['vUp']:.2f}, bas={wheel_res['vDown']:.2f}")
    assert abs(wheel_res['vUp'] - 0.75) < 0.01, f"Molette haut doit monter à 0.75 (obtenu: {wheel_res['vUp']})"
    assert abs(wheel_res['vDown'] - 0.70) < 0.01, f"Molette bas doit redescendre à 0.70 (obtenu: {wheel_res['vDown']})"

    print("\n[4/5] Test de la Modale Minuteur de Veille & Interface...")
    cdp.evaluate("enterPlayerMode()")
    time.sleep(0.4)
    # Ouvrir la modale
    cdp.evaluate("openSleepTimerModal()")
    time.sleep(0.4)
    modal_active = cdp.evaluate("document.getElementById('sleep-timer-modal-backdrop').classList.contains('active')")
    print(f"  ✓ Modale affichée avec succès: {modal_active}")
    assert modal_active is True, "La modale de veille doit être active"
    cdp.capture_screenshot("103_sleep_timer_modal.png")

    print("\n[5/5] Test d'Activation du Minuteur de Veille & Décompte...")
    # Activer 30 minutes
    cdp.evaluate("""
        const opt30 = document.querySelector(\"[data-sleep-minutes='30']\");
        if (opt30) opt30.click();
    """)
    time.sleep(0.4)

    is_sleep_active = cdp.evaluate("Boolean(window.SleepTimer && window.SleepTimer.active)")
    sleep_mode = cdp.evaluate("window.SleepTimer ? window.SleepTimer.mode : null")
    sleep_secs = cdp.evaluate("window.SleepTimer ? window.SleepTimer.remainingSeconds : 0")
    label_text = cdp.evaluate("document.getElementById('player-sleep-timer-label').textContent")
    badge_visible = cdp.evaluate("document.getElementById('player-sleep-active-badge').style.display !== 'none'")

    print(f"  ✓ SleepTimer.active: {is_sleep_active}")
    print(f"  ✓ SleepTimer.mode: {sleep_mode}")
    print(f"  ✓ SleepTimer.remainingSeconds: {sleep_secs}s")
    print(f"  ✓ Bouton veille label dynamique: '{label_text}'")
    print(f"  ✓ Pastille active affichée: {badge_visible}")

    assert is_sleep_active is True, "SleepTimer doit être actif"
    assert sleep_mode == "duration", "Mode doit être duration"
    assert 1790 <= sleep_secs <= 1800, "Doit avoir environ 1800s restantes"
    assert badge_visible is True, "La pastille active doit être visible"

    cdp.capture_screenshot("104_sleep_timer_active_badge.png")

    # Tester l'extinction feutrée (triggerSleep)
    cdp.evaluate("""
        (async () => {
            AudioPlayer.isPlaying = true;
            await SleepTimer.triggerSleep();
        })()
    """)
    time.sleep(0.9)
    after_sleep_active = cdp.evaluate("Boolean(SleepTimer.active)")
    print(f"  ✓ SleepTimer réinitialisé après extinction feutrée: {not after_sleep_active}")
    assert after_sleep_active is False, "Le minuteur doit se désactiver après extinction"

    print("\n=== TOUS LES TESTS DE LA PHASE 58 SONT VALIDES AVEC SUCCES A 100% ===")

finally:
    cdp.close()
    chrome_proc.terminate()
    server_proc.terminate()
    try:
        chrome_proc.wait(timeout=3)
        server_proc.wait(timeout=3)
    except Exception:
        pass

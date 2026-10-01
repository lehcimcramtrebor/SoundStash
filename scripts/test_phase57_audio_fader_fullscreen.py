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
PORT = 8033
CDP_PORT = 9245

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

print("=== TEST SUITE : PHASE 57 AUDIO FADER (0.5s) & STARTUP FULLSCREEN ===")

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

    # Fermer le wizard d'accueil s'il est affiché
    cdp.evaluate("if (typeof closeWelcomeWizard === 'function') closeWelcomeWizard();")
    time.sleep(0.3)

    print("\n[1/5] Vérification de l'initialisation du module AudioFader...")
    fader_exists = cdp.evaluate("Boolean(window.AudioFader)")
    fader_enabled = cdp.evaluate("Boolean(window.AudioFader && window.AudioFader.enabled)")
    fader_duration = cdp.evaluate("window.AudioFader ? window.AudioFader.duration : 0")
    print(f"  ✓ AudioFader instancié: {fader_exists}")
    print(f"  ✓ AudioFader activé: {fader_enabled}")
    print(f"  ✓ AudioFader durée par défaut: {fader_duration} ms")
    assert fader_exists and fader_enabled and fader_duration == 500, "AudioFader non correctement initialisé"

    print("\n[2/5] Test dynamique de la rampe temporelle Fade-in & Fade-out...")
    # Créer un faux élément audio pour mesurer la courbe temporelle
    fader_test_res = cdp.evaluate("""
        (async () => {
            const el = new Audio();
            el.volume = 1;
            // Test Fade-in
            const fadeInPromise = AudioFader.fadeIn(el, 0.8, 400);
            const v0 = el.volume;
            await new Promise(r => setTimeout(r, 120));
            const vMid = el.volume;
            await fadeInPromise;
            const vFinal = el.volume;

            // Test Fade-out
            const fadeOutPromise = AudioFader.fadeOut(el, 300);
            await new Promise(r => setTimeout(r, 100));
            const vDown = el.volume;
            await fadeOutPromise;
            const vZero = el.volume;

            return { v0, vMid, vFinal, vDown, vZero };
        })()
    """)
    print(f"  ✓ Mesures Fade-In : début={fader_test_res['v0']}, mi-parcours={fader_test_res['vMid']:.3f}, final={fader_test_res['vFinal']:.3f}")
    print(f"  ✓ Mesures Fade-Out: mi-parcours={fader_test_res['vDown']:.3f}, final={fader_test_res['vZero']:.3f}")
    assert fader_test_res['v0'] == 0, "Fade-in doit démarrer à 0"
    assert 0 < fader_test_res['vMid'] < 0.8, "Fade-in doit progresser continuellement"
    assert abs(fader_test_res['vFinal'] - 0.8) < 0.05, "Fade-in doit atteindre la consigne (0.8)"
    assert 0 <= fader_test_res['vDown'] < 0.8, "Fade-out doit descendre continuellement"
    assert fader_test_res['vZero'] == 0, "Fade-out doit atteindre 0"

    print("\n[3/5] Test des transitions dans AudioPlayer (Play/Pause/Track Switch)...")
    # Configurer une fausse playlist dans AudioPlayer
    cdp.evaluate("""
        AudioPlayer.currentAlbum = {
            title: "Renaud Album Test",
            artist: "Renaud",
            year: "2016",
            cover_url: "/static/placeholder-cover.svg",
            path: "Renaud/Renaud Album Test"
        };
        AudioPlayer.playlist = [
            { title: "Toujours debout", artist: "Renaud", duration: "03:45", stream_url: "", path: "piste1.m4a" },
            { title: "Les mots", artist: "Renaud", duration: "03:20", stream_url: "", path: "piste2.m4a" }
        ];
        AudioPlayer.currentIndex = 0;
        AudioPlayer.setVolume(0.85);
    """)

    # Test play() avec fadeIn
    play_vol = cdp.evaluate("""
        (() => {
            AudioPlayer.audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
            AudioPlayer.play();
            return AudioPlayer.audio.volume;
        })()
    """)
    print(f"  ✓ Volume au déclenchement de play() (doit commencer à 0): {play_vol}")
    assert play_vol == 0, "Le volume au lancement de play() doit être à 0 pour le fondu"

    # Attendre la montée en volume
    time.sleep(0.55)
    vol_after_fadein = cdp.evaluate("AudioPlayer.audio.volume")
    print(f"  ✓ Volume après fin du fondu d'entrée (0.5s): {vol_after_fadein:.2f}")
    assert abs(vol_after_fadein - 0.85) < 0.05, "Le volume final doit avoir atteint 0.85"

    cdp.evaluate("enterPlayerMode()")
    time.sleep(0.4)
    cdp.capture_screenshot("102_audio_fader_playing_smooth.png")

    print("\n[4/5] Vérification des cases à cocher dans les Paramètres...")
    cdp.evaluate("openSettingsModal(); switchSettingsSubtab('subtab-system');")
    time.sleep(0.6)

    has_fader_cb = cdp.evaluate("Boolean(document.getElementById('cfg-audio-crossfade'))")
    fader_checked = cdp.evaluate("document.getElementById('cfg-audio-crossfade') ? document.getElementById('cfg-audio-crossfade').checked : false")
    has_fs_cb = cdp.evaluate("Boolean(document.getElementById('cfg-start-fullscreen'))")
    fs_checked = cdp.evaluate("document.getElementById('cfg-start-fullscreen') ? document.getElementById('cfg-start-fullscreen').checked : false")

    print(f"  ✓ Case 'cfg-audio-crossfade' présente: {has_fader_cb}, cochée: {fader_checked}")
    print(f"  ✓ Case 'cfg-start-fullscreen' présente: {has_fs_cb}, cochée: {fs_checked}")
    assert has_fader_cb and fader_checked, "La case cfg-audio-crossfade doit être présente et cochée"
    assert has_fs_cb and fs_checked, "La case cfg-start-fullscreen doit être présente et cochée"

    cdp.capture_screenshot("101_settings_fader_fullscreen_options.png")
    cdp.evaluate("closeSettingsModal()")
    time.sleep(0.3)

    print("\n[5/5] Vérification de la configuration Backend & Main.js...")
    from backend.config import load_config
    cfg = load_config()
    print(f"  ✓ AppConfig.start_in_fullscreen: {getattr(cfg, 'start_in_fullscreen', None)}")
    print(f"  ✓ AppConfig.audio_fader_enabled: {getattr(cfg, 'audio_fader_enabled', None)}")
    print(f"  ✓ AppConfig.audio_fader_duration: {getattr(cfg, 'audio_fader_duration', None)}")
    assert getattr(cfg, 'start_in_fullscreen', None) is True
    assert getattr(cfg, 'audio_fader_enabled', None) is True
    assert getattr(cfg, 'audio_fader_duration', None) == 0.5

    # Vérification syntaxique et présence de la logique dans main.js
    main_code = Path(ROOT / "main.js").read_text(encoding="utf-8")
    assert "start_in_fullscreen" in main_code, "start_in_fullscreen doit être référencé dans main.js"
    assert "setFullScreen" in main_code, "setFullScreen doit être géré dans main.js"

    print("\n=== TOUS LES TESTS DE LA PHASE 57 SONT VALIDES AVEC SUCCES A 100% ===")

finally:
    cdp.close()
    chrome_proc.terminate()
    server_proc.terminate()
    try:
        chrome_proc.wait(timeout=3)
        server_proc.wait(timeout=3)
    except Exception:
        pass

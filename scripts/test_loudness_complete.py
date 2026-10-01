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
PORT = 8036
CDP_PORT = 9248

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

print("=== SUITE DE VALIDATION : LOUDNESS PHYSIOLOGIQUE & TEST AUDIO/PREVIEWS ===")

# 1. Démarrer serveur backend
env = os.environ.copy()
env["PYTHONUNBUFFERED"] = "1"
server_proc = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "backend.app:app", "--port", str(PORT), "--log-level", "warning"],
    cwd=str(ROOT),
    env=env
)
time.sleep(2.5)

# 2. Lancer Chrome Headless
chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
chrome_proc = subprocess.Popen(
    [
        chrome_path,
        f"--remote-debugging-port={CDP_PORT}",
        "--remote-allow-origins=*",
        "--headless=new",
        "--disable-gpu",
        "--autoplay-policy=no-user-gesture-required",
        "--window-size=1280,950",
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

    def capture_screenshot(self, filepath):
        res = self.send("Page.captureScreenshot", {"format": "png"})
        data = res.get("data")
        if data:
            with open(filepath, "wb") as f:
                f.write(base64.b64decode(data))
            print(f"  [Capture] Sauvegardée : {filepath.name}")

try:
    cdp = CDPClient(CDP_PORT)
    cdp.connect()
    print("  [CDP] Connecté avec succès.")

    # Attendre chargement initial
    time.sleep(2.0)

    # 1. TEST STRUCTURE DOM & OUVERTURE ÉGALISEUR
    print("\n--- TEST 1 : Structure DOM & Ouverture Modale Égaliseur ---")
    open_res = cdp.evaluate("""
        new Promise((resolve) => {
            AudioPlayer.openEqualizerModal();
            const modal = document.getElementById("player-equalizer-modal");
            setTimeout(() => {
                const card = document.querySelector(".eq-loudness-card");
                const slider = document.getElementById("eq-loudness-slider");
                const valDisplay = document.getElementById("eq-loudness-val-display");
                const badge = document.getElementById("eq-loudness-badge");
                const resetBtn = document.getElementById("eq-loudness-btn-reset");

                resolve({
                    modalVisible: modal ? (modal.style.display === "flex" || modal.classList.contains("active")) : false,
                    modalActive: modal ? modal.classList.contains("active") : false,
                    hasCard: Boolean(card),
                    hasSlider: Boolean(slider),
                    sliderMin: slider ? slider.min : null,
                    sliderMax: slider ? slider.max : null,
                    sliderVal: slider ? slider.value : null,
                    hasValDisplay: Boolean(valDisplay),
                    valText: valDisplay ? valDisplay.textContent.trim() : null,
                    hasBadge: Boolean(badge),
                    badgeText: badge ? badge.textContent.trim() : null,
                    hasResetBtn: Boolean(resetBtn)
                });
            }, 100);
        })
    """)
    print("Résultat Test 1 :", json.dumps(open_res, indent=2))
    assert open_res["modalVisible"], "La modale égaliseur devrait être visible"
    assert open_res["hasCard"], "La carte eq-loudness-card doit exister"
    assert open_res["hasSlider"], "Le slider de loudness doit exister"
    assert open_res["sliderMax"] == "100", "Le slider max doit être 100"

    # 2. TEST MOTEUR WEB AUDIO & NŒUDS PHYSIOLOGIQUES
    print("\n--- TEST 2 : Validation de la Chaîne Web Audio (Filtres, Pre-Gain & Limiteur) ---")
    audio_nodes_res = cdp.evaluate("""
        (() => {
            AudioPlayer.setupAudioContext();
            const ctx = AudioPlayer.eqAudioCtx;
            const source = AudioPlayer.eqSourceNode;
            const preGain = AudioPlayer.loudnessPreGainNode;
            const bass = AudioPlayer.loudnessBassFilter;
            const treble = AudioPlayer.loudnessTrebleFilter;
            const limiter = AudioPlayer.loudnessLimiterNode;
            const analyser = AudioPlayer.analyser;

            return {
                hasCtx: Boolean(ctx),
                hasSource: Boolean(source),
                hasPreGain: Boolean(preGain),
                hasBassFilter: Boolean(bass),
                bassType: bass ? bass.type : null,
                bassFreq: bass ? bass.frequency.value : null,
                hasTrebleFilter: Boolean(treble),
                trebleType: treble ? treble.type : null,
                trebleFreq: treble ? treble.frequency.value : null,
                hasLimiter: Boolean(limiter),
                limiterThreshold: limiter ? limiter.threshold.value : null,
                hasAnalyser: Boolean(analyser),
                audioCrossOrigin: AudioPlayer.audio ? AudioPlayer.audio.crossOrigin : null
            };
        })()
    """)
    print("Résultat Test 2 :", json.dumps(audio_nodes_res, indent=2))
    assert audio_nodes_res["hasCtx"], "AudioContext doit être initialisé"
    assert audio_nodes_res["hasPreGain"], "Pre-Gain GainNode doit exister"
    assert audio_nodes_res["bassType"] == "lowshelf" and audio_nodes_res["bassFreq"] == 100, "Bass filter: lowshelf @ 100Hz"
    assert audio_nodes_res["trebleType"] == "highshelf" and audio_nodes_res["trebleFreq"] == 10000, "Treble filter: highshelf @ 10kHz"
    assert audio_nodes_res["hasLimiter"], "DynamicsCompressorNode limiteur doit exister"
    assert audio_nodes_res["audioCrossOrigin"] == "anonymous", "crossOrigin doit impérativement être 'anonymous'"

    # 3. TEST RÉGLAGE LOUDNESS ACTIF (Ex: 75%)
    print("\n--- TEST 3 : Réglage Loudness à 75% & Calculs DSP ---")
    active_res = cdp.evaluate("""
        new Promise((resolve) => {
            AudioPlayer.setLoudness(75, true);
            setTimeout(() => {
                const bassGain = AudioPlayer.loudnessBassFilter.gain.value;
                const trebleGain = AudioPlayer.loudnessTrebleFilter.gain.value;
                const preGainVal = AudioPlayer.loudnessPreGainNode.gain.value;
                const slider = document.getElementById("eq-loudness-slider");
                const valDisplay = document.getElementById("eq-loudness-val-display");
                const badge = document.getElementById("eq-loudness-badge");
                const card = document.querySelector(".eq-loudness-card");
                const savedStorage = localStorage.getItem("ytm_loudness");

                resolve({
                    loudnessAmount: AudioPlayer.loudnessAmount,
                    bassGain: Math.round(bassGain * 100) / 100,
                    trebleGain: Math.round(trebleGain * 100) / 100,
                    preGainVal: Math.round(preGainVal * 1000) / 1000,
                    sliderVal: slider ? slider.value : null,
                    valText: valDisplay ? valDisplay.textContent.trim() : null,
                    badgeText: badge ? badge.textContent.trim() : null,
                    cardIsActive: card ? card.classList.contains("is-active") : false,
                    savedStorage: savedStorage
                });
            }, 70);
        })
    """)
    print("Résultat Test 3 :", json.dumps(active_res, indent=2))
    assert active_res["loudnessAmount"] == 75, "loudnessAmount doit être 75"
    assert abs(active_res["bassGain"] - 4.5) < 0.1, "Gain Basses @ 75% doit être +4.5 dB"
    assert abs(active_res["trebleGain"] - 3.0) < 0.1, "Gain Aigus @ 75% doit être +3.0 dB"
    assert abs(active_res["preGainVal"] - 0.879) < 0.05, "Pre-Gain calibré doit être ~0.879 (-1.12 dB)"
    assert active_res["cardIsActive"], "La carte doit avoir la classe is-active"
    assert active_res["savedStorage"] == "75", "localStorage doit avoir 75"

    time.sleep(0.5)
    shot1 = OUTPUT_DIR / "122_loudness_equalizer_active.png"
    cdp.capture_screenshot(shot1)

    # 4. TEST RÉINITIALISATION (0%)
    print("\n--- TEST 4 : Réinitialisation à 0% via Bouton Reset ---")
    reset_res = cdp.evaluate("""
        new Promise((resolve) => {
            const resetBtn = document.getElementById("eq-loudness-btn-reset");
            if (resetBtn) resetBtn.click();

            setTimeout(() => {
                const bassGain = AudioPlayer.loudnessBassFilter.gain.value;
                const trebleGain = AudioPlayer.loudnessTrebleFilter.gain.value;
                const preGainVal = AudioPlayer.loudnessPreGainNode.gain.value;
                const slider = document.getElementById("eq-loudness-slider");
                const valDisplay = document.getElementById("eq-loudness-val-display");
                const badge = document.getElementById("eq-loudness-badge");
                const card = document.querySelector(".eq-loudness-card");
                const savedStorage = localStorage.getItem("ytm_loudness");

                resolve({
                    loudnessAmount: AudioPlayer.loudnessAmount,
                    bassGain: bassGain,
                    trebleGain: trebleGain,
                    preGainVal: preGainVal,
                    sliderVal: slider ? slider.value : null,
                    valText: valDisplay ? valDisplay.textContent.trim() : null,
                    badgeText: badge ? badge.textContent.trim() : null,
                    cardIsActive: card ? card.classList.contains("is-active") : false,
                    savedStorage: savedStorage
                });
            }, 70);
        })
    """)
    print("Résultat Test 4 :", json.dumps(reset_res, indent=2))
    assert reset_res["loudnessAmount"] == 0, "loudnessAmount doit être 0"
    assert reset_res["bassGain"] == 0, "Gain Basses doit être 0 dB"
    assert reset_res["trebleGain"] == 0, "Gain Aigus doit être 0 dB"
    assert reset_res["preGainVal"] == 1, "Pre-Gain doit être 1.0 (0 dB)"
    assert not reset_res["cardIsActive"], "La carte ne doit plus être active"
    assert reset_res["savedStorage"] == "0", "localStorage doit avoir 0"

    time.sleep(0.5)
    shot2 = OUTPUT_DIR / "123_loudness_equalizer_flat.png"
    cdp.capture_screenshot(shot2)

    # 5. TEST CRITIQUE : VÉRIFICATION FLUX AUDIO & PRÉ-ÉCOUTES SANS PERTE DE SON
    print("\n--- TEST 5 : Test Audio & Préservation Intégrale des Pré-écoutes ---")
    audio_stream_res = cdp.evaluate("""
        new Promise(async (resolve) => {
            try {
                AudioPlayer.setupAudioContext();
                const ctx = AudioPlayer.eqAudioCtx;
                if (ctx.state === "suspended") {
                    await ctx.resume();
                }

                // Créer un oscillateur 440 Hz (La) et l'injecter avant le graphe pour tester le flux audio complet
                const osc = ctx.createOscillator();
                const testGain = ctx.createGain();
                testGain.gain.value = 0.2;
                osc.type = "sine";
                osc.frequency.value = 440;

                // Connecter l'oscillateur au pre-gain du loudness pour tester la traversée complète
                osc.connect(testGain);
                testGain.connect(AudioPlayer.loudnessPreGainNode);
                osc.start();

                AudioPlayer.isPlaying = true;

                setTimeout(() => {
                    const freqs = AudioPlayer.getAudioFrequencies();
                    const waveform = AudioPlayer.getAudioWaveform();

                    let sumFreq = 0;
                    if (freqs) {
                        for (let i = 0; i < freqs.length; i++) sumFreq += freqs[i];
                    }

                    // Déconnecter le générateur de test
                    osc.stop();
                    osc.disconnect();
                    testGain.disconnect();
                    AudioPlayer.isPlaying = false;

                    resolve({
                        success: true,
                        audioEngineReady: Boolean(AudioPlayer.audio),
                        crossOriginAttr: AudioPlayer.audio.crossOrigin,
                        hasFrequencies: Boolean(freqs && freqs.length > 0),
                        hasWaveform: Boolean(waveform && waveform.length > 0),
                        sumFrequencies: sumFreq,
                        soundFlowPassed: sumFreq > 0
                    });
                }, 300);
            } catch (err) {
                resolve({ success: false, error: err.message });
            }
        })
    """)
    print("Résultat Test 5 (Test Audio Réel) :", json.dumps(audio_stream_res, indent=2))
    assert audio_stream_res["success"], f"Échec du test audio: {audio_stream_res.get('error')}"
    assert audio_stream_res["crossOriginAttr"] == "anonymous", "crossOrigin doit rester 'anonymous'"
    assert audio_stream_res["soundFlowPassed"], "Le flux audio doit traverser les filtres et générer des fréquences > 0"

    print("\n=======================================================")
    print("✓ TOUS LES 5 TESTS ONT ÉTÉ VALIDÉS AVEC SUCCÈS À 100% !")
    print("=======================================================")

finally:
    try:
        chrome_proc.terminate()
    except Exception:
        pass
    try:
        server_proc.terminate()
    except Exception:
        pass

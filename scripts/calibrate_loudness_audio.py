import json
import urllib.request
import websocket
import subprocess
import time
import os
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
PORT = 8038
CDP_PORT = 9250

print("=== CALIBRATION ACOUSTIQUE LOUDNESS & ÉNERGIE PERÇUE ===")

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

try:
    cdp = CDPClient(CDP_PORT)
    cdp.connect()

    # Exécution du test de calibration audio dans le navigateur
    calib_results = cdp.evaluate("""
        new Promise(async (resolve) => {
            AudioPlayer.setupAudioContext();
            const ctx = AudioPlayer.eqAudioCtx;
            if (ctx.state === "suspended") await ctx.resume();

            // Créer un buffer audio de test synthétisant un morceau musical réaliste (1 seconde, 44100Hz)
            const sampleRate = ctx.sampleRate;
            const duration = 1.0;
            const length = sampleRate * duration;
            const audioBuffer = ctx.createBuffer(1, length, sampleRate);
            const channelData = audioBuffer.getChannelData(0);

            // Composition du mix :
            // Basses (60-120Hz) : 35% d'énergie
            // Médiums (400-3000Hz, voix/instruments) : 50% d'énergie
            // Aigus (6000-12000Hz) : 15% d'énergie
            for (let i = 0; i < length; i++) {
                const t = i / sampleRate;
                const b = Math.sin(2 * Math.PI * 80 * t) * 0.35 + Math.sin(2 * Math.PI * 120 * t) * 0.25;
                const m = Math.sin(2 * Math.PI * 500 * t) * 0.40 + Math.sin(2 * Math.PI * 1000 * t) * 0.35 + Math.sin(2 * Math.PI * 2500 * t) * 0.25;
                const tr = Math.sin(2 * Math.PI * 8000 * t) * 0.20 + Math.sin(2 * Math.PI * 11000 * t) * 0.15;
                channelData[i] = (b + m + tr) * 0.55; // Niveau nominal à -3 dBFS peak
            }

            // Calculer RMS baseline
            let sumSqBase = 0;
            let peakBase = 0;
            for (let i = 0; i < length; i++) {
                const s = channelData[i];
                sumSqBase += s * s;
                if (Math.abs(s) > peakBase) peakBase = Math.abs(s);
            }
            const rmsBase = Math.sqrt(sumSqBase / length);
            const rmsBaseDb = 20 * Math.log10(rmsBase);
            const peakBaseDb = 20 * Math.log10(peakBase);

            // Tester différents ratios de Pre-Gain pour le Loudness Max (Bass +6dB, Treble +4dB)
            const candidatePreGainsDb = [-6.0, -5.0, -4.0, -3.0, -2.5, -2.0, -1.8, -1.5, -1.2, -1.0, 0.0];
            const candidateResults = [];

            for (const preDb of candidatePreGainsDb) {
                // Utiliser un OfflineAudioContext pour mesurer avec une précision bit-exacte le signal sortant
                const offlineCtx = new OfflineAudioContext(1, length, sampleRate);
                const src = offlineCtx.createBufferSource();
                src.buffer = audioBuffer;

                const preGain = offlineCtx.createGain();
                preGain.gain.value = Math.pow(10, preDb / 20);

                const bassFilter = offlineCtx.createBiquadFilter();
                bassFilter.type = "lowshelf";
                bassFilter.frequency.value = 100;
                bassFilter.gain.value = 6.0;

                const trebleFilter = offlineCtx.createBiquadFilter();
                trebleFilter.type = "highshelf";
                trebleFilter.frequency.value = 10000;
                trebleFilter.gain.value = 4.0;

                const limiter = offlineCtx.createDynamicsCompressor();
                limiter.threshold.value = -0.5;
                limiter.knee.value = 0;
                limiter.ratio.value = 20;
                limiter.attack.value = 0.003;
                limiter.release.value = 0.1;

                src.connect(preGain);
                preGain.connect(bassFilter);
                bassFilter.connect(trebleFilter);
                trebleFilter.connect(limiter);
                limiter.connect(offlineCtx.destination);

                src.start(0);
                const rendered = await offlineCtx.startRendering();
                const outData = rendered.getChannelData(0);

                let sumSqOut = 0;
                let peakOut = 0;
                for (let i = 0; i < outData.length; i++) {
                    const s = outData[i];
                    sumSqOut += s * s;
                    if (Math.abs(s) > peakOut) peakOut = Math.abs(s);
                }
                const rmsOut = Math.sqrt(sumSqOut / outData.length);
                const rmsOutDb = 20 * Math.log10(rmsOut);
                const peakOutDb = 20 * Math.log10(peakOut);
                const deltaRmsDb = rmsOutDb - rmsBaseDb;

                // Calcul de la perte sur les médiums (vocal/melody drop)
                const midDropDb = preDb;

                candidateResults.push({
                    preGainDb: preDb,
                    rmsOutDb: Math.round(rmsOutDb * 100) / 100,
                    peakOutDb: Math.round(peakOutDb * 100) / 100,
                    deltaRmsDb: Math.round(deltaRmsDb * 100) / 100,
                    midDropDb: midDropDb,
                    isClipped: peakOut > 1.0001
                });
            }

            resolve({
                rmsBaseDb: Math.round(rmsBaseDb * 100) / 100,
                peakBaseDb: Math.round(peakBaseDb * 100) / 100,
                results: candidateResults
            });
        })
    """)

    print(f"\n[Baseline Original Signal] RMS: {calib_results['rmsBaseDb']} dBFS | Peak: {calib_results['peakBaseDb']} dBFS\n")
    print(f"{'Pre-Gain':<10} | {'RMS Out':<10} | {'Peak Out':<10} | {'Delta RMS':<12} | {'Perte Médiums (Voix)':<22} | {'Clipping ?':<10}")
    print("-" * 85)
    for r in calib_results["results"]:
        clip_str = "OUI (!)" if r["isClipped"] else "NON (Sûr)"
        print(f"{r['preGainDb']:<10.1f} | {r['rmsOutDb']:<10.2f} | {r['peakOutDb']:<10.2f} | {r['deltaRmsDb']:<+12.2f} | {r['midDropDb']:<+22.1f} | {clip_str}")

finally:
    try:
        chrome_proc.terminate()
    except Exception:
        pass
    try:
        server_proc.terminate()
    except Exception:
        pass

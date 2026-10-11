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
PORT = 8048
CDP_PORT = 9258

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

print("=== TEST AUTOMATISÉ : PHASE 156 - BUTÉE DE SCROLL & PROTECTION CARTES MASQUÉES ===")

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
        payload = {"id": self.msg_id, "method": method, "params": params or {}}
        self.ws.send(json.dumps(payload))
        while True:
            resp = json.loads(self.ws.recv())
            if resp.get("id") == self.msg_id:
                return resp.get("result", {})

    def evaluate(self, expr):
        res = self.send("Runtime.evaluate", {
            "expression": expr,
            "returnByValue": True,
            "awaitPromise": True
        })
        if "exceptionDetails" in res:
            raise RuntimeError(f"CDP Eval Error: {res['exceptionDetails']}")
        return res.get("result", {}).get("value")

    def capture_screenshot(self, filepath):
        res = self.send("Page.captureScreenshot", {"format": "png"})
        img_data = base64.b64decode(res["data"])
        with open(filepath, "wb") as f:
            f.write(img_data)
        print(f"  [Capture] Sauvegardée : {filepath}")

    def close(self):
        if self.ws:
            self.ws.close()

cdp = CDPClient(CDP_PORT)
cdp.connect()

try:
    print("\n1. Attente du chargement initial de SoundStash...")
    time.sleep(2.0)

    cdp.evaluate("""
    (() => {
        localStorage.setItem("welcome_guide_dismissed", "true");
        localStorage.setItem("soundstash_onboarding_done", "true");
        const m = document.getElementById("welcome-guide-modal");
        if (m) m.style.display = "none";
        const bd = document.querySelector(".modal-backdrop");
        if (bd && bd.id === "welcome-guide-modal") bd.style.display = "none";
        document.querySelectorAll(".modal-backdrop").forEach(el => el.style.display = "none");
    })()
    """)

    is_ready = cdp.evaluate("Boolean(window.AudioPlayer && window.AudioPlayer.isCatalogReady !== undefined)")
    print(f"  AudioPlayer prêt : {is_ready}")

    # Injection ou simulation de 4 albums de 'Cali'
    print("\n2. Configuration de 4 albums pour l'artiste 'Cali'...")
    cdp.evaluate("""
    (() => {
        const ap = window.AudioPlayer;
        ap.librarySource = "library";
        ap.libraryData = [
            { title: "L'Espoir", artist: "Cali", year: 2008, tracks: [{ title: "1000 coeurs", duration: 200, filepath: "1.mp3" }], cover_url: "", path: "/music/cali/espoir" },
            { title: "L'Âge d'or", artist: "Cali", year: 2015, tracks: [{ title: "La vie", duration: 180, filepath: "2.mp3" }], cover_url: "", path: "/music/cali/agedor" },
            { title: "Cavale", artist: "Cali", year: 2020, tracks: [{ title: "Cavale", duration: 210, filepath: "3.mp3" }], cover_url: "", path: "/music/cali/cavale" },
            { title: "Les Choses Défendues", artist: "Cali", year: 2016, tracks: [{ title: "Seuls", duration: 195, filepath: "4.mp3" }], cover_url: "", path: "/music/cali/choses" }
        ];
        ap.selectedArtistFilter = "Cali";
        ap.selectedGenreFilter = null;
        ap.setView("albums");
        ap.renderCurrentView();
    })()
    """)
    time.sleep(1.0)

    # Vérification du nombre d'albums et dimensions
    info = cdp.evaluate("""
    (() => {
        const ap = window.AudioPlayer;
        const collapseOffset = ap.getHeaderCollapseOffset();
        const maxAllowed = ap.getMaxAllowedScroll();
        const cards = document.querySelectorAll(".player-album-card");
        const controls = document.getElementById("player-controls-card");
        const content = document.getElementById("player-content-card");
        
        return {
            collapseOffset,
            maxAllowed,
            cardCount: cards.length,
            controlsHeight: controls ? controls.offsetHeight : 0,
            contentHeight: content ? content.offsetHeight : 0,
            viewportHeight: window.innerHeight,
            bodyScrollHeight: document.documentElement.scrollHeight
        };
    })()
    """)
    print(f"  Info vue Cali : {json.dumps(info, indent=2)}")

    collapseOffset = info["collapseOffset"]
    maxAllowed = info["maxAllowed"]
    cardCount = info["cardCount"]

    assert cardCount == 4, f"Attendu 4 albums de Cali, obtenu {cardCount}"
    assert maxAllowed == collapseOffset, f"Pour 4 albums (tenue écran), maxAllowed ({maxAllowed}) doit être EXACTEMENT égal à collapseOffset ({collapseOffset})"
    print(f"  ✓ Validé : maxAllowed ({maxAllowed}) == collapseOffset ({collapseOffset}) pour 4 albums !")

    # Test : tentative de défilement forcé vers le bas (ex: scroll 1500px)
    print("\n3. Tentative de défilement forcé vers 1500px...")
    cdp.evaluate("""
    (() => {
        window.scrollTo(0, 1500);
        window.dispatchEvent(new Event('scroll'));
    })()
    """)
    time.sleep(0.5)

    scroll_state = cdp.evaluate("""
    (() => {
        const ap = window.AudioPlayer;
        const controls = document.getElementById("player-controls-card");
        const firstCard = document.querySelector(".player-album-card");
        const controlsRect = controls ? controls.getBoundingClientRect() : null;
        const cardRect = firstCard ? firstCard.getBoundingClientRect() : null;

        return {
            scrollY: window.scrollY,
            maxAllowed: ap.getMaxAllowedScroll(),
            controlsBottom: controlsRect ? controlsRect.bottom : 0,
            cardTop: cardRect ? cardRect.top : 0,
            cardVisibleBelowControls: cardRect && controlsRect ? (cardRect.top >= controlsRect.bottom - 2) : false
        };
    })()
    """)
    print(f"  État après scroll forcé : {json.dumps(scroll_state, indent=2)}")

    assert scroll_state["scrollY"] <= collapseOffset + 1, f"scrollY ({scroll_state['scrollY']}) ne doit pas dépasser collapseOffset ({collapseOffset})"
    assert scroll_state["cardVisibleBelowControls"] is True, f"La carte doit être entièrement visible sous les contrôles sticky (cardTop={scroll_state['cardTop']}, controlsBottom={scroll_state['controlsBottom']})"
    print(f"  ✓ Validé : scrollY ({scroll_state['scrollY']}) est strictement verrouillé à la butée ({collapseOffset}) !")
    print("  ✓ Validé : Les cartes Cali sont 100% visibles immédiatement sous le cadre sticky, AUCUNE carte ne disparaît !")

    # Capture d'écran de vérification
    screenshot_path = OUTPUT_DIR / "phase156_cali_scroll_ceiling_locked.png"
    cdp.capture_screenshot(str(screenshot_path))

    # Test : collection volumineuse (50 albums)
    print("\n4. Test d'une collection longue (50 albums)...")
    cdp.evaluate("""
    (() => {
        const ap = window.AudioPlayer;
        const bigList = [];
        for (let i = 1; i <= 50; i++) {
            bigList.push({
                title: `Album ${i}`,
                artist: `Artiste ${i % 5}`,
                year: 2000 + i,
                tracks: [{ title: `Piste ${i}`, duration: 180, filepath: `tr_${i}.mp3` }],
                cover_url: "",
                path: `/music/alb_${i}`
            });
        }
        ap.libraryData = bigList;
        ap.selectedArtistFilter = null;
        ap.selectedGenreFilter = null;
        ap.setView("albums");
        ap.renderCurrentView();
    })()
    """)
    time.sleep(1.0)

    big_info = cdp.evaluate("""
    (() => {
        const ap = window.AudioPlayer;
        return {
            collapseOffset: ap.getHeaderCollapseOffset(),
            maxAllowed: ap.getMaxAllowedScroll(),
            cardCount: document.querySelectorAll(".player-album-card").length,
            bodyScrollHeight: document.documentElement.scrollHeight
        };
    })()
    """)
    print(f"  Info longue collection : {json.dumps(big_info, indent=2)}")

    assert big_info["cardCount"] >= 50, f"Attendu >= 50 cartes, obtenu {big_info['cardCount']}"
    assert big_info["maxAllowed"] > collapseOffset + 200, f"Pour 50 cartes, maxAllowed ({big_info['maxAllowed']}) doit permettre de défiler au-delà de collapseOffset"
    print(f"  ✓ Validé : Pour une longue collection, le défilement normal est permis ({big_info['maxAllowed']}px) !")

    # Test de scroll dans la longue collection
    cdp.evaluate("window.scrollTo(0, 500); window.dispatchEvent(new Event('scroll'));")
    time.sleep(0.3)
    big_scroll = cdp.evaluate("window.scrollY")
    assert 480 <= big_scroll <= 520, f"Dans une longue collection, scrollY doit atteindre 500px, obtenu {big_scroll}"
    print(f"  ✓ Validé : Défilement fluide actif à scrollY={big_scroll}px dans la grande collection.")

    screenshot_big = OUTPUT_DIR / "phase156_long_collection_scrolling.png"
    cdp.capture_screenshot(str(screenshot_big))

    print("\n=== TOUS LES TESTS DE LA PHASE 156 SONT PASSÉS AVEC SUCCÈS À 100% ===")

finally:
    cdp.close()
    chrome_proc.terminate()
    server_proc.terminate()
    try:
        chrome_proc.wait(timeout=2)
        server_proc.wait(timeout=2)
    except:
        pass

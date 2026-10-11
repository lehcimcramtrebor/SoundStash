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
PORT = 8049
CDP_PORT = 9259

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

print("=== TEST AUTOMATISÉ : PHASE 157 - DÉGAGEMENT DU CENTRE DE COMMANDE DU BAS ===")

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
    print("\n1. Attente du chargement initial...")
    time.sleep(2.0)

    cdp.evaluate("""
    (() => {
        localStorage.setItem("welcome_guide_dismissed", "true");
        localStorage.setItem("soundstash_onboarding_done", "true");
        const m = document.getElementById("welcome-guide-modal");
        if (m) m.style.display = "none";
        document.querySelectorAll(".modal-backdrop").forEach(el => el.style.display = "none");
    })()
    """)

    # Test 1 : Cali (4 albums) avec centre de commande actif (persistent player bar)
    print("\n2. Test Cali (4 albums) avec dock persistant actif...")
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

        // Afficher la barre persistante en bas (comme en lecture)
        const pbar = document.getElementById("persistent-player-bar");
        if (pbar) {
            pbar.style.display = "flex";
            pbar.classList.remove("hidden");
        }
        ap.updateScrollBounds();
    })()
    """)
    time.sleep(0.8)

    cali_info = cdp.evaluate("""
    (() => {
        const ap = window.AudioPlayer;
        const collapseOffset = ap.getHeaderCollapseOffset();
        const maxAllowed = ap.getMaxAllowedScroll();
        const cards = document.querySelectorAll(".player-album-card");
        const controlsCard = document.getElementById("player-controls-card");
        const contentCard = document.getElementById("player-content-card");
        const activePane = contentCard.querySelector(".player-view-pane:not([style*='display: none'])") || contentCard;
        const persistentBar = document.getElementById("persistent-player-bar");
        const isBarVisible = Boolean(
            persistentBar &&
            persistentBar.style.display !== "none" &&
            !persistentBar.classList.contains("hidden") &&
            (persistentBar.offsetHeight || 0) > 0
        );
        const bottomDockHeight = isBarVisible ? Math.round(persistentBar.offsetHeight + 16) : 0;
        const controlsHeight = Math.round(controlsCard.getBoundingClientRect().height || controlsCard.offsetHeight || 140);
        const viewportHeight = window.innerHeight || 800;
        const controlsMargin = 16;
        const availableBelowControls = Math.max(0, viewportHeight - controlsHeight - controlsMargin - bottomDockHeight);

        return {
            collapseOffset,
            maxAllowed,
            cardCount: cards.length,
            naturalContentHeight: activePane.scrollHeight,
            contentCardHeight: contentCard.scrollHeight,
            contentCardMinHeight: contentCard.style.minHeight,
            controlsHeight,
            viewportHeight,
            bottomDockHeight,
            availableBelowControls,
            docScrollHeight: document.documentElement.scrollHeight
        };
    })()
    """)
    print(f"  Info Cali : {json.dumps(cali_info, indent=2)}")
    assert cali_info["cardCount"] == 4, f"Attendu 4 albums, obtenu {cali_info['cardCount']}"
    assert cali_info["maxAllowed"] == cali_info["collapseOffset"], (
        f"Cali doit rester verrouillé à collapseOffset ({cali_info['collapseOffset']}), obtenu {cali_info['maxAllowed']}"
    )
    print("  ✓ Succès : Cali est strictement verrouillé à collapseOffset (aucune carte ne disparaît sous le haut).")

    # Test 2 : Détail d'un album avec 13 titres (cas exact de la capture utilisateur)
    print("\n3. Test Album Détail (13 pistes) avec barre persistante...")
    cdp.evaluate("""
    (() => {
        const ap = window.AudioPlayer;
        const tracks = [];
        for (let i = 1; i <= 13; i++) {
            tracks.push({
                track_number: i,
                title: i === 13 ? "Dust Wont Bury Me" : `Piste ${i}`,
                duration: 210,
                filename: `track_${i}.mp3`,
                filepath: `/music/album/track_${i}.mp3`
            });
        }
        if (!ap.albumInfoCache) ap.albumInfoCache = new Map();
        ap.albumInfoCache.set("/music/album13", {
            album_name: "Dust & Bones",
            album_artist: "The Band",
            year: 2024,
            tracks: tracks,
            cover_url: ""
        });

        ap.openAlbumDetail("/music/album13");
    })()
    """)
    time.sleep(1.0)

    # Vérification que le détail est bien chargé avec 13 pistes
    album_state = cdp.evaluate("""
    (() => {
        const rows = document.querySelectorAll("#player-album-detail-view .player-track-item");
        const ap = window.AudioPlayer;
        const maxAllowed = ap.getMaxAllowedScroll();
        const collapseOffset = ap.getHeaderCollapseOffset();
        const docScrollHeight = document.documentElement.scrollHeight;
        const viewportHeight = window.innerHeight;
        return {
            trackRowsCount: rows.length,
            maxAllowed,
            collapseOffset,
            docScrollHeight,
            viewportHeight,
            isDetailOpen: ap.isAlbumDetailOpen
        };
    })()
    """)
    print(f"  État Album Détail : {json.dumps(album_state, indent=2)}")
    assert album_state["trackRowsCount"] == 13, f"Attendu 13 pistes, obtenu {album_state['trackRowsCount']}"
    assert album_state["maxAllowed"] > album_state["collapseOffset"], (
        f"Pour 13 pistes, maxAllowed ({album_state['maxAllowed']}) doit dépasser collapseOffset ({album_state['collapseOffset']})"
    )
    print("  ✓ Succès : maxAllowed permet le défilement complet pour les 13 pistes.")

    # Défilement tout en bas
    print("\n4. Défilement tout en bas de la vue album (13 pistes)...")
    cdp.evaluate("""
    (() => {
        const ap = window.AudioPlayer;
        const maxAllowed = ap.getMaxAllowedScroll();
        window.scrollTo(0, maxAllowed);
        window.dispatchEvent(new Event('scroll'));
    })()
    """)
    time.sleep(0.8)

    # Mesure des positions du 13ème titre et de la barre persistante du bas
    clearance_info = cdp.evaluate("""
    (() => {
        const rows = document.querySelectorAll("#player-album-detail-view .player-track-item");
        const lastRow = rows[rows.length - 1];
        const pbar = document.getElementById("persistent-player-bar");

        const lastRowRect = lastRow ? lastRow.getBoundingClientRect() : null;
        const pbarRect = pbar ? pbar.getBoundingClientRect() : null;

        const clearance = pbarRect && lastRowRect ? (pbarRect.top - lastRowRect.bottom) : null;

        return {
            scrollY: window.scrollY,
            lastTrackTitle: lastRow ? lastRow.querySelector(".player-track-item-title")?.textContent?.trim() : null,
            lastTrackBottom: lastRowRect ? lastRowRect.bottom : null,
            pbarTop: pbarRect ? pbarRect.top : null,
            clearanceAboveBar: clearance,
            isFullyVisibleAboveBar: clearance !== null && clearance >= 0
        };
    })()
    """)
    print(f"  Mesures de dégagement : {json.dumps(clearance_info, indent=2)}")

    assert clearance_info["isFullyVisibleAboveBar"] is True, (
        f"Le 13ème titre doit être ENTIÈREMENT au-dessus de la barre persistante ! Clearance: {clearance_info['clearanceAboveBar']}px"
    )
    assert clearance_info["clearanceAboveBar"] >= 20, (
        f"Le dégagement au-dessus de la barre persistante doit être confortable (>= 20px), obtenu {clearance_info['clearanceAboveBar']}px"
    )
    print(f"  ✓ Validé : Le 13ème titre ('{clearance_info['lastTrackTitle']}') est 100% visible avec {clearance_info['clearanceAboveBar']:.1f}px de dégagement au-dessus du centre de commande !")

    # Capture d'écran
    screenshot_detail = OUTPUT_DIR / "phase157_album_detail_bottom_clearance.png"
    cdp.capture_screenshot(str(screenshot_detail))

    print("\n=== TOUS LES TESTS DE LA PHASE 157 SONT VALIDÉS AVEC SUCCÈS ===")

finally:
    cdp.close()
    chrome_proc.terminate()
    server_proc.terminate()
    try:
        chrome_proc.wait(timeout=2)
        server_proc.wait(timeout=2)
    except:
        pass

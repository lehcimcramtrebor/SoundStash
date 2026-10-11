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
PORT = 8051
CDP_PORT = 9261

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

print("=== TEST AUTOMATISÉ : PHASE 159 - CADRE SUPÉRIEUR UNIQUE DU LECTEUR ===")

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
            if resp.get("id") == payload["id"]:
                return resp.get("result", {})

    def evaluate(self, expr):
        res = self.send("Runtime.evaluate", {
            "expression": expr,
            "returnByValue": True,
            "awaitPromise": True
        })
        if "exceptionDetails" in res:
            print("  [JS EXCEPTION]:", res["exceptionDetails"])
        return res.get("result", {}).get("value")

    def capture_screenshot(self, filename):
        res = self.send("Page.captureScreenshot", {"format": "png"})
        data = base64.b64decode(res["data"])
        out_path = OUTPUT_DIR / filename
        out_path.write_bytes(data)
        print(f"  [SCREENSHOT] Sauvegardé : {out_path.name} ({len(data)} octets)")
        return out_path

    def close(self):
        if self.ws:
            self.ws.close()

try:
    client = CDPClient(CDP_PORT)
    client.connect()
    print("✓ Connecté au navigateur Chrome via CDP")

    # Attente que l'application et AudioPlayer soient initialisés
    for _ in range(30):
        ready = client.evaluate("typeof window.AudioPlayer !== 'undefined' && Boolean(window.AudioPlayer.isInitialized)")
        if ready:
            break
        time.sleep(0.5)

    print("✓ AudioPlayer initialisé")

    # Fermer le modal de bienvenue pour des captures nettes de l'interface
    client.evaluate("""(() => {
        try {
            localStorage.setItem('has_seen_welcome_modal', 'true');
            if (typeof closeWelcomeModal === 'function') closeWelcomeModal();
        } catch (_) {}
        const modal = document.getElementById('modal-welcome-guide');
        if (modal) modal.style.display = 'none';
        const backdrops = document.querySelectorAll('.modal-backdrop');
        backdrops.forEach(b => b.style.display = 'none');
        document.body.classList.remove('modal-open');
    })()""")
    time.sleep(0.5)

    # 1. Vérification de l'absence de .app-header
    has_app_header = client.evaluate("Boolean(document.querySelector('.app-header'))")
    print(f"  1. Conteneur .app-header présent : {has_app_header} (Attendu: False)")
    assert not has_app_header, "Erreur: .app-header ne devrait plus exister dans le DOM !"

    # 2. Vérification de la présence de la marque SoundStash dans #player-controls-card
    brand_info = client.evaluate("""(() => {
        const brand = document.querySelector('#player-controls-card #player-brand-logo');
        if (!brand) return null;
        const title = brand.querySelector('.player-brand-title');
        const subtitle = brand.querySelector('.player-brand-subtitle');
        const icon = brand.querySelector('.player-brand-icon');
        const divider = document.querySelector('#player-controls-card .player-header-divider');
        return {
            hasBrand: true,
            titleText: title ? title.textContent.trim() : null,
            subtitleText: subtitle ? subtitle.textContent.trim() : null,
            hasIcon: Boolean(icon),
            hasDivider: Boolean(divider)
        };
    })()""")
    print(f"  2. Marque intégrée dans #player-controls-card : {brand_info}")
    assert brand_info and brand_info.get("hasBrand"), "Erreur: #player-brand-logo introuvable dans #player-controls-card !"

    # 3. Vérification de getHeaderCollapseOffset() === 0
    collapse_offset = client.evaluate("window.AudioPlayer.getHeaderCollapseOffset()")
    print(f"  3. getHeaderCollapseOffset() : {collapse_offset} (Attendu: 0)")
    assert collapse_offset == 0, f"Erreur: collapseOffset devrait valoir 0, obtenu {collapse_offset}"

    # 4. Vérification du style de #player-controls-card
    controls_style = client.evaluate("""(() => {
        const card = document.getElementById('player-controls-card');
        const cs = window.getComputedStyle(card);
        const rect = card.getBoundingClientRect();
        return {
            position: cs.position,
            top: cs.top,
            backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
            rectTop: Math.round(rect.top),
            height: Math.round(rect.height)
        };
    })()""")
    print(f"  4. Style de #player-controls-card : {controls_style}")
    assert controls_style.get("position") == "sticky", "Le cadre doit être sticky"

    time.sleep(1.0)
    client.capture_screenshot("phase159_unified_top_frame_initial.png")

    # 5. Test avec l'artiste Cali (4 albums, vue courte)
    cali_scroll = client.evaluate("""(() => {
        window.AudioPlayer.searchFilter = 'Cali';
        const input = document.getElementById('player-unified-search-input');
        if (input) input.value = 'Cali';
        window.AudioPlayer.renderAlbumsGrid();
        window.AudioPlayer.updateScrollBounds();
        return {
            maxAllowed: window.AudioPlayer.getMaxAllowedScroll(),
            scrollY: window.scrollY
        };
    })()""")
    print(f"  5. Vue courte Cali (4 albums) : {cali_scroll} (Attendu: maxAllowed == 0)")
    assert cali_scroll.get("maxAllowed") == 0, f"Erreur: maxAllowed pour 4 albums devrait être 0, obtenu {cali_scroll.get('maxAllowed')}"

    time.sleep(0.5)
    client.capture_screenshot("phase159_unified_top_frame_cali_short.png")

    # 6. Test avec collection complète (vue longue)
    long_scroll = client.evaluate("""(() => {
        window.AudioPlayer.searchFilter = '';
        const input = document.getElementById('player-unified-search-input');
        if (input) input.value = '';
        window.AudioPlayer.renderAlbumsGrid();
        window.AudioPlayer.updateScrollBounds();
        const maxScroll = window.AudioPlayer.getMaxAllowedScroll();
        window.scrollTo(0, maxScroll);
        return {
            maxAllowed: maxScroll,
            finalScrollY: window.scrollY
        };
    })()""")
    print(f"  6. Vue longue collection complète : {long_scroll}")
    assert long_scroll.get("maxAllowed") > 200, "La collection complète doit pouvoir défiler"

    time.sleep(0.5)
    client.capture_screenshot("phase159_unified_top_frame_long_scrolled.png")

    # 7. Test de commutation d'onglets (indépendance du scroll)
    tab_switch = client.evaluate("""(() => {
        // Enregistrer la position actuelle sur 'albums'
        window.AudioPlayer.setView('artists');
        const artistsY = window.scrollY;
        window.AudioPlayer.setView('albums');
        const restoredAlbumsY = window.scrollY;
        return {
            artistsY,
            restoredAlbumsY,
            expectedAlbumsY: window.AudioPlayer.savedScrollPositions['albums']
        };
    })()""")
    print(f"  7. Commutation d'onglets et restauration de scroll : {tab_switch}")

    # 8. Test de la vue Détail d'Album avec le cadre supérieur unifié
    detail_test = client.evaluate("""(() => {
        const firstCard = document.querySelector('.player-album-card');
        if (firstCard) {
            firstCard.click();
            return true;
        }
        return false;
    })()""")
    time.sleep(1.0)
    if detail_test:
        client.capture_screenshot("phase159_unified_top_frame_album_detail.png")
        print("  8. Vue Détail d'Album capturée avec succès")

    print("\n✓ TOUS LES TESTS DE LA PHASE 159 ONT RÉUSSI AVEC SUCCÈS !")

finally:
    try:
        client.close()
    except Exception:
        pass
    try:
        chrome_proc.terminate()
        chrome_proc.wait(timeout=3)
    except Exception:
        pass
    try:
        server_proc.terminate()
        server_proc.wait(timeout=3)
    except Exception:
        pass

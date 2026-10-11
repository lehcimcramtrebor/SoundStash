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
PORT = 8053
CDP_PORT = 9263

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

print("=== TEST AUTOMATISÉ : PHASE 160 - CADRE FIXE EN MODE FENÊTRÉ & ESTOMPAGE SUPÉRIEUR ===")

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
        "--window-size=1600,900",
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

    def set_viewport(self, width, height):
        self.send("Emulation.setDeviceMetricsOverride", {
            "width": width,
            "height": height,
            "deviceScaleFactor": 1,
            "mobile": False
        })
        time.sleep(0.5)

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

    # Attente qu'AudioPlayer soit prêt
    for _ in range(30):
        ready = client.evaluate("typeof window.AudioPlayer !== 'undefined' && Boolean(window.AudioPlayer.isInitialized)")
        if ready:
            break
        time.sleep(0.5)

    print("✓ AudioPlayer initialisé")

    # Fermer le modal de bienvenue
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

    # 1. Vérification du style de .player-scroll-shade et #player-controls-card
    shade_and_card_info = client.evaluate("""(() => {
        const shade = document.querySelector('.player-scroll-shade');
        const card = document.getElementById('player-controls-card');
        const shadeCS = shade ? window.getComputedStyle(shade) : null;
        const cardCS = card ? window.getComputedStyle(card) : null;
        return {
            shadeHeight: shadeCS ? shadeCS.height : null,
            shadeBg: shadeCS ? shadeCS.backgroundImage || shadeCS.background : null,
            cardTop: cardCS ? cardCS.top : null,
            cardPadding: cardCS ? cardCS.padding : null,
            cardBorderRadius: cardCS ? cardCS.borderRadius : null
        };
    })()""")
    print(f"  1. Styles Shade & Card : {shade_and_card_info}")
    assert shade_and_card_info["cardTop"] == "8px", f"Attendu cardTop == 8px, obtenu {shade_and_card_info['cardTop']}"
    assert shade_and_card_info["shadeHeight"] == "28px", f"Attendu shadeHeight == 28px, obtenu {shade_and_card_info['shadeHeight']}"

    # 2. Test Plein Écran (1600x900)
    print("\n--- Test 2 : Plein Écran (1600x900) ---")
    client.set_viewport(1600, 900)
    fullscreen_metrics = client.evaluate("""(() => {
        const card = document.getElementById('player-controls-card');
        const header = card.querySelector('.player-header-bar');
        const nav = card.querySelector('.player-nav-tabs-bar');
        const toolbar = card.querySelector('.player-toolbar-row');
        return {
            cardHeight: card.offsetHeight,
            headerHeight: header.offsetHeight,
            navHeight: nav.offsetHeight,
            toolbarHeight: toolbar.offsetHeight,
            headerTop: header.getBoundingClientRect().top,
            toolbarTop: toolbar.getBoundingClientRect().top
        };
    })()""")
    print(f"  Métriques plein écran : {fullscreen_metrics}")
    client.capture_screenshot("phase160_fullscreen_fixed_height.png")

    # 3. Test Mode Fenêtré Standard (1180x850)
    print("\n--- Test 3 : Mode Fenêtré Standard (1180x850) ---")
    client.set_viewport(1180, 850)
    windowed_metrics = client.evaluate("""(() => {
        const card = document.getElementById('player-controls-card');
        const header = card.querySelector('.player-header-bar');
        const nav = card.querySelector('.player-nav-tabs-bar');
        const toolbar = card.querySelector('.player-toolbar-row');
        
        // Vérifier si des éléments visibles dans toolbar ont wrap
        const visibleChildren = Array.from(toolbar.children).filter(c => window.getComputedStyle(c).display !== 'none');
        const toolbarTops = visibleChildren.map(c => Math.round(c.getBoundingClientRect().top));
        const minTop = Math.min(...toolbarTops);
        const maxTop = Math.max(...toolbarTops);
        // S'il y a un wrap, maxTop - minTop serait > 25px (une nouvelle ligne)
        const hasWrap = (maxTop - minTop) > 15;

        return {
            cardHeight: card.offsetHeight,
            headerHeight: header.offsetHeight,
            navHeight: nav.offsetHeight,
            toolbarHeight: toolbar.offsetHeight,
            hasWrap: hasWrap,
            toolbarTops: toolbarTops,
            minTop: minTop,
            maxTop: maxTop
        };
    })()""")
    print(f"  Métriques fenêtré (1180px) : {windowed_metrics}")
    assert not windowed_metrics["hasWrap"], "Erreur: Les éléments de la barre d'outils ont wrap en 1180px !"
    print(f"  Différence de hauteur avec plein écran : {windowed_metrics['cardHeight'] - fullscreen_metrics['cardHeight']}px")
    assert abs(windowed_metrics['cardHeight'] - fullscreen_metrics['cardHeight']) <= 4, "La hauteur du cadre doit être constante et fixe !"

    client.capture_screenshot("phase160_windowed_1180px_fixed_height.png")

    # 4. Test Mode Fenêtré Étroit (1050x850)
    print("\n--- Test 4 : Mode Fenêtré Compact (1050x850) ---")
    client.set_viewport(1050, 850)
    compact_metrics = client.evaluate("""(() => {
        const card = document.getElementById('player-controls-card');
        const toolbar = card.querySelector('.player-toolbar-row');
        const visibleChildren = Array.from(toolbar.children).filter(c => window.getComputedStyle(c).display !== 'none');
        const toolbarTops = visibleChildren.map(c => Math.round(c.getBoundingClientRect().top));
        const minTop = Math.min(...toolbarTops);
        const maxTop = Math.max(...toolbarTops);
        const hasWrap = (maxTop - minTop) > 15;

        return {
            cardHeight: card.offsetHeight,
            toolbarHeight: toolbar.offsetHeight,
            hasWrap: hasWrap,
            toolbarTops: toolbarTops
        };
    })()""")
    print(f"  Métriques compact (1050px) : {compact_metrics}")
    assert not compact_metrics["hasWrap"], "Erreur: Les éléments de la barre d'outils ont wrap en 1050px !"
    assert abs(compact_metrics['cardHeight'] - fullscreen_metrics['cardHeight']) <= 4, "La hauteur du cadre doit rester fixe en 1050px !"
    client.capture_screenshot("phase160_windowed_1050px_fixed_height.png")

    # 5. Test Scroll et Masquage sous le coin supérieur
    print("\n--- Test 5 : Scroll sous le coin arrondi et estompage supérieur ---")
    client.set_viewport(1200, 850)
    scroll_test = client.evaluate("""(() => {
        // Faire défiler la page de 180px pour observer le passage sous le cadre sticky
        window.AudioPlayer.searchFilter = '';
        const input = document.getElementById('player-unified-search-input');
        if (input) input.value = '';
        window.AudioPlayer.renderAlbumsGrid();
        window.AudioPlayer.updateScrollBounds();
        window.scrollTo(0, 180);

        const card = document.getElementById('player-controls-card');
        const cardRect = card.getBoundingClientRect();
        const shade = document.querySelector('.player-scroll-shade');
        const shadeRect = shade.getBoundingClientRect();

        return {
            scrollY: window.scrollY,
            cardTop: Math.round(cardRect.top),
            shadeBottom: Math.round(shadeRect.bottom),
            isCardStickyTop8: cardRect.top === 8
        };
    })()""")
    print(f"  Test de défilement avec voile d'estompage : {scroll_test}")
    assert scroll_test["isCardStickyTop8"], "Le cadre sticky doit être ancré exactement à top: 8px"
    client.capture_screenshot("phase160_scroll_shade_coverage.png")

    print("\n✓ TOUS LES TESTS DE LA PHASE 160 SONT VALIDÉS AVEC SUCCÈS !")

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

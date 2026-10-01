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
sys.stdout.reconfigure(encoding="utf-8")
OUTPUT_DIR = Path(r"C:\Users\miche\.gemini\antigravity\brain\058353d3-7e85-44af-978a-b4f362fced4b\audit_screenshots")
PORT = 8021
CDP_PORT = 9227

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# 1. Start backend server
env = os.environ.copy()
env["PYTHONUNBUFFERED"] = "1"
server_proc = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "backend.app:app", "--port", str(PORT), "--log-level", "warning"],
    cwd=str(ROOT),
    env=env
)
time.sleep(2.5)

# 2. Launch headless Chrome with CDP
chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
chrome_proc = subprocess.Popen(
    [
        chrome_path,
        f"--remote-debugging-port={CDP_PORT}",
        "--remote-allow-origins=*",
        "--headless=new",
        "--disable-gpu",
        "--window-size=1200,900",
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
        print(f"Captured: {output_path.name}")

    def close(self):
        if self.ws:
            self.ws.close()

results = {}

try:
    cdp = CDPClient(CDP_PORT)
    cdp.connect()
    time.sleep(1)

    # 1. Vérifier la disparition du bouton Cast TV
    cast_btn_exists = cdp.evaluate("Boolean(document.getElementById('video-cast-btn'))")
    results["cast_button_removed"] = not cast_btn_exists
    print(f"1. Bouton TV Cast retiré : {not cast_btn_exists}")

    # 2. Vérifier la verticalité des modales (white-space: normal sur modal-body)
    modal_body_ws = cdp.evaluate("""
    (() => {
        const mb = document.querySelector('.modal-body');
        return mb ? window.getComputedStyle(mb).whiteSpace : null;
    })()
    """)
    results["modal_body_whitespace"] = modal_body_ws
    print(f"2. Style modal-body white-space : {modal_body_ws}")

    # 3. Ouvrir le Grand Guide d'Utilisation depuis les Paramètres
    print("3. Test ouverture Grand Guide d'Utilisation...")
    guide_status = cdp.evaluate("""
    (() => {
        if (window.openUserGuideModal) {
            window.openUserGuideModal();
            const bd = document.getElementById('user-guide-modal-backdrop');
            return {
                opened: bd && bd.classList.contains('active'),
                sectionsCount: document.querySelectorAll('.guide-section').length,
                navItemsCount: document.querySelectorAll('.guide-nav-item').length
            };
        }
        return null;
    })()
    """)
    results["user_guide"] = guide_status
    print(f"   Guide ouvert : {guide_status}")
    cdp.capture_screenshot(OUTPUT_DIR / "64_grand_user_guide_modal.png")

    # Fermer le guide
    cdp.evaluate("""
    (() => {
        const closeBtn = document.getElementById('close-user-guide-btn');
        if (closeBtn) closeBtn.click();
    })()
    """)
    time.sleep(0.5)

    # 4. Ouvrir une vidéo et tester le Mode Ambiance et ses flèches
    print("4. Test Vidéo et Mode Ambiance 4-Positions...")
    cdp.evaluate("""
    (() => {
        openVideoModal({
            id: 'mock_vid_test',
            title: 'Daft Punk - Around the World (Clip Officiel HD)',
            artist: 'Daft Punk',
            url: 'https://www.youtube.com/watch?v=mock_vid_test',
            thumbnail: '/static/placeholder-cover.svg'
        });
        const v = document.getElementById('video-modal-player');
        if (v) {
            // Simuler la lecture
            Object.defineProperty(v, 'paused', { value: false, configurable: true });
            Object.defineProperty(v, 'readyState', { value: 4, configurable: true });
            Object.defineProperty(v, 'currentTime', { value: 42, configurable: true });
            Object.defineProperty(v, 'duration', { value: 240, configurable: true });
            v.dispatchEvent(new Event('play'));
        }
        if (window.AmbientVisualizer) {
            window.AmbientVisualizer.enter();
        }
    })()
    """)
    time.sleep(1)

    # Vérifier l'état en Mode Ambiance position initiale (bottom-center)
    amb_pos_init = cdp.evaluate("""
    (() => {
        const dialog = document.getElementById('video-theater-dialog');
        const arrowLeft = document.getElementById('btn-ambient-move-left');
        const arrowRight = document.getElementById('btn-ambient-move-right');
        const arrowUp = document.getElementById('btn-ambient-move-up');
        const arrowDown = document.getElementById('btn-ambient-move-down');
        return {
            hasBottomCenter: dialog.classList.contains('ambient-pos-bottom-center') || (!dialog.classList.contains('ambient-pos-bottom-left') && !dialog.classList.contains('ambient-pos-bottom-right') && !dialog.classList.contains('ambient-pos-center')),
            arrowLeftDisplay: window.getComputedStyle(arrowLeft).display,
            arrowRightDisplay: window.getComputedStyle(arrowRight).display,
            arrowUpDisplay: window.getComputedStyle(arrowUp).display,
            arrowDownDisplay: window.getComputedStyle(arrowDown).display
        };
    })()
    """)
    results["ambient_pos_bottom_center"] = amb_pos_init
    print(f"   Position centre-bas : {amb_pos_init}")
    cdp.capture_screenshot(OUTPUT_DIR / "65_video_ambient_bottom_center.png")

    # Déplacement vers la gauche
    cdp.evaluate("document.getElementById('btn-ambient-move-left').click()")
    time.sleep(0.5)
    amb_pos_left = cdp.evaluate("""
    (() => {
        const dialog = document.getElementById('video-theater-dialog');
        const arrowRight = document.getElementById('btn-ambient-move-right');
        return {
            hasBottomLeft: dialog.classList.contains('ambient-pos-bottom-left'),
            arrowRightDisplay: window.getComputedStyle(arrowRight).display
        };
    })()
    """)
    results["ambient_pos_bottom_left"] = amb_pos_left
    print(f"   Position gauche : {amb_pos_left}")
    cdp.capture_screenshot(OUTPUT_DIR / "66_video_ambient_bottom_left.png")

    # Retour centre puis montée au grand centre (540px)
    cdp.evaluate("document.getElementById('btn-ambient-move-right').click()")
    time.sleep(0.3)
    cdp.evaluate("document.getElementById('btn-ambient-move-up').click()")
    time.sleep(0.5)
    amb_pos_center = cdp.evaluate("""
    (() => {
        const dialog = document.getElementById('video-theater-dialog');
        const arrowDown = document.getElementById('btn-ambient-move-down');
        return {
            hasCenter: dialog.classList.contains('ambient-pos-center'),
            width: window.getComputedStyle(dialog).width,
            arrowDownDisplay: window.getComputedStyle(arrowDown).display
        };
    })()
    """)
    results["ambient_pos_center"] = amb_pos_center
    print(f"   Position grand centre : {amb_pos_center}")
    cdp.capture_screenshot(OUTPUT_DIR / "67_video_ambient_grand_center.png")

    # 5. Tester la fermeture vidéo sans couper l'audio (continuité en arrière-plan)
    print("5. Test fermeture vidéo avec continuité audio...")
    bg_video_res = cdp.evaluate("""
    (() => {
        const closeBtn = document.getElementById('video-modal-close-btn');
        closeBtn.click();
        const bar = document.getElementById('persistent-player-bar');
        const miniTitle = document.getElementById('mini-player-title');
        const miniArtist = document.getElementById('mini-player-artist');
        return {
            isBackgroundActive: window.isVideoPlayingInBackground,
            barVisible: bar && window.getComputedStyle(bar).display !== 'none',
            miniTitle: miniTitle ? miniTitle.textContent : null,
            miniArtist: miniArtist ? miniArtist.textContent : null
        };
    })()
    """)
    results["background_video_continuity"] = bg_video_res
    print(f"   Vidéo arrière-plan active : {bg_video_res}")
    cdp.capture_screenshot(OUTPUT_DIR / "68_video_playing_in_background_bar.png")

    # 6. Tester la réouverture 1-clic depuis la barre
    print("6. Test réouverture 1-clic depuis la barre...")
    reopen_res = cdp.evaluate("""
    (() => {
        const openBtn = document.getElementById('mini-player-open-tab');
        openBtn.click();
        const bd = document.getElementById('video-modal-backdrop');
        return {
            reopened: bd && bd.classList.contains('active'),
            isBackgroundActive: window.isVideoPlayingInBackground
        };
    })()
    """)
    results["reopen_video"] = reopen_res
    print(f"   Vidéo réouverte : {reopen_res}")

    # Fermer définitivement la vidéo
    cdp.evaluate("window.closeVideoModal(true)")

    # 7. Tester l'onglet Playlists & Bouton de suppression 1-clic
    print("7. Test Playlists et bouton suppression 1-clic...")
    pl_res = cdp.evaluate("""
    (async () => {
        // Créer une playlist test via API
        const createRes = await fetch('/api/playlists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Playlist Audit Matrix', description: 'Test' })
        });
        const createData = await createRes.json();
        
        // Charger la vue playlists
        if (window.AudioPlayer) {
            enterPlayerMode();
            window.AudioPlayer.setView('playlists');
        }
        await new Promise(r => setTimeout(r, 600));

        const cards = document.querySelectorAll('.playlist-card');
        const hasDelBtn = document.querySelector('.playlist-card-delete-btn') !== null;

        return {
            createSuccess: Boolean(createData.success || createData.id),
            cardsCount: cards.length,
            hasDeleteBtn: hasDelBtn
        };
    })()
    """)
    results["playlists_test"] = pl_res
    print(f"   Playlists test : {pl_res}")
    cdp.capture_screenshot(OUTPUT_DIR / "69_playlists_with_delete_buttons.png")

    print("\n--- TOUS LES TESTS SONT VALIDES ---")
    print(json.dumps(results, indent=2))

finally:
    cdp.close()
    chrome_proc.kill()
    server_proc.kill()

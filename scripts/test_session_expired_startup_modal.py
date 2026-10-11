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
PORT = 8062
CDP_PORT = 9272

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

print("=== TEST AUTOMATISÉ : TEST DE SESSION EXPIRÉE AU DÉMARRAGE & MODALE DE NOTIFICATION ===")

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
            if resp.get("id") == self.msg_id:
                return resp.get("result", {})

    def eval(self, expr):
        res = self.send("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        return res.get("result", {}).get("value")

    def capture_screenshot(self, filename):
        res = self.send("Page.captureScreenshot", {"format": "png"})
        data = base64.b64decode(res["data"])
        out_path = OUTPUT_DIR / filename
        out_path.write_bytes(data)
        print(f"  [SCREENSHOT] {out_path.name} sauvegardé")
        return out_path

    def close(self):
        if self.ws:
            self.ws.close()

try:
    cdp = CDPClient(CDP_PORT)
    cdp.connect()

    cdp.eval("localStorage.setItem('ytm_has_seen_welcome', 'true'); localStorage.setItem('soundstash_has_seen_welcome', 'true');")

    print("\n1. Attente de l'exécution du test au démarrage (1.5s)...")
    time.sleep(1.8)

    # Vérification de l'état du badge Atelier / Recherche
    badge_info = cdp.eval("""
        (() => {
            const b = document.getElementById('search-session-status-badge');
            if (!b) return null;
            return {
                className: b.className,
                text: b.textContent.trim(),
                title: b.title,
                isWarning: b.classList.contains('badge-warning'),
                isSuccess: b.classList.contains('badge-success'),
                dotColor: b.querySelector('.session-dot')?.style.background
            };
        })()
    """)
    print(f"  Badge recherche au démarrage: {badge_info}")
    assert badge_info["isWarning"] is True, f"Le badge doit être 'badge-warning' ! Trouvé: {badge_info}"
    assert "expirée" in badge_info["text"].lower(), f"Le badge doit indiquer 'expirée' ! Trouvé: {badge_info['text']}"
    assert badge_info["isSuccess"] is False, "Le badge ne doit SURTOUT PAS être 'badge-success' !"
    print("  ✓ SUCCÈS : Le badge au démarrage indique immédiatement et fidèlement '⚠️ Session expirée'")

    # Vérification de l'apparition de la modale de notification
    modal_info = cdp.eval("""
        (() => {
            const backdrop = document.getElementById('custom-modal-backdrop');
            const title = document.getElementById('modal-title')?.textContent;
            const message = document.getElementById('modal-message')?.textContent;
            const btnConfirm = document.getElementById('modal-btn-confirm')?.textContent;
            const isVisible = backdrop && backdrop.classList.contains('active') && backdrop.style.display !== 'none';
            return { isVisible, title, message, btnConfirm };
        })()
    """)
    print(f"  Modale de notification: {modal_info}")
    assert modal_info["isVisible"] is True, f"La modale de notification doit être active et visible ! Trouvé: {modal_info}"
    assert "Session YouTube Expirée" in modal_info["title"], f"Titre incorrect : {modal_info['title']}"
    assert "Ouvrir les Paramètres" in modal_info["btnConfirm"], f"Bouton d'action incorrect : {modal_info['btnConfirm']}"
    print("  ✓ SUCCÈS : La modale d'alerte de session expirée est apparue au centre de l'écran avec bouton 'Ouvrir les Paramètres'")

    cdp.capture_screenshot("session_expired_startup_modal.png")

    # Clic sur le bouton de confirmation de la modale pour ouvrir les paramètres
    print("\n2. Clic sur 'Ouvrir les Paramètres' dans la modale...")
    cdp.eval("""
        (() => {
            const w = document.getElementById('welcome-wizard-backdrop');
            if (w) { w.style.display = 'none'; w.classList.remove('active'); }
            const btn = document.getElementById('modal-btn-confirm');
            if (btn) btn.click();
        })()
    """)
    time.sleep(1.0)

    # Vérification de la modale Paramètres
    settings_info = cdp.eval("""
        (() => {
            const settingsModal = document.getElementById('settings-modal-backdrop');
            const isOpen = settingsModal && settingsModal.classList.contains('active');
            const activeSubtab = document.querySelector('.settings-subtab-btn.active')?.getAttribute('data-subtab');
            const cfgBadge = document.getElementById('cfg-cookies-status-badge');
            const cfgDetails = document.getElementById('cfg-cookies-status-details')?.textContent;
            return {
                isOpen,
                activeSubtab,
                cfgBadgeText: cfgBadge ? cfgBadge.textContent.trim() : null,
                cfgBadgeClass: cfgBadge ? cfgBadge.className : null,
                cfgDetails
            };
        })()
    """)
    print(f"  Paramètres après redirection: {settings_info}")
    assert settings_info["isOpen"] is True, "La modale des Paramètres doit être ouverte !"
    assert settings_info["activeSubtab"] == "subtab-system", f"L'onglet actif doit être 'subtab-system' ! Trouvé: {settings_info['activeSubtab']}"
    assert "expirée" in settings_info["cfgBadgeText"].lower(), f"Le badge des paramètres doit indiquer l'expiration ! Trouvé: {settings_info['cfgBadgeText']}"
    assert "warning" in settings_info["cfgBadgeClass"].lower(), f"Le badge des paramètres doit être en warning ! Trouvé: {settings_info['cfgBadgeClass']}"
    print("  ✓ SUCCÈS : Les Paramètres s'ouvrent directement sur l'onglet Système / Cookies avec le badge ⚠️ Session expirée")

    cdp.capture_screenshot("session_expired_in_settings.png")

    print("\n3. Fermeture des Paramètres et vérification du badge dans l'Atelier / Recherche...")
    cdp.eval("""
        (() => {
            closeSettingsModal();
            switchTab('tab-search');
        })()
    """)
    time.sleep(0.6)

    search_badge_info = cdp.eval("""
        (() => {
            const b = document.getElementById('search-session-status-badge');
            return {
                text: b ? b.textContent.trim() : null,
                isWarning: b ? b.classList.contains('badge-warning') : false,
                isSuccess: b ? b.classList.contains('badge-success') : false
            };
        })()
    """)
    print(f"  Badge dans l'Atelier: {search_badge_info}")
    assert search_badge_info["isWarning"] is True, "Le badge de l'Atelier doit être en warning !"
    assert search_badge_info["isSuccess"] is False, "Le badge de l'Atelier ne doit pas être en success !"
    assert "expirée" in search_badge_info["text"].lower(), "Le badge de l'Atelier doit indiquer 'expirée' !"
    cdp.capture_screenshot("session_expired_in_search_tab.png")
    print("  ✓ SUCCÈS : Le badge dans l'Atelier reste 100% à jour en ⚠️ Session expirée")

    print("\n=== TOUS LES TESTS SONT PASSÉS AVEC SUCCÈS (100% VALIDÉ) ===")

finally:
    try:
        cdp.close()
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

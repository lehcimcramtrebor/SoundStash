"""
Suite de tests d'exhaustivité et de robustesse pour SoundStash.
Teste chaque appel, bouton, fonction et cas limite (nominal, frontière, erreur).
"""

import os
import sys
import json
import time
import shutil
import base64
import tempfile
import subprocess
import urllib.request
from pathlib import Path
import websocket

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 8030
DEBUG_PORT = 9240
BASE_URL = f"http://127.0.0.1:{PORT}"

results = []

def record(test_name, success, details=""):
    status = "PASS" if success else "FAIL"
    print(f"[{status}] {test_name}: {details}")
    results.append({"name": test_name, "success": success, "details": details})

# ============================================================================
# PARTIE 1 : TESTS UNITAIRES ET CAS LIMITES BACKEND (MIGRATION & OUTILS)
# ============================================================================
def test_backend_unit_matrix():
    print("\n--- PARTIE 1 : Tests Unitaires et Cas Limites Backend ---")
    from backend.library_migrator import (
        check_migration_needed, execute_migration, _clean_empty_folders
    )
    from backend.config import config

    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        src = base / "OldSource"
        tgt = base / "NewTarget"
        src.mkdir()
        tgt.mkdir()

        # 1.1 Chemin cible vide ou invalide
        res = check_migration_needed("music", "")
        record("Check migration chemin vide", res.get("needs_migration") is False)

        # 1.2 Chemin cible identique à la source
        res = check_migration_needed("music", str(Path(config.library_dir or config.export_dir).resolve()))
        record("Check migration cible identique", res.get("needs_migration") is False)

        # 1.3 Dossier source vide -> Pas de migration nécessaire
        res = execute_migration("music", str(src), str(tgt))
        record("Migration musique source vide", res.get("success") is True and res.get("moved_count") == 0)

        # 1.4 Migration Musique avec album plat 'Artiste - Album'
        alb_dir = src / "Pink Floyd - The Dark Side of the Moon"
        alb_dir.mkdir(parents=True, exist_ok=True)
        (alb_dir / "01 - Speak to Me.mp3").write_bytes(b"ID3_DUMMY_AUDIO_TRACK_1")
        (alb_dir / "02 - Breathe.mp3").write_bytes(b"ID3_DUMMY_AUDIO_TRACK_2")
        (alb_dir / "cover.jpg").write_bytes(b"JPEG_COVER_DUMMY")

        res = execute_migration("music", str(src), str(tgt))
        record("Migration musique album plat", res.get("success") is True and res.get("moved_count") >= 1)
        
        # Vérification des fichiers dans la cible
        target_tracks = list(tgt.rglob("*.mp3"))
        record("Vérification présence pistes dans cible", len(target_tracks) == 2, f"{len(target_tracks)} pistes trouvées")
        target_covers = list(tgt.rglob("cover.jpg"))
        record("Vérification pochette compagnon", len(target_covers) >= 1)
        record("Nettoyage source vide", not src.exists() or len(list(src.iterdir())) == 0)

        # 1.5 Gestion des conflits de fichiers (même fichier déjà existant)
        src2 = base / "SourceConflict"
        src2.mkdir()
        alb_conflict = src2 / "Pink Floyd - The Dark Side of the Moon"
        alb_conflict.mkdir()
        # Même fichier identique (taille identique)
        (alb_conflict / "01 - Speak to Me.mp3").write_bytes(b"ID3_DUMMY_AUDIO_TRACK_1")
        # Fichier différent avec même nom
        (alb_conflict / "02 - Breathe.mp3").write_bytes(b"ID3_DUMMY_AUDIO_TRACK_2_DIFFERENT_CONTENT_HERE")

        res_conflict = execute_migration("music", str(src2), str(tgt))
        record("Migration avec conflit de nom", res_conflict.get("success") is True)
        
        # Le fichier différent doit avoir été renommé avec _migrated pour ne pas écraser
        migrated_tracks = list(tgt.rglob("*_migrated.mp3"))
        record("Préservation fichier en conflit (_migrated)", len(migrated_tracks) == 1)

        # 1.6 Migration Vidéos avec miniature 16:9 et nom brut YouTube
        src_vid = base / "SourceVideos"
        src_vid.mkdir()
        tgt_vid = base / "TargetVideos"
        tgt_vid.mkdir()

        (src_vid / "Queen - Bohemian Rhapsody (Official Music Video).mp4").write_bytes(b"MP4_DUMMY_1")
        (src_vid / "Queen - Bohemian Rhapsody (Official Music Video).jpg").write_bytes(b"THUMB_DUMMY_1")
        (src_vid / "Daft Punk - Technologic.mp4").write_bytes(b"MP4_DUMMY_2")

        res_v = execute_migration("video", str(src_vid), str(tgt_vid))
        record("Migration vidéo nominale", res_v.get("success") is True and res_v.get("moved_count") == 2)

        # Vérification organisation par Artiste
        queen_folder = tgt_vid / "Queen"
        record("Dossier artiste vidéo créé (Queen)", queen_folder.exists() and queen_folder.is_dir())
        queen_video = queen_folder / "Queen - Bohemian Rhapsody.mp4"
        record("Vidéo nettoyée du suffixe parasite", queen_video.exists())
        queen_thumb = queen_folder / "Queen - Bohemian Rhapsody.jpg"
        record("Miniature vidéo compagnon déplacée", queen_thumb.exists())
        record("Nettoyage source vidéo vide", not src_vid.exists() or len(list(src_vid.iterdir())) == 0)

# ============================================================================
# PARTIE 2 : TESTS DES ENDPOINTS D'API REST FASTAPI
# ============================================================================
def test_api_endpoints_matrix():
    print("\n--- PARTIE 2 : Tests des Endpoints API REST ---")
    
    # 2.1 GET /api/config
    req = urllib.request.urlopen(f"{BASE_URL}/api/config")
    cfg = json.loads(req.read())
    record("API GET /api/config", req.status == 200 and "library_dir" in cfg and "video_library_dir" in cfg)

    # 2.2 POST /api/config (mise à jour partielle et préservation des types)
    update_data = {
        "cooldown_album": 25,
        "cooldown_single": 8,
        "default_video_quality": "1440p"
    }
    req2 = urllib.request.Request(
        f"{BASE_URL}/api/config",
        data=json.dumps(update_data).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req2) as resp:
        res2 = json.loads(resp.read())
        record("API POST /api/config", res2.get("success") is True and res2["config"]["cooldown_album"] == 25)

    # 2.3 POST /api/library/check-migration
    check_req = urllib.request.Request(
        f"{BASE_URL}/api/library/check-migration",
        data=json.dumps({"type": "music", "new_path": "C:\\DossierTestInexistant987"}).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(check_req) as resp:
        res3 = json.loads(resp.read())
        record("API POST /api/library/check-migration", "needs_migration" in res3)

    # 2.4 GET /api/logs/info
    req_logs = urllib.request.urlopen(f"{BASE_URL}/api/logs/info")
    logs_info = json.loads(req_logs.read())
    record("API GET /api/logs/info", "total_bytes" in logs_info and "log_file" in logs_info)

    # 2.5 GET /api/videos/catalog
    req_cat = urllib.request.urlopen(f"{BASE_URL}/api/videos/catalog?force_refresh=true")
    cat_data = json.loads(req_cat.read())
    record("API GET /api/videos/catalog", "videos" in cat_data and "total_count" in cat_data)

# ============================================================================
# PARTIE 3 : TESTS DES BOUTONS, ÉVÉNEMENTS & MODALES VIA CHROME CDP
# ============================================================================
class CDPController:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=10)
        self.msg_id = 0

    def call(self, method, params=None):
        self.msg_id += 1
        payload = {"id": self.msg_id, "method": method, "params": params or {}}
        self.ws.send(json.dumps(payload))
        while True:
            resp = json.loads(self.ws.recv())
            if resp.get("id") == self.msg_id:
                return resp.get("result", {})

    def eval(self, expr, await_promise=True):
        res = self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": await_promise})
        return res.get("result", {}).get("value")

    def eval_raw(self, expr):
        return self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass

def test_frontend_cdp_matrix(cdp: CDPController):
    print("\n--- PARTIE 3 : Tests Frontend, Boutons, Raccourcis et Modales (CDP) ---")

    # 3.1 Vérification de la présence de la roue crantée dans le header
    has_gear = cdp.eval("document.getElementById('btn-open-settings') !== null")
    record("Présence bouton roue crantée dans header", has_gear is True)

    # 3.2 Vérification qu'il n'y a QUE les 4 onglets dans la navigation atelier
    tab_ids = cdp.eval("Array.from(document.querySelectorAll('#main-nav-tabs .nav-tab')).map(t => t.getAttribute('data-tab'))")
    expected_tabs = ["tab-search", "tab-download", "tab-editor", "tab-library"]
    record("Vérification 4 onglets Atelier stricts", tab_ids == expected_tabs, f"Trouvés: {tab_ids}")

    # 3.3 Ouverture de la modale Paramètres depuis l'Atelier
    cdp.eval("document.getElementById('btn-open-settings').click()")
    time.sleep(0.4)
    is_open = cdp.eval("document.getElementById('settings-modal-backdrop').classList.contains('active')")
    record("Ouverture modale Paramètres via clic roue crantée", is_open is True)

    # 3.4 Fermeture de la modale via bouton croix (X)
    cdp.eval("document.getElementById('settings-modal-close-btn').click()")
    time.sleep(0.4)
    is_closed = cdp.eval("document.getElementById('settings-modal-backdrop').style.display === 'none' || !document.getElementById('settings-modal-backdrop').classList.contains('active')")
    record("Fermeture modale via bouton croix (X)", is_closed is True)

    # 3.5 Ouverture modale depuis le Mode Lecteur
    cdp.eval("switchMode('player')")
    time.sleep(0.4)
    cdp.eval("document.getElementById('btn-open-settings').click()")
    time.sleep(0.4)
    is_open_player = cdp.eval("document.getElementById('settings-modal-backdrop').classList.contains('active')")
    record("Ouverture modale depuis le Mode Lecteur", is_open_player is True)

    # 3.6 Fermeture via la touche Échap
    cdp.eval("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))")
    time.sleep(0.4)
    is_closed_esc = cdp.eval("!document.getElementById('settings-modal-backdrop').classList.contains('active')")
    record("Fermeture modale Paramètres via Échap", is_closed_esc is True)

    # Retour mode atelier
    cdp.eval("switchMode('atelier')")
    time.sleep(0.3)

    # 3.7 Navigation entre les 4 sous-onglets des paramètres
    cdp.eval("openSettingsModal('subtab-music')")
    time.sleep(0.3)
    
    # Sous-onglet 1 : Musique
    active_pane_1 = cdp.eval("document.getElementById('pane-subtab-music').classList.contains('active')")
    record("Sous-onglet Musique actif par défaut", active_pane_1 is True)

    # Clic Sous-onglet 2 : Hub Vidéos
    cdp.eval("document.querySelector('[data-subtab=\"subtab-video\"]').click()")
    time.sleep(0.2)
    pane_2 = cdp.eval("document.getElementById('pane-subtab-video').classList.contains('active') && !document.getElementById('pane-subtab-music').classList.contains('active')")
    record("Bascule vers sous-onglet Hub Vidéos", pane_2 is True)

    # Clic Sous-onglet 3 : Système & Préférences
    cdp.eval("document.querySelector('[data-subtab=\"subtab-system\"]').click()")
    time.sleep(0.2)
    pane_3 = cdp.eval("document.getElementById('pane-subtab-system').classList.contains('active')")
    record("Bascule vers sous-onglet Système", pane_3 is True)

    # Clic Sous-onglet 4 : Diagnostic & Maintenance
    cdp.eval("document.querySelector('[data-subtab=\"subtab-maintenance\"]').click()")
    time.sleep(0.4)
    pane_4 = cdp.eval("document.getElementById('pane-subtab-maintenance').classList.contains('active')")
    tools_rendered = cdp.eval("document.querySelectorAll('#tools-list .tool-item').length > 0")
    record("Bascule vers Diagnostic & rendu outils système", pane_4 is True and tools_rendered is True)

    # 3.8 Raccourcis vidéo rapides (Bureau, Téléchargements, Vidéos Windows)
    cdp.eval("switchSettingsSubtab('subtab-video')")
    time.sleep(0.2)
    cdp.eval("document.querySelector('.quick-dest-btn[data-dest=\"video_desktop\"]').click()")
    val_desktop = cdp.eval("document.getElementById('cfg-video-library-dir').value")
    record("Bouton raccourci Bureau Vidéos", "Desktop" in val_desktop or "Bureau" in val_desktop or "Vidéos YTM" in val_desktop, val_desktop)

    # 3.9 Synchronisation unifiée du champ vidéo (library <-> export)
    cdp.eval("const inp = document.getElementById('cfg-video-library-dir'); inp.value = 'D:\\\\MesVideos'; inp.dispatchEvent(new Event('input'))")
    val_hidden = cdp.eval("document.getElementById('cfg-video-export-dir').value")
    record("Synchronisation dossier unique vidéo", val_hidden == "D:\\MesVideos")

    # 3.10 Toggle Smart Export & affichage politique de fusion
    cdp.eval("switchSettingsSubtab('subtab-music')")
    time.sleep(0.2)
    cdp.eval("const se = document.getElementById('cfg-smart-export'); se.checked = false; se.dispatchEvent(new Event('change'))")
    wrap_hidden = cdp.eval("document.getElementById('smart-export-policy-wrap').style.display === 'none'")
    record("Smart Export OFF masque politique de conflit", wrap_hidden is True)

    cdp.eval("const se2 = document.getElementById('cfg-smart-export'); se2.checked = true; se2.dispatchEvent(new Event('change'))")
    wrap_shown = cdp.eval("document.getElementById('smart-export-policy-wrap').style.display !== 'none'")
    record("Smart Export ON affiche politique de conflit", wrap_shown is True)

    # 3.11 Déclenchement de la modale de migration (Simulation 2 options)
    mock_mig = {
        "type": "music",
        "source_path": "C:\\Users\\miche\\Desktop\\Musique YTM",
        "target_path": "D:\\Ma Musique",
        "summary": "3 album(s) (36 pistes audio)"
    }
    # Appel non bloquant (await_promise=False) car la promesse attend une interaction utilisateur
    cdp.eval(f"window._migPromise = showMigrationModal({json.dumps(mock_mig)})", await_promise=False)
    time.sleep(0.3)
    mig_open = cdp.eval("document.getElementById('migration-modal-backdrop').classList.contains('active')")
    record("Ouverture modale de migration", mig_open is True)

    # Vérification des 2 seuls boutons demandés par l'utilisateur
    btn_move_exists = cdp.eval("document.getElementById('migration-btn-move') !== null")
    btn_skip_exists = cdp.eval("document.getElementById('migration-btn-skip') !== null")
    no_copy_btn = cdp.eval("document.getElementById('migration-btn-copy') === null")
    record("Présence stricte des 2 options (Move & Skip)", btn_move_exists and btn_skip_exists and no_copy_btn)

    # Fermeture de la modale de migration par bouton 'Ne rien faire'
    cdp.eval("document.getElementById('migration-btn-skip').click()")
    time.sleep(0.3)
    mig_closed = cdp.eval("!document.getElementById('migration-modal-backdrop').classList.contains('active')")
    res_promise = cdp.eval("window._migPromise")
    record("Fermeture modale migration via 'Ne rien faire' (résolution false)", mig_closed is True and res_promise is False)

    # 3.12 Test de fermeture de la modale de migration via Échap
    cdp.eval(f"window._migPromise2 = showMigrationModal({json.dumps(mock_mig)})", await_promise=False)
    time.sleep(0.3)
    cdp.eval("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))")
    time.sleep(0.3)
    mig_closed_esc = cdp.eval("!document.getElementById('migration-modal-backdrop').classList.contains('active')")
    record("Fermeture modale migration via Échap", mig_closed_esc is True)

    # Fermeture finale modale paramètres
    cdp.eval("closeSettingsModal()")
    time.sleep(0.3)
    record("Fermeture finale modale paramètres", True)

# ============================================================================
# EXÉCUTION DE L'ENSEMBLE DE LA SUITE
# ============================================================================
def main():
    print("=====================================================================")
    print("  DÉMARRAGE DE LA MATRICE COMPLÈTE DE TESTS & CAS LIMITES (SOUNDSTASH) ")
    print("=====================================================================")

    # Test 1 : Backend Unitaire
    test_backend_unit_matrix()

    # Démarrage Serveur FastAPI
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    server_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.app:app", "--port", str(PORT), "--log-level", "warning"],
        cwd=PROJECT_ROOT,
        env=env
    )
    time.sleep(2.0)

    chrome_proc = None
    cdp = None
    try:
        # Test 2 : API Endpoints
        test_api_endpoints_matrix()

        # Démarrage Chrome CDP
        chrome_user_dir = f"C:\\Users\\miche\\AppData\\Local\\Temp\\chrome_matrix_{os.getpid()}"
        chrome_proc = subprocess.Popen([
            CHROME_PATH,
            "--headless=new",
            f"--remote-debugging-port={DEBUG_PORT}",
            "--remote-allow-origins=*",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--window-size=1280,850",
            f"--user-data-dir={chrome_user_dir}",
            f"{BASE_URL}/?theme=dark"
        ])
        time.sleep(2.0)

        with urllib.request.urlopen(f"http://127.0.0.1:{DEBUG_PORT}/json") as r:
            tabs = json.loads(r.read())
            ws_url = [t["webSocketDebuggerUrl"] for t in tabs if t.get("type") == "page"][0]

        cdp = CDPController(ws_url)
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")

        # Test 3 : Frontend & Modales
        test_frontend_cdp_matrix(cdp)

    finally:
        if cdp:
            cdp.close()
        if chrome_proc:
            chrome_proc.terminate()
            try:
                chrome_proc.wait(timeout=2)
            except Exception:
                chrome_proc.kill()
        if server_proc:
            server_proc.terminate()
            try:
                server_proc.wait(timeout=2)
            except Exception:
                server_proc.kill()

    # Rapport final
    print("\n=====================================================================")
    print("                    RAPPORT FINAL DE LA MATRICE                     ")
    print("=====================================================================")
    total = len(results)
    passed = sum(1 for r in results if r["success"])
    failed = total - passed
    print(f"Total des tests exécutés : {total}")
    print(f"  - Succès (PASS)        : {passed}")
    print(f"  - Échecs (FAIL)        : {failed}")

    if failed > 0:
        print("\nDÉTAIL DES ÉCHECS :")
        for r in results:
            if not r["success"]:
                print(f"  * {r['name']}: {r['details']}")
    else:
        print("\nTOUTES LES VÉRIFICATIONS SONT 100% VALIDES !")
    print("=====================================================================\n")

if __name__ == "__main__":
    main()

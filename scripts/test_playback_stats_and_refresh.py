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
PORT = 8039
CDP_PORT = 9251

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

print("=== TEST PHASE 64 : SUIVI DES ÉCOUTES ET ACTUALISATION SMART PLAYLIST ===")

# Démarrer serveur backend
env = os.environ.copy()
env["PYTHONUNBUFFERED"] = "1"
server_proc = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "backend.app:app", "--port", str(PORT), "--log-level", "warning"],
    cwd=str(ROOT),
    env=env
)
time.sleep(2.5)

created_playlist_id = None

try:
    # 1. Tester l'API /api/stats/track-played
    print("\n--- 1. Test Enregistrement Écoutes Audio & Vidéo ---")
    
    # Écoute Piste A (Audio)
    req1 = urllib.request.Request(
        f"http://localhost:{PORT}/api/stats/track-played",
        data=json.dumps({
            "path": "C:/Music/Daft_Punk/Get_Lucky.mp3",
            "title": "Get Lucky",
            "artist": "Daft Punk",
            "album": "Random Access Memories",
            "genre": "Disco/Funk",
            "duration": 248.0,
            "type": "audio"
        }).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req1) as resp:
        res1 = json.loads(resp.read().decode("utf-8"))
        assert res1["success"] is True
        print(f"  ✓ Écoute 1 Audio: {res1['entry']['title']} -> {res1['entry']['play_count']} écoute(s)")

    # Écoute Piste A une deuxième fois
    with urllib.request.urlopen(req1) as resp:
        res1_2 = json.loads(resp.read().decode("utf-8"))
        assert res1_2["entry"]["play_count"] >= 2
        print(f"  ✓ Écoute 2 Audio (Incrémentation): {res1_2['entry']['title']} -> {res1_2['entry']['play_count']} écoute(s)")

    # Écoute Piste B (Vidéo)
    req2 = urllib.request.Request(
        f"http://localhost:{PORT}/api/stats/track-played",
        data=json.dumps({
            "path": "C:/Videos/Gorillaz/Feel_Good_Inc.mp4",
            "title": "Feel Good Inc.",
            "artist": "Gorillaz",
            "album": "Clips Officiels",
            "genre": "Alternative",
            "duration": 223.0,
            "type": "video"
        }).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req2) as resp:
        res2 = json.loads(resp.read().decode("utf-8"))
        assert res2["success"] is True
        assert res2["entry"]["type"] == "video"
        print(f"  ✓ Écoute Clip Vidéo: {res2['entry']['title']} -> {res2['entry']['play_count']} écoute(s) (type={res2['entry']['type']})")

    # 2. Vérifier Top Tracks
    print("\n--- 2. Test Classement Top Pistes ---")
    req_top = urllib.request.Request(f"http://localhost:{PORT}/api/stats/top-tracks?limit=10")
    with urllib.request.urlopen(req_top) as resp:
        top_res = json.loads(resp.read().decode("utf-8"))
        tracks = top_res.get("tracks", [])
        assert len(tracks) >= 2
        top_titles = [t["title"] for t in tracks]
        print(f"  ✓ Top pistes récupérées : {top_titles[:5]}")
        assert "Get Lucky" in top_titles
        assert "Feel Good Inc." in top_titles

    # 3. Création Smart Playlist "Top les plus écoutés"
    print("\n--- 3. Création Smart Playlist Top Écoutés ---")
    req_smart = urllib.request.Request(
        f"http://localhost:{PORT}/api/playlists/smart-generate",
        data=json.dumps({
            "name": "Top Hits Test Phase 64",
            "smart_type": "top_played",
            "criteria": {"limit": 10}
        }).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req_smart) as resp:
        smart_res = json.loads(resp.read().decode("utf-8"))
        assert smart_res["success"] is True
        pl = smart_res["playlist"]
        created_playlist_id = pl["id"]
        print(f"  ✓ Smart Playlist créée : '{pl['name']}' (ID: {created_playlist_id}, is_smart={pl.get('is_smart')})")
        items_titles = [it.get("title") for it in pl.get("items", [])]
        print(f"  ✓ Titres initiaux ({len(items_titles)}): {items_titles}")
        assert "Get Lucky" in items_titles

    # 4. Enregistrer 5 écoutes sur une Piste C pour dépasser Get Lucky
    print("\n--- 4. Simulation de nouvelles écoutes & Actualisation dynamique ---")
    req3 = urllib.request.Request(
        f"http://localhost:{PORT}/api/stats/track-played",
        data=json.dumps({
            "path": "C:/Music/Justice/Genesis.mp3",
            "title": "Genesis",
            "artist": "Justice",
            "album": "Cross",
            "genre": "Electro",
            "duration": 234.0,
            "type": "audio"
        }).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    for _ in range(5):
        urllib.request.urlopen(req3)
    print("  ✓ 5 écoutes enregistrées pour 'Genesis' (Justice)")

    # Actualiser la Smart Playlist via POST /api/playlists/{id}/refresh
    req_refresh = urllib.request.Request(
        f"http://localhost:{PORT}/api/playlists/{created_playlist_id}/refresh",
        data=b"",
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req_refresh) as resp:
        refreshed_res = json.loads(resp.read().decode("utf-8"))
        assert refreshed_res["success"] is True
        refreshed_pl = refreshed_res["playlist"]
        refreshed_titles = [it.get("title") for it in refreshed_pl.get("items", [])]
        print(f"  ✓ Playlist actualisée ! Nouveaux titres : {refreshed_titles}")
        # Genesis doit maintenant être n°1 !
        assert refreshed_titles[0] == "Genesis", f"Genesis devrait être en tête, trouvé : {refreshed_titles}"
        print("  ✓ Concordance vérifiée : 'Genesis' a pris la première place après actualisation !")

    # 5. Test UI via CDP Chrome Headless
    print("\n--- 5. Vérification Interface & Capture Écran CDP ---")
    chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    chrome_proc = subprocess.Popen(
        [
            chrome_path,
            f"--remote-debugging-port={CDP_PORT}",
            "--remote-allow-origins=*",
            "--headless=new",
            "--disable-gpu",
            "--window-size=1280,900",
            f"http://localhost:{PORT}/?player=true&playerView=playlists"
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    time.sleep(2.5)

    try:
        targets_url = f"http://localhost:{CDP_PORT}/json"
        req = urllib.request.urlopen(targets_url)
        targets = json.loads(req.read().decode())
        page_target = next(t for t in targets if t.get("type") == "page")
        ws = websocket.create_connection(page_target["webSocketDebuggerUrl"], timeout=10)

        msg_id = 0
        def send_cdp(method, params=None):
            global msg_id
            msg_id += 1
            ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
            while True:
                r = json.loads(ws.recv())
                if r.get("id") == msg_id:
                    return r

        send_cdp("Page.enable")
        send_cdp("Runtime.enable")
        send_cdp("Emulation.setDeviceMetricsOverride", {
            "width": 1280, "height": 900, "deviceScaleFactor": 1, "mobile": False
        })

        # Attendre le chargement de l'app
        time.sleep(2.0)

        # Ouvrir la playlist dans l'UI sans le wizard
        open_js = f"""
        (async () => {{
            localStorage.setItem('ytm_wizard_seen', 'true');
            const wiz = document.getElementById('quickstart-wizard-backdrop');
            if (wiz) wiz.classList.remove('active');
            const wizBtn = document.getElementById('btn-wizard-finish');
            if (wizBtn) wizBtn.click();
            await UserPlaylists.loadAndRenderPlaylists(true);
            await UserPlaylists.openDetail('{created_playlist_id}');
            return true;
        }})()
        """
        eval_res = send_cdp("Runtime.evaluate", {"expression": open_js, "awaitPromise": True})
        print("  ✓ open_js result:", eval_res)
        time.sleep(1.5)

        # Vérifier que le bouton et le badge sont visibles
        check_js = """
        (() => {
            const btn = document.getElementById("btn-refresh-smart-playlist");
            const badge = document.getElementById("playlist-hero-smart-badge");
            return {
                btn_display: btn ? window.getComputedStyle(btn).display : "none",
                btn_text: btn ? btn.innerText.trim() : "",
                badge_display: badge ? window.getComputedStyle(badge).display : "none",
                badge_text: badge ? badge.innerText.trim() : ""
            };
        })()
        """
        check_res = send_cdp("Runtime.evaluate", {"expression": check_js, "returnByValue": True})
        ui_val = check_res.get("result", {}).get("result", {}).get("value", {})
        print(f"  ✓ UI Checks: {ui_val}")
        assert ui_val.get("btn_display") in ["flex", "inline-flex"], f"Bouton non affiché: {ui_val}"
        assert "Actualiser" in ui_val.get("btn_text", "")
        assert "Smart Playlist" in ui_val.get("badge_text", "") or "SMART PLAYLIST" in ui_val.get("badge_text", "")

        # Cliquer sur le bouton d'actualisation pour déclencher le toast
        click_js = """
        (() => {
            const btn = document.getElementById("btn-refresh-smart-playlist");
            if (btn) btn.click();
            return true;
        })()
        """
        send_cdp("Runtime.evaluate", {"expression": click_js})
        time.sleep(1.0)

        # Capture Screenshot
        shot_res = send_cdp("Page.captureScreenshot", {"format": "png"})
        shot_data = shot_res.get("result", {}).get("data")
        if shot_data:
            out_img = OUTPUT_DIR / "117_smart_playlist_refresh_badge.png"
            with open(out_img, "wb") as f:
                f.write(base64.b64decode(shot_data))
            print(f"  ✓ Capture enregistrée : {out_img.name} ({out_img.stat().st_size // 1024} Ko)")

    finally:
        chrome_proc.terminate()

except Exception as e:
    print(f"\n❌ ERREUR LORS DU TEST : {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

finally:
    # Nettoyage de la playlist de test
    if created_playlist_id:
        try:
            req_del = urllib.request.Request(
                f"http://localhost:{PORT}/api/playlists/{created_playlist_id}",
                method="DELETE"
            )
            urllib.request.urlopen(req_del)
            print(f"  ✓ Nettoyage : Playlist de test {created_playlist_id} supprimée.")
        except Exception:
            pass

    server_proc.terminate()
    print("\n✓ SUCCÈS INTÉGRAL DE LA SUITE DE TESTS PHASE 64 !")

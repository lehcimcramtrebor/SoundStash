import os
import sys
import time
import subprocess
import urllib.request
from pathlib import Path

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
OUTPUT_DIR = Path(r"C:\Users\miche\.gemini\antigravity\brain\058353d3-7e85-44af-978a-b4f362fced4b\audit_screenshots")
USER_DATA_DIR = Path(r"C:\Users\miche\AppData\Local\Temp\chrome_sort_audit")
PORT = 8003

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
USER_DATA_DIR.mkdir(parents=True, exist_ok=True)

VIEWS = [
    # 1. Vue par défaut avec nouveaux contrôles (Tri Pertinence + Sous-filtre Tous)
    ("13_search_controls_relevance_dark", "/?tab=tab-search&theme=dark&search=daft+punk&filter=album"),
    ("13_search_controls_relevance_light", "/?tab=tab-search&theme=light&search=daft+punk&filter=album"),

    # 2. Sous-filtre "💿 Albums Studio" (LP ≥ 6 pistes)
    ("14_search_subfilter_lp_dark", "/?tab=tab-search&theme=dark&search=daft+punk&filter=album&subfilter=lp"),
    ("14_search_subfilter_lp_light", "/?tab=tab-search&theme=light&search=daft+punk&filter=album&subfilter=lp"),

    # 3. Sous-filtre "⚡ Singles & EPs" (1 à 5 pistes)
    ("15_search_subfilter_singles_dark", "/?tab=tab-search&theme=dark&search=daft+punk&filter=album&subfilter=single_ep"),
    ("15_search_subfilter_singles_light", "/?tab=tab-search&theme=light&search=daft+punk&filter=album&subfilter=single_ep"),

    # 4. Tri Chronologique Ancien ➔ Récent
    ("16_search_sort_chrono_dark", "/?tab=tab-search&theme=dark&search=daft+punk&filter=album&sort=year-asc"),
    ("16_search_sort_chrono_light", "/?tab=tab-search&theme=light&search=daft+punk&filter=album&sort=year-asc"),

    # 5. Tri Alphabétique A ➔ Z
    ("17_search_sort_alpha_dark", "/?tab=tab-search&theme=dark&search=daft+punk&filter=album&sort=alpha-asc"),
    ("17_search_sort_alpha_light", "/?tab=tab-search&theme=light&search=daft+punk&filter=album&sort=alpha-asc"),

    # 6. Tri par Nombre de Pistes Décroissant
    ("18_search_sort_tracks_dark", "/?tab=tab-search&theme=dark&search=daft+punk&filter=album&sort=tracks-desc"),
    ("18_search_sort_tracks_light", "/?tab=tab-search&theme=light&search=daft+punk&filter=album&sort=tracks-desc"),
]

def wait_for_server(port, max_wait=20):
    url = f"http://127.0.0.1:{port}/api/config"
    start = time.time()
    while time.time() - start < max_wait:
        try:
            with urllib.request.urlopen(url, timeout=1) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.4)
    return False

def capture_view(name, query_path):
    target_url = f"http://127.0.0.1:{PORT}{query_path}"
    out_file = OUTPUT_DIR / f"{name}.png"

    # Délai d'attente pour que la recherche et les tris s'appliquent
    delay_ms = 4500

    cmd = [
        CHROME_PATH,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        f"--window-size=1280,850",
        f"--user-data-dir={USER_DATA_DIR}",
        f"--virtual-time-budget={delay_ms}",
        f"--screenshot={out_file}",
        target_url
    ]

    res = subprocess.run(cmd, capture_output=True, text=True)
    if out_file.exists() and out_file.stat().st_size > 5000:
        print(f"  [OK] {name} ({out_file.stat().st_size // 1024} Ko)")
        return True
    else:
        print(f"  [FAIL] {name}: {res.stderr[:200]}")
        return False

def main():
    print(f"--- Démarrage de la capture d'audit des tris et sous-filtres ({len(VIEWS)} vues) ---")
    python_exe = sys.executable

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    server_proc = subprocess.Popen(
        [python_exe, "-m", "uvicorn", "backend.app:app", "--port", str(PORT), "--log-level", "warning"],
        cwd=Path(__file__).resolve().parent.parent,
        env=env
    )

    try:
        print(f"Attente du serveur FastAPI sur le port {PORT}...")
        if not wait_for_server(PORT):
            print("ERREUR: Le serveur n'a pas répondu à temps.")
            return

        print("Serveur prêt. Capture des écrans en cours...")
        for name, query in VIEWS:
            capture_view(name, query)

        print("\nToutes les captures de tri et sous-filtres sont terminées dans :", OUTPUT_DIR)
    finally:
        server_proc.terminate()
        try:
            server_proc.wait(timeout=3)
        except Exception:
            server_proc.kill()
        print("Serveur de capture arrêté.")

if __name__ == "__main__":
    main()

import os
import sys
import time
import subprocess
import urllib.request
from pathlib import Path

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
OUTPUT_DIR = Path(r"C:\Users\miche\.gemini\antigravity\brain\058353d3-7e85-44af-978a-b4f362fced4b\audit_screenshots")
USER_DATA_DIR = Path(r"C:\Users\miche\AppData\Local\Temp\chrome_btn_audit")
PORT = 8002

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
USER_DATA_DIR.mkdir(parents=True, exist_ok=True)

VIEWS = [
    ("11_button_more_dark", "/?tab=tab-search&theme=dark&search=daft+punk&filter=album"),
    ("11_button_more_light", "/?tab=tab-search&theme=light&search=daft+punk&filter=album"),
    ("12_hint_all_dark", "/?tab=tab-search&theme=dark&search=daft+punk&filter=all"),
    ("12_hint_all_light", "/?tab=tab-search&theme=light&search=daft+punk&filter=all"),
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

    cmd = [
        CHROME_PATH,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--window-size=1280,5400",
        f"--user-data-dir={USER_DATA_DIR}",
        "--virtual-time-budget=4500",
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
    python_exe = sys.executable
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    server_proc = subprocess.Popen(
        [python_exe, "-m", "uvicorn", "backend.app:app", "--port", str(PORT), "--log-level", "warning"],
        cwd=Path(__file__).resolve().parent.parent,
        env=env
    )

    try:
        if not wait_for_server(PORT):
            print("ERREUR: Le serveur n'a pas répondu à temps.")
            return

        for name, query in VIEWS:
            capture_view(name, query)
    finally:
        server_proc.terminate()
        try:
            server_proc.wait(timeout=3)
        except Exception:
            server_proc.kill()

if __name__ == "__main__":
    main()

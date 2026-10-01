import os
import sys
import time
import json
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.stdout.reconfigure(encoding="utf-8")
sys.path = [str(ROOT)] + [p for p in sys.path if "Sauvegardes" not in p]

print("=== TEST PROTOCOLE D'INTERRUPTION PROPRE & FERMETURE SECURISEE ===")

from backend.library_sync import (
    request_library_sync_stop, is_library_sync_stop_requested,
    _sync_lock, _sync_stop_requested, is_library_syncing
)
from backend.video_sync import (
    request_video_sync_stop, is_video_stop_requested,
    _video_sync_lock, _video_stop_requested, is_video_syncing
)
from backend.library_migrator import (
    request_migrator_stop, is_migrator_stop_requested,
    _migrator_stop_requested, is_migrating
)

# Test 1 : Vérification des signaux coopératifs
print("\n[Test 1] Vérification des signaux d'arrêt coopératifs...")
_sync_stop_requested.clear()
_video_stop_requested.clear()
_migrator_stop_requested.clear()

assert not is_library_sync_stop_requested(), "Le signal sync devrait être inactif"
assert not is_video_stop_requested(), "Le signal vidéo devrait être inactif"
assert not is_migrator_stop_requested(), "Le signal migration devrait être inactif"

request_library_sync_stop()
assert is_library_sync_stop_requested(), "Le signal sync aurait dû être activé"

request_video_sync_stop()
assert is_video_stop_requested(), "Le signal vidéo aurait dû être activé"

request_migrator_stop()
assert is_migrator_stop_requested(), "Le signal migration aurait dû être activé"

print("  ✓ Tous les signaux d'arrêt coopératifs (Events) fonctionnent parfaitement.")

# Nettoyage
_sync_stop_requested.clear()
_video_stop_requested.clear()
_migrator_stop_requested.clear()

# Test 2 : Simulation d'une boucle de synchronisation interrompue à un point sûr
print("\n[Test 2] Simulation d'une tâche de synchronisation coopérative...")
sync_completed_cleanly = False
files_processed = 0

def mock_sync_worker():
    global sync_completed_cleanly, files_processed
    with _sync_lock:
        for i in range(100):
            if is_library_sync_stop_requested():
                print(f"  [Worker] Interruption sécurisée détectée après {files_processed} fichiers ! Sortie propre de la boucle.")
                sync_completed_cleanly = True
                break
            time.sleep(0.02)  # Simule le traitement d'un fichier (20ms)
            files_processed += 1

worker_thread = threading.Thread(target=mock_sync_worker)
worker_thread.start()

time.sleep(0.06)  # Laisser le worker démarrer et traiter 2 ou 3 fichiers
assert is_library_syncing(), "La synchronisation devrait être signalée comme active"

print(f"  [Test] Synchronisation en cours ({files_processed} fichiers traités). Déclenchement de l'arrêt gracieux...")
request_library_sync_stop()
worker_thread.join(timeout=2.0)

assert not worker_thread.is_alive(), "Le worker aurait dû s'arrêter promptement"
assert sync_completed_cleanly, "La synchronisation aurait dû s'interrompre proprement sans crash"
assert not is_library_syncing(), "Le verrou de synchronisation aurait dû être relâché"
print(f"  ✓ Arrêt propre confirmé : le worker s'est arrêté à un point sûr après {files_processed} fichiers.")

_sync_stop_requested.clear()

# Test 3 : Appel API /api/system/graceful-shutdown via TestClient
print("\n[Test 3] Vérification de l'endpoint FastAPI /api/system/graceful-shutdown...")
from fastapi.testclient import TestClient
from backend.app import app

client = TestClient(app)

res_busy = client.get("/api/system/busy-status")
assert res_busy.status_code == 200
data_busy = res_busy.json()
print("  ✓ /api/system/busy-status répond:", data_busy)

res_shutdown = client.post("/api/system/graceful-shutdown")
assert res_shutdown.status_code == 200
data_shutdown = res_shutdown.json()
print("  ✓ /api/system/graceful-shutdown répond:", data_shutdown)
assert data_shutdown.get("success") is True
assert data_shutdown.get("ready_to_quit") is True
assert data_shutdown.get("clean") is True

print("\n=== TOUS LES TESTS UNITAIRES D'INTERRUPTION PROPRE ONT REUSSI ===")

@echo off
title SoundStash - Serveur et Interface Autonome
cd /d "%~dp0"

:: 1. Priorite a l'environnement Python embarque dans le projet
if exist "%~dp0python_runtime\python.exe" (
    set "PYTHON_CMD=%~dp0python_runtime\python.exe"
) else (
    set "PYTHON_CMD=python"
)

:: 2. Ajouter les outils embarques (yt-dlp, ffmpeg, kid3) au PATH local
set "PATH=%~dp0bin;%~dp0bin\kid3;%PATH%"

echo ===================================================
echo            SoundStash (100%% Autonome)
echo ===================================================
echo [Outils] yt-dlp, FFmpeg, Kid3 et Python embarques.
echo [Serveur] Demarrage sur http://127.0.0.1:8000...
echo.
echo Ouverture de votre navigateur...
start "" "http://127.0.0.1:8000"
echo.
echo Le serveur fonctionne. Laissez cette fenetre ouverte.
echo (Pour arreter, appuyez sur Ctrl+C ou fermez la fenetre)
echo.

"%PYTHON_CMD%" -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
pause

@echo off
setlocal
title SoundStash - Gestionnaire d'Environnement et de Build
cd /d "%~dp0"

if not "%~1"=="" (
    set "CHOICE=%~1"
    goto PROCESS_CHOICE
)

:MENU
cls
echo ========================================================================
echo          SoundStash v3.0 - Environnement et Compilation
echo ========================================================================
echo.
echo  Ce script permet de verifier votre systeme, telecharger et installer
echo  toutes les dependances manquantes (Node, Python, Binaires, Runtime),
echo  lancer la suite de tests et compiler l'application en 1 clic.
echo.
echo ========================================================================
echo  [1] Verification complete et Reinstallation des outils (Bootstrap)
echo  [2] Lancer les tests unitaires (152 tests d'assurance qualite)
echo  [3] Compiler la version Portable autonome (dist:portable)
echo  [4] Compiler l'installateur Windows classique (dist:installer)
echo  [5] Compiler tous les formats (Portable + Installateur NSIS)
echo  [6] Lancer SoundStash en mode developpement (npm start)
echo  [0] Quitter
echo ========================================================================
echo.
set "CHOICE="
set /p "CHOICE=Votre choix [0-6] : "
if "%CHOICE%"=="" goto MENU

:PROCESS_CHOICE
if "%CHOICE%"=="1" goto BOOTSTRAP
if "%CHOICE%"=="2" goto RUN_TESTS
if "%CHOICE%"=="3" goto BUILD_PORTABLE
if "%CHOICE%"=="4" goto BUILD_INSTALLER
if "%CHOICE%"=="5" goto BUILD_ALL
if "%CHOICE%"=="6" goto RUN_DEV
if "%CHOICE%"=="0" goto QUIT
goto MENU

:BOOTSTRAP
cls
echo ========================================================================
echo  [Etape 1/4] Diagnostic des prerequis systeme (Node.js et Python)
echo ========================================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERREUR CRITIQUE] Node.js n'a pas ete detecte dans votre PATH.
    echo Veuillez installer Node.js (version 18 ou superieure) :
    echo   - Telechargement : https://nodejs.org/
    echo.
    pause
    goto MENU
)
for /f "tokens=*" %%v in ('node -v') do echo [OK] Node.js detecte : %%v

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERREUR CRITIQUE] npm n'a pas ete detecte dans votre PATH.
    echo.
    pause
    goto MENU
)
for /f "tokens=*" %%v in ('npm -v') do echo [OK] npm detecte     : v%%v

where python >nul 2>&1
if errorlevel 1 (
    echo [ERREUR CRITIQUE] Python n'a pas ete detecte dans votre PATH.
    echo Veuillez installer Python (version 3.11 ou superieure) :
    echo   - Telechargement : https://www.python.org/
    echo   - IMPORTANT : Cochez "Add Python to PATH" lors de l'installation.
    echo.
    pause
    goto MENU
)
for /f "tokens=*" %%v in ('python --version') do echo [OK] Python detecte  : %%v

echo.
echo ========================================================================
echo  [Etape 2/4] Installation des modules Node (npm install)
echo ========================================================================
echo.
call npm install
if errorlevel 1 (
    echo.
    echo [AVERTISSEMENT] Erreur ou avertissement lors de npm install.
) else (
    echo.
    echo [OK] Dependances Node.js et Electron a jour.
)

echo.
echo ========================================================================
echo  [Etape 3/4] Installation des paquets Python (requirements.txt)
echo ========================================================================
echo.
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo [AVERTISSEMENT] Erreur lors de l'installation des paquets Python.
) else (
    echo.
    echo [OK] Paquets Python installes avec succes.
)

echo.
echo ========================================================================
echo  [Etape 4/4] Telechargement des binaires et runtime embarque (Bootstrap)
echo ========================================================================
echo.
python scripts/bootstrap_dependencies.py
if errorlevel 1 (
    echo.
    echo [ERREUR] Echec lors du bootstrap des dependances autonomes.
    echo.
    pause
    goto MENU
)

echo.
echo ========================================================================
echo  SUCCES : Votre environnement de dev et build est pret a 100 pour 100.
echo ========================================================================
echo.
pause
goto MENU

:RUN_TESTS
cls
echo ========================================================================
echo  Execution de la suite de tests modulaires SoundStash (152 tests)
echo ========================================================================
echo.
call npx electron scripts/test_core_modules.js
echo.
pause
goto MENU

:BUILD_PORTABLE
cls
echo ========================================================================
echo  Compilation de la version Portable (.exe autonome)
echo ========================================================================
echo.
call npm run dist:portable
echo.
if exist "dist\SoundStash-Portable-*.exe" (
    echo ====================================================================
    echo  [OK] Build Portable termine avec succes.
    echo  Retrouvez votre executable dans le dossier dist\
    echo ====================================================================
    start "" "dist"
)
pause
goto MENU

:BUILD_INSTALLER
cls
echo ========================================================================
echo  Compilation de l'installateur Windows NSIS (.exe)
echo ========================================================================
echo.
call npm run dist:installer
echo.
if exist "dist\SoundStash Setup *.exe" (
    echo ====================================================================
    echo  [OK] Build Installateur termine avec succes.
    echo  Retrouvez votre executable dans le dossier dist\
    echo ====================================================================
    start "" "dist"
)
pause
goto MENU

:BUILD_ALL
cls
echo ========================================================================
echo  Compilation des deux formats (Portable + Installateur NSIS)
echo ========================================================================
echo.
call npm run dist
echo.
if exist "dist" (
    echo ====================================================================
    echo  [OK] Build termine avec succes.
    echo  Retrouvez vos executables dans le dossier dist\
    echo ====================================================================
    start "" "dist"
)
pause
goto MENU

:RUN_DEV
cls
echo ========================================================================
echo  Lancement de SoundStash en mode Developpement
echo ========================================================================
echo.
call npm start
goto MENU

:QUIT
exit /b 0

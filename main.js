const { app, BrowserWindow, shell, dialog, ipcMain, clipboard, session, screen, Menu, Tray, nativeImage, powerSaveBlocker, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');
const { spawn, exec } = require('child_process');

// Définir l'identité de l'application
app.name = 'SoundStash';
app.setName('SoundStash');

// Définir l'AppUserModelID pour Windows (indispensable pour l'icône personnalisée dans la barre des tâches)
if (process.platform === 'win32') {
    app.setAppUserModelId('com.soundstash.app');
}

// Autoriser la lecture audio en arrière-plan sans geste utilisateur requis (vital pour le Tray / MediaSession)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Activer le Media Router Chromium pour la diffusion vidéo vers les Smart TVs (LG WebOS, Chromecast, DLNA)
app.commandLine.appendSwitch('enable-features', 'CastMediaRouteProvider');
// Accélération matérielle GPU native complète pour éliminer les latences de survol et de composition
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// Handler IPC pour accès direct au presse-papiers
ipcMain.handle('read-clipboard', () => {
    try {
        return clipboard.readText();
    } catch (e) {
        console.error('Erreur clipboard.readText:', e);
        return '';
    }
});

// Handler IPC pour ouverture du dialogue natif de sélection de dossier
ipcMain.handle('select-folder', async (event, initialDir) => {
    try {
        const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
        const options = {
            title: "Sélectionner un dossier",
            properties: ['openDirectory', 'createDirectory']
        };
        if (initialDir && fs.existsSync(initialDir)) {
            options.defaultPath = initialDir;
        }
        const result = win
            ? await dialog.showOpenDialog(win, options)
            : await dialog.showOpenDialog(options);
            
        if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
            return result.filePaths[0];
        }
        return '';
    } catch (e) {
        console.error('Erreur dialog.showOpenDialog:', e);
        return '';
    }
});

// Handler IPC pour sélection de fichiers multimédias multiples
ipcMain.handle('select-files', async (event, initialDir) => {
    try {
        const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
        const options = {
            title: "Sélectionner des fichiers multimédias à importer",
            properties: ['openFile', 'multiSelections'],
            filters: [
                { name: 'Tous les Médias (Audio & Vidéo)', extensions: ['m4a', 'mp3', 'flac', 'ogg', 'wav', 'aac', 'opus', 'alac', 'mp4', 'mkv', 'webm', 'avi', 'mov'] },
                { name: 'Fichiers Audio', extensions: ['m4a', 'mp3', 'flac', 'ogg', 'wav', 'aac', 'opus', 'alac'] },
                { name: 'Clips Vidéo', extensions: ['mp4', 'mkv', 'webm', 'avi', 'mov'] },
                { name: 'Tous les fichiers (*.*)', extensions: ['*'] }
            ]
        };
        if (initialDir && fs.existsSync(initialDir)) {
            options.defaultPath = initialDir;
        }
        const result = win
            ? await dialog.showOpenDialog(win, options)
            : await dialog.showOpenDialog(options);
            
        if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
            return result.filePaths;
        }
        return [];
    } catch (e) {
        console.error('Erreur dialog.showOpenDialog (fichiers):', e);
        return [];
    }
});

// Handler IPC pour suppression sécurisée vers la Corbeille Windows (shell.trashItem)
ipcMain.handle('trash-item', async (event, targetPath) => {
    try {
        if (!targetPath || typeof targetPath !== 'string') {
            return { success: false, error: 'Chemin invalide' };
        }
        if (!fs.existsSync(targetPath)) {
            return { success: false, error: 'Élément introuvable sur le disque' };
        }
        await shell.trashItem(targetPath);
        return { success: true };
    } catch (e) {
        console.error('Erreur shell.trashItem:', e);
        return { success: false, error: e.message || String(e) };
    }
});

// Handler IPC pour ouvrir un fichier vidéo avec le lecteur système par défaut (permettant la diffusion TV LG / DLNA)
ipcMain.handle('open-path', async (event, targetPath) => {
    try {
        if (!targetPath || typeof targetPath !== 'string') {
            return { success: false, error: 'Chemin invalide' };
        }
        if (!fs.existsSync(targetPath)) {
            return { success: false, error: 'Fichier introuvable sur le disque' };
        }
        const errMsg = await shell.openPath(targetPath);
        if (errMsg) {
            return { success: false, error: errMsg };
        }
        return { success: true };
    } catch (e) {
        console.error('Erreur shell.openPath:', e);
        return { success: false, error: e.message || String(e) };
    }
});

// Handler IPC pour afficher et sélectionner le fichier dans l'Explorateur Windows
ipcMain.handle('show-item-in-folder', async (event, targetPath) => {
    try {
        if (!targetPath || typeof targetPath !== 'string') {
            return { success: false, error: 'Chemin invalide' };
        }
        if (!fs.existsSync(targetPath)) {
            return { success: false, error: 'Fichier introuvable sur le disque' };
        }
        shell.showItemInFolder(targetPath);
        return { success: true };
    } catch (e) {
        console.error('Erreur shell.showItemInFolder:', e);
        return { success: false, error: e.message || String(e) };
    }
});

// Handler IPC pour ouvrir un lien externe dans le navigateur Web par défaut
ipcMain.handle('open-external', async (event, url) => {
    try {
        if (!url || typeof url !== 'string') return { success: false, error: 'URL invalide' };
        await shell.openExternal(url);
        return { success: true };
    } catch (e) {
        console.error('Erreur shell.openExternal:', e);
        return { success: false, error: e.message || String(e) };
    }
});

// Verrou d'instance unique (empêche de lancer plusieurs fois l'application)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
}

let mainWindow = null;
let pythonProcess = null;
let serverPort = 8000;
let isQuitting = false;
let isSuspending = false;
let pythonCrashCount = 0;
let lastPythonCrashTime = 0;
let isRestartingPython = false;

// Détermination des chemins d'exécution
const isPackaged = app.isPackaged;
const projectRoot = isPackaged ? process.resourcesPath : __dirname;

// Résolution universelle du chemin de l'icône de l'application (.ico / .png)
function getAppIconPath() {
    const candidates = [
        path.join(__dirname, 'build', 'icon.ico'),
        path.join(projectRoot, 'build', 'icon.ico'),
        path.join(projectRoot, 'frontend', 'icon.ico'),
        path.join(__dirname, 'frontend', 'icon.ico'),
        path.join(process.resourcesPath || '', 'build', 'icon.ico'),
        path.join(process.resourcesPath || '', 'frontend', 'icon.ico'),
        path.join(__dirname, 'build', 'icon.png'),
        path.join(projectRoot, 'frontend', 'icon.png')
    ];
    for (const p of candidates) {
        if (p && fs.existsSync(p)) return p;
    }
    return null;
}

let pythonExe = path.join(projectRoot, 'python_runtime', 'python.exe');
if (!fs.existsSync(pythonExe)) {
    // Fallback sur le python système si le runtime embarqué n'est pas trouvé
    pythonExe = 'python';
}

// Dossier temporaire sécurisé (UserData en packagé pour éviter les restrictions de droits d'écriture)
const tempDir = isPackaged
    ? path.join(app.getPath('userData'), 'temp_downloads')
    : path.join(projectRoot, 'temp_downloads');

if (!fs.existsSync(tempDir)) {
    try {
        fs.mkdirSync(tempDir, { recursive: true });
    } catch (e) {
        console.error('Impossible de créer le dossier temp:', e);
    }
}

// Dossier de logs persistant
const logDir = isPackaged
    ? path.join(app.getPath('userData'), 'logs')
    : path.join(projectRoot, 'logs');

if (!fs.existsSync(logDir)) {
    try {
        fs.mkdirSync(logDir, { recursive: true });
    } catch (e) {
        console.error('Impossible de créer le dossier logs:', e);
    }
}

// Dossier de configuration persistant (UserData en packagé pour garantir la persistance et les droits d'écriture)
const configDir = isPackaged
    ? app.getPath('userData')
    : projectRoot;

if (!fs.existsSync(configDir)) {
    try {
        fs.mkdirSync(configDir, { recursive: true });
    } catch (e) {
        console.error('Impossible de créer le dossier config:', e);
    }
}

// Dossier de cache persistant (pour aperçus et pochettes)
const cacheDir = isPackaged
    ? path.join(app.getPath('userData'), 'cache')
    : path.join(projectRoot, '.cache');

if (!fs.existsSync(cacheDir)) {
    try {
        fs.mkdirSync(cacheDir, { recursive: true });
    } catch (e) {
        console.error('Impossible de créer le dossier cache:', e);
    }
}

// Si en mode packagé, copier le config.json initial s'il n'existe pas encore dans userData
if (isPackaged) {
    const targetConfig = path.join(configDir, 'config.json');
    const seedConfig = path.join(projectRoot, 'config.json');
    if (!fs.existsSync(targetConfig) && fs.existsSync(seedConfig)) {
        try {
            fs.copyFileSync(seedConfig, targetConfig);
            console.log('[Electron] config.json initial copié vers userData:', targetConfig);
        } catch (e) {
            console.error('[Electron] Erreur copie seed config.json:', e);
        }
    }
}

// Lecture et mise à jour de la configuration applicative pour Electron
function getAppConfig() {
    try {
        const configFile = path.join(configDir, 'config.json');
        if (fs.existsSync(configFile)) {
            const raw = fs.readFileSync(configFile, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.warn('[Electron] Erreur lecture config.json:', e.message);
    }
    return {
        minimize_to_tray_on_close: true,
        minimize_to_tray_on_minimize: true,
        has_seen_tray_notice: false,
        start_in_fullscreen: true
    };
}

function updateAppConfigField(key, value) {
    try {
        const configFile = path.join(configDir, 'config.json');
        let data = {};
        if (fs.existsSync(configFile)) {
            data = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        }
        data[key] = value;
        fs.writeFileSync(configFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.warn('[Electron] Erreur mise à jour config.json:', e.message);
    }
}

// Trouver un port libre
function findFreePort(startPort) {
    return new Promise((resolve) => {
        const srv = net.createServer();
        srv.listen(startPort, '127.0.0.1', () => {
            const port = srv.address().port;
            srv.close(() => resolve(port));
        });
        srv.on('error', () => {
            resolve(findFreePort(startPort + 1));
        });
    });
}

// Lancer le serveur Python FastAPI (Uvicorn)
function startPythonServer(port) {
    return new Promise((resolve, reject) => {
        const binDir = path.join(projectRoot, 'bin');
        const kid3Dir = path.join(binDir, 'kid3');

        const env = Object.assign({}, process.env, {
            YTM_PROJECT_ROOT: projectRoot,
            YTM_CONFIG_DIR: configDir,
            YTM_CACHE_DIR: cacheDir,
            YTM_TEMP_DIR: tempDir,
            YTM_LOG_DIR: logDir,
            PATH: `${binDir};${kid3Dir};${process.env.PATH || ''}`,
            PYTHONUNBUFFERED: '1',
            PYTHONOPTIMIZE: '1',
            PYTHONDONTWRITEBYTECODE: '0'
        });

        const args = [
            '-m', 'uvicorn',
            'backend.app:app',
            '--host', '127.0.0.1',
            '--port', String(port),
            '--log-level', 'info'
        ];

        console.log(`[Electron] Lancement Python: ${pythonExe} dans ${projectRoot}`);
        pythonProcess = spawn(pythonExe, args, {
            cwd: projectRoot,
            env: env,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        pythonProcess.stdout.on('data', (data) => {
            console.log(`[Python] ${data.toString().trim()}`);
        });

        pythonProcess.stderr.on('data', (data) => {
            console.error(`[Python Err] ${data.toString().trim()}`);
        });

        pythonProcess.on('error', (err) => {
            console.error('[Electron] Erreur au démarrage du processus Python:', err);
            reject(err);
        });

        pythonProcess.on('exit', async (code, signal) => {
            console.log(`[Electron] Processus Python terminé (code: ${code}, signal: ${signal})`);
            pythonProcess = null;

            // 1. Si fermeture ordonnée de l'application, ignorer
            if (isQuitting) return;

            // 2. Si le PC est en suspension/veille, ne pas afficher d'erreur : reprise gérée au 'resume'
            if (isSuspending) {
                console.log('[Electron] Sortie du processus Python liée à la mise en veille. Reprise différée au réveil.');
                return;
            }

            if (isRestartingPython) return;

            // 3. Tenter une auto-récupération transparente si l'application est active
            const now = Date.now();
            if (now - lastPythonCrashTime < 20000) {
                pythonCrashCount++;
            } else {
                pythonCrashCount = 1;
            }
            lastPythonCrashTime = now;

            if (pythonCrashCount <= 3 && mainWindow && !mainWindow.isDestroyed()) {
                console.warn(`[Electron] Tentative de relance transparente du serveur Python (${pythonCrashCount}/3)...`);
                isRestartingPython = true;
                try {
                    await startPythonServer(serverPort);
                    await waitForServer(serverPort, 15000);
                    console.log('[Electron] Serveur Python récupéré avec succès.');
                    isRestartingPython = false;
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('server-recovered');
                    }
                    return;
                } catch (recovErr) {
                    console.error('[Electron] Échec de la récupération transparente du serveur Python:', recovErr);
                    isRestartingPython = false;
                }
            }

            // 4. En cas d'échecs critiques répétés uniquement
            if (mainWindow && !mainWindow.isDestroyed()) {
                const { dialog } = require('electron');
                dialog.showMessageBoxSync(mainWindow, {
                    type: 'error',
                    title: 'Erreur Serveur',
                    message: 'Le serveur local s\'est interrompu et n\'a pas pu redémarrer automatiquement. L\'application va redémarrer.',
                    buttons: ['OK']
                });
                app.relaunch();
                app.exit(0);
            }
        });

        resolve();
    });
}

// Attendre que le serveur FastAPI réponde au ping
function waitForServer(port, timeoutMs = 25000) {
    const startTime = Date.now();
    return new Promise((resolve, reject) => {
        function check() {
            const req = http.get(`http://127.0.0.1:${port}/api/config`, (res) => {
                if (res.statusCode === 200) {
                    resolve();
                } else {
                    retry();
                }
            });

            req.on('error', () => retry());
            req.setTimeout(1000, () => {
                req.destroy();
                retry();
            });
        }

        function retry() {
            if (Date.now() - startTime > timeoutMs) {
                reject(new Error(`Délai d'attente dépassé pour le serveur sur le port ${port}`));
            } else {
                setTimeout(check, 300);
            }
        }

        check();
    });
}

// Fichier de persistance de l'état de la fenêtre (taille, position, maximisation)
const windowStatePath = path.join(configDir, 'window-state.json');
const DEFAULT_WINDOW_STATE = {
    width: 1120,
    height: 880,
    isMaximized: false
};
const MIN_WINDOW_WIDTH = 1040;
const MIN_WINDOW_HEIGHT = 680;

function loadWindowState() {
    try {
        if (fs.existsSync(windowStatePath)) {
            const raw = fs.readFileSync(windowStatePath, 'utf8');
            const state = JSON.parse(raw);
            if (state && typeof state.width === 'number' && typeof state.height === 'number') {
                let x = state.x;
                let y = state.y;

                // Vérifier si la position est toujours dans les limites d'un écran actuellement connecté
                if (typeof x === 'number' && typeof y === 'number') {
                    const displays = screen.getAllDisplays();
                    const isVisible = displays.some(display => {
                        const b = display.bounds;
                        return (
                            x >= b.x - 20 &&
                            y >= b.y - 20 &&
                            x < b.x + b.width - 50 &&
                            y < b.y + b.height - 50
                        );
                    });
                    if (!isVisible) {
                        x = undefined;
                        y = undefined;
                    }
                }

                return {
                    width: Math.max(MIN_WINDOW_WIDTH, state.width),
                    height: Math.max(MIN_WINDOW_HEIGHT, state.height),
                    x,
                    y,
                    isMaximized: Boolean(state.isMaximized),
                    isFullScreen: Boolean(state.isFullScreen)
                };
            }
        }
    } catch (e) {
        console.warn('[Electron] Erreur lecture window-state.json:', e.message);
    }
    return Object.assign({}, DEFAULT_WINDOW_STATE);
}

function saveWindowState() {
    if (!mainWindow) return;
    try {
        const isFullScreen = mainWindow.isFullScreen();
        const isMaximized = mainWindow.isMaximized();
        let stateToSave = { isFullScreen, isMaximized };

        if (!isFullScreen && !isMaximized && !mainWindow.isMinimized()) {
            const bounds = mainWindow.getBounds();
            stateToSave.width = bounds.width;
            stateToSave.height = bounds.height;
            stateToSave.x = bounds.x;
            stateToSave.y = bounds.y;
        } else {
            // Si la fenêtre est plein écran ou maximisée, préserver la dernière taille normale mémorisée
            const existing = loadWindowState();
            stateToSave.width = existing.width || DEFAULT_WINDOW_STATE.width;
            stateToSave.height = existing.height || DEFAULT_WINDOW_STATE.height;
            stateToSave.x = existing.x;
            stateToSave.y = existing.y;
        }

        fs.writeFileSync(windowStatePath, JSON.stringify(stateToSave, null, 2), 'utf8');
    } catch (e) {
        console.warn('[Electron] Erreur sauvegarde window-state.json:', e.message);
    }
}

// Données d'état multimédia partagées (pour barre des tâches & tray)
let currentMediaState = {
    isPlaying: false,
    title: '',
    artist: '',
    album: ''
};

// Icônes miniatures pour la barre des tâches Windows (Prev, Play, Pause, Next)
const THUMBAR_ICONS = {
    play: nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAZ0lEQVR4nO2VMQ7AMAgDcdT/f5kuZSw1Jok65Gbk002YHX6Nu3t3Y6yWDObIH5YJAkVSEig1ZUHASmQBW9MSBJlkiiCruWwSALCsAC/j7QIkw+0CEONSAchhqQDFcboAwvC2f3CwL26OZzgL+gJedQAAAABJRU5ErkJggg=='),
    pause: nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAOUlEQVR4nO3QMQoAIAxD0aT3v3OdnEQiiLj8t6ZQ+BJ+827o7l6ObZ/uU+mx4kFCoohEEYkiEkHXBurxCCKR/4LVAAAAAElFTkSuQmCC'),
    prev: nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAa0lEQVR4nO2UwQ6AMAxCwfj/v4wnEw+aQLueHMclg712LbD1T+khBHfezo9VD8KHzinjNoHM8sUECvoSEyg0twlUMLYJ1DC3AkhyNOAOqQZFTWYhJJ4DhjTlQaMZ0tpFNGiWLDs2f9oWRnUBYZAsH7LcW0cAAAAASUVORK5CYII='),
    next: nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAZUlEQVR4nO2PQQrAIAwEXen/v5ziIRdBm90oCHWukR2nlMt/MTNj3jr9ra6SjJgKGqOfLRM4qiQsUGsogcNIJAFTIwucL0laAACz+7NrOFWA4DhdAGKYLoAwHiqAOBwqyI5fzuAFuT44B0vrjIgAAAAASUVORK5CYII=')
};

function updateThumbarButtons(isPlaying) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (process.platform !== 'win32') return;

    try {
        mainWindow.setThumbarButtons([
            {
                tooltip: 'Piste précédente',
                icon: THUMBAR_ICONS.prev,
                click() {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('media-action', 'prev');
                    }
                }
            },
            {
                tooltip: isPlaying ? 'Mettre en pause' : 'Lire',
                icon: isPlaying ? THUMBAR_ICONS.pause : THUMBAR_ICONS.play,
                click() {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('media-action', 'play-pause');
                    }
                }
            },
            {
                tooltip: 'Piste suivante',
                icon: THUMBAR_ICONS.next,
                click() {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('media-action', 'next');
                    }
                }
            }
        ]);
    } catch (e) {
        console.warn('[Electron] setThumbarButtons error:', e.message);
    }
}

let tray = null;

function createTray() {
    if (tray) return;
    const iconPath = getAppIconPath();
    if (!iconPath) return;

    try {
        tray = new Tray(iconPath);
        tray.setToolTip('SoundStash by Helmicretro');

        const toggleWindow = () => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
            }
            updateTrayMenu();
        };

        tray.on('click', toggleWindow);
        tray.on('double-click', toggleWindow);

        updateTrayMenu();
    } catch (e) {
        console.warn('[Electron] Erreur création Tray:', e.message);
    }
}

function updateTrayMenu() {
    if (!tray) return;

    const isPlaying = currentMediaState.isPlaying;
    const isVisible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
    const trackLabel = currentMediaState.title
        ? `🎵 ${currentMediaState.title}${currentMediaState.artist ? ' — ' + currentMediaState.artist : ''}`
        : '🎵 Aucun morceau en cours';

    // Mettre à jour l'infobulle (tooltip) près de l'horloge
    if (currentMediaState.title) {
        tray.setToolTip(`SoundStash: ${currentMediaState.title}${currentMediaState.artist ? ' - ' + currentMediaState.artist : ''}`);
    } else {
        tray.setToolTip('SoundStash by Helmicretro');
    }

    const contextMenu = Menu.buildFromTemplate([
        { label: trackLabel, enabled: false },
        { type: 'separator' },
        {
            label: isPlaying ? '⏸ Mettre en pause' : '▶ Lire',
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    currentMediaState.isPlaying = !currentMediaState.isPlaying;
                    updateTrayMenu();
                    mainWindow.webContents.send('media-action', 'play-pause');
                }
            }
        },
        {
            label: '⏮ Piste précédente',
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('media-action', 'prev');
                }
            }
        },
        {
            label: '⏭ Piste suivante',
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('media-action', 'next');
                }
            }
        },
        { type: 'separator' },
        {
            label: isVisible ? '👁 Masquer la fenêtre' : '👁 Afficher SoundStash',
            click: () => {
                if (!mainWindow || mainWindow.isDestroyed()) return;
                if (mainWindow.isVisible()) {
                    mainWindow.hide();
                } else {
                    if (mainWindow.isMinimized()) mainWindow.restore();
                    mainWindow.show();
                    mainWindow.focus();
                }
                updateTrayMenu();
            }
        },
        {
            label: '⚙ Paramètres',
            click: () => {
                if (!mainWindow || mainWindow.isDestroyed()) return;
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
                mainWindow.webContents.send('navigate-to-tab', 'tab-settings');
                updateTrayMenu();
            }
        },
        { type: 'separator' },
        {
            label: '✕ Quitter SoundStash',
            click: () => {
                checkAndQuit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);
}

// Fonction centrale pour fermer proprement l'application
function doQuit() {
    isQuitting = true;
    if (displayWakeLockId !== null && powerSaveBlocker.isStarted(displayWakeLockId)) {
        try {
            powerSaveBlocker.stop(displayWakeLockId);
            console.log('[PowerSaveBlocker] Maintien écran libéré à la fermeture');
        } catch (e) {}
        displayWakeLockId = null;
    }
    killPythonServer();
    if (tray) {
        tray.destroy();
        tray = null;
    }
    app.quit();
}

// Vérifie si le backend exécute des opérations de fichiers avant de fermer
function checkAndQuit() {
    if (!serverPort) {
        doQuit();
        return;
    }
    const http = require('http');
    const req = http.get(`http://127.0.0.1:${serverPort}/api/system/busy-status`, (res) => {
        let rawData = '';
        res.on('data', chunk => rawData += chunk);
        res.on('end', () => {
            try {
                const data = JSON.parse(rawData);
                if (data.busy) {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        if (mainWindow.isMinimized()) mainWindow.restore();
                        mainWindow.show();
                        mainWindow.focus();
                        mainWindow.webContents.send('show-close-confirm-modal');
                        return;
                    }
                }
            } catch (e) {}
            doQuit();
        });
    });
    req.on('error', () => {
        doQuit();
    });
    req.setTimeout(800, () => {
        req.destroy();
        doQuit();
    });
}

// Handlers IPC pour la zone de notification (Systray) & Fermeture / Minimisation
ipcMain.on('minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.minimize();
    }
});

ipcMain.on('minimize-to-tray', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
        updateTrayMenu();
    }
});

ipcMain.on('mark-tray-notice-seen', () => {
    updateAppConfigField('has_seen_tray_notice', true);
});

// Confirmation de fermeture définitive demandée depuis la modale
ipcMain.on('confirm-quit', () => {
    doQuit();
});

// Lancement propre et autonome de la mise à jour
ipcMain.handle('install-update', async (event, installerPath) => {
    console.log('[Updater] Demande d\'installation de mise à jour reçue:', installerPath);
    if (!installerPath || !fs.existsSync(installerPath)) {
        console.error('[Updater] Fichier d\'installation introuvable:', installerPath);
        return { success: false, error: 'Fichier d\'installation introuvable sur le disque' };
    }

    isQuitting = true;

    // 1. Débloquer la fermeture de la fenêtre pour que taskkill / WM_CLOSE ne soit jamais intercepté
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.removeAllListeners('close');
        mainWindow.hide();
    }

    // 2. Libérer le verrou d'écran
    if (displayWakeLockId !== null && powerSaveBlocker.isStarted(displayWakeLockId)) {
        try { powerSaveBlocker.stop(displayWakeLockId); } catch (e) {}
        displayWakeLockId = null;
    }

    // 3. Fermer le backend Python pour libérer TOUS les fichiers du répertoire SoundStash
    killPythonServer();

    // 4. Détruire le Systray
    if (tray) {
        try { tray.destroy(); } catch (e) {}
        tray = null;
    }

    // 5. Lancer l'installeur Windows de manière 100% autonome et détachée
    try {
        const { spawn } = require('child_process');
        const child = spawn(installerPath, [], {
            detached: true,
            stdio: 'ignore'
        });
        child.unref();
        console.log('[Updater] Installeur détaché démarré avec succès');
    } catch (err) {
        console.error('[Updater] Erreur spawn détaché, tentative via shell.openPath:', err);
        shell.openPath(installerPath);
    }

    // 6. Quitter définitivement Electron après un bref délai pour laisser la commande cmd se lancer
    setTimeout(() => {
        app.exit(0);
    }, 400);

    return { success: true };
});

// Bascule et état du plein écran
ipcMain.handle('toggle-fullscreen', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const nextState = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(nextState);
    return nextState;
});

ipcMain.handle('is-fullscreen', () => {
    return mainWindow && !mainWindow.isDestroyed() ? mainWindow.isFullScreen() : false;
});

// Gestion native du maintien de l'écran éveillé (anti-veille d'écran Windows)
let displayWakeLockId = null;

function setDisplayWakeLock(enable) {
    try {
        if (enable) {
            if (displayWakeLockId === null || !powerSaveBlocker.isStarted(displayWakeLockId)) {
                displayWakeLockId = powerSaveBlocker.start('prevent-display-sleep');
                console.log(`[PowerSaveBlocker] Maintien écran éveillé activé (id=${displayWakeLockId})`);
            }
            return { active: true, id: displayWakeLockId };
        } else {
            if (displayWakeLockId !== null && powerSaveBlocker.isStarted(displayWakeLockId)) {
                powerSaveBlocker.stop(displayWakeLockId);
                console.log(`[PowerSaveBlocker] Maintien écran éveillé désactivé (id=${displayWakeLockId})`);
            }
            displayWakeLockId = null;
            return { active: false };
        }
    } catch (e) {
        console.error('[PowerSaveBlocker] Erreur setDisplayWakeLock:', e);
        return { active: false, error: e.message };
    }
}

ipcMain.handle('set-display-wake-lock', (event, enable) => {
    return setDisplayWakeLock(Boolean(enable));
});

// Handler IPC pour mise à jour de l'état multimédia depuis le frontend
ipcMain.on('playback-state-changed', (event, state) => {
    if (!state) return;
    currentMediaState = {
        isPlaying: Boolean(state.isPlaying),
        title: state.title || '',
        artist: state.artist || '',
        album: state.album || ''
    };
    updateThumbarButtons(currentMediaState.isPlaying);
    updateTrayMenu();
});

// Créer la fenêtre principale Electron
function createMainWindow(port) {
    const iconPath = getAppIconPath();
    const appIcon = iconPath ? nativeImage.createFromPath(iconPath) : null;
    const state = loadWindowState();

    const winOptions = {
        width: state.width,
        height: state.height,
        minWidth: MIN_WINDOW_WIDTH,
        minHeight: MIN_WINDOW_HEIGHT,
        title: "SoundStash by Helmicretro",
        backgroundColor: '#0f1115',
        autoHideMenuBar: true,
        icon: (appIcon && !appIcon.isEmpty()) ? appIcon : (iconPath || undefined),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: false
        }
    };

    if (typeof state.x === 'number' && typeof state.y === 'number') {
        winOptions.x = state.x;
        winOptions.y = state.y;
    }

    mainWindow = new BrowserWindow(winOptions);

    if (appIcon && !appIcon.isEmpty()) {
        try {
            mainWindow.setIcon(appIcon);
        } catch (e) {
            console.warn('[Electron] Erreur setIcon:', e);
        }
    }

    const cfg = getAppConfig();
    const shouldStartFullScreen = cfg.start_in_fullscreen !== false;

    if (shouldStartFullScreen || state.isFullScreen) {
        mainWindow.setFullScreen(true);
    } else if (state.isMaximized) {
        mainWindow.maximize();
    }

    // Persistance dynamique avec temporisation (debounce)
    let saveTimeout = null;
    const scheduleSave = () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveWindowState, 400);
    };

    mainWindow.on('resize', scheduleSave);
    mainWindow.on('move', scheduleSave);

    // Événements plein écran pour synchroniser l'icône flottante frontend
    mainWindow.on('enter-full-screen', () => {
        scheduleSave();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('fullscreen-changed', true);
        }
    });

    mainWindow.on('leave-full-screen', () => {
        scheduleSave();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('fullscreen-changed', false);
        }
    });

    // Réduction vers la zone de notification (près de l'horloge)
    mainWindow.on('minimize', (event) => {
        const cfg = getAppConfig();
        if (cfg.minimize_to_tray_on_minimize !== false) {
            event.preventDefault();
            mainWindow.hide();
            updateTrayMenu();
        }
    });

    // PHASE 122 — Notifier le renderer quand la fenêtre est cachée/restaurée (tray)
    mainWindow.on('hide', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('window-hidden');
        }
    });
    mainWindow.on('show', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('window-shown');
        }
    });

    // Fermeture avec la croix rouge (✕) : affichage de la modale de confirmation avec alternative Systray
    mainWindow.on('close', (event) => {
        if (isQuitting) {
            clearTimeout(saveTimeout);
            saveWindowState();
            return;
        }

        event.preventDefault();
        clearTimeout(saveTimeout);
        saveWindowState();

        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('show-close-confirm-modal');
    });

    if (port) {
        mainWindow.loadURL(`http://127.0.0.1:${port}`, {
            extraHeaders: 'pragma: no-cache\ncache-control: no-cache'
        });
    } else {
        const loadingHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;background:#0f1115;color:#cdd6f4;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;user-select:none;flex-direction:column;}.title{font-size:1.6rem;font-weight:700;color:#ff2a4b;margin-bottom:8px;letter-spacing:-0.02em;}.sub{font-size:0.85rem;color:#6c7086;}</style></head><body><div class="title">SoundStash</div><div class="sub">Initialisation du studio musical autonome...</div></body></html>`;
        mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHtml)}`);
    }

    // Boutons souris Précédent / Suivant : browser-backward dédié exclusivement au retour du lecteur vers la collection
    mainWindow.on('app-command', (e, cmd) => {
        if (cmd === 'browser-backward') {
            e.preventDefault();
            mainWindow.webContents.send('app-navigate-back');
        } else if (cmd === 'browser-forward') {
            e.preventDefault();
        }
    });

    // Raccourcis clavier : F5 ou Ctrl+R pour recharger sans cache, et blocage navigation Alt+Flèches
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) {
            mainWindow.webContents.reloadIgnoringCache();
            event.preventDefault();
        }
        if (input.alt && (input.key === 'ArrowLeft' || input.key === 'ArrowRight')) {
            event.preventDefault();
        }
    });

    // Purge de l'historique dès que l'application est chargée (supprime l'écran d'attente de la pile)
    mainWindow.webContents.on('did-finish-load', () => {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.canGoBack()) {
            mainWindow.webContents.clearHistory();
        }
    });

    // Bloquer toute navigation intempestive en arrière vers l'écran temporaire data:
    mainWindow.webContents.on('will-navigate', (event, navUrl) => {
        if (navUrl.startsWith('data:')) {
            event.preventDefault();
        }
    });

    // Ouvrir les liens externes vers le navigateur système
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Fermeture propre du backend Python
function killPythonServer() {
    if (pythonProcess && pythonProcess.pid) {
        console.log('[Electron] Arrêt du serveur Python...');
        try {
            if (process.platform === 'win32') {
                exec(`taskkill /pid ${pythonProcess.pid} /F`, (err) => {
                    if (err) console.warn('[Electron] Info taskkill:', err.message);
                });
            } else {
                pythonProcess.kill('SIGTERM');
            }
        } catch (e) {
            console.error('[Electron] Erreur arrêt Python:', e);
        }
        pythonProcess = null;
    }
}

// Cycle de vie Electron
app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

app.whenReady().then(async () => {
    try {
        // 1. Création immédiate de la fenêtre (Zero-Wait UX : affichage en < 200ms)
        createMainWindow();
        createTray();

        // 2. Définition des permissions et des en-têtes
        session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
            if (permission === 'clipboard-read' || permission === 'clipboard-sanitized-write') {
                return callback(true);
            }
            callback(false);
        });

        // Vider le cache HTTP résiduel à chaque démarrage pour garantir l'affichage immédiat des jaquettes à jour
        session.defaultSession.clearCache().catch(() => {});

        session.defaultSession.webRequest.onBeforeSendHeaders(
            { urls: ['*://*.googleusercontent.com/*', '*://*.ytimg.com/*', '*://*.ggpht.com/*'] },
            (details, callback) => {
                delete details.requestHeaders['Referer'];
                delete details.requestHeaders['referer'];
                callback({ requestHeaders: details.requestHeaders });
            }
        );

        // Forcer la validation immédiate des jaquettes servies par le backend local (aucun cache périmé)
        session.defaultSession.webRequest.onHeadersReceived(
            { urls: ['http://127.0.0.1:*/api/audio/cover*', 'http://127.0.0.1:*/api/cover*'] },
            (details, callback) => {
                const responseHeaders = { ...details.responseHeaders };
                responseHeaders['Cache-Control'] = ['no-cache, must-revalidate'];
                responseHeaders['Pragma'] = ['no-cache'];
                callback({ responseHeaders });
            }
        );

        session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
            if (permission === 'clipboard-read' || permission === 'clipboard-sanitized-write') {
                return true;
            }
            return false;
        });

        // 3. Port & Démarrage Python en arrière-plan
        serverPort = await findFreePort(8000);
        console.log(`[Electron] Port attribué : ${serverPort}`);

        await startPythonServer(serverPort);
        await waitForServer(serverPort);

        // 4. Chargement de l'application dès que le serveur local est prêt
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.loadURL(`http://127.0.0.1:${serverPort}`, {
                extraHeaders: 'pragma: no-cache\ncache-control: no-cache'
            });
            updateThumbarButtons(currentMediaState.isPlaying);
        }
    } catch (err) {
        console.error('[Electron] Erreur critique au démarrage :', err);
        dialog.showErrorBox(
            "Erreur de démarrage",
            `Impossible de démarrer le serveur local SoundStash :\n\n${err.message}`
        );
        app.quit();
    }
});

// Surveillance de la mise en veille et reprise de session Windows
powerMonitor.on('suspend', () => {
    isSuspending = true;
    console.log('[PowerMonitor] Mise en veille système détectée (suspend).');
});

powerMonitor.on('resume', async () => {
    isSuspending = false;
    console.log('[PowerMonitor] Sortie de veille détectée (resume).');
    if (!pythonProcess && !isQuitting && serverPort) {
        console.log('[PowerMonitor] Relance automatique du serveur Python suite au réveil du PC...');
        try {
            await startPythonServer(serverPort);
            await waitForServer(serverPort, 20000);
            console.log('[PowerMonitor] Serveur Python reconnecté avec succès après réveil.');
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('server-recovered');
            }
        } catch (e) {
            console.error('[PowerMonitor] Erreur relance post-veille:', e);
        }
    }
});

app.on('window-all-closed', () => {
    killPythonServer();
    if (tray) {
        tray.destroy();
        tray = null;
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    killPythonServer();
    if (tray) {
        tray.destroy();
        tray = null;
    }
});

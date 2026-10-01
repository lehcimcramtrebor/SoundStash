const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const PORT = 8027;

function waitForServer(port, maxTries = 30) {
    return new Promise((resolve, reject) => {
        let count = 0;
        const check = () => {
            count++;
            const req = http.get(`http://127.0.0.1:${port}/api/config`, (res) => {
                if (res.statusCode === 200) resolve();
                else retry();
            });
            req.on('error', retry);
            req.setTimeout(500, () => { req.destroy(); retry(); });
        };
        const retry = () => {
            if (count >= maxTries) reject(new Error('Serveur non prêt'));
            else setTimeout(check, 300);
        };
        check();
    });
}

app.whenReady().then(async () => {
    console.log('[Test Audio Stream] Démarrage du backend Python...');
    const projectRoot = path.resolve(__dirname, '..');
    const pyProcess = spawn('python', ['-m', 'uvicorn', 'backend.app:app', '--port', String(PORT), '--log-level', 'warning'], {
        cwd: projectRoot,
        env: Object.assign({}, process.env, { PYTHONUNBUFFERED: '1' })
    });

    try {
        await waitForServer(PORT);
        console.log('[Test Audio Stream] Serveur FastAPI connecté.');

        const win = new BrowserWindow({
            width: 800,
            height: 600,
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        await win.loadURL(`http://127.0.0.1:${PORT}/`);

        const evalResult = await win.webContents.executeJavaScript(`
            new Promise((resolve) => {
                const audio = new Audio();
                const testUrl = '/api/stream?id=dQw4w9WgXcQ';
                const logs = [];

                audio.addEventListener('loadstart', () => logs.push('loadstart'));
                audio.addEventListener('loadedmetadata', () => logs.push('loadedmetadata duration=' + audio.duration));
                audio.addEventListener('canplay', () => logs.push('canplay'));
                audio.addEventListener('playing', () => logs.push('playing'));
                audio.addEventListener('error', (e) => {
                    const err = audio.error;
                    logs.push('error code=' + (err ? err.code : 'unknown') + ' msg=' + (err ? err.message : ''));
                    resolve({ success: false, logs });
                });

                audio.src = testUrl;
                audio.play().then(() => {
                    logs.push('play() promise resolved');
                    setTimeout(() => {
                        logs.push('currentTime after 1s=' + audio.currentTime);
                        resolve({ success: true, logs });
                    }, 1500);
                }).catch(err => {
                    logs.push('play() rejected: ' + err.name + ' - ' + err.message);
                    setTimeout(() => {
                        resolve({ success: false, logs });
                    }, 1000);
                });
            });
        `);

        console.log('[Test Audio Stream] Résultat du test audio:', evalResult);
    } catch (err) {
        console.error('[Test Audio Stream] Erreur:', err);
    } finally {
        pyProcess.kill();
        app.quit();
        process.exit(0);
    }
});

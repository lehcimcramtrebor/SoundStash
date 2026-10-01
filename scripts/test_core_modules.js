const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const PORT = 8031;

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
    console.log('[Test Core Modules] Démarrage du backend Python...');
    const projectRoot = path.resolve(__dirname, '..');
    const pyProcess = spawn('python', ['-m', 'uvicorn', 'backend.app:app', '--port', String(PORT), '--log-level', 'warning'], {
        cwd: projectRoot,
        env: Object.assign({}, process.env, { PYTHONUNBUFFERED: '1' })
    });

    pyProcess.stderr.on('data', d => {
        const txt = d.toString();
        if (txt.includes('ERROR')) console.error('[PY ERROR]', txt.trim());
    });

    try {
        await waitForServer(PORT);
        console.log('[Test Core Modules] Serveur FastAPI connecté.');

        const win = new BrowserWindow({
            width: 1280,
            height: 800,
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        const consoleErrors = [];
        win.webContents.on('console-message', (event, level, message, line, sourceId) => {
            console.log(`[RENDERER L${level}] ${message} (${sourceId}:${line})`);
            if (level >= 3) {
                consoleErrors.push({ message, line, sourceId });
            }
        });

        await win.loadURL(`http://127.0.0.1:${PORT}/`);
        // Attendre l'initialisation du DOM et des composants
        const fs = require('fs');
        const clientScript = fs.readFileSync(path.join(__dirname, 'test_client_script.js'), 'utf-8');
        const testResults = await win.webContents.executeJavaScript(clientScript);

        console.log('\n=== RÉSULTATS DES TESTS DU SOCLE CORE JS ===');
        let failedCount = 0;
        testResults.forEach(t => {
            if (t.pass) {
                console.log(`  ✓ [PASS] ${t.name}`);
            } else {
                console.error(`  ✗ [FAIL] ${t.name} (Détails: ${t.details})`);
                failedCount++;
            }
        });

        if (consoleErrors.length > 0) {
            console.log('\n=== ERREURS CONSOLE DÉTECTÉES ===');
            consoleErrors.forEach(e => console.error(`  [CONSOLE ERROR] ${e.message}`));
        } else {
            console.log('\n  ✓ Aucune erreur console JavaScript pendant le chargement.');
        }

        console.log(`\nBILAN : ${testResults.length - failedCount}/${testResults.length} tests réussis.`);

        if (failedCount === 0 && consoleErrors.length === 0) {
            console.log('=== SUCCÈS INTÉGRAL ÉTAPE 2 : 100% VALIDE ===');
            process.exitCode = 0;
        } else {
            console.error('=== ÉCHEC : Certains tests ont échoué ===');
            process.exitCode = 1;
        }

    } catch (err) {
        console.error('[TEST CRASH]', err);
        process.exitCode = 1;
    } finally {
        pyProcess.kill();
        app.quit();
    }
});

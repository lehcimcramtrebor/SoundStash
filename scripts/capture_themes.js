const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: 1920,
        height: 1080,
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    const outputDir = path.join(__dirname, '..', 'frontend', 'assets', 'backdrops');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const synthwaveJs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'ambient', 'synthwave_canvas.js'), 'utf-8');

    const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="margin:0; padding:0; background:#08090e;">
        <canvas id="synthwave-canvas" width="1920" height="1080" style="width:1920px; height:1080px;"></canvas>
        <script>
            window.innerWidth = 1920;
            window.innerHeight = 1080;
            ${synthwaveJs}
        </script>
    </body>
    </html>
    `;

    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    const result = await win.webContents.executeJavaScript(`
        (async () => {
            const canvas = document.getElementById('synthwave-canvas');
            const ctx = canvas.getContext('2d');
            const themes = window.AmbientThemeManager.themes;
            const images = [];

            // Onde sonore douce et harmonieuse fidèle au mode ambiance
            const wave = new Uint8Array(128);
            for (let j = 0; j < 128; j++) {
                wave[j] = Math.round(128 + 22 * Math.sin(j * 0.14) + 10 * Math.cos(j * 0.28) + 6 * Math.sin(j * 0.06));
            }

            const mockAudio = {
                isPlaying: true,
                waveform: wave,
                freqs: new Uint8Array(128).fill(160),
                energy: 0.65,
                rawEnergy: 0.70,
                bass: 0.75,
                rawBass: 0.80,
                mid: 0.60,
                treble: 0.65,
                beat: false,
                beatIntensity: 0.4,
                percussion: 0.4,
                kick: 0.4,
                snare: 0.35,
                isPercussion: false,
                calm: 0.3
            };

            for (let i = 0; i < themes.length; i++) {
                const t = themes[i];
                for (const mode of ['dark', 'light']) {
                    const isLight = (mode === 'light');
                    try {
                        ctx.clearRect(0, 0, 1920, 1080);
                        if (typeof t.init === 'function') t.init(canvas, ctx);
                        // Rendu pur et authentique du canvas du thème (sans halo ni dégradé additionnel)
                        t.render(canvas, ctx, mockAudio, 12.0, 0.016, isLight, false);
                        const dataUrl = canvas.toDataURL('image/png');
                        images.push({ id: t.id, mode, dataUrl });
                    } catch (err) {
                        images.push({ id: t.id, mode, error: String(err) });
                    }
                }
            }
            return images;
        })()
    `);

    for (const item of result) {
        if (item.error) {
            console.error(`Erreur sur ${item.id}_${item.mode}:`, item.error);
            continue;
        }
        const base64Data = item.dataUrl.replace(/^data:image\/png;base64,/, '');
        const filename = `${item.id}_${item.mode}_raw.png`;
        const filePath = path.join(outputDir, filename);
        fs.writeFileSync(filePath, base64Data, 'base64');
        console.log(`Généré brut : ${filename}`);
    }

    // Flou d'optique de lentille naturel (GaussianBlur radius=7.0), sans aucune distorsion de couleur
    try {
        console.log('Application du flou de lentille...');
        const pyScript = `
from PIL import Image, ImageFilter
from pathlib import Path

d = Path('frontend/assets/backdrops')
for p in d.glob('*_raw.png'):
    im = Image.open(p)
    # Flou d'optique de lentille naturel et soyeux (radius=7.0 sur 1080p, équivalent au flou de référence 576p)
    blurred = im.filter(ImageFilter.GaussianBlur(radius=7.0))
    
    base_name = p.stem.replace('_raw', '')
    blurred.save(d / f'{base_name}.webp', 'WEBP', quality=92)
    blurred.convert('RGB').save(d / f'{base_name}.jpg', 'JPEG', quality=92)
    p.unlink()
print("Images de fond optimisées avec succès !")
`;
        fs.writeFileSync(path.join(outputDir, 'process_backdrops.py'), pyScript, 'utf-8');
        execSync(`python "${path.join(outputDir, 'process_backdrops.py')}"`, { stdio: 'inherit' });
        fs.unlinkSync(path.join(outputDir, 'process_backdrops.py'));
        console.log('Traitement terminé avec succès !');
    } catch (e) {
        console.error('Erreur traitement python:', e);
    }

    app.quit();
});

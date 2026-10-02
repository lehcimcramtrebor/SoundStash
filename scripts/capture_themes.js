const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

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
    <body style="margin:0; padding:0; background:#000;">
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

            const mockAudio = {
                isPlaying: true,
                waveform: new Float32Array(128).fill(0),
                freqs: new Uint8Array(128).fill(128),
                energy: 0.55,
                rawEnergy: 0.6,
                bass: 0.65,
                rawBass: 0.7,
                mid: 0.45,
                treble: 0.5,
                beat: false,
                beatIntensity: 0.3,
                percussion: 0.4,
                kick: 0.35,
                snare: 0.25,
                isPercussion: false,
                calm: 0.5
            };

            for (let i = 0; i < themes.length; i++) {
                const t = themes[i];
                for (const mode of ['dark', 'light']) {
                    const isLight = (mode === 'light');
                    try {
                        if (typeof t.init === 'function') t.init(canvas, ctx);
                        // Rendu à t = 10.0 pour avoir des motifs bien formés
                        t.render(canvas, ctx, mockAudio, 10.0, 0.016, isLight, false);
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
        console.log(`Généré : ${filename}`);
    }

    // Floutage gaussien et conversion WebP / JPG
    const { execSync } = require('child_process');
    try {
        console.log('Floutage et compression WebP en cours...');
        execSync(`python -c "from PIL import Image, ImageFilter; from pathlib import Path; d = Path('frontend/assets/backdrops'); [ (im := Image.open(p), blurred := im.filter(ImageFilter.GaussianBlur(radius=36)), blurred.save(d / f'{p.stem.replace(\\"_raw\\", \\"\\")}.webp', 'WEBP', quality=85), blurred.convert('RGB').save(d / f'{p.stem.replace(\\"_raw\\", \\"\\")}.jpg', 'JPEG', quality=85), p.unlink()) for p in d.glob('*_raw.png') ]"`, { stdio: 'inherit' });
        console.log('Optimisation des arrière-plans terminée avec succès !');
    } catch (e) {
        console.error('Erreur floutage python:', e);
    }

    app.quit();
});

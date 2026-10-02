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

            const mockAudio = {
                isPlaying: true,
                waveform: new Float32Array(128).fill(0),
                freqs: new Uint8Array(128).fill(160),
                energy: 0.75,
                rawEnergy: 0.8,
                bass: 0.85,
                rawBass: 0.9,
                mid: 0.65,
                treble: 0.7,
                beat: false,
                beatIntensity: 0.5,
                percussion: 0.5,
                kick: 0.45,
                snare: 0.4,
                isPercussion: false,
                calm: 0.3
            };

            function applyAmbientGlow(ctx, themeId, isLight, w, h) {
                ctx.save();
                if (themeId === 'synthwave') {
                    if (!isLight) {
                        // Ciel haut & coins : aurore violette / magenta profonde
                        const topGrad = ctx.createRadialGradient(w * 0.2, 0, 50, w * 0.2, 0, w * 0.65);
                        topGrad.addColorStop(0, 'rgba(139, 92, 246, 0.45)');
                        topGrad.addColorStop(0.6, 'rgba(88, 28, 135, 0.22)');
                        topGrad.addColorStop(1, 'transparent');
                        ctx.fillStyle = topGrad;
                        ctx.fillRect(0, 0, w, h * 0.65);

                        const topGrad2 = ctx.createRadialGradient(w * 0.8, 0, 50, w * 0.8, 0, w * 0.65);
                        topGrad2.addColorStop(0, 'rgba(236, 72, 153, 0.42)');
                        topGrad2.addColorStop(0.6, 'rgba(157, 23, 77, 0.20)');
                        topGrad2.addColorStop(1, 'transparent');
                        ctx.fillStyle = topGrad2;
                        ctx.fillRect(0, 0, w, h * 0.65);

                        // Flancs gauche & droit (horizon néon étendu)
                        const leftHorizon = ctx.createRadialGradient(0, h * 0.62, 30, 0, h * 0.62, 600);
                        leftHorizon.addColorStop(0, 'rgba(6, 182, 212, 0.52)');
                        leftHorizon.addColorStop(0.5, 'rgba(59, 130, 246, 0.30)');
                        leftHorizon.addColorStop(1, 'transparent');
                        ctx.fillStyle = leftHorizon;
                        ctx.fillRect(0, h * 0.25, 650, h * 0.7);

                        const rightHorizon = ctx.createRadialGradient(w, h * 0.62, 30, w, h * 0.62, 600);
                        rightHorizon.addColorStop(0, 'rgba(244, 63, 94, 0.55)');
                        rightHorizon.addColorStop(0.5, 'rgba(190, 24, 93, 0.30)');
                        rightHorizon.addColorStop(1, 'transparent');
                        ctx.fillStyle = rightHorizon;
                        ctx.fillRect(w - 650, h * 0.25, 650, h * 0.7);

                        // Lueur soleil diffuse étendue à tout l'écran
                        const bigSun = ctx.createRadialGradient(w / 2, h * 0.62, 80, w / 2, h * 0.62, 950);
                        bigSun.addColorStop(0, 'rgba(255, 42, 100, 0.40)');
                        bigSun.addColorStop(0.5, 'rgba(168, 85, 247, 0.25)');
                        bigSun.addColorStop(1, 'transparent');
                        ctx.fillStyle = bigSun;
                        ctx.fillRect(0, 0, w, h);
                    } else {
                        // Mode clair : halo pastel chaud pêche / lilas / azur
                        const sunLight = ctx.createRadialGradient(w / 2, h * 0.62, 100, w / 2, h * 0.62, 900);
                        sunLight.addColorStop(0, 'rgba(251, 146, 60, 0.32)');
                        sunLight.addColorStop(0.5, 'rgba(236, 72, 153, 0.20)');
                        sunLight.addColorStop(1, 'transparent');
                        ctx.fillStyle = sunLight;
                        ctx.fillRect(0, 0, w, h);

                        const leftLight = ctx.createRadialGradient(0, h * 0.5, 50, 0, h * 0.5, 650);
                        leftLight.addColorStop(0, 'rgba(56, 189, 248, 0.28)');
                        leftLight.addColorStop(1, 'transparent');
                        ctx.fillStyle = leftLight;
                        ctx.fillRect(0, 0, 750, h);

                        const rightLight = ctx.createRadialGradient(w, h * 0.5, 50, w, h * 0.5, 650);
                        rightLight.addColorStop(0, 'rgba(244, 114, 182, 0.28)');
                        rightLight.addColorStop(1, 'transparent');
                        ctx.fillStyle = rightLight;
                        ctx.fillRect(w - 750, 0, 750, h);
                    }
                } else if (themeId === 'cyberpunk_city') {
                    if (!isLight) {
                        // Projecteurs ciel & aurore cyan / magenta
                        const beamLeft = ctx.createRadialGradient(w * 0.15, 0, 30, w * 0.15, 0, 750);
                        beamLeft.addColorStop(0, 'rgba(6, 182, 212, 0.50)');
                        beamLeft.addColorStop(0.6, 'rgba(14, 116, 144, 0.25)');
                        beamLeft.addColorStop(1, 'transparent');
                        ctx.fillStyle = beamLeft;
                        ctx.fillRect(0, 0, 850, 750);

                        const beamRight = ctx.createRadialGradient(w * 0.85, 0, 30, w * 0.85, 0, 750);
                        beamRight.addColorStop(0, 'rgba(192, 38, 211, 0.45)');
                        beamRight.addColorStop(0.6, 'rgba(112, 26, 117, 0.22)');
                        beamRight.addColorStop(1, 'transparent');
                        ctx.fillStyle = beamRight;
                        ctx.fillRect(w - 850, 0, 850, 750);

                        // Lueur ville basse & fenêtres néon sur les bords
                        const cityGlow = ctx.createLinearGradient(0, h, 0, h * 0.45);
                        cityGlow.addColorStop(0, 'rgba(14, 165, 233, 0.40)');
                        cityGlow.addColorStop(0.4, 'rgba(217, 70, 239, 0.30)');
                        cityGlow.addColorStop(1, 'transparent');
                        ctx.fillStyle = cityGlow;
                        ctx.fillRect(0, h * 0.45, w, h * 0.55);
                    } else {
                        const cityLight = ctx.createLinearGradient(0, 0, w, h);
                        cityLight.addColorStop(0, 'rgba(56, 189, 248, 0.26)');
                        cityLight.addColorStop(0.5, 'rgba(250, 204, 21, 0.18)');
                        cityLight.addColorStop(1, 'rgba(192, 132, 252, 0.24)');
                        ctx.fillStyle = cityLight;
                        ctx.fillRect(0, 0, w, h);
                    }
                } else if (themeId === 'vector_wireframe') {
                    if (!isLight) {
                        // Grille laser émeraude / cyan qui illumine toute la périphérie
                        const beamL = ctx.createRadialGradient(0, h * 0.4, 40, 0, h * 0.4, 700);
                        beamL.addColorStop(0, 'rgba(16, 185, 129, 0.55)');
                        beamL.addColorStop(0.5, 'rgba(5, 150, 105, 0.28)');
                        beamL.addColorStop(1, 'transparent');
                        ctx.fillStyle = beamL;
                        ctx.fillRect(0, 0, 800, h);

                        const beamR = ctx.createRadialGradient(w, h * 0.4, 40, w, h * 0.4, 700);
                        beamR.addColorStop(0, 'rgba(20, 184, 166, 0.52)');
                        beamR.addColorStop(0.5, 'rgba(13, 148, 136, 0.25)');
                        beamR.addColorStop(1, 'transparent');
                        ctx.fillStyle = beamR;
                        ctx.fillRect(w - 800, 0, 800, h);

                        const topBeam = ctx.createRadialGradient(w / 2, 0, 50, w / 2, 0, 650);
                        topBeam.addColorStop(0, 'rgba(52, 211, 153, 0.40)');
                        topBeam.addColorStop(1, 'transparent');
                        ctx.fillStyle = topBeam;
                        ctx.fillRect(0, 0, w, 550);
                    } else {
                        const vectorLight = ctx.createLinearGradient(0, 0, 0, h);
                        vectorLight.addColorStop(0, 'rgba(52, 211, 153, 0.28)');
                        vectorLight.addColorStop(1, 'rgba(56, 189, 248, 0.25)');
                        ctx.fillStyle = vectorLight;
                        ctx.fillRect(0, 0, w, h);
                    }
                } else if (themeId === 'infinite_tetris') {
                    if (!isLight) {
                        // Colonnes arcade néon sur les bords gauche et droit
                        const colors = ['#f43f5e', '#a855f7', '#06b6d4', '#eab308', '#10b981', '#f97316'];
                        for (let k = 0; k < 6; k++) {
                            const colGrad = ctx.createRadialGradient(70 + k * 50, 100 + k * 140, 20, 70 + k * 50, 100 + k * 140, 250);
                            colGrad.addColorStop(0, colors[k % colors.length] + '66');
                            colGrad.addColorStop(1, 'transparent');
                            ctx.fillStyle = colGrad;
                            ctx.fillRect(0, 0, 500, h);
                        }
                        for (let k = 0; k < 6; k++) {
                            const colGrad = ctx.createRadialGradient(w - (70 + k * 50), 120 + k * 130, 20, w - (70 + k * 50), 120 + k * 130, 250);
                            colGrad.addColorStop(0, colors[(k + 3) % colors.length] + '66');
                            colGrad.addColorStop(1, 'transparent');
                            ctx.fillStyle = colGrad;
                            ctx.fillRect(w - 500, 0, 500, h);
                        }
                        const arcGlow = ctx.createRadialGradient(w / 2, h / 2, 150, w / 2, h / 2, 950);
                        arcGlow.addColorStop(0, 'rgba(168, 85, 247, 0.30)');
                        arcGlow.addColorStop(0.6, 'rgba(6, 182, 212, 0.20)');
                        arcGlow.addColorStop(1, 'transparent');
                        ctx.fillStyle = arcGlow;
                        ctx.fillRect(0, 0, w, h);
                    } else {
                        const arcLight = ctx.createLinearGradient(0, 0, w, h);
                        arcLight.addColorStop(0, 'rgba(244, 114, 182, 0.24)');
                        arcLight.addColorStop(0.35, 'rgba(192, 132, 252, 0.24)');
                        arcLight.addColorStop(0.7, 'rgba(56, 189, 248, 0.24)');
                        arcLight.addColorStop(1, 'rgba(250, 204, 21, 0.24)');
                        ctx.fillStyle = arcLight;
                        ctx.fillRect(0, 0, w, h);
                    }
                }
                ctx.restore();
            }

            for (let i = 0; i < themes.length; i++) {
                const t = themes[i];
                for (const mode of ['dark', 'light']) {
                    const isLight = (mode === 'light');
                    try {
                        if (typeof t.init === 'function') t.init(canvas, ctx);
                        t.render(canvas, ctx, mockAudio, 12.0, 0.016, isLight, false);
                        applyAmbientGlow(ctx, t.id, isLight, 1920, 1080);
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

    // Floutage gaussien soyeux, rehaussement et conversion WebP / JPG
    try {
        console.log('Floutage gaussien et rehaussement colorimétrique en cours...');
        const pyScript = `
from PIL import Image, ImageFilter, ImageEnhance
from pathlib import Path

d = Path('frontend/assets/backdrops')
for p in d.glob('*_raw.png'):
    im = Image.open(p)
    # Flou très léger (radius=8 au lieu de 50) pour préserver le dessin et les motifs nets
    blurred = im.filter(ImageFilter.GaussianBlur(radius=8))
    is_dark = 'dark' in p.stem
    if is_dark:
        enhanced = ImageEnhance.Color(blurred).enhance(1.25)
        enhanced = ImageEnhance.Brightness(enhanced).enhance(1.10)
        enhanced = ImageEnhance.Contrast(enhanced).enhance(1.08)
    else:
        enhanced = ImageEnhance.Color(blurred).enhance(1.15)
        enhanced = ImageEnhance.Brightness(enhanced).enhance(1.02)
        enhanced = ImageEnhance.Contrast(enhanced).enhance(1.04)
    
    base_name = p.stem.replace('_raw', '')
    enhanced.save(d / f'{base_name}.webp', 'WEBP', quality=90)
    enhanced.convert('RGB').save(d / f'{base_name}.jpg', 'JPEG', quality=90)
    p.unlink()
print("Images optimisées avec succès !")
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

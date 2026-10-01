const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: 1280,
        height: 850,
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    const fileUrl = 'file:///' + path.join(__dirname, '..', 'frontend', 'index.html').replace(/\\/g, '/');
    console.log('Loading:', fileUrl);
    await win.loadURL(fileUrl);
    await new Promise(r => setTimeout(r, 600));

    const image = await win.webContents.capturePage();
    const outPath = path.join(__dirname, '..', 'test_electron_shot.png');
    fs.writeFileSync(outPath, image.toPNG());
    console.log('Saved to:', outPath, 'Size:', fs.statSync(outPath).size);
    app.quit();
});

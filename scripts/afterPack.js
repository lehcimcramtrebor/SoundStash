const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');

/**
 * Hook afterPack pour electron-builder :
 * Garantit que l'exécutable Windows PE dans appOutDir est toujours patché avec
 * l'icône vinyle officielle et les métadonnées de version AVANT la compression NSIS / Portable.
 */
exports.default = async function(context) {
    if (context.electronPlatformName !== 'win32') {
        return;
    }

    const appName = context.packager.appInfo.productFilename;
    const version = context.packager.appInfo.version;
    const exePath = path.join(context.appOutDir, `${appName}.exe`);
    const iconPath = path.join(context.packager.projectDir, 'build', 'icon.ico');

    if (!fs.existsSync(exePath)) {
        console.warn(`[afterPack] Exécutable introuvable : ${exePath}`);
        return;
    }

    if (!fs.existsSync(iconPath)) {
        console.warn(`[afterPack] Icône introuvable : ${iconPath}`);
        return;
    }

    // Recherche de rcedit dans le dossier bin local ou dans les caches
    const rceditCandidates = [
        path.join(context.packager.projectDir, 'bin', 'rcedit-x64.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign', '421508547', 'rcedit-x64.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign', '381979159', 'rcedit-x64.exe')
    ];

    const rceditPath = rceditCandidates.find(p => fs.existsSync(p));
    if (!rceditPath) {
        console.warn('[afterPack] rcedit-x64.exe introuvable, injection ignorée.');
        return;
    }

    try {
        console.log(`[afterPack] Patching des métadonnées PE et de l'icône dans ${appName}.exe via rcedit...`);
        const cmd = `"${rceditPath}" "${exePath}" --set-icon "${iconPath}" --set-version-string "FileDescription" "${appName}" --set-version-string "ProductName" "${appName}" --set-version-string "CompanyName" "Helmicretro" --set-version-string "LegalCopyright" "Copyright © 2026 Helmicretro" --set-version-string "OriginalFilename" "${appName}.exe" --set-file-version "${version}" --set-product-version "${version}"`;
        execSync(cmd, { stdio: 'inherit' });
        console.log(`[afterPack] Succès : ${appName}.exe contient désormais l'icône vinyle personnalisée.`);
    } catch (err) {
        console.error(`[afterPack] Erreur lors de l'exécution de rcedit :`, err.message);
    }

    // Synchronisation automatique de la version de l'application pour le backend
    try {
        const backendVerTarget = path.join(context.appOutDir, 'resources', 'backend', 'version.json');
        if (fs.existsSync(path.dirname(backendVerTarget))) {
            fs.writeFileSync(backendVerTarget, JSON.stringify({ version }, null, 2), 'utf-8');
            console.log(`[afterPack] Version ${version} injectée dans resources/backend/version.json`);
        }
    } catch (e) {
        console.warn('[afterPack] Erreur écriture version.json:', e.message);
    }
};

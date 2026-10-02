const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getPathForFile: (file) => {
        try {
            return webUtils.getPathForFile(file);
        } catch (e) {
            return file ? file.path || '' : '';
        }
    },
    readClipboard: () => ipcRenderer.invoke('read-clipboard'),
    selectFolder: (initialDir) => ipcRenderer.invoke('select-folder', initialDir),
    selectFiles: (initialDir) => ipcRenderer.invoke('select-files', initialDir),
    trashItem: (targetPath) => ipcRenderer.invoke('trash-item', targetPath),
    openPath: (targetPath) => ipcRenderer.invoke('open-path', targetPath),
    showItemInFolder: (targetPath) => ipcRenderer.invoke('show-item-in-folder', targetPath),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    updatePlaybackState: (state) => ipcRenderer.send('playback-state-changed', state),
    setDisplayWakeLock: (enable) => ipcRenderer.invoke('set-display-wake-lock', enable),
    minimize: () => ipcRenderer.send('minimize'),
    minimizeToTray: () => ipcRenderer.send('minimize-to-tray'),
    confirmQuit: () => ipcRenderer.send('confirm-quit'),
    installUpdate: (installerPath) => ipcRenderer.invoke('install-update', installerPath),
    toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
    isFullscreen: () => ipcRenderer.invoke('is-fullscreen'),
    markTrayNoticeSeen: () => ipcRenderer.send('mark-tray-notice-seen'),
    onMediaAction: (callback) => {
        ipcRenderer.on('media-action', (event, action) => callback(action));
    },
    onShowTrayNotice: (callback) => {
        ipcRenderer.on('show-tray-notice', () => callback());
    },
    onShowCloseConfirmModal: (callback) => {
        ipcRenderer.on('show-close-confirm-modal', () => callback());
    },
    onFullscreenChanged: (callback) => {
        ipcRenderer.on('fullscreen-changed', (event, isFs) => callback(isFs));
    },
    onNavigateToTab: (callback) => {
        ipcRenderer.on('navigate-to-tab', (event, tabId) => callback(tabId));
    },
    onNavigateBack: (callback) => {
        ipcRenderer.on('app-navigate-back', () => callback());
    },
    // PHASE 122 — Optimisation GPU : notifications hide/show tray
    onWindowHidden: (callback) => {
        ipcRenderer.on('window-hidden', () => callback());
    },
    onWindowShown: (callback) => {
        ipcRenderer.on('window-shown', () => callback());
    },
    onServerRecovered: (callback) => {
        ipcRenderer.on('server-recovered', () => callback());
    }
});

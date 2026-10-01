(() => {
    try {
        const results = [];
        function assert(name, condition, details = "") {
            results.push({ name, pass: Boolean(condition), details });
        }

        // ==========================================
        // 1. Tests ICONS_SVG & Core Socle
        // ==========================================
        assert("ICONS_SVG présent", typeof window.ICONS_SVG === "object" && window.ICONS_SVG !== null);
        assert("ICONS_SVG info/success/warning/danger", 
            window.ICONS_SVG && 
            Boolean(window.ICONS_SVG.info) && 
            Boolean(window.ICONS_SVG.success) && 
            Boolean(window.ICONS_SVG.warning) && 
            Boolean(window.ICONS_SVG.danger)
        );

        // ==========================================
        // 2. Tests Utils
        // ==========================================
        assert("escapeHtml", typeof window.escapeHtml === "function");
        const escaped = window.escapeHtml ? window.escapeHtml("<b>\"Hello\" & 'World'</b>") : "";
        assert("escapeHtml résultat correct", escaped === "&lt;b&gt;&quot;Hello&quot; &amp; &#039;World&#039;&lt;/b&gt;", escaped);

        assert("cleanArtistName", typeof window.cleanArtistName === "function");
        const cleaned = window.cleanArtistName ? window.cleanArtistName("Daft Punk - Topic") : "";
        assert("cleanArtistName résultat correct", cleaned === "Daft Punk", cleaned);

        assert("formatTime", typeof window.formatTime === "function");
        const formatted = window.formatTime ? window.formatTime(135) : "";
        assert("formatTime résultat correct", formatted === "2:15", formatted);

        assert("isPlaylistUrlOrItem", typeof window.isPlaylistUrlOrItem === "function");
        const isPl = window.isPlaylistUrlOrItem ? window.isPlaylistUrlOrItem(null, "https://music.youtube.com/playlist?list=PLtest") : false;
        const isOlak = window.isPlaylistUrlOrItem ? window.isPlaylistUrlOrItem(null, "https://music.youtube.com/playlist?list=OLAK5uy_test") : true;
        assert("isPlaylistUrlOrItem playlist standard", isPl === true);
        assert("isPlaylistUrlOrItem album officiel OLAK", isOlak === false);

        assert("triggerBackNavigation", typeof window.triggerBackNavigation === "function");
        assert("syncPlayerControlsHeight", typeof window.syncPlayerControlsHeight === "function");
        assert("handleCoverError", typeof window.handleCoverError === "function");
        assert("browseFolder", typeof window.browseFolder === "function");
        assert("updateEditorTypeToggleUI", typeof window.updateEditorTypeToggleUI === "function");

        // ==========================================
        // 3. Tests Modals & Toasts
        // ==========================================
        assert("showModalAlert", typeof window.showModalAlert === "function");
        assert("showModalConfirm", typeof window.showModalConfirm === "function");
        assert("showModalPrompt", typeof window.showModalPrompt === "function");
        assert("showModalChoice3", typeof window.showModalChoice3 === "function");
        assert("isCustomModalOpen", typeof window.isCustomModalOpen === "function");
        assert("showToast", typeof window.showToast === "function");
        assert("showSyncToast", typeof window.showSyncToast === "function");

        // Test d'émission Toast
        window.showToast("Test Toast Etape 3", "info", 3000);
        const toastContainer = document.getElementById("toast-container");
        const toastEl = toastContainer ? toastContainer.querySelector(".toast") : null;
        assert("Toast injecté dans le DOM", Boolean(toastEl));

        // ==========================================
        // 4. Tests WebSocket & Sync Watch
        // ==========================================
        assert("setupWebSocket", typeof window.setupWebSocket === "function");
        assert("handleWsEvent", typeof window.handleWsEvent === "function");
        assert("renderQueue", typeof window.renderQueue === "function");
        assert("appendLogLine", typeof window.appendLogLine === "function");
        assert("updateProgress", typeof window.updateProgress === "function");
        assert("triggerLibrarySync", typeof window.triggerLibrarySync === "function");
        assert("setDownloadTabWorking", typeof window.setDownloadTabWorking === "function");
        assert("updateTempTabBadge", typeof window.updateTempTabBadge === "function");
        assert("updateSyncWatchIndicator", typeof window.updateSyncWatchIndicator === "function");
        assert("setupSyncWatchIndicator", typeof window.setupSyncWatchIndicator === "function");

        // ==========================================
        // 5. Tests Ambient (Synthwave & AmbientManager)
        // ==========================================
        assert("AmbientThemeManager présent", typeof window.AmbientThemeManager === "object" && window.AmbientThemeManager !== null);
        assert("SynthwaveVisualizer alias présent", window.SynthwaveVisualizer === window.AmbientThemeManager);
        assert("AmbientThemeManager themes disponibles", Array.isArray(window.AmbientThemeManager?.themes) && window.AmbientThemeManager.themes.length > 0);
        assert("setupSynthwaveVisualizer", typeof window.setupSynthwaveVisualizer === "function");
        assert("ScreenWakeLockManager présent", typeof window.ScreenWakeLockManager === "object" && window.ScreenWakeLockManager !== null);
        assert("AmbientVisualizer présent", typeof window.AmbientVisualizer === "object" && window.AmbientVisualizer !== null);
        assert("setupAmbientMode", typeof window.setupAmbientMode === "function");

        // ==========================================
        // 6. Tests Playlists (UserPlaylists)
        // ==========================================
        assert("UserPlaylists présent", typeof window.UserPlaylists === "object" && window.UserPlaylists !== null);
        assert("UserPlaylists.loadAndRenderPlaylists", typeof window.UserPlaylists?.loadAndRenderPlaylists === "function");
        assert("UserPlaylists.renderGrid", typeof window.UserPlaylists?.renderGrid === "function");
        assert("UserPlaylists.openDetail", typeof window.UserPlaylists?.openDetail === "function");
        assert("UserPlaylists.closeDetail", typeof window.UserPlaylists?.closeDetail === "function");
        assert("openAddToPlaylistModal", typeof window.openAddToPlaylistModal === "function");
        assert("setupUserPlaylists", typeof window.setupUserPlaylists === "function");

        // ==========================================
        // 7. Tests Extras: Settings & Modales Système
        // ==========================================
        assert("openSettingsModal", typeof window.openSettingsModal === "function");
        assert("closeSettingsModal", typeof window.closeSettingsModal === "function");
        assert("switchSettingsSubtab", typeof window.switchSettingsSubtab === "function");
        assert("loadConfiguration", typeof window.loadConfiguration === "function");
        assert("setupSettings", typeof window.setupSettings === "function");
        assert("setupAppReset", typeof window.setupAppReset === "function");
        assert("setupTrayNoticeModal", typeof window.setupTrayNoticeModal === "function");
        assert("setupCloseConfirmModal", typeof window.setupCloseConfirmModal === "function");
        assert("setupFloatingFullscreen", typeof window.setupFloatingFullscreen === "function");

        // ==========================================
        // 8. Tests Extras: SleepTimer
        // ==========================================
        assert("SleepTimer présent", typeof window.SleepTimer === "object" && window.SleepTimer !== null);
        assert("SleepTimer.start", typeof window.SleepTimer?.start === "function");
        assert("SleepTimer.clear", typeof window.SleepTimer?.clear === "function");
        assert("openSleepTimerModal", typeof window.openSleepTimerModal === "function");
        assert("closeSleepTimerModal", typeof window.closeSleepTimerModal === "function");
        assert("setupSleepTimerModal", typeof window.setupSleepTimerModal === "function");

        // ==========================================
        // 9. Tests Extras: PartyLock
        // ==========================================
        assert("PartyLock présent", typeof window.PartyLock === "object" && window.PartyLock !== null);
        assert("PartyLock.requestUnlock", typeof window.PartyLock?.requestUnlock === "function");
        assert("PartyLock.init", typeof window.PartyLock?.init === "function");

        // ==========================================
        // 10. Tests Extras: UserGuide & WelcomeWizard
        // ==========================================
        assert("setupUserGuideModal", typeof window.setupUserGuideModal === "function");
        assert("openWelcomeWizard", typeof window.openWelcomeWizard === "function");
        assert("closeWelcomeWizard", typeof window.closeWelcomeWizard === "function");
        assert("setupWelcomeWizard", typeof window.setupWelcomeWizard === "function");

        // ==========================================
        // 11. Tests Workshop: Workbench (Canopy Drawer & Navigation)
        // ==========================================
        assert("openWorkshopDrawer", typeof window.openWorkshopDrawer === "function");
        assert("closeWorkshopDrawer", typeof window.closeWorkshopDrawer === "function");
        assert("toggleWorkshopDrawer", typeof window.toggleWorkshopDrawer === "function");
        assert("switchWorkflowTab", typeof window.switchWorkflowTab === "function");
        assert("enterPlayerMode", typeof window.enterPlayerMode === "function");
        assert("exitPlayerMode", typeof window.exitPlayerMode === "function");
        assert("setupTabs", typeof window.setupTabs === "function");
        assert("switchTab", typeof window.switchTab === "function");
        assert("isWorkshopDrawerOpen défini", typeof window.isWorkshopDrawerOpen === "boolean");

        // ==========================================
        // 12. Tests Workshop: Search & Preview
        // ==========================================
        assert("setupSearch", typeof window.setupSearch === "function");
        assert("setupAlbumPreview", typeof window.setupAlbumPreview === "function");
        assert("openAlbumPreview", typeof window.openAlbumPreview === "function");

        // ==========================================
        // 13. Tests Workshop: Download & File d'attente
        // ==========================================
        assert("downloadItemFromSearch", typeof window.downloadItemFromSearch === "function");
        assert("setupDownloadForm", typeof window.setupDownloadForm === "function");
        assert("isYouTubeUrl", typeof window.isYouTubeUrl === "function");
        assert("isYouTubeUrl test valid", window.isYouTubeUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ") === true);

        // ==========================================
        // 14. Tests Editor: Reconstitution d'Album
        // ==========================================
        assert("isReconstituteModalOpen", typeof window.isReconstituteModalOpen === "function");
        assert("enqueuePendingMissingAlbum", typeof window.enqueuePendingMissingAlbum === "function");
        assert("processNextPendingMissingAlbum", typeof window.processNextPendingMissingAlbum === "function");
        assert("setupReconstituteModal", typeof window.setupReconstituteModal === "function");
        assert("openReconstituteModal", typeof window.openReconstituteModal === "function");
        assert("submitReconstitution", typeof window.submitReconstitution === "function");

        // ==========================================
        // 15. Tests Editor: Tag Editor (Kid3 & Métadonnées)
        // ==========================================
        assert("loadCollectionAlbumsForEditor", typeof window.loadCollectionAlbumsForEditor === "function");
        assert("setupEditorActions", typeof window.setupEditorActions === "function");
        assert("refreshAlbumNavList", typeof window.refreshAlbumNavList === "function");
        assert("updateAlbumNavUI", typeof window.updateAlbumNavUI === "function");
        assert("captureCurrentEditorDraft", typeof window.captureCurrentEditorDraft === "function");
        assert("saveCurrentEditorDraft", typeof window.saveCurrentEditorDraft === "function");
        assert("clearCurrentEditorDraft", typeof window.clearCurrentEditorDraft === "function");
        assert("updateEditorDirtyUI", typeof window.updateEditorDirtyUI === "function");
        assert("markEditorDirty", typeof window.markEditorDirty === "function");
        assert("clearEditorDirty", typeof window.clearEditorDirty === "function");
        assert("navPrevAlbum", typeof window.navPrevAlbum === "function");
        assert("navNextAlbum", typeof window.navNextAlbum === "function");
        assert("resetEditorState", typeof window.resetEditorState === "function");
        assert("updateEditorInteractiveState", typeof window.updateEditorInteractiveState === "function");
        assert("verifyAndValidateEditorActiveAlbum", typeof window.verifyAndValidateEditorActiveAlbum === "function");
        assert("ensureLibraryTagSuggestions", typeof window.ensureLibraryTagSuggestions === "function");
        assert("populateTagSuggestionsDatalists", typeof window.populateTagSuggestionsDatalists === "function");
        assert("updateEditorAlbumsDatalist", typeof window.updateEditorAlbumsDatalist === "function");
        assert("updateCollectionMatchBadges", typeof window.updateCollectionMatchBadges === "function");
        assert("setupEditorDirtyTracking", typeof window.setupEditorDirtyTracking === "function");
        assert("loadAlbumInEditor", typeof window.loadAlbumInEditor === "function");

        // ==========================================
        // 16. Tests Library: Library Manager & Corbeille
        // ==========================================
        assert("setupLibrary", typeof window.setupLibrary === "function");
        assert("loadLibrary", typeof window.loadLibrary === "function");
        assert("loadExternalTempAlbums", typeof window.loadExternalTempAlbums === "function");
        assert("promptAndConfigureLibrary", typeof window.promptAndConfigureLibrary === "function");
        assert("autoConfigureAndScanLibrary", typeof window.autoConfigureAndScanLibrary === "function");
        assert("updateSmartExportUIState", typeof window.updateSmartExportUIState === "function");
        assert("updateEditorExportUIState", typeof window.updateEditorExportUIState === "function");
        assert("confirmDeleteCollectionItem", typeof window.confirmDeleteCollectionItem === "function");
        assert("setupCollectionTree", typeof window.setupCollectionTree === "function");
        assert("loadAndRenderCollectionTree", typeof window.loadAndRenderCollectionTree === "function");
        assert("renderCollectionTree", typeof window.renderCollectionTree === "function");

        // ==========================================
        // 17. Tests Player: AudioPlayer, Presets & DSP
        // ==========================================
        assert("AudioPlayer présent", typeof window.AudioPlayer === "object" && window.AudioPlayer !== null);
        assert("AudioPlayer.init", typeof window.AudioPlayer?.init === "function");
        assert("AudioPlayer.play", typeof window.AudioPlayer?.play === "function");
        assert("AudioPlayer.togglePlayPause", typeof window.AudioPlayer?.togglePlayPause === "function");
        assert("AudioPlayer.playNext", typeof window.AudioPlayer?.playNext === "function");
        assert("AudioPlayer.playPrev", typeof window.AudioPlayer?.playPrev === "function");
        assert("AudioPlayer.setVolume", typeof window.AudioPlayer?.setVolume === "function");
        assert("AudioPlayer.toggleMute", typeof window.AudioPlayer?.toggleMute === "function");
        assert("AudioPlayer.setupAudioContext", typeof window.AudioPlayer?.setupAudioContext === "function");
        assert("AudioPlayer.openEqualizerModal", typeof window.AudioPlayer?.openEqualizerModal === "function");
        assert("AudioPlayer.closeEqualizerModal", typeof window.AudioPlayer?.closeEqualizerModal === "function");
        assert("AudioPlayer.loadAndRenderVideosCatalog", typeof window.AudioPlayer?.loadAndRenderVideosCatalog === "function");
        assert("AudioPlayer.loadAndRenderAllCatalog", typeof window.AudioPlayer?.loadAndRenderAllCatalog === "function");
        assert("setupAudioPlayer", typeof window.setupAudioPlayer === "function");
        assert("playTrack", typeof window.playTrack === "function");
        assert("playOnlineAlbumFromItem", typeof window.playOnlineAlbumFromItem === "function");
        assert("EQ_PRESETS présent", typeof window.EQ_PRESETS === "object" && window.EQ_PRESETS !== null);
        assert("EQ_PRESETS.flat", typeof window.EQ_PRESETS?.flat === "object");
        assert("AudioFader présent", typeof window.AudioFader === "object" && window.AudioFader !== null);

        // ==========================================
        // 18. Tests Video: Lecteur Vidéo Clip & Moteur Audio
        // ==========================================
        assert("VideoAudioManager présent", typeof window.VideoAudioManager === "object" && window.VideoAudioManager !== null);
        assert("VideoAudioManager.init", typeof window.VideoAudioManager?.init === "function");
        assert("setupVideoModal", typeof window.setupVideoModal === "function");
        assert("closeVideoModal", typeof window.closeVideoModal === "function");
        assert("reopenVideoModal", typeof window.reopenVideoModal === "function");
        assert("syncAudioPlayerWithVideo", typeof window.syncAudioPlayerWithVideo === "function");
        assert("openVideoModal", typeof window.openVideoModal === "function");
        assert("openLocalVideoModal", typeof window.openLocalVideoModal === "function");

        // ==========================================
        // 19. Tests Player: Raccourcis Clavier & Molette
        // ==========================================
        assert("setupPlayerShortcutsAndWheel", typeof window.setupPlayerShortcutsAndWheel === "function");

        return results;
    } catch (e) {
        return [{ name: "EXEC_ERROR", pass: false, details: e.stack || e.message }];
    }
})()



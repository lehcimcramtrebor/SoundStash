// =========================================================
// SoundStash Frontend - Application Orchestrator & Bootstrapper
// v3.0.0 - Modular Architecture
// =========================================================

// État global & Navigation multi-albums (partagés avec les modules)
window.currentAlbumPath = window.currentAlbumPath || null;
window.currentAlbumIsPlaylist = window.currentAlbumIsPlaylist || false;
window.currentAlbumIsConcert = window.currentAlbumIsConcert || false;
window.currentConfig = window.currentConfig || {};
window.tempAlbumsList = window.tempAlbumsList || [];
window.currentAlbumIndex = window.currentAlbumIndex !== undefined ? window.currentAlbumIndex : -1;
window.editorDirtyState = window.editorDirtyState || {};
window.editorDraftsByAlbum = window.editorDraftsByAlbum || {};
window.isCollectionEditorMode = window.isCollectionEditorMode || false;
window.collectionAlbumsList = window.collectionAlbumsList || [];
window.pendingMissingAlbumsQueue = window.pendingMissingAlbumsQueue || [];
window.isProcessingMissingPrompt = window.isProcessingMissingPrompt || false;

var currentAlbumPath = window.currentAlbumPath;
var currentAlbumIsPlaylist = window.currentAlbumIsPlaylist;
var currentAlbumIsConcert = window.currentAlbumIsConcert;
var currentConfig = window.currentConfig;
var tempAlbumsList = window.tempAlbumsList;
var currentAlbumIndex = window.currentAlbumIndex;
var editorDirtyState = window.editorDirtyState;
var editorDraftsByAlbum = window.editorDraftsByAlbum;
var isCollectionEditorMode = window.isCollectionEditorMode;
var collectionAlbumsList = window.collectionAlbumsList;
var pendingMissingAlbumsQueue = window.pendingMissingAlbumsQueue;
var isProcessingMissingPrompt = window.isProcessingMissingPrompt;

// [MODULARISÉ] File d'attente Reconstitution déplacée dans frontend/js/editor/reconstitute.js
// Initialisation au chargement du DOM
document.addEventListener("DOMContentLoaded", () => {
    setupTheme();
    setupTabs();
    setupSearch();
    setupAlbumPreview();
    setupVideoModal();
    setupReconstituteModal();
    setupAudioPlayer();
    setupWebSocket();
    setupDownloadForm();
    setupEditorActions();
    setupLibrary();
    setupSettings();
    setupQuickDestButtons();
    setupTrayNoticeModal();
    setupCloseConfirmModal();
    setupFloatingFullscreen();
    setupSynthwaveVisualizer();
    setupAmbientMode();
    setupCollectionTree();
    setupUserPlaylists();
    setupUserGuideModal();
    setupWelcomeWizard();
    setupSleepTimerModal();
    if (window.PartyLock) window.PartyLock.init();
    setupPlayerShortcutsAndWheel();
    setupSyncWatchIndicator();
    loadConfiguration();
    loadLibrary();
    loadCollectionAlbumsForEditor();
    setTimeout(() => triggerLibrarySync(), 5000);


    // Support d'audit visuel automatisé via paramètres d'URL (immédiat & synchrone)
    const urlParams = new URLSearchParams(window.location.search);
    const auditTheme = urlParams.get("theme");
    const auditTab = urlParams.get("tab");
    const auditModal = urlParams.get("modal");
    const auditSearch = urlParams.get("search");

    if (auditTheme) {
        document.documentElement.setAttribute("data-theme", auditTheme);
        const sunIcon = document.getElementById("theme-icon-sun");
        const moonIcon = document.getElementById("theme-icon-moon");
        if (sunIcon && moonIcon) {
            sunIcon.style.display = auditTheme === "light" ? "none" : "block";
            moonIcon.style.display = auditTheme === "light" ? "block" : "none";
        }
    }
    if (auditTab) {
        switchTab(auditTab === "tab-temp" ? "tab-library" : auditTab);
    }
    if (auditModal === "export") {
        switchTab("tab-editor");
        const ep = document.getElementById("export-panel");
        if (ep) ep.style.display = "block";
    } else if (auditModal === "preview") {
        openAlbumPreview({
            title: "Pulp Fiction (Music From The Motion Picture)",
            artist: "Various Artists",
            year: "1994",
            type: "album",
            url: "https://music.youtube.com/playlist?list=OLAK5uy_kzLEnu9FZAor0_Z4yfYM7b7FBHCiSBc5I",
            thumbnail: "/static/placeholder-cover.svg"
        });
    }
    if (auditSearch) {
        switchTab("tab-search");
        const auditFilter = urlParams.get("filter");
        if (auditFilter) {
            const typeSelect = document.getElementById("search-filter-type-select");
            if (typeSelect) {
                typeSelect.value = auditFilter;
                typeSelect.dispatchEvent(new Event("change"));
            }
        }
        const sInput = document.getElementById("search-query-input");
        if (sInput) {
            sInput.value = auditSearch;
            const form = document.getElementById("search-form");
            if (form) form.dispatchEvent(new Event("submit"));
        }
    }

    if (urlParams.get("player") === "true") {
        if (typeof enterPlayerMode === "function") enterPlayerMode();
        const pView = urlParams.get("playerView");
        if (pView && typeof AudioPlayer !== "undefined") {
            AudioPlayer.setView(pView);
        }
        if (urlParams.get("mockNowPlaying") === "true" && typeof AudioPlayer !== "undefined") {
            AudioPlayer.currentAlbum = {
                title: "Random Access Memories",
                artist: "Daft Punk",
                year: "2013",
                genre: "Electronic",
                cover_url: "/static/placeholder-cover.svg",
                path: "mock_ram"
            };
            AudioPlayer.playlist = [
                { title: "Give Life Back to Music", artist: "Daft Punk", duration: "4:35", format: "FLAC", track_number: 1 },
                { title: "The Game of Love", artist: "Daft Punk", duration: "5:22", format: "FLAC", track_number: 2 },
                { title: "Giorgio by Moroder", artist: "Daft Punk", duration: "9:05", format: "FLAC", track_number: 3 },
                { title: "Within", artist: "Daft Punk", duration: "3:48", format: "FLAC", track_number: 4 },
                { title: "Instant Crush (feat. Julian Casablancas)", artist: "Daft Punk", duration: "5:37", format: "FLAC", track_number: 5 },
                { title: "Lose Yourself to Dance (feat. Pharrell Williams)", artist: "Daft Punk", duration: "5:53", format: "FLAC", track_number: 6 },
                { title: "Touch (feat. Paul Williams)", artist: "Daft Punk", duration: "8:18", format: "FLAC", track_number: 7 },
                { title: "Get Lucky (feat. Pharrell Williams)", artist: "Daft Punk", duration: "6:09", format: "FLAC", track_number: 8 }
            ];
            AudioPlayer.currentIndex = 4;
            AudioPlayer.isPlaying = true;
            AudioPlayer.setView("now-playing");
            AudioPlayer.updateDisplayedAlbumUI();
            AudioPlayer.updateCurrentTrackUI(AudioPlayer.playlist[4]);
            AudioPlayer.renderPlayerTab();
            AudioPlayer.updatePlayStateUI();
        }
    }
    if (urlParams.get("modal") === "equalizer" && typeof AudioPlayer !== "undefined") {
        setTimeout(() => {
            AudioPlayer.openEqualizerModal();
        }, 150);
    }
    if (urlParams.get("modal") === "close-confirm") {
        setTimeout(() => {
            if (window.openCloseConfirmModal) window.openCloseConfirmModal();
        }, 250);
    }
    if (urlParams.get("modal") === "settings" || urlParams.get("tab") === "tab-settings") {
        const subtab = urlParams.get("subtab") || "subtab-music";
        openSettingsModal(subtab);
    }
    if (urlParams.get("ambient") === "true" || urlParams.get("mode") === "ambient") {
        if (window.AmbientVisualizer) window.AmbientVisualizer.enter();
        if (urlParams.get("idle") === "true") {
            document.body.classList.add("ambient-idle");
        }
    }
    if (urlParams.get("editorTree") === "true") {
        switchTab("tab-editor");
    }
    if (urlParams.get("modal") === "playlist-picker") {
        setTimeout(() => {
            if (window.openAddToPlaylistModal) {
                window.openAddToPlaylistModal({
                    type: "audio",
                    title: "Around the World",
                    artist: "Daft Punk",
                    album_title: "Homework",
                    duration: 429,
                    path: "C:\\Music\\Daft Punk\\Homework\\07 - Around the World.mp3"
                });
            }
        }, 150);
    }
    if (urlParams.get("modal") === "trash-confirm") {
        setTimeout(() => {
            if (window.confirmDeleteCollectionItem) {
                window.confirmDeleteCollectionItem("C:\\Music\\Daft Punk\\Homework", "album", "Homework");
            }
        }, 150);
    }

    // Chargement automatique de l'éditeur si des albums existent dans le dossier temporaire
    (async () => {
        ensureLibraryTagSuggestions();
        await refreshAlbumNavList();
        if (tempAlbumsList.length > 0) {
            currentAlbumIndex = 0;
            await loadAlbumInEditor(tempAlbumsList[0].path);
        } else {
            resetEditorState("Dossier temporaire vide", "Aucun album à taguer");
        }
    })();
});

// Gestion du thème Sombre / Clair
function setupTheme() {
    const toggleBtn = document.getElementById("theme-toggle-btn");
    const sunIcon = document.getElementById("theme-icon-sun");
    const moonIcon = document.getElementById("theme-icon-moon");

    function updateIcons(theme) {
        if (sunIcon && moonIcon) {
            if (theme === "light") {
                sunIcon.style.display = "none";
                moonIcon.style.display = "block";
            } else {
                sunIcon.style.display = "block";
                moonIcon.style.display = "none";
            }
        }
        const ambSun = document.getElementById("ambient-theme-icon-sun");
        const ambMoon = document.getElementById("ambient-theme-icon-moon");
        const ambModeBtn = document.getElementById("ambient-theme-mode-btn");
        if (ambSun && ambMoon) {
            if (theme === "light") {
                ambSun.style.display = "none";
                ambMoon.style.display = "block";
                if (ambModeBtn) ambModeBtn.title = "Passer en Mode Sombre (Raccourci: Maj+D ou Clic)";
            } else {
                ambSun.style.display = "block";
                ambMoon.style.display = "none";
                if (ambModeBtn) ambModeBtn.title = "Passer en Mode Clair (Raccourci: Maj+D ou Clic)";
            }
        }
    }

    window.toggleAppTheme = function(showFeedback = true) {
        const current = document.documentElement.getAttribute("data-theme") || "dark";
        const next = current === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        try { localStorage.setItem("ytm_theme", next); } catch (_) {}
        updateIcons(next);
        if (window.AmbientThemeManager && typeof window.AmbientThemeManager.updateThemeMode === "function") {
            window.AmbientThemeManager.updateThemeMode();
        }
        if (showFeedback && typeof showToast === "function") {
            showToast(next === "light" ? "☀️ Mode Clair activé" : "🌙 Mode Sombre activé", "info", 1500);
        }
        return next;
    };

    const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
    updateIcons(currentTheme);

    if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
            window.toggleAppTheme(false);
        });
    }

    if (window.matchMedia) {
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
            if (!localStorage.getItem("ytm_theme")) {
                const autoTheme = e.matches ? "dark" : "light";
                document.documentElement.setAttribute("data-theme", autoTheme);
                updateIcons(autoTheme);
                if (window.AmbientThemeManager && typeof window.AmbientThemeManager.updateThemeMode === "function") {
                    window.AmbientThemeManager.updateThemeMode();
                }
            }
        });
    }
}

// =========================================================
// Accès Universel En cours d'écoute & Bouton Header
// =========================================================
function updateHeaderNowPlayingButton() {
    const btn = document.getElementById("btn-header-now-playing");
    const eq = document.getElementById("header-now-playing-eq");
    const label = document.getElementById("btn-header-now-playing-label");
    const iconAudio = document.getElementById("header-now-playing-icon-audio");
    const iconVideo = document.getElementById("header-now-playing-icon-video");
    if (!btn) return;

    const vPlayer = document.getElementById("video-modal-player");
    const vBackdrop = document.getElementById("video-modal-backdrop");
    const isModalOpen = Boolean(vBackdrop && vBackdrop.classList.contains("active") && vBackdrop.style.display !== "none");
    const isVideoBg = Boolean(window.isVideoPlayingInBackground && vPlayer && !vPlayer.paused);

    const ap = window.AudioPlayer;
    const currentTrack = (ap && ap.playlist && ap.currentIndex >= 0 && ap.currentIndex < ap.playlist.length)
        ? ap.playlist[ap.currentIndex]
        : null;

    const isCurrentTrackVideo = Boolean(
        currentTrack && (
            currentTrack.type === "video" ||
            currentTrack.is_video ||
            (currentTrack.filepath && /\.(mp4|mkv|webm)$/i.test(currentTrack.filepath)) ||
            (currentTrack.path && /\.(mp4|mkv|webm)$/i.test(currentTrack.path))
        )
    );

    // Une vidéo est active si la modale est ouverte, ou en arrière-plan, ou si la piste courante de la playlist est une vidéo
    const isVideo = Boolean(isModalOpen || isVideoBg || isCurrentTrackVideo);

    // Un audio simple est actif si ce n'est pas une vidéo et qu'un album/playlist avec piste courante audio existe
    const isAudio = Boolean(
        !isVideo &&
        ap &&
        ap.currentAlbum &&
        ap.playlist &&
        ap.playlist.length > 0 &&
        currentTrack &&
        !isCurrentTrackVideo
    );

    const nowPlayingSubtab = document.getElementById("player-subtab-now-playing");
    const subtabEq = document.getElementById("player-tab-eq");
    const subtabIcon = document.getElementById("player-subtab-now-playing-icon");
    const subtabLabel = document.getElementById("player-subtab-now-playing-label");

    const hasActivePiste = Boolean(isVideo || isAudio);

    // ── Grisage de l'onglet "En cours d'écoute" quand aucune lecture ──
    if (nowPlayingSubtab) {
        nowPlayingSubtab.classList.toggle("tab-disabled", !hasActivePiste);
        if (!hasActivePiste) {
            nowPlayingSubtab.title = "Aucune lecture en cours";
            // Si l'utilisateur est sur cet onglet alors qu'il n'y a rien, revenir aux Albums
            if (window.AudioPlayer && window.AudioPlayer.currentView === "now-playing") {
                window.AudioPlayer.setView("albums");
            }
        } else {
            nowPlayingSubtab.title = isVideo ? "Afficher la vidéo en cours" : "Afficher la lecture en cours";
        }
    }

    if (isVideo || isAudio) {
        // Masquage contextuel intelligent : affiché dans le header uniquement si le tiroir Atelier est ouvert
        // car dans le Lecteur, le sous-onglet #player-subtab-now-playing prend le relais !
        const shouldShowInHeader = Boolean(isWorkshopDrawerOpen);
        btn.style.display = shouldShowInHeader ? "inline-flex" : "none";
        const isPlaying = Boolean(
            (isVideo && ((vPlayer && !vPlayer.paused) || (ap && ap.isPlaying))) ||
            (isAudio && ap && ap.isPlaying)
        );
        if (eq) eq.style.display = isPlaying ? "inline-flex" : "none";
        if (nowPlayingSubtab) nowPlayingSubtab.classList.toggle("is-playing", isPlaying);
        if (subtabEq) subtabEq.style.display = isPlaying ? "inline-flex" : "none";
        if (subtabIcon) subtabIcon.textContent = isVideo ? "🎬" : "🎧";

        btn.classList.toggle("is-video", isVideo);
        if (isVideo) {
            if (iconAudio) iconAudio.style.display = "none";
            if (iconVideo) iconVideo.style.display = "inline";
            if (label) label.textContent = "Vidéo";
            btn.title = "Afficher la vidéo en cours (Raccourci: N)";
        } else {
            if (iconAudio) iconAudio.style.display = "inline";
            if (iconVideo) iconVideo.style.display = "none";
            if (label) label.textContent = "En cours";
            btn.title = "Afficher la lecture en cours (Raccourci: N)";
        }
    } else {
        btn.style.display = "none";
        if (subtabEq) subtabEq.style.display = "none";
    }
}
window.updateHeaderNowPlayingButton = updateHeaderNowPlayingButton;

window.goToNowPlaying = function() {
    const vPlayer = document.getElementById("video-modal-player");
    const backdrop = document.getElementById("video-modal-backdrop");
    const isModalOpen = Boolean(backdrop && backdrop.classList.contains("active") && backdrop.style.display !== "none");
    const isVideoBg = Boolean(window.isVideoPlayingInBackground && vPlayer && !vPlayer.paused);

    const ap = window.AudioPlayer;
    const currentTrack = (ap && ap.playlist && ap.currentIndex >= 0 && ap.currentIndex < ap.playlist.length)
        ? ap.playlist[ap.currentIndex]
        : null;

    const isCurrentTrackVideo = Boolean(
        currentTrack && (
            currentTrack.type === "video" ||
            currentTrack.is_video ||
            (currentTrack.filepath && /\.(mp4|mkv|webm)$/i.test(currentTrack.filepath)) ||
            (currentTrack.path && /\.(mp4|mkv|webm)$/i.test(currentTrack.path))
        )
    );

    const isVideo = Boolean(isModalOpen || isVideoBg || isCurrentTrackVideo);

    // 1. Si une vidéo est active
    if (isVideo) {
        // Si l'utilisateur est déjà sur la modale vidéo affichée, ne rien faire
        if (isModalOpen) return;

        // Ré-ouvrir la vidéo immédiatement
        if (window.reopenVideoModal) {
            window.reopenVideoModal();
            return;
        }
    }

    // 2. Si l'utilisateur est déjà dans le Lecteur sur "En cours d'écoute", réinitialiser le scroll et ne rien faire d'autre
    const isAlreadyAtNowPlaying = isPlayerModeActive && ap && ap.currentView === "now-playing";
    if (isAlreadyAtNowPlaying) {
        if (ap && typeof ap.resetPlayerScrollRobust === "function") {
            ap.resetPlayerScrollRobust();
        }
        return;
    }

    // 3. Basculer vers le Mode Lecteur et la vue En cours d'écoute
    const wasWorkshop = !isPlayerModeActive;
    if (typeof enterPlayerMode === "function") {
        enterPlayerMode();
    }
    if (ap) {
        if (wasWorkshop) {
            ap.previousModeWasWorkshop = true;
        }
        if (typeof ap.resetPlayerScrollRobust === "function") {
            ap.resetPlayerScrollRobust();
        }
        if (typeof ap.setView === "function") {
            ap.setView("now-playing");
        }
        if (typeof ap.resetPlayerScrollRobust === "function") {
            ap.resetPlayerScrollRobust();
        }
    }
};



// =========================================================
// Architecture Modulaire SoundStash v3.0.0
// Tous les modules métier sont désormais isolés dans :
// - frontend/js/core/       : icons, utils, modals, websocket
// - frontend/js/ambient/    : synthwave_canvas, ambient_manager
// - frontend/js/playlists/  : user_playlists
// - frontend/js/extras/     : settings, sleep_timer, party_lock, user_guide
// - frontend/js/workshop/   : workbench, search, download
// - frontend/js/editor/     : reconstitute, tag_editor
// - frontend/js/library/    : library_manager
// - frontend/js/player/     : audio_player, shortcuts
// - frontend/js/video/      : video_player
// =========================================================

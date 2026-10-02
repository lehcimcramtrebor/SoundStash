// =========================================================
// SoundStash - Module Player / Raccourcis Clavier & Optimisation GPU
// Contrôles rapides au bureau, molette du volume et suspension des animations
// =========================================================

// =========================================================
// Raccourcis Clavier Rapides & Réglage Volume à la Molette
// =========================================================
function setupPlayerShortcutsAndWheel() {
    function isTypingInField(el) {
        if (!el) return false;
        const tag = el.tagName ? el.tagName.toUpperCase() : "";
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
        if (el.isContentEditable) return true;
        return false;
    }

    // 1. Raccourcis Clavier Universels au Bureau
    window.addEventListener("keydown", (e) => {
        // Laisser passer si on tape dans un champ de formulaire ou recherche
        if (isTypingInField(e.target)) return;

        // Ne pas intercepter les raccourcis système Windows / navigateur (sauf Shift)
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        // Touche Backspace (Retour arrière) : Revenir du lecteur vers l'onglet de contenu précédent
        if (e.key === "Backspace") {
            if (typeof triggerBackNavigation === "function" && triggerBackNavigation()) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
        }

        // Maj + W : Ouvrir / Replier le tiroir escamotable de l'Atelier
        if (e.shiftKey && (e.key === "W" || e.key === "w")) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof toggleWorkshopDrawer === "function") {
                toggleWorkshopDrawer();
            }
            return;
        }

        // Touche Espace : Lecture / Pause universelle (Audio ou Vidéo)
        if (e.code === "Space" || e.key === " ") {
            const closeConfirmModal = document.getElementById("close-confirm-modal");
            if (closeConfirmModal && closeConfirmModal.classList.contains("active")) return;

            e.preventDefault();
            const vPlayer = document.getElementById("video-modal-player");
            if (vPlayer && vPlayer.src && (!vPlayer.paused || document.getElementById("video-modal-backdrop")?.classList.contains("active") || window.isVideoPlayingInBackground)) {
                if (vPlayer.paused) {
                    if (window.AudioFader) AudioFader.fadeIn(vPlayer, vPlayer.dataset.normalVolume ? parseFloat(vPlayer.dataset.normalVolume) : 1, 500);
                    vPlayer.play().catch(err => console.warn(err));
                } else {
                    if (window.AudioFader && window.AudioFader.enabled) {
                        AudioFader.fadeOut(vPlayer, 400).then(() => vPlayer.pause());
                    } else {
                        vPlayer.pause();
                    }
                }
                return;
            }

            if (window.AudioPlayer) {
                window.AudioPlayer.togglePlayPause();
            }
            return;
        }

        // Flèche Gauche : Reculer de 5s (ou Piste précédente si Shift)
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            if (e.shiftKey) {
                if (window.AudioPlayer) window.AudioPlayer.playPrev();
            } else {
                if (window.AudioPlayer) window.AudioPlayer.seekRelative(-5);
            }
            return;
        }

        // Flèche Droite : Avancer de 5s (ou Piste suivante si Shift)
        if (e.key === "ArrowRight") {
            e.preventDefault();
            if (e.shiftKey) {
                if (window.AudioPlayer) window.AudioPlayer.playNext();
            } else {
                if (window.AudioPlayer) window.AudioPlayer.seekRelative(5);
            }
            return;
        }

        // Flèche Haut : Volume +5%
        if (e.key === "ArrowUp") {
            e.preventDefault();
            if (window.AudioPlayer) {
                const curVol = window.AudioPlayer.isMuted ? 0 : window.AudioPlayer.volume;
                const newVol = Math.min(1, parseFloat((curVol + 0.05).toFixed(2)));
                if (window.AudioPlayer.isMuted && newVol > 0) window.AudioPlayer.isMuted = false;
                window.AudioPlayer.setVolume(newVol);
            }
            return;
        }

        // Flèche Bas : Volume -5%
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (window.AudioPlayer) {
                const curVol = window.AudioPlayer.isMuted ? 0 : window.AudioPlayer.volume;
                const newVol = Math.max(0, parseFloat((curVol - 0.05).toFixed(2)));
                window.AudioPlayer.setVolume(newVol);
            }
            return;
        }

        // Touche M : Couper / Rétablir le son (Mute)
        if (!e.shiftKey && (e.key === "m" || e.key === "M")) {
            e.preventDefault();
            if (window.AudioPlayer) {
                window.AudioPlayer.toggleMute();
            }
            return;
        }

        // Touche N : Accès instantané à « En cours d'écoute » ou réouverture de la vidéo
        if (!e.shiftKey && (e.key === "n" || e.key === "N")) {
            e.preventDefault();
            if (typeof window.goToNowPlaying === "function") {
                window.goToNowPlaying();
            }
            return;
        }

        // Touche V : Alterner l'affichage de la vidéo (Mode standard et Mode ambiance)
        if (!e.shiftKey && (e.key === "v" || e.key === "V")) {
            e.preventDefault();
            if (typeof window.toggleVideoDisplay === "function") {
                window.toggleVideoDisplay();
            }
            return;
        }

        // Touche T (seule) : Activer / Quitter le Mode Ambiance
        if (!e.shiftKey && (e.key === "t" || e.key === "T")) {
            e.preventDefault();
            if (typeof closeWorkshopDrawer === "function") {
                closeWorkshopDrawer();
            }
            if (window.AmbientVisualizer) {
                if (window.AmbientVisualizer.isActive) {
                    window.AmbientVisualizer.exit();
                } else {
                    window.AmbientVisualizer.enter();
                }
            }
            return;
        }

        // Maj + T : Changer d'univers de thème d'ambiance
        if (e.shiftKey && (e.key === "t" || e.key === "T")) {
            e.preventDefault();
            if (window.AmbientVisualizer && window.AmbientVisualizer.isActive) {
                if (window.AmbientThemeManager) {
                    window.AmbientThemeManager.nextTheme();
                }
                if (typeof window.AmbientVisualizer.handleUserActivity === "function") {
                    window.AmbientVisualizer.handleUserActivity();
                }
            } else if (window.AmbientThemeManager) {
                window.AmbientThemeManager.nextTheme();
                if (typeof showToast === "function") {
                    const curT = window.AmbientThemeManager.getCurrentTheme ? window.AmbientThemeManager.getCurrentTheme() : null;
                    const name = curT ? curT.name : "Suivant";
                    showToast(`Thème d'ambiance sélectionné : ${name}`, "info");
                }
            }
            return;
        }

        // Maj + D : Basculer entre thème Sombre et Clair
        if (e.shiftKey && (e.key === "d" || e.key === "D")) {
            e.preventDefault();
            if (typeof window.toggleAppTheme === "function") {
                window.toggleAppTheme(true);
            }
            if (window.AmbientVisualizer && window.AmbientVisualizer.isActive && typeof window.AmbientVisualizer.handleUserActivity === "function") {
                window.AmbientVisualizer.handleUserActivity();
            }
            return;
        }

        // Touche E : Ouvrir / Fermer l'Égaliseur 10 Bandes DSP
        if (!e.shiftKey && (e.key === "e" || e.key === "E")) {
            e.preventDefault();
            if (window.AudioPlayer && typeof window.AudioPlayer.toggleEqualizerModal === "function") {
                window.AudioPlayer.toggleEqualizerModal();
            }
            return;
        }

        // Touche L : Ouvrir / Fermer le tiroir de la File d'attente (Queue Drawer)
        if (!e.shiftKey && (e.key === "l" || e.key === "L")) {
            e.preventDefault();
            if (typeof closeWorkshopDrawer === "function") {
                closeWorkshopDrawer();
            }
            if (window.AudioPlayer && typeof window.AudioPlayer.toggleQueueDrawer === "function") {
                window.AudioPlayer.toggleQueueDrawer();
            }
            return;
        }

        // Touche P : Activer / Désactiver le Mode Soirée (Party Lock)
        if (!e.shiftKey && (e.key === "p" || e.key === "P")) {
            e.preventDefault();
            if (window.PartyLock && typeof window.PartyLock.toggle === "function") {
                window.PartyLock.toggle();
            }
            return;
        }

        // Touche F12 : Réduire l'application (Minimiser dans la barre des tâches)
        if (e.key === "F12" || e.code === "F12") {
            e.preventDefault();
            e.stopPropagation();
            if (window.electronAPI && typeof window.electronAPI.minimize === "function") {
                window.electronAPI.minimize();
            } else if (window.electronAPI && typeof window.electronAPI.minimizeToTray === "function") {
                window.electronAPI.minimizeToTray();
            }
            return;
        }
    });

    // 2. Réglage du Volume à la Molette de la Souris (Scroll Wheel)
    const handleWheelVolume = (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.05 : -0.05;
        if (!window.AudioPlayer) return;
        const curVol = window.AudioPlayer.isMuted ? 0 : window.AudioPlayer.volume;
        const newVol = Math.max(0, Math.min(1, parseFloat((curVol + delta).toFixed(2))));
        if (window.AudioPlayer.isMuted && delta > 0) {
            window.AudioPlayer.isMuted = false;
        }
        window.AudioPlayer.setVolume(newVol);
    };

    const mainVolRow = document.querySelector(".player-volume-row");
    if (mainVolRow) mainVolRow.addEventListener("wheel", handleWheelVolume, { passive: false });

    const miniVolSlider = document.getElementById("mini-player-volume-slider");
    if (miniVolSlider && miniVolSlider.parentElement) {
        miniVolSlider.parentElement.addEventListener("wheel", handleWheelVolume, { passive: false });
    }

    const ambientVolSlider = document.getElementById("ambient-volume-slider");
    if (ambientVolSlider && ambientVolSlider.parentElement) {
        ambientVolSlider.parentElement.addEventListener("wheel", handleWheelVolume, { passive: false });
    }
}


// =========================================================
// PHASE 122 — Optimisation GPU : Suspension globale animations
// Page Visibility API + IPC Electron (hide/show tray)
// =========================================================
(function setupAppVisibilityOptimizer() {
    /**
     * Active/désactive le mode économie GPU :
     * - body.app-hidden  → toutes les animations CSS en pause
     * - AmbientThemeManager → RAF canvas stoppé (déjà géré en interne,
     *   mais on force la synchronisation ici pour le cas tray)
     */
    function setAppHidden(hidden) {
        if (hidden) {
            document.body.classList.add("app-hidden");
            // Sécurité : si AmbientThemeManager n'a pas déjà stoppé son RAF
            if (window.AmbientThemeManager && window.AmbientThemeManager.animationId) {
                cancelAnimationFrame(window.AmbientThemeManager.animationId);
                window.AmbientThemeManager.animationId = null;
            }
        } else {
            document.body.classList.remove("app-hidden");
            // Reprendre le RAF du canvas si nécessaire
            if (window.AmbientThemeManager && !window.AmbientThemeManager.animationId) {
                window.AmbientThemeManager.lastTime = performance.now();
                window.AmbientThemeManager.animate();
            }
        }
    }

    // 1. Page Visibility API (minimisation classique + envoi tray Chromium)
    document.addEventListener("visibilitychange", () => {
        setAppHidden(document.hidden);
    });

    // 2. IPC Electron : signal depuis main.js quand fenêtre cachée dans le tray
    //    (cas où visibilitychange ne se déclenche pas à temps)
    if (window.electronAPI && typeof window.electronAPI.onWindowHidden === "function") {
        window.electronAPI.onWindowHidden(() => setAppHidden(true));
    }
    if (window.electronAPI && typeof window.electronAPI.onWindowShown === "function") {
        window.electronAPI.onWindowShown(() => setAppHidden(false));
    }
    if (window.electronAPI && typeof window.electronAPI.onServerRecovered === "function") {
        window.electronAPI.onServerRecovered(() => {
            console.log("[Electron] Signal server-recovered reçu : reconnexion immédiate du WebSocket...");
            if (typeof setupWebSocket === "function") {
                setupWebSocket();
            }
        });
    }
})();


// Exports globaux
window.setupPlayerShortcutsAndWheel = setupPlayerShortcutsAndWheel;

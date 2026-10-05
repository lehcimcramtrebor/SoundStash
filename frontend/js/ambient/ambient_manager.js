/**
 * SoundStash Ambient - Gestionnaire du Mode Ambiance & WakeLock
 * Contrôleur AmbientVisualizer, maintien éveillé de l'écran et auto-masquage cinématique.
 */

// =========================================================
// GESTION DU MAINTIEN DE L'ÉCRAN ÉVEILLÉ (ANTI-VEILLE D'ÉCRAN)
// Règle stricte : Maintien écran éveillé actif UNIQUEMENT si :
// (1) Mode Ambiance actif ET (2) Lecture en cours (audio ou vidéo)
// =========================================================

const ScreenWakeLockManager = {
    isLocked: false,
    sentinel: null,
    isRequesting: false,

    isPlaybackActive() {
        const isAudio = Boolean(
            window.AudioPlayer &&
            window.AudioPlayer.isPlaying &&
            window.AudioPlayer.audio &&
            !window.AudioPlayer.audio.paused
        );
        const videoPlayer = document.getElementById("video-modal-player");
        const isVideo = Boolean(
            currentModalVideoItem &&
            videoPlayer &&
            !videoPlayer.paused &&
            videoPlayer.src
        );
        return isAudio || isVideo;
    },

    isAmbientActive() {
        return Boolean(
            window.AmbientVisualizer &&
            window.AmbientVisualizer.isActive &&
            document.body.classList.contains("ambient-mode-active")
        );
    },

    isFullscreen() {
        return Boolean(
            document.fullscreenElement ||
            window.isAppFullscreen
        );
    },

    shouldPreventSleep() {
        const ambient = this.isAmbientActive();
        const fullscreen = this.isFullscreen();
        const playback = this.isPlaybackActive();

        // Règle 1 : Mode Ambiance actif ET Plein Écran (les 2 conditions réunies)
        // Règle 2 : Mode Ambiance actif ET Lecture en cours (audio ou vidéo)
        return ambient && (fullscreen || playback);
    },

    async update() {
        const target = this.shouldPreventSleep();
        if (target === this.isLocked && this.sentinel && !this.sentinel.released) {
            return;
        }

        this.isLocked = target;

        // 1. Déverrouillage / Verrouillage natif OS Electron (powerSaveBlocker prevent-display-sleep)
        if (window.electronAPI && typeof window.electronAPI.setDisplayWakeLock === "function") {
            try {
                await window.electronAPI.setDisplayWakeLock(target);
            } catch (ipcErr) {
                console.warn("[ScreenWakeLock] Electron IPC error:", ipcErr);
            }
        }

        // 2. Standard Chromium Screen Wake Lock API (navigator.wakeLock)
        if ('wakeLock' in navigator) {
            try {
                if (target) {
                    if (!this.sentinel || this.sentinel.released) {
                        if (this.isRequesting) return;
                        this.isRequesting = true;
                        try {
                            this.sentinel = await navigator.wakeLock.request('screen');
                            this.sentinel.addEventListener('release', () => {
                                console.log("[ScreenWakeLock] Sentinel relâché par l'OS ou le navigateur");
                                this.sentinel = null;
                                if (this.shouldPreventSleep() && document.visibilityState === 'visible') {
                                    this.update();
                                }
                            });
                            console.log(`[ScreenWakeLock] Anti-veille d'écran ACTIVÉE (Ambiance: ${this.isAmbientActive()}, Plein écran: ${this.isFullscreen()}, Lecture: ${this.isPlaybackActive()})`);
                        } finally {
                            this.isRequesting = false;
                        }
                    }
                } else {
                    if (this.sentinel && !this.sentinel.released) {
                        const s = this.sentinel;
                        this.sentinel = null;
                        await s.release();
                        console.log("[ScreenWakeLock] Anti-veille d'écran DÉSACTIVÉE (conditions non réunies)");
                    }
                }
            } catch (err) {
                this.isRequesting = false;
                console.warn("[ScreenWakeLock] Erreur navigator.wakeLock:", err);
            }
        }
    },

    init() {
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
                this.update();
            }
        });
        window.addEventListener("focus", () => {
            this.update();
        });
        document.addEventListener("fullscreenchange", () => {
            window.isAppFullscreen = Boolean(document.fullscreenElement);
            this.update();
        });
        if (window.electronAPI && window.electronAPI.onFullscreenChanged) {
            window.electronAPI.onFullscreenChanged((isFs) => {
                window.isAppFullscreen = Boolean(isFs);
                this.update();
            });
        }
        if (window.electronAPI && window.electronAPI.isFullscreen) {
            window.electronAPI.isFullscreen().then(isFs => {
                window.isAppFullscreen = Boolean(isFs);
                this.update();
            }).catch(() => {});
        }
    }
};

window.ScreenWakeLockManager = ScreenWakeLockManager;
window.updateScreenWakeLock = () => ScreenWakeLockManager.update();

// =========================================================
// CONTRÔLEUR MODE AMBIANCE / VISUALISEUR PLEIN ÉCRAN
// =========================================================

const AmbientVisualizer = {
    isActive: false,
    idleTimer: null,
    idleDelay: 3500,
    isDockPinned: true,

    updateDockPinnedUI() {
        const lockBtn = document.getElementById("ambient-lock-btn");
        const iconLocked = document.getElementById("ambient-icon-locked");
        const iconUnlocked = document.getElementById("ambient-icon-unlocked");
        if (lockBtn) {
            lockBtn.classList.toggle("locked", this.isDockPinned);
            lockBtn.title = this.isDockPinned
                ? "Centre de commande verrouillé (maintenu affiché) - Cliquer pour masquer automatiquement"
                : "Centre de commande en masquage automatique - Cliquer pour maintenir affiché";
        }
        if (iconLocked) iconLocked.style.display = this.isDockPinned ? "block" : "none";
        if (iconUnlocked) iconUnlocked.style.display = this.isDockPinned ? "none" : "block";

        if (this.isActive) {
            document.body.classList.toggle("ambient-dock-pinned", this.isDockPinned);
        }
    },

    init() {
        // Restaurer la préférence de maintien affiché du centre de commande (par défaut verrouillé = true)
        try {
            const savedPinned = localStorage.getItem("ytm_ambient_dock_pinned");
            this.isDockPinned = (savedPinned === null) ? true : (savedPinned === "true");
        } catch (e) {
            this.isDockPinned = true;
        }
        this.updateDockPinnedUI();

        // Boutons déclencheurs (Universels depuis n'importe quel écran)
        const btnHeader = document.getElementById("btn-ambient-mode");
        const btnMini = document.getElementById("mini-player-ambient-btn");
        const btnFocus = document.getElementById("player-now-playing-ambient-btn");
        const btnExit = document.getElementById("ambient-exit-btn");

        if (btnHeader) btnHeader.addEventListener("click", () => this.enter());
        if (btnMini) btnMini.addEventListener("click", () => this.enter());
        if (btnFocus) btnFocus.addEventListener("click", () => this.enter());
        if (btnExit) btnExit.addEventListener("click", () => this.exit());

        // Bouton Cadenas Maintien du centre de commande
        const lockBtn = document.getElementById("ambient-lock-btn");
        if (lockBtn) {
            lockBtn.addEventListener("click", () => {
                this.isDockPinned = !this.isDockPinned;
                try {
                    localStorage.setItem("ytm_ambient_dock_pinned", String(this.isDockPinned));
                } catch (e) {}
                this.updateDockPinnedUI();
                if (this.isDockPinned) {
                    showToast("Centre de commande maintenu affiché (verrouillé)", "info");
                } else {
                    showToast("Masquage automatique du centre de commande activé", "info");
                }
                this.handleUserActivity();
            });
        }

        // Commandes Transport Ambiance
        const playBtn = document.getElementById("ambient-play-btn");
        const prevBtn = document.getElementById("ambient-prev-btn");
        const nextBtn = document.getElementById("ambient-next-btn");
        const shuffleBtn = document.getElementById("ambient-shuffle-btn");
        const repeatBtn = document.getElementById("ambient-repeat-btn");
        const seekBar = document.getElementById("ambient-seek-bar");
        const volSlider = document.getElementById("ambient-volume-slider");
        const volBtn = document.getElementById("ambient-volume-btn");
        const eqBtn = document.getElementById("ambient-eq-btn");
        const videoToggleBtn = document.getElementById("ambient-video-toggle-btn");

        if (playBtn) playBtn.addEventListener("click", () => {
            const videoPlayer = document.getElementById("video-modal-player");
            if (currentModalVideoItem && videoPlayer && videoPlayer.src) {
                const targetVol = (videoPlayer.dataset.normalVolume ? parseFloat(videoPlayer.dataset.normalVolume) : (videoPlayer.volume || 1));
                if (videoPlayer.paused) {
                    AudioFader.fadeIn(videoPlayer, targetVol, 500);
                    videoPlayer.play().catch(e => console.warn(e));
                } else {
                    if (AudioFader.enabled) {
                        AudioFader.fadeOut(videoPlayer, 400).then(() => {
                            videoPlayer.pause();
                            videoPlayer.volume = targetVol;
                        });
                    } else {
                        videoPlayer.pause();
                    }
                }
            } else if (window.AudioPlayer) {
                window.AudioPlayer.togglePlayPause();
            }
        });
        if (prevBtn) prevBtn.addEventListener("click", () => {
            if (window.AudioPlayer) window.AudioPlayer.playPrev();
        });
        if (nextBtn) nextBtn.addEventListener("click", () => {
            if (window.AudioPlayer) window.AudioPlayer.playNext();
        });
        if (shuffleBtn) shuffleBtn.addEventListener("click", () => {
            if (window.AudioPlayer) window.AudioPlayer.toggleShuffle();
        });
        if (repeatBtn) repeatBtn.addEventListener("click", () => {
            if (window.AudioPlayer) window.AudioPlayer.cycleRepeat();
        });

        if (volBtn) volBtn.addEventListener("click", () => {
            const videoPlayer = document.getElementById("video-modal-player");
            if (currentModalVideoItem && videoPlayer) {
                videoPlayer.muted = !videoPlayer.muted;
                const vOn = document.getElementById("ambient-icon-vol-on");
                const vOff = document.getElementById("ambient-icon-vol-off");
                if (vOn) vOn.style.display = videoPlayer.muted ? "none" : "block";
                if (vOff) vOff.style.display = videoPlayer.muted ? "block" : "none";
            } else if (window.AudioPlayer) {
                window.AudioPlayer.toggleMute();
            }
        });
        if (volSlider) {
            volSlider.addEventListener("input", (e) => {
                const val = parseFloat(e.target.value);
                const videoPlayer = document.getElementById("video-modal-player");
                if (currentModalVideoItem && videoPlayer) {
                    videoPlayer.volume = val;
                }
                if (window.AudioPlayer) window.AudioPlayer.setVolume(val);
            });
        }

        const themePill = document.getElementById("ambient-theme-pill");
        const themeDockBtn = document.getElementById("ambient-theme-dock-btn");

        const audioOutBtn = document.getElementById("ambient-audio-output-btn");
        if (audioOutBtn) {
            audioOutBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (window.AudioPlayer) {
                    window.AudioPlayer.toggleAudioOutputFlyout(audioOutBtn);
                }
            });
        }

        if (eqBtn) {
            eqBtn.addEventListener("click", () => {
                if (window.AudioPlayer) window.AudioPlayer.openEqualizerModal();
            });
        }

        if (videoToggleBtn) {
            videoToggleBtn.addEventListener("click", () => {
                if (typeof window.toggleVideoDisplay === "function") {
                    window.toggleVideoDisplay();
                }
                this.handleUserActivity();
            });
        }

        const overlayEl = document.getElementById("ambient-mode-overlay");
        if (overlayEl) {
            overlayEl.addEventListener("click", (e) => {
                // Clic dans le vide : réveiller les contrôles cinématiques sans JAMAIS quitter le mode ambiance
                if (e.target === overlayEl) {
                    this.handleUserActivity();
                }
            });
        }

        if (themePill) themePill.addEventListener("click", () => {
            if (window.AmbientThemeManager) window.AmbientThemeManager.nextTheme();
            this.handleUserActivity();
        });
        if (themeDockBtn) themeDockBtn.addEventListener("click", () => {
            if (window.AmbientThemeManager) window.AmbientThemeManager.nextTheme();
            this.handleUserActivity();
        });

        const themeModeBtn = document.getElementById("ambient-theme-mode-btn");
        if (themeModeBtn) themeModeBtn.addEventListener("click", (e) => {
            if (e) e.stopPropagation();
            if (typeof window.toggleAppTheme === "function") {
                window.toggleAppTheme(true);
            }
            this.handleUserActivity();
        });


        if (seekBar) {
            seekBar.addEventListener("mousedown", () => {
                if (window.AudioPlayer) window.AudioPlayer.isSeeking = true;
            });
            seekBar.addEventListener("touchstart", () => {
                if (window.AudioPlayer) window.AudioPlayer.isSeeking = true;
            });
            seekBar.addEventListener("input", () => {
                const videoPlayer = document.getElementById("video-modal-player");
                if (currentModalVideoItem && videoPlayer && videoPlayer.duration) {
                    const cur = (seekBar.value / 100) * videoPlayer.duration;
                    const tc = document.getElementById("ambient-time-current");
                    if (tc && window.AudioPlayer) tc.textContent = window.AudioPlayer.formatTime(cur);
                } else if (window.AudioPlayer && window.AudioPlayer.audio && window.AudioPlayer.audio.duration) {
                    const cur = (seekBar.value / 100) * window.AudioPlayer.audio.duration;
                    const tc = document.getElementById("ambient-time-current");
                    if (tc) tc.textContent = window.AudioPlayer.formatTime(cur);
                }
            });
            seekBar.addEventListener("change", () => {
                const videoPlayer = document.getElementById("video-modal-player");
                if (currentModalVideoItem && videoPlayer && videoPlayer.duration) {
                    videoPlayer.currentTime = (seekBar.value / 100) * videoPlayer.duration;
                } else if (window.AudioPlayer) {
                    window.AudioPlayer.isSeeking = false;
                    if (window.AudioPlayer.audio && window.AudioPlayer.audio.duration) {
                        window.AudioPlayer.audio.currentTime = (seekBar.value / 100) * window.AudioPlayer.audio.duration;
                    }
                }
            });
        }

        // Détection de l'activité utilisateur pour l'auto-masquage cinématique (3.5 secondes)
        const activityHandler = () => this.handleUserActivity();
        window.addEventListener("mousemove", activityHandler, { passive: true });
        window.addEventListener("mousedown", activityHandler, { passive: true });
        window.addEventListener("keydown", activityHandler, { passive: true });
        window.addEventListener("touchstart", activityHandler, { passive: true });
    },

    enter() {
        const player = window.AudioPlayer;
        const videoPlayer = document.getElementById("video-modal-player");
        const isVideoActive = Boolean(currentModalVideoItem && videoPlayer && (!videoPlayer.paused || videoPlayer.src));

        // Accessible si lecture audio réelle en cours OU clip vidéo actif
        if (!isVideoActive && (!player || !player.isPlaying || !player.currentAlbum)) {
            showToast("Le mode ambiance nécessite une lecture musicale active ou une vidéo.", "info");
            return;
        }

        this.isActive = true;
        document.body.classList.add("ambient-mode-active");
        if (this.isDockPinned) {
            document.body.classList.add("ambient-dock-pinned");
        } else {
            document.body.classList.remove("ambient-dock-pinned");
        }
        this.updateDockPinnedUI();

        // Désactiver le plein écran fenêtre si actif pour garantir le positionnement parfait de la vignette
        const theaterDialog = document.getElementById("video-theater-dialog");
        if (theaterDialog) {
            theaterDialog.classList.remove("video-inwindow-fullscreen");
            const fsExpandIcon = document.getElementById("video-fs-expand");
            const fsCompressIcon = document.getElementById("video-fs-compress");
            const fsText = document.getElementById("video-fs-text");
            if (fsExpandIcon) fsExpandIcon.style.display = "inline";
            if (fsCompressIcon) fsCompressIcon.style.display = "none";
            if (fsText) fsText.textContent = "Plein écran";
        }

        const overlay = document.getElementById("ambient-mode-overlay");
        if (overlay) overlay.style.display = "flex";

        if (window.AmbientThemeManager) {
            window.AmbientThemeManager.updateThemeUI();
            window.AmbientThemeManager.start();
        }

        this.syncState();
        this.handleUserActivity();
        if (typeof window.updateVideoToggleButtons === "function") {
            window.updateVideoToggleButtons();
        }
        if (typeof window.updateScreenWakeLock === "function") {
            window.updateScreenWakeLock();
        }
    },

    exit() {
        this.isActive = false;
        document.body.classList.remove("ambient-mode-active", "ambient-idle", "ambient-dock-pinned", "ambient-video-hidden");
        if (window.AmbientThemeManager) {
            window.AmbientThemeManager.stop();
        }
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        const overlay = document.getElementById("ambient-mode-overlay");
        if (overlay) overlay.style.display = "none";

        // Si une vidéo était ouverte, rétablir la classe de théâtre vidéo
        if (currentModalVideoItem && document.getElementById("video-modal-backdrop")?.classList.contains("active")) {
            document.body.classList.add("video-playback-active");
        }
        if (typeof window.updateVideoToggleButtons === "function") {
            window.updateVideoToggleButtons();
        }
        if (typeof window.updateScreenWakeLock === "function") {
            window.updateScreenWakeLock();
        }
    },

    handleUserActivity() {
        if (!this.isActive) return;
        document.body.classList.remove("ambient-idle");
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => {
            if (this.isActive) {
                // Ne pas masquer si l'égaliseur audio est ouvert par-dessus
                if (window.AudioPlayer && window.AudioPlayer.isEqualizerModalOpen) return;
                document.body.classList.add("ambient-idle");
            }
        }, this.idleDelay);
    },

    syncState() {
        if (!this.isActive) return;
        const videoPlayer = document.getElementById("video-modal-player");

        if (currentModalVideoItem && videoPlayer) {
            const titleEl = document.getElementById("ambient-track-title");
            const subEl = document.getElementById("ambient-track-sub");
            const coverEl = document.getElementById("ambient-cover-thumb");
            if (titleEl) titleEl.textContent = currentModalVideoItem.title || "Clip Vidéo";
            if (subEl) subEl.textContent = `${currentModalVideoItem.artist || "Artiste"} • Clip Vidéo`;
            if (coverEl) coverEl.src = currentModalVideoItem.thumbnail || "/static/placeholder-cover.svg";

            const playIcon = document.getElementById("ambient-icon-play");
            const pauseIcon = document.getElementById("ambient-icon-pause");
            if (playIcon) playIcon.style.display = videoPlayer.paused ? "block" : "none";
            if (pauseIcon) pauseIcon.style.display = videoPlayer.paused ? "none" : "block";

            const curTimeEl = document.getElementById("ambient-time-current");
            const totalTimeEl = document.getElementById("ambient-time-total");
            const seekBar = document.getElementById("ambient-seek-bar");
            const cur = videoPlayer.currentTime || 0;
            const dur = videoPlayer.duration || 0;
            if (curTimeEl && window.AudioPlayer) curTimeEl.textContent = window.AudioPlayer.formatTime(cur);
            if (totalTimeEl && window.AudioPlayer) totalTimeEl.textContent = window.AudioPlayer.formatTime(dur);
            if (seekBar && dur > 0 && !seekBar.matches(":active")) {
                seekBar.value = (cur / dur) * 100;
            }
            if (typeof window.updateVideoToggleButtons === "function") {
                window.updateVideoToggleButtons();
            }
            return;
        }

        if (!window.AudioPlayer) return;
        const player = window.AudioPlayer;

        // Synchroniser piste actuelle
        const cur = (player.activePlaylist && player.activePlaylist[player.currentIndex]) ||
                    (player.playlist && player.playlist[player.currentIndex]);
        if (cur) {
            player.updateCurrentTrackUI(cur);
        }
        player.updatePlayStateUI();
        player.updateProgressUI();
        player.updateDurationUI();
        player.updateVolumeUI();
        player.updateEqualizerUI();

        const ambShuffleBtn = document.getElementById("ambient-shuffle-btn");
        if (ambShuffleBtn) ambShuffleBtn.classList.toggle("active", Boolean(player.isShuffle));

        if (typeof player.updateRepeatUI === "function") {
            player.updateRepeatUI();
        } else {
            const ambRepeatBtn = document.getElementById("ambient-repeat-btn");
            if (ambRepeatBtn) ambRepeatBtn.classList.toggle("active", player.repeatMode !== "none");
        }

        if (typeof window.updateVideoToggleButtons === "function") {
            window.updateVideoToggleButtons();
        }
    }
};

window.AmbientVisualizer = AmbientVisualizer;

function setupAmbientMode() {
    try {
        if (window.ScreenWakeLockManager) {
            window.ScreenWakeLockManager.init();
        }
        AmbientVisualizer.init();
    } catch (err) {
        console.warn("AmbientVisualizer init warning:", err);
    }
}


window.setupAmbientMode = setupAmbientMode;

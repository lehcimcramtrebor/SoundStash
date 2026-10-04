// =========================================================
// SoundStash - Module Video / Lecteur Vidéo Clip & Moteur Audio Vidéo
// Modale 16:9 in-app, VideoAudioManager & synchronisation de lecture
// =========================================================

// =========================================================
// Modale Lecteur Vidéo Clip In-App & Moteur Audio Vidéo
// =========================================================
const VideoAudioManager = {
    audioCtx: null,
    sourceNode: null,
    analyser: null,
    analyserDataArray: null,
    analyserFreqArray: null,
    initialized: false,

    init(videoElement) {
        if (!videoElement || this.initialized) return;
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return;
            this.audioCtx = new AudioContextClass();
            this.sourceNode = this.audioCtx.createMediaElementSource(videoElement);
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.8;
            this.sourceNode.connect(this.analyser);
            this.analyser.connect(this.audioCtx.destination);
            this.analyserDataArray = new Uint8Array(this.analyser.frequencyBinCount);
            this.analyserFreqArray = new Uint8Array(this.analyser.frequencyBinCount);
            this.initialized = true;
        } catch (e) {
            console.warn("Video Web Audio setup warning:", e);
        }
    },

    resume() {
        if (this.audioCtx && this.audioCtx.state === "suspended") {
            this.audioCtx.resume().catch(() => {});
        }
    },

    isPlaying(videoElement) {
        return Boolean(videoElement && !videoElement.paused && !videoElement.ended && videoElement.readyState >= 2);
    },

    getWaveform(videoElement) {
        if (!this.analyser || !this.isPlaying(videoElement)) return null;
        this.resume();
        if (!this.analyserDataArray || this.analyserDataArray.length !== this.analyser.frequencyBinCount) {
            this.analyserDataArray = new Uint8Array(this.analyser.frequencyBinCount);
        }
        this.analyser.getByteTimeDomainData(this.analyserDataArray);
        return this.analyserDataArray;
    },

    getFrequencies(videoElement) {
        if (!this.analyser || !this.isPlaying(videoElement)) return null;
        this.resume();
        if (!this.analyserFreqArray || this.analyserFreqArray.length !== this.analyser.frequencyBinCount) {
            this.analyserFreqArray = new Uint8Array(this.analyser.frequencyBinCount);
        }
        this.analyser.getByteFrequencyData(this.analyserFreqArray);
        return this.analyserFreqArray;
    }
};
window.VideoAudioManager = VideoAudioManager;

let currentModalVideoItem = null;
window.isVideoPlayingInBackground = false;

function setupVideoModal() {
    const backdrop = document.getElementById("video-modal-backdrop");
    const theaterDialog = document.getElementById("video-theater-dialog");
    const closeBtn = document.getElementById("video-modal-close-btn");
    const cancelBtn = document.getElementById("video-modal-cancel-btn");
    const videoPlayer = document.getElementById("video-modal-player");
    const spinner = document.getElementById("video-modal-spinner");
    const dlAudioBtn = document.getElementById("video-modal-dl-audio-btn");
    const dlVideoBtn = document.getElementById("video-modal-dl-video-btn");
    const extractAudioBtn = document.getElementById("video-modal-extract-audio-btn");
    const extLink = document.getElementById("video-modal-external-link");
    const fsBtn = document.getElementById("video-theater-fullscreen-btn");
    const fsExpandIcon = document.getElementById("video-fs-expand");
    const fsCompressIcon = document.getElementById("video-fs-compress");
    const fsText = document.getElementById("video-fs-text");
    const ambientBtn = document.getElementById("video-ambient-mode-btn");

    if (!backdrop) return;

    if (videoPlayer) {
        videoPlayer.disablePictureInPicture = true;
        videoPlayer.addEventListener("contextmenu", (e) => e.preventDefault());
    }

    // Gestion du positionnement en Mode Ambiance (4 positions stylisées et persistantes)
    let currentAmbientPos = localStorage.getItem("ytm_ambient_video_pos") || "bottom-center";
    if (!["bottom-center", "bottom-left", "bottom-right", "center"].includes(currentAmbientPos)) {
        currentAmbientPos = "bottom-center";
    }

    function setAmbientPosition(newPos, save = true) {
        if (!theaterDialog) return;
        theaterDialog.classList.remove(
            "ambient-pos-bottom-center",
            "ambient-pos-bottom-left",
            "ambient-pos-bottom-right",
            "ambient-pos-center"
        );
        currentAmbientPos = newPos;
        theaterDialog.classList.add(`ambient-pos-${newPos}`);
        if (save) {
            try {
                localStorage.setItem("ytm_ambient_video_pos", newPos);
            } catch (e) {}
        }
    }
    window.setVideoAmbientPosition = setAmbientPosition;
    setAmbientPosition(currentAmbientPos, false);

    const btnArrowLeft = document.getElementById("btn-ambient-move-left");
    const btnArrowRight = document.getElementById("btn-ambient-move-right");
    const btnArrowUp = document.getElementById("btn-ambient-move-up");
    const btnArrowDown = document.getElementById("btn-ambient-move-down");

    if (btnArrowLeft) {
        btnArrowLeft.addEventListener("click", (e) => {
            e.stopPropagation();
            if (currentAmbientPos === "bottom-center") {
                setAmbientPosition("bottom-left", true);
            } else if (currentAmbientPos === "bottom-right") {
                setAmbientPosition("bottom-center", true);
            }
        });
    }

    if (btnArrowRight) {
        btnArrowRight.addEventListener("click", (e) => {
            e.stopPropagation();
            if (currentAmbientPos === "bottom-center") {
                setAmbientPosition("bottom-right", true);
            } else if (currentAmbientPos === "bottom-left") {
                setAmbientPosition("bottom-center", true);
            }
        });
    }

    if (btnArrowUp) {
        btnArrowUp.addEventListener("click", (e) => {
            e.stopPropagation();
            if (currentAmbientPos === "bottom-center") {
                setAmbientPosition("center", true);
            }
        });
    }

    if (btnArrowDown) {
        btnArrowDown.addEventListener("click", (e) => {
            e.stopPropagation();
            if (currentAmbientPos === "center") {
                setAmbientPosition("bottom-center", true);
            }
        });
    }

    function closeVideoModal(stopCompletely = false) {
        const wasPlaying = videoPlayer && !videoPlayer.paused && videoPlayer.currentTime > 0;

        backdrop.classList.remove("active");
        document.body.classList.remove("video-playback-active");
        if (theaterDialog) theaterDialog.classList.remove("video-inwindow-fullscreen");
        if (fsExpandIcon) fsExpandIcon.style.display = "inline";
        if (fsCompressIcon) fsCompressIcon.style.display = "none";
        if (fsText) fsText.textContent = "Plein écran";

        if (stopCompletely || !wasPlaying) {
            window.isVideoPlayingInBackground = false;
            currentModalVideoItem = null;
            window.currentModalVideoItem = null;
            if (videoPlayer) {
                AudioFader.stop(videoPlayer);
                videoPlayer.pause();
                videoPlayer.removeAttribute("src");
                videoPlayer.load();
            }
            backdrop.style.display = "none";
            if (spinner) spinner.style.display = "none";
            if (window.AudioPlayer && !window.AudioPlayer.isUserPlaylistActive) {
                window.AudioPlayer.isPlaying = false;
                window.AudioPlayer.updatePlayStateUI();
            }
            const bar = document.getElementById("persistent-player-bar");
            if (bar && (!window.AudioPlayer || !window.AudioPlayer.isPlaying)) {
                bar.style.display = "none";
            }

            // Mettre à jour le bouton Mode Ambiance dans le header si plus d'audio en cours
            const ambHeaderBtn = document.getElementById("btn-ambient-mode");
            if (ambHeaderBtn && (!window.AudioPlayer || !window.AudioPlayer.isPlaying || !window.AudioPlayer.currentAlbum)) {
                ambHeaderBtn.style.display = "none";
            }

            if (typeof updateHeaderNowPlayingButton === "function") {
                updateHeaderNowPlayingButton();
            }

            if (typeof updateVideoToggleButtons === "function") {
                updateVideoToggleButtons();
            }

            setTimeout(() => {
                backdrop.style.display = "none";
                if (window.AmbientVisualizer && window.AmbientVisualizer.isActive) {
                    window.AmbientVisualizer.syncState();
                }
                if (dlAudioBtn) dlAudioBtn.style.display = "inline-flex";
                if (dlVideoBtn) dlVideoBtn.style.display = "inline-flex";
                if (extractAudioBtn) extractAudioBtn.style.display = "none";
                if (extLink) extLink.style.display = "inline-flex";
            }, 200);
        } else {
            // Continuité audio en arrière-plan demandée par l'utilisateur !
            window.isVideoPlayingInBackground = true;
            window.currentModalVideoItem = currentModalVideoItem;
            backdrop.style.display = "none";

            // Afficher et mettre à jour la barre de contrôle flottante
            const bar = document.getElementById("persistent-player-bar");
            const miniTitle = document.getElementById("mini-player-title");
            const miniArtist = document.getElementById("mini-player-artist");
            const miniThumb = document.getElementById("mini-player-thumb");
            const miniPlayIcon = document.getElementById("mini-player-icon-play");
            const miniPauseIcon = document.getElementById("mini-player-icon-pause");

            if (bar) bar.style.display = "flex";
            if (miniTitle) miniTitle.textContent = currentModalVideoItem ? currentModalVideoItem.title : "Clip vidéo";
            if (miniArtist) miniArtist.textContent = `${(currentModalVideoItem && currentModalVideoItem.artist) || "Artiste"} • 🎬 Clip Vidéo`;
            if (miniThumb) {
                miniThumb.src = (currentModalVideoItem && (currentModalVideoItem.cover_url || currentModalVideoItem.thumbnail_url || currentModalVideoItem.thumbnail)) || "/static/placeholder-cover.svg";
            }
            if (miniPlayIcon) miniPlayIcon.style.display = "none";
            if (miniPauseIcon) miniPauseIcon.style.display = "block";

            if (typeof updateVideoToggleButtons === "function") {
                updateVideoToggleButtons();
            }
            showToast("Lecture vidéo en arrière-plan (audio actif). Cliquez sur la barre pour rouvrir.", "info");
        }
    }

    function reopenVideoModal() {
        if (!currentModalVideoItem || !videoPlayer || !videoPlayer.src) return;
        window.isVideoPlayingInBackground = false;
        document.body.classList.add("video-playback-active");
        backdrop.style.display = "flex";
        void backdrop.offsetWidth;
        backdrop.classList.add("active");
        if (typeof updateVideoToggleButtons === "function") {
            updateVideoToggleButtons();
        }
    }

    window.closeVideoModal = closeVideoModal;
    window.reopenVideoModal = reopenVideoModal;

    if (closeBtn) closeBtn.addEventListener("click", () => closeVideoModal(false));
    if (cancelBtn) cancelBtn.addEventListener("click", () => closeVideoModal(false));

    // Plein écran dans la fenêtre (In-Window Fullscreen)
    if (fsBtn && theaterDialog) {
        fsBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const isFs = theaterDialog.classList.toggle("video-inwindow-fullscreen");
            if (fsExpandIcon) fsExpandIcon.style.display = isFs ? "none" : "inline";
            if (fsCompressIcon) fsCompressIcon.style.display = isFs ? "inline" : "none";
            if (fsText) fsText.textContent = isFs ? "Réduire" : "Plein écran";
            fsBtn.title = isFs ? "Quitter le plein écran fenêtre" : "Plein écran dans la fenêtre";
        });
    }

    // Bascule vers le Mode Ambiance
    if (ambientBtn) {
        ambientBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (theaterDialog) {
                theaterDialog.classList.remove("video-inwindow-fullscreen");
                if (fsExpandIcon) fsExpandIcon.style.display = "inline";
                if (fsCompressIcon) fsCompressIcon.style.display = "none";
                if (fsText) fsText.textContent = "Plein écran";
            }
            if (window.AmbientVisualizer) {
                window.AmbientVisualizer.enter();
            }
        });
    }

    // Clic sur la vignette vidéo en mode ambiance : réveille l'interface sans quitter le mode
    if (theaterDialog) {
        theaterDialog.addEventListener("click", (e) => {
            if (e.target.closest(".video-ambient-nav") || e.target.closest(".btn-ambient-arrow")) {
                return;
            }
            if (document.body.classList.contains("ambient-mode-active")) {
                if (window.AmbientVisualizer && typeof window.AmbientVisualizer.handleUserActivity === "function") {
                    window.AmbientVisualizer.handleUserActivity();
                }
            }
        });
    }

    backdrop.addEventListener("click", (e) => {
        if (!document.body.classList.contains("ambient-mode-active") && e.target === backdrop) {
            closeVideoModal(false);
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            if (theaterDialog && theaterDialog.classList.contains("video-inwindow-fullscreen")) {
                theaterDialog.classList.remove("video-inwindow-fullscreen");
                if (fsExpandIcon) fsExpandIcon.style.display = "inline";
                if (fsCompressIcon) fsCompressIcon.style.display = "none";
                if (fsText) fsText.textContent = "Plein écran";
                e.stopPropagation();
                return;
            }
            if (backdrop.classList.contains("active") && !document.body.classList.contains("ambient-mode-active")) {
                closeVideoModal(false);
            }
        }
    });

    if (videoPlayer) {
        videoPlayer.addEventListener("canplay", () => {
            if (spinner) spinner.style.display = "none";
        });
        videoPlayer.addEventListener("playing", () => {
            if (spinner) spinner.style.display = "none";
        });
        videoPlayer.addEventListener("waiting", () => {
            if (spinner && backdrop.classList.contains("active")) {
                spinner.style.display = "flex";
            }
        });
        videoPlayer.addEventListener("error", () => {
            if (spinner && backdrop.classList.contains("active")) {
                spinner.style.display = "flex";
                const spinnerText = document.getElementById("video-modal-spinner-text");
                if (spinnerText) {
                    spinnerText.innerHTML = `⚠️ Impossible de charger le flux vidéo.<br><small style="opacity: 0.8;">Vérifiez que le format du fichier est compatible ou essayez à nouveau.</small>`;
                }
            }
        });
        // Enchaînement automatique dans une playlist utilisateur mixte et enregistrement statistique
        videoPlayer.addEventListener("ended", () => {
            if (!window.currentVideoPlayLogged && currentModalVideoItem) {
                window.currentVideoPlayLogged = true;
                fetch("/api/stats/track-played", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        path: currentModalVideoItem.rel_path || currentModalVideoItem.path || "",
                        title: currentModalVideoItem.title || "",
                        artist: currentModalVideoItem.artist || "",
                        album: "Clip Vidéo",
                        genre: "Clip",
                        duration: videoPlayer.duration || currentModalVideoItem.duration || 0,
                        type: "video"
                    })
                }).catch(() => {});
            }
            if (window.isVideoPlayingInBackground) {
                closeVideoModal(true);
            }
            if (window.AudioPlayer && window.AudioPlayer.isUserPlaylistActive) {
                window.AudioPlayer.playNext();
            }
            if (typeof window.updateScreenWakeLock === "function") {
                window.updateScreenWakeLock();
            }
        });
        // Synchronisation du scrubber en Mode Ambiance et barre flottante arrière-plan
        videoPlayer.addEventListener("timeupdate", () => {
            const cur = videoPlayer.currentTime || 0;
            const dur = videoPlayer.duration || 0;

            if (!window.currentVideoPlayLogged && currentModalVideoItem && !videoPlayer.paused && (cur >= 10 || (dur > 0 && cur / dur >= 0.5))) {
                window.currentVideoPlayLogged = true;
                fetch("/api/stats/track-played", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        path: currentModalVideoItem.rel_path || currentModalVideoItem.path || "",
                        title: currentModalVideoItem.title || "",
                        artist: currentModalVideoItem.artist || "",
                        album: "Clip Vidéo",
                        genre: "Clip",
                        duration: dur || currentModalVideoItem.duration || 0,
                        type: "video"
                    })
                }).catch(() => {});
            }

            if (window.isVideoPlayingInBackground) {
                const curTimeEl = document.getElementById("mini-player-time-current");
                const totalTimeEl = document.getElementById("mini-player-time-total");
                const seekBar = document.getElementById("mini-player-seek-bar");
                if (curTimeEl && window.AudioPlayer) curTimeEl.textContent = window.AudioPlayer.formatTime(cur);
                if (totalTimeEl && window.AudioPlayer) totalTimeEl.textContent = window.AudioPlayer.formatTime(dur);
                if (seekBar && dur > 0 && !seekBar.matches(":active")) {
                    seekBar.value = (cur / dur) * 100;
                }
            }

            if (window.AmbientVisualizer && window.AmbientVisualizer.isActive && currentModalVideoItem) {
                const curTimeEl = document.getElementById("ambient-time-current");
                const totalTimeEl = document.getElementById("ambient-time-total");
                const seekBar = document.getElementById("ambient-seek-bar");
                if (curTimeEl && window.AudioPlayer) curTimeEl.textContent = window.AudioPlayer.formatTime(cur);
                if (totalTimeEl && window.AudioPlayer) totalTimeEl.textContent = window.AudioPlayer.formatTime(dur);
                if (seekBar && dur > 0 && !seekBar.matches(":active")) {
                    seekBar.value = (cur / dur) * 100;
                }
            }
        });
        videoPlayer.addEventListener("play", () => {
            VideoAudioManager.init(videoPlayer);
            VideoAudioManager.resume();

            if (window.isVideoPlayingInBackground) {
                const playIcon = document.getElementById("mini-player-icon-play");
                const pauseIcon = document.getElementById("mini-player-icon-pause");
                if (playIcon) playIcon.style.display = "none";
                if (pauseIcon) pauseIcon.style.display = "block";
            }

            if (window.AmbientVisualizer && window.AmbientVisualizer.isActive && currentModalVideoItem) {
                const playIcon = document.getElementById("ambient-icon-play");
                const pauseIcon = document.getElementById("ambient-icon-pause");
                if (playIcon) playIcon.style.display = "none";
                if (pauseIcon) pauseIcon.style.display = "block";
            }

            if (typeof window.updateScreenWakeLock === "function") {
                window.updateScreenWakeLock();
            }
        });
        videoPlayer.addEventListener("pause", () => {
            if (window.isVideoPlayingInBackground) {
                const playIcon = document.getElementById("mini-player-icon-play");
                const pauseIcon = document.getElementById("mini-player-icon-pause");
                if (playIcon) playIcon.style.display = "block";
                if (pauseIcon) pauseIcon.style.display = "none";
            }

            if (window.AmbientVisualizer && window.AmbientVisualizer.isActive && currentModalVideoItem) {
                const playIcon = document.getElementById("ambient-icon-play");
                const pauseIcon = document.getElementById("ambient-icon-pause");
                if (playIcon) playIcon.style.display = "block";
                if (pauseIcon) pauseIcon.style.display = "none";
            }

            if (typeof window.updateScreenWakeLock === "function") {
                window.updateScreenWakeLock();
            }
        });
    }

    if (dlAudioBtn) {
        dlAudioBtn.addEventListener("click", async () => {
            if (!currentModalVideoItem) return;
            const origHtml = dlAudioBtn.innerHTML;
            const fmt = currentConfig.default_format || (document.getElementById("format-select") ? document.getElementById("format-select").value : "m4a");
            await downloadItemFromSearch(currentModalVideoItem.url, currentModalVideoItem.title, fmt, dlAudioBtn, origHtml);
        });
    }

    if (dlVideoBtn) {
        dlVideoBtn.addEventListener("click", async () => {
            if (!currentModalVideoItem) return;
            const origHtml = dlVideoBtn.innerHTML;
            await downloadItemFromSearch(currentModalVideoItem.url, currentModalVideoItem.title, "mp4", dlVideoBtn, origHtml);
        });
    }

    if (extractAudioBtn) {
        extractAudioBtn.addEventListener("click", async () => {
            if (!currentModalVideoItem) return;

            const trackArtist = currentModalVideoItem.artist || "Artiste inconnu";
            const trackTitle = currentModalVideoItem.title || "Titre du clip";

            const confirmed = await showModalConfirm(
                "Extraire la piste audio",
                `Voulez-vous extraire la piste audio de « ${trackTitle} » et l'ajouter à votre collection musicale sous « ${trackArtist} / Singles & Rips » ?`,
                "🎵 Extraire l'audio",
                false,
                "Annuler"
            );
            if (!confirmed) return;

            const origHtml = extractAudioBtn.innerHTML;
            extractAudioBtn.disabled = true;
            extractAudioBtn.innerHTML = `⏳ Extraction audio en cours...`;
            showToast(`Extraction de la piste audio de « ${currentModalVideoItem.title} »...`, "info");

            try {
                const res = await fetch("/api/videos/extract-audio", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        path: currentModalVideoItem.rel_path || currentModalVideoItem.filepath || currentModalVideoItem.path,
                        artist: currentModalVideoItem.artist,
                        title: currentModalVideoItem.title
                    })
                });
                let data = null;
                try {
                    data = await res.json();
                } catch (parseErr) {
                    data = { detail: `Erreur serveur (${res.status})` };
                }

                if (res.ok && data && data.success) {
                    showToast(data.message || "Piste audio extraite avec succès dans votre collection !", "success");
                    if (window.AudioPlayer && typeof window.AudioPlayer.loadLibraryData === "function") {
                        window.AudioPlayer.loadLibraryData();
                    }
                    if (typeof loadLibrary === "function") {
                        loadLibrary();
                    }
                } else {
                    showToast(data?.detail || data?.error || `Erreur lors de l'extraction audio (${res.status})`, "error");
                }
            } catch (err) {
                showToast("Échec de communication lors de l'extraction audio", "error");
            } finally {
                extractAudioBtn.disabled = false;
                extractAudioBtn.innerHTML = origHtml;
            }
        });
    }

    if (typeof updateVideoToggleButtons === "function") {
        updateVideoToggleButtons();
    }
}

function syncAudioPlayerWithVideo(item) {
    if (!window.AudioPlayer || !item) return;
    const ap = window.AudioPlayer;
    ap.isPlaying = true;

    // Vérifier si cette vidéo fait déjà partie de la playlist utilisateur active en cours d'écoute
    const inActivePlaylist = ap.isUserPlaylistActive && 
        ap.playlist && 
        ap.currentIndex >= 0 && 
        ap.playlist[ap.currentIndex] && 
        (ap.playlist[ap.currentIndex].title === item.title || 
         (item.path && (ap.playlist[ap.currentIndex].path === item.path || ap.playlist[ap.currentIndex].filepath === item.path)));

    const vidPath = item.path || item.rel_path || item.filepath || "";
    const isConc = Boolean(item.is_concert || item.video_type === "concert" || (item.duration_seconds && item.duration_seconds >= 1200) || (vidPath && (vidPath.toLowerCase().includes('/concerts/') || vidPath.toLowerCase().includes('\\concerts\\'))));
    const thumb = item.thumbnail || item.thumbnail_url || item.cover_url || "/static/placeholder-cover.svg";

    if (!inActivePlaylist) {
        const videoTrack = {
            title: item.title || (isConc ? "Concert Vidéo" : "Clip Vidéo"),
            artist: item.artist || "Artiste inconnu",
            album: item.album || (isConc ? "Concert Vidéo" : "Clip Vidéo"),
            cover_url: thumb,
            thumbnail_url: thumb,
            is_video: true,
            is_concert: isConc,
            filepath: vidPath,
            path: vidPath,
            rel_path: item.rel_path || vidPath,
            duration_seconds: item.duration_seconds || 0,
            id: item.id || item.video_id || "",
            format: isConc ? "CONCERT" : "VIDÉO"
        };

        ap.currentAlbum = {
            title: item.title || (isConc ? "Concert Vidéo" : "Clip Vidéo"),
            artist: item.artist || "Artiste inconnu",
            cover_url: thumb,
            thumbnail_url: thumb,
            is_video: true,
            is_concert: isConc,
            is_online: Boolean(item.is_online || (!vidPath && item.url)),
            path: vidPath || "video_standalone",
            year: item.year || ""
        };
        ap.activeAlbumPath = ap.currentAlbum.path;
        ap.playlist = [videoTrack];
        ap.activePlaylist = [videoTrack];
        ap.currentIndex = 0;
        ap.playbackContext = {
            album: ap.currentAlbum,
            playlist: [videoTrack],
            currentIndex: 0
        };
        if (typeof ap.recordPlaybackOrigin === "function") {
            ap.recordPlaybackOrigin("video");
        }
        ap.updateDisplayedAlbumUI();
        ap.updateCurrentTrackUI(videoTrack);
        ap.renderPlayerTab();
    } else {
        const trk = ap.playlist[ap.currentIndex];
        if (trk) {
            ap.updateCurrentTrackUI(trk);
            ap.updateDisplayedAlbumUI();
            ap.renderPlayerTab();
        }
    }
    ap.updatePlayStateUI();
}

function openVideoModal(item) {
    const backdrop = document.getElementById("video-modal-backdrop");
    const titleEl = document.getElementById("video-modal-title");
    const artistEl = document.getElementById("video-modal-artist");
    const videoPlayer = document.getElementById("video-modal-player");
    const spinner = document.getElementById("video-modal-spinner");
    const spinnerText = document.getElementById("video-modal-spinner-text");
    const extLink = document.getElementById("video-modal-external-link");
    const dlAudioBtn = document.getElementById("video-modal-dl-audio-btn");
    const dlVideoBtn = document.getElementById("video-modal-dl-video-btn");
    const extractAudioBtn = document.getElementById("video-modal-extract-audio-btn");

    if (!backdrop || !item) return;

    // Si la même vidéo en ligne est déjà chargée, réafficher sans recharger le flux pour éviter toute coupure audio
    const isSameActiveOnlineVideo = currentModalVideoItem && (
        (item.id && currentModalVideoItem.id && item.id === currentModalVideoItem.id) ||
        (item.url && currentModalVideoItem.url && item.url === currentModalVideoItem.url) ||
        (item.title && currentModalVideoItem.title && item.title === currentModalVideoItem.title && item.artist === currentModalVideoItem.artist)
    );

    if (isSameActiveOnlineVideo && videoPlayer && videoPlayer.src) {
        window.isVideoPlayingInBackground = false;
        document.body.classList.add("video-playback-active");
        backdrop.style.display = "flex";
        void backdrop.offsetWidth;
        backdrop.classList.add("active");
        if (videoPlayer.paused) {
            videoPlayer.play().catch(e => console.warn(e));
        }
        if (typeof updateVideoToggleButtons === "function") {
            updateVideoToggleButtons();
        }
        return;
    }

    currentModalVideoItem = item;
    window.currentModalVideoItem = item;
    window.isVideoPlayingInBackground = false;
    const savedAmbientPos = localStorage.getItem("ytm_ambient_video_pos") || "bottom-center";
    if (window.setVideoAmbientPosition) window.setVideoAmbientPosition(savedAmbientPos, false);

    // Pause de la pré-écoute audio si active
    if (window.globalAudio && !window.globalAudio.paused) {
        window.globalAudio.pause();
    }
    if (window.AudioPlayer && window.AudioPlayer.audio && !window.AudioPlayer.audio.paused) {
        window.AudioPlayer.pause();
    }

    syncAudioPlayerWithVideo(item);

    if (titleEl) titleEl.textContent = item.title || "Clip vidéo";
    if (artistEl) artistEl.textContent = item.artist || "Artiste inconnu";
    const tagArtistBtnOnline = document.getElementById("video-modal-tag-artist-btn");
    if (tagArtistBtnOnline) tagArtistBtnOnline.style.display = "none";

    if (dlAudioBtn) dlAudioBtn.style.display = "inline-flex";
    if (dlVideoBtn) dlVideoBtn.style.display = "inline-flex";
    if (extractAudioBtn) extractAudioBtn.style.display = "none";
    if (extLink) extLink.style.display = "inline-flex";

    let videoId = item.id || "";
    if (!videoId && item.url) {
        const match = item.url.match(/[?&]v=([^&]+)/);
        if (match) videoId = match[1];
    }

    // Mise à jour du lien externe
    if (extLink) {
        const ytUrl = item.url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "#");
        extLink.href = ytUrl;
    }

    if (videoPlayer && videoId) {
        if (spinner) {
            spinner.style.display = "flex";
            if (spinnerText) spinnerText.textContent = "Connexion au flux vidéo haute qualité...";
        }
        videoPlayer.src = `/api/video/stream?id=${encodeURIComponent(videoId)}`;
        videoPlayer.load();
        VideoAudioManager.init(videoPlayer);
        const targetVol = (videoPlayer.dataset.normalVolume ? parseFloat(videoPlayer.dataset.normalVolume) : (videoPlayer.volume || 1));
        AudioFader.fadeIn(videoPlayer, targetVol, 500);
        videoPlayer.play().catch(e => {
            console.warn("Lecture automatique vidéo différée:", e);
        });
    } else if (videoPlayer) {
        videoPlayer.removeAttribute("src");
        if (spinner) spinner.style.display = "none";
    }

    // Activer l'affichage Grand Théâtre
    document.body.classList.add("video-playback-active");

    backdrop.style.display = "flex";
    void backdrop.offsetWidth;
    backdrop.classList.add("active");
}

function openLocalVideoModal(item) {
    const backdrop = document.getElementById("video-modal-backdrop");
    const titleEl = document.getElementById("video-modal-title");
    const artistEl = document.getElementById("video-modal-artist");
    const videoPlayer = document.getElementById("video-modal-player");
    const spinner = document.getElementById("video-modal-spinner");
    const spinnerText = document.getElementById("video-modal-spinner-text");
    const extLink = document.getElementById("video-modal-external-link");
    const dlAudioBtn = document.getElementById("video-modal-dl-audio-btn");
    const dlVideoBtn = document.getElementById("video-modal-dl-video-btn");
    const extractAudioBtn = document.getElementById("video-modal-extract-audio-btn");

    if (!backdrop || !item) return;

    // Si la même vidéo locale est déjà active/en arrière-plan, réafficher sans recharger le flux (0ms coupure de son !)
    const isSameActiveLocalVideo = currentModalVideoItem && (
        (item.rel_path && (item.rel_path === currentModalVideoItem.rel_path || item.rel_path === currentModalVideoItem.path)) ||
        (item.path && (item.path === currentModalVideoItem.path || item.path === currentModalVideoItem.rel_path)) ||
        (item.filepath && (item.filepath === currentModalVideoItem.filepath || item.filepath === currentModalVideoItem.path)) ||
        (item.id && currentModalVideoItem.id && item.id === currentModalVideoItem.id) ||
        (item.title && currentModalVideoItem.title && item.title === currentModalVideoItem.title && item.artist === currentModalVideoItem.artist)
    );

    if (isSameActiveLocalVideo && videoPlayer && videoPlayer.src) {
        window.isVideoPlayingInBackground = false;
        document.body.classList.add("video-playback-active");
        backdrop.style.display = "flex";
        void backdrop.offsetWidth;
        backdrop.classList.add("active");
        if (videoPlayer.paused) {
            videoPlayer.play().catch(e => console.warn(e));
        }
        if (typeof updateVideoToggleButtons === "function") {
            updateVideoToggleButtons();
        }
        return;
    }

    currentModalVideoItem = item;
    window.currentModalVideoItem = item;
    window.isVideoPlayingInBackground = false;
    window.currentVideoPlayLogged = false;
    const savedAmbientPos = localStorage.getItem("ytm_ambient_video_pos") || "bottom-center";
    if (window.setVideoAmbientPosition) window.setVideoAmbientPosition(savedAmbientPos, false);

    // Pause audio immédiate
    if (window.globalAudio && !window.globalAudio.paused) {
        window.globalAudio.pause();
    }
    if (window.AudioPlayer && window.AudioPlayer.audio && !window.AudioPlayer.audio.paused) {
        window.AudioPlayer.pause();
    }

    syncAudioPlayerWithVideo(item);

    const isConcert = item.video_type === 'concert' || item.is_concert || (item.duration_seconds && item.duration_seconds >= 600) || (item.path && (item.path.toLowerCase().includes('/concerts/') || item.path.toLowerCase().includes('\\concerts\\')));

    const typeBadge = document.getElementById("video-modal-type-badge");
    if (typeBadge) {
        if (isConcert) {
            typeBadge.textContent = "🎸 Concert";
            typeBadge.className = "search-type-badge badge-concert";
        } else {
            typeBadge.textContent = "Vidéo";
            typeBadge.className = "search-type-badge badge-video";
        }
    }

    if (titleEl) titleEl.textContent = item.title || (isConcert ? "Concert vidéo" : "Clip vidéo");
    if (artistEl) artistEl.textContent = item.artist || "Artiste inconnu";

    const tagArtistBtn = document.getElementById("video-modal-tag-artist-btn");
    const isUnknown = (window.AudioPlayer && typeof window.AudioPlayer.isUnknownArtist === "function")
        ? window.AudioPlayer.isUnknownArtist(item.artist)
        : (!item.artist || ["artiste inconnu", "unknown artist", "divers", "clips divers"].includes(String(item.artist).trim().toLowerCase()));

    if (tagArtistBtn) {
        if (isUnknown) {
            tagArtistBtn.style.display = "inline-flex";
            tagArtistBtn.onclick = (e) => {
                e.stopPropagation();
                if (window.AudioPlayer && typeof window.AudioPlayer.sendVideoToTagEditor === "function") {
                    window.AudioPlayer.sendVideoToTagEditor(item);
                }
            };
        } else {
            tagArtistBtn.style.display = "none";
            tagArtistBtn.onclick = null;
        }
    }

    // Mode local : masquer les boutons de download (l'extraction audio se fait directement depuis la vignette)
    if (dlAudioBtn) dlAudioBtn.style.display = "none";
    if (dlVideoBtn) dlVideoBtn.style.display = "none";
    if (extractAudioBtn) extractAudioBtn.style.display = "none";
    if (extLink) extLink.style.display = "none";

    if (videoPlayer) {
        if (spinner) {
            spinner.style.display = "flex";
            if (spinnerText) spinnerText.textContent = isConcert ? "Lecture du concert vidéo..." : "Lecture du clip vidéo local...";
        }
        let vidPath = item.rel_path || item.path || item.filepath || "";
        if (!vidPath && (item.thumbnail || item.thumbnail_url || item.cover_url)) {
            const targetUrl = item.thumbnail || item.thumbnail_url || item.cover_url || "";
            if (targetUrl.includes("path=")) {
                try {
                    const m = targetUrl.match(/[?&]path=([^&]+)/);
                    if (m && m[1]) vidPath = decodeURIComponent(m[1]);
                } catch (e) {}
            }
        }
        const streamUrl = `/api/videos/stream?path=${encodeURIComponent(vidPath)}`;
        videoPlayer.src = streamUrl;
        videoPlayer.load();
        VideoAudioManager.init(videoPlayer);
        const targetVol = (videoPlayer.dataset.normalVolume ? parseFloat(videoPlayer.dataset.normalVolume) : (videoPlayer.volume || 1));
        AudioFader.fadeIn(videoPlayer, targetVol, 500);

        // Gestion de la reprise de lecture pour les concerts & vidéos longues
        const resumeKey = 'ytm_resume_vid_' + (item.rel_path || item.path || item.id || item.video_id || item.title);
        const savedTime = parseFloat(localStorage.getItem(resumeKey) || '0');

        const onLoadedMeta = () => {
            if (savedTime > 15 && (!videoPlayer.duration || savedTime < (videoPlayer.duration - 30))) {
                videoPlayer.currentTime = savedTime;
                showToast(`Reprise de la lecture à ${formatTime(savedTime)}`, "info");
            }
            videoPlayer.removeEventListener("loadedmetadata", onLoadedMeta);
        };
        videoPlayer.addEventListener("loadedmetadata", onLoadedMeta);

        if (videoPlayer._resumeTimeUpdateHandler) {
            videoPlayer.removeEventListener("timeupdate", videoPlayer._resumeTimeUpdateHandler);
        }
        let lastSaveTime = 0;
        videoPlayer._resumeTimeUpdateHandler = () => {
            const now = Date.now();
            if (now - lastSaveTime > 3000 && videoPlayer.currentTime > 10) {
                lastSaveTime = now;
                if (videoPlayer.duration && videoPlayer.currentTime >= videoPlayer.duration - 30) {
                    localStorage.removeItem(resumeKey);
                } else {
                    localStorage.setItem(resumeKey, videoPlayer.currentTime);
                }
            }
        };
        videoPlayer.addEventListener("timeupdate", videoPlayer._resumeTimeUpdateHandler);

        videoPlayer.play().catch(e => {
            console.warn("Lecture vidéo locale différée:", e);
        });
    }

    // Activer l'affichage Grand Théâtre
    document.body.classList.add("video-playback-active");

    backdrop.style.display = "flex";
    void backdrop.offsetWidth;
    backdrop.classList.add("active");
    updateVideoToggleButtons();
}

function updateVideoToggleButtons() {
    const videoPlayer = document.getElementById("video-modal-player");
    const backdrop = document.getElementById("video-modal-backdrop");
    const miniBtn = document.getElementById("mini-player-video-toggle-btn");
    const ambientBtn = document.getElementById("ambient-video-toggle-btn");

    const hasActiveVideo = Boolean(
        (window.currentModalVideoItem || currentModalVideoItem) &&
        videoPlayer &&
        videoPlayer.src &&
        !videoPlayer.ended
    );

    const isAmbient = document.body.classList.contains("ambient-mode-active");
    const isVideoVisible = isAmbient
        ? !document.body.classList.contains("ambient-video-hidden")
        : Boolean(backdrop && backdrop.classList.contains("active"));

    const buttons = [miniBtn, ambientBtn].filter(Boolean);

    buttons.forEach(btn => {
        if (!hasActiveVideo) {
            btn.disabled = true;
            btn.classList.add("disabled");
            btn.classList.remove("video-active");
            btn.title = "Aucune vidéo en cours de lecture";
            btn.style.opacity = "0.28";
            btn.style.cursor = "not-allowed";
        } else {
            btn.disabled = false;
            btn.classList.remove("disabled");
            btn.style.opacity = "1";
            btn.style.cursor = "pointer";
            if (isVideoVisible) {
                btn.classList.add("video-active");
                btn.title = "Masquer l'affichage vidéo (continuer l'écoute sonore) [Raccourci: V]";
                btn.style.color = "var(--primary, #00f0ff)";
            } else {
                btn.classList.remove("video-active");
                btn.title = "Afficher l'écran vidéo [Raccourci: V]";
                btn.style.color = "";
            }
        }
    });
}

function toggleVideoDisplay() {
    const videoPlayer = document.getElementById("video-modal-player");
    const backdrop = document.getElementById("video-modal-backdrop");
    const hasActiveVideo = Boolean(
        (window.currentModalVideoItem || currentModalVideoItem) &&
        videoPlayer &&
        videoPlayer.src
    );

    if (!hasActiveVideo) {
        if (typeof showToast === "function") {
            showToast("Aucune vidéo en cours de lecture", "info");
        }
        return;
    }

    const isAmbient = document.body.classList.contains("ambient-mode-active");

    if (isAmbient) {
        const isHidden = document.body.classList.toggle("ambient-video-hidden");
        if (typeof showToast === "function") {
            showToast(isHidden ? "Vignette vidéo masquée (audio actif)" : "Vignette vidéo affichée", "info");
        }
    } else {
        const isModalVisible = backdrop && backdrop.classList.contains("active");
        if (isModalVisible) {
            if (typeof window.closeVideoModal === "function") {
                window.closeVideoModal(false);
            }
        } else {
            if (typeof window.reopenVideoModal === "function") {
                window.reopenVideoModal();
            }
        }
    }
    updateVideoToggleButtons();
}

// Exports globaux
window.VideoAudioManager = VideoAudioManager;
window.setupVideoModal = setupVideoModal;
window.closeVideoModal = window.closeVideoModal || function() {};
window.reopenVideoModal = window.reopenVideoModal || function() {};
window.syncAudioPlayerWithVideo = syncAudioPlayerWithVideo;
window.openVideoModal = openVideoModal;
window.openLocalVideoModal = openLocalVideoModal;
window.updateVideoToggleButtons = updateVideoToggleButtons;
window.toggleVideoDisplay = toggleVideoDisplay;


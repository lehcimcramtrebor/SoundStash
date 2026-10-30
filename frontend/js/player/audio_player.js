// =========================================================
// SoundStash - Module Player / AudioPlayer & Égaliseur
// Moteur audio unifié, presets DSP, playlist, vues & mini-dock
// =========================================================

// =========================================================
// PRESETS D'ÉGALISATION AUDIO HAUTE FIDÉLITÉ (10 BANDES)
// =========================================================
const EQ_PRESETS = {
    flat: {
        name: "Plat (Neutre)",
        badge: "Plat",
        gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    },
    bass_boost: {
        name: "Bass Boost",
        badge: "Bass Boost",
        gains: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0]
    },
    bass_treble: {
        name: "Bass & Treble",
        badge: "Bass & Treble",
        gains: [6, 5, 3, 0, -1, 0, 2, 4, 5, 6]
    },
    rock: {
        name: "Rock",
        badge: "Rock",
        gains: [5, 4, 2, -1, -2, 0, 2, 3, 4, 5]
    },
    vocal: {
        name: "Vocal / Podcast",
        badge: "Vocal",
        gains: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1]
    },
    electro: {
        name: "Électro / Dance",
        badge: "Électro",
        gains: [6, 5, 2, 0, -2, 2, 1, 3, 5, 5]
    },
    jazz: {
        name: "Jazz",
        badge: "Jazz",
        gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3]
    },
    classical: {
        name: "Classique",
        badge: "Classique",
        gains: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4]
    },
    acoustic: {
        name: "Acoustique",
        badge: "Acoustique",
        gains: [3, 2, 1, 1, 2, 2, 3, 3, 2, 1]
    },
    treble_boost: {
        name: "Brillance (Treble)",
        badge: "Brillance",
        gains: [-2, -1, 0, 0, 1, 2, 4, 6, 7, 8]
    },
    custom: {
        name: "Personnalisé",
        badge: "Personnalisé",
        gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    }
};

// =========================================================
// MOTEUR DE FONDU AUDIO PROGRESSIF (Fade-in & Fade-out 0.5s)
// =========================================================

const AudioFader = {
    duration: 500, // 0.5 seconde par défaut
    enabled: true,
    activeFades: new WeakMap(),

    init() {
        try {
            const saved = localStorage.getItem("ytm_audio_fader_enabled");
            if (saved !== null) {
                this.enabled = saved === "true";
            }
        } catch (e) {}
        window.AudioFader = this;
    },

    stop(media) {
        if (!media) return;
        const current = this.activeFades.get(media);
        if (current) {
            current.cancelled = true;
            if (current.animId) cancelAnimationFrame(current.animId);
            this.activeFades.delete(media);
        }
    },

    fadeIn(media, targetVolume = null, durationMs = null) {
        if (!media) return Promise.resolve();
        const duration = (typeof durationMs === "number" && durationMs >= 0) ? durationMs : this.duration;
        const finalVol = Math.max(0, Math.min(1, (targetVolume !== null && typeof targetVolume === "number") ? targetVolume : (media.dataset.normalVolume ? parseFloat(media.dataset.normalVolume) : (media.volume || 1))));
        media.dataset.normalVolume = String(finalVol);

        if (!this.enabled || duration <= 0) {
            media.volume = finalVol;
            return Promise.resolve();
        }

        this.stop(media);
        media.volume = 0;

        const state = { cancelled: false, targetVolume: finalVol, animId: null };
        this.activeFades.set(media, state);
        const startTime = performance.now();

        return new Promise((resolve) => {
            const step = (now) => {
                if (state.cancelled) {
                    resolve();
                    return;
                }
                const elapsed = now - startTime;
                const progress = Math.min(1, elapsed / duration);
                const curTarget = (typeof state.targetVolume === "number") ? state.targetVolume : finalVol;
                // Courbe d'atténuation sinusoïdale fluide
                const factor = Math.sin((progress * Math.PI) / 2);
                media.volume = Math.max(0, Math.min(1, curTarget * factor));

                if (progress < 1 && !state.cancelled) {
                    state.animId = requestAnimationFrame(step);
                } else {
                    if (!state.cancelled) media.volume = curTarget;
                    this.activeFades.delete(media);
                    resolve();
                }
            };
            state.animId = requestAnimationFrame(step);
        });
    },

    fadeOut(media, durationMs = null) {
        if (!media || media.volume === 0) return Promise.resolve(true);
        const duration = (typeof durationMs === "number" && durationMs >= 0) ? durationMs : this.duration;

        if (!this.enabled || duration <= 0) {
            return Promise.resolve(true);
        }

        this.stop(media);
        const initialVol = media.volume;
        media.dataset.normalVolume = String(initialVol);

        const state = { cancelled: false, targetVolume: initialVol, animId: null };
        this.activeFades.set(media, state);
        const startTime = performance.now();

        return new Promise((resolve) => {
            const step = (now) => {
                if (state.cancelled) {
                    resolve(false);
                    return;
                }
                const elapsed = now - startTime;
                const progress = Math.min(1, elapsed / duration);
                const factor = Math.cos((progress * Math.PI) / 2);
                media.volume = Math.max(0, Math.min(1, initialVol * factor));

                if (progress < 1 && !state.cancelled) {
                    state.animId = requestAnimationFrame(step);
                } else {
                    if (!state.cancelled) media.volume = 0;
                    this.activeFades.delete(media);
                    resolve(!state.cancelled);
                }
            };
            state.animId = requestAnimationFrame(step);
        });
    }
};
AudioFader.init();

// =========================================================
// MOTEUR AUDIO UNIFIÉ (Lecteur Sanctuarisé & Mini-Dock Flottant)
// =========================================================

const AudioPlayer = {
    audio: null,
    currentAlbum: null,       // { title, artist, year, genre, cover_url, path, is_collection }
    playlist: [],             // Array of { title, artist, path, stream_url, duration, format, track_number }
    currentIndex: -1,
    isPlaying: false,
    isShuffle: false,
    repeatMode: "all",        // "none" | "all" | "one"
    isSeeking: false,
    volume: 0.85,
    isMuted: false,
    isRadioPlaying: false,
    currentRadio: null,

    // État du navigateur de collection
    librarySource: "library", // "library" | "temp"
    currentView: "albums",    // "albums" | "all" | "artists" | "genres" | "now-playing"
    previousView: "albums",
    previousModeWasWorkshop: false,
    libraryAlbums: [],
    allCatalog: null,
    isLoadingCatalog: false,
    isCatalogReady: false,
    allSearchQuery: "",
    searchFilter: "",
    sortMode: "artist-asc",
    sortModeAlbums: "artist-asc",
    sortModeArtists: "name-asc",
    sortModeGenres: "albums-desc",
    sortModeAllCatalog: "artist-asc",
    sortModeAllSearch: "relevance",
    selectedArtistFilter: null,
    selectedGenreFilter: null,
    selectedTypeFilters: new Set(["album", "single", "rip", "playlist"]),
    libraryConfigured: true,
    isLoadingLibrary: false,
    hasLoadedOnce: false,
    activeAlbumPath: null,
    activePlaylist: [],
    isExtractingCovers: false,
    albumInfoCache: new Map(), // albumPath -> cached info JSON (0ms instant playback)

    // Hub Vidéo & Clips musicaux
    videosCatalog: [],
    isLoadingVideos: false,
    videosSearchFilter: "",
    videosSortMode: "recent",

    // Recherche globale unifiée (Option A)
    preSearchView: "albums",
    unifiedSearchQuery: "",
    activeUnifiedSearchChip: "all",
    unifiedSearchResults: null,
    _unifiedSearchDebounceTimer: null,

    // File d'attente prioritaire & Reprise de lecture
    userQueue: [],            // Array of { title, artist, album, year, filepath, stream_url, duration, format, track_number, cover_url, album_path }
    playbackContext: null,    // { album: {...}, playlist: [...], currentIndex: number }
    currentTrackIsFromQueue: false,
    currentQueueTrack: null,
    endOfAlbumBehavior: "stop", // "stop" | "repeat" | "random"
    isQueueDrawerOpen: false,

    formatTrackBadge(trk) {
        if (!trk) return "M4A";
        const fmt = (trk.format || (trk.filepath ? trk.filepath.split('.').pop() : "M4A")).toUpperCase();
        const br = trk.bitrate || trk.bitrate_kbps;
        if (br && typeof br === "number" && br > 0) {
            return `${fmt} • ${br}k`;
        }
        return fmt;
    },

    // Égaliseur Audio Haute Fidélité (10 Bandes & Web Audio API)
    eqAudioCtx: null,
    eqSourceNode: null,
    eqFilters: [],
    eqInitialized: false,
    eqEnabled: true,
    eqCurrentPreset: "flat",
    eqCustomGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    isEqualizerModalOpen: false,
    analyser: null,
    analyserDataArray: null,
    analyserFreqArray: null,

    // Correction Physiologique (Loudness Progressif ISO 226)
    loudnessAmount: 0,
    loudnessPreGainNode: null,
    loudnessBassFilter: null,
    loudnessTrebleFilter: null,
    loudnessLimiterNode: null,

    // Sélection de la sortie son Windows
    audioOutputDeviceId: "default",
    availableAudioOutputDevices: [],
    isAudioOutputFlyoutOpen: false,
    currentAudioOutputTriggerBtn: null,

    // Mémorisation & Reprise transparente de session musicale (v5.0.4)
    _hasPlayedInCurrentRun: false,
    _lastSessionSaveMs: 0,
    _pendingResumeSeekTime: 0,
    _pendingResumeDuration: 0,
    _isRestoringSavedSession: false,
    _showResumeNotificationOnLoad: false,
    _pendingAllCollectionHydration: false,
    _restoredTargetTrackPath: "",
    _restoredTargetTrackId: "",

    _serializeTrackForSession(t) {
        if (!t) return null;
        return {
            id: t.id || "",
            type: t.type || "audio",
            title: t.title || "",
            artist: t.artist || "",
            album: t.album || "",
            album_path: t.album_path || "",
            duration: t.duration || "--:--",
            duration_seconds: t.duration_seconds || 0,
            path: t.path || "",
            filepath: t.filepath || "",
            rel_path: t.rel_path || "",
            stream_url: t.stream_url || "",
            cover_url: t.cover_url || "",
            thumbnail_url: t.thumbnail_url || "",
            track_number: t.track_number || 1,
            format: t.format || "M4A",
            bitrate: t.bitrate || t.bitrate_kbps || 0,
            is_video: Boolean(t.is_video),
            is_concert: Boolean(t.is_concert)
        };
    },

    savePlaybackSession(markAsNewSave = true) {
        try {
            if (this.isRadioPlaying && this.currentRadio) {
                let notifiedOnRestore = false;
                if (!markAsNewSave) {
                    try {
                        const prevRaw = localStorage.getItem("soundstash_saved_playback_session");
                        if (prevRaw) {
                            const prev = JSON.parse(prevRaw);
                            if (prev && prev.notifiedOnRestore === true) {
                                notifiedOnRestore = true;
                            }
                        }
                    } catch (_) {}
                }
                const sessionPayload = {
                    version: 1,
                    savedAt: Date.now(),
                    notifiedOnRestore: notifiedOnRestore,
                    isRadio: true,
                    currentRadio: this.currentRadio,
                    isUserPlaylistActive: false,
                    isShuffle: this.isShuffle,
                    repeatMode: this.repeatMode,
                    volume: this.volume,
                    isMuted: this.isMuted,
                    currentView: this.currentView || "radios"
                };
                localStorage.setItem("soundstash_saved_playback_session", JSON.stringify(sessionPayload));
                return;
            }
            if (!this.currentAlbum || !this.playlist || this.playlist.length === 0 || this.currentIndex < 0) {
                return;
            }
            const albPath = String(this.currentAlbum.path || "");
            if (this.currentAlbum.is_online || albPath.startsWith("online:")) {
                return;
            }
            const curTrk = this.playlist[this.currentIndex] || this.currentTrack;
            if (!curTrk || curTrk.is_online) {
                return;
            }

            let curTime = 0;
            if (this.audio && this.audio.currentTime > 0) {
                curTime = this.audio.currentTime;
            } else if (this._pendingResumeSeekTime > 0) {
                curTime = this._pendingResumeSeekTime;
            }

            let dur = 0;
            if (this.audio && this.audio.duration && !isNaN(this.audio.duration) && this.audio.duration > 0) {
                dur = this.audio.duration;
            } else if (curTrk.duration_seconds > 0) {
                dur = curTrk.duration_seconds;
            } else if (this._pendingResumeDuration > 0) {
                dur = this._pendingResumeDuration;
            }

            let notifiedOnRestore = false;
            if (!markAsNewSave) {
                try {
                    const prevRaw = localStorage.getItem("soundstash_saved_playback_session");
                    if (prevRaw) {
                        const prev = JSON.parse(prevRaw);
                        if (prev && prev.notifiedOnRestore === true) {
                            notifiedOnRestore = true;
                        }
                    }
                } catch (_) {}
            }

            const isAllCollection = (albPath === "system:all-collection");
            let savedPlaylist = [];
            let savedIndex = this.currentIndex;

            if (this.playlist.length <= 400) {
                savedPlaylist = this.playlist.map(t => this._serializeTrackForSession(t));
            } else {
                const halfWin = 100;
                const startWin = Math.max(0, this.currentIndex - halfWin);
                const endWin = Math.min(this.playlist.length, startWin + 200);
                savedPlaylist = this.playlist.slice(startWin, endWin).map(t => this._serializeTrackForSession(t));
                savedIndex = this.currentIndex - startWin;
            }

            const sessionPayload = {
                version: 1,
                savedAt: Date.now(),
                notifiedOnRestore: notifiedOnRestore,
                currentAlbum: {
                    title: this.currentAlbum.title || "",
                    artist: this.currentAlbum.artist || "",
                    year: this.currentAlbum.year || "",
                    genre: this.currentAlbum.genre || "",
                    cover_url: this.currentAlbum.cover_url || "/static/placeholder-cover.svg",
                    path: albPath,
                    is_collection: Boolean(this.currentAlbum.is_collection),
                    is_playlist: Boolean(this.currentAlbum.is_playlist),
                    is_video: Boolean(this.currentAlbum.is_video),
                    is_concert: Boolean(this.currentAlbum.is_concert)
                },
                currentTrack: this._serializeTrackForSession(curTrk),
                targetTrackPath: curTrk.filepath || curTrk.path || "",
                targetTrackId: curTrk.id || "",
                playlist: savedPlaylist,
                currentIndex: savedIndex,
                isAllCollection: isAllCollection,
                fullPlaylistLength: this.playlist.length,
                currentTime: Math.round(curTime * 100) / 100,
                duration: Math.round(dur * 100) / 100,
                isShuffle: Boolean(this.isShuffle),
                repeatMode: this.repeatMode || "all",
                isUserPlaylistActive: Boolean(this.isUserPlaylistActive),
                librarySource: this.librarySource || "library",
                playbackOrigin: this.playbackOrigin || null,
                userQueue: (this.userQueue || []).slice(0, 50).map(t => this._serializeTrackForSession(t))
            };

            localStorage.setItem("soundstash_saved_playback_session", JSON.stringify(sessionPayload));
        } catch (err) {
            console.warn("[PlaybackResume] Impossible de sauvegarder la session:", err);
        }
    },

    clearSavedPlaybackSession() {
        this._pendingResumeSeekTime = 0;
        this._pendingResumeDuration = 0;
        this._isRestoringSavedSession = false;
        this._showResumeNotificationOnLoad = false;
        this._pendingAllCollectionHydration = false;
        try {
            localStorage.removeItem("soundstash_saved_playback_session");
        } catch (_) {}
    },

    restoreSavedPlaybackSession() {
        try {
            const raw = localStorage.getItem("soundstash_saved_playback_session");
            if (!raw) return false;
            const saved = JSON.parse(raw);
            if (!saved) return false;

            if (saved.isRadio && saved.currentRadio) {
                this.isRadioPlaying = true;
                this.currentRadio = saved.currentRadio;
                this.currentAlbum = null;
                this.playlist = [];
                this.activePlaylist = [];
                this.currentIndex = -1;
                this.isPlaying = false;
                this._isRestoringSavedSession = true;
                this._showResumeNotificationOnLoad = !saved.notifiedOnRestore;
                this.playbackOrigin = { type: "radios", view: "radios" };

                const rad = saved.currentRadio;
                let logo = rad.favicon;
                if (!logo || logo.includes("radio_placeholder") || logo.includes("upload.wikimedia.org")) {
                    if (window.RadioManager && typeof window.RadioManager.getProceduralStationCover === "function") {
                        logo = window.RadioManager.getProceduralStationCover(rad.name, rad.tags, rad.country);
                    } else {
                        logo = "/static/assets/radio_placeholder.svg";
                    }
                }
                const stationName = rad.name || "Radio Web";
                const metaSubtitle = rad.sub_label
                    ? (rad.sub_label_type === 'location' ? `📍 ${rad.sub_label} • ${rad.country || "Direct"}` : `🏷️ ${rad.sub_label}`)
                    : (rad.tags || rad.country || "Flux en direct");

                const miniThumb = document.getElementById("mini-player-thumb");
                const miniTitle = document.getElementById("mini-player-title");
                const miniArtist = document.getElementById("mini-player-artist");
                if (miniThumb) miniThumb.src = logo;
                if (miniTitle) miniTitle.textContent = stationName;
                if (miniArtist) miniArtist.textContent = metaSubtitle;

                const pCover = document.getElementById("player-cover-img");
                const pFmt = document.getElementById("player-format-badge");
                const pTitle = document.getElementById("player-track-title");
                const pArtist = document.getElementById("player-track-artist");
                const pAlbum = document.getElementById("player-track-album");
                if (pCover) pCover.src = logo;
                if (pFmt) pFmt.textContent = rad.codec ? (rad.codec + (rad.bitrate ? " " + rad.bitrate + "k" : "")) : "RADIO";
                if (pTitle) pTitle.textContent = stationName;
                if (pArtist) pArtist.textContent = metaSubtitle;
                if (pAlbum) pAlbum.textContent = "Contrôle du direct • Timeshift 30 min";

                if (window.RadioManager) {
                    window.RadioManager.state.currentStation = rad;
                    window.RadioManager.state.isPlaying = false;
                }

                this.showPlayerBar();
                this.updatePlayStateUI();
                this.updateMiniDockVisibility();
                this.syncSystemMediaState();
                this.renderPlayerTab();

                setTimeout(() => {
                    if (this._showResumeNotificationOnLoad && !this._hasPlayedInCurrentRun) {
                        this._showResumeNotificationOnLoad = false;
                        if (typeof showToast === "function") {
                            showToast(`📻 Session précédente : « ${stationName} » prête. Appuyez sur ▶ ou Espace pour écouter.`, "info", 5000);
                        }
                    }
                }, 1200);

                return true;
            }

            if (!saved.currentAlbum || !Array.isArray(saved.playlist) || saved.playlist.length === 0) {
                return false;
            }

            const idx = Math.max(0, Math.min(saved.currentIndex || 0, saved.playlist.length - 1));
            const trk = saved.playlist[idx] || saved.currentTrack;
            if (!trk) return false;

            const isVideo = Boolean(
                trk.type === "video" ||
                trk.is_video ||
                (trk.filepath && /\.(mp4|mkv|webm)$/i.test(trk.filepath)) ||
                (trk.path && /\.(mp4|mkv|webm)$/i.test(trk.path))
            );
            if (isVideo) return false;

            const trkPath = trk.filepath || trk.path || "";
            const streamUrl = trk.stream_url || (trkPath ? `/api/audio/stream-local?path=${encodeURIComponent(trkPath)}` : "");
            if (!streamUrl) return false;

            this.currentAlbum = saved.currentAlbum;
            this.playlist = saved.playlist.slice();
            this.activePlaylist = saved.playlist.slice();
            this.currentIndex = idx;
            this.currentTrack = trk;
            this.activeAlbumPath = saved.currentAlbum.path || null;
            this.isUserPlaylistActive = Boolean(saved.isUserPlaylistActive);
            this.playbackOrigin = saved.playbackOrigin || null;
            this.playbackContext = {
                album: this.currentAlbum,
                playlist: this.playlist.slice(),
                currentIndex: idx
            };

            if (typeof saved.isShuffle === "boolean") {
                this.isShuffle = saved.isShuffle;
                this.updateShuffleUI();
            }
            if (saved.repeatMode && ["none", "all", "one"].includes(saved.repeatMode)) {
                this.repeatMode = saved.repeatMode;
                this.updateRepeatUI();
            }
            if (Array.isArray(saved.userQueue) && saved.userQueue.length > 0) {
                this.userQueue = saved.userQueue;
                this.updateQueueBadges();
            }

            if (saved.isAllCollection || (this.currentAlbum.path === "system:all-collection" && saved.fullPlaylistLength > this.playlist.length)) {
                this._pendingAllCollectionHydration = true;
                this._restoredTargetTrackPath = saved.targetTrackPath || trkPath;
                this._restoredTargetTrackId = saved.targetTrackId || trk.id || "";
            }

            const savedTime = (typeof saved.currentTime === "number" && saved.currentTime > 0) ? saved.currentTime : 0;
            const savedDur = (typeof saved.duration === "number" && saved.duration > 0) ? saved.duration : (trk.duration_seconds || 0);

            this._pendingResumeSeekTime = savedTime;
            this._pendingResumeDuration = savedDur;
            this._isRestoringSavedSession = true;
            this._showResumeNotificationOnLoad = (saved.notifiedOnRestore !== true);
            this.isPlaying = false;

            this.audio.preload = "metadata";
            this.audio.src = streamUrl;
            this.audio.load();

            this.updateCurrentTrackUI(trk);
            this.renderPlayerTab();
            this.updateDurationUI();
            this.updateProgressUI();
            this.updatePlayStateUI();
            return true;
        } catch (err) {
            console.warn("[PlaybackResume] Erreur lors de la restauration de la session:", err);
            return false;
        }
    },

    hydrateRestoredAllCollection() {
        if (!this._pendingAllCollectionHydration) return;
        if (!this.currentAlbum || this.currentAlbum.path !== "system:all-collection") {
            this._pendingAllCollectionHydration = false;
            return;
        }
        if (!this.allCatalog || !Array.isArray(this.allCatalog.albums) || this.allCatalog.albums.length === 0) {
            return;
        }
        this._pendingAllCollectionHydration = false;

        const tracks = [];
        for (const alb of this.allCatalog.albums) {
            const cover = alb.cover_url || `/api/audio/cover?path=${encodeURIComponent(alb.path)}`;
            const albTitle = alb.title || "";
            const albArtist = alb.artist || "";
            const albPath = alb.path || "";
            for (let idx = 0; idx < (alb.tracks || []).length; idx++) {
                const t = alb.tracks[idx];
                const fp = t.filepath || t.path || "";
                tracks.push({
                    id: `collection-${albPath}-${idx}`,
                    type: "audio",
                    title: t.title || `Piste ${idx + 1}`,
                    artist: t.artist || albArtist,
                    album: t.album || albTitle,
                    album_path: albPath,
                    duration: t.duration || "--:--",
                    duration_seconds: t.duration_seconds || 0,
                    path: fp,
                    filepath: fp,
                    rel_path: fp,
                    stream_url: t.stream_url || `/api/audio/stream-local?path=${encodeURIComponent(fp)}`,
                    cover_url: cover,
                    thumbnail_url: cover,
                    track_number: t.track_number || (idx + 1),
                    format: t.format || "M4A"
                });
            }
        }
        if (tracks.length === 0) return;

        const targetPath = (this._restoredTargetTrackPath || "").replace(/\\/g, "/").toLowerCase();
        const targetId = this._restoredTargetTrackId || "";
        let foundIdx = -1;
        if (targetPath) {
            foundIdx = tracks.findIndex(t => String(t.filepath || t.path || "").replace(/\\/g, "/").toLowerCase() === targetPath);
        }
        if (foundIdx === -1 && targetId) {
            foundIdx = tracks.findIndex(t => t.id === targetId);
        }
        if (foundIdx === -1 && this.currentTrack && this.currentTrack.title) {
            foundIdx = tracks.findIndex(t => t.title === this.currentTrack.title && t.artist === this.currentTrack.artist);
        }
        if (foundIdx === -1) foundIdx = 0;

        this.playlist = tracks;
        this.activePlaylist = tracks.slice();
        this.currentIndex = foundIdx;
        this.currentTrack = tracks[foundIdx];
        if (this.playbackContext) {
            this.playbackContext.playlist = tracks.slice();
            this.playbackContext.currentIndex = foundIdx;
        }
        if (this.currentAlbum) {
            this.currentAlbum.artist = `${this.allCatalog.albums.length} albums • ${tracks.length} pistes`;
        }
        this.renderPlayerTab();
    },

    init() {
        window.AudioPlayer = this;
        this.audio = document.getElementById("global-audio-engine");
        if (!this.audio) {
            this.audio = new Audio();
            this.audio.id = "global-audio-engine";
            document.body.appendChild(this.audio);
        }
        this.audio.crossOrigin = "anonymous";

        // Restauration de l'état mémorisé
        try {
            const savedVol = localStorage.getItem("ytm_player_volume");
            if (savedVol !== null) this.volume = parseFloat(savedVol);
            const savedSrc = localStorage.getItem("ytm_player_source");
            if (savedSrc) this.librarySource = savedSrc;
            const savedSort = localStorage.getItem("ytm_player_sort") || localStorage.getItem("ytm_player_sort_albums");
            if (savedSort) { this.sortMode = savedSort; this.sortModeAlbums = savedSort; }
            const savedSortArt = localStorage.getItem("ytm_player_sort_artists");
            if (savedSortArt) this.sortModeArtists = savedSortArt;
            const savedSortGen = localStorage.getItem("ytm_player_sort_genres");
            if (savedSortGen) this.sortModeGenres = savedSortGen;
            const savedSortAllCat = localStorage.getItem("ytm_player_sort_all_catalog");
            if (savedSortAllCat) this.sortModeAllCatalog = savedSortAllCat;
            const savedSortAllSearch = localStorage.getItem("ytm_player_sort_all_search");
            if (savedSortAllSearch) this.sortModeAllSearch = savedSortAllSearch;
            const savedEnd = localStorage.getItem("ytm_player_end_behavior");
            if (savedEnd) this.endOfAlbumBehavior = savedEnd;
            const savedRepeat = localStorage.getItem("ytm_player_repeat_mode");
            if (savedRepeat && ["none", "all", "one"].includes(savedRepeat)) {
                this.repeatMode = savedRepeat;
            }

            // Restauration de l'égaliseur audio
            const savedEqEnabled = localStorage.getItem("ytm_eq_enabled");
            if (savedEqEnabled !== null) this.eqEnabled = savedEqEnabled === "true";
            const savedEqPreset = localStorage.getItem("ytm_eq_preset");
            if (savedEqPreset && EQ_PRESETS[savedEqPreset]) this.eqCurrentPreset = savedEqPreset;
            const savedCustom = localStorage.getItem("ytm_eq_custom_gains");
            if (savedCustom) {
                const parsed = JSON.parse(savedCustom);
                if (Array.isArray(parsed) && parsed.length === 10) {
                    this.eqCustomGains = parsed.map(v => typeof v === 'number' ? v : 0);
                }
            }

            // Restauration de la correction physiologique (Loudness)
            const savedLoudness = localStorage.getItem("ytm_loudness");
            if (savedLoudness !== null) {
                const val = parseInt(savedLoudness, 10);
                if (!isNaN(val) && val >= 0 && val <= 100) {
                    this.loudnessAmount = val;
                }
            }
        } catch (e) {}
        this.audio.volume = this.volume;

        window.AudioPlayer = this;
        this.bindEvents();
        this.initAudioOutputDevices();
        this.updateSortSelectForView(this.currentView);
        this.updateAllSortSelect(false);
        this.updateVolumeUI();
        this.updateRepeatUI();
        this.updateQueueBadges();
        this.updateEqualizerUI();
        if (window.UserPlaylists) window.UserPlaylists.updateBadge();
        this.restoreSavedPlaybackSession();
        this.onTabActivated();
    },

    bindEvents() {
        const a = this.audio;

        a.addEventListener("play", () => {
            this._radioReconnectAttempts = 0;
            this.setupAudioContext();
            this.isPlaying = true;
            this._hasPlayedInCurrentRun = true;
            this.updatePlayStateUI();
            this.savePlaybackSession(true);
        });

        a.addEventListener("pause", () => {
            this.isPlaying = false;
            this.updatePlayStateUI();
            this.savePlaybackSession(Boolean(this._hasPlayedInCurrentRun));
        });

        a.addEventListener("ended", () => {
            if (this.isRadioPlaying) {
                console.log("[AudioPlayer] Flux radio terminé côté serveur, reprise automatique en direct...");
                if (this.isPlaying) {
                    setTimeout(() => {
                        if (this.isRadioPlaying && this.isPlaying) {
                            this.audio.src = `/api/radio/stream?offset=0&_t=${Date.now()}`;
                            this.audio.load();
                            this.audio.play().catch(e => console.warn("[AudioPlayer] Reprise radio post-ended:", e));
                        }
                    }, 800);
                }
                return;
            }
            if (!this.currentTrackPlayLogged) {
                this.recordCurrentTrackPlay();
            }
            this.handleTrackEnded();
        });

        a.addEventListener("timeupdate", () => {
            if (!this.currentTrackPlayLogged && this.audio && !this.audio.paused && (this.audio.currentTime >= 10 || (this.audio.duration > 0 && this.audio.currentTime / this.audio.duration >= 0.5))) {
                this.recordCurrentTrackPlay();
            }
            if (!this.audio.paused) {
                const nowMs = Date.now();
                if (nowMs - (this._lastSessionSaveMs || 0) >= 2000) {
                    this._lastSessionSaveMs = nowMs;
                    this.savePlaybackSession(true);
                }
            }
            if (this.isSeeking) return;
            this.updateProgressUI();
        });

        a.addEventListener("loadedmetadata", () => {
            const wasRestoring = this._isRestoringSavedSession;
            this._isRestoringSavedSession = false;

            if (this._pendingResumeSeekTime && this._pendingResumeSeekTime > 0) {
                const targetTime = this._pendingResumeSeekTime;
                this._pendingResumeSeekTime = 0;
                try {
                    const maxTime = (a.duration && !isNaN(a.duration) && a.duration > 1) ? Math.max(0, a.duration - 0.5) : targetTime;
                    a.currentTime = Math.min(targetTime, maxTime);
                } catch (e) {}
            }
            this._pendingResumeDuration = 0;
            this.updateDurationUI();
            this.updateProgressUI();

            if (wasRestoring && this._showResumeNotificationOnLoad) {
                this._showResumeNotificationOnLoad = false;
                try {
                    const raw = localStorage.getItem("soundstash_saved_playback_session");
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        if (parsed) {
                            parsed.notifiedOnRestore = true;
                            localStorage.setItem("soundstash_saved_playback_session", JSON.stringify(parsed));
                        }
                    }
                } catch (_) {}

                const curTrk = this.currentTrack || (this.playlist && this.playlist[this.currentIndex]);
                if (curTrk && typeof showToast === "function") {
                    const posSec = a.currentTime || 0;
                    const posStr = posSec > 0 ? ` (${this.formatTime(posSec)})` : "";
                    setTimeout(() => {
                        showToast(
                            `🎧 Reprise prête : « ${curTrk.title} »${posStr} — Appuyez sur Espace ou cliquez sur ▶ pour reprendre votre écoute`,
                            "info",
                            6000
                        );
                    }, 550);
                }
            }
        });

        window.addEventListener("beforeunload", () => {
            this.savePlaybackSession(Boolean(this._hasPlayedInCurrentRun));
        });
        window.addEventListener("pagehide", () => {
            this.savePlaybackSession(Boolean(this._hasPlayedInCurrentRun));
        });

        a.addEventListener("error", (e) => {
            if (!a.getAttribute("src") || !a.src || a.src === window.location.href || a.src.endsWith("/") || a.src === "") {
                return;
            }
            if (this._isRestoringSavedSession) {
                console.warn("[PlaybackResume] Fichier audio de la session précédente introuvable, réinitialisation silencieuse.");
                this.clearSavedPlaybackSession();
                this.stopAndHide();
                return;
            }
            if (window.currentModalVideoItem || window.isVideoPlayingInBackground || document.getElementById("video-modal-backdrop")?.classList.contains("active")) {
                return;
            }
            const errCode = a.error ? a.error.code : "inconnu";
            const errMsg = a.error ? a.error.message : "";
            console.warn(`Erreur lecture audio (Code: ${errCode}, Msg: ${errMsg}, Src: ${a.src}):`, e);
            if (this.isRadioPlaying) {
                this._radioReconnectAttempts = (this._radioReconnectAttempts || 0) + 1;
                if (this._radioReconnectAttempts <= 5) {
                    console.log(`[AudioPlayer] Reprise automatique du flux radio (${this._radioReconnectAttempts}/5)...`);
                    setTimeout(() => {
                        if (this.isRadioPlaying && this.isPlaying) {
                            if (window.RadioManager && this.currentRadio && this._radioReconnectAttempts >= 2) {
                                window.RadioManager.playStation(this.currentRadio);
                            } else {
                                this.audio.src = `/api/radio/stream?offset=0&_t=${Date.now()}`;
                                this.audio.load();
                                this.audio.play().catch(err => console.warn("[AudioPlayer] Reprise échouée:", err));
                            }
                        }
                    }, 1200);
                    return;
                }
                showToast("Flux radio momentanément indisponible ou interrompu.", "warning");
            } else {
                showToast("Impossible de lire ce flux audio (format ou réseau non supporté).", "warning");
            }
            this.isPlaying = false;
            this.updatePlayStateUI();
        });

        // 1. Contrôles Mini-Player Flottant (Persistant global)
        const miniPlayBtn = document.getElementById("mini-player-play-btn");
        const miniPrevBtn = document.getElementById("mini-player-prev-btn");
        const miniNextBtn = document.getElementById("mini-player-next-btn");
        const miniSeekBar = document.getElementById("mini-player-seek-bar");
        const miniVolSlider = document.getElementById("mini-player-volume-slider");
        const miniVolBtn = document.getElementById("mini-player-volume-btn");
        const miniCloseBtn = document.getElementById("mini-player-close-btn");
        const miniOpenTab = document.getElementById("mini-player-open-tab");
        const miniVideoToggleBtn = document.getElementById("mini-player-video-toggle-btn");

        if (miniPlayBtn) {
            miniPlayBtn.addEventListener("click", () => {
                const vPlayer = document.getElementById("video-modal-player");
                if (window.isVideoPlayingInBackground && vPlayer) {
                    const targetVol = (vPlayer.dataset.normalVolume ? parseFloat(vPlayer.dataset.normalVolume) : (vPlayer.volume || 1));
                    if (vPlayer.paused) {
                        AudioFader.fadeIn(vPlayer, targetVol, 500);
                        vPlayer.play().catch(e => console.warn(e));
                    } else {
                        if (AudioFader.enabled) {
                            AudioFader.fadeOut(vPlayer, 400).then(() => {
                                vPlayer.pause();
                                vPlayer.volume = targetVol;
                            });
                        } else {
                            vPlayer.pause();
                        }
                    }
                    return;
                }
                this.togglePlayPause();
            });
        }
        if (miniPrevBtn) {
            miniPrevBtn.addEventListener("click", () => {
                if (this.isRadioPlaying && window.RadioManager) {
                    window.RadioManager.seekRelative(-15);
                    return;
                }
                this.playPrev();
            });
        }
        if (miniNextBtn) {
            miniNextBtn.addEventListener("click", () => {
                if (this.isRadioPlaying && window.RadioManager) {
                    window.RadioManager.seekRelative(+15);
                    return;
                }
                this.playNext();
            });
        }

        const miniShuffleBtn = document.getElementById("mini-player-shuffle-btn");
        const miniRepeatBtn = document.getElementById("mini-player-repeat-btn");

        if (miniShuffleBtn) {
            miniShuffleBtn.addEventListener("click", () => this.toggleShuffle());
        }
        if (miniRepeatBtn) {
            miniRepeatBtn.addEventListener("click", () => this.cycleRepeat());
        }
        if (miniSeekBar) {
            miniSeekBar.addEventListener("mousedown", () => { this.isSeeking = true; });
            miniSeekBar.addEventListener("touchstart", () => { this.isSeeking = true; });
            miniSeekBar.addEventListener("input", () => {
                if (this.isRadioPlaying) {
                    const offset = parseFloat(miniSeekBar.value);
                    const tc = document.getElementById("mini-player-time-current");
                    if (tc) {
                        const s = Math.floor(Math.abs(offset));
                        const mins = Math.floor(s / 60);
                        const secs = s % 60;
                        tc.textContent = (offset >= -2) ? "0:00" : `-${mins}:${secs < 10 ? "0" : ""}${secs}`;
                    }
                    return;
                }
                const vPlayer = document.getElementById("video-modal-player");
                if (window.isVideoPlayingInBackground && vPlayer && vPlayer.duration) {
                    const cur = (miniSeekBar.value / 100) * vPlayer.duration;
                    const tc = document.getElementById("mini-player-time-current");
                    if (tc) tc.textContent = this.formatTime(cur);
                    return;
                }
                if (a.duration) {
                    const cur = (miniSeekBar.value / 100) * a.duration;
                    const tc = document.getElementById("mini-player-time-current");
                    if (tc) tc.textContent = this.formatTime(cur);
                }
            });
            miniSeekBar.addEventListener("change", () => {
                this.isSeeking = false;
                if (this.isRadioPlaying) {
                    if (window.RadioManager) window.RadioManager.seekOffset(parseFloat(miniSeekBar.value));
                    return;
                }
                const vPlayer = document.getElementById("video-modal-player");
                if (window.isVideoPlayingInBackground && vPlayer && vPlayer.duration) {
                    vPlayer.currentTime = (miniSeekBar.value / 100) * vPlayer.duration;
                    return;
                }
                if (a.duration) {
                    a.currentTime = (miniSeekBar.value / 100) * a.duration;
                    this._pendingResumeSeekTime = 0;
                    this._hasPlayedInCurrentRun = true;
                    this.savePlaybackSession(true);
                }
            });
        }

        if (miniVolSlider) {
            miniVolSlider.value = this.volume;
            miniVolSlider.addEventListener("input", () => {
                const val = parseFloat(miniVolSlider.value);
                const vPlayer = document.getElementById("video-modal-player");
                if (window.isVideoPlayingInBackground && vPlayer) {
                    vPlayer.volume = val;
                }
                this.setVolume(val);
            });
        }
        if (miniVolBtn) {
            miniVolBtn.addEventListener("click", () => {
                const vPlayer = document.getElementById("video-modal-player");
                if (window.isVideoPlayingInBackground && vPlayer) {
                    vPlayer.muted = !vPlayer.muted;
                    const vOn = document.getElementById("mini-icon-vol-on");
                    const vOff = document.getElementById("mini-icon-vol-off");
                    if (vOn) vOn.style.display = vPlayer.muted ? "none" : "block";
                    if (vOff) vOff.style.display = vPlayer.muted ? "block" : "none";
                    return;
                }
                this.toggleMute();
            });
        }
        if (miniCloseBtn) {
            miniCloseBtn.addEventListener("click", () => {
                if (window.isVideoPlayingInBackground) {
                    if (window.closeVideoModal) window.closeVideoModal(true);
                    return;
                }
                this.stopAndHide();
            });
        }
        const handleOpenFullPlayer = () => {
            window.goToNowPlaying();
        };
        if (miniOpenTab) miniOpenTab.addEventListener("click", handleOpenFullPlayer);
        if (miniVideoToggleBtn) {
            miniVideoToggleBtn.addEventListener("click", () => {
                if (typeof window.toggleVideoDisplay === "function") {
                    window.toggleVideoDisplay();
                }
            });
        }



        // 3. Sélecteur de Source (Collection vs Dossier Temporaire)
        const srcColBtn = document.getElementById("player-source-col-btn");
        const srcTempBtn = document.getElementById("player-source-temp-btn");
        const srcRefreshBtn = document.getElementById("player-btn-refresh-library");
        if (srcColBtn) srcColBtn.addEventListener("click", () => this.setSource("library"));
        if (srcTempBtn) srcTempBtn.addEventListener("click", () => this.setSource("temp"));
        if (srcRefreshBtn) srcRefreshBtn.addEventListener("click", () => this.refreshLibrary());
        // Suivi continu et indépendant de la position de scroll de l'onglet actif avec protection anti-dépassement
        window.addEventListener("scroll", () => {
            if (this._isRestoringScroll) return;
            this.cancelPendingScrolls();
            const maxAllowed = this.getMaxAllowedScroll();
            const currentY = window.scrollY || document.documentElement.scrollTop || 0;
            if (currentY > maxAllowed + 1) {
                window.scrollTo({ top: maxAllowed, left: 0, behavior: "instant" });
                const cv = this.currentView;
                if (cv && cv !== "now-playing") {
                    if (!this.savedScrollPositions) this.savedScrollPositions = {};
                    if (cv === "albums" && this.isAlbumDetailOpen) {
                        this.savedScrollPositions["album_detail"] = maxAllowed;
                    } else if (cv === "playlists" && window.UserPlaylists && window.UserPlaylists.isDetailOpen) {
                        this.savedScrollPositions["playlist_detail"] = maxAllowed;
                    } else {
                        this.savedScrollPositions[cv] = maxAllowed;
                    }
                }
                return;
            }
            const cv = this.currentView;
            if (cv && cv !== "now-playing") {
                if (!this.savedScrollPositions) this.savedScrollPositions = {};
                if (cv === "albums" && this.isAlbumDetailOpen) {
                    this.savedScrollPositions["album_detail"] = currentY;
                } else if (cv === "playlists" && window.UserPlaylists && window.UserPlaylists.isDetailOpen) {
                    this.savedScrollPositions["playlist_detail"] = currentY;
                } else {
                    this.savedScrollPositions[cv] = currentY;
                }
            }
        }, { passive: true });

        // 4. Sous-Onglets de Vue (Albums, Artistes, Genres, Clips, Concerts, Playlists, Radios, En cours d'écoute)
        document.querySelectorAll(".player-subtab-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                try { btn.blur(); } catch (_) {}
                const v = btn.getAttribute("data-pview");
                if (v === "all" && !this.isCatalogReady) {
                    if (typeof showToast === "function") {
                        showToast("⏳ Préparation du catalogue en cours, disponible dans un instant...", "info");
                    }
                    return;
                }
                if (v === "albums" && this.currentView === "albums" && this.isAlbumDetailOpen) {
                    this.closeAlbumDetail(true);
                    return;
                }
                if (v === "playlists" && this.currentView === "playlists" && window.UserPlaylists && window.UserPlaylists.isDetailOpen) {
                    window.UserPlaylists.closeDetail();
                    return;
                }
                if (v === "now-playing") {
                    if (this.isRadioPlaying && this.currentRadio) {
                        this.setView("now-playing");
                    } else if (typeof window.goToNowPlaying === "function") {
                        window.goToNowPlaying();
                    } else {
                        this.setView("now-playing");
                    }
                    return;
                }
                if (v) this.setView(v);
            });
        });

        // Bouton de retour contextuel unifié et permanent (Détail Album ou Playlist)
        const contextBackBtn = document.getElementById("player-context-back-btn");
        if (contextBackBtn) {
            contextBackBtn.addEventListener("click", () => {
                if (this.currentView === "albums" && this.isAlbumDetailOpen) {
                    this.closeAlbumDetail(true);
                } else if (this.currentView === "playlists" && window.UserPlaylists && window.UserPlaylists.isDetailOpen) {
                    window.UserPlaylists.closeDetail();
                }
            });
        }

        // Bouton de retour depuis la vue "En cours d'écoute"
        const npBackBtn = document.getElementById("player-now-playing-back-btn");
        if (npBackBtn) {
            npBackBtn.addEventListener("click", () => {
                this.returnToPreviousView();
            });
        }

        // Bouton de retour depuis la vue Détail Album intégrée
        const albDetailBackBtn = document.getElementById("player-album-detail-back-btn");
        if (albDetailBackBtn) {
            albDetailBackBtn.addEventListener("click", () => {
                this.closeAlbumDetail(true);
            });
        }

        // Surveillance dynamique de la hauteur du cadre de commandes pour caler les éléments sticky
        const controlsCard = document.getElementById("player-controls-card");
        if (controlsCard && window.ResizeObserver) {
            try {
                const ro = new ResizeObserver(() => {
                    syncPlayerControlsHeight();
                });
                ro.observe(controlsCard);
            } catch (_) {}
        }
        syncPlayerControlsHeight();
        window.addEventListener("resize", () => {
            this.updateScrollBounds();
            if (typeof syncPlayerControlsHeight === "function") syncPlayerControlsHeight();
        });

        // 5. Barre d'outils (Recherche Unifiée Globale, Tri & Filtres)
        const searchInput = document.getElementById("player-search-input");
        const searchClearBtn = document.getElementById("player-search-clear-btn");
        const sortSelect = document.getElementById("player-sort-select");
        const clearFilterBtn = document.getElementById("player-clear-filter-btn");

        if (searchInput) {
            searchInput.addEventListener("input", () => {
                const q = searchInput.value;
                if (searchClearBtn) searchClearBtn.style.display = q ? "block" : "none";
                clearTimeout(this._unifiedSearchDebounceTimer);
                this._unifiedSearchDebounceTimer = setTimeout(() => {
                    this.setGlobalSearch(q, searchInput);
                }, 120);
            });

            // Raccourcis clavier : Échap vide et ferme la recherche
            searchInput.addEventListener("keydown", (e) => {
                if (e.key === "Escape") {
                    e.preventDefault();
                    this.clearGlobalSearch();
                }
            });
        }

        if (searchClearBtn) {
            searchClearBtn.addEventListener("click", () => {
                this.clearGlobalSearch();
            });
        }

        const unifiedSearchContainer = document.getElementById("unified-search-view");
        if (unifiedSearchContainer) {
            this.bindUnifiedSearchEvents(unifiedSearchContainer);
        }

        // Raccourci global clavier : "/" ou Ctrl+F pour focaliser la recherche
        document.addEventListener("keydown", (e) => {
            const isInput = e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable);
            if (!isInput && (e.key === "/" || ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")))) {
                const sInp = document.getElementById("player-search-input");
                if (sInp && sInp.offsetParent !== null) {
                    e.preventDefault();
                    sInp.focus();
                    sInp.select();
                }
            } else if (e.key === "Escape" && this.currentView === "search") {
                this.clearUnifiedSearch(true);
            }
        });
        if (sortSelect) {
            sortSelect.addEventListener("change", () => {
                const val = sortSelect.value;
                if (this.currentView === "all") {
                    const isSearch = Boolean(this.allSearchQuery && this.allSearchQuery.trim());
                    if (isSearch) {
                        this.sortModeAllSearch = val;
                        try { localStorage.setItem("ytm_player_sort_all_search", val); } catch (e) {}
                    } else {
                        this.sortModeAllCatalog = val;
                        try { localStorage.setItem("ytm_player_sort_all_catalog", val); } catch (e) {}
                    }
                    this.renderAllView(true);
                } else if (this.currentView === "artists") {
                    this.sortModeArtists = val;
                    try { localStorage.setItem("ytm_player_sort_artists", val); } catch (e) {}
                    this.renderCurrentView();
                } else if (this.currentView === "genres") {
                    this.sortModeGenres = val;
                    try { localStorage.setItem("ytm_player_sort_genres", val); } catch (e) {}
                    this.renderCurrentView();
                } else {
                    this.sortModeAlbums = val;
                    this.sortMode = val;
                    try {
                        localStorage.setItem("ytm_player_sort_albums", val);
                        localStorage.setItem("ytm_player_sort", val);
                    } catch (e) {}
                    this.renderCurrentView();
                }
            });
        }
        if (clearFilterBtn) {
            clearFilterBtn.addEventListener("click", () => {
                this.selectedArtistFilter = null;
                this.selectedGenreFilter = null;
                this.renderCurrentView();
            });
        }

        const filterBackBtn = document.getElementById("player-filter-back-btn");
        if (filterBackBtn) {
            filterBackBtn.addEventListener("click", () => {
                this.returnFromFilterToOrigin();
            });
        }

        const filterPlayAllBtn = document.getElementById("player-filter-play-all-btn");
        if (filterPlayAllBtn) {
            filterPlayAllBtn.addEventListener("click", () => {
                this.playFilteredCollection({ shuffle: false });
            });
        }

        const filterShuffleBtn = document.getElementById("player-filter-shuffle-btn");
        if (filterShuffleBtn) {
            filterShuffleBtn.addEventListener("click", () => {
                this.playFilteredCollection({ shuffle: true });
            });
        }

        const backToLibBtn = document.getElementById("player-btn-back-to-library");
        if (backToLibBtn) {
            backToLibBtn.addEventListener("click", () => this.setView("albums"));
        }

        const addAlbumToPlaylistBtn = document.getElementById("player-btn-add-album-to-playlist");
        if (addAlbumToPlaylistBtn) {
            addAlbumToPlaylistBtn.addEventListener("click", () => {
                if (!this.currentAlbum || !this.currentAlbum.path) {
                    showToast("Aucun album chargé à ajouter.", "warning");
                    return;
                }
                openAddToPlaylistModal({
                    type: "album",
                    title: this.currentAlbum.title,
                    artist: this.currentAlbum.artist,
                    path: this.currentAlbum.path,
                    tracks_count: this.playlist ? this.playlist.length : 0,
                    cover_url: this.currentAlbum.cover_url
                });
            });
        }

        // Boutons de Téléchargement Direct depuis le Lecteur (Pour écoutes en ligne / temporaires)
        const downloadOnlineBtn = document.getElementById("player-btn-download-online");
        if (downloadOnlineBtn) {
            downloadOnlineBtn.addEventListener("click", () => {
                this.downloadCurrentOnlineItem(downloadOnlineBtn);
            });
        }

        const downloadHeaderBtn = document.getElementById("player-btn-download-album");
        if (downloadHeaderBtn) {
            downloadHeaderBtn.addEventListener("click", () => {
                this.downloadCurrentOnlineItem(downloadHeaderBtn);
            });
        }

        const miniDownloadBtn = document.getElementById("mini-player-download-btn");
        if (miniDownloadBtn) {
            miniDownloadBtn.addEventListener("click", () => {
                this.downloadCurrentOnlineItem(miniDownloadBtn);
            });
        }

        const miniAddPlaylistBtn = document.getElementById("mini-player-add-playlist-btn");
        if (miniAddPlaylistBtn) {
            miniAddPlaylistBtn.addEventListener("click", () => {
                const trk = this.currentTrack || (this.playlist && this.playlist[this.currentIndex]);
                if (!trk) {
                    showToast("Aucun titre en cours de lecture.", "warning");
                    return;
                }
                if (typeof openAddToPlaylistModal === "function") {
                    openAddToPlaylistModal({
                        type: trk.type === "video" ? "video" : "audio",
                        title: trk.title || "Piste",
                        artist: trk.artist || this.currentAlbum?.artist || "Artiste",
                        duration: trk.duration_seconds || trk.duration || 0,
                        path: trk.path || trk.filepath || "",
                        album_title: this.currentAlbum?.title,
                        cover_url: trk.cover_url || this.currentAlbum?.cover_url
                    });
                }
            });
        }

        // 5-ter. Recherche dynamique, tri et synchronisation dans la vue « Clips »
        const vidSearch = document.getElementById("player-videos-search-input");
        const vidSort = document.getElementById("player-videos-sort-select");
        const vidSyncBtn = document.getElementById("player-videos-sync-btn");

        if (vidSearch) {
            vidSearch.addEventListener("input", () => {
                this.videosSearchFilter = vidSearch.value;
                this.renderVideosGrid();
            });
        }
        if (vidSort) {
            vidSort.addEventListener("change", () => {
                this.videosSortMode = vidSort.value;
                this.renderVideosGrid();
            });
        }
        if (vidSyncBtn) {
            vidSyncBtn.addEventListener("click", () => this.syncAndReloadVideos());
        }

        // 5-quater. Recherche dynamique, tri et synchronisation dans la vue « Concerts »
        const concSearch = document.getElementById("player-concerts-search-input");
        const concSort = document.getElementById("player-concerts-sort-select");
        const concSyncBtn = document.getElementById("player-concerts-sync-btn");

        if (concSearch) {
            concSearch.addEventListener("input", () => {
                this.concertsSearchFilter = concSearch.value;
                this.renderConcertsGrid();
            });
        }
        if (concSort) {
            concSort.addEventListener("change", () => {
                this.concertsSortMode = concSort.value;
                this.renderConcertsGrid();
            });
        }
        if (concSyncBtn) {
            concSyncBtn.addEventListener("click", () => this.syncAndReloadVideos());
        }

        // 6. Contrôles Onglet Player (Grand Écran / Vue Focus)
        const playerPlayBtn = document.getElementById("player-btn-play-pause");
        const playerPrevBtn = document.getElementById("player-btn-prev");
        const playerNextBtn = document.getElementById("player-btn-next");
        const playerShuffleBtn = document.getElementById("player-btn-shuffle");
        const playerRepeatBtn = document.getElementById("player-btn-repeat");
        const playerSeekSlider = document.getElementById("player-seek-slider");
        const playerVolSlider = document.getElementById("player-volume-slider");
        const playerMuteBtn = document.getElementById("player-btn-mute");

        if (playerPlayBtn) playerPlayBtn.addEventListener("click", () => this.togglePlayPause());
        if (playerPrevBtn) playerPrevBtn.addEventListener("click", () => this.playPrev());
        if (playerNextBtn) playerNextBtn.addEventListener("click", () => this.playNext());
        if (playerShuffleBtn) playerShuffleBtn.addEventListener("click", () => this.toggleShuffle());
        if (playerRepeatBtn) playerRepeatBtn.addEventListener("click", () => this.cycleRepeat());

        const playerCoverWatchBtn = document.getElementById("player-cover-watch-btn");
        if (playerCoverWatchBtn) {
            playerCoverWatchBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (window.isVideoPlayingInBackground && window.reopenVideoModal) {
                    window.reopenVideoModal();
                    return;
                }
                this.playTrackAtIndex(this.currentIndex >= 0 ? this.currentIndex : 0);
            });
        }
        const playerCoverBox = document.getElementById("player-cover-box");
        if (playerCoverBox) {
            playerCoverBox.addEventListener("click", (e) => {
                if (e.target.closest("button")) return;
                const cur = (this.playlist && this.currentIndex >= 0) ? this.playlist[this.currentIndex] : (this.playlist ? this.playlist[0] : null);
                if (cur && (cur.is_video || cur.type === "video" || (this.currentAlbum && this.currentAlbum.is_video))) {
                    if (window.isVideoPlayingInBackground && window.reopenVideoModal) {
                        window.reopenVideoModal();
                        return;
                    }
                    this.playTrackAtIndex(this.currentIndex >= 0 ? this.currentIndex : 0);
                }
            });
        }

        const btnNpPlayAll = document.getElementById("player-now-playing-btn-play-all");
        if (btnNpPlayAll) {
            btnNpPlayAll.addEventListener("click", () => {
                if (this.playlist && this.playlist.length > 0) {
                    this.playTrackAtIndex(0);
                }
            });
        }
        const btnNpNextAll = document.getElementById("player-now-playing-btn-next-all");
        if (btnNpNextAll) {
            btnNpNextAll.addEventListener("click", () => {
                if (this.currentAlbum && this.currentAlbum.path) {
                    this.enqueueAlbum(this.currentAlbum.path, true);
                }
            });
        }
        const btnNpQueueAll = document.getElementById("player-now-playing-btn-queue-all");
        if (btnNpQueueAll) {
            btnNpQueueAll.addEventListener("click", () => {
                if (this.currentAlbum && this.currentAlbum.path) {
                    this.enqueueAlbum(this.currentAlbum.path, false);
                }
            });
        }

        if (playerSeekSlider) {
            playerSeekSlider.addEventListener("mousedown", () => { this.isSeeking = true; });
            playerSeekSlider.addEventListener("touchstart", () => { this.isSeeking = true; });
            playerSeekSlider.addEventListener("input", () => {
                if (this.isRadioPlaying) {
                    const offset = parseFloat(playerSeekSlider.value);
                    const tc = document.getElementById("player-time-current");
                    if (tc) {
                        const s = Math.floor(Math.abs(offset));
                        const mins = Math.floor(s / 60);
                        const secs = s % 60;
                        tc.textContent = (offset >= -2) ? "0:00" : `-${mins}:${secs < 10 ? "0" : ""}${secs}`;
                    }
                    return;
                }
                if (a.duration) {
                    const cur = (playerSeekSlider.value / 100) * a.duration;
                    const tc = document.getElementById("player-time-current");
                    if (tc) tc.textContent = this.formatTime(cur);
                }
            });
            playerSeekSlider.addEventListener("change", () => {
                this.isSeeking = false;
                if (this.isRadioPlaying) {
                    if (window.RadioManager) window.RadioManager.seekOffset(parseFloat(playerSeekSlider.value));
                    return;
                }
                if (a.duration) {
                    a.currentTime = (playerSeekSlider.value / 100) * a.duration;
                    this._pendingResumeSeekTime = 0;
                    this._hasPlayedInCurrentRun = true;
                    this.savePlaybackSession(true);
                }
            });
        }

        if (playerVolSlider) {
            playerVolSlider.value = this.volume;
            playerVolSlider.addEventListener("input", () => {
                this.setVolume(parseFloat(playerVolSlider.value));
            });
        }
        if (playerMuteBtn) playerMuteBtn.addEventListener("click", () => this.toggleMute());

        // 5. Intégration MediaSession API (Contrôles Windows 10/11 & Touches Clavier / Casque)
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => this.play());
            navigator.mediaSession.setActionHandler('pause', () => this.pause());
            navigator.mediaSession.setActionHandler('previoustrack', () => {
                if (this.isRadioPlaying && window.RadioManager && typeof window.RadioManager.seekOffset === "function") {
                    window.RadioManager.seekOffset(-15);
                } else {
                    this.playPrev();
                }
            });
            navigator.mediaSession.setActionHandler('nexttrack', () => {
                if (this.isRadioPlaying && window.RadioManager && typeof window.RadioManager.jumpToLive === "function") {
                    window.RadioManager.jumpToLive();
                } else {
                    this.playNext();
                }
            });
            try {
                navigator.mediaSession.setActionHandler('seekbackward', (details) => {
                    const offset = -(details.seekOffset || 15);
                    if (this.isRadioPlaying && window.RadioManager) window.RadioManager.seekOffset(offset);
                    else if (this.audio) this.audio.currentTime = Math.max(0, this.audio.currentTime + offset);
                });
                navigator.mediaSession.setActionHandler('seekforward', (details) => {
                    const offset = (details.seekOffset || 15);
                    if (this.isRadioPlaying && window.RadioManager) window.RadioManager.seekOffset(offset);
                    else if (this.audio) this.audio.currentTime = Math.min(this.audio.duration || 0, this.audio.currentTime + offset);
                });
                navigator.mediaSession.setActionHandler('seekto', (details) => {
                    if (details.seekTime !== undefined && this.audio && this.audio.duration) {
                        this.audio.currentTime = details.seekTime;
                    }
                });
            } catch (e) {}
        }

        // 6. Écouteur des contrôles système Electron (Boutons miniature barre des tâches & Tray)
        if (window.electronAPI && window.electronAPI.onMediaAction) {
            window.electronAPI.onMediaAction((action) => {
                if (this.eqAudioCtx && this.eqAudioCtx.state === "suspended") {
                    this.eqAudioCtx.resume().catch(() => {});
                }
                if (action === 'play-pause') {
                    this.togglePlayPause();
                } else if (action === 'radio-rewind') {
                    if (window.RadioManager && typeof window.RadioManager.seekOffset === "function") {
                        window.RadioManager.seekOffset(-15);
                    }
                } else if (action === 'radio-live') {
                    if (window.RadioManager && typeof window.RadioManager.jumpToLive === "function") {
                        window.RadioManager.jumpToLive();
                    }
                } else if (action === 'next') {
                    if (this.isRadioPlaying) {
                        if (window.RadioManager && typeof window.RadioManager.jumpToLive === "function") {
                            window.RadioManager.jumpToLive();
                        }
                    } else {
                        this.playNext();
                    }
                } else if (action === 'prev') {
                    if (this.isRadioPlaying) {
                        if (window.RadioManager && typeof window.RadioManager.seekOffset === "function") {
                            window.RadioManager.seekOffset(-15);
                        }
                    } else {
                        this.playPrev();
                    }
                }
            });
        }

        // 7. Contrôles de la File d'Attente (Queue Drawer)
        const btnBarQueue = document.getElementById("mini-player-queue-btn");
        const btnMainQueue = document.getElementById("player-btn-view-queue");
        const btnCloseQueue = document.getElementById("queue-drawer-close-btn");
        const backdropQueue = document.getElementById("player-queue-drawer-backdrop");
        const btnClearQueue = document.getElementById("queue-clear-btn");
        const selectEndBehavior = document.getElementById("queue-end-behavior-select");

        if (btnBarQueue) btnBarQueue.addEventListener("click", () => this.toggleQueueDrawer());
        if (btnMainQueue) btnMainQueue.addEventListener("click", () => this.toggleQueueDrawer());
        if (btnCloseQueue) btnCloseQueue.addEventListener("click", () => this.closeQueueDrawer());
        if (backdropQueue) backdropQueue.addEventListener("click", () => this.closeQueueDrawer());
        if (btnClearQueue) btnClearQueue.addEventListener("click", () => this.clearQueue());

        if (selectEndBehavior) {
            selectEndBehavior.value = this.endOfAlbumBehavior;
            selectEndBehavior.addEventListener("change", () => {
                this.endOfAlbumBehavior = selectEndBehavior.value;
                try {
                    localStorage.setItem("ytm_player_end_behavior", this.endOfAlbumBehavior);
                } catch (e) {}
                const label = selectEndBehavior.options[selectEndBehavior.selectedIndex] ? selectEndBehavior.options[selectEndBehavior.selectedIndex].text : selectEndBehavior.value;
                showToast(`Action en fin d'album : ${label}`, "info");
            });
        }

        // 8. Contrôles de l'Égaliseur Audio (10 Bandes & Presets)
        const btnBarEq = document.getElementById("mini-player-eq-btn");
        const btnFocusEq = document.getElementById("player-now-playing-eq-btn");
        const btnCloseEq = document.getElementById("eq-modal-close-btn");
        const btnDoneEq = document.getElementById("eq-btn-done");
        const backdropEq = document.getElementById("player-equalizer-modal");
        const togglePowerEq = document.getElementById("eq-power-toggle");
        const btnResetFlatEq = document.getElementById("eq-btn-reset-flat");
        const presetsListEq = document.getElementById("eq-presets-list");

        if (btnBarEq) btnBarEq.addEventListener("click", () => this.toggleEqualizerModal());
        if (btnFocusEq) btnFocusEq.addEventListener("click", () => this.openEqualizerModal());
        if (btnCloseEq) btnCloseEq.addEventListener("click", () => this.closeEqualizerModal());
        if (btnDoneEq) btnDoneEq.addEventListener("click", () => this.closeEqualizerModal());
        if (backdropEq) {
            backdropEq.addEventListener("click", (e) => {
                if (e.target === backdropEq) this.closeEqualizerModal();
            });
        }
        if (togglePowerEq) {
            togglePowerEq.addEventListener("change", () => this.toggleEqualizerPower());
        }
        if (btnResetFlatEq) {
            btnResetFlatEq.addEventListener("click", () => this.resetEqualizerCustom());
        }
        if (presetsListEq) {
            presetsListEq.addEventListener("click", (e) => {
                const btn = e.target.closest(".eq-preset-btn");
                if (btn) {
                    const preset = btn.getAttribute("data-preset");
                    if (preset) this.setEqualizerPreset(preset);
                }
            });
        }

        // Branchement des 10 faders de fréquences
        for (let i = 0; i < 10; i++) {
            const slider = document.getElementById(`eq-slider-${i}`);
            if (slider) {
                slider.addEventListener("input", () => {
                    this.onFaderInput(i, slider.value);
                });
            }
        }

        // Branchement du curseur de correction physiologique (Loudness)
        const loudnessSlider = document.getElementById("eq-loudness-slider");
        const loudnessResetBtn = document.getElementById("eq-loudness-btn-reset");
        if (loudnessSlider) {
            loudnessSlider.addEventListener("input", () => {
                this.setLoudness(loudnessSlider.value, false);
            });
        }
        if (loudnessResetBtn) {
            loudnessResetBtn.addEventListener("click", () => {
                this.setLoudness(0, true);
            });
        }

        // Configuration de la densité d'affichage de la vue Artistes (3 ou 4 colonnes)
        this.setupArtistsDensity();

        // Démarrage systématique sur l'onglet Albums et état de préparation du catalogue Tout
        this.savedScrollPositions = {
            "albums": 0, "all": 0, "artists": 0, "genres": 0,
            "videos": 0, "concerts": 0, "playlists": 0, "search": 0
        };
        this._visitedTabs = new Set(["albums"]);
        this.currentView = "albums";
        this.setView("albums");
        this.setAllCatalogPreparingState(true);

        // Déclencher le préchargement en arrière-plan dès le boot de l'application
        setTimeout(() => {
            if (!this.isCatalogReady && !this.isLoadingCatalog) {
                this.prefetchAllCatalog();
            }
        }, 200);
    },

    setupArtistsDensity() {
        const btn4 = document.getElementById("btn-density-4");
        const btn3 = document.getElementById("btn-density-3");
        let savedCols = "4";
        try {
            savedCols = localStorage.getItem("ytm_artists_cols") || "4";
        } catch (_) {}

        const applyDensity = (cols) => {
            const grid = document.getElementById("player-artists-grid");
            const genresGrid = document.getElementById("player-genres-grid");
            if (grid) {
                if (cols === "3") {
                    grid.classList.add("cols-3");
                } else {
                    grid.classList.remove("cols-3");
                }
            }
            if (genresGrid) {
                if (cols === "3") {
                    genresGrid.classList.add("cols-3");
                } else {
                    genresGrid.classList.remove("cols-3");
                }
            }
            if (btn4) btn4.classList.toggle("active", cols === "4");
            if (btn3) btn3.classList.toggle("active", cols === "3");
            try {
                localStorage.setItem("ytm_artists_cols", cols);
            } catch (_) {}
        };

        applyDensity(savedCols);

        if (btn4) {
            btn4.addEventListener("click", () => applyDensity("4"));
        }
        if (btn3) {
            btn3.addEventListener("click", () => applyDensity("3"));
        }
        this.updateFloatingBarVisibility();
    },

    onTabActivated() {
        if (!this.hasLoadedOnce) {
            this.currentView = "albums";
            this.setView("albums");
            this.loadLibraryData();
        } else {
            this.renderCurrentView();
        }
        this.updateMiniDockVisibility();
    },

    setSource(source) {
        if (window.isPartyLockActive && source === "temp") {
            if (typeof showToast === "function") {
                showToast("🔒 Accès restreint : Seule 'Ma Collection' est accessible en Mode Soirée.", "info");
            }
            return;
        }
        if (source === "library" && !this.libraryConfigured) {
            showToast("Veuillez d'abord configurer votre dossier de collection musicale dans les Paramètres.", "warning");
            return;
        }
        if (this.librarySource === source && this.hasLoadedOnce) return;
        this.librarySource = source;
        this.allCatalog = null;
        this.isCatalogReady = false;
        this.setAllCatalogPreparingState(true);
        try {
            localStorage.setItem("ytm_player_source", source);
        } catch (e) {}
        this.selectedArtistFilter = null;
        this.selectedGenreFilter = null;
        this.setView("albums");
        this.updateSourceButtonsUI();
        this.loadLibraryData();
    },

    updateSourceButtonsUI() {
        const colBtn = document.getElementById("player-source-col-btn");
        const tempBtn = document.getElementById("player-source-temp-btn");
        if (colBtn) colBtn.classList.toggle("active", this.librarySource === "library");
        if (tempBtn) tempBtn.classList.toggle("active", this.librarySource === "temp");
    },

    resetPlayerScroll() {
        try {
            window.scrollTo({ top: 0, left: 0, behavior: "instant" });
        } catch (_) {
            try { window.scrollTo(0, 0); } catch (_) {}
        }
        if (document.documentElement) {
            document.documentElement.scrollTop = 0;
            document.documentElement.scrollLeft = 0;
        }
        if (document.body) {
            document.body.scrollTop = 0;
            document.body.scrollLeft = 0;
        }

        const ids = [
            "tab-player",
            "player-view-now-playing",
            "player-main-layout",
            "player-tracklist-container",
            "player-albums-grid",
            "player-all-container",
            "player-view-all"
        ];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                try {
                    el.scrollTop = 0;
                    el.scrollLeft = 0;
                } catch (_) {}
            }
        });

        const selectors = [
            ".player-tracklist-wrapper",
            ".all-album-tracks",
            ".player-tracklist-col",
            ".player-tracklist-list",
            ".app-content",
            ".app-container",
            "main"
        ];
        selectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                try {
                    el.scrollTop = 0;
                    el.scrollLeft = 0;
                } catch (_) {}
            });
        });
    },

    cancelPendingScrolls() {
        if (this._scrollRafId) {
            cancelAnimationFrame(this._scrollRafId);
            this._scrollRafId = null;
        }
        if (this._scrollTimeoutId) {
            clearTimeout(this._scrollTimeoutId);
            this._scrollTimeoutId = null;
        }
        if (this._restoreScrollTimer1) {
            clearTimeout(this._restoreScrollTimer1);
            this._restoreScrollTimer1 = null;
        }
        if (this._restoreScrollTimer2) {
            clearTimeout(this._restoreScrollTimer2);
            this._restoreScrollTimer2 = null;
        }
        if (this._restoreScrollTimer3) {
            clearTimeout(this._restoreScrollTimer3);
            this._restoreScrollTimer3 = null;
        }
    },

    resetPlayerScrollRobust() {
        this.cancelPendingScrolls();
        this.resetPlayerScroll();
        if (typeof requestAnimationFrame === "function") {
            this._scrollRafId = requestAnimationFrame(() => {
                this.resetPlayerScroll();
                this._scrollRafId = null;
            });
        }
    },

    getHeaderCollapseOffset() {
        return 0;
    },

    getMaxAllowedScroll() {
        const controlsCard = document.getElementById("player-controls-card");
        const contentCard = document.getElementById("player-content-card");
        if (!controlsCard || !contentCard) return 0;

        const controlsHeight = Math.round(controlsCard.getBoundingClientRect().height || controlsCard.offsetHeight || 140);
        const viewportHeight = window.innerHeight || 800;
        const controlsMargin = 16;

        // Prise en compte dynamique de la barre persistante du bas (centre de commande)
        const persistentBar = document.getElementById("persistent-player-bar");
        const isBarVisible = Boolean(
            persistentBar &&
            persistentBar.style.display !== "none" &&
            !persistentBar.classList.contains("hidden") &&
            (persistentBar.offsetHeight || 0) > 0
        );
        const bottomDockHeight = isBarVisible ? Math.round(persistentBar.offsetHeight + 16) : 0;

        // Espace libre visible sous le bandeau de commandes et au-dessus de la barre persistante
        const availableBelowControls = Math.max(0, viewportHeight - controlsHeight - controlsMargin - bottomDockHeight);

        const activePane = contentCard.querySelector(".player-view-pane:not([style*='display: none'])") || contentCard;
        const panePaddingBottom = activePane ? (parseFloat(getComputedStyle(activePane).paddingBottom) || 0) : 0;
        const naturalContentHeight = Math.max(0, (activePane ? activePane.scrollHeight : contentCard.scrollHeight) - panePaddingBottom);

        // Si le contenu réel tient entièrement dans l'espace disponible sous le bandeau :
        // Aucun défilement n'est nécessaire ni autorisé !
        if (naturalContentHeight <= availableBelowControls) {
            return 0;
        }

        // Si le contenu dépasse la hauteur visible, le scroll maximal permet d'atteindre
        // le fond physique complet du document afin que tous les éléments (dernières pistes, jaquettes)
        // soient 100% dégagés et visibles au-dessus du centre de commande du bas
        const docScrollHeight = Math.max(
            document.documentElement ? document.documentElement.scrollHeight : 0,
            document.body ? document.body.scrollHeight : 0
        );
        const docMaxScroll = Math.max(0, docScrollHeight - viewportHeight);

        return docMaxScroll;
    },

    updateScrollBounds() {
        const controlsCard = document.getElementById("player-controls-card");
        const contentCard = document.getElementById("player-content-card");
        if (!controlsCard || !contentCard) return;

        contentCard.style.minHeight = "auto";
        const activePane = contentCard.querySelector(".player-view-pane:not([style*='display: none'])");
        if (activePane) {
            activePane.style.minHeight = "auto";
        }

        // Si la position de défilement actuelle dépasse la limite autorisée pour la vue, recaler immédiatement
        const maxAllowed = this.getMaxAllowedScroll();
        const currentY = window.scrollY || document.documentElement.scrollTop || 0;
        if (currentY > maxAllowed) {
            try {
                window.scrollTo({ top: maxAllowed, left: 0, behavior: "instant" });
            } catch (_) {}
            const cv = this.currentView;
            if (cv && cv !== "now-playing") {
                if (!this.savedScrollPositions) this.savedScrollPositions = {};
                if (cv === "albums" && this.isAlbumDetailOpen) {
                    this.savedScrollPositions["album_detail"] = maxAllowed;
                } else if (cv === "playlists" && window.UserPlaylists && window.UserPlaylists.isDetailOpen) {
                    this.savedScrollPositions["playlist_detail"] = maxAllowed;
                } else {
                    this.savedScrollPositions[cv] = maxAllowed;
                }
            }
        }
    },

    restoreScrollPosition(targetY) {
        if (typeof targetY !== "number" || isNaN(targetY) || targetY < 0) targetY = 0;
        this.updateScrollBounds();
        this.cancelPendingScrolls();
        this._isRestoringScroll = true;

        const requestedY = targetY;

        const doScroll = () => {
            const currentMax = this.getMaxAllowedScroll();
            const effectiveY = Math.min(requestedY, currentMax);
            try {
                window.scrollTo({ top: effectiveY, left: 0, behavior: "instant" });
            } catch (_) {
                try { window.scrollTo(0, effectiveY); } catch (_) {}
            }
            if (document.documentElement) document.documentElement.scrollTop = effectiveY;
            if (document.body) document.body.scrollTop = effectiveY;
        };

        doScroll();
        if (typeof requestAnimationFrame === "function") {
            this._scrollRafId = requestAnimationFrame(() => {
                doScroll();
                this._scrollRafId = null;
            });
        }
        this._restoreScrollTimer1 = setTimeout(() => { doScroll(); this._restoreScrollTimer1 = null; }, 30);
        this._restoreScrollTimer2 = setTimeout(() => { doScroll(); this._restoreScrollTimer2 = null; }, 90);
        this._restoreScrollTimer3 = setTimeout(() => {
            doScroll();
            this._restoreScrollTimer3 = null;
            this._isRestoringScroll = false;
        }, 200);
    },

    setView(view) {
        if (document.activeElement && typeof document.activeElement.blur === "function" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
            try { document.activeElement.blur(); } catch (_) {}
        }
        if (view === "all" && !this.isCatalogReady) {
            if (typeof showToast === "function") {
                showToast("⏳ Préparation du catalogue en cours, disponible dans un instant...", "info");
            }
            view = "albums";
        }

        if (view === this.currentView && !this.isAlbumDetailOpen) {
            return;
        }

        if (view === "now-playing" && window.isVideoPlayingInBackground && window.reopenVideoModal) {
            window.reopenVideoModal();
        }

        const prevV = this.currentView;
        const currentY = window.scrollY || document.documentElement.scrollTop || 0;

        // Mémoriser la position de défilement de la vue qu'on quitte si ce n'est pas "now-playing"
        if (prevV && prevV !== "now-playing") {
            if (!this.savedScrollPositions) this.savedScrollPositions = {};
            if (prevV === "albums" && this.isAlbumDetailOpen) {
                this.savedScrollPositions["album_detail"] = currentY;
            } else if (prevV === "playlists" && window.UserPlaylists && window.UserPlaylists.isDetailOpen) {
                this.savedScrollPositions["playlist_detail"] = currentY;
            } else {
                this.savedScrollPositions[prevV] = currentY;
            }
        }

        // Mémoriser la vue précédente lors de la transition vers "now-playing"
        if (prevV && prevV !== "now-playing" && view === "now-playing") {
            this.previousView = prevV;
        } else if (view !== "now-playing") {
            this.previousModeWasWorkshop = false;
        }

        if (prevV === "albums" && view !== "albums" && view !== "now-playing" && this.isAlbumDetailOpen) {
            this.closeAlbumDetail(false);
        }
        if (prevV === "albums" && view !== "albums" && view !== "now-playing") {
            this.selectedArtistFilter = null;
            this.selectedGenreFilter = null;
        }
        if (prevV === "playlists" && view !== "playlists" && view !== "now-playing" && window.UserPlaylists && window.UserPlaylists.isDetailOpen) {
            window.UserPlaylists.closeDetail();
        }

        // Gestion du scroll indépendant par onglet et initialisation au démarrage
        if (!this._visitedTabs) {
            this._visitedTabs = new Set();
            if (prevV) this._visitedTabs.add(prevV);
        }

        let targetY = 0;
        if (view !== "now-playing") {
            const isFirstVisit = !this._visitedTabs.has(view);
            this._visitedTabs.add(view);

            if (isFirstVisit) {
                targetY = 0;
                if (!this.savedScrollPositions) this.savedScrollPositions = {};
                this.savedScrollPositions[view] = targetY;
            } else {
                targetY = (this.savedScrollPositions && typeof this.savedScrollPositions[view] === "number")
                    ? this.savedScrollPositions[view]
                    : 0;
            }
        }

        this.currentView = view;

        // Mettre à jour les sous-onglets
        document.querySelectorAll(".player-subtab-btn").forEach(btn => {
            btn.classList.toggle("active", btn.getAttribute("data-pview") === view);
        });

        // Afficher/Masquer les panneaux
        const panes = {
            "search": document.getElementById("player-view-search"),
            "albums": document.getElementById("player-view-albums"),
            "all": document.getElementById("player-view-all"),
            "artists": document.getElementById("player-view-artists"),
            "genres": document.getElementById("player-view-genres"),
            "videos": document.getElementById("player-view-videos"),
            "concerts": document.getElementById("player-view-concerts"),
            "playlists": document.getElementById("player-view-playlists"),
            "radios": document.getElementById("player-view-radios"),
            "now-playing": document.getElementById("player-view-now-playing")
        };

        Object.keys(panes).forEach(k => {
            if (panes[k]) {
                panes[k].style.display = (k === view) ? "block" : "none";
            }
        });

        // La barre de recherche/outils reste accessible sur tous les onglets de navigation (masquée uniquement en Grand Écran ou Détail d'album)
        const toolbar = document.getElementById("player-toolbar-row");
        if (toolbar) {
            const shouldHideToolbar = (
                view === "now-playing" ||
                view === "radios" ||
                (view === "albums" && this.isAlbumDetailOpen)
            );
            toolbar.style.display = shouldHideToolbar ? "none" : "flex";
        }
        this.updateDetailContextBar();
        if (typeof syncPlayerControlsHeight === "function") syncPlayerControlsHeight();

        // Mettre à jour la barre de retour depuis "En cours d'écoute"
        this.updateNowPlayingBackLabel();

        // Synchroniser le champ de recherche globale et son bouton d'effacement
        const searchInput = document.getElementById("player-search-input");
        const searchClearBtn = document.getElementById("player-search-clear-btn");
        const radiosSearchInput = document.getElementById("radios-search-input");
        const radiosClearBtn = document.getElementById("radios-search-clear-btn");

        const q = this.globalSearchQuery || "";
        if (searchInput && document.activeElement !== searchInput) {
            searchInput.value = q;
            if (searchClearBtn) searchClearBtn.style.display = q ? "block" : "none";
        }
        if (radiosSearchInput && document.activeElement !== radiosSearchInput) {
            radiosSearchInput.value = q;
            if (radiosClearBtn) radiosClearBtn.style.display = q ? "flex" : "none";
        }

        // Répercuter la recherche active sur les filtres de la vue courante
        this.searchFilter = q;
        this.videosSearchFilter = q;
        this.concertsSearchFilter = q;
        this.allSearchQuery = q;
        if (window.UserPlaylists) window.UserPlaylists.searchFilter = q;
        if (view === "radios" && window.RadioManager) {
            window.RadioManager.state.searchQuery = q;
            window.RadioManager.handleSearch(q);
        }

        // Maintenir les pastilles de résultat à jour sur chaque sous-onglet
        this.updateSearchTabBadges(q);

        this.updateSortSelectForView(view);

        this.updateMiniDockVisibility();
        this.updateFloatingBarVisibility();
        this.renderCurrentView();

        if (view === "now-playing") {
            this.resetPlayerScrollRobust();
            this.updateNowPlayingBackLabel();
            // Scroll précis vers la piste active dès l'ouverture de la vue
            setTimeout(() => {
                this.scrollToActiveTrack(true);
            }, 180);
        } else {
            this.restoreScrollPosition(targetY);
        }
    },

    /**
     * Fait défiler la page pour placer la piste active dans le champ visible utile,
     * en respectant impérativement les zones de sécurité :
     * - Ne passe JAMAIS sous le header sticky supérieur
     * - Ne passe JAMAIS sous le mini-lecteur flottant inférieur
     * - N'effectue aucun scroll superflu si le morceau est déjà confortablement visible
     */
    scrollToActiveTrack(force = false) {
        if (!force && this._lastScrolledTrackIndex === this.currentIndex) {
            return;
        }
        this._lastScrolledTrackIndex = this.currentIndex;
        this.cancelPendingScrolls();

        this._scrollRafId = requestAnimationFrame(() => {
            this._scrollRafId = null;

            let activeItem = null;
            if (this.currentView === "playlists") {
                activeItem = document.querySelector("#playlist-tracks-body tr.active-track-row");
            } else if (this.currentView === "albums") {
                if (this.isAlbumDetailOpen) {
                    activeItem = document.querySelector("#player-album-detail-block .player-track-item.active");
                }
            } else if (this.currentView === "all") {
                if (typeof this.updateActiveTrackInAllContainer === "function") {
                    this.updateActiveTrackInAllContainer();
                }
                activeItem = document.querySelector("#player-view-all .player-track-item.active, #player-view-all .dense-track-row.active");
            } else if (this.currentView === "now-playing") {
                activeItem = document.querySelector("#player-tracklist-container .player-track-item.active");
            }

            // Fallback si rien trouvé dans la vue spécifique
            if (!activeItem) {
                const candidates = document.querySelectorAll(
                    "#player-view-all .player-track-item.active, " +
                    "#player-view-all .dense-track-row.active, " +
                    "#playlist-tracks-body tr.active-track-row, " +
                    "#player-album-detail-block .player-track-item.active, " +
                    "#player-tracklist-container .player-track-item.active, " +
                    ".dense-track-row.active"
                );
                for (const cand of candidates) {
                    const r = cand.getBoundingClientRect();
                    if (r.height > 0 && r.width > 0 && cand.offsetParent !== null) {
                        activeItem = cand;
                        break;
                    }
                }
            }

            if (!activeItem) return;

            const rect = activeItem.getBoundingClientRect();
            // CRITIQUE : Si l'élément est dans un conteneur masqué ou n'a aucune dimension, NE JAMAIS scroller !
            if (rect.height <= 0 || rect.width <= 0) return;

            // 1. En-tête supérieur sticky (#player-controls-card)
            const headerCard = document.getElementById("player-controls-card");
            const headerHeight = headerCard ? (headerCard.offsetHeight || headerCard.getBoundingClientRect().height) : 150;
            // Quand le document scrolle, headerCard colle au top (top: 0), son bas est donc à headerHeight du viewport
            const effectiveHeaderBottom = Math.max(headerHeight, 130);

            // 2. Centre de commandes inférieur fixe (#persistent-player-bar)
            const bottomBar = document.getElementById("persistent-player-bar");
            const isBottomBarVisible = Boolean(
                bottomBar &&
                bottomBar.style.display !== "none" &&
                (bottomBar.offsetHeight > 0 || (this.playlist && this.playlist.length > 0))
            );
            const effectiveBottomTop = (isBottomBarVisible && bottomBar && bottomBar.getBoundingClientRect().top > 0)
                ? bottomBar.getBoundingClientRect().top
                : (window.innerHeight - (isBottomBarVisible ? 90 : 20));

            // Marges de confort indispensables (tampon anti-collision avec l'en-tête et le centre de commandes)
            const safeMarginTop = 15;
            const safeMarginBottom = 20;
            const safetyTop = effectiveHeaderBottom + safeMarginTop;
            const safetyBottom = effectiveBottomTop - safeMarginBottom;

            // RÈGLE D'OR : Si le morceau est déjà confortablement visible dans la zone sécurisée,
            // NE PAS BOUGER L'ÉCRAN ! Cela élimine tout sautillement / scintillement de la vue.
            if (rect.top >= safetyTop && rect.bottom <= safetyBottom) {
                return;
            }

            const currentScrollY = window.scrollY || document.documentElement.scrollTop || 0;
            const maxAllowed = typeof this.getMaxAllowedScroll === "function" ? this.getMaxAllowedScroll() : 0;

            // Si tout le contenu tient déjà à l'écran sans ascenseur et qu'on est au sommet : ne jamais scroller
            if (maxAllowed <= 0 && currentScrollY <= 0) {
                return;
            }

            let targetScrollY = currentScrollY;

            // Uniquement en vue "Tout" (liste infinie d'albums multiples) : on cherche à aligner l'en-tête du bloc album
            const parentBlock = (this.currentView === "all")
                ? activeItem.closest(".player-all-album-block")
                : null;

            if (parentBlock && parentBlock !== activeItem) {
                // Aligner le haut du bloc album juste sous le cadre supérieur avec une marge aérée de 8px
                const blockRect = parentBlock.getBoundingClientRect();
                const idealBlockTopScrollY = Math.max(0, Math.round(currentScrollY + blockRect.top - effectiveHeaderBottom - 8));

                // Vérifier si avec cette position au sommet de l'album, la piste active reste visible dans la zone de lecture
                const projectedTrackTop = rect.top - (idealBlockTopScrollY - currentScrollY);
                const projectedTrackBottom = rect.bottom - (idealBlockTopScrollY - currentScrollY);

                if (projectedTrackTop >= safetyTop && projectedTrackBottom <= safetyBottom) {
                    targetScrollY = idealBlockTopScrollY;
                } else if (projectedTrackBottom > safetyBottom) {
                    // Piste plus bas dans la liste d'un très long album : faire défiler juste assez depuis le sommet de l'album pour ramener la piste dans la vue
                    targetScrollY = Math.max(0, idealBlockTopScrollY + Math.round(projectedTrackBottom - safetyBottom));
                } else if (projectedTrackTop < safetyTop) {
                    // Piste au-dessus de la vue : faire défiler pour la ramener en dessous de l'en-tête
                    targetScrollY = Math.max(0, idealBlockTopScrollY - Math.round(safetyTop - projectedTrackTop));
                } else {
                    targetScrollY = idealBlockTopScrollY;
                }
            } else {
                // Pour les vues avec un seul album (Détail Album, En écoute, Playlists) :
                // Défilement minimaliste ciblé : ramener la piste dans la zone utile sans décaler inutilement l'en-tête
                if (rect.bottom > safetyBottom) {
                    targetScrollY = Math.max(0, currentScrollY + Math.round(rect.bottom - safetyBottom + 12));
                } else if (rect.top < safetyTop) {
                    targetScrollY = Math.max(0, currentScrollY - Math.round(safetyTop - rect.top + 12));
                }
            }

            // Borner impérativement par le défilement maximal autorisé pour la vue
            if (targetScrollY > maxAllowed) {
                targetScrollY = maxAllowed;
            }
            if (targetScrollY < 0) {
                targetScrollY = 0;
            }

            // Ignorer les micro-deltas (< 6px) pour éviter les micro-saccades
            if (Math.abs(targetScrollY - currentScrollY) < 6) {
                return;
            }

            // Saut immédiat et instantané (0ms) : élimine tout artefact graphique et dérive relative
            try {
                window.scrollTo({ top: targetScrollY, left: 0, behavior: "instant" });
            } catch (_) {
                try { window.scrollTo(0, targetScrollY); } catch (_) {}
            }
            if (document.documentElement) document.documentElement.scrollTop = targetScrollY;
            if (document.body) document.body.scrollTop = targetScrollY;
        });
    },

    /**
     * Mémorise la section d'origine d'une lecture au moment de son lancement (v3.3.2).
     * Cette trace permet à « En écoute » (touche N) de toujours renvoyer vers l'endroit
     * exact d'où la lecture a été lancée, quel que soit l'onglet où l'on se trouve ensuite.
     */
    recordPlaybackOrigin(forcedType = null) {
        const alb = this.currentAlbum || {};
        const albPath = alb.path || "";

        // Contenu en ligne, dossier temporaire ou lancé depuis l'Atelier : router vers now-playing
        if (alb.is_online || alb.is_collection === false || this.previousModeWasWorkshop || String(albPath).startsWith("online:")) {
            this.playbackOrigin = {
                type: "now-playing",
                view: "now-playing",
                path: albPath,
                title: alb.title || "",
                artist: alb.artist || ""
            };
            this._playbackOriginCtxRef = this.playbackContext || null;
            return;
        }

        // Vue de lancement : si on a déjà basculé en Grand Écran, retenir la vue d'où l'on venait
        let view = this.currentView || "albums";
        if (view === "now-playing") {
            view = this.previousView || "albums";
        }

        let type = forcedType;
        if (!type) {
            if (alb.is_video && (albPath === "video_standalone" || (this.playlist && this.playlist.length === 1 && this.playlist[0] && this.playlist[0].is_video))
                && !String(albPath).startsWith("playlist:") && !String(albPath).startsWith("system:")) {
                type = "video";
            } else if (view === "all") {
                // Tout lancement depuis l'onglet Tout (album, aléatoire collection, recherche) revient sur Tout
                type = "all";
            } else if (String(albPath).startsWith("playlist:") || (albPath && String(albPath).startsWith("system:") && view === "playlists")) {
                type = "playlist";
            } else if (albPath === "system:all-collection") {
                type = (view === "playlists") ? "playlist" : "all";
            } else if (albPath === "system:search-results") {
                type = "all";
            } else if (!albPath) {
                type = "filtered";
            } else {
                type = "album";
            }
        }

        if (type === "video") {
            view = alb.is_concert ? "concerts" : (view === "concerts" ? "concerts" : "videos");
        }

        this.playbackOrigin = {
            type,
            view,
            path: albPath,
            artistFilter: this.selectedArtistFilter || null,
            genreFilter: this.selectedGenreFilter || null
        };
        this._playbackOriginCtxRef = this.playbackContext || null;
    },

    /**
     * Redirige vers la section d'où la lecture en cours a été lancée (v3.3.2 / v4.0.0) :
     * - Album en ligne / Atelier → vue Grand Écran (now-playing) avec tracklist et scroll actif
     * - Album collection         → ce seul album (détail) avec scroll actif
     * - Tout                     → onglet Tout, morceau en cours mis en vision
     * - Playlist                 → la playlist concernée avec scroll actif
     * - Vidéo                    → réouverture du lecteur vidéo grand écran
     * Le comportement ne dépend plus de l'onglet où se trouve l'utilisateur.
     */
    navigateToCurrentlyPlaying() {
        // 1. Fermer le tiroir de la file d'attente s'il est ouvert pour dégager la vue
        if (this.isQueueDrawerOpen && typeof this.closeQueueDrawer === "function") {
            this.closeQueueDrawer();
        }

        const origin = this.playbackOrigin || null;
        const videoEl = document.getElementById("video-modal-player");
        const isVideoActive = Boolean(
            (window.isVideoPlayingInBackground || (videoEl && videoEl.src && !videoEl.paused)) &&
            window.currentModalVideoItem &&
            videoEl &&
            videoEl.src
        );

        // Vidéo active en arrière-plan : rouvrir le lecteur vidéo
        if (isVideoActive && window.reopenVideoModal) {
            window.reopenVideoModal();
            return;
        }

        // Flux Radio Web actif : ouvrir la vue Grand Écran de la radio en direct
        if (this.isRadioPlaying && this.currentRadio) {
            if (typeof isWorkshopDrawerOpen !== "undefined" && isWorkshopDrawerOpen && typeof closeWorkshopDrawer === "function") {
                closeWorkshopDrawer();
            }
            if (typeof isPlayerModeActive !== "undefined" && !isPlayerModeActive && typeof enterPlayerMode === "function") {
                enterPlayerMode();
            }
            this.setView("now-playing");
            this.renderPlayerTab();
            return;
        }

        if (!this.currentAlbum && !this.isPlaying && (!this.playlist || this.playlist.length === 0)) {
            showToast("Aucun morceau en cours de lecture", "info", 2000);
            return;
        }

        // Fermer l'Atelier si ouvert et entrer dans le mode lecteur
        if (typeof isWorkshopDrawerOpen !== "undefined" && isWorkshopDrawerOpen && typeof closeWorkshopDrawer === "function") {
            closeWorkshopDrawer();
        }
        if (typeof isPlayerModeActive !== "undefined" && !isPlayerModeActive && typeof enterPlayerMode === "function") {
            enterPlayerMode();
        }

        // Trace absente (lecture lancée avant la v3.3.2) : la reconstituer à partir du contexte actuel
        const ctxAlbum = (this.playbackContext && this.playbackContext.album) || this.currentAlbum || {};
        const o = origin || (() => {
            const p = ctxAlbum.path || "";
            if (ctxAlbum.is_online || ctxAlbum.is_collection === false || String(p).startsWith("online:")) return { type: "now-playing", view: "now-playing", path: p };
            if (String(p).startsWith("playlist:")) return { type: "playlist", view: "playlists", path: p };
            if (p === "system:all-collection" || p === "system:search-results") return { type: "all", view: "all", path: p };
            if (p && p !== "video_standalone") return { type: "album", view: "albums", path: p };
            return { type: "now-playing", view: "now-playing", path: p };
        })();

        const scrollLater = (delay = 150) => setTimeout(() => this.scrollToActiveTrack(true), delay);

        // Contenu Grand Écran (Album en ligne, Atelier, hors collection, etc.) : affichage dédié dans now-playing
        if (o.type === "now-playing" || o.type === "online" || ctxAlbum.is_online || ctxAlbum.is_collection === false || String(o.path || "").startsWith("online:") || String(this.activeAlbumPath || "").startsWith("online:")) {
            if (this.currentView !== "now-playing") {
                this.setView("now-playing");
            }
            this.renderPlayerTab();
            scrollLater(100);
            return;
        }

        switch (o.type) {
            case "all": {
                if (this.currentView !== "all") this.setView("all");
                const refresh = () => {
                    if (typeof this.updateActiveTrackInAllContainer === "function") {
                        this.updateActiveTrackInAllContainer();
                    }
                    this.scrollToActiveTrack(true);
                };
                refresh();
                setTimeout(refresh, 180);
                return;
            }

            case "playlist": {
                const curPath = o.path || (ctxAlbum.path || "");
                const plOpen = window.UserPlaylists && window.UserPlaylists.isDetailOpen;
                if (this.currentView !== "playlists") this.setView("playlists");
                if (curPath === "system:all-collection" || String(curPath).includes("all-collection")) {
                    if (window.UserPlaylists && window.UserPlaylists.openAllCollectionDetail) {
                        window.UserPlaylists.openAllCollectionDetail();
                    }
                } else if (String(curPath).startsWith("playlist:")) {
                    const plId = curPath.replace("playlist:", "");
                    const openPl = window.UserPlaylists && window.UserPlaylists.currentDetailPlaylist;
                    const sameOpen = plOpen && openPl && String(openPl.id) === String(plId);
                    if (!sameOpen && window.UserPlaylists && window.UserPlaylists.openDetail) {
                        window.UserPlaylists.openDetail(plId);
                    }
                }
                scrollLater(150);
                return;
            }

            case "album": {
                const albPath = (this.currentAlbum && this.currentAlbum.path) || o.path || this.activeAlbumPath;
                if (albPath && String(albPath).startsWith("online:")) {
                    if (this.currentView !== "now-playing") this.setView("now-playing");
                    this.renderPlayerTab();
                    scrollLater(100);
                    return;
                }
                if (albPath) {
                    const alreadyOpen = this.currentView === "albums" && this.isAlbumDetailOpen && this.detailAlbumPath === albPath;
                    if (!alreadyOpen) {
                        if (this.currentView !== "albums") this.setView("albums");
                        this.openAlbumDetail(albPath);
                    }
                    scrollLater(alreadyOpen ? 0 : 150);
                    return;
                }
                break;
            }

            case "filtered": {
                if (o.view === "albums" && (this.selectedArtistFilter || this.selectedGenreFilter)) {
                    if (this.currentView !== "albums") this.setView("albums");
                    scrollLater(150);
                    return;
                }
                if (this.currentView !== "now-playing") {
                    this.setView("now-playing");
                }
                this.renderPlayerTab();
                scrollLater(120);
                return;
            }

            case "video": {
                // Si la piste vidéo fait partie d'un album de la collection (ex: album concert)
                const albPath = (this.currentAlbum && this.currentAlbum.path) || o.path || this.activeAlbumPath;
                if (albPath && albPath !== "video_standalone" && !String(albPath).startsWith("online:") && this.currentAlbum && this.currentAlbum.is_collection) {
                    if (this.currentView !== "albums") this.setView("albums");
                    this.openAlbumDetail(albPath);
                    scrollLater(150);
                    return;
                }

                // Pour un concert ou clip autonome fermé : afficher l'onglet Grand Écran / Now-Playing
                if (this.currentView !== "now-playing") {
                    this.setView("now-playing");
                }
                this.renderPlayerTab();
                scrollLater(100);
                return;
            }
        }

        // Fallback (ex: titre seul en ligne) : Grand Écran
        if (this.currentView !== "now-playing") {
            this.setView("now-playing");
        }
        this.renderPlayerTab();
        scrollLater(120);
    },

    updateNowPlayingBackLabel() {
        const navBar = document.getElementById("player-now-playing-nav-bar");
        const labelEl = document.getElementById("player-now-playing-back-label");
        if (!navBar) return;

        if (this.currentView !== "now-playing") {
            navBar.style.display = "none";
            return;
        }

        navBar.style.display = "flex";

        if (!labelEl) return;
        if (this.previousModeWasWorkshop) {
            labelEl.textContent = "Retourner à l'Atelier";
            return;
        }

        const viewNames = {
            "all": "Retourner à Tout",
            "albums": "Retourner aux Albums",
            "artists": "Retourner aux Artistes",
            "genres": "Retourner aux Genres",
            "videos": "Retourner aux Clips",
            "concerts": "Retourner aux Concerts",
            "playlists": "Retourner aux Playlists",
            "radios": "Retourner aux Radios"
        };
        const prev = this.previousView || (this.isRadioPlaying ? "radios" : "albums");
        labelEl.textContent = viewNames[prev] || (this.isRadioPlaying ? "Retourner aux Radios" : "Retourner à la collection");
    },

    updateDetailContextBar() {
        const bar = document.getElementById("player-detail-context-bar");
        const backBtn = document.getElementById("player-context-back-btn");
        const backLabel = document.getElementById("player-context-back-label");
        const breadcrumb = document.getElementById("player-context-breadcrumb");
        if (!bar) return;

        const isAlbumDetail = (this.currentView === "albums" && this.isAlbumDetailOpen);
        const isPlDetail = (this.currentView === "playlists" && window.UserPlaylists && window.UserPlaylists.isDetailOpen);

        if (isAlbumDetail) {
            bar.style.display = "flex";
            if (backLabel) {
                if (this.selectedArtistFilter) {
                    backLabel.textContent = `← Revenir aux albums (${this.selectedArtistFilter})`;
                } else if (this.selectedGenreFilter) {
                    backLabel.textContent = `← Revenir aux albums (${this.selectedGenreFilter})`;
                } else {
                    backLabel.textContent = "← Revenir aux Albums";
                }
            }
            if (backBtn) {
                if (this.selectedArtistFilter) {
                    backBtn.setAttribute("title", `Revenir aux albums de ${this.selectedArtistFilter} (Échap / Retour)`);
                } else if (this.selectedGenreFilter) {
                    backBtn.setAttribute("title", `Revenir aux albums du genre ${this.selectedGenreFilter} (Échap / Retour)`);
                } else {
                    backBtn.setAttribute("title", "Revenir à la grille des albums (Échap / Retour)");
                }
            }

            let infoText = "";
            const albumName = this.detailAlbumTitle || (this.currentAlbum && this.activeAlbumPath === this.detailAlbumPath ? this.currentAlbum.title : "");
            const artistName = this.detailAlbumArtist || (this.currentAlbum && this.activeAlbumPath === this.detailAlbumPath ? this.currentAlbum.artist : "");
            const count = this.detailAlbumTracksCount || (this.playlist && this.activeAlbumPath === this.detailAlbumPath ? this.playlist.length : 0);

            if (albumName || artistName) {
                const trkCountStr = count ? ` (${count} titre${count > 1 ? "s" : ""})` : "";
                if (this.selectedArtistFilter) {
                    infoText = `Artistes › <strong>${escapeHtml(this.selectedArtistFilter)}</strong> › <strong>${escapeHtml(albumName || "Détail")}</strong>${trkCountStr}`;
                } else if (this.selectedGenreFilter) {
                    infoText = `Genres › <strong>${escapeHtml(this.selectedGenreFilter)}</strong> › <strong>${escapeHtml(albumName || "Détail")}</strong>${trkCountStr}`;
                } else {
                    infoText = `Albums › <strong>${escapeHtml(artistName ? `${artistName} — ` : "")}${escapeHtml(albumName || "Détail")}</strong>${trkCountStr}`;
                }
            } else {
                infoText = `Albums › <strong>Détail de l'album</strong>`;
            }
            if (breadcrumb) {
                breadcrumb.innerHTML = infoText;
                breadcrumb.title = breadcrumb.textContent;
            }
        } else if (isPlDetail) {
            bar.style.display = "flex";
            if (backLabel) backLabel.textContent = "← Retour aux Playlists";
            if (backBtn) backBtn.setAttribute("title", "Revenir à la grille des playlists (Échap / Retour)");

            const pl = window.UserPlaylists ? window.UserPlaylists.currentDetailPlaylist : null;
            let infoText = "Playlists › <strong>Détail</strong>";
            if (pl) {
                const count = (typeof pl.items_count === "number") ? pl.items_count : (pl.items ? pl.items.length : 0);
                const countStr = count ? ` (${count} élément${count > 1 ? "s" : ""})` : "";
                infoText = `Playlists › <strong>${escapeHtml(pl.name || "Playlist")}</strong>${countStr}`;
            }
            if (breadcrumb) {
                breadcrumb.innerHTML = infoText;
                breadcrumb.title = breadcrumb.textContent;
            }
        } else {
            bar.style.display = "none";
        }

        if (typeof syncPlayerControlsHeight === "function") {
            syncPlayerControlsHeight();
        }
    },

    returnToPreviousView() {
        if (this.previousModeWasWorkshop) {
            this.previousModeWasWorkshop = false;
            exitPlayerMode();
            return;
        }
        const targetView = (this.previousView && this.previousView !== "now-playing") ? this.previousView : (this.isRadioPlaying ? "radios" : "albums");
        const savedY = (this.savedScrollPositions && typeof this.savedScrollPositions[targetView] === "number")
            ? this.savedScrollPositions[targetView]
            : 0;
        this.setView(targetView);
        this.restoreScrollPosition(savedY);
    },

    returnFromFilterToOrigin() {
        if (this.selectedArtistFilter) {
            this.selectedArtistFilter = null;
            this.setView("artists");
            return true;
        }
        if (this.selectedGenreFilter) {
            this.selectedGenreFilter = null;
            this.setView("genres");
            return true;
        }
        return false;
    },

    updateSortSelectForView(view) {
        const sortSelect = document.getElementById("player-sort-select");
        const searchInput = document.getElementById("player-search-input");
        const typeFilters = document.getElementById("player-type-filters");
        const artistsDensityToggle = document.getElementById("player-artists-density-toggle");

        if (typeFilters) {
            typeFilters.style.display = (view === "albums") ? "flex" : "none";
        }
        if (artistsDensityToggle) {
            artistsDensityToggle.style.display = (view === "artists" || view === "genres") ? "inline-flex" : "none";
        }
        if (!sortSelect) return;

        if (view === "all") {
            const isSearchMode = Boolean(this.allSearchQuery && this.allSearchQuery.trim());
            if (isSearchMode) {
                sortSelect.innerHTML = `
                    <option value="relevance">🎯 Pertinence (Ordre naturel)</option>
                    <option value="title-asc">🎵 Titre (A ➔ Z)</option>
                    <option value="title-desc">🎵 Titre (Z ➔ A)</option>
                    <option value="artist-asc">🔤 Artiste (A ➔ Z)</option>
                    <option value="artist-desc">🔤 Artiste (Z ➔ A)</option>
                    <option value="album-asc">💿 Album (A ➔ Z)</option>
                    <option value="album-desc">💿 Album (Z ➔ A)</option>
                    <option value="genre-asc">🏷️ Genre (A ➔ Z)</option>
                    <option value="genre-desc">🏷️ Genre (Z ➔ A)</option>
                    <option value="dur-desc">⏱️ Durée (Plus long)</option>
                    <option value="dur-asc">⏱️ Durée (Plus court)</option>
                `;
                sortSelect.value = this.sortModeAllSearch || "relevance";
            } else {
                sortSelect.innerHTML = `
                    <option value="artist-asc">🔤 Artiste (A ➔ Z)</option>
                    <option value="artist-desc">🔤 Artiste (Z ➔ A)</option>
                    <option value="title-asc">💿 Album (A ➔ Z)</option>
                    <option value="title-desc">💿 Album (Z ➔ A)</option>
                    <option value="genre-asc">🏷️ Genre (A ➔ Z)</option>
                    <option value="genre-desc">🏷️ Genre (Z ➔ A)</option>
                    <option value="tracks-desc">🎵 Nb de pistes (Décroissant)</option>
                    <option value="year-desc">📅 Année (Plus récent)</option>
                    <option value="year-asc">⏳ Année (Plus ancien)</option>
                `;
                sortSelect.value = this.sortModeAllCatalog || "artist-asc";
            }
            if (searchInput) searchInput.placeholder = "Rechercher un titre, un artiste, un album...";
        } else if (view === "artists") {
            sortSelect.innerHTML = `
                <option value="name-asc">🔤 Artiste (A ➔ Z)</option>
                <option value="name-desc">🔤 Artiste (Z ➔ A)</option>
                <option value="albums-desc">💿 Nb d'albums (Décroissant)</option>
                <option value="albums-asc">💿 Nb d'albums (Croissant)</option>
                <option value="tracks-desc">🎵 Nb de titres (Décroissant)</option>
            `;
            sortSelect.value = this.sortModeArtists || "name-asc";
            if (searchInput) searchInput.placeholder = "Filtrer les artistes...";
        } else if (view === "genres") {
            sortSelect.innerHTML = `
                <option value="albums-desc">💿 Nb d'albums (Décroissant)</option>
                <option value="albums-asc">💿 Nb d'albums (Croissant)</option>
                <option value="name-asc">🏷️ Genre (A ➔ Z)</option>
                <option value="name-desc">🏷️ Genre (Z ➔ A)</option>
            `;
            sortSelect.value = this.sortModeGenres || "albums-desc";
            if (searchInput) searchInput.placeholder = "Filtrer les genres...";
        } else {
            sortSelect.innerHTML = `
                <option value="artist-asc">🔤 Artiste (A ➔ Z)</option>
                <option value="artist-desc">🔤 Artiste (Z ➔ A)</option>
                <option value="title-asc">💿 Album (A ➔ Z)</option>
                <option value="title-desc">💿 Album (Z ➔ A)</option>
                <option value="genre-asc">🏷️ Genre (A ➔ Z)</option>
                <option value="genre-desc">🏷️ Genre (Z ➔ A)</option>
                <option value="tracks-desc">🎵 Nb de pistes (Décroissant)</option>
                <option value="year-desc">📅 Année (Plus récent)</option>
                <option value="year-asc">⏳ Année (Plus ancien)</option>
            `;
            sortSelect.value = this.sortModeAlbums || this.sortMode || "artist-asc";
            if (searchInput) searchInput.placeholder = "Filtrer dans la collection (artiste, album, genre...)";
        }
    },

    updateAllSortSelect(isSearchMode) {
        if (this.currentView === "all") {
            this.updateSortSelectForView("all");
        }
    },

    updateMiniDockVisibility() {
        // Le mini-dock supérieur a été retiré au profit exclusif de la barre flottante du bas
    },

    updateFloatingBarVisibility() {
        const bar = document.getElementById("persistent-player-bar");
        if (!bar) return;

        // Le centre de commandes inférieur reste affiché en permanence en mode standard
        // (En mode Ambiance, la règle body.ambient-mode-active applique display: none !important)
        bar.style.display = "flex";
        if (typeof updateHeaderNowPlayingButton === "function") updateHeaderNowPlayingButton();
    },

    async loadLibraryData(preservePlayback = false) {
        this.isLoadingLibrary = true;
        if (this.albumInfoCache) {
            this.albumInfoCache.clear();
        }
        const grid = document.getElementById("player-albums-grid");
        if (grid && (!this.libraryAlbums || this.libraryAlbums.length === 0)) {
            grid.innerHTML = '<p class="text-muted" style="padding: 30px; text-align: center;"><span class="spinner" style="display:inline-block;width:18px;height:18px;margin-right:8px;vertical-align:middle;"></span>Chargement des données...</p>';
        }

        try {
            const res = await fetch(`/api/library/albums?source=${encodeURIComponent(this.librarySource)}`);
            if (!res.ok) throw new Error("Erreur de chargement de la bibliothèque");
            const data = await res.json();

            this.libraryConfigured = !!data.library_configured;

            // Auto-fallback sur le temporaire si collection demandée mais non configurée
            if (this.librarySource === "library" && !this.libraryConfigured) {
                this.librarySource = "temp";
                return this.loadLibraryData();
            }

            this.libraryAlbums = data.albums || [];
            this.hasLoadedOnce = true;
            this.allCatalog = null;

            // Mettre à jour les badges de source
            const colBadge = document.getElementById("player-source-col-badge");
            const tempBadge = document.getElementById("player-source-temp-badge");
            const colBtn = document.getElementById("player-source-col-btn");

            if (colBadge) {
                colBadge.textContent = data.library_albums_count !== undefined ? data.library_albums_count : (data.source === "library" ? data.total : "...");
            }
            if (tempBadge) {
                if (data.source === "temp") {
                    tempBadge.textContent = data.total;
                } else {
                    this.updateTempCountBadgeOnly();
                }
            }

            if (colBtn) {
                if (!this.libraryConfigured) {
                    colBtn.classList.add("disabled");
                    colBtn.title = "Collection non configurée (définissez le dossier dans Paramètres)";
                } else {
                    colBtn.classList.remove("disabled");
                    colBtn.title = "Lire les albums de votre collection musicale";
                }
            }

            this.updateSourceButtonsUI();
            if (this.currentView !== "now-playing") {
                const allContainer = document.getElementById("player-all-container");
                const hasAllBlocks = Boolean(allContainer && allContainer.querySelector(".player-all-album-block"));
                if (this.currentView === "all" && hasAllBlocks) {
                    this.updateActiveTrackInAllContainer();
                } else if (this.currentView === "albums" && this.isAlbumDetailOpen) {
                    // Si le détail d'un album est ouvert, ne pas écraser la grille sous-jacente
                } else {
                    const currentY = window.scrollY || document.documentElement.scrollTop || 0;
                    this.renderCurrentView();
                    this.restoreScrollPosition(currentY);
                }
            }

            if (window.UserPlaylists) {
                window.UserPlaylists.hasSystemPlaylist = (this.libraryAlbums.length > 0);
                if (typeof window.UserPlaylists.updateBadgeUI === "function") {
                    window.UserPlaylists.updateBadgeUI();
                }
            }

            if (this.librarySource === "library") {
                setTimeout(() => this.checkAndExtractMissingCovers(), 8000);
            }

            // Pré-charger les infos des albums en arrière-plan avec répit (pour priorité totale au clic utilisateur)
            setTimeout(() => this.warmAlbumCache(), 3500);

            // Pré-charger le catalogue global « Tout » dès l'ouverture de la collection
            this.prefetchAllCatalog();

            // Si la vue détail d'un album est actuellement ouverte, la rafraîchir en préservant le scroll
            if (this.isAlbumDetailOpen && this.detailAlbumPath) {
                this.openAlbumDetail(this.detailAlbumPath, true, true);
            }
        } catch (err) {
            console.error("Erreur loadLibraryData:", err);
            showToast("Impossible de charger la collection audio : " + err.message, "danger");
            if (grid) {
                grid.innerHTML = `<div class="empty-state" style="padding: 40px 20px; text-align: center;"><p class="text-muted">Erreur de chargement.</p><button type="button" class="btn btn-sm btn-primary" onclick="AudioPlayer.loadLibraryData()">Réessayer</button></div>`;
            }
        } finally {
            this.isLoadingLibrary = false;
        }
    },

    invalidateAlbumCache(albumPath = null) {
        if (!this.albumInfoCache) this.albumInfoCache = new Map();
        if (albumPath) {
            this.albumInfoCache.delete(albumPath);
            if (this.allCatalog && Array.isArray(this.allCatalog.albums)) {
                const idx = this.allCatalog.albums.findIndex(a => a.path === albumPath);
                if (idx >= 0) {
                    this.allCatalog.albums.splice(idx, 1);
                }
            }
            if (this.isAlbumDetailOpen && this.detailAlbumPath === albumPath) {
                this.openAlbumDetail(albumPath, true, true);
            }
        } else {
            this.albumInfoCache.clear();
            this.allCatalog = null;
            if (this.isAlbumDetailOpen && this.detailAlbumPath) {
                this.openAlbumDetail(this.detailAlbumPath, true, true);
            }
        }
    },

    remapAlbumPaths(oldPath, newPath, newMeta = null) {
        if (!oldPath || !newPath) return;
        const normOld = String(oldPath).replace(/[\\/]+/g, "/").toLowerCase().replace(/\/+$/, "");
        const normNew = String(newPath).replace(/[\\/]+/g, "/").replace(/\/+$/, "");
        if (normOld === normNew.toLowerCase()) return;

        if (this.currentAlbum && this.currentAlbum.path) {
            const curNorm = String(this.currentAlbum.path).replace(/[\\/]+/g, "/").toLowerCase().replace(/\/+$/, "");
            if (curNorm === normOld) {
                this.currentAlbum.path = newPath;
                if (newMeta) {
                    if (newMeta.artist) this.currentAlbum.artist = newMeta.artist;
                    if (newMeta.title || newMeta.album) this.currentAlbum.title = newMeta.title || newMeta.album;
                    if (newMeta.genre) this.currentAlbum.genre = newMeta.genre;
                    if (newMeta.year) this.currentAlbum.year = newMeta.year;
                    if (newMeta.cover_url) this.currentAlbum.cover_url = newMeta.cover_url;
                }
            }
        }

        if (Array.isArray(this.playlist)) {
            this.playlist.forEach(t => {
                if (t && (t.path || t.filepath)) {
                    const rawP = t.path || t.filepath;
                    const tNorm = String(rawP).replace(/[\\/]+/g, "/");
                    if (tNorm.toLowerCase().startsWith(normOld)) {
                        const sub = tNorm.slice(normOld.length).replace(/^\/+/, "");
                        const updatedPath = `${normNew}/${sub}`;
                        t.path = updatedPath;
                        t.filepath = updatedPath;
                        t.stream_url = `/api/audio/stream-local?path=${encodeURIComponent(updatedPath)}`;
                        if (newMeta) {
                            if (newMeta.artist) t.artist = newMeta.artist;
                            if (newMeta.title || newMeta.album) t.album = newMeta.title || newMeta.album;
                        }
                    }
                }
            });
        }

        if (Array.isArray(this.userQueue)) {
            this.userQueue.forEach(item => {
                const t = item.track || item;
                if (t && (t.path || t.filepath)) {
                    const rawP = t.path || t.filepath;
                    const tNorm = String(rawP).replace(/[\\/]+/g, "/");
                    if (tNorm.toLowerCase().startsWith(normOld)) {
                        const sub = tNorm.slice(normOld.length).replace(/^\/+/, "");
                        const updatedPath = `${normNew}/${sub}`;
                        t.path = updatedPath;
                        t.filepath = updatedPath;
                        t.stream_url = `/api/audio/stream-local?path=${encodeURIComponent(updatedPath)}`;
                        if (t.album_path) t.album_path = newPath;
                    }
                }
                if (item.album && item.album.path) {
                    const aNorm = String(item.album.path).replace(/[\\/]+/g, "/").toLowerCase().replace(/\/+$/, "");
                    if (aNorm === normOld) {
                        item.album.path = newPath;
                    }
                }
            });
        }

        if (this.albumInfoCache) {
            this.albumInfoCache.delete(oldPath);
            this.albumInfoCache.delete(newPath);
        }
    },

    async refreshLibrary() {
        const btn = document.getElementById("player-btn-refresh-library");
        if (btn) btn.classList.add("rotating");
        this.isCatalogReady = false;
        this.setAllCatalogPreparingState(true);
        try {
            // Déclencher la synchronisation complète (sas _imports, orphelins, dossiers vides et scan disque)
            let res = await fetch("/api/library/synchronize?is_automatic=false", { method: "POST" });
            let data = null;
            if (res.ok) {
                data = await res.json();
            }
            // Si la synchronisation est déjà en cours ou indisponible, forcer une réindexation directe
            if (!data || data.status === "in_progress") {
                const scanRes = await fetch("/api/library/scan", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ force: true })
                });
                if (scanRes.ok) data = await scanRes.json();
            }

            await this.loadLibraryData();
            await this.prefetchAllCatalog(true);
            if (typeof loadLibrary === "function") {
                loadLibrary();
            }
            if (typeof window.refreshSearchBadges === "function") {
                window.refreshSearchBadges();
            }

            const count = (data && data.albums_count !== undefined)
                ? data.albums_count
                : (this.libraryAlbums ? this.libraryAlbums.length : 0);

            showToast(`Collection synchronisée : ${count} album(s) actif(s)`, "success");
        } catch (err) {
            console.error("Erreur refreshLibrary:", err);
            showToast("Erreur lors de la synchronisation de la collection", "danger");
        } finally {
            if (btn) {
                setTimeout(() => btn.classList.remove("rotating"), 500);
            }
        }
    },

    /**
     * Pré-charge les infos détaillées de chaque album en arrière-plan.
     * Throttlé à ~5 requêtes/sec pour ne pas saturer le backend local.
     * S'arrête si la bibliothèque est rechargée (albumInfoCache.clear()) ou si l'utilisateur
     * ouvre un album (qui met lui-même à jour le cache, priorité donnée à la navigation).
     * Limite à MAX_PREFETCH albums pour économiser les ressources.
     */
    async warmAlbumCache() {
        const MAX_PREFETCH = 80;   // Au-delà, l'utilisateur scrollera — ça se chargera au survol
        const THROTTLE_MS = 150;   // Délai entre chaque fetch (~6 req/s max côté backend)

        if (!this.libraryAlbums || this.libraryAlbums.length === 0) return;
        if (!this.albumInfoCache) this.albumInfoCache = new Map();

        // Jeton unique pour annuler ce warm si la bibliothèque est rechargée
        const warmToken = Date.now();
        this._warmToken = warmToken;

        const toFetch = this.libraryAlbums.slice(0, MAX_PREFETCH);
        const total = toFetch.length;

        // --- Indicateur visuel ---
        const indicator = document.getElementById("player-cache-warm-indicator");
        const warmText = document.getElementById("player-cache-warm-text");
        const warmIcon = document.getElementById("player-cache-warm-icon");

        const showIndicator = () => {
            if (!indicator) return;
            // Reset état
            indicator.classList.remove("done");
            indicator.classList.add("visible");
            if (warmIcon) warmIcon.innerHTML = `
                <svg class="player-cache-spinner" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                </svg>`;
        };
        const updateProgress = (done) => {
            if (warmText) warmText.textContent = `Cache ${done}/${total}…`;
        };
        const showDone = (cached) => {
            if (!indicator) return;
            indicator.classList.add("done");
            if (warmIcon) warmIcon.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
            if (warmText) warmText.textContent = `✓ ${cached} album${cached > 1 ? "s" : ""} en cache`;
            setTimeout(() => {
                indicator.classList.remove("visible", "done");
            }, 3000);
        };

        showIndicator();
        updateProgress(0);

        let fetchedCount = 0;
        for (const alb of toFetch) {
            // Annulation : si loadLibraryData a été rappelée, le token change
            if (this._warmToken !== warmToken) {
                if (indicator) indicator.classList.remove("visible", "done");
                return;
            }
            // Déjà en cache → compter sans fetch
            if (this.albumInfoCache.has(alb.path)) {
                fetchedCount++;
                updateProgress(fetchedCount);
                continue;
            }
            // L'utilisateur navigue ou écoute de la musique → céder la priorité absolue
            if (this.isAlbumDetailOpen || this.isPlaying || this.isUserPlaylistActive) {
                await new Promise(r => setTimeout(r, 600));
            }

            try {
                const res = await fetch(`/api/album/info?path=${encodeURIComponent(alb.path)}`);
                if (res.ok && this._warmToken === warmToken) {
                    const info = await res.json();
                    this.albumInfoCache.set(alb.path, info);
                    fetchedCount++;
                    updateProgress(fetchedCount);
                }
            } catch (_) {
                // Silencieux — ce n'est qu'un warm-up optionnel
            }

            // Throttle
            await new Promise(r => setTimeout(r, THROTTLE_MS));
        }

        showDone(this.albumInfoCache.size);
    },

    checkAndExtractMissingCovers() {
        if (this.isExtractingCovers) return;
        if (!this.libraryAlbums || this.libraryAlbums.length === 0) return;
        const missing = this.libraryAlbums.filter(a => !a.has_cover);
        if (missing.length === 0) return;

        this.isExtractingCovers = true;
        showToast(`🖼️ Normalisation des jaquettes : analyse de ${missing.length} album(s)...`, "info");
        fetch(`/api/library/extract-embedded-covers?source=${encodeURIComponent(this.librarySource)}`, {
            method: "POST"
        }).then(r => r.json()).then(data => {
            if (data && data.extracted_count > 0) {
                // Recharger silencieusement les données pour actualiser has_cover
                fetch(`/api/library/albums?source=${encodeURIComponent(this.librarySource)}`)
                    .then(r => r.json())
                    .then(d => {
                        if (d && d.albums) {
                            this.libraryAlbums = d.albums;
                            if (!this.isPlaying && this.currentView !== "all") {
                                this.renderCurrentView();
                            }
                        }
                    }).catch(() => {});
            }
        }).catch(err => {
            console.warn("Erreur auto-extraction jaquettes:", err);
        }).finally(() => {
            this.isExtractingCovers = false;
        });
    },

    async updateTempCountBadgeOnly() {
        try {
            const res = await fetch("/api/library/albums?source=temp");
            if (res.ok) {
                const d = await res.json();
                const tb = document.getElementById("player-source-temp-badge");
                if (tb) tb.textContent = d.total || 0;
            }
        } catch (e) {}
    },

    getAlbumType(alb) {
        if (!alb) return "album";
        const title = (alb.title || "").toLowerCase();
        const path = (alb.path || "").toLowerCase();
        const trkCount = (alb.tracks && alb.tracks.length) || parseInt(alb.tracks_count, 10) || 0;

        if (alb.album_type) {
            // Sécurité absolue : un album de plus de 3 pistes n'est JAMAIS un single
            if (alb.album_type === "single" && trkCount > 3) {
                return "album";
            }
            return alb.album_type;
        }

        if (path.includes("singles & rips") || path.includes("singles et rips") || title.includes("singles & rips") || title.includes("rip")) {
            return "rip";
        }
        if (title.includes("[playlist]") || path.includes("[playlist]")) {
            return "playlist";
        }
        if (title.includes("[concert]") || path.includes("[concert]") || path.includes("/concerts/")) {
            return "concert";
        }
        if (trkCount > 3) {
            return "album";
        }
        if (title.includes("[single]") || path.includes("[single]")) {
            return "single";
        }
        if (trkCount > 0 && trkCount <= 3) {
            return "single";
        }
        return "album";
    },

    getAlbumTypeBadgeInfo(type) {
        switch (type) {
            case "single":
                return { label: "SINGLE", class: "badge-single", emoji: "⚡", title: "Singles & EPs" };
            case "rip":
                return { label: "RIP AUDIO", class: "badge-rip", emoji: "🎙️", title: "Rips Audio vidéo" };
            case "playlist":
                return { label: "LISTE", class: "badge-playlist", emoji: "📑", title: "Listes de lecture importées" };
            case "concert":
                return { label: "CONCERT", class: "badge-concert", emoji: "🎸", title: "Concerts & Lives" };
            case "album":
            default:
                return { label: "ALBUM", class: "badge-album", emoji: "💿", title: "Albums officiels" };
        }
    },

    updateTypeFilterPills() {
        const container = document.getElementById("player-type-filters");
        if (!container) return;

        if (this.currentView !== "albums") {
            container.style.display = "none";
            return;
        }
        container.style.display = "flex";

        let baseList = this.libraryAlbums.slice();
        if (this.selectedArtistFilter) {
            const normTarget = this.selectedArtistFilter.toLowerCase().trim();
            baseList = baseList.filter(a => (a.artist || "").toLowerCase().trim() === normTarget);
        }
        if (this.selectedGenreFilter) {
            const normTarget = this.selectedGenreFilter.toLowerCase().trim();
            if (normTarget === "non classé" || normTarget === "inconnu") {
                baseList = baseList.filter(a => !a.genre || !a.genre.trim());
            } else {
                baseList = baseList.filter(a => (a.genre || "").toLowerCase().trim() === normTarget);
            }
        }

        const counts = { album: 0, single: 0, rip: 0, playlist: 0, total: baseList.length };
        baseList.forEach(a => {
            const t = this.getAlbumType(a);
            if (counts[t] !== undefined) counts[t]++;
        });

        const isAllSelected = this.selectedTypeFilters.size >= 4;

        const typesConfig = [
            { type: "album", label: "Albums", emoji: "💿", count: counts.album },
            { type: "single", label: "Singles", emoji: "⚡", count: counts.single },
            { type: "rip", label: "Rips", emoji: "🎙️", count: counts.rip },
            { type: "playlist", label: "Listes", emoji: "📑", count: counts.playlist }
        ];

        let html = `
            <button type="button" class="player-type-filter-pill ${isAllSelected ? "active" : ""}" data-filter-type="all" title="Afficher tous les types d'albums">
                <span class="type-pill-label">Tous</span>
                <span class="type-pill-count">${counts.total}</span>
            </button>
        `;

        typesConfig.forEach(cfg => {
            const isChecked = this.selectedTypeFilters.has(cfg.type);
            html += `
                <button type="button" class="player-type-filter-pill ${isChecked ? "active" : ""}" data-filter-type="${cfg.type}" title="${cfg.label} (Clic pour activer/désactiver, Alt+Clic pour isoler)">
                    <span class="type-pill-check">${isChecked ? "✓" : ""}</span>
                    <span class="type-pill-emoji">${cfg.emoji}</span>
                    <span class="type-pill-label">${cfg.label}</span>
                    <span class="type-pill-count">${cfg.count}</span>
                </button>
            `;
        });

        container.innerHTML = html;

        container.querySelectorAll(".player-type-filter-pill").forEach(pill => {
            const fType = pill.getAttribute("data-filter-type");

            const handleFilterAction = (e, isolate = false) => {
                if (fType === "all") {
                    this.selectedTypeFilters = new Set(["album", "single", "rip", "playlist"]);
                } else if (isolate || e.altKey) {
                    this.selectedTypeFilters = new Set([fType]);
                } else {
                    if (this.selectedTypeFilters.has(fType)) {
                        this.selectedTypeFilters.delete(fType);
                        if (this.selectedTypeFilters.size === 0) {
                            this.selectedTypeFilters = new Set(["album", "single", "rip", "playlist"]);
                        }
                    } else {
                        this.selectedTypeFilters.add(fType);
                    }
                }
                this.renderAlbumsGrid();
            };

            pill.addEventListener("click", (e) => handleFilterAction(e, false));
            pill.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                handleFilterAction(e, true);
            });
        });
    },

    getFilteredAlbums() {
        let list = this.libraryAlbums.slice();

        // Filtre Artiste sélectionné (clic depuis la vue Artistes)
        if (this.selectedArtistFilter) {
            const normTarget = this.selectedArtistFilter.toLowerCase().trim();
            list = list.filter(a => (a.artist || "").toLowerCase().trim() === normTarget);
        }

        // Filtre Genre sélectionné (clic depuis la vue Genres)
        if (this.selectedGenreFilter) {
            const normTarget = this.selectedGenreFilter.toLowerCase().trim();
            if (normTarget === "non classé" || normTarget === "inconnu") {
                list = list.filter(a => !a.genre || !a.genre.trim());
            } else {
                list = list.filter(a => (a.genre || "").toLowerCase().trim() === normTarget);
            }
        }

        // Filtre Type d'album (Albums officiels, Singles, Rips Audio, Playlists)
        if (this.selectedTypeFilters) {
            if (this.selectedTypeFilters.size === 0) {
                list = [];
            } else if (this.selectedTypeFilters.size < 4) {
                list = list.filter(a => this.selectedTypeFilters.has(this.getAlbumType(a)));
            }
        }

        // Recherche plein texte instantanée (< 5ms)
        if (this.searchFilter && this.searchFilter.trim()) {
            const q = this.searchFilter.toLowerCase().trim();
            list = list.filter(a => {
                const titleMatch = (a.title || "").toLowerCase().includes(q);
                const artistMatch = (a.artist || "").toLowerCase().includes(q);
                const genreMatch = (a.genre || "").toLowerCase().includes(q);
                return titleMatch || artistMatch || genreMatch;
            });
        }

        // Tri
        list.sort((a, b) => {
            const artA = (a.artist || "").toLowerCase();
            const artB = (b.artist || "").toLowerCase();
            const titA = (a.title || "").toLowerCase();
            const titB = (b.title || "").toLowerCase();
            const trkA = parseInt(a.tracks_count, 10) || 0;
            const trkB = parseInt(b.tracks_count, 10) || 0;
            const yrA = parseInt(a.year, 10) || 0;
            const yrB = parseInt(b.year, 10) || 0;
            const genA = (a.genre || "").toLowerCase();
            const genB = (b.genre || "").toLowerCase();

            const sortMode = this.sortModeAlbums || this.sortMode || "artist-asc";
            switch (sortMode) {
                case "artist-asc":
                    return artA.localeCompare(artB) || titA.localeCompare(titB);
                case "artist-desc":
                    return artB.localeCompare(artA) || titA.localeCompare(titB);
                case "title-asc":
                    return titA.localeCompare(titB) || artA.localeCompare(artB);
                case "title-desc":
                    return titB.localeCompare(titA) || artA.localeCompare(artB);
                case "genre-asc":
                    if (!genA && genB) return 1;
                    if (genA && !genB) return -1;
                    return genA.localeCompare(genB) || artA.localeCompare(artB) || titA.localeCompare(titB);
                case "genre-desc":
                    if (!genA && genB) return 1;
                    if (genA && !genB) return -1;
                    return genB.localeCompare(genA) || artA.localeCompare(artB) || titA.localeCompare(titB);
                case "tracks-desc":
                    return trkB - trkA || artA.localeCompare(artB);
                case "year-desc":
                    return yrB - yrA || artA.localeCompare(artB);
                case "year-asc":
                    if (!yrA && yrB) return 1;
                    if (yrA && !yrB) return -1;
                    return yrA - yrB || artA.localeCompare(artB);
                default:
                    return artA.localeCompare(artB) || titA.localeCompare(titB);
            }
        });

        return list;
    },

    async ensureAllCatalog() {
        if (this.allCatalog && Array.isArray(this.allCatalog.albums) && this.allCatalog.albums.length > 0) {
            return this.allCatalog;
        }
        try {
            const res = await fetch(`/api/library/catalog?source=${encodeURIComponent(this.librarySource)}`);
            if (res.ok) {
                this.allCatalog = await res.json();
                return this.allCatalog;
            }
        } catch (e) {
            console.warn("Erreur chargement catalogue complet pour lecture filtrée:", e);
        }
        return null;
    },

    async playFilteredCollection(opts = {}) {
        if (this._isPlayingFilteredLock) return;
        this._isPlayingFilteredLock = true;
        try {
            const { artist, genre, shuffle = false } = opts;
        const targetArtist = artist || this.selectedArtistFilter;
        const targetGenre = genre || this.selectedGenreFilter;

        let filteredAlbums = [];
        if (targetArtist) {
            const norm = targetArtist.toLowerCase().trim();
            filteredAlbums = (this.libraryAlbums || []).filter(a => (a.artist || "").toLowerCase().trim() === norm);
        } else if (targetGenre) {
            const norm = targetGenre.toLowerCase().trim();
            if (norm === "non classé" || norm === "inconnu") {
                filteredAlbums = (this.libraryAlbums || []).filter(a => !a.genre || !a.genre.trim());
            } else {
                filteredAlbums = (this.libraryAlbums || []).filter(a => (a.genre || "").toLowerCase().trim() === norm);
            }
        } else {
            filteredAlbums = this.getFilteredAlbums();
        }

        if (!filteredAlbums || filteredAlbums.length === 0) {
            showToast("Aucun album correspondant trouvé.", "warning");
            return;
        }

        showToast("Préparation des morceaux...", "info");
        await this.ensureAllCatalog();

        const catAlbums = (this.allCatalog && Array.isArray(this.allCatalog.albums)) ? this.allCatalog.albums : [];
        const catMap = new Map();
        catAlbums.forEach(a => {
            if (a.path) catMap.set(a.path, a);
        });

        const allTracks = [];
        for (const alb of filteredAlbums) {
            const fullAlb = catMap.get(alb.path) || alb;
            if (fullAlb && Array.isArray(fullAlb.tracks)) {
                for (const t of fullAlb.tracks) {
                    const fp = t.filepath || t.path || "";
                    const ext = fp.substring(fp.lastIndexOf(".")).toUpperCase().replace(".", "");
                    const isVid = Boolean(t.is_video || t.type === "video" || ext === "MP4" || ext === "MKV" || ext === "WEBM");
                    allTracks.push({
                        title: t.title || t.filename || "Piste",
                        artist: t.artist || fullAlb.artist || alb.artist || "Artiste inconnu",
                        album: fullAlb.title || alb.title || "",
                        track_number: t.track_number || "",
                        duration: t.duration || "--:--",
                        filepath: fp,
                        path: fp,
                        format: ext || "M4A",
                        type: isVid ? "video" : "audio",
                        is_video: isVid,
                        stream_url: `/api/audio/stream-local?path=${encodeURIComponent(fp)}`
                    });
                }
            }
        }

        if (allTracks.length === 0) {
            showToast("Aucune piste audio trouvée pour cette sélection.", "warning");
            return;
        }

        const label = targetArtist ? `Artiste : ${targetArtist}` : (targetGenre ? `Genre : ${targetGenre}` : "Sélection filtrée");
        const firstAlb = filteredAlbums[0];
        const coverUrl = firstAlb ? (firstAlb.cover_url || `/api/audio/cover?path=${encodeURIComponent(firstAlb.path)}`) : "";

        this.currentAlbum = {
            title: label,
            artist: targetArtist || "Sélection",
            year: "",
            genre: targetGenre || "",
            cover_url: coverUrl,
            path: null,
            is_collection: (this.librarySource === "library"),
            is_video: false,
            is_concert: false
        };

        this.playlist = allTracks;

        let startIndex = 0;
        if (shuffle) {
            this.isShuffle = true;
            this.updateShuffleUI();
            startIndex = Math.floor(Math.random() * this.playlist.length);
        }

        this.playbackContext = {
            album: this.currentAlbum,
            playlist: this.playlist.slice(),
            currentIndex: startIndex
        };
        this.activeAlbumPath = null;
        this.activePlaylist = this.playlist.slice();

        if ((isWorkshopDrawerOpen || !isPlayerModeActive) && typeof enterPlayerMode === "function") {
            this.previousModeWasWorkshop = true;
            enterPlayerMode();
        } else if (isWorkshopDrawerOpen) {
            this.previousModeWasWorkshop = true;
            closeWorkshopDrawer();
        }

        this.renderPlayerTab();
        this.showPlayerBar();
        this.playTrackAtIndex(startIndex);
        setTimeout(() => this.scrollToActiveTrack(true), 80);

        showToast(`Lecture ${shuffle ? "aléatoire " : ""}de « ${label} » (${this.playlist.length} titres)`, "success");
        } finally {
            this._isPlayingFilteredLock = false;
        }
    },

    renderCurrentView() {
        // Bandeau de filtre actif
        const banner = document.getElementById("player-active-filter-banner");
        const bannerText = document.getElementById("player-active-filter-text");
        const filterBackBtn = document.getElementById("player-filter-back-btn");
        const filterBackLabel = document.getElementById("player-filter-back-label");
        if (banner && bannerText) {
            if (this.selectedArtistFilter) {
                banner.style.display = "flex";
                bannerText.textContent = `Filtre actif : Artiste « ${this.selectedArtistFilter} »`;
                if (filterBackBtn) {
                    filterBackBtn.style.display = "inline-flex";
                    filterBackBtn.title = "Revenir à la liste des Artistes (Bouton précédent souris / Échap)";
                }
                if (filterBackLabel) filterBackLabel.textContent = "← Revenir aux Artistes";
            } else if (this.selectedGenreFilter) {
                banner.style.display = "flex";
                bannerText.textContent = `Filtre actif : Genre « ${this.selectedGenreFilter} »`;
                if (filterBackBtn) {
                    filterBackBtn.style.display = "inline-flex";
                    filterBackBtn.title = "Revenir à la liste des Genres (Bouton précédent souris / Échap)";
                }
                if (filterBackLabel) filterBackLabel.textContent = "← Revenir aux Genres";
            } else {
                banner.style.display = "none";
                if (filterBackBtn) filterBackBtn.style.display = "none";
            }
            if (typeof syncPlayerControlsHeight === "function") {
                syncPlayerControlsHeight();
            }
        }

        if (this.currentView === "albums") {
            this.renderAlbumsGrid();
        } else if (this.currentView === "all") {
            this.loadAndRenderAllCatalog();
        } else if (this.currentView === "artists") {
            this.renderArtistsGrid();
        } else if (this.currentView === "genres") {
            this.renderGenresGrid();
        } else if (this.currentView === "videos") {
            this.loadAndRenderVideosCatalog();
        } else if (this.currentView === "concerts") {
            this.loadAndRenderConcertsCatalog();
        } else if (this.currentView === "playlists") {
            if (window.UserPlaylists && !window.UserPlaylists.isDetailOpen) {
                window.UserPlaylists.loadAndRenderPlaylists();
            }
        } else if (this.currentView === "radios") {
            if (window.RadioManager) {
                window.RadioManager.render();
            }
        } else if (this.currentView === "search") {
            this.renderUnifiedSearch();
        } else if (this.currentView === "now-playing") {
            this.updateMiniDockVisibility();
            this.renderPlayerTab();
            if (!this.isRadioPlaying) {
                this.updateDisplayedAlbumUI();
            }
        }
        this.updateScrollBounds();
    },

    renderAlbumsGrid() {
        const grid = document.getElementById("player-albums-grid");
        const counter = document.getElementById("player-count-indicator");
        if (!grid) return;

        this.updateTypeFilterPills();

        const list = this.getFilteredAlbums();
        if (counter) {
            counter.textContent = `${list.length} album${list.length > 1 ? "s" : ""}`;
        }

        if (list.length === 0) {
            const isFreshNoLib = !this.libraryConfigured && this.librarySource === "temp" && !this.searchFilter && !this.selectedArtistFilter && !this.selectedGenreFilter;

            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; padding: 40px 20px; text-align: center;">
                    <div style="font-size: 2.5rem; opacity: 0.5; margin-bottom: 8px;">💿</div>
                    <h4 style="margin-bottom: 6px;">Aucun album trouvé</h4>
                    <p class="text-muted" style="font-size: 0.88rem; max-width: 520px; margin: 0 auto 16px auto;">
                        ${this.searchFilter ? `Aucun album ne correspond à « ${escapeHtml(this.searchFilter)} »` : (isFreshNoLib ? "Votre collection musicale n'est pas encore configurée dans les Paramètres et votre dossier temporaire ne contient aucun téléchargement pour le moment." : "Aucun album disponible dans cette source.")}
                    </p>
                    ${isFreshNoLib ? `
                        <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                            <button type="button" class="btn btn-primary" onclick="switchTab('tab-settings')">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align: middle; margin-right: 4px;"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
                                ⚙️ Configurer ma Collection
                            </button>
                            <button type="button" class="btn btn-secondary" onclick="switchTab('tab-search')">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align: middle; margin-right: 4px;"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
                                🔍 Rechercher & Télécharger
                            </button>
                        </div>
                    ` : ""}
                    ${(this.selectedArtistFilter || this.selectedGenreFilter || this.searchFilter || (this.selectedTypeFilters && this.selectedTypeFilters.size < 4)) ? `<button type="button" class="btn btn-sm btn-secondary" style="margin-top: 10px;" onclick="AudioPlayer.clearAllFilters()">Réinitialiser les filtres</button>` : ""}
                </div>
            `;
            return;
        }


        // OPT: Array.push + join au lieu de html+= (évite O(n²) sur grandes bibliothèques)
        const htmlParts = [];
        list.forEach(alb => {
            const coverUrl = alb.cover_url || `/api/audio/cover?path=${encodeURIComponent(alb.path)}${alb.mtime ? `&v=${Math.floor(alb.mtime)}` : ''}`;
            const yearStr = alb.year ? `<span>📅 ${escapeHtml(String(alb.year))}</span>` : "";
            const tracksStr = `${alb.tracks_count || 0} titre${alb.tracks_count > 1 ? "s" : ""}`;
            const albType = this.getAlbumType(alb);
            const badgeInfo = this.getAlbumTypeBadgeInfo(albType);
            const genreStr = (alb.genre || "").trim();
            const genreTagHtml = genreStr
                ? `<span class="player-card-genre-tag" title="Genre : ${escapeHtml(genreStr)}"><svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" class="genre-tag-icon"><path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/></svg><span>${escapeHtml(genreStr)}</span></span>`
                : `<span class="player-card-genre-tag is-empty" title="Genre non renseigné"><span>Non classé</span></span>`;

            htmlParts.push(`
                <div class="player-album-card" data-path="${escapeHtml(alb.path)}" title="${escapeHtml(alb.artist)} — ${escapeHtml(alb.title)}">
                    <div class="player-card-thumb-wrap">
                        <span class="player-card-type-badge ${badgeInfo.class}">${badgeInfo.label}</span>
                        <img class="player-card-thumb" src="${coverUrl}" alt="Cover" loading="lazy" onerror="window.handleCoverError(this);">
                        <div class="player-card-quick-actions">
                            <button type="button" class="btn-card-quick-action" data-action="shuffle-album" title="Lire cet album en mode aléatoire">
                                <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                            </button>
                            <button type="button" class="btn-card-quick-action" data-action="queue-album-next" title="Lire cet album ensuite (priorité immédiate)">
                                <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                            </button>
                            <button type="button" class="btn-card-quick-action" data-action="queue-album-end" title="Ajouter cet album à la file d'attente">
                                <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
                            </button>
                            <button type="button" class="btn-card-quick-action" data-action="add-album-playlist" title="Ajouter tout cet album à une playlist">
                                <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/></svg>
                            </button>
                        </div>
                        <button type="button" class="player-card-play-btn" title="Lire l'album immédiatement" data-action="play-album" data-path="${escapeHtml(alb.path)}">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        </button>
                    </div>
                    <div class="player-card-info">
                        <div class="player-card-title">${escapeHtml(alb.title)}</div>
                        <div class="player-card-genre">
                            ${genreTagHtml}
                        </div>
                        <div class="player-card-artist">${escapeHtml(alb.artist)}</div>
                        <div class="player-card-meta">
                            <span>${tracksStr}</span>
                            ${yearStr}
                        </div>
                    </div>
                </div>
            `);
        });

        grid.innerHTML = htmlParts.join("");

        // OPT: Délégation d'événements — 1 seul listener permanent sur le grid
        // au lieu de recréer les listeners à chaque filtrage/recherche
        if (!grid._hasAlbumDelegation) {
            grid._hasAlbumDelegation = true;
            grid.addEventListener("click", (e) => {
                const card = e.target.closest(".player-album-card");
                if (!card) return;
                const p = card.getAttribute("data-path");
                if (!p) return;

                const actionEl = e.target.closest("[data-action]");
                const action = actionEl ? actionEl.getAttribute("data-action") : null;

                if (action === "play-album") {
                    e.stopPropagation();
                    if (!this.savedScrollPositions) this.savedScrollPositions = {};
                    this.savedScrollPositions[this.currentView || "albums"] = window.scrollY || document.documentElement.scrollTop || 0;
                    this.loadAlbum(p, { autoPlay: true, isCollection: this.librarySource === "library", switchView: false });
                    return;
                }
                if (action === "shuffle-album") {
                    e.stopPropagation();
                    if (!this.savedScrollPositions) this.savedScrollPositions = {};
                    this.savedScrollPositions[this.currentView || "albums"] = window.scrollY || document.documentElement.scrollTop || 0;
                    this.loadAlbum(p, { autoPlay: true, shuffle: true, isCollection: this.librarySource === "library", switchView: false });
                    return;
                }
                if (action === "queue-album-next") {
                    e.stopPropagation();
                    this.enqueueAlbum(p, true);
                    return;
                }
                if (action === "queue-album-end") {
                    e.stopPropagation();
                    this.enqueueAlbum(p, false);
                    return;
                }
                if (action === "add-album-playlist") {
                    e.stopPropagation();
                    const albData = (this.libraryAlbums || []).find(a => a.path === p);
                    openAddToPlaylistModal({
                        type: "album",
                        title: albData?.title || "Album",
                        artist: albData?.artist || "Artiste",
                        path: p,
                        tracks_count: albData?.tracks_count || 0,
                        cover_url: `/api/audio/cover?path=${encodeURIComponent(p)}`
                    });
                    return;
                }

                // Clic sur la carte (hors boutons d'action) → ouvrir le détail
                if (!e.target.closest(".btn-card-quick-action") && !e.target.closest(".player-card-play-btn")) {
                    if (!this.savedScrollPositions) this.savedScrollPositions = {};
                    this.savedScrollPositions[this.currentView || "albums"] = window.scrollY || document.documentElement.scrollTop || 0;
                    this.openAlbumDetail(p);
                }
            });

            // OPT: Pré-fetch au survol posé (debounce 250ms pour ne pas saturer le CPU/réseau lors des balayages rapides de souris)
            let prefetchTimer = null;
            grid.addEventListener("mouseover", (e) => {
                const card = e.target.closest(".player-album-card");
                if (!card) return;
                const p = card.getAttribute("data-path");
                if (!p) return;
                if (this.albumInfoCache && this.albumInfoCache.has(p)) return;

                clearTimeout(prefetchTimer);
                prefetchTimer = setTimeout(() => {
                    if (!this.albumInfoCache) this.albumInfoCache = new Map();
                    if (this.albumInfoCache.has(p)) return;
                    fetch(`/api/album/info?path=${encodeURIComponent(p)}`)
                        .then(r => r.ok ? r.json() : null)
                        .then(info => { if (info) this.albumInfoCache.set(p, info); })
                        .catch(() => {});
                }, 250);
            });
        }
        this.updateScrollBounds();
    },

    async openAlbumDetail(albumPath, forceRefresh = false, preserveScroll = false) {
        if (!albumPath) return;

        const isSameAlbumAlreadyOpen = Boolean(this.isAlbumDetailOpen && this.detailAlbumPath === albumPath);
        const currentDetailScrollY = (isSameAlbumAlreadyOpen || preserveScroll)
            ? (window.scrollY || document.documentElement.scrollTop || 0)
            : 0;

        // Mémoriser la position exacte de la grille UNIQUEMENT si le détail n'était pas déjà ouvert !
        if (!this.isAlbumDetailOpen) {
            if (!this.savedScrollPositions) this.savedScrollPositions = {};
            this.savedScrollPositions["albums"] = window.scrollY || document.documentElement.scrollTop || 0;
        }

        this.isAlbumDetailOpen = true;
        this.detailAlbumPath = albumPath;
        this.detailAlbumTitle = null;
        this.detailAlbumArtist = null;
        this.detailAlbumTracksCount = 0;
        this.updateDetailContextBar();

        // Masquer la barre de recherche/tri de la collection pour harmoniser avec la vue Tout
        const toolbar = document.getElementById("player-toolbar-row");
        if (toolbar) toolbar.style.display = "none";
        if (typeof syncPlayerControlsHeight === "function") syncPlayerControlsHeight();

        const gridView = document.getElementById("player-albums-grid");
        const detailView = document.getElementById("player-album-detail-view");
        const detailBlock = document.getElementById("player-album-detail-block");

        if (forceRefresh && this.albumInfoCache) {
            this.albumInfoCache.delete(albumPath);
        }

        // 1. Chercher dans le cache mémoire AudioPlayer ou synthétiser depuis allCatalog
        let info = (!forceRefresh && this.albumInfoCache) ? this.albumInfoCache.get(albumPath) : null;
        if (!info && !forceRefresh && this.allCatalog && Array.isArray(this.allCatalog.albums)) {
            const foundAlb = this.allCatalog.albums.find(a => a.path === albumPath);
            if (foundAlb && Array.isArray(foundAlb.tracks) && foundAlb.tracks.length > 0) {
                info = {
                    album_name: foundAlb.title,
                    album_artist: foundAlb.artist,
                    year: foundAlb.year || "",
                    genre: foundAlb.genre || "",
                    tracks: foundAlb.tracks.map(t => ({
                        title: t.title,
                        artist: t.artist || foundAlb.artist,
                        track_number: t.track_number,
                        duration: t.duration,
                        bitrate: t.bitrate || t.bitrate_kbps,
                        format: t.format,
                        filepath: t.filepath,
                        filename: t.filename
                    }))
                };
                if (!this.albumInfoCache) this.albumInfoCache = new Map();
                this.albumInfoCache.set(albumPath, info);
            }
        }

        // Si non présent en cache mémoire ou forceRefresh, afficher le spinner de chargement si bloc vide
        if (!info) {
            if (gridView) gridView.style.display = "none";
            if (detailView) detailView.style.display = "block";
            if (detailBlock && (!forceRefresh || !detailBlock.firstElementChild)) {
                detailBlock.innerHTML = `
                    <div style="padding: 60px 20px; text-align: center;">
                        <div class="spinner"></div>
                        <p class="text-muted" style="margin-top: 14px; font-size: 0.9rem;">Chargement des pistes de l'album...</p>
                    </div>
                `;
                this.cancelPendingScrolls();
                this.restoreScrollPosition(0);
            }

            try {
                const res = await fetch(`/api/album/info?path=${encodeURIComponent(albumPath)}${forceRefresh ? '&force=1' : ''}`);
                if (res.ok) {
                    info = await res.json();
                    if (!this.albumInfoCache) this.albumInfoCache = new Map();
                    this.albumInfoCache.set(albumPath, info);
                }
            } catch (err) {
                console.error("Erreur chargement détail album:", err);
            }
        }

        // Si l'utilisateur a fermé ou changé d'album entre-temps
        if (!this.isAlbumDetailOpen || this.detailAlbumPath !== albumPath) return;

        if (!info) {
            if (detailBlock) {
                detailBlock.innerHTML = `
                    <div style="padding: 40px 20px; text-align: center;">
                        <p class="text-danger" style="font-weight: 600;">Impossible de charger cet album.</p>
                        <button type="button" class="btn btn-secondary btn-sm" onclick="window.AudioPlayer && window.AudioPlayer.closeAlbumDetail()">
                            ← Revenir aux Albums
                        </button>
                    </div>
                `;
            }
            return;
        }

        const albMatch = this.libraryAlbums ? this.libraryAlbums.find(a => a.path === albumPath) : null;
        if (albMatch && info) {
            if (albMatch.year && (!info.year || info.year !== albMatch.year)) info.year = albMatch.year;
            if (albMatch.genre && (!info.genre || info.genre !== albMatch.genre)) info.genre = albMatch.genre;
            if (albMatch.artist && (!info.album_artist || info.album_artist !== albMatch.artist)) info.album_artist = albMatch.artist;
            if (albMatch.title && (!info.album_name || info.album_name !== albMatch.title)) info.album_name = albMatch.title;
        }

        if (gridView) gridView.style.display = "none";
        if (detailView) detailView.style.display = "block";

        // Construction du rendu
        const folderName = albumPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "Album";
        const albumTitle = (albMatch && albMatch.title) || info.album_name || folderName;
        const albumArtist = (albMatch && albMatch.artist) || info.album_artist || "Artiste inconnu";
        const effectiveYear = (albMatch && albMatch.year) || (info && info.year) || "";
        const coverUrl = (albMatch && albMatch.cover_url) || (info && info.cover_url) || `/api/audio/cover?path=${encodeURIComponent(albumPath)}${albMatch && albMatch.mtime ? `&v=${Math.floor(albMatch.mtime)}` : ''}`;
        const rawTracks = (info.tracks || []).slice().sort((a, b) => {
            const na = parseInt(a.track_number, 10) || 0;
            const nb = parseInt(b.track_number, 10) || 0;
            return na - nb;
        });

        this.detailAlbumTitle = albumTitle;
        this.detailAlbumArtist = albumArtist;
        this.detailAlbumTracksCount = rawTracks.length;
        this.updateDetailContextBar();

        const firstFormat = (rawTracks[0] && (rawTracks[0].format || (rawTracks[0].filepath && rawTracks[0].filepath.split('.').pop()))) || "M4A";
        const yearStr = effectiveYear ? `📅 ${escapeHtml(String(effectiveYear))} • ` : "";
        const tracksCountStr = `${rawTracks.length} titre${rawTracks.length > 1 ? "s" : ""}`;
        const isPlayingThisAlbum = Boolean(this.activeAlbumPath && this.activeAlbumPath === albumPath);

        if (this.currentAlbum && this.currentAlbum.path === albumPath) {
            if (effectiveYear) this.currentAlbum.year = effectiveYear;
            if (albumTitle) this.currentAlbum.title = albumTitle;
            if (albumArtist) this.currentAlbum.artist = albumArtist;
            if (typeof this.updatePlayerBarUI === "function") this.updatePlayerBarUI();
        }

        // OPT: Array.push + join au lieu de concaténation string (évite la pression O(n²))
        const trackParts = [];
        rawTracks.forEach((trk, trkIdx) => {
            const isThisTrackPlaying = isPlayingThisAlbum && (this.currentIndex === trkIdx);
            const numStr = trk.track_number ? String(trk.track_number).padStart(2, '0') : String(trkIdx + 1).padStart(2, '0');
            const ext = (trk.format || (trk.filepath ? trk.filepath.split('.').pop() : "M4A")).toUpperCase();

            trackParts.push(`
                <div class="player-track-item ${isThisTrackPlaying ? "active" : ""}" data-trk-idx="${trkIdx}" data-alb-path="${escapeHtml(albumPath)}">
                    <div class="player-track-item-left">
                        <span class="player-equalizer-bars" style="display: ${isThisTrackPlaying && this.isPlaying ? "inline-flex" : "none"};">
                            <span class="player-equalizer-bar"></span>
                            <span class="player-equalizer-bar"></span>
                            <span class="player-equalizer-bar"></span>
                        </span>
                        <span class="player-track-item-num">${numStr}</span>
                        <span class="player-track-item-title" title="${escapeHtml(trk.title || trk.filename || 'Piste')}">${escapeHtml(trk.title || trk.filename || 'Piste')}</span>
                    </div>
                    <div class="player-track-actions">
                        <button type="button" class="btn-track-action btn-detail-trk-play" title="Lire immédiatement ce morceau">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                            <span>Lire</span>
                        </button>
                        <button type="button" class="btn-track-action btn-detail-trk-next" title="Lire ce titre ensuite (priorité)">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                            <span>Ensuite</span>
                        </button>
                        <button type="button" class="btn-track-action btn-detail-trk-enqueue" title="Ajouter à la file d'attente">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
                            <span>+ File</span>
                        </button>
                        <button type="button" class="btn-track-action btn-detail-trk-playlist" title="Ajouter ce morceau à une playlist">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/></svg>
                            <span>+ Playlist</span>
                        </button>
                    </div>
                    <span class="dense-track-format">${escapeHtml(this.formatTrackBadge(trk))}</span>
                    <span class="player-track-item-dur">${escapeHtml(trk.duration || "--:--")}</span>
                </div>
            `);
        });
        const tracksHtml = trackParts.join("");

        const albObj = albMatch || (this.libraryAlbums ? this.libraryAlbums.find(a => a.path === albumPath) : null);
        const albType = this.getAlbumType(albObj || { title: albumTitle, path: albumPath, tracks: rawTracks });
        const badgeInfo = this.getAlbumTypeBadgeInfo(albType);
        const albumGenre = ((albMatch && albMatch.genre) || (info && info.genre) || (albObj && albObj.genre) || (rawTracks[0] && rawTracks[0].genre) || "").trim();
        const genreTagHtml = albumGenre
            ? `<span class="player-card-genre-tag" title="Genre : ${escapeHtml(albumGenre)}"><svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" class="genre-tag-icon"><path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/></svg><span>${escapeHtml(albumGenre)}</span></span>`
            : "";

        if (this.currentAlbum && this.currentAlbum.path === albumPath && albumGenre) {
            this.currentAlbum.genre = albumGenre;
        }

        if (detailBlock) {
            detailBlock.innerHTML = `
                <div class="player-all-album-block ${isPlayingThisAlbum ? "is-active-album" : ""}" data-alb-path="${escapeHtml(albumPath)}">
                    <!-- Volet Gauche : Pochette & Métadonnées Album -->
                    <div class="all-album-sidebar">
                        <div class="all-album-cover-box">
                            <img class="all-album-cover-img" src="${coverUrl}" alt="Cover" onerror="window.handleCoverError(this);">
                            <div class="player-format-badge">${escapeHtml(firstFormat)}</div>
                        </div>
                        <div class="all-album-meta-info">
                            <div class="all-album-title" title="${escapeHtml(albumTitle)}">${escapeHtml(albumTitle)}</div>
                            <div class="all-album-artist" title="${escapeHtml(albumArtist)}">${escapeHtml(albumArtist)}</div>
                            <div class="all-album-submeta">
                                <span class="player-type-badge-inline ${badgeInfo.class}">${badgeInfo.label}</span>
                                ${genreTagHtml}
                                <span>${yearStr}${tracksCountStr}</span>
                            </div>
                        </div>
                        <div class="all-album-actions">
                            <button type="button" class="btn-all-action btn-all-action-play btn-detail-alb-play" title="Lire tout l'album">
                                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                                <span>Lire tout</span>
                            </button>
                            <button type="button" class="btn-all-action btn-detail-alb-shuffle" title="Lire l'album en mode aléatoire">
                                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                                <span>Aléatoire</span>
                            </button>
                            <button type="button" class="btn-all-action btn-detail-alb-next" title="Lire l'album ensuite en tête de file">
                                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                                <span>Ensuite</span>
                            </button>
                            <button type="button" class="btn-all-action btn-detail-alb-queue" title="Ajouter tout l'album à la file">
                                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
                                <span>+ File</span>
                            </button>
                            <button type="button" class="btn-all-action btn-detail-alb-playlist" title="Ajouter tout cet album à une playlist">
                                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/></svg>
                                <span>➕ Playlist</span>
                            </button>
                        </div>
                    </div>

                    <!-- Volet Droit : Tracklist Complète Défilante -->
                    <div class="all-album-tracks player-tracklist-col">
                        ${tracksHtml}
                    </div>
                </div>
            `;

            if (isSameAlbumAlreadyOpen || preserveScroll) {
                this.restoreScrollPosition(currentDetailScrollY);
            } else if (isPlayingThisAlbum) {
                this.scrollToActiveTrack(true);
            } else {
                this.cancelPendingScrolls();
                this.restoreScrollPosition(0);
            }

            // OPT: Délégation d'événements — 1 seul listener sur le container
            // au lieu de N listeners sur N boutons (évite la pression GC)
            const block = detailBlock.querySelector(".player-all-album-block");
            if (block) {
                block.addEventListener("click", (e) => {
                    e.stopPropagation();

                    // --- Boutons d'action Album ---
                    if (e.target.closest(".btn-detail-alb-play")) {
                        this.loadAlbum(albumPath, { autoPlay: true, startTrackIndex: 0, isCollection: (this.librarySource === "library"), switchView: false });
                        return;
                    }
                    if (e.target.closest(".btn-detail-alb-shuffle")) {
                        this.loadAlbum(albumPath, { autoPlay: true, shuffle: true, isCollection: (this.librarySource === "library"), switchView: false });
                        return;
                    }
                    if (e.target.closest(".btn-detail-alb-next")) {
                        this.enqueueAlbum(albumPath, true);
                        return;
                    }
                    if (e.target.closest(".btn-detail-alb-queue")) {
                        this.enqueueAlbum(albumPath, false);
                        return;
                    }
                    if (e.target.closest(".btn-detail-alb-playlist")) {
                        if (typeof openAddToPlaylistModal === "function") {
                            openAddToPlaylistModal({
                                type: "album",
                                title: albumTitle,
                                artist: albumArtist,
                                path: albumPath,
                                tracks_count: rawTracks.length,
                                cover_url: coverUrl
                            });
                        }
                        return;
                    }

                    // --- Boutons d'action Piste ---
                    const trackItem = e.target.closest(".player-track-item");
                    if (!trackItem) return;
                    const trkIdx = parseInt(trackItem.getAttribute("data-trk-idx"), 10);

                    if (e.target.closest(".btn-detail-trk-play")) {
                        if (this.currentAlbum && this.activeAlbumPath === albumPath && this.playlist && this.playlist.length > 0) {
                            this.playTrackAtIndex(trkIdx);
                        } else {
                            this.loadAlbum(albumPath, { autoPlay: true, startTrackIndex: trkIdx, isCollection: (this.librarySource === "library"), switchView: false });
                        }
                        return;
                    }
                    if (e.target.closest(".btn-detail-trk-next")) {
                        if (rawTracks[trkIdx]) {
                            this.enqueueTrack(rawTracks[trkIdx], { title: albumTitle, artist: albumArtist, path: albumPath }, true);
                        }
                        return;
                    }
                    if (e.target.closest(".btn-detail-trk-enqueue")) {
                        if (rawTracks[trkIdx]) {
                            this.enqueueTrack(rawTracks[trkIdx], { title: albumTitle, artist: albumArtist, path: albumPath }, false);
                        }
                        return;
                    }
                    if (e.target.closest(".btn-detail-trk-playlist")) {
                        if (rawTracks[trkIdx]) {
                            const trk = rawTracks[trkIdx];
                            if (typeof openAddToPlaylistModal === "function") {
                                openAddToPlaylistModal({
                                    type: trk.type === "video" ? "video" : "audio",
                                    title: trk.title || trk.filename || "Piste",
                                    artist: trk.artist || albumArtist || "Artiste",
                                    duration: trk.duration_seconds || trk.duration || 0,
                                    path: trk.path || (albumPath ? `${albumPath}\\${trk.filename}` : trk.filename),
                                    album_title: albumTitle,
                                    cover_url: coverUrl
                                });
                            }
                        }
                        return;
                    }

                    // Clic direct sur la ligne de piste (hors boutons)
                    if (!e.target.closest(".btn-track-action")) {
                        if (this.currentAlbum && this.activeAlbumPath === albumPath && this.playlist && this.playlist.length > 0) {
                            this.playTrackAtIndex(trkIdx);
                        } else {
                            this.loadAlbum(albumPath, { autoPlay: true, startTrackIndex: trkIdx, isCollection: (this.librarySource === "library"), switchView: false });
                        }
                    }
                });
            }
        }
        this.updateScrollBounds();
    },

    closeAlbumDetail(restoreScroll = true) {
        if (!this.isAlbumDetailOpen) return;
        this.isAlbumDetailOpen = false;
        this.detailAlbumPath = null;
        this.detailAlbumTitle = null;
        this.detailAlbumArtist = null;
        this.detailAlbumTracksCount = 0;
        const gridView = document.getElementById("player-albums-grid");
        const detailView = document.getElementById("player-album-detail-view");
        if (detailView) detailView.style.display = "none";
        if (gridView) gridView.style.display = "grid";

        // Réafficher la barre de recherche/tri pour la grille des albums
        const toolbar = document.getElementById("player-toolbar-row");
        if (toolbar && this.currentView === "albums") toolbar.style.display = "flex";
        this.updateDetailContextBar();
        if (typeof syncPlayerControlsHeight === "function") syncPlayerControlsHeight();

        if (restoreScroll) {
            const savedY = (this.savedScrollPositions && typeof this.savedScrollPositions["albums"] === "number")
                ? this.savedScrollPositions["albums"]
                : 0;
            this.restoreScrollPosition(savedY);
        }
    },

    renderArtistsGrid() {
        const grid = document.getElementById("player-artists-grid");
        const counter = document.getElementById("player-count-indicator");
        if (!grid) return;

        try {
            const currentCols = localStorage.getItem("ytm_artists_cols") || "4";
            grid.classList.toggle("cols-3", currentCols === "3");
        } catch (_) {}

        // Regrouper par artiste
        const artistMap = new Map();
        this.libraryAlbums.forEach(alb => {
            const art = (alb.artist || "Artiste inconnu").trim();
            if (!artistMap.has(art)) {
                artistMap.set(art, { name: art, albumCount: 0, trackCount: 0 });
            }
            const data = artistMap.get(art);
            data.albumCount += 1;
            data.trackCount += (alb.tracks_count || 0);
        });

        let artists = Array.from(artistMap.values());

        // Filtrage recherche
        if (this.searchFilter && this.searchFilter.trim()) {
            const q = this.searchFilter.toLowerCase().trim();
            artists = artists.filter(a => a.name.toLowerCase().includes(q));
        }

        // Tri selon le mode sélectionné
        const artSort = this.sortModeArtists || "name-asc";
        artists.sort((a, b) => {
            const nameA = a.name.toLowerCase();
            const nameB = b.name.toLowerCase();
            switch (artSort) {
                case "name-asc":
                    return nameA.localeCompare(nameB);
                case "name-desc":
                    return nameB.localeCompare(nameA);
                case "albums-desc":
                    return (b.albumCount - a.albumCount) || nameA.localeCompare(nameB);
                case "albums-asc":
                    return (a.albumCount - b.albumCount) || nameA.localeCompare(nameB);
                case "tracks-desc":
                    return (b.trackCount - a.trackCount) || nameA.localeCompare(nameB);
                default:
                    return nameA.localeCompare(nameB);
            }
        });

        if (counter) {
            counter.textContent = `${artists.length} artiste${artists.length > 1 ? "s" : ""}`;
        }

        if (artists.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; padding: 40px 20px; text-align: center;">
                    <div style="font-size: 2.5rem; opacity: 0.5; margin-bottom: 8px;">🎤</div>
                    <h4 style="margin-bottom: 6px;">Aucun artiste trouvé</h4>
                    <p class="text-muted" style="font-size: 0.85rem;">Aucun artiste ne correspond aux critères.</p>
                </div>
            `;
            return;
        }

        let html = "";
        artists.forEach(art => {
            const initials = art.name.substring(0, 2).toUpperCase();
            html += `
                <div class="player-artist-card" data-artist="${escapeHtml(art.name)}">
                    <div class="player-artist-avatar">
                        <span>${escapeHtml(initials)}</span>
                    </div>
                    <div class="player-artist-info">
                        <div class="player-artist-name" title="${escapeHtml(art.name)}">${escapeHtml(art.name)}</div>
                        <div class="player-artist-count">${art.albumCount} album${art.albumCount > 1 ? "s" : ""} • ${art.trackCount} titre${art.trackCount > 1 ? "s" : ""}</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 4px; margin-left: 4px;">

                        <button type="button" class="btn-artist-shuffle" title="Lire la discographie de « ${escapeHtml(art.name)} » en aléatoire" data-artist="${escapeHtml(art.name)}">

                            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">

                                <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>

                            </svg>

                        </button>

                        <button type="button" class="btn-artist-search-online" title="Rechercher les nouveautés de « ${escapeHtml(art.name)} » en ligne (Mode Artiste strict & Non possédés)" data-artist="${escapeHtml(art.name)}">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                        </svg>
                    </button>

                    </div>
                </div>
            `;
        });

        grid.innerHTML = html;

        // OPT: Délégation d'événements — 1 seul listener permanent sur la grille artistes
        if (!grid._hasArtistDelegation) {
            grid._hasArtistDelegation = true;
            grid.addEventListener("click", (e) => {
                const card = e.target.closest(".player-artist-card");
                if (!card) return;
                const artName = card.getAttribute("data-artist");
                if (!artName) return;

                if (e.target.closest(".btn-artist-shuffle")) {
                    e.stopPropagation();
                    this.playFilteredCollection({ artist: artName, shuffle: true });
                    return;
                }

                if (e.target.closest(".btn-artist-search-online")) {
                    e.stopPropagation();
                    if (window.isPartyLockActive) return;
                    if (typeof window.searchArtistStrictUnowned === "function") {
                        window.searchArtistStrictUnowned(artName);
                    }
                    return;
                }

                this.selectedArtistFilter = artName;
                this.selectedGenreFilter = null;
                this.setView("albums");
            });
        }
        this.updateScrollBounds();
    },

    renderGenresGrid() {
        const grid = document.getElementById("player-genres-grid");
        const counter = document.getElementById("player-count-indicator");
        if (!grid) return;

        // Appliquer la densité sauvegardée (colonnes)
        let savedCols = "4";
        try {
            savedCols = localStorage.getItem("ytm_artists_cols") || "4";
        } catch (_) {}
        if (savedCols === "3") {
            grid.classList.add("cols-3");
        } else {
            grid.classList.remove("cols-3");
        }

        // Regrouper par genre
        const genreMap = new Map();
        this.libraryAlbums.forEach(alb => {
            let g = (alb.genre || "").trim();
            if (!g) g = "Non classé";
            if (!genreMap.has(g)) {
                genreMap.set(g, { name: g, albumCount: 0, trackCount: 0 });
            }
            const gData = genreMap.get(g);
            gData.albumCount += 1;
            gData.trackCount += (alb.tracks_count || (alb.tracks ? alb.tracks.length : 0));
        });

        let genres = Array.from(genreMap.values());

        // Filtrage recherche
        if (this.searchFilter && this.searchFilter.trim()) {
            const q = this.searchFilter.toLowerCase().trim();
            genres = genres.filter(g => g.name.toLowerCase().includes(q));
        }

        // Tri selon le mode sélectionné
        const genSort = this.sortModeGenres || "albums-desc";
        genres.sort((a, b) => {
            const nameA = a.name.toLowerCase();
            const nameB = b.name.toLowerCase();
            switch (genSort) {
                case "albums-desc":
                    return (b.albumCount - a.albumCount) || nameA.localeCompare(nameB);
                case "albums-asc":
                    return (a.albumCount - b.albumCount) || nameA.localeCompare(nameB);
                case "tracks-desc":
                    return (b.trackCount - a.trackCount) || nameA.localeCompare(nameB);
                case "name-asc":
                    return nameA.localeCompare(nameB);
                case "name-desc":
                    return nameB.localeCompare(nameA);
                default:
                    return (b.albumCount - a.albumCount) || nameA.localeCompare(nameB);
            }
        });

        if (counter) {
            counter.textContent = `${genres.length} genre${genres.length > 1 ? "s" : ""}`;
        }

        if (genres.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; padding: 40px 20px; text-align: center;">
                    <div style="font-size: 2.5rem; opacity: 0.5; margin-bottom: 8px;">🏷️</div>
                    <h4 style="margin-bottom: 6px;">Aucun genre trouvé</h4>
                    <p class="text-muted" style="font-size: 0.85rem;">Aucun genre disponible.</p>
                </div>
            `;
            return;
        }

        let html = "";
        genres.forEach(g => {
            const isUnclassified = g.name.toLowerCase() === "non classé" || g.name.toLowerCase() === "unclassified";
            html += `
                <div class="player-genre-card" data-genre="${escapeHtml(g.name)}">
                    <div class="player-genre-avatar">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                            <path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/>
                        </svg>
                    </div>
                    <div class="player-genre-info">
                        <div class="player-genre-name" title="${escapeHtml(g.name)}">${escapeHtml(g.name)}</div>
                        <div class="player-genre-count">${g.albumCount} album${g.albumCount > 1 ? "s" : ""}${g.trackCount ? ` • ${g.trackCount} titre${g.trackCount > 1 ? "s" : ""}` : ""}</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 4px; margin-left: 4px;">
                        <button type="button" class="btn-genre-shuffle" title="Lire le genre « ${escapeHtml(g.name)} » en aléatoire" data-genre="${escapeHtml(g.name)}">
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                                <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
                            </svg>
                        </button>
                        ${!isUnclassified ? `
                        <button type="button" class="btn-genre-search-online" title="Rechercher des albums de genre « ${escapeHtml(g.name)} » en ligne (Albums & Non possédés)" data-genre="${escapeHtml(g.name)}">
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                            </svg>
                        </button>
                        ` : ''}
                    </div>
                </div>
            `;
        });

        grid.innerHTML = html;

        // OPT: Délégation d'événements — 1 seul listener permanent sur la grille genres
        if (!grid._hasGenreDelegation) {
            grid._hasGenreDelegation = true;
            grid.addEventListener("click", (e) => {
                const card = e.target.closest(".player-genre-card");
                if (!card) return;
                const gName = card.getAttribute("data-genre");
                if (!gName) return;

                if (e.target.closest(".btn-genre-shuffle")) {
                    e.stopPropagation();
                    this.playFilteredCollection({ genre: gName, shuffle: true });
                    return;
                }

                if (e.target.closest(".btn-genre-search-online")) {
                    e.stopPropagation();
                    if (window.isPartyLockActive) return;
                    if (typeof window.searchGenreOnline === "function") {
                        window.searchGenreOnline(gName);
                    }
                    return;
                }

                this.selectedGenreFilter = gName;
                this.selectedArtistFilter = null;
                this.setView("albums");
            });
        }
        this.updateScrollBounds();
    },

    // =========================================================
    // VUE « TOUT » : CATALOGUE GLOBAL & RECHERCHE DYNAMIQUE
    // =========================================================

    setAllCatalogPreparingState(isPreparing, hasError = false) {
        const btn = document.getElementById("player-subtab-all");
        const refreshIndicator = document.getElementById("player-catalog-refresh-indicator");
        const refreshText = document.getElementById("player-catalog-refresh-text");

        if (isPreparing) {
            if (btn) {
                btn.classList.add("is-preparing", "tab-disabled");
                btn.title = "Rafraîchissement et préparation du catalogue complet...";
                btn.innerHTML = `<span class="subtab-all-icon">🌐</span> <span class="subtab-all-label">Tout</span>`;
            }
            if (refreshIndicator) {
                refreshIndicator.classList.add("visible");
                if (refreshText) refreshText.textContent = "Rafraîchissement…";
            }
        } else if (hasError) {
            if (btn) {
                btn.classList.remove("is-preparing");
                btn.classList.add("tab-disabled");
                btn.title = "Erreur lors du rafraîchissement du catalogue complet";
                btn.innerHTML = `<span class="subtab-all-icon">⚠️</span> <span class="subtab-all-label">Tout</span>`;
            }
            if (refreshIndicator) {
                refreshIndicator.classList.add("visible");
                if (refreshText) refreshText.textContent = "Erreur rafraîchissement";
                setTimeout(() => {
                    refreshIndicator.classList.remove("visible");
                }, 4000);
            }
        } else {
            if (btn) {
                btn.classList.remove("is-preparing", "tab-disabled");
                btn.title = "Tout le catalogue (vue continue et recherche globale)";
                btn.innerHTML = `<span class="subtab-all-icon">🌐</span> <span class="subtab-all-label">Tout</span>`;
            }
            if (refreshIndicator) {
                refreshIndicator.classList.remove("visible");
            }
        }
    },

    async prefetchAllCatalog(force = false) {
        if (this.isCatalogReady && !force && this.allCatalog) {
            return;
        }
        if (this._prefetchPromise && !force) {
            return this._prefetchPromise;
        }

        this._prefetchPromise = (async () => {
            this.isLoadingCatalog = true;
            this.isCatalogReady = false;
            this.setAllCatalogPreparingState(true);

            try {
                const res = await fetch(`/api/library/catalog?source=${encodeURIComponent(this.librarySource)}`);
                if (!res.ok) throw new Error("Erreur HTTP " + res.status + " lors du chargement du catalogue");
                const data = await res.json();
                this.allCatalog = data;
                if (this._pendingAllCollectionHydration) {
                    this.hydrateRestoredAllCollection();
                }

                // Indexation instantanée pour recherche (< 1ms pour l'ensemble des pistes)
                if (this.allCatalog && this.allCatalog.albums) {
                    this.allCatalog.albums.forEach(alb => {
                        const albPart = `${alb.title || ""} ${alb.artist || ""}`.toLowerCase();
                        (alb.tracks || []).forEach(trk => {
                            trk._haystack = `${albPart} ${trk.title || ""} ${trk.artist || ""}`.toLowerCase();
                        });
                    });
                }

                // Rendu intelligent dans le conteneur #player-all-container
                const allContainer = document.getElementById("player-all-container");
                const hasExistingBlocks = Boolean(allContainer && allContainer.querySelector(".player-all-album-block"));

                if (!hasExistingBlocks) {
                    this.renderCatalogAlbums();
                    if (this.currentView === "all" && (this.isPlaying || this.currentIndex >= 0)) {
                        this.updateActiveTrackInAllContainer();
                        setTimeout(() => this.scrollToActiveTrack(true), 60);
                    }
                } else {
                    // Les blocs d'albums sont déjà rendus : ne JAMAIS écraser le DOM pendant la lecture !
                    if (this.currentView === "all") {
                        this.updateActiveTrackInAllContainer();
                    }
                }

                this.isCatalogReady = true;
                this.setAllCatalogPreparingState(false);
            } catch (err) {
                console.error("Erreur prefetchAllCatalog:", err);
                this.isCatalogReady = false;
                this.setAllCatalogPreparingState(false, true);
            } finally {
                this.isLoadingCatalog = false;
                this._prefetchPromise = null;
            }
        })();

        return this._prefetchPromise;
    },

    async loadAndRenderAllCatalog(force = false) {
        const container = document.getElementById("player-all-container");
        const hasExistingBlocks = Boolean(container && container.querySelector(".player-all-album-block"));
        if (!this.isCatalogReady || force) {
            if (container && (!this.allCatalog || force) && !hasExistingBlocks) {
                container.innerHTML = `
                    <div style="padding: 40px 20px; text-align: center;">
                        <span class="spinner" style="display:inline-block;width:24px;height:24px;margin-bottom:12px;vertical-align:middle;"></span>
                        <p class="text-muted" style="font-size: 0.9rem;">Chargement du catalogue complet...</p>
                    </div>
                `;
            }
            try {
                await this.prefetchAllCatalog(force);
            } catch (err) {
                if (container && !hasExistingBlocks) {
                    container.innerHTML = `
                        <div class="empty-state" style="padding: 40px 20px; text-align: center;">
                            <div style="font-size: 2.5rem; opacity: 0.5; margin-bottom: 8px;">⚠️</div>
                            <h4>Impossible de charger le catalogue</h4>
                            <p class="text-muted" style="font-size: 0.88rem; max-width: 480px; margin: 0 auto 16px auto;">${escapeHtml(err.message)}</p>
                            <button type="button" class="btn btn-secondary" onclick="AudioPlayer.loadAndRenderAllCatalog(true)">Réessayer</button>
                        </div>
                    `;
                }
                return;
            }
        }
        if (this.currentView === "all") {
            this.renderAllView();
            this.updateScrollBounds();
        }
    },

    updateActiveTrackInAllContainer() {
        const allContainer = document.getElementById("player-all-container");
        if (!allContainer) return;

        const curTrack = (this.activePlaylist && this.activePlaylist[this.currentIndex]) || (this.playlist && this.playlist[this.currentIndex]);
        const curTrackPath = curTrack ? (curTrack.filepath || curTrack.path || "") : "";
        const curAlbPath = curTrack ? (curTrack.album_path || (this.activeAlbumPath && !this.activeAlbumPath.startsWith("system:") && !this.activeAlbumPath.startsWith("playlist:") ? this.activeAlbumPath : "")) : "";

        // 1. Trouver l'élément piste cible et le bloc album cible
        let targetTrack = null;
        let targetBlock = null;

        // Stratégie A : Recherche directe par attribut data-track-path (100% robuste sur chemins Windows sans parsing CSS)
        if (curTrackPath) {
            const items = allContainer.querySelectorAll(".player-track-item, .dense-track-row");
            const curNorm = curTrackPath.replace(/\\/g, "/").toLowerCase();
            for (let i = 0; i < items.length; i++) {
                const p = items[i].getAttribute("data-track-path");
                if (!p) continue;
                if (p === curTrackPath || p.replace(/\\/g, "/").toLowerCase() === curNorm) {
                    targetTrack = items[i];
                    break;
                }
            }
        }

        // Stratégie B : Recherche par chemin d'album et index de piste
        if (!targetTrack && this.activeAlbumPath && !this.activeAlbumPath.startsWith("system:") && !this.activeAlbumPath.startsWith("playlist:")) {
            const albNorm = this.activeAlbumPath.replace(/\\/g, "/").toLowerCase();
            const items = allContainer.querySelectorAll(".player-track-item, .dense-track-row");
            for (let i = 0; i < items.length; i++) {
                const ap = items[i].getAttribute("data-alb-path");
                if (ap && ap.replace(/\\/g, "/").toLowerCase() === albNorm) {
                    const idxStr = items[i].getAttribute("data-trk-idx");
                    if (idxStr !== null && parseInt(idxStr, 10) === this.currentIndex) {
                        targetTrack = items[i];
                        break;
                    }
                }
            }
        }

        // Stratégie C : Recherche dans le bloc album par titre de morceau
        if (!targetTrack && curAlbPath && curTrack) {
            const curAlbNorm = curAlbPath.replace(/\\/g, "/").toLowerCase();
            const blocks = allContainer.querySelectorAll(".player-all-album-block");
            let albBlock = null;
            for (let i = 0; i < blocks.length; i++) {
                const ap = blocks[i].getAttribute("data-alb-path");
                if (ap && ap.replace(/\\/g, "/").toLowerCase() === curAlbNorm) {
                    albBlock = blocks[i];
                    break;
                }
            }
            if (albBlock) {
                const trkNum = curTrack.track_number ? parseInt(curTrack.track_number, 10) : null;
                const trackItems = albBlock.querySelectorAll(".player-track-item");
                if (trkNum !== null && !isNaN(trkNum) && trkNum > 0 && trackItems[trkNum - 1]) {
                    targetTrack = trackItems[trkNum - 1];
                }
                if (!targetTrack && curTrack.title) {
                    const titleLower = curTrack.title.trim().toLowerCase();
                    for (let i = 0; i < trackItems.length; i++) {
                        const tEl = trackItems[i].querySelector(".player-track-item-title");
                        if (tEl && tEl.textContent.trim().toLowerCase() === titleLower) {
                            targetTrack = trackItems[i];
                            break;
                        }
                    }
                }
            }
        }

        // Déterminer le bloc album parent actif
        if (targetTrack) {
            targetBlock = targetTrack.closest(".player-all-album-block");
        }
        if (!targetBlock && curAlbPath) {
            const curAlbNorm = curAlbPath.replace(/\\/g, "/").toLowerCase();
            const blocks = allContainer.querySelectorAll(".player-all-album-block");
            for (let i = 0; i < blocks.length; i++) {
                const ap = blocks[i].getAttribute("data-alb-path");
                if (ap && ap.replace(/\\/g, "/").toLowerCase() === curAlbNorm) {
                    targetBlock = blocks[i];
                    break;
                }
            }
        }

        // 2. Mettre à jour les classes sur les blocs d'albums
        allContainer.querySelectorAll(".player-all-album-block.is-active-album").forEach(block => {
            if (block !== targetBlock) {
                block.classList.remove("is-active-album");
            }
        });
        if (targetBlock) {
            targetBlock.classList.add("is-active-album");
        }

        // 3. Mettre à jour les pistes et l'égaliseur animé
        allContainer.querySelectorAll(".player-track-item.active, .dense-track-row.active").forEach(el => {
            if (el !== targetTrack) {
                el.classList.remove("active");
                const eq = el.querySelector(".player-equalizer-bars");
                if (eq) eq.style.display = "none";
            }
        });

        if (targetTrack) {
            targetTrack.classList.add("active");
            const eq = targetTrack.querySelector(".player-equalizer-bars");
            if (eq) eq.style.display = this.isPlaying ? "inline-flex" : "none";
        }
    },

    renderAllView(force = false) {
        const container = document.getElementById("player-all-container");
        if (!container) return;

        if (!this.allCatalog || !this.allCatalog.albums) {
            this.loadAndRenderAllCatalog();
            return;
        }

        const q = (this.allSearchQuery || "").trim().toLowerCase();
        if (q.length > 0) {
            this.renderCatalogSearch(q);
        } else {
            const hasBlocks = container.firstElementChild && container.querySelector(".player-all-album-block");
            if (hasBlocks && !force) {
                this.updateActiveTrackInAllContainer();
                return;
            }
            this.renderCatalogAlbums();
        }
    },

    _buildCatalogAlbumBlockHtml(alb, albIdx) {
        const curTrack = (this.activePlaylist && this.activePlaylist[this.currentIndex]) || (this.playlist && this.playlist[this.currentIndex]);
        const curTrackPath = curTrack ? (curTrack.filepath || curTrack.path || "") : "";
        const curAlbPath = curTrack ? (curTrack.album_path || (this.activeAlbumPath && !this.activeAlbumPath.startsWith("system:") && !this.activeAlbumPath.startsWith("playlist:") ? this.activeAlbumPath : "")) : "";
        const isPlayingThisAlbum = Boolean(
            (curAlbPath && curAlbPath === alb.path) ||
            (this.activeAlbumPath && this.activeAlbumPath === alb.path)
        );
        const coverUrl = alb.cover_url || `/api/audio/cover?path=${encodeURIComponent(alb.path)}`;
        const yearStr = alb.year ? `📅 ${escapeHtml(String(alb.year))} • ` : "";
        const tracksCountStr = `${alb.tracks_count || (alb.tracks ? alb.tracks.length : 0)} titre(s)`;

        let tracksHtml = "";
        (alb.tracks || []).forEach((trk, trkIdx) => {
            const trkPath = trk.filepath || trk.path || "";
            const normCurTrackPath = curTrackPath ? curTrackPath.replace(/\\/g, "/").toLowerCase() : "";
            const normTrkPath = trkPath ? trkPath.replace(/\\/g, "/").toLowerCase() : "";
            const isThisTrackPlaying = Boolean(
                (normCurTrackPath && normTrkPath && normCurTrackPath === normTrkPath) ||
                (isPlayingThisAlbum && curTrack && curTrack.title && trk.title && curTrack.title.trim().toLowerCase() === trk.title.trim().toLowerCase())
            );
            const numStr = trk.track_number ? String(trk.track_number).padStart(2, '0') : String(trkIdx + 1).padStart(2, '0');

            tracksHtml += `
                <div class="player-track-item ${isThisTrackPlaying ? "active" : ""}" data-alb-idx="${albIdx}" data-trk-idx="${trkIdx}" data-alb-path="${escapeHtml(alb.path)}" data-track-path="${escapeHtml(trkPath)}">
                    <div class="player-track-item-left">
                        <span class="player-equalizer-bars" style="display: ${isThisTrackPlaying && this.isPlaying ? "inline-flex" : "none"};">
                            <span class="player-equalizer-bar"></span>
                            <span class="player-equalizer-bar"></span>
                            <span class="player-equalizer-bar"></span>
                        </span>
                        <span class="player-track-item-num">${numStr}</span>
                        <span class="player-track-item-title" title="${escapeHtml(trk.title)}">${escapeHtml(trk.title)}</span>
                    </div>
                    <div class="player-track-actions">
                        <button type="button" class="btn-track-action btn-cat-track-play" title="Lire immédiatement ce morceau">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                            <span>Lire</span>
                        </button>
                        <button type="button" class="btn-track-action btn-cat-track-next" title="Lire ce titre ensuite (priorité)">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                            <span>Ensuite</span>
                        </button>
                        <button type="button" class="btn-track-action btn-cat-track-enqueue" title="Ajouter à la file d'attente">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
                            <span>+ File</span>
                        </button>
                        <button type="button" class="btn-track-action btn-cat-track-playlist" title="Ajouter ce titre à une playlist">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/></svg>
                            <span>+ Playlist</span>
                        </button>
                    </div>
                    <span class="dense-track-format">${escapeHtml(this.formatTrackBadge(trk))}</span>
                    <span class="player-track-item-dur">${escapeHtml(trk.duration || "--:--")}</span>
                </div>
            `;
        });

        const albType = this.getAlbumType(alb);
        const badgeInfo = this.getAlbumTypeBadgeInfo(albType);
        const albumGenre = (alb.genre || (alb.tracks && alb.tracks[0] && alb.tracks[0].genre) || "").trim();
        const genreTagHtml = albumGenre
            ? `<span class="player-card-genre-tag" title="Genre : ${escapeHtml(albumGenre)}"><svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" class="genre-tag-icon"><path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/></svg><span>${escapeHtml(albumGenre)}</span></span>`
            : "";

        return `
            <div class="player-all-album-block ${isPlayingThisAlbum ? "is-active-album" : ""}" data-alb-idx="${albIdx}" data-alb-path="${escapeHtml(alb.path)}">
                <!-- Volet Gauche : Pochette & Métadonnées Album -->
                <div class="all-album-sidebar">
                    <div class="all-album-cover-box">
                        <img class="all-album-cover-img" src="${coverUrl}" alt="Cover" loading="lazy" decoding="async" onerror="window.handleCoverError(this);">
                        <div class="player-format-badge">${alb.tracks && alb.tracks[0] ? escapeHtml(alb.tracks[0].format || "M4A") : "M4A"}</div>
                    </div>
                    <div class="all-album-meta-info">
                        <div class="all-album-title" title="${escapeHtml(alb.title)}">${escapeHtml(alb.title)}</div>
                        <div class="all-album-artist" title="${escapeHtml(alb.artist)}">${escapeHtml(alb.artist)}</div>
                        <div class="all-album-submeta">
                            <span class="player-type-badge-inline ${badgeInfo.class}">${badgeInfo.label}</span>
                            ${genreTagHtml}
                            <span>${yearStr}${tracksCountStr}</span>
                        </div>
                    </div>
                    <div class="all-album-actions">
                        <button type="button" class="btn-all-action btn-all-action-play btn-cat-alb-play" title="Lire tout l'album">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                            <span>Lire tout</span>
                        </button>
                        <button type="button" class="btn-all-action btn-cat-alb-shuffle" title="Lire uniquement cet album en mode aléatoire">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                            <span>Aléatoire album</span>
                        </button>
                        <button type="button" class="btn-all-action btn-cat-alb-next" title="Lire l'album ensuite en tête de file">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                            <span>Ensuite</span>
                        </button>
                        <button type="button" class="btn-all-action btn-cat-alb-queue" title="Ajouter tout l'album à la file">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
                            <span>+ File</span>
                        </button>
                        <button type="button" class="btn-all-action btn-cat-alb-playlist" title="Ajouter tout cet album à une playlist">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/></svg>
                            <span>+ Playlist</span>
                        </button>
                    </div>
                </div>

                <!-- Volet Droit : Tracklist Complète Défilante -->
                <div class="all-album-tracks">
                    ${tracksHtml}
                </div>
            </div>
        `;
    },

    _buildDenseSearchRowHtml(item, matchIdx, query, isCurrentAlbumActive) {
        const trk = item.track;
        const alb = item.album;
        const trkIdx = item.trackIndex;
        const trkPath = trk.filepath || trk.path || "";
        const curTrack = (this.activePlaylist && this.activePlaylist[this.currentIndex]) || (this.playlist && this.playlist[this.currentIndex]);
        const curTrackPath = curTrack ? (curTrack.filepath || curTrack.path || "") : "";
        const isThisTrackPlaying = Boolean(
            (curTrackPath && trkPath && curTrackPath === trkPath) ||
            (isCurrentAlbumActive && (this.activeAlbumPath === alb.path) && (this.currentIndex === trkIdx))
        );
        const numStr = trk.track_number ? String(trk.track_number).padStart(2, '0') : String(trkIdx + 1).padStart(2, '0');

        const highlightedTitle = this.highlightMatch(trk.title, query);
        const highlightedArtist = this.highlightMatch(trk.artist || alb.artist, query);
        const highlightedAlbum = this.highlightMatch(alb.title, query);

        return `
            <div class="dense-track-row ${isThisTrackPlaying ? "active" : ""}" data-match-idx="${matchIdx}" data-alb-path="${escapeHtml(alb.path)}" data-trk-idx="${trkIdx}" data-track-path="${escapeHtml(trkPath)}">
                <!-- Colonne Gauche : Artiste & Album (sans pochette) -->
                <div class="dense-col-origin">
                    <div class="dense-artist" title="${escapeHtml(trk.artist || alb.artist)}">${highlightedArtist}</div>
                    <div class="dense-album" title="${escapeHtml(alb.title)}">${highlightedAlbum}</div>
                </div>

                <!-- Colonne Droite : Piste, Actions & Durée -->
                <div class="dense-col-track">
                    <div class="dense-track-info">
                        <span class="player-equalizer-bars" style="display: ${isThisTrackPlaying && this.isPlaying ? "inline-flex" : "none"};">
                            <span class="player-equalizer-bar"></span>
                            <span class="player-equalizer-bar"></span>
                            <span class="player-equalizer-bar"></span>
                        </span>
                        <span class="dense-track-num">${numStr}</span>
                        <span class="dense-track-title" title="${escapeHtml(trk.title)}">${highlightedTitle}</span>
                    </div>
                    <div class="dense-track-actions">
                        <button type="button" class="btn-track-action btn-dense-play" title="Lire ce morceau immédiatement">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                            <span>Lire</span>
                        </button>
                        <button type="button" class="btn-track-action btn-dense-next" title="Lire ce titre ensuite (priorité)">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                            <span>Ensuite</span>
                        </button>
                        <button type="button" class="btn-track-action btn-dense-enqueue" title="Ajouter à la file d'attente">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
                            <span>+ File</span>
                        </button>
                        <button type="button" class="btn-track-action btn-dense-playlist" title="Ajouter ce titre à une playlist">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/></svg>
                            <span>+ Playlist</span>
                        </button>
                    </div>
                    <span class="dense-track-format">${escapeHtml(this.formatTrackBadge(trk))}</span>
                    <span class="dense-track-dur">${escapeHtml(trk.duration || "--:--")}</span>
                </div>
            </div>
        `;
    },

    async playTrackInAllCollection(alb, trkIdx, trackObj = null) {
        if (!alb) return;

        // Si la collection complète est déjà chargée dans this.playlist, retrouver directement le morceau sans tout reconstruire
        if (this.currentAlbum && this.currentAlbum.path === "system:all-collection" && this.playlist && this.playlist.length > 0) {
            let targetIdx = -1;
            const targetFp = (trackObj && (trackObj.filepath || trackObj.path))
                ? (trackObj.filepath || trackObj.path)
                : (alb.tracks && alb.tracks[trkIdx] ? (alb.tracks[trkIdx].filepath || alb.tracks[trkIdx].path) : "");

            if (targetFp) {
                const normFp = targetFp.replace(/\\/g, "/").toLowerCase();
                targetIdx = this.playlist.findIndex(t => (t.filepath || t.path || "").replace(/\\/g, "/").toLowerCase() === normFp);
            }
            if (targetIdx < 0 && alb.path) {
                const normAlb = (alb.path || "").replace(/\\/g, "/").toLowerCase();
                targetIdx = this.playlist.findIndex(t => (t.album_path || "").replace(/\\/g, "/").toLowerCase() === normAlb && (t.track_number === (trkIdx + 1) || String(t.id).endsWith(`-${trkIdx}`)));
            }
            if (targetIdx < 0) {
                const trkTitle = trackObj ? trackObj.title : (alb.tracks && alb.tracks[trkIdx] ? alb.tracks[trkIdx].title : null);
                if (trkTitle) {
                    const normTitle = trkTitle.toLowerCase().trim();
                    const normAlb = (alb.path || "").replace(/\\/g, "/").toLowerCase();
                    targetIdx = this.playlist.findIndex(t => (t.album_path || "").replace(/\\/g, "/").toLowerCase() === normAlb && (t.title || "").toLowerCase().trim() === normTitle);
                }
            }

            if (targetIdx >= 0) {
                this.currentIndex = targetIdx;
                if (this.playbackContext) this.playbackContext.currentIndex = targetIdx;
                this.playTrackAtIndex(targetIdx);
                if (typeof this.updateActiveTrackInAllContainer === "function") {
                    this.updateActiveTrackInAllContainer();
                }
                setTimeout(() => this.scrollToActiveTrack(true), 100);
                return;
            }
        }

        // Sinon, construire la liste ordonnée des pistes de toute la collection
        const catalogAlbums = (this._currentCatalogAlbums && this._currentCatalogAlbums.length > 0)
            ? this._currentCatalogAlbums
            : ((this.allCatalog && Array.isArray(this.allCatalog.albums)) ? this.allCatalog.albums : (this.libraryAlbums || []));

        if (!catalogAlbums || catalogAlbums.length === 0) {
            this.loadAlbum(alb.path, { autoPlay: true, startTrackIndex: trkIdx, isCollection: (this.librarySource === "library"), switchView: false });
            return;
        }

        const allTracks = [];
        for (const a of catalogAlbums) {
            const cover = a.cover_url || `/api/audio/cover?path=${encodeURIComponent(a.path)}`;
            const albTitle = a.title || "";
            const albArtist = a.artist || "";
            const albPath = a.path || "";
            const rawTracks = (a.tracks || []).slice().sort((t1, t2) => (parseInt(t1.track_number, 10) || 0) - (parseInt(t2.track_number, 10) || 0));
            for (let idx = 0; idx < rawTracks.length; idx++) {
                const t = rawTracks[idx];
                const fp = t.filepath || t.path || "";
                const ext = fp.substring(fp.lastIndexOf(".")).toUpperCase().replace(".", "");
                const isVid = Boolean(t.is_video || t.type === "video" || ext === "MP4" || ext === "MKV" || ext === "WEBM");
                const isConc = Boolean(t.is_concert || a.is_concert || (isVid && (fp.toLowerCase().includes("[concert]") || fp.toLowerCase().includes("concert") || fp.toLowerCase().includes("live") || fp.toLowerCase().includes("tour"))));
                allTracks.push({
                    id: `collection-${albPath}-${idx}`,
                    type: isVid ? "video" : "audio",
                    title: t.title || t.filename || `Piste ${idx + 1}`,
                    artist: t.artist || albArtist || "Artiste inconnu",
                    album: t.album || albTitle || "Album",
                    album_path: albPath,
                    duration: t.duration || "--:--",
                    duration_seconds: t.duration_seconds || 0,
                    path: fp,
                    filepath: fp,
                    rel_path: fp,
                    format: ext || t.format || "M4A",
                    stream_url: t.stream_url || `/api/audio/stream-local?path=${encodeURIComponent(fp)}`,
                    cover_url: cover,
                    thumbnail_url: cover,
                    track_number: t.track_number || (idx + 1),
                    is_video: isVid,
                    is_concert: isConc
                });
            }
        }

        if (allTracks.length === 0) {
            this.loadAlbum(alb.path, { autoPlay: true, startTrackIndex: trkIdx, isCollection: (this.librarySource === "library"), switchView: false });
            return;
        }

        let targetIdx = -1;
        const targetFp = (trackObj && (trackObj.filepath || trackObj.path))
            ? (trackObj.filepath || trackObj.path)
            : (alb.tracks && alb.tracks[trkIdx] ? (alb.tracks[trkIdx].filepath || alb.tracks[trkIdx].path) : "");

        if (targetFp) {
            const normFp = targetFp.replace(/\\/g, "/").toLowerCase();
            targetIdx = allTracks.findIndex(t => (t.filepath || t.path || "").replace(/\\/g, "/").toLowerCase() === normFp);
        }
        if (targetIdx < 0 && alb.path) {
            const normAlb = (alb.path || "").replace(/\\/g, "/").toLowerCase();
            targetIdx = allTracks.findIndex(t => (t.album_path || "").replace(/\\/g, "/").toLowerCase() === normAlb && (t.track_number === (trkIdx + 1) || String(t.id).endsWith(`-${trkIdx}`)));
        }
        if (targetIdx < 0) {
            const trkTitle = trackObj ? trackObj.title : (alb.tracks && alb.tracks[trkIdx] ? alb.tracks[trkIdx].title : null);
            if (trkTitle) {
                const normTitle = trkTitle.toLowerCase().trim();
                const normAlb = (alb.path || "").replace(/\\/g, "/").toLowerCase();
                targetIdx = allTracks.findIndex(t => (t.album_path || "").replace(/\\/g, "/").toLowerCase() === normAlb && (t.title || "").toLowerCase().trim() === normTitle);
            }
        }
        if (targetIdx < 0) targetIdx = 0;

        // Conserver STRICTEMENT les options de lecture de l'utilisateur (isShuffle et repeatMode)
        const currentTargetTrack = allTracks[targetIdx];
        this.currentAlbum = {
            title: "🌍 Toute la Collection",
            artist: `${catalogAlbums.length} albums • ${allTracks.length} pistes`,
            year: "",
            genre: "Collection",
            cover_url: currentTargetTrack?.cover_url || alb.cover_url || "/static/placeholder-cover.svg",
            path: "system:all-collection",
            is_playlist: true,
            is_collection: true
        };
        this.activeAlbumPath = "system:all-collection";
        this.playlist = allTracks;
        this.activePlaylist = allTracks.slice();
        this.currentIndex = targetIdx;
        this.playbackContext = {
            album: this.currentAlbum,
            playlist: allTracks.slice(),
            currentIndex: targetIdx
        };
        this.isUserPlaylistActive = true;
        this.playbackOrigin = { view: "all", type: "all", path: "system:all-collection" };

        this.renderPlayerTab();
        if (typeof this.updateActiveTrackInAllContainer === "function") {
            this.updateActiveTrackInAllContainer();
        }
        if (this.isQueueDrawerOpen && typeof this.renderQueueDrawer === "function") {
            this.renderQueueDrawer();
        }
        this.updateMiniDockVisibility();
        this.playTrackAtIndex(targetIdx);
        setTimeout(() => this.scrollToActiveTrack(true), 100);
    },

    ensureAllContainerDelegation(container) {
        if (!container || container._hasAllDelegation) return;
        container._hasAllDelegation = true;

        container.addEventListener("click", (e) => {
            // ── ACTIONS BANNIÈRE GLOBALE ──
            if (e.target.closest(".btn-all-global-shuffle") || e.target.closest(".btn-all-collection-shuffle")) {
                e.stopPropagation();
                this.playEntireCollection({ shuffle: true });
                return;
            }
            if (e.target.closest(".btn-all-global-play") || e.target.closest(".btn-all-collection-play")) {
                e.stopPropagation();
                this.playEntireCollection({ shuffle: false });
                return;
            }
            if (e.target.closest(".btn-search-results-shuffle")) {
                e.stopPropagation();
                if (this._currentCatalogMatches && this._currentCatalogMatches.length > 0) {
                    this.playSearchResults(this._currentCatalogMatches, true);
                } else {
                    this.playEntireCollection({ shuffle: true });
                }
                return;
            }

            // ── 1. MODE CATALOGUE CONTINU ──
            const albBlock = e.target.closest(".player-all-album-block");
            if (albBlock) {
                const albIdx = parseInt(albBlock.getAttribute("data-alb-idx"), 10);
                const alb = (this._currentCatalogAlbums && this._currentCatalogAlbums[albIdx])
                    ? this._currentCatalogAlbums[albIdx]
                    : ((this.allCatalog && this.allCatalog.albums) ? this.allCatalog.albums.find(a => a.path === albBlock.getAttribute("data-alb-path")) : null);

                // Action Lire tout album
                if (e.target.closest(".btn-cat-alb-play")) {
                    e.stopPropagation();
                    this.playTrackInAllCollection(alb, 0, alb.tracks ? alb.tracks[0] : null);
                    return;
                }
                // Action Aléatoire album
                if (e.target.closest(".btn-cat-alb-shuffle")) {
                    e.stopPropagation();
                    this.loadAlbum(alb.path, { autoPlay: true, shuffle: true, isCollection: (this.librarySource === "library"), switchView: false });
                    return;
                }
                // Action Ensuite album
                if (e.target.closest(".btn-cat-alb-next")) {
                    e.stopPropagation();
                    this.enqueueAlbum(alb.path, true);
                    return;
                }
                // Action + File album
                if (e.target.closest(".btn-cat-alb-queue")) {
                    e.stopPropagation();
                    this.enqueueAlbum(alb.path, false);
                    return;
                }
                // Action + Playlist album
                if (e.target.closest(".btn-cat-alb-playlist")) {
                    e.stopPropagation();
                    if (typeof openAddToPlaylistModal === "function") {
                        openAddToPlaylistModal({
                            type: "album",
                            title: alb.title || "Album",
                            artist: alb.artist || "Artiste",
                            path: alb.path,
                            tracks_count: alb.tracks_count || (alb.tracks ? alb.tracks.length : 0),
                            cover_url: alb.cover_url || `/api/audio/cover?path=${encodeURIComponent(alb.path)}`
                        });
                    }
                    return;
                }

                // Actions Piste
                const trkItem = e.target.closest(".player-track-item");
                if (trkItem) {
                    const trkIdx = parseInt(trkItem.getAttribute("data-trk-idx"), 10);
                    if (e.target.closest(".btn-cat-track-play")) {
                        e.stopPropagation();
                        this.playTrackInAllCollection(alb, trkIdx, alb.tracks ? alb.tracks[trkIdx] : null);
                        return;
                    }
                    if (e.target.closest(".btn-cat-track-next")) {
                        e.stopPropagation();
                        if (alb.tracks && alb.tracks[trkIdx]) {
                            this.enqueueTrack(alb.tracks[trkIdx], alb, true);
                        }
                        return;
                    }
                    if (e.target.closest(".btn-cat-track-enqueue")) {
                        e.stopPropagation();
                        if (alb.tracks && alb.tracks[trkIdx]) {
                            this.enqueueTrack(alb.tracks[trkIdx], alb, false);
                        }
                        return;
                    }
                    if (e.target.closest(".btn-cat-track-playlist")) {
                        e.stopPropagation();
                        if (alb.tracks && alb.tracks[trkIdx] && typeof openAddToPlaylistModal === "function") {
                            const trk = alb.tracks[trkIdx];
                            openAddToPlaylistModal({
                                type: trk.type === "video" ? "video" : "audio",
                                title: trk.title || trk.filename || "Piste",
                                artist: trk.artist || alb.artist || "Artiste",
                                duration: trk.duration_seconds || trk.duration || 0,
                                path: trk.path || trk.filepath || (alb.path ? `${alb.path}\\${trk.filename}` : trk.filename),
                                album_title: alb.title,
                                cover_url: alb.cover_url || `/api/audio/cover?path=${encodeURIComponent(alb.path)}`
                            });
                        }
                        return;
                    }

                    // Clic direct sur la ligne de piste
                    if (!e.target.closest(".btn-track-action")) {
                        this.playTrackInAllCollection(alb, trkIdx, alb.tracks ? alb.tracks[trkIdx] : null);
                    }
                }
                return;
            }

            // ── 2. MODE RECHERCHE DENSE ──
            const denseRow = e.target.closest(".dense-track-row");
            if (denseRow) {
                const mIdx = parseInt(denseRow.getAttribute("data-match-idx"), 10);
                const match = (this._currentCatalogMatches && this._currentCatalogMatches[mIdx])
                    ? this._currentCatalogMatches[mIdx]
                    : null;
                if (!match) return;

                const albPath = match.album.path;
                const trkIdx = match.trackIndex;

                if (e.target.closest(".btn-dense-play")) {
                    e.stopPropagation();
                    this.playTrackInAllCollection(match.album, trkIdx, match.track);
                    return;
                }
                if (e.target.closest(".btn-dense-next")) {
                    e.stopPropagation();
                    this.enqueueTrack(match.track, match.album, true);
                    return;
                }
                if (e.target.closest(".btn-dense-enqueue")) {
                    e.stopPropagation();
                    this.enqueueTrack(match.track, match.album, false);
                    return;
                }
                if (e.target.closest(".btn-dense-playlist")) {
                    e.stopPropagation();
                    if (typeof openAddToPlaylistModal === "function") {
                        const trk = match.track;
                        const alb = match.album;
                        openAddToPlaylistModal({
                            type: trk.type === "video" ? "video" : "audio",
                            title: trk.title || trk.filename || "Piste",
                            artist: trk.artist || alb.artist || "Artiste",
                            duration: trk.duration_seconds || trk.duration || 0,
                            path: trk.path || trk.filepath || (alb.path ? `${alb.path}\\${trk.filename}` : trk.filename),
                            album_title: alb.title,
                            cover_url: alb.cover_url || `/api/audio/cover?path=${encodeURIComponent(alb.path)}`
                        });
                    }
                    return;
                }

                // Clic direct sur la ligne dense
                if (!e.target.closest(".btn-track-action")) {
                    this.playTrackInAllCollection(match.album, trkIdx, match.track);
                }
            }
        });
    },

    renderCatalogAlbums() {
        const container = document.getElementById("player-all-container");
        const countIndicator = document.getElementById("player-count-indicator") || document.getElementById("player-all-count-indicator");
        if (!container) return;

        const albums = (this.allCatalog && this.allCatalog.albums) ? this.allCatalog.albums.slice() : [];
        const totalTracks = this.allCatalog ? (this.allCatalog.total_tracks || 0) : 0;

        // Tri des albums du catalogue selon le mode sélectionné
        const catSort = this.sortModeAllCatalog || "artist-asc";
        albums.sort((a, b) => {
            const artA = (a.artist || "").toLowerCase();
            const artB = (b.artist || "").toLowerCase();
            const titA = (a.title || "").toLowerCase();
            const titB = (b.title || "").toLowerCase();
            const genA = (a.genre || "").toLowerCase();
            const genB = (b.genre || "").toLowerCase();
            const yrA = parseInt(a.year, 10) || 0;
            const yrB = parseInt(b.year, 10) || 0;
            const trkA = parseInt(a.tracks_count || (a.tracks ? a.tracks.length : 0), 10) || 0;
            const trkB = parseInt(b.tracks_count || (b.tracks ? b.tracks.length : 0), 10) || 0;

            switch (catSort) {
                case "artist-asc":
                    return artA.localeCompare(artB) || titA.localeCompare(titB);
                case "artist-desc":
                    return artB.localeCompare(artA) || titA.localeCompare(titB);
                case "title-asc":
                    return titA.localeCompare(titB) || artA.localeCompare(artB);
                case "title-desc":
                    return titB.localeCompare(titA) || artA.localeCompare(artB);
                case "genre-asc":
                    if (!genA && genB) return 1;
                    if (genA && !genB) return -1;
                    return genA.localeCompare(genB) || artA.localeCompare(artB) || titA.localeCompare(titB);
                case "genre-desc":
                    if (!genA && genB) return 1;
                    if (genA && !genB) return -1;
                    return genB.localeCompare(genA) || artA.localeCompare(artB) || titA.localeCompare(titB);
                case "year-desc":
                    return yrB - yrA || artA.localeCompare(artB);
                case "year-asc":
                    if (!yrA && yrB) return 1;
                    if (yrA && !yrB) return -1;
                    return yrA - yrB || artA.localeCompare(artB);
                case "tracks-desc":
                    return trkB - trkA || artA.localeCompare(artB);
                default:
                    return artA.localeCompare(artB) || titA.localeCompare(titB);
            }
        });

        this._currentCatalogAlbums = albums;

        if (countIndicator) {
            countIndicator.textContent = `${totalTracks} titres • ${albums.length} album${albums.length > 1 ? "s" : ""}`;
        }

        if (albums.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="padding: 40px 20px; text-align: center;">
                    <div style="font-size: 2.5rem; opacity: 0.5; margin-bottom: 8px;">💿</div>
                    <h4>Aucun album trouvé</h4>
                    <p class="text-muted" style="font-size: 0.88rem;">Aucun morceau disponible dans cette source.</p>
                </div>
            `;
            return;
        }

        // OPT: Rendu direct complet en une seule passe sans découpage (chunking) visuel.
        // content-visibility: auto assure que le navigateur ne calcule et ne peint que les blocs visibles à l'écran.
        const bannerHtml = `
            <div class="player-all-catalog-banner">
                <div class="player-all-catalog-info">
                    <span class="player-all-catalog-icon">🌐</span>
                    <div class="player-all-catalog-texts">
                        <span class="player-all-catalog-title">Catalogue Intégral</span>
                        <span class="player-all-catalog-sub">${totalTracks} titres • ${albums.length} album${albums.length > 1 ? "s" : ""}</span>
                    </div>
                </div>
                <div class="player-all-catalog-actions">
                    <button type="button" class="btn btn-sm btn-primary btn-all-global-shuffle" id="btn-all-banner-shuffle" title="Lancer une lecture aléatoire qui pioche dans tous les titres de la collection">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                        <span>Aléatoire (Toute la collection)</span>
                    </button>
                    <button type="button" class="btn btn-sm btn-secondary btn-all-global-play" id="btn-all-banner-play" title="Lire tous les morceaux de la collection dans l'ordre">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        <span>Tout lire</span>
                    </button>
                </div>
            </div>
        `;
        const allParts = [bannerHtml];
        for (let i = 0; i < albums.length; i++) {
            allParts.push(this._buildCatalogAlbumBlockHtml(albums[i], i));
        }

        container.innerHTML = allParts.join("");
        this.ensureAllContainerDelegation(container);

        if (this.currentView === "all") {
            if (this.isPlaying || this.currentIndex >= 0) {
                this.updateActiveTrackInAllContainer();
            }
            const targetAllY = (this.savedScrollPositions && typeof this.savedScrollPositions["all"] === "number")
                ? this.savedScrollPositions["all"]
                : 0;
            this.restoreScrollPosition(targetAllY);
        }
    },

    bindCatalogAlbumEvents(container, albums) {
        // OPT: Remplacé par délégation d'événements unique (0 ms de liaison pour des milliers d'éléments)
        this.ensureAllContainerDelegation(container);
    },

    highlightMatch(text, query) {
        if (!text || !query) return escapeHtml(text || "");
        const s = String(text);
        const q = String(query).toLowerCase();
        const idx = s.toLowerCase().indexOf(q);
        if (idx === -1) return escapeHtml(s);
        return escapeHtml(s.substring(0, idx)) +
               `<mark class="search-highlight">${escapeHtml(s.substring(idx, idx + q.length))}</mark>` +
               escapeHtml(s.substring(idx + q.length));
    },

    renderCatalogSearch(query) {
        const container = document.getElementById("player-all-container");
        const countIndicator = document.getElementById("player-count-indicator") || document.getElementById("player-all-count-indicator");
        if (!container) return;

        const albums = (this.allCatalog && this.allCatalog.albums) ? this.allCatalog.albums : [];
        const matches = [];

        // OPT: Recherche instantanée via haystack pré-normalisé
        for (const alb of albums) {
            const albTitleMatch = (alb.title || "").toLowerCase().includes(query);
            const albArtistMatch = (alb.artist || "").toLowerCase().includes(query);

            for (let i = 0; i < (alb.tracks || []).length; i++) {
                const trk = alb.tracks[i];
                const isMatch = trk._haystack
                    ? trk._haystack.includes(query)
                    : (albTitleMatch || albArtistMatch ||
                       (trk.title || "").toLowerCase().includes(query) ||
                       (trk.artist || "").toLowerCase().includes(query));

                if (isMatch) {
                    matches.push({
                        track: trk,
                        album: alb,
                        trackIndex: i
                    });
                }
            }
        }

        if (countIndicator) {
            countIndicator.textContent = `${matches.length} titre${matches.length > 1 ? "s" : ""} trouvé${matches.length > 1 ? "s" : ""}`;
        }

        if (matches.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="padding: 40px 20px; text-align: center;">
                    <div style="font-size: 2.5rem; opacity: 0.5; margin-bottom: 8px;">🔍</div>
                    <h4>Aucun titre trouvé</h4>
                    <p class="text-muted" style="font-size: 0.88rem;">Aucun morceau ne correspond à « <strong>${escapeHtml(query)}</strong> ».</p>
                </div>
            `;
            return;
        }

        // Tri des résultats de recherche selon le mode sélectionné
        const sMode = this.sortModeAllSearch || "relevance";
        if (sMode !== "relevance") {
            const parseDurationSeconds = (d) => {
                if (!d || typeof d !== "string") return 0;
                const parts = d.split(":").map(p => parseInt(p, 10) || 0);
                if (parts.length === 2) return parts[0] * 60 + parts[1];
                if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
                return 0;
            };

            matches.sort((a, b) => {
                const trkA = (a.track.title || "").toLowerCase();
                const trkB = (b.track.title || "").toLowerCase();
                const artA = (a.track.artist || a.album.artist || "").toLowerCase();
                const artB = (b.track.artist || b.album.artist || "").toLowerCase();
                const albA = (a.album.title || "").toLowerCase();
                const albB = (b.album.title || "").toLowerCase();
                const durA = parseDurationSeconds(a.track.duration);
                const durB = parseDurationSeconds(b.track.duration);

                switch (sMode) {
                    case "title-asc":
                        return trkA.localeCompare(trkB) || artA.localeCompare(artB);
                    case "title-desc":
                        return trkB.localeCompare(trkA) || artA.localeCompare(artB);
                    case "artist-asc":
                        return artA.localeCompare(artB) || trkA.localeCompare(trkB);
                    case "artist-desc":
                        return artB.localeCompare(artA) || trkA.localeCompare(trkB);
                    case "album-asc":
                        return albA.localeCompare(albB) || trkA.localeCompare(trkB);
                    case "album-desc":
                        return albB.localeCompare(albA) || trkA.localeCompare(trkB);
                    case "genre-asc": {
                        const genA = (a.track.genre || a.album.genre || "").toLowerCase();
                        const genB = (b.track.genre || b.album.genre || "").toLowerCase();
                        if (!genA && genB) return 1;
                        if (genA && !genB) return -1;
                        return genA.localeCompare(genB) || artA.localeCompare(artB) || trkA.localeCompare(trkB);
                    }
                    case "genre-desc": {
                        const genA = (a.track.genre || a.album.genre || "").toLowerCase();
                        const genB = (b.track.genre || b.album.genre || "").toLowerCase();
                        if (!genA && genB) return 1;
                        if (genA && !genB) return -1;
                        return genB.localeCompare(genA) || artA.localeCompare(artB) || trkA.localeCompare(trkB);
                    }
                    case "dur-desc":
                        return durB - durA || trkA.localeCompare(trkB);
                    case "dur-asc":
                        return durA - durB || trkA.localeCompare(trkB);
                    default:
                        return 0;
                }
            });
        }

        this._currentCatalogMatches = matches;

        const isCurrentAlbumActive = Boolean(this.activeAlbumPath);
        const rowsParts = [];
        for (let i = 0; i < matches.length; i++) {
            rowsParts.push(this._buildDenseSearchRowHtml(matches[i], i, query, isCurrentAlbumActive));
        }

        const searchBannerHtml = `
            <div class="player-all-catalog-banner">
                <div class="player-all-catalog-info">
                    <span class="player-all-catalog-icon">🔍</span>
                    <div class="player-all-catalog-texts">
                        <span class="player-all-catalog-title">${matches.length} titre${matches.length > 1 ? "s" : ""} trouvé${matches.length > 1 ? "s" : ""}</span>
                        <span class="player-all-catalog-sub">Recherche : « ${escapeHtml(query)} »</span>
                    </div>
                </div>
                <div class="player-all-catalog-actions">
                    <button type="button" class="btn btn-sm btn-primary btn-search-results-shuffle" title="Lire ces ${matches.length} titres en mode aléatoire">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                        <span>Aléatoire (${matches.length} titres)</span>
                    </button>
                    <button type="button" class="btn btn-sm btn-secondary btn-all-global-shuffle" title="Lancer une lecture aléatoire de toute la collection">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                        <span>Aléatoire (Collection)</span>
                    </button>
                </div>
            </div>
        `;

        container.innerHTML = `
            ${searchBannerHtml}
            <div class="player-dense-search-container" id="player-dense-search-wrapper">
                <div class="dense-track-header">
                    <div style="width: 280px; max-width: 320px;">Artiste & Album</div>
                    <div style="flex: 1; display: flex; justify-content: space-between;">
                        <span>Titre du morceau</span>
                        <span>Durée</span>
                    </div>
                </div>
                ${rowsParts.join("")}
            </div>
        `;

        this.ensureAllContainerDelegation(container);
    },

    // =========================================================
    // RECHERCHE GLOBALE UNIFIÉE (OPTION A)
    // =========================================================

    // ── MOTEUR DE RECHERCHE GLOBALE MULTI-ONGLETS AVEC PASTILLES DE RÉSULTAT ──
    globalSearchQuery: "",

    setGlobalSearch(rawQuery, sourceInput = null) {
        const q = (rawQuery || "").trim();
        this.globalSearchQuery = q;

        const pInp = document.getElementById("player-search-input");
        const rInp = document.getElementById("radios-search-input");
        const pClr = document.getElementById("player-search-clear-btn");
        const rClr = document.getElementById("radios-search-clear-btn");

        if (pInp && pInp !== sourceInput && pInp.value !== (rawQuery || "")) pInp.value = rawQuery || "";
        if (rInp && rInp !== sourceInput && rInp.value !== (rawQuery || "")) rInp.value = rawQuery || "";
        if (pClr) pClr.style.display = q ? "block" : "none";
        if (rClr) rClr.style.display = q ? "flex" : "none";

        this.searchFilter = q;
        this.videosSearchFilter = q;
        this.concertsSearchFilter = q;
        this.allSearchQuery = q;
        if (window.UserPlaylists) window.UserPlaylists.searchFilter = q;
        if (window.RadioManager) window.RadioManager.state.searchQuery = q;

        this.updateSearchTabBadges(q);
        this.applySearchToCurrentView(q);
    },

    clearGlobalSearch() {
        this.globalSearchQuery = "";
        this.searchFilter = "";
        this.videosSearchFilter = "";
        this.concertsSearchFilter = "";
        this.allSearchQuery = "";
        if (window.UserPlaylists) window.UserPlaylists.searchFilter = "";
        if (window.RadioManager) {
            window.RadioManager.state.searchQuery = "";
            window.RadioManager.handleSearch("");
        }

        const pInp = document.getElementById("player-search-input");
        const rInp = document.getElementById("radios-search-input");
        const pClr = document.getElementById("player-search-clear-btn");
        const rClr = document.getElementById("radios-search-clear-btn");

        if (pInp) pInp.value = "";
        if (rInp) rInp.value = "";
        if (pClr) pClr.style.display = "none";
        if (rClr) rClr.style.display = "none";

        this.updateSearchTabBadges("");
        this.renderCurrentView();
    },

    updateSearchTabBadges(query) {
        const q = (query || "").toLowerCase().trim();
        const badges = {
            all: document.getElementById("player-all-count-badge"),
            albums: document.getElementById("player-albums-count-badge"),
            artists: document.getElementById("player-artists-count-badge"),
            genres: document.getElementById("player-genres-count-badge"),
            videos: document.getElementById("player-videos-count-badge"),
            concerts: document.getElementById("player-concerts-count-badge"),
            playlists: document.getElementById("player-playlists-count-badge")
        };

        // L'onglet Radios du haut ne porte pas de pastille de recherche (réservée aux pilules de pays/favoris)
        const radiosBadge = document.getElementById("player-radios-count-badge");
        if (radiosBadge) radiosBadge.style.display = "none";

        if (!q) {
            Object.keys(badges).forEach(k => {
                const b = badges[k];
                if (!b) return;
                b.style.display = "none";
                b.className = "badge badge-sm badge-tab-count";
            });
            if (window.RadioManager && typeof window.RadioManager.updateFilterPillBadges === "function") {
                window.RadioManager.updateFilterPillBadges("");
            }
            return;
        }

        // Compter les albums
        const catAlbums = (this.allCatalog && Array.isArray(this.allCatalog.albums)) ? this.allCatalog.albums : (this.libraryAlbums || []);
        let albumsCount = 0;
        for (const a of catAlbums) {
            if ((a.title || "").toLowerCase().includes(q) || (a.artist || "").toLowerCase().includes(q) || (a.genre || "").toLowerCase().includes(q)) {
                albumsCount++;
            }
        }

        // Compter les artistes uniques
        const artSet = new Set();
        for (const a of catAlbums) {
            const art = (a.artist || "").trim();
            if (art && art.toLowerCase().includes(q)) artSet.add(art.toLowerCase());
        }
        const artistsCount = artSet.size;

        // Compter les genres uniques
        const genSet = new Set();
        for (const a of catAlbums) {
            const gen = (a.genre || "").trim();
            if (gen && gen.toLowerCase().includes(q)) genSet.add(gen.toLowerCase());
        }
        const genresCount = genSet.size;

        // Compter clips et concerts
        let videosCount = 0;
        let concertsCount = 0;
        const vids = this.videosCatalog || [];
        for (const v of vids) {
            const m = (v.title || "").toLowerCase().includes(q) || (v.artist || "").toLowerCase().includes(q) || (v.filename || "").toLowerCase().includes(q);
            if (m) {
                if (v.video_type === "concert" || v.is_concert) concertsCount++;
                else videosCount++;
            }
        }

        // Compter playlists
        let playlistsCount = 0;
        const pls = (window.UserPlaylists && Array.isArray(window.UserPlaylists.playlists)) ? window.UserPlaylists.playlists : [];
        for (const p of pls) {
            if ((p.name || "").toLowerCase().includes(q)) playlistsCount++;
        }

        // Synchroniser également les pilules de sous-filtres des radios (Favoris, Top, Pays...)
        if (window.RadioManager && typeof window.RadioManager.updateFilterPillBadges === "function") {
            window.RadioManager.updateFilterPillBadges(q);
        }

        const allCount = albumsCount + artistsCount + genresCount + videosCount + concertsCount + playlistsCount;

        const counts = {
            all: allCount,
            albums: albumsCount,
            artists: artistsCount,
            genres: genresCount,
            videos: videosCount,
            concerts: concertsCount,
            playlists: playlistsCount
        };

        Object.keys(badges).forEach(k => {
            const b = badges[k];
            if (!b) return;
            const cnt = counts[k] || 0;
            b.textContent = cnt;
            b.style.display = "inline-flex";
            b.className = `badge badge-sm badge-tab-count ${cnt > 0 ? "count-positive" : "count-zero"}`;
        });
    },

    applySearchToCurrentView(q) {
        if (this.currentView === "albums") {
            this.renderAlbumsGrid();
        } else if (this.currentView === "artists") {
            this.renderArtistsGrid();
        } else if (this.currentView === "genres") {
            this.renderGenresGrid();
        } else if (this.currentView === "videos") {
            this.renderVideosGrid();
        } else if (this.currentView === "concerts") {
            this.renderConcertsGrid();
        } else if (this.currentView === "playlists") {
            if (window.UserPlaylists) window.UserPlaylists.renderGrid();
        } else if (this.currentView === "radios") {
            if (window.RadioManager) window.RadioManager.handleSearch(q);
        } else if (this.currentView === "all") {
            this.renderAllView(true);
        } else if (this.currentView === "search") {
            this.performUnifiedSearch(q);
        }
    },

    onSearchInputChanged(rawQuery) {
        const q = (rawQuery || "").trim();
        if (!q) {
            if (this.currentView === "search") {
                this.clearUnifiedSearch(true);
            }
            return;
        }

        this.unifiedSearchQuery = q;

        // Si on n'est pas encore sur la vue recherche, mémoriser la vue d'origine et basculer
        if (this.currentView !== "search") {
            this.preSearchView = (this.currentView && this.currentView !== "now-playing") ? this.currentView : "albums";
            this.savedScrollPositions = this.savedScrollPositions || {};
            this.savedScrollPositions[this.preSearchView] = window.scrollY || document.documentElement.scrollTop || 0;
            this.setView("search");

            const searchInput = document.getElementById("player-search-input");
            if (searchInput && searchInput.value !== rawQuery) {
                searchInput.value = rawQuery;
            }
        }

        this.performUnifiedSearch(q);
    },

    clearUnifiedSearch(restoreView = true) {
        clearTimeout(this._unifiedSearchDebounceTimer);
        this.unifiedSearchQuery = "";
        this.unifiedSearchResults = null;
        this.activeUnifiedSearchChip = "all";

        const searchInput = document.getElementById("player-search-input");
        const searchClearBtn = document.getElementById("player-search-clear-btn");
        if (searchInput) searchInput.value = "";
        if (searchClearBtn) searchClearBtn.style.display = "none";

        const searchContainer = document.getElementById("unified-search-view");
        if (searchContainer) searchContainer.innerHTML = "";

        if (restoreView) {
            const target = (this.preSearchView && this.preSearchView !== "search" && this.preSearchView !== "now-playing")
                ? this.preSearchView
                : "albums";
            this.setView(target);
            const savedY = (this.savedScrollPositions && typeof this.savedScrollPositions[target] === "number")
                ? this.savedScrollPositions[target]
                : 0;
            this.restoreScrollPosition(savedY);
        }
    },

    performUnifiedSearch(query) {
        this.unifiedSearchQuery = query || "";
        const q = (query || "").toLowerCase().trim();
        if (!q) {
            this.unifiedSearchResults = null;
            this.renderUnifiedSearch();
            return;
        }

        const results = {
            query: query,
            tracks: [],
            albums: [],
            videos: [],
            artists: [],
            genres: [],
            playlists: [],
            topMatch: null
        };

        // 1. Titres et Albums depuis allCatalog ou libraryAlbums
        const catAlbums = (this.allCatalog && Array.isArray(this.allCatalog.albums))
            ? this.allCatalog.albums
            : (this.libraryAlbums || []);

        const matchedAlbums = [];
        const matchedTracks = [];
        const seenAlbumPaths = new Set();

        for (const alb of catAlbums) {
            const albTitle = (alb.title || "").toLowerCase();
            const albArtist = (alb.artist || "").toLowerCase();
            const albGenre = (alb.genre || "").toLowerCase();
            const albPath = alb.path || "";

            const albMatch = albTitle.includes(q) || albArtist.includes(q) || albGenre.includes(q);
            if (albMatch && !seenAlbumPaths.has(albPath)) {
                seenAlbumPaths.add(albPath);
                let score = 0;
                if (albTitle === q) score += 100;
                else if (albTitle.startsWith(q)) score += 60;
                else if (albTitle.includes(q)) score += 30;
                if (albArtist === q) score += 50;
                else if (albArtist.startsWith(q)) score += 30;
                matchedAlbums.push({ album: alb, score });
            }

            // Recherche des morceaux : ne retenir STRICTEMENT que les pistes dont le TITRE correspond à la recherche
            const tracks = alb.tracks || [];
            for (let i = 0; i < tracks.length; i++) {
                const trk = tracks[i];
                const trkTitle = (trk.title || trk.filename || "").toLowerCase();

                if (trkTitle.includes(q)) {
                    let score = 0;
                    if (trkTitle === q) score += 120;
                    else if (trkTitle.startsWith(q)) score += 80;
                    else score += 40;

                    matchedTracks.push({
                        track: trk,
                        album: alb,
                        trackIndex: i,
                        score
                    });
                }
            }
        }

        matchedAlbums.sort((a, b) => b.score - a.score);
        matchedTracks.sort((a, b) => b.score - a.score);

        results.albums = matchedAlbums.map(m => m.album);
        results.tracks = matchedTracks;

        // 2. Clips & Concerts depuis videosCatalog
        const allVids = this.videosCatalog || [];
        const matchedVids = [];
        for (const v of allVids) {
            const vTitle = (v.title || "").toLowerCase();
            const vArtist = (v.artist || "").toLowerCase();
            const vFile = (v.filename || "").toLowerCase();
            if (vTitle.includes(q) || vArtist.includes(q) || vFile.includes(q)) {
                let score = 0;
                if (vTitle === q) score += 110;
                else if (vTitle.startsWith(q)) score += 70;
                else score += 30;
                if (vArtist === q) score += 40;
                matchedVids.push({ video: v, score });
            }
        }
        matchedVids.sort((a, b) => b.score - a.score);
        results.videos = matchedVids.map(m => m.video);

        // 3. Artistes uniques
        const artistMap = new Map();
        for (const alb of (this.libraryAlbums || [])) {
            const artName = (alb.artist || "").trim();
            if (!artName || this.isUnknownArtist(artName)) continue;
            const norm = artName.toLowerCase();
            if (!artistMap.has(norm)) {
                artistMap.set(norm, { name: artName, albumCount: 0, coverUrl: alb.cover_url || `/api/audio/cover?path=${encodeURIComponent(alb.path)}` });
            }
            artistMap.get(norm).albumCount++;
        }
        // Ajouter artistes des vidéos
        for (const v of (this.videosCatalog || [])) {
            const artName = (v.artist || "").trim();
            if (!artName || this.isUnknownArtist(artName)) continue;
            const norm = artName.toLowerCase();
            if (!artistMap.has(norm)) {
                artistMap.set(norm, { name: artName, albumCount: 0, coverUrl: `/api/videos/thumbnail?path=${encodeURIComponent(v.rel_path || v.path)}` });
            }
        }
        const matchedArtists = [];
        for (const [norm, data] of artistMap.entries()) {
            if (norm.includes(q)) {
                let score = 0;
                if (norm === q) score += 150;
                else if (norm.startsWith(q)) score += 90;
                else score += 40;
                matchedArtists.push({ ...data, score });
            }
        }
        matchedArtists.sort((a, b) => b.score - a.score || b.albumCount - a.albumCount);
        results.artists = matchedArtists;

        // 4. Genres uniques
        const genreMap = new Map();
        for (const alb of (this.libraryAlbums || [])) {
            const gName = (alb.genre || "").trim();
            if (!gName) continue;
            const norm = gName.toLowerCase();
            if (!genreMap.has(norm)) {
                genreMap.set(norm, { name: gName, count: 0 });
            }
            genreMap.get(norm).count++;
        }
        const matchedGenres = [];
        for (const [norm, data] of genreMap.entries()) {
            if (norm.includes(q)) {
                let score = (norm === q) ? 100 : (norm.startsWith(q) ? 60 : 30);
                matchedGenres.push({ ...data, score });
            }
        }
        matchedGenres.sort((a, b) => b.score - a.score || b.count - a.count);
        results.genres = matchedGenres;

        // 5. Playlists utilisateur
        const userPlaylists = (window.UserPlaylists && Array.isArray(window.UserPlaylists.playlists))
            ? window.UserPlaylists.playlists
            : [];
        const matchedPlaylists = [];
        for (const pl of userPlaylists) {
            const plName = (pl.name || "").toLowerCase();
            if (plName.includes(q)) {
                let score = (plName === q) ? 100 : (plName.startsWith(q) ? 60 : 30);
                matchedPlaylists.push({ ...pl, score });
            }
        }
        matchedPlaylists.sort((a, b) => b.score - a.score);
        results.playlists = matchedPlaylists;

        // 6. Détermination du Top Match (Meilleur résultat absolu)
        let bestCandidate = null;
        let highestScore = 0;

        if (matchedArtists.length > 0 && matchedArtists[0].score >= 80) {
            bestCandidate = { type: "artist", data: matchedArtists[0], score: matchedArtists[0].score };
            highestScore = matchedArtists[0].score;
        }
        if (matchedAlbums.length > 0 && matchedAlbums[0].score > highestScore) {
            bestCandidate = { type: "album", data: matchedAlbums[0].album, score: matchedAlbums[0].score };
            highestScore = matchedAlbums[0].score;
        }
        if (matchedTracks.length > 0 && matchedTracks[0].score > highestScore) {
            bestCandidate = { type: "track", data: matchedTracks[0], score: matchedTracks[0].score };
            highestScore = matchedTracks[0].score;
        }
        if (matchedVids.length > 0 && matchedVids[0].score > highestScore) {
            bestCandidate = { type: "video", data: matchedVids[0].video, score: matchedVids[0].score };
            highestScore = matchedVids[0].score;
        }

        results.topMatch = bestCandidate;
        this.unifiedSearchResults = results;
        this.renderUnifiedSearch();
    },

    renderUnifiedSearch() {
        const container = document.getElementById("unified-search-view");
        if (!container) return;

        this.bindUnifiedSearchEvents(container);

        const results = this.unifiedSearchResults;
        const query = this.unifiedSearchQuery || "";

        if (!query.trim() || !results) {
            container.innerHTML = `
                <div class="search-empty-state">
                    <div class="search-empty-icon">🔍</div>
                    <div class="search-empty-title">Recherche unifiée dans votre collection</div>
                    <div class="search-empty-hint">Tapez un titre, artiste, album, clip ou genre musical pour afficher instantanément tous les résultats.</div>
                </div>
            `;
            return;
        }

        const totalCount = results.tracks.length + results.albums.length + results.videos.length + results.artists.length + results.genres.length + results.playlists.length;
        const countIndicator = document.getElementById("player-count-indicator");
        if (countIndicator) {
            countIndicator.textContent = `${totalCount} résultat${totalCount > 1 ? "s" : ""}`;
        }
        if (totalCount === 0) {
            container.innerHTML = `
                <div class="unified-search-nav-row">
                    <button type="button" class="btn btn-secondary player-context-back-btn" id="btn-unified-search-back">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
                        <span>← Revenir</span>
                    </button>
                    <span class="search-results-summary-count">0 résultat pour « ${escapeHtml(query)} »</span>
                </div>
                <div class="search-empty-state">
                    <div class="search-empty-icon">📂</div>
                    <div class="search-empty-title">Aucun résultat trouvé</div>
                    <div class="search-empty-hint">Aucun élément ne correspond à « <strong>${escapeHtml(query)}</strong> ». Vérifiez l'orthographe ou essayez un mot-clé plus court.</div>
                </div>
            `;
            return;
        }

        const activeChip = this.activeUnifiedSearchChip || "all";

        // Navigation & Barre de filtres (Pills)
        const pillsHtml = `
            <div class="unified-search-nav-row">
                <button type="button" class="btn btn-secondary player-context-back-btn" id="btn-unified-search-back" title="Fermer la recherche et revenir à la vue précédente (Échap)">
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
                    <span>← Revenir</span>
                </button>
                <div class="search-pills-bar">
                    <button type="button" class="search-pill ${activeChip === "all" ? "active" : ""}" data-chip="all">
                        Tout <span class="search-pill-count">${totalCount}</span>
                    </button>
                    <button type="button" class="search-pill ${activeChip === "tracks" ? "active" : ""}" data-chip="tracks" ${results.tracks.length === 0 ? "style='display:none;'" : ""}>
                        🎵 Titres <span class="search-pill-count">${results.tracks.length}</span>
                    </button>
                    <button type="button" class="search-pill ${activeChip === "albums" ? "active" : ""}" data-chip="albums" ${results.albums.length === 0 ? "style='display:none;'" : ""}>
                        💿 Albums <span class="search-pill-count">${results.albums.length}</span>
                    </button>
                    <button type="button" class="search-pill ${activeChip === "videos" ? "active" : ""}" data-chip="videos" ${results.videos.length === 0 ? "style='display:none;'" : ""}>
                        🎬 Clips & Concerts <span class="search-pill-count">${results.videos.length}</span>
                    </button>
                    <button type="button" class="search-pill ${activeChip === "artists" ? "active" : ""}" data-chip="artists" ${results.artists.length === 0 ? "style='display:none;'" : ""}>
                        🎤 Artistes <span class="search-pill-count">${results.artists.length}</span>
                    </button>
                    <button type="button" class="search-pill ${activeChip === "genres" ? "active" : ""}" data-chip="genres" ${results.genres.length === 0 ? "style='display:none;'" : ""}>
                        🏷️ Genres <span class="search-pill-count">${results.genres.length}</span>
                    </button>
                    <button type="button" class="search-pill ${activeChip === "playlists" ? "active" : ""}" data-chip="playlists" ${results.playlists.length === 0 ? "style='display:none;'" : ""}>
                        📑 Playlists <span class="search-pill-count">${results.playlists.length}</span>
                    </button>
                </div>
            </div>
        `;

        // Section Top Match (affiché si mode "all" et topMatch présent)
        let topMatchHtml = "";
        if (activeChip === "all" && results.topMatch) {
            topMatchHtml = this._buildTopMatchCardHtml(results.topMatch, query);
        }

        // Section Titres
        let tracksHtml = "";
        if ((activeChip === "all" || activeChip === "tracks") && results.tracks.length > 0) {
            const limit = (activeChip === "all") ? 8 : results.tracks.length;
            const slice = results.tracks.slice(0, limit);
            const trkRows = slice.map((m, idx) => this._buildSearchTrackRowHtml(m, idx, query)).join("");
            tracksHtml = `
                <div class="search-section">
                    <div class="search-section-header">
                        <div class="search-section-title">
                            🎵 Titres
                            <span class="search-section-badge">${results.tracks.length}</span>
                        </div>
                        ${(activeChip === "all" && results.tracks.length > limit) ? `
                            <button type="button" class="search-section-see-all" data-chip="tracks">Voir tous les titres (${results.tracks.length}) →</button>
                        ` : ""}
                    </div>
                    <div class="search-tracks-list">
                        ${trkRows}
                    </div>
                </div>
            `;
        }

        // Section Albums
        let albumsHtml = "";
        if ((activeChip === "all" || activeChip === "albums") && results.albums.length > 0) {
            const limit = (activeChip === "all") ? 6 : results.albums.length;
            const slice = results.albums.slice(0, limit);
            const albCards = slice.map(a => this._buildSearchAlbumCardHtml(a, query)).join("");
            albumsHtml = `
                <div class="search-section">
                    <div class="search-section-header">
                        <div class="search-section-title">
                            💿 Albums
                            <span class="search-section-badge">${results.albums.length}</span>
                        </div>
                        ${(activeChip === "all" && results.albums.length > limit) ? `
                            <button type="button" class="search-section-see-all" data-chip="albums">Voir tous les albums (${results.albums.length}) →</button>
                        ` : ""}
                    </div>
                    <div class="search-albums-grid">
                        ${albCards}
                    </div>
                </div>
            `;
        }

        // Section Vidéos & Concerts
        let videosHtml = "";
        if ((activeChip === "all" || activeChip === "videos") && results.videos.length > 0) {
            const limit = (activeChip === "all") ? 4 : results.videos.length;
            const slice = results.videos.slice(0, limit);
            const vidCards = slice.map(v => this._buildSearchVideoCardHtml(v, query)).join("");
            videosHtml = `
                <div class="search-section">
                    <div class="search-section-header">
                        <div class="search-section-title">
                            🎬 Clips & Concerts
                            <span class="search-section-badge">${results.videos.length}</span>
                        </div>
                        ${(activeChip === "all" && results.videos.length > limit) ? `
                            <button type="button" class="search-section-see-all" data-chip="videos">Voir tous les clips & concerts (${results.videos.length}) →</button>
                        ` : ""}
                    </div>
                    <div class="search-videos-grid">
                        ${vidCards}
                    </div>
                </div>
            `;
        }

        // Section Artistes
        let artistsHtml = "";
        if ((activeChip === "all" || activeChip === "artists") && results.artists.length > 0) {
            const limit = (activeChip === "all") ? 6 : results.artists.length;
            const slice = results.artists.slice(0, limit);
            const artCards = slice.map(art => `
                <div class="player-artist-card" data-action="open-artist" data-artist="${escapeHtml(art.name)}" style="cursor: pointer;">
                    <div class="player-artist-avatar" style="background-image: url('${art.coverUrl}'); background-size: cover; background-position: center;"></div>
                    <div class="player-artist-info">
                        <div class="player-artist-name">${this.highlightMatch(art.name, query)}</div>
                        <div class="player-artist-count">${art.albumCount} album${art.albumCount > 1 ? "s" : ""}</div>
                    </div>
                </div>
            `).join("");
            artistsHtml = `
                <div class="search-section">
                    <div class="search-section-header">
                        <div class="search-section-title">
                            🎤 Artistes
                            <span class="search-section-badge">${results.artists.length}</span>
                        </div>
                        ${(activeChip === "all" && results.artists.length > limit) ? `
                            <button type="button" class="search-section-see-all" data-chip="artists">Voir tous les artistes (${results.artists.length}) →</button>
                        ` : ""}
                    </div>
                    <div class="search-artists-grid">
                        ${artCards}
                    </div>
                </div>
            `;
        }

        // Section Genres
        let genresHtml = "";
        if ((activeChip === "all" || activeChip === "genres") && results.genres.length > 0) {
            const chips = results.genres.map(g => `
                <button type="button" class="search-genre-chip" data-action="open-genre" data-genre="${escapeHtml(g.name)}">
                    <span>🏷️</span>
                    <span>${this.highlightMatch(g.name, query)}</span>
                    <span style="font-size: 0.75rem; opacity: 0.65; margin-left: 2px;">(${g.count})</span>
                </button>
            `).join("");
            genresHtml = `
                <div class="search-section">
                    <div class="search-section-header">
                        <div class="search-section-title">
                            🏷️ Genres
                            <span class="search-section-badge">${results.genres.length}</span>
                        </div>
                    </div>
                    <div class="search-genres-cloud">
                        ${chips}
                    </div>
                </div>
            `;
        }

        // Section Playlists
        let playlistsHtml = "";
        if ((activeChip === "all" || activeChip === "playlists") && results.playlists.length > 0) {
            const plCards = results.playlists.map(pl => `
                <div class="playlist-card" data-action="open-playlist" data-playlist-id="${escapeHtml(pl.id)}" style="cursor: pointer;">
                    <div class="playlist-card-inner">
                        <div class="playlist-card-title">${this.highlightMatch(pl.name, query)}</div>
                        <div class="playlist-card-count text-muted">${(pl.tracks && pl.tracks.length) || 0} pistes</div>
                    </div>
                </div>
            `).join("");
            playlistsHtml = `
                <div class="search-section">
                    <div class="search-section-header">
                        <div class="search-section-title">
                            📑 Playlists
                            <span class="search-section-badge">${results.playlists.length}</span>
                        </div>
                    </div>
                    <div class="search-playlists-grid">
                        ${plCards}
                    </div>
                </div>
            `;
        }

        container.innerHTML = `
            ${pillsHtml}
            ${topMatchHtml}
            ${tracksHtml}
            ${albumsHtml}
            ${videosHtml}
            ${artistsHtml}
            ${genresHtml}
            ${playlistsHtml}
        `;

        this.bindUnifiedSearchEvents(container);
    },

    _buildTopMatchCardHtml(topMatch, query) {
        if (!topMatch) return "";
        const { type, data } = topMatch;
        let thumbUrl = "/static/placeholder-cover.svg";
        let title = "";
        let subtitle = "";
        let badge = "MEILLEUR RÉSULTAT";
        let cardAction = "";
        let playAction = "";

        if (type === "artist") {
            badge = "🎤 ARTISTE";
            title = data.name;
            subtitle = `${data.albumCount} album${data.albumCount > 1 ? "s" : ""} dans votre discographie`;
            thumbUrl = data.coverUrl || thumbUrl;
            cardAction = `data-action="open-artist" data-artist="${escapeHtml(data.name)}"`;
            playAction = `data-action="play-artist" data-artist="${escapeHtml(data.name)}"`;
        } else if (type === "album") {
            badge = "💿 ALBUM";
            title = data.title || "Album";
            subtitle = data.artist || "Artiste inconnu";
            thumbUrl = data.cover_url || `/api/audio/cover?path=${encodeURIComponent(data.path)}`;
            cardAction = `data-action="open-album" data-path="${escapeHtml(data.path)}"`;
            playAction = `data-action="play-album" data-path="${escapeHtml(data.path)}"`;
        } else if (type === "track") {
            const trk = data.track;
            const alb = data.album;
            badge = "🎵 TITRE";
            title = trk.title || trk.filename || "Piste";
            subtitle = `${trk.artist || alb.artist || "Artiste"} • ${alb.title || "Album"}`;
            thumbUrl = alb.cover_url || `/api/audio/cover?path=${encodeURIComponent(alb.path)}`;
            cardAction = `data-action="play-track" data-album-path="${escapeHtml(alb.path)}" data-trk-idx="${data.trackIndex}"`;
            playAction = `data-action="play-track" data-album-path="${escapeHtml(alb.path)}" data-trk-idx="${data.trackIndex}"`;
        } else if (type === "video") {
            badge = data.is_concert ? "🎸 CONCERT" : "🎬 CLIP VIDÉO";
            title = data.title;
            subtitle = data.artist || "Artiste";
            thumbUrl = `/api/videos/thumbnail?path=${encodeURIComponent(data.rel_path || data.path)}`;
            cardAction = `data-action="play-video" data-video-path="${escapeHtml(data.rel_path || data.path)}"`;
            playAction = `data-action="play-video" data-video-path="${escapeHtml(data.rel_path || data.path)}"`;
        }

        return `
            <div class="search-top-match-card" ${cardAction} style="cursor: pointer;">
                <img class="search-top-match-thumb" src="${thumbUrl}" alt="Cover" onerror="this.src='/static/placeholder-cover.svg';">
                <div class="search-top-match-info">
                    <span class="search-top-match-badge">⭐ ${badge}</span>
                    <div class="search-top-match-title">${this.highlightMatch(title, query)}</div>
                    <div class="search-top-match-subtitle">${escapeHtml(subtitle)}</div>
                </div>
                <button type="button" class="search-top-match-play-btn" ${playAction} title="Lire immédiatement">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </button>
            </div>
        `;
    },

    _buildSearchTrackRowHtml(matchItem, idx, query) {
        const trk = matchItem.track;
        const alb = matchItem.album;
        const trkIdx = matchItem.trackIndex;
        const trkTitle = trk.title || trk.filename || "Piste";
        const trkArtist = trk.artist || alb.artist || "Artiste inconnu";
        const albTitle = alb.title || "Album";
        const coverUrl = alb.cover_url || `/api/audio/cover?path=${encodeURIComponent(alb.path)}`;
        const durStr = trk.duration || "--:--";

        const curTrk = this.playlist && this.playlist[this.currentIndex];
        const isCurrentActive = Boolean(
            curTrk &&
            ((curTrk.filepath && curTrk.filepath === trk.filepath) ||
             (this.activeAlbumPath === alb.path && this.currentIndex === trkIdx))
        );

        return `
            <div class="search-track-item ${isCurrentActive ? "active" : ""}" data-action="play-track" data-album-path="${escapeHtml(alb.path)}" data-trk-idx="${trkIdx}">
                <div class="search-track-cover-wrap">
                    <img class="search-track-cover" src="${coverUrl}" alt="Cover" onerror="this.src='/static/placeholder-cover.svg';">
                    <span class="player-equalizer-bars" style="display: ${isCurrentActive && this.isPlaying ? "inline-flex" : "none"};">
                        <span class="player-equalizer-bar"></span>
                        <span class="player-equalizer-bar"></span>
                        <span class="player-equalizer-bar"></span>
                    </span>
                </div>
                <div class="search-track-main-info">
                    <div class="search-track-title">${this.highlightMatch(trkTitle, query)}</div>
                    <div class="search-track-sub">${this.highlightMatch(trkArtist, query)} • ${escapeHtml(albTitle)}</div>
                </div>
                <div class="search-track-actions">
                    <button type="button" class="btn-track-action" data-action="queue-track-next" data-album-path="${escapeHtml(alb.path)}" data-trk-idx="${trkIdx}" title="Lire ensuite en priorité">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                        <span>Ensuite</span>
                    </button>
                    <button type="button" class="btn-track-action" data-action="queue-track-end" data-album-path="${escapeHtml(alb.path)}" data-trk-idx="${trkIdx}" title="Ajouter à la file d'attente">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
                        <span>+ File</span>
                    </button>
                    <button type="button" class="btn-track-action" data-action="playlist-track" data-album-path="${escapeHtml(alb.path)}" data-trk-idx="${trkIdx}" title="Ajouter à une playlist">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/></svg>
                        <span>+ Playlist</span>
                    </button>
                </div>
                <span class="search-track-dur">${escapeHtml(durStr)}</span>
            </div>
        `;
    },

    _buildSearchAlbumCardHtml(alb, query) {
        const coverUrl = alb.cover_url || `/api/audio/cover?path=${encodeURIComponent(alb.path)}`;
        const albType = this.getAlbumType(alb);
        const badgeInfo = this.getAlbumTypeBadgeInfo(albType);
        const albumGenre = (alb.genre || (alb.tracks && alb.tracks[0] && alb.tracks[0].genre) || "").trim();
        const trkCount = (alb.tracks && alb.tracks.length) || parseInt(alb.tracks_count, 10) || 0;
        const genreTagHtml = albumGenre
            ? `<div class="player-card-genre"><span class="player-card-genre-tag" title="Genre : ${escapeHtml(albumGenre)}"><svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" class="genre-tag-icon"><path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/></svg><span>${escapeHtml(albumGenre)}</span></span></div>`
            : "";

        return `
            <div class="player-album-card" data-action="open-album" data-path="${escapeHtml(alb.path)}" style="cursor: pointer;">
                <div class="player-card-thumb-wrap">
                    <span class="player-card-type-badge ${badgeInfo.class}">${badgeInfo.label}</span>
                    <img class="player-card-thumb" src="${coverUrl}" alt="Cover" onerror="window.handleCoverError(this);">
                    <button type="button" class="player-card-play-btn" data-action="play-album" data-path="${escapeHtml(alb.path)}" title="Lire l'album immédiatement">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                </div>
                <div class="player-card-info">
                    <div class="player-card-title">${this.highlightMatch(alb.title, query)}</div>
                    ${genreTagHtml}
                    <div class="player-card-artist">${this.highlightMatch(alb.artist, query)}</div>
                    <div class="player-card-meta">
                        <span>${trkCount} titre${trkCount > 1 ? "s" : ""}</span>
                        ${alb.year ? `<span>• ${alb.year}</span>` : ""}
                    </div>
                </div>
            </div>
        `;
    },

    _buildSearchVideoCardHtml(v, query) {
        const thumbUrl = `/api/videos/thumbnail?path=${encodeURIComponent(v.rel_path || v.path)}`;
        const durStr = v.duration_str || (v.duration_seconds ? formatTime(v.duration_seconds) : "");
        const isConcert = v.is_concert || v.video_type === "concert";

        return `
            <div class="player-video-card" data-action="play-video" data-video-path="${escapeHtml(v.rel_path || v.path)}" style="cursor: pointer;">
                <div class="player-video-thumb-wrap">
                    <img class="player-video-thumb" src="${thumbUrl}" alt="Thumb" onerror="this.src='/static/placeholder-cover.svg';">
                    ${isConcert ? `<span class="player-video-badge-concert">🎸 Concert</span>` : ""}
                    ${durStr ? `<span class="player-video-badge-dur">${durStr}</span>` : ""}
                    <div class="player-video-play-overlay">
                        <div class="player-video-play-icon-btn">
                            <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                    </div>
                </div>
                <div class="player-video-body">
                    <h4 class="player-video-title">${this.highlightMatch(v.title, query)}</h4>
                    <div class="player-video-artist">
                        <span>${this.highlightMatch(v.artist, query)}</span>
                    </div>
                    <div class="player-video-footer">
                        <span>${durStr || ""}</span>
                        <div class="player-video-actions">
                            <button type="button" class="player-video-action-btn" data-action="queue-video-next" data-video-path="${escapeHtml(v.rel_path || v.path)}" title="Lire ce clip ensuite (priorité)">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                            </button>
                            <button type="button" class="player-video-action-btn" data-action="queue-video-end" data-video-path="${escapeHtml(v.rel_path || v.path)}" title="Ajouter ce clip à la file d'attente">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
                            </button>
                            <button type="button" class="player-video-action-btn" data-action="add-video-playlist" data-video-path="${escapeHtml(v.rel_path || v.path)}" title="Ajouter ce clip à une playlist">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/></svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    bindUnifiedSearchEvents(container) {
        if (!container) return;
        // OPT / Anti-flood : délégation d'événements unique et permanente sur le conteneur de recherche
        if (container._unifiedSearchBound) return;
        container._unifiedSearchBound = true;

        // Délégation globale des clics sur les résultats et contrôles de recherche
        container.addEventListener("click", (e) => {
            // 1. Bouton Retour
            const backBtn = e.target.closest("#btn-unified-search-back");
            if (backBtn) {
                e.stopPropagation();
                this.clearUnifiedSearch(true);
                return;
            }

            // 2. Filtres catégories (Pills & Voir tout)
            const pillBtn = e.target.closest(".search-pill, .search-section-see-all");
            if (pillBtn) {
                e.stopPropagation();
                const chip = pillBtn.getAttribute("data-chip");
                if (chip) {
                    this.activeUnifiedSearchChip = chip;
                    this.renderUnifiedSearch();
                    this.restoreScrollPosition(0);
                }
                return;
            }

            // 3. Actions sur les cartes / pistes / boutons
            const actionEl = e.target.closest("[data-action]");
            if (!actionEl) return;

            const action = actionEl.getAttribute("data-action");
            e.stopPropagation();

            // 1. Lecture directe de piste
            if (action === "play-track") {
                const albPath = actionEl.getAttribute("data-album-path");
                const trkIdx = parseInt(actionEl.getAttribute("data-trk-idx"), 10);
                if (albPath && !isNaN(trkIdx)) {
                    this.loadAlbum(albPath, {
                        autoPlay: true,
                        startTrackIndex: trkIdx,
                        isCollection: (this.librarySource === "library"),
                        switchView: false
                    });
                }
                return;
            }

            // 2. File d'attente : ensuite
            if (action === "queue-track-next") {
                const albPath = actionEl.getAttribute("data-album-path");
                const trkIdx = parseInt(actionEl.getAttribute("data-trk-idx"), 10);
                const results = this.unifiedSearchResults;
                const match = results?.tracks?.find(m => m.album?.path === albPath && m.trackIndex === trkIdx);
                if (match) {
                    this.enqueueTrack(match.track, {
                        title: match.album.title,
                        artist: match.album.artist,
                        path: match.album.path
                    }, true);
                }
                return;
            }

            // 3. File d'attente : à la fin
            if (action === "queue-track-end") {
                const albPath = actionEl.getAttribute("data-album-path");
                const trkIdx = parseInt(actionEl.getAttribute("data-trk-idx"), 10);
                const results = this.unifiedSearchResults;
                const match = results?.tracks?.find(m => m.album?.path === albPath && m.trackIndex === trkIdx);
                if (match) {
                    this.enqueueTrack(match.track, {
                        title: match.album.title,
                        artist: match.album.artist,
                        path: match.album.path
                    }, false);
                }
                return;
            }

            // 4. Ajouter la piste à une playlist
            if (action === "playlist-track") {
                const albPath = actionEl.getAttribute("data-album-path");
                const trkIdx = parseInt(actionEl.getAttribute("data-trk-idx"), 10);
                const results = this.unifiedSearchResults;
                const match = results?.tracks?.find(m => m.album?.path === albPath && m.trackIndex === trkIdx);
                if (match && typeof openAddToPlaylistModal === "function") {
                    const trk = match.track;
                    const alb = match.album;
                    openAddToPlaylistModal({
                        type: "audio",
                        title: trk.title || trk.filename || "Piste",
                        artist: trk.artist || alb.artist || "Artiste",
                        duration: trk.duration || 0,
                        path: trk.path || trk.filepath || (albPath ? `${albPath}\\${trk.filename}` : trk.filename),
                        album_title: alb.title,
                        cover_url: alb.cover_url || `/api/audio/cover?path=${encodeURIComponent(albPath)}`
                    });
                }
                return;
            }

            // 5. Lecture d'un album complet
            if (action === "play-album") {
                const p = actionEl.getAttribute("data-path");
                if (p) {
                    this.loadAlbum(p, {
                        autoPlay: true,
                        startTrackIndex: 0,
                        isCollection: (this.librarySource === "library"),
                        switchView: false
                    });
                }
                return;
            }

            // 6. Ouvrir les détails de l'album
            if (action === "open-album") {
                const p = actionEl.getAttribute("data-path") || actionEl.getAttribute("data-album-path");
                if (p) {
                    this.clearUnifiedSearch(false);
                    this.setView("albums");
                    this.openAlbumDetail(p);
                }
                return;
            }

            // 7. Lecture d'un clip ou concert vidéo
            if (action === "play-video") {
                const vPath = actionEl.getAttribute("data-video-path");
                const vMatch = (this.videosCatalog || []).find(v => (v.rel_path || v.path) === vPath);
                if (vMatch) {
                    if (typeof window.captureAudioStateBeforeVideo === "function") {
                        window.captureAudioStateBeforeVideo();
                    }
                    if (typeof openLocalVideoModal === "function") {
                        openLocalVideoModal(vMatch);
                    }
                }
                return;
            }

            if (action === "queue-video-next") {
                const vPath = actionEl.getAttribute("data-video-path");
                const vMatch = (this.videosCatalog || []).find(v => (v.rel_path || v.path) === vPath);
                if (vMatch) this.enqueueVideo(vMatch, true);
                return;
            }

            if (action === "queue-video-end") {
                const vPath = actionEl.getAttribute("data-video-path");
                const vMatch = (this.videosCatalog || []).find(v => (v.rel_path || v.path) === vPath);
                if (vMatch) this.enqueueVideo(vMatch, false);
                return;
            }

            if (action === "add-video-playlist") {
                const vPath = actionEl.getAttribute("data-video-path");
                const vMatch = (this.videosCatalog || []).find(v => (v.rel_path || v.path) === vPath);
                if (vMatch && typeof openAddToPlaylistModal === "function") {
                    openAddToPlaylistModal({
                        type: "video",
                        title: vMatch.title,
                        artist: vMatch.artist,
                        path: vMatch.rel_path || vMatch.filepath || vMatch.path,
                        filepath: vMatch.filepath || vMatch.path || vMatch.rel_path,
                        rel_path: vMatch.rel_path || "",
                        duration: vMatch.duration || vMatch.duration_seconds || 0,
                        height: vMatch.height || 1080,
                        cover_url: `/api/videos/thumbnail?path=${encodeURIComponent(vMatch.rel_path || vMatch.path || vMatch.filepath)}`
                    });
                }
                return;
            }

            // 8. Ouvrir et filtrer par artiste
            if (action === "open-artist" || action === "play-artist") {
                const art = actionEl.getAttribute("data-artist");
                if (art) {
                    this.clearUnifiedSearch(false);
                    this.selectedArtistFilter = art;
                    this.selectedGenreFilter = null;
                    this.setView("albums");
                    if (action === "play-artist") {
                        this.playFilteredCollection({ artist: art, shuffle: false });
                    }
                }
                return;
            }

            // 9. Ouvrir et filtrer par genre
            if (action === "open-genre") {
                const g = actionEl.getAttribute("data-genre");
                if (g) {
                    this.clearUnifiedSearch(false);
                    this.selectedGenreFilter = g;
                    this.selectedArtistFilter = null;
                    this.setView("albums");
                }
                return;
            }

            // 10. Ouvrir une playlist
            if (action === "open-playlist") {
                const plId = actionEl.getAttribute("data-playlist-id");
                if (plId) {
                    this.clearUnifiedSearch(false);
                    this.setView("playlists");
                    if (window.UserPlaylists && typeof window.UserPlaylists.openDetail === "function") {
                        window.UserPlaylists.openDetail(plId);
                    }
                }
                return;
            }
        });
    },

    // =========================================================
    // HUB VIDÉO MUSICAL (CLIPS & VIDÉOS 16:9)
    // =========================================================

    async loadAndRenderVideosCatalog(force = false) {
        const grid = document.getElementById("player-videos-grid");
        if (this.videosCatalog && this.videosCatalog.length > 0 && !force) {
            this.updateVideoBadges();
            this.renderVideosGrid();
            if (this.currentView === "videos") {
                const targetVideosY = (this.savedScrollPositions && typeof this.savedScrollPositions["videos"] === "number")
                    ? this.savedScrollPositions["videos"]
                    : 0;
                this.restoreScrollPosition(targetVideosY);
            }
            return;
        }

        this.isLoadingVideos = true;
        if (grid) {
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 40px 20px; text-align: center;">
                    <span class="spinner" style="display:inline-block;width:24px;height:24px;margin-bottom:12px;vertical-align:middle;"></span>
                    <p class="text-muted" style="font-size: 0.9rem;">Chargement des clips vidéo...</p>
                </div>
            `;
        }

        try {
            const url = `/api/videos/catalog${force ? "?force_refresh=true" : ""}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error("Erreur de récupération du catalogue vidéo");
            const data = await res.json();
            this.videosCatalog = data.videos || [];
            this.updateVideoBadges();
            this.renderVideosGrid();
            this.updateScrollBounds();
            if (this.currentView === "videos") {
                const targetVideosY = (this.savedScrollPositions && typeof this.savedScrollPositions["videos"] === "number")
                    ? this.savedScrollPositions["videos"]
                    : 0;
                this.restoreScrollPosition(targetVideosY);
            }
        } catch (err) {
            console.error("Erreur loadAndRenderVideosCatalog:", err);
            if (grid) {
                grid.innerHTML = `
                    <div class="empty-state" style="grid-column: 1 / -1; padding: 40px 20px; text-align: center;">
                        <div style="font-size: 2.5rem; opacity: 0.5; margin-bottom: 8px;">🎬</div>
                        <h4>Aucun clip vidéo disponible</h4>
                        <p class="text-muted" style="font-size: 0.88rem; max-width: 480px; margin: 0 auto 16px auto;">
                            Configurez un dossier de vidéos dans les Paramètres ou téléchargez des clips en format MP4.
                        </p>
                        <button type="button" class="btn btn-secondary" onclick="switchTab('tab-settings')">⚙️ Configurer</button>
                    </div>
                `;
            }
        } finally {
            this.isLoadingVideos = false;
        }
    },

    async loadAndRenderConcertsCatalog(force = false) {
        const grid = document.getElementById("player-concerts-grid");
        if (this.videosCatalog && this.videosCatalog.length > 0 && !force) {
            this.updateVideoBadges();
            this.renderConcertsGrid();
            if (this.currentView === "concerts") {
                const targetConcertsY = (this.savedScrollPositions && typeof this.savedScrollPositions["concerts"] === "number")
                    ? this.savedScrollPositions["concerts"]
                    : 0;
                this.restoreScrollPosition(targetConcertsY);
            }
            return;
        }

        this.isLoadingVideos = true;
        if (grid) {
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 40px 20px; text-align: center;">
                    <span class="spinner" style="display:inline-block;width:24px;height:24px;margin-bottom:12px;vertical-align:middle;"></span>
                    <p class="text-muted" style="font-size: 0.9rem;">Chargement des concerts vidéo...</p>
                </div>
            `;
        }

        try {
            const url = `/api/videos/catalog${force ? "?force_refresh=true" : ""}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error("Erreur de récupération du catalogue vidéo");
            const data = await res.json();
            this.videosCatalog = data.videos || [];
            this.updateVideoBadges();
            this.renderConcertsGrid();
            this.updateScrollBounds();
            if (this.currentView === "concerts") {
                const targetConcertsY = (this.savedScrollPositions && typeof this.savedScrollPositions["concerts"] === "number")
                    ? this.savedScrollPositions["concerts"]
                    : 0;
                this.restoreScrollPosition(targetConcertsY);
            }
        } catch (err) {
            console.error("Erreur loadAndRenderConcertsCatalog:", err);
            if (grid) {
                grid.innerHTML = `
                    <div class="empty-state" style="grid-column: 1 / -1; padding: 40px 20px; text-align: center;">
                        <div style="font-size: 2.5rem; opacity: 0.5; margin-bottom: 8px;">🎸</div>
                        <h4>Aucun concert vidéo disponible</h4>
                        <p class="text-muted" style="font-size: 0.88rem; max-width: 480px; margin: 0 auto 16px auto;">
                            Configurez un dossier de vidéos dans les Paramètres ou téléchargez des concerts en format MP4.
                        </p>
                    </div>
                `;
            }
        } finally {
            this.isLoadingVideos = false;
        }
    },

    updateVideoBadges() {
        const all = this.videosCatalog || [];
        const clips = all.filter(v => v.video_type !== "concert" && !v.is_concert);
        const concerts = all.filter(v => v.video_type === "concert" || v.is_concert);

        const clipsBadge = document.getElementById("player-videos-count-badge");
        if (clipsBadge) {
            clipsBadge.textContent = `${clips.length} clip${clips.length > 1 ? "s" : ""}`;
            clipsBadge.className = clips.length > 0 ? "badge badge-success" : "badge badge-idle";
        }

        const concertsBadge = document.getElementById("player-concerts-count-badge");
        if (concertsBadge) {
            concertsBadge.textContent = `${concerts.length} concert${concerts.length > 1 ? "s" : ""}`;
            concertsBadge.className = concerts.length > 0 ? "badge badge-success" : "badge badge-idle";
        }
    },

    // Utilitaire : vérifie si l'artiste est inconnu ou générique (SoundStash v3.3.1)
    isUnknownArtist(artist) {
        if (!artist) return true;
        const a = artist.trim().toLowerCase();
        return [
            "artiste inconnu", "unknown artist", "unknown", "inconnu",
            "clips divers", "divers", "na", "n/a", "none"
        ].includes(a);
    },

    // Action : envoyer directement un élément à l'Atelier de tag pour identifier l'artiste
    async sendVideoToTagEditor(item) {
        if (!item) return;
        const targetPath = item.filepath || item.path || item.rel_path;
        if (!targetPath) {
            if (typeof showToast === "function") showToast("Chemin du média introuvable.", "warning");
            return;
        }

        // Fermer la fenêtre de lecture vidéo si elle est active
        if (typeof closeVideoModal === "function") {
            closeVideoModal(false);
        }

        // Ouvrir le tiroir Atelier sur l'onglet Éditeur
        if (typeof openWorkshopDrawer === "function") {
            openWorkshopDrawer("tab-editor");
        } else if (typeof switchTab === "function") {
            switchTab("tab-editor");
        }

        // Charger l'élément dans l'éditeur de tags (mode vidéothèque)
        if (typeof window.loadAlbumInEditor === "function") {
            await window.loadAlbumInEditor(targetPath, "videos");
        }

        // Donner le focus immédiat au champ de saisie de l'artiste
        setTimeout(() => {
            const artInput = document.getElementById("edit-album-artist") || document.getElementById("editor-album-artist");
            if (artInput) {
                artInput.focus();
                artInput.select();
            }
            if (typeof showToast === "function") {
                showToast("🏷️ Vidéo chargée dans l'Atelier. Renseignez l'artiste puis validez !", "info");
            }
        }, 350);
    },

    renderVideosGrid() {
        const grid = document.getElementById("player-videos-grid");
        const countBadge = document.getElementById("player-videos-count-badge");
        if (!grid) return;

        let list = [...(this.videosCatalog || [])].filter(v => v.video_type !== "concert" && !v.is_concert);

        // 1. Filtrage recherche
        if (this.videosSearchFilter && this.videosSearchFilter.trim()) {
            const q = this.videosSearchFilter.toLowerCase().trim();
            list = list.filter(v => 
                (v.title || "").toLowerCase().includes(q) ||
                (v.artist || "").toLowerCase().includes(q) ||
                (v.filename || "").toLowerCase().includes(q)
            );
        }

        // 2. Tri
        const sortMode = this.videosSortMode || "recent";
        list.sort((a, b) => {
            const artA = (a.artist || "").toLowerCase();
            const artB = (b.artist || "").toLowerCase();
            const titA = (a.title || "").toLowerCase();
            const titB = (b.title || "").toLowerCase();

            switch (sortMode) {
                case "artist-asc":
                    return artA.localeCompare(artB) || titA.localeCompare(titB);
                case "title-asc":
                    return titA.localeCompare(titB) || artA.localeCompare(artB);
                case "resolution-desc": {
                    const hA = a.height || 0;
                    const hB = b.height || 0;
                    return (hB - hA) || artA.localeCompare(artB);
                }
                case "duration-desc": {
                    const dA = a.duration_seconds || 0;
                    const dB = b.duration_seconds || 0;
                    return (dB - dA);
                }
                case "recent":
                default:
                    return (b.mtime || 0) - (a.mtime || 0);
            }
        });

        if (countBadge) {
            countBadge.textContent = `${list.length} clip${list.length > 1 ? "s" : ""}`;
            countBadge.className = list.length > 0 ? "badge badge-success" : "badge badge-idle";
        }

        if (list.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; padding: 40px 20px; text-align: center;">
                    <div style="font-size: 2.5rem; opacity: 0.5; margin-bottom: 8px;">🎬</div>
                    <h4>Aucun clip trouvé</h4>
                    <p class="text-muted" style="font-size: 0.88rem; max-width: 480px; margin: 0 auto 16px auto;">
                        ${this.videosSearchFilter ? `Aucun clip ne correspond à « ${escapeHtml(this.videosSearchFilter)} »` : "Votre bibliothèque vidéo est vide pour le moment. Déposez des fichiers .mp4 ou téléchargez un clip."}
                    </p>
                    ${!this.videosSearchFilter ? `
                        <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                            <button type="button" class="btn btn-primary" onclick="switchTab('tab-download')">
                                📥 Télécharger un Clip MP4
                            </button>
                            <button type="button" class="btn btn-secondary" onclick="AudioPlayer.syncAndReloadVideos()">
                                ⚡ Vérifier le dossier
                            </button>
                        </div>
                    ` : ""}
                </div>
            `;
            return;
        }

        let html = "";
        list.forEach((v, idx) => {
            const h = v.height || 0;
            let resBadge = "HD";
            let resClass = "";
            if (h >= 2160) {
                resBadge = "4K";
                resClass = "badge-4k";
            } else if (h >= 1440) {
                resBadge = "2K";
                resClass = "badge-2k";
            } else if (h >= 1080) {
                resBadge = "1080p";
                resClass = "badge-1080p";
            } else if (h >= 720) {
                resBadge = "720p";
            } else if (h > 0) {
                resBadge = `${h}p`;
            }

            const durStr = v.duration_str || (v.duration_seconds ? formatTime(v.duration_seconds) : "");
            const thumbUrl = `/api/videos/thumbnail?path=${encodeURIComponent(v.rel_path || v.path)}`;

            html += `
                <div class="player-video-card" data-video-idx="${idx}">
                    <div class="player-video-thumb-wrap">
                        <img class="player-video-thumb" src="${thumbUrl}" alt="${escapeHtml(v.title)}" loading="lazy" onerror="this.onerror=null; this.src='/static/placeholder-cover.svg';">
                        <span class="player-video-badge-res ${resClass}">${resBadge}</span>
                        ${durStr ? `<span class="player-video-badge-dur">${durStr}</span>` : ""}
                        <div class="player-video-play-overlay">
                            <div class="player-video-play-icon-btn" title="Regarder le clip">
                                <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                            </div>
                        </div>
                    </div>
                    <div class="player-video-body">
                        <h4 class="player-video-title" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</h4>
                        <div class="player-video-artist ${this.isUnknownArtist(v.artist) ? 'artist-unknown' : ''}" title="${escapeHtml(v.artist)}">
                            <span>${escapeHtml(v.artist)}</span>
                            ${this.isUnknownArtist(v.artist) ? `<button type="button" class="btn-tag-unknown-artist" title="Identifier et taguer cet artiste dans l'Atelier" data-video-idx="${idx}">🏷️ Taguer</button>` : ""}
                        </div>
                        <div class="player-video-footer">
                            <span>${v.size_str || ""}</span>
                            <div class="player-video-actions">
                                ${this.isUnknownArtist(v.artist) ? `
                                    <button type="button" class="player-video-action-btn btn-send-to-tagger" title="🏷️ Artiste inconnu : envoyer vers l'Atelier de tag" data-video-idx="${idx}">
                                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/></svg>
                                    </button>
                                ` : ""}
                                <button type="button" class="player-video-action-btn btn-video-enqueue-next" title="Lire ce clip ensuite (priorité)" data-video-idx="${idx}">
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                                </button>
                                <button type="button" class="player-video-action-btn btn-video-enqueue" title="Ajouter ce clip à la file d'attente" data-video-idx="${idx}">
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
                                </button>
                                <button type="button" class="player-video-action-btn btn-video-add-playlist" title="Ajouter ce clip à une playlist" data-video-idx="${idx}">
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/></svg>
                                </button>
                                <button type="button" class="player-video-action-btn btn-extract-audio" title="Extraire l'audio en M4A dans ma collection" data-video-idx="${idx}">
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });

        grid.innerHTML = html;

        // Écouteur pour envoyer vers l'Atelier de tag si artiste inconnu
        grid.querySelectorAll(".btn-tag-unknown-artist, .btn-send-to-tagger").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute("data-video-idx"), 10);
                const item = list[idx];
                if (item) {
                    this.sendVideoToTagEditor(item);
                }
            });
        });

        // Écouteurs de clics sur les cartes vidéo
        grid.querySelectorAll(".player-video-card").forEach(card => {
            card.addEventListener("click", (e) => {
                // Si l'utilisateur clique sur un bouton d'action, ne pas ouvrir la vidéo
                if (e.target.closest(".player-video-action-btn") || e.target.closest(".btn-tag-unknown-artist")) return;
                const idx = parseInt(card.getAttribute("data-video-idx"), 10);
                const item = list[idx];
                if (item) {
                    if (typeof window.captureAudioStateBeforeVideo === "function") {
                        window.captureAudioStateBeforeVideo();
                    }
                    openLocalVideoModal(item);
                }
            });
        });

        // Écouteur pour lire la vidéo ensuite
        grid.querySelectorAll(".btn-video-enqueue-next").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute("data-video-idx"), 10);
                const item = list[idx];
                if (item) this.enqueueVideo(item, true);
            });
        });

        // Écouteur pour ajouter la vidéo à la file d'attente
        grid.querySelectorAll(".btn-video-enqueue").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute("data-video-idx"), 10);
                const item = list[idx];
                if (item) this.enqueueVideo(item, false);
            });
        });

        // Écouteur pour ajouter une vidéo à une playlist
        grid.querySelectorAll(".btn-video-add-playlist").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute("data-video-idx"), 10);
                const item = list[idx];
                if (!item) return;
                openAddToPlaylistModal({
                    type: "video",
                    title: item.title,
                    artist: item.artist,
                    path: item.rel_path || item.filepath || item.path,
                    filepath: item.filepath || item.path || item.rel_path,
                    rel_path: item.rel_path || "",
                    duration: item.duration || item.duration_seconds || 0,
                    height: item.height || 1080,
                    cover_url: `/api/videos/thumbnail?path=${encodeURIComponent(item.rel_path || item.path || item.filepath)}`
                });
            });
        });

        // Écouteurs pour l'extraction audio directe depuis la carte
        grid.querySelectorAll(".btn-extract-audio").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute("data-video-idx"), 10);
                const item = list[idx];
                if (!item) return;

                const trackArtist = item.artist || "Artiste inconnu";
                const trackTitle = item.title || "Titre du clip";

                const confirmed = await showModalConfirm(
                    "Extraire la piste audio",
                    `Voulez-vous extraire la piste audio de « ${trackTitle} » et l'ajouter à votre collection sous « ${trackArtist} / Singles & Rips » ?`,
                    "🎵 Extraire l'audio",
                    false,
                    "Annuler"
                );
                if (!confirmed) return;

                btn.disabled = true;
                btn.style.opacity = "0.5";
                showToast(`Extraction audio de « ${item.title} » en cours...`, "info");

                try {
                    const res = await fetch("/api/videos/extract-audio", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            path: item.rel_path || item.filepath || item.path,
                            artist: item.artist,
                            title: item.title
                        })
                    });
                    let resData = null;
                    try {
                        resData = await res.json();
                    } catch (parseErr) {
                        resData = { detail: `Erreur serveur (${res.status})` };
                    }

                    if (res.ok && resData && resData.success) {
                        showToast(resData.message || "Piste audio extraite dans votre collection !", "success");
                        if (window.AudioPlayer && typeof window.AudioPlayer.loadLibraryData === "function") {
                            window.AudioPlayer.loadLibraryData();
                        }
                        if (typeof loadLibrary === "function") {
                            loadLibrary();
                        }
                    } else {
                        showToast(resData?.detail || resData?.error || `Erreur lors de l'extraction (${res.status})`, "error");
                    }
                } catch (err) {
                    showToast("Échec de communication lors de l'extraction audio", "error");
                } finally {
                    btn.disabled = false;
                    btn.style.opacity = "1";
                }
            });
        });
    },

    renderConcertsGrid() {
        const grid = document.getElementById("player-concerts-grid");
        const countBadge = document.getElementById("player-concerts-count-badge");
        if (!grid) return;

        let list = [...(this.videosCatalog || [])].filter(v => v.video_type === "concert" || v.is_concert);

        // 1. Filtrage recherche
        if (this.concertsSearchFilter && this.concertsSearchFilter.trim()) {
            const q = this.concertsSearchFilter.toLowerCase().trim();
            list = list.filter(v => 
                (v.title || "").toLowerCase().includes(q) ||
                (v.artist || "").toLowerCase().includes(q) ||
                (v.filename || "").toLowerCase().includes(q)
            );
        }

        // 2. Tri (défaut : duration-desc)
        const sortMode = this.concertsSortMode || "duration-desc";
        list.sort((a, b) => {
            const artA = (a.artist || "").toLowerCase();
            const artB = (b.artist || "").toLowerCase();
            const titA = (a.title || "").toLowerCase();
            const titB = (b.title || "").toLowerCase();

            switch (sortMode) {
                case "artist-asc":
                    return artA.localeCompare(artB) || titA.localeCompare(titB);
                case "title-asc":
                    return titA.localeCompare(titB) || artA.localeCompare(artB);
                case "resolution-desc": {
                    const hA = a.height || 0;
                    const hB = b.height || 0;
                    return (hB - hA) || artA.localeCompare(artB);
                }
                case "recent":
                    return (b.mtime || 0) - (a.mtime || 0);
                case "duration-desc":
                default: {
                    const dA = a.duration_seconds || 0;
                    const dB = b.duration_seconds || 0;
                    return (dB - dA);
                }
            }
        });

        if (countBadge) {
            countBadge.textContent = `${list.length} concert${list.length > 1 ? "s" : ""}`;
            countBadge.className = list.length > 0 ? "badge badge-success" : "badge badge-idle";
        }

        if (list.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; padding: 40px 20px; text-align: center;">
                    <div style="font-size: 2.5rem; opacity: 0.5; margin-bottom: 8px;">🎸</div>
                    <h4>Aucun concert trouvé</h4>
                    <p class="text-muted" style="font-size: 0.88rem; max-width: 480px; margin: 0 auto 16px auto;">
                        ${this.concertsSearchFilter ? `Aucun concert ne correspond à « ${escapeHtml(this.concertsSearchFilter)} »` : "Votre bibliothèque de concerts est vide pour le moment. Téléchargez des concerts complets en MP4 ou classez vos vidéos dans un sous-dossier Concerts."}
                    </p>
                    ${!this.concertsSearchFilter ? `
                        <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                            <button type="button" class="btn btn-primary" onclick="switchTab('tab-download')">
                                📥 Télécharger un Concert MP4
                            </button>
                            <button type="button" class="btn btn-secondary" onclick="AudioPlayer.syncAndReloadVideos()">
                                ⚡ Vérifier le dossier
                            </button>
                        </div>
                    ` : ""}
                </div>
            `;
            return;
        }

        let html = "";
        list.forEach((v, idx) => {
            const h = v.height || 0;
            let resBadge = "HD";
            let resClass = "";
            if (h >= 2160) {
                resBadge = "4K";
                resClass = "badge-4k";
            } else if (h >= 1440) {
                resBadge = "2K";
                resClass = "badge-2k";
            } else if (h >= 1080) {
                resBadge = "1080p";
                resClass = "badge-1080p";
            } else if (h >= 720) {
                resBadge = "720p";
            } else if (h > 0) {
                resBadge = `${h}p`;
            }

            // Durée formatée élégante (ex: 1h 45m ou 45m 12s)
            let durFormatted = "";
            if (v.duration_seconds) {
                const sec = Math.round(v.duration_seconds);
                const hrs = Math.floor(sec / 3600);
                const mins = Math.floor((sec % 3600) / 60);
                if (hrs > 0) {
                    durFormatted = `${hrs}h ${mins.toString().padStart(2, '0')}m`;
                } else {
                    durFormatted = `${mins}m ${(sec % 60).toString().padStart(2, '0')}s`;
                }
            } else if (v.duration_str) {
                durFormatted = v.duration_str;
            }

            const thumbUrl = `/api/videos/thumbnail?path=${encodeURIComponent(v.rel_path || v.path)}`;

            html += `
                <div class="player-video-card player-concert-card" data-concert-idx="${idx}">
                    <div class="player-video-thumb-wrap">
                        <img class="player-video-thumb" src="${thumbUrl}" alt="${escapeHtml(v.title)}" loading="lazy" onerror="this.onerror=null; this.src='/static/placeholder-cover.svg';">
                        <span class="player-video-badge-concert">🎸 Concert</span>
                        <span class="player-video-badge-res ${resClass}">${resBadge}</span>
                        ${durFormatted ? `<span class="player-video-badge-dur" style="font-weight: 700; background: rgba(0,0,0,0.85);">${durFormatted}</span>` : ""}
                        <div class="player-video-play-overlay">
                            <div class="player-video-play-icon-btn" title="Regarder le concert">
                                <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                            </div>
                        </div>
                    </div>
                    <div class="player-video-body">
                        <h4 class="player-video-title" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</h4>
                        <div class="player-video-artist ${this.isUnknownArtist(v.artist) ? 'artist-unknown' : ''}" title="${escapeHtml(v.artist)}">
                            <span>${escapeHtml(v.artist)}</span>
                            ${this.isUnknownArtist(v.artist) ? `<button type="button" class="btn-tag-unknown-artist" title="Identifier et taguer cet artiste dans l'Atelier" data-concert-idx="${idx}">🏷️ Taguer</button>` : ""}
                        </div>
                        <div class="player-video-footer">
                            <span>${v.size_str || ""}</span>
                            <div class="player-video-actions">
                                ${this.isUnknownArtist(v.artist) ? `
                                    <button type="button" class="player-video-action-btn btn-send-to-tagger" title="🏷️ Artiste inconnu : envoyer vers l'Atelier de tag" data-concert-idx="${idx}">
                                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/></svg>
                                    </button>
                                ` : ""}
                                <button type="button" class="player-video-action-btn btn-concert-enqueue-next" title="Lire ce concert ensuite (priorité)" data-concert-idx="${idx}">
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                                </button>
                                <button type="button" class="player-video-action-btn btn-concert-enqueue" title="Ajouter ce concert à la file d'attente" data-concert-idx="${idx}">
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
                                </button>
                                <button type="button" class="player-video-action-btn btn-concert-add-playlist" title="Ajouter ce concert à une playlist" data-concert-idx="${idx}">
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/></svg>
                                </button>
                                <button type="button" class="player-video-action-btn btn-extract-concert-audio" title="Extraire l'audio du concert en M4A dans ma collection" data-concert-idx="${idx}">
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });

        grid.innerHTML = html;

        // Écouteur pour envoyer vers l'Atelier de tag si artiste inconnu
        grid.querySelectorAll(".btn-tag-unknown-artist, .btn-send-to-tagger").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute("data-concert-idx"), 10);
                const item = list[idx];
                if (item) {
                    this.sendVideoToTagEditor(item);
                }
            });
        });

        // Écouteurs de clics sur les cartes concert (lancement direct en grand écran)
        grid.querySelectorAll(".player-concert-card").forEach(card => {
            card.addEventListener("click", (e) => {
                if (e.target.closest(".player-video-action-btn") || e.target.closest(".btn-tag-unknown-artist")) return;
                const idx = parseInt(card.getAttribute("data-concert-idx"), 10);
                const item = list[idx];
                if (item) {
                    if (typeof window.captureAudioStateBeforeVideo === "function") {
                        window.captureAudioStateBeforeVideo();
                    }
                    openLocalVideoModal(item);
                }
            });
        });

        // Écouteur pour lire le concert ensuite
        grid.querySelectorAll(".btn-concert-enqueue-next").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute("data-concert-idx"), 10);
                const item = list[idx];
                if (item) this.enqueueVideo(item, true);
            });
        });

        // Écouteur pour ajouter le concert à la file d'attente
        grid.querySelectorAll(".btn-concert-enqueue").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute("data-concert-idx"), 10);
                const item = list[idx];
                if (item) this.enqueueVideo(item, false);
            });
        });

        // Écouteur pour ajouter un concert à une playlist
        grid.querySelectorAll(".btn-concert-add-playlist").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute("data-concert-idx"), 10);
                const item = list[idx];
                if (!item) return;
                openAddToPlaylistModal({
                    type: "video",
                    title: item.title,
                    artist: item.artist,
                    path: item.rel_path || item.filepath || item.path,
                    filepath: item.filepath || item.path || item.rel_path,
                    rel_path: item.rel_path || "",
                    duration: item.duration || item.duration_seconds || 0,
                    height: item.height || 1080,
                    cover_url: `/api/videos/thumbnail?path=${encodeURIComponent(item.rel_path || item.path || item.filepath)}`
                });
            });
        });

        // Écouteurs pour l'extraction audio du concert
        grid.querySelectorAll(".btn-extract-concert-audio").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute("data-concert-idx"), 10);
                const item = list[idx];
                if (!item) return;

                const trackArtist = item.artist || "Artiste inconnu";
                const trackTitle = item.title || "Concert";

                const confirmed = await showModalConfirm(
                    "Extraire l'audio du concert",
                    `Voulez-vous extraire la piste audio de « ${trackTitle} » et l'ajouter à votre collection sous « ${trackArtist} / Singles & Rips » ?`,
                    "🎵 Extraire l'audio",
                    false,
                    "Annuler"
                );
                if (!confirmed) return;

                btn.disabled = true;
                btn.style.opacity = "0.5";
                showToast(`Extraction audio de « ${item.title} » en cours...`, "info");

                try {
                    const res = await fetch("/api/videos/extract-audio", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            path: item.rel_path || item.filepath || item.path,
                            artist: item.artist,
                            title: item.title
                        })
                    });
                    let resData = null;
                    try {
                        resData = await res.json();
                    } catch (parseErr) {
                        resData = { detail: `Erreur serveur (${res.status})` };
                    }

                    if (res.ok && resData && resData.success) {
                        showToast(resData.message || "Piste audio du concert extraite dans votre collection !", "success");
                        if (window.AudioPlayer && typeof window.AudioPlayer.loadLibraryData === "function") {
                            window.AudioPlayer.loadLibraryData();
                        }
                        if (typeof loadLibrary === "function") {
                            loadLibrary();
                        }
                    } else {
                        showToast(resData?.detail || resData?.error || `Erreur lors de l'extraction (${res.status})`, "error");
                    }
                } catch (err) {
                    showToast("Échec de communication lors de l'extraction audio", "error");
                } finally {
                    btn.disabled = false;
                    btn.style.opacity = "1";
                }
            });
        });
    },

    async syncAndReloadVideos() {
        const syncBtn = document.getElementById("player-videos-sync-btn");
        const concSyncBtn = document.getElementById("player-concerts-sync-btn");
        if (syncBtn) {
            syncBtn.disabled = true;
            syncBtn.innerHTML = `<span class="spinner" style="display:inline-block;width:14px;height:14px;"></span>`;
        }
        if (concSyncBtn) {
            concSyncBtn.disabled = true;
            concSyncBtn.innerHTML = `<span class="spinner" style="display:inline-block;width:14px;height:14px;"></span>`;
        }

        try {
            const res = await fetch("/api/videos/synchronize", { method: "POST" });
            const data = await res.json();
            if (res.ok && data.success) {
                const rep = data.report || {};
                if (rep.healed_loose > 0 || rep.renamed_titles > 0) {
                    showToast(`Sync terminée : ${rep.healed_loose} clip(s)/concert(s) classé(s), ${rep.renamed_titles} titre(s) nettoyé(s).`, "success");
                } else {
                    showToast("Vidéothèque et concerts actualisés avec succès !", "success");
                }
            } else {
                showToast(data.detail || "Erreur lors de l'actualisation", "warning");
            }
        } catch (err) {
            showToast("Échec de communication lors de l'actualisation", "error");
        } finally {
            const syncIcon = `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>`;
            if (syncBtn) {
                syncBtn.disabled = false;
                syncBtn.innerHTML = syncIcon;
            }
            if (concSyncBtn) {
                concSyncBtn.disabled = false;
                concSyncBtn.innerHTML = syncIcon;
            }
            await this.loadAndRenderVideosCatalog(true);
            if (this.currentView === "concerts") {
                this.renderConcertsGrid();
            }
        }
    },

    clearAllFilters() {
        this.selectedArtistFilter = null;
        this.selectedGenreFilter = null;
        this.selectedTypeFilters = new Set(["album", "single", "rip", "playlist"]);
        this.searchFilter = "";
        this.allSearchQuery = "";
        const inp = document.getElementById("player-search-input");
        if (inp) inp.value = "";
        const clr = document.getElementById("player-search-clear-btn");
        if (clr) clr.style.display = "none";
        this.renderCurrentView();
    },

    play() {
        if (!this.audio) return;
        if (this.isRadioPlaying && this.currentRadio) {
            if (this._isRestoringSavedSession || !this._hasPlayedInCurrentRun || !this.audio.src) {
                this._isRestoringSavedSession = false;
                this._hasPlayedInCurrentRun = true;
                if (window.RadioManager && typeof window.RadioManager.playStation === "function") {
                    window.RadioManager.playStation(this.currentRadio);
                    return;
                }
            }
            const offset = (window.RadioManager && typeof window.RadioManager.state.currentOffset === "number")
                ? window.RadioManager.state.currentOffset
                : 0;
            const targetUrl = `/api/radio/stream?offset=${encodeURIComponent(offset)}&_t=${Date.now()}`;
            this.audio.src = targetUrl;
            this.audio.load();
            this.audio.volume = this.isMuted ? 0 : (typeof this.volume === "number" ? this.volume : 1);
            this.isPlaying = true;
            this._hasPlayedInCurrentRun = true;
            if (window.RadioManager) window.RadioManager.startStatusPolling();
            this.audio.play().catch(e => console.warn(e));
            this.updatePlayStateUI();
            this.syncSystemMediaState();
            return;
        }
        if (!this.audio.src) {
            if (this.playlist.length > 0 && this.currentIndex >= 0) {
                const resumeSec = this._pendingResumeSeekTime || 0;
                this._pendingResumeSeekTime = 0;
                this.playTrackAtIndex(this.currentIndex, resumeSec);
            }
            return;
        }
        if (this.audio.paused) {
            if (window.closeVideoModal && (window.isVideoPlayingInBackground || (document.getElementById("video-modal-player") && !document.getElementById("video-modal-player").paused))) {
                window.closeVideoModal(true);
            }
            if (this._pendingResumeSeekTime && this._pendingResumeSeekTime > 0 && this.audio.readyState >= 1) {
                const targetTime = this._pendingResumeSeekTime;
                this._pendingResumeSeekTime = 0;
                try {
                    this.audio.currentTime = targetTime;
                } catch (e) {}
            }
            this._hasPlayedInCurrentRun = true;
            AudioFader.fadeIn(this.audio, this.isMuted ? 0 : this.volume, 500);
            this.audio.play().catch(e => console.warn(e));
        }
    },

    async pause() {
        if (this.audio && !this.audio.paused) {
            if (AudioFader.enabled) {
                const completed = await AudioFader.fadeOut(this.audio, 400);
                if (completed === false) return;
            }
            this.audio.pause();
            this.audio.volume = this.isMuted ? 0 : this.volume;
        }
    },

    togglePlayPause() {
        const curTrk = (this.playlist && this.currentIndex >= 0) ? this.playlist[this.currentIndex] : null;
        const isVideo = curTrk && (curTrk.type === "video" || curTrk.is_video || (curTrk.filepath && /\.(mp4|mkv|webm)$/i.test(curTrk.filepath)) || (curTrk.path && /\.(mp4|mkv|webm)$/i.test(curTrk.path)));
        if (isVideo) {
            const vPlayer = document.getElementById("video-modal-player");
            const isModalActive = document.getElementById("video-modal-backdrop")?.classList.contains("active");
            if (vPlayer && (isModalActive || window.isVideoPlayingInBackground)) {
                if (vPlayer.paused) {
                    vPlayer.play().catch(e => console.warn(e));
                    this.isPlaying = true;
                } else {
                    vPlayer.pause();
                    this.isPlaying = false;
                }
                this.updatePlayStateUI();
                return;
            }
            this.playTrackAtIndex(this.currentIndex);
            return;
        }

        // CAS RADIO WEB : Contrôle prioritaire Play/Pause du flux radio
        if (this.isRadioPlaying && this.currentRadio) {
            if (this._isRestoringSavedSession || !this._hasPlayedInCurrentRun || !this.audio.src) {
                this._isRestoringSavedSession = false;
                this._hasPlayedInCurrentRun = true;
                if (window.RadioManager && typeof window.RadioManager.playStation === "function") {
                    window.RadioManager.playStation(this.currentRadio);
                    return;
                }
            }
            if (!this.isPlaying || this.audio.paused) {
                this.play();
            } else {
                this.pause();
            }
            return;
        }

        if (!this.audio.src) {
            if (this.playlist.length > 0 && this.currentIndex >= 0) {
                this.playTrackAtIndex(this.currentIndex);
            } else if ((this.libraryAlbums && this.libraryAlbums.length > 0) || (this.allCatalog && this.allCatalog.albums && this.allCatalog.albums.length > 0)) {
                this.playEntireCollection({ shuffle: false });
            }
            return;
        }
        if (this.audio.paused) {
            this.play();
        } else {
            this.pause();
        }
    },

    playNext() {
        if (this.isRadioPlaying && window.RadioManager) {
            window.RadioManager.jumpToLive();
            return;
        }
        // Niveau 1 : File prioritaire manuelle (Morceaux ajoutés via « Lire ensuite » ou « En file »)
        if (this.userQueue && this.userQueue.length > 0) {
            // Mémoriser l'album d'origine pour y revenir ensuite exactement où l'on s'est arrêté
            if (!this.playbackContext && this.currentAlbum && this.playlist && this.currentIndex >= 0) {
                this.playbackContext = {
                    album: this.currentAlbum,
                    playlist: this.playlist.slice(),
                    currentIndex: this.currentIndex
                };
            }
            const nextTrack = this.userQueue.shift();
            this.updateQueueBadges();
            this.playQueueTrack(nextTrack);
            if (this.isQueueDrawerOpen) this.renderQueueDrawer();
            return;
        }

        // Niveau 2 : Retour ou continuation dans le contexte de l'album d'origine
        if (this.currentTrackIsFromQueue) {
            this.currentTrackIsFromQueue = false;
            this.currentQueueTrack = null;
            if (this.playbackContext && this.playbackContext.album) {
                this.currentAlbum = this.playbackContext.album;
                this.playlist = this.playbackContext.playlist;
                const nextIdx = this.playbackContext.currentIndex + 1;
                if (nextIdx < this.playlist.length) {
                    this.playbackContext.currentIndex = nextIdx;
                    this.renderPlayerTab();
                    this.playTrackAtIndex(nextIdx);
                    if (this.isQueueDrawerOpen) this.renderQueueDrawer();
                    return;
                } else {
                    this.handleEndOfAlbum();
                    if (this.isQueueDrawerOpen) this.renderQueueDrawer();
                    return;
                }
            }
        }

        // Lecture séquentielle ou aléatoire
        const list = (this.activePlaylist && this.activePlaylist.length > 0) ? this.activePlaylist : this.playlist;
        if (!list || list.length === 0) return;

        if (this.isShuffle) {
            // Si la répétition d'album est active (repeatMode === 'all') et qu'on lit un album individuel hors collection
            const isSingleAlbumRestricted = (this.repeatMode === "all" && this.currentAlbum && this.currentAlbum.path && !this.currentAlbum.path.startsWith("playlist:") && this.currentAlbum.path !== "system:all-collection" && this.playlist && this.playlist.length > 0);
            if (isSingleAlbumRestricted) {
                // Aléatoire confiné aux pistes de l'album en cours
                let nextIdx = Math.floor(Math.random() * list.length);
                if (list.length > 1 && nextIdx === this.currentIndex) {
                    nextIdx = (nextIdx + 1) % list.length;
                }
                if (this.playbackContext) this.playbackContext.currentIndex = nextIdx;
                this.playTrackAtIndex(nextIdx);
                if (this.isQueueDrawerOpen) this.renderQueueDrawer();
                return;
            }

            // Aléatoire standard (sur la liste active / toute la collection)
            let nextIdx = Math.floor(Math.random() * list.length);
            if (list.length > 1 && nextIdx === this.currentIndex) {
                nextIdx = (nextIdx + 1) % list.length;
            }
            if (this.playbackContext) this.playbackContext.currentIndex = nextIdx;
            this.playTrackAtIndex(nextIdx);
            if (this.isQueueDrawerOpen) this.renderQueueDrawer();
            return;
        }

        // Lecture séquentielle stricte : piste suivante dans la liste
        let nextIdx = this.currentIndex + 1;
        if (nextIdx < list.length) {
            if (this.playbackContext) this.playbackContext.currentIndex = nextIdx;
            this.playTrackAtIndex(nextIdx);
            if (this.isQueueDrawerOpen) this.renderQueueDrawer();
        } else {
            this.handleEndOfAlbum();
            if (this.isQueueDrawerOpen) this.renderQueueDrawer();
        }
    },

    playPrev() {
        if (this.isRadioPlaying && window.RadioManager) {
            window.RadioManager.seekRelative(-15);
            return;
        }
        const vPlayer = document.getElementById("video-modal-player");
        if (vPlayer && (window.isVideoPlayingInBackground || document.getElementById("video-modal-backdrop")?.classList.contains("active"))) {
            if (vPlayer.currentTime > 3) {
                vPlayer.currentTime = 0;
                return;
            }
        } else if (this.audio && this.audio.currentTime > 3) {
            this.audio.currentTime = 0;
            return;
        }
        if (this.currentTrackIsFromQueue) {
            if (this.audio) this.audio.currentTime = 0;
            return;
        }
        const list = (this.activePlaylist && this.activePlaylist.length > 0) ? this.activePlaylist : this.playlist;
        if (!list || list.length === 0) return;
        let prevIdx = this.currentIndex - 1;
        if (prevIdx < 0) {
            prevIdx = (this.repeatMode === "all" || this.endOfAlbumBehavior === "repeat") ? list.length - 1 : 0;
        }
        if (this.playbackContext) this.playbackContext.currentIndex = prevIdx;
        this.playTrackAtIndex(prevIdx);
        if (this.isQueueDrawerOpen) this.renderQueueDrawer();
    },

    handleTrackEnded() {
        if (this.repeatMode === "one") {
            this.audio.currentTime = 0;
            AudioFader.fadeIn(this.audio, this.isMuted ? 0 : this.volume, 500);
            this.audio.play().catch(e => console.warn(e));
            return;
        }
        this.playNext();
    },

    handleEndOfAlbum() {
        if (window.SleepTimer && window.SleepTimer.onAlbumEnded()) {
            return;
        }

        if (this.repeatMode === "all" || this.endOfAlbumBehavior === "repeat") {
            const list = (this.activePlaylist && this.activePlaylist.length > 0) ? this.activePlaylist : this.playlist;
            if (this.currentAlbum && this.currentAlbum.path === "system:all-collection" && list && list.length > 0) {
                if (this.playbackContext) this.playbackContext.currentIndex = 0;
                this.playTrackAtIndex(0);
                showToast("🔁 Répétition de la collection", "info");
                return;
            }
            if (this.playbackContext) this.playbackContext.currentIndex = 0;
            this.playTrackAtIndex(0);
            showToast("🔁 Répétition de l'album", "info");
            return;
        }

        if (this.endOfAlbumBehavior === "random") {
            if (this.libraryAlbums && this.libraryAlbums.length > 0) {
                const currentPath = this.currentAlbum ? this.currentAlbum.path : "";
                let candidates = this.libraryAlbums.filter(a => a.path !== currentPath);
                if (candidates.length === 0) candidates = this.libraryAlbums.slice();
                const randomAlb = candidates[Math.floor(Math.random() * candidates.length)];
                showToast(`🔀 Enchaînement : Lecture de « ${randomAlb.title} » (${randomAlb.artist})`, "info");
                this.loadAlbum(randomAlb.path, { autoPlay: true, isCollection: (this.librarySource === "library"), switchView: false });
                return;
            }
        }

        // Enchaînement séquentiel continu dans l'onglet Tout (Catalogue Intégral)
        const isFromAll = (this.currentView === "all" || (this.playbackOrigin && this.playbackOrigin.view === "all") || (this.playbackOrigin && this.playbackOrigin.type === "all"));
        if (isFromAll && !this.isShuffle && this.currentAlbum && this.currentAlbum.path) {
            const catalogAlbums = (this._currentCatalogAlbums && this._currentCatalogAlbums.length > 0)
                ? this._currentCatalogAlbums
                : ((this.allCatalog && Array.isArray(this.allCatalog.albums)) ? this.allCatalog.albums : null);
            if (catalogAlbums && catalogAlbums.length > 0) {
                const curNorm = (this.currentAlbum.path || "").replace(/\\/g, "/").toLowerCase();
                const curIdx = catalogAlbums.findIndex(a => (a.path || "").replace(/\\/g, "/").toLowerCase() === curNorm);
                if (curIdx >= 0 && curIdx + 1 < catalogAlbums.length) {
                    const nextAlb = catalogAlbums[curIdx + 1];
                    showToast(`▶ Album suivant : « ${nextAlb.title || "Album"} » (${nextAlb.artist || "Artiste"})`, "info", 3000);
                    this.loadAlbum(nextAlb.path, { autoPlay: true, startTrackIndex: 0, isCollection: (this.librarySource === "library"), switchView: false });
                    return;
                }
            }
        }

        // Par défaut : arrêt propre
        if (window.closeVideoModal) {
            window.closeVideoModal(true);
        }
        if (this.audio && !this.audio.paused && AudioFader.enabled) {
            AudioFader.fadeOut(this.audio, 400).then((completed) => {
                if (completed === false) return;
                this.audio.pause();
                this.isPlaying = false;
                this.updatePlayStateUI();
            });
        } else {
            this.audio.pause();
            this.isPlaying = false;
            this.updatePlayStateUI();
        }
        showToast("⏹️ Fin de l'album.", "info");
    },

    playQueueTrack(track) {
        if (!track) return;
        this.currentTrackIsFromQueue = true;
        this.currentQueueTrack = track;
        this.currentTrack = track;

        const isVideo = Boolean(
            track.type === "video" ||
            track.is_video ||
            (track.filepath && /\.(mp4|mkv|webm)$/i.test(track.filepath)) ||
            (track.rel_path && /\.(mp4|mkv|webm)$/i.test(track.rel_path))
        );

        if (isVideo) {
            window._savedAudioStateBeforeVideo = null;
            this.isPlaying = true;
            if (this.audio) {
                this.audio.pause();
            }
            this.updateCurrentTrackUI(track);
            this.updatePlayStateUI();
            let vidPath = track.filepath || track.path || track.rel_path || "";
            const isConc = Boolean(track.is_concert || (vidPath && (vidPath.toLowerCase().includes('[concert]') || vidPath.toLowerCase().includes('/concerts/') || vidPath.toLowerCase().includes('\\concerts\\'))));
            if (typeof openLocalVideoModal === "function") {
                openLocalVideoModal({
                    title: track.title,
                    artist: track.artist,
                    path: vidPath,
                    rel_path: track.rel_path || vidPath,
                    is_concert: isConc,
                    thumbnail: track.cover_url || (vidPath ? `/api/videos/thumbnail?path=${encodeURIComponent(vidPath)}` : ""),
                    isPlaylistTrack: true
                });
            }
            if (this.isQueueDrawerOpen) this.renderQueueDrawer();
            this.syncSystemMediaState();
            return;
        }

        // Lecture Audio classique : fermer toute vidéo active
        if (window.closeVideoModal && (window.isVideoPlayingInBackground || document.getElementById("video-modal-backdrop")?.classList.contains("active") || (document.getElementById("video-modal-player") && !document.getElementById("video-modal-player").paused))) {
            window.closeVideoModal(true);
        }

        const startPlayback = () => {
            this.audio.src = track.stream_url;
            this.audio.load();
            AudioFader.fadeIn(this.audio, this.isMuted ? 0 : this.volume, 500);
            this.audio.play().catch(e => console.warn("Lecture queue:", e));
        };

        if (this.isPlaying && this.audio && !this.audio.paused && AudioFader.enabled) {
            AudioFader.fadeOut(this.audio, 280).then((completed) => {
                if (completed !== false) startPlayback();
            });
        } else {
            startPlayback();
        }

        const coverUrl = track.cover_url || "/static/placeholder-cover.svg";

        // Mini-bar persistante
        const miniThumb = document.getElementById("mini-player-thumb");
        const miniTitle = document.getElementById("mini-player-title");
        const miniArtist = document.getElementById("mini-player-artist");
        if (miniThumb) miniThumb.src = coverUrl;
        if (miniTitle) miniTitle.textContent = track.title;
        if (miniArtist) miniArtist.textContent = `${track.artist} • ${track.album}`;

        // Vue Grand Lecteur
        const pCover = document.getElementById("player-cover-img");
        const pFmt = document.getElementById("player-format-badge");
        const pTitle = document.getElementById("player-track-title");
        const pArtist = document.getElementById("player-track-artist");
        const pAlbum = document.getElementById("player-track-album");
        if (pCover) pCover.src = coverUrl;
        if (pFmt) pFmt.textContent = track.format || "M4A";
        if (pTitle) { pTitle.textContent = track.title; pTitle.title = track.title; }
        if (pArtist) pArtist.textContent = track.artist;
        if (pAlbum) pAlbum.textContent = `${track.album}${track.year ? " • " + track.year : ""}`;

        this.showPlayerBar();
        this.updateMiniDockVisibility();
        this.updatePlayStateUI();
        this.syncSystemMediaState();
    },

    enqueueVideo(videoItem, playNext = false) {
        if (!videoItem) return;
        const vidPath = videoItem.filepath || videoItem.path || videoItem.rel_path || "";
        const relPath = videoItem.rel_path || vidPath;
        const isConc = Boolean(
            videoItem.is_concert ||
            videoItem.video_type === "concert" ||
            (videoItem.duration_seconds && videoItem.duration_seconds >= 1200) ||
            (vidPath && (vidPath.toLowerCase().includes('[concert]') || vidPath.toLowerCase().includes('/concerts/') || vidPath.toLowerCase().includes('\\concerts\\'))) ||
            (videoItem.title && (videoItem.title.toLowerCase().includes(' en concert') || videoItem.title.toLowerCase().includes('full concert') || videoItem.title.toLowerCase().includes('live at') || videoItem.title.toLowerCase().includes('arena tour')))
        );
        const thumbUrl = videoItem.thumbnail || videoItem.thumbnail_url || `/api/videos/thumbnail?path=${encodeURIComponent(relPath || vidPath)}`;
        const durStr = videoItem.duration_str || (videoItem.duration_seconds ? formatTime(videoItem.duration_seconds) : (videoItem.duration || "--:--"));

        const queueItem = {
            title: videoItem.title || "Clip Vidéo",
            artist: videoItem.artist || "Artiste inconnu",
            album: isConc ? "Concert Vidéo" : "Clip Vidéo",
            year: videoItem.year || "",
            filepath: vidPath,
            rel_path: relPath,
            duration: durStr,
            duration_seconds: videoItem.duration_seconds || 0,
            format: "MP4",
            track_number: "",
            cover_url: thumbUrl,
            album_path: "",
            stream_url: `/api/videos/stream?path=${encodeURIComponent(relPath || vidPath)}`,
            type: "video",
            is_video: true,
            is_concert: isConc
        };

        const isAudioPlaying = this.isPlaying && this.audio && !this.audio.paused;
        const isVideoPlaying = (window.isVideoPlayingInBackground || document.getElementById("video-modal-backdrop")?.classList.contains("active") || (document.getElementById("video-modal-player") && !document.getElementById("video-modal-player").paused));

        if (!isAudioPlaying && !isVideoPlaying) {
            this.userQueue.push(queueItem);
            this.updateQueueBadges();
            this.playNext();
            showToast(`▶ Lecture de « ${queueItem.title} »`, "info");
            return;
        }

        if (playNext) {
            this.userQueue.unshift(queueItem);
            showToast(`⏭️ Clip « ${queueItem.title} » sera lu ensuite`, "info");
        } else {
            this.userQueue.push(queueItem);
            showToast(`➕ Clip « ${queueItem.title} » ajouté à la file d'attente`, "info");
        }

        this.updateQueueBadges();
        if (this.isQueueDrawerOpen) this.renderQueueDrawer();
    },

    enqueueTrack(track, album = null, playNext = false) {
        if (!track) return;
        const alb = album || this.currentAlbum || {};
        const fp = track.filepath || track.path || "";
        const isVideo = Boolean(
            track.type === "video" ||
            track.is_video ||
            (fp && /\.(mp4|mkv|webm)$/i.test(fp)) ||
            (track.rel_path && /\.(mp4|mkv|webm)$/i.test(track.rel_path))
        );
        if (isVideo) {
            return this.enqueueVideo({
                title: track.title,
                artist: track.artist || alb.artist,
                path: fp,
                filepath: fp,
                rel_path: track.rel_path || "",
                duration: track.duration,
                duration_seconds: track.duration_seconds,
                is_concert: Boolean(track.is_concert),
                thumbnail: track.cover_url || track.thumbnail_url
            }, playNext);
        }

        const queueItem = {
            title: track.title || "Piste",
            artist: track.artist || alb.artist || "Artiste inconnu",
            album: alb.title || "Album",
            year: alb.year || "",
            filepath: fp,
            duration: track.duration || "--:--",
            format: track.format || "M4A",
            track_number: track.track_number || "",
            cover_url: alb.cover_url || (alb.path ? `/api/audio/cover?path=${encodeURIComponent(alb.path)}` : "/static/placeholder-cover.svg"),
            album_path: alb.path || "",
            stream_url: track.stream_url || `/api/audio/stream-local?path=${encodeURIComponent(fp)}`
        };

        if (!this.isPlaying && !this.audio.src) {
            this.userQueue.push(queueItem);
            this.updateQueueBadges();
            this.playNext();
            showToast(`▶ Lecture de « ${queueItem.title} »`, "info");
            return;
        }

        if (playNext) {
            this.userQueue.unshift(queueItem);
            showToast(`⏭️ « ${queueItem.title} » sera lu ensuite`, "info");
        } else {
            this.userQueue.push(queueItem);
            showToast(`➕ « ${queueItem.title} » ajouté à la file d'attente`, "info");
        }

        this.updateQueueBadges();
        if (this.isQueueDrawerOpen) this.renderQueueDrawer();
    },

    async enqueueAlbum(albumPath, playNext = false) {
        if (!albumPath) return;
        try {
            const res = await fetch(`/api/album/info?path=${encodeURIComponent(albumPath)}`);
            if (!res.ok) throw new Error("Album introuvable");
            const info = await res.json();
            const folderName = albumPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "Album";
            const albMatch = this.libraryAlbums ? this.libraryAlbums.find(a => a.path === albumPath) : null;
            const coverUrl = (albMatch && albMatch.cover_url) || (info && info.cover_url) || `/api/audio/cover?path=${encodeURIComponent(albumPath)}${albMatch && albMatch.mtime ? `&v=${Math.floor(albMatch.mtime)}` : ''}`;
            const rawTracks = (info.tracks || []).slice().sort((a, b) => (parseInt(a.track_number, 10) || 0) - (parseInt(b.track_number, 10) || 0));

            if (rawTracks.length === 0) {
                showToast("Aucune piste trouvée dans cet album.", "warning");
                return;
            }

            const items = rawTracks.map(t => {
                const fp = t.filepath || t.path || "";
                const ext = fp.substring(fp.lastIndexOf(".")).toUpperCase().replace(".", "");
                return {
                    title: t.title || t.filename || "Piste",
                    artist: t.artist || info.album_artist || "Artiste inconnu",
                    album: info.album_name || folderName,
                    year: info.year || "",
                    filepath: fp,
                    duration: t.duration || "--:--",
                    format: ext || "M4A",
                    track_number: t.track_number || "",
                    cover_url: coverUrl,
                    album_path: albumPath,
                    stream_url: `/api/audio/stream-local?path=${encodeURIComponent(fp)}`
                };
            });

            if (!this.isPlaying && !this.audio.src) {
                this.loadAlbum(albumPath, { autoPlay: true, isCollection: (this.librarySource === "library"), switchView: false });
                showToast(`▶ Lecture de l'album « ${info.album_name || folderName} »`, "info");
                return;
            }

            if (playNext) {
                this.userQueue.unshift(...items);
                showToast(`⏭️ Album « ${info.album_name || folderName} » (${items.length} titres) sera lu ensuite`, "info");
            } else {
                this.userQueue.push(...items);
                showToast(`➕ Album « ${info.album_name || folderName} » (${items.length} titres) ajouté à la file`, "info");
            }

            this.updateQueueBadges();
            if (this.isQueueDrawerOpen) this.renderQueueDrawer();
        } catch (err) {
            console.error("Erreur enqueueAlbum:", err);
            showToast("Impossible d'ajouter l'album à la file : " + err.message, "danger");
        }
    },

    removeFromQueue(index) {
        if (index >= 0 && index < this.userQueue.length) {
            const removed = this.userQueue.splice(index, 1)[0];
            this.updateQueueBadges();
            this.renderQueueDrawer();
            if (removed) showToast(`Morceau retiré de la file`, "info");
        }
    },

    moveQueueItem(fromIndex, toIndex) {
        if (fromIndex < 0 || fromIndex >= this.userQueue.length || toIndex < 0 || toIndex >= this.userQueue.length) return;
        const item = this.userQueue.splice(fromIndex, 1)[0];
        this.userQueue.splice(toIndex, 0, item);
        this.renderQueueDrawer();
    },

    clearQueue() {
        if (!this.userQueue || this.userQueue.length === 0) return;
        this.userQueue = [];
        this.updateQueueBadges();
        this.renderQueueDrawer();
        showToast("🗑️ File d'attente vidée", "info");
    },

    updateQueueBadges() {
        const count = this.userQueue ? this.userQueue.length : 0;
        const countStr = count > 99 ? "99+" : String(count);

        const barBadge = document.getElementById("bar-queue-badge");
        const mainBadge = document.getElementById("main-queue-badge");
        const drawerTotal = document.getElementById("queue-drawer-total-count");
        const clearBtn = document.getElementById("queue-clear-btn");

        if (barBadge) {
            barBadge.textContent = countStr;
            barBadge.style.display = count > 0 ? "inline-flex" : "none";
        }
        if (mainBadge) {
            mainBadge.textContent = countStr;
            mainBadge.style.display = count > 0 ? "inline-flex" : "none";
        }
        if (drawerTotal) {
            drawerTotal.textContent = `${count} titre${count > 1 ? "s" : ""}`;
        }
        if (clearBtn) {
            clearBtn.disabled = (count === 0);
        }
    },

    openQueueDrawer() {
        this.isQueueDrawerOpen = true;
        const drawer = document.getElementById("player-queue-drawer");
        const backdrop = document.getElementById("player-queue-drawer-backdrop");
        if (backdrop) {
            backdrop.style.display = "block";
            requestAnimationFrame(() => backdrop.classList.add("active"));
        }
        if (drawer) {
            drawer.style.display = "flex";
            requestAnimationFrame(() => drawer.classList.add("open"));
        }
        this.renderQueueDrawer();
    },

    closeQueueDrawer() {
        this.isQueueDrawerOpen = false;
        const drawer = document.getElementById("player-queue-drawer");
        const backdrop = document.getElementById("player-queue-drawer-backdrop");
        if (backdrop) {
            backdrop.classList.remove("active");
            setTimeout(() => { if (!this.isQueueDrawerOpen) backdrop.style.display = "none"; }, 250);
        }
        if (drawer) {
            drawer.classList.remove("open");
            setTimeout(() => { if (!this.isQueueDrawerOpen) drawer.style.display = "none"; }, 300);
        }
    },

    toggleQueueDrawer() {
        if (this.isQueueDrawerOpen) {
            this.closeQueueDrawer();
        } else {
            this.openQueueDrawer();
        }
    },

    renderQueueDrawer() {
        const drawer = document.getElementById("player-queue-drawer");
        if (!drawer || !this.isQueueDrawerOpen) return;

        // 1. En-tête : Badge et bouton vider
        const totalCount = document.getElementById("queue-drawer-total-count");
        const clearBtn = document.getElementById("queue-clear-btn");
        const count = this.userQueue ? this.userQueue.length : 0;
        if (totalCount) totalCount.textContent = `${count} titre${count > 1 ? "s" : ""}`;
        if (clearBtn) clearBtn.disabled = (count === 0);

        // 2. Section "En cours de lecture"
        const curCard = document.getElementById("queue-current-card");
        if (curCard) {
            if (this.isRadioPlaying && this.currentRadio) {
                const st = this.currentRadio;
                const np = window.RadioManager?.state?.nowPlaying;
                const title = (np && (np.title || np.raw)) ? (np.title || np.raw) : (st.name || "Radio Web");
                const artist = (np && np.artist) ? np.artist : (st.sub_label ? `📍 ${st.sub_label} • ${st.name}` : (st.country || "Radio en direct"));
                let cover = st.favicon;
                if (!cover || cover.includes("radio_placeholder") || cover.includes("wikimedia.org") || cover.includes("wikipedia.org")) {
                    if (window.RadioManager && typeof window.RadioManager.getProceduralStationCover === "function") {
                        cover = window.RadioManager.getProceduralStationCover(st.name, st.tags, st.country);
                    } else {
                        cover = "/static/assets/radio_placeholder.svg";
                    }
                }
                const originLabel = "🔴 EN DIRECT • Flux Web" + (st.codec ? ` • ${st.codec.toUpperCase()} ${st.bitrate ? st.bitrate + 'k' : ''}` : "");

                curCard.classList.remove("is-empty");
                curCard.classList.add("clickable");
                curCard.setAttribute("role", "button");
                curCard.setAttribute("tabindex", "0");
                curCard.setAttribute("title", "Aller à la station en direct (Raccourci: N)");
                curCard.innerHTML = `
                    <img class="queue-item-thumb" src="${cover}" alt="Cover" onerror="window.handleCoverError ? window.handleCoverError(this) : (this.src='/static/assets/radio_placeholder.svg');">
                    <div class="queue-item-info">
                        <div class="queue-item-title">${escapeHtml(title)}</div>
                        <div class="queue-item-artist">${escapeHtml(artist)}</div>
                        <div class="queue-item-origin" style="color: var(--accent, #89b4fa); font-weight: 600;">
                            ${escapeHtml(originLabel)}
                        </div>
                    </div>
                    <span class="player-equalizer-bars" style="display: ${this.isPlaying ? "inline-flex" : "none"};">
                        <span class="player-equalizer-bar"></span>
                        <span class="player-equalizer-bar"></span>
                        <span class="player-equalizer-bar"></span>
                    </span>
                `;
                curCard.onclick = () => {
                    if (typeof this.closeQueueDrawer === "function") {
                        this.closeQueueDrawer();
                    }
                    if (typeof window.goToNowPlaying === "function") {
                        window.goToNowPlaying();
                    }
                };
                curCard.onkeydown = (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        if (typeof this.closeQueueDrawer === "function") {
                            this.closeQueueDrawer();
                        }
                        if (typeof window.goToNowPlaying === "function") {
                            window.goToNowPlaying();
                        }
                    }
                };
            } else {
                let currentTrack = null;
                let isQueueTrack = Boolean(this.currentTrackIsFromQueue && this.currentQueueTrack);
                if (isQueueTrack) {
                    currentTrack = this.currentQueueTrack;
                } else if (this.activePlaylist && this.activePlaylist[this.currentIndex]) {
                    currentTrack = this.activePlaylist[this.currentIndex];
                } else if (this.playlist && this.playlist[this.currentIndex]) {
                    currentTrack = this.playlist[this.currentIndex];
                }

                if (currentTrack) {
                    const cover = currentTrack.cover_url || (this.currentAlbum ? this.currentAlbum.cover_url : "/static/placeholder-cover.svg");
                    const albumTitle = currentTrack.album || (this.currentAlbum ? this.currentAlbum.title : "");
                    curCard.classList.remove("is-empty");
                    curCard.classList.add("clickable");
                    curCard.setAttribute("role", "button");
                    curCard.setAttribute("tabindex", "0");
                    curCard.setAttribute("title", "Aller au morceau en cours d'écoute (Raccourci: N)");
                    curCard.innerHTML = `
                        <img class="queue-item-thumb" src="${cover}" alt="Cover" onerror="window.handleCoverError(this);">
                        <div class="queue-item-info">
                            <div class="queue-item-title">${escapeHtml(currentTrack.title || "Titre inconnu")}</div>
                            <div class="queue-item-artist">${escapeHtml(currentTrack.artist || "Artiste inconnu")}</div>
                            <div class="queue-item-origin">
                                ${isQueueTrack ? "★ Titre intercalé en priorité" : `💿 Album : ${escapeHtml(albumTitle)}`}
                            </div>
                        </div>
                        <span class="player-equalizer-bars" style="display: ${this.isPlaying ? "inline-flex" : "none"};">
                            <span class="player-equalizer-bar"></span>
                            <span class="player-equalizer-bar"></span>
                            <span class="player-equalizer-bar"></span>
                        </span>
                    `;
                    curCard.onclick = () => {
                        if (typeof this.closeQueueDrawer === "function") {
                            this.closeQueueDrawer();
                        }
                        if (typeof window.goToNowPlaying === "function") {
                            window.goToNowPlaying();
                        }
                    };
                    curCard.onkeydown = (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            if (typeof this.closeQueueDrawer === "function") {
                                this.closeQueueDrawer();
                            }
                            if (typeof window.goToNowPlaying === "function") {
                                window.goToNowPlaying();
                            }
                        }
                    };
                } else {
                    curCard.classList.remove("clickable");
                    curCard.classList.add("is-empty");
                    curCard.removeAttribute("role");
                    curCard.removeAttribute("tabindex");
                    curCard.removeAttribute("title");
                    curCard.onclick = null;
                    curCard.onkeydown = null;
                    curCard.innerHTML = `
                        <div class="text-muted" style="font-size: 0.85rem; padding: 6px 0;">
                            Aucun morceau en cours de lecture.
                        </div>
                    `;
                }
            }
        }

        // 3. Section "File prioritaire"
        const prioList = document.getElementById("queue-priority-list");
        const prioEmpty = document.getElementById("queue-priority-empty");
        const prioCount = document.getElementById("queue-priority-count");
        if (prioCount) prioCount.textContent = String(count);

        if (prioList && prioEmpty) {
            if (count === 0) {
                prioList.innerHTML = "";
                prioEmpty.style.display = "block";
            } else {
                prioEmpty.style.display = "none";
                let listHtml = "";
                this.userQueue.forEach((item, idx) => {
                    const isFirst = (idx === 0);
                    const isLast = (idx === count - 1);
                    const cover = item.cover_url || "/static/placeholder-cover.svg";
                    listHtml += `
                        <div class="queue-track-item" data-qidx="${idx}">
                            <img class="queue-item-thumb" src="${cover}" alt="Cover" onerror="window.handleCoverError(this);">
                            <div class="queue-item-info">
                                <div class="queue-item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
                                <div class="queue-item-artist">${escapeHtml(item.artist)}</div>
                                <div class="queue-item-origin">↳ ${escapeHtml(item.album || "Album")}</div>
                            </div>
                            <div class="queue-item-actions">
                                <button type="button" class="btn-queue-order" data-action="up" data-qidx="${idx}" title="Monter" ${isFirst ? "disabled" : ""}>▲</button>
                                <button type="button" class="btn-queue-order" data-action="down" data-qidx="${idx}" title="Descendre" ${isLast ? "disabled" : ""}>▼</button>
                                <button type="button" class="btn-queue-remove" data-action="remove" data-qidx="${idx}" title="Retirer de la file">&times;</button>
                            </div>
                        </div>
                    `;
                });
                prioList.innerHTML = listHtml;

                // Listeners réorganisation et suppression
                prioList.querySelectorAll(".btn-queue-order").forEach(btn => {
                    btn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        const idx = parseInt(btn.getAttribute("data-qidx"), 10);
                        const act = btn.getAttribute("data-action");
                        if (act === "up" && idx > 0) this.moveQueueItem(idx, idx - 1);
                        else if (act === "down" && idx < this.userQueue.length - 1) this.moveQueueItem(idx, idx + 1);
                    });
                });
                prioList.querySelectorAll(".btn-queue-remove").forEach(btn => {
                    btn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        const idx = parseInt(btn.getAttribute("data-qidx"), 10);
                        this.removeFromQueue(idx);
                    });
                });
                prioList.querySelectorAll(".queue-track-item").forEach(itemEl => {
                    itemEl.addEventListener("click", (e) => {
                        if (e.target.closest(".queue-item-actions")) return;
                        const idx = parseInt(itemEl.getAttribute("data-qidx"), 10);
                        if (idx >= 0 && idx < this.userQueue.length) {
                            const track = this.userQueue.splice(idx, 1)[0];
                            this.updateQueueBadges();
                            this.playQueueTrack(track);
                            this.renderQueueDrawer();
                        }
                    });
                });
            }
        }

        // 4. Section "Suite de l'album d'origine"
        const upList = document.getElementById("queue-upcoming-list");
        const upCount = document.getElementById("queue-upcoming-count");

        let basePlaylist = [];
        let baseIndex = -1;
        let baseAlbum = null;

        if (this.isRadioPlaying) {
            basePlaylist = [];
            baseIndex = -1;
            baseAlbum = null;
        } else if (this.playbackContext && this.playbackContext.album) {
            basePlaylist = this.playbackContext.playlist || [];
            baseIndex = this.playbackContext.currentIndex;
            baseAlbum = this.playbackContext.album;
        } else if (this.playlist && this.playlist.length > 0) {
            basePlaylist = this.playlist;
            baseIndex = this.currentIndex;
            baseAlbum = this.currentAlbum;
        }

        const upcomingTracks = (!this.isRadioPlaying && baseIndex >= 0 && baseIndex < basePlaylist.length - 1)
            ? basePlaylist.slice(baseIndex + 1)
            : [];

        if (upCount) upCount.textContent = this.isRadioPlaying ? "—" : String(upcomingTracks.length);

        if (upList) {
            if (this.isRadioPlaying) {
                upList.innerHTML = `
                    <div class="text-muted" style="font-size: 0.82rem; padding: 12px 14px; font-style: italic; display: flex; align-items: flex-start; gap: 10px; line-height: 1.4; background: rgba(255, 255, 255, 0.02); border-radius: 8px;">
                        <span style="font-size: 1.15rem; flex-shrink: 0;">📻</span>
                        <div>
                            <strong>Flux direct ininterrompu.</strong><br>
                            Les radios web n'ont pas de liste d'attente automatique. Vous pouvez ajouter des morceaux prioritaires dans <em>"À suivre"</em> ci-dessus à tout moment.
                        </div>
                    </div>
                `;
            } else if (upcomingTracks.length === 0) {
                upList.innerHTML = `
                    <div class="text-muted" style="font-size: 0.82rem; padding: 8px 10px; font-style: italic;">
                        ${baseAlbum ? "Dernière piste de l'album en cours (aucun titre restant)." : "Aucun album d'origine en cours."}
                    </div>
                `;
            } else {
                let upHtml = "";
                const cover = (baseAlbum && baseAlbum.cover_url) ? baseAlbum.cover_url : "/static/placeholder-cover.svg";
                upcomingTracks.slice(0, 8).forEach((trk, relIdx) => {
                    const absIdx = baseIndex + 1 + relIdx;
                    upHtml += `
                        <div class="queue-track-item" style="cursor: pointer;" title="Cliquer pour reprendre directement à ce titre" data-resume-idx="${absIdx}">
                            <img class="queue-item-thumb" src="${cover}" alt="Cover" onerror="window.handleCoverError(this);">
                            <div class="queue-item-info">
                                <div class="queue-item-title">${escapeHtml(trk.title)}</div>
                                <div class="queue-item-artist">${escapeHtml(trk.artist)}</div>
                            </div>
                            <span class="text-muted" style="font-size: 0.75rem; font-family: var(--font-mono);">${escapeHtml(trk.duration || "--:--")}</span>
                        </div>
                    `;
                });
                if (upcomingTracks.length > 8) {
                    upHtml += `
                        <div class="text-muted" style="font-size: 0.78rem; text-align: center; padding: 4px;">
                            + ${upcomingTracks.length - 8} autre(s) titre(s)...
                        </div>
                    `;
                }
                upList.innerHTML = upHtml;

                upList.querySelectorAll("[data-resume-idx]").forEach(item => {
                    item.addEventListener("click", () => {
                        const targetIdx = parseInt(item.getAttribute("data-resume-idx"), 10);
                        if (!isNaN(targetIdx)) {
                            this.currentTrackIsFromQueue = false;
                            this.currentQueueTrack = null;
                            if (this.playbackContext) {
                                this.currentAlbum = this.playbackContext.album;
                                this.playlist = this.playbackContext.playlist;
                                this.playbackContext.currentIndex = targetIdx;
                            }
                            this.renderPlayerTab();
                            this.playTrackAtIndex(targetIdx);
                            this.renderQueueDrawer();
                        }
                    });
                });
            }
        }
    },

    updateShuffleUI() {
        const btn = document.getElementById("player-btn-shuffle");
        if (btn) {
            btn.classList.toggle("active", Boolean(this.isShuffle));
            btn.title = `Lecture aléatoire (${this.isShuffle ? "Activée" : "Désactivée"})`;
        }
        const miniShuffleBtn = document.getElementById("mini-player-shuffle-btn");
        if (miniShuffleBtn) {
            miniShuffleBtn.classList.toggle("active", Boolean(this.isShuffle));
            miniShuffleBtn.title = `Lecture aléatoire (${this.isShuffle ? "Activée" : "Désactivée"})`;
        }
        const ambShuffleBtn = document.getElementById("ambient-shuffle-btn");
        if (ambShuffleBtn) {
            ambShuffleBtn.classList.toggle("active", Boolean(this.isShuffle));
            ambShuffleBtn.title = `Lecture aléatoire (${this.isShuffle ? "Activée" : "Désactivée"})`;
        }
    },

    async toggleShuffle() {
        this.isShuffle = !this.isShuffle;
        this.updateShuffleUI();
        this.savePlaybackSession(Boolean(this._hasPlayedInCurrentRun));

        if (this.isQueueDrawerOpen && typeof this.renderQueueDrawer === "function") {
            this.renderQueueDrawer();
        }

        showToast(this.isShuffle ? "🔀 Lecture aléatoire activée" : "Lecture séquentielle activée", "info");
    },

    async cycleRepeat() {
        if (this.repeatMode === "all") {
            this.repeatMode = "one";
        } else if (this.repeatMode === "one") {
            this.repeatMode = "none";
        } else {
            this.repeatMode = "all";
        }
        try {
            localStorage.setItem("ytm_player_repeat_mode", this.repeatMode);
        } catch (e) {}
        this.updateRepeatUI();
        this.savePlaybackSession(Boolean(this._hasPlayedInCurrentRun));

        const isFromAll = (this.currentView === "all" || (this.playbackOrigin && this.playbackOrigin.view === "all") || (this.currentAlbum && (this.currentAlbum.path === "system:all-collection" || this.currentAlbum.path === "system:search-results")));

        const msg = this.repeatMode === "all"
            ? (isFromAll ? "🔁 Répéter toute la collection" : "🔁 Répéter tout l'album")
            : (this.repeatMode === "one" ? "🔂 Répéter la piste actuelle" : "Répétition désactivée");
        showToast(msg, "info");
    },

    updateRepeatUI() {
        const isOne = this.repeatMode === "one";
        const isActive = this.repeatMode !== "none";
        const isFromAll = (this.currentView === "all" || (this.playbackOrigin && this.playbackOrigin.view === "all") || (this.currentAlbum && (this.currentAlbum.path === "system:all-collection" || this.currentAlbum.path === "system:search-results")));
        const label = this.repeatMode === "all" ? (isFromAll ? "Toute la collection" : "Tout l'album") : (this.repeatMode === "one" ? "Répéter la piste" : "Désactivée");
        const titleText = `Mode répétition (${label})`;

        // Repeat All (two looping arrows)
        const pathAll = "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z";
        // Repeat One (two looping arrows with numeral '1' centered in the loop)
        const pathOne = "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z";
        const currentPath = isOne ? pathOne : pathAll;

        const updateBtn = (btnId, size) => {
            const btn = document.getElementById(btnId);
            if (!btn) return;
            btn.classList.toggle("active", isActive);
            btn.title = titleText;
            btn.setAttribute("aria-label", titleText);
            btn.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"><path d="${currentPath}"/></svg>`;
        };

        updateBtn("mini-player-repeat-btn", 16);
        updateBtn("ambient-repeat-btn", 18);
        updateBtn("player-btn-repeat", 18);
    },

    setVolume(val) {
        this.volume = Math.max(0, Math.min(1, val));
        this.isMuted = this.volume === 0;
        this.audio.muted = this.isMuted;
        this.audio.dataset.normalVolume = this.volume.toString();
        const activeFade = AudioFader.activeFades.get(this.audio);
        if (activeFade) {
            activeFade.targetVolume = this.volume;
        } else {
            this.audio.volume = this.volume;
        }
        try {
            localStorage.setItem("ytm_player_volume", this.volume.toString());
        } catch (e) {}
        this.updateVolumeUI();
    },

    toggleMute() {
        this.isMuted = !this.isMuted;
        this.audio.muted = this.isMuted;
        this.updateVolumeUI();
    },

    updateVolumeUI() {
        const miniVolSlider = document.getElementById("mini-player-volume-slider");
        const playerVolSlider = document.getElementById("player-volume-slider");
        const playerPercent = document.getElementById("player-volume-percent");
        const miniVolOn = document.getElementById("mini-icon-vol-on");
        const miniVolOff = document.getElementById("mini-icon-vol-off");
        const playerVolOn = document.getElementById("player-icon-vol-on");
        const playerVolOff = document.getElementById("player-icon-vol-off");

        const ambientVolSlider = document.getElementById("ambient-volume-slider");
        const ambientVolOn = document.getElementById("ambient-icon-vol-on");
        const ambientVolOff = document.getElementById("ambient-icon-vol-off");

        const displayVol = this.isMuted ? 0 : this.volume;
        if (miniVolSlider) miniVolSlider.value = displayVol;
        if (playerVolSlider) playerVolSlider.value = displayVol;
        if (playerPercent) playerPercent.textContent = `${Math.round(displayVol * 100)}%`;

        if (ambientVolSlider) ambientVolSlider.value = displayVol;

        const isSilent = displayVol === 0 || this.isMuted;
        if (miniVolOn) miniVolOn.style.display = isSilent ? "none" : "block";
        if (miniVolOff) miniVolOff.style.display = isSilent ? "block" : "none";
        if (playerVolOn) playerVolOn.style.display = isSilent ? "none" : "block";
        if (playerVolOff) playerVolOff.style.display = isSilent ? "block" : "none";

        if (ambientVolOn) ambientVolOn.style.display = isSilent ? "none" : "block";
        if (ambientVolOff) ambientVolOff.style.display = isSilent ? "block" : "none";
    },

    // =========================================================
    // ÉGALISEUR AUDIO HAUTE FIDÉLITÉ (10 BANDES & WEB AUDIO API)
    // =========================================================

    setupAudioContext() {
        if (this.eqAudioCtx) {
            if (this.eqAudioCtx.state === "suspended") {
                this.eqAudioCtx.resume().catch(() => {});
            }
            return;
        }

        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return;

            this.eqAudioCtx = new AudioContextClass();
            if (this.audioOutputDeviceId && this.audioOutputDeviceId !== "default" && typeof this.eqAudioCtx.setSinkId === "function") {
                this.eqAudioCtx.setSinkId(this.audioOutputDeviceId).catch(() => {});
            }

            if (!this.audio) {
                this.audio = document.getElementById("global-audio-engine");
            }
            if (!this.audio) return;
            this.audio.crossOrigin = "anonymous";

            if (!this.eqSourceNode) {
                this.eqSourceNode = this.eqAudioCtx.createMediaElementSource(this.audio);
            }

            const frequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
            this.eqFilters = [];

            let lastNode = this.eqSourceNode;

            for (let i = 0; i < frequencies.length; i++) {
                const filter = this.eqAudioCtx.createBiquadFilter();
                filter.frequency.value = frequencies[i];
                if (i === 0) {
                    filter.type = "lowshelf";
                } else if (i === frequencies.length - 1) {
                    filter.type = "highshelf";
                } else {
                    filter.type = "peaking";
                    filter.Q.value = 1.4;
                }
                filter.gain.value = 0;
                lastNode.connect(filter);
                lastNode = filter;
                this.eqFilters.push(filter);
            }

            // Nœuds de Correction Physiologique (Loudness Progressif ISO 226)
            this.loudnessPreGainNode = this.eqAudioCtx.createGain();
            this.loudnessBassFilter = this.eqAudioCtx.createBiquadFilter();
            this.loudnessBassFilter.type = "lowshelf";
            this.loudnessBassFilter.frequency.value = 100;
            this.loudnessBassFilter.gain.value = 0;

            this.loudnessTrebleFilter = this.eqAudioCtx.createBiquadFilter();
            this.loudnessTrebleFilter.type = "highshelf";
            this.loudnessTrebleFilter.frequency.value = 10000;
            this.loudnessTrebleFilter.gain.value = 0;

            // Limiteur de sécurité transparent anti-clipping numérique
            this.loudnessLimiterNode = this.eqAudioCtx.createDynamicsCompressor();
            this.loudnessLimiterNode.threshold.value = -0.5;
            this.loudnessLimiterNode.knee.value = 0;
            this.loudnessLimiterNode.ratio.value = 20;
            this.loudnessLimiterNode.attack.value = 0.003;
            this.loudnessLimiterNode.release.value = 0.1;

            // Insertion dans la chaîne : lastNode (après filtre 16kHz) -> PreGain -> Bass -> Treble -> Limiter
            lastNode.connect(this.loudnessPreGainNode);
            this.loudnessPreGainNode.connect(this.loudnessBassFilter);
            this.loudnessBassFilter.connect(this.loudnessTrebleFilter);
            this.loudnessTrebleFilter.connect(this.loudnessLimiterNode);
            lastNode = this.loudnessLimiterNode;

            // Web Audio Analyser pour Synthwave Waveform réactive
            try {
                this.analyser = this.eqAudioCtx.createAnalyser();
                this.analyser.fftSize = 256;
                this.analyser.smoothingTimeConstant = 0.8;
                lastNode.connect(this.analyser);
                this.analyser.connect(this.eqAudioCtx.destination);
                this.analyserDataArray = new Uint8Array(this.analyser.frequencyBinCount);
                this.analyserFreqArray = new Uint8Array(this.analyser.frequencyBinCount);
            } catch (aErr) {
                console.warn("Analyser connection warning:", aErr);
                lastNode.connect(this.eqAudioCtx.destination);
            }

            this.eqInitialized = true;

            this.applyEqualizerGains(false);
            this.applyLoudnessGains(false);

            if (this.eqAudioCtx.state === "suspended") {
                this.eqAudioCtx.resume().catch(() => {});
            }
        } catch (err) {
            console.warn("Equalizer AudioContext setup warning:", err);
        }
    },

    getAudioWaveform() {
        if (!this.analyser || !this.isPlaying) return null;
        if (!this.analyserDataArray || this.analyserDataArray.length !== this.analyser.frequencyBinCount) {
            this.analyserDataArray = new Uint8Array(this.analyser.frequencyBinCount);
        }
        this.analyser.getByteTimeDomainData(this.analyserDataArray);
        return this.analyserDataArray;
    },

    getAudioFrequencies() {
        if (!this.analyser || !this.isPlaying) return null;
        if (!this.analyserFreqArray || this.analyserFreqArray.length !== this.analyser.frequencyBinCount) {
            this.analyserFreqArray = new Uint8Array(this.analyser.frequencyBinCount);
        }
        this.analyser.getByteFrequencyData(this.analyserFreqArray);
        return this.analyserFreqArray;
    },

    applyEqualizerGains(ramp = true) {
        if (!this.eqFilters || this.eqFilters.length === 0) return;

        let gains = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        if (this.eqEnabled) {
            if (this.eqCurrentPreset === "custom") {
                gains = this.eqCustomGains;
            } else if (EQ_PRESETS[this.eqCurrentPreset]) {
                gains = EQ_PRESETS[this.eqCurrentPreset].gains;
            }
        }

        const now = (this.eqAudioCtx && this.eqAudioCtx.currentTime) || 0;
        for (let i = 0; i < this.eqFilters.length; i++) {
            const filter = this.eqFilters[i];
            const targetGain = gains[i] !== undefined ? gains[i] : 0;
            if (ramp && this.eqAudioCtx && this.eqAudioCtx.state === "running") {
                filter.gain.cancelScheduledValues(now);
                filter.gain.linearRampToValueAtTime(targetGain, now + 0.02);
            } else {
                filter.gain.value = targetGain;
            }
        }
    },

    applyLoudnessGains(ramp = true) {
        if (!this.loudnessPreGainNode || !this.loudnessBassFilter || !this.loudnessTrebleFilter) return;

        const alpha = Math.max(0, Math.min(100, this.loudnessAmount)) / 100.0;
        const bassGain = alpha * 6.0;   // 0 à +6 dB à 100 Hz (Low-Shelf)
        const trebleGain = alpha * 4.0; // 0 à +4 dB à 10 kHz (High-Shelf)

        // Calibrage acoustique d'énergie perçue (Loudness Matching) :
        // L'atténuation théorique de -6 dB divisait l'énergie des médiums par deux (perte de -4.3 dB RMS),
        // provoquant une sensation désagréable d'affaissement du volume global lors de la montée du curseur.
        // Avec un Pre-Gain calibré à -1.5 dB max (mesure d'énergie constante delta RMS < 0.2 dB),
        // le niveau moyen perçu reste parfaitement stable et le limiteur dynamique (-0.5 dBFS)
        // garantit l'absence totale de saturation numérique (0 dBFS).
        const preGainDb = -alpha * 1.5; // 0 à -1.5 dB
        const preGainLinear = Math.pow(10, preGainDb / 20.0);

        const now = (this.eqAudioCtx && this.eqAudioCtx.currentTime) || 0;
        if (ramp && this.eqAudioCtx && this.eqAudioCtx.state === "running") {
            this.loudnessPreGainNode.gain.cancelScheduledValues(now);
            this.loudnessPreGainNode.gain.linearRampToValueAtTime(preGainLinear, now + 0.03);

            this.loudnessBassFilter.gain.cancelScheduledValues(now);
            this.loudnessBassFilter.gain.linearRampToValueAtTime(bassGain, now + 0.03);

            this.loudnessTrebleFilter.gain.cancelScheduledValues(now);
            this.loudnessTrebleFilter.gain.linearRampToValueAtTime(trebleGain, now + 0.03);
        } else {
            this.loudnessPreGainNode.gain.value = preGainLinear;
            this.loudnessBassFilter.gain.value = bassGain;
            this.loudnessTrebleFilter.gain.value = trebleGain;
        }
    },

    setLoudness(amount, updateSlider = false) {
        this.setupAudioContext();
        const val = Math.max(0, Math.min(100, parseInt(amount, 10) || 0));
        this.loudnessAmount = val;
        try {
            localStorage.setItem("ytm_loudness", String(val));
        } catch (e) {}

        this.applyLoudnessGains(true);
        this.updateLoudnessUI(updateSlider);
    },

    updateLoudnessUI(updateSlider = false) {
        const slider = document.getElementById("eq-loudness-slider");
        const valDisplay = document.getElementById("eq-loudness-val-display");
        const badge = document.getElementById("eq-loudness-badge");
        const card = document.querySelector(".eq-loudness-card");

        const alpha = this.loudnessAmount / 100.0;
        const isActive = this.loudnessAmount > 0;

        if (slider && updateSlider) {
            slider.value = this.loudnessAmount;
        }
        if (valDisplay) {
            valDisplay.textContent = `${this.loudnessAmount} %`;
        }
        if (badge) {
            if (isActive) {
                const bGain = (alpha * 6.0).toFixed(1);
                const tGain = (alpha * 4.0).toFixed(1);
                badge.textContent = `Actif (+${bGain} dB / +${tGain} dB)`;
                badge.className = "badge badge-sm badge-success";
            } else {
                badge.textContent = "Désactivé (0 dB)";
                badge.className = "badge badge-sm";
            }
        }
        if (card) {
            card.classList.toggle("is-active", isActive);
        }
    },

    setEqualizerPreset(presetName) {
        if (!EQ_PRESETS[presetName]) return;
        this.setupAudioContext();

        this.eqCurrentPreset = presetName;
        if (!this.eqEnabled) {
            this.eqEnabled = true;
            try { localStorage.setItem("ytm_eq_enabled", "true"); } catch (e) {}
        }
        try { localStorage.setItem("ytm_eq_preset", presetName); } catch (e) {}

        this.applyEqualizerGains(true);
        this.updateEqualizerUI();
    },

    onFaderInput(bandIndex, valueDb) {
        this.setupAudioContext();

        if (this.eqCurrentPreset !== "custom") {
            const curGains = EQ_PRESETS[this.eqCurrentPreset] ? [...EQ_PRESETS[this.eqCurrentPreset].gains] : [...this.eqCustomGains];
            this.eqCustomGains = curGains;
            this.eqCurrentPreset = "custom";
            try { localStorage.setItem("ytm_eq_preset", "custom"); } catch (e) {}
        }

        this.eqCustomGains[bandIndex] = parseFloat(valueDb);
        try { localStorage.setItem("ytm_eq_custom_gains", JSON.stringify(this.eqCustomGains)); } catch (e) {}

        if (!this.eqEnabled) {
            this.eqEnabled = true;
            try { localStorage.setItem("ytm_eq_enabled", "true"); } catch (e) {}
        }

        this.applyEqualizerGains(true);
        this.updateEqualizerUI();
    },

    toggleEqualizerPower() {
        this.setupAudioContext();
        this.eqEnabled = !this.eqEnabled;
        try { localStorage.setItem("ytm_eq_enabled", this.eqEnabled ? "true" : "false"); } catch (e) {}

        this.applyEqualizerGains(true);
        this.updateEqualizerUI();
    },

    resetEqualizerCustom() {
        this.setupAudioContext();
        this.eqCustomGains = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        try { localStorage.setItem("ytm_eq_custom_gains", JSON.stringify(this.eqCustomGains)); } catch (e) {}
        this.setEqualizerPreset("custom");
    },

    openEqualizerModal() {
        this.setupAudioContext();
        const modal = document.getElementById("player-equalizer-modal");
        if (modal) {
            modal.style.display = "flex";
            requestAnimationFrame(() => modal.classList.add("active"));
            this.isEqualizerModalOpen = true;
            this.updateEqualizerUI();
        }
    },

    closeEqualizerModal() {
        const modal = document.getElementById("player-equalizer-modal");
        if (modal) {
            modal.classList.remove("active");
            setTimeout(() => {
                if (!this.isEqualizerModalOpen) {
                    modal.style.display = "none";
                }
            }, 250);
            this.isEqualizerModalOpen = false;
        }
    },

    toggleEqualizerModal() {
        if (this.isEqualizerModalOpen) {
            this.closeEqualizerModal();
        } else {
            this.openEqualizerModal();
        }
    },

    updateEqualizerUI() {
        // 1. Bouton Power / Bypass
        const pwr = document.getElementById("eq-power-toggle");
        if (pwr) pwr.checked = this.eqEnabled;
        const lbl = document.getElementById("eq-toggle-label");
        if (lbl) lbl.textContent = this.eqEnabled ? "Actif" : "Bypass";

        // 2. Grisement du dialogue si désactivé
        const dialog = document.querySelector(".eq-modal-dialog");
        if (dialog) dialog.classList.toggle("eq-disabled", !this.eqEnabled);

        // 3. Badge du preset actif
        const bdg = document.getElementById("eq-active-preset-badge");
        if (bdg) {
            bdg.textContent = (EQ_PRESETS[this.eqCurrentPreset] && EQ_PRESETS[this.eqCurrentPreset].badge) || this.eqCurrentPreset;
        }

        // 4. Boutons pilules des presets
        document.querySelectorAll(".eq-preset-btn").forEach(btn => {
            btn.classList.toggle("active", btn.getAttribute("data-preset") === this.eqCurrentPreset);
        });

        // 5. Voyants lumineux verts (Mini-player & Focus & Ambiance)
        const miniDot = document.getElementById("mini-player-eq-dot");
        if (miniDot) miniDot.style.display = this.eqEnabled ? "inline-block" : "none";
        const focusDot = document.getElementById("player-now-playing-eq-dot");
        if (focusDot) focusDot.style.display = this.eqEnabled ? "inline-block" : "none";
        const ambientDot = document.getElementById("ambient-eq-dot");
        if (ambientDot) ambientDot.style.display = this.eqEnabled ? "inline-block" : "none";
        const miniBtn = document.getElementById("mini-player-eq-btn");
        if (miniBtn) miniBtn.classList.toggle("eq-is-enabled", this.eqEnabled);
        const ambientEqBtn = document.getElementById("ambient-eq-btn");
        if (ambientEqBtn) ambientEqBtn.classList.toggle("eq-is-enabled", this.eqEnabled);

        // 6. Valeurs des curseurs
        const currentGains = this.eqCurrentPreset === "custom"
            ? this.eqCustomGains
            : ((EQ_PRESETS[this.eqCurrentPreset] && EQ_PRESETS[this.eqCurrentPreset].gains) || [0,0,0,0,0,0,0,0,0,0]);

        for (let i = 0; i < 10; i++) {
            const slider = document.getElementById(`eq-slider-${i}`);
            const valSpan = document.getElementById(`eq-val-${i}`);
            const g = currentGains[i] !== undefined ? currentGains[i] : 0;
            if (slider && !slider.matches(":active")) {
                slider.value = g;
            }
            if (valSpan) {
                valSpan.textContent = (g > 0 ? "+" : "") + g + " dB";
                valSpan.classList.toggle("positive", g > 0);
                valSpan.classList.toggle("negative", g < 0);
            }
        }

        // 7. Visualiseur de courbe
        this.renderEqualizerCurve(currentGains);

        // 8. Synchronisation du Loudness physiologique
        this.updateLoudnessUI(true);
    },

    renderEqualizerCurve(gains) {
        const line = document.getElementById("eq-curve-line");
        const area = document.getElementById("eq-curve-area");
        if (!line || !area) return;

        const displayGains = this.eqEnabled ? gains : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        const points = [];
        const n = displayGains.length;
        for (let i = 0; i < n; i++) {
            const x = 30 + (i / (n - 1)) * 540;
            const g = Math.max(-12, Math.min(12, displayGains[i] || 0));
            const y = 40 - (g / 12) * 28;
            points.push({ x, y });
        }

        let d = `M 0 40 L ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i === 0 ? 0 : i - 1];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[i + 2 < points.length ? i + 2 : i + 1];

            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;

            d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
        }
        d += ` L 600 40`;

        line.setAttribute("d", d);
        const areaD = `${d} L 600 78 L 0 78 Z`;
        area.setAttribute("d", areaD);
    },

    // =========================================================
    // SÉLECTION DE LA SORTIE SON WINDOWS (MULTI-PÉRIPHÉRIQUES)
    // =========================================================

    initAudioOutputDevices() {
        try {
            const saved = localStorage.getItem("ytm_audio_output_device");
            if (saved) {
                this.audioOutputDeviceId = saved;
            }
        } catch (_) {}

        // Appliquer dès l'initialisation au moteur audio principal
        if (this.audio && this.audioOutputDeviceId && this.audioOutputDeviceId !== "default" && typeof this.audio.setSinkId === "function") {
            this.audio.setSinkId(this.audioOutputDeviceId).catch(() => {});
        }

        // Écouteur sur le bouton de la barre inférieure (Mini-Player)
        const miniBtn = document.getElementById("mini-player-audio-output-btn");
        if (miniBtn) {
            miniBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                this.toggleAudioOutputFlyout(miniBtn);
            });
        }

        // Écouteur sur le bouton de fermeture de la popover
        const closeBtn = document.getElementById("audio-output-flyout-close-btn");
        if (closeBtn) {
            closeBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                this.closeAudioOutputFlyout();
            });
        }

        // Fermeture automatique au clic à l'extérieur
        document.addEventListener("click", (e) => {
            if (!this.isAudioOutputFlyoutOpen) return;
            const flyout = document.getElementById("audio-output-flyout");
            const miniOutBtn = document.getElementById("mini-player-audio-output-btn");
            const ambientOutBtn = document.getElementById("ambient-audio-output-btn");
            if (flyout && !flyout.contains(e.target) && (!miniOutBtn || !miniOutBtn.contains(e.target)) && (!ambientOutBtn || !ambientOutBtn.contains(e.target))) {
                this.closeAudioOutputFlyout();
            }
        });

        // Fermeture automatique avec la touche Échap
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && this.isAudioOutputFlyoutOpen) {
                this.closeAudioOutputFlyout();
            }
        });

        // Détection à chaud du branchement / débranchement de périphériques Windows
        if (navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === "function") {
            navigator.mediaDevices.addEventListener("devicechange", async () => {
                console.log("[AudioPlayer] Détection d'un changement matériel de périphérique audio Windows");
                const updatedList = await this.refreshAudioOutputDevices();
                
                // Si le périphérique actif a été débranché et n'est plus dans la liste
                if (this.audioOutputDeviceId !== "default") {
                    const stillExists = updatedList.some(d => d.deviceId === this.audioOutputDeviceId);
                    if (!stillExists) {
                        console.warn("[AudioPlayer] Périphérique actif déconnecté, repli sur la sortie par défaut");
                        await this.setAudioOutputDevice("default", true);
                        if (typeof showToast === "function") {
                            showToast("Périphérique audio déconnecté, bascule automatique sur la sortie par défaut", "info");
                        }
                    }
                }

                // Si le flyout est actuellement ouvert, rafraîchir la liste affichée
                if (this.isAudioOutputFlyoutOpen) {
                    this.renderAudioOutputDeviceList();
                }
            });
        }

        // Rafraîchir la liste et initialiser les icônes
        this.refreshAudioOutputDevices();
    },

    async refreshAudioOutputDevices() {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== "function") {
            return [];
        }
        try {
            const allDevices = await navigator.mediaDevices.enumerateDevices();
            // Filtrer uniquement les sorties audio, exclure le doublon de canal de communication
            const outputs = allDevices.filter(d => d.kind === "audiooutput" && d.deviceId !== "communications");
            this.availableAudioOutputDevices = outputs;
            this.updateAudioOutputButtonsUI();
            return outputs;
        } catch (err) {
            console.warn("[AudioPlayer] Erreur enumerateDevices:", err);
            return [];
        }
    },

    getDeviceCategory(device) {
        const lbl = (device && device.label ? device.label : "").toLowerCase();
        if (/casque|headphone|headset|earphone|airpod|bud|dongle|void|wireless.*gaming/i.test(lbl)) {
            return "headphones";
        }
        if (/nvidia|amd|intel|hdmi|displayport|screen|moniteur|tv|24g4/i.test(lbl)) {
            return "screen";
        }
        return "speaker";
    },

    getDeviceSvgIcon(category, size = 18) {
        if (category === "headphones") {
            return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"><path d="M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1a7 7 0 0 1 14 0v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9z"/></svg>`;
        }
        if (category === "screen") {
            return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"><path d="M21 2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H3V4h18v12z"/></svg>`;
        }
        return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
    },

    getCleanDeviceLabel(device) {
        let label = (device && device.label ? device.label : "").trim();
        if (!label) {
            if (device && device.deviceId === "default") return "Sortie système par défaut";
            return `Périphérique audio (${(device.deviceId || "").slice(0, 6)}...)`;
        }
        // Éliminer préfixe "Default - "
        label = label.replace(/^Default\s*-\s*/i, "");
        // Éliminer suffixe d'ID matériel genre (1b1c:0a14)
        label = label.replace(/\s*\([0-9a-fA-F]{4}:[0-9a-fA-F]{4}\)$/, "");
        return label;
    },

    renderAudioOutputDeviceList() {
        const container = document.getElementById("audio-output-device-list");
        if (!container) return;

        const devices = this.availableAudioOutputDevices || [];
        const currentActiveId = this.audioOutputDeviceId || "default";

        // Détecter le label du périphérique actuellement configuré comme défaut de Windows
        const defaultDev = devices.find(d => d.deviceId === "default");
        const defaultSubName = defaultDev ? this.getCleanDeviceLabel(defaultDev) : "Configuration audio Windows";
        const defaultCategory = defaultDev ? this.getDeviceCategory(defaultDev) : "speaker";

        let html = "";

        // 1. Option "Sortie par défaut (Windows)"
        const isDefaultActive = (currentActiveId === "default" || currentActiveId === "");
        html += `
            <div class="audio-output-item ${isDefaultActive ? 'active' : ''}" data-device-id="default">
                <div class="audio-output-item-icon">
                    ${this.getDeviceSvgIcon(defaultCategory, 18)}
                </div>
                <div class="audio-output-item-text">
                    <div class="audio-output-item-label">Par défaut (Windows)</div>
                    <div class="audio-output-item-sub">${escapeHtml(defaultSubName)}</div>
                </div>
                ${isDefaultActive ? `
                    <div class="audio-output-item-check">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                        </svg>
                    </div>
                ` : ''}
            </div>
        `;

        // 2. Périphériques physiques réels (en excluant 'default' et 'communications')
        const physicalDevices = devices.filter(d => d.deviceId !== "default" && d.deviceId !== "communications");

        physicalDevices.forEach(dev => {
            const isActive = (currentActiveId === dev.deviceId);
            const category = this.getDeviceCategory(dev);
            const cleanLabel = this.getCleanDeviceLabel(dev);

            let subDesc = "Sortie audio";
            if (category === "headphones") subDesc = "Casque / Écouteurs";
            else if (category === "screen") subDesc = "Écran / Sortie HDMI";
            else if (category === "speaker") subDesc = "Enceintes / Haut-parleurs";

            html += `
                <div class="audio-output-item ${isActive ? 'active' : ''}" data-device-id="${escapeHtml(dev.deviceId)}">
                    <div class="audio-output-item-icon">
                        ${this.getDeviceSvgIcon(category, 18)}
                    </div>
                    <div class="audio-output-item-text">
                        <div class="audio-output-item-label" title="${escapeHtml(cleanLabel)}">${escapeHtml(cleanLabel)}</div>
                        <div class="audio-output-item-sub">${escapeHtml(subDesc)}</div>
                    </div>
                    ${isActive ? `
                        <div class="audio-output-item-check">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                            </svg>
                        </div>
                    ` : ''}
                </div>
            `;
        });

        if (physicalDevices.length === 0 && !defaultDev) {
            html += `
                <div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 0.82rem;">
                    Aucun périphérique de sortie audio détecté.
                </div>
            `;
        }

        container.innerHTML = html;

        // Délégation d'événement sur les éléments de la liste
        container.querySelectorAll(".audio-output-item").forEach(item => {
            item.addEventListener("click", (e) => {
                e.stopPropagation();
                const targetId = item.getAttribute("data-device-id");
                if (targetId) {
                    this.setAudioOutputDevice(targetId, true);
                    this.closeAudioOutputFlyout();
                }
            });
        });
    },

    toggleAudioOutputFlyout(triggerBtn) {
        if (this.isAudioOutputFlyoutOpen && this.currentAudioOutputTriggerBtn === triggerBtn) {
            this.closeAudioOutputFlyout();
        } else {
            this.openAudioOutputFlyout(triggerBtn);
        }
    },

    async openAudioOutputFlyout(triggerBtn) {
        const flyout = document.getElementById("audio-output-flyout");
        if (!flyout) return;

        this.currentAudioOutputTriggerBtn = triggerBtn;
        this.isAudioOutputFlyoutOpen = true;

        if (triggerBtn) triggerBtn.classList.add("active");

        // Récupérer la liste à jour
        await this.refreshAudioOutputDevices();
        this.renderAudioOutputDeviceList();

        flyout.style.display = "flex";

        // Positionnement dynamique au-dessus du bouton déclencheur
        if (triggerBtn) {
            const rect = triggerBtn.getBoundingClientRect();
            const flyoutWidth = 360;
            const bottom = window.innerHeight - rect.top + 8;
            let left = rect.left + (rect.width / 2) - (flyoutWidth / 2);

            // Ne jamais déborder de l'écran
            if (left < 10) left = 10;
            if (left + flyoutWidth > window.innerWidth - 10) {
                left = window.innerWidth - flyoutWidth - 10;
            }

            flyout.style.bottom = `${Math.round(bottom)}px`;
            flyout.style.left = `${Math.round(left)}px`;
        }

        requestAnimationFrame(() => {
            flyout.classList.add("active");
        });
    },

    closeAudioOutputFlyout() {
        const flyout = document.getElementById("audio-output-flyout");
        if (flyout) {
            flyout.classList.remove("active");
            setTimeout(() => {
                if (!this.isAudioOutputFlyoutOpen) {
                    flyout.style.display = "none";
                }
            }, 180);
        }

        if (this.currentAudioOutputTriggerBtn) {
            this.currentAudioOutputTriggerBtn.classList.remove("active");
            this.currentAudioOutputTriggerBtn = null;
        }
        const miniBtn = document.getElementById("mini-player-audio-output-btn");
        const ambientBtn = document.getElementById("ambient-audio-output-btn");
        if (miniBtn) miniBtn.classList.remove("active");
        if (ambientBtn) ambientBtn.classList.remove("active");

        this.isAudioOutputFlyoutOpen = false;
    },

    async setAudioOutputDevice(deviceId, save = true) {
        if (!deviceId) deviceId = "default";
        this.audioOutputDeviceId = deviceId;

        if (save) {
            try {
                localStorage.setItem("ytm_audio_output_device", deviceId);
            } catch (_) {}
        }

        const targetSinkId = (deviceId === "default" ? "" : deviceId);

        // 1. Appliquer à l'élément audio principal
        if (this.audio && typeof this.audio.setSinkId === "function") {
            try {
                await this.audio.setSinkId(targetSinkId);
            } catch (err) {
                console.warn("[AudioPlayer] audio.setSinkId error:", err);
            }
        }

        // 2. Appliquer au lecteur vidéo (si présent)
        const video = document.getElementById("video-modal-player");
        if (video && typeof video.setSinkId === "function") {
            try {
                await video.setSinkId(targetSinkId);
            } catch (err) {
                console.warn("[AudioPlayer] video.setSinkId error:", err);
            }
        }

        // 3. Appliquer à l'AudioContext (si supporté par Chromium)
        if (this.eqAudioCtx && typeof this.eqAudioCtx.setSinkId === "function") {
            try {
                await this.eqAudioCtx.setSinkId(targetSinkId);
            } catch (err) {
                console.warn("[AudioPlayer] eqAudioCtx.setSinkId error:", err);
            }
        }

        // 4. Appliquer à l'AudioContext du lecteur vidéo (VideoAudioManager)
        if (window.VideoAudioManager && typeof window.VideoAudioManager.applyOutputDevice === "function") {
            try {
                await window.VideoAudioManager.applyOutputDevice(deviceId);
            } catch (err) {
                console.warn("[AudioPlayer] VideoAudioManager.applyOutputDevice error:", err);
            }
        }

        // Trouver le libellé pour le toast
        let activeLabel = "Par défaut (Windows)";
        if (deviceId !== "default") {
            const found = (this.availableAudioOutputDevices || []).find(d => d.deviceId === deviceId);
            if (found) {
                activeLabel = this.getCleanDeviceLabel(found);
            }
        }

        this.updateAudioOutputButtonsUI();

        if (typeof showToast === "function") {
            showToast(`Sortie son : ${activeLabel}`, "info");
        }
    },

    updateAudioOutputButtonsUI() {
        const miniIcon = document.getElementById("mini-player-audio-output-icon");
        const ambientIcon = document.getElementById("ambient-audio-output-icon");
        const miniBtn = document.getElementById("mini-player-audio-output-btn");
        const ambientBtn = document.getElementById("ambient-audio-output-btn");

        let activeDev = null;
        let activeCategory = "speaker";
        let label = "Sortie par défaut";

        if (this.audioOutputDeviceId && this.audioOutputDeviceId !== "default") {
            activeDev = (this.availableAudioOutputDevices || []).find(d => d.deviceId === this.audioOutputDeviceId);
            if (activeDev) {
                activeCategory = this.getDeviceCategory(activeDev);
                label = this.getCleanDeviceLabel(activeDev);
            }
        } else {
            const defDev = (this.availableAudioOutputDevices || []).find(d => d.deviceId === "default");
            if (defDev) {
                activeCategory = this.getDeviceCategory(defDev);
                label = `Par défaut (${this.getCleanDeviceLabel(defDev)})`;
            }
        }

        const iconSvg = this.getDeviceSvgIcon(activeCategory, 17);
        const ambientIconSvg = this.getDeviceSvgIcon(activeCategory, 18);

        if (miniIcon) miniIcon.outerHTML = iconSvg.replace('<svg ', '<svg id="mini-player-audio-output-icon" ');
        if (ambientIcon) ambientIcon.outerHTML = ambientIconSvg.replace('<svg ', '<svg id="ambient-audio-output-icon" ');

        const titleText = `Sortie son : ${label} (Cliquer pour changer)`;
        if (miniBtn) miniBtn.title = titleText;
        if (ambientBtn) ambientBtn.title = titleText;
    },

    updatePlayStateUI() {
        const miniPlayIcon = document.getElementById("mini-player-icon-play");
        const miniPauseIcon = document.getElementById("mini-player-icon-pause");
        const playerPlayIcon = document.getElementById("player-icon-play");
        const playerPauseIcon = document.getElementById("player-icon-pause");
        const tabEq = document.getElementById("player-tab-eq");
        const headerPlayerSwitch = document.getElementById("player-mode-switch-group");
        const headerPlayerEq = document.getElementById("header-player-eq");
        const headerPlayerBtn = document.getElementById("btn-header-goto-player");
        const nowPlayingSubtab = document.getElementById("player-subtab-now-playing");
        const nowPlayingIcon = document.getElementById("player-subtab-now-playing-icon");

        const vPlayer = document.getElementById("video-modal-player");
        const isVideoPlaying = Boolean(
            (vPlayer && !vPlayer.paused) || 
            (window.isVideoPlayingInBackground && vPlayer && !vPlayer.paused)
        );
        const isPlaybackActive = Boolean(this.isPlaying || isVideoPlaying);

        if (miniPlayIcon) miniPlayIcon.style.display = this.isPlaying ? "none" : "block";
        if (miniPauseIcon) miniPauseIcon.style.display = this.isPlaying ? "block" : "none";
        if (playerPlayIcon) playerPlayIcon.style.display = this.isPlaying ? "none" : "block";
        if (playerPauseIcon) playerPauseIcon.style.display = this.isPlaying ? "block" : "none";

        if (tabEq) tabEq.style.display = isPlaybackActive ? "inline-flex" : "none";
        if (nowPlayingSubtab) nowPlayingSubtab.classList.toggle("is-playing", isPlaybackActive);
        if (nowPlayingIcon) nowPlayingIcon.textContent = isVideoPlaying ? "🎬" : "🎧";
        if (headerPlayerEq) headerPlayerEq.style.display = this.isPlaying ? "inline-flex" : "none";
        if (headerPlayerBtn) headerPlayerBtn.classList.toggle("is-playing", this.isPlaying);
        if (headerPlayerSwitch) headerPlayerSwitch.classList.toggle("is-playing", this.isPlaying);
        if (typeof updateHeaderNowPlayingButton === "function") updateHeaderNowPlayingButton();

        // Mettre à jour les barres d'égaliseur de la piste active dans la tracklist si cet album est affiché
        const isCurrentAlbumActive = Boolean(
            this.activeAlbumPath && this.currentAlbum && this.activeAlbumPath === this.currentAlbum.path
        );
        document.querySelectorAll("#player-tracklist-container .player-track-item").forEach((el, idx) => {
            const isCur = isCurrentAlbumActive && (idx === this.currentIndex);
            el.classList.toggle("active", isCur);
            const eq = el.querySelector(".player-equalizer-bars");
            if (eq) eq.style.display = (isCur && this.isPlaying) ? "inline-flex" : "none";
        });

        // Mettre à jour la vue « Tout » si active (ciblage ciblé O(1) au lieu de balayer 4500 éléments)
        if (this.currentView === "all") {
            this.updateActiveTrackInAllContainer();
        }

        // Mettre à jour la vue de détail album si active dans l'onglet albums
        if (this.isAlbumDetailOpen && this.detailAlbumPath) {
            const detailBlock = document.querySelector("#player-album-detail-block .player-all-album-block");
            if (detailBlock) {
                const isBlockActive = Boolean(this.activeAlbumPath && detailBlock.getAttribute("data-alb-path") === this.activeAlbumPath);
                detailBlock.classList.toggle("is-active-album", isBlockActive);
                detailBlock.querySelectorAll(".player-track-item").forEach(el => {
                    const trkIdx = parseInt(el.getAttribute("data-trk-idx"), 10);
                    const isCur = isBlockActive && (trkIdx === this.currentIndex);
                    el.classList.toggle("active", isCur);
                    const eq = el.querySelector(".player-equalizer-bars");
                    if (eq) eq.style.display = (isCur && this.isPlaying) ? "inline-flex" : "none";
                });
            }
        }

        // Mettre à jour la vue de détail playlist si active dans l'onglet playlists
        const plDetailBody = document.getElementById("playlist-tracks-body");
        if (plDetailBody && (this.isUserPlaylistActive || (this.currentAlbum && (this.currentAlbum.is_playlist || this.currentAlbum.is_collection)))) {
            plDetailBody.querySelectorAll("tr[data-trk-idx]").forEach(row => {
                const trkIdx = parseInt(row.getAttribute("data-trk-idx"), 10);
                const isCur = (trkIdx === this.currentIndex);
                row.classList.toggle("active-track-row", isCur);
                const numCell = row.cells[0];
                if (numCell) {
                    if (isCur && this.isPlaying) {
                        numCell.innerHTML = '<span class="player-equalizer-bars" style="display:inline-flex; vertical-align:middle;"><span class="player-equalizer-bar"></span><span class="player-equalizer-bar"></span><span class="player-equalizer-bar"></span></span>';
                    } else {
                        numCell.textContent = String(trkIdx + 1);
                    }
                }
            });
        }

        // Synchronisation de la pochette dynamique dans le volet sticky de la playlist
        if (window.UserPlaylists && typeof window.UserPlaylists.syncHeroCoverFromPlayer === "function") {
            window.UserPlaylists.syncHeroCoverFromPlayer();
        }

        // ── Auto-scroll intelligent vers la piste active quelle que soit la vue active ──────
        // (Appelé impérativement APRÈS la mise à jour des classes .active sur le DOM pour cibler instantanément le bon élément)
        if (this.currentView === "now-playing" || (this.currentView === "albums" && this.isAlbumDetailOpen) || this.currentView === "playlists" || this.currentView === "all") {
            const trackChanged = (this._lastScrolledTrackIndex !== this.currentIndex);
            this.scrollToActiveTrack(trackChanged);
        }

        const queueEq = document.querySelector("#queue-current-card .player-equalizer-bars");
        if (queueEq) queueEq.style.display = this.isPlaying ? "inline-flex" : "none";

        // 7. Mode Ambiance : synchroniser les boutons d'accès rapide et les contrôles ambiance
        const btnHeaderAmbient = document.getElementById("btn-ambient-mode");
        const btnMiniAmbient = document.getElementById("mini-player-ambient-btn");
        const btnFocusAmbient = document.getElementById("player-now-playing-ambient-btn");
        const ambientPlayIcon = document.getElementById("ambient-icon-play");
        const ambientPauseIcon = document.getElementById("ambient-icon-pause");

        // RÈGLE STRICTE : Accessible si lecture réelle en cours (Album ou Radio Web, PAS pour les previews)
        const canShowAmbient = Boolean(this.isPlaying && (this.currentAlbum || (this.isRadioPlaying && this.currentRadio)));
        if (btnHeaderAmbient) btnHeaderAmbient.style.display = canShowAmbient ? "inline-flex" : "none";
        if (btnMiniAmbient) btnMiniAmbient.style.display = canShowAmbient ? "inline-flex" : "none";
        if (btnFocusAmbient) btnFocusAmbient.style.display = canShowAmbient ? "inline-flex" : "none";

        if (ambientPlayIcon) ambientPlayIcon.style.display = this.isPlaying ? "none" : "block";
        if (ambientPauseIcon) ambientPauseIcon.style.display = this.isPlaying ? "block" : "none";

        if (!this.currentAlbum && !(this.isRadioPlaying && this.currentRadio) && window.AmbientVisualizer && window.AmbientVisualizer.isActive) {
            window.AmbientVisualizer.exit();
        }

        this.syncSystemMediaState();
        if (typeof window.updateVideoToggleButtons === "function") {
            window.updateVideoToggleButtons();
        }
        if (typeof window.updateScreenWakeLock === "function") {
            window.updateScreenWakeLock();
        }
    },

    syncSystemMediaState() {
        let title = "";
        let artist = "";
        let album = "";
        let cover = "";
        const isRadio = Boolean(this.isRadioPlaying && this.currentRadio);

        if (isRadio) {
            const rad = this.currentRadio;
            const np = window.RadioManager?.state?.nowPlaying;
            if (np && (np.title || np.raw)) {
                title = np.title || np.raw;
                artist = np.artist || (rad.sub_label ? `${rad.name} (${rad.sub_label})` : rad.name) || "Radio Web";
            } else {
                title = rad.name || "Radio Web";
                artist = rad.sub_label
                    ? (rad.sub_label_type === 'location' ? `📍 ${rad.sub_label} • ${rad.country || "Direct"}` : `🏷️ ${rad.sub_label}`)
                    : (rad.country || rad.tags || "Direct Radio");
            }
            album = "Contrôle du direct • 📻 Radio Web";
            cover = rad.favicon || "";
            if ((!cover || cover.includes("radio_placeholder") || cover.includes("wikimedia.org") || cover.includes("wikipedia.org")) && window.RadioManager?.getProceduralStationCover) {
                cover = window.RadioManager.getProceduralStationCover(rad.name, rad.tags, rad.country);
            }
        } else {
            const cur = (this.activePlaylist && this.activePlaylist[this.currentIndex]) || (this.playlist && this.playlist[this.currentIndex]);
            title = cur ? (cur.title || "Titre inconnu") : "";
            artist = (cur && cur.artist) || (this.currentAlbum && this.currentAlbum.artist) || "";
            album = (this.currentAlbum && this.currentAlbum.title) || "";
            cover = (this.currentAlbum && this.currentAlbum.cover_url) || "";
        }

        if (cover && !cover.startsWith("http") && !cover.startsWith("data:")) {
            cover = window.location.origin + cover;
        }

        // 1. API standard Windows MediaSession (SMTC & Clavier)
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = this.isPlaying ? "playing" : "paused";
            if (title) {
                const artwork = cover ? [{ src: cover, sizes: '512x512', type: 'image/jpeg' }] : [];
                try {
                    navigator.mediaSession.metadata = new MediaMetadata({
                        title: title,
                        artist: artist,
                        album: album,
                        artwork: artwork
                    });
                } catch (e) {}
            }
        }

        // 2. Synchronisation Electron (Boutons miniatures barre des tâches & System Tray)
        if (window.electronAPI && window.electronAPI.updatePlaybackState) {
            window.electronAPI.updatePlaybackState({
                isPlaying: this.isPlaying,
                isRadio: isRadio,
                title: title,
                artist: artist,
                album: album
            });
        }
    },

    updateProgressUI() {
        if (this.isRadioPlaying && window.RadioManager) {
            window.RadioManager.updateTimeshiftTimeline();
            return;
        }
        const cur = (this._pendingResumeSeekTime > 0 && (!this.audio.currentTime || this.audio.currentTime < 0.5))
            ? this._pendingResumeSeekTime
            : (this.audio.currentTime || 0);
        const dur = (this.audio.duration && !isNaN(this.audio.duration) && this.audio.duration > 0)
            ? this.audio.duration
            : (this._pendingResumeDuration || 0);
        const pct = dur > 0 ? (cur / dur) * 100 : 0;

        const miniSeekBar = document.getElementById("mini-player-seek-bar");
        const miniTimeCur = document.getElementById("mini-player-time-current");
        const playerSeekBar = document.getElementById("player-seek-slider");
        const playerTimeCur = document.getElementById("player-time-current");
        const ambientSeekBar = document.getElementById("ambient-seek-bar");
        const ambientTimeCur = document.getElementById("ambient-time-current");

        if (!this.isRadioPlaying) {
            if (miniSeekBar && miniSeekBar.min !== "0") {
                miniSeekBar.min = "0";
                miniSeekBar.max = "100";
                miniSeekBar.step = "0.1";
            }
            if (playerSeekBar && playerSeekBar.min !== "0") {
                playerSeekBar.min = "0";
                playerSeekBar.max = "100";
                playerSeekBar.step = "0.1";
            }
            if (ambientSeekBar && ambientSeekBar.min !== "0") {
                ambientSeekBar.min = "0";
                ambientSeekBar.max = "100";
                ambientSeekBar.step = "0.1";
            }
        }

        if (miniSeekBar) miniSeekBar.value = pct;
        if (miniTimeCur) miniTimeCur.textContent = this.formatTime(cur);
        if (playerSeekBar) playerSeekBar.value = pct;
        if (playerTimeCur) playerTimeCur.textContent = this.formatTime(cur);
        if (ambientSeekBar && !this.isSeeking) ambientSeekBar.value = pct;
        if (ambientTimeCur) ambientTimeCur.textContent = this.formatTime(cur);
    },

    seekRelative(seconds) {
        if (this.isRadioPlaying && window.RadioManager) {
            window.RadioManager.seekRelative(seconds);
            return;
        }
        if (!this.audio || !this.audio.duration || isNaN(this.audio.duration)) return;
        const cur = this.audio.currentTime || 0;
        const target = Math.max(0, Math.min(this.audio.duration, cur + seconds));
        this.audio.currentTime = target;
        this._pendingResumeSeekTime = 0;
        this._hasPlayedInCurrentRun = true;
        this.updateProgressUI();
        this.savePlaybackSession(true);
    },

    updateDurationUI() {
        if (this.isRadioPlaying && window.RadioManager) {
            window.RadioManager.updateTimeshiftTimeline();
            return;
        }
        const dur = (this.audio.duration && !isNaN(this.audio.duration) && this.audio.duration > 0)
            ? this.audio.duration
            : (this._pendingResumeDuration || 0);
        const miniTimeTot = document.getElementById("mini-player-time-total");
        const playerTimeTot = document.getElementById("player-time-total");
        const ambientTimeTot = document.getElementById("ambient-time-total");
        if (miniTimeTot) miniTimeTot.textContent = this.formatTime(dur);
        if (playerTimeTot) playerTimeTot.textContent = this.formatTime(dur);
        if (ambientTimeTot) ambientTimeTot.textContent = this.formatTime(dur);
    },

    formatTime(sec) {
        if (!sec || isNaN(sec)) return "0:00";
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    },

    async loadAlbum(albumPath, optsOrAutoPlayIndex = 0, isCollection = false, switchView = true) {
        if (!albumPath) return;
        if (this.isRadioPlaying) {
            this.isRadioPlaying = false;
            this.currentRadio = null;
            fetch("/api/radio/stop", { method: "POST" }).catch(() => {});
            if (window.RadioManager) window.RadioManager.stopStatusPolling();
        }

        this.isUserPlaylistActive = false;
        let autoPlay = false;
        let startTrackIndex = 0;
        let isCol = (this.librarySource === "library");
        let switchV = true;
        let shuffle = false;

        if (typeof optsOrAutoPlayIndex === "object" && optsOrAutoPlayIndex !== null) {
            autoPlay = optsOrAutoPlayIndex.autoPlay ?? false;
            startTrackIndex = optsOrAutoPlayIndex.startTrackIndex ?? 0;
            if (optsOrAutoPlayIndex.isCollection !== undefined) isCol = !!optsOrAutoPlayIndex.isCollection;
            if (optsOrAutoPlayIndex.switchView !== undefined) switchV = !!optsOrAutoPlayIndex.switchView;
            if (optsOrAutoPlayIndex.shuffle !== undefined) shuffle = !!optsOrAutoPlayIndex.shuffle;
        } else if (typeof optsOrAutoPlayIndex === "boolean") {
            autoPlay = optsOrAutoPlayIndex;
            isCol = !!isCollection;
            switchV = (switchView !== false);
        } else if (typeof optsOrAutoPlayIndex === "number") {
            autoPlay = true;
            startTrackIndex = optsOrAutoPlayIndex;
            isCol = !!isCollection;
            switchV = (switchView !== false);
        }

        if (switchV) {
            if (this.currentView && this.currentView !== "now-playing") {
                if (!this.savedScrollPositions) this.savedScrollPositions = {};
                if (this.currentView === "albums" && this.isAlbumDetailOpen) {
                    this.savedScrollPositions["album_detail"] = window.scrollY || document.documentElement.scrollTop || 0;
                } else if (this.currentView === "playlists" && window.UserPlaylists && window.UserPlaylists.isDetailOpen) {
                    this.savedScrollPositions["playlist_detail"] = window.scrollY || document.documentElement.scrollTop || 0;
                } else {
                    this.savedScrollPositions[this.currentView] = window.scrollY || document.documentElement.scrollTop || 0;
                }
            }
            this.resetPlayerScrollRobust();
        }

        // 1. Chercher dans le cache mémoire AudioPlayer ou synthétiser depuis allCatalog
        let info = this.albumInfoCache ? this.albumInfoCache.get(albumPath) : null;
        if (!info && this.allCatalog && Array.isArray(this.allCatalog.albums)) {
            const foundAlb = this.allCatalog.albums.find(a => a.path === albumPath);
            if (foundAlb && Array.isArray(foundAlb.tracks) && foundAlb.tracks.length > 0) {
                info = {
                    album_name: foundAlb.title,
                    album_artist: foundAlb.artist,
                    year: foundAlb.year || "",
                    genre: foundAlb.genre || "",
                    tracks: foundAlb.tracks.map(t => ({
                        title: t.title,
                        artist: t.artist || foundAlb.artist,
                        track_number: t.track_number,
                        duration: t.duration,
                        bitrate: t.bitrate || t.bitrate_kbps,
                        format: t.format,
                        filepath: t.filepath,
                        filename: t.filename
                    }))
                };
                if (!this.albumInfoCache) this.albumInfoCache = new Map();
                this.albumInfoCache.set(albumPath, info);
            }
        }

        const applyAlbumData = (albumInfo) => {
            const coverUrl = `/api/audio/cover?path=${encodeURIComponent(albumPath)}&t=${Date.now()}`;
            const folderName = albumPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "Album";

            const isAlbumVideo = Boolean(
                albumInfo.is_video ||
                (albumInfo.tracks || []).some(t => t.is_video || t.type === "video" || /\.(mp4|mkv|webm)$/i.test(t.filepath || t.path || "")) ||
                (albumPath && (albumPath.toLowerCase().includes("[vidéo]") || albumPath.toLowerCase().includes("[video]") || albumPath.toLowerCase().includes("[concert]")))
            );
            const isAlbumConcert = Boolean(
                albumInfo.is_concert ||
                (albumPath && albumPath.toLowerCase().includes("[concert]")) ||
                (isAlbumVideo && (albumPath && (albumPath.toLowerCase().includes("concert") || albumPath.toLowerCase().includes("live") || albumPath.toLowerCase().includes("tour") || albumPath.toLowerCase().includes("bercy"))))
            );

            this.currentAlbum = {
                title: albumInfo.album_name || folderName,
                artist: albumInfo.album_artist || "Artiste inconnu",
                year: albumInfo.year || "",
                genre: albumInfo.genre || "",
                cover_url: coverUrl,
                path: albumPath,
                is_collection: isCol,
                is_video: isAlbumVideo,
                is_concert: isAlbumConcert,
                warning: albumInfo.warning || null,
                editor_draft: albumInfo.editor_draft || null
            };

            const rawTracks = (albumInfo.tracks || []).slice().sort((a, b) => {
                const na = parseInt(a.track_number, 10) || 0;
                const nb = parseInt(b.track_number, 10) || 0;
                return na - nb;
            });

            this.playlist = rawTracks.map(t => {
                const fp = t.filepath || t.path || "";
                const ext = fp.substring(fp.lastIndexOf(".")).toUpperCase().replace(".", "");
                const isVid = Boolean(t.is_video || t.type === "video" || ext === "MP4" || ext === "MKV" || ext === "WEBM");
                const isConc = Boolean(t.is_concert || isAlbumConcert || (isVid && (fp.toLowerCase().includes("[concert]") || fp.toLowerCase().includes("concert") || fp.toLowerCase().includes("live") || fp.toLowerCase().includes("tour"))));
                return {
                    title: t.title || t.filename || "Piste",
                    artist: t.artist || albumInfo.album_artist || "Artiste inconnu",
                    track_number: t.track_number || "",
                    duration: t.duration || "--:--",
                    filepath: fp,
                    path: fp,
                    format: ext || "M4A",
                    type: isVid ? "video" : "audio",
                    is_video: isVid,
                    is_concert: isConc,
                    stream_url: `/api/audio/stream-local?path=${encodeURIComponent(fp)}`
                };
            });

            this.renderPlayerTab();
            this.showPlayerBar();
            if (switchV) {
                this.resetPlayerScrollRobust();
            }

            if (switchV) {
                if ((isWorkshopDrawerOpen || !isPlayerModeActive) && typeof enterPlayerMode === "function") {
                    this.previousModeWasWorkshop = true;
                    enterPlayerMode();
                } else if (isWorkshopDrawerOpen) {
                    this.previousModeWasWorkshop = true;
                    closeWorkshopDrawer();
                }
                this.setView("now-playing");
                this.resetPlayerScrollRobust();
            } else {
                this.updateMiniDockVisibility();
            }

            if (autoPlay && isWorkshopDrawerOpen) {
                this.previousModeWasWorkshop = true;
                closeWorkshopDrawer();
            }

            if (shuffle && this.playlist.length > 0) {
                this.isShuffle = true;
                this.updateShuffleUI();
                startTrackIndex = Math.floor(Math.random() * this.playlist.length);
            }

            if (autoPlay) {
                const startIdx = Math.max(0, Math.min(startTrackIndex, this.playlist.length - 1));
                this.currentTrackIsFromQueue = false;
                this.currentQueueTrack = null;
                this.playbackContext = {
                    album: this.currentAlbum,
                    playlist: this.playlist.slice(),
                    currentIndex: startIdx
                };
                this.playTrackAtIndex(startIdx);
                this.scrollToActiveTrack(true);
                if (shuffle) {
                    showToast(`🔀 Lecture aléatoire : ${this.currentAlbum.title}`, "info");
                }
            } else {
                // Navigation non-disruptive : Si un son joue déjà, ne pas interrompre l'actuel
                if (this.isPlaying && this.audio && this.audio.src) {
                    this.updateDisplayedAlbumUI();
                } else {
                    // Si aucun son ne joue, préparer la première piste sans lancer
                    const startIdx = Math.max(0, Math.min(startTrackIndex, this.playlist.length - 1));
                    if (this.playlist.length > 0 && startIdx < this.playlist.length) {
                        this.currentIndex = startIdx;
                        this.currentTrackIsFromQueue = false;
                        this.currentQueueTrack = null;
                        this.playbackContext = {
                            album: this.currentAlbum,
                            playlist: this.playlist.slice(),
                            currentIndex: startIdx
                        };
                        this.activeAlbumPath = this.currentAlbum.path;
                        this.activePlaylist = this.playlist.slice();
                        const trk = this.playlist[startIdx];
                        const isVideo = trk.type === "video" || trk.is_video || (trk.filepath && /\.(mp4|mkv|webm)$/i.test(trk.filepath));
                        if (!isVideo) {
                            this.audio.src = trk.stream_url;
                            this.audio.load();
                        } else {
                            if (this.audio) { this.audio.pause(); this.audio.src = ""; }
                        }
                        this.updateCurrentTrackUI(trk);
                        this.isPlaying = false;
                        this.updatePlayStateUI();
                    }
                }
            }
        };

        // Si disponible en mémoire, affichage et lecture instantanés (0 ms !)
        if (info) {
            applyAlbumData(info);
            // Revalidation discrète en tâche de fond pour rafraîchir brouillons ou avertissements
            fetch(`/api/album/info?path=${encodeURIComponent(albumPath)}`)
                .then(r => r.ok ? r.json() : null)
                .then(freshInfo => {
                    if (freshInfo && this.albumInfoCache) {
                        this.albumInfoCache.set(albumPath, freshInfo);
                        if (this.currentAlbum && this.currentAlbum.path === albumPath) {
                            if (freshInfo.warning !== undefined) this.currentAlbum.warning = freshInfo.warning;
                            if (freshInfo.editor_draft !== undefined) this.currentAlbum.editor_draft = freshInfo.editor_draft;
                        }
                    }
                })
                .catch(() => {});
            return;
        }

        // Sinon, chargement via backend avec batching optimisé (~180 ms)
        try {
            const res = await fetch(`/api/album/info?path=${encodeURIComponent(albumPath)}`);
            if (!res.ok) throw new Error("Album non trouvé");
            const freshInfo = await res.json();
            if (!this.albumInfoCache) this.albumInfoCache = new Map();
            this.albumInfoCache.set(albumPath, freshInfo);
            applyAlbumData(freshInfo);
        } catch (err) {
            console.error("Erreur chargement album audio:", err);
            showToast("Impossible de charger l'album pour la lecture : " + err.message, "danger");
        }
    },

    playTrackAtIndex(index, seekTime = 0) {
        if (!this.playlist || index < 0 || index >= this.playlist.length) return;
        if (this.isRadioPlaying) {
            this.isRadioPlaying = false;
            this.currentRadio = null;
            fetch("/api/radio/stop", { method: "POST" }).catch(() => {});
            if (window.RadioManager) window.RadioManager.stopStatusPolling();
        }
        this._isRestoringSavedSession = false;
        this._showResumeNotificationOnLoad = false;
        this._pendingResumeSeekTime = 0;
        this._pendingResumeDuration = 0;
        this._hasPlayedInCurrentRun = true;
        this.currentIndex = index;
        this.currentTrackIsFromQueue = false;
        this.currentQueueTrack = null;
        this.currentTrackPlayLogged = false;
        if (this.playbackContext) {
            this.playbackContext.currentIndex = index;
        } else if (this.currentAlbum) {
            this.playbackContext = {
                album: this.currentAlbum,
                playlist: this.playlist.slice(),
                currentIndex: index
            };
        }
        // Trace de la section de lancement (v3.3.2) : un nouveau contexte = un nouveau lancement
        if (!this.playbackOrigin || this._playbackOriginCtxRef !== this.playbackContext) {
            this.recordPlaybackOrigin();
        }
        this.activeAlbumPath = this.currentAlbum ? this.currentAlbum.path : null;
        this.activePlaylist = this.playlist.slice();
        const trk = this.playlist[index];
        this.currentTrack = trk;

        const isVideo = Boolean(
            trk.type === "video" ||
            trk.is_video ||
            (trk.filepath && /\.(mp4|mkv|webm)$/i.test(trk.filepath)) ||
            (trk.path && /\.(mp4|mkv|webm)$/i.test(trk.path))
        );

        if (isVideo) {
            // Lecture Vidéo / Concert au sein de la playlist ou de l'album (enchaînement normal, ne pas capturer comme audio à restaurer)
            window._savedAudioStateBeforeVideo = null;
            this.isPlaying = true;
            if (this.audio) {
                this.audio.pause();
            }
            this.updateCurrentTrackUI(trk);
            this.updatePlayStateUI();
            let vidPath = trk.filepath || trk.path || trk.rel_path || "";
            if (!vidPath && (trk.thumbnail_url || trk.cover_url)) {
                const targetUrl = trk.thumbnail_url || trk.cover_url || "";
                if (targetUrl.includes("path=")) {
                    try {
                        const m = targetUrl.match(/[?&]path=([^&]+)/);
                        if (m && m[1]) vidPath = decodeURIComponent(m[1]);
                    } catch (e) {}
                }
            }
            const isConc = Boolean(
                trk.is_concert ||
                (this.currentAlbum && this.currentAlbum.is_concert) ||
                (trk.duration_seconds && trk.duration_seconds >= 1200) ||
                (vidPath && (vidPath.toLowerCase().includes('[concert]') || vidPath.toLowerCase().includes('/concerts/') || vidPath.toLowerCase().includes('\\concerts\\'))) ||
                (trk.title && (trk.title.toLowerCase().includes(' en concert') || trk.title.toLowerCase().includes('full concert') || trk.title.toLowerCase().includes('live at') || trk.title.toLowerCase().includes('arena tour')))
            );
            openLocalVideoModal({
                title: trk.title,
                artist: trk.artist,
                path: vidPath,
                rel_path: trk.rel_path || vidPath,
                is_concert: isConc,
                thumbnail: trk.thumbnail_url || trk.cover_url || (this.currentAlbum ? this.currentAlbum.cover_url : ""),
                isPlaylistTrack: true
            });
            if (this.isQueueDrawerOpen) this.renderQueueDrawer();
            return;
        }

        // Lecture Audio classique : stopper et fermer impérativement toute vidéo (en premier plan ou en arrière-plan)
        if (window.closeVideoModal && (window.isVideoPlayingInBackground || document.getElementById("video-modal-backdrop")?.classList.contains("active") || (document.getElementById("video-modal-player") && !document.getElementById("video-modal-player").paused))) {
            window.closeVideoModal(true);
        }

        const startPlayback = () => {
            const trkPath = trk.filepath || trk.path || "";
            let streamUrl = trk.stream_url || (trkPath ? `/api/audio/stream-local?path=${encodeURIComponent(trkPath)}` : (trk.videoId || trk.id ? `/api/stream?id=${encodeURIComponent(trk.videoId || trk.id)}` : ""));
            if (streamUrl && streamUrl.includes("/api/stream?id=")) {
                streamUrl = streamUrl.replace(/&_t=\d+/, "") + `&_t=${Date.now()}`;
            }
            this.audio.src = streamUrl;
            this.audio.load();
            if (seekTime > 0) {
                this.audio.addEventListener("loadedmetadata", () => {
                    try { this.audio.currentTime = seekTime; } catch (e) {}
                }, { once: true });
            }
            AudioFader.fadeIn(this.audio, this.isMuted ? 0 : this.volume, 500);
            this.audio.play().catch(e => console.warn("Lecture différée:", e));
        };

        if (this.isPlaying && this.audio && !this.audio.paused && AudioFader.enabled) {
            AudioFader.fadeOut(this.audio, 280).then((completed) => {
                if (completed !== false) startPlayback();
            });
        } else {
            startPlayback();
        }

        this.updateCurrentTrackUI(trk);
        this.updatePlayStateUI();
        this.savePlaybackSession(true);
        if (this.isQueueDrawerOpen) this.renderQueueDrawer();
    },

    recordCurrentTrackPlay() {
        if (this.currentTrackPlayLogged) return;
        this.currentTrackPlayLogged = true;
        const trk = (this.playlist && this.playlist[this.currentIndex]) || null;
        if (!trk) return;

        fetch("/api/stats/track-played", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                path: trk.path || "",
                title: trk.title || "",
                artist: trk.artist || "",
                album: this.currentAlbum?.title || trk.album_title || "",
                genre: this.currentAlbum?.genre || trk.genre || "",
                duration: trk.duration_seconds || (this.audio ? this.audio.duration : 0) || 0,
                type: trk.type || "audio"
            })
        }).then(r => r.json()).then(data => {
            if (data && data.entry) {
                console.log(`[PlaybackStats] Écoute validée : "${data.entry.title}" (${data.entry.artist}) -> ${data.entry.play_count} écoute(s)`);
            }
        }).catch(() => {});
    },

    playRadioStream(station) {
        if (!station) return;
        this.isRadioPlaying = true;
        this.currentRadio = station;
        this.currentAlbum = null;
        this.playlist = [];
        this.currentIndex = -1;
        this.isPlaying = true;
        this._isRestoringSavedSession = false;
        this._hasPlayedInCurrentRun = true;
        this.playbackOrigin = { type: "radios", view: "radios" };
        this.playbackContext = {
            type: "radio",
            station: station,
            title: station.name || "Radio Web",
            artist: station.sub_label || station.country || "Radio",
            album: null,
            playlist: [],
            currentIndex: -1
        };
        this.currentQueueTrack = null;
        this.currentTrackIsFromQueue = false;

        if (window.closeVideoModal && (window.isVideoPlayingInBackground || document.getElementById("video-modal-backdrop")?.classList.contains("active"))) {
            window.closeVideoModal(true);
        }

        let logo = station.favicon;
        if (!logo || logo.includes("radio_placeholder") || logo.includes("upload.wikimedia.org")) {
            if (window.RadioManager && typeof window.RadioManager.getProceduralStationCover === "function") {
                logo = window.RadioManager.getProceduralStationCover(station.name, station.tags, station.country);
            } else {
                logo = "/static/assets/radio_placeholder.svg";
            }
        }
        const stationName = station.name || "Radio Web";
        const metaSubtitle = station.sub_label
            ? (station.sub_label_type === 'location' ? `📍 ${station.sub_label} • ${station.country || "Direct"}` : `🏷️ ${station.sub_label} • ${station.tags || "Direct"}`)
            : (station.tags || station.country || "Flux en direct");

        const miniThumb = document.getElementById("mini-player-thumb");
        const miniTitle = document.getElementById("mini-player-title");
        const miniArtist = document.getElementById("mini-player-artist");
        if (miniThumb) {
            miniThumb.src = logo;
            miniThumb.onerror = () => {
                miniThumb.onerror = null;
                if (window.RadioManager && typeof window.RadioManager.getProceduralStationCover === "function") {
                    miniThumb.src = window.RadioManager.getProceduralStationCover(station.name, station.tags, station.country);
                }
            };
        }
        if (miniTitle) miniTitle.textContent = stationName;
        if (miniArtist) miniArtist.textContent = metaSubtitle;

        const pCover = document.getElementById("player-cover-img");
        const pFmt = document.getElementById("player-format-badge");
        const pTitle = document.getElementById("player-track-title");
        const pArtist = document.getElementById("player-track-artist");
        const pAlbum = document.getElementById("player-track-album");
        if (pCover) {
            pCover.src = logo;
            pCover.onerror = () => {
                pCover.onerror = null;
                if (window.RadioManager && typeof window.RadioManager.getProceduralStationCover === "function") {
                    pCover.src = window.RadioManager.getProceduralStationCover(station.name, station.tags, station.country);
                }
            };
        }
        if (pFmt) pFmt.textContent = station.codec ? (station.codec + (station.bitrate ? " " + station.bitrate + "k" : "")) : "RADIO";
        if (pTitle) pTitle.textContent = stationName;
        if (pArtist) pArtist.textContent = metaSubtitle;
        if (pAlbum) pAlbum.textContent = "Contrôle du direct • Timeshift 30 min";

        const startRadioAudio = () => {
            const streamUrl = `/api/radio/stream?offset=0&_t=${Date.now()}`;
            this.audio.src = streamUrl;
            this.audio.load();
            this.audio.volume = this.isMuted ? 0 : (typeof this.volume === "number" ? this.volume : 1);
            const playPromise = this.audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(e => console.warn("[AudioPlayer] Lecture radio différée/bloquée:", e));
            }
        };

        if (this.audio && !this.audio.paused && AudioFader.enabled) {
            AudioFader.fadeOut(this.audio, 280).then(() => startRadioAudio());
        } else {
            startRadioAudio();
        }

        this.showPlayerBar();
        this.updatePlayStateUI();
        this.updateMiniDockVisibility();
        this.syncSystemMediaState();
        if (this.isQueueDrawerOpen) this.renderQueueDrawer();
        if (window.RadioManager) window.RadioManager.updateTimeshiftTimeline();
        if (window.AmbientVisualizer && window.AmbientVisualizer.isActive) {
            window.AmbientVisualizer.syncState();
        }
        // Atterrissage immédiat sur la page dédiée Grand Écran Radio
        if (typeof closeWorkshopDrawer === "function" && typeof isWorkshopDrawerOpen !== "undefined" && isWorkshopDrawerOpen) {
            closeWorkshopDrawer();
        }
        if (typeof enterPlayerMode === "function" && typeof isPlayerModeActive !== "undefined" && !isPlayerModeActive) {
            enterPlayerMode();
        }
        this.setView("now-playing");
        this.renderPlayerTab();
    },

    updateDisplayedAlbumUI() {
        const firstTrk = (this.playlist && this.playlist.length > 0) ? this.playlist[0] : null;
        const curTrk = (this.playlist && this.currentIndex >= 0 && this.currentIndex < this.playlist.length) ? this.playlist[this.currentIndex] : firstTrk;
        const coverUrl = (curTrk && (curTrk.thumbnail_url || curTrk.cover_url)) || (this.currentAlbum ? (this.currentAlbum.cover_url || this.currentAlbum.thumbnail_url) : "/static/placeholder-cover.svg");
        const albumName = this.currentAlbum ? this.currentAlbum.title : "";
        const albumYear = this.currentAlbum && this.currentAlbum.year ? ` • ${this.currentAlbum.year}` : "";

        const isVid = Boolean((firstTrk && (firstTrk.is_video || firstTrk.type === "video")) || (this.currentAlbum && this.currentAlbum.is_video));
        const isConc = Boolean((firstTrk && firstTrk.is_concert) || (this.currentAlbum && this.currentAlbum.is_concert));

        const pCover = document.getElementById("player-cover-img");
        const pFmt = document.getElementById("player-format-badge");
        const pTitle = document.getElementById("player-track-title");
        const pArtist = document.getElementById("player-track-artist");
        const pAlbum = document.getElementById("player-track-album");

        if (pCover) pCover.src = coverUrl;
        if (pFmt) pFmt.textContent = isConc ? "CONCERT" : (isVid ? "VIDÉO" : this.formatTrackBadge(curTrk || firstTrk));

        const pCoverWatchBtn = document.getElementById("player-cover-watch-btn");
        const pCoverBox = document.getElementById("player-cover-box");
        if (pCoverWatchBtn) {
            pCoverWatchBtn.style.display = isVid ? "inline-flex" : "none";
            const watchText = document.getElementById("player-cover-watch-text");
            if (watchText) {
                watchText.textContent = isConc ? "Regarder le concert" : "Regarder la vidéo";
            }
        }
        if (pCoverBox) {
            if (isVid) pCoverBox.classList.add("is-video-cover");
            else pCoverBox.classList.remove("is-video-cover");
        }

        if (pTitle) {
            const albTitle = albumName || (firstTrk ? (firstTrk.album || firstTrk.title) : "Album");
            pTitle.textContent = albTitle;
            pTitle.title = albTitle;
        }
        if (pArtist) {
            const albArtist = this.currentAlbum ? this.currentAlbum.artist : (firstTrk ? firstTrk.artist : "Artiste");
            pArtist.textContent = albArtist;
            pArtist.title = albArtist;
        }
        if (pAlbum) {
            const yr = (this.currentAlbum && this.currentAlbum.year) ? String(this.currentAlbum.year) : "";
            const gn = (this.currentAlbum && this.currentAlbum.genre) ? String(this.currentAlbum.genre) : ((firstTrk && firstTrk.genre) ? String(firstTrk.genre) : "");
            const cnt = (this.playlist && this.playlist.length) ? `${this.playlist.length} titre(s)` : "";
            pAlbum.textContent = [yr, gn, cnt].filter(Boolean).join(" • ");
        }
    },

    updateCurrentTrackUI(trk) {
        const coverUrl = (trk && (trk.thumbnail_url || trk.cover_url)) || (this.currentAlbum ? (this.currentAlbum.cover_url || this.currentAlbum.thumbnail_url) : "/static/placeholder-cover.svg");
        const isAllCollection = Boolean(this.currentAlbum && this.currentAlbum.path === "system:all-collection");
        const albumName = isAllCollection ? (trk?.album || "") : (this.currentAlbum ? this.currentAlbum.title : "");
        const albumYear = this.currentAlbum && this.currentAlbum.year ? ` • ${this.currentAlbum.year}` : (trk?.year ? ` • ${trk.year}` : "");

        // Mini bar flottante (persistance globale)
        const miniThumb = document.getElementById("mini-player-thumb");
        const miniTitle = document.getElementById("mini-player-title");
        const miniArtist = document.getElementById("mini-player-artist");

        if (miniThumb) miniThumb.src = coverUrl;
        if (miniTitle) miniTitle.textContent = trk.title;
        if (miniArtist) miniArtist.textContent = `${trk.artist}${albumName ? " • " + albumName : ""}`;

        // Onglet Lecteur (Sidebar Album)
        const isVid = Boolean(
            trk.type === "video" ||
            trk.is_video ||
            (trk.filepath && /\.(mp4|mkv|webm)$/i.test(trk.filepath)) ||
            (trk.path && /\.(mp4|mkv|webm)$/i.test(trk.path)) ||
            (this.currentAlbum && this.currentAlbum.is_video && !this.currentAlbum.is_playlist)
        );
        const isConc = Boolean(trk.is_concert || (this.currentAlbum && this.currentAlbum.is_concert));

        const pCover = document.getElementById("player-cover-img");
        const pFmt = document.getElementById("player-format-badge");
        const pTitle = document.getElementById("player-track-title");
        const pArtist = document.getElementById("player-track-artist");
        const pAlbum = document.getElementById("player-track-album");

        if (pCover) pCover.src = coverUrl;
        if (pFmt) pFmt.textContent = isConc ? "CONCERT" : (isVid ? "VIDÉO" : this.formatTrackBadge(trk));

        const pCoverWatchBtn = document.getElementById("player-cover-watch-btn");
        const pCoverBox = document.getElementById("player-cover-box");
        if (pCoverWatchBtn) {
            pCoverWatchBtn.style.display = isVid ? "inline-flex" : "none";
            const watchText = document.getElementById("player-cover-watch-text");
            if (watchText) {
                watchText.textContent = isConc ? "Regarder le concert" : "Regarder la vidéo";
            }
        }
        if (pCoverBox) {
            if (isVid) pCoverBox.classList.add("is-video-cover");
            else pCoverBox.classList.remove("is-video-cover");
        }

        if (pTitle) {
            const albTitle = isAllCollection ? (trk.album || trk.title) : (albumName || trk.album || trk.title);
            pTitle.textContent = albTitle;
            pTitle.title = albTitle;
        }
        if (pArtist) {
            const albArtist = isAllCollection ? (trk.artist || (this.currentAlbum && this.currentAlbum.artist)) : ((this.currentAlbum && this.currentAlbum.artist) ? this.currentAlbum.artist : trk.artist);
            pArtist.textContent = albArtist;
            pArtist.title = albArtist;
        }
        if (pAlbum) {
            const yr = (this.currentAlbum && this.currentAlbum.year) ? String(this.currentAlbum.year) : (trk.year ? String(trk.year) : "");
            const gn = (this.currentAlbum && this.currentAlbum.genre) ? String(this.currentAlbum.genre) : (trk.genre ? String(trk.genre) : "");
            const cnt = (this.playlist && this.playlist.length) ? `${this.playlist.length} titre(s)` : "";
            pAlbum.textContent = [yr, gn, cnt].filter(Boolean).join(" • ");
        }

        // Mode Ambiance Dock
        const ambientThumb = document.getElementById("ambient-cover-thumb");
        const ambientTitle = document.getElementById("ambient-track-title");
        const ambientSub = document.getElementById("ambient-track-sub");
        if (ambientThumb) ambientThumb.src = coverUrl;
        if (ambientTitle) ambientTitle.textContent = trk.title;
        if (ambientSub) ambientSub.textContent = `${trk.artist}${albumName ? " • " + albumName : ""}${albumYear}`;

        this.showPlayerBar();
        this.updateMiniDockVisibility();
        if (typeof updateHeaderNowPlayingButton === "function") updateHeaderNowPlayingButton();
    },

    renderPlayerTab() {
        this.updateNowPlayingBackLabel();
        const emptyState = document.getElementById("player-empty-state");
        const mainLayout = document.getElementById("player-main-layout");
        const badge = document.getElementById("player-active-album-badge");
        const meta = document.getElementById("player-tracklist-meta");
        const container = document.getElementById("player-tracklist-container");

        // Rendu Grand Écran dédié aux flux Radio Web en direct (Page Spéciale Haute Fidélité)
        if (this.isRadioPlaying && this.currentRadio) {
            if (emptyState) emptyState.style.display = "none";
            if (mainLayout) mainLayout.style.display = "flex";
            const st = this.currentRadio;
            const logo = st.favicon || (window.RadioManager ? window.RadioManager.getProceduralStationCover(st.name, st.tags, st.country) : "/static/assets/radio_placeholder.svg");

            const coverImg = document.getElementById("player-cover-img");
            if (coverImg) {
                coverImg.src = logo;
                coverImg.onerror = () => {
                    coverImg.onerror = null;
                    if (window.RadioManager) coverImg.src = window.RadioManager.getProceduralStationCover(st.name, st.tags, st.country);
                };
            }

            const titleEl = document.getElementById("player-track-title");
            const artistEl = document.getElementById("player-track-artist");
            const submetaEl = document.getElementById("player-track-album");
            const formatBadge = document.getElementById("player-format-badge");

            const currentLiveTitle = (window.RadioManager && window.RadioManager.state && window.RadioManager.state.nowPlaying && window.RadioManager.state.nowPlaying.raw)
                ? window.RadioManager.state.nowPlaying.raw
                : (this.lastIcyTitle || st.name || "Flux en direct");

            if (titleEl) {
                titleEl.textContent = st.name || "Radio Web";
                titleEl.title = st.name || "Radio Web";
            }
            if (artistEl) {
                const subText = st.sub_label
                    ? (st.sub_label_type === 'location' ? `📍 ${st.sub_label} • ${st.country || "France"}` : `🏷️ ${st.sub_label} • ${st.country || "Direct"}`)
                    : (st.tags || st.country || "Flux direct");
                artistEl.textContent = subText;
                artistEl.title = subText;
            }
            if (submetaEl) {
                submetaEl.textContent = `Flux direct • ${st.codec || 'MP3'} ${st.bitrate || 128}k • ${st.country || 'International'}`;
            }
            if (formatBadge) {
                formatBadge.textContent = "LIVE";
            }

            if (badge) {
                badge.style.display = "inline-flex";
                badge.className = "badge badge-sm badge-danger pulse-badge";
                badge.textContent = "🔴 EN DIRECT";
            }
            if (meta) {
                meta.textContent = "📻 Contrôle du Direct & Déclinaisons";
            }

            // Gestion des boutons du volet latéral gauche
            const playAll = document.getElementById("player-now-playing-btn-play-all");
            const nextAll = document.getElementById("player-now-playing-btn-next-all");
            const queueAll = document.getElementById("player-now-playing-btn-queue-all");
            const addPl = document.getElementById("player-btn-add-album-to-playlist");
            const onlineDown = document.getElementById("player-online-download-container");
            if (playAll) playAll.style.display = "none";
            if (nextAll) nextAll.style.display = "none";
            if (queueAll) queueAll.style.display = "none";
            if (addPl) addPl.style.display = "none";
            if (onlineDown) onlineDown.style.display = "none";

            // Identification du bouquet de déclinaisons de cette station
            let bouquetVariants = [];
            let bouquetName = "";
            if (window.RadioManager) {
                const rm = window.RadioManager;
                if (st.is_group && Array.isArray(st.variants)) {
                    bouquetVariants = st.variants;
                    bouquetName = st.name;
                } else if (st.parent_brand && Array.isArray(rm.state.browseResults)) {
                    const grp = rm.state.browseResults.find(g => g.is_group && (g.name === st.parent_brand || g.parent_brand === st.parent_brand));
                    if (grp && Array.isArray(grp.variants)) {
                        bouquetVariants = grp.variants;
                        bouquetName = grp.name;
                    }
                }
                if (!bouquetVariants.length && rm.state.currentMasterGroup && Array.isArray(rm.state.currentMasterGroup.variants)) {
                    bouquetVariants = rm.state.currentMasterGroup.variants;
                    bouquetName = rm.state.currentMasterGroup.name;
                }
            }

            const currentOffset = window.RadioManager ? window.RadioManager.state.currentOffset : 0;
            const isLive = currentOffset >= -2;
            const curTimeStr = isLive ? "0:00" : `-${formatSeconds(Math.abs(currentOffset))}`;

            // Rendu du volet droit
            if (container) {
                let html = `
                    <div class="radio-grand-ecran-container">
                        <!-- 1. CARTE HERO : À L'ANTENNE EN DIRECT -->
                        <div class="radio-hero-live-card">
                            <div class="radio-hero-header">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span class="badge-tab-count count-positive radio-live-pill-animated">
                                        <span class="radio-live-red-dot"></span> EN DIRECT
                                    </span>
                                    <span class="radio-hero-station-tag">${escapeHtml(st.name || "Station")}</span>
                                    ${st.sub_label ? `<span class="radio-hero-sub-pill">${st.sub_label_type === 'location' ? '📍' : '🏷️'} ${escapeHtml(st.sub_label)}</span>` : ''}
                                </div>
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <button type="button" class="btn btn-secondary btn-sm" id="btn-grand-ecran-ambient" title="Ouvrir le Mode Soirée avec visualiseur plein écran">
                                        ✨ Mode Soirée
                                    </button>
                                    <button type="button" class="btn btn-secondary btn-sm" id="btn-grand-ecran-goto-catalog" title="Voir la station dans l'annuaire des radios">
                                        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/></svg>
                                        <span>Annuaire</span>
                                    </button>
                                </div>
                            </div>

                            <div class="radio-hero-body">
                                <div class="radio-hero-now-playing-label">TITRE DIFFUSÉ SUR CETTE STATION :</div>
                                <div class="radio-hero-track-row">
                                    <h2 id="player-now-playing-radio-live-title" class="radio-hero-track-title">${escapeHtml(currentLiveTitle)}</h2>
                                    <div class="radio-hero-equalizer-bars">
                                        <span class="player-equalizer-bar"></span>
                                        <span class="player-equalizer-bar"></span>
                                        <span class="player-equalizer-bar"></span>
                                        <span class="player-equalizer-bar"></span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- 2. CONSOLE DU CONTRÔLE DU DIRECT (TIMESHIFTING) -->
                        <div class="radio-timeshift-console-card">
                            <div class="radio-timeshift-console-header">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="font-weight: 700; font-size: 0.88rem; color: #fff;">⏱️ Contrôle du Direct (Timeshifting)</span>
                                    <span class="text-muted" style="font-size: 0.78rem;">• Tampon de 30 minutes</span>
                                </div>
                                <span id="player-now-playing-radio-live-status" class="radio-live-pill ${isLive ? 'is-live' : 'is-behind'}">
                                    ${isLive ? '🔴 EN DIRECT' : '⚡ ' + curTimeStr}
                                </span>
                            </div>

                            <div style="margin: 12px 0 14px 0;">
                                <input type="range" id="player-now-playing-radio-seek-slider" class="player-seek-slider" min="-1800" max="0" step="1" value="${currentOffset}" style="width: 100%;">
                                <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: var(--text-muted); margin-top: 4px;">
                                    <span>-30:00 (Début du tampon)</span>
                                    <span id="player-now-playing-radio-current-pos">${curTimeStr}</span>
                                    <span>En direct</span>
                                </div>
                            </div>

                            <div class="radio-timeshift-buttons-row">
                                <button type="button" class="btn btn-secondary btn-sm" id="btn-grand-ecran-seek-15" title="Reculer de 15 secondes">⏮️ -15s</button>
                                <button type="button" class="btn btn-secondary btn-sm" id="btn-grand-ecran-seek-60" title="Reculer d'une minute">⏮️ -1 min</button>
                                <button type="button" class="btn btn-secondary btn-sm" id="btn-grand-ecran-seek-300" title="Reculer de 5 minutes">⏮️ -5 min</button>
                                <button type="button" class="btn btn-danger btn-sm" id="btn-grand-ecran-jump-live" style="margin-left: auto;">🔴 Sauter au Direct</button>
                            </div>
                        </div>
                `;

                // 3. DÉCLINAISONS DU RÉSEAU (BOUQUET) FAÇON TRACKLIST
                if (bouquetVariants.length > 1) {
                    const curId = st.id || st.stationuuid || st.url;
                    html += `
                        <div class="radio-declinations-section">
                            <div class="radio-declinations-header">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="font-size: 1.1rem;">✨</span>
                                    <h4 style="margin: 0; font-size: 0.96rem; font-weight: 700;">Déclinaisons du réseau ${escapeHtml(bouquetName || st.parent_brand || st.name)}</h4>
                                    <span class="badge-tab-count count-positive">${bouquetVariants.length} stations</span>
                                </div>
                                <span class="text-muted" style="font-size: 0.78rem;">Cliquez sur une déclinaison pour basculer l'écoute instantanément</span>
                            </div>

                            <div class="radio-declinations-list">
                                ${bouquetVariants.map((v, vIdx) => {
                                    const vId = v.id || v.stationuuid || v.url;
                                    const isThisStation = (vId === curId);
                                    const vSub = v.sub_label || v.name;
                                    const subIcon = (v.sub_label_type === "location") ? "📍" : "🏷️";
                                    const fmt = v.bitrate ? `${v.codec || "MP3"} ${v.bitrate}k` : (v.codec || "MP3");

                                    return `
                                        <div class="radio-declination-row ${isThisStation ? 'is-active-declination' : ''}" data-declination-idx="${vIdx}">
                                            <div class="radio-declination-num">
                                                ${isThisStation ? `
                                                    <span class="player-equalizer-bars" style="display: inline-flex;">
                                                        <span class="player-equalizer-bar"></span>
                                                        <span class="player-equalizer-bar"></span>
                                                        <span class="player-equalizer-bar"></span>
                                                    </span>
                                                ` : `${vIdx + 1}`}
                                            </div>
                                            <div class="radio-declination-info">
                                                <span class="radio-declination-name">${escapeHtml(v.name)}</span>
                                                <div class="radio-declination-meta">
                                                    ${v.sub_label ? `<span class="radio-declination-badge">${subIcon} ${escapeHtml(v.sub_label)}</span>` : ''}
                                                    <span class="radio-declination-badge">${escapeHtml(fmt)}</span>
                                                    ${v.votes ? `<span class="radio-declination-votes">⭐ ${v.votes}</span>` : ''}
                                                </div>
                                            </div>
                                            <button type="button" class="radio-declination-play-btn" title="Écouter ${escapeHtml(v.name)}">
                                                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                                                    <path d="${isThisStation ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' : 'M8 5v14l11-7z'}"/>
                                                </svg>
                                            </button>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    `;
                }

                // 4. FICHE TECHNIQUE DU FLUX
                const cleanHost = (st.url && st.url.includes("://")) ? st.url.split("://")[1].split("/")[0] : "icecast.soundstash.local";
                html += `
                    <div class="radio-tech-specs-card">
                        <div style="font-weight: 700; font-size: 0.85rem; color: #fff; margin-bottom: 10px;">📊 Fiche Technique du Flux Audio</div>
                        <div class="radio-tech-specs-grid">
                            <div class="radio-tech-spec-item">
                                <span class="radio-tech-spec-label">Format de diffusion</span>
                                <span class="radio-tech-spec-val">${escapeHtml(st.codec || "MP3")} Audio</span>
                            </div>
                            <div class="radio-tech-spec-item">
                                <span class="radio-tech-spec-label">Débit numérique</span>
                                <span class="radio-tech-spec-val">${st.bitrate || 128} kbps (CBR/VBR)</span>
                            </div>
                            <div class="radio-tech-spec-item">
                                <span class="radio-tech-spec-label">Serveur de streaming</span>
                                <span class="radio-tech-spec-val" title="${escapeHtml(cleanHost)}">${escapeHtml(cleanHost)}</span>
                            </div>
                            <div class="radio-tech-spec-item">
                                <span class="radio-tech-spec-label">Protection déconnexion</span>
                                <span class="radio-tech-spec-val" style="color: #10b981;">🟢 Auto-reconnexion active</span>
                            </div>
                        </div>
                    </div>
                </div>`;

                container.innerHTML = html;

                // Attachement des écouteurs d'événements
                const btnAnnuaire = container.querySelector("#btn-grand-ecran-goto-catalog");
                if (btnAnnuaire) {
                    btnAnnuaire.addEventListener("click", () => {
                        if (window.RadioManager) window.RadioManager.focusStation(st);
                    });
                }
                const btnAmbient = container.querySelector("#btn-grand-ecran-ambient");
                if (btnAmbient) {
                    btnAmbient.addEventListener("click", () => {
                        if (window.AmbientVisualizer && typeof window.AmbientVisualizer.toggle === "function") {
                            window.AmbientVisualizer.toggle();
                        }
                    });
                }

                const b15 = container.querySelector("#btn-grand-ecran-seek-15");
                const b60 = container.querySelector("#btn-grand-ecran-seek-60");
                const b300 = container.querySelector("#btn-grand-ecran-seek-300");
                const bLive = container.querySelector("#btn-grand-ecran-jump-live");
                if (b15) b15.addEventListener("click", () => { if (window.RadioManager) window.RadioManager.seekRelative(-15); });
                if (b60) b60.addEventListener("click", () => { if (window.RadioManager) window.RadioManager.seekRelative(-60); });
                if (b300) b300.addEventListener("click", () => { if (window.RadioManager) window.RadioManager.seekRelative(-300); });
                if (bLive) bLive.addEventListener("click", () => { if (window.RadioManager) window.RadioManager.jumpToLive(); });

                // Slider seekbar du grand écran
                const seekSlider = container.querySelector("#player-now-playing-radio-seek-slider");
                if (seekSlider) {
                    seekSlider.addEventListener("input", (e) => {
                        this.isSeeking = true;
                        const val = parseFloat(e.target.value);
                        const curPos = container.querySelector("#player-now-playing-radio-current-pos");
                        if (curPos) curPos.textContent = (val >= -2) ? "0:00" : `-${formatSeconds(Math.abs(val))}`;
                    });
                    seekSlider.addEventListener("change", (e) => {
                        this.isSeeking = false;
                        const val = parseFloat(e.target.value);
                        if (window.RadioManager) window.RadioManager.seekTo(val);
                    });
                }

                // Clic sur les déclinaisons de bouquet
                container.querySelectorAll(".radio-declination-row").forEach(row => {
                    row.addEventListener("click", () => {
                        const idx = parseInt(row.getAttribute("data-declination-idx"), 10);
                        if (!isNaN(idx) && bouquetVariants[idx] && window.RadioManager) {
                            const v = bouquetVariants[idx];
                            const vId = v.id || v.stationuuid || v.url;
                            if (vId === curId) {
                                window.AudioPlayer.togglePlayPause();
                            } else {
                                window.RadioManager.playStation(v);
                            }
                        }
                    });
                });
            }
            return;
        }

        // Restaurer la visibilité des boutons albums
        const playAll = document.getElementById("player-now-playing-btn-play-all");
        const nextAll = document.getElementById("player-now-playing-btn-next-all");
        const queueAll = document.getElementById("player-now-playing-btn-queue-all");
        const addPl = document.getElementById("player-btn-add-album-to-playlist");
        if (playAll) playAll.style.display = "";
        if (nextAll) nextAll.style.display = "";
        if (queueAll) queueAll.style.display = "";
        if (addPl) addPl.style.display = "";

        if (emptyState) emptyState.style.display = "none";
        if (mainLayout) mainLayout.style.display = "flex";
        if (badge) {
            badge.style.display = "inline-flex";
            if (this.currentAlbum && this.currentAlbum.is_collection) {
                badge.className = "badge badge-sm badge-info";
                badge.textContent = "💿 Collection";
            } else if (this.currentAlbum && this.currentAlbum.is_playlist) {
                badge.className = "badge badge-sm badge-secondary";
                badge.textContent = "📑 Playlist";
            } else if (this.currentAlbum && this.currentAlbum.is_online) {
                badge.className = "badge badge-sm badge-warning";
                badge.textContent = this.currentAlbum.is_single_track ? "🌐 Titre en ligne" : "🌐 Album en ligne";
            } else {
                badge.className = "badge badge-sm badge-warning";
                badge.textContent = "📁 Temporaire";
            }
        }
        if (meta) meta.textContent = `${this.playlist.length} piste(s)`;

        if (!container) return;
        container.innerHTML = "";
        try {
            container.scrollTop = 0;
            const wrapper = container.closest(".player-tracklist-wrapper");
            if (wrapper) wrapper.scrollTop = 0;
        } catch (_) {}

        const isCurrentAlbumActive = Boolean(
            this.activeAlbumPath && this.currentAlbum && this.activeAlbumPath === this.currentAlbum.path
        );

        this.playlist.forEach((trk, idx) => {
            const item = document.createElement("div");
            const isCur = isCurrentAlbumActive && (idx === this.currentIndex);
            item.className = `player-track-item ${isCur ? "active" : ""}`;
            const numStr = trk.track_number ? String(trk.track_number).padStart(2, '0') : String(idx + 1).padStart(2, '0');

            item.innerHTML = `
                <div class="player-track-item-left">
                    <span class="player-equalizer-bars" style="display: ${isCur && this.isPlaying ? "inline-flex" : "none"};">
                        <span class="player-equalizer-bar"></span>
                        <span class="player-equalizer-bar"></span>
                        <span class="player-equalizer-bar"></span>
                    </span>
                    <span class="player-track-item-num">${numStr}</span>
                    <span class="player-track-item-title" title="${escapeHtml(trk.title)}">${escapeHtml(trk.title)}</span>
                </div>
                <div class="player-track-actions">
                    <button type="button" class="btn-track-action btn-track-play" title="Lire immédiatement ce morceau">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        <span>Lire</span>
                    </button>
                    <button type="button" class="btn-track-action btn-track-play-next" title="Lire ce titre ensuite (priorité)">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                        <span>Ensuite</span>
                    </button>
                    <button type="button" class="btn-track-action btn-track-enqueue" title="Ajouter ce titre à la file d'attente">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
                        <span>+ File</span>
                    </button>
                    <button type="button" class="btn-track-action btn-track-add-playlist" title="Ajouter ce titre à une playlist">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/></svg>
                        <span>+ Playlist</span>
                    </button>
                    ${(trk.is_video || trk.type === "video") ? `
                    <button type="button" class="btn-track-action btn-track-watch-video" title="Regarder en plein écran">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        <span>${trk.is_concert ? "Concert" : "Vidéo"}</span>
                    </button>
                    ` : ""}
                    ${(trk.is_online || trk.video_id) ? `
                    <button type="button" class="btn-track-action btn-track-download-single" title="Télécharger ce morceau seul">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                        <span>Télécharger</span>
                    </button>
                    ` : ""}
                </div>
                <span class="dense-track-format">${escapeHtml(this.formatTrackBadge(trk))}</span>
                <span class="player-track-item-dur">${escapeHtml(trk.duration || "--:--")}</span>
            `;

            const btnPlay = item.querySelector(".btn-track-play");
            const btnWatchVid = item.querySelector(".btn-track-watch-video");
            const btnNext = item.querySelector(".btn-track-play-next");
            const btnEnqueue = item.querySelector(".btn-track-enqueue");
            const btnAddPlay = item.querySelector(".btn-track-add-playlist");
            const btnDownloadSingle = item.querySelector(".btn-track-download-single");

            if (btnPlay) {
                btnPlay.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this.playTrackAtIndex(idx);
                });
            }

            if (btnWatchVid) {
                btnWatchVid.addEventListener("click", (e) => {
                    e.stopPropagation();
                    if (isCur && window.isVideoPlayingInBackground && window.reopenVideoModal) {
                        window.reopenVideoModal();
                        return;
                    }
                    this.playTrackAtIndex(idx);
                });
            }

            if (btnNext) {
                btnNext.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this.enqueueTrack(trk, this.currentAlbum, true);
                });
            }

            if (btnEnqueue) {
                btnEnqueue.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this.enqueueTrack(trk, this.currentAlbum, false);
                });
            }

            if (btnAddPlay) {
                btnAddPlay.addEventListener("click", (e) => {
                    e.stopPropagation();
                    openAddToPlaylistModal({
                        type: trk.type === "video" ? "video" : "audio",
                        title: trk.title,
                        artist: trk.artist,
                        duration: trk.duration_seconds || trk.duration,
                        path: trk.path,
                        album_title: this.currentAlbum?.title,
                        cover_url: trk.cover_url
                    });
                });
            }

            if (btnDownloadSingle) {
                btnDownloadSingle.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this.downloadOnlineTrackItem(trk, btnDownloadSingle);
                });
            }

            item.addEventListener("click", (e) => {
                if (e.target.closest("button")) return;
                if (isCur && window.isVideoPlayingInBackground && window.reopenVideoModal) {
                    window.reopenVideoModal();
                    return;
                }
                this.playTrackAtIndex(idx);
            });

            container.appendChild(item);
        });

        this.updateOnlineDownloadButtons();
        if (this.currentView === "now-playing") {
            setTimeout(() => this.scrollToActiveTrack(true), 120);
        }
    },

    updateOnlineDownloadButtons() {
        const isOnline = Boolean(
            this.currentAlbum && 
            !this.currentAlbum.is_collection && 
            (this.currentAlbum.is_online || this.currentAlbum.online_url || (this.playlist && this.playlist.some(t => t.is_online)))
        );

        // Volet gauche (Panneau d'écoute)
        const onlineBox = document.getElementById("player-online-download-container");
        const onlineBtn = document.getElementById("player-btn-download-online");

        // En-tête volet droit (Tracklist)
        const headerBtn = document.getElementById("player-btn-download-album");

        // Mini barre flottante en bas
        const miniBtn = document.getElementById("mini-player-download-btn");

        if (!isOnline) {
            if (onlineBox) onlineBox.style.display = "none";
            if (headerBtn) headerBtn.style.display = "none";
            if (miniBtn) miniBtn.style.display = "none";
            return;
        }

        const isSingle = Boolean(this.currentAlbum && this.currentAlbum.is_single_track);
        const isPlaylist = Boolean(this.currentAlbum && ((this.currentAlbum.online_item && this.currentAlbum.online_item.is_playlist) || (this.currentAlbum.genre && String(this.currentAlbum.genre).toLowerCase() === "playlist")));
        
        const labelLeft = isSingle ? "Télécharger ce titre" : (isPlaylist ? "Télécharger la playlist" : "Télécharger tout l'album");
        const labelHeader = isSingle ? "Télécharger le titre" : (isPlaylist ? "Télécharger la playlist" : "Télécharger l'album");

        // Vérification dynamique réelle de l'état dans la file d'attente
        const onlineItem = this.currentAlbum.online_item;
        const currentUrl = (this.currentAlbum.online_url || (onlineItem && onlineItem.url) || "").trim();
        const queueList = window.currentDownloadQueue || [];
        const currentDl = window.currentDownloadingItem;

        const isInQueue = currentUrl ? queueList.some(q => q.url && q.url.trim() === currentUrl) : false;
        const isCurrent = Boolean(currentDl && currentDl.url && currentUrl && (currentDl.url.trim() === currentUrl));

        // Si l'élément avait un statut 'queued' ou 'downloading' mais qu'il n'est plus actif, réinitialiser
        if (onlineItem && (onlineItem.status === "queued" || onlineItem.status === "downloading")) {
            if (!isInQueue && !isCurrent) {
                onlineItem.status = null;
            }
        }

        let isQueued = isInQueue || Boolean(onlineItem && onlineItem.status === "queued");
        let isDownloading = isCurrent || Boolean(onlineItem && onlineItem.status === "downloading");

        if (onlineBox) onlineBox.style.display = "block";
        if (headerBtn) headerBtn.style.display = "inline-flex";
        if (miniBtn) miniBtn.style.display = "inline-flex";

        if (isDownloading) {
            if (onlineBtn) {
                onlineBtn.disabled = true;
                onlineBtn.classList.add("btn-dl-state-disabled");
                onlineBtn.title = "Cet album est actuellement en cours de téléchargement";
                onlineBtn.innerHTML = `<span style="display:inline-block; animation: spin 1.2s linear infinite; margin-right: 5px;">⚡</span><span id="player-btn-download-online-label">En cours de téléchargement</span>`;
            }
            if (headerBtn) {
                headerBtn.disabled = true;
                headerBtn.classList.add("btn-dl-state-disabled");
                headerBtn.title = "Cet album est actuellement en cours de téléchargement";
                headerBtn.innerHTML = `<span style="display:inline-block; animation: spin 1.2s linear infinite; margin-right: 5px;">⚡</span><span id="player-download-header-label">En cours...</span>`;
            }
            if (miniBtn) {
                miniBtn.disabled = true;
                miniBtn.title = "En cours de téléchargement";
            }
        } else if (isQueued) {
            if (onlineBtn) {
                onlineBtn.disabled = true;
                onlineBtn.classList.add("btn-dl-state-disabled");
                onlineBtn.title = "Déjà présent dans la file d'attente de téléchargement";
                onlineBtn.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" style="margin-right: 5px;"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z"/></svg><span id="player-btn-download-online-label">En file d'attente</span>`;
            }
            if (headerBtn) {
                headerBtn.disabled = true;
                headerBtn.classList.add("btn-dl-state-disabled");
                headerBtn.title = "Déjà présent dans la file d'attente de téléchargement";
                headerBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="margin-right: 5px;"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z"/></svg><span id="player-download-header-label">En file</span>`;
            }
            if (miniBtn) {
                miniBtn.disabled = true;
                miniBtn.title = "En file d'attente";
            }
        } else {
            // État normal : bouton actif et cliquable
            if (onlineBtn) {
                onlineBtn.disabled = false;
                onlineBtn.classList.remove("btn-dl-state-disabled");
                onlineBtn.title = isSingle ? "Télécharger ce titre dans votre collection" : "Télécharger tout cet album dans votre collection";
                onlineBtn.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg><span id="player-btn-download-online-label">${labelLeft}</span>`;
            }
            if (headerBtn) {
                headerBtn.disabled = false;
                headerBtn.classList.remove("btn-dl-state-disabled");
                headerBtn.title = isSingle ? "Télécharger ce titre dans votre collection" : "Télécharger tout cet album dans votre collection";
                headerBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg><span id="player-download-header-label">${labelHeader}</span>`;
            }
            if (miniBtn) {
                miniBtn.disabled = false;
                miniBtn.title = labelLeft;
            }
        }
    },

    async downloadCurrentOnlineItem(btnEl = null) {
        if (!this.currentAlbum) {
            showToast("Aucun élément en cours d'écoute.", "warning");
            return;
        }
        const isSingle = Boolean(this.currentAlbum.is_single_track);
        let targetUrl = this.currentAlbum.online_url || this.currentAlbum.online_item?.url;
        let targetTitle = this.currentAlbum.title;

        if (isSingle || !targetUrl) {
            const curTrk = this.playlist && this.playlist[this.currentIndex];
            if (curTrk && curTrk.video_id) {
                targetUrl = `https://www.youtube.com/watch?v=${curTrk.video_id}`;
                targetTitle = curTrk.title;
            }
        }

        if (!targetUrl) {
            showToast("Impossible de localiser l'URL de téléchargement pour cet élément.", "warning");
            return;
        }

        const onlineBtn = document.getElementById("player-btn-download-online");
        const headerBtn = document.getElementById("player-btn-download-album");
        const miniBtn = document.getElementById("mini-player-download-btn");

        if (onlineBtn) {
            onlineBtn.disabled = true;
            onlineBtn.innerHTML = `⏳ Ajout...`;
        }
        if (headerBtn) {
            headerBtn.disabled = true;
            headerBtn.innerHTML = `⏳ Ajout...`;
        }
        if (miniBtn) miniBtn.disabled = true;

        const fmt = currentConfig.default_format || "m4a";
        const itemObj = this.currentAlbum.online_item || {
            url: targetUrl,
            title: targetTitle,
            artist: this.currentAlbum.artist,
            thumbnail: this.currentAlbum.cover_url,
            type: isSingle ? "track" : "album"
        };

        try {
            await downloadItemFromSearch(
                targetUrl,
                targetTitle,
                fmt,
                null,
                "",
                itemObj
            );
            if (itemObj) itemObj.status = "queued";
            this.updateOnlineDownloadButtons();
        } catch (e) {
            console.error("Erreur téléchargement depuis le lecteur:", e);
            this.updateOnlineDownloadButtons();
        }
    },

    async downloadOnlineTrackItem(trk, btnEl = null) {
        if (!trk || !trk.video_id) {
            showToast("Piste introuvable.", "warning");
            return;
        }
        const trkUrl = `https://www.youtube.com/watch?v=${trk.video_id}`;
        const origHtml = btnEl ? btnEl.innerHTML : "";
        const fmt = currentConfig.default_format || "m4a";
        if (btnEl) {
            btnEl.disabled = true;
            btnEl.innerHTML = `⏳`;
        }
        try {
            await downloadItemFromSearch(
                trkUrl,
                trk.title,
                fmt,
                btnEl,
                origHtml,
                {
                    url: trkUrl,
                    title: trk.title,
                    artist: trk.artist || this.currentAlbum?.artist,
                    thumbnail: this.currentAlbum?.cover_url,
                    type: "track",
                    album: this.currentAlbum?.title
                }
            );
        } catch (e) {
            console.error("Erreur téléchargement piste:", e);
            if (btnEl && origHtml) {
                btnEl.disabled = false;
                btnEl.innerHTML = origHtml;
            }
        }
    },

    showPlayerBar() {
        this.updateFloatingBarVisibility();
    },

    async stopAndHide() {
        window._savedAudioStateBeforeVideo = null;
        window._isPlayingRandomClipChain = false;
        if (window.closeVideoModal) {
            window.closeVideoModal(true);
        }
        if (this.isPlaying && this.audio && !this.audio.paused && AudioFader.enabled) {
            await AudioFader.fadeOut(this.audio, 300);
        } else {
            AudioFader.stop(this.audio);
        }
        this.clearSavedPlaybackSession();
        this.audio.pause();
        this.audio.src = "";
        this.isPlaying = false;
        if (this.isRadioPlaying) {
            this.isRadioPlaying = false;
            this.currentRadio = null;
            fetch("/api/radio/stop", { method: "POST" }).catch(() => {});
            if (window.RadioManager) window.RadioManager.stopStatusPolling();
        }
        this.currentAlbum = null;
        this.currentTrack = null;
        this.playlist = [];
        this.activePlaylist = [];
        this.currentIndex = -1;
        this.updatePlayStateUI();

        // Réinitialisation de l'affichage du centre de commandes en mode repos
        const miniThumb = document.getElementById("mini-player-thumb");
        const miniTitle = document.getElementById("mini-player-title");
        const miniArtist = document.getElementById("mini-player-artist");
        const curTime = document.getElementById("mini-player-time-current");
        const totTime = document.getElementById("mini-player-time-total");
        const seekBar = document.getElementById("mini-player-seek-bar");
        if (miniThumb) miniThumb.src = "/static/placeholder-cover.svg";
        if (miniTitle) miniTitle.textContent = "Aucune lecture en cours";
        if (miniArtist) miniArtist.textContent = "SoundStash • Prêt pour la lecture";
        if (curTime) curTime.textContent = "0:00";
        if (totTime) totTime.textContent = "0:00";
        if (seekBar) seekBar.value = 0;

        this.updateFloatingBarVisibility();
        this.closeQueueDrawer();
        if (window.AmbientVisualizer && window.AmbientVisualizer.isActive) {
            window.AmbientVisualizer.exit();
        }
    },

    releaseAlbumHandle(albumPath) {
        if (!albumPath) return;
        const normTarget = String(albumPath).replace(/\\/g, "/").toLowerCase();
        const currentPath = (this.currentAlbum && this.currentAlbum.path) ? String(this.currentAlbum.path).replace(/\\/g, "/").toLowerCase() : "";
        const audioSrc = this.audio && this.audio.src ? decodeURIComponent(this.audio.src).replace(/\\/g, "/").toLowerCase() : "";

        if (currentPath.includes(normTarget) || normTarget.includes(currentPath) || audioSrc.includes(normTarget)) {
            if (this.audio) {
                this.audio.pause();
                this.audio.removeAttribute("src");
                this.audio.load();
            }
            this.isPlaying = false;
            this.currentAlbum = null;
            this.currentTrack = null;
            this.playlist = [];
            this.updatePlayStateUI();
        }
    },

    // Pré-écoute en ligne d'un album ou playlist complet
    playOnlineAlbum(albumInfo, tracks, startIndex = 0) {
        if (!tracks || tracks.length === 0) {
            showToast("Aucune piste disponible pour cet album.", "warning");
            return;
        }
        if (this.currentView && this.currentView !== "now-playing") {
            if (!this.savedScrollPositions) this.savedScrollPositions = {};
            this.savedScrollPositions[this.currentView] = window.scrollY || document.documentElement.scrollTop || 0;
        }
        this.isUserPlaylistActive = false;
        this.activeAlbumPath = `online:${albumInfo.url || albumInfo.title}`;
        this.currentAlbum = {
            title: albumInfo.title || "Album en ligne",
            artist: albumInfo.artist || "En ligne",
            year: albumInfo.year || "",
            genre: albumInfo.subtype || "Album",
            cover_url: albumInfo.thumbnail || albumInfo.cover_url || "/static/placeholder-cover.svg",
            path: `online:${albumInfo.url || albumInfo.title}`,
            is_collection: false,
            is_online: true,
            is_single_track: false,
            online_url: albumInfo.url || "",
            online_item: albumInfo.online_item || albumInfo
        };
        this.playlist = tracks.map((t, idx) => ({
            title: t.title || `Piste ${idx + 1}`,
            artist: t.artist || albumInfo.artist || "Artiste inconnu",
            track_number: t.track_number || (idx + 1),
            duration: t.duration || "--:--",
            duration_seconds: 0,
            filepath: "",
            format: "AAC",
            stream_url: `/api/stream?id=${encodeURIComponent(t.video_id)}`,
            video_id: t.video_id,
            is_online: true,
            origin_album: albumInfo.title || "",
            album_url: albumInfo.url || ""
        }));
        if ((isWorkshopDrawerOpen || !isPlayerModeActive) && typeof enterPlayerMode === "function") {
            this.previousModeWasWorkshop = true;
            enterPlayerMode();
        } else if (isWorkshopDrawerOpen) {
            this.previousModeWasWorkshop = true;
            closeWorkshopDrawer();
        }
        this.resetPlayerScrollRobust();
        this.activePlaylist = this.playlist.slice();
        this.renderPlayerTab();
        this.setView("now-playing");
        this.resetPlayerScrollRobust();
        this.showPlayerBar();
        this.updateMiniDockVisibility();
        this.updateOnlineDownloadButtons();
        const startIdx = Math.max(0, Math.min(startIndex, this.playlist.length - 1));
        this.playTrackAtIndex(startIdx);
        showToast(`Lecture de l'album : ${this.currentAlbum.title} (${this.playlist.length} pistes)`, "info");
    },

    // Pré-écoute en ligne (Stream d'un titre seul)
    playOnlineTrack(title, artist, thumb, videoId, albumName = "", albumUrl = "", itemObj = null) {
        if (!videoId) {
            showToast("Identifiant de piste introuvable.", "warning");
            return;
        }
        if ((isWorkshopDrawerOpen || !isPlayerModeActive) && typeof enterPlayerMode === "function") {
            this.previousModeWasWorkshop = true;
            enterPlayerMode();
        } else if (isWorkshopDrawerOpen) {
            this.previousModeWasWorkshop = true;
            closeWorkshopDrawer();
        }
        this.isUserPlaylistActive = false;
        this.activeAlbumPath = `online:single:${videoId}`;
        this.currentAlbum = {
            title: albumName || title || "Morceau en ligne",
            artist: artist || "En ligne",
            year: "",
            genre: "Single",
            cover_url: thumb || "/static/placeholder-cover.svg",
            path: `online:single:${videoId}`,
            is_collection: false,
            is_online: true,
            is_single_track: true,
            online_url: albumUrl || `https://www.youtube.com/watch?v=${videoId}`,
            online_item: itemObj || {
                title: title,
                artist: artist,
                thumbnail: thumb,
                id: videoId,
                type: "track",
                url: albumUrl || `https://www.youtube.com/watch?v=${videoId}`,
                status: null
            }
        };
        this.playlist = [{
            title: title || "Piste sans titre",
            artist: artist || "Artiste inconnu",
            track_number: "01",
            duration: "--:--",
            filepath: "",
            format: "AAC",
            stream_url: `/api/stream?id=${encodeURIComponent(videoId)}`,
            video_id: videoId,
            is_online: true,
            origin_album: albumName
        }];
        this.resetPlayerScrollRobust();
        this.activePlaylist = this.playlist.slice();
        this.renderPlayerTab();
        this.setView("now-playing");
        this.resetPlayerScrollRobust();
        this.showPlayerBar();
        this.updateMiniDockVisibility();
        this.updateOnlineDownloadButtons();
        this.playTrackAtIndex(0);
        showToast(`Pré-écoute : ${title || "Titre"}${artist ? " — " + artist : ""}`, "info");
    },

    /**
     * Charge toute la collection musicale et la met en lecture (mode aléatoire ou séquentiel).
     * Utilise les pistes déjà en mémoire (this.allCatalog) pour un lancement instantané (0 ms),
     * ou fetch en parallèle via /api/collection/all-tracks.
     */
    async playEntireCollection(opts = { shuffle: true }) {
        if (this.isRadioPlaying) {
            this.isRadioPlaying = false;
            this.currentRadio = null;
            fetch("/api/radio/stop", { method: "POST" }).catch(() => {});
            if (window.RadioManager) window.RadioManager.stopStatusPolling();
        }
        const albums = this.libraryAlbums;
        if ((!albums || albums.length === 0) && (!this.allCatalog || !this.allCatalog.albums || this.allCatalog.albums.length === 0)) {
            showToast("La bibliothèque est vide. Synchronisez d'abord votre collection.", "warning");
            return;
        }

        const shouldShuffle = (opts && opts.shuffle !== undefined) ? Boolean(opts.shuffle) : true;

        try {
            let tracks = [];
            let totalAlbumsCount = (albums && albums.length) || 0;

            // 1. Extraction ultra-rapide 0 ms si le catalogue complet est déjà en mémoire
            if (this.allCatalog && Array.isArray(this.allCatalog.albums) && this.allCatalog.albums.length > 0) {
                totalAlbumsCount = this.allCatalog.albums.length;
                for (const alb of this.allCatalog.albums) {
                    const cover = alb.cover_url || `/api/audio/cover?path=${encodeURIComponent(alb.path)}`;
                    const albTitle = alb.title || "";
                    const albArtist = alb.artist || "";
                    const albPath = alb.path || "";
                    for (let idx = 0; idx < (alb.tracks || []).length; idx++) {
                        const t = alb.tracks[idx];
                        const fp = t.filepath || t.path || "";
                        tracks.push({
                            id: `collection-${albPath}-${idx}`,
                            type: "audio",
                            title: t.title || `Piste ${idx + 1}`,
                            artist: t.artist || albArtist,
                            album: t.album || albTitle,
                            album_path: albPath,
                            duration: t.duration || "--:--",
                            duration_seconds: t.duration_seconds || 0,
                            path: fp,
                            filepath: fp,
                            rel_path: fp,
                            stream_url: t.stream_url || `/api/audio/stream-local?path=${encodeURIComponent(fp)}`,
                            cover_url: cover,
                            thumbnail_url: cover,
                            track_number: t.track_number || (idx + 1),
                            format: t.format || "M4A"
                        });
                    }
                }
            }

            // 2. Repli API si non présent en mémoire
            if (tracks.length === 0) {
                const res = await fetch(`/api/collection/all-tracks?source=${encodeURIComponent(this.librarySource)}`);
                if (!res.ok) throw new Error("Erreur de récupération des pistes de la collection");
                const data = await res.json();
                tracks = data.tracks || [];
                if (data.albums_count) totalAlbumsCount = data.albums_count;
            }

            if (tracks.length === 0) {
                showToast("Aucune piste trouvée dans la collection.", "warning");
                return;
            }

            const playListTracks = tracks.slice();
            const startIdx = shouldShuffle ? Math.floor(Math.random() * playListTracks.length) : 0;
            this.isShuffle = shouldShuffle;
            this.updateShuffleUI();
            this.isUserPlaylistActive = true;
            this.currentAlbum = {
                title: "🌍 Toute la Collection",
                artist: `${totalAlbumsCount} albums • ${playListTracks.length} pistes`,
                year: "",
                genre: "Collection",
                cover_url: playListTracks[startIdx]?.cover_url || "/static/placeholder-cover.svg",
                path: "system:all-collection",
                is_playlist: true,
                is_collection: true
            };
            this.playlist = playListTracks;
            this.playbackContext = {
                album: this.currentAlbum,
                playlist: playListTracks.slice(),
                currentIndex: startIdx
            };
            this.currentIndex = startIdx;
            this.activeAlbumPath = this.currentAlbum.path;
            this.activePlaylist = this.playlist.slice();
            this.playbackOrigin = { view: "all", type: "all", path: "system:all-collection" };

            this.renderPlayerTab();
            if (this.currentView === "all") {
                if (typeof this.updateActiveTrackInAllContainer === "function") {
                    this.updateActiveTrackInAllContainer();
                }
            } else if (this.currentView !== "playlists") {
                this.resetPlayerScrollRobust();
            }
            this.playTrackAtIndex(startIdx);
            setTimeout(() => this.scrollToActiveTrack(true), 120);

            showToast(`▶ Lecture ${shouldShuffle ? "aléatoire " : ""}démarrée : 🌍 Toute la Collection (${playListTracks.length} pistes)`, "success", 3000);
        } catch (err) {
            console.error("Erreur playEntireCollection:", err);
            showToast("Impossible de lancer toute la collection : " + err.message, "danger");
        }
    },

    playSearchResults(matches, shuffle = true) {
        if (!matches || matches.length === 0) return;
        const shuffleArr = (arr) => {
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            return arr;
        };
        const tracks = matches.map((m, idx) => {
            const t = m.track;
            const alb = m.album;
            const fp = t.filepath || t.path || "";
            return {
                id: `search-${alb.path}-${idx}`,
                type: "audio",
                title: t.title || `Piste ${idx + 1}`,
                artist: t.artist || alb.artist,
                album: t.album || alb.title,
                album_path: alb.path,
                duration: t.duration || "--:--",
                duration_seconds: t.duration_seconds || 0,
                path: fp,
                filepath: fp,
                rel_path: fp,
                stream_url: t.stream_url || `/api/audio/stream-local?path=${encodeURIComponent(fp)}`,
                cover_url: alb.cover_url || `/api/audio/cover?path=${encodeURIComponent(alb.path)}`,
                thumbnail_url: alb.cover_url || `/api/audio/cover?path=${encodeURIComponent(alb.path)}`,
                track_number: t.track_number || (idx + 1),
                format: t.format || "M4A"
            };
        });
        const playListTracks = shuffle ? shuffleArr(tracks.slice()) : tracks.slice();
        this.isShuffle = shuffle;
        this.updateShuffleUI();
        this.isUserPlaylistActive = true;
        this.currentAlbum = {
            title: "🔍 Résultats de recherche",
            artist: `${playListTracks.length} piste${playListTracks.length > 1 ? "s" : ""}`,
            year: "",
            genre: "Recherche",
            cover_url: playListTracks[0]?.cover_url || "/static/placeholder-cover.svg",
            path: "system:search-results",
            is_playlist: true,
            is_collection: true
        };
        this.playlist = playListTracks;
        this.playbackContext = {
            album: this.currentAlbum,
            playlist: playListTracks.slice(),
            currentIndex: 0
        };
        this.currentIndex = 0;
        this.activeAlbumPath = this.currentAlbum.path;
        this.activePlaylist = this.playlist.slice();

        this.renderPlayerTab();
        if (this.currentView === "all") {
            if (typeof this.updateActiveTrackInAllContainer === "function") {
                this.updateActiveTrackInAllContainer();
            }
        } else if (this.currentView !== "playlists") {
            this.resetPlayerScrollRobust();
        }
        this.playTrackAtIndex(0);
        setTimeout(() => this.scrollToActiveTrack(true), 120);
        showToast(`▶ Lecture ${shuffle ? "aléatoire " : ""}démarrée : 🔍 ${playListTracks.length} pistes`, "success", 3000);
    },

    async playUserPlaylist(playlistObj, startIndex = 0, shuffle = false) {
        if (!playlistObj) return;
        let pObj = playlistObj;

        const targetPath = (pObj.id && (pObj.id === "system:all-collection" || pObj.id.startsWith("system:"))) ? pObj.id : `playlist:${pObj.id}`;
        if (!shuffle && this.isUserPlaylistActive && this.playlist && this.currentAlbum && this.currentAlbum.path === targetPath && (!pObj.items || this.playlist.length === pObj.items.length)) {
            this.playTrackAtIndex(startIndex);
            setTimeout(() => this.scrollToActiveTrack(true), 60);
            return;
        }
        if (pObj.is_smart || !pObj.items || !Array.isArray(pObj.items)) {
            // Pour les Smart Playlists ou playlists non encore préchargées : fetch systématique pour ne jamais jouer de fichiers supprimés
            try {
                const res = await fetch(`/api/playlists/${pObj.id}`);
                if (res.ok) {
                    pObj = await res.json();
                    if (window.UserPlaylists && pObj.items) {
                        window.UserPlaylists.playlistCache.set(pObj.id, pObj);
                    }
                }
            } catch (e) {
                console.error("Erreur chargement playlist:", e);
                const cached = window.UserPlaylists?.playlistCache?.get(pObj.id);
                if (cached && cached.items) {
                    pObj = cached;
                }
            }
        }

        if (!pObj.items || pObj.items.length === 0) {
            showToast("Cette playlist est vide. Ajoutez des morceaux ou des vidéos d'abord.", "warning");
            return;
        }

        this.isUserPlaylistActive = true;
        this.currentAlbum = {
            title: pObj.name,
            artist: "Playlist Mixte",
            year: "",
            genre: "Mixte",
            cover_url: pObj.items[0]?.thumbnail_url || pObj.items[0]?.cover_url || "/static/placeholder-cover.svg",
            path: (pObj.id && (pObj.id === "system:all-collection" || pObj.id.startsWith("system:"))) ? pObj.id : `playlist:${pObj.id}`,
            is_playlist: true,
            is_collection: true
        };

        this.playlist = pObj.items.map((item, idx) => {
            let itemPath = item.path || item.filepath || item.rel_path || "";
            if (!itemPath && (item.thumbnail_url || item.cover_url)) {
                const targetUrl = item.thumbnail_url || item.cover_url || "";
                if (targetUrl.includes("path=")) {
                    try {
                        const m = targetUrl.match(/[?&]path=([^&]+)/);
                        if (m && m[1]) itemPath = decodeURIComponent(m[1]);
                    } catch (e) {}
                }
            }
            return {
                id: item.id,
                type: item.type || "audio",
                title: item.title,
                artist: item.artist,
                duration: item.duration_str || (item.duration_seconds ? this.formatTime(item.duration_seconds) : "--:--"),
                duration_seconds: item.duration_seconds || 0,
                path: itemPath,
                filepath: item.filepath || itemPath,
                rel_path: item.rel_path || itemPath,
                stream_url: item.type === "video" ? `/api/videos/stream?path=${encodeURIComponent(itemPath)}` : `/api/audio/stream-local?path=${encodeURIComponent(itemPath)}`,
                cover_url: item.cover_url || item.thumbnail_url || "/static/placeholder-cover.svg",
                thumbnail_url: item.thumbnail_url || item.cover_url || "/static/placeholder-cover.svg",
                track_number: idx + 1,
                format: item.type === "video" ? "MP4" : "M4A"
            };
        });

        this.playbackContext = {
            album: this.currentAlbum,
            playlist: this.playlist.slice(),
            currentIndex: startIndex
        };
        this.activeAlbumPath = this.currentAlbum.path;
        this.activePlaylist = this.playlist.slice();

        if (shuffle) {
            this.isShuffle = true;
            this.updateShuffleUI();
            const rnd = Math.floor(Math.random() * this.playlist.length);
            startIndex = rnd;
        }

        if ((isWorkshopDrawerOpen || !isPlayerModeActive) && typeof enterPlayerMode === "function") {
            this.previousModeWasWorkshop = true;
            enterPlayerMode();
        } else if (isWorkshopDrawerOpen) {
            this.previousModeWasWorkshop = true;
            closeWorkshopDrawer();
        }
        this.renderPlayerTab();
        // Lancer la lecture sur place dans la playlist
        this.playTrackAtIndex(startIndex);
        setTimeout(() => this.scrollToActiveTrack(true), 80);
        showToast(`Lecture de la playlist « ${pObj.name} » démarrée !`, "success");
    },

    syncActiveUserPlaylist(updatedPlaylist) {
        if (!updatedPlaylist || !updatedPlaylist.id) return;
        const targetPath = (updatedPlaylist.id === "system:all-collection" || (typeof updatedPlaylist.id === "string" && updatedPlaylist.id.startsWith("system:")))
            ? updatedPlaylist.id
            : `playlist:${updatedPlaylist.id}`;

        const isCurrentActive = Boolean(
            this.isUserPlaylistActive &&
            this.currentAlbum &&
            (this.currentAlbum.path === targetPath || this.activeAlbumPath === targetPath)
        );

        if (!isCurrentActive) return;

        const currentTrack = (this.playlist && this.playlist.length > 0 && this.currentIndex >= 0 && this.currentIndex < this.playlist.length)
            ? this.playlist[this.currentIndex]
            : null;

        const rawItems = Array.isArray(updatedPlaylist.items) ? updatedPlaylist.items : [];
        const newTracks = rawItems.map((item, idx) => {
            let itemPath = item.path || item.filepath || item.rel_path || "";
            if (!itemPath && (item.thumbnail_url || item.cover_url)) {
                const targetUrl = item.thumbnail_url || item.cover_url || "";
                if (targetUrl.includes("path=")) {
                    try {
                        const m = targetUrl.match(/[?&]path=([^&]+)/);
                        if (m && m[1]) itemPath = decodeURIComponent(m[1]);
                    } catch (e) {}
                }
            }
            return {
                id: item.id,
                type: item.type || "audio",
                title: item.title,
                artist: item.artist,
                duration: item.duration_str || (item.duration_seconds ? this.formatTime(item.duration_seconds) : "--:--"),
                duration_seconds: item.duration_seconds || 0,
                path: itemPath,
                filepath: item.filepath || itemPath,
                rel_path: item.rel_path || itemPath,
                stream_url: item.type === "video" ? `/api/videos/stream?path=${encodeURIComponent(itemPath)}` : `/api/audio/stream-local?path=${encodeURIComponent(itemPath)}`,
                cover_url: item.cover_url || item.thumbnail_url || "/static/placeholder-cover.svg",
                thumbnail_url: item.thumbnail_url || item.cover_url || "/static/placeholder-cover.svg",
                track_number: idx + 1,
                format: item.type === "video" ? "MP4" : "M4A"
            };
        });

        if (this.currentAlbum) {
            this.currentAlbum.title = updatedPlaylist.name || this.currentAlbum.title;
            const newCover = updatedPlaylist.cover_url || (rawItems.length > 0 && (rawItems[0].thumbnail_url || rawItems[0].cover_url));
            if (newCover) {
                this.currentAlbum.cover_url = newCover;
            }
        }

        if (newTracks.length === 0) {
            this.playlist = [];
            this.activePlaylist = [];
            if (this.playbackContext) {
                this.playbackContext.playlist = [];
                this.playbackContext.currentIndex = 0;
            }
            this.currentIndex = 0;
            this.pause();
            this.renderPlayerTab();
            if (this.isQueueDrawerOpen && typeof this.renderQueueDrawer === "function") {
                this.renderQueueDrawer();
            }
            this.updatePlayStateUI();
            return;
        }

        let newIndex = -1;
        if (currentTrack) {
            if (currentTrack.id) {
                newIndex = newTracks.findIndex(t => t.id === currentTrack.id);
            }
            if (newIndex === -1 && currentTrack.path) {
                newIndex = newTracks.findIndex(t => t.path === currentTrack.path);
            }
        }

        if (newIndex !== -1) {
            this.playlist = newTracks;
            this.activePlaylist = newTracks.slice();
            this.currentIndex = newIndex;
            if (this.playbackContext) {
                this.playbackContext.playlist = newTracks.slice();
                this.playbackContext.currentIndex = newIndex;
            }
        } else {
            const nextIndex = Math.min(Math.max(0, this.currentIndex), newTracks.length - 1);
            this.playlist = newTracks;
            this.activePlaylist = newTracks.slice();
            this.currentIndex = nextIndex;
            if (this.playbackContext) {
                this.playbackContext.playlist = newTracks.slice();
                this.playbackContext.currentIndex = nextIndex;
            }
            if (this.isPlaying) {
                this.playTrackAtIndex(nextIndex);
            }
        }

        this.renderPlayerTab();
        if (this.isQueueDrawerOpen && typeof this.renderQueueDrawer === "function") {
            this.renderQueueDrawer();
        }
        this.updatePlayStateUI();
    },

    handlePlaylistDeleted(playlistId) {
        if (!playlistId) return;
        const targetPath = (playlistId === "system:all-collection" || (typeof playlistId === "string" && playlistId.startsWith("system:")))
            ? playlistId
            : `playlist:${playlistId}`;

        if (this.isUserPlaylistActive && this.currentAlbum && (this.currentAlbum.path === targetPath || this.activeAlbumPath === targetPath)) {
            this.pause();
            this.isUserPlaylistActive = false;
            this.playlist = [];
            this.activePlaylist = [];
            this.playbackContext = null;
            this.renderPlayerTab();
            if (this.isQueueDrawerOpen && typeof this.renderQueueDrawer === "function") {
                this.renderQueueDrawer();
            }
            this.updatePlayStateUI();
        }
    }
};

window.goToNowPlaying = function() {
    if (window.AudioPlayer) {
        window.AudioPlayer.navigateToCurrentlyPlaying();
    }
};

function setupAudioPlayer() {
    window.goToNowPlaying = function() {
        if (window.AudioPlayer) {
            window.AudioPlayer.navigateToCurrentlyPlaying();
        }
    };
    AudioPlayer.init();
}

function playTrack(title, artist, thumb, videoId, albumName = "", albumUrl = "", itemObj = null) {
    AudioPlayer.playOnlineTrack(title, artist, thumb, videoId, albumName, albumUrl, itemObj);
}

async function playOnlineAlbumFromItem(item, btnEl = null, startIndex = 0) {
    let origHtml = "";
    if (btnEl) {
        origHtml = btnEl.innerHTML;
        btnEl.disabled = true;
        btnEl.innerHTML = `<span style="display: inline-block; animation: spin 1s linear infinite;">⏳</span>`;
    }
    showToast(`Chargement de l'album "${item.title}"...`, "info");
    try {
        const res = await fetch(`/api/album/preview?url=${encodeURIComponent(item.url)}`);
        const data = await res.json();
        if (btnEl && origHtml) {
            btnEl.disabled = false;
            btnEl.innerHTML = origHtml;
        }
        if (!data.success || !data.tracks || data.tracks.length === 0) {
            showToast("Impossible de récupérer la liste des pistes de cet album.", "warning");
            return;
        }
        const availableTracks = data.tracks.filter(t => t.is_available && t.video_id);
        if (availableTracks.length === 0) {
            showToast("Aucune piste disponible à l'écoute pour cet album.", "warning");
            return;
        }

        AudioPlayer.playOnlineAlbum(
            {
                title: data.title || item.title,
                artist: data.artist || item.artist,
                year: data.year || item.year || "",
                thumbnail: item.thumbnail || data.thumbnail,
                url: item.url,
                subtype: data.subtype || item.subtype || "album",
                is_playlist: isPlaylistUrlOrItem(item, item.url),
                status: item.status || null,
                online_item: item
            },
            availableTracks,
            startIndex
        );

        if (typeof enterPlayerMode === "function") {
            enterPlayerMode();
        }
    } catch (err) {
        console.error("Erreur chargement album en ligne:", err);
        if (btnEl && origHtml) {
            btnEl.disabled = false;
            btnEl.innerHTML = origHtml;
        }
        showToast("Erreur lors de la récupération de l'album.", "danger");
    }
}


// Exports globaux
window.EQ_PRESETS = EQ_PRESETS;
window.AudioFader = AudioFader;
window.AudioPlayer = AudioPlayer;
window.setupAudioPlayer = setupAudioPlayer;
window.playTrack = playTrack;
window.playOnlineAlbumFromItem = playOnlineAlbumFromItem;

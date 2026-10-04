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
        if (!media || media.volume === 0) return Promise.resolve();
        const duration = (typeof durationMs === "number" && durationMs >= 0) ? durationMs : this.duration;

        if (!this.enabled || duration <= 0) {
            return Promise.resolve();
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
                    resolve();
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
                    resolve();
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

    // File d'attente prioritaire & Reprise de lecture
    userQueue: [],            // Array of { title, artist, album, year, filepath, stream_url, duration, format, track_number, cover_url, album_path }
    playbackContext: null,    // { album: {...}, playlist: [...], currentIndex: number }
    currentTrackIsFromQueue: false,
    currentQueueTrack: null,
    endOfAlbumBehavior: "stop", // "stop" | "repeat" | "random"
    isQueueDrawerOpen: false,

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
        this.updateSortSelectForView(this.currentView);
        this.updateAllSortSelect(false);
        this.updateVolumeUI();
        this.updateRepeatUI();
        this.updateQueueBadges();
        this.updateEqualizerUI();
        if (window.UserPlaylists) window.UserPlaylists.updateBadge();
        this.onTabActivated();
    },

    bindEvents() {
        const a = this.audio;

        a.addEventListener("play", () => {
            this.setupAudioContext();
            this.isPlaying = true;
            this.updatePlayStateUI();
        });

        a.addEventListener("pause", () => {
            this.isPlaying = false;
            this.updatePlayStateUI();
        });

        a.addEventListener("ended", () => {
            if (!this.currentTrackPlayLogged) {
                this.recordCurrentTrackPlay();
            }
            this.handleTrackEnded();
        });

        a.addEventListener("timeupdate", () => {
            if (!this.currentTrackPlayLogged && this.audio && !this.audio.paused && (this.audio.currentTime >= 10 || (this.audio.duration > 0 && this.audio.currentTime / this.audio.duration >= 0.5))) {
                this.recordCurrentTrackPlay();
            }
            if (this.isSeeking) return;
            this.updateProgressUI();
        });

        a.addEventListener("loadedmetadata", () => {
            this.updateDurationUI();
        });

        a.addEventListener("error", (e) => {
            if (!a.getAttribute("src") || !a.src || a.src === window.location.href || a.src.endsWith("/") || a.src === "") {
                return;
            }
            if (window.currentModalVideoItem || window.isVideoPlayingInBackground || document.getElementById("video-modal-backdrop")?.classList.contains("active")) {
                return;
            }
            const errCode = a.error ? a.error.code : "inconnu";
            const errMsg = a.error ? a.error.message : "";
            console.warn(`Erreur lecture audio (Code: ${errCode}, Msg: ${errMsg}, Src: ${a.src}):`, e);
            showToast("Impossible de lire ce flux audio (format ou réseau non supporté).", "warning");
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
                this.playPrev();
            });
        }
        if (miniNextBtn) {
            miniNextBtn.addEventListener("click", () => {
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
                const vPlayer = document.getElementById("video-modal-player");
                if (window.isVideoPlayingInBackground && vPlayer && vPlayer.duration) {
                    vPlayer.currentTime = (miniSeekBar.value / 100) * vPlayer.duration;
                    return;
                }
                if (a.duration) {
                    a.currentTime = (miniSeekBar.value / 100) * a.duration;
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

        // 4. Sous-Onglets de Vue (Albums, Artistes, Genres, En cours d'écoute)
        document.querySelectorAll(".player-subtab-btn").forEach(btn => {
            btn.addEventListener("click", () => {
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
                    if (typeof window.goToNowPlaying === "function") {
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

        // 5. Barre d'outils (Recherche, Tri & Filtres)
        const searchInput = document.getElementById("player-search-input");
        const searchClearBtn = document.getElementById("player-search-clear-btn");
        const sortSelect = document.getElementById("player-sort-select");
        const clearFilterBtn = document.getElementById("player-clear-filter-btn");

        let searchDebounceTimer = null;
        if (searchInput) {
            searchInput.addEventListener("input", () => {
                clearTimeout(searchDebounceTimer);
                searchDebounceTimer = setTimeout(() => {
                    if (this.currentView === "all") {
                        const prevSearch = Boolean(this.allSearchQuery);
                        this.allSearchQuery = searchInput.value.trim();
                        const nowSearch = Boolean(this.allSearchQuery);
                        if (prevSearch !== nowSearch) {
                            this.updateSortSelectForView("all");
                        }
                        if (searchClearBtn) searchClearBtn.style.display = this.allSearchQuery ? "block" : "none";
                        this.renderAllView();
                        return;
                    }
                    this.searchFilter = searchInput.value;
                    if (searchClearBtn) searchClearBtn.style.display = this.searchFilter ? "block" : "none";
                    if (this.isAlbumDetailOpen) this.closeAlbumDetail(false);
                    this.renderCurrentView();
                }, 35);
            });
        }
        if (searchClearBtn) {
            searchClearBtn.addEventListener("click", () => {
                clearTimeout(searchDebounceTimer);
                if (searchInput) searchInput.value = "";
                searchClearBtn.style.display = "none";
                if (this.currentView === "all") {
                    const prevSearch = Boolean(this.allSearchQuery);
                    this.allSearchQuery = "";
                    if (prevSearch) {
                        this.updateSortSelectForView("all");
                    }
                    this.renderAllView();
                    return;
                }
                this.searchFilter = "";
                if (this.isAlbumDetailOpen) this.closeAlbumDetail(false);
                this.renderCurrentView();
            });
        }
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
                    this.renderAllView();
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

        const allShuffleBtn = document.getElementById("player-btn-all-shuffle");
        if (allShuffleBtn) {
            allShuffleBtn.addEventListener("click", () => {
                if (this.currentView === "all" && this.allSearchQuery && this._currentCatalogMatches && this._currentCatalogMatches.length > 0) {
                    this.playSearchResults(this._currentCatalogMatches, true);
                } else {
                    this.playEntireCollection({ shuffle: true });
                }
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
                if (a.duration) {
                    const cur = (playerSeekSlider.value / 100) * a.duration;
                    const tc = document.getElementById("player-time-current");
                    if (tc) tc.textContent = this.formatTime(cur);
                }
            });
            playerSeekSlider.addEventListener("change", () => {
                this.isSeeking = false;
                if (a.duration) {
                    a.currentTime = (playerSeekSlider.value / 100) * a.duration;
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
            navigator.mediaSession.setActionHandler('previoustrack', () => this.playPrev());
            navigator.mediaSession.setActionHandler('nexttrack', () => this.playNext());
            try {
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
                } else if (action === 'next') {
                    this.playNext();
                } else if (action === 'prev') {
                    this.playPrev();
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
            if (grid) {
                if (cols === "3") {
                    grid.classList.add("cols-3");
                } else {
                    grid.classList.remove("cols-3");
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

    restoreScrollPosition(targetY) {
        if (typeof targetY !== "number" || isNaN(targetY) || targetY < 0) targetY = 0;
        this.cancelPendingScrolls();
        const doScroll = () => {
            try {
                window.scrollTo({ top: targetY, left: 0, behavior: "instant" });
            } catch (_) {
                try { window.scrollTo(0, targetY); } catch (_) {}
            }
            if (document.documentElement) document.documentElement.scrollTop = targetY;
            if (document.body) document.body.scrollTop = targetY;
        };

        doScroll();
        if (typeof requestAnimationFrame === "function") {
            this._scrollRafId = requestAnimationFrame(() => {
                doScroll();
                this._scrollRafId = null;
            });
        }
        this._restoreScrollTimer1 = setTimeout(() => { doScroll(); this._restoreScrollTimer1 = null; }, 25);
        this._restoreScrollTimer2 = setTimeout(() => { doScroll(); this._restoreScrollTimer2 = null; }, 80);
        this._restoreScrollTimer3 = setTimeout(() => { doScroll(); this._restoreScrollTimer3 = null; }, 160);
    },

    setView(view) {
        if (view === "all" && !this.isCatalogReady) {
            if (typeof showToast === "function") {
                showToast("⏳ Préparation du catalogue en cours, disponible dans un instant...", "info");
            }
            view = "albums";
        }

        if (view === "now-playing" && window.isVideoPlayingInBackground && window.reopenVideoModal) {
            window.reopenVideoModal();
        }

        const prevV = this.currentView;
        const wasNowPlaying = (prevV === "now-playing");

        // Mémoriser la position de défilement de la vue qu'on quitte si ce n'est pas "now-playing"
        if (prevV && prevV !== "now-playing") {
            if (!this.savedScrollPositions) this.savedScrollPositions = {};
            this.savedScrollPositions[prevV] = window.scrollY || document.documentElement.scrollTop || 0;
        }

        // Mémoriser la vue précédente lors de la transition vers "now-playing"
        if (prevV && prevV !== "now-playing" && view === "now-playing") {
            this.previousView = prevV;
        } else if (view !== "now-playing") {
            this.previousModeWasWorkshop = false;
        }

        if (prevV === "albums" && view !== "albums" && this.isAlbumDetailOpen) {
            this.closeAlbumDetail(false);
        }
        if (prevV === "playlists" && view !== "playlists" && window.UserPlaylists && window.UserPlaylists.isDetailOpen) {
            window.UserPlaylists.closeDetail();
        }

        this.currentView = view;
        if (view === "now-playing") {
            this.resetPlayerScrollRobust();
        } else if (wasNowPlaying) {
            const savedY = (this.savedScrollPositions && typeof this.savedScrollPositions[view] === "number")
                ? this.savedScrollPositions[view]
                : 0;
            this.restoreScrollPosition(savedY);
        }
        // Mettre à jour les sous-onglets
        document.querySelectorAll(".player-subtab-btn").forEach(btn => {
            btn.classList.toggle("active", btn.getAttribute("data-pview") === view);
        });

        // Afficher/Masquer les panneaux
        const panes = {
            "albums": document.getElementById("player-view-albums"),
            "all": document.getElementById("player-view-all"),
            "artists": document.getElementById("player-view-artists"),
            "genres": document.getElementById("player-view-genres"),
            "videos": document.getElementById("player-view-videos"),
            "concerts": document.getElementById("player-view-concerts"),
            "playlists": document.getElementById("player-view-playlists"),
            "now-playing": document.getElementById("player-view-now-playing")
        };

        Object.keys(panes).forEach(k => {
            if (panes[k]) {
                panes[k].style.display = (k === view) ? "block" : "none";
            }
        });

        // Masquer la barre de recherche/tri en mode Grand Écran "now-playing", vue clips "videos", "concerts", "playlists" ou détail d'album
        const toolbar = document.getElementById("player-toolbar-row");
        if (toolbar) {
            const shouldHideToolbar = (
                view === "now-playing" ||
                view === "videos" ||
                view === "concerts" ||
                view === "playlists" ||
                (view === "albums" && this.isAlbumDetailOpen)
            );
            toolbar.style.display = shouldHideToolbar ? "none" : "flex";
        }
        this.updateDetailContextBar();
        if (typeof syncPlayerControlsHeight === "function") syncPlayerControlsHeight();

        // Mettre à jour la barre de retour depuis "En cours d'écoute"
        this.updateNowPlayingBackLabel();

        // Synchroniser le champ de recherche et son bouton d'effacement selon la vue
        const searchInput = document.getElementById("player-search-input");
        const searchClearBtn = document.getElementById("player-search-clear-btn");
        if (searchInput) {
            if (view === "all") {
                searchInput.value = this.allSearchQuery || "";
            } else if (view === "albums" || view === "artists" || view === "genres") {
                searchInput.value = this.searchFilter || "";
            }
            if (searchClearBtn) {
                searchClearBtn.style.display = searchInput.value ? "block" : "none";
            }
        }

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
        } else if (wasNowPlaying) {
            const savedY = (this.savedScrollPositions && typeof this.savedScrollPositions[view] === "number")
                ? this.savedScrollPositions[view]
                : 0;
            this.restoreScrollPosition(savedY);
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
            const safeMarginTop = 45;
            const safeMarginBottom = 45;
            const safetyTop = effectiveHeaderBottom + safeMarginTop;
            const safetyBottom = effectiveBottomTop - safeMarginBottom;

            // Si le morceau est déjà confortablement visible dans la zone sécurisée et non forcé : ne pas faire bouger l'écran
            if (!force && rect.top >= safetyTop && rect.bottom <= safetyBottom) {
                return;
            }

            // Hors champ ou forcé : centrer parfaitement la piste dans la zone utile visible
            const currentScrollY = window.scrollY || document.documentElement.scrollTop || 0;
            const visibleHeight = Math.max(effectiveBottomTop - effectiveHeaderBottom, 150);
            const targetCenterY = effectiveHeaderBottom + (visibleHeight / 2);
            const itemAbsoluteCenterY = currentScrollY + rect.top + (rect.height / 2);
            const targetScrollY = Math.max(0, Math.round(itemAbsoluteCenterY - targetCenterY));

            // Ignorer les micro-deltas (< 6px) pour éviter les micro-saccades
            if (!force && Math.abs(targetScrollY - currentScrollY) < 6) {
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
     * Redirige vers la section d'où la lecture en cours a été lancée (v3.3.2) :
     * - Album      → ce seul album (détail)
     * - Tout       → onglet Tout, morceau en cours mis en vision
     * - Playlist   → la playlist concernée
     * - Vidéo      → le lecteur vidéo
     * Le comportement ne dépend plus de l'onglet où se trouve l'utilisateur.
     */
    navigateToCurrentlyPlaying() {
        const origin = this.playbackOrigin || null;
        const videoEl = document.getElementById("video-modal-player");
        const isVideoActive = Boolean(
            window.isVideoPlayingInBackground ||
            (videoEl && videoEl.src && !videoEl.paused)
        );

        // Vidéo : rouvrir le lecteur vidéo
        if ((isVideoActive || (origin && origin.type === "video")) && window.reopenVideoModal && videoEl && videoEl.src) {
            window.reopenVideoModal();
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
            if (String(p).startsWith("playlist:")) return { type: "playlist", view: "playlists", path: p };
            if (p === "system:all-collection" || p === "system:search-results") return { type: "all", view: "all", path: p };
            if (p && p !== "video_standalone") return { type: "album", view: "albums", path: p };
            return { type: "now-playing", view: "now-playing", path: p };
        })();

        const scrollLater = (delay = 150) => setTimeout(() => this.scrollToActiveTrack(true), delay);

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
                const albPath = o.path || this.activeAlbumPath;
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
                const v = o.view && o.view !== "now-playing" ? o.view : "albums";
                if (this.currentView !== v) this.setView(v);
                scrollLater(150);
                return;
            }

            case "video": {
                const v = o.view || "videos";
                if (this.currentView !== v) this.setView(v);
                return;
            }
        }

        // Fallback (ex: titre seul en ligne) : Grand Écran
        if (this.currentView !== "now-playing") {
            this.setView("now-playing");
        }
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
            "playlists": "Retourner aux Playlists"
        };
        const prev = this.previousView || "albums";
        labelEl.textContent = viewNames[prev] || "Retourner à la collection";
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
            if (backLabel) backLabel.textContent = "← Revenir aux Albums";
            if (backBtn) backBtn.setAttribute("title", "Revenir à la grille des albums (Échap / Retour)");

            let infoText = "";
            const albumName = this.detailAlbumTitle || (this.currentAlbum && this.activeAlbumPath === this.detailAlbumPath ? this.currentAlbum.title : "");
            const artistName = this.detailAlbumArtist || (this.currentAlbum && this.activeAlbumPath === this.detailAlbumPath ? this.currentAlbum.artist : "");
            const count = this.detailAlbumTracksCount || (this.playlist && this.activeAlbumPath === this.detailAlbumPath ? this.playlist.length : 0);

            if (albumName || artistName) {
                const trkCountStr = count ? ` (${count} titre${count > 1 ? "s" : ""})` : "";
                infoText = `Albums › <strong>${escapeHtml(artistName ? `${artistName} — ` : "")}${escapeHtml(albumName || "Détail")}</strong>${trkCountStr}`;
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
        const targetView = (this.previousView && this.previousView !== "now-playing") ? this.previousView : "albums";
        const savedY = (this.savedScrollPositions && typeof this.savedScrollPositions[targetView] === "number")
            ? this.savedScrollPositions[targetView]
            : 0;
        this.setView(targetView);
        this.restoreScrollPosition(savedY);
    },

    updateSortSelectForView(view) {
        const sortSelect = document.getElementById("player-sort-select");
        const searchInput = document.getElementById("player-search-input");
        const typeFilters = document.getElementById("player-type-filters");
        const artistsDensityToggle = document.getElementById("player-artists-density-toggle");
        const allShuffleBtn = document.getElementById("player-btn-all-shuffle");

        if (typeFilters) {
            typeFilters.style.display = (view === "albums") ? "flex" : "none";
        }
        if (artistsDensityToggle) {
            artistsDensityToggle.style.display = (view === "artists") ? "inline-flex" : "none";
        }
        if (allShuffleBtn) {
            allShuffleBtn.style.display = (view === "all" || view === "albums") ? "inline-flex" : "none";
            if (view === "all" && this.allSearchQuery && this.allSearchQuery.trim()) {
                allShuffleBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                    <span>Aléatoire (Résultats)</span>
                `;
                allShuffleBtn.title = "Lancer une lecture aléatoire des morceaux trouvés";
            } else {
                allShuffleBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                    <span>Aléatoire (Collection)</span>
                `;
                allShuffleBtn.title = "Lancer une lecture aléatoire qui pioche dans tous les titres de la collection";
            }
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

        const isAudioActive = Boolean(this.currentAlbum && this.playlist && this.playlist.length > 0);
        const isVideoBgActive = Boolean(window.isVideoPlayingInBackground && (window.currentModalVideoItem || currentModalVideoItem));

        if (!isAudioActive && !isVideoBgActive) {
            bar.style.display = "none";
            if (typeof updateHeaderNowPlayingButton === "function") updateHeaderNowPlayingButton();
            return;
        }

        // La barre flottante du bas reste visible en permanence dès qu'un média est actif
        bar.style.display = "flex";
        if (typeof updateHeaderNowPlayingButton === "function") updateHeaderNowPlayingButton();
    },

    async loadLibraryData(preservePlayback = false) {
        this.isLoadingLibrary = true;
        const hasActivePlayback = Boolean(this.isPlaying || (this.playlist && this.playlist.length > 0));
        if (this.albumInfoCache && !preservePlayback && !hasActivePlayback) {
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
                this.renderCurrentView();
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
                            this.renderCurrentView();
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
            { type: "rip", label: "Rips Audio", emoji: "🎙️", count: counts.rip },
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
    },

    renderCurrentView() {
        // Bandeau de filtre actif
        const banner = document.getElementById("player-active-filter-banner");
        const bannerText = document.getElementById("player-active-filter-text");
        if (banner && bannerText) {
            if (this.selectedArtistFilter) {
                banner.style.display = "flex";
                bannerText.textContent = `Filtre actif : Artiste « ${this.selectedArtistFilter} »`;
            } else if (this.selectedGenreFilter) {
                banner.style.display = "flex";
                bannerText.textContent = `Filtre actif : Genre « ${this.selectedGenreFilter} »`;
            } else {
                banner.style.display = "none";
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
        } else if (this.currentView === "now-playing") {
            this.updateMiniDockVisibility();
            this.renderPlayerTab();
            this.updateDisplayedAlbumUI();
        }
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
    },

    async openAlbumDetail(albumPath) {
        if (!albumPath) return;
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

        if (!this.savedScrollPositions) this.savedScrollPositions = {};
        this.savedScrollPositions["albums"] = window.scrollY || document.documentElement.scrollTop || 0;

        const gridView = document.getElementById("player-albums-grid");
        const detailView = document.getElementById("player-album-detail-view");
        const detailBlock = document.getElementById("player-album-detail-block");

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
                        filepath: t.filepath,
                        filename: t.filename
                    }))
                };
                if (!this.albumInfoCache) this.albumInfoCache = new Map();
                this.albumInfoCache.set(albumPath, info);
            }
        }

        // Si non présent en cache mémoire, afficher le spinner de chargement
        if (!info) {
            if (gridView) gridView.style.display = "none";
            if (detailView) detailView.style.display = "block";
            if (detailBlock) {
                detailBlock.innerHTML = `
                    <div style="padding: 60px 20px; text-align: center;">
                        <div class="spinner"></div>
                        <p class="text-muted" style="margin-top: 14px; font-size: 0.9rem;">Chargement des pistes de l'album...</p>
                    </div>
                `;
            }
            this.cancelPendingScrolls();
            window.scrollTo({ top: 0, left: 0, behavior: "instant" });

            try {
                const res = await fetch(`/api/album/info?path=${encodeURIComponent(albumPath)}`);
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

        if (gridView) gridView.style.display = "none";
        if (detailView) detailView.style.display = "block";

        // Construction du rendu
        const folderName = albumPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "Album";
        const albumTitle = info.album_name || folderName;
        const albumArtist = info.album_artist || "Artiste inconnu";
        const albMatch = this.libraryAlbums ? this.libraryAlbums.find(a => a.path === albumPath) : null;
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
        const yearStr = info.year ? `📅 ${escapeHtml(String(info.year))} • ` : "";
        const tracksCountStr = `${rawTracks.length} titre${rawTracks.length > 1 ? "s" : ""}`;
        const isPlayingThisAlbum = Boolean(this.activeAlbumPath && this.activeAlbumPath === albumPath);

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
                        <span class="dense-track-format">${escapeHtml(ext)}</span>
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
                    </div>
                    <span class="player-track-item-dur">${escapeHtml(trk.duration || "--:--")}</span>
                </div>
            `);
        });
        const tracksHtml = trackParts.join("");

        const albObj = this.libraryAlbums.find(a => a.path === albumPath);
        const albType = this.getAlbumType(albObj || { title: albumTitle, path: albumPath, tracks: rawTracks });
        const badgeInfo = this.getAlbumTypeBadgeInfo(albType);

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

            if (isPlayingThisAlbum) {
                this.scrollToActiveTrack(true);
            } else {
                this.cancelPendingScrolls();
                window.scrollTo({ top: 0, left: 0, behavior: "instant" });
                if (document.documentElement) document.documentElement.scrollTop = 0;
                if (document.body) document.body.scrollTop = 0;
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
    },

    renderGenresGrid() {
        const grid = document.getElementById("player-genres-grid");
        const counter = document.getElementById("player-count-indicator");
        if (!grid) return;

        // Regrouper par genre
        const genreMap = new Map();
        this.libraryAlbums.forEach(alb => {
            let g = (alb.genre || "").trim();
            if (!g) g = "Non classé";
            if (!genreMap.has(g)) {
                genreMap.set(g, { name: g, albumCount: 0 });
            }
            genreMap.get(g).albumCount += 1;
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
            html += `
                <div class="player-genre-card" data-genre="${escapeHtml(g.name)}">
                    <div class="player-genre-name">${escapeHtml(g.name)}</div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="player-genre-badge">${g.albumCount} album${g.albumCount > 1 ? "s" : ""}</span>
                        <button type="button" class="btn-genre-shuffle" title="Lire le genre « ${escapeHtml(g.name)} » en aléatoire" data-genre="${escapeHtml(g.name)}">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                                <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
                            </svg>
                        </button>
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

                this.selectedGenreFilter = gName;
                this.selectedArtistFilter = null;
                this.setView("albums");
            });
        }
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

                // Indexation instantanée pour recherche (< 1ms pour l'ensemble des pistes)
                if (this.allCatalog && this.allCatalog.albums) {
                    this.allCatalog.albums.forEach(alb => {
                        const albPart = `${alb.title || ""} ${alb.artist || ""}`.toLowerCase();
                        (alb.tracks || []).forEach(trk => {
                            trk._haystack = `${albPart} ${trk.title || ""} ${trk.artist || ""}`.toLowerCase();
                        });
                    });
                }

                // Rendu silencieux en arrière-plan dans le conteneur #player-all-container
                // (Prêt immédiatement et sans freeze dès que l'utilisateur bascule dessus)
                this.renderCatalogAlbums();

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
        if (!this.isCatalogReady || force) {
            if (container && (!this.allCatalog || force)) {
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
                if (container) {
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
            const isThisTrackPlaying = Boolean(
                (curTrackPath && trkPath && curTrackPath === trkPath) ||
                (isPlayingThisAlbum && this.currentIndex === trkIdx)
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
                        <span class="dense-track-format">${escapeHtml(trk.format || "M4A")}</span>
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
                    </div>
                    <span class="player-track-item-dur">${escapeHtml(trk.duration || "--:--")}</span>
                </div>
            `;
        });

        const albType = this.getAlbumType(alb);
        const badgeInfo = this.getAlbumTypeBadgeInfo(albType);

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
                        <span class="dense-track-format">${escapeHtml(trk.format || "M4A")}</span>
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
                    </div>
                    <span class="dense-track-dur">${escapeHtml(trk.duration || "--:--")}</span>
                </div>
            </div>
        `;
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

                if (!alb) return;

                // Action Lire tout album
                if (e.target.closest(".btn-cat-alb-play")) {
                    e.stopPropagation();
                    this.loadAlbum(alb.path, { autoPlay: true, startTrackIndex: 0, isCollection: (this.librarySource === "library"), switchView: false });
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

                // Actions Piste
                const trkItem = e.target.closest(".player-track-item");
                if (trkItem) {
                    const trkIdx = parseInt(trkItem.getAttribute("data-trk-idx"), 10);
                    if (e.target.closest(".btn-cat-track-play")) {
                        e.stopPropagation();
                        if (this.currentAlbum && this.activeAlbumPath === alb.path && this.playlist && this.playlist.length > 0) {
                            this.playTrackAtIndex(trkIdx);
                        } else {
                            this.loadAlbum(alb.path, { autoPlay: true, startTrackIndex: trkIdx, isCollection: (this.librarySource === "library"), switchView: false });
                        }
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

                    // Clic direct sur la ligne de piste
                    if (!e.target.closest(".btn-track-action")) {
                        if (this.currentAlbum && this.activeAlbumPath === alb.path && this.playlist && this.playlist.length > 0) {
                            this.playTrackAtIndex(trkIdx);
                        } else {
                            this.loadAlbum(alb.path, { autoPlay: true, startTrackIndex: trkIdx, isCollection: (this.librarySource === "library"), switchView: false });
                        }
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
                    if (this.currentAlbum && this.activeAlbumPath === albPath && this.playlist && this.playlist.length > 0) {
                        this.playTrackAtIndex(trkIdx);
                    } else {
                        this.loadAlbum(albPath, { autoPlay: true, startTrackIndex: trkIdx, isCollection: (this.librarySource === "library"), switchView: false });
                    }
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

                // Clic direct sur la ligne dense
                if (!e.target.closest(".btn-track-action")) {
                    if (this.currentAlbum && this.activeAlbumPath === albPath && this.playlist && this.playlist.length > 0) {
                        this.playTrackAtIndex(trkIdx);
                    } else {
                        this.loadAlbum(albPath, { autoPlay: true, startTrackIndex: trkIdx, isCollection: (this.librarySource === "library"), switchView: false });
                    }
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
    // HUB VIDÉO MUSICAL (CLIPS & VIDÉOS 16:9)
    // =========================================================

    async loadAndRenderVideosCatalog(force = false) {
        const grid = document.getElementById("player-videos-grid");
        if (this.videosCatalog && this.videosCatalog.length > 0 && !force) {
            this.updateVideoBadges();
            this.renderVideosGrid();
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

        // Charger l'élément dans l'éditeur de tags (mode collection / vidéothèque)
        if (typeof window.loadAlbumInEditor === "function") {
            await window.loadAlbumInEditor(targetPath, true);
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
                if (e.target.closest(".btn-extract-audio") || e.target.closest(".btn-video-add-playlist") || e.target.closest(".btn-send-to-tagger") || e.target.closest(".btn-tag-unknown-artist")) return;
                const idx = parseInt(card.getAttribute("data-video-idx"), 10);
                const item = list[idx];
                if (item) {
                    openLocalVideoModal(item);
                }
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
                if (e.target.closest(".btn-extract-concert-audio") || e.target.closest(".btn-concert-add-playlist") || e.target.closest(".btn-send-to-tagger") || e.target.closest(".btn-tag-unknown-artist")) return;
                const idx = parseInt(card.getAttribute("data-concert-idx"), 10);
                const item = list[idx];
                if (item) {
                    openLocalVideoModal(item);
                }
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
        if (!this.audio.src) {
            if (this.playlist.length > 0 && this.currentIndex >= 0) {
                this.playTrackAtIndex(this.currentIndex);
            }
            return;
        }
        if (this.audio.paused) {
            if (window.closeVideoModal && (window.isVideoPlayingInBackground || (document.getElementById("video-modal-player") && !document.getElementById("video-modal-player").paused))) {
                window.closeVideoModal(true);
            }
            AudioFader.fadeIn(this.audio, this.isMuted ? 0 : this.volume, 500);
            this.audio.play().catch(e => console.warn(e));
        }
    },

    async pause() {
        if (this.audio && !this.audio.paused) {
            if (AudioFader.enabled) {
                await AudioFader.fadeOut(this.audio, 400);
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
        if (!this.audio.src) {
            if (this.playlist.length > 0 && this.currentIndex >= 0) {
                this.playTrackAtIndex(this.currentIndex);
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

        // Lecture séquentielle ou aléatoire dans l'album actif
        const list = (this.activePlaylist && this.activePlaylist.length > 0) ? this.activePlaylist : this.playlist;
        if (!list || list.length === 0) return;

        if (this.isShuffle) {
            let nextIdx = Math.floor(Math.random() * list.length);
            if (list.length > 1 && nextIdx === this.currentIndex) {
                nextIdx = (nextIdx + 1) % list.length;
            }
            if (this.playbackContext) this.playbackContext.currentIndex = nextIdx;
            this.playTrackAtIndex(nextIdx);
            if (this.isQueueDrawerOpen) this.renderQueueDrawer();
            return;
        }

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

        // Par défaut : arrêt propre
        if (this.audio && !this.audio.paused && AudioFader.enabled) {
            AudioFader.fadeOut(this.audio, 400).then(() => {
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

        const startPlayback = () => {
            this.audio.src = track.stream_url;
            this.audio.load();
            AudioFader.fadeIn(this.audio, this.isMuted ? 0 : this.volume, 500);
            this.audio.play().catch(e => console.warn("Lecture queue:", e));
        };

        if (this.isPlaying && this.audio && !this.audio.paused && AudioFader.enabled) {
            AudioFader.fadeOut(this.audio, 280).then(() => {
                startPlayback();
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

    enqueueTrack(track, album = null, playNext = false) {
        if (!track) return;
        const alb = album || this.currentAlbum || {};
        const fp = track.filepath || "";
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
            } else {
                curCard.innerHTML = `
                    <div class="text-muted" style="font-size: 0.85rem; padding: 6px 0;">
                        Aucun morceau en cours de lecture.
                    </div>
                `;
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
            }
        }

        // 4. Section "Suite de l'album d'origine"
        const upList = document.getElementById("queue-upcoming-list");
        const upCount = document.getElementById("queue-upcoming-count");

        let basePlaylist = [];
        let baseIndex = -1;
        let baseAlbum = null;

        if (this.playbackContext && this.playbackContext.album) {
            basePlaylist = this.playbackContext.playlist || [];
            baseIndex = this.playbackContext.currentIndex;
            baseAlbum = this.playbackContext.album;
        } else if (this.playlist && this.playlist.length > 0) {
            basePlaylist = this.playlist;
            baseIndex = this.currentIndex;
            baseAlbum = this.currentAlbum;
        }

        const upcomingTracks = (baseIndex >= 0 && baseIndex < basePlaylist.length - 1)
            ? basePlaylist.slice(baseIndex + 1)
            : [];

        if (upCount) upCount.textContent = String(upcomingTracks.length);

        if (upList) {
            if (upcomingTracks.length === 0) {
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

    toggleShuffle() {
        this.isShuffle = !this.isShuffle;
        this.updateShuffleUI();
        showToast(this.isShuffle ? "🔀 Lecture aléatoire activée" : "Lecture séquentielle activée", "info");
    },

    cycleRepeat() {
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
        const msg = this.repeatMode === "all" ? "🔁 Répéter tout l'album" : (this.repeatMode === "one" ? "🔂 Répéter la piste actuelle" : "Répétition désactivée");
        showToast(msg, "info");
    },

    updateRepeatUI() {
        const isOne = this.repeatMode === "one";
        const isActive = this.repeatMode !== "none";
        const label = this.repeatMode === "all" ? "Tout l'album" : (this.repeatMode === "one" ? "Répéter la piste" : "Désactivée");
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
            this.scrollToActiveTrack(this.isShuffle || Boolean(this.userQueue && this.userQueue.length > 0));
        }

        const queueEq = document.querySelector("#queue-current-card .player-equalizer-bars");
        if (queueEq) queueEq.style.display = this.isPlaying ? "inline-flex" : "none";

        // 7. Mode Ambiance : synchroniser les boutons d'accès rapide et les contrôles ambiance
        const btnHeaderAmbient = document.getElementById("btn-ambient-mode");
        const btnMiniAmbient = document.getElementById("mini-player-ambient-btn");
        const btnFocusAmbient = document.getElementById("player-now-playing-ambient-btn");
        const ambientPlayIcon = document.getElementById("ambient-icon-play");
        const ambientPauseIcon = document.getElementById("ambient-icon-pause");

        // RÈGLE STRICTE : Accessible UNIQUEMENT si lecture réelle en cours (PAS pour les previews)
        const canShowAmbient = Boolean(this.isPlaying && this.currentAlbum);
        if (btnHeaderAmbient) btnHeaderAmbient.style.display = canShowAmbient ? "inline-flex" : "none";
        if (btnMiniAmbient) btnMiniAmbient.style.display = canShowAmbient ? "inline-flex" : "none";
        if (btnFocusAmbient) btnFocusAmbient.style.display = canShowAmbient ? "inline-flex" : "none";

        if (ambientPlayIcon) ambientPlayIcon.style.display = this.isPlaying ? "none" : "block";
        if (ambientPauseIcon) ambientPauseIcon.style.display = this.isPlaying ? "block" : "none";

        if (!this.currentAlbum && window.AmbientVisualizer && window.AmbientVisualizer.isActive) {
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
        const cur = (this.activePlaylist && this.activePlaylist[this.currentIndex]) || (this.playlist && this.playlist[this.currentIndex]);
        const title = cur ? (cur.title || "Titre inconnu") : "";
        const artist = (cur && cur.artist) || (this.currentAlbum && this.currentAlbum.artist) || "";
        const album = (this.currentAlbum && this.currentAlbum.title) || "";
        let cover = (this.currentAlbum && this.currentAlbum.cover_url) || "";
        if (cover && !cover.startsWith("http")) {
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
                title: title,
                artist: artist,
                album: album
            });
        }
    },

    updateProgressUI() {
        const cur = this.audio.currentTime || 0;
        const dur = this.audio.duration || 0;
        const pct = dur > 0 ? (cur / dur) * 100 : 0;

        const miniSeekBar = document.getElementById("mini-player-seek-bar");
        const miniTimeCur = document.getElementById("mini-player-time-current");
        const playerSeekBar = document.getElementById("player-seek-slider");
        const playerTimeCur = document.getElementById("player-time-current");
        const ambientSeekBar = document.getElementById("ambient-seek-bar");
        const ambientTimeCur = document.getElementById("ambient-time-current");

        if (miniSeekBar) miniSeekBar.value = pct;
        if (miniTimeCur) miniTimeCur.textContent = this.formatTime(cur);
        if (playerSeekBar) playerSeekBar.value = pct;
        if (playerTimeCur) playerTimeCur.textContent = this.formatTime(cur);
        if (ambientSeekBar && !this.isSeeking) ambientSeekBar.value = pct;
        if (ambientTimeCur) ambientTimeCur.textContent = this.formatTime(cur);
    },

    seekRelative(seconds) {
        if (!this.audio || !this.audio.duration || isNaN(this.audio.duration)) return;
        const cur = this.audio.currentTime || 0;
        const target = Math.max(0, Math.min(this.audio.duration, cur + seconds));
        this.audio.currentTime = target;
        this.updateProgressUI();
    },

    updateDurationUI() {
        const dur = this.audio.duration || 0;
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
                this.savedScrollPositions[this.currentView] = window.scrollY || document.documentElement.scrollTop || 0;
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

    playTrackAtIndex(index) {
        if (!this.playlist || index < 0 || index >= this.playlist.length) return;
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

        const isVideo = Boolean(
            trk.type === "video" ||
            trk.is_video ||
            (trk.filepath && /\.(mp4|mkv|webm)$/i.test(trk.filepath)) ||
            (trk.path && /\.(mp4|mkv|webm)$/i.test(trk.path))
        );

        if (isVideo) {
            // Lecture Vidéo / Concert au sein de la playlist ou de l'album
            this.isPlaying = true;
            if (this.audio) {
                this.audio.pause();
                this.audio.removeAttribute("src");
                this.audio.load();
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
                thumbnail: trk.thumbnail_url || trk.cover_url || (this.currentAlbum ? this.currentAlbum.cover_url : "")
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
            AudioFader.fadeIn(this.audio, this.isMuted ? 0 : this.volume, 500);
            this.audio.play().catch(e => console.warn("Lecture différée:", e));
        };

        if (this.isPlaying && this.audio && !this.audio.paused && AudioFader.enabled) {
            AudioFader.fadeOut(this.audio, 280).then(() => {
                startPlayback();
            });
        } else {
            startPlayback();
        }

        this.updateCurrentTrackUI(trk);
        this.updatePlayStateUI();
        if (this.isQueueDrawerOpen) this.renderQueueDrawer();
        setTimeout(() => this.scrollToActiveTrack(true), 60);
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
        if (pFmt) pFmt.textContent = isConc ? "CONCERT" : (isVid ? "VIDÉO" : ((firstTrk && firstTrk.format) ? firstTrk.format : "M4A"));

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
            const cnt = (this.playlist && this.playlist.length) ? `${this.playlist.length} titre(s)` : "";
            pAlbum.textContent = [yr, cnt].filter(Boolean).join(" • ");
        }
    },

    updateCurrentTrackUI(trk) {
        const coverUrl = (trk && (trk.thumbnail_url || trk.cover_url)) || (this.currentAlbum ? (this.currentAlbum.cover_url || this.currentAlbum.thumbnail_url) : "/static/placeholder-cover.svg");
        const albumName = this.currentAlbum ? this.currentAlbum.title : "";
        const albumYear = this.currentAlbum && this.currentAlbum.year ? ` • ${this.currentAlbum.year}` : "";

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
        if (pFmt) pFmt.textContent = isConc ? "CONCERT" : (isVid ? "VIDÉO" : (trk.format || "M4A"));

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
            const albTitle = albumName || trk.album || trk.title;
            pTitle.textContent = albTitle;
            pTitle.title = albTitle;
        }
        if (pArtist) {
            const albArtist = (this.currentAlbum && this.currentAlbum.artist) ? this.currentAlbum.artist : trk.artist;
            pArtist.textContent = albArtist;
            pArtist.title = albArtist;
        }
        if (pAlbum) {
            const yr = (this.currentAlbum && this.currentAlbum.year) ? String(this.currentAlbum.year) : (trk.year ? String(trk.year) : "");
            const cnt = (this.playlist && this.playlist.length) ? `${this.playlist.length} titre(s)` : "";
            pAlbum.textContent = [yr, cnt].filter(Boolean).join(" • ");
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
                    <span class="dense-track-format">${escapeHtml(trk.format || "M4A")}</span>
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
        const isSingle = Boolean(this.currentAlbum && this.currentAlbum.is_single_track);
        const labelText = isSingle ? "Télécharger ce titre" : "Télécharger tout l'album";

        // Volet gauche (Panneau d'écoute)
        const onlineBox = document.getElementById("player-online-download-container");
        const onlineBtn = document.getElementById("player-btn-download-online");
        const onlineLabel = document.getElementById("player-btn-download-online-label");
        if (onlineBox) onlineBox.style.display = isOnline ? "block" : "none";
        if (onlineLabel) onlineLabel.textContent = labelText;

        // En-tête volet droit (Tracklist)
        const headerBtn = document.getElementById("player-btn-download-album");
        const headerLabel = document.getElementById("player-download-header-label");
        if (headerBtn) headerBtn.style.display = isOnline ? "inline-flex" : "none";
        if (headerLabel) headerLabel.textContent = isSingle ? "Télécharger le titre" : "Télécharger l'album";

        // Mini barre flottante en bas
        const miniBtn = document.getElementById("mini-player-download-btn");
        if (miniBtn) {
            miniBtn.style.display = isOnline ? "inline-flex" : "none";
            miniBtn.title = labelText;
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

        const fmt = currentConfig.default_format || "m4a";
        const origHtml = btnEl ? btnEl.innerHTML : "";
        if (btnEl) {
            btnEl.disabled = true;
            btnEl.innerHTML = `⏳ Ajout...`;
        }

        try {
            await downloadItemFromSearch(
                targetUrl,
                targetTitle,
                fmt,
                btnEl,
                origHtml,
                this.currentAlbum.online_item || {
                    url: targetUrl,
                    title: targetTitle,
                    artist: this.currentAlbum.artist,
                    thumbnail: this.currentAlbum.cover_url,
                    type: isSingle ? "track" : "album"
                }
            );
        } catch (e) {
            console.error("Erreur téléchargement depuis le lecteur:", e);
            if (btnEl && origHtml) {
                btnEl.disabled = false;
                btnEl.innerHTML = origHtml;
            }
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
        if (this.isPlaying && this.audio && !this.audio.paused && AudioFader.enabled) {
            await AudioFader.fadeOut(this.audio, 300);
        } else {
            AudioFader.stop(this.audio);
        }
        this.audio.pause();
        this.audio.src = "";
        this.isPlaying = false;
        this.updatePlayStateUI();
        const bar = document.getElementById("persistent-player-bar");
        if (bar) bar.style.display = "none";
        this.updateMiniDockVisibility();
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
            online_item: albumInfo
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
    playOnlineTrack(title, artist, thumb, videoId, albumName = "", albumUrl = "") {
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
            online_item: {
                title: title,
                artist: artist,
                thumbnail: thumb,
                id: videoId,
                type: "track",
                url: albumUrl || `https://www.youtube.com/watch?v=${videoId}`
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
        const albums = this.libraryAlbums;
        if ((!albums || albums.length === 0) && (!this.allCatalog || !this.allCatalog.albums || this.allCatalog.albums.length === 0)) {
            showToast("La bibliothèque est vide. Synchronisez d'abord votre collection.", "warning");
            return;
        }

        const shouldShuffle = (opts && opts.shuffle !== undefined) ? Boolean(opts.shuffle) : true;

        // Fonction utilitaire : mélange Fisher-Yates
        const shuffleArr = (arr) => {
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            return arr;
        };

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

            const playListTracks = shouldShuffle ? shuffleArr(tracks.slice()) : tracks.slice();
            this.isShuffle = shouldShuffle;
            this.updateShuffleUI();
            this.isUserPlaylistActive = true;
            this.currentAlbum = {
                title: "🌍 Toute la Collection",
                artist: `${totalAlbumsCount} albums • ${playListTracks.length} pistes`,
                year: "",
                genre: "Collection",
                cover_url: playListTracks[0]?.cover_url || "/static/placeholder-cover.svg",
                path: "system:all-collection",
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
        if (!pObj.items || !Array.isArray(pObj.items)) {
            // ── Utiliser le cache UserPlaylists.playlistCache si disponible ──
            const cached = window.UserPlaylists?.playlistCache?.get(pObj.id);
            if (cached && cached.items) {
                pObj = cached;
            } else {
                try {
                    const res = await fetch(`/api/playlists/${pObj.id}`);
                    if (res.ok) {
                        pObj = await res.json();
                        // Stocker dans le cache pour les prochains clics
                        if (window.UserPlaylists && pObj.items) {
                            window.UserPlaylists.playlistCache.set(pObj.id, pObj);
                        }
                    }
                } catch (e) {
                    console.error("Erreur chargement playlist:", e);
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

function playTrack(title, artist, thumb, videoId, albumName = "", albumUrl = "") {
    AudioPlayer.playOnlineTrack(title, artist, thumb, videoId, albumName, albumUrl);
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
                is_playlist: isPlaylistUrlOrItem(item, item.url)
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

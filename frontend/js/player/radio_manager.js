// =========================================================
// TABLEAU MONDIAL DES PAYS POUR LES RADIOS WEB
// =========================================================
const WORLD_COUNTRIES = [
    { code: "FR", name: "France", flag: "🇫🇷" },
    { code: "BE", name: "Belgique", flag: "🇧🇪" },
    { code: "CH", name: "Suisse", flag: "🇨🇭" },
    { code: "CA", name: "Canada", flag: "🇨🇦" },
    { code: "GB", name: "Royaume-Uni", flag: "🇬🇧" },
    { code: "US", name: "États-Unis", flag: "🇺🇸" },
    { code: "DE", name: "Allemagne", flag: "🇩🇪" },
    { code: "IT", name: "Italie", flag: "🇮🇹" },
    { code: "ES", name: "Espagne", flag: "🇪🇸" },
    { code: "PT", name: "Portugal", flag: "🇵🇹" },
    { code: "NL", name: "Pays-Bas", flag: "🇳🇱" },
    { code: "IE", name: "Irlande", flag: "🇮🇪" },
    { code: "AT", name: "Autriche", flag: "🇦🇹" },
    { code: "SE", name: "Suède", flag: "🇸🇪" },
    { code: "NO", name: "Norvège", flag: "🇳🇴" },
    { code: "DK", name: "Danemark", flag: "🇩🇰" },
    { code: "FI", name: "Finlande", flag: "🇫🇮" },
    { code: "PL", name: "Pologne", flag: "🇵🇱" },
    { code: "GR", name: "Grèce", flag: "🇬🇷" },
    { code: "TR", name: "Turquie", flag: "🇹🇷" },
    { code: "JP", name: "Japon", flag: "🇯🇵" },
    { code: "KR", name: "Corée du Sud", flag: "🇰🇷" },
    { code: "AU", name: "Australie", flag: "🇦🇺" },
    { code: "NZ", name: "Nouvelle-Zélande", flag: "🇳🇿" },
    { code: "BR", name: "Brésil", flag: "🇧🇷" },
    { code: "AR", name: "Argentine", flag: "🇦🇷" },
    { code: "MX", name: "Mexique", flag: "🇲🇽" },
    { code: "CO", name: "Colombie", flag: "🇨🇴" },
    { code: "CL", name: "Chili", flag: "🇨🇱" },
    { code: "MA", name: "Maroc", flag: "🇲🇦" },
    { code: "DZ", name: "Algérie", flag: "🇩🇿" },
    { code: "TN", name: "Tunisie", flag: "🇹🇳" },
    { code: "SN", name: "Sénégal", flag: "🇸🇳" },
    { code: "CI", name: "Côte d'Ivoire", flag: "🇨🇮" },
    { code: "LB", name: "Liban", flag: "🇱🇧" },
    { code: "IL", name: "Israël", flag: "🇮🇱" },
    { code: "ZA", name: "Afrique du Sud", flag: "🇿🇦" },
    { code: "IN", name: "Inde", flag: "🇮🇳" },
    { code: "UA", name: "Ukraine", flag: "🇺🇦" },
    { code: "RO", name: "Roumanie", flag: "🇷🇴" }
];

// =========================================================
// SoundStash - Module Radios Web & Contrôle du Direct (Timeshifting)
// Catalogue mondial Radio Browser, favoris, ajout manuel & buffer de recul
// =========================================================

const RadioManager = {
    state: {
        currentStation: null,
        isPlaying: false,
        isLive: true,
        currentOffset: 0,         // 0 = direct, <0 = différé (secondes dans le passé)
        bufferSeconds: 0,
        maxBufferSeconds: 1800,   // 30 minutes
        nowPlaying: { artist: "", title: "", raw: "" },
        favorites: [],
        custom: [],
        browseResults: [],
        activeFilter: "favorites", // "favorites" | "top" | "country:FR" | "tag:rock" ...
        searchQuery: "",
        displayLimit: 40,
        activeGroup: null,
        activeGroupSearch: "",
        currentMasterGroup: null,
        isLoading: false,
        pollTimer: null,
        _searchDebounceTimer: null
    },

    async init() {
        console.log("[RadioManager] Initialisation du gestionnaire de radios web...");
        this.renderCountryPills();
        this.setupEventListeners();
        this.setupCountriesModal();
        this.setupBouquetModal();
        await this.loadLocalRadios();
    },

    async loadLocalRadios() {
        try {
            const resp = await fetch("/api/radio/list");
            if (resp.ok) {
                const data = await resp.json();
                this.state.favorites = data.favorites || [];
                this.state.custom = data.custom || [];
                this.updateRadiosBadge();
                if (this.state.activeFilter === "favorites") {
                    this.renderGrid();
                }
            }
        } catch (err) {
            console.warn("[RadioManager] Erreur chargement radios locales:", err);
        }
    },

    updateRadiosBadge() {
        const badge = document.getElementById("player-radios-count-badge");
        if (badge && (!window.AudioPlayer || !window.AudioPlayer.globalSearchQuery)) {
            badge.style.display = "none";
        }
    },

    setupEventListeners() {
        // Barre de sous-filtres des radios
        const pillsContainer = document.getElementById("radios-filter-pills");
        if (pillsContainer) {
            pillsContainer.addEventListener("click", (e) => {
                const pill = e.target.closest(".subfilter-pill");
                if (!pill) return;
                const filter = pill.getAttribute("data-radio-filter");
                if (!filter) return;

                pillsContainer.querySelectorAll(".subfilter-pill").forEach(p => p.classList.remove("active"));
                pill.classList.add("active");
                this.setFilter(filter);
            });
        }

        // Champ de recherche radio (synchronisé avec la recherche globale)
        const searchInput = document.getElementById("radios-search-input");
        const clearBtn = document.getElementById("radios-search-clear-btn");
        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                const val = e.target.value;
                if (clearBtn) clearBtn.style.display = val ? "flex" : "none";
                clearTimeout(this.state._searchDebounceTimer);
                this.state._searchDebounceTimer = setTimeout(() => {
                    this.handleSearch(val);
                    if (window.AudioPlayer && typeof window.AudioPlayer.setGlobalSearch === "function") {
                        window.AudioPlayer.setGlobalSearch(val, searchInput);
                    }
                }, 200);
            });
        }
        if (clearBtn && searchInput) {
            clearBtn.addEventListener("click", () => {
                searchInput.value = "";
                clearBtn.style.display = "none";
                this.handleSearch("");
                if (window.AudioPlayer && typeof window.AudioPlayer.clearGlobalSearch === "function") {
                    window.AudioPlayer.clearGlobalSearch();
                }
            });
        }

        // Bouton Ajouter une radio personnalisée
        const btnAddCustom = document.getElementById("btn-add-custom-radio");
        if (btnAddCustom) {
            btnAddCustom.addEventListener("click", () => this.openCustomRadioModal());
        }

        // Modale d'ajout manuel de radio
        const modalBackdrop = document.getElementById("custom-radio-modal-backdrop");
        const modalClose = document.getElementById("custom-radio-modal-close");
        const modalCancel = document.getElementById("custom-radio-modal-cancel");
        const modalForm = document.getElementById("custom-radio-form");
        const btnTest = document.getElementById("btn-custom-radio-test");

        if (modalClose) modalClose.addEventListener("click", () => this.closeCustomRadioModal());
        if (modalCancel) modalCancel.addEventListener("click", () => this.closeCustomRadioModal());
        if (modalBackdrop) {
            modalBackdrop.addEventListener("click", (e) => {
                if (e.target === modalBackdrop) this.closeCustomRadioModal();
            });
        }

        if (btnTest) {
            btnTest.addEventListener("click", () => this.testStreamUrl());
        }

        if (modalForm) {
            modalForm.addEventListener("submit", (e) => {
                e.preventDefault();
                this.saveCustomRadio();
            });
        }

        // Sélecteur déroulant de genres
        const genreSelect = document.getElementById("radios-genre-select");
        if (genreSelect) {
            genreSelect.addEventListener("change", (e) => {
                const val = e.target.value;
                if (val) {
                    this.setFilter(val);
                } else {
                    this.setFilter("top");
                }
            });
        }

        // Délégation d'événements sur la grille de radios
        const grid = document.getElementById("player-radios-grid");
        if (grid) {
            // Capture universelle des erreurs d'images pour bascule immédiate sur cover procédurale
            grid.addEventListener("error", (e) => {
                if (e.target && e.target.classList && e.target.classList.contains("radio-card-cover")) {
                    this.handleCoverError(e.target);
                }
            }, true);

            grid.addEventListener("click", (e) => {
                const card = e.target.closest(".radio-card");
                if (!card) return;
                const stationId = card.getAttribute("data-station-id");
                const station = this.findStationById(stationId);
                if (!station) return;

                // Action Clic sur un badge de tag (navigation directe)
                const tagChip = e.target.closest(".radio-tag-chip");
                if (tagChip) {
                    e.stopPropagation();
                    const tagVal = tagChip.getAttribute("data-tag");
                    if (tagVal) {
                        this.setFilter(`tag:${tagVal.trim()}`);
                    }
                    return;
                }

                // Action Clic sur le pays (navigation directe)
                const countryBadge = e.target.closest(".radio-meta-country");
                if (countryBadge) {
                    const cCode = countryBadge.getAttribute("data-country");
                    if (cCode) {
                        e.stopPropagation();
                        this.setFilter(`country:${cCode.trim()}`);
                        return;
                    }
                }

                // Action Favoris
                if (e.target.closest(".btn-radio-fav")) {
                    e.stopPropagation();
                    this.toggleFavorite(station);
                    return;
                }

                // Action Supprimer station personnalisée
                if (e.target.closest(".btn-radio-delete")) {
                    e.stopPropagation();
                    this.deleteCustomRadio(station);
                    return;
                }

                // Clic principal sur la carte ou bouton Play
                this.playStation(station);
            });
        }
    },

    setFilter(filter) {
        this.state.activeFilter = filter;

        // Synchroniser l'état actif des pilules
        const pills = document.querySelectorAll("#radios-filter-pills .subfilter-pill");
        pills.forEach(pill => {
            const pFilter = pill.getAttribute("data-radio-filter");
            if (pFilter === filter) {
                pill.classList.add("active");
            } else {
                pill.classList.remove("active");
            }
        });

        // Synchroniser le menu déroulant des genres
        const genreSelect = document.getElementById("radios-genre-select");
        if (genreSelect) {
            if (filter.startsWith("tag:")) {
                const matchOption = Array.from(genreSelect.options).find(opt => opt.value === filter);
                if (matchOption) {
                    genreSelect.value = filter;
                } else {
                    const cleanTag = filter.replace(/^tag:/, "");
                    let tempOpt = genreSelect.querySelector("option[data-temp='1']");
                    if (!tempOpt) {
                        tempOpt = document.createElement("option");
                        tempOpt.setAttribute("data-temp", "1");
                        genreSelect.appendChild(tempOpt);
                    }
                    tempOpt.value = filter;
                    tempOpt.textContent = `🏷️ ${cleanTag}`;
                    genreSelect.value = filter;
                }
            } else {
                genreSelect.value = "";
            }
        }

        const query = (this.state.searchQuery || "").trim();

        this.state.displayLimit = 40;

        if (filter === "favorites") {
            this.renderGrid();
        } else if (filter === "top") {
            const params = { limit: 40, group: 1 };
            if (query) params.name = query;
            this.fetchBrowseStations(params);
        } else if (filter.startsWith("country:")) {
            const code = filter.split(":")[1];
            // Pour les pays, on demande l'index complet (limit: 0) servi en cache local
            const params = { countrycode: code, limit: 0, group: 1 };
            if (query) params.name = query;
            this.fetchBrowseStations(params);
        } else if (filter.startsWith("tag:")) {
            const tag = filter.replace(/^tag:/, "").trim();
            const params = { tag: tag, limit: 40, group: 1 };
            if (query) params.name = query;
            this.fetchBrowseStations(params);
        }
    },

    handleSearch(query) {
        this.state.searchQuery = query || "";
        this.state.displayLimit = 40;
        const q = (query || "").trim();

        const searchInput = document.getElementById("radios-search-input");
        const clearBtn = document.getElementById("radios-search-clear-btn");
        if (searchInput && searchInput.value !== (query || "")) {
            searchInput.value = query || "";
        }
        if (clearBtn) clearBtn.style.display = q ? "flex" : "none";

        const filter = this.state.activeFilter || "top";
        if (filter === "favorites") {
            this.renderGrid();
            if (window.AudioPlayer && typeof window.AudioPlayer.updateSearchTabBadges === "function") {
                window.AudioPlayer.updateSearchTabBadges(q);
            }
        } else if (filter.startsWith("country:")) {
            // Si le catalogue complet du pays est déjà chargé en mémoire, filtrer localement à 60 FPS
            if (Array.isArray(this.state.browseResults) && this.state.browseResults.length > 50) {
                this.renderGrid();
                if (window.AudioPlayer && typeof window.AudioPlayer.updateSearchTabBadges === "function") {
                    window.AudioPlayer.updateSearchTabBadges(q);
                }
            } else {
                const code = filter.split(":")[1];
                const params = { countrycode: code, limit: 0, group: 1 };
                if (q) params.name = q;
                this.fetchBrowseStations(params);
            }
        } else if (filter.startsWith("tag:")) {
            const tag = filter.replace(/^tag:/, "").trim();
            const params = { tag: tag, limit: 40 };
            if (q) params.name = q;
            this.fetchBrowseStations(params);
        } else {
            const params = { limit: 40 };
            if (q) params.name = q;
            this.fetchBrowseStations(params);
        }
    },

    getSearchMatchCount(query) {
        if (!query) return 0;
        const q = (query || "").toLowerCase().trim();
        if (this.state.searchQuery && this.state.searchQuery.toLowerCase().trim() === q && Array.isArray(this.state.browseResults)) {
            return this.state.browseResults.length;
        }
        const seen = new Set();
        let count = 0;
        const allKnown = [
            ...(this.state.favorites || []),
            ...(DEFAULT_CURATED_STATIONS || []),
            ...(this.state.browseResults || [])
        ];
        for (const s of allKnown) {
            const id = s.id || s.stationuuid || s.url;
            if (seen.has(id)) continue;
            seen.add(id);
            const name = (s.name || "").toLowerCase();
            const tags = (s.tags || "").toLowerCase();
            const country = (s.country || "").toLowerCase();
            if (name.includes(q) || tags.includes(q) || country.includes(q)) {
                count++;
            }
        }
        return count;
    },

    focusStation(station) {
        if (!station) return;
        if (window.AudioPlayer && window.AudioPlayer.currentView !== "radios") {
            window.AudioPlayer.setView("radios");
        }

        const stId = station.id || station.stationuuid || station.url;
        const groupId = station.parent_group || (this.state.currentMasterGroup ? (this.state.currentMasterGroup.id || this.state.currentMasterGroup.name) : null);
        let card = document.querySelector(`.radio-card[data-station-id="${stId}"]`);
        if (!card && groupId) {
            card = document.querySelector(`.radio-card[data-station-id="${groupId}"]`);
        }

        if (!card) {
            // Si la station n'est pas dans la vue actuelle (ex: filtrée par un autre pays ou recherche),
            // l'injecter en tête de liste pour la rendre immédiatement visible
            if (!this.state.browseResults) this.state.browseResults = [];
            const idx = this.state.browseResults.findIndex(s => (s.id || s.stationuuid || s.url) === stId);
            if (idx === -1) {
                this.state.browseResults.unshift(station);
            }
            this.renderGrid();
            card = document.querySelector(`.radio-card[data-station-id="${stId}"]`);
        }

        if (card) {
            card.scrollIntoView({ behavior: "smooth", block: "center" });
            card.classList.remove("is-highlighted-pulse");
            void card.offsetWidth;
            card.classList.add("is-highlighted-pulse");
            setTimeout(() => card.classList.remove("is-highlighted-pulse"), 2500);
        }
        if (typeof showToast === "function") {
            showToast(`📻 ${station.name || "Station en direct"}`, "info", 1800);
        }
    },

    async fetchBrowseStations(params = {}) {
        this.state.isLoading = true;
        this.renderLoadingState(true);

        try {
            const q = new URLSearchParams(params).toString();
            const resp = await fetch(`/api/radio/browser/search?${q}`);
            if (resp.ok) {
                const data = await resp.json();
                this.state.browseResults = data.stations || [];
            } else {
                this.state.browseResults = [];
            }
        } catch (err) {
            console.warn("[RadioManager] Erreur requête Radio Browser:", err);
            this.state.browseResults = [];
        } finally {
            this.state.isLoading = false;
            this.renderLoadingState(false);
            this.renderGrid();
            if (window.AudioPlayer && typeof window.AudioPlayer.updateSearchTabBadges === "function") {
                window.AudioPlayer.updateSearchTabBadges(this.state.searchQuery);
            }
        }
    },

    renderLoadingState(loading) {
        const spinner = document.getElementById("radios-loading-spinner");
        if (spinner) spinner.style.display = loading ? "flex" : "none";
        const grid = document.getElementById("player-radios-grid");
        if (grid && loading) grid.style.opacity = "0.4";
        else if (grid) grid.style.opacity = "1";
    },

    findStationById(id) {
        if (!id) return null;
        let s = this.state.favorites.find(x => (x.id || x.stationuuid || x.url) === id);
        if (s) return s;
        s = this.state.browseResults.find(x => (x.id || x.stationuuid || x.url) === id);
        if (s) return s;
        for (const item of (this.state.browseResults || [])) {
            if (item.is_group && Array.isArray(item.variants)) {
                const sub = item.variants.find(v => (v.id || v.stationuuid || v.url) === id);
                if (sub) return sub;
            }
        }
        s = this.state.custom.find(x => x.id === id);
        return s || null;
    },

    isStationFavorite(station) {
        if (!station) return false;
        const stId = station.id || station.stationuuid || station.url;
        return this.state.favorites.some(f => (f.id || f.stationuuid || f.url) === stId);
    },

    render() {
        this.renderGrid();
    },

    handleCoverError(img) {
        if (!img) return;
        img.onerror = null; // Stoppe toute boucle de rappel
        const name = img.getAttribute("data-station-name") || "Radio";
        const tags = img.getAttribute("data-station-tags") || "";
        const country = img.getAttribute("data-station-country") || "";
        img.classList.add("is-procedural");
        img.src = this.getProceduralStationCover(name, tags, country);
    },

    getProceduralStationCover(name, tags = "", country = "") {
        const safeName = (name || "Radio").trim();
        const PALETTES = [
            ["#8b5cf6", "#ec4899", "#3b82f6"], // Ultra Violet
            ["#06b6d4", "#3b82f6", "#6366f1"], // Cyan Electric
            ["#f59e0b", "#ef4444", "#f97316"], // Sunset Blaze
            ["#10b981", "#06b6d4", "#14b8a6"], // Neon Emerald
            ["#6366f1", "#a855f7", "#ec4899"], // Cyberpunk Synth
            ["#ec4899", "#f97316", "#e11d48"], // Pink Flare
            ["#14b8a6", "#84cc16", "#10b981"], // Tropical Lime
            ["#f43f5e", "#8b5cf6", "#a855f7"], // Crimson Night
            ["#0284c7", "#6366f1", "#3b82f6"], // Deep Sapphire
            ["#d97706", "#b45309", "#f59e0b"], // Golden Amber
            ["#e11d48", "#f43f5e", "#be123c"], // Ruby Velvet
            ["#059669", "#10b981", "#047857"]  // Forest Jade
        ];

        let hash = 0;
        for (let i = 0; i < safeName.length; i++) {
            hash = ((hash << 5) - hash) + safeName.charCodeAt(i);
            hash |= 0;
        }
        const absHash = Math.abs(hash);
        const [c1, c2, c3] = PALETTES[absHash % PALETTES.length];

        // Extraction des initiales / monogramme
        let clean = safeName.replace(/[-_().]/g, " ");
        const stopWords = new Set(["radio", "fm", "the", "web", "stream", "official", "net", "com", "org", "live", "channel", "hits"]);
        const words = clean.split(/\s+/).filter(w => !stopWords.has(w.toLowerCase()));
        let initials = "";
        if (words.length >= 2) {
            initials = (words[0][0] + words[1][0]).toUpperCase();
        } else if (words.length === 1 && words[0].length >= 2) {
            initials = words[0].slice(0, 3).toUpperCase();
        } else {
            initials = safeName.slice(0, 3).toUpperCase();
        }

        const rawSub = (tags ? tags.split(",")[0].trim() : (country || "RADIO")).toUpperCase();
        const sub = rawSub.slice(0, 16);
        const freq = (88.0 + (absHash % 200) / 10).toFixed(1);

        // Spectre égaliseur d'arrière-plan
        const eqBars = [];
        const barCount = 13;
        for (let b = 0; b < barCount; b++) {
            const barH = 10 + ((absHash + (b * 19)) % 32);
            const bx = 160 - ((barCount * 10) / 2) + (b * 10);
            const by = 145 - barH;
            eqBars.push(`<rect x="${bx}" y="${by}" width="4" height="${barH}" rx="2" fill="${c1}" opacity="${0.18 + ((b % 3) * 0.08)}"/>`);
        }

        const escapeXml = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200">
  <defs>
    <linearGradient id="bg_${absHash}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#141523"/>
      <stop offset="60%" stop-color="#181827"/>
      <stop offset="100%" stop-color="#1e1e2f"/>
    </linearGradient>
    <linearGradient id="g_${absHash}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
    <radialGradient id="glow_${absHash}" cx="50%" cy="48%" r="65%">
      <stop offset="0%" stop-color="${c1}" stop-opacity="0.32"/>
      <stop offset="60%" stop-color="${c2}" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow_${absHash}" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="${c1}" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect width="320" height="200" fill="url(#bg_${absHash})"/>
  <rect width="320" height="200" fill="url(#glow_${absHash})"/>
  <rect x="8" y="8" width="304" height="184" rx="12" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
  ${eqBars.join("\n  ")}
  <rect x="20" y="20" width="76" height="20" rx="10" fill="rgba(0,0,0,0.48)" stroke="rgba(255,255,255,0.09)" stroke-width="1"/>
  <circle cx="31" cy="30" r="3.5" fill="${c2}"/>
  <text x="42" y="34" font-family="system-ui, -apple-system, sans-serif" font-size="9.5" font-weight="700" fill="#cdd6f4" letter-spacing="0.4">${freq} FM</text>
  <path d="M282 25 A8 8 0 0 1 282 37" fill="none" stroke="${c1}" stroke-width="1.8" stroke-linecap="round" opacity="0.6"/>
  <path d="M287 21 A14 14 0 0 1 287 41" fill="none" stroke="${c2}" stroke-width="1.8" stroke-linecap="round" opacity="0.4"/>
  <path d="M292 17 A20 20 0 0 1 292 45" fill="none" stroke="${c3}" stroke-width="1.8" stroke-linecap="round" opacity="0.25"/>
  <circle cx="276" cy="31" r="2.5" fill="${c1}"/>
  <circle cx="160" cy="94" r="39" fill="url(#g_${absHash})" filter="url(#shadow_${absHash})"/>
  <circle cx="160" cy="94" r="39" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.5"/>
  <circle cx="160" cy="94" r="33" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
  <text x="160" y="102" font-family="system-ui, -apple-system, sans-serif" font-weight="900" font-size="22" fill="#ffffff" text-anchor="middle" dominant-baseline="middle" letter-spacing="1">${escapeXml(initials)}</text>
  <rect x="60" y="156" width="200" height="22" rx="11" fill="rgba(0,0,0,0.52)" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
  <text x="160" y="171" font-family="system-ui, -apple-system, sans-serif" font-weight="700" font-size="9" fill="rgba(255,255,255,0.92)" text-anchor="middle" dominant-baseline="middle" letter-spacing="0.8">${escapeXml(sub)}</text>
</svg>`;

        try {
            if (typeof window !== "undefined" && typeof window.btoa === "function") {
                return "data:image/svg+xml;base64," + window.btoa(unescape(encodeURIComponent(svg)));
            }
        } catch (e) {
            // Repli en cas d'erreur de conversion
        }
        return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
    },

    renderGrid() {
        const grid = document.getElementById("player-radios-grid");
        const emptyState = document.getElementById("radios-empty-state");
        if (!grid) return;

        let list = [];
        if (this.state.activeFilter === "favorites") {
            list = this.state.favorites.slice();
        } else {
            list = (this.state.browseResults || []).slice();
        }

        if (this.state.searchQuery) {
            const q = this.state.searchQuery.toLowerCase().trim();
            list = list.filter(s => {
                const name = (s.name || "").toLowerCase();
                const tags = (s.tags || "").toLowerCase();
                const country = (s.country || "").toLowerCase();
                const brand = (s.parent_brand || "").toLowerCase();
                const sub = (s.sub_label || "").toLowerCase();
                const matchVariant = s.is_group && Array.isArray(s.variants) && s.variants.some(v =>
                    (v.name || "").toLowerCase().includes(q) ||
                    (v.sub_label || "").toLowerCase().includes(q) ||
                    (v.tags || "").toLowerCase().includes(q)
                );
                return name.includes(q) || tags.includes(q) || country.includes(q) || brand.includes(q) || sub.includes(q) || matchVariant;
            });
        }

        if (list.length === 0) {
            grid.innerHTML = "";
            if (emptyState) {
                emptyState.style.display = "block";
                const emptyMsg = document.getElementById("radios-empty-msg");
                if (emptyMsg) {
                    emptyMsg.textContent = this.state.activeFilter === "favorites"
                        ? (this.state.searchQuery ? "Aucune radio favorite ne correspond à cette recherche." : "Vous n'avez pas encore de radio favorite. Explorez l'annuaire mondial ou ajoutez un flux personnalisé !")
                        : "Aucune station trouvée pour cette catégorie.";
                }
            }
            return;
        }

        if (emptyState) emptyState.style.display = "none";

        const currentStId = this.state.currentStation
            ? (this.state.currentStation.id || this.state.currentStation.stationuuid || this.state.currentStation.url)
            : null;

        const isCurrentlyPlaying = this.state.isPlaying && Boolean(window.AudioPlayer && window.AudioPlayer.isRadioPlaying);

        const totalCount = list.length;
        const currentLimit = this.state.displayLimit || 40;
        const visibleList = list.slice(0, currentLimit);

        let cardsHtml = visibleList.map(s => {
            const stId = s.id || s.stationuuid || s.url;
            const isFav = this.isStationFavorite(s);
            const isGroupMasterPlaying = Boolean(
                s.is_group && this.state.currentMasterGroup &&
                (this.state.currentMasterGroup.id === stId || this.state.currentMasterGroup.name === s.name)
            );
            const isThisPlaying = ((currentStId && currentStId === stId) || isGroupMasterPlaying) && isCurrentlyPlaying;
            const proceduralCover = this.getProceduralStationCover(s.name, s.tags, s.country);
            const hasCustomFavicon = Boolean(s.favicon && !s.favicon.includes("radio_placeholder.svg") && !s.favicon.includes("wikimedia.org") && !s.favicon.includes("wikipedia.org"));
            const logo = hasCustomFavicon ? s.favicon : proceduralCover;
            const bitrateBadge = s.bitrate ? `${s.codec || "MP3"} ${s.bitrate}k` : (s.codec || "RADIO");
            const countryBadge = s.country || (s.countrycode ? s.countrycode.toUpperCase() : "");

            // Badge Déclinaisons (Bouquet) ou Badge sous-label ville/thème
            let topBadgeHtml = "";
            if (s.is_group && s.variants_count > 1) {
                topBadgeHtml = `
                    <div class="radio-card-bouquet-badge" data-group-id="${escapeHtml(stId)}" title="Explorer les ${s.variants_count} déclinaisons de ce bouquet" onclick="event.stopPropagation(); window.RadioManager && window.RadioManager.openBouquetModal('${escapeHtml(stId)}');">
                        <i class="fas fa-layer-group"></i> ${s.variants_count} déclinaisons
                    </div>
                `;
            } else if (s.sub_label) {
                const subLabelType = s.sub_label_type || "location";
                const subIcon = subLabelType === "location" ? "📍" : "🏷️";
                topBadgeHtml = `
                    <div class="radio-card-sublabel-pill is-${escapeHtml(subLabelType)}" title="${escapeHtml(s.name)} : ${escapeHtml(subLabel)}">
                        <span class="sublabel-pin">${subIcon}</span>
                        <span class="sublabel-text">${escapeHtml(subLabel)}</span>
                    </div>
                `;
            }

            // Menu déroulant de sélection directe de la déclinaison sur la carte maîtresse
            let variantSelectHtml = "";
            if (s.is_group && Array.isArray(s.variants) && s.variants.length > 1) {
                variantSelectHtml = `
                    <div class="radio-card-variant-wrap" onclick="event.stopPropagation();">
                        <select class="radio-card-variant-select" data-group-id="${escapeHtml(stId)}" onchange="window.RadioManager && window.RadioManager.handleVariantChange(this, '${escapeHtml(stId)}');">
                            ${s.variants.map((v, vIdx) => {
                                const vSub = v.sub_label || v.name;
                                const vFmt = v.bitrate ? `${v.bitrate}k` : (v.codec || "");
                                return `<option value="${vIdx}">${escapeHtml(vSub)}${vFmt ? ' • ' + escapeHtml(vFmt) : ''}</option>`;
                            }).join('')}
                        </select>
                    </div>
                `;
            }

            // Tags individuels cliquables
            const rawTags = (s.tags || "")
                .split(",")
                .map(t => t.trim().toLowerCase())
                .filter(t => t && t.length > 1 && !t.includes("http"))
                .slice(0, 3);

            return `
                <div class="radio-card ${isThisPlaying ? 'is-playing' : ''} ${s.is_group ? 'is-bouquet-card' : ''}" data-station-id="${escapeHtml(stId)}">
                    <div class="radio-card-cover-wrap">
                        <img class="radio-card-cover ${!hasCustomFavicon ? 'is-procedural' : ''}" 
                             src="${escapeHtml(logo)}" 
                             alt="${escapeHtml(s.name)}" 
                             data-station-name="${escapeHtml(s.name)}"
                             data-station-tags="${escapeHtml(s.tags || '')}"
                             data-station-country="${escapeHtml(countryBadge)}"
                             onerror="window.RadioManager && window.RadioManager.handleCoverError(this);" 
                             loading="lazy">
                        ${isThisPlaying ? `
                            <div class="radio-card-eq-overlay">
                                <span class="player-equalizer-bar"></span>
                                <span class="player-equalizer-bar"></span>
                                <span class="player-equalizer-bar"></span>
                            </div>
                        ` : `
                            <button type="button" class="radio-card-play-btn" title="Écouter ${escapeHtml(s.name)}">
                                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                            </button>
                        `}
                        ${topBadgeHtml}
                        <div class="radio-card-bitrate-badge">${escapeHtml(bitrateBadge)}</div>
                    </div>
                    <div class="radio-card-body">
                        <div class="radio-card-title-row">
                            <h4 class="radio-card-title" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</h4>
                            <button type="button" class="btn-radio-fav ${isFav ? 'active' : ''}" title="${isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="${isFav ? '#eab308' : 'currentColor'}"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                            </button>
                        </div>
                        ${variantSelectHtml}
                        <div class="radio-card-meta">
                            ${countryBadge ? `<span class="radio-meta-country" data-country="${escapeHtml(s.countrycode || '')}" title="Explorer les radios : ${escapeHtml(countryBadge)}">📍 ${escapeHtml(countryBadge)}</span>` : ''}
                            ${rawTags.length > 0 ? `
                                <div class="radio-meta-tags-list">
                                    ${rawTags.map(t => `<button type="button" class="radio-tag-chip" data-tag="${escapeHtml(t)}" title="Explorer les radios '${escapeHtml(t)}'">${escapeHtml(t)}</button>`).join('')}
                                </div>
                            ` : ''}
                        </div>
                        ${s.is_custom ? `
                            <div class="radio-card-custom-actions">
                                <button type="button" class="btn-radio-delete" title="Supprimer cette radio">
                                    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                                    <span>Supprimer</span>
                                </button>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join("");

        // Ligne de pagination "Charger plus"
        if (totalCount > currentLimit) {
            const remaining = totalCount - currentLimit;
            cardsHtml += `
                <div class="radios-load-more-row">
                    <button type="button" id="btn-radios-load-more" class="radios-load-more-btn" onclick="window.RadioManager && window.RadioManager.loadMore();">
                        <i class="fas fa-plus"></i> Charger plus de stations (${remaining} restantes sur ${totalCount})
                    </button>
                </div>
            `;
        } else if (totalCount > 40) {
            cardsHtml += `
                <div class="radios-load-more-row is-complete">
                    <i class="fas fa-check-circle"></i> Toutes les stations sont affichées (${totalCount} au total)
                </div>
            `;
        }

        grid.innerHTML = cardsHtml;
        if (window.SoundStashI18n && typeof window.SoundStashI18n.translateDOM === "function") {
            window.SoundStashI18n.translateDOM(grid);
        }
    },

    async toggleFavorite(station) {
        try {
            const resp = await fetch("/api/radio/favorite/toggle", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ station: station })
            });
            if (resp.ok) {
                const data = await resp.json();
                const isFav = data.is_favorite;
                const stId = station.id || station.stationuuid || station.url;

                if (isFav) {
                    if (!this.state.favorites.some(f => (f.id || f.stationuuid || f.url) === stId)) {
                        this.state.favorites.unshift(station);
                    }
                    if (typeof showToast === "function") showToast(`⭐ Station ajoutée aux favoris : ${station.name}`, "success");
                } else {
                    this.state.favorites = this.state.favorites.filter(f => (f.id || f.stationuuid || f.url) !== stId);
                    if (typeof showToast === "function") showToast(`Station retirée des favoris : ${station.name}`, "info");
                }
                this.updateRadiosBadge();
                this.renderGrid();
            }
        } catch (err) {
            console.warn("[RadioManager] Erreur toggle favorite:", err);
        }
    },

    async playStation(station) {
        if (!station) return;
        let actualStation = station;

        // Si la station est un bouquet groupé, jouer la déclinaison sélectionnée dans le menu
        if (station.is_group && Array.isArray(station.variants) && station.variants.length > 0) {
            this.state.currentMasterGroup = station;
            const stId = station.id || station.stationuuid;
            const selectEl = document.querySelector(`.radio-card-variant-select[data-group-id="${stId}"]`);
            const selectedIdx = selectEl ? (parseInt(selectEl.value, 10) || 0) : 0;
            actualStation = station.variants[selectedIdx] || station.default_station || station.variants[0];
        } else {
            if (station.parent_brand && this.state.browseResults) {
                const parentGrp = this.state.browseResults.find(g => g.is_group && g.name === station.parent_brand);
                this.state.currentMasterGroup = parentGrp || null;
            } else {
                this.state.currentMasterGroup = null;
            }
        }

        this.state.currentStation = actualStation;
        this.state.currentOffset = 0;
        this.state.isLive = true;

        if (typeof showToast === "function") {
            const titleDisplay = actualStation.name || station.name || "Radio Web";
            showToast(`📻 Connexion au direct : ${titleDisplay}...`, "info", 2000);
        }

        try {
            const resp = await fetch("/api/radio/play", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ station: actualStation })
            });
            const playData = await resp.json().catch(() => null);
            if (!resp.ok || !playData || !playData.success) {
                const errMsg = (playData && playData.error) || "Impossible d'initialiser le flux côté serveur";
                throw new Error(errMsg);
            }

            if (window.AudioPlayer && typeof window.AudioPlayer.playRadioStream === "function") {
                window.AudioPlayer.playRadioStream(actualStation);
            }

            this.state.isPlaying = true;
            this.renderGrid();
            this.startStatusPolling();
        } catch (err) {
            console.error("[RadioManager] Échec lecture radio:", err);
            if (typeof showToast === "function") {
                showToast(`⚠️ Impossible de lire cette radio : ${err.message || err}`, "warning");
            }
            this.state.isPlaying = false;
            this.renderGrid();
        }
    },

    loadMore() {
        this.state.displayLimit = (this.state.displayLimit || 40) + 40;
        this.renderGrid();
    },

    handleVariantChange(selectEl, groupId) {
        const group = this.findStationById(groupId);
        if (!group || !Array.isArray(group.variants)) return;
        const idx = parseInt(selectEl.value, 10) || 0;
        const variant = group.variants[idx];
        if (!variant) return;

        this.state.currentMasterGroup = group;
        const currentStId = this.state.currentStation ? (this.state.currentStation.id || this.state.currentStation.stationuuid || this.state.currentStation.url) : null;
        const isThisGroupPlaying = Boolean(this.state.currentMasterGroup && (this.state.currentMasterGroup.id === groupId || this.state.currentMasterGroup.name === group.name));
        if (isThisGroupPlaying || (currentStId && currentStId === groupId)) {
            this.playStation(variant);
        }
    },

    openBouquetModal(groupId) {
        const group = this.findStationById(groupId);
        if (!group || !group.is_group) return;

        this.state.activeGroup = group;
        this.state.activeGroupSearch = "";

        const modal = document.getElementById("radios-bouquet-modal-backdrop");
        const logo = document.getElementById("radios-bouquet-modal-logo");
        const title = document.getElementById("radios-bouquet-modal-title");
        const subtitle = document.getElementById("radios-bouquet-modal-subtitle");
        const searchInput = document.getElementById("radios-bouquet-search");
        const clearBtn = document.getElementById("radios-bouquet-search-clear");

        if (logo) {
            logo.src = group.favicon || this.getProceduralStationCover(group.name, group.tags, group.country);
        }
        if (title) title.textContent = `${group.name} (Bouquet)`;
        if (subtitle) subtitle.textContent = `${group.variants_count} déclinaisons thématiques & régionales disponibles`;
        if (searchInput) searchInput.value = "";
        if (clearBtn) clearBtn.style.display = "none";

        this.renderBouquetGrid();
        if (modal) modal.style.display = "flex";
    },

    closeBouquetModal() {
        const modal = document.getElementById("radios-bouquet-modal-backdrop");
        if (modal) modal.style.display = "none";
        this.state.activeGroup = null;
    },

    renderBouquetGrid() {
        const group = this.state.activeGroup;
        if (!group) return;

        const grid = document.getElementById("radios-bouquet-grid");
        const countPill = document.getElementById("radios-bouquet-count-pill");
        if (!grid) return;

        const q = (this.state.activeGroupSearch || "").toLowerCase().trim();
        let variants = group.variants || [];
        if (q) {
            variants = variants.filter(v =>
                (v.name && v.name.toLowerCase().includes(q)) ||
                (v.sub_label && v.sub_label.toLowerCase().includes(q)) ||
                (v.tags && v.tags.toLowerCase().includes(q))
            );
        }

        if (countPill) {
            countPill.textContent = `${variants.length} / ${group.variants_count} station(s)`;
        }

        const currentStId = this.state.currentStation ? (this.state.currentStation.id || this.state.currentStation.stationuuid || this.state.currentStation.url) : null;
        const isPlaying = this.state.isPlaying && Boolean(window.AudioPlayer && window.AudioPlayer.isRadioPlaying);

        grid.innerHTML = variants.map((v) => {
            const vId = v.id || v.stationuuid || v.url;
            const isThisPlaying = (isPlaying && currentStId === vId);
            const vSub = v.sub_label || v.name;
            const subIcon = (v.sub_label_type === "location") ? "📍" : "🏷️";
            const fmt = v.bitrate ? `${v.codec || "MP3"} ${v.bitrate}k` : (v.codec || "MP3");
            const originalIdx = (group.variants || []).findIndex(x => (x.id || x.stationuuid || x.url) === vId);
            const targetIdx = originalIdx >= 0 ? originalIdx : 0;

            return `
                <div class="bouquet-card ${isThisPlaying ? 'is-active-playing' : ''}" onclick="window.RadioManager && window.RadioManager.playBouquetVariant(${targetIdx});">
                    <div class="bouquet-card-info">
                        <span class="bouquet-card-name" title="${escapeHtml(v.name)}">${escapeHtml(v.name)}</span>
                        <div class="bouquet-card-meta">
                            ${v.sub_label ? `<span class="bouquet-card-tag">${subIcon} ${escapeHtml(v.sub_label)}</span>` : ''}
                            <span class="bouquet-card-tag">${escapeHtml(fmt)}</span>
                        </div>
                    </div>
                    <button type="button" class="bouquet-card-play-btn" title="Écouter ${escapeHtml(v.name)}">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                            <path d="${isThisPlaying ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' : 'M8 5v14l11-7z'}"/>
                        </svg>
                    </button>
                </div>
            `;
        }).join('');
    },

    playBouquetVariant(vIdx) {
        const group = this.state.activeGroup;
        if (!group || !Array.isArray(group.variants)) return;
        const variant = group.variants[vIdx];
        if (!variant) return;

        const groupId = group.id || group.stationuuid;
        const selectEl = document.querySelector(`.radio-card-variant-select[data-group-id="${groupId}"]`);
        if (selectEl) {
            selectEl.value = String(vIdx);
        }

        this.state.currentMasterGroup = group;
        this.playStation(variant);
        this.renderBouquetGrid();
    },

    setupBouquetModal() {
        const modal = document.getElementById("radios-bouquet-modal-backdrop");
        const btnClose = document.getElementById("btn-close-radios-bouquet-modal");
        const searchInput = document.getElementById("radios-bouquet-search");
        const clearBtn = document.getElementById("radios-bouquet-search-clear");

        if (btnClose) btnClose.addEventListener("click", () => this.closeBouquetModal());
        if (modal) {
            modal.addEventListener("click", (e) => {
                if (e.target === modal) this.closeBouquetModal();
            });
        }
        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                this.state.activeGroupSearch = e.target.value;
                if (clearBtn) clearBtn.style.display = e.target.value ? "block" : "none";
                this.renderBouquetGrid();
            });
        }
        if (clearBtn && searchInput) {
            clearBtn.addEventListener("click", () => {
                searchInput.value = "";
                clearBtn.style.display = "none";
                this.state.activeGroupSearch = "";
                this.renderBouquetGrid();
            });
        }
    },

    startStatusPolling() {
        this.stopStatusPolling();
        this.pollStatus();
        this.state.pollTimer = setInterval(() => {
            this.pollStatus();
        }, 3000);
    },

    stopStatusPolling() {
        if (this.state.pollTimer) {
            clearInterval(this.state.pollTimer);
            this.state.pollTimer = null;
        }
    },

    async pollStatus() {
        if (!this.state.currentStation || !this.state.isPlaying) return;
        try {
            const resp = await fetch("/api/radio/status");
            if (resp.ok) {
                const data = await resp.json();
                if (data.is_active) {
                    this.state.bufferSeconds = data.buffer_seconds || 0;
                    this.state.maxBufferSeconds = data.max_buffer_seconds || 1800;
                    if (data.now_playing) {
                        this.state.nowPlaying = data.now_playing;
                        this.updateNowPlayingUI();
                    }
                    this.updateTimeshiftTimeline();
                }
            }
        } catch (e) {
            // Ignorer les erreurs réseau temporaires de polling
        }
    },

    updateNowPlayingUI() {
        const miniArtist = document.getElementById("mini-player-artist");
        const playerArtist = document.getElementById("player-track-artist");
        const np = this.state.nowPlaying;

        if (np && np.raw && this.state.currentStation) {
            const text = np.raw.length > 5 ? np.raw : (this.state.currentStation.name || "Radio");
            if (miniArtist) miniArtist.textContent = text;
            if (playerArtist) playerArtist.textContent = text;

            // Synchroniser le Mode Soirée (Ambient Mode) s'il est actif
            if (window.AmbientVisualizer && window.AmbientVisualizer.isActive) {
                const ambTitle = document.getElementById("ambient-track-title");
                const ambSub = document.getElementById("ambient-track-sub");
                if (ambTitle) ambTitle.textContent = np.title || np.raw || this.state.currentStation.name;
                if (ambSub) ambSub.textContent = `${this.state.currentStation.name} • ${np.raw}`;
            }

            // Synchroniser le Grand Écran Radio (Now Playing) s'il est affiché
            const grandEcranTitle = document.getElementById("player-now-playing-radio-live-title");
            if (grandEcranTitle) {
                grandEcranTitle.textContent = np.title || np.raw || this.state.currentStation.name;
            }
        }

        // Mettre à jour l'état SMTC, Taskbar Thumbar et Tray
        if (window.AudioPlayer && typeof window.AudioPlayer.syncSystemMediaState === "function") {
            window.AudioPlayer.syncSystemMediaState();
        }
        // Mettre à jour le tiroir de file d'attente s'il est ouvert
        if (window.AudioPlayer && window.AudioPlayer.isQueueDrawerOpen && typeof window.AudioPlayer.renderQueueDrawer === "function") {
            window.AudioPlayer.renderQueueDrawer();
        }
    },

    updateTimeshiftTimeline() {
        const miniTimeCur = document.getElementById("mini-player-time-current");
        const miniTimeTot = document.getElementById("mini-player-time-total");
        const miniSeekBar = document.getElementById("mini-player-seek-bar");
        const playerTimeCur = document.getElementById("player-time-current");
        const playerTimeTot = document.getElementById("player-time-total");
        const playerSeekBar = document.getElementById("player-seek-slider");

        const offset = this.state.currentOffset; // 0 = direct, <0 = passé
        const bufSec = this.state.bufferSeconds;

        const isLive = (offset >= -2);
        this.state.isLive = isLive;

        const liveText = isLive ? "🔴 EN DIRECT" : "⚡ Revenir au direct";
        const curText = isLive ? "0:00" : `-${formatSeconds(Math.abs(offset))}`;

        if (miniTimeCur) miniTimeCur.textContent = curText;
        if (playerTimeCur) playerTimeCur.textContent = curText;

        if (miniTimeTot) {
            miniTimeTot.innerHTML = `<span class="radio-live-pill ${isLive ? 'is-live' : 'is-behind'}" title="${isLive ? 'Flux diffusé en direct' : 'Cliquez pour sauter au direct'}">${liveText}</span>`;
            if (!isLive && !miniTimeTot._hasLiveClickListener) {
                miniTimeTot._hasLiveClickListener = true;
                miniTimeTot.addEventListener("click", () => this.jumpToLive());
            }
        }
        if (playerTimeTot) {
            playerTimeTot.innerHTML = `<span class="radio-live-pill ${isLive ? 'is-live' : 'is-behind'}" title="${isLive ? 'Flux diffusé en direct' : 'Cliquez pour sauter au direct'}">${liveText}</span>`;
            if (!isLive && !playerTimeTot._hasLiveClickListener) {
                playerTimeTot._hasLiveClickListener = true;
                playerTimeTot.addEventListener("click", () => this.jumpToLive());
            }
        }

        // Synchroniser le Mode Soirée (Ambient Mode) s'il est actif
        const ambTimeCur = document.getElementById("ambient-time-current");
        const ambTimeTot = document.getElementById("ambient-time-total");
        const ambSeekBar = document.getElementById("ambient-seek-bar");
        if (ambTimeCur) ambTimeCur.textContent = curText;
        if (ambTimeTot) {
            ambTimeTot.innerHTML = `<span class="radio-live-pill ${isLive ? 'is-live' : 'is-behind'}" title="${isLive ? 'Flux diffusé en direct' : 'Cliquez pour sauter au direct'}">${liveText}</span>`;
            if (!isLive && !ambTimeTot._hasLiveClickListener) {
                ambTimeTot._hasLiveClickListener = true;
                ambTimeTot.addEventListener("click", () => this.jumpToLive());
            }
        }

        // Configuration de la barre de défilement (de -bufSec à 0)
        if (miniSeekBar && !window.AudioPlayer?.isSeeking) {
            miniSeekBar.min = String(-Math.max(10, Math.min(bufSec, this.state.maxBufferSeconds)));
            miniSeekBar.max = "0";
            miniSeekBar.step = "1";
            miniSeekBar.value = String(offset);
        }
        if (playerSeekBar && !window.AudioPlayer?.isSeeking) {
            playerSeekBar.min = String(-Math.max(10, Math.min(bufSec, this.state.maxBufferSeconds)));
            playerSeekBar.max = "0";
            playerSeekBar.step = "1";
            playerSeekBar.value = String(offset);
        }
        if (ambSeekBar && !window.AudioPlayer?.isSeeking) {
            ambSeekBar.min = String(-Math.max(10, Math.min(bufSec, this.state.maxBufferSeconds)));
            ambSeekBar.max = "0";
            ambSeekBar.step = "1";
            ambSeekBar.value = String(offset);
        }

        // Synchroniser la console Grand Écran Radio (Now Playing)
        const geLiveStatus = document.getElementById("player-now-playing-radio-live-status");
        const geCurPos = document.getElementById("player-now-playing-radio-current-pos");
        const geSeekSlider = document.getElementById("player-now-playing-radio-seek-slider");
        if (geLiveStatus) {
            geLiveStatus.className = `radio-live-pill ${isLive ? 'is-live' : 'is-behind'}`;
            geLiveStatus.textContent = isLive ? '🔴 EN DIRECT' : '⚡ ' + curText;
        }
        if (geCurPos) {
            geCurPos.textContent = curText;
        }
        if (geSeekSlider && (!window.AudioPlayer || !window.AudioPlayer.isSeeking)) {
            geSeekSlider.min = String(-Math.max(10, Math.min(bufSec, this.state.maxBufferSeconds)));
            geSeekSlider.max = "0";
            geSeekSlider.step = "1";
            geSeekSlider.value = String(offset);
        }
    },

    seekTo(offsetSeconds) {
        this.seekOffset(offsetSeconds);
    },

    seekRelative(deltaSeconds) {
        const bufSec = this.state.bufferSeconds;
        const maxPast = -Math.min(bufSec, this.state.maxBufferSeconds);
        const newOffset = Math.max(maxPast, Math.min(0, this.state.currentOffset + deltaSeconds));
        this.seekOffset(newOffset);
    },

    seekOffset(offsetSeconds) {
        if (window.AudioPlayer && (window.AudioPlayer._isRestoringSavedSession || !window.AudioPlayer._hasPlayedInCurrentRun || !window.AudioPlayer.audio.src)) {
            if (this.state.currentStation) {
                this.playStation(this.state.currentStation);
                return;
            }
        }
        this.state.currentOffset = offsetSeconds;
        this.state.isLive = (offsetSeconds >= -2);

        if (typeof showToast === "function") {
            if (this.state.isLive) {
                showToast("🔴 Reprise du direct en temps réel", "info", 1500);
            } else {
                showToast(`⏳ Retour en arrière : -${formatSeconds(Math.abs(offsetSeconds))}`, "info", 1500);
            }
        }

        // Mise à jour de l'URL du flux avec l'offset
        if (window.AudioPlayer && window.AudioPlayer.audio) {
            const targetUrl = `/api/radio/stream?offset=${encodeURIComponent(offsetSeconds)}&_t=${Date.now()}`;
            window.AudioPlayer.audio.src = targetUrl;
            window.AudioPlayer.audio.play().catch(e => console.warn("Erreur seek radio:", e));
        }

        this.updateTimeshiftTimeline();
    },

    jumpToLive() {
        this.seekOffset(0);
    },

    getUserCountryCodes() {
        const DEFAULT_CODES = ["FR", "BE", "CH", "CA", "GB", "US"];
        try {
            const raw = localStorage.getItem("soundstash_radio_user_countries");
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch (e) {}
        return DEFAULT_CODES;
    },

    renderCountryPills() {
        const container = document.getElementById("radios-dynamic-country-pills");
        if (!container) return;

        const codes = this.getUserCountryCodes();
        const activeFilter = this.state.activeFilter;

        let html = "";
        codes.forEach(code => {
            const country = WORLD_COUNTRIES.find(c => c.code === code) || { code: code, name: code, flag: "🌐" };
            const isAct = (activeFilter === `country:${code}`);
            html += `<button type="button" class="subfilter-pill ${isAct ? 'active' : ''}" data-radio-filter="country:${escapeHtml(country.code)}">${escapeHtml(country.flag)} ${escapeHtml(country.name)}</button>`;
        });
        container.innerHTML = html;
    },

    setupCountriesModal() {
        const btnOpen = document.getElementById("btn-configure-radios-countries");
        const modalBackdrop = document.getElementById("radios-countries-modal-backdrop");
        const btnClose = document.getElementById("btn-close-radios-countries-modal");
        const btnCancel = document.getElementById("btn-cancel-radios-countries");
        const btnSave = document.getElementById("btn-save-radios-countries");
        const btnReset = document.getElementById("btn-reset-radios-countries");
        const searchInput = document.getElementById("radios-countries-search");

        if (btnOpen) btnOpen.addEventListener("click", () => this.openCountriesModal());
        if (btnClose) btnClose.addEventListener("click", () => this.closeCountriesModal());
        if (btnCancel) btnCancel.addEventListener("click", () => this.closeCountriesModal());
        if (btnReset) btnReset.addEventListener("click", () => this.resetCountriesModal());
        if (btnSave) btnSave.addEventListener("click", () => this.saveCountriesSelection());

        if (modalBackdrop) {
            modalBackdrop.addEventListener("click", (e) => {
                if (e.target === modalBackdrop) this.closeCountriesModal();
            });
        }

        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                const q = e.target.value.toLowerCase().trim();
                const cards = document.querySelectorAll("#radios-countries-grid .country-checkbox-card");
                cards.forEach(card => {
                    const name = card.getAttribute("data-country-name") || "";
                    const code = card.getAttribute("data-country-code") || "";
                    if (!q || name.includes(q) || code.includes(q)) {
                        card.style.display = "flex";
                    } else {
                        card.style.display = "none";
                    }
                });
            });
        }
    },

    openCountriesModal() {
        const modalBackdrop = document.getElementById("radios-countries-modal-backdrop");
        const grid = document.getElementById("radios-countries-grid");
        const searchInput = document.getElementById("radios-countries-search");
        if (!modalBackdrop || !grid) return;

        if (searchInput) searchInput.value = "";
        const userCodes = new Set(this.getUserCountryCodes());

        let html = "";
        WORLD_COUNTRIES.forEach(c => {
            const isChecked = userCodes.has(c.code);
            html += `
                <label class="country-checkbox-card ${isChecked ? 'is-selected' : ''}" data-country-code="${c.code.toLowerCase()}" data-country-name="${escapeHtml(c.name.toLowerCase())}">
                    <input type="checkbox" value="${c.code}" ${isChecked ? 'checked' : ''} onchange="window.RadioManager && window.RadioManager.handleCountryCheckboxChange(this);">
                    <span class="country-checkbox-flag">${c.flag}</span>
                    <span class="country-checkbox-name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>
                    <span class="country-checkbox-code">${c.code}</span>
                </label>
            `;
        });
        grid.innerHTML = html;
        this.updateCountriesModalCount();

        modalBackdrop.style.display = "flex";
        setTimeout(() => modalBackdrop.classList.add("active"), 10);
    },

    handleCountryCheckboxChange(checkbox) {
        const card = checkbox.closest(".country-checkbox-card");
        if (card) {
            card.classList.toggle("is-selected", checkbox.checked);
        }
        this.updateCountriesModalCount();
    },

    updateCountriesModalCount() {
        const countEl = document.getElementById("radios-countries-selected-count");
        if (countEl) {
            const checkedBoxes = document.querySelectorAll("#radios-countries-grid input[type='checkbox']:checked");
            countEl.textContent = `${checkedBoxes.length} pays sélectionné(s)`;
        }
    },

    closeCountriesModal() {
        const modalBackdrop = document.getElementById("radios-countries-modal-backdrop");
        if (modalBackdrop) {
            modalBackdrop.classList.remove("active");
            setTimeout(() => { modalBackdrop.style.display = "none"; }, 200);
        }
    },

    resetCountriesModal() {
        const DEFAULT_CODES = new Set(["FR", "BE", "CH", "CA", "GB", "US"]);
        const checkboxes = document.querySelectorAll("#radios-countries-grid input[type='checkbox']");
        checkboxes.forEach(cb => {
            cb.checked = DEFAULT_CODES.has(cb.value);
            const card = cb.closest(".country-checkbox-card");
            if (card) card.classList.toggle("is-selected", cb.checked);
        });
        this.updateCountriesModalCount();
    },

    async saveCountriesSelection() {
        const checkboxes = document.querySelectorAll("#radios-countries-grid input[type='checkbox']:checked");
        let codes = Array.from(checkboxes).map(cb => cb.value.toUpperCase());
        if (codes.length === 0) {
            codes = ["FR"]; // Au moins un pays par sécurité
        }

        // Sauvegarde locale instantanée
        try {
            localStorage.setItem("soundstash_radio_user_countries", JSON.stringify(codes));
        } catch (e) {}

        // Sauvegarde sur le backend pour pérennité
        try {
            fetch("/api/radio/countries", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ codes: codes })
            }).catch(() => {});
        } catch (e) {}

        this.renderCountryPills();
        this.closeCountriesModal();

        if (typeof showToast === "function") {
            showToast(`🌍 ${codes.length} pays configuré(s) pour les Radios Web !`, "success", 2500);
        }
    },

    // --- Modale d'ajout manuel de radio ---
    openCustomRadioModal() {
        const modal = document.getElementById("custom-radio-modal-backdrop");
        if (modal) modal.style.display = "flex";
        const statusEl = document.getElementById("custom-radio-test-status");
        if (statusEl) statusEl.style.display = "none";
    },

    closeCustomRadioModal() {
        const modal = document.getElementById("custom-radio-modal-backdrop");
        if (modal) modal.style.display = "none";
        const form = document.getElementById("custom-radio-form");
        if (form) form.reset();
        const statusEl = document.getElementById("custom-radio-test-status");
        if (statusEl) statusEl.style.display = "none";
    },

    async testStreamUrl() {
        const urlInput = document.getElementById("custom-radio-url");
        const statusEl = document.getElementById("custom-radio-test-status");
        if (!urlInput || !statusEl) return;

        const url = urlInput.value.trim();
        if (!url) {
            statusEl.textContent = "Veuillez entrer une URL de flux.";
            statusEl.className = "alert-text text-danger";
            statusEl.style.display = "block";
            return;
        }

        statusEl.textContent = "Test de connexion au flux en cours...";
        statusEl.className = "alert-text text-info";
        statusEl.style.display = "block";

        try {
            const resp = await fetch(`/api/radio/test?url=${encodeURIComponent(url)}`, { method: "POST" });
            const data = await resp.json();
            if (data.success) {
                statusEl.textContent = `✓ Flux valide (${data.content_type || "Audio"}) ! Prêt à diffuser.`;
                statusEl.className = "alert-text text-success";
            } else {
                statusEl.textContent = `⚠️ Impossible de joindre le flux : ${data.error || "Erreur réseau"}`;
                statusEl.className = "alert-text text-danger";
            }
        } catch (e) {
            statusEl.textContent = `⚠️ Erreur de test : ${e.message}`;
            statusEl.className = "alert-text text-danger";
        }
    },

    async saveCustomRadio() {
        const nameInput = document.getElementById("custom-radio-name");
        const urlInput = document.getElementById("custom-radio-url");
        const tagsInput = document.getElementById("custom-radio-tags");
        const logoInput = document.getElementById("custom-radio-logo");

        if (!nameInput || !urlInput) return;
        const name = nameInput.value.trim();
        const url = urlInput.value.trim();
        if (!name || !url) {
            if (typeof showToast === "function") showToast("Le nom et l'URL du flux sont obligatoires.", "warning");
            return;
        }

        try {
            const resp = await fetch("/api/radio/custom/add", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name,
                    url: url,
                    tags: tagsInput ? tagsInput.value.trim() : "",
                    favicon: logoInput ? logoInput.value.trim() : "",
                    country: "Personnalisé"
                })
            });

            if (resp.ok) {
                const data = await resp.json();
                if (typeof showToast === "function") showToast(`✓ Radio personnalisée ajoutée : ${name}`, "success");
                this.closeCustomRadioModal();
                await this.loadLocalRadios();
                this.setFilter("favorites");
            }
        } catch (err) {
            console.error("[RadioManager] Erreur ajout radio:", err);
            if (typeof showToast === "function") showToast("Erreur lors de l'enregistrement de la radio.", "error");
        }
    },

    async deleteCustomRadio(station) {
        if (!station || !station.id) return;
        const confirmDelete = window.confirm(`Supprimer définitivement la radio "${station.name}" ?`);
        if (!confirmDelete) return;

        try {
            const resp = await fetch(`/api/radio/custom/${encodeURIComponent(station.id)}`, {
                method: "DELETE"
            });
            if (resp.ok) {
                if (typeof showToast === "function") showToast(`Radio "${station.name}" supprimée.`, "info");
                await this.loadLocalRadios();
                this.renderGrid();
            }
        } catch (e) {
            console.error("[RadioManager] Erreur suppression radio:", e);
        }
    }
};

function formatSeconds(totalSec) {
    const s = Math.floor(totalSec);
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

window.RadioManager = RadioManager;

// =========================================================
// SoundStash - Module Workshop / Search
// Recherche en ligne, filtres, tri, pagination & aperçu d'albums
// =========================================================

window.currentPreviewAlbum = null;

// =========================================================
// Onglet Recherche en Ligne
// =========================================================
function setupSearch() {
    const searchForm = document.getElementById("search-form");
    const queryInput = document.getElementById("search-query-input");
    const clearBtn = document.getElementById("search-clear-btn");
    const submitBtn = document.getElementById("search-submit-btn");
    const searchTypeSelect = document.getElementById("search-filter-type-select");
    const searchGenreSelect = document.getElementById("search-filter-genre-select");
    const placeholder = document.getElementById("search-placeholder");
    const loading = document.getElementById("search-loading");
    const errorBox = document.getElementById("search-error");
    const errorText = document.getElementById("search-error-text");
    const resultsContainer = document.getElementById("search-results-container");
    const resultsGrid = document.getElementById("search-results-grid");
    const resultsCount = document.getElementById("search-results-count");
    const albumSubfiltersGroup = document.getElementById("album-subfilters-group");
    const albumSubfilterPills = document.querySelectorAll("#album-subfilter-pills .subfilter-pill");
    const sortSelect = document.getElementById("search-sort-select");
    const loadMoreContainer = document.getElementById("search-load-more-container");
    const loadMoreBtn = document.getElementById("search-load-more-btn");
    const loadMoreText = document.getElementById("search-load-more-text");
    const loadMoreSpinner = document.getElementById("search-load-more-spinner");
    const loadMoreIcon = document.getElementById("search-load-more-icon");
    const allHint = document.getElementById("search-all-hint");
    const btnStrictArtist = document.getElementById("btn-strict-artist");
    const btnFilterHideOwned = document.getElementById("btn-filter-hide-owned");
    const artistDiscographyBanner = document.getElementById("artist-discography-banner");
    const discographyBannerTitle = document.getElementById("discography-banner-title");
    const btnCloseDiscography = document.getElementById("btn-close-discography");
    const btnBannerGapFinder = document.getElementById("btn-banner-gap-finder");

    if (!searchForm || !queryInput) return;

    let currentFilter = "all";
    let currentContinuationToken = null;
    let currentRawResults = [];
    let currentSort = "relevance";
    let currentAlbumSubfilter = "all";
    let strictArtistFilterActive = false;
    let hideOwnedFilterActive = false;
    let currentArtistLock = "";
    let isOfficialDiscographyMode = false;
    let savedSearchBeforeDiscography = null;

    let isAutoLoadingMore = false;
    let autoLoadConsecutiveCount = 0;
    const MIN_VISIBLE_TILES_THRESHOLD = 15;
    const MAX_CONSECUTIVE_AUTO_LOADS = 4;

    // Affichage / masquage du bouton clear et persistance du texte saisi
    queryInput.addEventListener("input", () => {
        const val = queryInput.value;
        clearBtn.style.display = val.trim() ? "block" : "none";
        try {
            if (val.trim()) {
                localStorage.setItem("ytm_search_query", val);
            } else {
                localStorage.removeItem("ytm_search_query");
            }
        } catch (e) {}
    });

    clearBtn.addEventListener("click", () => {
        queryInput.value = "";
        clearBtn.style.display = "none";
        try {
            localStorage.removeItem("ytm_search_query");
        } catch (e) {}
        currentContinuationToken = null;
        currentRawResults = [];
        window.currentSearchResults = [];
        currentSort = "relevance";
        if (sortSelect) sortSelect.value = "relevance";
        try {
            localStorage.removeItem("ytm_search_sort");
        } catch (e) {}
        currentAlbumSubfilter = "all";
        albumSubfilterPills.forEach(p => {
            if (p.getAttribute("data-subfilter") === "all") p.classList.add("active");
            else p.classList.remove("active");
        });
        try {
            localStorage.removeItem("ytm_album_subfilter");
        } catch (e) {}
        if (albumSubfiltersGroup) albumSubfiltersGroup.style.display = "none";
        if (loadMoreContainer) loadMoreContainer.style.display = "none";
        if (allHint) allHint.style.display = "none";
        if (searchGenreSelect) searchGenreSelect.value = "";
        queryInput.focus();
    });

    // Gestion du filtre déroulant par type
    if (searchTypeSelect) {
        searchTypeSelect.addEventListener("change", () => {
            currentFilter = searchTypeSelect.value || "all";
            try {
                localStorage.setItem("ytm_search_filter", currentFilter);
            } catch (e) {}

            // Réinitialiser le sous-filtre d'album à 'all'
            currentAlbumSubfilter = "all";
            albumSubfilterPills.forEach(p => {
                if (p.getAttribute("data-subfilter") === "all") p.classList.add("active");
                else p.classList.remove("active");
            });
            try {
                localStorage.setItem("ytm_album_subfilter", "all");
            } catch (e) {}
            if (albumSubfiltersGroup) {
                albumSubfiltersGroup.style.display = (currentFilter === "album" && currentRawResults.length > 0) ? "inline-flex" : "none";
            }

            if (queryInput.value.trim()) {
                performSearch(queryInput.value.trim(), currentFilter);
            }
        });
    }

    // Gestion des sous-filtres d'albums (Tous / Albums Studio / Singles & EPs)
    albumSubfilterPills.forEach(pill => {
        pill.addEventListener("click", () => {
            albumSubfilterPills.forEach(p => p.classList.remove("active"));
            pill.classList.add("active");
            currentAlbumSubfilter = pill.getAttribute("data-subfilter") || "all";
            try {
                localStorage.setItem("ytm_album_subfilter", currentAlbumSubfilter);
            } catch (e) {}
            applyFiltersAndSort();
        });
    });

    // Gestion du bouton de verrouillage "🎯 Artiste strict"
    if (btnStrictArtist) {
        btnStrictArtist.addEventListener("click", () => {
            strictArtistFilterActive = !strictArtistFilterActive;
            btnStrictArtist.classList.toggle("active", strictArtistFilterActive);
            applyFiltersAndSort();
        });
    }

    // Gestion du bouton de filtrage "🙈 Masquer déjà possédés" avec pagination automatique
    if (btnFilterHideOwned) {
        btnFilterHideOwned.addEventListener("click", () => {
            hideOwnedFilterActive = !hideOwnedFilterActive;
            btnFilterHideOwned.classList.toggle("active", hideOwnedFilterActive);
            autoLoadConsecutiveCount = 0;
            applyFiltersAndSort();
            if (hideOwnedFilterActive) {
                checkAutoLoadForHideOwned();
            }
        });
    }

    // Bouton retour depuis la discographie officielle vers la recherche générale
    if (btnCloseDiscography) {
        btnCloseDiscography.addEventListener("click", () => {
            isOfficialDiscographyMode = false;
            if (artistDiscographyBanner) artistDiscographyBanner.style.display = "none";
            if (savedSearchBeforeDiscography) {
                queryInput.value = savedSearchBeforeDiscography.query || "";
                currentFilter = savedSearchBeforeDiscography.filter || "artist";
                if (searchTypeSelect) searchTypeSelect.value = currentFilter;
                performSearch(queryInput.value, currentFilter);
                savedSearchBeforeDiscography = null;
            } else {
                performSearch(queryInput.value, currentFilter);
            }
        });
    }

    // Bouton Gap Finder (Albums manquants) dans le bandeau de discographie
    if (btnBannerGapFinder) {
        btnBannerGapFinder.addEventListener("click", () => {
            if (currentArtistLock) {
                openGapFinderModal(currentArtistLock, null);
            }
        });
    }

    // Gestion du sélecteur de tri instantané
    if (sortSelect) {
        sortSelect.addEventListener("change", () => {
            currentSort = sortSelect.value;
            try {
                localStorage.setItem("ytm_search_sort", currentSort);
            } catch (e) {}
            applyFiltersAndSort();
        });
    }

    // Gestion du menu déroulant complet des genres musicaux
    if (searchGenreSelect) {
        searchGenreSelect.addEventListener("change", () => {
            const genre = searchGenreSelect.value;
            if (genre) {
                queryInput.value = genre;
                clearBtn.style.display = "block";
                try {
                    localStorage.setItem("ytm_search_query", genre);
                } catch (e) {}
                performSearch(genre, currentFilter);
            } else if (queryInput.value.trim()) {
                performSearch(queryInput.value.trim(), currentFilter);
            }
        });
    }

    searchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const query = queryInput.value.trim();
        if (!query) {
            queryInput.focus();
            return;
        }
        performSearch(query, currentFilter);
    });

    // Poursuite automatique de la recherche lorsque "Masquer déjà possédés" réduit les tuiles
    async function checkAutoLoadForHideOwned() {
        if (!hideOwnedFilterActive || !currentContinuationToken || isAutoLoadingMore) {
            return;
        }
        const filtered = filterResults(currentRawResults);
        if (filtered.length < MIN_VISIBLE_TILES_THRESHOLD && autoLoadConsecutiveCount < MAX_CONSECUTIVE_AUTO_LOADS) {
            isAutoLoadingMore = true;
            autoLoadConsecutiveCount++;
            try {
                if (loadMoreSpinner) loadMoreSpinner.style.display = "inline-block";
                if (loadMoreIcon) loadMoreIcon.style.display = "none";
                if (loadMoreText) loadMoreText.textContent = "Recherche de nouveaux résultats...";
                if (loadMoreContainer) loadMoreContainer.style.display = "flex";

                const res = await fetch(`/api/search/more?continuation=${encodeURIComponent(currentContinuationToken)}&filter_type=${encodeURIComponent(currentFilter)}`);
                const data = await res.json();
                const moreItems = data.results || [];
                currentContinuationToken = data.continuation || null;

                if (moreItems.length > 0) {
                    const startIdx = currentRawResults.length;
                    moreItems.forEach((item, idx) => {
                        item._originalIndex = startIdx + idx;
                    });
                    currentRawResults = currentRawResults.concat(moreItems);
                    window.currentSearchResults = currentRawResults;

                    // Enrichir le statut bibliothèque des nouveaux éléments (sans récursion de filtres)
                    await enrichItemsWithLibraryStatus(moreItems, false);
                    applyFiltersAndSort(false);

                    setTimeout(() => {
                        isAutoLoadingMore = false;
                        checkAutoLoadForHideOwned();
                    }, 250);
                } else {
                    isAutoLoadingMore = false;
                    if (loadMoreContainer) loadMoreContainer.style.display = "none";
                }
            } catch (err) {
                console.warn("Erreur chargement automatique pour 'Masquer déjà possédés':", err);
                isAutoLoadingMore = false;
            } finally {
                if (!isAutoLoadingMore) {
                    if (loadMoreSpinner) loadMoreSpinner.style.display = "none";
                    if (loadMoreIcon) loadMoreIcon.style.display = "inline";
                    if (loadMoreText) loadMoreText.textContent = "Voir plus de résultats";
                }
            }
        } else {
            isAutoLoadingMore = false;
        }
    }

    // Gestion du bouton manuel "➕ Voir plus de résultats"
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener("click", async () => {
            if (!currentContinuationToken || loadMoreBtn.disabled) return;

            autoLoadConsecutiveCount = 0; // Réinitialiser le compteur sur clic manuel
            loadMoreBtn.disabled = true;
            if (loadMoreIcon) loadMoreIcon.style.display = "none";
            if (loadMoreSpinner) loadMoreSpinner.style.display = "inline-block";
            if (loadMoreText) loadMoreText.textContent = "Chargement en cours...";

            try {
                const res = await fetch(`/api/search/more?continuation=${encodeURIComponent(currentContinuationToken)}&filter_type=${encodeURIComponent(currentFilter)}`);
                const data = await res.json();
                const moreItems = data.results || [];

                if (moreItems.length > 0) {
                    const startIdx = currentRawResults.length;
                    moreItems.forEach((item, idx) => {
                        item._originalIndex = startIdx + idx;
                    });
                    currentRawResults = currentRawResults.concat(moreItems);
                    window.currentSearchResults = currentRawResults;
                    applyFiltersAndSort();
                }

                currentContinuationToken = data.continuation || null;
                if (!currentContinuationToken || moreItems.length === 0) {
                    if (loadMoreContainer) loadMoreContainer.style.display = "none";
                    showToast("Tous les résultats disponibles ont été chargés.", "info");
                }
            } catch (err) {
                showToast(`Erreur lors du chargement : ${err.message}`, "danger");
            } finally {
                loadMoreBtn.disabled = false;
                if (loadMoreIcon) loadMoreIcon.style.display = "inline";
                if (loadMoreSpinner) loadMoreSpinner.style.display = "none";
                if (loadMoreText) loadMoreText.textContent = "Voir plus de résultats";
            }
        });
    }

    async function promptTargetedArtistSearch(artistName) {
        artistName = cleanArtistName(artistName);
        if (!artistName || artistName === "Artiste inconnu" || artistName === "Various Artists") return;
        const confirmed = await showModalConfirm(
            "Recherche ciblée par artiste",
            `Voulez-vous lancer une nouvelle recherche ciblée pour afficher la fiche de l'artiste « ${artistName} » ?`,
            "Rechercher l'artiste",
            false
        );
        if (confirmed) {
            queryInput.value = artistName;
            clearBtn.style.display = "block";
            try {
                localStorage.setItem("ytm_search_query", artistName);
            } catch (e) {}

            currentFilter = "artist";
            if (searchTypeSelect) searchTypeSelect.value = "artist";
            try {
                localStorage.setItem("ytm_search_filter", "artist");
            } catch (e) {}

            if (albumSubfiltersGroup) albumSubfiltersGroup.style.display = "none";

            performSearch(artistName, "artist");
        }
    }

    function resetConfirmOverrideState(btnEl) {
        if (!btnEl) return;
        if (btnEl._overrideTimer) {
            clearTimeout(btnEl._overrideTimer);
            btnEl._overrideTimer = null;
        }
        delete btnEl.dataset.confirmOverride;
        btnEl.classList.remove("btn-confirm-override");
        if (btnEl.dataset.savedHtml) {
            btnEl.innerHTML = btnEl.dataset.savedHtml;
            delete btnEl.dataset.savedHtml;
        }
    }
    window.resetConfirmOverrideState = resetConfirmOverrideState;

    async function handleDownloadWithGuards(url, title, formatParam, btnEl, originalHtml, item) {
        if (!btnEl || btnEl.disabled) return;

        const status = item ? item.status : null;

        // 1. Si en cours de téléchargement ou en file d'attente -> bloqué
        if (status === "downloading" || status === "queued") {
            return;
        }

        // 2. Si déjà présent dans le dossier temporaire -> confirmation explicite d'écrasement
        if (status === "temp") {
            const itemType = (item && item.type) || "élément";
            const itemLabel = itemType === "album" ? "Cet album" : (itemType === "playlist" ? "Cette playlist" : (itemType === "video" ? "Ce clip" : "Ce titre"));
            const displayTitle = title || (item && item.title) || "";
            const confirmed = await showModalConfirm(
                "Écraser le téléchargement temporaire ?",
                `${itemLabel} « ${displayTitle} » est déjà présent dans vos téléchargements temporaires.\n\nSouhaitez-vous le retélécharger et écraser le contenu temporaire existant ?`,
                "Écraser & Retélécharger",
                false,
                "Annuler"
            );
            if (!confirmed) return;
            return await downloadItemFromSearch(url, title, formatParam, btnEl, originalHtml, item);
        }

        // 3. Si déjà possédé dans la collection maître (ou exporté) -> double état au clic
        if (status === "owned_library" || status === "exported") {
            if (!btnEl.dataset.confirmOverride) {
                // 1er clic : armer la confirmation
                btnEl.dataset.confirmOverride = "true";
                btnEl.dataset.savedHtml = btnEl.innerHTML;
                btnEl.classList.add("btn-confirm-override");
                btnEl.innerHTML = `⚠️ Télécharger quand même ?`;

                if (btnEl._overrideTimer) clearTimeout(btnEl._overrideTimer);
                btnEl._overrideTimer = setTimeout(() => {
                    resetConfirmOverrideState(btnEl);
                }, 4500);
                return;
            } else {
                // 2ème clic : confirmé !
                resetConfirmOverrideState(btnEl);
                return await downloadItemFromSearch(url, title, formatParam, btnEl, originalHtml, item);
            }
        }

        // 4. Cas normal (non possédé)
        return await downloadItemFromSearch(url, title, formatParam, btnEl, originalHtml, item);
    }
    window.handleDownloadWithGuards = handleDownloadWithGuards;

    function updateCardStatusBadge(item) {
        if (!item || !item._cardElement) return;
        const thumbContainer = item._cardElement.querySelector(".search-thumb-container");
        if (!thumbContainer) return;

        const existingBadge = thumbContainer.querySelector(".search-status-badge");
        if (existingBadge) existingBadge.remove();

        const btnSendPlayer = item._cardElement.querySelector(".btn-send-to-player");
        let listenBtn = item._cardElement.querySelector(".btn-card-listen-local");

        if (item.status && item.statusLabel && item.statusBadgeClass) {
            const badge = document.createElement("span");
            badge.className = `search-status-badge ${item.statusBadgeClass}`;
            badge.textContent = item.statusLabel;
            if (item.localPath) {
                badge.title = `Local : ${item.localPath}`;
            }
            thumbContainer.appendChild(badge);

            // Bouton Écouter direct si l'album est déjà disponible localement (collection ou temporaire)
            if (item.localPath && (item.type === "album" || item.type === "playlist")) {
                if (!listenBtn) {
                    const row = item._cardElement.querySelector(".search-actions-row");
                    if (row) {
                        listenBtn = document.createElement("button");
                        listenBtn.type = "button";
                        listenBtn.className = "btn btn-secondary search-card-subaction-btn btn-card-listen-local";
                        listenBtn.title = "Écouter cet album dans le Lecteur Audio";
                        listenBtn.innerHTML = `▶ Écouter`;
                        listenBtn.addEventListener("click", () => {
                            if (typeof window.AudioPlayer !== "undefined" && typeof window.AudioPlayer.resetPlayerScrollRobust === "function") {
                                window.AudioPlayer.resetPlayerScrollRobust();
                            }
                            AudioPlayer.loadAlbum(item.localPath, 0, item.status === "owned_library");
                            switchTab("tab-player");
                        });
                        row.insertBefore(listenBtn, row.firstChild);
                    }
                }
                // Si l'album est disponible localement, masquer l'icône casque d'écoute en ligne
                if (btnSendPlayer) {
                    btnSendPlayer.style.display = "none";
                }
            } else {
                if (listenBtn) listenBtn.remove();
                if (btnSendPlayer) btnSendPlayer.style.display = "";
            }
        } else {
            if (listenBtn) listenBtn.remove();
            if (btnSendPlayer) btnSendPlayer.style.display = "";
        }

        // Mise à jour de l'état des boutons de téléchargement de la carte selon le statut
        const dlButtons = item._cardElement.querySelectorAll(".search-card-download-btn");
        dlButtons.forEach(btn => {
            if (!btn.dataset.defaultHtml) {
                btn.dataset.defaultHtml = btn.innerHTML;
            }

            if (item.status === "downloading") {
                resetConfirmOverrideState(btn);
                btn.disabled = true;
                btn.classList.add("btn-dl-state-disabled");
                btn.title = "Déjà en cours de téléchargement";
                btn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" style="width: 12px; height: 12px; border-width: 2px; margin-right: 4px; display: inline-block;"></span>⚡ En cours`;
            } else if (item.status === "queued") {
                resetConfirmOverrideState(btn);
                btn.disabled = true;
                btn.classList.add("btn-dl-state-disabled");
                btn.title = "Déjà présent dans la file d'attente";
                btn.innerHTML = `⏳ En file`;
            } else {
                btn.disabled = false;
                btn.classList.remove("btn-dl-state-disabled");
                btn.title = "";
                if (!btn.dataset.confirmOverride && btn.dataset.defaultHtml) {
                    btn.innerHTML = btn.dataset.defaultHtml;
                }
            }
        });
    }
    window.updateCardStatusBadge = updateCardStatusBadge;

    async function enrichItemsWithLibraryStatus(items, allowAutoRefilter = true) {
        const targetItems = (items && items.length > 0) ? items : (window.currentSearchResults || currentRawResults || []);
        if (!targetItems || targetItems.length === 0) return;

        // Filtrer uniquement les éléments qui n'ont pas encore été enrichis
        const itemsToEnrich = targetItems.filter(it => !it._statusEnriched);
        if (itemsToEnrich.length === 0) {
            return;
        }

        try {
            const payload = itemsToEnrich.map(it => ({
                id: it.id || "",
                title: it.title || "",
                artist: it.artist || "",
                type: it.type || "album",
                url: it.url || ""
            }));
            const res = await fetch("/api/library/match-search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items: payload })
            });
            if (!res.ok) return;
            const data = await res.json();
            const matches = data.matches || [];
            let newlyOwnedCount = 0;

            matches.forEach((m, idx) => {
                const item = itemsToEnrich[idx];
                if (item) {
                    item._statusEnriched = true;
                    if (m && m.status && m.label && m.badge_class) {
                        item.status = m.status;
                        item.statusLabel = m.label;
                        item.statusBadgeClass = m.badge_class;
                        item.localPath = m.local_path;
                        if (m.status === "owned_library" || m.status === "temp" || m.status === "exported" || m.local_path) {
                            newlyOwnedCount++;
                        }
                    } else {
                        item.status = null;
                        item.statusLabel = null;
                        item.statusBadgeClass = null;
                        item.localPath = null;
                    }
                    updateCardStatusBadge(item);
                }
            });

            // Si le filtre "Masquer déjà possédés" est actif ET que des éléments possédés ont été découverts,
            // ré-appliquer le filtre une fois SANS ré-enrichir récursivement !
            if (allowAutoRefilter && hideOwnedFilterActive && newlyOwnedCount > 0) {
                applyFiltersAndSort(false);
                checkAutoLoadForHideOwned();
            }
        } catch (err) {
            console.warn("Erreur statut bibliothèque:", err);
        }
    }
    window.enrichItemsWithLibraryStatus = enrichItemsWithLibraryStatus;

    function createSearchResultCard(item) {
        if (item.artist) item.artist = cleanArtistName(item.artist);
        if (item.type === "artist" && item.title) item.title = cleanArtistName(item.title);

        const card = document.createElement("div");
        card.className = "search-result-card";

        const isConcert = Boolean(item.is_concert) || (
            (item.type === "video" || item.type === "track") && (
                (item.duration && (item.duration.split(":").length >= 3 || (item.duration.split(":").length === 2 && parseInt(item.duration.split(":")[0], 10) >= 20))) ||
                /(full\s+concert|live\s+at|live\s+in|concert\s+complet|live\s+tour|festival\s+live|live\s+session|live\s+show|en\s+concert)/i.test(item.title || "")
            )
        );
        if (isConcert) {
            item.is_concert = true;
            item.type = "video";
        }

        let typeLabel = "Titre";
        let typeClass = "badge-track";
        if (item.type === "artist") {
            typeLabel = "Artiste";
            typeClass = "badge-artist";
        } else if (item.type === "album") {
            if (item.subtype === "ep") {
                typeLabel = "EP";
                typeClass = "badge-ep";
            } else if (item.subtype === "single") {
                typeLabel = "Single";
                typeClass = "badge-single";
            } else {
                typeLabel = "Album";
                typeClass = "badge-album";
            }
        } else if (item.type === "playlist") {
            typeLabel = "Playlist";
            typeClass = "badge-playlist";
        } else if (isConcert) {
            typeLabel = "Concert";
            typeClass = "badge-concert";
        } else if (item.type === "video") {
            typeLabel = "Vidéo";
            typeClass = "badge-video";
        }

        const thumbSrc = item.thumbnail || "/static/placeholder-cover.svg";

        // Métadonnées affichées sous le titre (nb pistes, année, durée, album d'origine ou abonnés)
        let metaHtml = "";
        if (item.type === "artist") {
            if (item.subscribers) {
                metaHtml = `<div style="font-size: 0.8rem; color: #ec4899; font-weight: 600; margin-bottom: 8px;">🎤 ${escapeHtml(item.subscribers)}</div>`;
            }
        } else if (item.type === "album" || item.type === "playlist") {
            const parts = [];
            if (item.track_count) parts.push(`💿 ${escapeHtml(item.track_count)}`);
            if (item.year) parts.push(escapeHtml(item.year));
            if (parts.length > 0) {
                metaHtml = `<div style="font-size: 0.78rem; color: #10b981; font-weight: 500; margin-bottom: 8px;">${parts.join(" • ")}</div>`;
            }
        } else if (isConcert) {
            metaHtml = `<div style="margin-bottom: 8px;"><span class="badge-concert-tag">🎸 Concert & Live ${item.duration ? `(${escapeHtml(item.duration)})` : ''}</span></div>`;
        } else if (item.type === "track") {
            const parts = [];
            if (item.album) parts.push(`💿 ${escapeHtml(item.album)}`);
            if (item.duration) parts.push(`⏱ ${escapeHtml(item.duration)}`);
            if (parts.length > 0) {
                metaHtml = `<div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 8px;">${parts.join(" • ")}</div>`;
            }
        } else if (item.duration) {
            metaHtml = `<div style="font-size: 0.78rem; color: var(--text-muted); font-family: var(--font-mono); margin-bottom: 8px;">⏱ ${escapeHtml(item.duration)}</div>`;
        }

        const hasArtistBtn = item.artist && item.artist !== "Artiste inconnu" && item.artist !== "Various Artists" && item.type !== "artist";
        const artistBtnHtml = hasArtistBtn ? `
            <button type="button" class="btn btn-secondary search-card-subaction-btn btn-card-artist" title="Rechercher spécifiquement l'artiste « ${escapeHtml(item.artist)} »">
                🎤 Artiste
            </button>
        ` : "";

        // Construction des boutons d'actions selon le type
        let actionsHtml = "";
        if (item.type === "artist") {
            actionsHtml = `
                <div class="search-card-actions">
                    <button type="button" class="btn btn-primary search-card-download-btn btn-artist-albums" title="Afficher tous les albums officiels de cet artiste">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"/></svg>
                        💿 Voir ses albums
                    </button>
                    <div class="search-actions-row">
                        <button type="button" class="btn btn-secondary search-card-subaction-btn btn-artist-gap-finder" title="Comparer sa discographie avec votre collection et lister les albums manquants">
                            💿 Albums manquants
                        </button>
                        <button type="button" class="btn btn-secondary search-card-subaction-btn btn-search-artist-all" title="Rechercher tous les contenus (albums, singles, clips) de cet artiste">
                            🔍 Tout afficher
                        </button>
                        <a href="${escapeHtml(item.url)}" target="_blank" class="search-card-link-btn" title="Ouvrir la page officielle">
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
                        </a>
                    </div>
                </div>
            `;
        } else if (item.type === "album" || item.type === "playlist") {
            let labelBtn = "Télécharger l'album";
            if (item.type === "playlist") {
                labelBtn = "Télécharger la playlist";
            } else if (item.subtype === "ep") {
                labelBtn = "Télécharger l'EP";
            } else if (item.subtype === "single") {
                labelBtn = "Télécharger le single";
            }
            actionsHtml = `
                <div class="search-card-actions">
                    <div class="search-actions-row">
                        <button type="button" class="btn btn-primary search-card-download-btn btn-dl-main">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                            ${labelBtn}
                        </button>
                        <button type="button" class="search-card-listen-btn btn-send-to-player" title="Charger et écouter l'album dans le Lecteur Audio">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1a7 7 0 0 1 14 0v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9z"/></svg>
                        </button>
                    </div>
                    <div class="search-actions-row">
                        <button type="button" class="btn btn-secondary search-card-subaction-btn search-card-preview-btn" title="Voir la liste des pistes et détecter les morceaux grisés">
                            👁 Pistes
                        </button>
                        ${artistBtnHtml}
                        <a href="${escapeHtml(item.url)}" target="_blank" class="search-card-link-btn" title="Ouvrir le lien source">
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
                        </a>
                    </div>
                </div>
            `;
        } else if (item.type === "video") {
            actionsHtml = `
                <div class="search-card-actions">
                    <div class="search-actions-row">
                        <button type="button" class="btn btn-primary search-card-download-btn btn-dl-audio" title="Télécharger la piste audio (.m4a/.ogg)">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                            Audio
                        </button>
                        <button type="button" class="btn btn-video-dl search-card-download-btn btn-dl-video" title="${isConcert ? "Télécharger le concert vidéo (.mp4)" : "Télécharger le clip vidéo (.mp4)"}">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
                            ${isConcert ? "Concert MP4" : "Clip MP4"}
                        </button>
                    </div>
                    <div class="search-actions-row">
                        <button type="button" class="btn btn-secondary search-card-subaction-btn search-card-play-btn" title="Écouter l'extrait audio">
                            ▶ Écouter
                        </button>
                        <button type="button" class="btn btn-secondary search-card-subaction-btn search-card-view-video-btn" title="${isConcert ? "Regarder le concert dans l'application" : "Regarder le clip vidéo dans l'application"}">
                            ${isConcert ? "👁 Voir concert" : "👁 Voir clip"}
                        </button>
                        ${artistBtnHtml}
                        <a href="${escapeHtml(item.url)}" target="_blank" class="search-card-link-btn" title="Ouvrir le flux source">
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
                        </a>
                    </div>
                </div>
            `;
        } else {
            // item.type === "track"
            actionsHtml = `
                <div class="search-card-actions">
                    <div class="search-actions-row">
                        <button type="button" class="btn btn-primary search-card-download-btn btn-dl-main">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                            Télécharger le titre
                        </button>
                        <button type="button" class="search-card-listen-btn btn-send-to-player" title="Écouter dans le Lecteur Audio">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1a7 7 0 0 1 14 0v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9z"/></svg>
                        </button>
                    </div>
                    <div class="search-actions-row">
                        <button type="button" class="btn btn-secondary search-card-subaction-btn search-card-play-btn" title="Écouter l'extrait">
                            ▶ Écouter
                        </button>
                        <button type="button" class="btn btn-secondary search-card-subaction-btn search-card-view-video-btn" title="Regarder la vidéo dans l'application">
                            👁 Clip
                        </button>
                        ${artistBtnHtml}
                        <a href="${escapeHtml(item.url)}" target="_blank" class="search-card-link-btn" title="Ouvrir le lien source">
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
                        </a>
                    </div>
                </div>
            `;
        }

        const isArtistCard = item.type === "artist";
        const thumbContainerClass = isArtistCard ? "search-thumb-container artist-thumb-container" : "search-thumb-container";
        const artistLineHtml = isArtistCard 
            ? `<p class="search-card-artist" title="Fiche artiste officielle">🎤 Profil officiel</p>`
            : `<p class="search-card-artist" title="${escapeHtml(item.artist)}">
                <span>${escapeHtml(item.artist)}</span>
                ${hasArtistBtn ? `<button type="button" class="btn-artist-search-jump" title="Rechercher l'artiste « ${escapeHtml(item.artist)} »" data-artist="${escapeHtml(item.artist)}">🎤</button>` : ""}
               </p>`;

        card.innerHTML = `
            <div class="${thumbContainerClass}">
                <img class="search-thumb-img" src="${escapeHtml(thumbSrc)}" data-orig-src="${escapeHtml(thumbSrc)}" alt="${escapeHtml(item.title)}" referrerpolicy="no-referrer" onerror="window.handleCoverError(this);">
                <span class="search-type-badge ${typeClass}">${typeLabel}</span>
                ${item.duration ? `<span class="search-duration-badge">${escapeHtml(item.duration)}</span>` : ""}
            </div>
            <div class="search-card-body">
                <div>
                    <h4 class="search-card-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</h4>
                    ${artistLineHtml}
                    <div class="search-card-meta-container">${metaHtml}</div>
                </div>
                ${actionsHtml}
            </div>
        `;

        item._cardElement = card;

        // Clic sur "💿 Voir ses albums" (pour fiche artiste) : charge la discographie officielle 100% pure
        const btnArtistAlbums = card.querySelector(".btn-artist-albums");
        if (btnArtistAlbums) {
            btnArtistAlbums.addEventListener("click", () => {
                loadArtistDiscography(item.id, item.title);
            });
        }

        // Clic sur "💿 Albums manquants" (pour fiche artiste)
        const btnArtistGap = card.querySelector(".btn-artist-gap-finder");
        if (btnArtistGap) {
            btnArtistGap.addEventListener("click", () => {
                openGapFinderModal(item.title, item.id);
            });
        }

        // Clic sur "🔍 Tout afficher" (pour fiche artiste)
        const btnArtistAll = card.querySelector(".btn-search-artist-all");
        if (btnArtistAll) {
            btnArtistAll.addEventListener("click", () => {
                queryInput.value = item.title;
                clearBtn.style.display = "block";
                try {
                    localStorage.setItem("ytm_search_query", item.title);
                } catch (e) {}
                currentFilter = "all";
                if (searchTypeSelect) searchTypeSelect.value = "all";
                try {
                    localStorage.setItem("ytm_search_filter", "all");
                } catch (e) {}
                performSearch(item.title, "all");
            });
        }

        // Clic sur les boutons de recherche ciblée artiste
        const cardArtistBtns = card.querySelectorAll(".btn-card-artist, .btn-artist-search-jump");
        cardArtistBtns.forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                promptTargetedArtistSearch(item.artist);
            });
        });

        // Clic sur "🎧 Envoyer au Lecteur" (depuis la tuile)
        const btnSendPlayer = card.querySelector(".btn-send-to-player");
        if (btnSendPlayer) {
            btnSendPlayer.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (typeof window.AudioPlayer !== "undefined" && typeof window.AudioPlayer.resetPlayerScrollRobust === "function") {
                    window.AudioPlayer.resetPlayerScrollRobust();
                }
                if (item.type === "album" || item.type === "playlist") {
                    await playOnlineAlbumFromItem(item, btnSendPlayer);
                } else {
                    playTrack(item.title, item.artist, thumbSrc, item.id, item.album, item.url, item);
                    if (typeof enterPlayerMode === "function") {
                        enterPlayerMode();
                    }
                }
            });
        }

        // Clic sur "👁 Pistes" (si Album ou Playlist)
        const previewBtn = card.querySelector(".search-card-preview-btn");
        if (previewBtn) {
            previewBtn.addEventListener("click", () => {
                openAlbumPreview(item);
            });
        }

        // Clic sur "▶ Écouter"
        const playBtn = card.querySelector(".search-card-play-btn");
        if (playBtn) {
            playBtn.addEventListener("click", () => {
                playTrack(item.title, item.artist, thumbSrc, item.id, item.album, item.url, item);
            });
        }

        // Clic sur "👁 Voir le clip" (si Vidéo ou Titre)
        const viewVideoBtn = card.querySelector(".search-card-view-video-btn");
        if (viewVideoBtn) {
            viewVideoBtn.addEventListener("click", () => {
                openVideoModal(item);
            });
        }

        // Clic sur bouton principal Télécharger (Album / Titre / Playlist)
        const dlMainBtn = card.querySelector(".btn-dl-main");
        if (dlMainBtn) {
            const origHtml = dlMainBtn.innerHTML;
            dlMainBtn.dataset.defaultHtml = origHtml;
            dlMainBtn.addEventListener("click", () => {
                const fmt = currentConfig.default_format || (document.getElementById("format-select") ? document.getElementById("format-select").value : "m4a");
                handleDownloadWithGuards(item.url, item.title, fmt, dlMainBtn, origHtml, item);
            });
        }

        // Clic sur Audio (pour Vidéo)
        const dlAudioBtn = card.querySelector(".btn-dl-audio");
        if (dlAudioBtn) {
            const origHtml = dlAudioBtn.innerHTML;
            dlAudioBtn.dataset.defaultHtml = origHtml;
            dlAudioBtn.addEventListener("click", () => {
                const fmt = currentConfig.default_format || (document.getElementById("format-select") ? document.getElementById("format-select").value : "m4a");
                handleDownloadWithGuards(item.url, item.title, fmt, dlAudioBtn, origHtml, item);
            });
        }

        // Clic sur Clip MP4 (pour Vidéo)
        const dlVideoBtn = card.querySelector(".btn-dl-video");
        if (dlVideoBtn) {
            const origHtml = dlVideoBtn.innerHTML;
            dlVideoBtn.dataset.defaultHtml = origHtml;
            dlVideoBtn.addEventListener("click", () => {
                handleDownloadWithGuards(item.url, item.title, "mp4", dlVideoBtn, origHtml, item);
            });
        }

        if (item.status && item.statusLabel && item.statusBadgeClass) {
            updateCardStatusBadge(item);
        }

        return card;
    }
    window.createSearchResultCard = createSearchResultCard;

    function normalizeArtistForMatch(text) {
        if (!text) return "";
        return String(text)
            .toLowerCase()
            // Retirer les suffixes de chaînes Topic / Thème de YouTube
            .replace(/\s*(?:[\-–—]\s*|\()(?:topic|th[eè]me)\)?\s*$/i, "")
            // Remplacer & et + par ' and ' pour aligner 'Whiskey&Lead' et 'whiskey & lead'
            .replace(/[&+]/g, " and ")
            // Supprimer les accents / diacritiques
            .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
            // Retirer les articles initiaux fréquents (the, les, la, le, etc.)
            .replace(/^(?:the|les?|la|l'|une?|un|der|die|das)\s+/i, "")
            // Remplacer toute ponctuation restante par un espace
            .replace(/[^a-z0-9\s]/g, " ")
            // Compacter les espaces multiples
            .replace(/\s+/g, " ")
            .trim();
    }

    function isArtistMatch(artistA, artistB) {
        const a = normalizeArtistForMatch(artistA);
        const b = normalizeArtistForMatch(artistB);
        if (!a || !b) return false;
        if (a === b) return true;
        if (a.includes(b) || b.includes(a)) return true;

        // Comparaison sans espaces (ex: 'acdc' vs 'ac dc')
        const noSpaceA = a.replace(/\s+/g, "");
        const noSpaceB = b.replace(/\s+/g, "");
        if (noSpaceA === noSpaceB || noSpaceA.includes(noSpaceB) || noSpaceB.includes(noSpaceA)) return true;

        // Recouvrement des tokens pour artistes multi-mots (indice de Jaccard >= 0.75)
        const tokensA = new Set(a.split(/\s+/).filter(Boolean));
        const tokensB = new Set(b.split(/\s+/).filter(Boolean));
        if (tokensA.size === 0 || tokensB.size === 0) return false;
        let intersection = 0;
        tokensA.forEach(t => { if (tokensB.has(t)) intersection++; });
        const union = new Set([...tokensA, ...tokensB]).size;
        return (intersection / union) >= 0.75;
    }

    function filterResults(items) {
        let res = items;

        // 1. Filtrage strict par artiste (si activé manuellement en recherche textuelle d'albums)
        if (strictArtistFilterActive && currentArtistLock && currentFilter === "album") {
            res = res.filter(item => {
                const itemArtist = item.artist || (item.type === "artist" ? item.title : "");
                if (!itemArtist) return false;
                return isArtistMatch(itemArtist, currentArtistLock);
            });
        }

        // 2. Masquage des éléments déjà possédés (collection ou temporaire)
        if (hideOwnedFilterActive) {
            res = res.filter(item => {
                const s = item.status;
                if (s === "owned_library" || s === "temp" || s === "exported" || item.localPath) {
                    return false;
                }
                return true;
            });
        }

        // 3. Sous-filtres LP vs Single/EP
        if (currentFilter !== "album" || currentAlbumSubfilter === "all") {
            return res;
        }
        return res.filter(item => {
            const subtype = (item.subtype || "").toLowerCase();
            const trackCount = parseInt(item.track_count, 10);
            const hasTrackCount = !isNaN(trackCount);

            if (currentAlbumSubfilter === "lp") {
                if (subtype === "single" || subtype === "ep") return false;
                if (hasTrackCount && trackCount < 6) return false;
                return true;
            } else if (currentAlbumSubfilter === "single_ep") {
                if (subtype === "single" || subtype === "ep") return true;
                if (hasTrackCount && trackCount > 0 && trackCount < 6) return true;
                return false;
            }
            return true;
        });
    }

    function sortResults(items) {
        const list = [...items];
        switch (currentSort) {
            case "year-asc":
                return list.sort((a, b) => {
                    const yA = parseInt(a.year, 10) || 9999;
                    const yB = parseInt(b.year, 10) || 9999;
                    if (yA !== yB) return yA - yB;
                    return (a._originalIndex ?? 0) - (b._originalIndex ?? 0);
                });
            case "year-desc":
                return list.sort((a, b) => {
                    const yA = parseInt(a.year, 10) || 0;
                    const yB = parseInt(b.year, 10) || 0;
                    if (yA !== yB) return yB - yA;
                    return (a._originalIndex ?? 0) - (b._originalIndex ?? 0);
                });
            case "tracks-desc":
                return list.sort((a, b) => {
                    const tA = parseInt(a.track_count, 10) || 0;
                    const tB = parseInt(b.track_count, 10) || 0;
                    if (tA !== tB) return tB - tA;
                    return (a._originalIndex ?? 0) - (b._originalIndex ?? 0);
                });
            case "alpha-asc":
                return list.sort((a, b) => {
                    const tA = a.title || "";
                    const tB = b.title || "";
                    const cmp = tA.localeCompare(tB, "fr", { sensitivity: "base" });
                    if (cmp !== 0) return cmp;
                    return (a._originalIndex ?? 0) - (b._originalIndex ?? 0);
                });
            case "relevance":
            default:
                return list.sort((a, b) => (a._originalIndex ?? 0) - (b._originalIndex ?? 0));
        }
    }

    function applyFiltersAndSort(shouldEnrich = true) {
        const filtered = filterResults(currentRawResults);
        const sorted = sortResults(filtered);

        resultsGrid.innerHTML = "";
        sorted.forEach(item => {
            if (!item._cardElement) {
                item._cardElement = createSearchResultCard(item);
            }
            resultsGrid.appendChild(item._cardElement);
        });

        // Enrichir en tâche de fond le statut de collection (badge vert, exporté, temporaire, etc.)
        if (shouldEnrich) {
            enrichItemsWithLibraryStatus(sorted, true);
        }

        if (hideOwnedFilterActive || (currentFilter === "album" && (currentAlbumSubfilter !== "all" || (strictArtistFilterActive && currentArtistLock)))) {
            resultsCount.textContent = `${sorted.length} sur ${currentRawResults.length} résultat(s) affiché(s)`;
        } else {
            resultsCount.textContent = `${currentRawResults.length} résultat(s) trouvé(s)`;
        }

        if (sorted.length === 0 && currentRawResults.length > 0) {
            const emptyMsg = document.createElement("div");
            emptyMsg.className = "text-muted";
            emptyMsg.style.gridColumn = "1 / -1";
            emptyMsg.style.textAlign = "center";
            emptyMsg.style.padding = "40px 10px";
            emptyMsg.style.fontSize = "0.95rem";
            let reason = "";
            if (strictArtistFilterActive && currentArtistLock && currentAlbumSubfilter !== "all") {
                const subLabel = currentAlbumSubfilter === "lp" ? "Albums Studio" : "Singles & EPs";
                reason = `aux critères combinés (Artiste strict « <strong>${escapeHtml(currentArtistLock)}</strong> » et sous-filtre <strong>${subLabel}</strong>)`;
            } else if (strictArtistFilterActive && currentArtistLock) {
                reason = `au filtre artiste strict « <strong>${escapeHtml(currentArtistLock)}</strong> »`;
            } else if (currentAlbumSubfilter !== "all") {
                const subLabel = currentAlbumSubfilter === "lp" ? "Albums Studio" : "Singles & EPs";
                reason = `au sous-filtre <strong>${subLabel}</strong>`;
            } else if (hideOwnedFilterActive) {
                reason = `au filtre « Masquer déjà possédés » (tous les éléments chargés font déjà partie de votre collection)`;
            } else {
                reason = `aux filtres actifs`;
            }
            emptyMsg.innerHTML = `⚠️ Aucun résultat ne correspond ${reason} parmi les résultats actuellement chargés.<br><span style="font-size: 0.82rem; opacity: 0.8;">Vous pouvez cliquer sur « ➕ Voir plus de résultats » ci-dessous pour en charger davantage.</span>`;
            resultsGrid.appendChild(emptyMsg);
        }
    }

    async function performSearch(query, filter) {
        // Réinitialiser le mode discographie officielle lors d'une recherche textuelle standard
        isOfficialDiscographyMode = false;
        if (artistDiscographyBanner) artistDiscographyBanner.style.display = "none";
        currentArtistLock = query.trim();

        placeholder.style.display = "none";
        errorBox.style.display = "none";
        resultsContainer.style.display = "none";
        if (loadMoreContainer) loadMoreContainer.style.display = "none";
        if (allHint) allHint.style.display = "none";
        loading.style.display = "flex";
        const loadingText = document.getElementById("search-loading-text");
        if (loadingText) loadingText.textContent = "Recherche en cours...";
        submitBtn.disabled = true;
        autoLoadConsecutiveCount = 0;
        currentContinuationToken = null;
        currentRawResults = [];

        try {
            const res = await fetch(`/api/search?query=${encodeURIComponent(query)}&filter_type=${encodeURIComponent(filter)}`);
            const data = await res.json();

            loading.style.display = "none";
            submitBtn.disabled = false;

            if (data.error && (!data.results || data.results.length === 0)) {
                errorBox.style.display = "flex";
                errorText.textContent = data.error;
                return;
            }

            const results = data.results || [];
            if (results.length === 0) {
                errorBox.style.display = "flex";
                errorText.textContent = "Aucun résultat trouvé pour cette recherche.";
                return;
            }

            // Indexation initiale des résultats pour la pertinence
            results.forEach((item, idx) => {
                item._originalIndex = idx;
            });
            currentRawResults = results;
            window.currentSearchResults = results;

            // Afficher le groupe de sous-filtres uniquement pour les albums
            if (albumSubfiltersGroup) {
                albumSubfiltersGroup.style.display = (filter === "album" && results.length > 0) ? "inline-flex" : "none";
            }
            if (btnStrictArtist) {
                btnStrictArtist.style.display = (filter === "album" && results.length > 0) ? "inline-flex" : "none";
                btnStrictArtist.classList.toggle("active", strictArtistFilterActive);
                btnStrictArtist.title = `Ne garder que les albums créés par « ${escapeHtml(currentArtistLock)} » (masquer hommages, reprises et tiers)`;
            }

            // Rendre le conteneur visible avant d'insérer les cartes pour éviter les problèmes de rendu Chromium/Blink
            resultsContainer.style.display = "block";

            // Affichage et tri initial
            applyFiltersAndSort();

            currentContinuationToken = data.continuation || null;
            if (currentContinuationToken) {
                if (loadMoreContainer) loadMoreContainer.style.display = "flex";
                if (hideOwnedFilterActive) {
                    checkAutoLoadForHideOwned();
                }
            } else if (filter === "all" && results.length >= 20) {
                if (allHint) allHint.style.display = "block";
            }

        } catch (err) {
            loading.style.display = "none";
            submitBtn.disabled = false;
            errorBox.style.display = "flex";
            errorText.textContent = `Erreur lors de la recherche : ${err.message}`;
        }
    }

    async function loadArtistDiscography(browseId, artistName) {
        if (!browseId) {
            performSearch(artistName, "album");
            return;
        }

        // Mémoriser l'état précédent de la recherche pour le bouton retour
        savedSearchBeforeDiscography = {
            query: queryInput.value,
            filter: currentFilter
        };

        isOfficialDiscographyMode = true;
        placeholder.style.display = "none";
        errorBox.style.display = "none";
        resultsContainer.style.display = "none";
        if (loadMoreContainer) loadMoreContainer.style.display = "none";
        if (allHint) allHint.style.display = "none";
        loading.style.display = "flex";
        const loadingText = document.getElementById("search-loading-text");
        if (loadingText) loadingText.textContent = `Chargement de la discographie officielle de ${artistName}...`;
        submitBtn.disabled = true;
        currentContinuationToken = null;
        currentRawResults = [];

        try {
            const res = await fetch(`/api/artist/discography?browse_id=${encodeURIComponent(browseId)}&artist_name=${encodeURIComponent(artistName)}`);
            const data = await res.json();

            loading.style.display = "none";
            submitBtn.disabled = false;

            if (data.error && (!data.results || data.results.length === 0)) {
                isOfficialDiscographyMode = false;
                performSearch(artistName, "album");
                return;
            }

            const results = data.results || [];
            if (results.length === 0) {
                isOfficialDiscographyMode = false;
                performSearch(artistName, "album");
                return;
            }

            // Indexation
            results.forEach((item, idx) => {
                item._originalIndex = idx;
            });
            currentRawResults = results;
            window.currentSearchResults = results;

            // Filtre album
            currentFilter = "album";
            if (searchTypeSelect) searchTypeSelect.value = "album";
            try { localStorage.setItem("ytm_search_filter", "album"); } catch(e) {}

            currentArtistLock = artistName;
            queryInput.value = artistName;
            clearBtn.style.display = "block";

            // Affichage du bandeau de discographie certifiée
            if (artistDiscographyBanner && discographyBannerTitle) {
                discographyBannerTitle.textContent = `Discographie officielle : ${artistName} (${results.length} sorties)`;
                artistDiscographyBanner.style.display = "flex";
            }

            // Affichage des sous-filtres d'albums
            if (albumSubfiltersGroup) {
                albumSubfiltersGroup.style.display = "inline-flex";
            }
            if (btnStrictArtist) {
                // En mode discographie certifiée, les résultats sont déjà 100% garantis de l'artiste
                strictArtistFilterActive = false;
                btnStrictArtist.classList.remove("active");
                btnStrictArtist.style.display = "none";
            }

            resultsContainer.style.display = "block";
            applyFiltersAndSort();

        } catch (err) {
            loading.style.display = "none";
            submitBtn.disabled = false;
            isOfficialDiscographyMode = false;
            performSearch(artistName, "album");
        }
    }

    // Restauration des préférences et du texte de recherche sauvegardés
    try {
        const savedFilter = localStorage.getItem("ytm_search_filter");
        if (savedFilter) {
            currentFilter = savedFilter;
            if (searchTypeSelect) {
                searchTypeSelect.value = savedFilter;
            }
        }
        const savedSort = localStorage.getItem("ytm_search_sort");
        if (savedSort && sortSelect) {
            sortSelect.value = savedSort;
            currentSort = savedSort;
        }
        const savedSubfilter = localStorage.getItem("ytm_album_subfilter");
        if (savedSubfilter) {
            const targetSub = document.querySelector(`#album-subfilter-pills .subfilter-pill[data-subfilter="${savedSubfilter}"]`);
            if (targetSub) {
                albumSubfilterPills.forEach(p => p.classList.remove("active"));
                targetSub.classList.add("active");
                currentAlbumSubfilter = savedSubfilter;
            }
        }
        const savedQuery = localStorage.getItem("ytm_search_query");
        if (savedQuery) {
            queryInput.value = savedQuery;
            clearBtn.style.display = "block";
        }
    } catch (e) {}

    window.refreshSearchBadges = () => {
        if (typeof enrichItemsWithLibraryStatus === "function") {
            if (currentRawResults && currentRawResults.length > 0) {
                currentRawResults.forEach(it => { delete it._statusEnriched; });
            }
            enrichItemsWithLibraryStatus(currentRawResults, true);
        }
    };
    window.applySearchFiltersAndSort = () => applyFiltersAndSort();

    window.searchArtistStrictUnowned = (artistName) => {
        if (!artistName || !artistName.trim()) return;
        if (window.isPartyLockActive) return;

        const trimmed = artistName.trim();

        // 1. Basculer vers l'onglet Recherche (quitte proprement le Mode Lecteur)
        switchTab("tab-search");

        // 2. Renseigner le champ de recherche
        queryInput.value = trimmed;
        clearBtn.style.display = "block";
        try {
            localStorage.setItem("ytm_search_query", trimmed);
        } catch (e) {}

        // 3. Définir le filtre sur Album (requis pour l'Artiste Strict et le filtrage des possédés)
        currentFilter = "album";
        if (searchTypeSelect) searchTypeSelect.value = "album";
        try {
            localStorage.setItem("ytm_search_filter", "album");
        } catch (e) {}

        // 4. Réinitialiser les sous-filtres d'albums sur "Tous"
        currentAlbumSubfilter = "all";
        if (albumSubfilterPills) {
            albumSubfilterPills.forEach(p => {
                p.classList.toggle("active", p.getAttribute("data-subfilter") === "all");
            });
        }
        try {
            localStorage.setItem("ytm_album_subfilter", "all");
        } catch (e) {}

        // 5. Verrouiller le Mode Artiste Strict
        strictArtistFilterActive = true;
        currentArtistLock = trimmed;
        if (btnStrictArtist) {
            btnStrictArtist.style.display = "inline-flex";
            btnStrictArtist.classList.add("active");
            btnStrictArtist.title = `Ne garder que les albums créés par « ${escapeHtml(trimmed)} » (masquer hommages, reprises et tiers)`;
        }
        if (albumSubfiltersGroup) {
            albumSubfiltersGroup.style.display = "inline-flex";
        }

        // 6. Activer le filtre "Masquer déjà possédés"
        hideOwnedFilterActive = true;
        if (btnFilterHideOwned) {
            btnFilterHideOwned.classList.add("active");
        }

        // 7. Déclencher la recherche
        performSearch(trimmed, "album");

        showToast(`Recherche des albums non possédés pour « ${trimmed} » (Artiste strict)...`, "info");
    };
}


// =========================================================
// Aperçu des Pistes d'Album & Détection Pistes Grisées
// =========================================================
// currentPreviewAlbum on window

function setupAlbumPreview() {
    const backdrop = document.getElementById("preview-modal-backdrop");
    const closeBtn = document.getElementById("preview-modal-close-btn");
    const cancelBtn = document.getElementById("preview-modal-cancel-btn");
    const downloadAllBtn = document.getElementById("preview-download-all-btn");
    const playAllBtn = document.getElementById("preview-play-all-btn");

    if (!backdrop) return;

    function closePreview() {
        if (downloadAllBtn) resetConfirmOverrideState(downloadAllBtn);
        backdrop.classList.remove("active");
        setTimeout(() => {
            backdrop.style.display = "none";
            currentPreviewAlbum = null;
        }, 200);
    }

    closeBtn.addEventListener("click", closePreview);
    cancelBtn.addEventListener("click", closePreview);

    if (playAllBtn) {
        playAllBtn.addEventListener("click", () => {
            if (!currentPreviewAlbum) return;
            const albumToPlay = currentPreviewAlbum;
            closePreview();
            playOnlineAlbumFromItem(albumToPlay);
        });
    }

    backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) closePreview();
    });

    downloadAllBtn.addEventListener("click", async () => {
        if (!currentPreviewAlbum || !currentPreviewAlbum.url) return;
        if (downloadAllBtn.disabled) return;

        const status = currentPreviewAlbum.status;
        if (status === "downloading" || status === "queued") return;

        if (status === "temp") {
            const confirmed = await showModalConfirm(
                "Écraser le téléchargement temporaire ?",
                `« ${currentPreviewAlbum.title} » est déjà présent dans vos téléchargements temporaires.\n\nSouhaitez-vous le retélécharger et écraser le contenu temporaire existant ?`,
                "Écraser & Retélécharger",
                false,
                "Annuler"
            );
            if (!confirmed) return;
        } else if (status === "owned_library" || status === "exported") {
            if (!downloadAllBtn.dataset.confirmOverride) {
                downloadAllBtn.dataset.confirmOverride = "true";
                downloadAllBtn.dataset.savedHtml = downloadAllBtn.innerHTML;
                downloadAllBtn.classList.add("btn-confirm-override");
                downloadAllBtn.innerHTML = `⚠️ Télécharger quand même ?`;
                if (downloadAllBtn._overrideTimer) clearTimeout(downloadAllBtn._overrideTimer);
                downloadAllBtn._overrideTimer = setTimeout(() => {
                    resetConfirmOverrideState(downloadAllBtn);
                }, 4500);
                return;
            } else {
                resetConfirmOverrideState(downloadAllBtn);
            }
        }

        downloadAllBtn.disabled = true;
        downloadAllBtn.innerHTML = `⏳ Ajout...`;

        try {
            const defaultFormat = currentConfig.default_format || "m4a";
            const defaultQuality = currentConfig.default_quality || "auto";
            const autoRetag = currentConfig.auto_retag !== false;
            const namingPattern = currentConfig.naming_pattern || "{track:02d} {title}";
            const cleanTitles = currentConfig.clean_titles !== false;

            const isPlaylist = isPlaylistUrlOrItem(currentPreviewAlbum, currentPreviewAlbum ? currentPreviewAlbum.url : null);

            const res = await fetch("/api/download", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    url: currentPreviewAlbum.url,
                    title: currentPreviewAlbum.title,
                    format: defaultFormat,
                    quality: defaultQuality,
                    auto_retag: autoRetag,
                    naming_pattern: namingPattern,
                    clean_titles: cleanTitles,
                    is_playlist: isPlaylist,
                    custom_album: isPlaylist ? currentPreviewAlbum.title : null,
                    custom_artist: isPlaylist ? currentPreviewAlbum.artist : null,
                    thumbnail_url: currentPreviewAlbum.thumbnail || null
                })
            });

            const data = await res.json();
            if (data.success) {
                currentPreviewAlbum.status = "queued";
                currentPreviewAlbum.statusLabel = "⏳ En file";
                currentPreviewAlbum.statusBadgeClass = "badge-status-queued";
                if (typeof window.updateCardStatusBadge === "function") {
                    window.updateCardStatusBadge(currentPreviewAlbum);
                }
                showToast(`"${currentPreviewAlbum.title}" ajouté à la file d'attente !`, "Voir la file", () => {
                    switchTab("tab-download");
                });
                closePreview();
            } else {
                await showModalAlert("Erreur", data.detail || "Erreur lors de l'ajout.", "danger");
            }
        } catch (err) {
            await showModalAlert("Erreur réseau", err.message, "danger");
        } finally {
            downloadAllBtn.disabled = false;
            const isPlaylist = isPlaylistUrlOrItem(currentPreviewAlbum, currentPreviewAlbum ? currentPreviewAlbum.url : null);
            let btnLabel = isPlaylist ? "Télécharger toute la playlist" : "Télécharger tout l'album";
            if (!isPlaylist && currentPreviewAlbum) {
                if (currentPreviewAlbum.subtype === "ep") {
                    btnLabel = "Télécharger tout l'EP";
                } else if (currentPreviewAlbum.subtype === "single") {
                    btnLabel = "Télécharger le single";
                }
            }
            const downloadAllText = document.getElementById("preview-download-all-text");
            if (downloadAllText) {
                downloadAllText.textContent = btnLabel;
            } else {
                downloadAllBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> <span id="preview-download-all-text">${btnLabel}</span>`;
            }
        }
    });
}

async function openAlbumPreview(album) {
    const backdrop = document.getElementById("preview-modal-backdrop");
    const coverEl = document.getElementById("preview-modal-cover");
    const titleEl = document.getElementById("preview-modal-title");
    const artistEl = document.getElementById("preview-modal-artist");
    const typeBadge = document.getElementById("preview-type-badge");
    const availBadge = document.getElementById("preview-availability-badge");
    const tracksLoading = document.getElementById("preview-tracks-loading");
    const tracksList = document.getElementById("preview-tracks-list");
    const downloadAllBtn = document.getElementById("preview-download-all-btn");
    const downloadAllText = document.getElementById("preview-download-all-text");
    const downloadMissingBtn = document.getElementById("preview-download-missing-btn");
    const downloadMissingText = document.getElementById("preview-download-missing-text");

    if (downloadMissingBtn) {
        downloadMissingBtn.style.display = "none";
        downloadMissingBtn.onclick = null;
    }

    currentPreviewAlbum = album;

    const isPlaylist = isPlaylistUrlOrItem(album, album.url);
    let typeName = isPlaylist ? "Playlist" : "Album";
    let badgeClass = isPlaylist ? "badge-playlist" : "badge-album";
    let btnLabel = isPlaylist ? "Télécharger toute la playlist" : "Télécharger tout l'album";

    if (!isPlaylist) {
        if (album.subtype === "ep") {
            typeName = "EP";
            badgeClass = "badge-ep";
            btnLabel = "Télécharger tout l'EP";
        } else if (album.subtype === "single") {
            typeName = "Single";
            badgeClass = "badge-single";
            btnLabel = "Télécharger le single";
        }
    }

    if (downloadAllBtn) {
        resetConfirmOverrideState(downloadAllBtn);
        if (album.status === "downloading") {
            downloadAllBtn.disabled = true;
            downloadAllBtn.classList.add("btn-dl-state-disabled");
            btnLabel = "⚡ En cours de téléchargement";
            downloadAllBtn.title = "Déjà en cours de téléchargement";
        } else if (album.status === "queued") {
            downloadAllBtn.disabled = true;
            downloadAllBtn.classList.add("btn-dl-state-disabled");
            btnLabel = "⏳ Déjà dans la file d'attente";
            downloadAllBtn.title = "Déjà présent dans la file d'attente";
        } else {
            downloadAllBtn.disabled = false;
            downloadAllBtn.classList.remove("btn-dl-state-disabled");
            downloadAllBtn.title = "";
        }
    }

    if (downloadAllText) {
        downloadAllText.textContent = btnLabel;
    } else if (downloadAllBtn) {
        downloadAllBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> <span id="preview-download-all-text">${btnLabel}</span>`;
    }

    coverEl.dataset.proxyRetried = "";
    coverEl.dataset.origSrc = album.thumbnail || "";
    coverEl.src = album.thumbnail || "/static/placeholder-cover.svg";
    titleEl.textContent = album.title || (isPlaylist ? "Playlist" : typeName);
    artistEl.textContent = `${album.artist || "Artiste inconnu"}${album.year ? ` • ${album.year}` : ""}`;
    typeBadge.textContent = typeName;
    typeBadge.className = `search-type-badge ${badgeClass}`;

    availBadge.className = "availability-badge";
    availBadge.textContent = "⏳ Analyse des pistes en cours...";
    tracksList.innerHTML = "";
    tracksLoading.style.display = "flex";

    backdrop.style.display = "flex";
    void backdrop.offsetWidth;
    backdrop.classList.add("active");

    try {
        const res = await fetch(`/api/album/preview?url=${encodeURIComponent(album.url)}`);
        const data = await res.json();

        tracksLoading.style.display = "none";

        if (!data.success || !data.tracks) {
            availBadge.className = "availability-badge badge-has-missing";
            availBadge.textContent = "⚠️ Impossible d'analyser la liste des pistes";
            tracksList.innerHTML = `<div class="text-muted text-center" style="padding: 20px;">Détails non disponibles pour cette source.</div>`;
            return;
        }

        // Mise à jour fine du sous-type (EP / Single / Album) et de l'année si retournés par l'API
        let finalTypeName = isPlaylist ? "Playlist" : "Album";
        let finalBadgeClass = isPlaylist ? "badge-playlist" : "badge-album";
        let finalBtnLabel = isPlaylist ? "Télécharger toute la playlist" : "Télécharger tout l'album";

        if (!isPlaylist && data.subtype) {
            album.subtype = data.subtype;
            if (data.subtype === "ep") {
                finalTypeName = "EP";
                finalBadgeClass = "badge-ep";
                finalBtnLabel = "Télécharger tout l'EP";
            } else if (data.subtype === "single") {
                finalTypeName = "Single";
                finalBadgeClass = "badge-single";
                finalBtnLabel = "Télécharger le single";
            }
        }

        typeBadge.textContent = finalTypeName;
        typeBadge.className = `search-type-badge ${finalBadgeClass}`;
        if (downloadAllText) {
            downloadAllText.textContent = finalBtnLabel;
        }

        if (data.year && (!album.year || album.year === "None")) {
            album.year = data.year;
            artistEl.textContent = `${album.artist || data.artist || "Artiste inconnu"} • ${data.year}`;
        }

        // Rafraîchissement dynamique et rétroactif de la carte dans la grille de recherche
        if (album._cardElement && document.body.contains(album._cardElement)) {
            const card = album._cardElement;
            const badgeEl = card.querySelector(".search-type-badge");
            const btnMain = card.querySelector(".btn-dl-main");
            const metaContainer = card.querySelector(".search-card-meta-container");

            if (badgeEl) {
                badgeEl.textContent = finalTypeName;
                badgeEl.className = `search-type-badge ${finalBadgeClass}`;
            }
            if (btnMain) {
                const cardBtnText = isPlaylist ? "Télécharger la playlist" : (album.subtype === "ep" ? "Télécharger l'EP" : (album.subtype === "single" ? "Télécharger le single" : "Télécharger l'album"));
                btnMain.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> ${cardBtnText}`;
            }
            if (metaContainer && (data.total_tracks || data.year || album.year)) {
                const parts = [];
                const countVal = data.total_tracks ? `${data.total_tracks} titres` : (album.track_count || "");
                if (countVal) parts.push(`💿 ${escapeHtml(countVal)}`);
                const yr = data.year || album.year;
                if (yr && yr !== "None") parts.push(escapeHtml(yr));
                if (parts.length > 0) {
                    metaContainer.innerHTML = `<div style="font-size: 0.78rem; color: #10b981; font-weight: 500; margin-bottom: 8px;">${parts.join(" • ")}</div>`;
                }
            }
        }

        // Statut de disponibilité global et pistes déjà possédées
        const matchBadges = [];
        if (data.owned_tracks_count && data.owned_tracks_count > 0) {
            matchBadges.push(`<span style="color: #10b981; font-weight: 600;">✓ ${data.owned_tracks_count} possédée${data.owned_tracks_count > 1 ? 's' : ''}</span>`);
        }
        if (data.diff_duration_tracks_count && data.diff_duration_tracks_count > 0) {
            matchBadges.push(`<span style="color: #f59e0b; font-weight: 600;">⏱️ ${data.diff_duration_tracks_count} autre${data.diff_duration_tracks_count > 1 ? 's' : ''} durée${data.diff_duration_tracks_count > 1 ? 's' : ''}</span>`);
        }
        if (data.diff_version_tracks_count && data.diff_version_tracks_count > 0) {
            matchBadges.push(`<span style="color: #a855f7; font-weight: 600;">🔀 ${data.diff_version_tracks_count} autre${data.diff_version_tracks_count > 1 ? 's' : ''} version${data.diff_version_tracks_count > 1 ? 's' : ''}</span>`);
        }
        if (data.suspicious_artist_tracks_count && data.suspicious_artist_tracks_count > 0) {
            matchBadges.push(`<span style="color: #06b6d4; font-weight: 600;">🔍 ${data.suspicious_artist_tracks_count} autre${data.suspicious_artist_tracks_count > 1 ? 's' : ''} artiste${data.suspicious_artist_tracks_count > 1 ? 's' : ''} ?</span>`);
        }
        if (data.missing_for_album_count && data.missing_for_album_count > 0 && data.matched_album_name) {
            matchBadges.push(`<span style="color: #fbbf24; font-weight: 600;">⭐ Complète "${escapeHtml(data.matched_album_name)}" (${data.missing_for_album_count} manquante${data.missing_for_album_count > 1 ? 's' : ''})</span>`);
        }
        const ownedBadgeStr = matchBadges.length > 0 ? ` • ${matchBadges.join(" • ")}` : "";

        if (data.is_complete) {
            availBadge.className = "availability-badge badge-all-ok";
            availBadge.innerHTML = `✓ ${data.available_tracks} / ${data.total_tracks} pistes disponibles (Complet)${ownedBadgeStr}`;
        } else {
            availBadge.className = "availability-badge badge-has-missing";
            availBadge.innerHTML = `⚠️ ${data.available_tracks} / ${data.total_tracks} disponibles (${data.missing_count} grisée/retirée)${ownedBadgeStr}`;
        }

        // Bouton 'Télécharger les pistes manquantes' si album partiellement possédé
        if (downloadMissingBtn && data.missing_for_album_count && data.missing_for_album_count > 0 && data.matched_album_name) {
            const missingCount = data.missing_for_album_count;
            if (downloadMissingText) {
                downloadMissingText.textContent = `Télécharger les ${missingCount} manquante${missingCount > 1 ? 's' : ''} (${data.matched_album_name})`;
            }
            downloadMissingBtn.style.display = "inline-flex";
            downloadMissingBtn.onclick = async () => {
                const missingTracks = data.tracks.filter(tr => tr.is_missing_track && tr.is_available && tr.video_id);
                if (missingTracks.length === 0) {
                    showToast("Toutes les pistes disponibles sont déjà en votre possession !", "info");
                    return;
                }

                const confirmed = await showModalConfirm(
                    "Compléter l'album ?",
                    `Voulez-vous ajouter les ${missingTracks.length} pistes manquantes à la file d'attente pour compléter "${data.matched_album_name}" ?\n\nElles seront directement intégrées dans le dossier de cet album.`,
                    "Télécharger les pistes manquantes"
                );
                if (!confirmed) return;

                downloadMissingBtn.disabled = true;
                const prevMissingText = downloadMissingText ? downloadMissingText.textContent : "";
                if (downloadMissingText) downloadMissingText.textContent = "Ajout à la file...";

                let addedCount = 0;
                const defaultFormat = currentConfig.default_format || "m4a";
                const defaultQuality = currentConfig.default_quality || "auto";

                for (const mt of missingTracks) {
                    try {
                        const trackUrl = `https://www.youtube.com/watch?v=${mt.video_id}`;
                        const res = await fetch("/api/download", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                url: trackUrl,
                                title: mt.title || "",
                                format: defaultFormat,
                                quality: defaultQuality,
                                auto_retag: true,
                                naming_pattern: currentConfig.naming_pattern || "{track:02d} {title}",
                                clean_titles: true,
                                is_playlist: false,
                                custom_album: data.matched_album_name,
                                origin_album: data.matched_album_name
                            })
                        });
                        const resData = await res.json();
                        if (resData.success) addedCount++;
                    } catch (err) {
                        console.error("Erreur lors de l'ajout d'une piste manquante:", err);
                    }
                }

                downloadMissingBtn.disabled = false;
                if (downloadMissingText) downloadMissingText.textContent = prevMissingText;

                if (addedCount > 0) {
                    showToast(`${addedCount} piste${addedCount > 1 ? 's' : ''} manquante${addedCount > 1 ? 's' : ''} ajoutée${addedCount > 1 ? 's' : ''} pour "${data.matched_album_name}" !`, "Voir la file", () => {
                        switchTab("tab-download");
                    });
                }
            };
        } else if (downloadMissingBtn) {
            downloadMissingBtn.style.display = "none";
        }

        // Rendu de chaque piste
        data.tracks.forEach(t => {
            const isOwned = Boolean(t.is_owned);
            const matchStatus = t.match_status || (isOwned ? "owned" : null);

            let rowItemClass = "";
            let badgeHtml = "";
            let dlTooltip = "Télécharger ce morceau seul";

            if (matchStatus === "owned") {
                rowItemClass = "track-owned";
                const ownedTooltip = `Piste déjà possédée dans votre collection (${escapeHtml(t.owned_album || 'Collection')}${t.owned_duration ? ' • ' + escapeHtml(t.owned_duration) : ''})`;
                badgeHtml = `
                    <span class="badge-track-owned" title="${ownedTooltip}">
                        <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" style="display:inline-block; vertical-align: -1px; margin-right: 3px;"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
                        Piste possédée
                    </span>
                `;
                dlTooltip = `Piste déjà possédée (${escapeHtml(t.owned_album || 'Collection')}) - Cliquer pour retélécharger`;
            } else if (matchStatus === "different_duration") {
                rowItemClass = "track-different-duration";
                const durTooltip = `Titre identique possédé mais durée différente (${escapeHtml(t.owned_album || 'Collection')} • ${escapeHtml(t.owned_duration || '')})`;
                badgeHtml = `
                    <span class="badge-track-different-duration" title="${durTooltip}">
                        <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" style="display:inline-block; vertical-align: -1px; margin-right: 3px;"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z"/></svg>
                        Autre durée
                    </span>
                `;
                dlTooltip = `Autre durée possédée (${escapeHtml(t.owned_duration || '')} dans ${escapeHtml(t.owned_album || 'Collection')}) - Cliquer pour télécharger cette version (${escapeHtml(t.duration || '')})`;
            } else if (matchStatus === "different_version") {
                rowItemClass = "track-different-version";
                const verTooltip = `Autre version possédée : "${escapeHtml(t.owned_title || '')}" (${escapeHtml(t.owned_album || 'Collection')}${t.owned_duration ? ' • ' + escapeHtml(t.owned_duration) : ''})`;
                badgeHtml = `
                    <span class="badge-track-different-version" title="${verTooltip}">
                        <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" style="display:inline-block; vertical-align: -1px; margin-right: 3px;"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                        Autre version
                    </span>
                `;
                dlTooltip = `Autre version possédée : "${escapeHtml(t.owned_title || '')}" (${escapeHtml(t.owned_album || 'Collection')}) - Cliquer pour télécharger`;
            } else if (matchStatus === "suspicious_artist") {
                rowItemClass = "track-suspicious-artist";
                const suspTooltip = `Titre et durée identiques possédés mais chez un autre artiste : "${escapeHtml(t.owned_artist || 'Autre artiste')}" (${escapeHtml(t.owned_album || 'Collection')}${t.owned_duration ? ' • ' + escapeHtml(t.owned_duration) : ''})`;
                badgeHtml = `
                    <span class="badge-track-suspicious-artist" title="${suspTooltip}">
                        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align: -1px; margin-right: 3px;"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                        Autre artiste ?
                    </span>
                `;
                dlTooltip = `Morceau identique possédé chez ${escapeHtml(t.owned_artist || 'autre artiste')} (${escapeHtml(t.owned_album || '')}) - Cliquer pour télécharger cette version`;
            } else if (t.is_missing_track) {
                rowItemClass = "track-completes-album";
                const missTooltip = `Cette piste manque à votre album "${escapeHtml(t.missing_album_name || '')}" dans votre collection. Cliquer pour compléter l'album.`;
                badgeHtml = `
                    <span class="badge-track-completes-album" title="${missTooltip}">
                        ⭐ Complète votre album
                    </span>
                `;
                dlTooltip = `Compléter l'album "${escapeHtml(t.missing_album_name || '')}" avec cette piste manquante`;
            }

            // Chips secondaires : Live, Instrumentale, Upgrade qualité, Explicit/Clean
            let chipsHtml = "";
            if (t.tag_live) {
                chipsHtml += `<span class="badge-track-chip chip-live" title="${escapeHtml(t.tag_live_tooltip || t.tag_live)}">${escapeHtml(t.tag_live)}</span>`;
            }
            if (t.tag_inst) {
                chipsHtml += `<span class="badge-track-chip chip-inst" title="${escapeHtml(t.tag_inst_tooltip || t.tag_inst)}">${escapeHtml(t.tag_inst)}</span>`;
            }
            if (t.tag_upgrade) {
                chipsHtml += `<span class="badge-track-chip chip-upgrade" title="${escapeHtml(t.tag_upgrade_tooltip || t.tag_upgrade)}">${escapeHtml(t.tag_upgrade)}</span>`;
            }
            if (t.tag_content) {
                chipsHtml += `<span class="badge-track-chip chip-content" title="${escapeHtml(t.tag_content_tooltip || t.tag_content)}">${escapeHtml(t.tag_content)}</span>`;
            }

            const row = document.createElement("div");
            row.className = `preview-track-item ${t.is_available ? "" : "track-unavailable"} ${rowItemClass}`;

            row.innerHTML = `
                <div class="track-item-left">
                    <span class="track-item-num">${String(t.track_number).padStart(2, '0')}</span>
                    <span class="track-item-title" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</span>
                    ${badgeHtml}
                    ${chipsHtml}
                </div>
                <div class="track-item-right">
                    ${t.duration ? `<span class="track-item-dur">${escapeHtml(t.duration)}</span>` : ""}
                    ${t.is_available ? `
                        <button type="button" class="btn-track-play" title="Écouter un extrait">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        </button>
                        <button type="button" class="btn-track-dl" title="${dlTooltip}">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                        </button>
                    ` : `
                        <span class="track-unavailable-badge">⚠️ Grisée</span>
                    `}
                </div>
            `;

            if (t.is_available && t.video_id) {
                const playBtn = row.querySelector(".btn-track-play");
                if (playBtn) {
                    playBtn.addEventListener("click", () => {
                        const availableTracks = data.tracks.filter(tr => tr.is_available && tr.video_id);
                        const trackIdx = availableTracks.findIndex(tr => tr.video_id === t.video_id);
                        AudioPlayer.playOnlineAlbum(
                            {
                                title: album.title || data.title,
                                artist: album.artist || data.artist,
                                year: data.year || album.year,
                                thumbnail: album.thumbnail,
                                url: album.url,
                                subtype: data.subtype || album.subtype,
                                is_playlist: isPlaylistUrlOrItem(album, album.url)
                            },
                            availableTracks,
                            trackIdx >= 0 ? trackIdx : 0
                        );
                    });
                }

                const dlTrackBtn = row.querySelector(".btn-track-dl");
                if (dlTrackBtn) {
                    dlTrackBtn.addEventListener("click", async () => {
                        const isPl = isPlaylistUrlOrItem(album, album.url);
                        const isMissing = Boolean(t.is_missing_track && t.missing_album_name);
                        const targetAlbum = isMissing ? t.missing_album_name : ((!isPl && album.title) ? album.title : (t.album || null));
                        const customAlbumParam = isMissing ? t.missing_album_name : "Singles & Rips";

                        let confirmMessage = "";
                        if (isMissing) {
                            confirmMessage = `Cette piste viendra directement compléter votre album existant :\n"${targetAlbum}".\n\nElle sera enregistrée sous le nom :\n"${t.title}".`;
                        } else {
                            confirmMessage = `Ce morceau sera téléchargé individuellement et classé dans votre conteneur "Singles & Rips".`;
                            if (targetAlbum) {
                                confirmMessage += `\n\nSon album d'origine (${targetAlbum}) sera automatiquement mentionné dans le titre du morceau :\n"${t.title} (${targetAlbum})".`;
                            } else {
                                confirmMessage += `\n\nCe titre sera enregistré sous le nom :\n"${t.title}".`;
                            }
                        }

                        const confirmed = await showModalConfirm(
                            isMissing ? "Compléter votre album avec ce titre ?" : "Télécharger ce titre seul ?",
                            confirmMessage,
                            isMissing ? "Compléter l'album" : "Télécharger le titre seul"
                        );

                        if (!confirmed) return;

                        dlTrackBtn.disabled = true;
                        dlTrackBtn.innerHTML = `⏳`;

                        try {
                            const defaultFormat = currentConfig.default_format || "m4a";
                            const defaultQuality = currentConfig.default_quality || "auto";
                            const trackUrl = `https://www.youtube.com/watch?v=${t.video_id}`;

                            const res = await fetch("/api/download", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    url: trackUrl,
                                    title: t.title || "",
                                    format: defaultFormat,
                                    quality: defaultQuality,
                                    auto_retag: true,
                                    naming_pattern: currentConfig.naming_pattern || "{track:02d} {title}",
                                    clean_titles: true,
                                    is_playlist: false,
                                    custom_album: customAlbumParam,
                                    origin_album: targetAlbum
                                })
                            });

                            const resData = await res.json();
                            if (resData.success) {
                                showToast(`"${t.title}" ajouté à la file d'attente !`, "Voir la file", () => {
                                    switchTab("tab-download");
                                });
                            } else {
                                await showModalAlert("Erreur", resData.detail || "Erreur lors de l'ajout.", "danger");
                            }
                        } catch (err) {
                            await showModalAlert("Erreur réseau", err.message, "danger");
                        } finally {
                            dlTrackBtn.disabled = false;
                            dlTrackBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`;
                        }
                    });
                }
            }

            tracksList.appendChild(row);
        });

    } catch (err) {
        tracksLoading.style.display = "none";
        availBadge.className = "availability-badge badge-has-missing";
        availBadge.textContent = `Erreur : ${err.message}`;
    }
}


// Exports globaux
window.setupSearch = setupSearch;
window.setupAlbumPreview = setupAlbumPreview;
window.openAlbumPreview = openAlbumPreview;

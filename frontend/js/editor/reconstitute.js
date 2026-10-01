// =========================================================
// SoundStash - Module Editor / Reconstitution d'Album
// Gestion des albums incomplets, recherche de pistes manquantes et substitutions
// =========================================================

window.pendingMissingAlbumsQueue = window.pendingMissingAlbumsQueue || [];
window.isProcessingMissingPrompt = window.isProcessingMissingPrompt || false;

function isReconstituteModalOpen() {
    const backdrop = document.getElementById("reconstitute-modal-backdrop");
    return Boolean(backdrop && backdrop.classList.contains("active") && backdrop.style.display !== "none");
}
window.isReconstituteModalOpen = isReconstituteModalOpen;

function enqueuePendingMissingAlbum(albumDir, albumName, warning) {
    if (!albumDir) return;
    const alreadyQueued = pendingMissingAlbumsQueue.some(item => item.albumDir === albumDir);
    if (!alreadyQueued) {
        pendingMissingAlbumsQueue.push({ albumDir, albumName, warning });
    }

    if (isReconstituteModalOpen()) {
        showToast(`📦 "${albumName}" est terminé avec des pistes manquantes (mis en attente).`, "info");
    } else if (!isProcessingMissingPrompt && !isCustomModalOpen()) {
        processNextPendingMissingAlbum();
    }
}
window.enqueuePendingMissingAlbum = enqueuePendingMissingAlbum;

async function processNextPendingMissingAlbum() {
    if (isProcessingMissingPrompt) return;
    if (isReconstituteModalOpen()) return;
    if (isCustomModalOpen()) return;
    if (!pendingMissingAlbumsQueue || pendingMissingAlbumsQueue.length === 0) return;

    isProcessingMissingPrompt = true;
    const item = pendingMissingAlbumsQueue.shift();

    try {
        const remainingInQueue = pendingMissingAlbumsQueue.length;
        const msgContent = `${item.warning}\n\n` +
            `• Reconstituer maintenant : Rechercher et intégrer les pistes de substitution avec pré-écoute.\n` +
            `• Traiter plus tard : Conserver l'album dans l'éditeur (accessible avec les flèches ◀ ▶) pour le reconstituer à votre rythme.\n` +
            `• Supprimer : Annuler cet album et effacer immédiatement ses fichiers temporaires.` +
            (remainingInQueue > 0 ? `\n\n(${remainingInQueue} autre(s) album(s) incomplet(s) en attente)` : "");

        const choice = await showModalChoice3(
            `Pistes manquantes : ${item.albumName}`,
            msgContent,
            "🔧 Reconstituer maintenant",
            "⏱️ Traiter plus tard",
            "🗑️ Supprimer cet album"
        );

        if (choice === "confirm") {
            await refreshAlbumNavList();
            await loadAlbumInEditor(item.albumDir);
            switchTab("tab-editor");
            openReconstituteModal(item.albumDir);
        } else if (choice === "cancel") {
            showToast(`"${item.albumName}" conservé. Accessible dans l'éditeur via les flèches ◀ ▶.`, "info");
            await refreshAlbumNavList();
            await loadAlbumInEditor(item.albumDir);
            switchTab("tab-editor");
            setTimeout(() => {
                processNextPendingMissingAlbum();
            }, 350);
        } else if (choice === "extra") {
            try {
                const res = await fetch("/api/album/temp", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ path: item.albumDir })
                });
                const delResult = await res.json();
                if (delResult.success) {
                    delete editorDirtyState[item.albumDir];
                    await refreshAlbumNavList();
                    loadLibrary();
                    if (tempAlbumsList.length > 0) {
                        currentAlbumIndex = Math.min(currentAlbumIndex, tempAlbumsList.length - 1);
                        await loadAlbumInEditor(tempAlbumsList[currentAlbumIndex].path);
                    } else {
                        currentAlbumPath = null;
                        const wb = document.getElementById("editor-warning-banner");
                        if (wb) wb.style.display = "none";
                        document.getElementById("editor-album-title").textContent = "Sélectionnez un album";
                        document.getElementById("editor-album-path").textContent = "Aucun dossier chargé";
                    }
                    showToast(`"${item.albumName}" annulé et supprimé du dossier temporaire.`, "warning");
                }
            } catch (err) {
                showToast("Erreur lors de la suppression : " + err.message, "danger");
            }
            setTimeout(() => {
                processNextPendingMissingAlbum();
            }, 350);
        }
    } finally {
        isProcessingMissingPrompt = false;
    }
}


// =========================================================
// Reconstitution d'Album (Pistes Manquantes & Substituts)
// =========================================================
let currentReconstituteDetails = null;
let selectedSubstitutes = {}; // { trackNumber: { track_number, video_id, title, artist, duration } }

function setupReconstituteModal() {
    const backdrop = document.getElementById("reconstitute-modal-backdrop");
    const closeBtn = document.getElementById("reconstitute-modal-close-btn");
    const cancelBtn = document.getElementById("reconstitute-cancel-btn");
    const submitBtn = document.getElementById("reconstitute-submit-btn");

    function closeModal() {
        if (backdrop) {
            backdrop.classList.remove("active");
            setTimeout(() => {
                backdrop.style.display = "none";
                // Vérifier s'il y a d'autres albums avec pistes manquantes en file d'attente (Approche A + B)
                if (pendingMissingAlbumsQueue.length > 0) {
                    setTimeout(() => {
                        processNextPendingMissingAlbum();
                    }, 350);
                }
            }, 200);
        }
        stopSubstitutePreview();
    }

    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
    if (backdrop) {
        backdrop.addEventListener("click", (e) => {
            if (e.target === backdrop) closeModal();
        });
    }

    if (submitBtn) {
        submitBtn.addEventListener("click", submitReconstitution);
    }
}

function playSubstitutePreview(videoId, title, artist) {
    const audioBar = document.getElementById("reconstitute-audio-bar");
    const titleEl = document.getElementById("audio-bar-title");
    const artistEl = document.getElementById("audio-bar-artist");
    const player = document.getElementById("reconstitute-audio-player");
    if (!player) return;

    if (titleEl) titleEl.textContent = title || "Morceau";
    if (artistEl) artistEl.textContent = artist || "Artiste";
    if (audioBar) audioBar.style.display = "flex";

    player.src = `/api/stream?id=${encodeURIComponent(videoId)}&_t=${Date.now()}`;
    player.load();
    player.play().catch(e => console.warn("Lecture audio pré-écoute différée:", e));
}

function stopSubstitutePreview() {
    const player = document.getElementById("reconstitute-audio-player");
    const audioBar = document.getElementById("reconstitute-audio-bar");
    if (player) {
        player.pause();
        player.removeAttribute("src");
        player.load();
    }
    if (audioBar) audioBar.style.display = "none";
}

async function openReconstituteModal(albumDir, focusTrackNum = null) {
    const backdrop = document.getElementById("reconstitute-modal-backdrop");
    const loadingEl = document.getElementById("reconstitute-loading");
    const container = document.getElementById("reconstitute-tracks-container");
    const coverEl = document.getElementById("reconstitute-modal-cover");
    const titleEl = document.getElementById("reconstitute-modal-title");
    const artistEl = document.getElementById("reconstitute-modal-artist");
    const badgeEl = document.getElementById("reconstitute-missing-badge");

    if (!backdrop || !albumDir) return;

    stopSubstitutePreview();

    backdrop.style.display = "flex";
    void backdrop.offsetWidth;
    backdrop.classList.add("active");

    if (loadingEl) loadingEl.style.display = "block";
    if (container) container.innerHTML = "";

    try {
        const res = await fetch(`/api/album/missing-details?path=${encodeURIComponent(albumDir)}`);
        const data = await res.json();
        if (loadingEl) loadingEl.style.display = "none";

        if (!data.success || !data.missing_tracks || data.missing_tracks.length === 0) {
            try { localStorage.removeItem("ytm_pending_sub_" + albumDir); } catch(e) {}
            container.innerHTML = `
                <div style="text-align: center; padding: 40px;">
                    <p class="text-success" style="font-size: 1.1rem; font-weight: 600;">✓ Toutes les pistes de cet album sont présentes !</p>
                    <p class="text-muted">Aucune piste manquante détectée dans ce dossier.</p>
                </div>
            `;
            return;
        }

        currentReconstituteDetails = data;

        // Récupération et fusion des choix mémorisés (Backend .reconstitute_pending.json + LocalStorage)
        selectedSubstitutes = {};
        const backendSaved = data.pending_substitutes || {};
        let localSaved = {};
        try {
            const rawLocal = localStorage.getItem("ytm_pending_sub_" + albumDir);
            if (rawLocal) localSaved = JSON.parse(rawLocal);
        } catch (e) {}

        const merged = { ...localSaved, ...backendSaved };
        for (const [k, v] of Object.entries(merged)) {
            const num = parseInt(k, 10);
            if (!isNaN(num) && v && v.video_id) {
                if (data.missing_tracks.some(mt => mt.track_number === num)) {
                    selectedSubstitutes[num] = v;
                }
            }
        }

        updateReconstituteSubmitUI();

        if (coverEl) coverEl.src = data.cover_art ? `/api/cover?path=${encodeURIComponent(data.cover_art)}` : "/static/placeholder-cover.svg";
        if (titleEl) titleEl.textContent = data.album_name || "Album";
        if (artistEl) artistEl.textContent = data.album_artist || "Artiste";
        if (badgeEl) badgeEl.textContent = `${data.missing_count} piste(s) manquante(s) sur ${data.total_tracks}`;

        renderReconstituteTrackCards(data, focusTrackNum);
    } catch (err) {
        if (loadingEl) loadingEl.style.display = "none";
        container.innerHTML = `<p class="text-danger" style="padding: 20px;">Erreur lors de l'inspection de l'album : ${escapeHtml(err.message)}</p>`;
    }
}

function renderReconstituteTrackCards(details, focusTrackNum = null) {
    const container = document.getElementById("reconstitute-tracks-container");
    if (!container) return;
    container.innerHTML = "";

    details.missing_tracks.forEach((t) => {
        const card = document.createElement("div");
        card.className = "reconstitute-track-card";
        card.id = `reconstitute-card-${t.track_number}`;

        const isFocus = focusTrackNum && t.track_number === focusTrackNum;
        const savedSub = selectedSubstitutes[t.track_number];
        if (savedSub) {
            card.classList.add("is-selected");
        }

        const durationBadge = t.expected_duration ? `
            <span class="original-duration-badge" title="Durée originale de référence : ${escapeHtml(t.expected_duration)}">⏱ ${escapeHtml(t.expected_duration)}</span>
        ` : '';

        const statusPillClass = savedSub ? "track-status-pill track-status-selected" : "track-status-pill track-status-pending";
        const statusPillText = savedSub ? `✓ Retenu : ${savedSub.title} (${savedSub.duration || '--:--'})` : "En attente de choix";

        card.innerHTML = `
            <div class="track-card-header">
                <div class="track-card-title-group">
                    <span class="badge-missing-track-num">Piste ${String(t.track_number).padStart(2, '0')}</span>
                    <div style="min-width: 0; flex: 1;">
                        <div class="track-card-expected-title-row">
                            <span class="track-card-expected-title" title="${escapeHtml(t.expected_title)}">${escapeHtml(t.expected_title)}</span>
                            ${durationBadge}
                        </div>
                        <div class="track-card-expected-artist">${escapeHtml(t.expected_artist)}</div>
                    </div>
                </div>
                <span class="${statusPillClass}" id="status-pill-${t.track_number}">${escapeHtml(statusPillText)}</span>
            </div>
            <div class="reconstitute-search-row">
                <input type="text" class="reconstitute-search-input" id="search-input-${t.track_number}" value="${escapeHtml(t.search_query)}" placeholder="Titre ou artiste à rechercher...">
                <button type="button" class="btn btn-primary btn-sm btn-search-sub" data-track-num="${t.track_number}">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
                    Chercher
                </button>
            </div>
            <div class="substitute-results-list" id="results-list-${t.track_number}" style="display: none;"></div>
        `;

        const searchInput = card.querySelector(`#search-input-${t.track_number}`);
        const searchBtn = card.querySelector(`.btn-search-sub`);

        searchBtn.addEventListener("click", () => {
            const q = searchInput.value.trim();
            if (q) searchSubstitute(t.track_number, q);
        });

        searchInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                const q = searchInput.value.trim();
                if (q) searchSubstitute(t.track_number, q);
            }
        });

        container.appendChild(card);

        if (savedSub) {
            updateSavedBannerOnCard(t.track_number, savedSub);
        }

        if (isFocus || (!focusTrackNum && !savedSub && t.track_number === details.missing_tracks[0].track_number)) {
            setTimeout(() => {
                if (t.search_query) searchSubstitute(t.track_number, t.search_query);
                if (isFocus) card.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 100);
        }
    });
}

async function searchSubstitute(trackNum, query) {
    const resultsContainer = document.getElementById(`results-list-${trackNum}`);
    if (!resultsContainer) return;

    resultsContainer.style.display = "flex";
    resultsContainer.innerHTML = `<div class="text-muted" style="padding: 10px; font-size: 0.85rem;"><span class="spinner" style="width:16px;height:16px;vertical-align:middle;display:inline-block;margin-right:8px;"></span> Recherche en ligne...</div>`;

    try {
        const res = await fetch(`/api/search?query=${encodeURIComponent(query)}&filter_type=track`);
        const data = await res.json();
        const results = data.results || [];

        if (results.length === 0) {
            const fbRes = await fetch(`/api/search?query=${encodeURIComponent(query)}&filter_type=all`);
            const fbData = await fbRes.json();
            const fallbackResults = (fbData.results || []).filter(r => r.type === "track" || r.type === "video");
            renderSubstituteResults(trackNum, fallbackResults.slice(0, 6));
        } else {
            renderSubstituteResults(trackNum, results.slice(0, 6));
        }
    } catch (err) {
        resultsContainer.innerHTML = `<div class="text-danger" style="padding: 8px; font-size: 0.85rem;">Erreur de recherche : ${escapeHtml(err.message)}</div>`;
    }
}

function renderSubstituteResults(trackNum, results) {
    const resultsContainer = document.getElementById(`results-list-${trackNum}`);
    if (!resultsContainer) return;

    if (!results || results.length === 0) {
        resultsContainer.innerHTML = `<div class="text-muted" style="padding: 10px; font-size: 0.85rem;">Aucun morceau trouvé pour cette recherche. Essayez d'ajuster les termes.</div>`;
        return;
    }

    resultsContainer.innerHTML = "";
    results.forEach(item => {
        const row = document.createElement("div");
        row.className = "substitute-result-item";
        const videoId = item.id || (item.url ? (item.url.match(/v=([a-zA-Z0-9_-]{11})/) || [])[1] : "");
        row.setAttribute("data-video-id", videoId);

        const isCurrentlySelected = selectedSubstitutes[trackNum] && selectedSubstitutes[trackNum].video_id === videoId;
        if (isCurrentlySelected) {
            row.classList.add("is-selected");
        }

        const durStr = item.duration || "--:--";

        row.innerHTML = `
            <div class="substitute-meta-group">
                <img src="${item.thumbnail || '/static/placeholder-cover.svg'}" data-orig-src="${item.thumbnail || ''}" class="substitute-thumb" alt="Thumb" referrerpolicy="no-referrer" onerror="window.handleCoverError(this);">
                <div class="substitute-info">
                    <div class="substitute-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
                    <div class="substitute-subtext" title="${escapeHtml(item.artist || '')} — ${escapeHtml(item.album || '')}">
                        ${escapeHtml(item.artist || 'Artiste inconnu')}${item.album ? ` • <em>${escapeHtml(item.album)}</em>` : ''}
                    </div>
                </div>
            </div>
            <div class="substitute-actions">
                <span class="substitute-duration-badge">${durStr}</span>
                ${videoId ? `
                    <button type="button" class="btn btn-secondary btn-preview-listen" title="Écouter un extrait audio">
                        ▶ Écouter
                    </button>
                    <button type="button" class="btn ${isCurrentlySelected ? 'btn-success' : 'btn-primary'} btn-choose-substitute" data-video-id="${escapeHtml(videoId)}">
                        ${isCurrentlySelected ? '✓ Retenu' : '✓ Choisir'}
                    </button>
                ` : `<span class="text-muted" style="font-size:0.75rem;">Indisponible</span>`}
            </div>
        `;

        if (videoId) {
            const listenBtn = row.querySelector(".btn-preview-listen");
            const chooseBtn = row.querySelector(".btn-choose-substitute");

            listenBtn.addEventListener("click", () => {
                playSubstitutePreview(videoId, item.title, item.artist);
            });

            chooseBtn.addEventListener("click", () => {
                // Toggle : si ce substitut précis est déjà sélectionné pour cette piste, on le retire
                if (selectedSubstitutes[trackNum] && selectedSubstitutes[trackNum].video_id === videoId) {
                    unselectSubstitute(trackNum);
                } else {
                    selectSubstitute(trackNum, {
                        track_number: trackNum,
                        video_id: videoId,
                        title: item.title,
                        artist: item.artist || (currentReconstituteDetails ? currentReconstituteDetails.album_artist : "Artiste inconnu"),
                        duration: durStr
                    });
                }
            });
        }

        resultsContainer.appendChild(row);
    });
}

function selectSubstitute(trackNum, substituteData) {
    selectedSubstitutes[trackNum] = substituteData;

    const card = document.getElementById(`reconstitute-card-${trackNum}`);
    if (card) {
        card.classList.add("is-selected");
    }

    const pill = document.getElementById(`status-pill-${trackNum}`);
    if (pill) {
        pill.className = "track-status-pill track-status-selected";
        pill.textContent = `✓ Retenu : ${substituteData.title} (${substituteData.duration || '--:--'})`;
    }

    updateSavedBannerOnCard(trackNum, substituteData);

    const resultsContainer = document.getElementById(`results-list-${trackNum}`);
    if (resultsContainer) {
        const items = resultsContainer.querySelectorAll(".substitute-result-item");
        items.forEach(it => {
            const chooseBtn = it.querySelector(".btn-choose-substitute");
            const itVideoId = it.getAttribute("data-video-id");
            if (chooseBtn && itVideoId) {
                if (itVideoId === substituteData.video_id) {
                    it.classList.add("is-selected");
                    chooseBtn.className = "btn btn-success btn-choose-substitute";
                    chooseBtn.textContent = "✓ Retenu";
                } else {
                    it.classList.remove("is-selected");
                    chooseBtn.className = "btn btn-primary btn-choose-substitute";
                    chooseBtn.textContent = "✓ Choisir";
                }
            }
        });
    }

    persistPendingSubstitutes();
    updateReconstituteSubmitUI();
    showToast(`Piste ${String(trackNum).padStart(2, '0')} : Substitut sélectionné et mémorisé !`, "success");
}

function unselectSubstitute(trackNum) {
    delete selectedSubstitutes[trackNum];

    const card = document.getElementById(`reconstitute-card-${trackNum}`);
    if (card) {
        card.classList.remove("is-selected");
    }

    const pill = document.getElementById(`status-pill-${trackNum}`);
    if (pill) {
        pill.className = "track-status-pill track-status-pending";
        pill.textContent = "En attente de choix";
    }

    removeSavedBannerOnCard(trackNum);

    const resultsContainer = document.getElementById(`results-list-${trackNum}`);
    if (resultsContainer) {
        const items = resultsContainer.querySelectorAll(".substitute-result-item");
        items.forEach(it => {
            const chooseBtn = it.querySelector(".btn-choose-substitute");
            it.classList.remove("is-selected");
            if (chooseBtn) {
                chooseBtn.className = "btn btn-primary btn-choose-substitute";
                chooseBtn.textContent = "✓ Choisir";
            }
        });
    }

    persistPendingSubstitutes();
    updateReconstituteSubmitUI();
    showToast(`Piste ${String(trackNum).padStart(2, '0')} : Choix retiré`, "info");
}

function updateSavedBannerOnCard(trackNum, substituteData) {
    const card = document.getElementById(`reconstitute-card-${trackNum}`);
    if (!card) return;

    let banner = document.getElementById(`saved-sub-banner-${trackNum}`);
    if (!banner) {
        banner = document.createElement("div");
        banner.className = "saved-sub-banner";
        banner.id = `saved-sub-banner-${trackNum}`;
        const searchRow = card.querySelector(".reconstitute-search-row");
        if (searchRow) {
            card.insertBefore(banner, searchRow);
        } else {
            card.appendChild(banner);
        }
    }

    banner.innerHTML = `
        <div class="saved-sub-banner-left">
            <span class="saved-sub-banner-icon">✓</span>
            <div class="saved-sub-banner-details">
                <span class="saved-sub-banner-title" title="${escapeHtml(substituteData.title)}">${escapeHtml(substituteData.title)}</span>
                <span class="saved-sub-banner-sub">${escapeHtml(substituteData.artist || '')} &bull; ⏱ ${escapeHtml(substituteData.duration || '--:--')}</span>
            </div>
        </div>
        <div class="saved-sub-banner-actions">
            <button type="button" class="btn btn-secondary btn-sm btn-preview-listen">
                ▶ Écouter
            </button>
            <button type="button" class="btn btn-remove-saved btn-sm" title="Retirer ce choix mémorisé">
                ✕ Retirer
            </button>
        </div>
    `;

    const listenBtn = banner.querySelector(".btn-preview-listen");
    const removeBtn = banner.querySelector(".btn-remove-saved");

    if (listenBtn) {
        listenBtn.addEventListener("click", () => {
            playSubstitutePreview(substituteData.video_id, substituteData.title, substituteData.artist);
        });
    }

    if (removeBtn) {
        removeBtn.addEventListener("click", () => {
            unselectSubstitute(trackNum);
        });
    }
}

function removeSavedBannerOnCard(trackNum) {
    const banner = document.getElementById(`saved-sub-banner-${trackNum}`);
    if (banner && banner.parentNode) {
        banner.parentNode.removeChild(banner);
    }
}

function persistPendingSubstitutes() {
    if (!currentReconstituteDetails || !currentReconstituteDetails.album_dir) return;
    const albumDir = currentReconstituteDetails.album_dir;

    try {
        if (Object.keys(selectedSubstitutes).length > 0) {
            localStorage.setItem("ytm_pending_sub_" + albumDir, JSON.stringify(selectedSubstitutes));
        } else {
            localStorage.removeItem("ytm_pending_sub_" + albumDir);
        }
    } catch (e) {
        console.warn("Erreur localStorage savePendingSubstitutes:", e);
    }

    fetch("/api/album/save-pending-substitutes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            album_dir: albumDir,
            substitutes: selectedSubstitutes
        })
    }).catch(err => {
        console.warn("Erreur sauvegarde pending substitutes backend:", err);
    });
}

function updateReconstituteSubmitUI() {
    const submitBtn = document.getElementById("reconstitute-submit-btn");
    const submitText = document.getElementById("reconstitute-submit-text");
    const count = Object.keys(selectedSubstitutes).length;

    if (submitBtn && submitText) {
        if (count > 0) {
            submitBtn.disabled = false;
            submitText.textContent = `Télécharger & Intégrer les substituts (${count})`;
        } else {
            submitBtn.disabled = true;
            submitText.textContent = `Télécharger & Intégrer les substituts (0)`;
        }
    }
}

async function submitReconstitution() {
    const subsList = Object.values(selectedSubstitutes);
    if (!subsList || subsList.length === 0 || !currentReconstituteDetails) return;

    const submitBtn = document.getElementById("reconstitute-submit-btn");
    const submitText = document.getElementById("reconstitute-submit-text");
    const cancelBtn = document.getElementById("reconstitute-cancel-btn");

    if (submitBtn) submitBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (submitText) submitText.textContent = "Téléchargement & Intégration en cours...";

    stopSubstitutePreview();

    try {
        const res = await fetch("/api/album/reconstitute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                album_dir: currentReconstituteDetails.album_dir,
                substitutes: subsList,
                custom_album: currentReconstituteDetails.album_name,
                custom_artist: currentReconstituteDetails.album_artist,
                custom_year: currentReconstituteDetails.year,
                custom_genre: currentReconstituteDetails.genre
            })
        });

        const data = await res.json();
        if (data.success) {
            const backdrop = document.getElementById("reconstitute-modal-backdrop");
            if (backdrop) {
                backdrop.classList.remove("active");
                setTimeout(() => {
                    backdrop.style.display = "none";
                }, 200);
            }

            // Nettoyage de la persistance locale pour les pistes intégrées
            try {
                const albumDir = currentReconstituteDetails.album_dir;
                const remainingSubs = {};
                for (const [k, v] of Object.entries(selectedSubstitutes)) {
                    if (!subsList.some(s => s.track_number === parseInt(k, 10))) {
                        remainingSubs[k] = v;
                    }
                }
                selectedSubstitutes = remainingSubs;
                if (Object.keys(selectedSubstitutes).length > 0) {
                    localStorage.setItem("ytm_pending_sub_" + albumDir, JSON.stringify(selectedSubstitutes));
                } else {
                    localStorage.removeItem("ytm_pending_sub_" + albumDir);
                }
            } catch (e) {}

            showToast(`${subsList.length} piste(s) substituée(s) intégrée(s) avec succès dans l'album !`, "success");
            await loadAlbumInEditor(currentReconstituteDetails.album_dir);
            await refreshAlbumNavList();
            loadLibrary();

            // Si d'autres albums avec pistes manquantes étaient en attente, les proposer calmement
            if (pendingMissingAlbumsQueue.length > 0) {
                setTimeout(() => {
                    processNextPendingMissingAlbum();
                }, 800);
            }
        } else {
            await showModalAlert("Erreur de reconstitution", data.message || "Impossible d'intégrer toutes les pistes.", "danger");
        }
    } catch (err) {
        await showModalAlert("Erreur de reconstitution", err.message, "danger");
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        updateReconstituteSubmitUI();
    }
}

// Formulaire de téléchargement

// Exports globaux
window.isReconstituteModalOpen = isReconstituteModalOpen;
window.enqueuePendingMissingAlbum = enqueuePendingMissingAlbum;
window.processNextPendingMissingAlbum = processNextPendingMissingAlbum;
window.setupReconstituteModal = setupReconstituteModal;
window.openReconstituteModal = openReconstituteModal;
window.submitReconstitution = submitReconstitution;

// =========================================================
// SoundStash - Module Editor / Tag Editor (Kid3 & Métadonnées)
// Édition des tags ID3/FLAC/M4A, navigation multi-albums et autocomplétion intelligente
// =========================================================

window.currentAlbumPath = window.currentAlbumPath || null;
window.currentAlbumIsPlaylist = window.currentAlbumIsPlaylist || false;
window.currentAlbumIsConcert = window.currentAlbumIsConcert || false;
window.currentAlbumManualType = window.currentAlbumManualType || null;
window.currentAlbumDetectedType = window.currentAlbumDetectedType || "album";
window.tempAlbumsList = window.tempAlbumsList || [];
window.currentAlbumIndex = window.currentAlbumIndex !== undefined ? window.currentAlbumIndex : -1;
window.editorDirtyState = window.editorDirtyState || {};
window.editorDraftsByAlbum = window.editorDraftsByAlbum || {};
window.isCollectionEditorMode = window.isCollectionEditorMode || false;
window.editorSourceMode = window.editorSourceMode || "temp"; // "temp" | "collection" | "videos" | "covers"
window.editorWorkMode = window.editorWorkMode || "single"; // "single" | "batch"
window.editorSubMode = window.editorSubMode || "temp"; // "temp" | "collection" | "genres" | "videos" | "covers"
window.genreBatchAlbums = window.genreBatchAlbums || [];
window.genreBatchSelectedPaths = window.genreBatchSelectedPaths || new Set();
window.genreBatchCurrentScope = window.genreBatchCurrentScope || "all";
window.genreBatchSearchQuery = window.genreBatchSearchQuery || "";
window.collectionAlbumsList = window.collectionAlbumsList || [];
window.editorVideosList = window.editorVideosList || [];
window.cachedTagSuggestions = window.cachedTagSuggestions || null;

// Éditeur & Vidéothèque
async function loadVideoLibraryForEditor(force = false) {
    try {
        const url = `/api/videos/catalog${force ? "?force_refresh=true" : ""}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        const vids = data.videos || [];
        window.editorVideosList = vids;

        const countBadge = document.getElementById("editor-videos-count-badge");
        if (countBadge) countBadge.textContent = vids.length;

        const select = document.getElementById("editor-videos-select");
        if (select) {
            const previousVal = select.value;
            select.innerHTML = '<option value="">-- Choisir une vidéo de ma vidéothèque --</option>';
            vids.forEach(v => {
                const opt = document.createElement("option");
                opt.value = v.filepath;
                const typeIcon = (v.video_type === "concert" || v.is_concert) ? "🎸 [Concert]" : "🎬 [Clip]";
                const durStr = v.duration_str ? ` (${v.duration_str})` : "";
                opt.textContent = `${typeIcon} ${v.artist || "Inconnu"} - ${v.title || v.filename}${durStr}`;
                select.appendChild(opt);
            });
            if (previousVal && Array.from(select.options).some(o => o.value === previousVal)) {
                select.value = previousVal;
            }
        }
    } catch (err) {
        console.warn("Erreur chargement vidéothèque pour l'éditeur:", err);
    }
}
window.loadVideoLibraryForEditor = loadVideoLibraryForEditor;

// Éditeur & Curation de Collection
async function loadCollectionAlbumsForEditor() {
    try {
        const res = await fetch(`/api/library/albums?source=library&_t=${Date.now()}`);
        if (!res.ok) return;
        const data = await res.json();
        const rawAlbums = data.albums || [];
        collectionAlbumsList = rawAlbums.filter(alb => {
            const p = (alb.path || "").toLowerCase();
            const t = (alb.album_type || "").toLowerCase();
            if (p.endsWith(".mp4") || p.endsWith(".mkv") || p.endsWith(".webm") || p.endsWith(".avi") || p.endsWith(".mov") || p.endsWith(".m4v")) return false;
            if (t === "video" || t === "clip") return false;
            if (p.includes("/concerts/") || p.includes("\\concerts\\") || p.includes("mes vidéos") || p.includes("mes videos")) return false;
            return true;
        });

        const countBadge = document.getElementById("editor-collection-count-badge");
        if (countBadge) countBadge.textContent = collectionAlbumsList.length;
        const coversBadge = document.getElementById("editor-covers-count-badge");
        if (coversBadge) coversBadge.textContent = collectionAlbumsList.length;

        const select = document.getElementById("editor-collection-select");
        if (select) {
            const previousVal = select.value;
            select.innerHTML = '<option value="">-- Choisir un album de ma collection --</option>';
            collectionAlbumsList.forEach(alb => {
                const opt = document.createElement("option");
                opt.value = alb.path;
                const trkCount = alb.tracks_count ? ` (${alb.tracks_count} pistes)` : "";
                const yearStr = alb.year ? ` [${alb.year}]` : "";
                opt.textContent = `${alb.artist || "Inconnu"} - ${alb.title || "Sans titre"}${yearStr}${trkCount}`;
                select.appendChild(opt);
            });
            if (previousVal && Array.from(select.options).some(o => o.value === previousVal)) {
                select.value = previousVal;
            }
        }
    } catch (err) {
        console.warn("Erreur chargement albums collection:", err);
    }
}

function updateEditorSourceModeUI() {
    const tempBtn = document.getElementById("editor-source-temp-btn");
    const colBtn = document.getElementById("editor-source-collection-btn");
    const videosBtn = document.getElementById("editor-source-videos-btn");
    const genresBtn = document.getElementById("editor-source-genres-btn");
    const coversBtn = document.getElementById("editor-source-covers-btn");

    const workmodeGroup = document.getElementById("editor-workmode-group");
    const workmodeSingleBtn = document.getElementById("editor-workmode-single-btn");
    const workmodeBatchBtn = document.getElementById("editor-workmode-batch-btn");

    const pickerWrap = document.getElementById("editor-collection-picker-wrapper");
    const videosPickerWrap = document.getElementById("editor-videos-picker-wrapper");
    const singleView = document.getElementById("editor-single-view");
    const genreBatchView = document.getElementById("editor-genre-batch-view");
    const coversGalleryView = document.getElementById("editor-covers-gallery-view");
    const deleteBtn = document.getElementById("delete-current-album-btn");
    const deleteLabel = document.getElementById("delete-current-album-label");
    const openExportBtn = document.getElementById("open-export-modal-btn");
    const exportAllBtn = document.getElementById("export-all-editor-btn");
    const exportPanel = document.getElementById("export-panel");
    const navBar = document.getElementById("album-nav-bar");
    const statusBadge = document.getElementById("editor-album-tag-status");
    const applyBtn = document.getElementById("apply-uniform-btn");

    window.editorSourceMode = window.editorSourceMode || (isCollectionEditorMode ? "collection" : "temp");
    window.editorWorkMode = window.editorWorkMode || "single";

    const isTempSource = (window.editorSourceMode === "temp");
    const isColSource = (window.editorSourceMode === "collection");
    const isVideosSource = (window.editorSourceMode === "videos");
    const isCoversSource = (window.editorSourceMode === "covers");

    const isBatchMode = (window.editorWorkMode === "batch" && (isTempSource || isColSource));
    const isSingleMode = (!isBatchMode);

    // Synchronisation de compatibilité ascendante
    window.isCollectionEditorMode = isColSource;
    if (isBatchMode) {
        window.editorSubMode = "genres";
    } else {
        window.editorSubMode = window.editorSourceMode;
    }

    if (tempBtn) tempBtn.classList.toggle("active", isTempSource);
    if (colBtn) colBtn.classList.toggle("active", isColSource);
    if (videosBtn) videosBtn.classList.toggle("active", isVideosSource);
    if (coversBtn) coversBtn.classList.toggle("active", isCoversSource);
    if (genresBtn) genresBtn.classList.toggle("active", isBatchMode);

    if (workmodeGroup) {
        workmodeGroup.style.display = (isTempSource || isColSource) ? "inline-flex" : "none";
    }
    if (workmodeSingleBtn) workmodeSingleBtn.classList.toggle("active", isSingleMode);
    if (workmodeBatchBtn) workmodeBatchBtn.classList.toggle("active", isBatchMode);

    if (singleView) singleView.style.display = (isBatchMode || isCoversSource) ? "none" : "block";
    if (genreBatchView) genreBatchView.style.display = isBatchMode ? "block" : "none";
    if (coversGalleryView) coversGalleryView.style.display = isCoversSource ? "block" : "none";
    if (pickerWrap) pickerWrap.style.display = (isColSource && isSingleMode) ? "flex" : "none";
    if (videosPickerWrap) videosPickerWrap.style.display = isVideosSource ? "flex" : "none";

    if (isCoversSource) {
        if (deleteBtn) deleteBtn.style.display = "none";
        if (openExportBtn) openExportBtn.style.display = "none";
        if (exportAllBtn) exportAllBtn.style.display = "none";
        if (exportPanel) exportPanel.style.display = "none";
        if (navBar) navBar.style.display = "none";
        if (statusBadge) {
            statusBadge.className = "badge badge-warning";
            statusBadge.textContent = "🖼️ Galerie Jaquettes";
        }
        return;
    }

    // Mise à jour réactive du badge de comptage des lots selon la source active
    const batchCountBadge = document.getElementById("editor-genres-count-badge");
    if (batchCountBadge && Array.isArray(window.genreBatchAlbums) && window.genreBatchAlbums.length > 0) {
        if (isTempSource) {
            batchCountBadge.textContent = window.genreBatchAlbums.filter(a => a.source === "temp").length;
        } else if (isColSource) {
            batchCountBadge.textContent = window.genreBatchAlbums.filter(a => a.source === "library" || !a.source).length;
        } else {
            batchCountBadge.textContent = window.genreBatchAlbums.length;
        }
    }

    if (isBatchMode) {
        if (deleteBtn) deleteBtn.style.display = "none";
        if (openExportBtn) openExportBtn.style.display = "none";
        if (exportAllBtn) exportAllBtn.style.display = "none";
        if (exportPanel) exportPanel.style.display = "none";
        if (navBar) navBar.style.display = "none";
        if (statusBadge) {
            statusBadge.className = "badge badge-primary";
            statusBadge.textContent = isTempSource ? "🏷️ Tags par lot (Temporaire)" : "🏷️ Tags par lot (Collection)";
        }
        return;
    }

    if (isVideosSource) {
        if (deleteBtn) {
            deleteBtn.style.display = "inline-flex";
            deleteBtn.title = "Déplacer cette vidéo vers la Corbeille Windows (sécurisé)";
        }
        if (deleteLabel) deleteLabel.textContent = "Supprimer la vidéo";
        if (openExportBtn) openExportBtn.style.display = "none";
        if (exportAllBtn) exportAllBtn.style.display = "none";
        if (exportPanel) exportPanel.style.display = "none";
        if (navBar) navBar.style.display = "none";
        if (statusBadge) {
            statusBadge.className = "badge badge-info";
            statusBadge.textContent = "🎬 Vidéothèque";
        }
        if (applyBtn) {
            applyBtn.title = "Sauvegarder les modifications (titre, artiste, type clip/concert) de cette vidéo";
            applyBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm2 16H5V5h11.17L19 7.83V19zm-7-7c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zM6 6h9v4H6z"/></svg> Enregistrer les modifications`;
        }
    } else if (isColSource) {
        if (deleteBtn) {
            deleteBtn.style.display = "inline-flex";
            deleteBtn.title = "Déplacer cet album de votre collection vers la Corbeille Windows (sécurisé)";
        }
        if (deleteLabel) deleteLabel.textContent = "Supprimer de la collection";
        if (openExportBtn) openExportBtn.style.display = "none";
        if (exportAllBtn) exportAllBtn.style.display = "none";
        if (exportPanel) exportPanel.style.display = "none";
        if (navBar) navBar.style.display = "none";
        if (statusBadge) {
            statusBadge.className = "badge badge-success";
            statusBadge.textContent = "💿 Collection";
        }
        if (applyBtn) {
            applyBtn.title = "Sauvegarder les tags directement dans votre collection musicale (Kid3)";
            applyBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm2 16H5V5h11.17L19 7.83V19zm-7-7c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zM6 6h9v4H6z"/></svg> Enregistrer dans la collection`;
        }
    } else {
        if (deleteBtn) {
            deleteBtn.style.display = "inline-flex";
            deleteBtn.title = "Supprimer cet album du dossier temporaire";
        }
        if (deleteLabel) deleteLabel.textContent = "Supprimer (Temp)";
        if (openExportBtn) openExportBtn.style.display = "inline-flex";
        if (exportAllBtn) exportAllBtn.style.display = "inline-flex";
        if (navBar && tempAlbumsList.length > 1) navBar.style.display = "flex";
        if (statusBadge) {
            statusBadge.className = "badge badge-idle";
            statusBadge.textContent = "📁 Temporaire";
        }
        if (applyBtn) {
            applyBtn.title = "Sauvegarder les tags (titres, artistes, album) et renommer les fichiers";
            applyBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm2 16H5V5h11.17L19 7.83V19zm-7-7c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zM6 6h9v4H6z"/></svg> Sauvegarder les tags`;
        }
    }
    if (typeof updateEditorVideoModeUI === "function") {
        updateEditorVideoModeUI();
    }
    updateEditorInteractiveState();
}

function isCurrentEditorItemVideo() {
    if (window.editorSubMode === "videos") return true;
    if (window.currentAlbumManualType === "video" || window.currentAlbumManualType === "clip") return true;
    if (window.currentAlbumManualType === "concert") {
        // Un concert peut être une vidéo s'il y a un fichier vidéo ou s'il s'agit d'un fichier vidéo individuel
        const pLower = (window.currentAlbumPath || "").toLowerCase();
        if (pLower.endsWith(".mp4") || pLower.endsWith(".mkv") || pLower.endsWith(".webm") || pLower.endsWith(".avi") || pLower.endsWith(".mov")) {
            return true;
        }
    }
    if (window.currentAlbumManualType && window.currentAlbumManualType !== "video" && window.currentAlbumManualType !== "clip") return false;
    if (window.currentAlbumDetectedType === "video" || window.currentAlbumDetectedType === "clip") return true;
    if (window.currentAlbumPath && (
        window.currentAlbumPath.includes("[Vidéo]") || 
        window.currentAlbumPath.includes("[Video]") || 
        window.currentAlbumPath.includes("[Clip]")
    )) return true;
    const trs = document.querySelectorAll("#tracks-table-body tr[data-filename]");
    if (trs.length > 0) {
        const hasVideo = Array.from(trs).some(tr => {
            const fn = (tr.getAttribute("data-filename") || "").toLowerCase();
            return fn.endsWith(".mp4") || fn.endsWith(".mkv") || fn.endsWith(".webm") || fn.endsWith(".avi") || fn.endsWith(".mov");
        });
        if (hasVideo) return true;
    }
    const pLow = (window.currentAlbumPath || "").toLowerCase();
    if (pLow.endsWith(".mp4") || pLow.endsWith(".mkv") || pLow.endsWith(".webm") || pLow.endsWith(".avi") || pLow.endsWith(".mov")) {
        return true;
    }
    return false;
}
window.isCurrentEditorItemVideo = isCurrentEditorItemVideo;

function cleanVideoTitleFromArtist(title, artist) {
    if (!title) return "";
    let clean = title.replace(/^\s*\d{1,3}(?:\s*[\.\-_]\s*|\s+)/, "").trim();
    if (artist && artist.trim()) {
        const escaped = artist.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const reg = new RegExp('^' + escaped + '\\s*[\\-–—\\/:|_~]+\\s*', 'i');
        clean = clean.replace(reg, '').trim();
    }
    return clean;
}
window.cleanVideoTitleFromArtist = cleanVideoTitleFromArtist;

function updateEditorVideoModeUI() {
    const isVideo = isCurrentEditorItemVideo();
    const banner = document.getElementById("editor-video-mode-banner");
    const albumNameGroup = document.getElementById("editor-group-album-name");
    const yearGenreRow = document.getElementById("editor-year-genre-row");
    const artistLabel = document.getElementById("edit-album-artist-label");
    const artistInput = document.getElementById("edit-album-artist");
    const mbBtn = document.getElementById("musicbrainz-lookup-btn");
    const directExportBtn = document.getElementById("direct-video-export-btn");
    const openExportBtn = document.getElementById("open-export-modal-btn");
    const thTrackNum = document.getElementById("th-track-num");
    const thTrackArtist = document.getElementById("th-track-artist");
    const thTrackGenre = document.getElementById("th-track-genre");
    const thTrackTitle = document.getElementById("th-track-title");

    const hasAlbum = Boolean(window.currentAlbumPath);

    if (isVideo && hasAlbum) {
        if (banner) banner.style.display = "flex";
        if (albumNameGroup) albumNameGroup.style.display = "none";
        if (yearGenreRow) yearGenreRow.style.display = "none";
        if (artistLabel) artistLabel.textContent = "Artiste (Dossier de destination) :";
        if (artistInput) artistInput.placeholder = "Ex: Nom de l'artiste ou chaîne...";
        if (mbBtn) mbBtn.style.display = "none";
        const mbMagicBtn = document.getElementById("musicbrainz-magic-tag-btn");
        if (mbMagicBtn) mbMagicBtn.style.display = "none";

        if (directExportBtn) {
            directExportBtn.style.display = window.isCollectionEditorMode ? "none" : "inline-flex";
        }
        if (openExportBtn) {
            openExportBtn.style.display = "none";
        }

        // En mode vidéo, masquer N° Piste, Artiste et Genre du tableau
        // (L'artiste est unique et défini dans le champ principal en haut)
        if (thTrackNum) thTrackNum.style.display = "none";
        if (thTrackArtist) thTrackArtist.style.display = "none";
        if (thTrackGenre) thTrackGenre.style.display = "none";
        if (thTrackTitle) thTrackTitle.textContent = "Titre / Nom de fichier";

        const currentArtistVal = (artistInput ? artistInput.value : "").trim();

        // Ajuster les cellules des pistes déjà affichées dans tbody
        document.querySelectorAll("#tracks-table-body tr").forEach(tr => {
            const cells = tr.children;
            if (cells.length >= 6) {
                cells[0].style.display = "none"; // N° Piste
                cells[2].style.display = "none"; // Artiste de piste (masqué pour éviter la double saisie)
                cells[3].style.display = "none"; // Genre
            }
            const trackArtistInput = tr.querySelector(".track-artist-input");
            if (trackArtistInput) {
                if (currentArtistVal) {
                    trackArtistInput.value = currentArtistVal;
                } else if (trackArtistInput.value && artistInput) {
                    artistInput.value = trackArtistInput.value;
                }
            }
            const titleInput = tr.querySelector(".track-title-input");
            if (titleInput) {
                titleInput.placeholder = "Titre de la vidéo (nom du fichier)";
                let effArt = currentArtistVal || (artistInput ? artistInput.value.trim() : "");
                let clean = cleanVideoTitleFromArtist(titleInput.value, effArt);
                if (clean && clean !== titleInput.value) {
                    titleInput.value = clean;
                }
            }
            const btnPlay = tr.querySelector(".btn-editor-track-add-playlist");
            if (btnPlay) {
                btnPlay.style.display = "none";
            }
        });
    } else {
        if (banner) banner.style.display = "none";
        if (albumNameGroup) albumNameGroup.style.display = "";
        if (yearGenreRow) yearGenreRow.style.display = "";
        if (artistLabel) artistLabel.textContent = "Artiste de l'Album :";
        if (artistInput) artistInput.placeholder = "Ex: Depeche Mode, Daft Punk...";
        if (mbBtn) mbBtn.style.display = "none";
        const mbMagicBtn = document.getElementById("musicbrainz-magic-tag-btn");
        if (mbMagicBtn) mbMagicBtn.style.display = (hasAlbum && !currentAlbumIsConcert) ? "inline-flex" : "none";

        if (directExportBtn) {
            directExportBtn.style.display = "none";
        }
        if (openExportBtn) {
            openExportBtn.style.display = (window.isCollectionEditorMode || !hasAlbum) ? "none" : "inline-flex";
        }

        if (thTrackNum) thTrackNum.style.display = "";
        if (thTrackArtist) thTrackArtist.style.display = "";
        if (thTrackGenre) thTrackGenre.style.display = "";
        if (thTrackTitle) thTrackTitle.textContent = "Titre";

        // Restaurer les cellules des pistes
        document.querySelectorAll("#tracks-table-body tr").forEach(tr => {
            const cells = tr.children;
            if (cells.length >= 6) {
                cells[0].style.display = ""; // N° Piste
                cells[2].style.display = ""; // Artiste
                cells[3].style.display = ""; // Genre
            }
            const titleInput = tr.querySelector(".track-title-input");
            if (titleInput) {
                titleInput.placeholder = "Titre de la piste";
            }
            const btnPlay = tr.querySelector(".btn-editor-track-add-playlist");
            if (btnPlay) {
                btnPlay.style.display = window.currentAlbumIsConcert ? "none" : "";
            }
        });
    }
}
window.updateEditorVideoModeUI = updateEditorVideoModeUI;

// Libération immédiate des verrous de lecture audio/vidéo Chromium avant export ou suppression
function releaseMediaHandlesForPath(targetPath) {
    if (!targetPath) return;
    if (window.AudioPlayer && typeof window.AudioPlayer.releaseAlbumHandle === "function") {
        window.AudioPlayer.releaseAlbumHandle(targetPath);
    }
    const normTarget = String(targetPath).replace(/\\/g, "/").toLowerCase();
    const vp = document.getElementById("video-player");
    if (vp && vp.src && decodeURIComponent(vp.src).replace(/\\/g, "/").toLowerCase().includes(normTarget)) {
        vp.pause();
        vp.removeAttribute("src");
        vp.load();
    }
    const recPlayer = document.getElementById("reconstitute-audio-player");
    if (recPlayer && recPlayer.src && decodeURIComponent(recPlayer.src).replace(/\\/g, "/").toLowerCase().includes(normTarget)) {
        recPlayer.pause();
        recPlayer.removeAttribute("src");
        recPlayer.load();
    }
}

// Éditeur & Kid3 & Export
function setupEditorActions() {
    const applyBtn = document.getElementById("apply-uniform-btn");
    const openFolderBtn = document.getElementById("open-folder-btn");
    const deleteCurrentBtn = document.getElementById("delete-current-album-btn");
    const openExportModalBtn = document.getElementById("open-export-modal-btn");
    const directVideoExportBtn = document.getElementById("direct-video-export-btn");
    const confirmExportBtn = document.getElementById("confirm-export-btn");
    const cancelExportBtn = document.getElementById("cancel-export-btn");
    const exportPanel = document.getElementById("export-panel");
    const browseExportBtn = document.getElementById("browse-export-btn");
    const mbLookupBtn = document.getElementById("musicbrainz-lookup-btn");
    const playAlbumBtn = document.getElementById("editor-play-album-btn");
    const sourceTempBtn = document.getElementById("editor-source-temp-btn");
    const sourceColBtn = document.getElementById("editor-source-collection-btn");
    const sourceGenresBtn = document.getElementById("editor-source-genres-btn");
    const sourceCoversBtn = document.getElementById("editor-source-covers-btn");
    const sourceVideosBtn = document.getElementById("editor-source-videos-btn");
    const colSelect = document.getElementById("editor-collection-select");
    const videosSelect = document.getElementById("editor-videos-select");

    if (playAlbumBtn) {
        playAlbumBtn.addEventListener("click", () => {
            if (!currentAlbumPath) {
                showToast("Aucun album chargé dans l'éditeur.", "warning");
                return;
            }
            AudioPlayer.loadAlbum(currentAlbumPath, 0, isCollectionEditorMode);
            switchTab("tab-player");
        });
    }

    if (sourceTempBtn) {
        sourceTempBtn.addEventListener("click", async () => {
            window.editorSourceMode = "temp";
            if (window.editorWorkMode === "batch") {
                updateEditorSourceModeUI();
                await loadGenreBatchAlbums(false);
            } else {
                window.editorSubMode = "temp";
                isCollectionEditorMode = false;
                updateEditorSourceModeUI();
                await refreshAlbumNavList();
                if (tempAlbumsList.length > 0) {
                    currentAlbumIndex = Math.max(0, Math.min(currentAlbumIndex, tempAlbumsList.length - 1));
                    await loadAlbumInEditor(tempAlbumsList[currentAlbumIndex].path, false);
                } else {
                    resetEditorState("Dossier temporaire vide", "Aucun album à taguer");
                }
            }
        });
    }

    if (sourceColBtn) {
        sourceColBtn.addEventListener("click", async () => {
            window.editorSourceMode = "collection";
            if (window.editorWorkMode === "batch") {
                updateEditorSourceModeUI();
                await loadGenreBatchAlbums(false);
            } else {
                window.editorSubMode = "collection";
                isCollectionEditorMode = true;
                updateEditorSourceModeUI();
                await loadCollectionAlbumsForEditor();
                if (colSelect && colSelect.value) {
                    await loadAlbumInEditor(colSelect.value, "collection");
                } else if (collectionAlbumsList.length > 0) {
                    colSelect.value = collectionAlbumsList[0].path;
                    await loadAlbumInEditor(collectionAlbumsList[0].path, "collection");
                } else {
                    resetEditorState("Collection vide", "Aucun album trouvé");
                }
            }
        });
    }

    if (sourceVideosBtn) {
        sourceVideosBtn.addEventListener("click", async () => {
            window.editorSourceMode = "videos";
            window.editorSubMode = "videos";
            isCollectionEditorMode = false;
            updateEditorSourceModeUI();
            await loadVideoLibraryForEditor(true);
            if (videosSelect && videosSelect.value) {
                await loadAlbumInEditor(videosSelect.value, "videos");
            } else if (window.editorVideosList && window.editorVideosList.length > 0) {
                videosSelect.value = window.editorVideosList[0].filepath;
                await loadAlbumInEditor(window.editorVideosList[0].filepath, "videos");
            } else {
                resetEditorState("Vidéothèque vide", "Aucune vidéo trouvée");
            }
        });
    }

    if (sourceCoversBtn) {
        sourceCoversBtn.addEventListener("click", async () => {
            window.editorSourceMode = "covers";
            window.editorSubMode = "covers";
            isCollectionEditorMode = false;
            updateEditorSourceModeUI();
            initCoversGalleryUI();
            await loadCoversGalleryAlbums(true);
        });
    }

    // Sous-modes : Album individuel vs Tags par lot
    const workmodeSingleBtn = document.getElementById("editor-workmode-single-btn");
    const workmodeBatchBtn = document.getElementById("editor-workmode-batch-btn");

    if (workmodeSingleBtn) {
        workmodeSingleBtn.addEventListener("click", async () => {
            window.editorWorkMode = "single";
            window.editorSubMode = window.editorSourceMode;
            isCollectionEditorMode = (window.editorSourceMode === "collection");
            updateEditorSourceModeUI();
            if (window.editorSourceMode === "collection") {
                if (colSelect && colSelect.value) {
                    await loadAlbumInEditor(colSelect.value, "collection");
                } else if (collectionAlbumsList.length > 0) {
                    colSelect.value = collectionAlbumsList[0].path;
                    await loadAlbumInEditor(collectionAlbumsList[0].path, "collection");
                } else {
                    await loadCollectionAlbumsForEditor();
                }
            } else {
                await refreshAlbumNavList();
                if (tempAlbumsList.length > 0) {
                    currentAlbumIndex = Math.max(0, Math.min(currentAlbumIndex, tempAlbumsList.length - 1));
                    await loadAlbumInEditor(tempAlbumsList[currentAlbumIndex].path, false);
                } else {
                    resetEditorState("Dossier temporaire vide", "Aucun album à taguer");
                }
            }
        });
    }

    if (workmodeBatchBtn) {
        workmodeBatchBtn.addEventListener("click", async () => {
            window.editorWorkMode = "batch";
            window.editorSubMode = "genres";
            updateEditorSourceModeUI();
            initGenreBatchUI();
            await loadGenreBatchAlbums(false);
        });
    }

    if (sourceGenresBtn) {
        sourceGenresBtn.addEventListener("click", async () => {
            window.editorWorkMode = "batch";
            window.editorSubMode = "genres";
            updateEditorSourceModeUI();
            initGenreBatchUI();
            await loadGenreBatchAlbums(false);
        });
    }

    if (colSelect) {
        colSelect.addEventListener("change", async () => {
            if (colSelect.value) {
                await loadAlbumInEditor(colSelect.value, "collection");
            }
        });
    }

    if (videosSelect) {
        videosSelect.addEventListener("change", async () => {
            if (videosSelect.value) {
                await loadAlbumInEditor(videosSelect.value, "videos");
            }
        });
    }

    // ── Tags Complets MusicBrainz (Magique avec aplatissement Multi-CD continu) ──
    const mbMagicBtn = document.getElementById("musicbrainz-magic-tag-btn");
    const mbModalBackdrop = document.getElementById("mb-select-modal-backdrop");
    const mbModalCloseBtn = document.getElementById("mb-select-modal-close-btn");
    const mbModalCancelBtn = document.getElementById("mb-select-modal-cancel-btn");
    const mbModalList = document.getElementById("mb-select-releases-list");
    const mbModalLoading = document.getElementById("mb-select-loading");
    const mbModalEmpty = document.getElementById("mb-select-empty");
    const mbModalSearchAlbum = document.getElementById("mb-modal-search-album");
    const mbModalSearchArtist = document.getElementById("mb-modal-search-artist");
    const mbModalSearchSubmit = document.getElementById("mb-modal-search-submit");

    function openMusicBrainzModal() {
        if (!mbModalBackdrop) return;
        mbModalBackdrop.style.display = "flex";
        requestAnimationFrame(() => {
            mbModalBackdrop.classList.add("active");
        });
    }

    function closeMusicBrainzModal() {
        if (!mbModalBackdrop) return;
        mbModalBackdrop.classList.remove("active");
        setTimeout(() => {
            if (!mbModalBackdrop.classList.contains("active")) {
                mbModalBackdrop.style.display = "none";
            }
        }, 220);
    }

    if (mbModalCloseBtn) mbModalCloseBtn.addEventListener("click", closeMusicBrainzModal);
    if (mbModalCancelBtn) mbModalCancelBtn.addEventListener("click", closeMusicBrainzModal);
    if (mbModalBackdrop) {
        mbModalBackdrop.addEventListener("click", (e) => {
            if (e.target === mbModalBackdrop) closeMusicBrainzModal();
        });
    }
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && mbModalBackdrop && mbModalBackdrop.classList.contains("active")) {
            closeMusicBrainzModal();
        }
    });

    function renderMusicBrainzReleases(releases, expectedCount) {
        if (!mbModalList) return;
        mbModalList.innerHTML = "";

        if (!releases || releases.length === 0) {
            if (mbModalEmpty) {
                mbModalEmpty.textContent = "Aucune édition trouvée pour ces termes de recherche.";
                mbModalEmpty.style.display = "block";
            }
            return;
        }
        if (mbModalEmpty) mbModalEmpty.style.display = "none";

        releases.forEach(rel => {
            const card = document.createElement("div");
            card.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; cursor: pointer; transition: all 0.2s ease; gap: 12px;";
            card.onmouseover = () => { card.style.background = "rgba(137, 180, 250, 0.1)"; card.style.borderColor = "var(--accent)"; };
            card.onmouseout = () => { card.style.background = "rgba(255,255,255,0.03)"; card.style.borderColor = "rgba(255,255,255,0.08)"; };

            const isMatchCount = expectedCount > 0 && rel.track_count === expectedCount;
            const countBadge = isMatchCount
                ? `<span class="badge badge-success" style="font-size: 0.75rem;">✓ ${rel.track_count} pistes (Exact)</span>`
                : `<span class="badge badge-idle" style="font-size: 0.75rem;">${rel.track_count || "?"} pistes</span>`;

            const discsBadge = (rel.medium_count && rel.medium_count > 1)
                ? `<span class="badge badge-sm" style="background: rgba(245, 169, 127, 0.2); color: #f5a97f; font-size: 0.72rem;">${rel.medium_count} Disques réunis</span>`
                : "";

            card.innerHTML = `
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
                        <strong style="color: var(--text); font-size: 0.95rem;">${escapeHtml(rel.title)}</strong>
                        ${countBadge}
                        ${discsBadge}
                        ${rel.year ? `<span class="text-muted" style="font-size: 0.8rem;">[${rel.year}]</span>` : ""}
                        ${rel.country ? `<span class="text-muted" style="font-size: 0.78rem;">🌍 ${rel.country}</span>` : ""}
                    </div>
                    <div style="font-size: 0.82rem; color: var(--text-muted);">
                        Artiste : <strong>${escapeHtml(rel.artist)}</strong> ${rel.disambiguation ? `· <em>(${escapeHtml(rel.disambiguation)})</em>` : ""}
                    </div>
                </div>
                <button type="button" class="btn btn-primary btn-sm" style="white-space: nowrap; font-weight: 600;">
                    Appliquer
                </button>
            `;

            card.addEventListener("click", () => {
                applyMusicBrainzReleaseDetail(rel.id, rel.title);
            });

            mbModalList.appendChild(card);
        });
    }

    async function executeMusicBrainzSearch(albumVal, artistVal) {
        const currentRows = document.querySelectorAll("#tracks-table-body tr:not(.missing-track-row)");
        const trackCount = currentRows.length;

        if (mbModalLoading) mbModalLoading.style.display = "block";
        if (mbModalEmpty) mbModalEmpty.style.display = "none";
        if (mbModalList) mbModalList.innerHTML = "";

        try {
            const res = await fetch("/api/musicbrainz/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    album: albumVal,
                    artist: artistVal,
                    expected_track_count: trackCount
                })
            });
            if (!res.ok) {
                const errText = await res.text();
                showToast(`Erreur serveur (${res.status}) : ${errText.slice(0, 100)}`, "danger");
                if (mbModalEmpty) {
                    mbModalEmpty.textContent = `Erreur de recherche (${res.status})`;
                    mbModalEmpty.style.display = "block";
                }
                return [];
            }
            const data = await res.json();
            if (mbModalLoading) mbModalLoading.style.display = "none";

            if (!data.success || !data.releases || data.releases.length === 0) {
                if (mbModalEmpty) {
                    mbModalEmpty.textContent = data.message || "Aucune édition trouvée pour ces termes de recherche.";
                    mbModalEmpty.style.display = "block";
                }
                return [];
            }

            renderMusicBrainzReleases(data.releases, trackCount);
            return data.releases;
        } catch (err) {
            if (mbModalLoading) mbModalLoading.style.display = "none";
            if (mbModalEmpty) {
                mbModalEmpty.textContent = `Erreur : ${err.message}`;
                mbModalEmpty.style.display = "block";
            }
            showToast(`Erreur MusicBrainz : ${err.message}`, "danger");
            return [];
        }
    }

    if (mbModalSearchSubmit) {
        mbModalSearchSubmit.addEventListener("click", async () => {
            const alb = mbModalSearchAlbum ? mbModalSearchAlbum.value.trim() : "";
            const art = mbModalSearchArtist ? mbModalSearchArtist.value.trim() : "";
            if (!alb && !art) {
                showToast("Saisissez au moins un nom d'album ou un artiste.", "warning");
                return;
            }
            await executeMusicBrainzSearch(alb, art);
        });
    }

    const handleSearchKeydown = (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            if (mbModalSearchSubmit) mbModalSearchSubmit.click();
        }
    };
    if (mbModalSearchAlbum) mbModalSearchAlbum.addEventListener("keydown", handleSearchKeydown);
    if (mbModalSearchArtist) mbModalSearchArtist.addEventListener("keydown", handleSearchKeydown);

    async function applyMusicBrainzReleaseDetail(releaseId, releaseTitleFallback) {
        if (!releaseId) return;
        closeMusicBrainzModal();
        if (mbMagicBtn) {
            mbMagicBtn.disabled = true;
            mbMagicBtn.innerHTML = `<span>Application des tags...</span>`;
        }
        showToast("Récupération des tags officiels et featurings...", "info");

        try {
            const albumNameVal = document.getElementById("edit-album-name")?.value.trim() || "";
            const artistVal = document.getElementById("edit-album-artist")?.value.trim() || "";

            const res = await fetch("/api/musicbrainz/release-detail", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    release_id: releaseId,
                    album_fallback: albumNameVal,
                    artist_fallback: artistVal
                })
            });
            if (!res.ok) {
                const errText = await res.text();
                showToast(`Erreur serveur (${res.status}) : ${errText.slice(0, 100)}`, "danger");
                return;
            }
            const data = await res.json();
            if (!data.success) {
                showToast(data.message || "Impossible de récupérer les détails de cette édition.", "warning");
                return;
            }

            let modifiedCount = 0;

            // 1. Mettre à jour l'artiste et le nom d'album si vides ou différents
            const albumInput = document.getElementById("edit-album-name");
            if (albumInput && data.title) {
                if (albumInput.value.trim() !== data.title) {
                    albumInput.value = data.title;
                    albumInput.classList.add("input-highlight");
                    setTimeout(() => albumInput.classList.remove("input-highlight"), 1200);
                    modifiedCount++;
                }
            }

            const artistInput = document.getElementById("edit-album-artist");
            if (artistInput && data.artist) {
                if (artistInput.value.trim() !== data.artist) {
                    artistInput.value = data.artist;
                    artistInput.classList.add("input-highlight");
                    setTimeout(() => artistInput.classList.remove("input-highlight"), 1200);
                    modifiedCount++;
                }
            }

            // 2. Année (YYYY)
            const yearInput = document.getElementById("edit-album-year");
            if (yearInput && data.year) {
                if (yearInput.value.trim() !== data.year) {
                    yearInput.value = data.year;
                    yearInput.classList.add("input-highlight");
                    setTimeout(() => yearInput.classList.remove("input-highlight"), 1200);
                    modifiedCount++;
                }
            }

            // 3. Genre (détecté ou complété)
            const genreInput = document.getElementById("edit-album-genre");
            if (genreInput && data.genre) {
                if (!genreInput.value.trim() || genreInput.value.trim() !== data.genre) {
                    genreInput.value = data.genre;
                    genreInput.classList.add("input-highlight");
                    setTimeout(() => genreInput.classList.remove("input-highlight"), 1200);
                    modifiedCount++;
                }
            }

            // 4. Mettre à jour les pistes dans le tableau : numérotation séquentielle continue (multi-CD aplatis !)
            const rows = document.querySelectorAll("#tracks-table-body tr:not(.missing-track-row)");
            const mbTracks = data.tracks || [];

            console.log(`[MusicBrainz] Détails reçus pour '${data.title}' de '${data.artist}' (${data.tracks?.length || 0} pistes, ${rows.length} lignes dans le tableau). modifiedCount initial=0`);

            rows.forEach((row, idx) => {
                const mbTrk = mbTracks[idx];
                const seqNum = String(idx + 1).padStart(2, "0");

                // Mettre à jour le badge de numéro de piste
                const numBadge = row.querySelector(".track-num-badge");
                if (numBadge) {
                    numBadge.textContent = seqNum;
                }
                row.setAttribute("data-track-num", seqNum);

                // Titre
                const titleInput = row.querySelector(".track-title-input");
                if (titleInput && mbTrk && mbTrk.title) {
                    if (titleInput.value.trim() !== mbTrk.title) {
                        titleInput.value = mbTrk.title;
                        titleInput.classList.add("input-highlight");
                        setTimeout(() => titleInput.classList.remove("input-highlight"), 1200);
                        modifiedCount++;
                    }
                }

                // Artiste de piste (avec featurings exacts)
                const trkArtistInput = row.querySelector(".track-artist-input");
                if (trkArtistInput) {
                    const targetArt = (mbTrk && mbTrk.artist) ? mbTrk.artist : (data.artist || artistInput?.value.trim());
                    if (targetArt && trkArtistInput.value.trim() !== targetArt) {
                        trkArtistInput.value = targetArt;
                        trkArtistInput.classList.add("input-highlight");
                        setTimeout(() => trkArtistInput.classList.remove("input-highlight"), 1200);
                        modifiedCount++;
                    }
                }

                // Genre de piste
                const trkGenreInput = row.querySelector(".track-genre-input");
                if (trkGenreInput && data.genre) {
                    if (!trkGenreInput.value.trim()) {
                        trkGenreInput.value = data.genre;
                    }
                }
            });

            markEditorDirty();
            saveCurrentEditorDraft();

            const discNotice = (data.total_tracks && data.total_tracks !== rows.length)
                ? ` (Attention : l'édition officielle compte ${data.total_tracks} pistes, votre dossier en contient ${rows.length})`
                : "";

            if (modifiedCount > 0) {
                showToast(`✨ MusicBrainz : ${modifiedCount} champ(s) mis à jour sur ${rows.length} pistes.${discNotice}`, "success");
            } else {
                showToast(`MusicBrainz : Les tags appliqués correspondent déjà à votre saisie.${discNotice}`, "info");
            }
        } catch (err) {
            showToast(`Erreur application tags MusicBrainz : ${err.message}`, "danger");
        } finally {
            if (mbMagicBtn) {
                mbMagicBtn.disabled = false;
                mbMagicBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M7.5 5.6L5 7l1.4-2.5L5 2l2.5 1.4L10 2l-1.4 2.5L10 7 7.5 5.6zm12 9.8L22 14l-1.4 2.5L22 19l-2.5-1.4L17 19l1.4-2.5L17 14l2.5 1.4zM22 2l-2.5 1.4L17 2l1.4 2.5L17 7l2.5-1.4L22 7l-1.4-2.5L22 2zm-7.63 5.29c-.39-.39-1.02-.39-1.41 0L1.29 18.96c-.39.39-.39 1.02 0 1.41l2.34 2.34c.39.39 1.02.39 1.41 0L16.7 11.05c.39-.39.39-1.02 0-1.41l-2.33-2.35zm-1.06 3.53l-1.41-1.41 1.41-1.41 1.41 1.41-1.41 1.41z"/></svg>
                    <span>Tags MusicBrainz</span>
                `;
            }
        }
    }

    if (mbMagicBtn) {
        mbMagicBtn.addEventListener("click", async () => {
            const albumNameVal = document.getElementById("edit-album-name")?.value.trim() || "";
            const artistVal = document.getElementById("edit-album-artist")?.value.trim() || "";

            if (!albumNameVal && !artistVal) {
                showToast("Renseignez au moins le nom de l'album ou l'artiste dans l'éditeur.", "warning");
                return;
            }

            // Pré-remplir la barre de recherche intégrée à la modale
            if (mbModalSearchAlbum) mbModalSearchAlbum.value = albumNameVal;
            if (mbModalSearchArtist) mbModalSearchArtist.value = artistVal;

            mbMagicBtn.disabled = true;
            const origHtml = mbMagicBtn.innerHTML;
            mbMagicBtn.innerHTML = `<span>Recherche MusicBrainz...</span>`;

            try {
                // Ouvrir immédiatement la modale avec retour visuel
                openMusicBrainzModal();
                const releases = await executeMusicBrainzSearch(albumNameVal, artistVal);

                // S'il n'y a qu'un résultat unique, on peut l'appliquer immédiatement
                if (releases && releases.length === 1) {
                    await applyMusicBrainzReleaseDetail(releases[0].id, releases[0].title);
                }
            } catch (err) {
                showToast(`Erreur MusicBrainz : ${err.message}`, "danger");
            } finally {
                mbMagicBtn.disabled = false;
                mbMagicBtn.innerHTML = origHtml;
            }
        });
    }

    // ── Lookup MusicBrainz feat. (Bouton secondaire) ──────────────────────────
    if (mbLookupBtn) {
        mbLookupBtn.addEventListener("click", async () => {
            const album = document.getElementById("edit-album-name").value.trim();
            const artist = document.getElementById("edit-album-artist").value.trim();
            if (!album || !artist) {
                showToast("Renseignez d'abord l'album et l'artiste dans l'éditeur.", "warning");
                return;
            }

            mbLookupBtn.disabled = true;
            const origText = mbLookupBtn.innerHTML;
            mbLookupBtn.textContent = "MusicBrainz...";

            try {
                const res = await fetch("/api/musicbrainz/lookup", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ album, artist })
                });
                const data = await res.json();

                if (!data.success) {
                    showToast(data.message || "Aucun résultat MusicBrainz.", "warning");
                    return;
                }

                // Appliquer les crédits aux champs Artiste des pistes du tableau
                const rows = document.querySelectorAll("#tracks-table-body tr:not(.missing-track-row)");
                let updatedCount = 0;
                rows.forEach((row, idx) => {
                    const position = String(idx + 1);
                    const mbArtist = data.track_credits[position];
                    if (!mbArtist) return;

                    const artistInput = row.querySelector(".track-artist-input");
                    if (artistInput && artistInput.value.trim() !== mbArtist) {
                        artistInput.value = mbArtist;
                        artistInput.classList.add("input-highlight");
                        setTimeout(() => artistInput.classList.remove("input-highlight"), 1200);
                        updatedCount++;
                    }
                });

                if (updatedCount > 0) {
                    markEditorDirty();
                    showToast(`MusicBrainz : ${updatedCount} artiste(s) de piste mis à jour.`, "success");
                } else {
                    showToast(`MusicBrainz : album trouvé (${data.release_title}), aucun artiste différent détecté.`, "info");
                }
            } catch (err) {
                showToast("Erreur lors de la recherche MusicBrainz : " + err.message, "danger");
            } finally {
                mbLookupBtn.disabled = false;
                mbLookupBtn.innerHTML = origText;
            }
        });
    }

    if (browseExportBtn) {
        browseExportBtn.addEventListener("click", () => browseFolder("export-dir-input"));
    }

    const detectGenreBtn = document.getElementById("detect-genre-btn");
    if (detectGenreBtn) {
        detectGenreBtn.addEventListener("click", async () => {
            const album = document.getElementById("edit-album-name")?.value.trim() || "";
            let artist = document.getElementById("edit-album-artist")?.value.trim() || "";

            // Si l'artiste est générique (Various Artists / Playlist), chercher avec le premier artiste de piste
            if (!artist || artist === "Various Artists" || artist === "Artiste inconnu") {
                const firstTrackArtist = document.querySelector("#tracks-table-body .track-artist-input")?.value.trim();
                if (firstTrackArtist) artist = firstTrackArtist;
            }

            if (!artist && !album) {
                showToast("Renseignez au moins l'artiste ou l'album pour rechercher le genre.", "warning");
                return;
            }

            detectGenreBtn.disabled = true;
            const origHtml = detectGenreBtn.innerHTML;
            detectGenreBtn.textContent = "Recherche...";

            try {
                const isAlbum = album && !album.toLowerCase().includes("[playlist]") && album !== "Singles & Rips";
                const searchTitle = isAlbum ? album : (document.querySelector("#tracks-table-body .track-title-input")?.value.trim() || album);
                const res = await fetch(`/api/genre/detect?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(searchTitle)}&is_album=${isAlbum}`);
                const data = await res.json();

                if (data.success && data.genre) {
                    const genreInput = document.getElementById("edit-album-genre");
                    if (genreInput) {
                        genreInput.value = data.genre;
                        genreInput.classList.add("input-highlight");
                        setTimeout(() => genreInput.classList.remove("input-highlight"), 1200);
                        markEditorDirty();
                    }
                    showToast(`Genre officiel détecté : « ${data.genre} »`, "success");
                } else {
                    showToast("Aucun genre officiel trouvé via iTunes / MusicBrainz pour cet artiste/album.", "info");
                }
            } catch (err) {
                showToast("Erreur détection de genre : " + err.message, "danger");
            } finally {
                detectGenreBtn.disabled = false;
                detectGenreBtn.innerHTML = origHtml;
            }
        });
    }

    const applyGenreToAllBtn = document.getElementById("apply-genre-to-all-btn");
    if (applyGenreToAllBtn) {
        applyGenreToAllBtn.addEventListener("click", () => {
            const globalGenre = document.getElementById("edit-album-genre").value.trim();
            if (!globalGenre) {
                showToast("Veuillez d'abord renseigner un genre global.", "warning");
                return;
            }
            const trackGenreInputs = document.querySelectorAll("#tracks-table-body .track-genre-input");
            if (trackGenreInputs.length === 0) {
                showToast("Aucune piste chargée dans le tableau.", "warning");
                return;
            }
            trackGenreInputs.forEach(input => {
                input.value = globalGenre;
                input.classList.add("input-highlight");
                setTimeout(() => input.classList.remove("input-highlight"), 600);
            });
            markEditorDirty();
            showToast(`Genre « ${globalGenre} » appliqué aux ${trackGenreInputs.length} pistes !`, "success");
        });
    }

    // =========================================================
    // Sélecteur de type d'album & Aperçu dynamique du Badge (v3.3.3)
    // =========================================================
    function updateEditorBadgePreview(type, isManual = false) {
        const badgeEl = document.getElementById("editor-type-badge-preview");
        if (!badgeEl) return;
        const info = (typeof window.getBadgeInfoForType === "function")
            ? window.getBadgeInfoForType(type)
            : { label: (type || "ALBUM").toUpperCase(), class: "badge-album", emoji: "💿" };

        badgeEl.className = `player-card-type-badge ${info.class}`;
        badgeEl.textContent = info.label;
        badgeEl.title = isManual
            ? `Aperçu : ${info.label} (Choix Manuel ✍️ - Cliquez pour changer de type)`
            : `Aperçu : ${info.label} (Détection Automatique 🤖 - Cliquez pour forcer manuellement)`;
    }
    window.updateEditorBadgePreview = updateEditorBadgePreview;

    const toggleAutoBtn = document.getElementById("toggle-type-auto-btn");
    const toggleAlbumBtn = document.getElementById("toggle-type-album-btn");
    const toggleSingleBtn = document.getElementById("toggle-type-single-btn");
    const toggleRipBtn = document.getElementById("toggle-type-rip-btn");
    const togglePlaylistBtn = document.getElementById("toggle-type-playlist-btn");
    const toggleConcertBtn = document.getElementById("toggle-type-concert-btn");
    const toggleVideoBtn = document.getElementById("toggle-type-video-btn");
    const badgePreviewEl = document.getElementById("editor-type-badge-preview");

    if (toggleAutoBtn) {
        toggleAutoBtn.addEventListener("click", () => {
            if (!currentAlbumPath) return;
            currentAlbumManualType = null;
            const det = currentAlbumDetectedType || "album";
            currentAlbumIsPlaylist = (det === "playlist");
            currentAlbumIsConcert = (det === "concert");
            updateEditorTypeToggleUI(det, false);
            updateEditorBadgePreview(det, false);
            markEditorDirty();
            const bInfo = window.getBadgeInfoForType ? window.getBadgeInfoForType(det) : { label: det.toUpperCase() };
            showToast(`Mode Automatique 🤖 réactivé : Badge « ${bInfo.label} » appliqué.`, "info");
        });
    }

    if (toggleAlbumBtn) {
        toggleAlbumBtn.addEventListener("click", () => {
            if (!currentAlbumPath) return;
            currentAlbumManualType = "album";
            currentAlbumIsPlaylist = false;
            currentAlbumIsConcert = false;
            updateEditorTypeToggleUI("album", true);
            updateEditorBadgePreview("album", true);

            // 1. Nettoyer ou restaurer le champ Nom de l'Album
            const nameInput = document.getElementById("edit-album-name");
            if (nameInput) {
                const prevName = nameInput.value;
                if (nameInput.value.trim().toLowerCase() === "singles & rips" || nameInput.value.trim().toLowerCase() === "vidéos") {
                    // Restaurer le nom d'origine mémorisé
                    nameInput.value = nameInput.dataset.originalAlbumName || "Album";
                } else {
                    nameInput.value = nameInput.value.replace(/\s*\[(playlist|mix|compilation|vidéo|video|clip)\]/gi, "").trim();
                }
                const titleEl = document.getElementById("editor-album-title");
                if (titleEl) titleEl.textContent = nameInput.value || "Album sans nom";
                if (nameInput.value !== prevName) {
                    nameInput.classList.add("input-highlight");
                    setTimeout(() => nameInput.classList.remove("input-highlight"), 600);
                }
            }

            // 2. Nettoyer les titres des pistes : retirer (Nom Album) et [Single] et [AUDIO RIP]
            const titleInputs = document.querySelectorAll("#tracks-table-body .track-title-input");
            let cleanedCount = 0;
            titleInputs.forEach(input => {
                const original = input.value;
                let cleaned = original.replace(/\s*\[(single|audio\s*rip|rip|extrait\s*vid[eé]o|vid[eé]o|clip)\]\s*$/gi, "");
                cleaned = cleaned.replace(/\s*\([^\)]+\)\s*$/, "");
                cleaned = cleaned.trim();
                if (cleaned !== original && cleaned) {
                    input.value = cleaned;
                    input.classList.add("input-highlight");
                    setTimeout(() => input.classList.remove("input-highlight"), 600);
                    cleanedCount++;
                }
            });

            markEditorDirty();
            showToast(`Mode Manuel ✍️ : Badge forcé en « ALBUM » ${cleanedCount > 0 ? `(${cleanedCount} titres nettoyés)` : ""}`, "success");
        });
    }

    if (toggleSingleBtn) {
        toggleSingleBtn.addEventListener("click", () => {
            if (!currentAlbumPath) return;
            currentAlbumManualType = "single";
            currentAlbumIsPlaylist = false;
            currentAlbumIsConcert = false;
            updateEditorTypeToggleUI("single", true);
            updateEditorBadgePreview("single", true);

            markEditorDirty();
            showToast("Mode Manuel ✍️ : Badge forcé en « SINGLE ».", "info");
        });
    }

    if (toggleRipBtn) {
        toggleRipBtn.addEventListener("click", () => {
            if (!currentAlbumPath) return;
            currentAlbumManualType = "rip";
            currentAlbumIsPlaylist = false;
            currentAlbumIsConcert = false;
            updateEditorTypeToggleUI("rip", true);
            updateEditorBadgePreview("rip", true);

            // Mettre le nom de l'album sur "Singles & Rips" tout en mémorisant le nom actuel
            const nameInput = document.getElementById("edit-album-name");
            if (nameInput && nameInput.value.trim().toLowerCase() !== "singles & rips") {
                nameInput.dataset.originalAlbumName = nameInput.value.replace(/\s*\[(playlist|mix|compilation)\]/gi, "").trim();
                nameInput.value = "Singles & Rips";
                const titleEl = document.getElementById("editor-album-title");
                if (titleEl) titleEl.textContent = "Singles & Rips";
                nameInput.classList.add("input-highlight");
                setTimeout(() => nameInput.classList.remove("input-highlight"), 600);
            }

            markEditorDirty();
            showToast("Mode Manuel ✍️ : Badge forcé en « RIP AUDIO » (dossier Singles & Rips).", "info");
        });
    }

    if (togglePlaylistBtn) {
        togglePlaylistBtn.addEventListener("click", () => {
            if (!currentAlbumPath) return;
            currentAlbumManualType = "playlist";
            currentAlbumIsPlaylist = true;
            currentAlbumIsConcert = false;
            updateEditorTypeToggleUI("playlist", true);
            updateEditorBadgePreview("playlist", true);

            const nameInput = document.getElementById("edit-album-name");
            if (nameInput) {
                if (nameInput.value.trim().toLowerCase() === "singles & rips") {
                    nameInput.value = `${(nameInput.dataset.originalAlbumName || "Playlist").trim()} [Playlist]`;
                } else if (!nameInput.value.toLowerCase().includes("[playlist]")) {
                    nameInput.value = `${nameInput.value.trim()} [Playlist]`;
                }
                const titleEl = document.getElementById("editor-album-title");
                if (titleEl) titleEl.textContent = nameInput.value;
                nameInput.classList.add("input-highlight");
                setTimeout(() => nameInput.classList.remove("input-highlight"), 600);
            }

            markEditorDirty();
            showToast("Mode Manuel ✍️ : Badge forcé en « PLAYLIST ».", "info");
        });
    }

    if (toggleConcertBtn) {
        toggleConcertBtn.addEventListener("click", () => {
            if (!currentAlbumPath) return;
            currentAlbumManualType = "concert";
            currentAlbumIsPlaylist = false;
            currentAlbumIsConcert = true;
            updateEditorTypeToggleUI("concert", true);
            updateEditorBadgePreview("concert", true);

            const nameInput = document.getElementById("edit-album-name");
            if (nameInput) {
                if (nameInput.value.trim().toLowerCase() === "singles & rips") {
                    nameInput.value = nameInput.dataset.originalAlbumName || "Concert";
                }
                const titleEl = document.getElementById("editor-album-title");
                if (titleEl) titleEl.textContent = nameInput.value || "Concert & Live";
                nameInput.classList.add("input-highlight");
                setTimeout(() => nameInput.classList.remove("input-highlight"), 600);
            }

            markEditorDirty();
            if (typeof updateEditorVideoModeUI === "function") {
                updateEditorVideoModeUI();
            }
            showToast("Mode Manuel ✍️ : Badge forcé en « CONCERT ».", "info");
        });
    }

    if (toggleVideoBtn) {
        toggleVideoBtn.addEventListener("click", () => {
            if (!currentAlbumPath) return;
            currentAlbumManualType = "video";
            currentAlbumIsPlaylist = false;
            currentAlbumIsConcert = false;
            updateEditorTypeToggleUI("video", true);
            updateEditorBadgePreview("video", true);

            const nameInput = document.getElementById("edit-album-name");
            if (nameInput) {
                if (nameInput.value.trim().toLowerCase() === "singles & rips") {
                    nameInput.dataset.originalAlbumName = nameInput.value;
                }
                nameInput.value = "Vidéos";
                const titleEl = document.getElementById("editor-album-title");
                if (titleEl) titleEl.textContent = "Vidéos";
                nameInput.classList.add("input-highlight");
                setTimeout(() => nameInput.classList.remove("input-highlight"), 600);
            }

            markEditorDirty();
            if (typeof updateEditorVideoModeUI === "function") {
                updateEditorVideoModeUI();
            }
            showToast("Mode Manuel ✍️ : Mode Vidéo activé (destination Vidéothèque).", "info");
        });
    }

    // Clic direct sur l'aperçu du badge sur la pochette pour cycler entre les modes
    if (badgePreviewEl) {
        badgePreviewEl.addEventListener("click", () => {
            if (!currentAlbumPath) return;
            const cycle = ["auto", "album", "single", "rip", "playlist", "concert", "video"];
            const currentMode = currentAlbumManualType || "auto";
            const nextIdx = (cycle.indexOf(currentMode) + 1) % cycle.length;
            const nextMode = cycle[nextIdx];

            if (nextMode === "auto") {
                if (toggleAutoBtn) toggleAutoBtn.click();
            } else if (nextMode === "album") {
                if (toggleAlbumBtn) toggleAlbumBtn.click();
            } else if (nextMode === "single") {
                if (toggleSingleBtn) toggleSingleBtn.click();
            } else if (nextMode === "rip") {
                if (toggleRipBtn) toggleRipBtn.click();
            } else if (nextMode === "playlist") {
                if (togglePlaylistBtn) togglePlaylistBtn.click();
            } else if (nextMode === "concert") {
                if (toggleConcertBtn) toggleConcertBtn.click();
            } else if (nextMode === "video") {
                if (toggleVideoBtn) toggleVideoBtn.click();
            }
        });
    }

    if (directVideoExportBtn) {
        directVideoExportBtn.addEventListener("click", async () => {
            if (!currentAlbumPath) {
                await showModalAlert("Aucun élément sélectionné", "Veuillez d'abord sélectionner ou télécharger une vidéo.", "warning");
                return;
            }

            releaseMediaHandlesForPath(currentAlbumPath);

            const albumArtist = document.getElementById("edit-album-artist").value.trim() || "Artiste Inconnu";
            const albumName = "Vidéos";

            // Récupérer les pistes avec titres nettoyés (sans préfixe de numérotation)
            const customTracks = [];
            document.querySelectorAll("#tracks-table-body tr[data-filename]").forEach(row => {
                const filename = row.getAttribute("data-filename");
                const titleInput = row.querySelector(".track-title-input");
                const artistInput = row.querySelector(".track-artist-input");
                if (filename) {
                    let titleVal = (titleInput ? titleInput.value.trim() : "") || filename.replace(/\.[^/.]+$/, "");
                    titleVal = cleanVideoTitleFromArtist(titleVal, albumArtist);
                    customTracks.push({
                        filename: filename,
                        title: titleVal,
                        artist: albumArtist, // Toujours l'artiste du champ unique en haut
                        track_number: "" // Strictement aucun numéro de piste pour les vidéos
                    });
                }
            });

            const targetBase = currentConfig.video_export_dir || currentConfig.video_library_dir || "";
            if (!targetBase) {
                await showModalAlert(
                    "Dossier Vidéothèque introuvable",
                    "Le dossier de votre Vidéothèque n'est pas configuré. Veuillez vérifier les Paramètres.",
                    "warning"
                );
                return;
            }

            const originalBtnHtml = directVideoExportBtn.innerHTML;
            directVideoExportBtn.disabled = true;
            directVideoExportBtn.textContent = "🎬 Rangement dans la Vidéothèque...";

            try {
                // Étape 1 : Sauvegarde transparente des tags (sans numérotation) et renommage propre
                await fetch("/api/album/retag", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        album_dir: currentAlbumPath,
                        custom_album: albumName,
                        custom_artist: albumArtist,
                        custom_tracks: customTracks,
                        custom_album_type: "video"
                    })
                });

                // Étape 2 : Exportation directe dans la Vidéothèque (destination <target_base_dir>/<Artiste>/<Titre>.mp4)
                const res = await fetch("/api/album/export", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        album_dir: currentAlbumPath,
                        target_base_dir: targetBase,
                        delete_temp: true,
                        custom_album: albumName,
                        custom_artist: albumArtist,
                        custom_tracks: customTracks,
                        custom_album_type: "video",
                        conflict_policy: "overwrite"
                    })
                });

                let result;
                try {
                    result = await res.json();
                } catch (e) {
                    throw new Error(`Erreur serveur (${res.status} ${res.statusText})`);
                }

                if (res.ok && result.success) {
                    delete editorDirtyState[currentAlbumPath];

                    if (typeof loadLibrary === "function") loadLibrary();
                    if (typeof refreshAlbumNavList === "function") await refreshAlbumNavList();
                    if (typeof loadExternalTempAlbums === "function") loadExternalTempAlbums();
                    if (typeof window.refreshSearchBadges === "function") window.refreshSearchBadges();

                    if (window.AudioPlayer) {
                        if (typeof window.AudioPlayer.loadAndRenderVideosCatalog === "function") {
                            window.AudioPlayer.loadAndRenderVideosCatalog(true);
                        }
                        if (typeof window.AudioPlayer.loadAndRenderConcertsCatalog === "function") {
                            window.AudioPlayer.loadAndRenderConcertsCatalog(true);
                        }
                    }

                    if (tempAlbumsList.length > 0) {
                        currentAlbumIndex = Math.min(currentAlbumIndex, tempAlbumsList.length - 1);
                        await loadAlbumInEditor(tempAlbumsList[currentAlbumIndex].path);
                    } else {
                        resetEditorState("Dossier temporaire vide", "Toutes les vidéos et albums temporaires ont été traités.");
                    }

                    const successMsg = `🎬 Clip Vidéo rangé avec succès !\n\nDestination : ${result.export_dir}\nFichier(s) : ${result.files_count}\n\n✨ Retrouvez votre vidéo dans le Lecteur > Onglet « 🎬 Clips » !\nLe dossier temporaire a été nettoyé.`;

                    await showModalAlert("Vidéothèque mise à jour", successMsg, "success");
                } else {
                    await showModalAlert("Erreur d'exportation vidéo", result.message || "Erreur lors du rangement de la vidéo.", "danger");
                }
            } catch (err) {
                await showModalAlert("Erreur", err.message, "danger");
            } finally {
                directVideoExportBtn.disabled = false;
                directVideoExportBtn.innerHTML = originalBtnHtml;
            }
        });
    }

    let currentSmartDestInfo = null;

    openExportModalBtn.addEventListener("click", async () => {
        if (!currentAlbumPath) {
            await showModalAlert("Aucun album sélectionné", "Veuillez d'abord sélectionner ou télécharger un album.", "warning");
            return;
        }
        exportPanel.style.display = exportPanel.style.display === "none" ? "block" : "none";
        currentSmartDestInfo = null;
        
        const isVideo = currentAlbumManualType === "video" || currentAlbumDetectedType === "video" ||
            (currentAlbumPath && (currentAlbumPath.includes("[Vidéo]") || currentAlbumPath.includes("[Video]"))) ||
            document.querySelectorAll('#tracks-table-body td[title$=".mp4"], #tracks-table-body td[title$=".mkv"], #tracks-table-body td[title$=".webm"]').length > 0;
            
        const targetInput = document.getElementById("export-dir-input");
        const titleEl = document.getElementById("export-panel-title");
        const descEl = document.getElementById("export-panel-desc");

        const smartCard = document.getElementById("smart-export-preview-card");
        const smartDestText = document.getElementById("smart-export-dest-text");
        const smartConflictAlert = document.getElementById("smart-export-conflict-alert");
        const smartConflictMsg = document.getElementById("smart-export-conflict-msg");

        if (isVideo) {
            targetInput.value = currentConfig.video_export_dir || currentConfig.video_library_dir || "";
            if (currentAlbumIsConcert) {
                if (titleEl) titleEl.innerHTML = `Export Concert / Live : <code>Artiste / Concerts / [Titre].mp4</code>`;
                if (descEl) descEl.textContent = "Le concert sera exporté dans votre dossier Vidéos YTM sous le sous-dossier Concerts de l'artiste (isolé des clips).";
            } else {
                if (titleEl) titleEl.innerHTML = `Export Vidéo Clip : <code>Artiste / [Titre].mp4</code>`;
                if (descEl) descEl.textContent = "Le clip sera exporté dans votre dossier Vidéos YTM sous le sous-dossier de l'artiste.";
            }
            if (smartCard) smartCard.style.display = "none";
        } else if (currentConfig.smart_export !== false && currentConfig.library_dir) {
            // Résolution intelligente prédictive
            if (titleEl) titleEl.innerHTML = `Export Intelligent : <code>Collection Musicale / Artiste / Album</code>`;
            if (descEl) descEl.textContent = "L'album sera directement intégré au bon endroit dans votre collection avec harmonisation des dossiers existants.";
            targetInput.value = currentConfig.library_dir;

            if (smartCard) {
                smartCard.style.display = "block";
                if (smartDestText) smartDestText.textContent = "Calcul de la destination intelligente...";
                if (smartConflictAlert) smartConflictAlert.style.display = "none";

                fetch("/api/library/resolve-export-destination", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ album_dir: currentAlbumPath })
                }).then(res => res.json()).then(destInfo => {
                    currentSmartDestInfo = destInfo;
                    if (smartDestText) {
                        let text = destInfo.dest_dir;
                        if (destInfo.matched_existing_artist) {
                            text += ` (✓ Dossier artiste existant « ${destInfo.artist_folder} » réutilisé)`;
                        }
                        smartDestText.textContent = text;
                    }
                    if (destInfo.conflict && smartConflictAlert) {
                        smartConflictAlert.style.display = "block";
                        if (smartConflictMsg) {
                            smartConflictMsg.textContent = `Cet album existe déjà dans votre collection (${destInfo.existing_tracks_count} pistes détectées).`;
                        }
                        const prefPolicy = currentConfig.smart_export_conflict_policy || "merge";
                        const radio = document.querySelector(`input[name="export-conflict-choice"][value="${prefPolicy}"]`);
                        if (radio) radio.checked = true;
                    } else if (smartConflictAlert) {
                        smartConflictAlert.style.display = "none";
                    }
                }).catch(() => {
                    if (smartCard) smartCard.style.display = "none";
                });
            }
        } else if (currentAlbumIsPlaylist) {
            targetInput.value = currentConfig.export_dir || "";
            if (titleEl) titleEl.innerHTML = `Export Playlist : <code>Various Artists / Playlist / Pistes</code>`;
            if (descEl) descEl.textContent = "La playlist sera isolée dans son propre dossier et ses morceaux numérotés sans polluer vos albums studio.";
            if (smartCard) smartCard.style.display = "none";
        } else {
            targetInput.value = currentConfig.export_dir || "";
            if (titleEl) titleEl.innerHTML = `Export Finalisé : <code>Artiste / Album / Pistes</code>`;
            if (descEl) descEl.textContent = "L'album sera copié ou déplacé dans la structure hiérarchique propre selon les métadonnées définies ci-dessus.";
            if (smartCard) smartCard.style.display = "none";
        }

        document.getElementById("delete-temp-checkbox").checked = currentConfig.delete_temp_after_export !== false;
        updateQuickDestButtons("export-dir-input");
        updateEditorExportUIState();
    });

    const editorExportCartBtn = document.getElementById("btn-editor-export-cart");
    if (editorExportCartBtn) {
        editorExportCartBtn.addEventListener("click", () => {
            if (!currentAlbumPath) {
                showToast("Veuillez d'abord sélectionner un album ou une vidéo dans l'éditeur.", "warning");
                return;
            }
            const isVideo = isCurrentEditorItemVideo();
            const artist = (document.getElementById("edit-album-artist")?.value || "").trim() || "Artiste";
            const albumName = (document.getElementById("edit-album-name")?.value || "").trim() || "Album";
            const trackRows = document.querySelectorAll("#tracks-table-body tr:not(.missing-track-row)");

            if (typeof window.addToExportCart === "function") {
                window.addToExportCart({
                    type: isVideo ? "video" : "album",
                    path: currentAlbumPath,
                    title: isVideo ? (trackRows[0]?.querySelector(".track-title-input")?.value || albumName) : albumName,
                    artist: artist,
                    album: albumName,
                    year: document.getElementById("edit-album-year")?.value || "",
                    genre: document.getElementById("edit-album-genre")?.value || "",
                    tracks_count: trackRows.length || 1
                });
            }
        });
    }

    cancelExportBtn.addEventListener("click", () => {
        exportPanel.style.display = "none";
        // Réinitialiser le bouton de confirmation s'il était bloqué
        // (ex: l'utilisateur ferme le panneau pendant un export en cours)
        if (confirmExportBtn.disabled) {
            confirmExportBtn.disabled = false;
            confirmExportBtn.textContent = "Confirmer l'Exportation";
        }
    });

    confirmExportBtn.addEventListener("click", async () => {
        if (!currentAlbumPath) return;
        releaseMediaHandlesForPath(currentAlbumPath);

        const albumName = document.getElementById("edit-album-name").value.trim();
        const albumArtist = document.getElementById("edit-album-artist").value.trim();
        const year = document.getElementById("edit-album-year").value.trim();
        const genre = document.getElementById("edit-album-genre").value.trim();

        // Récupérer les pistes personnalisées
        const customTracks = [];
        const rows = document.querySelectorAll("#tracks-table-body tr:not(.missing-track-row)");
        rows.forEach((row, idx) => {
            const filename = row.getAttribute("data-filename");
            const trackNum = row.getAttribute("data-track-num") || (idx + 1);
            const titleInput = row.querySelector(".track-title-input");
            const artistInput = row.querySelector(".track-artist-input");
            const genreInput = row.querySelector(".track-genre-input");
            if (filename) {
                customTracks.push({
                    filename: filename,
                    title: titleInput ? titleInput.value.trim() : "",
                    artist: artistInput ? artistInput.value.trim() : "",
                    genre: genreInput ? genreInput.value.trim() : "",
                    track_number: trackNum
                });
            }
        });

        let exportWithCustomTags = true;
        // Vérifier si des modifications de tags n'ont pas été sauvegardées
        if (editorDirtyState[currentAlbumPath]) {
            const choice = await showModalChoice3(
                "Tags non sauvegardés",
                "Vous avez modifié les métadonnées de cet album sans les sauvegarder.\n\nQue souhaitez-vous faire avant l'exportation ?\n\n• Sauvegarder & Exporter : enregistre vos modifications sur les fichiers puis lance l'export.\n• Exporter les tags d'origine : ignore vos modifications en cours et exporte les anciens tags.\n• Annuler : interrompt l'exportation pour continuer vos modifications.",
                "💾 Sauvegarder & Exporter",
                "Annuler",
                "⏩ Exporter l'original",
                false
            );
            if (choice === "cancel") return;
            if (choice === "confirm") {
                confirmExportBtn.disabled = true;
                confirmExportBtn.textContent = "Sauvegarde des tags...";
                try {
                    const saveRes = await fetch("/api/album/retag", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            album_dir: currentAlbumPath,
                            custom_album: albumName,
                            custom_artist: albumArtist,
                            custom_year: year,
                            custom_genre: genre,
                            rename_files: true,
                            clean_titles: true,
                            custom_tracks: customTracks.length > 0 ? customTracks : undefined,
                            is_playlist: currentAlbumIsPlaylist,
                            custom_album_type: currentAlbumManualType || (currentAlbumDetectedType === "video" ? "video" : "auto")
                        })
                    });
                    const saveResult = await saveRes.json();
                    if (saveResult.success) {
                        const oldP = currentAlbumPath;
                        clearCurrentEditorDraft(oldP);
                        if (saveResult.album_dir) {
                            currentAlbumPath = saveResult.album_dir;
                            clearCurrentEditorDraft(currentAlbumPath);
                        }
                        delete editorDraftsByAlbum[oldP];
                        delete editorDraftsByAlbum[currentAlbumPath];
                        delete editorDirtyState[oldP];
                        delete editorDirtyState[currentAlbumPath];
                        clearEditorDirty();
                    } else {
                        showToast("Avertissement : la sauvegarde préalable des tags a échoué (" + saveResult.message + ").", "warning");
                    }
                } catch (e) {
                    showToast("Erreur lors de la sauvegarde préalable : " + e.message, "danger");
                }
                exportWithCustomTags = true;
            } else if (choice === "extra") {
                exportWithCustomTags = false;
            }
        }

        const targetBase = document.getElementById("export-dir-input").value.trim();
        const deleteTemp = document.getElementById("delete-temp-checkbox").checked;

        let conflictPolicy = currentConfig.smart_export_conflict_policy || "merge";
        const selectedRadio = document.querySelector('input[name="export-conflict-choice"]:checked');
        if (selectedRadio) {
            conflictPolicy = selectedRadio.value;
        }

        // Si l'album existe déjà dans la collection, ouvrir la modale dédiée d'arbitrage
        if (currentSmartDestInfo && currentSmartDestInfo.conflict) {
            const albumDisplayName = exportWithCustomTags ? albumName : (currentAlbumInfo ? currentAlbumInfo.album_name : (currentAlbumPath ? currentAlbumPath.split(/[/\\]/).pop() : "Album"));
            const artistDisplayName = exportWithCustomTags ? albumArtist : (currentAlbumInfo ? currentAlbumInfo.album_artist : "Artiste");
            const chosenPolicy = await showExportConflictModal(
                albumDisplayName,
                artistDisplayName,
                currentSmartDestInfo.existing_tracks_count || 0,
                conflictPolicy
            );
            if (!chosenPolicy) {
                // Annulé par l'utilisateur
                return;
            }
            conflictPolicy = chosenPolicy;
            const radio = document.querySelector(`input[name="export-conflict-choice"][value="${conflictPolicy}"]`);
            if (radio) radio.checked = true;
        }

        confirmExportBtn.disabled = true;
        confirmExportBtn.textContent = "Exportation en cours...";

        try {
            const effectiveAlbumType = currentAlbumManualType || (currentAlbumDetectedType === "video" ? "video" : undefined);
            const res = await fetch("/api/album/export", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    album_dir: currentAlbumPath,
                    target_base_dir: targetBase,
                    delete_temp: deleteTemp,
                    custom_album: exportWithCustomTags ? albumName : undefined,
                    custom_artist: exportWithCustomTags ? albumArtist : undefined,
                    custom_year: exportWithCustomTags ? year : undefined,
                    custom_genre: exportWithCustomTags ? genre : undefined,
                    custom_tracks: (exportWithCustomTags && customTracks.length > 0) ? customTracks : undefined,
                    is_playlist: currentAlbumIsPlaylist,
                    is_concert: currentAlbumIsConcert,
                    conflict_policy: conflictPolicy,
                    custom_album_type: effectiveAlbumType
                })
            });

            let result;
            try {
                result = await res.json();
            } catch (e) {
                throw new Error(`Erreur serveur (${res.status} ${res.statusText})`);
            }

            if (res.ok && result.success) {
                const isVideoExport = !!(result.album === "Vidéos" || result.album === "Concerts" || effectiveAlbumType === "video" || currentAlbumIsConcert);

                let successMsg = "";
                if (isVideoExport) {
                    const isConcert = result.album === "Concerts" || currentAlbumIsConcert;
                    successMsg = `🎬 ${isConcert ? "Concert" : "Clip Vidéo"} exporté avec succès !\n\nDestination : ${result.export_dir}\nFichiers exportés : ${result.files_count}\n\n✨ Retrouvez votre vidéo dans le Lecteur > Onglet « ${isConcert ? "🎸 Concerts" : "🎬 Clips"} » !${deleteTemp ? "\n\nLe dossier temporaire a été nettoyé." : ""}`;
                } else {
                    successMsg = `Album exporté avec succès !\n\nDestination : ${result.export_dir}\nFichiers exportés : ${result.files_count}${result.is_smart ? "\n\n✨ Intégré directement dans votre collection musicale !" : ""}${deleteTemp ? "\n\nLe dossier temporaire a été intégralement vidé." : ""}`;
                }
                if (result.conflict) {
                    successMsg += `\n\nℹ️ Cet élément existait déjà : fusion effectuée (${result.conflict_policy === 'overwrite' ? 'fichiers remplacés' : 'fichiers existants préservés sans doublon'}).`;
                }

                exportPanel.style.display = "none";
                // Nettoyer immédiatement le dirty state de cet album
                delete editorDirtyState[currentAlbumPath];

                // Synchronisation instantanée : Bibliothèque locale + Atelier + Navigation
                if (typeof loadLibrary === "function") {
                    loadLibrary();
                }
                if (typeof refreshAlbumNavList === "function") {
                    await refreshAlbumNavList();
                }
                if (typeof loadExternalTempAlbums === "function") {
                    loadExternalTempAlbums();
                }
                if (typeof window.refreshSearchBadges === "function") {
                    window.refreshSearchBadges();
                } else if (typeof enrichItemsWithLibraryStatus === "function") {
                    enrichItemsWithLibraryStatus();
                }
                // Auto-sync immédiate du Lecteur Audio (Collection & Temporaire)
                if (window.AudioPlayer) {
                    if (typeof window.AudioPlayer.loadLibraryData === "function") {
                        window.AudioPlayer.loadLibraryData(true);
                    }
                    if (typeof window.AudioPlayer.loadAndRenderVideosCatalog === "function") {
                        window.AudioPlayer.loadAndRenderVideosCatalog(true);
                    }
                    if (typeof window.AudioPlayer.loadAndRenderConcertsCatalog === "function") {
                        window.AudioPlayer.loadAndRenderConcertsCatalog(true);
                    }
                }

                if (deleteTemp) {
                    // Rafraîchir la navigation et charger l'album suivant s'il y en a
                    if (tempAlbumsList.length > 0) {
                        currentAlbumIndex = Math.min(currentAlbumIndex, tempAlbumsList.length - 1);
                        await loadAlbumInEditor(tempAlbumsList[currentAlbumIndex].path);
                    } else {
                        resetEditorState("Dossier temporaire vide", "Tous les albums temporaires ont été exportés.");
                    }
                    if (!currentAlbumPath) {
                        const wb = document.getElementById("editor-warning-banner");
                        if (wb) wb.style.display = "none";
                        
                        // Réinitialiser le formulaire de téléchargement
                        document.getElementById("url-input").value = "";
                        document.getElementById("start-download-btn").disabled = false;
                        document.getElementById("start-download-btn").style.display = "inline-flex";
                        document.getElementById("cancel-download-btn").style.display = "none";
                        document.getElementById("progress-container").style.display = "none";
                        document.getElementById("global-status-badge").className = "badge badge-idle";
                        document.getElementById("global-status-badge").textContent = "Atelier";
                        document.getElementById("global-status-badge").title = "Ouvrir / Replier l'Atelier (Raccourci: Maj+W)";
                    }
                }

                await showModalAlert(
                    isVideoExport ? "Exportation Vidéo Réussie" : "Exportation réussie",
                    successMsg,
                    "success"
                );
            } else {
                await showModalAlert("Erreur d'exportation", result.message || "Erreur lors de l'export.", "danger");
            }
        } catch (err) {
            await showModalAlert("Erreur", err.message, "danger");
        } finally {
            confirmExportBtn.disabled = false;
            confirmExportBtn.textContent = "Confirmer l'Exportation";
        }
    });

    applyBtn.addEventListener("click", async () => {
        if (!currentAlbumPath) return;

        const albumName = document.getElementById("edit-album-name").value.trim();
        const albumArtist = document.getElementById("edit-album-artist").value.trim();
        const year = document.getElementById("edit-album-year").value.trim();
        const genre = document.getElementById("edit-album-genre").value.trim();

        const isVideoItem = isCurrentEditorItemVideo();

        // Récupérer les pistes personnalisées
        const customTracks = [];
        const rows = document.querySelectorAll("#tracks-table-body tr:not(.missing-track-row)");
        rows.forEach((row, idx) => {
            const filename = row.getAttribute("data-filename");
            const trackNum = row.getAttribute("data-track-num") || (idx + 1);
            const titleInput = row.querySelector(".track-title-input");
            const artistInput = row.querySelector(".track-artist-input");
            const genreInput = row.querySelector(".track-genre-input");
            if (filename) {
                let cleanTitle = titleInput ? titleInput.value.trim() : "";
                if (isVideoItem) {
                    cleanTitle = cleanVideoTitleFromArtist(cleanTitle, albumArtist);
                }
                customTracks.push({
                    filename: filename,
                    title: cleanTitle,
                    artist: isVideoItem ? albumArtist : (artistInput ? artistInput.value.trim() : ""),
                    genre: isVideoItem ? "" : (genreInput ? genreInput.value.trim() : ""),
                    track_number: isVideoItem ? "" : trackNum
                });
            }
        });

        clearTimeout(_editorDraftSaveTimer);
        applyBtn.disabled = true;
        applyBtn.textContent = "Sauvegarde en cours...";

        try {
            const res = await fetch("/api/album/retag", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    album_dir: currentAlbumPath,
                    custom_album: isVideoItem ? (albumName || "Vidéos") : albumName,
                    custom_artist: albumArtist,
                    custom_year: isVideoItem ? "" : year,
                    custom_genre: isVideoItem ? "" : genre,
                    rename_files: true,
                    clean_titles: true,
                    custom_tracks: customTracks.length > 0 ? customTracks : undefined,
                    is_playlist: currentAlbumIsPlaylist,
                    custom_album_type: currentAlbumManualType || (isVideoItem ? "video" : "auto")
                })
            });

            const result = await res.json();
            if (result.success) {
                const oldAlbumPath = currentAlbumPath;
                clearCurrentEditorDraft(oldAlbumPath);
                if (result.album_dir) {
                    currentAlbumPath = result.album_dir;
                    clearCurrentEditorDraft(currentAlbumPath);
                }

                delete editorDraftsByAlbum[oldAlbumPath];
                delete editorDraftsByAlbum[currentAlbumPath];
                delete editorDirtyState[oldAlbumPath];
                delete editorDirtyState[currentAlbumPath];
                clearEditorDirty();

                if (window.AudioPlayer && typeof window.AudioPlayer.remapAlbumPaths === "function" && oldAlbumPath !== currentAlbumPath) {
                    window.AudioPlayer.remapAlbumPaths(oldAlbumPath, currentAlbumPath, {
                        artist: albumArtist,
                        title: albumName,
                        genre: genre,
                        year: year
                    });
                }

                const isVideosMode = (window.editorSubMode === "videos" || isVideoItem);
                await showModalAlert("Succès", isVideosMode ? "Tags de la vidéo enregistrés avec succès !" : (isCollectionEditorMode ? "Tags enregistrés et collection mise à jour !" : "Tags sauvegardés et album mis à jour !"), "success");
                if (isVideosMode) {
                    await loadVideoLibraryForEditor(true);
                    if (videosSelect) videosSelect.value = currentAlbumPath;
                    await loadAlbumInEditor(currentAlbumPath, "videos");
                    if (window.AudioPlayer) {
                        if (typeof window.AudioPlayer.loadAndRenderVideosCatalog === "function") window.AudioPlayer.loadAndRenderVideosCatalog(true);
                        if (typeof window.AudioPlayer.loadAndRenderConcertsCatalog === "function") window.AudioPlayer.loadAndRenderConcertsCatalog(true);
                    }
                } else if (isCollectionEditorMode) {
                    await loadCollectionAlbumsForEditor();
                    await loadAlbumInEditor(currentAlbumPath, "collection");
                    if (window.AudioPlayer) {
                        if (typeof window.AudioPlayer.loadLibraryData === "function") window.AudioPlayer.loadLibraryData(true);
                        if (typeof window.AudioPlayer.loadAndRenderVideosCatalog === "function") window.AudioPlayer.loadAndRenderVideosCatalog(true);
                        if (typeof window.AudioPlayer.loadAndRenderConcertsCatalog === "function") window.AudioPlayer.loadAndRenderConcertsCatalog(true);
                    }
                    if (typeof loadGenreBatchAlbums === "function") loadGenreBatchAlbums(true);
                    if (typeof loadCoversGalleryAlbums === "function") loadCoversGalleryAlbums(true);
                } else {
                    await refreshAlbumNavList();
                    await loadAlbumInEditor(currentAlbumPath, "temp");
                    if (typeof loadExternalTempAlbums === "function") loadExternalTempAlbums();
                    if (typeof updateTempTabBadge === "function") updateTempTabBadge();
                    if (typeof loadLibrary === "function") loadLibrary();
                    if (window.AudioPlayer) {
                        if (typeof window.AudioPlayer.loadLibraryData === "function") window.AudioPlayer.loadLibraryData(true);
                        if (typeof window.AudioPlayer.loadAndRenderVideosCatalog === "function") window.AudioPlayer.loadAndRenderVideosCatalog(true);
                        if (typeof window.AudioPlayer.loadAndRenderConcertsCatalog === "function") window.AudioPlayer.loadAndRenderConcertsCatalog(true);
                    }
                    if (typeof loadGenreBatchAlbums === "function") loadGenreBatchAlbums(true);
                    if (typeof loadCoversGalleryAlbums === "function") loadCoversGalleryAlbums(true);
                }
            } else {
                await showModalAlert("Erreur", result.message || "Erreur lors de la sauvegarde.", "danger");
            }
        } catch (err) {
            await showModalAlert("Erreur", err.message, "danger");
        } finally {
            applyBtn.disabled = false;
            updateEditorSourceModeUI();
        }
    });

    openFolderBtn.addEventListener("click", async () => {
        if (!currentAlbumPath) return;
        try {
            await fetch("/api/album/open-folder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: currentAlbumPath })
            });
        } catch (err) {
            await showModalAlert("Erreur", err.message, "danger");
        }
    });

    deleteCurrentBtn.addEventListener("click", async () => {
        if (!currentAlbumPath) return;
        releaseMediaHandlesForPath(currentAlbumPath);

        if (window.editorSubMode === "videos") {
            const vidTitle = document.getElementById("editor-album-title")?.textContent.trim() || "Vidéo";
            await confirmDeleteCollectionItem(currentAlbumPath, "video", vidTitle);
            return;
        }

        if (isCollectionEditorMode) {
            const albumName = document.getElementById("edit-album-name")?.value.trim() || document.getElementById("editor-album-title")?.textContent.trim() || "Album";
            await confirmDeleteCollectionItem(currentAlbumPath, "album", albumName);
            return;
        }

        const confirmed = await showModalConfirm(
            "Supprimer l'album temporaire",
            "Voulez-vous vraiment supprimer cet album du dossier temporaire ?\nTous les fichiers non exportés seront définitivement perdus.",
            "Supprimer",
            true
        );
        if (confirmed) {
            try {
                const res = await fetch("/api/album/temp", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ path: currentAlbumPath })
                });
                const result = await res.json();
                if (result.success) {
                    delete editorDirtyState[currentAlbumPath];
                    await refreshAlbumNavList();
                    if (tempAlbumsList.length > 0) {
                        currentAlbumIndex = Math.min(currentAlbumIndex, tempAlbumsList.length - 1);
                        await loadAlbumInEditor(tempAlbumsList[currentAlbumIndex].path);
                    } else {
                        resetEditorState("Dossier temporaire vide", "Aucun album à taguer");
                    }
                    loadLibrary();
                    await showModalAlert("Album supprimé", "L'album a été retiré du dossier temporaire.", "info");
                } else {
                    await showModalAlert("Erreur", result.message || "Erreur lors de la suppression.", "danger");
                }
            } catch (err) {
                await showModalAlert("Erreur", err.message, "danger");
            }
        }
    });

    // Navigation multi-albums
    const navPrevBtn = document.getElementById("album-nav-prev");
    const navNextBtn = document.getElementById("album-nav-next");
    if (navPrevBtn) navPrevBtn.addEventListener("click", navPrevAlbum);
    if (navNextBtn) navNextBtn.addEventListener("click", navNextAlbum);

    // Bascule de l'emplacement des flèches (Gauche / Droite)
    const navPosBtn = document.getElementById("album-nav-pos-btn");
    const navBarEl = document.getElementById("album-nav-bar");
    if (navPosBtn && navBarEl) {
        const savedPos = localStorage.getItem("ytm_album_nav_pos") || "left";
        if (savedPos === "right") {
            navBarEl.classList.add("nav-pos-right");
            navPosBtn.textContent = "⇄ Flèches à gauche";
            navPosBtn.title = "Placer les flèches de navigation à gauche";
        } else {
            navPosBtn.textContent = "⇄ Flèches à droite";
            navPosBtn.title = "Placer les flèches de navigation à droite";
        }
        navPosBtn.addEventListener("click", () => {
            const isRight = navBarEl.classList.toggle("nav-pos-right");
            const newPos = isRight ? "right" : "left";
            localStorage.setItem("ytm_album_nav_pos", newPos);
            navPosBtn.textContent = isRight ? "⇄ Flèches à gauche" : "⇄ Flèches à droite";
            navPosBtn.title = isRight ? "Placer les flèches de navigation à gauche" : "Placer les flèches de navigation à droite";
            if (typeof showToast === "function") {
                showToast(`Flèches de navigation fixées à ${isRight ? "droite" : "gauche"}`, "info", 2000);
            }
        });
    }

    // Raccourcis clavier universels dans l'éditeur : Alt + Flèche Gauche / Droite
    document.addEventListener("keydown", (e) => {
        if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
            const navBar = document.getElementById("album-nav-bar");
            if (navBar && navBar.style.display !== "none" && tempAlbumsList && tempAlbumsList.length > 1) {
                e.preventDefault();
                if (e.key === "ArrowLeft") {
                    navPrevAlbum();
                } else {
                    navNextAlbum();
                }
            }
        }
    });

    // Bouton "Tout exporter"
    const exportAllEditorBtn = document.getElementById("export-all-editor-btn");
    if (exportAllEditorBtn) {
        exportAllEditorBtn.addEventListener("click", async () => {
            if (!tempAlbumsList || tempAlbumsList.length === 0) {
                showToast("Le dossier temporaire est vide. Aucun album à exporter.", "warning");
                return;
            }

            // Vérifier si au moins un album a des modifications non sauvegardées
            const dirtyAlbums = Object.entries(editorDirtyState).filter(([_, dirty]) => dirty);
            if (dirtyAlbums.length > 0) {
                const choice = await showModalChoice3(
                    "Tags non sauvegardés",
                    `${dirtyAlbums.length} album(s) comportent des modifications de tags non sauvegardées.\n\nQue souhaitez-vous faire pour ces albums avant l'exportation groupée ?\n\n• Sauvegarder tout & Exporter : enregistre tous vos brouillons modifiés avant de tout exporter.\n• Exporter les originaux : ignore les modifications non sauvegardées et exporte les anciens tags.\n• Annuler : interrompt l'exportation groupée.`,
                    "💾 Sauvegarder tout & Exporter",
                    "Annuler",
                    "⏩ Exporter les originaux",
                    false
                );
                if (choice === "cancel") return;
                if (choice === "confirm") {
                    if (currentAlbumPath && editorDirtyState[currentAlbumPath]) {
                        saveCurrentEditorDraft();
                    }
                    exportAllEditorBtn.disabled = true;
                    exportAllEditorBtn.textContent = "Sauvegarde des brouillons...";
                    for (const [albPath] of dirtyAlbums) {
                        const draft = editorDraftsByAlbum[albPath];
                        if (draft) {
                            try {
                                const retagRes = await fetch("/api/album/retag", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        album_dir: albPath,
                                        custom_album: draft.album_name,
                                        custom_artist: draft.album_artist,
                                        custom_year: draft.year,
                                        custom_genre: draft.genre,
                                        rename_files: true,
                                        clean_titles: true,
                                        custom_tracks: (draft.tracks && draft.tracks.length > 0) ? draft.tracks : undefined,
                                        is_playlist: draft.is_playlist
                                    })
                                });
                                const retagData = await retagRes.json();
                                clearCurrentEditorDraft(albPath);
                                if (retagData && retagData.album_dir) {
                                    clearCurrentEditorDraft(retagData.album_dir);
                                    delete editorDraftsByAlbum[retagData.album_dir];
                                    delete editorDirtyState[retagData.album_dir];
                                }
                                delete editorDraftsByAlbum[albPath];
                                delete editorDirtyState[albPath];
                            } catch (e) {
                                console.warn("Erreur sauvegarde draft:", e);
                            }
                        }
                    }
                }
            }

            const isSmartActive = Boolean(currentConfig && currentConfig.smart_export !== false && currentConfig.library_dir);
            const targetDir = isSmartActive ? currentConfig.library_dir : (currentConfig.export_dir || "Dossier d'export par défaut");

            const confirmed = await showModalConfirm(
                isSmartActive ? "✨ Tout exporter (Export Intelligent)" : "Tout exporter",
                isSmartActive
                    ? `Voulez-vous exporter les ${tempAlbumsList.length} album(s) du dossier temporaire directement vers votre collection musicale ?\n\n📁 Destination : ${targetDir}\n\n✨ Mode : Exportation Intelligente activée\nChaque album sera automatiquement classé au bon endroit sous le dossier de son artiste (avec harmonisation et gestion intelligente des doublons).\n\nLe dossier temporaire sera vidé après export.`
                    : `Exporter les ${tempAlbumsList.length} album(s) du dossier temporaire vers votre dossier d'exportation ?\n\n📁 Destination : ${targetDir}\n\nChaque album sera classé en Artiste / Album et le dossier temporaire sera vidé.`,
                isSmartActive ? "Confirmer l'Export Intelligent" : "Tout exporter"
            );
            if (!confirmed) return;
            if (Array.isArray(tempAlbumsList)) {
                tempAlbumsList.forEach(a => releaseMediaHandlesForPath(a.path));
            }

            exportAllEditorBtn.disabled = true;
            exportAllEditorBtn.textContent = "Export en cours...";

            try {
                const res = await fetch("/api/temp/export-all", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        target_base_dir: isSmartActive ? currentConfig.library_dir : (currentConfig.export_dir || null),
                        delete_temp: true,
                        conflict_policy: currentConfig.smart_export_conflict_policy || "merge"
                    })
                });
                const result = await res.json();
                if (result.success) {
                    tempAlbumsList = [];
                    currentAlbumIndex = -1;
                    resetEditorState("Tous les albums exportés", "");
                    if (typeof loadLibrary === "function") loadLibrary();
                    if (typeof refreshAlbumNavList === "function") refreshAlbumNavList();
                    if (window.AudioPlayer && typeof window.AudioPlayer.loadLibraryData === "function") {
                        window.AudioPlayer.loadLibraryData(true);
                    }
                    if (typeof window.refreshSearchBadges === "function") {
                        window.refreshSearchBadges();
                    } else if (typeof enrichItemsWithLibraryStatus === "function") {
                        enrichItemsWithLibraryStatus();
                    }
                    await showModalAlert(
                        isSmartActive ? "Exportation Intelligente terminée" : "Export terminé",
                        isSmartActive
                            ? `${result.exported_albums_count || "Tous les"} album(s) intégrés avec succès dans votre collection musicale :\n${targetDir}`
                            : (result.message || "Tous les albums ont été exportés."),
                        "success"
                    );
                } else {
                    await showModalAlert("Erreur", result.message || "Erreur lors de l'export groupé.", "danger");
                }
            } catch (err) {
                await showModalAlert("Erreur", err.message, "danger");
            } finally {
                updateEditorInteractiveState();
            }
        });
    }

    // Activer le tracking des modifications (dirty state)
    setupEditorDirtyTracking();

    // Verrouiller l'éditeur par défaut si aucun album n'est encore chargé
    updateEditorInteractiveState();
}

// ═══════════════════════════════════════════════════════════════════
// Navigation multi-albums dans l'éditeur
// ═══════════════════════════════════════════════════════════════════

async function refreshAlbumNavList() {
    try {
        const res = await fetch("/api/albums");
        const data = await res.json();
        const allTemp = data.temp_albums || [];
        tempAlbumsList = allTemp.filter(a => a.track_count > 0);
        updateTempTabBadge(allTemp.length);
    } catch (e) {
        console.warn("refreshAlbumNavList:", e);
        tempAlbumsList = [];
        updateTempTabBadge(0);
    }
    updateAlbumNavUI();
    updateEditorInteractiveState();
}

function updateAlbumNavUI() {
    const navBar = document.getElementById("album-nav-bar");
    const indicator = document.getElementById("album-nav-indicator");
    const prevBtn = document.getElementById("album-nav-prev");
    const nextBtn = document.getElementById("album-nav-next");
    if (!navBar) return;

    if (isCollectionEditorMode || tempAlbumsList.length <= 1) {
        navBar.style.display = "none";
        return;
    }

    navBar.style.display = "flex";

    // Synchroniser currentAlbumIndex avec currentAlbumPath
    if (currentAlbumPath) {
        const idx = tempAlbumsList.findIndex(a => a.path === currentAlbumPath);
        if (idx >= 0) {
            currentAlbumIndex = idx;
        } else {
            navBar.style.display = "none";
            return;
        }
    }

    const total = tempAlbumsList.length;
    const current = currentAlbumIndex >= 0 ? currentAlbumIndex + 1 : 1;
    const albumName = tempAlbumsList[currentAlbumIndex]?.name || "";
    indicator.innerHTML = `<span class="album-nav-badge">${current} / ${total}</span> <span class="album-nav-sep">—</span> <span class="album-nav-title" title="${escapeHtml(albumName)}">${escapeHtml(albumName)}</span>`;
    indicator.title = `${current} / ${total} — ${albumName}`;

    prevBtn.disabled = (currentAlbumIndex <= 0);
    nextBtn.disabled = (currentAlbumIndex >= total - 1);
}

function captureCurrentEditorDraft() {
    if (!currentAlbumPath) return null;
    const nameInput = document.getElementById("edit-album-name");
    const artistInput = document.getElementById("edit-album-artist");
    const yearInput = document.getElementById("edit-album-year");
    const genreInput = document.getElementById("edit-album-genre");

    const tracks = [];
    const rows = document.querySelectorAll("#tracks-table-body tr:not(.missing-track-row)");
    rows.forEach((row, idx) => {
        const filename = row.getAttribute("data-filename");
        const trackNum = row.getAttribute("data-track-num") || (idx + 1);
        const titleInput = row.querySelector(".track-title-input");
        const trackArtistInput = row.querySelector(".track-artist-input");
        const trackGenreInput = row.querySelector(".track-genre-input");
        if (filename) {
            tracks.push({
                filename: filename,
                track_number: trackNum,
                title: titleInput ? titleInput.value : "",
                artist: trackArtistInput ? trackArtistInput.value : "",
                genre: trackGenreInput ? trackGenreInput.value : ""
            });
        }
    });

    return {
        album_name: nameInput ? nameInput.value : "",
        album_artist: artistInput ? artistInput.value : "",
        year: yearInput ? yearInput.value : "",
        genre: genreInput ? genreInput.value : "",
        is_playlist: !!currentAlbumIsPlaylist,
        is_concert: !!currentAlbumIsConcert,
        tracks: tracks,
        updated_at: Date.now()
    };
}

let _editorDraftSaveTimer = null;
function saveCurrentEditorDraft() {
    if (!currentAlbumPath) return;
    const draft = captureCurrentEditorDraft();
    if (!draft) return;

    editorDraftsByAlbum[currentAlbumPath] = draft;
    editorDirtyState[currentAlbumPath] = true;

    try {
        localStorage.setItem("ytm_editor_draft_" + currentAlbumPath, JSON.stringify(draft));
    } catch (e) {
        console.warn("Erreur localStorage saveCurrentEditorDraft:", e);
    }

    clearTimeout(_editorDraftSaveTimer);
    _editorDraftSaveTimer = setTimeout(() => {
        if (!currentAlbumPath) return;
        fetch("/api/album/save-draft", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                album_dir: currentAlbumPath,
                draft: draft
            })
        }).catch(err => console.warn("Erreur sauvegarde draft backend:", err));
    }, 350);
}

function clearCurrentEditorDraft(albumPath) {
    if (!albumPath) return;
    clearTimeout(_editorDraftSaveTimer);
    delete editorDraftsByAlbum[albumPath];
    delete editorDirtyState[albumPath];

    try {
        localStorage.removeItem("ytm_editor_draft_" + albumPath);
    } catch (e) {}

    fetch("/api/album/clear-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ album_dir: albumPath })
    }).catch(err => console.warn("Erreur suppression draft backend:", err));
}

function updateEditorDirtyUI(isDirty) {
    const indicator = document.getElementById("editor-dirty-indicator");
    const resetBtn = document.getElementById("editor-reset-draft-btn");
    if (indicator) indicator.style.display = isDirty ? "inline-flex" : "none";
    if (resetBtn) resetBtn.style.display = isDirty ? "inline-flex" : "none";
}

function markEditorDirty() {
    if (!currentAlbumPath) return;
    editorDirtyState[currentAlbumPath] = true;
    updateEditorDirtyUI(true);
    saveCurrentEditorDraft();
}

function clearEditorDirty() {
    if (!currentAlbumPath) return;
    editorDirtyState[currentAlbumPath] = false;
    updateEditorDirtyUI(false);
}

async function navPrevAlbum() {
    if (currentAlbumIndex <= 0 || tempAlbumsList.length === 0) return;
    if (currentAlbumPath && editorDirtyState[currentAlbumPath]) {
        saveCurrentEditorDraft();
    }
    currentAlbumIndex--;
    await loadAlbumInEditor(tempAlbumsList[currentAlbumIndex].path);
}

async function navNextAlbum() {
    if (currentAlbumIndex >= tempAlbumsList.length - 1) return;
    if (currentAlbumPath && editorDirtyState[currentAlbumPath]) {
        saveCurrentEditorDraft();
    }
    currentAlbumIndex++;
    await loadAlbumInEditor(tempAlbumsList[currentAlbumIndex].path);
}

// ===================================================================
// Sanctuarisation de l'Éditeur & Gestion de la Collection
// ===================================================================

function isPathEqualOrDescendant(activePath, targetPath) {
    if (!activePath || !targetPath) return false;
    const normActive = String(activePath).replace(/[\\/]+/g, "/").toLowerCase().replace(/\/+$/, "");
    const normTarget = String(targetPath).replace(/[\\/]+/g, "/").toLowerCase().replace(/\/+$/, "");
    return normActive === normTarget || normActive.startsWith(normTarget + "/");
}

function resetEditorState(customTitle = "Sélectionnez un album", customPath = "Aucun dossier chargé") {
    if (currentAlbumPath) {
        delete editorDirtyState[currentAlbumPath];
        clearCurrentEditorDraft(currentAlbumPath);
    }
    currentAlbumPath = null;
    currentAlbumIsPlaylist = false;
    currentAlbumIsConcert = false;
    currentAlbumManualType = null;
    currentAlbumDetectedType = "album";
    updateEditorTypeToggleUI("album", false);
    updateEditorBadgePreview("album", false);
    const wb = document.getElementById("editor-warning-banner");
    if (wb) wb.style.display = "none";
    const titleEl = document.getElementById("editor-album-title");
    if (titleEl) titleEl.textContent = customTitle;
    const pathEl = document.getElementById("editor-album-path");
    if (pathEl) pathEl.textContent = customPath;
    const nameEl = document.getElementById("edit-album-name");
    if (nameEl) {
        nameEl.value = "";
        delete nameEl.dataset.originalAlbumName;
    }
    const artEl = document.getElementById("edit-album-artist");
    if (artEl) artEl.value = "";
    const yrEl = document.getElementById("edit-album-year");
    if (yrEl) yrEl.value = "";
    const genEl = document.getElementById("edit-album-genre");
    if (genEl) genEl.value = "";
    const covEl = document.getElementById("editor-cover");
    if (covEl) covEl.src = "/static/placeholder-cover.png";
    const tbody = document.getElementById("tracks-table-body");
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" class="table-empty-cell"><div class="table-empty-state"><svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg><span>Aucune piste chargée.</span></div></td></tr>`;
    }
    const artBadge = document.getElementById("artist-collection-match-badge");
    if (artBadge) artBadge.style.display = "none";
    const albBadge = document.getElementById("album-collection-match-badge");
    if (albBadge) albBadge.style.display = "none";
    clearEditorDirty();
    updateAlbumNavUI();
    updateEditorInteractiveState();
    if (typeof updateEditorVideoModeUI === "function") {
        updateEditorVideoModeUI();
    }
}

function updateEditorInteractiveState() {
    const hasAlbum = Boolean(currentAlbumPath);
    const tempCount = (typeof tempAlbumsList !== "undefined" && Array.isArray(tempAlbumsList)) ? tempAlbumsList.length : 0;

    // 1. Verrouillage / Déverrouillage des 4 champs de saisie de métadonnées
    const inputsConfig = [
        { id: "edit-album-name", placeholderActive: "Ex: Violator, Discovery...", placeholderDisabled: "Aucun album chargé (Saisie désactivée)" },
        { id: "edit-album-artist", placeholderActive: "Ex: Depeche Mode, Daft Punk...", placeholderDisabled: "Aucun album chargé (Saisie désactivée)" },
        { id: "edit-album-year", placeholderActive: "Ex: 2024", placeholderDisabled: "----" },
        { id: "edit-album-genre", placeholderActive: "Ex: Variété française, Pop, Rock...", placeholderDisabled: "Aucun album chargé (Saisie désactivée)" }
    ];

    inputsConfig.forEach(({ id, placeholderActive, placeholderDisabled }) => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = !hasAlbum;
            el.placeholder = hasAlbum ? placeholderActive : placeholderDisabled;
            if (!hasAlbum) {
                el.value = "";
                el.classList.add("input-disabled-state");
            } else {
                el.classList.remove("input-disabled-state");
            }
        }
    });

    // 2. Verrouillage / Déverrouillage des boutons d'actions unitaires
    const albumActionBtnIds = [
        "apply-uniform-btn",            // Sauvegarder les tags
        "open-export-modal-btn",        // Exporter l'Album
        "direct-video-export-btn",      // Ranger dans la Vidéothèque
        "btn-search-cover-ytm",         // Changer jaquette
        "editor-play-album-btn",        // Écouter l'album
        "musicbrainz-magic-tag-btn",    // Tags MusicBrainz Magiques
        "musicbrainz-lookup-btn",       // feat. MusicBrainz
        "open-folder-btn",              // Ouvrir Dossier
        "delete-current-album-btn",     // Supprimer (Temp / Collection)
        "detect-genre-btn",             // Détecter genre
        "apply-genre-to-all-btn",       // Appliquer genre à tous
        "toggle-type-auto-btn",         // Type Auto
        "toggle-type-album-btn",        // Type Studio
        "toggle-type-single-btn",       // Type Single
        "toggle-type-rip-btn",          // Type Rip Audio
        "toggle-type-playlist-btn",     // Type Playlist
        "toggle-type-concert-btn",      // Type Concert & Live
        "toggle-type-video-btn"         // Type Clip Vidéo
    ];

    albumActionBtnIds.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.disabled = !hasAlbum;
            if (!hasAlbum) {
                btn.classList.add("btn-disabled-state");
            } else {
                btn.classList.remove("btn-disabled-state");
            }
        }
    });

    // 3. Gestion stricte du bouton "Tout exporter" de l'éditeur
    const exportAllBtn = document.getElementById("export-all-editor-btn");
    if (exportAllBtn) {
        if (isCollectionEditorMode) {
            exportAllBtn.style.display = "none";
        } else {
            exportAllBtn.style.display = "inline-flex";
            const canExport = tempCount > 0;
            exportAllBtn.disabled = !canExport;
            if (canExport) {
                exportAllBtn.classList.remove("btn-disabled-state");
                exportAllBtn.title = `Exporter les ${tempCount} album(s) du dossier temporaire`;
                exportAllBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2v9.67z"/></svg> 📦 Tout exporter (${tempCount})`;
            } else {
                exportAllBtn.classList.add("btn-disabled-state");
                exportAllBtn.title = "Dossier temporaire vide (aucun album à exporter)";
                exportAllBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2v9.67z"/></svg> 📦 Tout exporter`;
            }
        }
    }

    // 4. Masquer le panneau d'export et les indicateurs si aucun album
    if (!hasAlbum) {
        const exportPanel = document.getElementById("export-panel");
        if (exportPanel) exportPanel.style.display = "none";
        const dirtyIndicator = document.getElementById("editor-dirty-indicator");
        if (dirtyIndicator) dirtyIndicator.style.display = "none";
        const resetDraftBtn = document.getElementById("editor-reset-draft-btn");
        if (resetDraftBtn) resetDraftBtn.style.display = "none";
        const artBadge = document.getElementById("artist-collection-match-badge");
        if (artBadge) artBadge.style.display = "none";
        const albBadge = document.getElementById("album-collection-match-badge");
        if (albBadge) albBadge.style.display = "none";
    }
}

async function verifyAndValidateEditorActiveAlbum() {
    if (!currentAlbumPath) return;
    try {
        const res = await fetch(`/api/album/info?path=${encodeURIComponent(currentAlbumPath)}`);
        if (!res.ok) {
            console.warn("Éditeur : Le dossier actif n'existe plus sur le disque, réinitialisation automatique :", currentAlbumPath);
            resetEditorState();
            await refreshAlbumNavList();
            if (tempAlbumsList && tempAlbumsList.length > 0) {
                currentAlbumIndex = 0;
                await loadAlbumInEditor(tempAlbumsList[0].path);
            }
        }
    } catch (e) {
        console.warn("Erreur vérification dossier actif éditeur:", e);
    }
}

// ===================================================================
// Autocomplétion Intelligente des Tags depuis la Collection Musicale
// ===================================================================

// cachedTagSuggestions on window
let isFetchingTagSuggestions = false;

async function ensureLibraryTagSuggestions(force = false) {
    if (cachedTagSuggestions && !force) return cachedTagSuggestions;
    if (isFetchingTagSuggestions) return null;
    isFetchingTagSuggestions = true;
    try {
        const res = await fetch("/api/library/tag-suggestions");
        if (res.ok) {
            cachedTagSuggestions = await res.json();
            populateTagSuggestionsDatalists();
        }
    } catch (err) {
        console.warn("Erreur chargement suggestions tags:", err);
    } finally {
        isFetchingTagSuggestions = false;
    }
    return cachedTagSuggestions;
}

function populateTagSuggestionsDatalists() {
    if (!cachedTagSuggestions) return;

    const artistDatalist = document.getElementById("editor-artists-datalist");
    if (artistDatalist && cachedTagSuggestions.artists) {
        artistDatalist.innerHTML = cachedTagSuggestions.artists
            .map(art => `<option value="${escapeHtml(art)}">`)
            .join("");
    }

    const yearsDatalist = document.getElementById("editor-years-datalist");
    if (yearsDatalist && cachedTagSuggestions.years) {
        yearsDatalist.innerHTML = cachedTagSuggestions.years
            .map(yr => `<option value="${escapeHtml(yr)}">`)
            .join("");
    }

    const genresDatalist = document.getElementById("genres-datalist");
    if (genresDatalist && cachedTagSuggestions.genres) {
        const existingOptions = new Set(Array.from(genresDatalist.querySelectorAll("option")).map(o => o.value.trim().toLowerCase()));
        cachedTagSuggestions.genres.forEach(g => {
            if (!existingOptions.has(g.trim().toLowerCase())) {
                const opt = document.createElement("option");
                opt.value = g;
                genresDatalist.appendChild(opt);
                existingOptions.add(g.trim().toLowerCase());
            }
        });
    }

    updateEditorAlbumsDatalist();
    updateCollectionMatchBadges();
}

function updateEditorAlbumsDatalist(artistName = null) {
    if (!cachedTagSuggestions) return;
    const albumDatalist = document.getElementById("editor-albums-datalist");
    if (!albumDatalist) return;

    const artInput = document.getElementById("edit-album-artist");
    const currentArtist = (artistName !== null ? artistName : (artInput ? artInput.value : "")).trim();

    let albumsToShow = [];
    if (currentArtist && cachedTagSuggestions.artist_albums) {
        const artLower = currentArtist.toLowerCase();
        const matchingKey = Object.keys(cachedTagSuggestions.artist_albums).find(k => k.toLowerCase() === artLower);
        if (matchingKey && cachedTagSuggestions.artist_albums[matchingKey]?.length > 0) {
            albumsToShow = cachedTagSuggestions.artist_albums[matchingKey];
        }
    }

    if (albumsToShow.length === 0 && cachedTagSuggestions.albums) {
        albumsToShow = cachedTagSuggestions.albums;
    }

    albumDatalist.innerHTML = albumsToShow
        .map(alb => `<option value="${escapeHtml(alb)}">`)
        .join("");
}

function updateCollectionMatchBadges() {
    const artInput = document.getElementById("edit-album-artist");
    const albInput = document.getElementById("edit-album-name");
    const artBadge = document.getElementById("artist-collection-match-badge");
    const albBadge = document.getElementById("album-collection-match-badge");

    const artistVal = (artInput?.value || "").trim();
    const albumVal = (albInput?.value || "").trim();

    if (artBadge) {
        if (!artistVal || !cachedTagSuggestions) {
            artBadge.style.display = "none";
        } else {
            const exactArt = (cachedTagSuggestions.artists || []).find(a => a.toLowerCase() === artistVal.toLowerCase());
            if (exactArt) {
                artBadge.className = "badge badge-sm badge-collection-match";
                if (exactArt === artistVal) {
                    artBadge.textContent = "✓ Dans la collection";
                    artBadge.title = "Cet artiste existe déjà dans votre bibliothèque musicale.";
                } else {
                    artBadge.textContent = `✓ Suggéré : ${exactArt}`;
                    artBadge.title = `Cliquer pour adopter la casse officielle : ${exactArt}`;
                }
                artBadge.style.display = "inline-flex";
            } else {
                artBadge.className = "badge badge-sm badge-collection-new";
                artBadge.textContent = "+ Nouvel artiste";
                artBadge.title = "Cet artiste n'est pas encore répertorié dans votre collection.";
                artBadge.style.display = "inline-flex";
            }
        }
    }

    if (albBadge) {
        if (!albumVal || !cachedTagSuggestions) {
            albBadge.style.display = "none";
        } else {
            let isKnown = false;
            if (artistVal && cachedTagSuggestions.artist_albums) {
                const artLower = artistVal.toLowerCase();
                const matchingKey = Object.keys(cachedTagSuggestions.artist_albums).find(k => k.toLowerCase() === artLower);
                if (matchingKey) {
                    isKnown = (cachedTagSuggestions.artist_albums[matchingKey] || []).some(a => a.toLowerCase() === albumVal.toLowerCase());
                }
            }
            if (!isKnown && cachedTagSuggestions.albums) {
                isKnown = (cachedTagSuggestions.albums || []).some(a => a.toLowerCase() === albumVal.toLowerCase());
            }

            if (isKnown) {
                albBadge.className = "badge badge-sm badge-collection-match";
                albBadge.textContent = "✓ Album connu";
                albBadge.title = "Cet album est déjà répertorié dans votre collection.";
                albBadge.style.display = "inline-flex";
            } else {
                albBadge.className = "badge badge-sm badge-collection-new";
                albBadge.textContent = "+ Nouvel album";
                albBadge.title = "Cet album sera créé comme nouvel album dans votre collection.";
                albBadge.style.display = "inline-flex";
            }
        }
    }
}

function setupEditorDirtyTracking() {
    // Champs album globaux
    ["edit-album-name", "edit-album-artist", "edit-album-year", "edit-album-genre"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("input", markEditorDirty);
    });

    const artInput = document.getElementById("edit-album-artist");
    if (artInput) {
        artInput.addEventListener("input", () => {
            updateEditorAlbumsDatalist(artInput.value);
            updateCollectionMatchBadges();
            if (isCurrentEditorItemVideo()) {
                const newArt = artInput.value.trim();
                document.querySelectorAll("#tracks-table-body tr").forEach(tr => {
                    const trackArtistInput = tr.querySelector(".track-artist-input");
                    if (trackArtistInput) trackArtistInput.value = artInput.value;
                    const titleInput = tr.querySelector(".track-title-input");
                    if (titleInput && newArt) {
                        let clean = cleanVideoTitleFromArtist(titleInput.value, newArt);
                        if (clean && clean !== titleInput.value) {
                            titleInput.value = clean;
                        }
                    }
                });
            }
        });
        artInput.addEventListener("blur", () => {
            if (cachedTagSuggestions && cachedTagSuggestions.artists) {
                const trimmed = artInput.value.trim();
                const exact = cachedTagSuggestions.artists.find(a => a.toLowerCase() === trimmed.toLowerCase());
                if (exact && exact !== trimmed) {
                    artInput.value = exact;
                    markEditorDirty();
                }
            }
            updateEditorAlbumsDatalist(artInput.value);
            updateCollectionMatchBadges();
            if (isCurrentEditorItemVideo()) {
                const newArt = artInput.value.trim();
                document.querySelectorAll("#tracks-table-body tr").forEach(tr => {
                    const trackArtistInput = tr.querySelector(".track-artist-input");
                    if (trackArtistInput) trackArtistInput.value = artInput.value;
                    const titleInput = tr.querySelector(".track-title-input");
                    if (titleInput && newArt) {
                        let clean = cleanVideoTitleFromArtist(titleInput.value, newArt);
                        if (clean && clean !== titleInput.value) {
                            titleInput.value = clean;
                        }
                    }
                });
            }
        });
    }

    const albInput = document.getElementById("edit-album-name");
    if (albInput) {
        albInput.addEventListener("input", () => {
            updateCollectionMatchBadges();
        });
        albInput.addEventListener("change", () => {
            if (cachedTagSuggestions && cachedTagSuggestions.album_details) {
                const artistVal = (document.getElementById("edit-album-artist")?.value || "").trim();
                const albumVal = albInput.value.trim();
                const detailKey = `${artistVal} - ${albumVal}`.toLowerCase();
                const detail = cachedTagSuggestions.album_details[detailKey];
                if (detail) {
                    const yrInput = document.getElementById("edit-album-year");
                    const genInput = document.getElementById("edit-album-genre");
                    if (yrInput && !yrInput.value.trim() && detail.year) {
                        yrInput.value = detail.year;
                        markEditorDirty();
                    }
                    if (genInput && !genInput.value.trim() && detail.genre) {
                        genInput.value = detail.genre;
                        markEditorDirty();
                    }
                }
            }
            updateCollectionMatchBadges();
        });
    }

    const artBadge = document.getElementById("artist-collection-match-badge");
    if (artBadge) {
        artBadge.style.cursor = "pointer";
        artBadge.addEventListener("click", () => {
            if (cachedTagSuggestions && cachedTagSuggestions.artists && artInput) {
                const trimmed = artInput.value.trim();
                const exact = cachedTagSuggestions.artists.find(a => a.toLowerCase() === trimmed.toLowerCase());
                if (exact && exact !== trimmed) {
                    artInput.value = exact;
                    markEditorDirty();
                    updateEditorAlbumsDatalist(exact);
                    updateCollectionMatchBadges();
                }
            }
        });
    }

    // Champs pistes (délégation sur le tbody)
    const tbody = document.getElementById("tracks-table-body");
    if (tbody) {
        tbody.addEventListener("input", (e) => {
            if (e.target.matches(".track-title-input, .track-artist-input, .track-genre-input")) {
                markEditorDirty();
            }
        });
    }

    // Bouton de réinitialisation / abandon du brouillon
    const resetDraftBtn = document.getElementById("editor-reset-draft-btn");
    if (resetDraftBtn) {
        resetDraftBtn.addEventListener("click", async () => {
            if (!currentAlbumPath) return;
            const confirmed = await showModalConfirm(
                "Rétablir les tags d'origine",
                "Voulez-vous abandonner toutes les modifications en cours pour cet album et rétablir les métadonnées d'origine du disque ?",
                "Rétablir l'original",
                true
            );
            if (confirmed) {
                clearCurrentEditorDraft(currentAlbumPath);
                await loadAlbumInEditor(currentAlbumPath);
                showToast("Brouillon abandonné, métadonnées du disque rétablies.", "info");
            }
        });
    }
}

// Charger les données d'un album dans l'éditeur
async function loadAlbumInEditor(albumPath, modeOrIsCollection = null) {
    currentAlbumPath = albumPath;

    // Déterminer le sous-mode de manière robuste :
    const pathLow = String(albumPath || "").toLowerCase();
    const isVideoFile = pathLow.endsWith(".mp4") || pathLow.endsWith(".mkv") || pathLow.endsWith(".webm") || pathLow.endsWith(".avi") || pathLow.endsWith(".mov") || pathLow.endsWith(".m4v");

    let targetMode = "temp";
    if (modeOrIsCollection === "videos" || window.editorSubMode === "videos" || isVideoFile) {
        targetMode = "videos";
    } else if (modeOrIsCollection === "collection" || modeOrIsCollection === true) {
        targetMode = "collection";
    } else if (modeOrIsCollection === "temp" || modeOrIsCollection === false) {
        targetMode = "temp";
    } else if (window.editorSubMode) {
        targetMode = window.editorSubMode;
    }

    window.editorSourceMode = targetMode;
    window.editorWorkMode = "single";
    window.editorSubMode = targetMode;
    isCollectionEditorMode = (targetMode === "collection");
    updateEditorSourceModeUI();

    if (targetMode === "temp") {
        if (tempAlbumsList.length === 0) await refreshAlbumNavList();
        updateAlbumNavUI();
    } else if (targetMode === "collection") {
        const select = document.getElementById("editor-collection-select");
        if (select && albumPath && select.value !== albumPath) {
            select.value = albumPath;
        }
    } else if (targetMode === "videos") {
        const vSelect = document.getElementById("editor-videos-select");
        if (vSelect && albumPath && vSelect.value !== albumPath) {
            vSelect.value = albumPath;
        }
    }
    try {
        const res = await fetch(`/api/album/info?path=${encodeURIComponent(albumPath)}`);
        if (!res.ok) throw new Error("Album non trouvé");
        const info = await res.json();

        if (targetMode === "collection") {
            const select = document.getElementById("editor-collection-select");
            if (select && albumPath) {
                for (let i = 0; i < select.options.length; i++) {
                    if (select.options[i].value === albumPath) {
                        select.selectedIndex = i;
                        break;
                    }
                }
            }
        } else if (targetMode === "videos") {
            const vSelect = document.getElementById("editor-videos-select");
            if (vSelect && albumPath) {
                let found = false;
                for (let i = 0; i < vSelect.options.length; i++) {
                    if (vSelect.options[i].value === albumPath) {
                        vSelect.selectedIndex = i;
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    const opt = document.createElement("option");
                    opt.value = albumPath;
                    const typeIcon = (info.album_type === "concert" || info.is_concert) ? "🎸 [Concert]" : "🎬 [Clip]";
                    opt.textContent = `${typeIcon} ${info.album_artist || "Inconnu"} - ${info.album_name || "Média"}`;
                    vSelect.appendChild(opt);
                    vSelect.value = albumPath;
                }
            }
        }

        // Récupérer un éventuel brouillon (en mémoire, localStorage ou backend)
        let activeDraft = editorDraftsByAlbum[albumPath] || null;
        if (!activeDraft) {
            try {
                const raw = localStorage.getItem("ytm_editor_draft_" + albumPath);
                if (raw) activeDraft = JSON.parse(raw);
            } catch (e) {}
        }
        if (!activeDraft && info.editor_draft) {
            activeDraft = info.editor_draft;
        }

        if (activeDraft) {
            editorDraftsByAlbum[albumPath] = activeDraft;
            editorDirtyState[albumPath] = true;
            updateEditorDirtyUI(true);
        } else {
            clearEditorDirty();
        }

        currentAlbumIsPlaylist = (activeDraft && activeDraft.is_playlist !== undefined)
            ? !!activeDraft.is_playlist
            : !!info.is_playlist;

        currentAlbumIsConcert = (activeDraft && activeDraft.is_concert !== undefined)
            ? !!activeDraft.is_concert
            : !!info.is_concert;

        const isSinglesRips = !currentAlbumIsPlaylist && !currentAlbumIsConcert && info.album_name && info.album_name.toLowerCase() === "singles & rips";
        const isVideoFolder = info.album_type === "video" || info.album_type === "clip" || !!info.is_video || (info.tracks && info.tracks.some(t => {
            const ext = (t.filepath || t.filename || "").toLowerCase();
            return ext.endsWith(".mp4") || ext.endsWith(".mkv") || ext.endsWith(".webm");
        }));
        let initialToggleMode = info.album_type || "album";
        if (isVideoFolder && !currentAlbumIsConcert) initialToggleMode = "video";
        else if (currentAlbumIsPlaylist) initialToggleMode = "playlist";
        else if (currentAlbumIsConcert) initialToggleMode = "concert";
        else if (isSinglesRips) initialToggleMode = "rip";

        currentAlbumDetectedType = info.album_type || initialToggleMode;

        if (info.is_manual_type && info.manual_type) {
            currentAlbumManualType = info.manual_type;
            updateEditorTypeToggleUI(currentAlbumManualType, true);
            updateEditorBadgePreview(currentAlbumManualType, true);
        } else {
            currentAlbumManualType = null;
            updateEditorTypeToggleUI(currentAlbumDetectedType, false);
            updateEditorBadgePreview(currentAlbumDetectedType, false);
        }

        const effectiveAlbumName = (activeDraft && activeDraft.album_name !== undefined) ? activeDraft.album_name : (info.album_name || "");
        const effectiveArtist = (activeDraft && activeDraft.album_artist !== undefined) ? activeDraft.album_artist : (info.album_artist || "");
        let effectiveYear = (activeDraft && activeDraft.year !== undefined) ? activeDraft.year : (info.year || "");
        const effectiveGenre = (activeDraft && activeDraft.genre !== undefined) ? activeDraft.genre : (info.genre || "");

        // Formatage strict de l'année sur 4 chiffres YYYY si non-brouillon
        if (!activeDraft) {
            const ym = effectiveYear.match(/\b(19\d\d|20\d\d)\b/);
            if (ym) {
                effectiveYear = ym[1];
            } else if (effectiveYear.length >= 4 && /^(19\d\d|20\d\d)/.test(effectiveYear)) {
                effectiveYear = effectiveYear.substring(0, 4);
            } else {
                effectiveYear = "";
            }
        }

        const nameInputEl = document.getElementById("edit-album-name");
        nameInputEl.value = effectiveAlbumName;
        if (effectiveAlbumName && effectiveAlbumName.trim().toLowerCase() !== "singles & rips") {
            nameInputEl.dataset.originalAlbumName = effectiveAlbumName.replace(/\s*\[(playlist|mix|compilation)\]/gi, "").trim();
        }
        document.getElementById("editor-album-title").textContent = effectiveAlbumName || (currentAlbumIsPlaylist ? "Playlist sans nom" : (currentAlbumIsConcert ? "Concert sans nom" : "Album sans nom"));
        document.getElementById("editor-album-path").textContent = info.album_dir;
        document.getElementById("edit-album-artist").value = effectiveArtist;
        document.getElementById("edit-album-year").value = effectiveYear;
        document.getElementById("edit-album-genre").value = effectiveGenre;

        updateEditorAlbumsDatalist(effectiveArtist);
        updateCollectionMatchBadges();
        updateEditorInteractiveState();

        const coverImg = document.getElementById("editor-cover");
        if (info.cover_art) {
            coverImg.src = `/api/cover?path=${encodeURIComponent(info.cover_art)}&t=${Date.now()}`;
        } else if (info.album_dir) {
            coverImg.src = `/api/audio/cover?path=${encodeURIComponent(info.album_dir)}&t=${Date.now()}`;
        } else {
            coverImg.src = "/static/placeholder-cover.png";
        }

        // Gestion du bandeau d'avertissement de pistes manquantes
        const warningBanner = document.getElementById("editor-warning-banner");
        const warningText = document.getElementById("editor-warning-text");
        const reconstituteBtn = document.getElementById("editor-reconstitute-btn");
        if (info.missing_tracks && info.missing_tracks.length > 0) {
            const missingList = info.missing_tracks.map(n => String(n).padStart(2, '0')).join(', ');
            if (warningText) {
                warningText.textContent = `${info.missing_tracks.length} piste(s) manquante(s) : ${missingList}. L'album ou la playlist semble incomplet sur la source.`;
            }
            if (warningBanner) warningBanner.style.display = "flex";
            if (reconstituteBtn) {
                reconstituteBtn.onclick = () => {
                    openReconstituteModal(info.album_dir);
                };
            }
        } else {
            if (warningBanner) warningBanner.style.display = "none";
        }

        const tbody = document.getElementById("tracks-table-body");
        tbody.innerHTML = "";

        function getTrackFieldValues(track) {
            if (activeDraft && activeDraft.tracks && Array.isArray(activeDraft.tracks)) {
                const dt = activeDraft.tracks.find(d => d.filename === track.filename);
                if (dt) {
                    return {
                        title: dt.title !== undefined ? dt.title : (track.title || ""),
                        artist: dt.artist !== undefined ? dt.artist : (track.artist || info.album_artist || ""),
                        genre: dt.genre !== undefined ? dt.genre : (track.genre || info.genre || "")
                    };
                }
            }
            return {
                title: track.title || "",
                artist: track.artist || info.album_artist || "",
                genre: track.genre || info.genre || ""
            };
        }

        function createEditorTrackRow(track, trackNum, fields) {
            const tr = document.createElement("tr");
            tr.setAttribute("data-filename", track.filename);
            tr.setAttribute("data-track-num", trackNum);
            tr.innerHTML = `
                <td><span class="track-num-badge">${trackNum || "--"}</span></td>
                <td><input type="text" class="track-title-input" value="${escapeHtml(fields.title)}" placeholder="Titre de la piste"></td>
                <td><input type="text" class="track-artist-input" list="editor-artists-datalist" value="${escapeHtml(fields.artist)}" placeholder="Artiste"></td>
                <td><input type="text" class="track-genre-input" list="genres-datalist" value="${escapeHtml(fields.genre)}" placeholder="Genre"></td>
                <td class="text-muted" style="font-family: var(--font-mono); font-size: 0.8rem;" title="${escapeHtml(track.filename)}">${escapeHtml(track.filename)}</td>
                <td style="text-align: center; white-space: nowrap;">
                    <div style="display: inline-flex; gap: 4px; justify-content: center;">
                        <button type="button" class="btn btn-ghost btn-sm btn-editor-track-export" title="Ajouter ce morceau au panier d'export de l'Atelier" style="padding: 3px 6px; color: var(--accent, #89b4fa);">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                        </button>
                        <button type="button" class="btn btn-ghost btn-sm btn-editor-track-add-playlist" title="Ajouter ce morceau à une playlist" style="padding: 3px 6px;">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/></svg>
                        </button>
                        <button type="button" class="btn btn-ghost btn-sm btn-editor-track-trash" title="Déplacer cette piste vers la Corbeille Windows" style="padding: 3px 6px; color: var(--danger, #ef4444);">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                        </button>
                    </div>
                </td>
            `;

            if (isCurrentEditorItemVideo()) {
                const tdNum = tr.children[0];
                const tdArtist = tr.children[2];
                const tdGenre = tr.children[3];
                if (tdNum) tdNum.style.display = "none";
                if (tdArtist) tdArtist.style.display = "none";
                if (tdGenre) tdGenre.style.display = "none";
                const curArt = (document.getElementById("edit-album-artist")?.value || "").trim();
                const trackArtistInput = tr.querySelector(".track-artist-input");
                if (trackArtistInput && curArt) {
                    trackArtistInput.value = curArt;
                }
                const titleInput = tr.querySelector(".track-title-input");
                if (titleInput) {
                    titleInput.placeholder = "Titre de la vidéo (nom du fichier)";
                    let clean = cleanVideoTitleFromArtist(titleInput.value, curArt);
                    if (clean && clean !== titleInput.value) {
                        titleInput.value = clean;
                    }
                }
            }

            const btnPlay = tr.querySelector(".btn-editor-track-add-playlist");
            if (btnPlay) {
                if (currentAlbumIsConcert || isCurrentEditorItemVideo()) {
                    btnPlay.style.display = "none";
                } else {
                    btnPlay.addEventListener("click", () => {
                        const fullPath = track.path || (info.album_dir ? `${info.album_dir}\\${track.filename}` : track.filename);
                        openAddToPlaylistModal({
                            type: "audio",
                            title: fields.title || track.title || track.filename,
                            artist: fields.artist || track.artist || info.album_artist || "Artiste",
                            duration: track.duration_seconds || track.duration || 0,
                            path: fullPath,
                            album_title: effectiveAlbumName
                        });
                    });
                }
            }

            const btnTrash = tr.querySelector(".btn-editor-track-trash");
            if (btnTrash) {
                btnTrash.addEventListener("click", () => {
                    const fullPath = track.path || (info.album_dir ? `${info.album_dir}\\${track.filename}` : track.filename);
                    confirmDeleteCollectionItem(fullPath, "track", fields.title || track.filename);
                });
            }

            const btnTrackExp = tr.querySelector(".btn-editor-track-export");
            if (btnTrackExp) {
                btnTrackExp.addEventListener("click", () => {
                    const fullPath = track.path || (info.album_dir ? `${info.album_dir}\\${track.filename}` : track.filename);
                    if (typeof window.addToExportCart === "function") {
                        window.addToExportCart({
                            type: isCurrentEditorItemVideo() ? "video" : "track",
                            path: fullPath,
                            title: tr.querySelector(".track-title-input")?.value || fields.title || track.title || track.filename,
                            artist: tr.querySelector(".track-artist-input")?.value || fields.artist || track.artist || info.album_artist || "Artiste",
                            album: effectiveAlbumName || "",
                            year: document.getElementById("edit-album-year")?.value || info.album_year || "",
                            genre: tr.querySelector(".track-genre-input")?.value || fields.genre || track.genre || "",
                            track_num: trackNum
                        });
                    }
                });
            }

            return tr;
        }

        if (info.tracks && info.tracks.length > 0) {
            const missingSet = new Set(info.missing_tracks || []);
            const maxTrack = info.max_track || info.tracks.length;

            // Associer chaque piste à son numéro effectif
            const tracksByNum = new Map();
            const unnumberedTracks = [];

            info.tracks.forEach(t => {
                let num = null;
                const fnMatch = t.filename ? t.filename.match(/^(\d{1,3})[\s\.\-_]/) : null;
                if (fnMatch) {
                    num = parseInt(fnMatch[1], 10);
                } else if (t.track_number) {
                    const tnMatch = String(t.track_number).match(/^(\d+)/);
                    if (tnMatch) num = parseInt(tnMatch[1], 10);
                }

                if (num !== null && !tracksByNum.has(num)) {
                    tracksByNum.set(num, t);
                } else {
                    unnumberedTracks.push(t);
                }
            });

            // Si on a des pistes manquantes et des numéros valides, afficher dans l'ordre séquentiel de 1 à maxTrack
            if (missingSet.size > 0 && tracksByNum.size > 0) {
                for (let i = 1; i <= maxTrack; i++) {
                    if (missingSet.has(i)) {
                        const tr = document.createElement("tr");
                        tr.className = "missing-track-row";
                        tr.innerHTML = `
                            <td><span class="track-num-badge badge-missing">${String(i).padStart(2, '0')}</span></td>
                            <td colspan="4" class="text-warning">
                                <em>⚠️ Piste ${String(i).padStart(2, '0')} manquante (Non disponible ou absente de la source)</em>
                            </td>
                            <td style="text-align: right;">
                                <button type="button" class="btn btn-warning btn-sm btn-replace-missing" data-track-num="${i}" style="padding: 2px 10px; font-size: 0.78rem;">
                                    🔍 Remplacer...
                                </button>
                            </td>
                        `;
                        const btnReplace = tr.querySelector(".btn-replace-missing");
                        if (btnReplace) {
                            btnReplace.addEventListener("click", () => {
                                openReconstituteModal(info.album_dir, i);
                            });
                        }
                        tbody.appendChild(tr);
                    } else if (tracksByNum.has(i)) {
                        const track = tracksByNum.get(i);
                        const fields = getTrackFieldValues(track);
                        tbody.appendChild(createEditorTrackRow(track, track.track_number || String(i).padStart(2, '0'), fields));
                    }
                }
                unnumberedTracks.forEach(track => {
                    const fields = getTrackFieldValues(track);
                    tbody.appendChild(createEditorTrackRow(track, track.track_number || "--", fields));
                });
            } else {
                const isSingleOrRip = info.tracks.length === 1 || (info.album_name && info.album_name.toLowerCase().includes("singles"));
                info.tracks.forEach((track, idx) => {
                    const displayNum = isSingleOrRip ? "--" : (track.track_number || String(idx + 1).padStart(2, '0'));
                    const fields = getTrackFieldValues(track);
                    tbody.appendChild(createEditorTrackRow(track, displayNum, fields));
                });
            }
        } else {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Aucun morceau audio trouvé dans ce dossier.</td></tr>`;
        }

        if (typeof updateEditorVideoModeUI === "function") {
            updateEditorVideoModeUI();
        }
    } catch (err) {
        console.error("Erreur chargement album:", err);
        resetEditorState();
    }
}

// Bibliothèque

// ==========================================================================
// MODULE 3.1.0 : ÉDITEUR DE GENRES PAR LOT & ACTIONS RAPIDES
// ==========================================================================

const UNIVERSAL_GENRE_PRESETS = [
    "Rock", "Pop", "Synthwave", "Électro", "Metal", 
    "Hip-Hop", "Jazz", "Classique", "Variété française", 
    "Soundtrack", "Ambient", "R&B / Soul", "Punk", "Disco"
];

function setGenreBatchScope(scope) {
    if (scope === "temp") {
        window.editorSourceMode = "temp";
    } else if (scope === "library" || scope === "collection") {
        window.editorSourceMode = "collection";
    }
}
window.setGenreBatchScope = setGenreBatchScope;

function initGenreBatchUI() {
    if (window._genreBatchUIInitialized) return;
    window._genreBatchUIInitialized = true;

    // Champ de Recherche
    const searchInput = document.getElementById("genre-batch-search-input");
    const searchClearBtn = document.getElementById("genre-batch-search-clear");
    if (searchInput) {
        let debounceTimer = null;
        searchInput.addEventListener("input", () => {
            const val = searchInput.value;
            window.genreBatchSearchQuery = val;
            if (searchClearBtn) searchClearBtn.style.display = val ? "inline-flex" : "none";
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                renderGenreBatchTable();
            }, 120);
        });
    }

    if (searchClearBtn && searchInput) {
        searchClearBtn.addEventListener("click", () => {
            searchInput.value = "";
            window.genreBatchSearchQuery = "";
            searchClearBtn.style.display = "none";
            renderGenreBatchTable();
            searchInput.focus();
        });
    }

    // Champs Cibles du Lot (Artiste, Genre, Année)
    const targetArtistInput = document.getElementById("batch-target-artist-input");
    if (targetArtistInput) {
        targetArtistInput.addEventListener("input", () => {
            updateGenreBatchSelectionUI();
        });
        targetArtistInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                applyGenreBatch();
            }
        });
    }

    const targetInput = document.getElementById("genre-batch-target-input");
    if (targetInput) {
        targetInput.addEventListener("input", () => {
            updateGenreBatchSelectionUI();
        });
        targetInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                applyGenreBatch();
            }
        });
    }

    const targetYearInput = document.getElementById("batch-target-year-input");
    if (targetYearInput) {
        targetYearInput.addEventListener("input", () => {
            updateGenreBatchSelectionUI();
        });
        targetYearInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                applyGenreBatch();
            }
        });
    }

    // Bouton Appliquer les Tags
    const applyBtn = document.getElementById("genre-batch-apply-btn");
    if (applyBtn) {
        applyBtn.addEventListener("click", () => {
            applyGenreBatch();
        });
    }

    // Bouton Détecter Années officielles par lot (MusicBrainz / iTunes)
    const batchDetectYearsBtn = document.getElementById("batch-detect-years-btn");
    if (batchDetectYearsBtn) {
        batchDetectYearsBtn.addEventListener("click", () => {
            batchDetectOfficialYears();
        });
    }

    // Tout sélectionner / Tout désélectionner
    const selectAllBtn = document.getElementById("genre-batch-select-all-btn");
    if (selectAllBtn) {
        selectAllBtn.addEventListener("click", () => {
            const visible = getFilteredGenreBatchAlbums();
            visible.forEach(a => window.genreBatchSelectedPaths.add(a.path));
            updateGenreBatchSelectionUI();
            renderGenreBatchTable();
        });
    }

    const deselectAllBtn = document.getElementById("genre-batch-deselect-all-btn");
    if (deselectAllBtn) {
        deselectAllBtn.addEventListener("click", () => {
            window.genreBatchSelectedPaths.clear();
            updateGenreBatchSelectionUI();
            renderGenreBatchTable();
        });
    }

    // Rafraîchir
    const refreshBtn = document.getElementById("genre-batch-refresh-btn");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", () => {
            loadGenreBatchAlbums(true);
        });
    }

    // Master Checkbox
    const masterChk = document.getElementById("genre-batch-master-checkbox");
    if (masterChk) {
        masterChk.addEventListener("change", () => {
            const visible = getFilteredGenreBatchAlbums();
            if (masterChk.checked) {
                visible.forEach(a => window.genreBatchSelectedPaths.add(a.path));
            } else {
                visible.forEach(a => window.genreBatchSelectedPaths.delete(a.path));
            }
            updateGenreBatchSelectionUI();
            renderGenreBatchTable();
        });
    }
}

async function loadGenreBatchAlbums(forceRefresh = false) {
    const tbody = document.getElementById("genre-batch-table-body");
    if (!tbody) return;

    if (forceRefresh || !window.genreBatchAlbums || window.genreBatchAlbums.length === 0) {
        if (!window.genreBatchAlbums || window.genreBatchAlbums.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="table-empty-cell"><div class="table-empty-state"><span>Chargement des albums et playlists...</span></div></td></tr>`;
        }
        try {
            const res = await fetch(`/api/library/albums?source=all&_t=${Date.now()}`);
            if (!res.ok) throw new Error("Erreur de communication avec le serveur");
            const data = await res.json();
            window.genreBatchAlbums = data.albums || [];

            const genresBadge = document.getElementById("editor-genres-count-badge");
            if (genresBadge) genresBadge.textContent = window.genreBatchAlbums.length;

            updateGenreScopeBadges();
            populateGenreBatchDatalistAndChips();
        } catch (err) {
            if (!window.genreBatchAlbums || window.genreBatchAlbums.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="table-empty-cell"><div class="table-empty-state"><span style="color: var(--color-danger);">Erreur lors de la récupération des albums : ${err.message}</span></div></td></tr>`;
            }
            return;
        }
    }
    renderGenreBatchTable();
}

function updateGenreScopeBadges() {
    let libCount = 0;
    let tempCount = 0;

    (window.genreBatchAlbums || []).forEach(alb => {
        if (alb.source === "temp") tempCount++;
        else libCount++;
    });

    const genresBadge = document.getElementById("editor-genres-count-badge");
    if (genresBadge) {
        if (window.editorSourceMode === "temp") {
            genresBadge.textContent = tempCount;
        } else {
            genresBadge.textContent = libCount;
        }
    }
}

function populateGenreBatchDatalistAndChips() {
    const datalist = document.getElementById("genre-batch-datalist");
    const chipsContainer = document.getElementById("genre-batch-preset-chips");

    const genreFreq = new Map();
    (window.genreBatchAlbums || []).forEach(alb => {
        const g = (alb.genre || "").trim();
        if (g) {
            genreFreq.set(g, (genreFreq.get(g) || 0) + 1);
        }
    });

    if (window.cachedTagSuggestions && Array.isArray(window.cachedTagSuggestions.genres)) {
        window.cachedTagSuggestions.genres.forEach(g => {
            const cleanG = (g || "").trim();
            if (cleanG && !genreFreq.has(cleanG)) genreFreq.set(cleanG, 0);
        });
    }

    if (datalist) {
        datalist.innerHTML = "";
        const sortedGenres = Array.from(genreFreq.keys()).sort((a, b) => a.localeCompare(b));
        sortedGenres.forEach(g => {
            const opt = document.createElement("option");
            opt.value = g;
            datalist.appendChild(opt);
        });
    }

    if (chipsContainer) {
        chipsContainer.innerHTML = "";
        const topGenres = Array.from(genreFreq.entries())
            .filter(([_, count]) => count > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([g]) => g)
            .slice(0, 8);

        const displayedPresets = Array.from(new Set([...topGenres, ...UNIVERSAL_GENRE_PRESETS])).slice(0, 14);

        displayedPresets.forEach(preset => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "genre-preset-chip";
            chip.textContent = preset;
            chip.title = `Définir le genre "${preset}"`;
            chip.addEventListener("click", () => {
                const targetInput = document.getElementById("genre-batch-target-input");
                if (targetInput) {
                    targetInput.value = preset;
                    targetInput.dispatchEvent(new Event("input"));
                }
                chipsContainer.querySelectorAll(".genre-preset-chip").forEach(c => c.classList.remove("active"));
                chip.classList.add("active");
            });
            chipsContainer.appendChild(chip);
        });
    }
}

function getFilteredGenreBatchAlbums() {
    const isTempSource = (window.editorSourceMode === "temp");
    const query = (window.genreBatchSearchQuery || "").toLowerCase().trim();

    return (window.genreBatchAlbums || []).filter(alb => {
        // Filtrage direct selon la source active (Dossier Temporaire vs Ma Collection)
        if (isTempSource) {
            if (alb.source !== "temp") return false;
        } else {
            if (alb.source === "temp") return false;
        }

        if (query) {
            const t = (alb.title || "").toLowerCase();
            const a = (alb.artist || "").toLowerCase();
            const g = (alb.genre || "").toLowerCase();
            const y = (alb.year ? String(alb.year) : "");
            if (!t.includes(query) && !a.includes(query) && !g.includes(query) && !y.includes(query)) {
                return false;
            }
        }
        return true;
    });
}

function renderGenreBatchTable() {
    const tbody = document.getElementById("genre-batch-table-body");
    if (!tbody) return;

    const filtered = getFilteredGenreBatchAlbums();
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="table-empty-cell"><div class="table-empty-state"><span>Aucun album ne correspond aux critères de recherche.</span></div></td></tr>`;
        updateGenreBatchSelectionUI();
        return;
    }

    const fragment = document.createDocumentFragment();

    filtered.forEach(alb => {
        const tr = document.createElement("tr");
        const isSelected = window.genreBatchSelectedPaths.has(alb.path);
        if (isSelected) tr.classList.add("selected");

        const coverSrc = alb.cover_url || `/api/audio/cover?path=${encodeURIComponent(alb.path)}${alb.mtime ? `&v=${Math.floor(alb.mtime)}` : ''}`;
        const curGenre = (alb.genre || "").trim();
        const curYear = (alb.year ? String(alb.year).trim() : "");
        const genreBadgeHtml = curGenre
            ? `<span class="genre-badge-cell" title="${escapeHtml(curGenre)}">${escapeHtml(curGenre)}</span>`
            : `<span class="genre-badge-cell genre-badge-empty">— Aucun —</span>`;

        tr.innerHTML = `
            <td style="text-align: center;">
                <input type="checkbox" class="genre-batch-row-checkbox" data-path="${escapeHtml(alb.path)}" ${isSelected ? "checked" : ""}>
            </td>
            <td style="text-align: center;">
                <img src="${coverSrc}" class="genre-row-cover" loading="lazy" alt="Cover" onerror="this.src='/static/placeholder-cover.svg';">
            </td>
            <td>
                <div style="font-weight: 600; color: var(--text-main); display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                    <span>${escapeHtml(alb.title || "Sans titre")}</span>
                    ${alb.album_type === "playlist" ? `<span class="badge badge-secondary" style="font-size: 0.70rem; padding: 1px 5px;">📋 Playlist</span>` : ""}
                </div>
                <div style="font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono);">${alb.tracks_count ? `${alb.tracks_count} pistes` : ""}</div>
            </td>
            <td>
                <div style="color: var(--text-secondary); font-weight: 500;">${escapeHtml(alb.artist || "Artiste inconnu")}</div>
            </td>
            <td class="col-year" style="text-align: center; white-space: nowrap;">
                <div class="year-quick-unit-wrap">
                    <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" class="year-quick-input" placeholder="AAAA" value="${escapeHtml(curYear)}" data-album-path="${escapeHtml(alb.path)}" title="Corriger l'année de sortie (Appuyez sur Entrée ou cliquez ✓ pour valider)">
                    <button type="button" class="btn-year-magic-detect" data-album-path="${escapeHtml(alb.path)}" title="⚡ Détecter l'année officielle (MusicBrainz / iTunes)">⚡</button>
                    <button type="button" class="btn-year-quick-save" title="Enregistrer l'année">✓</button>
                </div>
            </td>
            <td>
                ${genreBadgeHtml}
            </td>
            <td>
                <div class="genre-quick-unit-wrap">
                    <input type="text" class="genre-quick-input" placeholder="Nouveau genre..." list="genre-batch-datalist" value="${escapeHtml(curGenre)}" data-album-path="${escapeHtml(alb.path)}">
                    <button type="button" class="btn-genre-quick-save" title="Enregistrer le genre pour cet album en 1 clic">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
                        <span>OK</span>
                    </button>
                </div>
            </td>
        `;

        const chk = tr.querySelector(".genre-batch-row-checkbox");
        if (chk) {
            chk.addEventListener("change", () => {
                if (chk.checked) {
                    window.genreBatchSelectedPaths.add(alb.path);
                    tr.classList.add("selected");
                } else {
                    window.genreBatchSelectedPaths.delete(alb.path);
                    tr.classList.remove("selected");
                }
                updateGenreBatchSelectionUI();
            });
        }

        // Gestion de la saisie / détection unitaire d'année
        const quickYearInput = tr.querySelector(".year-quick-input");
        const magicYearBtn = tr.querySelector(".btn-year-magic-detect");
        const quickYearSaveBtn = tr.querySelector(".btn-year-quick-save");

        const saveYear = async (val, isMagic = false) => {
            const cleanY = (val || "").trim();
            if (!cleanY) {
                showToast("Veuillez saisir une année à 4 chiffres (ex: 2000).", "warning");
                return;
            }
            if (quickYearSaveBtn) {
                quickYearSaveBtn.disabled = true;
                quickYearSaveBtn.textContent = "...";
            }
            try {
                const res = await fetch("/api/albums/batch-tags", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ albums: [alb.path], year: cleanY })
                });
                const d = await res.json();
                if (!res.ok || !d.success) throw new Error(d.detail || "Erreur enregistrement année");
                alb.year = cleanY;
                if (window.AudioPlayer && typeof window.AudioPlayer.invalidateAlbumCache === "function") {
                    window.AudioPlayer.invalidateAlbumCache(alb.path);
                }
                if (quickYearInput) {
                    quickYearInput.value = cleanY;
                    quickYearInput.classList.add("updated-highlight");
                    setTimeout(() => quickYearInput.classList.remove("updated-highlight"), 1500);
                }
                if (isMagic) {
                    showToast(`⚡ Année officielle ${cleanY} détectée et enregistrée pour "${alb.title || 'album'}" !`, "success");
                } else {
                    showToast(`Année ${cleanY} enregistrée pour "${alb.title || 'album'}"`, "success");
                }
            } catch (err) {
                showToast(`Erreur : ${err.message}`, "error");
            } finally {
                if (quickYearSaveBtn) {
                    quickYearSaveBtn.disabled = false;
                    quickYearSaveBtn.textContent = "✓";
                }
            }
        };

        if (quickYearSaveBtn && quickYearInput) {
            quickYearSaveBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                saveYear(quickYearInput.value, false);
            });
            quickYearInput.addEventListener("click", (e) => e.stopPropagation());
            quickYearInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    saveYear(quickYearInput.value, false);
                }
            });
        }

        if (magicYearBtn && quickYearInput) {
            magicYearBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                magicYearBtn.disabled = true;
                magicYearBtn.textContent = "⏳";
                try {
                    const res = await fetch("/api/album/detect-year", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            album: alb.title || "",
                            artist: alb.artist || ""
                        })
                    });
                    const d = await res.json();
                    if (!res.ok || !d.success || !d.year) {
                        throw new Error(d.message || "Année officielle introuvable.");
                    }
                    quickYearInput.value = d.year;
                    await saveYear(d.year, true);
                } catch (err) {
                    showToast(`Détection : ${err.message}`, "warning");
                } finally {
                    magicYearBtn.disabled = false;
                    magicYearBtn.textContent = "⚡";
                }
            });
        }

        // Gestion de la saisie unitaire de genre
        const quickInput = tr.querySelector(".genre-quick-input");
        const quickSaveBtn = tr.querySelector(".btn-genre-quick-save");
        if (quickSaveBtn && quickInput) {
            const doQuickSave = async () => {
                const newG = quickInput.value.trim();
                if (!newG) {
                    showToast("Veuillez saisir un genre.", "warning");
                    return;
                }
                quickSaveBtn.disabled = true;
                quickSaveBtn.innerHTML = `...`;
                try {
                    const res = await fetch("/api/albums/batch-tags", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ albums: [alb.path], genre: newG })
                    });
                    const d = await res.json();
                    if (!res.ok || !d.success) throw new Error(d.detail || "Erreur de mise à jour");

                    alb.genre = newG;
                    if (window.AudioPlayer && typeof window.AudioPlayer.invalidateAlbumCache === "function") {
                        window.AudioPlayer.invalidateAlbumCache(alb.path);
                    }
                    showToast(`Genre "${newG}" appliqué à "${alb.title || 'album'}"`, "success");
                    updateGenreScopeBadges();
                    populateGenreBatchDatalistAndChips();
                    renderGenreBatchTable();
                } catch (err) {
                    showToast(`Erreur : ${err.message}`, "error");
                    quickSaveBtn.disabled = false;
                    quickSaveBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg> <span>OK</span>`;
                }
            };

            quickSaveBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                doQuickSave();
            });

            quickInput.addEventListener("click", (e) => {
                e.stopPropagation();
            });

            quickInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    doQuickSave();
                }
            });
        }

        fragment.appendChild(tr);
    });

    tbody.innerHTML = "";
    tbody.appendChild(fragment);
    updateGenreBatchSelectionUI();
}

function updateGenreBatchSelectionUI() {
    const selCount = window.genreBatchSelectedPaths.size;
    const countSpan = document.getElementById("genre-batch-selected-count");
    if (countSpan) countSpan.textContent = selCount;

    const targetArtistInput = document.getElementById("batch-target-artist-input");
    const targetGenreInput = document.getElementById("genre-batch-target-input");
    const targetYearInput = document.getElementById("batch-target-year-input");

    const targetArtist = (targetArtistInput ? targetArtistInput.value : "").trim();
    const targetGenre = (targetGenreInput ? targetGenreInput.value : "").trim();
    const targetYear = (targetYearInput ? targetYearInput.value : "").trim();

    const hasAnyTag = !!(targetArtist || targetGenre || targetYear);

    const applyBtn = document.getElementById("genre-batch-apply-btn");
    if (applyBtn) {
        applyBtn.disabled = (selCount === 0 || !hasAnyTag);
        applyBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg> <span>Appliquer (${selCount})</span>`;
    }

    const batchDetectYearsBtn = document.getElementById("batch-detect-years-btn");
    if (batchDetectYearsBtn) {
        batchDetectYearsBtn.disabled = (selCount === 0);
    }
    const batchDetectCount = document.getElementById("batch-detect-count");
    if (batchDetectCount) {
        batchDetectCount.textContent = selCount;
    }

    const masterChk = document.getElementById("genre-batch-master-checkbox");
    if (masterChk) {
        const visibleAlbums = getFilteredGenreBatchAlbums();
        if (visibleAlbums.length === 0) {
            masterChk.checked = false;
            masterChk.indeterminate = false;
        } else {
            const visibleSelectedCount = visibleAlbums.filter(a => window.genreBatchSelectedPaths.has(a.path)).length;
            masterChk.checked = (visibleSelectedCount > 0 && visibleSelectedCount === visibleAlbums.length);
            masterChk.indeterminate = (visibleSelectedCount > 0 && visibleSelectedCount < visibleAlbums.length);
        }
    }
}

async function applyGenreBatch() {
    const targetArtistInput = document.getElementById("batch-target-artist-input");
    const targetGenreInput = document.getElementById("genre-batch-target-input");
    const targetYearInput = document.getElementById("batch-target-year-input");

    const targetArtist = (targetArtistInput ? targetArtistInput.value : "").trim();
    const targetGenre = (targetGenreInput ? targetGenreInput.value : "").trim();
    const targetYear = (targetYearInput ? targetYearInput.value : "").trim();

    if (!targetArtist && !targetGenre && !targetYear) {
        showToast("Veuillez renseigner au moins un Artiste, un Genre ou une Année à appliquer.", "warning");
        if (targetArtistInput) targetArtistInput.focus();
        return;
    }
    const paths = Array.from(window.genreBatchSelectedPaths);
    if (paths.length === 0) {
        showToast("Veuillez cocher au moins un album.", "warning");
        return;
    }

    const applyBtn = document.getElementById("genre-batch-apply-btn");
    if (applyBtn) {
        applyBtn.disabled = true;
        applyBtn.innerHTML = `<span>Application en cours (${paths.length} albums)...</span>`;
    }

    try {
        const payload = {
            albums: paths,
            artist: targetArtist || null,
            genre: targetGenre || null,
            year: targetYear || null
        };
        const res = await fetch("/api/albums/batch-tags", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.detail || "Erreur lors de l'application des tags");
        }

        const pathSet = new Set(paths);
        (window.genreBatchAlbums || []).forEach(alb => {
            if (pathSet.has(alb.path)) {
                if (targetArtist) alb.artist = targetArtist;
                if (targetGenre) alb.genre = targetGenre;
                if (targetYear) alb.year = targetYear;
            }
        });

        const modifiedLabels = [];
        if (targetArtist) modifiedLabels.push(`Artiste "${targetArtist}"`);
        if (targetGenre) modifiedLabels.push(`Genre "${targetGenre}"`);
        if (targetYear) modifiedLabels.push(`Année "${targetYear}"`);

        showToast(`${modifiedLabels.join(", ")} appliqué avec succès à ${data.updated_albums_count} album(s) !`, "success");

        if (window.AudioPlayer && typeof window.AudioPlayer.invalidateAlbumCache === "function") {
            window.AudioPlayer.invalidateAlbumCache();
        }

        window.genreBatchSelectedPaths.clear();
        updateGenreScopeBadges();
        populateGenreBatchDatalistAndChips();
        renderGenreBatchTable();
    } catch (err) {
        showToast(`Erreur : ${err.message}`, "error");
    } finally {
        if (applyBtn) {
            applyBtn.disabled = false;
        }
        updateGenreBatchSelectionUI();
    }
}

async function batchDetectOfficialYears() {
    const paths = Array.from(window.genreBatchSelectedPaths);
    if (paths.length === 0) {
        showToast("Veuillez cocher au moins un album pour détecter les années.", "warning");
        return;
    }

    const detectBtn = document.getElementById("batch-detect-years-btn");
    if (detectBtn) {
        detectBtn.disabled = true;
        detectBtn.textContent = `⚡ Détection (0/${paths.length})...`;
    }

    let successCount = 0;
    try {
        for (let i = 0; i < paths.length; i++) {
            const albPath = paths[i];
            const alb = (window.genreBatchAlbums || []).find(a => a.path === albPath);
            if (!alb) continue;

            if (detectBtn) {
                detectBtn.textContent = `⚡ Détection (${i + 1}/${paths.length})...`;
            }

            try {
                const res = await fetch("/api/album/detect-year", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ album: alb.title || "", artist: alb.artist || "" })
                });
                const d = await res.json();
                if (d.success && d.year) {
                    await fetch("/api/albums/batch-tags", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ albums: [alb.path], year: d.year })
                    });
                    alb.year = d.year;
                    successCount++;
                }
            } catch (itemErr) {
                console.warn(`Erreur détection année pour ${alb.title}:`, itemErr);
            }
        }

        if (successCount > 0) {
            if (window.AudioPlayer && typeof window.AudioPlayer.invalidateAlbumCache === "function") {
                window.AudioPlayer.invalidateAlbumCache();
            }
            showToast(`⚡ Années officielles détectées et appliquées avec succès pour ${successCount}/${paths.length} album(s) !`, "success");
            renderGenreBatchTable();
        } else {
            showToast("Aucune année officielle n'a pu être détectée pour la sélection.", "info");
        }
    } catch (err) {
        showToast(`Erreur lors de la détection des années : ${err.message}`, "error");
    } finally {
        if (detectBtn) {
            detectBtn.disabled = false;
            detectBtn.textContent = `⚡ Années officielles (${window.genreBatchSelectedPaths.size})`;
        }
        updateGenreBatchSelectionUI();
    }
}


// Exports globaux
window.loadCollectionAlbumsForEditor = loadCollectionAlbumsForEditor;
window.updateEditorSourceModeUI = updateEditorSourceModeUI;
window.releaseMediaHandlesForPath = releaseMediaHandlesForPath;
window.setupEditorActions = setupEditorActions;
window.refreshAlbumNavList = refreshAlbumNavList;
window.updateAlbumNavUI = updateAlbumNavUI;
window.captureCurrentEditorDraft = captureCurrentEditorDraft;
window.saveCurrentEditorDraft = saveCurrentEditorDraft;
window.clearCurrentEditorDraft = clearCurrentEditorDraft;
window.updateEditorDirtyUI = updateEditorDirtyUI;
window.markEditorDirty = markEditorDirty;
window.clearEditorDirty = clearEditorDirty;
window.navPrevAlbum = navPrevAlbum;
window.navNextAlbum = navNextAlbum;
window.isPathEqualOrDescendant = isPathEqualOrDescendant;
window.resetEditorState = resetEditorState;
window.updateEditorInteractiveState = updateEditorInteractiveState;
window.verifyAndValidateEditorActiveAlbum = verifyAndValidateEditorActiveAlbum;
window.ensureLibraryTagSuggestions = ensureLibraryTagSuggestions;
window.populateTagSuggestionsDatalists = populateTagSuggestionsDatalists;
window.updateEditorAlbumsDatalist = updateEditorAlbumsDatalist;
window.updateCollectionMatchBadges = updateCollectionMatchBadges;
window.setupEditorDirtyTracking = setupEditorDirtyTracking;
window.loadAlbumInEditor = loadAlbumInEditor;
window.initGenreBatchUI = initGenreBatchUI;
window.setGenreBatchScope = setGenreBatchScope;
window.loadGenreBatchAlbums = loadGenreBatchAlbums;
window.applyGenreBatch = applyGenreBatch;
window.applyBatchTags = applyGenreBatch;
window.batchDetectOfficialYears = batchDetectOfficialYears;

// =========================================================================
// Galerie des Jaquettes (Onglet Jaquettes dans Uniformiser & Éditer)
// =========================================================================
window.coversGalleryAlbums = [];
window.coversGalleryFilterScope = "all";
window.coversGallerySearchQuery = "";
let _coversGalleryInitialized = false;

function initCoversGalleryUI() {
    if (_coversGalleryInitialized) return;
    _coversGalleryInitialized = true;

    const searchInput = document.getElementById("covers-gallery-search");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            window.coversGallerySearchQuery = e.target.value.trim().toLowerCase();
            renderCoversGallery();
        });
    }

    const refreshBtn = document.getElementById("covers-gallery-refresh-btn");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", () => {
            loadCoversGalleryAlbums(true);
        });
    }

    const scopeBtns = document.querySelectorAll("#covers-gallery-scope-group .genre-scope-btn");
    scopeBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            scopeBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            window.coversGalleryFilterScope = btn.getAttribute("data-scope") || "all";
            renderCoversGallery();
        });
    });
}

async function loadCoversGalleryAlbums(forceRefresh = false) {
    const loadingEl = document.getElementById("covers-gallery-loading");
    const emptyEl = document.getElementById("covers-gallery-empty");
    const gridEl = document.getElementById("covers-gallery-grid");

    if (!window.coversGalleryAlbums || window.coversGalleryAlbums.length === 0) {
        if (loadingEl) loadingEl.style.display = "flex";
        if (emptyEl) emptyEl.style.display = "none";
        if (gridEl) gridEl.innerHTML = "";
    }

    try {
        const res = await fetch(`/api/library/albums?source=library&_t=${Date.now()}`);
        if (!res.ok) throw new Error("Erreur chargement discothèque");
        const data = await res.json();
        window.coversGalleryAlbums = data.albums || [];

        // Mettre à jour les compteurs
        const total = window.coversGalleryAlbums.length;
        const countBadge = document.getElementById("editor-covers-count-badge");
        if (countBadge) countBadge.textContent = total;

        const countAll = document.getElementById("covers-filter-count-all");
        if (countAll) countAll.textContent = total;

        const hasCount = window.coversGalleryAlbums.filter(a => a.has_cover).length;
        const missingCount = total - hasCount;

        const countHas = document.getElementById("covers-filter-count-has");
        if (countHas) countHas.textContent = hasCount;

        const countMissing = document.getElementById("covers-filter-count-missing");
        if (countMissing) countMissing.textContent = missingCount;

        renderCoversGallery();
    } catch (err) {
        console.error("Erreur chargement albums galerie jaquettes:", err);
        showToast("Impossible de charger les albums de la collection.", "danger");
    } finally {
        if (loadingEl) loadingEl.style.display = "none";
    }
}

function renderCoversGallery() {
    const gridEl = document.getElementById("covers-gallery-grid");
    const emptyEl = document.getElementById("covers-gallery-empty");
    if (!gridEl) return;

    gridEl.innerHTML = "";

    const query = window.coversGallerySearchQuery || "";
    const scope = window.coversGalleryFilterScope || "all";

    const filtered = (window.coversGalleryAlbums || []).filter(alb => {
        // Filtre de portée
        if (scope === "has" && !alb.has_cover) return false;
        if (scope === "missing" && alb.has_cover) return false;

        // Filtre de recherche texte
        if (query) {
            const str = `${alb.title || ""} ${alb.artist || ""} ${alb.album_name || ""} ${alb.album_artist || ""}`.toLowerCase();
            if (!str.includes(query)) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        if (emptyEl) emptyEl.style.display = "block";
        return;
    } else {
        if (emptyEl) emptyEl.style.display = "none";
    }

    filtered.forEach(alb => {
        const card = document.createElement("div");
        card.className = "cover-gallery-card";
        card.setAttribute("data-path", alb.path);

        const albumTitle = alb.title || alb.album_name || "Sans titre";
        const albumArtist = alb.artist || alb.album_artist || "Artiste inconnu";
        const coverSrc = alb.cover_url || `/api/audio/cover?path=${encodeURIComponent(alb.path)}${alb.mtime ? `&v=${Math.floor(alb.mtime)}` : ''}`;

        const metaParts = [];
        if (alb.year) metaParts.push(alb.year);
        if (alb.tracks_count) metaParts.push(`${alb.tracks_count} pistes`);
        const metaStr = metaParts.join(" • ");

        card.innerHTML = `
            <div class="cover-gallery-thumb-wrap">
                <img class="cover-gallery-thumb" src="${coverSrc}" alt="${escapeHtml(albumTitle)}" loading="lazy" onerror="window.handleCoverError ? window.handleCoverError(this) : (this.src='/static/placeholder-cover.svg');">
                <div class="cover-gallery-overlay">
                    <span class="cover-gallery-hover-action">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
                        Changer jaquette
                    </span>
                </div>
            </div>
            <div class="cover-gallery-info">
                <div class="cover-gallery-title" title="${escapeHtml(albumTitle)}">${escapeHtml(albumTitle)}</div>
                <div class="cover-gallery-artist" title="${escapeHtml(albumArtist)}">${escapeHtml(albumArtist)}</div>
                ${metaStr ? `<div class="cover-gallery-meta">${escapeHtml(metaStr)}</div>` : ""}
            </div>
        `;

        // Clic sur l'album -> Déclenche immédiatement la modale de changement de jaquette multi-sources
        card.addEventListener("click", () => {
            openCoverSearchModalForAlbum(alb);
        });

        gridEl.appendChild(card);
    });
}

function openCoverSearchModalForAlbum(alb) {
    if (!alb || !alb.path) return;

    window.currentAlbumPath = alb.path;
    const albumTitle = alb.title || alb.album_name || "";
    const albumArtist = alb.artist || alb.album_artist || "";

    // Mettre à jour les champs de l'éditeur pour cohérence
    const pathEl = document.getElementById("editor-album-path");
    if (pathEl) pathEl.textContent = alb.path;
    const artistInput = document.getElementById("edit-album-artist");
    if (artistInput) artistInput.value = albumArtist;
    const albumInput = document.getElementById("edit-album-name");
    if (albumInput) albumInput.value = albumTitle;

    const query = [albumArtist, albumTitle].filter(Boolean).join(" ");
    const coverSearchInput = document.getElementById("cover-search-query-input");
    if (coverSearchInput) {
        coverSearchInput.value = query;
    }

    if (window.openCoverSearchModal) {
        window.openCoverSearchModal(null, alb);
    }
}

window.openCoverSearchModalForAlbum = openCoverSearchModalForAlbum;
window.initCoversGalleryUI = initCoversGalleryUI;
window.loadCoversGalleryAlbums = loadCoversGalleryAlbums;
window.renderCoversGallery = renderCoversGallery;



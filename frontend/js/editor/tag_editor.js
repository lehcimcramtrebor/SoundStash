// =========================================================
// SoundStash - Module Editor / Tag Editor (Kid3 & Métadonnées)
// Édition des tags ID3/FLAC/M4A, navigation multi-albums et autocomplétion intelligente
// =========================================================

window.currentAlbumPath = window.currentAlbumPath || null;
window.currentAlbumIsPlaylist = window.currentAlbumIsPlaylist || false;
window.currentAlbumIsConcert = window.currentAlbumIsConcert || false;
window.tempAlbumsList = window.tempAlbumsList || [];
window.currentAlbumIndex = window.currentAlbumIndex !== undefined ? window.currentAlbumIndex : -1;
window.editorDirtyState = window.editorDirtyState || {};
window.editorDraftsByAlbum = window.editorDraftsByAlbum || {};
window.isCollectionEditorMode = window.isCollectionEditorMode || false;
window.collectionAlbumsList = window.collectionAlbumsList || [];
window.cachedTagSuggestions = window.cachedTagSuggestions || null;

// Éditeur & Curation de Collection
async function loadCollectionAlbumsForEditor() {
    try {
        const res = await fetch("/api/library/albums");
        if (!res.ok) return;
        const data = await res.json();
        collectionAlbumsList = data.albums || [];

        const countBadge = document.getElementById("editor-collection-count-badge");
        if (countBadge) countBadge.textContent = collectionAlbumsList.length;

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
    const pickerWrap = document.getElementById("editor-collection-picker-wrapper");
    const deleteBtn = document.getElementById("delete-current-album-btn");
    const deleteLabel = document.getElementById("delete-current-album-label");
    const openExportBtn = document.getElementById("open-export-modal-btn");
    const exportAllBtn = document.getElementById("export-all-editor-btn");
    const exportPanel = document.getElementById("export-panel");
    const navBar = document.getElementById("album-nav-bar");
    const statusBadge = document.getElementById("editor-album-tag-status");
    const applyBtn = document.getElementById("apply-uniform-btn");

    if (tempBtn) tempBtn.classList.toggle("active", !isCollectionEditorMode);
    if (colBtn) colBtn.classList.toggle("active", isCollectionEditorMode);
    if (pickerWrap) pickerWrap.style.display = isCollectionEditorMode ? "flex" : "none";

    if (isCollectionEditorMode) {
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
    updateEditorInteractiveState();
}

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
    const confirmExportBtn = document.getElementById("confirm-export-btn");
    const cancelExportBtn = document.getElementById("cancel-export-btn");
    const exportPanel = document.getElementById("export-panel");
    const browseExportBtn = document.getElementById("browse-export-btn");
    const mbLookupBtn = document.getElementById("musicbrainz-lookup-btn");
    const playAlbumBtn = document.getElementById("editor-play-album-btn");
    const sourceTempBtn = document.getElementById("editor-source-temp-btn");
    const sourceColBtn = document.getElementById("editor-source-collection-btn");
    const colSelect = document.getElementById("editor-collection-select");

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
            isCollectionEditorMode = false;
            updateEditorSourceModeUI();
            await refreshAlbumNavList();
            if (tempAlbumsList.length > 0) {
                currentAlbumIndex = Math.max(0, Math.min(currentAlbumIndex, tempAlbumsList.length - 1));
                await loadAlbumInEditor(tempAlbumsList[currentAlbumIndex].path, false);
            } else {
                currentAlbumPath = null;
                document.getElementById("editor-album-title").textContent = "Sélectionnez un album";
                document.getElementById("editor-album-path").textContent = "Dossier temporaire vide";
                document.getElementById("tracks-table-body").innerHTML = "";
            }
        });
    }

    if (sourceColBtn) {
        sourceColBtn.addEventListener("click", async () => {
            isCollectionEditorMode = true;
            updateEditorSourceModeUI();
            await loadCollectionAlbumsForEditor();
            if (colSelect && colSelect.value) {
                await loadAlbumInEditor(colSelect.value, true);
            } else if (collectionAlbumsList.length > 0) {
                colSelect.value = collectionAlbumsList[0].path;
                await loadAlbumInEditor(collectionAlbumsList[0].path, true);
            }
        });
    }

    if (colSelect) {
        colSelect.addEventListener("change", async () => {
            if (colSelect.value) {
                await loadAlbumInEditor(colSelect.value, true);
            }
        });
    }

    // ── Lookup MusicBrainz feat. ──────────────────────────────────────────────
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

    const toggleAlbumBtn = document.getElementById("toggle-type-album-btn");
    const togglePlaylistBtn = document.getElementById("toggle-type-playlist-btn");

    if (toggleAlbumBtn) {
        toggleAlbumBtn.addEventListener("click", () => {
            if (!currentAlbumPath) return;
            currentAlbumIsPlaylist = false;
            currentAlbumIsConcert = false;
            updateEditorTypeToggleUI("album");

            // 1. Nettoyer ou restaurer le champ Nom de l'Album
            const nameInput = document.getElementById("edit-album-name");
            if (nameInput) {
                const prevName = nameInput.value;
                if (nameInput.value.trim().toLowerCase() === "singles & rips") {
                    // Restaurer le nom d'origine mémorisé
                    nameInput.value = nameInput.dataset.originalAlbumName || "Album";
                } else {
                    nameInput.value = nameInput.value.replace(/\s*\[(playlist|mix|compilation)\]/gi, "").trim();
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
                let cleaned = original.replace(/\s*\[(single|audio\s*rip|rip|extrait\s*vid[eé]o|vid[eé]o)\]\s*$/gi, "");
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
            showToast(`Mode Album Studio activé : ${cleanedCount > 0 ? cleanedCount + " titres nettoyés (suffixes retirés) !" : "album configuré en studio"}`, "success");
        });
    }

    if (togglePlaylistBtn) {
        togglePlaylistBtn.addEventListener("click", () => {
            if (!currentAlbumPath) return;
            currentAlbumIsPlaylist = true;
            currentAlbumIsConcert = false;
            updateEditorTypeToggleUI("playlist");

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
            showToast("Mode Playlist activé : les pistes conserveront leurs mentions et l'export sera isolé.", "info");
        });
    }

    // Bouton Single & Rip
    const toggleSingleBtn = document.getElementById("toggle-type-single-btn");
    if (toggleSingleBtn) {
        toggleSingleBtn.addEventListener("click", () => {
            if (!currentAlbumPath) return;
            currentAlbumIsPlaylist = false;
            currentAlbumIsConcert = false;
            updateEditorTypeToggleUI("single");

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
            showToast("Mode Single & Rip activé : ce morceau sera classé dans le conteneur « Singles & Rips ».", "info");
        });
    }

    // Bouton Concert & Live
    const toggleConcertBtn = document.getElementById("toggle-type-concert-btn");
    if (toggleConcertBtn) {
        toggleConcertBtn.addEventListener("click", () => {
            if (!currentAlbumPath) return;
            currentAlbumIsPlaylist = false;
            currentAlbumIsConcert = true;
            updateEditorTypeToggleUI("concert");

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
            showToast("Mode Concert & Live activé : classé dans Artiste / Concerts / [Titre].mp4 (exclu des playlists).", "info");
        });
    }

    openExportModalBtn.addEventListener("click", async () => {
        if (!currentAlbumPath) {
            await showModalAlert("Aucun album sélectionné", "Veuillez d'abord sélectionner ou télécharger un album.", "warning");
            return;
        }
        exportPanel.style.display = exportPanel.style.display === "none" ? "block" : "none";
        
        const isVideo = (currentAlbumPath && (currentAlbumPath.includes("[Vidéo]") || currentAlbumPath.includes("[Video]"))) ||
            document.querySelectorAll('#tracks-table-body td[title$=".mp4"], #tracks-table-body td[title$=".mkv"], #tracks-table-body td[title$=".webm"]').length > 0;
            
        const targetInput = document.getElementById("export-dir-input");
        const titleEl = document.getElementById("export-panel-title");
        const descEl = document.getElementById("export-panel-desc");

        const smartCard = document.getElementById("smart-export-preview-card");
        const smartDestText = document.getElementById("smart-export-dest-text");
        const smartConflictAlert = document.getElementById("smart-export-conflict-alert");
        const smartConflictMsg = document.getElementById("smart-export-conflict-msg");

        if (isVideo) {
            targetInput.value = currentConfig.video_export_dir || "";
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
                            is_playlist: currentAlbumIsPlaylist
                        })
                    });
                    const saveResult = await saveRes.json();
                    if (saveResult.success) {
                        clearCurrentEditorDraft(currentAlbumPath);
                        if (saveResult.album_dir) {
                            currentAlbumPath = saveResult.album_dir;
                        }
                        delete editorDirtyState[currentAlbumPath];
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

        confirmExportBtn.disabled = true;
        confirmExportBtn.textContent = "Exportation en cours...";

        try {
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
                    conflict_policy: conflictPolicy
                })
            });

            let result;
            try {
                result = await res.json();
            } catch (e) {
                throw new Error(`Erreur serveur (${res.status} ${res.statusText})`);
            }

            if (res.ok && result.success) {
                let successMsg = `Album exporté avec succès !\n\nDestination : ${result.export_dir}\nFichiers exportés : ${result.files_count}${result.is_smart ? "\n\n✨ Intégré directement dans votre collection musicale !" : ""}${deleteTemp ? "\n\nLe dossier temporaire a été intégralement vidé." : ""}`;
                if (result.conflict) {
                    successMsg += `\n\nℹ️ Cet album existait déjà dans votre collection : fusion effectuée (${result.conflict_policy === 'overwrite' ? 'pistes remplacées' : 'pistes existantes préservées sans doublon'}).`;
                }
                await showModalAlert(
                    "Exportation réussie",
                    successMsg,
                    "success"
                );
                exportPanel.style.display = "none";
                // Nettoyer le dirty state de cet album
                delete editorDirtyState[currentAlbumPath];

                // Actualiser la bibliothèque et les statuts des recherches
                if (typeof loadLibrary === "function") {
                    loadLibrary();
                }
                if (typeof window.refreshSearchBadges === "function") {
                    window.refreshSearchBadges();
                } else if (typeof enrichItemsWithLibraryStatus === "function") {
                    enrichItemsWithLibraryStatus();
                }
                // Auto-sync du Lecteur Audio si l'export est vers la collection musicale principale
                if (result.is_smart && window.AudioPlayer && window.AudioPlayer.loadLibraryData) {
                    // Rechargement silencieux — l'index backend est déjà à jour via add_or_update_album
                    window.AudioPlayer.loadLibraryData();
                    showToast("Lecteur Audio mis à jour avec le nouvel album", "success", 2500);
                }
                if (deleteTemp) {
                    // Rafraîchir la navigation et charger l'album suivant s'il y en a
                    await refreshAlbumNavList();
                    if (tempAlbumsList.length > 0) {
                        currentAlbumIndex = Math.min(currentAlbumIndex, tempAlbumsList.length - 1);
                        await loadAlbumInEditor(tempAlbumsList[currentAlbumIndex].path);
                    } else {
                        currentAlbumPath = null;
                    }
                    if (!currentAlbumPath) {
                        const wb = document.getElementById("editor-warning-banner");
                        if (wb) wb.style.display = "none";
                        document.getElementById("editor-album-title").textContent = "Album exporté et temporaire vidé";
                        document.getElementById("editor-album-path").textContent = result.export_dir;
                        document.getElementById("tracks-table-body").innerHTML = `<tr><td colspan="5" class="text-center text-muted">L'album a été exporté vers : ${escapeHtml(result.export_dir)}</td></tr>`;
                        
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
                loadLibrary();
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

        applyBtn.disabled = true;
        applyBtn.textContent = "Sauvegarde en cours...";

        try {
            const res = await fetch("/api/album/retag", {
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
                    is_playlist: currentAlbumIsPlaylist
                })
            });

            const result = await res.json();
            if (result.success) {
                clearCurrentEditorDraft(currentAlbumPath);
                if (result.album_dir) {
                    currentAlbumPath = result.album_dir;
                }
                await showModalAlert("Succès", isCollectionEditorMode ? "Tags enregistrés et collection mise à jour !" : "Tags sauvegardés et album mis à jour !", "success");
                if (isCollectionEditorMode) {
                    await loadCollectionAlbumsForEditor();
                    await loadAlbumInEditor(currentAlbumPath, true);
                    if (window.AudioPlayer) {
                        window.AudioPlayer.loadLibrary();
                    }
                } else {
                    await loadAlbumInEditor(currentAlbumPath, false);
                    await refreshAlbumNavList();
                    loadLibrary();
                    if (window.AudioPlayer) {
                        window.AudioPlayer.loadLibrary();
                    }
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
                        resetEditorState();
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
                                await fetch("/api/album/retag", {
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
                                clearCurrentEditorDraft(albPath);
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
                    loadLibrary();
                    if (typeof enrichItemsWithLibraryStatus === "function") {
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
    indicator.textContent = `${current} / ${total} — ${albumName}`;
    indicator.title = albumName;

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
    updateEditorTypeToggleUI("album");
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
        "btn-search-cover-ytm",         // Changer jaquette
        "editor-play-album-btn",        // Écouter l'album
        "musicbrainz-lookup-btn",       // feat. MusicBrainz
        "open-folder-btn",              // Ouvrir Dossier
        "delete-current-album-btn",     // Supprimer (Temp / Collection)
        "detect-genre-btn",             // Détecter genre
        "apply-genre-to-all-btn",       // Appliquer genre à tous
        "toggle-type-album-btn",        // Type Studio
        "toggle-type-single-btn",       // Type Single & Rip
        "toggle-type-playlist-btn",     // Type Playlist
        "toggle-type-concert-btn"       // Type Concert & Live
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
async function loadAlbumInEditor(albumPath, isCollection = false) {
    currentAlbumPath = albumPath;
    if (isCollection !== undefined) {
        isCollectionEditorMode = !!isCollection;
    }
    updateEditorSourceModeUI();

    if (!isCollectionEditorMode) {
        if (tempAlbumsList.length === 0) await refreshAlbumNavList();
        updateAlbumNavUI();
    } else {
        const select = document.getElementById("editor-collection-select");
        if (select && albumPath && select.value !== albumPath) {
            select.value = albumPath;
        }
    }
    try {
        const res = await fetch(`/api/album/info?path=${encodeURIComponent(albumPath)}`);
        if (!res.ok) throw new Error("Album non trouvé");
        const info = await res.json();

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
        let initialToggleMode = "album";
        if (currentAlbumIsPlaylist) initialToggleMode = "playlist";
        else if (currentAlbumIsConcert) initialToggleMode = "concert";
        else if (isSinglesRips) initialToggleMode = "single";
        updateEditorTypeToggleUI(initialToggleMode);

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
                        <button type="button" class="btn btn-ghost btn-sm btn-editor-track-add-playlist" title="Ajouter ce morceau à une playlist" style="padding: 3px 6px;">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/></svg>
                        </button>
                        <button type="button" class="btn btn-ghost btn-sm btn-editor-track-trash" title="Déplacer cette piste vers la Corbeille Windows" style="padding: 3px 6px; color: var(--danger, #ef4444);">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                        </button>
                    </div>
                </td>
            `;

            const btnPlay = tr.querySelector(".btn-editor-track-add-playlist");
            if (btnPlay) {
                if (currentAlbumIsConcert) {
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
    } catch (err) {
        console.error("Erreur chargement album:", err);
        resetEditorState();
    }
}

// Bibliothèque

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


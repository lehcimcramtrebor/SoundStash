// =========================================================
// SoundStash - Module Library / Library Manager & Trash
// Gestion de la discothèque locale, export intelligent, scan et corbeille sécurisée
// =========================================================

function setupLibrary() {
    document.getElementById("refresh-library-btn").addEventListener("click", loadLibrary);
    
    const openTempBtn = document.getElementById("open-temp-folder-btn");
    if (openTempBtn) {
        openTempBtn.addEventListener("click", async () => {
            const targetPath = currentConfig.temp_download_dir;
            if (targetPath) {
                await fetch("/api/album/open-folder", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ path: targetPath })
                });
            }
        });
    }
    
    document.getElementById("clear-temp-btn").addEventListener("click", async () => {
        const confirmed = await showModalConfirm(
            "Vider le dossier temporaire",
            "Voulez-vous vraiment vider l'intégralité du dossier temporaire ?\nTous les albums non exportés seront définitivement supprimés.",
            "Vider le temporaire",
            true
        );

        if (confirmed) {
            if (Array.isArray(tempAlbumsList)) {
                tempAlbumsList.forEach(a => releaseMediaHandlesForPath(a.path));
            }
            try {
                const res = await fetch("/api/temp/clear", { method: "POST" });
                const result = await res.json();
                if (result.success) {
                    // Réinitialisation complète sans nécessiter de Ctrl+F5
                    resetEditorState();
                    document.getElementById("url-input").value = "";
                    document.getElementById("start-download-btn").disabled = false;
                    document.getElementById("start-download-btn").style.display = "inline-flex";
                    document.getElementById("cancel-download-btn").style.display = "none";
                    document.getElementById("progress-container").style.display = "none";
                    document.getElementById("global-status-badge").className = "badge badge-idle";
                    document.getElementById("global-status-badge").textContent = "Atelier";
                    document.getElementById("global-status-badge").title = "Ouvrir / Replier l'Atelier (Raccourci: Maj+W)";

                    loadLibrary();
                    if (typeof currentSearchResults !== "undefined" && currentSearchResults && currentSearchResults.length > 0) {
                        enrichItemsWithLibraryStatus(currentSearchResults);
                    }
                    await showModalAlert("Dossier temporaire vidé", "Le dossier temporaire a été entièrement vidé.\nPrêt pour un nouveau téléchargement !", "success");
                } else {
                    await showModalAlert("Erreur", "Erreur lors du nettoyage du dossier temporaire.", "danger");
                }
            } catch (err) {
                await showModalAlert("Erreur", err.message, "danger");
            }
        }
    });

    const exportAllBtn = document.getElementById("export-all-btn");
    if (exportAllBtn) {
        exportAllBtn.addEventListener("click", async () => {
            if (!tempAlbumsList || tempAlbumsList.length === 0) {
                showToast("Le dossier temporaire est vide. Aucun album à exporter.", "warning");
                return;
            }

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
                    exportAllBtn.disabled = true;
                    exportAllBtn.textContent = "Sauvegarde des brouillons...";
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
                    ? `Voulez-vous exporter l'ensemble des albums temporaires vers votre collection musicale ?\n\n📁 Destination : ${targetDir}\n\n✨ Mode : Exportation Intelligente activée\nChaque album sera automatiquement classé au bon endroit sous le dossier de son artiste (avec harmonisation et gestion intelligente des doublons).\n\nLe dossier temporaire sera vidé après export.`
                    : `Voulez-vous exporter l'ensemble des albums temporaires vers votre dossier d'exportation ?\n\n📁 Destination : ${targetDir}\n\nChaque album sera classé en Artiste / Album et le dossier temporaire sera vidé.`,
                isSmartActive ? "Confirmer l'Export Intelligent" : "Confirmer l'Export Groupé"
            );

            if (confirmed) {
                if (Array.isArray(tempAlbumsList)) {
                    tempAlbumsList.forEach(a => releaseMediaHandlesForPath(a.path));
                }
                exportAllBtn.disabled = true;
                exportAllBtn.textContent = "Exportation en cours...";

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
                        if (!isCollectionEditorMode) {
                            resetEditorState();
                        }
                        loadLibrary();
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
                            isSmartActive ? "Exportation Intelligente réussie" : "Exportation groupée réussie",
                            isSmartActive
                                ? `${result.exported_albums_count} album(s) intégré(s) avec succès dans votre collection musicale :\n${targetDir}\n\nLe dossier temporaire a été intégralement vidé.`
                                : `${result.exported_albums_count} album(s) exporté(s) avec succès dans votre dossier :\n${targetDir}\n\nLe dossier temporaire a été intégralement vidé.`,
                            "success"
                        );
                    } else {
                        await showModalAlert("Erreur", result.message || "Erreur lors de l'exportation groupée.", "danger");
                    }
                } catch (err) {
                    await showModalAlert("Erreur", err.message, "danger");
                } finally {
                    const hasTemp = tempAlbumsList && tempAlbumsList.length > 0;
                    exportAllBtn.disabled = !hasTemp;
                    if (!hasTemp) {
                        exportAllBtn.classList.add("btn-disabled-state");
                        exportAllBtn.title = "Dossier temporaire vide (aucun album à exporter)";
                    } else {
                        exportAllBtn.classList.remove("btn-disabled-state");
                        exportAllBtn.title = `Exporter les ${tempAlbumsList.length} album(s) temporaires`;
                    }
                    exportAllBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2v9.67z"/></svg> Tout exporter`;
                }
            }
        });
    }

    // Section B : Contenus Externes & Imports Locaux
    const refreshExtBtn = document.getElementById("refresh-external-btn");
    if (refreshExtBtn) {
        refreshExtBtn.addEventListener("click", () => {
            loadExternalTempAlbums();
        });
    }

    const openExtBtn = document.getElementById("open-external-folder-btn");
    if (openExtBtn) {
        openExtBtn.addEventListener("click", async () => {
            const path = externalDirCache || (currentConfig && currentConfig.temp_download_dir ? currentConfig.temp_download_dir + "/_external" : "temp_downloads/_external");
            await fetch("/api/album/open-folder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path })
            });
        });
    }

    const openHorsBtn = document.getElementById("open-hors-analyse-btn");
    if (openHorsBtn) {
        openHorsBtn.addEventListener("click", async () => {
            const path = horsAnalyseDirCache || (currentConfig && currentConfig.temp_download_dir ? currentConfig.temp_download_dir + "/_Hors_Analyse" : "temp_downloads/_Hors_Analyse");
            await fetch("/api/album/open-folder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path })
            });
        });
    }
}

let isLoadingLibrary = false;
let needsReloadLibrary = false;
async function loadLibrary() {
    if (isLoadingLibrary) {
        needsReloadLibrary = true;
        return;
    }
    isLoadingLibrary = true;
    needsReloadLibrary = false;
    const tempGrid = document.getElementById("temp-albums-grid");
    if (!tempGrid) {
        isLoadingLibrary = false;
        return;
    }

    tempGrid.innerHTML = `<p class="text-muted">Chargement...</p>`;

    try {
        const res = await fetch("/api/albums");
        const data = await res.json();

        // Albums temporaires uniquement
        const tempAlbums = data.temp_albums || [];
        tempAlbumsList = tempAlbums.filter(a => a.track_count > 0);
        updateTempTabBadge(tempAlbums.length);
        const editorTempBadge = document.getElementById("editor-temp-count-badge");
        if (editorTempBadge) editorTempBadge.textContent = tempAlbums.length;

        // Mise à jour de l'état du bouton "Tout exporter" dans l'onglet bibliothèque
        const libExportAllBtn = document.getElementById("export-all-btn");
        if (libExportAllBtn) {
            const hasTemp = tempAlbums.length > 0;
            libExportAllBtn.disabled = !hasTemp;
            if (!hasTemp) {
                libExportAllBtn.classList.add("btn-disabled-state");
                libExportAllBtn.title = "Dossier temporaire vide (aucun album à exporter)";
            } else {
                libExportAllBtn.classList.remove("btn-disabled-state");
                libExportAllBtn.title = `Exporter les ${tempAlbums.length} album(s) temporaires`;
            }
        }
        updateEditorInteractiveState();

        if (tempAlbums.length === 0) {
            tempGrid.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">
                        <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor">
                            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                        </svg>
                    </div>
                    <h3 class="empty-state-title">Aucun album en attente</h3>
                    <p class="empty-state-desc">Vos téléchargements apparaîtront ici pour être uniformisés et exportés vers votre bibliothèque.</p>
                </div>
            `;
        } else {
            tempGrid.innerHTML = "";
            tempAlbums.forEach(album => {
                const card = document.createElement("div");
                card.className = "album-card album-card-temp";
                const isVideo = Boolean(album.is_video || (album.name && (album.name.toLowerCase().includes("[vidéo]") || album.name.toLowerCase().includes("[video]") || album.name.toLowerCase().includes("[concert]"))));
                const isConcert = Boolean(album.is_concert || (album.name && (album.name.toLowerCase().includes("[concert]") || (isVideo && (album.name.toLowerCase().includes("concert") || album.name.toLowerCase().includes("live") || album.name.toLowerCase().includes("tour") || album.name.toLowerCase().includes("bercy"))))));

                card.innerHTML = `
                    <div>
                        <h3 class="album-card-title">${escapeHtml(album.name)}</h3>
                        <p class="album-card-meta">${album.track_count} piste(s) — En attente d'export</p>
                    </div>
                    <div class="album-card-actions">
                        ${isConcert ? `
                            <button class="btn btn-warning btn-sm btn-watch-concert-temp" data-path="${escapeHtml(album.path)}" title="Regarder ce concert vidéo en plein écran">🎸 Regarder le concert</button>
                        ` : isVideo ? `
                            <button class="btn btn-video-accent btn-sm btn-watch-temp" data-path="${escapeHtml(album.path)}" title="Regarder ce clip vidéo en plein écran">🎬 Regarder la vidéo</button>
                        ` : `
                            <button class="btn btn-secondary btn-sm btn-listen-temp" data-path="${escapeHtml(album.path)}" title="Écouter cet album dans le Lecteur Audio">▶ Écouter</button>
                        `}
                        <button class="btn btn-primary btn-sm btn-edit" data-path="${escapeHtml(album.path)}">Éditer / Tags</button>
                        <button class="btn btn-secondary btn-sm btn-folder" data-path="${escapeHtml(album.path)}" title="Ouvrir le dossier">Dossier</button>
                        <button class="btn btn-danger btn-sm btn-delete-temp" data-path="${escapeHtml(album.path)}" title="Supprimer du temporaire">Supprimer</button>
                    </div>
                `;

                const watchBtn = card.querySelector(".btn-watch-concert-temp, .btn-watch-temp");
                if (watchBtn) {
                    watchBtn.addEventListener("click", async () => {
                        try {
                            const res = await fetch(`/api/album/info?path=${encodeURIComponent(album.path)}`);
                            if (res.ok) {
                                const info = await res.json();
                                const vidTrack = (info.tracks || []).find(t => t.is_video || t.type === "video" || /\.(mp4|mkv|webm)$/i.test(t.filepath || t.path || "")) || (info.tracks && info.tracks[0]);
                                if (vidTrack) {
                                    const vPath = vidTrack.filepath || vidTrack.path;
                                    openLocalVideoModal({
                                        title: vidTrack.title || album.name,
                                        artist: vidTrack.artist || info.album_artist || "Artiste",
                                        path: vPath,
                                        rel_path: vPath,
                                        is_concert: isConcert,
                                        thumbnail: `/api/videos/thumbnail?path=${encodeURIComponent(vPath)}`
                                    });
                                    return;
                                }
                            }
                        } catch (e) {
                            console.warn("Erreur lecture vidéo directe:", e);
                        }
                        AudioPlayer.loadAlbum(album.path, 0, true);
                        switchTab("tab-player");
                    });
                }

                const listenBtn = card.querySelector(".btn-listen-temp");
                if (listenBtn) {
                    listenBtn.addEventListener("click", () => {
                        AudioPlayer.loadAlbum(album.path, 0, false);
                        switchTab("tab-player");
                    });
                }

                card.querySelector(".btn-edit").addEventListener("click", () => {
                    loadAlbumInEditor(album.path, false);
                    switchTab("tab-editor");
                });

                card.querySelector(".btn-folder").addEventListener("click", async () => {
                    await fetch("/api/album/open-folder", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ path: album.path })
                    });
                });

                card.querySelector(".btn-delete-temp").addEventListener("click", async () => {
                    const confirmed = await showModalConfirm(
                        "Supprimer l'album temporaire",
                        `Supprimer définitivement cet album du dossier temporaire ?\n\n${album.name}`,
                        "Supprimer",
                        true
                    );
                    if (confirmed) {
                        releaseMediaHandlesForPath(album.path);
                        await fetch("/api/album/temp", {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ path: album.path })
                        });
                        if (isPathEqualOrDescendant(currentAlbumPath, album.path)) {
                            resetEditorState();
                            await refreshAlbumNavList();
                            if (tempAlbumsList && tempAlbumsList.length > 0) {
                                currentAlbumIndex = 0;
                                await loadAlbumInEditor(tempAlbumsList[0].path);
                            }
                        }
                        loadLibrary();
                        if (typeof currentSearchResults !== "undefined" && currentSearchResults && currentSearchResults.length > 0) {
                            enrichItemsWithLibraryStatus(currentSearchResults);
                        }
                    }
                });

                tempGrid.appendChild(card);
            });
        }
    } catch (err) {
        updateTempTabBadge(0);
        tempAlbumsList = [];
        const libExportAllBtn = document.getElementById("export-all-btn");
        if (libExportAllBtn) {
            libExportAllBtn.disabled = true;
            libExportAllBtn.classList.add("btn-disabled-state");
            libExportAllBtn.title = "Dossier temporaire vide (aucun album à exporter)";
        }
        updateEditorInteractiveState();
        tempGrid.innerHTML = `<p class="text-danger">Erreur: ${err.message}</p>`;
    } finally {
        isLoadingLibrary = false;
        loadExternalTempAlbums();
        if (needsReloadLibrary) {
            needsReloadLibrary = false;
            loadLibrary();
        }
    }
}

let externalDirCache = "";
let horsAnalyseDirCache = "";

async function loadExternalTempAlbums() {
    const extGrid = document.getElementById("external-albums-grid");
    const countBadge = document.getElementById("external-count-badge");
    const horsBtn = document.getElementById("open-hors-analyse-btn");
    const horsCountSpan = document.getElementById("hors-analyse-count");
    if (!extGrid) return;

    try {
        const res = await fetch("/api/albums/external");
        const data = await res.json();
        const albums = data.external_albums || [];
        const horsCount = data.hors_analyse_count || 0;
        externalDirCache = data.external_dir || "";
        horsAnalyseDirCache = data.hors_analyse_dir || "";

        // Mise à jour du badge de décompte externe
        if (countBadge) {
            if (albums.length > 0) {
                countBadge.textContent = albums.length;
                countBadge.style.display = "inline-block";
            } else {
                countBadge.style.display = "none";
            }
        }

        // Mise à jour du bouton d'alerte pour fichiers non-médias isolés (_Hors_Analyse)
        if (horsBtn && horsCountSpan) {
            horsCountSpan.textContent = horsCount;
            horsBtn.style.display = horsCount > 0 ? "inline-flex" : "none";
        }

        if (albums.length === 0) {
            extGrid.innerHTML = `
                <div class="empty-state" style="padding: 24px; text-align: center; grid-column: 1 / -1;">
                    <p class="text-muted" style="margin: 0; font-size: 0.9rem;">
                        Aucun contenu externe ou importé en attente. Utilisez l'onglet « Télécharger » pour coller un lien tiers ou importer des fichiers locaux.
                    </p>
                </div>
            `;
            return;
        }

        extGrid.innerHTML = "";
        albums.forEach(album => {
            const card = document.createElement("div");
            card.className = "album-card album-card-external";

            const statusHtml = album.is_ready_for_library
                ? `<span class="tag-status-badge tag-status-ready">✓ Tags complets (Prêt pour Bibliothèque)</span>`
                : `<span class="tag-status-badge tag-status-warning" title="Manque : ${(album.missing_tags || []).join(', ')}">⚠️ Tags incomplets (${(album.missing_tags || []).join(' & ')} requis)</span>`;

            const isVideo = Boolean(album.is_video || (album.name && (album.name.toLowerCase().includes("[vidéo]") || album.name.toLowerCase().includes("[video]") || album.name.toLowerCase().includes("[concert]"))));
            const isConcert = Boolean(album.is_concert || (album.name && (album.name.toLowerCase().includes("[concert]") || (isVideo && (album.name.toLowerCase().includes("concert") || album.name.toLowerCase().includes("live") || album.name.toLowerCase().includes("tour"))))));

            card.innerHTML = `
                <div style="display: flex; gap: 12px; align-items: flex-start;">
                    ${album.has_cover 
                        ? `<img src="${album.cover_url}" alt="Cover" style="width: 52px; height: 52px; object-fit: cover; border-radius: 6px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.1);" onerror="this.style.display='none';">` 
                        : `<div style="width: 52px; height: 52px; border-radius: 6px; background: rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 1.4rem;">🎵</div>`
                    }
                    <div style="flex: 1; min-width: 0;">
                        <h3 class="album-card-title" title="${escapeHtml(album.name)}" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;">${escapeHtml(album.title || album.name)}</h3>
                        <p class="album-card-meta" style="margin-bottom: 2px;"><strong>${escapeHtml(album.artist || "Artiste inconnu")}</strong> — ${album.track_count} piste(s)</p>
                        ${statusHtml}
                    </div>
                </div>
                <div class="album-card-actions" style="margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px;">
                    ${isConcert ? `
                        <button class="btn btn-warning btn-sm btn-ext-watch" title="Regarder ce concert vidéo en plein écran">🎸 Regarder le concert</button>
                    ` : isVideo ? `
                        <button class="btn btn-video-accent btn-sm btn-ext-watch" title="Regarder cette vidéo en plein écran">🎬 Regarder la vidéo</button>
                    ` : `
                        <button class="btn btn-secondary btn-sm btn-ext-listen" title="Écouter dans le lecteur audio">▶ Écouter</button>
                    `}
                    <button class="btn btn-primary btn-sm btn-ext-edit" title="Éditer les tags dans l'onglet Éditeur">✏️ Éditeur / Tags</button>
                    <button class="btn btn-secondary btn-sm btn-ext-export-lib" ${album.is_ready_for_library ? '' : 'style="opacity: 0.65;"'} title="${album.is_ready_for_library ? 'Exporter vers la bibliothèque musicale' : 'Artiste et Titre requis pour exporter vers la bibliothèque'}">💿 Bibliothèque</button>
                    <button class="btn btn-secondary btn-sm btn-ext-export-custom" title="Exporter manuellement vers n'importe quel dossier (Clé USB, Bureau, etc.)">💾 Export Manuel...</button>
                    <button class="btn btn-secondary btn-sm btn-ext-folder" title="Ouvrir le dossier source">📁 Dossier</button>
                    <button class="btn btn-danger btn-sm btn-ext-delete" title="Supprimer définitivement ce contenu">🗑️ Supprimer</button>
                </div>
            `;

            const extWatchBtn = card.querySelector(".btn-ext-watch");
            if (extWatchBtn) {
                extWatchBtn.addEventListener("click", async () => {
                    try {
                        const res = await fetch(`/api/album/info?path=${encodeURIComponent(album.path)}`);
                        if (res.ok) {
                            const info = await res.json();
                            const vidTrack = (info.tracks || []).find(t => t.is_video || t.type === "video" || /\.(mp4|mkv|webm)$/i.test(t.filepath || t.path || "")) || (info.tracks && info.tracks[0]);
                            if (vidTrack) {
                                const vPath = vidTrack.filepath || vidTrack.path;
                                openLocalVideoModal({
                                    title: vidTrack.title || album.name,
                                    artist: vidTrack.artist || info.album_artist || "Artiste",
                                    path: vPath,
                                    rel_path: vPath,
                                    is_concert: isConcert,
                                    thumbnail: `/api/videos/thumbnail?path=${encodeURIComponent(vPath)}`
                                });
                                return;
                            }
                        }
                    } catch (e) {
                        console.warn("Erreur lecture vidéo externe:", e);
                    }
                    AudioPlayer.loadAlbum(album.path, 0, true);
                    switchTab("tab-player");
                });
            }

            const extListenBtn = card.querySelector(".btn-ext-listen");
            if (extListenBtn) {
                extListenBtn.addEventListener("click", () => {
                    AudioPlayer.loadAlbum(album.path, 0, false);
                    switchTab("tab-player");
                });
            }

            // Envoyer à l'éditeur
            card.querySelector(".btn-ext-edit").addEventListener("click", () => {
                loadAlbumInEditor(album.path, false);
                switchTab("tab-editor");
            });

            // Exporter vers la bibliothèque musicale (soumis à validation stricte)
            card.querySelector(".btn-ext-export-lib").addEventListener("click", async () => {
                if (!album.is_ready_for_library) {
                    await showModalAlert(
                        "⚠️ Tags requis pour la Bibliothèque",
                        `Pour préserver la structure impeccable de votre bibliothèque musicale, cet élément externe nécessite un Artiste et un Titre valides (tags ID3).\n\nTags manquants : ${(album.missing_tags || []).join(', ')}\n\n💡 Utilisez « ✏️ Éditeur / Tags » pour renseigner ces champs, ou utilisez « 💾 Export Manuel... » pour enregistrer les fichiers directement où vous le souhaitez.`,
                        "warning"
                    );
                    return;
                }

                const libDir = (currentConfig && currentConfig.library_dir) ? currentConfig.library_dir : "";
                if (!libDir) {
                    await showModalAlert("Bibliothèque non configurée", "Veuillez d'abord configurer le chemin de votre Bibliothèque Musicale dans les paramètres de la bibliothèque.", "warning");
                    return;
                }

                const confirmed = await showModalConfirm(
                    "Exporter vers la Bibliothèque",
                    `Exporter l'album « ${album.title} » de « ${album.artist} » vers votre collection musicale ?\n\n📁 Destination : ${libDir}\n\nLe dossier temporaire sera nettoyé après l'exportation.`,
                    "Exporter",
                    false
                );
                if (!confirmed) return;
                releaseMediaHandlesForPath(album.path);

                const btn = card.querySelector(".btn-ext-export-lib");
                btn.disabled = true;
                btn.textContent = "Export...";

                try {
                    const expRes = await fetch("/api/album/export", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            album_dir: album.path,
                            target_base_dir: libDir,
                            delete_temp: true
                        })
                    });
                    const expData = await expRes.json();
                    if (expData.success) {
                        if (isPathEqualOrDescendant(currentAlbumPath, album.path)) {
                            resetEditorState();
                        }
                        showToast(`✓ Album exporté vers la bibliothèque avec succès !`, "success");
                        loadLibrary();
                        if (typeof refreshAlbumNavList === "function") refreshAlbumNavList();
                        if (window.AudioPlayer && typeof window.AudioPlayer.loadLibraryData === "function") {
                            window.AudioPlayer.loadLibraryData(true);
                        }
                        if (typeof window.refreshSearchBadges === "function") window.refreshSearchBadges();
                    } else {
                        await showModalAlert("Erreur d'exportation", expData.message || expData.detail || "Échec de l'exportation", "error");
                        btn.disabled = false;
                        btn.textContent = "💿 Bibliothèque";
                    }
                } catch (e) {
                    await showModalAlert("Erreur réseau", e.message, "error");
                    btn.disabled = false;
                    btn.textContent = "💿 Bibliothèque";
                }
            });

            // Export Manuel vers n'importe quel dossier choisi
            card.querySelector(".btn-ext-export-custom").addEventListener("click", async () => {
                let chosenFolder = null;
                if (window.electronAPI && window.electronAPI.selectFolder) {
                    chosenFolder = await window.electronAPI.selectFolder();
                } else {
                    chosenFolder = prompt("Dossier de destination pour l'export manuel (ex: Clé USB, Bureau) :");
                }
                if (!chosenFolder || !chosenFolder.trim()) return;

                const confirmed = await showModalConfirm(
                    "Exportation Manuelle",
                    `Copier ce contenu vers :\n📁 ${chosenFolder.trim()}\n\nSouhaitez-vous également supprimer l'original du dossier temporaire ?`,
                    "Copier & Supprimer du temporaire",
                    false,
                    "Copier uniquement (conserver)"
                );

                if (confirmed) {
                    releaseMediaHandlesForPath(album.path);
                }

                try {
                    const res = await fetch("/api/album/export-custom", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            source_path: album.path,
                            target_dir: chosenFolder.trim(),
                            delete_source: confirmed
                        })
                    });
                    const data = await res.json();
                    if (data.success) {
                        if (confirmed && isPathEqualOrDescendant(currentAlbumPath, album.path)) {
                            resetEditorState();
                        }
                        showToast(`✓ Exporté avec succès vers ${data.target_path}`, "success");
                        loadLibrary();
                        if (typeof refreshAlbumNavList === "function") refreshAlbumNavList();
                        if (window.AudioPlayer && typeof window.AudioPlayer.loadLibraryData === "function") {
                            window.AudioPlayer.loadLibraryData(true);
                        }
                        if (typeof window.refreshSearchBadges === "function") window.refreshSearchBadges();
                    } else {
                        await showModalAlert("Erreur d'exportation", data.detail || data.message || "Erreur lors de l'export", "error");
                    }
                } catch (err) {
                    await showModalAlert("Erreur", err.message, "error");
                }
            });

            // Ouvrir le dossier source
            card.querySelector(".btn-ext-folder").addEventListener("click", async () => {
                await fetch("/api/album/open-folder", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ path: album.path })
                });
            });

            // Supprimer du temporaire
            card.querySelector(".btn-ext-delete").addEventListener("click", async () => {
                const confirmed = await showModalConfirm(
                    "Supprimer le contenu externe",
                    `Supprimer définitivement cet élément du dossier temporaire ?\n\n${album.name}`,
                    "Supprimer",
                    true
                );
                if (confirmed) {
                    releaseMediaHandlesForPath(album.path);
                    await fetch("/api/album/temp", {
                        method: "DELETE",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ path: album.path })
                    });
                    if (isPathEqualOrDescendant(currentAlbumPath, album.path)) {
                        resetEditorState();
                        await refreshAlbumNavList();
                        if (tempAlbumsList.length > 0) {
                            currentAlbumIndex = 0;
                            await loadAlbumInEditor(tempAlbumsList[0].path);
                        }
                    }
                    loadLibrary();
                }
            });

            extGrid.appendChild(card);
        });

    } catch (err) {
        console.error("loadExternalTempAlbums error:", err);
        extGrid.innerHTML = `<p class="text-danger" style="padding: 12px;">Erreur lors du chargement des contenus externes : ${err.message}</p>`;
    }
}

// Paramètres & Export Intelligent
// ═══════════════════════════════════════════════════════════════════════

let isAutoScanningLibrary = false;
let isPromptingLibrary = false;

async function promptAndConfigureLibrary(targetDir) {
    if (isPromptingLibrary) return;
    const cleanDir = (targetDir || "").trim();
    const previousDir = (currentConfig && currentConfig.library_dir) ? currentConfig.library_dir.trim() : "";

    // Si le dossier n'a pas changé et est déjà configuré, indexer directement
    if (cleanDir === previousDir && cleanDir) {
        await autoConfigureAndScanLibrary(cleanDir);
        return;
    }

    // Si l'utilisateur a effacé le champ
    if (!cleanDir) {
        await autoConfigureAndScanLibrary("");
        return;
    }

    isPromptingLibrary = true;
    try {
        const confirmed = await showModalConfirm(
            "⚡ Surveillance & Auto-organisation (Tag-First Truth)",
            `Vous êtes sur le point de configurer ce dossier comme Collection Musicale Maître :\n\n📁 ${cleanDir}\n\n⚠️ AVERTISSEMENT IMPORTANT :\nDès son activation, ce dossier fait l'objet d'une surveillance continue en tâche de fond (Tag-First Truth) :\n\n• Rangement en vrac : Tout fichier audio déposé à la racine sera automatiquement rangé dans « Artiste / Album / XX Titre.ext » selon ses tags.\n• Réalignement : Les albums mal rangés seront automatiquement replacés sous leur artiste réel.\n• Harmonisation : Les répertoires seront harmonisés d'après les tags officiels des pistes.\n• Export Intelligent : Vos futurs téléchargements seront intégrés directement dans cette arborescence.\n\nSouhaitez-vous activer ce dossier avec la surveillance permanente ?`,
            "Activer la surveillance & Indexer",
            false,
            "Annuler"
        );

        const input = document.getElementById("cfg-library-dir");
        if (!confirmed) {
            if (input) input.value = previousDir;
            return;
        }

        await autoConfigureAndScanLibrary(cleanDir);
        await checkAndPromptMigration("music", cleanDir);
    } finally {
        isPromptingLibrary = false;
    }
}

async function autoConfigureAndScanLibrary(dirPath) {
    const cleanDir = (dirPath || "").trim();
    const statusEl = document.getElementById("library-status-text");
    const scanBtn = document.getElementById("scan-library-btn");

    if (!cleanDir) {
        if (statusEl) {
            statusEl.innerHTML = "Permet de marquer les albums déjà possédés avec le badge vert <code>💿 Dans ma collection</code> et de détecter les albums manquants dans la discographie officielle de vos artistes.";
        }
        if (currentConfig) currentConfig.library_dir = null;
        updateSmartExportUIState();
        if (typeof AudioPlayer !== "undefined" && AudioPlayer.loadLibraryData) {
            AudioPlayer.loadLibraryData();
        }
        return;
    }

    if (isAutoScanningLibrary) return;
    isAutoScanningLibrary = true;

    const origScanHtml = scanBtn ? scanBtn.innerHTML : "Indexer";
    if (scanBtn) {
        scanBtn.disabled = true;
        scanBtn.innerHTML = `⏳ Indexation...`;
    }
    if (statusEl) {
        statusEl.innerHTML = `<span style="color: var(--accent, #89b4fa); font-weight: 500;">🔄 Indexation automatique en cours pour : <code>${escapeHtml(cleanDir)}</code>...</span>`;
    }

    try {
        const res = await fetch("/api/library/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ library_dir: cleanDir })
        });
        const data = await res.json();
        if (data.status === "success") {
            if (currentConfig) currentConfig.library_dir = cleanDir;
            const input = document.getElementById("cfg-library-dir");
            if (input && input.value.trim() !== cleanDir) {
                input.value = cleanDir;
            }
            if (statusEl) {
                statusEl.innerHTML = `✅ <strong>${data.albums_count}</strong> album(s) et <strong>${data.artists_count}</strong> artiste(s) indexés en <strong>${data.duration_seconds}s</strong>.`;
            }
            showToast(`Collection indexée : ${data.albums_count} album(s) et ${data.artists_count} artiste(s) trouvés !`, "success");
            updateSmartExportUIState();
            if (typeof AudioPlayer !== "undefined" && AudioPlayer.loadLibraryData) {
                AudioPlayer.loadLibraryData();
            }
            if (typeof loadLibrary === "function") {
                loadLibrary();
            }
            if (typeof window.refreshSearchBadges === "function") {
                window.refreshSearchBadges();
            }
            if (typeof enrichItemsWithLibraryStatus === "function" && typeof currentSearchResults !== "undefined" && currentSearchResults.length > 0) {
                enrichItemsWithLibraryStatus(currentSearchResults);
            }
        } else {
            if (statusEl) {
                statusEl.innerHTML = `<span style="color: var(--danger, #f38ba8);">❌ Erreur : ${escapeHtml(data.error || "Impossible d'indexer le dossier")}</span>`;
            }
            showToast(data.error || "Erreur durant l'indexation de la collection.", "danger");
            updateSmartExportUIState();
        }
    } catch (err) {
        if (statusEl) {
            statusEl.innerHTML = `<span style="color: var(--danger, #f38ba8);">❌ Erreur : ${escapeHtml(err.message)}</span>`;
        }
        showToast(`Erreur : ${err.message}`, "danger");
        updateSmartExportUIState();
    } finally {
        isAutoScanningLibrary = false;
        if (scanBtn) {
            scanBtn.disabled = false;
            scanBtn.innerHTML = origScanHtml;
        }
    }
}

function updateSmartExportUIState() {
    const libInput = document.getElementById("cfg-library-dir");
    const libDir = libInput ? libInput.value.trim() : "";
    const hasMasterLib = Boolean(libDir);

    const smartExportCheckbox = document.getElementById("cfg-smart-export");
    const reqHint = document.getElementById("smart-export-req-hint");
    const policyWrap = document.getElementById("smart-export-policy-wrap");

    if (smartExportCheckbox) {
        if (!hasMasterLib) {
            smartExportCheckbox.checked = false;
            smartExportCheckbox.disabled = true;
            if (policyWrap) policyWrap.style.display = "none";
            if (reqHint) reqHint.style.display = "block";
        } else {
            smartExportCheckbox.disabled = false;
            if (reqHint) reqHint.style.display = "none";
            if (policyWrap) {
                policyWrap.style.display = smartExportCheckbox.checked ? "flex" : "none";
            }
        }
    }

    const syncStatusBadge = document.getElementById("library-sync-status-badge");
    if (syncStatusBadge) {
        if (hasMasterLib) {
            syncStatusBadge.textContent = "🟢 Surveillance active en continu";
            syncStatusBadge.classList.add("active");
        } else {
            syncStatusBadge.textContent = "Actif dès configuration";
            syncStatusBadge.classList.remove("active");
        }
    }

    const isSmartExportActive = hasMasterLib && smartExportCheckbox && smartExportCheckbox.checked;

    // Éléments du dossier d'export Musique dans les paramètres
    const exportDirInput = document.getElementById("cfg-export-dir");
    const browseExportBtn = document.getElementById("browse-settings-export-btn");
    const exportDirHint = document.getElementById("cfg-export-dir-hint");
    const musicQuickDests = document.getElementById("music-export-quick-dests");

    if (exportDirInput) {
        exportDirInput.disabled = isSmartExportActive;
        exportDirInput.style.opacity = isSmartExportActive ? "0.5" : "";
        exportDirInput.style.cursor = isSmartExportActive ? "not-allowed" : "";
        if (isSmartExportActive) {
            exportDirInput.removeAttribute("required");
        } else {
            exportDirInput.setAttribute("required", "required");
        }
    }
    if (browseExportBtn) {
        browseExportBtn.disabled = isSmartExportActive;
        browseExportBtn.style.opacity = isSmartExportActive ? "0.5" : "";
        browseExportBtn.style.cursor = isSmartExportActive ? "not-allowed" : "";
    }
    if (musicQuickDests) {
        musicQuickDests.style.opacity = isSmartExportActive ? "0.45" : "";
        musicQuickDests.style.pointerEvents = isSmartExportActive ? "none" : "";
        musicQuickDests.querySelectorAll("button").forEach(btn => {
            btn.disabled = isSmartExportActive;
        });
    }
    if (exportDirHint) {
        exportDirHint.style.display = isSmartExportActive ? "block" : "none";
    }

    if (currentConfig) {
        currentConfig.library_dir = libDir || null;
        if (!hasMasterLib) {
            currentConfig.smart_export = false;
        } else if (smartExportCheckbox) {
            currentConfig.smart_export = smartExportCheckbox.checked;
        }
    }

    updateEditorExportUIState();
}

function updateEditorExportUIState() {
    const exportPanel = document.getElementById("export-panel");
    if (!exportPanel || exportPanel.style.display === "none") return;

    const isVideo = (currentAlbumPath && (currentAlbumPath.includes("[Vidéo]") || currentAlbumPath.includes("[Video]"))) ||
        document.querySelectorAll('#tracks-table-body td[title$=".mp4"], #tracks-table-body td[title$=".mkv"], #tracks-table-body td[title$=".webm"]').length > 0;

    const isSmartAudioActive = !isVideo && Boolean(currentConfig && currentConfig.smart_export !== false && currentConfig.library_dir);

    const targetInput = document.getElementById("export-dir-input");
    const browseBtn = document.getElementById("browse-export-btn");
    const quickDests = document.getElementById("editor-quick-dest-group");
    const smartHint = document.getElementById("editor-export-dest-smart-hint");

    if (targetInput) {
        targetInput.disabled = isSmartAudioActive;
        targetInput.style.opacity = isSmartAudioActive ? "0.5" : "";
        targetInput.style.cursor = isSmartAudioActive ? "not-allowed" : "";
    }
    if (browseBtn) {
        browseBtn.disabled = isSmartAudioActive;
        browseBtn.style.opacity = isSmartAudioActive ? "0.5" : "";
        browseBtn.style.cursor = isSmartAudioActive ? "not-allowed" : "";
    }
    if (quickDests) {
        quickDests.style.opacity = isSmartAudioActive ? "0.45" : "";
        quickDests.style.pointerEvents = isSmartAudioActive ? "none" : "";
        quickDests.querySelectorAll("button").forEach(b => {
            b.disabled = isSmartAudioActive;
        });
    }
    if (smartHint) {
        smartHint.style.display = isSmartAudioActive ? "block" : "none";
    }
}


// [MODULARISÉ] Paramètres, Modales Système & Mode Ambiance
// Déplacés dans :
// - frontend/js/extras/settings.js
// - frontend/js/ambient/synthwave_canvas.js
// - frontend/js/ambient/ambient_manager.js

// =========================================================
// PHASE 48 : Gestion Sécurisée & Suppression vers la Corbeille
// =========================================================
async function confirmDeleteCollectionItem(targetPath, itemType = "album", itemName = "") {
    if (!targetPath) return;

    let info = {
        path: targetPath,
        size_str: "Calcul en cours...",
        files_count: 1,
        type: itemType
    };

    try {
        const res = await fetch(`/api/library/item-info?path=${encodeURIComponent(targetPath)}`);
        if (res.ok) {
            info = await res.json();
        }
    } catch (e) {
        console.warn("Impossible de récupérer les infos de l'élément:", e);
    }

    let typeLabel = "l'album";
    let icon = "💿";
    if (itemType === "video" || info.type === "video") {
        typeLabel = "le clip vidéo";
        icon = "🎬";
    } else if (itemType === "track" || info.type === "track") {
        typeLabel = "la piste audio";
        icon = "🎵";
    }

    const title = `Mettre ${typeLabel} à la Corbeille`;
    const details = `${icon} ${itemName || info.path.split(/[\\/]/).pop()}\n\n📂 Emplacement : ${info.path}\n💾 Taille : ${info.size_str}${info.files_count > 1 ? ` (${info.files_count} fichiers)` : ""}\n\n♻️ Cet élément sera déplacé en toute sécurité vers la Corbeille Windows. Vous pourrez le restaurer à tout moment.`;

    const confirmed = await showModalConfirm(
        title,
        details,
        "Mettre à la corbeille",
        true
    );

    if (!confirmed) return;

    try {
        let moved = false;
        // 1. Tenter via Electron native shell.trashItem
        if (window.electronAPI && typeof window.electronAPI.trashItem === "function") {
            const elRes = await window.electronAPI.trashItem(targetPath);
            if (elRes && elRes.success) {
                moved = true;
            }
        }

        // 2. Notifier et purger dans le backend (ou fallback PowerShell si Electron indisponible)
        const res = await fetch("/api/library/trash", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: targetPath })
        });
        const data = await res.json();

        if (data.success || moved) {
            showToast(`« ${itemName || "Élément"} » déplacé dans la Corbeille Windows.`, "success");

            // Mettre à jour les indexothèques en mémoire et les vues
            if (itemType === "album") {
                if (window.AudioPlayer) {
                    window.AudioPlayer.libraryAlbums = (window.AudioPlayer.libraryAlbums || []).filter(a => a.path !== targetPath);
                    if (window.AudioPlayer.currentAlbum && window.AudioPlayer.currentAlbum.path === targetPath) {
                        window.AudioPlayer.stopAndHide();
                    }
                }
                if (typeof loadCollectionAlbumsForEditor === "function") {
                    await loadCollectionAlbumsForEditor();
                }
                if (isPathEqualOrDescendant(currentAlbumPath, targetPath)) {
                    resetEditorState();
                    const colSelect = document.getElementById("editor-collection-select");
                    if (colSelect && colSelect.options.length > 1) {
                        colSelect.selectedIndex = 1;
                        await loadAlbumInEditor(colSelect.value, true);
                    }
                }
                ensureLibraryTagSuggestions(true);
            } else if (itemType === "video") {
                if (window.AudioPlayer) {
                    window.AudioPlayer.videosCatalog = (window.AudioPlayer.videosCatalog || []).filter(v => v.path !== targetPath && v.rel_path !== targetPath);
                    if (window.AudioPlayer.currentView === "videos") {
                        window.AudioPlayer.renderVideosGrid();
                    }
                }
            } else if (itemType === "track") {
                if (currentAlbumPath) {
                    await loadAlbumInEditor(currentAlbumPath, isCollectionEditorMode);
                }
            }

            // Rafraîchir l'arborescence si le panneau est ouvert
            if (typeof loadAndRenderCollectionTree === "function") {
                loadAndRenderCollectionTree(true);
            }
        } else {
            showToast(data.message || "Erreur lors du déplacement vers la corbeille.", "danger");
        }
    } catch (err) {
        showToast("Erreur de communication : " + err.message, "danger");
    }
}

// ── Arborescence Collection Retirée (Atelier : sélection directe d'albums) ────
function setupCollectionTree() {}
async function loadAndRenderCollectionTree(force = false) {}
function renderCollectionTree() {}



// Exports globaux
window.setupLibrary = setupLibrary;
window.loadLibrary = loadLibrary;
window.loadExternalTempAlbums = loadExternalTempAlbums;
window.promptAndConfigureLibrary = promptAndConfigureLibrary;
window.autoConfigureAndScanLibrary = autoConfigureAndScanLibrary;
window.updateSmartExportUIState = updateSmartExportUIState;
window.updateEditorExportUIState = updateEditorExportUIState;
window.confirmDeleteCollectionItem = confirmDeleteCollectionItem;
window.setupCollectionTree = setupCollectionTree;
window.loadAndRenderCollectionTree = loadAndRenderCollectionTree;
window.renderCollectionTree = renderCollectionTree;


/**
 * SoundStash v5.0.0 - Module d'Exportation & Baladeur (Audio & Vidéo)
 * Gestion du panier persistant, estimation d'espace disque, conversion et arborescence.
 */

(function () {
    const CART_STORAGE_KEY = "soundstash_export_cart_v1";
    let exportCart = [];
    let isExportRunning = false;
    let pollTimer = null;

    const escapeHtml = window.escapeHtml || function(str) {
        if (!str) return "";
        return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
    };

    // Charger le panier persistant
    function loadCart() {
        try {
            const raw = localStorage.getItem(CART_STORAGE_KEY);
            exportCart = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(exportCart)) exportCart = [];
        } catch (e) {
            exportCart = [];
        }
        updateCartBadge();
    }

    // Sauvegarder le panier persistant
    function saveCart() {
        try {
            localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(exportCart));
        } catch (e) {}
        updateCartBadge();
        renderCartUI();
        refreshEstimate();
    }

    // Mettre à jour le badge de l'onglet dans l'Atelier
    function updateCartBadge() {
        const badge = document.getElementById("export-cart-badge");
        if (!badge) return;
        const count = exportCart.length;
        badge.textContent = count;
        badge.style.display = count > 0 ? "inline-flex" : "none";
    }

    // Ajouter des éléments au panier
    function addToExportCart(items) {
        if (!items) return;
        const arr = Array.isArray(items) ? items : [items];
        let addedCount = 0;

        arr.forEach(it => {
            if (!it || !it.path) return;
            // Éviter les doublons stricts de chemin
            const exists = exportCart.some(c => c.path === it.path && c.type === it.type);
            if (!exists) {
                exportCart.push({
                    type: it.type || "album", // "album" | "track" | "video"
                    path: it.path,
                    title: it.title || "Titre",
                    artist: it.artist || "Artiste",
                    album: it.album || "",
                    year: it.year || "",
                    genre: it.genre || "",
                    tracks_count: it.tracks_count || 1
                });
                addedCount++;
            }
        });

        if (addedCount > 0) {
            saveCart();
            showToast(`${addedCount} élément(s) ajouté(s) au panier d'export.`, "success");
        } else {
            showToast("Les éléments sélectionnés sont déjà dans le panier d'export.", "info");
        }
    }

    // Supprimer un élément du panier
    function removeFromExportCart(index) {
        if (index >= 0 && index < exportCart.length) {
            exportCart.splice(index, 1);
            saveCart();
        }
    }

    // Supprimer un élément du panier par son chemin et son type
    function removePathFromExportCart(path, type) {
        if (!path) return false;
        const initialLen = exportCart.length;
        exportCart = exportCart.filter(c => !(c.path === path && (!type || c.type === type)));
        if (exportCart.length !== initialLen) {
            saveCart();
            showToast("Élément retiré du panier d'export.", "info");
            return true;
        }
        return false;
    }

    // Vider le panier
    function clearExportCart() {
        if (exportCart.length === 0) return;
        exportCart = [];
        saveCart();
        showToast("Le panier d'export a été vidé.", "info");
    }

    // Rendu de l'interface du panier
    function renderCartUI() {
        const listEl = document.getElementById("export-cart-items-list");
        const emptyEl = document.getElementById("export-cart-empty-state");
        const audioCountEl = document.getElementById("export-cart-audio-count");
        const videoCountEl = document.getElementById("export-cart-video-count");
        const albumsCountEl = document.getElementById("export-cart-albums-count");

        if (!listEl) return;

        let totalAudioCount = 0;
        let videoCount = 0;
        let albumsCount = 0;

        exportCart.forEach(it => {
            if (it.type === "album") {
                albumsCount++;
                totalAudioCount += (Number(it.tracks_count) || 0);
            } else if (it.type === "video") {
                videoCount++;
            } else {
                totalAudioCount++;
            }
        });

        if (audioCountEl) audioCountEl.textContent = totalAudioCount;
        if (videoCountEl) videoCountEl.textContent = videoCount;
        if (albumsCountEl) albumsCountEl.textContent = albumsCount;

        if (exportCart.length === 0) {
            listEl.innerHTML = "";
            if (emptyEl) emptyEl.style.display = "flex";
            return;
        }

        if (emptyEl) emptyEl.style.display = "none";
        listEl.innerHTML = "";

        exportCart.forEach((item, idx) => {
            const row = document.createElement("div");
            row.className = "export-cart-item-row";

            let iconHtml = "💿";
            let subDetails = "";
            if (item.type === "video") {
                iconHtml = "🎬";
                subDetails = escapeHtml(item.artist || "Vidéo");
            } else if (item.type === "track") {
                iconHtml = "🎵";
                subDetails = `${escapeHtml(item.artist)}${item.album ? ` • ${escapeHtml(item.album)}` : ''}${item.track_num ? ` (Piste ${item.track_num})` : ''}`;
            } else {
                iconHtml = "💿";
                const countStr = item.tracks_count ? ` • Album complet (${item.tracks_count} pistes)` : ' • Album complet';
                subDetails = `${escapeHtml(item.artist)}${countStr}`;
            }

            row.innerHTML = `
                <div class="export-cart-item-info">
                    <span style="font-size: 1.1rem; flex-shrink: 0;">${iconHtml}</span>
                    <div style="min-width: 0; flex: 1;">
                        <div class="export-cart-item-title">${escapeHtml(item.title)}</div>
                        <div class="export-cart-item-sub">${subDetails}</div>
                    </div>
                </div>
                <button type="button" class="btn btn-sm btn-danger btn-cart-remove" data-index="${idx}" title="Retirer du panier" style="padding: 3px 8px; font-size: 0.75rem;">
                    ✕
                </button>
            `;

            row.querySelector(".btn-cart-remove").addEventListener("click", () => {
                removeFromExportCart(idx);
            });

            listEl.appendChild(row);
        });
    }

    // Rafraîchir l'estimation de taille et d'espace disque
    async function refreshEstimate() {
        const estText = document.getElementById("export-estimate-text");
        const launchBtn = document.getElementById("export-launch-btn");
        const destInput = document.getElementById("export-dest-input");
        const allLibCheck = document.getElementById("export-all-library-checkbox");
        const audioCountEl = document.getElementById("export-cart-audio-count");

        const isAllLib = allLibCheck ? allLibCheck.checked : false;

        if (exportCart.length === 0 && !isAllLib) {
            if (estText) estText.innerHTML = "Panier vide • 0 Mo";
            if (launchBtn) launchBtn.disabled = true;
            return;
        }

        try {
            const payload = {
                items: exportCart,
                export_all_library: isAllLib,
                destination_dir: destInput ? destInput.value.trim() : ""
            };
            const res = await fetch("/api/export/estimate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            if (!res.ok) return;
            const data = await res.json();

            if (estText) {
                estText.innerHTML = `
                    <strong>${data.total_items} élément(s)</strong> (${data.audio_count} audio, ${data.video_count} vidéo)
                    • ~<strong>${data.estimated_size_mb > 1024 ? (data.estimated_size_gb + " Go") : (data.estimated_size_mb + " Mo")}</strong>
                    • Disque cible : <strong>${data.destination_free_gb} Go libres</strong>
                `;
            }

            if (audioCountEl && typeof data.audio_count === "number" && !isAllLib) {
                audioCountEl.textContent = data.audio_count;
            }

            if (launchBtn) {
                launchBtn.disabled = !data.has_enough_space || data.total_items === 0;
            }
        } catch (e) {
            console.warn("Erreur calcul estimation export:", e);
        }
    }

    // Initialisation complète de l'interface d'export
    function initExportUI() {
        loadCart();
        renderCartUI();

        // 1. Bouton Vider le panier
        const clearBtn = document.getElementById("export-clear-cart-btn");
        if (clearBtn) {
            clearBtn.addEventListener("click", () => {
                if (confirm("Voulez-vous vraiment vider tout le panier d'exportation ?")) {
                    clearExportCart();
                }
            });
        }

        // 2. Bouton Parcourir pour choisir la destination
        const browseBtn = document.getElementById("export-browse-dest-btn");
        const destInput = document.getElementById("export-dest-input");
        if (browseBtn) {
            browseBtn.addEventListener("click", async () => {
                if (typeof browseFolder === "function") {
                    await browseFolder("export-dest-input");
                    refreshEstimate();
                }
            });
        }

        // 3. Raccourcis de destination (Bureau, Musique, Téléchargements)
        document.querySelectorAll(".export-quick-dest-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                const destType = btn.getAttribute("data-dest");
                const nameInput = document.getElementById("export-name-input");
                const expName = nameInput ? nameInput.value.trim() : "Export";

                try {
                    const res = await fetch(`/api/export/default-dest?name=${encodeURIComponent(expName)}`);
                    const d = await res.json();
                    if (destInput) {
                        destInput.value = (destType && d[destType]) ? d[destType] : (d.default_full_path || d.desktop);
                        destInput.dataset.manual = "true";
                        refreshEstimate();
                    }
                } catch (e) {}
            });
        });

        // 4. Case "Exporter toute la collection"
        const allLibCheck = document.getElementById("export-all-library-checkbox");
        if (allLibCheck) {
            allLibCheck.addEventListener("change", () => {
                const cartCard = document.getElementById("export-cart-section-card");
                if (cartCard) {
                    cartCard.style.opacity = allLibCheck.checked ? "0.45" : "1";
                    cartCard.style.pointerEvents = allLibCheck.checked ? "none" : "auto";
                }
                refreshEstimate();
            });
        }

        // 5. Segments Audio : Copie directe vs Reconvertir
        const segAudioCopy = document.getElementById("export-audio-mode-copy");
        const segAudioConvert = document.getElementById("export-audio-mode-convert");
        const convertOptionsWrap = document.getElementById("export-audio-convert-options");

        if (segAudioCopy && segAudioConvert) {
            segAudioCopy.addEventListener("click", () => {
                segAudioCopy.classList.add("active");
                segAudioConvert.classList.remove("active");
                if (convertOptionsWrap) convertOptionsWrap.style.display = "none";
                refreshEstimate();
            });

            segAudioConvert.addEventListener("click", () => {
                segAudioConvert.classList.add("active");
                segAudioCopy.classList.remove("active");
                if (convertOptionsWrap) convertOptionsWrap.style.display = "flex";
                refreshEstimate();
            });
        }

        // 6. Changement du nom d'export -> mise à jour automatique de la destination par défaut
        const nameInput = document.getElementById("export-name-input");
        if (nameInput) {
            nameInput.addEventListener("input", () => {
                if (destInput && (!destInput.dataset.manual || destInput.dataset.manual === "false")) {
                    const val = nameInput.value.trim() || "Export";
                    fetch(`/api/export/default-dest?name=${encodeURIComponent(val)}`)
                        .then(r => r.json())
                        .then(d => {
                            if (destInput && (!destInput.dataset.manual || destInput.dataset.manual === "false")) {
                                destInput.value = d.default_full_path;
                            }
                        })
                        .catch(() => {});
                }
            });
        }

        if (destInput) {
            destInput.addEventListener("input", () => {
                destInput.dataset.manual = "true";
                refreshEstimate();
            });
        }

        // 7. Bouton Ajouter du contenu (Modal sélecteur)
        const openPickerBtn = document.getElementById("export-open-picker-btn");
        if (openPickerBtn) {
            openPickerBtn.addEventListener("click", () => {
                openExportItemPicker();
            });
        }

        // 8. Bouton Lancer l'exportation
        const launchBtn = document.getElementById("export-launch-btn");
        if (launchBtn) {
            launchBtn.addEventListener("click", () => {
                startExportProcess();
            });
        }

        // 9. Bouton Interrompre l'exportation
        const cancelBtn = document.getElementById("export-cancel-btn");
        if (cancelBtn) {
            cancelBtn.addEventListener("click", () => {
                cancelExportProcess();
            });
        }

        // 10. Fermeture des modales (Croix, boutons et clic en arrière-plan)
        const pickerModal = document.getElementById("export-picker-modal-backdrop");
        const pickerCloseBtn = document.getElementById("export-picker-modal-close-btn");
        const pickerCloseFooterBtn = document.getElementById("export-picker-modal-close-footer-btn");
        if (pickerCloseBtn) pickerCloseBtn.onclick = () => closeModalBackdrop(pickerModal);
        if (pickerCloseFooterBtn) pickerCloseFooterBtn.onclick = () => closeModalBackdrop(pickerModal);
        if (pickerModal) {
            pickerModal.onclick = (e) => {
                if (e.target === pickerModal) closeModalBackdrop(pickerModal);
            };
        }

        const resultModal = document.getElementById("export-result-modal-backdrop");
        const resultCloseBtn = document.getElementById("export-result-modal-close-btn");
        if (resultCloseBtn) resultCloseBtn.onclick = () => closeModalBackdrop(resultModal);
        if (resultModal) {
            resultModal.onclick = (e) => {
                if (e.target === resultModal) closeModalBackdrop(resultModal);
            };
        }

        // Charger destination par défaut au démarrage
        if (destInput && !destInput.value) {
            fetch("/api/export/default-dest")
                .then(r => r.json())
                .then(d => {
                    if (destInput && !destInput.value) {
                        destInput.value = d.default_full_path;
                        refreshEstimate();
                    }
                })
                .catch(() => {});
        }

        refreshEstimate();
    }

    let pickerAlbums = [];
    let pickerVideos = [];

    // Rendu filtré du sélecteur d'éléments (Albums complets, pistes individuelles, vidéos)
    function renderPickerList(filterText = "") {
        const listContainer = document.getElementById("export-picker-modal-list");
        if (!listContainer) return;

        const q = (filterText || "").trim().toLowerCase();
        listContainer.innerHTML = "";

        const filteredAlbums = pickerAlbums.filter(a => {
            if (!q) return true;
            return (a.title && a.title.toLowerCase().includes(q)) ||
                   (a.artist && a.artist.toLowerCase().includes(q)) ||
                   (a.path && a.path.toLowerCase().includes(q));
        });

        const filteredVideos = pickerVideos.filter(v => {
            if (!q) return true;
            return (v.title && v.title.toLowerCase().includes(q)) ||
                   (v.filename && v.filename.toLowerCase().includes(q)) ||
                   (v.artist && v.artist.toLowerCase().includes(q));
        });

        if (filteredAlbums.length === 0 && filteredVideos.length === 0) {
            listContainer.innerHTML = `<div style="text-align: center; padding: 24px; color: var(--text-muted);">Aucun média ne correspond à "${escapeHtml(filterText)}".</div>`;
            return;
        }

        // Section Albums
        if (filteredAlbums.length > 0) {
            const albHeader = document.createElement("div");
            albHeader.style.cssText = "font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--accent); margin: 6px 0 8px 4px;";
            albHeader.textContent = `Albums de la collection (${filteredAlbums.length})`;
            listContainer.appendChild(albHeader);

            filteredAlbums.forEach(alb => {
                const itemBlock = document.createElement("div");
                itemBlock.className = "export-picker-album-card";
                itemBlock.style.cssText = "background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-color); border-radius: 8px; margin-bottom: 8px; padding: 10px 12px;";

                const isAlbumInCart = exportCart.some(c => c.path === alb.path && c.type === "album");

                itemBlock.innerHTML = `
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                        <div style="display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1;">
                            <img src="${alb.cover_url || `/api/audio/cover?path=${encodeURIComponent(alb.path)}`}" style="width: 40px; height: 40px; border-radius: 6px; object-fit: cover; flex-shrink: 0;" onerror="this.src='/static/placeholder-cover.svg';">
                            <div style="min-width: 0; flex: 1;">
                                <div style="font-weight: 600; color: var(--text-main); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(alb.title)}</div>
                                <div style="font-size: 0.78rem; color: var(--text-muted);">${escapeHtml(alb.artist)}${alb.tracks_count ? ` • ${alb.tracks_count} pistes` : ''}</div>
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                            <button type="button" class="btn btn-sm btn-ghost btn-toggle-album-tracks" style="font-size: 0.78rem; padding: 4px 8px; display: inline-flex; align-items: center; gap: 4px;" title="Afficher les pistes pour choisir des morceaux précis">
                                <span>🎵 Pistes</span>
                                <span class="chevron-icon">▾</span>
                            </button>
                            <button type="button" class="btn btn-sm ${isAlbumInCart ? 'btn-secondary btn-in-cart' : 'btn-primary'} btn-add-full-album" title="${isAlbumInCart ? 'Cliquer pour retirer cet album du panier' : 'Ajouter tout l\'album au panier'}">
                                ${isAlbumInCart ? '✓ Ajouté' : '➕ Tout l\'album'}
                            </button>
                        </div>
                    </div>
                    <div class="export-picker-tracks-container" style="display: none; margin-top: 10px; padding: 8px 10px; background: rgba(0, 0, 0, 0.2); border-radius: 6px; border-left: 2px solid var(--accent); max-height: 220px; overflow-y: auto;">
                        <div class="tracks-loading" style="font-size: 0.8rem; color: var(--text-muted); padding: 6px;">Chargement des pistes...</div>
                    </div>
                `;

                // Clic & Toggle "Tout l'album"
                const addAlbBtn = itemBlock.querySelector(".btn-add-full-album");

                function syncAlbumBtnUI() {
                    const inCart = exportCart.some(c => c.path === alb.path && c.type === "album");
                    if (inCart) {
                        addAlbBtn.className = "btn btn-sm btn-secondary btn-in-cart btn-add-full-album";
                        addAlbBtn.textContent = "✓ Ajouté";
                        addAlbBtn.title = "Cliquer pour retirer cet album du panier";
                    } else {
                        addAlbBtn.className = "btn btn-sm btn-primary btn-add-full-album";
                        addAlbBtn.textContent = "➕ Tout l'album";
                        addAlbBtn.title = "Ajouter tout l'album au panier";
                    }
                }

                addAlbBtn.addEventListener("mouseenter", () => {
                    if (exportCart.some(c => c.path === alb.path && c.type === "album")) {
                        addAlbBtn.textContent = "✕ Retirer";
                        addAlbBtn.classList.add("btn-danger-hover");
                    }
                });

                addAlbBtn.addEventListener("mouseleave", () => {
                    if (exportCart.some(c => c.path === alb.path && c.type === "album")) {
                        addAlbBtn.textContent = "✓ Ajouté";
                        addAlbBtn.classList.remove("btn-danger-hover");
                    }
                });

                addAlbBtn.addEventListener("click", () => {
                    const inCart = exportCart.some(c => c.path === alb.path && c.type === "album");
                    if (inCart) {
                        removePathFromExportCart(alb.path, "album");
                    } else {
                        addToExportCart({
                            type: "album",
                            path: alb.path,
                            title: alb.title,
                            artist: alb.artist,
                            tracks_count: alb.tracks_count
                        });
                    }
                    syncAlbumBtnUI();
                });

                // Clic "Pistes ▾"
                const toggleBtn = itemBlock.querySelector(".btn-toggle-album-tracks");
                const tracksContainer = itemBlock.querySelector(".export-picker-tracks-container");
                let tracksLoaded = false;

                toggleBtn.addEventListener("click", async () => {
                    const isOpening = tracksContainer.style.display === "none";
                    tracksContainer.style.display = isOpening ? "block" : "none";
                    toggleBtn.querySelector(".chevron-icon").textContent = isOpening ? "▴" : "▾";

                    if (isOpening && !tracksLoaded) {
                        try {
                            const res = await fetch(`/api/album/info?path=${encodeURIComponent(alb.path)}`);
                            if (!res.ok) throw new Error("Erreur lecture pistes");
                            const info = await res.json();
                            const tracks = info.tracks || [];

                            if (tracks.length === 0) {
                                tracksContainer.innerHTML = `<div style="font-size: 0.8rem; color: var(--text-muted); padding: 4px;">Aucune piste audio trouvée.</div>`;
                            } else {
                                tracksContainer.innerHTML = "";
                                tracks.forEach((t, idx) => {
                                    const tPath = t.filepath || t.path;
                                    const isTrackInCart = exportCart.some(c => c.path === tPath && c.type === "track");

                                    const tRow = document.createElement("div");
                                    tRow.style.cssText = "display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 6px; border-bottom: 1px dashed rgba(255,255,255,0.06); font-size: 0.82rem;";
                                    tRow.innerHTML = `
                                        <div style="min-width: 0; flex: 1; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                                            <span style="font-weight: 600; color: var(--accent); margin-right: 6px;">${String(t.track_number || idx + 1).padStart(2, '0')}</span>
                                            <span style="color: var(--text-main);">${escapeHtml(t.title || t.filename)}</span>
                                            <span style="color: var(--text-muted); font-size: 0.76rem; margin-left: 6px;">${escapeHtml(t.artist || alb.artist)}</span>
                                        </div>
                                        <button type="button" class="btn btn-sm ${isTrackInCart ? 'btn-secondary btn-in-cart' : 'btn-primary'} btn-add-single-track" title="${isTrackInCart ? 'Cliquer pour retirer cette piste du panier' : 'Ajouter cette piste au panier'}" style="padding: 2px 8px; font-size: 0.74rem; flex-shrink: 0;">
                                            ${isTrackInCart ? '✓ Ajouté' : '➕ Piste'}
                                        </button>
                                    `;

                                    const addTrkBtn = tRow.querySelector(".btn-add-single-track");

                                    function syncTrackBtnUI() {
                                        const inCart = exportCart.some(c => c.path === tPath && c.type === "track");
                                        if (inCart) {
                                            addTrkBtn.className = "btn btn-sm btn-secondary btn-in-cart btn-add-single-track";
                                            addTrkBtn.textContent = "✓ Ajouté";
                                            addTrkBtn.title = "Cliquer pour retirer cette piste du panier";
                                        } else {
                                            addTrkBtn.className = "btn btn-sm btn-primary btn-add-single-track";
                                            addTrkBtn.textContent = "➕ Piste";
                                            addTrkBtn.title = "Ajouter cette piste au panier";
                                        }
                                    }

                                    addTrkBtn.addEventListener("mouseenter", () => {
                                        if (exportCart.some(c => c.path === tPath && c.type === "track")) {
                                            addTrkBtn.textContent = "✕ Retirer";
                                            addTrkBtn.classList.add("btn-danger-hover");
                                        }
                                    });

                                    addTrkBtn.addEventListener("mouseleave", () => {
                                        if (exportCart.some(c => c.path === tPath && c.type === "track")) {
                                            addTrkBtn.textContent = "✓ Ajouté";
                                            addTrkBtn.classList.remove("btn-danger-hover");
                                        }
                                    });

                                    addTrkBtn.addEventListener("click", () => {
                                        const inCart = exportCart.some(c => c.path === tPath && c.type === "track");
                                        if (inCart) {
                                            removePathFromExportCart(tPath, "track");
                                        } else {
                                            addToExportCart({
                                                type: "track",
                                                path: tPath,
                                                title: t.title || t.filename,
                                                artist: t.artist || alb.artist,
                                                album: alb.title,
                                                year: alb.year || "",
                                                genre: t.genre || alb.genre || "",
                                                track_num: t.track_number || (idx + 1)
                                            });
                                        }
                                        syncTrackBtnUI();
                                    });

                                    tracksContainer.appendChild(tRow);
                                });
                            }
                            tracksLoaded = true;
                        } catch (err) {
                            tracksContainer.innerHTML = `<div style="font-size: 0.8rem; color: var(--color-danger); padding: 4px;">Impossible de charger les pistes : ${err.message}</div>`;
                        }
                    }
                });

                listContainer.appendChild(itemBlock);
            });
        }

        // Section Vidéos
        if (filteredVideos.length > 0) {
            const vidHeader = document.createElement("div");
            vidHeader.style.cssText = "font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #f87171; margin: 14px 0 8px 4px;";
            vidHeader.textContent = `Vidéos & Clips (${filteredVideos.length})`;
            listContainer.appendChild(vidHeader);

            filteredVideos.forEach(vid => {
                const row = document.createElement("div");
                row.className = "export-selector-row";
                const isAlreadyInCart = exportCart.some(c => c.path === vid.filepath && c.type === "video");

                row.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1;">
                        <span style="font-size: 1.4rem;">🎬</span>
                        <div style="min-width: 0;">
                            <div style="font-weight: 600; color: var(--text-main);">${escapeHtml(vid.title || vid.filename)}</div>
                            <div style="font-size: 0.78rem; color: var(--text-muted);">${escapeHtml(vid.artist || "Artiste")} • ${vid.duration_str || "Vidéo"}</div>
                        </div>
                    </div>
                    <button type="button" class="btn btn-sm ${isAlreadyInCart ? 'btn-secondary btn-in-cart' : 'btn-primary'} btn-add-video" title="${isAlreadyInCart ? 'Cliquer pour retirer cette vidéo du panier' : 'Ajouter cette vidéo au panier'}">
                        ${isAlreadyInCart ? '✓ Ajouté' : '➕ Ajouter'}
                    </button>
                `;

                const btn = row.querySelector(".btn-add-video");

                function syncVideoBtnUI() {
                    const inCart = exportCart.some(c => c.path === vid.filepath && c.type === "video");
                    if (inCart) {
                        btn.className = "btn btn-sm btn-secondary btn-in-cart btn-add-video";
                        btn.textContent = "✓ Ajouté";
                        btn.title = "Cliquer pour retirer cette vidéo du panier";
                    } else {
                        btn.className = "btn btn-sm btn-primary btn-add-video";
                        btn.textContent = "➕ Ajouter";
                        btn.title = "Ajouter cette vidéo au panier";
                    }
                }

                btn.addEventListener("mouseenter", () => {
                    if (exportCart.some(c => c.path === vid.filepath && c.type === "video")) {
                        btn.textContent = "✕ Retirer";
                        btn.classList.add("btn-danger-hover");
                    }
                });

                btn.addEventListener("mouseleave", () => {
                    if (exportCart.some(c => c.path === vid.filepath && c.type === "video")) {
                        btn.textContent = "✓ Ajouté";
                        btn.classList.remove("btn-danger-hover");
                    }
                });

                btn.addEventListener("click", () => {
                    const inCart = exportCart.some(c => c.path === vid.filepath && c.type === "video");
                    if (inCart) {
                        removePathFromExportCart(vid.filepath, "video");
                    } else {
                        addToExportCart({
                            type: "video",
                            path: vid.filepath,
                            title: vid.title || vid.filename,
                            artist: vid.artist || "Artiste"
                        });
                    }
                    syncVideoBtnUI();
                });

                listContainer.appendChild(row);
            });
        }
    }

    // Gestionnaires d'ouverture / fermeture conformes aux standards de SoundStash (classe .active)
    function openModalBackdrop(modalEl) {
        if (!modalEl) return;
        modalEl.style.display = "flex";
        void modalEl.offsetWidth; // Forcer le reflow du DOM
        modalEl.classList.add("active");
    }

    function closeModalBackdrop(modalEl) {
        if (!modalEl) return;
        modalEl.classList.remove("active");
        setTimeout(() => {
            modalEl.style.display = "none";
        }, 200);
    }

    // Modal Sélecteur d'éléments pour ajouter des albums / pistes / vidéos au panier
    async function openExportItemPicker() {
        const modalBackdrop = document.getElementById("export-picker-modal-backdrop");
        const listContainer = document.getElementById("export-picker-modal-list");
        const searchInput = document.getElementById("export-picker-search-input");
        if (!modalBackdrop || !listContainer) return;

        openModalBackdrop(modalBackdrop);
        listContainer.innerHTML = `<div style="text-align: center; padding: 24px; color: var(--text-muted);">Chargement de vos albums et vidéos...</div>`;
        if (searchInput) searchInput.value = "";

        try {
            const [albumsRes, videosRes] = await Promise.all([
                fetch(`/api/library/albums?source=all&_t=${Date.now()}`).then(r => r.json()).catch(() => ({ albums: [] })),
                fetch(`/api/videos/catalog?_t=${Date.now()}`).then(r => r.json()).catch(() => ({ catalog: [], videos: [] }))
            ]);

            pickerAlbums = albumsRes.albums || [];
            pickerVideos = videosRes.videos || videosRes.catalog || [];

            renderPickerList("");

            if (searchInput && !searchInput.dataset.listening) {
                searchInput.dataset.listening = "true";
                searchInput.addEventListener("input", () => {
                    renderPickerList(searchInput.value);
                });
            }
        } catch (e) {
            listContainer.innerHTML = `<div style="color: var(--color-danger); padding: 16px;">Erreur lors du chargement : ${e.message}</div>`;
        }
    }

    // Lancer l'exportation
    async function startExportProcess() {
        const nameInput = document.getElementById("export-name-input");
        const destInput = document.getElementById("export-dest-input");
        const allLibCheck = document.getElementById("export-all-library-checkbox");
        const segAudioConvert = document.getElementById("export-audio-mode-convert");
        const formatSelect = document.getElementById("export-audio-format-select");
        const bitrateSelect = document.getElementById("export-audio-bitrate-select");
        const videoExtractRadio = document.getElementById("export-video-mode-extract");
        const structSelect = document.querySelector('input[name="export_folder_structure"]:checked');
        const coverCheck = document.getElementById("export-copy-cover-checkbox");
        const playlistCheck = document.getElementById("export-generate-playlist-checkbox");

        const expName = nameInput ? nameInput.value.trim() : "Export";
        if (!expName) {
            showToast("Veuillez donner un nom à votre exportation.", "warning");
            if (nameInput) nameInput.focus();
            return;
        }

        const isConvert = segAudioConvert && segAudioConvert.classList.contains("active");

        const payload = {
            export_name: expName,
            destination_dir: destInput ? destInput.value.trim() : "",
            audio_mode: isConvert ? "convert" : "copy",
            audio_format: formatSelect ? formatSelect.value : "mp3",
            audio_bitrate: bitrateSelect ? bitrateSelect.value : "320k",
            video_mode: (videoExtractRadio && videoExtractRadio.checked) ? "extract_audio" : "copy",
            folder_structure: structSelect ? structSelect.value : "artist_album_track",
            copy_cover_art: coverCheck ? coverCheck.checked : true,
            generate_playlist: playlistCheck ? playlistCheck.checked : true,
            items: exportCart,
            export_all_library: allLibCheck ? allLibCheck.checked : false
        };

        try {
            const launchBtn = document.getElementById("export-launch-btn");
            if (launchBtn) {
                launchBtn.disabled = true;
                launchBtn.innerHTML = `<span>⏳ Démarrage de l'export...</span>`;
            }

            const res = await fetch("/api/export/start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "Erreur au lancement");

            isExportRunning = true;
            showProgressUI(true);
            startPollingProgress();
            showToast("🚀 Exportation lancée avec succès !", "success");

        } catch (err) {
            showToast(`Erreur export : ${err.message}`, "error");
            const launchBtn = document.getElementById("export-launch-btn");
            if (launchBtn) {
                launchBtn.disabled = false;
                launchBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> <span>Lancer l'Exportation</span>`;
            }
        }
    }

    // Annuler l'export
    async function cancelExportProcess() {
        try {
            await fetch("/api/export/cancel", { method: "POST" });
            showToast("Demande d'interruption envoyée...", "warning");
        } catch (e) {}
    }

    // Afficher ou masquer la section de progression
    function showProgressUI(visible) {
        const panel = document.getElementById("export-progress-panel");
        const formPanel = document.getElementById("export-settings-form-panel");
        if (panel) panel.style.display = visible ? "flex" : "none";
        if (formPanel) formPanel.style.display = visible ? "none" : "block";
    }

    // Polling de suivi
    function startPollingProgress() {
        clearInterval(pollTimer);
        pollTimer = setInterval(async () => {
            try {
                const res = await fetch("/api/export/status");
                if (!res.ok) return;
                const status = await res.json();
                handleExportProgressUpdate(status);
            } catch (e) {}
        }, 800);
    }

    // Traitement d'une mise à jour de progression (WebSocket ou polling)
    function handleExportProgressUpdate(data) {
        if (!data) return;

        const fill = document.getElementById("export-progress-fill");
        const pctLabel = document.getElementById("export-progress-percent");
        const curFileLabel = document.getElementById("export-progress-current-file");
        const countLabel = document.getElementById("export-progress-count-label");

        if (fill) fill.style.width = `${Math.min(100, Math.max(0, data.percent))}%`;
        if (pctLabel) pctLabel.textContent = `${Math.round(data.percent)}%`;
        if (countLabel) countLabel.textContent = `${data.processed_items} / ${data.total_items}`;
        if (curFileLabel) {
            curFileLabel.textContent = data.current_item_title
                ? `Traitement : ${data.current_item_artist ? data.current_item_artist + ' - ' : ''}${data.current_item_title}`
                : "Initialisation...";
        }

        if (!data.is_running && isExportRunning) {
            isExportRunning = false;
            clearInterval(pollTimer);
            showProgressUI(false);

            const launchBtn = document.getElementById("export-launch-btn");
            if (launchBtn) {
                launchBtn.disabled = false;
                launchBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> <span>Lancer l'Exportation</span>`;
            }

            if (data.status === "completed") {
                showExportSuccessModal(data);
            } else if (data.status === "cancelled") {
                showToast("L'exportation a été interrompue.", "warning");
            } else if (data.status === "error") {
                showToast(`Échec de l'exportation : ${data.last_error_message || "Erreur inconnue"}`, "error");
            }
        }
    }

    // Modale finale de succès
    function showExportSuccessModal(data) {
        const modal = document.getElementById("export-result-modal-backdrop");
        const destLabel = document.getElementById("export-result-modal-dest");
        const summaryLabel = document.getElementById("export-result-modal-summary");

        if (!modal) return;

        if (destLabel) destLabel.textContent = data.destination_dir;
        if (summaryLabel) {
            summaryLabel.textContent = `${data.audio_exported_count} piste(s) audio, ${data.video_exported_count} vidéo(s) exportée(s) en ${data.elapsed_sec}s.`;
        }

        openModalBackdrop(modal);
    }

    // Écouteur WebSocket global
    window.addEventListener("ws_export_progress", (e) => {
        if (e.detail) {
            handleExportProgressUpdate(e.detail);
        }
    });

    // Exports globaux pour utilisation depuis le lecteur ou les listes d'albums
    window.addToExportCart = addToExportCart;
    window.removeFromExportCart = removeFromExportCart;
    window.clearExportCart = clearExportCart;
    window.initExportUI = initExportUI;
    window.refreshExportEstimate = refreshEstimate;
    window.openExportItemPicker = openExportItemPicker;

    // Auto-init au chargement du DOM
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initExportUI);
    } else {
        initExportUI();
    }
})();

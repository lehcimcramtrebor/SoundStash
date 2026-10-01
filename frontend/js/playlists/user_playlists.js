/**
 * SoundStash Playlists - Gestionnaire des Playlists Utilisateur & Mosaïques
 * UserPlaylists, sélection de pochettes thématiques, génération intelligente par genre/décennie et ajout rapide.
 */

// =========================================================
// PHASE 49 : Modale Universelle d'Ajout à une Playlist
// =========================================================
let pendingAddToPlaylistSpec = null;
let cachedPlaylistsList = [];
let selectedQuickCoverUrl = null;

window.pendingAddToPlaylistSpec = null;
window.cachedPlaylistsList = [];
window.selectedQuickCoverUrl = null;

async function renderQuickPresetCovers(category = "all") {
    const grid = document.getElementById("quick-preset-covers-grid");
    if (!grid) return;
    const covers = await fetchPresetCovers();
    let html = `
        <div class="preset-cover-card ${selectedQuickCoverUrl === null ? 'is-selected' : ''}" data-cover-url="" data-cover-title="Mosaïque automatique" data-category="all" title="Mosaïque 2x2 automatique des pochettes">
            <div class="preset-mosaic-preview" style="display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.06);font-size:0.75rem;font-weight:700;color:var(--text-muted);width:100%;height:100%;">
                ✨ Auto
            </div>
            <div class="preset-cover-name" style="font-size:0.68rem;">Auto</div>
        </div>
    `;

    covers.forEach(c => {
        const isSel = selectedQuickCoverUrl === c.url;
        html += `
            <div class="preset-cover-card ${isSel ? 'is-selected' : ''}" data-cover-url="${escapeHtml(c.url)}" data-cover-title="${escapeHtml(c.title)}" data-category="${escapeHtml(c.category)}" title="${escapeHtml(c.title)}">
                <img src="${escapeHtml(c.url)}" alt="${escapeHtml(c.title)}" loading="lazy">
                <div class="preset-cover-name" style="font-size:0.68rem;">${escapeHtml(c.title)}</div>
            </div>
        `;
    });
    grid.innerHTML = html;

    grid.querySelectorAll(".preset-cover-card").forEach(card => {
        const cCat = card.getAttribute("data-category");
        card.style.display = (category === "all" || cCat === "all" || cCat === category) ? "" : "none";
        card.addEventListener("click", () => {
            grid.querySelectorAll(".preset-cover-card").forEach(c => c.classList.remove("is-selected"));
            card.classList.add("is-selected");
            const url = card.getAttribute("data-cover-url") || null;
            selectedQuickCoverUrl = url;
            const title = card.getAttribute("data-cover-title") || "Mosaïque automatique";
            const badge = document.getElementById("quick-selected-cover-badge");
            if (badge) badge.textContent = title;
        });
    });
}

function setupAddToPlaylistModal() {
    const backdrop = document.getElementById("add-to-playlist-modal-backdrop");
    const closeBtn = document.getElementById("close-add-to-playlist-btn");
    const cancelBtn = document.getElementById("cancel-add-to-playlist-btn");
    const quickInput = document.getElementById("new-playlist-quick-input");
    const quickAddBtn = document.getElementById("btn-create-and-add-quick");
    const quickCatBar = document.getElementById("quick-covers-category-bar");

    if (quickCatBar) {
        quickCatBar.querySelectorAll(".btn-cover-cat").forEach(btn => {
            btn.addEventListener("click", () => {
                quickCatBar.querySelectorAll(".btn-cover-cat").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                const cat = btn.getAttribute("data-cat");
                const grid = document.getElementById("quick-preset-covers-grid");
                if (grid) {
                    grid.querySelectorAll(".preset-cover-card").forEach(card => {
                        const cCat = card.getAttribute("data-category");
                        card.style.display = (cat === "all" || cCat === "all" || cCat === cat) ? "" : "none";
                    });
                }
            });
        });
    }

    function closeModal() {
        if (backdrop) {
            backdrop.classList.remove("active");
            setTimeout(() => {
                backdrop.style.display = "none";
                pendingAddToPlaylistSpec = null;
            }, 180);
        }
    }

    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
    if (backdrop) {
        backdrop.addEventListener("click", (e) => {
            if (e.target === backdrop) closeModal();
        });
    }

    if (quickAddBtn && quickInput) {
        const handleQuickCreate = async () => {
            const name = quickInput.value.trim();
            if (!name) {
                showToast("Veuillez saisir un nom pour la playlist.", "warning");
                quickInput.focus();
                return;
            }
            quickAddBtn.disabled = true;
            try {
                const res = await fetch("/api/playlists", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: name, description: "", cover_url: selectedQuickCoverUrl || null })
                });
                const data = await res.json();
                const pl = data.playlist || (data.id ? data : null);
                if (data.success || pl) {
                    await executeAddToPlaylist(pl.id, pl.name || name);
                } else {
                    showToast(data.message || "Erreur création playlist", "danger");
                }
            } catch (err) {
                showToast("Erreur création : " + err.message, "danger");
            } finally {
                quickAddBtn.disabled = false;
            }
        };

        quickAddBtn.addEventListener("click", handleQuickCreate);
        quickInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                handleQuickCreate();
            }
        });
    }
}

async function openAddToPlaylistModal(spec) {
    if (!spec) return;

    // Protection Mode Soirée : interdiction formelle d'ajouter aux playlists sans déverrouillage PIN
    if (window.isPartyLockActive) {
        if (window.PartyLock) {
            window.PartyLock.requestUnlock("Le Mode Soirée est activé : saisissez votre code PIN pour ajouter un titre à une playlist.", () => {
                openAddToPlaylistModal(spec);
            });
        }
        return;
    }

    // Protection stricte : exclusion formelle des concerts et oeuvres complètes
    const isConcert = spec.is_concert || spec.video_type === "concert" || (spec.path && (spec.path.toLowerCase().includes('/concerts/') || spec.path.toLowerCase().includes('\\concerts\\')));
    if (isConcert) {
        showToast("Les concerts et œuvres complètes ne peuvent pas être ajoutés aux playlists.", "warning");
        return;
    }

    pendingAddToPlaylistSpec = spec;

    const backdrop = document.getElementById("add-to-playlist-modal-backdrop");
    const summaryBox = document.getElementById("add-to-playlist-item-summary");
    const listContainer = document.getElementById("add-to-playlist-items-list");
    const quickInput = document.getElementById("new-playlist-quick-input");

    if (quickInput) quickInput.value = "";
    selectedQuickCoverUrl = null;
    const qBadge = document.getElementById("quick-selected-cover-badge");
    if (qBadge) qBadge.textContent = "Mosaïque automatique";
    const quickCatBar = document.getElementById("quick-covers-category-bar");
    if (quickCatBar) {
        quickCatBar.querySelectorAll(".btn-cover-cat").forEach(b => b.classList.remove("active"));
        quickCatBar.querySelector('.btn-cover-cat[data-cat="all"]')?.classList.add("active");
    }
    renderQuickPresetCovers("all");

    // Afficher le résumé de l'élément à ajouter
    if (summaryBox) {
        let typeBadge = `<span class="badge badge-sm badge-info">🎵 Audio</span>`;
        if (spec.type === "video") {
            typeBadge = `<span class="badge badge-sm badge-success">🎬 Clip Vidéo</span>`;
        } else if (spec.type === "album") {
            typeBadge = `<span class="badge badge-sm badge-warning">💿 Album Complet (${spec.tracks_count || "?"} pistes)</span>`;
        }

        const thumb = spec.cover_url || spec.thumbnail_url || "/static/placeholder-cover.svg";

        summaryBox.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px; background: var(--bg-hover); padding: 10px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-card);">
                <img src="${thumb}" alt="thumb" style="width: 44px; height: 44px; border-radius: 6px; object-fit: cover;" onerror="this.src='/static/placeholder-cover.svg';">
                <div style="flex: 1; min-width: 0;">
                    <div style="font-weight: 600; font-size: 0.92rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-main);">${escapeHtml(spec.title || "Titre inconnu")}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(spec.artist || "Artiste inconnu")}</div>
                </div>
                <div>${typeBadge}</div>
            </div>
        `;
    }

    if (listContainer) {
        listContainer.innerHTML = `<p class="text-muted" style="text-align: center; padding: 15px; font-size: 0.85rem;"><span class="spinner" style="display:inline-block;width:14px;height:14px;margin-right:6px;vertical-align:middle;"></span>Chargement de vos playlists...</p>`;
    }

    if (backdrop) {
        backdrop.style.display = "flex";
        void backdrop.offsetWidth;
        backdrop.classList.add("active");
    }

    // Charger les playlists disponibles
    try {
        const res = await fetch("/api/playlists");
        if (!res.ok) throw new Error("Erreur serveur");
        const data = await res.json();
        cachedPlaylistsList = data.playlists || [];
        renderAddToPlaylistList();
    } catch (err) {
        if (listContainer) {
            listContainer.innerHTML = `<p class="text-danger" style="text-align: center; padding: 10px; font-size: 0.85rem;">Impossible de charger les playlists : ${escapeHtml(err.message)}</p>`;
        }
    }
}

function renderAddToPlaylistList() {
    const listContainer = document.getElementById("add-to-playlist-items-list");
    if (!listContainer) return;

    if (cachedPlaylistsList.length === 0) {
        listContainer.innerHTML = `<p class="text-muted" style="text-align: center; padding: 15px; font-size: 0.85rem;">Aucune playlist créée pour l'instant. Créez-en une ci-dessous !</p>`;
        return;
    }

    let html = "";
    cachedPlaylistsList.forEach(pl => {
        const cover = pl.cover_collage || "/static/placeholder-cover.svg";
        const countStr = `${pl.items_count} élément${pl.items_count > 1 ? "s" : ""}`;
        const durStr = pl.total_duration_str ? ` • ${pl.total_duration_str}` : "";

        html += `
            <div class="add-to-playlist-row" data-playlist-id="${escapeHtml(pl.id)}" data-playlist-name="${escapeHtml(pl.name)}">
                <img src="${cover}" alt="cover" class="add-to-playlist-thumb" onerror="this.src='/static/placeholder-cover.svg';">
                <div class="add-to-playlist-info">
                    <div class="add-to-playlist-title">${escapeHtml(pl.name)}</div>
                    <div class="add-to-playlist-sub">${countStr}${durStr}</div>
                </div>
                <button type="button" class="btn btn-sm btn-secondary btn-confirm-add-to-pl" style="font-size: 0.8rem; padding: 4px 10px;">
                    + Ajouter
                </button>
            </div>
        `;
    });

    listContainer.innerHTML = html;

    listContainer.querySelectorAll(".add-to-playlist-row").forEach(row => {
        const plId = row.getAttribute("data-playlist-id");
        const plName = row.getAttribute("data-playlist-name");
        row.addEventListener("click", () => {
            executeAddToPlaylist(plId, plName);
        });
    });
}

async function executeAddToPlaylist(playlistId, playlistName) {
    if (!pendingAddToPlaylistSpec || !playlistId) return;

    const spec = pendingAddToPlaylistSpec;
    const backdrop = document.getElementById("add-to-playlist-modal-backdrop");

    let itemsToAdd = [];

    if (spec.type === "album") {
        // Charger toutes les pistes de l'album
        try {
            const res = await fetch(`/api/album/info?path=${encodeURIComponent(spec.path)}`);
            if (!res.ok) throw new Error("Impossible de lire le contenu de l'album");
            const info = await res.json();
            const tracks = info.tracks || [];
            if (tracks.length === 0) {
                showToast("Aucune piste trouvée dans cet album.", "warning");
                return;
            }

            itemsToAdd = tracks.map(t => ({
                type: "audio",
                title: t.title || t.filename,
                artist: t.artist || info.album_artist || spec.artist || "Artiste inconnu",
                album_title: info.album_name || spec.title || "Album",
                duration_seconds: t.duration_seconds || 0,
                path: t.path || (info.album_dir ? `${info.album_dir}\\${t.filename}` : t.filename),
                cover_url: `/api/audio/cover?path=${encodeURIComponent(spec.path)}`
            }));
        } catch (e) {
            showToast("Erreur lors de la lecture des pistes : " + e.message, "danger");
            return;
        }
    } else if (spec.type === "video") {
        const vidPath = spec.path || spec.rel_path || spec.filepath || "";
        itemsToAdd = [{
            type: "video",
            title: spec.title || "Clip vidéo",
            artist: spec.artist || "Artiste inconnu",
            duration_seconds: spec.duration_seconds || spec.duration || 0,
            path: vidPath,
            rel_path: spec.rel_path || vidPath,
            filepath: spec.filepath || vidPath,
            thumbnail_url: spec.thumbnail_url || spec.cover_url || spec.thumbnail || (vidPath ? `/api/videos/thumbnail?path=${encodeURIComponent(vidPath)}` : "/static/placeholder-cover.svg"),
            height: spec.height || 1080
        }];
    } else {
        itemsToAdd = [{
            type: "audio",
            title: spec.title || "Piste",
            artist: spec.artist || "Artiste inconnu",
            album_title: spec.album_title || "",
            duration_seconds: spec.duration_seconds || spec.duration || 0,
            path: spec.path,
            cover_url: spec.cover_url || `/api/audio/cover?path=${encodeURIComponent(spec.path)}`
        }];
    }

    try {
        const res = await fetch(`/api/playlists/${playlistId}/items`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: itemsToAdd })
        });
        const data = await res.json();
        const ok = data.success || (res.ok && (data.playlist || data.id));
        if (ok) {
            showToast(`Ajouté à la playlist « ${playlistName} » (${itemsToAdd.length} élément${itemsToAdd.length > 1 ? "s" : ""}) !`, "success");
            if (backdrop) {
                backdrop.classList.remove("active");
                backdrop.style.display = "none";
                pendingAddToPlaylistSpec = null;
            }
            // Si la vue playlists est ouverte, la rafraîchir
            if (window.AudioPlayer && window.AudioPlayer.currentView === "playlists" && window.UserPlaylists) {
                window.UserPlaylists.loadAndRenderPlaylists(true);
            }
        } else {
            showToast(data.message || "Erreur lors de l'ajout.", "danger");
        }
    } catch (err) {
        showToast("Erreur réseau : " + err.message, "danger");
    }
}

// ── Gestionnaire Client de Playlists Utilisateur (Sous-Onglet) ─────────────────
const UserPlaylists = {
    playlists: [],
    hasSystemPlaylist: false,
    currentDetailPlaylist: null,
    isDetailOpen: false,
    playlistCache: new Map(), // id → playlist complète avec .items (prefetch)

    // ── GESTION DE LA POCHETTE DYNAMIQUE (STICKY SIDEBAR) ──
    // Sans lecture : vignette de la playlist. En lecture : cover jouée. Rien d'autre.

    // Vérifie si un morceau de la playlist actuellement affichée est en cours de lecture
    isPlayingCurrentDetailPlaylist() {
        const ap = window.AudioPlayer;
        if (!ap || !this.currentDetailPlaylist) return false;
        const pl = this.currentDetailPlaylist;
        const targetPath = (pl.id && (pl.id === "system:all-collection" || pl.id.startsWith("system:"))) ? pl.id : `playlist:${pl.id}`;
        const isThisPlaylistLoaded = Boolean(
            ap.isUserPlaylistActive &&
            ap.currentAlbum &&
            (ap.currentAlbum.path === targetPath || (pl.id === "system:all-collection" && ap.currentAlbum.path && ap.currentAlbum.path.includes("all-collection"))) &&
            ap.playlist &&
            ap.playlist[ap.currentIndex]
        );
        return isThisPlaylistLoaded && Boolean(ap.isPlaying || (ap.audioElement && !ap.audioElement.ended && ap.audioElement.src && !ap.audioElement.paused));
    },

    // Récupère la pochette du morceau actuellement joué dans cette playlist
    getActivePlayingTrackCover() {
        if (!this.isPlayingCurrentDetailPlaylist()) return null;
        const ap = window.AudioPlayer;
        const cur = ap.playlist[ap.currentIndex];
        if (!cur) return null;
        return cur.cover_url || cur.thumbnail_url || (cur.path ? `/api/audio/cover?path=${encodeURIComponent(cur.path)}` : null);
    },

    // Détermine la pochette de base : morceau joué de cette playlist, sinon illustration de la playlist elle-même
    getBaseHeroCover() {
        const activePlayingCover = this.getActivePlayingTrackCover();
        if (activePlayingCover) return activePlayingCover;
        const heroCover = document.getElementById("playlist-hero-cover");
        if (this.currentDetailPlaylist && (this.currentDetailPlaylist.id === "system:all-collection" || (typeof this.currentDetailPlaylist.id === "string" && this.currentDetailPlaylist.id.includes("all-collection")))) {
            return "/static/playlist_covers/all_collection.svg";
        }
        return (heroCover && heroCover.dataset.defaultCover) || (this.currentDetailPlaylist && this.currentDetailPlaylist.cover_url) || "/static/placeholder-cover.svg";
    },

    // Synchronise la pochette principale avec l'état de lecture
    syncHeroCoverFromPlayer() {
        const heroCover = document.getElementById("playlist-hero-cover");
        if (!heroCover) return;
        const base = this.getBaseHeroCover();
        if (base && heroCover.src !== base && !heroCover.src.includes(encodeURIComponent(base))) {
            heroCover.src = base;
        }
    },


    computeTotalCount() {
        return (this.playlists && Array.isArray(this.playlists)) ? this.playlists.length : 0;
    },

    updateBadgeUI() {
        const subtabBadge = document.getElementById("player-playlists-count-badge");
        if (subtabBadge) {
            subtabBadge.textContent = this.computeTotalCount();
        }
    },

    async updateBadge() {
        try {
            const res = await fetch("/api/playlists");
            if (res.ok) {
                const data = await res.json();
                this.playlists = data.playlists || [];
                const count = (this.playlists && Array.isArray(this.playlists)) ? this.playlists.length : 0;
                const subtabBadge = document.getElementById("player-playlists-count-badge");
                if (subtabBadge) subtabBadge.textContent = count;
            }
        } catch (e) {
            console.debug("Mise à jour silencieuse badge playlists:", e);
        }
    },

    /** Prefetch en arrière-plan des playlists complètes (avec items) pour clic instantané. */
    async warmPlaylistCache() {
        if (!this.playlists || this.playlists.length === 0) return;
        for (const pl of this.playlists) {
            if (this.playlistCache.has(pl.id)) continue; // déjà en cache
            try {
                const res = await fetch(`/api/playlists/${pl.id}`);
                if (res.ok) {
                    const full = await res.json();
                    if (full && full.items) this.playlistCache.set(pl.id, full);
                }
            } catch (_) {}
            await new Promise(r => setTimeout(r, 200)); // throttle doux
        }
    },

    async loadAndRenderPlaylists(force = false) {
        const gridContainer = document.getElementById("playlists-grid");
        const detailView = document.getElementById("playlist-detail-view");
        const gridView = document.getElementById("playlists-grid-view");

        // Assurer que la vue grille est affichée UNIQUEMENT si l'utilisateur n'est pas déjà dans le détail d'une playlist
        if (!this.isDetailOpen) {
            if (detailView) detailView.style.display = "none";
            if (gridView) gridView.style.display = "block";
        }

        if (gridContainer && (!this.playlists.length || force)) {
            gridContainer.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1; padding: 40px; text-align: center;"><span class="spinner" style="display:inline-block;width:20px;height:20px;margin-bottom:10px;"></span><p class="text-muted">Chargement de vos playlists...</p></div>`;
        }

        try {
            const res = await fetch("/api/playlists");
            if (!res.ok) throw new Error("Erreur de récupération des playlists");
            const data = await res.json();
            this.playlists = data.playlists || [];
            if (typeof data.has_system_playlist === "boolean") {
                this.hasSystemPlaylist = data.has_system_playlist;
            }
            
            // Mettre à jour le badge du sous-onglet Playlists
            this.updateBadgeUI();

            this.renderGrid();

            // Prefetch en arrière-plan de toutes les playlists avec leurs items
            if (force) this.playlistCache.clear();
            setTimeout(() => this.warmPlaylistCache(), 100);
        } catch (err) {
            if (gridContainer) {
                gridContainer.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1; padding: 40px; text-align: center;"><p class="text-danger">Impossible de charger vos playlists : ${escapeHtml(err.message)}</p></div>`;
            }
        }
    },

    renderGrid() {
        const grid = document.getElementById("playlists-grid");
        if (!grid) return;

        // Mettre à jour le badge du sous-onglet Playlists
        this.updateBadgeUI();

        if (this.playlists.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; padding: 50px 20px; text-align: center;">
                    <div style="font-size: 3rem; opacity: 0.5; margin-bottom: 12px;">📑</div>
                    <h3 style="margin-bottom: 8px;">Aucune playlist pour l'instant</h3>
                    <p class="text-muted" style="max-width: 480px; margin: 0 auto 20px auto; font-size: 0.9rem;">
                        Créez votre première playlist mixte (morceaux audio et clips vidéo) ou envoyez un album complet en 1 clic !
                    </p>
                    <button type="button" class="btn btn-primary" onclick="UserPlaylists.promptCreatePlaylist()">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align: middle; margin-right: 4px;"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                        <span>Créer une playlist</span>
                    </button>
                </div>
            `;
            return;
        }

        let html = "";
        this.playlists.forEach((p) => {
            const cover = p.cover_collage || p.cover_url || "/static/placeholder-cover.svg";
            const durStr = p.total_duration_str ? ` • ${p.total_duration_str}` : "";
            const audioBadge = p.audio_count > 0 ? `<span class="badge-item-audio">🎵 ${p.audio_count}</span>` : "";
            const videoBadge = p.video_count > 0 ? `<span class="badge-item-video">🎬 ${p.video_count}</span>` : "";
            const count = (p.items_count !== undefined ? p.items_count : (p.track_count || 0));

            html += `
                <div class="playlist-card" data-playlist-id="${escapeHtml(p.id)}">
                    <div class="playlist-card-cover-wrap">
                        <img class="playlist-card-cover" src="${cover}" alt="cover" loading="lazy" onerror="this.src='/static/placeholder-cover.svg';">
                        <button type="button" class="playlist-card-play-btn" title="Lire cette playlist" data-action="play-playlist" data-playlist-id="${escapeHtml(p.id)}">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        </button>
                        <button type="button" class="playlist-card-delete-btn" title="Supprimer la playlist" data-action="delete-playlist" data-playlist-id="${escapeHtml(p.id)}">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                        </button>
                    </div>
                    <div class="playlist-card-info">
                        <div class="playlist-card-title" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
                        <div class="playlist-card-meta">
                            <span>${count} élément${count > 1 ? "s" : ""}${durStr}</span>
                        </div>
                        <div class="playlist-card-badges">
                            ${audioBadge}
                            ${videoBadge}
                        </div>
                    </div>
                </div>
            `;
        });

        grid.innerHTML = html;

        // Clic sur une carte pour ouvrir le détail, lire ou supprimer
        // ── Cartes playlists utilisateur ──
        grid.querySelectorAll(".playlist-card").forEach(card => {
            const id = card.getAttribute("data-playlist-id");
            const playBtn = card.querySelector('[data-action="play-playlist"]');
            const delBtn = card.querySelector('[data-action="delete-playlist"]');

            if (playBtn) {
                playBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const pl = this.playlists.find(p => p.id === id);
                    if (pl && window.AudioPlayer) {
                        window.AudioPlayer.playUserPlaylist(pl, 0, false);
                    }
                });
            }

            if (delBtn) {
                delBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    if (window.isPartyLockActive) {
                        if (window.PartyLock) {
                            window.PartyLock.requestUnlock("Le Mode Soirée est activé : saisissez votre code PIN pour supprimer une playlist.", () => {
                                delBtn.click();
                            });
                        }
                        return;
                    }
                    const pl = this.playlists.find(p => p.id === id);
                    if (!pl) return;
                    const confirmed = await showModalConfirm(
                        "Supprimer la playlist",
                        `Voulez-vous vraiment supprimer définitivement la playlist « ${pl.name} » ?\n(Vos fichiers audio et vidéo sur le disque ne seront pas affectés).`,
                        "Supprimer la playlist",
                        true
                    );
                    if (!confirmed) return;
                    try {
                        const res = await fetch(`/api/playlists/${pl.id}`, { method: "DELETE" });
                        const data = await res.json();
                        if (data.success) {
                            showToast(`Playlist « ${pl.name} » supprimée.`, "success");
                            await this.loadAndRenderPlaylists(true);
                        } else {
                            showToast(data.message || "Erreur suppression", "danger");
                        }
                    } catch (err) {
                        showToast("Erreur : " + err.message, "danger");
                    }
                });
            }

            card.addEventListener("click", () => {
                this.openDetail(id);
            });
        });
    },

    async openAllCollectionDetail() {
        this.isDetailOpen = true;
        this.currentDetailPlaylist = {
            id: "system:all-collection",
            name: "🌍 Toute la Collection",
            cover_url: "/static/playlist_covers/all_collection.svg",
            items_count: 0
        };
        if (window.AudioPlayer && window.AudioPlayer.updateDetailContextBar) {
            window.AudioPlayer.updateDetailContextBar();
        }

        const gridView = document.getElementById("playlists-grid-view");
        const detailView = document.getElementById("playlist-detail-view");
        const deleteBtn = document.getElementById("btn-delete-playlist");
        const renameBtn = document.getElementById("btn-rename-playlist");
        const changeCoverBtn = document.getElementById("btn-change-playlist-cover");
        const tbody = document.getElementById("playlist-tracks-body");
        const titleEl = document.getElementById("playlist-hero-title");
        const descEl = document.getElementById("playlist-hero-desc");
        const coverEl = document.getElementById("playlist-hero-cover");
        const countEl = document.getElementById("playlist-hero-count");
        const durEl = document.getElementById("playlist-hero-duration");
        const typesEl = document.getElementById("playlist-hero-types");
        const mixedBadge = document.getElementById("playlist-hero-mixed-badge");
        const smartBadge = document.getElementById("playlist-hero-smart-badge");
        const refreshBtn = document.getElementById("btn-refresh-smart-playlist");

        if (gridView) gridView.style.display = "none";
        if (detailView) detailView.style.display = "block";
        if (deleteBtn) deleteBtn.style.display = "none";
        if (renameBtn) renameBtn.style.display = "none";
        if (changeCoverBtn) changeCoverBtn.style.display = "none";
        if (smartBadge) smartBadge.style.display = "none";
        if (refreshBtn) refreshBtn.style.display = "none";
        if (mixedBadge) mixedBadge.style.display = "none";

        // Affichage immédiat d'un en-tête soigné et du spinner de chargement
        if (titleEl) titleEl.textContent = "🌍 Toute la Collection";
        if (descEl) descEl.textContent = "Catalogue intégral — Chargement des morceaux...";
        if (countEl) countEl.textContent = "Chargement en cours...";
        if (durEl) durEl.textContent = "--:--";
        if (typesEl) typesEl.textContent = "🎵 Audio";
        if (coverEl) coverEl.src = this.getBaseHeroCover();

        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 70px 20px;">
                        <span class="spinner" style="display: inline-block; width: 32px; height: 32px; border-width: 3px; margin-bottom: 14px; vertical-align: middle;"></span>
                        <div style="font-size: 1.05rem; font-weight: 600; color: var(--text-main);">Indexation et chargement de la collection...</div>
                        <div class="text-muted" style="font-size: 0.85rem; margin-top: 6px;">Vérification de l'ensemble des titres en cours, veuillez patienter un instant.</div>
                    </td>
                </tr>
            `;
        }

        try {
            const ap = window.AudioPlayer;
            let tracks = [];
            let albumsCount = 0;
            if (ap && ap.currentAlbum && (ap.currentAlbum.path === "system:all-collection" || (ap.currentAlbum.path && ap.currentAlbum.path.includes("all-collection"))) && ap.playlist && ap.playlist.length > 0) {
                tracks = ap.playlist;
                albumsCount = ap.libraryAlbums ? ap.libraryAlbums.length : 0;
            } else {
                let res = await fetch("/api/collection/all-tracks");
                if (!res.ok) {
                    // Si l'application démarre tout juste, patienter brièvement et réessayer
                    await new Promise(r => setTimeout(r, 800));
                    res = await fetch("/api/collection/all-tracks");
                }
                if (!res.ok) throw new Error("Erreur de récupération de la collection");
                const data = await res.json();
                tracks = data.tracks || [];
                albumsCount = data.albums_count || 0;
            }

            const sysPl = {
                id: "system:all-collection",
                name: "🌍 Toute la Collection",
                description: `Catalogue intégral — ${albumsCount} albums • ${tracks.length} pistes`,
                is_smart: false,
                is_system: true,
                cover_url: "/static/playlist_covers/all_collection.svg",
                items_count: tracks.length,
                audio_count: tracks.length,
                video_count: 0,
                items: tracks
            };
            this.currentDetailPlaylist = sysPl;
            this.renderDetail(sysPl);
        } catch (err) {
            console.error("Erreur openAllCollectionDetail:", err);
            if (tbody) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" style="text-align: center; padding: 50px 20px;">
                            <div style="color: var(--danger, #ef4444); font-weight: 600; margin-bottom: 8px;">Impossible de charger la collection</div>
                            <div class="text-muted" style="font-size: 0.85rem; margin-bottom: 14px;">${escapeHtml(err.message)}</div>
                            <button type="button" class="btn btn-sm btn-primary" onclick="UserPlaylists.openAllCollectionDetail()">Réessayer</button>
                        </td>
                    </tr>
                `;
            }
        }
    },

    async openDetail(playlistId) {
        if (!playlistId || playlistId === "system:all-collection" || playlistId === "all-collection" || (typeof playlistId === "string" && playlistId.includes("all-collection"))) {
            return this.openAllCollectionDetail();
        }
        this.isDetailOpen = true;
        const basicPl = this.playlists.find(p => p.id === playlistId);
        if (basicPl) {
            this.currentDetailPlaylist = basicPl;
        }
        if (window.AudioPlayer && window.AudioPlayer.updateDetailContextBar) {
            window.AudioPlayer.updateDetailContextBar();
        }

        const gridView = document.getElementById("playlists-grid-view");
        const detailView = document.getElementById("playlist-detail-view");
        const deleteBtn = document.getElementById("btn-delete-playlist");
        const renameBtn = document.getElementById("btn-rename-playlist");
        const changeCoverBtn = document.getElementById("btn-change-playlist-cover");
        const tbody = document.getElementById("playlist-tracks-body");
        const titleEl = document.getElementById("playlist-hero-title");
        const descEl = document.getElementById("playlist-hero-desc");
        const countEl = document.getElementById("playlist-hero-count");

        if (gridView) gridView.style.display = "none";
        if (detailView) detailView.style.display = "block";
        if (deleteBtn) deleteBtn.style.display = "inline-flex";
        if (renameBtn) renameBtn.style.display = "inline-flex";
        if (changeCoverBtn) changeCoverBtn.style.display = "inline-flex";

        // Vérifier d'abord le cache mémoire pour affichage instantané à 0 ms !
        const cached = this.playlistCache.get(playlistId);
        if (cached && cached.items && cached.items.length > 0) {
            this.currentDetailPlaylist = cached;
            this.renderDetail(cached);
            return;
        }

        // Trouver les métadonnées de base si déjà listée
        if (basicPl) {
            if (titleEl) titleEl.textContent = basicPl.name || "Playlist";
            if (descEl) descEl.textContent = basicPl.description || "";
            if (countEl) countEl.textContent = "Chargement...";
        }

        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 60px 20px;">
                        <span class="spinner" style="display: inline-block; width: 28px; height: 28px; border-width: 3px; margin-bottom: 12px; vertical-align: middle;"></span>
                        <div style="font-size: 1rem; font-weight: 600; color: var(--text-main);">Chargement de la playlist...</div>
                        <div class="text-muted" style="font-size: 0.85rem; margin-top: 4px;">Récupération des morceaux, veuillez patienter...</div>
                    </td>
                </tr>
            `;
        }

        try {
            let res = await fetch(`/api/playlists/${playlistId}`);
            if (!res.ok) {
                // Attente brève et réessai si l'application vient d'ouvrir
                await new Promise(r => setTimeout(r, 800));
                res = await fetch(`/api/playlists/${playlistId}`);
            }
            if (!res.ok) throw new Error("Playlist introuvable");
            const pl = await res.json();
            this.currentDetailPlaylist = pl;
            this.playlistCache.set(playlistId, pl);
            this.renderDetail(pl);
        } catch (err) {
            console.error("Erreur openDetail:", err);
            if (tbody) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" style="text-align: center; padding: 50px 20px;">
                            <div style="color: var(--danger, #ef4444); font-weight: 600; margin-bottom: 8px;">Impossible de charger cette playlist</div>
                            <div class="text-muted" style="font-size: 0.85rem; margin-bottom: 14px;">${escapeHtml(err.message)}</div>
                            <button type="button" class="btn btn-sm btn-primary" onclick="UserPlaylists.openDetail('${escapeHtml(playlistId)}')">Réessayer</button>
                        </td>
                    </tr>
                `;
            }
        }
    },

    renderDetail(pl) {
        this.currentDetailPlaylist = pl;
        if (window.AudioPlayer && window.AudioPlayer.updateDetailContextBar) {
            window.AudioPlayer.updateDetailContextBar();
        }
        const titleEl = document.getElementById("playlist-hero-title");
        const descEl = document.getElementById("playlist-hero-desc");
        const coverEl = document.getElementById("playlist-hero-cover");
        const countEl = document.getElementById("playlist-hero-count");
        const durEl = document.getElementById("playlist-hero-duration");
        const typesEl = document.getElementById("playlist-hero-types");
        const mixedBadge = document.getElementById("playlist-hero-mixed-badge");
        const tbody = document.getElementById("playlist-tracks-body");

        if (titleEl) titleEl.textContent = pl.name;
        if (descEl) descEl.textContent = pl.description || "";
        if (coverEl) {
            const initialCover = (pl.id === "system:all-collection" || (typeof pl.id === "string" && pl.id.includes("all-collection")))
                ? "/static/playlist_covers/all_collection.svg"
                : (pl.cover_url || pl.cover_collage || (pl.items && (pl.items[0]?.thumbnail_url || pl.items[0]?.cover_url)) || "/static/placeholder-cover.svg");
            coverEl.dataset.defaultCover = initialCover;
            coverEl.src = this.getBaseHeroCover();
            coverEl.onerror = function() { this.src = "/static/placeholder-cover.svg"; };
        }
        if (countEl) countEl.textContent = `${pl.items_count} élément${pl.items_count > 1 ? "s" : ""}`;
        if (durEl) durEl.textContent = pl.total_duration_str || "0:00";
        if (typesEl) typesEl.textContent = `${pl.audio_count} 🎵 Audio • ${pl.video_count} 🎬 Vidéo`;
        if (mixedBadge) mixedBadge.style.display = (pl.audio_count > 0 && pl.video_count > 0) ? "inline-block" : "none";

        const refreshBtn = document.getElementById("btn-refresh-smart-playlist");
        const smartBadge = document.getElementById("playlist-hero-smart-badge");
        if (pl.is_smart) {
            if (refreshBtn) refreshBtn.style.display = "inline-flex";
            if (smartBadge) {
                smartBadge.style.display = "inline-block";
                const SMART_LABELS = {
                    "top_played": "Top les plus écoutés",
                    "genres": "Mix Multi-Genres",
                    "top_genres": "Top par Genre",
                    "decade": `Machine à Remonter (${pl.smart_criteria?.decade || ""}s)`,
                    "unplayed": "Pépites jamais écoutées",
                    "videos_mix": "100% Vidéos Clips",
                    "random_mix": "Blind-Test Aléatoire"
                };
                smartBadge.textContent = `✨ Smart Playlist • ${SMART_LABELS[pl.smart_type] || "Automatisée"}`;
            }
        } else {
            if (refreshBtn) refreshBtn.style.display = "none";
            if (smartBadge) smartBadge.style.display = "none";
        }

        if (!tbody) return;
        tbody.innerHTML = "";

        const items = pl.items || [];
        if (items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding: 30px;">Cette playlist est vide. Ajoutez des morceaux depuis votre collection ou des vidéos depuis le Hub Vidéo !</td></tr>`;
            return;
        }

        items.forEach((item, idx) => {
            const tr = document.createElement("tr");
            tr.setAttribute("data-item-id", item.id);
            tr.setAttribute("data-idx", idx);
            tr.setAttribute("data-trk-idx", idx);
            const isVideo = item.type === "video";

            // Résolution robuste de l'image de couverture ou de la miniature vidéo
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
            let coverSrc = "";
            if (isVideo) {
                coverSrc = item.thumbnail_url || item.cover_url || (itemPath ? `/api/videos/thumbnail?path=${encodeURIComponent(itemPath)}` : "") || "/static/placeholder-cover.svg";
            } else {
                coverSrc = item.cover_url || (itemPath ? `/api/audio/cover?path=${encodeURIComponent(itemPath)}` : "") || "/static/placeholder-cover.svg";
            }

            const typeLabel = isVideo ? "Clip Vidéo" : "Piste Audio";
            const typeEmoji = isVideo ? "🎬" : "🎵";
            tr.dataset.coverSrc = coverSrc;

            tr.innerHTML = `
                <td style="text-align: center; color: var(--text-muted); font-size: 0.85rem; font-family: var(--font-mono);">${idx + 1}</td>
                <td style="text-align: center; vertical-align: middle; padding: 6px 8px;">
                    <div class="pl-track-thumb-wrap" title="${typeLabel} : Cliquer pour lire">
                        <img class="pl-track-thumb-img" src="${escapeHtml(coverSrc)}" alt="thumb" loading="lazy" onerror="this.src='/static/placeholder-cover.svg';">
                        <div class="pl-track-thumb-overlay">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                        <span class="pl-track-type-tag ${isVideo ? 'video' : 'audio'}" title="${typeLabel}">${typeEmoji}</span>
                    </div>
                </td>
                <td>
                    <span style="font-weight: 500; color: var(--text-main);">${escapeHtml(item.title)}</span>
                    ${item.album_title ? `<div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 2px;">${escapeHtml(item.album_title)}</div>` : ""}
                </td>
                <td style="color: var(--text-muted); font-size: 0.85rem;">${escapeHtml(item.artist)}</td>
                <td style="text-align: right; font-family: var(--font-mono); font-size: 0.82rem; color: var(--text-muted);">${escapeHtml(item.duration_str || "--:--")}</td>
                <td style="text-align: center; white-space: nowrap;">
                    <div style="display: inline-flex; gap: 4px; justify-content: center;">
                        <button type="button" class="btn btn-ghost btn-sm btn-pl-item-play" title="Lire à partir d'ici">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        </button>
                        <button type="button" class="btn btn-ghost btn-sm btn-pl-item-delete" title="Retirer de la playlist" style="color: var(--danger, #ef4444);">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                        </button>
                    </div>
                </td>
            `;

            const handleTrackPlay = () => {
                if (!window.AudioPlayer) return;
                const ap = window.AudioPlayer;
                const isSameCollection = ap.currentAlbum && (
                    (this.currentDetailPlaylist.id === "system:all-collection" && (ap.currentAlbum.path === "system:all-collection" || ap.currentAlbum.path.includes("all-collection"))) ||
                    (ap.currentAlbum.path === `playlist:${this.currentDetailPlaylist.id}`)
                );
                if (ap.isUserPlaylistActive && isSameCollection && ap.playlist && ap.playlist.length === (this.currentDetailPlaylist.items ? this.currentDetailPlaylist.items.length : 0)) {
                    ap.playTrackAtIndex(idx);
                    setTimeout(() => ap.scrollToActiveTrack(true), 60);
                } else {
                    ap.playUserPlaylist(this.currentDetailPlaylist, idx, false);
                }
            };

            // Clic direct sur n'importe quel endroit de la ligne (comme pour les albums)
            tr.addEventListener("click", (e) => {
                // Ne pas déclencher si clic sur le bouton de suppression ou autre action spécifique
                if (e.target.closest(".btn-pl-item-delete") || e.target.closest("button:not(.btn-pl-item-play)")) {
                    return;
                }
                handleTrackPlay();
            });

            const btnPlay = tr.querySelector(".btn-pl-item-play");
            if (btnPlay) {
                btnPlay.addEventListener("click", handleTrackPlay);
            }

            const btnDel = tr.querySelector(".btn-pl-item-delete");
            if (btnDel) {
                btnDel.addEventListener("click", (e) => {
                    e.stopPropagation();
                    if (btnDel.classList.contains("confirming")) {
                        if (btnDel._confirmTimeout) {
                            clearTimeout(btnDel._confirmTimeout);
                            btnDel._confirmTimeout = null;
                        }
                        btnDel.classList.remove("confirming");
                        if (btnDel._originalHtml) {
                            btnDel.innerHTML = btnDel._originalHtml;
                        }
                        this.removeItem(pl.id, item.id, item.title);
                    } else {
                        // Réinitialiser tout autre bouton de suppression en attente
                        tbody.querySelectorAll(".btn-pl-item-delete.confirming").forEach(other => {
                            if (other._confirmTimeout) clearTimeout(other._confirmTimeout);
                            other.classList.remove("confirming");
                            if (other._originalHtml) other.innerHTML = other._originalHtml;
                        });

                        btnDel._originalHtml = btnDel.innerHTML;
                        btnDel.classList.add("confirming");
                        btnDel.innerHTML = `<span style="display:inline-flex; align-items:center; gap:3px;">Confirmer ?</span>`;
                        btnDel._confirmTimeout = setTimeout(() => {
                            btnDel.classList.remove("confirming");
                            if (btnDel._originalHtml) {
                                btnDel.innerHTML = btnDel._originalHtml;
                            }
                            btnDel._confirmTimeout = null;
                        }, 3500);
                    }
                });
            }

            tbody.appendChild(tr);
        });
    },

    promptCreatePlaylist() {
        openCreatePlaylistModal();
    },

    async promptRenamePlaylist() {
        if (!this.currentDetailPlaylist) return;
        if (window.isPartyLockActive) {
            if (window.PartyLock) {
                window.PartyLock.requestUnlock("Le Mode Soirée est activé : saisissez votre code PIN pour renommer une playlist.", () => {
                    this.promptRenamePlaylist();
                });
            }
            return;
        }
        const currentName = this.currentDetailPlaylist.name || "";
        const newName = await showModalPrompt("Renommer la playlist", "Saisissez le nouveau nom de la playlist :", currentName, "Nom de la playlist...");
        if (!newName || !newName.trim() || newName.trim() === currentName) return;

        try {
            const res = await fetch(`/api/playlists/${this.currentDetailPlaylist.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newName.trim(), description: this.currentDetailPlaylist.description || "" })
            });
            const data = await res.json();
            if (data.success) {
                this.currentDetailPlaylist.name = newName.trim();
                const titleEl = document.getElementById("playlist-hero-title");
                if (titleEl) titleEl.textContent = newName.trim();
                showToast("Playlist renommée avec succès !", "success");
            } else {
                showToast(data.message || "Erreur renommage", "danger");
            }
        } catch (e) {
            showToast("Erreur : " + e.message, "danger");
        }
    },

    closeDetail() {
        this.isDetailOpen = false;
        this.currentDetailPlaylist = null;
        const gridView = document.getElementById("playlists-grid-view");
        const detailView = document.getElementById("playlist-detail-view");
        if (detailView) detailView.style.display = "none";
        if (gridView) gridView.style.display = "block";
        if (window.AudioPlayer && window.AudioPlayer.updateDetailContextBar) {
            window.AudioPlayer.updateDetailContextBar();
        }
        this.loadAndRenderPlaylists(true);
    },

    async deleteActivePlaylist() {
        if (!this.currentDetailPlaylist) return;

        if (window.isPartyLockActive) {
            if (window.PartyLock) {
                window.PartyLock.requestUnlock("Le Mode Soirée est activé : saisissez votre code PIN pour supprimer une playlist.", () => {
                    this.deleteActivePlaylist();
                });
            }
            return;
        }

        const pl = this.currentDetailPlaylist;
        const confirmed = await showModalConfirm(
            "Supprimer la playlist",
            `Voulez-vous vraiment supprimer définitivement la playlist « ${pl.name} » ?\n(Vos fichiers audio et vidéo sur le disque ne seront pas affectés).`,
            "Supprimer la playlist",
            true
        );
        if (!confirmed) return;

        try {
            const res = await fetch(`/api/playlists/${pl.id}`, { method: "DELETE" });
            const data = await res.json();
            if (data.success) {
                showToast(`Playlist « ${pl.name} » supprimée.`, "success");
                this.closeDetail();
            } else {
                showToast(data.message || "Erreur suppression", "danger");
            }
        } catch (e) {
            showToast("Erreur suppression : " + e.message, "danger");
        }
    },

    async removeItem(playlistId, itemId, itemTitle) {
        if (window.isPartyLockActive) {
            if (window.PartyLock) {
                window.PartyLock.requestUnlock("Le Mode Soirée est activé : saisissez votre code PIN pour modifier une playlist.", () => {
                    this.removeItem(playlistId, itemId, itemTitle);
                });
            }
            return;
        }
        try {
            const res = await fetch(`/api/playlists/${playlistId}/items/${itemId}`, { method: "DELETE" });
            const data = await res.json();
            if (data.success) {
                showToast(`« ${itemTitle} » retiré de la playlist.`, "info");
                await this.openDetail(playlistId);
            }
        } catch (e) {
            showToast("Erreur suppression élément : " + e.message, "danger");
        }
    }
};
window.UserPlaylists = UserPlaylists;

// =========================================================
// PHASE 62 : GESTION DES MODALES DE PLAYLISTS & COUVERTURES
// =========================================================
let cachedPresetCovers = null;
let cachedLibraryGenres = null;
let selectedCreateCoverUrl = null;
let selectedCreateMode = "standard"; // "standard" | "smart"
let selectedSmartGenres = new Set();
let targetChangeCoverPlaylist = null;
let selectedChangeCoverUrl = null;

async function fetchPresetCovers() {
    if (cachedPresetCovers) return cachedPresetCovers;
    try {
        const res = await fetch("/api/playlists/preset-covers");
        if (res.ok) {
            const data = await res.json();
            cachedPresetCovers = data.covers || [];
            return cachedPresetCovers;
        }
    } catch (e) {
        console.warn("Erreur chargement pochettes thématiques:", e);
    }
    return [];
}

async function fetchLibraryGenres() {
    if (cachedLibraryGenres) return cachedLibraryGenres;
    try {
        const res = await fetch("/api/genres/list");
        if (res.ok) {
            const data = await res.json();
            cachedLibraryGenres = data.genres || [];
            return cachedLibraryGenres;
        }
    } catch (e) {
        console.warn("Erreur chargement genres:", e);
    }
    return [];
}

function setCreatePlaylistMode(mode) {
    selectedCreateMode = mode;
    const btnStd = document.getElementById("btn-mode-standard");
    const btnSmart = document.getElementById("btn-mode-smart");
    const secStd = document.getElementById("section-mode-standard");
    const secSmart = document.getElementById("section-mode-smart");
    const submitText = document.getElementById("submit-create-playlist-btn-text");

    if (mode === "standard") {
        btnStd?.classList.add("active");
        btnSmart?.classList.remove("active");
        if (secStd) secStd.style.display = "block";
        if (secSmart) secSmart.style.display = "none";
        if (submitText) submitText.textContent = "Créer la playlist";
    } else {
        btnStd?.classList.remove("active");
        btnSmart?.classList.add("active");
        if (secStd) secStd.style.display = "none";
        if (secSmart) secSmart.style.display = "block";
        if (submitText) submitText.textContent = "⚡ Générer la playlist intelligente";
    }
}

function updateSmartCriteriaVisibility() {
    const typeSelect = document.getElementById("smart-pl-type-select");
    const genresBox = document.getElementById("smart-criteria-genres-box");
    const decadeBox = document.getElementById("smart-criteria-decade-box");
    const nameInput = document.getElementById("smart-pl-name-input");
    if (!typeSelect) return;

    const val = typeSelect.value;
    if (genresBox) genresBox.style.display = (val === "genres" || val === "top_genres") ? "block" : "none";
    if (decadeBox) decadeBox.style.display = (val === "decade") ? "block" : "none";

    if (nameInput) {
        const DEFAULT_NAMES = {
            "top_played": "🔥 Top Hits de ma collection",
            "genres": "🔀 Mix Multi-Genres",
            "top_genres": "💎 Top Titres par Genre",
            "decade": "⏳ Voyage Années 80",
            "unplayed": "✨ Pépites Oubliées",
            "videos_mix": "🎬 100% Clips Vidéo 16:9",
            "random_mix": "🎲 Blind-Test & Mix Aléatoire"
        };
        nameInput.value = DEFAULT_NAMES[val] || "Playlist Intelligente";
    }
}

async function renderCreatePresetCovers(category = "all") {
    const grid = document.getElementById("create-preset-covers-grid");
    if (!grid) return;

    const covers = await fetchPresetCovers();
    let html = `
        <div class="preset-cover-card ${selectedCreateCoverUrl === null ? 'is-selected' : ''}" data-cover-url="" data-cover-title="Mosaïque automatique" data-category="all" title="Mosaïque 2x2 automatique des pochettes d'albums">
            <div class="preset-mosaic-preview">🖼️</div>
            <div class="preset-cover-label">Mosaïque auto</div>
            <div class="preset-check-badge">✓</div>
        </div>
    `;

    covers.forEach(cov => {
        const isSel = (selectedCreateCoverUrl === cov.url);
        const isHidden = (category !== "all" && cov.category !== category);
        html += `
            <div class="preset-cover-card ${isSel ? 'is-selected' : ''}" data-cover-url="${escapeHtml(cov.url)}" data-cover-title="${escapeHtml(cov.title)}" data-category="${escapeHtml(cov.category)}" style="${isHidden ? 'display: none;' : ''}" title="${escapeHtml(cov.title)} (${escapeHtml(cov.category)})">
                <img src="${escapeHtml(cov.url)}" alt="${escapeHtml(cov.title)}" loading="lazy">
                <div class="preset-cover-label">${escapeHtml(cov.title)}</div>
                <div class="preset-check-badge">✓</div>
            </div>
        `;
    });

    grid.innerHTML = html;

    grid.querySelectorAll(".preset-cover-card").forEach(card => {
        card.addEventListener("click", () => {
            grid.querySelectorAll(".preset-cover-card").forEach(c => c.classList.remove("is-selected"));
            card.classList.add("is-selected");
            const rawUrl = card.getAttribute("data-cover-url");
            selectedCreateCoverUrl = rawUrl ? rawUrl : null;
            const t = card.getAttribute("data-cover-title") || "Mosaïque automatique";
            const badge = document.getElementById("selected-cover-title-badge");
            if (badge) badge.textContent = t;
        });
    });
}

async function renderSmartGenres() {
    const container = document.getElementById("smart-genres-tags");
    if (!container) return;

    const genres = await fetchLibraryGenres();
    if (!genres || genres.length === 0) {
        container.innerHTML = `<span class="text-muted" style="font-size: 0.8rem;">Aucun genre disponible.</span>`;
        return;
    }

    container.innerHTML = genres.map(g => {
        const isAct = selectedSmartGenres.has(g);
        return `<span class="smart-genre-tag ${isAct ? 'active' : ''}" data-genre="${escapeHtml(g)}">${escapeHtml(g)}</span>`;
    }).join("");

    container.querySelectorAll(".smart-genre-tag").forEach(tag => {
        tag.addEventListener("click", () => {
            const g = tag.getAttribute("data-genre");
            if (selectedSmartGenres.has(g)) {
                selectedSmartGenres.delete(g);
                tag.classList.remove("active");
            } else {
                selectedSmartGenres.add(g);
                tag.classList.add("active");
            }
            const typeSelect = document.getElementById("smart-pl-type-select");
            const nameInput = document.getElementById("smart-pl-name-input");
            if (typeSelect && (typeSelect.value === "genres" || typeSelect.value === "top_genres") && selectedSmartGenres.size > 0 && nameInput) {
                const arr = Array.from(selectedSmartGenres).slice(0, 3);
                nameInput.value = (typeSelect.value === "top_genres" ? "Top " : "Mix ") + arr.join(" + ");
            }
        });
    });
}

async function openCreatePlaylistModal() {
    if (window.isPartyLockActive) {
        if (window.PartyLock) {
            window.PartyLock.requestUnlock("Le Mode Soirée est activé : saisissez votre code PIN pour créer une playlist.", () => {
                openCreatePlaylistModal();
            });
        }
        return;
    }
    const backdrop = document.getElementById("create-playlist-modal-backdrop");
    if (!backdrop) return;

    backdrop.style.display = "flex";
    void backdrop.offsetWidth;
    backdrop.classList.add("active");

    const nameInput = document.getElementById("create-pl-name-input");
    const descInput = document.getElementById("create-pl-desc-input");
    if (nameInput) nameInput.value = "";
    if (descInput) descInput.value = "";

    const smartTypeSelect = document.getElementById("smart-pl-type-select");
    const smartNameInput = document.getElementById("smart-pl-name-input");
    const smartLimitSelect = document.getElementById("smart-pl-limit-select");
    if (smartTypeSelect) smartTypeSelect.value = "top_played";
    if (smartNameInput) smartNameInput.value = "🔥 Top Hits de ma collection";
    if (smartLimitSelect) smartLimitSelect.value = "25";
    selectedSmartGenres.clear();

    setCreatePlaylistMode("standard");
    selectedCreateCoverUrl = null;
    const badge = document.getElementById("selected-cover-title-badge");
    if (badge) badge.textContent = "Mosaïque automatique";

    // Réinitialiser les filtres de catégorie
    const catBar = document.getElementById("create-covers-category-bar");
    if (catBar) {
        catBar.querySelectorAll(".btn-cover-cat").forEach(b => {
            b.classList.toggle("active", b.getAttribute("data-cat") === "all");
        });
    }

    if (nameInput) setTimeout(() => nameInput.focus(), 60);

    await renderCreatePresetCovers("all");
    await renderSmartGenres();
    updateSmartCriteriaVisibility();
}

function closeCreatePlaylistModal() {
    const backdrop = document.getElementById("create-playlist-modal-backdrop");
    if (!backdrop) return;
    backdrop.classList.remove("active");
    setTimeout(() => {
        backdrop.style.display = "none";
    }, 180);
}

async function renderChangePresetCovers(category = "all") {
    const grid = document.getElementById("change-preset-covers-grid");
    if (!grid) return;

    const covers = await fetchPresetCovers();
    let html = `
        <div class="preset-cover-card ${selectedChangeCoverUrl === null ? 'is-selected' : ''}" data-cover-url="" data-cover-title="Mosaïque automatique" data-category="all" title="Mosaïque 2x2 automatique des pochettes d'albums">
            <div class="preset-mosaic-preview">🖼️</div>
            <div class="preset-cover-label">Mosaïque auto</div>
            <div class="preset-check-badge">✓</div>
        </div>
    `;

    covers.forEach(cov => {
        const isSel = (selectedChangeCoverUrl === cov.url);
        const isHidden = (category !== "all" && cov.category !== category);
        html += `
            <div class="preset-cover-card ${isSel ? 'is-selected' : ''}" data-cover-url="${escapeHtml(cov.url)}" data-cover-title="${escapeHtml(cov.title)}" data-category="${escapeHtml(cov.category)}" style="${isHidden ? 'display: none;' : ''}" title="${escapeHtml(cov.title)} (${escapeHtml(cov.category)})">
                <img src="${escapeHtml(cov.url)}" alt="${escapeHtml(cov.title)}" loading="lazy">
                <div class="preset-cover-label">${escapeHtml(cov.title)}</div>
                <div class="preset-check-badge">✓</div>
            </div>
        `;
    });

    grid.innerHTML = html;

    grid.querySelectorAll(".preset-cover-card").forEach(card => {
        card.addEventListener("click", () => {
            grid.querySelectorAll(".preset-cover-card").forEach(c => c.classList.remove("is-selected"));
            card.classList.add("is-selected");
            const rawUrl = card.getAttribute("data-cover-url");
            selectedChangeCoverUrl = rawUrl ? rawUrl : null;
            const t = card.getAttribute("data-cover-title") || "Mosaïque automatique";
            const statusName = document.getElementById("change-cover-selected-name");
            if (statusName) statusName.textContent = t;
        });
    });
}

async function openChangeCoverModal(playlist) {
    if (!playlist) return;
    if (window.isPartyLockActive) {
        if (window.PartyLock) {
            window.PartyLock.requestUnlock("Le Mode Soirée est activé : saisissez votre code PIN pour modifier une playlist.", () => {
                openChangeCoverModal(playlist);
            });
        }
        return;
    }
    targetChangeCoverPlaylist = playlist;
    selectedChangeCoverUrl = playlist.cover_url || null;

    const backdrop = document.getElementById("change-playlist-cover-modal-backdrop");
    const statusName = document.getElementById("change-cover-selected-name");
    if (!backdrop) return;

    backdrop.style.display = "flex";
    void backdrop.offsetWidth;
    backdrop.classList.add("active");

    if (statusName) {
        statusName.textContent = playlist.cover_url ? "Pochette personnalisée" : "Mosaïque automatique";
    }

    const catBar = document.getElementById("change-covers-category-bar");
    if (catBar) {
        catBar.querySelectorAll(".btn-cover-cat").forEach(b => {
            b.classList.toggle("active", b.getAttribute("data-cat") === "all");
        });
    }

    await renderChangePresetCovers("all");
}

function closeChangeCoverModal() {
    const backdrop = document.getElementById("change-playlist-cover-modal-backdrop");
    if (!backdrop) return;
    backdrop.classList.remove("active");
    setTimeout(() => {
        backdrop.style.display = "none";
        targetChangeCoverPlaylist = null;
    }, 180);
}

function setupUserPlaylists() {
    setupAddToPlaylistModal();
    UserPlaylists.updateBadge();

    // Bouton Créer une Playlist (Ouvre la modale complète)
    const createBtn = document.getElementById("btn-create-playlist");
    if (createBtn) createBtn.addEventListener("click", () => openCreatePlaylistModal());

    const backBtn = document.getElementById("btn-back-to-playlists");
    if (backBtn) {
        backBtn.addEventListener("click", () => {
            UserPlaylists.closeDetail();
        });
    }

    const renameBtn = document.getElementById("btn-rename-playlist");
    if (renameBtn) renameBtn.addEventListener("click", () => UserPlaylists.promptRenamePlaylist());

    // Bouton de changement de pochette dans la vue détail
    const changeCoverBtn = document.getElementById("btn-change-playlist-cover");
    if (changeCoverBtn) {
        changeCoverBtn.addEventListener("click", () => {
            if (UserPlaylists.currentDetailPlaylist) {
                openChangeCoverModal(UserPlaylists.currentDetailPlaylist);
            }
        });
    }

    const heroCoverImg = document.getElementById("playlist-hero-cover");
    if (heroCoverImg) {
        heroCoverImg.style.cursor = "pointer";
        heroCoverImg.title = "Cliquer pour changer l'illustration";
        heroCoverImg.addEventListener("click", () => {
            if (UserPlaylists.currentDetailPlaylist) {
                openChangeCoverModal(UserPlaylists.currentDetailPlaylist);
            }
        });
    }

    const playBtn = document.getElementById("btn-play-playlist");
    if (playBtn) {
        playBtn.addEventListener("click", () => {
            if (UserPlaylists.currentDetailPlaylist && window.AudioPlayer) {
                window.AudioPlayer.playUserPlaylist(UserPlaylists.currentDetailPlaylist, 0, false);
            }
        });
    }

    const shuffleBtn = document.getElementById("btn-shuffle-playlist");
    if (shuffleBtn) {
        shuffleBtn.addEventListener("click", () => {
            if (UserPlaylists.currentDetailPlaylist && window.AudioPlayer) {
                window.AudioPlayer.playUserPlaylist(UserPlaylists.currentDetailPlaylist, 0, true);
            }
        });
    }

    const deleteBtn = document.getElementById("btn-delete-playlist");
    if (deleteBtn) deleteBtn.addEventListener("click", () => UserPlaylists.deleteActivePlaylist());

    const refreshSmartBtn = document.getElementById("btn-refresh-smart-playlist");
    if (refreshSmartBtn) {
        refreshSmartBtn.addEventListener("click", async () => {
            if (!UserPlaylists.currentDetailPlaylist) return;
            const pl = UserPlaylists.currentDetailPlaylist;
            refreshSmartBtn.disabled = true;
            const prevHtml = refreshSmartBtn.innerHTML;
            refreshSmartBtn.innerHTML = `<span class="spinner" style="display:inline-block;width:12px;height:12px;margin-right:4px;"></span> Actualisation...`;
            try {
                const res = await fetch(`/api/playlists/${pl.id}/refresh`, { method: "POST" });
                const data = await res.json();
                if (data.success && data.playlist) {
                    UserPlaylists.currentDetailPlaylist = data.playlist;
                    UserPlaylists.renderDetail(data.playlist);
                    showToast("Playlist intelligente actualisée avec succès selon vos écoutes !", "success");
                } else {
                    showToast(data.message || "Erreur lors de l'actualisation", "warning");
                }
            } catch (e) {
                showToast("Erreur réseau : " + e.message, "danger");
            } finally {
                refreshSmartBtn.disabled = false;
                refreshSmartBtn.innerHTML = prevHtml;
            }
        });
    }


    // --- Écouteurs de la Modale de Création ---
    const closeCreateBtn = document.getElementById("close-create-playlist-btn");
    const cancelCreateBtn = document.getElementById("cancel-create-playlist-btn");
    const createBackdrop = document.getElementById("create-playlist-modal-backdrop");
    const btnModeStd = document.getElementById("btn-mode-standard");
    const btnModeSmart = document.getElementById("btn-mode-smart");
    const smartTypeSelect = document.getElementById("smart-pl-type-select");
    const smartDecadeSelect = document.getElementById("smart-decade-select");
    const submitCreateBtn = document.getElementById("submit-create-playlist-btn");

    if (closeCreateBtn) closeCreateBtn.addEventListener("click", closeCreatePlaylistModal);
    if (cancelCreateBtn) cancelCreateBtn.addEventListener("click", closeCreatePlaylistModal);
    if (createBackdrop) {
        createBackdrop.addEventListener("click", (e) => {
            if (e.target === createBackdrop) closeCreatePlaylistModal();
        });
    }

    if (btnModeStd) btnModeStd.addEventListener("click", () => setCreatePlaylistMode("standard"));
    if (btnModeSmart) btnModeSmart.addEventListener("click", () => setCreatePlaylistMode("smart"));

    if (smartTypeSelect) {
        smartTypeSelect.addEventListener("change", () => updateSmartCriteriaVisibility());
    }

    if (smartDecadeSelect) {
        smartDecadeSelect.addEventListener("change", () => {
            const nameInput = document.getElementById("smart-pl-name-input");
            if (nameInput && smartTypeSelect?.value === "decade") {
                nameInput.value = `⏳ Voyage Années ${smartDecadeSelect.value}s`;
            }
        });
    }

    // Filtres catégories de pochettes (Création)
    const createCatBar = document.getElementById("create-covers-category-bar");
    if (createCatBar) {
        createCatBar.querySelectorAll(".btn-cover-cat").forEach(btn => {
            btn.addEventListener("click", () => {
                createCatBar.querySelectorAll(".btn-cover-cat").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                const cat = btn.getAttribute("data-cat");
                const grid = document.getElementById("create-preset-covers-grid");
                if (grid) {
                    grid.querySelectorAll(".preset-cover-card").forEach(card => {
                        const cCat = card.getAttribute("data-category");
                        card.style.display = (cat === "all" || cCat === "all" || cCat === cat) ? "" : "none";
                    });
                }
            });
        });
    }

    // Soumission de la création
    if (submitCreateBtn) {
        submitCreateBtn.addEventListener("click", async () => {
            submitCreateBtn.disabled = true;
            try {
                if (selectedCreateMode === "standard") {
                    const nameInput = document.getElementById("create-pl-name-input");
                    const descInput = document.getElementById("create-pl-desc-input");
                    const name = nameInput ? nameInput.value.trim() : "";
                    if (!name) {
                        showToast("Veuillez saisir un nom pour la playlist.", "warning");
                        nameInput?.focus();
                        return;
                    }
                    const res = await fetch("/api/playlists", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            name: name,
                            description: descInput ? descInput.value.trim() : "",
                            cover_url: selectedCreateCoverUrl
                        })
                    });
                    const data = await res.json();
                    if (data.success || data.id) {
                        showToast(`Playlist « ${name} » créée avec succès !`, "success");
                        closeCreatePlaylistModal();
                        await UserPlaylists.loadAndRenderPlaylists(true);
                    } else {
                        showToast(data.message || "Erreur création playlist", "danger");
                    }
                } else {
                    // Mode Smart Playlist
                    const smartNameInput = document.getElementById("smart-pl-name-input");
                    const smartType = smartTypeSelect ? smartTypeSelect.value : "top_played";
                    const smartLimitSelect = document.getElementById("smart-pl-limit-select");
                    const limit = smartLimitSelect ? parseInt(smartLimitSelect.value, 10) : 25;
                    const name = smartNameInput ? smartNameInput.value.trim() : "Playlist Intelligente";

                    const criteria = {
                        limit: limit,
                        genres: Array.from(selectedSmartGenres),
                        decade: smartDecadeSelect ? parseInt(smartDecadeSelect.value, 10) : 1980
                    };

                    const res = await fetch("/api/playlists/smart-generate", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            name: name,
                            smart_type: smartType,
                            criteria: criteria,
                            cover_url: selectedCreateCoverUrl
                        })
                    });
                    const data = await res.json();
                    if (data.success || data.playlist) {
                        const pl = data.playlist || data;
                        showToast(`⚡ Playlist intelligente « ${pl.name || name} » générée (${pl.track_count || pl.items_count || 0} titres) !`, "success");
                        closeCreatePlaylistModal();
                        await UserPlaylists.loadAndRenderPlaylists(true);
                    } else {
                        showToast(data.message || "Erreur génération intelligente", "danger");
                    }
                }
            } catch (err) {
                showToast("Erreur : " + err.message, "danger");
            } finally {
                submitCreateBtn.disabled = false;
            }
        });
    }

    // --- Écouteurs de la Modale de Changement de Pochette ---
    const closeChangeBtn = document.getElementById("close-change-cover-btn");
    const cancelChangeBtn = document.getElementById("cancel-change-cover-btn");
    const changeBackdrop = document.getElementById("change-playlist-cover-modal-backdrop");
    const restoreMosaicBtn = document.getElementById("btn-cover-restore-mosaic");
    const submitChangeCoverBtn = document.getElementById("submit-change-cover-btn");

    if (closeChangeBtn) closeChangeBtn.addEventListener("click", closeChangeCoverModal);
    if (cancelChangeBtn) cancelChangeBtn.addEventListener("click", closeChangeCoverModal);
    if (changeBackdrop) {
        changeBackdrop.addEventListener("click", (e) => {
            if (e.target === changeBackdrop) closeChangeCoverModal();
        });
    }

    // Filtres catégories de pochettes (Changement)
    const changeCatBar = document.getElementById("change-covers-category-bar");
    if (changeCatBar) {
        changeCatBar.querySelectorAll(".btn-cover-cat").forEach(btn => {
            btn.addEventListener("click", () => {
                changeCatBar.querySelectorAll(".btn-cover-cat").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                const cat = btn.getAttribute("data-cat");
                const grid = document.getElementById("change-preset-covers-grid");
                if (grid) {
                    grid.querySelectorAll(".preset-cover-card").forEach(card => {
                        const cCat = card.getAttribute("data-category");
                        card.style.display = (cat === "all" || cCat === "all" || cCat === cat) ? "" : "none";
                    });
                }
            });
        });
    }

    if (restoreMosaicBtn) {
        restoreMosaicBtn.addEventListener("click", () => {
            selectedChangeCoverUrl = null;
            const grid = document.getElementById("change-preset-covers-grid");
            if (grid) {
                grid.querySelectorAll(".preset-cover-card").forEach(c => c.classList.remove("is-selected"));
                grid.querySelector('.preset-cover-card[data-cover-url=""]')?.classList.add("is-selected");
            }
            const statusName = document.getElementById("change-cover-selected-name");
            if (statusName) statusName.textContent = "Mosaïque automatique";
        });
    }

    if (submitChangeCoverBtn) {
        submitChangeCoverBtn.addEventListener("click", async () => {
            if (!targetChangeCoverPlaylist) return;
            submitChangeCoverBtn.disabled = true;
            try {
                const res = await fetch(`/api/playlists/${targetChangeCoverPlaylist.id}/cover`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ cover_url: selectedChangeCoverUrl })
                });
                const data = await res.json();
                if (data.success) {
                    targetChangeCoverPlaylist.cover_url = selectedChangeCoverUrl;
                    const heroCover = document.getElementById("playlist-hero-cover");
                    if (heroCover) {
                        heroCover.src = selectedChangeCoverUrl || (targetChangeCoverPlaylist.items && (targetChangeCoverPlaylist.items[0]?.thumbnail_url || targetChangeCoverPlaylist.items[0]?.cover_url)) || "/static/placeholder-cover.svg";
                    }
                    showToast("Illustration de la playlist mise à jour !", "success");
                    closeChangeCoverModal();
                    await UserPlaylists.loadAndRenderPlaylists(true);
                } else {
                    showToast(data.message || "Erreur mise à jour illustration", "danger");
                }
            } catch (err) {
                showToast("Erreur : " + err.message, "danger");
            } finally {
                submitChangeCoverBtn.disabled = false;
            }
        });
    }
}


window.UserPlaylists = UserPlaylists;
window.openAddToPlaylistModal = openAddToPlaylistModal;
window.setupUserPlaylists = setupUserPlaylists;

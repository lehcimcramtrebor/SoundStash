/**
 * SoundStash Core - WebSocket & Gestion des Tâches Asynchrones
 * Communication temps réel avec le backend FastAPI, logs de téléchargement, file d'attente et synchronisation.
 */

// ===================================================
// Variables d'état WebSocket & Tâches
// ===================================================
let ws = null;
let wsReconnectAttempts = 0;
let _lastSyncTriggerTime = 0;
let _isSyncTriggering = false;

window.currentTaskIsPlaylist = false;
window.currentTaskIsSingle = false;

// ===================================================
// Indicateurs d'état dans les onglets de l'Atelier
// ===================================================
function setDownloadTabWorking(isWorking) {
    const dlTab = document.getElementById("nav-tab-download") || document.querySelector('.nav-tab[data-tab="tab-download"]');
    const indicator = document.getElementById("download-work-indicator");
    if (!dlTab) return;
    if (isWorking) {
        dlTab.classList.add("is-working");
        if (indicator) indicator.style.display = "inline-block";
    } else {
        dlTab.classList.remove("is-working");
        if (indicator) indicator.style.display = "none";
    }
}
window.setDownloadTabWorking = setDownloadTabWorking;

function updateTempTabBadge(count) {
    const badge = document.getElementById("temp-count-badge");
    if (!badge) return;
    if (count > 0) {
        badge.textContent = count;
        badge.style.display = "inline-flex";
        badge.title = `${count} élément(s) en attente dans le dossier temporaire`;
    } else {
        badge.style.display = "none";
    }
}
window.updateTempTabBadge = updateTempTabBadge;

// ===================================================
// Connexion & Cycle de Vie WebSocket
// ===================================================
function setupWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/logs`;
    
    ws = new WebSocket(wsUrl);
    window.ws = ws;

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleWsEvent(data);
        } catch (e) {
            console.error("Erreur message WS:", e);
        }
    };

    ws.onopen = () => {
        wsReconnectAttempts = 0;
        const queueUrl = window.YTM_API_HOST ? `http://${window.YTM_API_HOST}/api/queue` : "/api/queue";
        fetch(queueUrl)
            .then(r => r.json())
            .then(data => {
                if (data) {
                    window.currentDownloadQueue = data.queue || [];
                    window.currentDownloadingItem = data.current || null;
                    if (typeof AudioPlayer !== "undefined" && typeof AudioPlayer.updateOnlineDownloadButtons === "function") {
                        AudioPlayer.updateOnlineDownloadButtons();
                    }
                }
                if (data && !data.is_downloading) {
                    const startBtn = document.getElementById("start-download-btn");
                    const cancelBtn = document.getElementById("cancel-download-btn");
                    if (startBtn) {
                        startBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> Lancer le Téléchargement`;
                        startBtn.className = "btn btn-primary btn-large";
                        startBtn.disabled = false;
                    }
                    if (cancelBtn) cancelBtn.style.display = "none";
                }
            }).catch(() => {});
    };

    ws.onclose = () => {
        wsReconnectAttempts++;
        const delay = Math.min(2000 * Math.pow(2, wsReconnectAttempts), 30000);
        setTimeout(setupWebSocket, delay);
    };

    ws.onerror = (err) => {
        console.warn("[WS] Erreur WebSocket", err);
    };
}
window.setupWebSocket = setupWebSocket;

let badgeResetTimer = null;
function scheduleBadgeReset(delay = 5000) {
    if (badgeResetTimer) {
        clearTimeout(badgeResetTimer);
        badgeResetTimer = null;
    }
    badgeResetTimer = setTimeout(() => {
        const badge = document.getElementById("global-status-badge");
        if (badge && (badge.classList.contains("badge-finished") || badge.textContent === "File Terminée" || badge.textContent === "Prêt à Exporter")) {
            badge.className = "badge badge-idle";
            badge.textContent = "Atelier";
            badge.title = "Ouvrir / Replier l'Atelier (Raccourci: Maj+W)";
        }
    }, delay);
}

// ===================================================
// Réception & Dispatch des Événements WebSocket
// ===================================================
function handleWsEvent(data) {
    if (data.type === "covers_restore_progress" || data.type === "covers_restore_completed") {
        window.dispatchEvent(new CustomEvent("covers_restore_event", { detail: data }));
        return;
    }

    if (data.type === "sync_status") {
        if (typeof updateSyncWatchIndicator === "function") {
            updateSyncWatchIndicator(data.active, data.task, data.title, data.detail);
        }
        return;
    }

    if (data.type === "sync_event") {
        if (typeof showSyncToast === "function") {
            showSyncToast(data.message, data.color || "orange", data.detail || "", data.color === "green" ? 4000 : 5000);
        }
        if (data.color === "green") {
            if (typeof AudioPlayer !== "undefined" && AudioPlayer.loadLibraryData) {
                AudioPlayer.loadLibraryData(true);
            }
            if (typeof loadLibrary === "function") {
                loadLibrary();
            }
            if (typeof refreshAlbumNavList === "function") {
                refreshAlbumNavList();
            }
            if (typeof window.refreshSearchBadges === "function") {
                window.refreshSearchBadges();
            }
        }
        return;
    }

    if (data.type === "library_updated") {
        if (typeof AudioPlayer !== "undefined" && AudioPlayer.loadLibraryData) {
            AudioPlayer.loadLibraryData(true);
        }
        if (typeof loadLibrary === "function") {
            loadLibrary();
        }
        if (typeof refreshAlbumNavList === "function") {
            refreshAlbumNavList();
        }
        if (typeof window.refreshSearchBadges === "function") {
            window.refreshSearchBadges();
        }
        if (typeof UserPlaylists !== "undefined") {
            UserPlaylists.playlistCache.clear();
            if (UserPlaylists.isDetailOpen && UserPlaylists.currentDetailPlaylist) {
                UserPlaylists.openDetail(UserPlaylists.currentDetailPlaylist.id);
            } else {
                UserPlaylists.loadAndRenderPlaylists(true);
            }
        }
        if (typeof loadCollectionAlbumsForEditor === "function") {
            loadCollectionAlbumsForEditor();
        }
        if (typeof window.loadGenreBatchAlbums === "function") {
            window.loadGenreBatchAlbums(true);
        }
        if (typeof window.loadCoversGalleryAlbums === "function") {
            window.loadCoversGalleryAlbums(true);
        }
        if (typeof ensureLibraryTagSuggestions === "function") {
            ensureLibraryTagSuggestions(true);
        }
        if (typeof loadExternalTempAlbums === "function") {
            loadExternalTempAlbums();
        }
        if (typeof updateTempTabBadge === "function") {
            updateTempTabBadge();
        }
        return;
    }

    const badge = document.getElementById("global-status-badge");
    const startBtn = document.getElementById("start-download-btn");
    const cancelBtn = document.getElementById("cancel-download-btn");

    if (data.type === "queue_update") {
        window.currentDownloadQueue = data.queue || [];
        window.currentDownloadingItem = data.current || null;
        renderQueue(data.queue, data.current, data.is_downloading);
        const isWorking = Boolean(data.is_downloading || (data.queue && data.queue.length > 0));
        setDownloadTabWorking(isWorking);
        if (typeof window.refreshSearchBadges === "function") window.refreshSearchBadges();
        if (typeof AudioPlayer !== "undefined" && typeof AudioPlayer.updateOnlineDownloadButtons === "function") {
            AudioPlayer.updateOnlineDownloadButtons();
        }

        if (data.is_downloading || (data.queue && data.queue.length > 0)) {
            if (badgeResetTimer) {
                clearTimeout(badgeResetTimer);
                badgeResetTimer = null;
            }
            startBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg> Ajouter à la file d'attente`;
            startBtn.className = "btn btn-success btn-large";
            startBtn.disabled = false;
            cancelBtn.style.display = "inline-flex";
            cancelBtn.textContent = "Annuler en cours";
        } else {
            startBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> Lancer le Téléchargement`;
            startBtn.className = "btn btn-primary btn-large";
            startBtn.disabled = false;
            cancelBtn.style.display = "none";
            if (badge && (badge.classList.contains("badge-downloading") || badge.classList.contains("badge-tagging"))) {
                badge.className = "badge badge-idle";
                badge.textContent = "Atelier";
                badge.title = "Ouvrir / Replier l'Atelier (Raccourci: Maj+W)";
            }
        }
    } else if (data.type === "status") {
        const status = data.status;
        const msg = data.message || "";

        if (status === "started") {
            if (badgeResetTimer) {
                clearTimeout(badgeResetTimer);
                badgeResetTimer = null;
            }
            setDownloadTabWorking(true);
            if (typeof window.refreshSearchBadges === "function") window.refreshSearchBadges();
            badge.className = "badge badge-downloading";
            badge.textContent = "Téléchargement";
            badge.title = "Téléchargement en cours — Cliquer pour voir les détails (Onglet Téléchargement)";
            document.getElementById("progress-title").textContent = "Téléchargement en cours...";
            document.getElementById("progress-subtitle").textContent = msg;
            startBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg> Ajouter à la file d'attente`;
            startBtn.className = "btn btn-success btn-large";
            startBtn.style.display = "inline-flex";
            startBtn.disabled = false;
            cancelBtn.style.display = "inline-flex";
            cancelBtn.textContent = "Annuler en cours";
            document.getElementById("progress-container").style.display = "block";

            // Détection du type de tâche en cours
            window.currentTaskIsPlaylist = !!data.is_playlist || (typeof isPlaylistUrlOrItem === "function" ? isPlaylistUrlOrItem(null, data.url) : false);
            window.currentTaskIsSingle = !!data.is_single;

            const itemCountEl = document.getElementById("progress-item-count");
            if (itemCountEl) {
                if (window.currentTaskIsPlaylist) {
                    itemCountEl.textContent = "Playlist";
                } else if (window.currentTaskIsSingle) {
                    itemCountEl.textContent = "Titre unique";
                } else {
                    itemCountEl.textContent = "Piste -- / --";
                }
            }
        } else if (status === "tagging") {
            if (badgeResetTimer) {
                clearTimeout(badgeResetTimer);
                badgeResetTimer = null;
            }
            setDownloadTabWorking(true);
            badge.className = "badge badge-tagging";
            badge.textContent = "Retaggage Kid3";
            document.getElementById("progress-title").textContent = "Uniformisation des Tags...";
            document.getElementById("progress-subtitle").textContent = msg;
        } else if (status === "finished") {
            const remaining = data.remaining_in_queue || 0;
            if (typeof loadLibrary === "function") loadLibrary();
            if (typeof window.refreshSearchBadges === "function") window.refreshSearchBadges();

            const isBusy = (typeof isReconstituteModalOpen === "function" ? isReconstituteModalOpen() : (window.isReconstituteModalOpen ? window.isReconstituteModalOpen() : false));

            // Ne pas écraser l'album affiché dans l'éditeur si l'utilisateur est en pleine reconstitution
            if (data.album && data.album.album_dir && !isBusy) {
                if (typeof loadAlbumInEditor === "function") loadAlbumInEditor(data.album.album_dir);
                if (typeof refreshAlbumNavList === "function") refreshAlbumNavList();
            } else {
                if (typeof refreshAlbumNavList === "function") refreshAlbumNavList();
            }

            if (remaining > 0) {
                setDownloadTabWorking(true);
                badge.className = "badge badge-downloading";
                badge.textContent = `File (${remaining})`;
                document.getElementById("progress-title").textContent = "Album terminé ! Enchaînement du suivant...";
                document.getElementById("progress-subtitle").textContent = `${remaining} album(s) restant(s) dans la file d'attente.`;
                document.getElementById("progress-fill").style.width = "100%";
                document.getElementById("progress-percentage").textContent = "100%";
            } else {
                setDownloadTabWorking(false);
                badge.className = "badge badge-finished";
                badge.textContent = "Prêt à Exporter";
                badge.title = "Téléchargement terminé — Cliquer pour accéder à l'onglet Téléchargement";
                document.getElementById("progress-title").textContent = "Téléchargement & uniformisation terminés !";
                document.getElementById("progress-subtitle").textContent = msg;
                startBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> Lancer le Téléchargement`;
                startBtn.className = "btn btn-primary btn-large";
                startBtn.disabled = false;
                cancelBtn.style.display = "none";
                document.getElementById("progress-fill").style.width = "100%";
                document.getElementById("progress-percentage").textContent = "100%";
                scheduleBadgeReset(5000);
            }

            // Gestion de détection de pistes manquantes (Approche A + B via pendingMissingAlbumsQueue)
            const warning = data.warning || (data.album && data.album.warning);
            const albumDir = data.album ? data.album.album_dir : null;
            const albumName = (data.album ? data.album.album_name : null) || "Album";

            if (warning && albumDir) {
                if (typeof enqueuePendingMissingAlbum === "function") {
                    enqueuePendingMissingAlbum(albumDir, albumName, warning);
                } else if (typeof window.enqueuePendingMissingAlbum === "function") {
                    window.enqueuePendingMissingAlbum(albumDir, albumName, warning);
                }
            } else if (!isBusy && data.album && data.album.album_dir && remaining === 0) {
                if (typeof showToast === "function") {
                    showToast(`✓ "${albumName}" téléchargé avec succès !`, "success");
                }
            }
            if (typeof loadExternalTempAlbums === "function") loadExternalTempAlbums();
            if (typeof refreshAlbumNavList === "function") refreshAlbumNavList();
            if (typeof updateTempTabBadge === "function") updateTempTabBadge();
        } else if (status === "queue_completed") {
            setDownloadTabWorking(false);
            if (typeof loadLibrary === "function") loadLibrary();
            if (typeof refreshAlbumNavList === "function") refreshAlbumNavList();
            if (typeof loadExternalTempAlbums === "function") loadExternalTempAlbums();
            if (typeof updateTempTabBadge === "function") updateTempTabBadge();
            if (typeof window.refreshSearchBadges === "function") window.refreshSearchBadges();
            if (typeof AudioPlayer !== "undefined" && typeof AudioPlayer.updateOnlineDownloadButtons === "function") {
                AudioPlayer.updateOnlineDownloadButtons();
            }
            badge.className = "badge badge-finished";
            badge.textContent = "File Terminée";
            document.getElementById("progress-title").textContent = "Tous les téléchargements sont terminés !";
            document.getElementById("progress-subtitle").textContent = msg;
            startBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> Lancer le Téléchargement`;
            startBtn.className = "btn btn-primary btn-large";
            startBtn.disabled = false;
            cancelBtn.style.display = "none";
            scheduleBadgeReset(5000);
        } else if (status === "error") {
            const remaining = data.remaining_in_queue || 0;
            const reason = data.reason;
            const albumTitle = data.album_title ? ` « ${data.album_title} »` : "";

            if (typeof window.refreshSearchBadges === "function") window.refreshSearchBadges();

            if (reason === "cookies_expired") {
                const searchBadge = document.getElementById("search-session-status-badge");
                if (searchBadge) {
                    searchBadge.className = "badge badge-warning";
                    searchBadge.style.background = "rgba(245, 158, 11, 0.20)";
                    searchBadge.style.color = "#f59e0b";
                    searchBadge.style.borderColor = "rgba(245, 158, 11, 0.5)";
                    searchBadge.innerHTML = `
                        <span class="session-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; display: inline-block; box-shadow: 0 0 8px #f59e0b;"></span>
                        <span class="session-text" style="font-weight: 700;">⚠️ Session expirée</span>
                    `;
                    searchBadge.title = "Session YouTube expirée ou mot de passe modifié. Cliquez pour importer votre nouveau cookies.txt";
                }
                if (typeof showModalAlert === "function") {
                    showModalAlert(
                        "Session YouTube Expirée (Cookies révoqués)",
                        `Le téléchargement de${albumTitle} a été rejeté par YouTube car votre session (cookies.txt) a expiré ou le mot de passe de votre compte a été modifié.\n\n👉 Rendez-vous dans les Paramètres (icône ⚙️) > Section Cookies pour importer votre nouveau fichier cookies.txt en 1 clic.`,
                        "warning"
                    );
                }
                if (typeof showToast === "function") {
                    showToast(`⚠️ Session YouTube expirée : veuillez réimporter votre cookies.txt`, "warning");
                }
            } else if (reason === "bot_detected") {
                if (typeof showModalAlert === "function") {
                    showModalAlert(
                        "Protection Anti-Bot YouTube Détectée",
                        `Le téléchargement de${albumTitle} a été bloqué par YouTube (défi anti-bot / trop de requêtes consécutives).\n\n💡 Conseil : Patientez 5 à 10 minutes avant de relancer un téléchargement afin que YouTube lève automatiquement la restriction temporaire sur votre adresse IP.`,
                        "warning"
                    );
                }
                if (typeof showToast === "function") {
                    showToast(`🤖 Blocage anti-bot YouTube : patientez quelques minutes avant de relancer`, "warning");
                }
            } else if (typeof showToast === "function") {
                showToast(`⚠️ Échec du téléchargement : ${msg || "Erreur de récupération"}`, "danger");
            }

            if (remaining === 0) {
                setDownloadTabWorking(false);
                if (typeof loadLibrary === "function") loadLibrary();
                badge.className = "badge badge-idle";
                badge.textContent = reason === "bot_detected" ? "Anti-Bot" : "Erreur";
                badge.title = reason === "bot_detected" ? "Téléchargement bloqué par la protection anti-bot YouTube" : "Erreur lors de l'opération";
                document.getElementById("progress-title").textContent = reason === "bot_detected" ? "Téléchargement bloqué par YouTube (Anti-Bot)" : "Erreur lors de l'opération";
                document.getElementById("progress-subtitle").textContent = msg;
                startBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> Lancer le Téléchargement`;
                startBtn.className = "btn btn-primary btn-large";
                startBtn.disabled = false;
                cancelBtn.style.display = "none";
            }
        }
    } else if (data.type === "log") {
        appendLogLine(data.text);
        if (data.progress) {
            updateProgress(data.progress);
        }
    } else if (data.type === "tag_result") {
        appendLogLine(`[Kid3] Uniformisation terminée pour ${data.tracks ? data.tracks.length : 0} pistes.`);
    } else if (data.type === "cover_extraction_progress") {
        if (data.extracted % 5 === 0 || data.extracted === data.total) {
            if (typeof showToast === "function") {
                showToast(`🖼️ Normalisation des jaquettes : ${data.extracted} / ${data.total} (${data.album || ''})...`, "info");
            }
        }
    } else if (data.type === "cover_extraction_completed") {
        if (data.extracted_count > 0) {
            if (typeof showToast === "function") {
                showToast(`✓ Normalisation terminée : ${data.extracted_count} jaquette(s) extraite(s) avec succès !`, "success");
            }
            // Rafraîchir les images des pochettes affichées
            document.querySelectorAll(".player-card-thumb, .player-cover-box img, .mini-dock-thumb").forEach(img => {
                const src = img.src;
                if (src && src.includes("/api/audio/cover")) {
                    const clean = src.split("&t=")[0].split("?t=")[0];
                    img.src = `${clean}${clean.includes("?") ? "&" : "?"}t=${Date.now()}`;
                }
            });
        }
        if (window.AudioPlayer) {
            window.AudioPlayer.isExtractingCovers = false;
        }
    }
}
window.handleWsEvent = handleWsEvent;

// ===================================================
// Rendu de la file d'attente de téléchargement
// ===================================================
function renderQueue(queue = [], current = null, isDownloading = false) {
    const container = document.getElementById("queue-container");
    const badgeCount = document.getElementById("queue-badge-count");
    const list = document.getElementById("queue-items-list");
    if (!container || !list) return;

    const totalQueued = queue.length;
    if (badgeCount) badgeCount.textContent = totalQueued;

    if (totalQueued === 0) {
        container.style.display = "none";
        list.innerHTML = "";
        return;
    }

    container.style.display = "block";
    list.innerHTML = "";

    const esc = typeof escapeHtml === "function" ? escapeHtml : (window.escapeHtml || (s => s));

    queue.forEach((item, idx) => {
        const div = document.createElement("div");
        div.className = "queue-item";
        div.innerHTML = `
            <div class="queue-item-info">
                <span class="queue-item-badge">#${idx + 1}</span>
                <span class="queue-item-url" title="${esc(item.url)}">${esc(item.url)}</span>
            </div>
            <div class="queue-item-actions">
                <span class="text-muted" style="font-size: 0.75rem;">${item.format ? item.format.toUpperCase() : "M4A"} · ${item.quality || "128K"}</span>
                <button type="button" class="btn-remove-queue" data-id="${esc(item.id)}" title="Retirer de la file">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
            </div>
        `;
        div.querySelector(".btn-remove-queue").addEventListener("click", async () => {
            await fetch(`/api/queue/${item.id}`, { method: "DELETE" });
        });
        list.appendChild(div);
    });
}
window.renderQueue = renderQueue;

// ===================================================
// Affichage des journaux d'exécution
// ===================================================
function appendLogLine(text) {
    const consoleBody = document.getElementById("console-output");
    if (!consoleBody) return;
    const line = document.createElement("div");
    line.className = "log-line";

    if (text.includes("[download]") || text.includes("[ExtractAudio]")) {
        line.classList.add("log-info");
    } else if (text.includes("ERROR") || text.includes("Erreur") || text.includes("WARNING")) {
        line.classList.add(text.includes("ERROR") ? "log-error" : "log-warn");
    } else if (text.includes("Kid3") || text.includes("Succès") || text.includes("SoundStash")) {
        line.classList.add("log-success");
    }

    line.textContent = text;
    consoleBody.appendChild(line);
    consoleBody.scrollTop = consoleBody.scrollHeight;
}
window.appendLogLine = appendLogLine;

// ===================================================
// Progression de téléchargement
// ===================================================
function updateProgress(p) {
    if (p.percent !== undefined) {
        const fillEl = document.getElementById("progress-fill");
        const pctEl = document.getElementById("progress-percentage");
        if (fillEl) fillEl.style.width = `${p.percent}%`;
        if (pctEl) pctEl.textContent = `${p.percent.toFixed(1)}%`;
    }
    if (p.speed) {
        const speedEl = document.getElementById("progress-speed");
        if (speedEl) speedEl.textContent = p.speed;
    }
    if (p.eta) {
        const etaEl = document.getElementById("progress-eta");
        if (etaEl) etaEl.textContent = `ETA: ${p.eta}`;
    }
    const itemCountEl = document.getElementById("progress-item-count");
    if (itemCountEl) {
        if (p.item_current && p.item_total) {
            if (window.currentTaskIsPlaylist) {
                itemCountEl.textContent = `Playlist (${p.item_current} / ${p.item_total})`;
            } else {
                itemCountEl.textContent = `Piste ${p.item_current} / ${p.item_total}`;
            }
        } else if (window.currentTaskIsPlaylist && (itemCountEl.textContent === "Piste -- / --" || itemCountEl.textContent === "")) {
            itemCountEl.textContent = "Playlist";
        }
    }
}
window.updateProgress = updateProgress;

// ===================================================
// Synchronisation de la bibliothèque musicale
// ===================================================
async function triggerLibrarySync(forced = false) {
    const now = Date.now();
    if (!forced && (now - _lastSyncTriggerTime < 60000 || _isSyncTriggering)) {
        return;
    }
    _lastSyncTriggerTime = now;
    _isSyncTriggering = true;

    try {
        const res = await fetch("/api/library/synchronize?is_automatic=true", { method: "POST" });
        if (res.ok) {
            const data = await res.json();
            if (data && data.actions_count > 0) {
                if (typeof AudioPlayer !== "undefined" && AudioPlayer.loadLibraryData) {
                    AudioPlayer.loadLibraryData();
                }
                if (typeof loadLibrary === "function") {
                    loadLibrary();
                }
            }
        }
    } catch (e) {
        console.debug("[LibrarySync] Synchronisation en arrière-plan :", e);
    } finally {
        _isSyncTriggering = false;
    }
}
window.triggerLibrarySync = triggerLibrarySync;

// =========================================================
// Indicateur Horloger Tournant de Synchronisation (Bezel Watch)
// =========================================================
let syncWatchTimeout = null;

function updateSyncWatchIndicator(active, task, title, detail) {
    const indicator = document.getElementById("sync-watch-indicator");
    const dial = document.getElementById("sync-watch-dial");
    const popTitle = document.getElementById("sync-popover-title");
    const popTask = document.getElementById("sync-popover-task");
    const popDetail = document.getElementById("sync-popover-detail");
    if (!indicator) return;

    if (syncWatchTimeout) {
        clearTimeout(syncWatchTimeout);
        syncWatchTimeout = null;
    }

    if (active) {
        indicator.style.display = "inline-flex";
        if (dial) dial.classList.add("spinning");
        if (popTitle) popTitle.textContent = title || "Synchronisation active";
        if (popTask) {
            popTask.textContent = task === "music_sync" ? "Collection Musique" : (task === "video_sync" ? "Hub Vidéos" : (task || "Traitement d'arrière-plan"));
        }
        if (popDetail) popDetail.textContent = detail || "Analyse & auto-organisation en cours...";
    } else {
        if (dial) dial.classList.remove("spinning");
        if (popDetail) popDetail.textContent = detail || "Synchronisation terminée.";
        syncWatchTimeout = setTimeout(() => {
            if (dial && !dial.classList.contains("spinning")) {
                indicator.style.display = "none";
            }
        }, 1200);
    }
}
window.updateSyncWatchIndicator = updateSyncWatchIndicator;

async function checkSyncWatchStatus() {
    try {
        const res = await fetch("/api/system/busy-status");
        if (res.ok) {
            const data = await res.json();
            if (data.is_library_syncing) {
                updateSyncWatchIndicator(true, "music_sync", "Collection Musique", "Synchronisation de la bibliothèque musicale en cours...");
            } else if (data.is_video_syncing) {
                updateSyncWatchIndicator(true, "video_sync", "Hub Vidéos", "Synchronisation de la vidéothèque en cours...");
            }
        }
    } catch (e) {
        // Ignorer silencieusement
    }
}
window.checkSyncWatchStatus = checkSyncWatchStatus;

function setupSyncWatchIndicator() {
    checkSyncWatchStatus();
    setInterval(checkSyncWatchStatus, 15000);
}
window.setupSyncWatchIndicator = setupSyncWatchIndicator;


/**
 * SoundStash Core - Fonctions Utilitaires & Navigation Système
 * Échappement HTML, formatage, détection d'URLs, proxies de jaquette et navigation souris.
 */

// ===================================================
// Gestion de la navigation Souris Précédent / Suivant (Boutons 3 et 4)
// Bouton 3 (X1 / Précédent) : Dédié exclusivement au retour de l'album en cours vers la collection
// Bouton 4 (X2 / Suivant) : Neutralisé
// ===================================================
let lastBackNavigationTime = 0;

function triggerBackNavigation() {
    const now = Date.now();
    if (now - lastBackNavigationTime < 250) return false; // Anti-rebond
    lastBackNavigationTime = now;

    // 0a. Si le tiroir Atelier est ouvert : le replier en priorité vers le lecteur
    if (typeof isWorkshopDrawerOpen !== "undefined" && isWorkshopDrawerOpen && typeof closeWorkshopDrawer === "function") {
        if (typeof isReconstituteModalOpen === "function" && isReconstituteModalOpen()) return false;
        if (typeof isCustomModalOpen === "function" && isCustomModalOpen()) return false;
        const gapModal = document.getElementById("gap-modal-backdrop");
        if (gapModal && gapModal.style.display !== "none") return false;
        closeWorkshopDrawer();
        return true;
    }

    // 0b. Si le tiroir de la file d'attente est ouvert : le fermer
    if (window.AudioPlayer && window.AudioPlayer.isQueueDrawerOpen && typeof window.AudioPlayer.closeQueueDrawer === "function") {
        window.AudioPlayer.closeQueueDrawer();
        return true;
    }

    // 0c. Si la modale d'égaliseur est ouverte : la fermer
    if (window.AudioPlayer && window.AudioPlayer.isEqualizerModalOpen && typeof window.AudioPlayer.closeEqualizerModal === "function") {
        window.AudioPlayer.closeEqualizerModal();
        return true;
    }

    // 1. Si on est dans le détail d'un album dans l'onglet Albums : revenir à la grille des albums
    if (window.AudioPlayer && window.AudioPlayer.isAlbumDetailOpen) {
        window.AudioPlayer.closeAlbumDetail();
        return true;
    }

    // 2. Si on est dans la grille des albums avec un filtre Artiste ou Genre actif : revenir à l'onglet Artistes ou Genres
    if (window.AudioPlayer && window.AudioPlayer.currentView === "albums") {
        if (window.AudioPlayer.selectedArtistFilter || window.AudioPlayer.selectedGenreFilter) {
            return window.AudioPlayer.returnFromFilterToOrigin();
        }
    }

    // 3. Si on est dans le détail d'une playlist dans l'onglet Playlists : revenir à la grille des playlists
    if (window.AudioPlayer && window.AudioPlayer.currentView === "playlists" && window.UserPlaylists && window.UserPlaylists.isDetailOpen) {
        window.UserPlaylists.closeDetail();
        return true;
    }

    // 4. Fonction unique : Revenir du lecteur (now-playing) vers le dernier onglet de contenu précédent
    if (window.AudioPlayer && window.AudioPlayer.currentView === "now-playing") {
        window.AudioPlayer.returnToPreviousView();
        return true;
    }
    return false;
}
window.triggerBackNavigation = triggerBackNavigation;

window.addEventListener("mouseup", (e) => {
    if (e.button === 3) {
        e.preventDefault();
        e.stopPropagation();
        triggerBackNavigation();
    } else if (e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
    }
}, true);

window.addEventListener("mousedown", (e) => {
    if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
    }
}, true);

window.addEventListener("auxclick", (e) => {
    if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
    }
}, true);

if (window.electronAPI && typeof window.electronAPI.onNavigateBack === "function") {
    window.electronAPI.onNavigateBack(() => {
        triggerBackNavigation();
    });
}

// ===================================================
// Synchronisation dynamique de la hauteur des contrôles sticky
// ===================================================
function syncPlayerControlsHeight() {
    const card = document.getElementById("player-controls-card");
    if (!card) return;
    const h = card.getBoundingClientRect().height || card.offsetHeight || 136;
    if (h > 0) {
        document.documentElement.style.setProperty("--player-controls-height", `${Math.round(h)}px`);
    }
}
window.syncPlayerControlsHeight = syncPlayerControlsHeight;
window.addEventListener("resize", syncPlayerControlsHeight);

// ===================================================
// Gestionnaire d'erreur de pochette avec repli transparent via proxy local
// ===================================================
function handleCoverError(img) {
    if (!img) return;
    const origSrc = img.dataset.origSrc || img.getAttribute("src") || "";
    // Si l'image provient d'un CDN externe (Google/YouTube) et n'a pas encore été relayée par notre proxy local
    if (!img.dataset.proxyRetried && origSrc.startsWith("http") && !origSrc.includes("/api/proxy-cover")) {
        img.dataset.proxyRetried = "1";
        img.src = `/api/proxy-cover?url=${encodeURIComponent(origSrc)}`;
        return;
    }
    // Repli final vers le placeholder SVG si le proxy ou le réseau échoue
    img.onerror = null;
    img.src = "/static/placeholder-cover.svg";
}
window.handleCoverError = handleCoverError;

// ===================================================
// Utilitaires de chaînes & formatage
// ===================================================
function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
window.escapeHtml = escapeHtml;

function cleanArtistName(artist) {
    if (!artist) return "";
    return String(artist).replace(/\s*(?:[\-–—]\s*|\()(?:topic|th[eè]me)\)?\s*$/i, "").trim();
}
window.cleanArtistName = cleanArtistName;

function formatTime(sec) {
    if (!sec || isNaN(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}
window.formatTime = formatTime;

// ===================================================
// Sélecteur de dossier natif (Electron natif ou API HTTP backend)
// ===================================================
async function browseFolder(targetInputId) {
    const input = document.getElementById(targetInputId);
    if (!input) return;
    const initialDir = input.value.trim();
    let chosen = null;

    // 1. Dialogue natif Electron (100% modal, ancré sur la fenêtre principale, ultra-fiable)
    if (window.electronAPI && typeof window.electronAPI.selectFolder === "function") {
        try {
            const selected = await window.electronAPI.selectFolder(initialDir);
            if (selected) {
                chosen = selected;
            }
        } catch (err) {
            console.warn("Échec dialogue natif Electron, repli sur l'API HTTP :", err);
        }
    }

    // 2. Repli API HTTP backend
    if (!chosen) {
        try {
            const res = await fetch("/api/browse-folder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ initial_dir: initialDir })
            });
            const data = await res.json();
            if (data && data.path) {
                chosen = data.path;
            }
        } catch (err) {
            console.error("Erreur sélection dossier :", err);
        }
    }

    if (chosen) {
        input.value = chosen;
        input.dispatchEvent(new Event("input", { bubbles: true }));

        if (targetInputId === "cfg-library-dir") {
            if (typeof promptAndConfigureLibrary === "function") {
                await promptAndConfigureLibrary(chosen);
            } else if (typeof window.promptAndConfigureLibrary === "function") {
                await window.promptAndConfigureLibrary(chosen);
            }
        } else {
            input.dispatchEvent(new Event("change", { bubbles: true }));
        }
    }
}
window.browseFolder = browseFolder;

// ===================================================
// Détermination infaillible Album Officiel vs Playlist
// ===================================================
function isPlaylistUrlOrItem(item, url) {
    if (item && item.type) {
        if (item.type === "album" || item.type === "track" || item.type === "video") {
            return false;
        }
        if (item.type === "playlist") {
            return true;
        }
    }
    if (!url) return false;
    const u = String(url).trim();
    // Tout identifiant OLAK (Official Licensed Audio) ou MPREb_ désigne un album officiel certifié
    if (u.includes("list=OLAK") || u.includes("list=olak") || u.includes("browse/MPREb_") || u.includes("browse/OLAK")) {
        return false;
    }
    // Radio algorithmique dynamique YouTube Music (RD...) sur une piste en cours de lecture
    if ((u.includes("watch?v=") || u.includes("watch/")) && (u.includes("list=RD") || u.includes("list=rd") || u.includes("list=UL") || u.includes("list=ul"))) {
        return false;
    }
    // Une playlist YouTube possède un paramètre list= (ex: list=PL...) et n'est pas un album OLAK
    if (u.includes("playlist?list=") || u.includes("&list=") || u.includes("?list=")) {
        return true;
    }
    return false;
}
window.isPlaylistUrlOrItem = isPlaylistUrlOrItem;

// ===================================================
// Mise à jour de l'UI du sélecteur de mode dans l'éditeur (v3.3.3)
// ===================================================
function getBadgeInfoForType(type) {
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
}
window.getBadgeInfoForType = getBadgeInfoForType;

function updateEditorTypeToggleUI(mode, isManual = false) {
    const autoBtn = document.getElementById("toggle-type-auto-btn");
    const albumBtn = document.getElementById("toggle-type-album-btn");
    const singleBtn = document.getElementById("toggle-type-single-btn");
    const ripBtn = document.getElementById("toggle-type-rip-btn");
    const plBtn = document.getElementById("toggle-type-playlist-btn");
    const concertBtn = document.getElementById("toggle-type-concert-btn");

    const isAuto = !isManual;
    const isPlaylist = mode === true || mode === "playlist";
    const isSingle = mode === "single";
    const isRip = mode === "rip";
    const isConcert = mode === "concert";
    const isAlbum = mode === "album" || (!isPlaylist && !isSingle && !isRip && !isConcert);

    if (autoBtn) autoBtn.classList.toggle("active", isAuto);
    if (albumBtn) albumBtn.classList.toggle("active", isManual && isAlbum);
    if (singleBtn) singleBtn.classList.toggle("active", isManual && isSingle);
    if (ripBtn) ripBtn.classList.toggle("active", isManual && isRip);
    if (plBtn) plBtn.classList.toggle("active", isManual && isPlaylist);
    if (concertBtn) concertBtn.classList.toggle("active", isManual && isConcert);
}
window.updateEditorTypeToggleUI = updateEditorTypeToggleUI;

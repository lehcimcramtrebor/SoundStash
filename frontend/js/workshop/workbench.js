// =========================================================
// SoundStash - Module Workshop / Workbench Canopy Drawer
// Gestion du tiroir escamotable Atelier et navigation par onglets
// =========================================================

window.isWorkshopDrawerOpen = false;
window.isPlayerModeActive = true;
window.lastWorkflowTab = "tab-search";

// =========================================================
// TIROIR ESCAMOTABLE ATELIER (Pull-down Canopy Workbench)
// =========================================================
// isWorkshopDrawerOpen on window
// isPlayerModeActive on window // Le lecteur audio est le socle permanent
// lastWorkflowTab on window

function openWorkshopDrawer(targetTab = null) {
    if (window.isPartyLockActive) {
        if (window.PartyLock) {
            window.PartyLock.requestUnlock("Veuillez saisir votre code PIN pour accéder à l'Atelier.");
        }
        return;
    }

    isWorkshopDrawerOpen = true;
    document.body.classList.add("workshop-drawer-open");

    const drawer = document.getElementById("workshop-drawer");
    const backdrop = document.getElementById("workshop-drawer-backdrop");
    const pullTab = document.getElementById("workshop-pull-tab");
    const pullTabCaret = document.getElementById("pull-tab-caret");
    const pullTabText = document.getElementById("pull-tab-text");

    if (backdrop) backdrop.style.display = "block";
    if (drawer) drawer.setAttribute("aria-hidden", "false");
    if (pullTab) {
        pullTab.setAttribute("title", "Replier l'Atelier (Échap)");
        pullTab.setAttribute("aria-label", "Replier l'Atelier");
    }
    if (pullTabCaret) pullTabCaret.textContent = "▲";
    if (pullTabText) pullTabText.textContent = "FERMER";

    const tabToOpen = targetTab || (lastWorkflowTab && lastWorkflowTab !== "tab-player" ? lastWorkflowTab : "tab-search");
    switchWorkflowTab(tabToOpen);
    if (typeof updateHeaderNowPlayingButton === "function") updateHeaderNowPlayingButton();
}

function closeWorkshopDrawer() {
    if (!isWorkshopDrawerOpen) return;

    if (currentAlbumPath && editorDirtyState[currentAlbumPath]) {
        saveCurrentEditorDraft();
    }

    isWorkshopDrawerOpen = false;
    document.body.classList.remove("workshop-drawer-open");
    if (typeof updateHeaderNowPlayingButton === "function") updateHeaderNowPlayingButton();

    const drawer = document.getElementById("workshop-drawer");
    const backdrop = document.getElementById("workshop-drawer-backdrop");
    const pullTab = document.getElementById("workshop-pull-tab");
    const pullTabCaret = document.getElementById("pull-tab-caret");
    const pullTabText = document.getElementById("pull-tab-text");

    if (drawer) drawer.setAttribute("aria-hidden", "true");
    if (pullTab) {
        pullTab.setAttribute("title", "Ouvrir l'Atelier (Raccourci: Maj+W)");
        pullTab.setAttribute("aria-label", "Ouvrir l'Atelier");
    }
    if (pullTabCaret) pullTabCaret.textContent = "▼";
    if (pullTabText) pullTabText.textContent = "ATELIER";

    setTimeout(() => {
        if (!isWorkshopDrawerOpen && backdrop) {
            backdrop.style.display = "none";
        }
    }, 350);

    // Prompt de rafraîchissement si des jaquettes ont été modifiées pendant la session Atelier
    if (window.coversModifiedInWorkshopCount && window.coversModifiedInWorkshopCount > 0) {
        const count = window.coversModifiedInWorkshopCount;
        window.coversModifiedInWorkshopCount = 0;
        setTimeout(async () => {
            const countLabel = count > 1 ? `${count} jaquettes d'albums` : "une jaquette d'album";
            const confirmFn = window.showModalConfirm || (typeof showModalConfirm === "function" ? showModalConfirm : null);
            let confirmed = true;
            if (confirmFn) {
                confirmed = await confirmFn(
                    "🖼️ Jaquettes modifiées",
                    `Vous venez de modifier ${countLabel} dans l'Atelier.\n\nSouhaitez-vous recharger l'application (Ctrl+F5) pour actualiser immédiatement tous les visuels du Lecteur ?`,
                    "Rafraîchir (Ctrl+F5)",
                    false,
                    "Plus tard"
                );
            }
            if (confirmed) {
                try {
                    localStorage.setItem("ytm_active_workflow_tab", "tab-player");
                    localStorage.setItem("ytm_active_tab", "tab-player");
                } catch (_) {}

                if (window.electronAPI && typeof window.electronAPI.hardReload === "function") {
                    await window.electronAPI.hardReload();
                } else if (window.location && typeof window.location.reload === "function") {
                    window.location.reload(true);
                } else {
                    if (window.AudioPlayer && typeof window.AudioPlayer.loadLibraryData === "function") {
                        await window.AudioPlayer.loadLibraryData(true);
                    }
                }
            }
        }, 200);
    }
}

function toggleWorkshopDrawer(targetTab = null) {
    if (isWorkshopDrawerOpen) {
        closeWorkshopDrawer();
    } else {
        openWorkshopDrawer(targetTab);
    }
}

window.openWorkshopDrawer = openWorkshopDrawer;
window.closeWorkshopDrawer = closeWorkshopDrawer;
window.toggleWorkshopDrawer = toggleWorkshopDrawer;

function switchWorkflowTab(tabId) {
    if (tabId === "tab-player") {
        closeWorkshopDrawer();
        return;
    }
    if (tabId === "tab-settings") {
        openSettingsModal();
        return;
    }

    if (currentAlbumPath && editorDirtyState[currentAlbumPath] && tabId !== "tab-editor") {
        saveCurrentEditorDraft();
    }

    lastWorkflowTab = tabId;

    // Activer l'onglet dans le tiroir
    document.querySelectorAll("#main-nav-tabs .nav-tab").forEach(t => {
        t.classList.toggle("active", t.getAttribute("data-tab") === tabId);
    });
    document.querySelectorAll("#workshop-drawer-body .tab-pane").forEach(p => {
        p.classList.toggle("active", p.id === tabId);
    });

    try {
        localStorage.setItem("ytm_active_workflow_tab", tabId);
    } catch (e) {}

    // Scroll en haut du tiroir
    const drawerBody = document.getElementById("workshop-drawer-body");
    if (drawerBody) drawerBody.scrollTo({ top: 0, behavior: "smooth" });

    if (tabId === "tab-library") {
        loadLibrary();
    } else if (tabId === "tab-download") {
        pollStatus();
    } else if (tabId === "tab-search") {
        if (typeof currentSearchResults !== "undefined" && currentSearchResults && currentSearchResults.length > 0) {
            enrichItemsWithLibraryStatus(currentSearchResults);
        }
    } else if (tabId === "tab-editor") {
        triggerLibrarySync();
        if (typeof loadCollectionAlbumsForEditor === "function") {
            loadCollectionAlbumsForEditor();
        }
        if (typeof ensureLibraryTagSuggestions === "function") {
            ensureLibraryTagSuggestions();
        }
        if (window.editorSubMode === "genres") {
            if (typeof loadGenreBatchAlbums === "function") {
                loadGenreBatchAlbums(true);
            }
        } else if (window.editorSubMode === "covers") {
            if (typeof loadCoversGalleryAlbums === "function") {
                loadCoversGalleryAlbums(true);
            }
        } else if (!isCollectionEditorMode && (!tempAlbumsList || tempAlbumsList.length === 0)) {
            resetEditorState("Dossier temporaire vide", "Aucun album à taguer");
        } else {
            verifyAndValidateEditorActiveAlbum();
        }
    }
    if (typeof AudioPlayer !== "undefined" && AudioPlayer.updateFloatingBarVisibility) {
        AudioPlayer.updateFloatingBarVisibility();
    }
}

// Compatibilité descendante enterPlayerMode / exitPlayerMode
function enterPlayerMode() {
    closeWorkshopDrawer();
    isPlayerModeActive = true;
    document.body.classList.add("player-mode-active");

    if (typeof AudioPlayer !== "undefined") {
        if (AudioPlayer.onTabActivated) AudioPlayer.onTabActivated();
        if (AudioPlayer.updateFloatingBarVisibility) AudioPlayer.updateFloatingBarVisibility();
    }
    if (window.PartyLock) window.PartyLock.updateUI();
    if (typeof updateHeaderNowPlayingButton === "function") updateHeaderNowPlayingButton();
}

function exitPlayerMode() {
    openWorkshopDrawer();
}

// Gestion des onglets
function setupTabs() {
    const tabs = document.querySelectorAll(".nav-tab");
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            const targetId = tab.getAttribute("data-tab");
            switchTab(targetId);
        });
    });

    // Bouton Universel En cours d'écoute (Header)
    const btnNowPlaying = document.getElementById("btn-header-now-playing");
    if (btnNowPlaying) {
        btnNowPlaying.addEventListener("click", () => {
            window.goToNowPlaying();
        });
    }

    // Bouton Verrouillage Mode Soirée (Header)
    const btnPartyLock = document.getElementById("btn-party-lock");
    if (btnPartyLock) {
        btnPartyLock.addEventListener("click", () => {
            if (window.PartyLock) window.PartyLock.toggle();
        });
    }

    // Bouton Header Roue Crantée Paramètres
    const headerSettingsBtn = document.getElementById("btn-open-settings");
    if (headerSettingsBtn) {
        headerSettingsBtn.addEventListener("click", () => {
            if (window.isPartyLockActive) {
                if (window.PartyLock) window.PartyLock.requestUnlock("Veuillez saisir votre code PIN pour accéder aux Paramètres.");
                return;
            }
            openSettingsModal();
        });
    }

    // Languette Skeumorphique d'ouverture / fermeture du Tiroir Atelier (Bord supérieur de l'écran)
    const pullTab = document.getElementById("workshop-pull-tab");
    if (pullTab) {
        pullTab.addEventListener("click", () => {
            toggleWorkshopDrawer();
        });
        pullTab.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleWorkshopDrawer();
            }
        });
    }

    // Bouton croix de fermeture du tiroir
    const btnCloseDrawer = document.getElementById("btn-close-workshop-drawer");
    if (btnCloseDrawer) {
        btnCloseDrawer.addEventListener("click", () => {
            closeWorkshopDrawer();
        });
    }

    // Clic sur l'arrière-plan du tiroir pour refermer
    const drawerBackdrop = document.getElementById("workshop-drawer-backdrop");
    if (drawerBackdrop) {
        drawerBackdrop.addEventListener("click", () => {
            closeWorkshopDrawer();
        });
    }

    // Switch Header Mode Lecteur (Curseur et conteneur interactifs - compatibilité)
    const switchGroup = document.getElementById("player-mode-switch-group");
    const switchInput = document.getElementById("player-mode-switch-input");
    if (switchInput) {
        switchInput.addEventListener("change", () => {
            if (switchInput.checked) {
                closeWorkshopDrawer();
            } else {
                openWorkshopDrawer();
            }
        });
    }

    // Clic sur l'indicateur global Atelier / téléchargement dans l'en-tête -> Bascule le tiroir Atelier
    const globalStatusBadge = document.getElementById("global-status-badge");
    if (globalStatusBadge) {
        globalStatusBadge.addEventListener("click", () => {
            if (window.isPartyLockActive) {
                if (window.PartyLock) window.PartyLock.requestUnlock("Veuillez saisir votre code PIN pour accéder à l'Atelier.");
                return;
            }
            if (isWorkshopDrawerOpen) {
                closeWorkshopDrawer();
            } else {
                const isDownloading = globalStatusBadge.classList.contains("badge-downloading") || globalStatusBadge.classList.contains("badge-tagging");
                openWorkshopDrawer(isDownloading ? "tab-download" : null);
                if (isDownloading) {
                    const dlSec = document.getElementById("downloads-section");
                    if (dlSec) dlSec.scrollIntoView({ behavior: "smooth" });
                }
            }
        });
    }

    // Raccourci Échap pour fermer le tiroir ou les modales
    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            const partyUnlockModal = document.getElementById("party-lock-unlock-modal");
            if (partyUnlockModal && partyUnlockModal.style.display !== "none") {
                if (window.PartyLock) window.PartyLock.closeUnlockModal();
                e.stopPropagation();
                return;
            }
            const partySetupModal = document.getElementById("party-lock-setup-modal");
            if (partySetupModal && partySetupModal.style.display !== "none") {
                if (window.PartyLock) window.PartyLock.closeSetupModal();
                e.stopPropagation();
                return;
            }
            const migrationModal = document.getElementById("migration-modal-backdrop");
            if (migrationModal && migrationModal.classList.contains("active")) {
                closeMigrationModal();
                e.stopPropagation();
                return;
            }
            const settingsModal = document.getElementById("settings-modal-backdrop");
            if (settingsModal && settingsModal.classList.contains("active")) {
                closeSettingsModal();
                e.stopPropagation();
                return;
            }
            const closeConfirmModal = document.getElementById("close-confirm-modal");
            if (closeConfirmModal && closeConfirmModal.classList.contains("active")) {
                const cancelBtn = document.getElementById("close-confirm-cancel-btn");
                if (cancelBtn) cancelBtn.click();
                e.stopPropagation();
                return;
            }
            if (window.AudioPlayer && window.AudioPlayer.isEqualizerModalOpen) {
                window.AudioPlayer.closeEqualizerModal();
                e.stopPropagation();
                return;
            }
            if (window.AudioPlayer && window.AudioPlayer.isQueueDrawerOpen) {
                window.AudioPlayer.closeQueueDrawer();
                e.stopPropagation();
                return;
            }
            if (window.AmbientVisualizer && window.AmbientVisualizer.isActive) {
                window.AmbientVisualizer.exit();
                e.stopPropagation();
                return;
            }
            if (isWorkshopDrawerOpen) {
                if (isReconstituteModalOpen() || isCustomModalOpen()) return;
                const gapModal = document.getElementById("gap-modal-backdrop");
                if (gapModal && gapModal.style.display !== "none") return;
                closeWorkshopDrawer();
                e.stopPropagation();
                return;
            }
            if (window.AudioPlayer && window.AudioPlayer.currentView === "albums" && window.AudioPlayer.isAlbumDetailOpen) {
                window.AudioPlayer.closeAlbumDetail(true);
                e.stopPropagation();
                return;
            }
            if (window.AudioPlayer && window.AudioPlayer.currentView === "albums" && (window.AudioPlayer.selectedArtistFilter || window.AudioPlayer.selectedGenreFilter)) {
                window.AudioPlayer.returnFromFilterToOrigin();
                e.stopPropagation();
                return;
            }
            if (window.AudioPlayer && window.AudioPlayer.currentView === "playlists" && window.UserPlaylists && window.UserPlaylists.isDetailOpen) {
                window.UserPlaylists.closeDetail();
                e.stopPropagation();
                return;
            }
        }
    });

    // Le Lecteur Audio est l'écran d'accueil permanent
    try {
        const savedTab = localStorage.getItem("ytm_active_workflow_tab") || localStorage.getItem("ytm_active_tab");
        if (savedTab && savedTab !== "tab-player" && savedTab !== "tab-settings") {
            lastWorkflowTab = savedTab;
        }
    } catch (e) {}
}

function switchTab(tabId) {
    if (tabId === "tab-player") {
        closeWorkshopDrawer();
        return;
    }
    if (tabId === "tab-settings") {
        openSettingsModal();
        return;
    }

    if (window.isPartyLockActive) {
        if (window.PartyLock) {
            window.PartyLock.requestUnlock("Veuillez saisir votre code PIN pour accéder à l'Atelier.");
        }
        return;
    }

    if (!isWorkshopDrawerOpen) {
        openWorkshopDrawer(tabId);
    } else {
        switchWorkflowTab(tabId);
    }
}


// Exports globaux
window.openWorkshopDrawer = openWorkshopDrawer;
window.closeWorkshopDrawer = closeWorkshopDrawer;
window.toggleWorkshopDrawer = toggleWorkshopDrawer;
window.switchWorkflowTab = switchWorkflowTab;
window.enterPlayerMode = enterPlayerMode;
window.exitPlayerMode = exitPlayerMode;
window.setupTabs = setupTabs;
window.switchTab = switchTab;

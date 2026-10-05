/**
 * SoundStash Extras - Gestionnaire de Configuration, Paramètres & Modales Système
 * openSettingsModal, migration v3, audit Kid3, recherche de jaquettes, notification tray et réinitialisation.
 */

window.currentConfig = window.currentConfig || {};
function openSettingsModal(defaultSubtab = "subtab-music") {
    if (window.isPartyLockActive) {
        if (window.PartyLock) window.PartyLock.requestUnlock("Veuillez saisir votre code PIN pour accéder aux Paramètres.");
        return;
    }
    const modal = document.getElementById("settings-modal-backdrop");
    if (!modal) return;
    loadConfiguration();
    if (typeof refreshLogsInfo === "function") refreshLogsInfo();
    if (window.PartyLock) window.PartyLock.updateSettingsUI();
    switchSettingsSubtab(defaultSubtab);
    modal.style.display = "flex";
    modal.classList.add("active");
}

function closeSettingsModal() {
    const modal = document.getElementById("settings-modal-backdrop");
    if (!modal) return;
    modal.classList.remove("active");
    setTimeout(() => {
        modal.style.display = "none";
    }, 200);
}

function switchSettingsSubtab(subtabId) {
    const navBtns = document.querySelectorAll(".settings-subtab-btn");
    const panes = document.querySelectorAll(".settings-subtab-pane");

    navBtns.forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-subtab") === subtabId);
    });
    panes.forEach(pane => {
        pane.classList.toggle("active", pane.id === `pane-${subtabId}`);
    });
    if (subtabId === "subtab-maintenance") {
        if (typeof refreshLogsInfo === "function") refreshLogsInfo();
    }
}

let migrationResolveCallback = null;

function closeMigrationModal() {
    const modal = document.getElementById("migration-modal-backdrop");
    if (!modal) return;
    modal.classList.remove("active");
    setTimeout(() => {
        modal.style.display = "none";
        const indicator = document.getElementById("migration-progress-indicator");
        if (indicator) indicator.style.display = "none";
        const btnMove = document.getElementById("migration-btn-move");
        const btnSkip = document.getElementById("migration-btn-skip");
        if (btnMove) btnMove.disabled = false;
        if (btnSkip) btnSkip.disabled = false;
    }, 200);
    if (migrationResolveCallback) {
        migrationResolveCallback(false);
        migrationResolveCallback = null;
    }
}

function showMigrationModal(migrationData) {
    return new Promise((resolve) => {
        const modal = document.getElementById("migration-modal-backdrop");
        if (!modal) {
            resolve(false);
            return;
        }

        const titleEl = document.getElementById("migration-modal-title");
        const introEl = document.getElementById("migration-modal-intro");
        const srcEl = document.getElementById("migration-source-path");
        const tgtEl = document.getElementById("migration-target-path");
        const btnMove = document.getElementById("migration-btn-move");
        const btnSkip = document.getElementById("migration-btn-skip");
        const btnClose = document.getElementById("migration-modal-close-btn");
        const indicator = document.getElementById("migration-progress-indicator");
        const progressText = document.getElementById("migration-progress-text");

        const isVideo = migrationData.type === "video";
        if (titleEl) {
            titleEl.textContent = isVideo 
                ? "Clips Vidéo Détectés dans l'Ancien Emplacement" 
                : "Albums Détectés dans l'Ancien Emplacement";
        }
        if (introEl) {
            introEl.innerHTML = isVideo
                ? `Des clips vidéo (<strong>${escapeHtml(migrationData.summary)}</strong>) ont été trouvés dans votre précédent dossier.`
                : `Des albums audio (<strong>${escapeHtml(migrationData.summary)}</strong>) ont été trouvés dans votre précédent dossier d'exportation.`;
        }
        if (srcEl) srcEl.textContent = migrationData.source_path;
        if (tgtEl) tgtEl.textContent = migrationData.target_path;

        if (indicator) indicator.style.display = "none";
        if (btnMove) btnMove.disabled = false;
        if (btnSkip) btnSkip.disabled = false;

        migrationResolveCallback = resolve;

        // Câblage Déplacer et organiser (Recommandé)
        btnMove.onclick = async () => {
            btnMove.disabled = true;
            btnSkip.disabled = true;
            if (indicator) indicator.style.display = "flex";
            if (progressText) {
                progressText.textContent = isVideo
                    ? "Déplacement et organisation des clips par artiste en cours..."
                    : "Déplacement et harmonisation Tag-First de la collection en cours...";
            }
            try {
                const res = await fetch("/api/library/migrate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        type: migrationData.type,
                        source_path: migrationData.source_path,
                        target_path: migrationData.target_path
                    })
                });
                const resData = await res.json();
                if (resData.success) {
                    showToast(resData.message || "Migration terminée avec succès !", "success");
                    if (isVideo) {
                        if (window.AudioPlayer && typeof window.AudioPlayer.loadAndRenderVideosCatalog === "function") {
                            window.AudioPlayer.loadAndRenderVideosCatalog(true);
                        }
                    } else {
                        if (typeof autoConfigureAndScanLibrary === "function") {
                            await autoConfigureAndScanLibrary(migrationData.target_path);
                        }
                    }
                } else {
                    showToast(resData.error || "Erreur lors du déplacement des fichiers", "error");
                }
            } catch (err) {
                showToast("Erreur réseau durant la migration des fichiers", "error");
            } finally {
                const cb = migrationResolveCallback;
                migrationResolveCallback = null;
                closeMigrationModal();
                if (cb) cb(true);
            }
        };

        // Câblage Ne rien faire (Conserver en l'état)
        btnSkip.onclick = () => {
            const cb = migrationResolveCallback;
            migrationResolveCallback = null;
            closeMigrationModal();
            if (cb) cb(false);
        };

        if (btnClose) {
            btnClose.onclick = () => {
                const cb = migrationResolveCallback;
                migrationResolveCallback = null;
                closeMigrationModal();
                if (cb) cb(false);
            };
        }

        modal.onclick = (e) => {
            if (e.target === modal) {
                const cb = migrationResolveCallback;
                migrationResolveCallback = null;
                closeMigrationModal();
                if (cb) cb(false);
            }
        };

        modal.style.display = "flex";
        requestAnimationFrame(() => modal.classList.add("active"));
    });
}

async function checkAndPromptMigration(type, newPath) {
    if (!newPath || !newPath.trim()) return false;
    try {
        const res = await fetch("/api/library/check-migration", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: type, new_path: newPath.trim() })
        });
        const data = await res.json();
        if (data && data.needs_migration) {
            return await showMigrationModal(data);
        }
    } catch (err) {
        console.warn("Erreur check-migration:", err);
    }
    return false;
}

function setupSettings() {
    const form = document.getElementById("settings-form");
    const browseSettingsBtn = document.getElementById("browse-settings-export-btn");
    const browseVideoSettingsBtn = document.getElementById("browse-settings-video-export-btn");
    const browseLibraryBtn = document.getElementById("browse-settings-library-btn");
    const scanLibraryBtn = document.getElementById("scan-library-btn");
    const browseVideoLibraryBtn = document.getElementById("browse-settings-video-library-btn");
    const scanVideoLibraryBtn = document.getElementById("scan-video-library-btn");
    const auditCollectionBtn = document.getElementById("audit-collection-btn");
    const libraryInput = document.getElementById("cfg-library-dir");
    const smartExportCheckbox = document.getElementById("cfg-smart-export");

    // Boutons de fermeture de la modale des paramètres
    const btnCloseSettings = document.getElementById("settings-modal-close-btn");
    const btnCancelSettings = document.getElementById("settings-modal-cancel-btn");
    const settingsBackdrop = document.getElementById("settings-modal-backdrop");

    if (btnCloseSettings) {
        btnCloseSettings.addEventListener("click", () => closeSettingsModal());
    }
    if (btnCancelSettings) {
        btnCancelSettings.addEventListener("click", () => closeSettingsModal());
    }
    if (settingsBackdrop) {
        settingsBackdrop.addEventListener("click", (e) => {
            if (e.target === settingsBackdrop) {
                closeSettingsModal();
            }
        });
    }

    // Gestion des sous-onglets
    const subtabBtns = document.querySelectorAll(".settings-subtab-btn");
    subtabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const subtab = btn.getAttribute("data-subtab");
            if (subtab) switchSettingsSubtab(subtab);
        });
    });

    // Synchronisation automatique des dossiers vidéo (Unification : un seul champ vidéo)
    const vidLibInput = document.getElementById("cfg-video-library-dir");
    const vidExpInput = document.getElementById("cfg-video-export-dir");
    if (vidLibInput && vidExpInput) {
        const syncVideoInputs = () => {
            vidExpInput.value = vidLibInput.value.trim();
        };
        vidLibInput.addEventListener("input", syncVideoInputs);
        vidLibInput.addEventListener("change", syncVideoInputs);
    }

    if (browseSettingsBtn) {
        browseSettingsBtn.addEventListener("click", () => browseFolder("cfg-export-dir"));
    }
    if (browseVideoSettingsBtn) {
        browseVideoSettingsBtn.addEventListener("click", () => browseFolder("cfg-video-library-dir"));
    }
    if (browseLibraryBtn) {
        browseLibraryBtn.addEventListener("click", () => browseFolder("cfg-library-dir"));
    }
    if (browseVideoLibraryBtn) {
        browseVideoLibraryBtn.addEventListener("click", () => browseFolder("cfg-video-library-dir"));
    }

    if (libraryInput) {
        libraryInput.addEventListener("change", async () => {
            await promptAndConfigureLibrary(libraryInput.value.trim());
        });
    }

    if (smartExportCheckbox) {
        smartExportCheckbox.addEventListener("change", () => {
            updateSmartExportUIState();
        });
    }

    if (scanLibraryBtn) {
        scanLibraryBtn.addEventListener("click", async () => {
            const libraryDir = document.getElementById("cfg-library-dir") ? document.getElementById("cfg-library-dir").value.trim() : "";
            if (libraryDir && currentConfig && currentConfig.library_dir === libraryDir) {
                await autoConfigureAndScanLibrary(libraryDir);
            } else {
                await promptAndConfigureLibrary(libraryDir);
            }
        });
    }

    if (scanVideoLibraryBtn) {
        scanVideoLibraryBtn.addEventListener("click", async () => {
            scanVideoLibraryBtn.disabled = true;
            scanVideoLibraryBtn.innerHTML = `<span class="spinner" style="display:inline-block;width:14px;height:14px;vertical-align:middle;margin-right:4px;"></span> Indexation...`;
            showToast("Indexation et vérification de la bibliothèque vidéo en cours...", "info");
            try {
                const res = await fetch("/api/videos/catalog?force_refresh=true");
                const data = await res.json();
                const count = (data.videos || []).length;
                showToast(`Indexation vidéo terminée : ${count} clip(s) répertorié(s).`, "success");
                const vidStatusEl = document.getElementById("video-library-status-text");
                if (vidStatusEl) {
                    vidStatusEl.innerHTML = `✅ <strong>${count}</strong> clip(s) vidéo et <strong>${data.total_artists || 0}</strong> artiste(s) actuellement indexés dans le Hub.`;
                }
                if (window.AudioPlayer && typeof window.AudioPlayer.loadAndRenderVideosCatalog === "function") {
                    window.AudioPlayer.loadAndRenderVideosCatalog(true);
                }
            } catch (e) {
                showToast("Erreur lors de l'indexation de la bibliothèque vidéo", "error");
            } finally {
                scanVideoLibraryBtn.disabled = false;
                scanVideoLibraryBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
                    Indexer
                `;
            }
        });
    }

    if (auditCollectionBtn) {
        auditCollectionBtn.addEventListener("click", () => {
            openAuditModal();
        });
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const exportDir = document.getElementById("cfg-export-dir") ? document.getElementById("cfg-export-dir").value.trim() : "";
        const libraryDir = document.getElementById("cfg-library-dir") ? document.getElementById("cfg-library-dir").value.trim() : "";
        const videoLibraryDir = document.getElementById("cfg-video-library-dir") ? document.getElementById("cfg-video-library-dir").value.trim() : "";
        const videoExportDir = videoLibraryDir || (document.getElementById("cfg-video-export-dir") ? document.getElementById("cfg-video-export-dir").value.trim() : "");
        const defaultVideoQuality = document.getElementById("cfg-default-video-quality") ? document.getElementById("cfg-default-video-quality").value : "1080p";
        const autoSyncVideos = document.getElementById("cfg-auto-sync-videos") ? document.getElementById("cfg-auto-sync-videos").checked : true;
        const smartExport = document.getElementById("cfg-smart-export") ? document.getElementById("cfg-smart-export").checked : false;
        const smartConflictPolicy = document.getElementById("cfg-smart-conflict-policy") ? document.getElementById("cfg-smart-conflict-policy").value : "merge";
        const pattern = document.getElementById("cfg-naming-pattern").value;
        const delTemp = document.getElementById("cfg-delete-temp").checked;
        const minToTray = document.getElementById("cfg-minimize-to-tray") ? document.getElementById("cfg-minimize-to-tray").checked : true;
        const minOnMin = document.getElementById("cfg-minimize-on-minimize") ? document.getElementById("cfg-minimize-on-minimize").checked : true;
        const startFullscreen = document.getElementById("cfg-start-fullscreen") ? document.getElementById("cfg-start-fullscreen").checked : true;
        const audioFaderEnabled = document.getElementById("cfg-audio-crossfade") ? document.getElementById("cfg-audio-crossfade").checked : true;
        AudioFader.enabled = audioFaderEnabled;
        try { localStorage.setItem("ytm_audio_fader_enabled", audioFaderEnabled ? "true" : "false"); } catch (e) {}
        const cooldownAlbum = parseInt(document.getElementById("cfg-cooldown-album")?.value || "30", 10);
        const cooldownSingle = parseInt(document.getElementById("cfg-cooldown-single")?.value || "10", 10);

        // Vérification et proposition de rapatriement / migration assistée
        const initialLibDir = (currentConfig && currentConfig.library_dir) ? currentConfig.library_dir.trim() : "";
        const initialVidDir = (currentConfig && (currentConfig.video_library_dir || currentConfig.video_export_dir)) ? (currentConfig.video_library_dir || currentConfig.video_export_dir).trim() : "";

        if (libraryDir && libraryDir !== initialLibDir) {
            await checkAndPromptMigration("music", libraryDir);
        }
        if (videoLibraryDir && videoLibraryDir !== initialVidDir) {
            await checkAndPromptMigration("video", videoLibraryDir);
        }

        try {
            const res = await fetch("/api/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    export_dir: exportDir,
                    video_export_dir: videoExportDir,
                    video_library_dir: videoLibraryDir || null,
                    library_dir: libraryDir || null,
                    smart_export: smartExport && Boolean(libraryDir),
                    smart_export_conflict_policy: smartConflictPolicy,
                    default_video_quality: defaultVideoQuality,
                    auto_sync_videos: autoSyncVideos,
                    naming_pattern: pattern,
                    delete_temp_after_export: delTemp,
                    minimize_to_tray_on_close: minToTray,
                    minimize_to_tray_on_minimize: minOnMin,
                    start_in_fullscreen: startFullscreen,
                    audio_fader_enabled: audioFaderEnabled,
                    cooldown_album: cooldownAlbum,
                    cooldown_single: cooldownSingle,
                    auto_update_yt_dlp: document.getElementById("cfg-auto-update-yt-dlp") ? document.getElementById("cfg-auto-update-yt-dlp").checked : true,
                    auto_check_app_updates: document.getElementById("cfg-auto-check-app-updates") ? document.getElementById("cfg-auto-check-app-updates").checked : true,
                    max_audio_quality_when_signed: document.getElementById("cfg-max-audio-quality-signed") ? document.getElementById("cfg-max-audio-quality-signed").checked : true
                })
            });
            if (res.ok) {
                showToast("Paramètres enregistrés avec succès.", "success");
                await loadConfiguration();
            }
        } catch (err) {
            await showModalAlert("Erreur", err.message, "danger");
        }
    });

    setupAppReset();
}

function setupAppReset() {
    const resetBtn = document.getElementById("reset-app-btn");
    if (!resetBtn) return;

    resetBtn.addEventListener("click", async () => {
        // Confirmation Étape 1/2
        const firstConfirm = await showModalConfirm(
            "Réinitialisation de l'application (Étape 1/2)",
            "Attention : Cette opération va réinitialiser l'ensemble des paramètres aux valeurs d'usine.\n\nToutes les persistances locales (recherches, filtres, sélections de reconstitution, brouillons d'édition) et le cache d'aperçus seront purgés.\n\nSouhaitez-vous continuer vers la confirmation finale ?",
            "Continuer vers la confirmation finale",
            true
        );
        if (!firstConfirm) return;

        // Petite pause pour laisser la transition de fermeture de la première modale s'achever
        await new Promise(r => setTimeout(r, 220));

        // Confirmation Étape 2/2 (Ultime confirmation)
        const finalConfirm = await showModalConfirm(
            "⚠️ CONFIRMATION FINALE (Étape 2/2)",
            "ACTION DÉFINITIVE ET IRRÉVERSIBLE !\n\nÊtes-vous absolument certain(e) de vouloir tout réinitialiser ? Toutes vos préférences et données de travail non exportées seront immédiatement effacées.\n\nConfirmez-vous la réinitialisation totale ?",
            "RÉINITIALISER TOUT",
            true
        );
        if (!finalConfirm) return;

        try {
            resetBtn.disabled = true;
            const res = await fetch("/api/app/reset", { method: "POST" });
            const data = await res.json();
            if (data.success) {
                // Effacement complet de toute persistance locale dans le navigateur
                try {
                    localStorage.clear();
                } catch (e) {}

                await showModalAlert(
                    "Application réinitialisée",
                    "Tous les réglages d'usine ont été restaurés et les données locales ont été effacées.\nL'application va maintenant redémarrer.",
                    "success"
                );
                window.location.reload();
            } else {
                await showModalAlert("Erreur de réinitialisation", data.message || "Une erreur est survenue.", "danger");
                resetBtn.disabled = false;
            }
        } catch (err) {
            await showModalAlert("Erreur", `Impossible de réinitialiser l'application : ${err.message}`, "danger");
            resetBtn.disabled = false;
        }
    });
}

function updateQuickDestButtons(targetInputId) {
    const input = document.getElementById(targetInputId);
    if (!input || !currentConfig.quick_paths) return;
    const val = input.value.trim().toLowerCase().replace(/[\\/]+$/, "");
    document.querySelectorAll(`.quick-dest-btn[data-target="${targetInputId}"]`).forEach(btn => {
        const destKey = btn.getAttribute("data-dest");
        const path = (currentConfig.quick_paths[destKey] || "").toLowerCase().replace(/[\\/]+$/, "");
        if (path && val === path) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
}

function setupQuickDestButtons() {
    document.querySelectorAll(".quick-dest-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const targetId = btn.getAttribute("data-target");
            const destType = btn.getAttribute("data-dest");
            const input = document.getElementById(targetId);
            if (!input || !currentConfig.quick_paths) return;
            const destPath = currentConfig.quick_paths[destType];
            if (destPath) {
                input.value = destPath;
                updateQuickDestButtons(targetId);
            }
        });
    });

    ["export-dir-input", "cfg-export-dir", "cfg-video-export-dir", "cfg-video-library-dir"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("input", () => updateQuickDestButtons(id));
        }
    });

    // Ambiance Visuelle & Arrière-Plan Statique (v3.2.1)
    const staticBackdropCheckbox = document.getElementById("cfg-static-backdrop-enabled");
    if (staticBackdropCheckbox) {
        staticBackdropCheckbox.addEventListener("change", (e) => {
            try {
                localStorage.setItem("ytm_static_backdrop_enabled", e.target.checked ? "true" : "false");
                if (window.AmbientThemeManager && typeof window.AmbientThemeManager.updateStaticBackdrop === "function") {
                    window.AmbientThemeManager.updateStaticBackdrop();
                }
            } catch (err) {
                console.error("Erreur enregistrement option static_backdrop:", err);
            }
        });
    }

    // Gestion du Moteur yt-dlp (Mise à jour manuelle et automatique)
    const btnUpdateYtDlp = document.getElementById("btn-update-yt-dlp");
    const autoUpdateYtDlpCheckbox = document.getElementById("cfg-auto-update-yt-dlp");
    const updateResultAlert = document.getElementById("yt-dlp-update-result-alert");

    if (autoUpdateYtDlpCheckbox) {
        autoUpdateYtDlpCheckbox.addEventListener("change", async (e) => {
            try {
                await fetch("/api/config", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ auto_update_yt_dlp: e.target.checked })
                });
            } catch (err) {
                console.error("Erreur enregistrement option auto_update_yt_dlp:", err);
            }
        });
    }

    if (btnUpdateYtDlp) {
        btnUpdateYtDlp.addEventListener("click", async () => {
            const labelEl = document.getElementById("label-update-yt-dlp");
            const iconEl = document.getElementById("icon-update-yt-dlp");
            btnUpdateYtDlp.disabled = true;
            if (labelEl) labelEl.textContent = "Vérification en cours...";
            if (iconEl) iconEl.style.animation = "spin 1s linear infinite";
            if (updateResultAlert) updateResultAlert.style.display = "none";

            try {
                const res = await fetch("/api/tools/yt-dlp/update", { method: "POST" });
                const data = await res.json();

                if (updateResultAlert) {
                    updateResultAlert.style.display = "block";
                    if (data.updated) {
                        updateResultAlert.style.background = "rgba(16, 185, 129, 0.2)";
                        updateResultAlert.style.border = "1px solid #10b981";
                        updateResultAlert.style.color = "#6ee7b7";
                        updateResultAlert.innerHTML = `🎉 <strong>Succès :</strong> yt-dlp a été mis à jour vers <strong>${escapeHtml(data.new_version)}</strong> !`;
                        showToast(`yt-dlp mis à jour : ${data.new_version}`, "success");
                    } else if (data.success && data.is_up_to_date) {
                        updateResultAlert.style.background = "rgba(59, 130, 246, 0.15)";
                        updateResultAlert.style.border = "1px solid #3b82f6";
                        updateResultAlert.style.color = "#93c5fd";
                        updateResultAlert.innerHTML = `✓ <strong>À jour :</strong> yt-dlp est déjà dans sa version la plus récente (<code>${escapeHtml(data.new_version)}</code>).`;
                        showToast(`yt-dlp est déjà à jour (${data.new_version})`, "info");
                    } else if (data.success) {
                        updateResultAlert.style.background = "rgba(59, 130, 246, 0.15)";
                        updateResultAlert.style.border = "1px solid #3b82f6";
                        updateResultAlert.style.color = "#93c5fd";
                        updateResultAlert.innerHTML = `✓ <strong>Vérification terminée :</strong> version actuelle <code>${escapeHtml(data.new_version)}</code>.`;
                    } else {
                        updateResultAlert.style.background = "rgba(239, 68, 68, 0.2)";
                        updateResultAlert.style.border = "1px solid #ef4444";
                        updateResultAlert.style.color = "#fca5a5";
                        updateResultAlert.innerHTML = `❌ <strong>Erreur :</strong> ${escapeHtml(data.message || data.output || "Échec de vérification")}`;
                        showToast(`Erreur mise à jour yt-dlp`, "error");
                    }
                }
                await refreshYtDlpStatus();
            } catch (err) {
                console.error("Erreur lors de la mise à jour de yt-dlp:", err);
                if (updateResultAlert) {
                    updateResultAlert.style.display = "block";
                    updateResultAlert.style.background = "rgba(239, 68, 68, 0.2)";
                    updateResultAlert.style.border = "1px solid #ef4444";
                    updateResultAlert.style.color = "#fca5a5";
                    updateResultAlert.textContent = "Erreur de communication avec le serveur lors de la mise à jour.";
                }
            } finally {
                btnUpdateYtDlp.disabled = false;
                if (labelEl) labelEl.textContent = "Vérifier / Mettre à jour yt-dlp";
                if (iconEl) iconEl.style.animation = "";
            }
        });
    }

    // Gestion des cookies de session YouTube (Anti-Bot)
    const btnImportCookies = document.getElementById("btn-cfg-cookies-import");
    const fileInputCookies = document.getElementById("cfg-cookies-file-input");
    const btnOpenCookiesFolder = document.getElementById("btn-cfg-cookies-open-folder");
    const btnRemoveCookies = document.getElementById("btn-cfg-cookies-remove");

    if (btnImportCookies && fileInputCookies) {
        btnImportCookies.addEventListener("click", () => {
            fileInputCookies.value = "";
            fileInputCookies.click();
        });

        fileInputCookies.addEventListener("change", async () => {
            const file = fileInputCookies.files && fileInputCookies.files[0];
            if (!file) return;

            btnImportCookies.disabled = true;
            btnImportCookies.innerHTML = `⏳ Importation...`;

            try {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const text = e.target.result;
                    if (!text || !text.trim()) {
                        showToast("Le fichier sélectionné est vide.", "warning");
                        btnImportCookies.disabled = false;
                        btnImportCookies.innerHTML = `📥 Importer cookies.txt`;
                        return;
                    }

                    try {
                        const res = await fetch("/api/cookies/upload", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ content: text })
                        });
                        const data = await res.json();
                        if (res.ok && data.success) {
                            showToast("✓ Session YouTube importée avec succès !", "success");
                            await refreshCookiesStatus();
                        } else {
                            showModalAlert("Erreur d'importation", data.detail || "Fichier cookies invalide.", "danger");
                        }
                    } catch (err) {
                        showModalAlert("Erreur réseau", "Impossible d'envoyer le fichier : " + err.message, "danger");
                    } finally {
                        btnImportCookies.disabled = false;
                        btnImportCookies.innerHTML = `📥 Importer cookies.txt`;
                    }
                };
                reader.readAsText(file);
            } catch (err) {
                btnImportCookies.disabled = false;
                btnImportCookies.innerHTML = `📥 Importer cookies.txt`;
                showToast("Erreur lecture fichier : " + err.message, "danger");
            }
        });
    }

    if (btnOpenCookiesFolder) {
        btnOpenCookiesFolder.addEventListener("click", async () => {
            await fetch("/api/cookies/open-folder", { method: "POST" });
        });
    }

    const btnTestCookies = document.getElementById("btn-cfg-cookies-test");
    if (btnTestCookies) {
        btnTestCookies.addEventListener("click", async () => {
            if (typeof window.verifyCookiesSession === "function") {
                await window.verifyCookiesSession(false);
            }
        });
    }

    if (btnRemoveCookies) {
        btnRemoveCookies.addEventListener("click", async () => {
            const confirmed = await showModalConfirm(
                "Supprimer la session YouTube ?",
                "Souhaitez-vous supprimer le fichier cookies.txt et repasser en mode anonyme standard ?",
                "Supprimer les cookies",
                true
            );
            if (!confirmed) return;

            try {
                const res = await fetch("/api/cookies", { method: "DELETE" });
                if (res.ok) {
                    showToast("Session YouTube supprimée. Mode anonyme réactivé.", "info");
                    await refreshCookiesStatus();
                }
            } catch (err) {
                showToast("Erreur lors de la suppression des cookies.", "danger");
            }
        });
    }
}

async function refreshYtDlpStatus() {
    const versionEl = document.getElementById("yt-dlp-installed-version");
    const lastCheckEl = document.getElementById("yt-dlp-last-check-text");
    if (!versionEl) return;
    try {
        const res = await fetch("/api/tools/yt-dlp/status");
        if (!res.ok) return;
        const data = await res.json();
        versionEl.textContent = data.version || "Inconnue";
        if (lastCheckEl) {
            lastCheckEl.textContent = `${data.last_check_date} (${data.last_check_status || "Prêt"})`;
        }
    } catch (e) {
        console.warn("Impossible de récupérer le statut de yt-dlp:", e);
    }
}

async function refreshCookiesStatus() {
    const badge = document.getElementById("cfg-cookies-status-badge");
    const details = document.getElementById("cfg-cookies-status-details");
    const btnRemove = document.getElementById("btn-cfg-cookies-remove");
    const btnTest = document.getElementById("btn-cfg-cookies-test");
    const searchBadge = document.getElementById("search-session-status-badge");

    // Raccourci pour ouvrir directement le sous-onglet Système / Session depuis la recherche
    if (searchBadge && !searchBadge._hasClickListener) {
        searchBadge._hasClickListener = true;
        searchBadge.addEventListener("click", () => {
            if (typeof openSettingsModal === "function") {
                openSettingsModal("subtab-system");
            }
        });
    }

    try {
        const res = await fetch("/api/cookies/status");
        if (!res.ok) return;
        const data = await res.json();

        if (data.exists) {
            if (badge) {
                badge.className = "badge badge-success";
                badge.style.background = "";
                badge.style.color = "";
                badge.style.borderColor = "";
                badge.innerHTML = `🟢 Session YouTube active`;
                badge.title = `Fichier : ${data.path}`;
            }
            if (details) {
                const modText = data.modified_at ? ` (importé le ${data.modified_at})` : "";
                const ytNotice = data.has_youtube_auth ? "Identifiants YouTube reconnus." : "Fichier cookies détecté.";
                details.innerHTML = `✅ Fichier <code>cookies.txt</code> actif (${data.formatted_size})${modText}. ${ytNotice} Vos requêtes de téléchargement sont signées.`;
            }
            if (btnRemove) btnRemove.style.display = "inline-flex";
            if (btnTest) btnTest.style.display = "inline-flex";

            if (searchBadge) {
                searchBadge.className = "badge badge-success";
                searchBadge.style.background = "rgba(46, 204, 113, 0.15)";
                searchBadge.style.color = "#2ecc71";
                searchBadge.style.borderColor = "rgba(46, 204, 113, 0.4)";
                searchBadge.innerHTML = `
                    <span class="session-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #2ecc71; display: inline-block; box-shadow: 0 0 6px #2ecc71;"></span>
                    <span class="session-text" style="font-weight: 600;">Session YouTube Active</span>
                `;
                searchBadge.title = `Session connectée active (${data.formatted_size}). Cliquez pour gérer les cookies ou tester la session.`;
            }
        } else {
            if (badge) {
                badge.className = "badge badge-idle";
                badge.style.background = "";
                badge.style.color = "";
                badge.style.borderColor = "";
                badge.textContent = "Mode Anonyme (Aucun cookie)";
                badge.title = "Aucun fichier cookies.txt actif dans le dossier de configuration.";
            }
            if (details) {
                details.textContent = "Aucun fichier de session actif. SoundStash télécharge en visiteur anonyme.";
            }
            if (btnRemove) btnRemove.style.display = "none";
            if (btnTest) btnTest.style.display = "none";

            if (searchBadge) {
                searchBadge.className = "badge badge-idle";
                searchBadge.style.background = "var(--surface-2, rgba(255, 255, 255, 0.04))";
                searchBadge.style.color = "var(--text-muted, #888)";
                searchBadge.style.borderColor = "var(--border-subtle, #333)";
                searchBadge.innerHTML = `
                    <span class="session-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #888; display: inline-block;"></span>
                    <span class="session-text">Session YouTube : Inactive</span>
                `;
                searchBadge.title = "Aucune session YouTube connectée. Cliquez pour importer vos cookies et éviter les blocages.";
            }
        }
    } catch (e) {
        console.warn("Impossible de vérifier le statut des cookies:", e);
    }
}
window.refreshCookiesStatus = refreshCookiesStatus;

async function verifyCookiesSession(silent = false) {
    const btnTest = document.getElementById("btn-cfg-cookies-test");
    const badge = document.getElementById("cfg-cookies-status-badge");
    const details = document.getElementById("cfg-cookies-status-details");
    const searchBadge = document.getElementById("search-session-status-badge");

    if (btnTest && !silent) {
        btnTest.disabled = true;
        btnTest.innerHTML = `⏳ Test en direct...`;
    }

    try {
        const res = await fetch("/api/cookies/verify", { method: "POST" });
        if (!res.ok) throw new Error("Erreur serveur lors de la vérification");
        const data = await res.json();

        if (data.status === "valid") {
            if (badge) {
                badge.className = "badge badge-success";
                badge.style.background = "";
                badge.style.color = "";
                badge.style.borderColor = "";
                badge.innerHTML = `🟢 Session YouTube active & connectée`;
            }
            if (details) {
                details.innerHTML = `✅ Vos identifiants Google/YouTube sont acceptés en direct par les serveurs de YouTube. Vos téléchargements sont signés et protégés.`;
            }
            if (searchBadge) {
                searchBadge.className = "badge badge-success";
                searchBadge.style.background = "rgba(46, 204, 113, 0.15)";
                searchBadge.style.color = "#2ecc71";
                searchBadge.style.borderColor = "rgba(46, 204, 113, 0.4)";
                searchBadge.innerHTML = `
                    <span class="session-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #2ecc71; display: inline-block; box-shadow: 0 0 6px #2ecc71;"></span>
                    <span class="session-text" style="font-weight: 600;">Session YouTube Active</span>
                `;
                searchBadge.title = `Session connectée vérifiée avec succès auprès de YouTube. Vos téléchargements sont signés.`;
            }
            if (!silent && typeof showToast === "function") {
                showToast("✅ Session YouTube 100% valide et connectée !", "success");
            }
        } else if (data.status === "expired") {
            if (badge) {
                badge.className = "badge badge-warning";
                badge.style.background = "rgba(245, 158, 11, 0.20)";
                badge.style.color = "#f59e0b";
                badge.style.borderColor = "rgba(245, 158, 11, 0.5)";
                badge.innerHTML = `⚠️ Session expirée (À renouveler)`;
            }
            if (details) {
                details.innerHTML = `⚠️ <strong style="color: #f59e0b;">Session expirée ou révoquée par Google</strong> : vos cookies ne sont plus acceptés par YouTube (suite à un changement de mot de passe ou à expiration). Veuillez réimporter un nouveau fichier <code>cookies.txt</code> ci-dessus.`;
            }
            if (searchBadge) {
                searchBadge.className = "badge badge-warning";
                searchBadge.style.background = "rgba(245, 158, 11, 0.20)";
                searchBadge.style.color = "#f59e0b";
                searchBadge.style.borderColor = "rgba(245, 158, 11, 0.5)";
                searchBadge.innerHTML = `
                    <span class="session-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; display: inline-block; box-shadow: 0 0 8px #f59e0b;"></span>
                    <span class="session-text" style="font-weight: 700;">⚠️ Session expirée</span>
                `;
                searchBadge.title = `Session expirée ou mot de passe changé ! Cliquez pour importer votre nouveau cookies.txt dans les Paramètres.`;
            }
            if (!silent) {
                if (typeof showModalAlert === "function") {
                    showModalAlert(
                        "Session YouTube Expirée",
                        "Google a invalidé ou révoqué cette session (suite à un changement de mot de passe de votre compte ou à l'expiration des cookies).\n\nPour continuer à télécharger sans blocage, réexportez un nouveau fichier cookies.txt depuis votre navigateur et réimportez-le dans les Paramètres.",
                        "warning"
                    );
                }
            } else if (typeof showToast === "function") {
                showToast("⚠️ Votre session YouTube (cookies.txt) a expiré. Pensez à la réimporter dans les Paramètres.", "warning");
            }
        } else if (data.status === "no_cookies" || data.status === "anonymous") {
            await refreshCookiesStatus();
            if (!silent && typeof showToast === "function") {
                showToast("Mode Anonyme actif (aucun cookie utilisateur connecté).", "info");
            }
        } else {
            if (!silent && typeof showToast === "function") {
                showToast(data.message || "Impossible de vérifier la session auprès de YouTube.", "warning");
            }
        }
    } catch (err) {
        console.warn("[Cookies] Erreur vérification session en direct:", err);
        if (!silent && typeof showToast === "function") {
            showToast("Erreur réseau lors de la vérification : " + err.message, "danger");
        }
    } finally {
        if (btnTest && !silent) {
            btnTest.disabled = false;
            btnTest.innerHTML = `🔄 Tester la session`;
        }
    }
}
window.verifyCookiesSession = verifyCookiesSession;

// Vérification automatique et discrète en arrière-plan au démarrage (après 4s) si des cookies sont présents
setTimeout(async () => {
    try {
        const res = await fetch("/api/cookies/status");
        if (res.ok) {
            const data = await res.json();
            if (data.exists && data.has_youtube_auth) {
                verifyCookiesSession(true);
            }
        }
    } catch (_) {}
}, 4000);

async function loadConfiguration() {
    try {
        const res = await fetch("/api/config");
        const data = await res.json();
        currentConfig = data;

        // Mise à jour synchrone de la version installée affichée
        if (data.app_version) {
            const installedVerEl = document.getElementById("app-installed-version");
            if (installedVerEl) installedVerEl.textContent = `v${data.app_version}`;
            const modalCurrentVerEl = document.getElementById("app-update-current-ver");
            if (modalCurrentVerEl) modalCurrentVerEl.textContent = `v${data.app_version}`;
            if (window.AppUpdater) window.AppUpdater.currentVersion = data.app_version;
        }

        document.getElementById("cfg-export-dir").value = data.export_dir || "";
        const effectiveVideoDir = data.video_library_dir || data.video_export_dir || "";
        const videoCfgInput = document.getElementById("cfg-video-export-dir");
        if (videoCfgInput) {
            videoCfgInput.value = effectiveVideoDir;
        }
        const libraryCfgInput = document.getElementById("cfg-library-dir");
        if (libraryCfgInput) {
            libraryCfgInput.value = data.library_dir || "";
        }
        const videoLibraryCfgInput = document.getElementById("cfg-video-library-dir");
        if (videoLibraryCfgInput) {
            videoLibraryCfgInput.value = effectiveVideoDir;
        }
        const defaultVideoQualitySelect = document.getElementById("cfg-default-video-quality");
        if (defaultVideoQualitySelect) {
            defaultVideoQualitySelect.value = data.default_video_quality || "1080p";
        }
        const autoSyncVideosCheckbox = document.getElementById("cfg-auto-sync-videos");
        if (autoSyncVideosCheckbox) {
            autoSyncVideosCheckbox.checked = data.auto_sync_videos !== false;
        }

        const smartExportCheckbox = document.getElementById("cfg-smart-export");
        if (smartExportCheckbox) {
            smartExportCheckbox.checked = data.smart_export !== false;
            const policyWrap = document.getElementById("smart-export-policy-wrap");
            if (policyWrap) {
                policyWrap.style.display = smartExportCheckbox.checked ? "flex" : "none";
            }
            if (!smartExportCheckbox._hasListener) {
                smartExportCheckbox._hasListener = true;
                smartExportCheckbox.addEventListener("change", () => {
                    const pw = document.getElementById("smart-export-policy-wrap");
                    if (pw) pw.style.display = smartExportCheckbox.checked ? "flex" : "none";
                });
            }
        }
        const smartConflictSelect = document.getElementById("cfg-smart-conflict-policy");
        if (smartConflictSelect) {
            smartConflictSelect.value = data.smart_export_conflict_policy || "merge";
        }

        document.getElementById("cfg-naming-pattern").value = data.naming_pattern || "{track:02d} {title}";
        document.getElementById("cfg-delete-temp").checked = data.delete_temp_after_export !== false;

        const minToTrayEl = document.getElementById("cfg-minimize-to-tray");
        if (minToTrayEl) minToTrayEl.checked = data.minimize_to_tray_on_close !== false;
        const minOnMinEl = document.getElementById("cfg-minimize-on-minimize");
        if (minOnMinEl) minOnMinEl.checked = data.minimize_to_tray_on_minimize !== false;
        const startFsEl = document.getElementById("cfg-start-fullscreen");
        if (startFsEl) startFsEl.checked = data.start_in_fullscreen !== false;
        const faderEl = document.getElementById("cfg-audio-crossfade");
        if (faderEl) {
            const isFaderActive = (data.audio_fader_enabled !== false) && (localStorage.getItem("ytm_audio_fader_enabled") !== "false");
            faderEl.checked = isFaderActive;
            AudioFader.enabled = isFaderActive;
        }
        const staticBackdropEl = document.getElementById("cfg-static-backdrop-enabled");
        if (staticBackdropEl) {
            staticBackdropEl.checked = localStorage.getItem("ytm_static_backdrop_enabled") !== "false";
        }

        // Pré-remplir les champs cooldown
        const cooldownAlbumInput = document.getElementById("cfg-cooldown-album");
        if (cooldownAlbumInput) cooldownAlbumInput.value = data.cooldown_album ?? 30;
        const cooldownSingleInput = document.getElementById("cfg-cooldown-single");
        if (cooldownSingleInput) cooldownSingleInput.value = data.cooldown_single ?? 10;

        // Pré-remplir la qualité audio max en session signée
        const maxAudioSignedEl = document.getElementById("cfg-max-audio-quality-signed");
        if (maxAudioSignedEl) {
            maxAudioSignedEl.checked = data.max_audio_quality_when_signed !== false;
        }

        // Charger l'état actuel de la bibliothèque indexée
        try {
            const libRes = await fetch("/api/library/info");
            const libData = await libRes.json();
            const statusEl = document.getElementById("library-status-text");
            if (statusEl && libData.albums_count > 0) {
                statusEl.innerHTML = `✅ <strong>${libData.albums_count}</strong> album(s) et <strong>${libData.artists_count}</strong> artiste(s) actuellement indexés.`;
            }
        } catch (e) {}

        // Charger l'état actuel de la bibliothèque vidéo
        try {
            const vidRes = await fetch("/api/videos/catalog");
            const vidData = await vidRes.json();
            const vidStatusEl = document.getElementById("video-library-status-text");
            if (vidStatusEl && vidData.videos && vidData.videos.length > 0) {
                vidStatusEl.innerHTML = `✅ <strong>${vidData.total_videos}</strong> clip(s) vidéo et <strong>${vidData.total_artists || 0}</strong> artiste(s) actuellement indexés dans le Hub.`;
            }
        } catch (e) {}

        updateQuickDestButtons("cfg-export-dir");
        if (videoCfgInput) updateQuickDestButtons("cfg-video-export-dir");
        if (videoLibraryCfgInput) updateQuickDestButtons("cfg-video-library-dir");
        updateQuickDestButtons("export-dir-input");
        updateSmartExportUIState();

        // Mise à jour de l'affichage du dossier temporaire avec %APPDATA% si applicable
        const tempDirEl = document.getElementById("temp-dir-display");
        if (tempDirEl && data.temp_download_dir) {
            let displayPath = data.temp_download_dir;
            const appDataMatch = displayPath.match(/^[A-Za-z]:\\Users\\[^\\]+\\AppData\\Roaming/i);
            if (appDataMatch) {
                displayPath = displayPath.replace(appDataMatch[0], "%APPDATA%");
            }
            tempDirEl.textContent = displayPath;
            tempDirEl.title = `Dossier temporaire : ${data.temp_download_dir} (cliquer pour ouvrir)`;
            tempDirEl.onclick = async () => {
                await fetch("/api/album/open-folder", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ path: data.temp_download_dir })
                });
            };
        }

        const toolsList = document.getElementById("tools-list");
        toolsList.innerHTML = "";

        const toolEntries = [
            { name: "yt-dlp", path: data.tools.yt_dlp },
            { name: "ffmpeg", path: data.tools.ffmpeg },
            { name: "kid3-cli", path: data.tools.kid3_cli },
            { name: "ytm.bat (Local)", path: data.tools.ytm_bat },
            { name: "ytm_ogg.bat (Local)", path: data.tools.ytm_ogg_bat }
        ];

        toolEntries.forEach(t => {
            const div = document.createElement("div");
            div.className = "tool-item";
            div.innerHTML = `
                <span class="tool-name">${t.name}</span>
                <span class="tool-path" title="${t.path}">${t.path || "Non trouvé"}</span>
            `;
            toolsList.appendChild(div);
        });

        const autoUpdateCheckbox = document.getElementById("cfg-auto-update-yt-dlp");
        if (autoUpdateCheckbox) {
            autoUpdateCheckbox.checked = data.auto_update_yt_dlp !== false;
        }
        const autoCheckAppUpdatesCheckbox = document.getElementById("cfg-auto-check-app-updates");
        if (autoCheckAppUpdatesCheckbox) {
            autoCheckAppUpdatesCheckbox.checked = data.auto_check_app_updates !== false;
        }
        refreshYtDlpStatus();
        refreshCookiesStatus();
    } catch (err) {
        console.error("Erreur chargement configuration:", err);
    }
}

// ===================================================
// Journal d'Activité & Fichiers de Logs (Paramètres)
// ===================================================
const logSizeBadge = document.getElementById("log-file-size-badge");
const logPathHint = document.getElementById("log-file-path-hint");
const btnOpenLogsFolder = document.getElementById("btn-open-logs-folder");
const btnClearLogs = document.getElementById("btn-clear-logs");

async function refreshLogsInfo() {
    if (!logSizeBadge) return;
    try {
        const res = await fetch("/api/logs/info");
        const data = await res.json();
        const bytes = data.total_bytes || 0;
        let formatted = "0 Ko";
        if (bytes > 1024 * 1024) {
            formatted = `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
        } else if (bytes > 0) {
            formatted = `${(bytes / 1024).toFixed(1)} Ko`;
        }
        logSizeBadge.textContent = `${formatted} (${data.file_count || 1} fichier${(data.file_count || 1) > 1 ? "s" : ""})`;
        if (logPathHint && data.log_file) {
            logPathHint.textContent = data.log_file;
        }
    } catch (e) {
        console.error("Erreur lecture logs info:", e);
    }
}

if (btnOpenLogsFolder) {
    btnOpenLogsFolder.addEventListener("click", async () => {
        try {
            await fetch("/api/logs/open-folder", { method: "POST" });
        } catch (e) {
            showToast("Impossible d'ouvrir le dossier des logs.", "danger");
        }
    });
}

if (btnClearLogs) {
    btnClearLogs.addEventListener("click", async () => {
        const confirmed = await showModalConfirm(
            "Vider les journaux de logs",
            "Êtes-vous sûr de vouloir vider le fichier de logs d'activité ? Les données d'historique technique récentes seront effacées.",
            "Vider les logs",
            true
        );
        if (confirmed) {
            try {
                const res = await fetch("/api/logs/clear", { method: "POST" });
                const data = await res.json();
                await refreshLogsInfo();
                showToast("Le journal des logs a été vidé avec succès.", "success");
            } catch (e) {
                showToast(`Erreur lors du vidage des logs : ${e.message}`, "danger");
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Gap Finder (Complétion de Discographie) & Curation de Collection
// ═══════════════════════════════════════════════════════════════════════

let currentGapMissingAlbums = [];

async function sendDirectDownload(url, title, itemType = "album") {
    const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            url: url,
            title: title,
            format: currentConfig.default_format || "m4a",
            quality: currentConfig.default_quality || "auto",
            auto_retag: true,
            naming_pattern: currentConfig.naming_pattern || "{track:02d} {title}",
            clean_titles: true,
            is_playlist: (itemType === "playlist"),
            custom_album: title
        })
    });
    return await res.json();
}

async function openGapFinderModal(artistName, browseId = null) {
    const modal = document.getElementById("gap-modal-backdrop");
    const loading = document.getElementById("gap-modal-loading");
    const statsBar = document.getElementById("gap-stats-bar");
    const statsText = document.getElementById("gap-stats-text");
    const grid = document.getElementById("gap-albums-grid");
    const titleEl = document.getElementById("gap-modal-artist-title");
    const subtitleEl = document.getElementById("gap-modal-artist-subtitle");
    const dlAllBtn = document.getElementById("gap-download-all-btn");

    if (!modal) return;
    titleEl.textContent = `Discographie & Albums Manquants : ${artistName}`;
    subtitleEl.textContent = "Interrogation de la discographie certifiée en ligne...";
    modal.style.display = "flex";
    loading.style.display = "flex";
    statsBar.style.display = "none";
    grid.innerHTML = "";
    currentGapMissingAlbums = [];

    try {
        const queryParams = new URLSearchParams({
            artist_name: artistName,
            ...(browseId ? { browse_id: browseId } : {})
        });
        const res = await fetch(`/api/library/artist/missing-albums?${queryParams.toString()}`);
        const data = await res.json();

        loading.style.display = "none";

        if (data.error && (!data.missing_albums || data.missing_albums.length === 0)) {
            subtitleEl.textContent = `Erreur : ${data.error}`;
            return;
        }

        subtitleEl.textContent = `Comparaison avec votre collection locale (${data.total_official} sorties officielles certifiées)`;
        statsBar.style.display = "flex";
        statsText.textContent = `Vous possédez ${data.owned_count} albums / singles sur ${data.total_official}. Manquants : ${data.missing_count}`;

        currentGapMissingAlbums = data.missing_albums || [];

        if (currentGapMissingAlbums.length === 0) {
            dlAllBtn.style.display = "none";
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 40px; background: var(--bg-surface-elevated); border-radius: 12px; border: 1px solid var(--border-color);">
                    <div style="font-size: 2.2rem; margin-bottom: 8px;">🎉</div>
                    <h4 style="margin: 0 0 6px 0; color: #10b981;">Discographie complète !</h4>
                    <p class="text-muted" style="margin: 0; font-size: 0.88rem;">Tous les albums et singles officiels répertoriés de <strong>${escapeHtml(artistName)}</strong> sont déjà présents dans votre collection ou en cours de traitement.</p>
                </div>
            `;
            return;
        }

        dlAllBtn.style.display = "inline-flex";
        dlAllBtn.textContent = `Tout télécharger (${currentGapMissingAlbums.length})`;

        currentGapMissingAlbums.forEach(album => {
            const card = document.createElement("div");
            card.className = "gap-album-card";
            const thumb = album.thumbnail || "/static/placeholder-cover.svg";
            card.innerHTML = `
                <img class="gap-album-thumb" src="${escapeHtml(thumb)}" alt="${escapeHtml(album.title)}" referrerpolicy="no-referrer" onerror="window.handleCoverError(this);">
                <div class="gap-album-info">
                    <div class="gap-album-title" title="${escapeHtml(album.title)}">${escapeHtml(album.title)}</div>
                    <div class="gap-album-meta">${escapeHtml(album.type || "Album")}${album.year ? ` • ${escapeHtml(album.year)}` : ""}</div>
                </div>
                <div class="gap-album-action">
                    <button type="button" class="btn btn-sm btn-primary btn-gap-dl" title="Télécharger cet album dans la file d'attente">
                        📥 Télécharger
                    </button>
                </div>
            `;

            const dlBtn = card.querySelector(".btn-gap-dl");
            dlBtn.addEventListener("click", async () => {
                dlBtn.disabled = true;
                dlBtn.textContent = "⏳ Ajout...";
                try {
                    await sendDirectDownload(album.url || album.id, album.title, album.type || "album");
                    dlBtn.textContent = "✓ En file";
                    dlBtn.classList.remove("btn-primary");
                    dlBtn.classList.add("btn-secondary");
                    showToast(`« ${album.title} » ajouté à la file !`, "success");
                } catch (e) {
                    dlBtn.disabled = false;
                    dlBtn.textContent = "📥 Télécharger";
                    showToast(`Erreur : ${e.message}`, "danger");
                }
            });

            grid.appendChild(card);
        });

    } catch (err) {
        loading.style.display = "none";
        subtitleEl.textContent = `Erreur : ${err.message}`;
    }
}

// Câblage fermeture modale Gap
const gapModal = document.getElementById("gap-modal-backdrop");
const btnCloseGap = document.getElementById("gap-modal-close-btn");
const btnCancelGap = document.getElementById("gap-modal-cancel-btn");
const btnDlAllGap = document.getElementById("gap-download-all-btn");

if (btnCloseGap) btnCloseGap.addEventListener("click", () => { gapModal.style.display = "none"; });
if (btnCancelGap) btnCancelGap.addEventListener("click", () => { gapModal.style.display = "none"; });

if (btnDlAllGap) {
    btnDlAllGap.addEventListener("click", async () => {
        if (!currentGapMissingAlbums || currentGapMissingAlbums.length === 0) return;
        btnDlAllGap.disabled = true;
        btnDlAllGap.textContent = "Ajout en cours...";
        let added = 0;
        for (const alb of currentGapMissingAlbums) {
            try {
                await sendDirectDownload(alb.url || alb.id, alb.title, alb.type || "album");
                added++;
            } catch (e) {}
        }
        showToast(`${added} album(s) ajouté(s) à la file de téléchargement !`, "success");
        btnDlAllGap.textContent = "✓ Tous ajoutés";
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Diagnostic Santé & Harmonisation de Collection
// ═══════════════════════════════════════════════════════════════════════

let currentAuditIssues = [];

async function openAuditModal() {
    const modal = document.getElementById("audit-modal-backdrop");
    const loading = document.getElementById("audit-loading");
    const content = document.getElementById("audit-content-container");
    const countText = document.getElementById("audit-issues-count-text");
    const tbody = document.getElementById("audit-table-body");
    const applyBtn = document.getElementById("audit-apply-btn");

    if (!modal) return;
    modal.style.display = "flex";
    loading.style.display = "flex";
    content.style.display = "none";
    tbody.innerHTML = "";
    currentAuditIssues = [];

    try {
        const res = await fetch("/api/library/audit");
        const data = await res.json();

        loading.style.display = "none";
        content.style.display = "block";

        if (data.error) {
            countText.textContent = `Erreur : ${data.error}`;
            return;
        }

        currentAuditIssues = data.issues || [];
        countText.textContent = `${currentAuditIssues.length} anomalie(s) détectée(s) sur ${data.scanned_albums_count} dossiers analysés`;

        if (currentAuditIssues.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center; padding: 30px; color: #10b981;">
                        🎉 Aucune anomalie détectée ! Votre collection est propre et harmonisée.
                    </td>
                </tr>
            `;
            applyBtn.disabled = true;
            return;
        }

        applyBtn.disabled = false;

        currentAuditIssues.forEach(iss => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><input type="checkbox" class="audit-item-check" data-id="${escapeHtml(iss.id)}" checked></td>
                <td><span class="audit-badge ${iss.badge_class}">${escapeHtml(iss.badge_label)}</span></td>
                <td style="font-family: var(--font-mono); font-size: 0.78rem; word-break: break-all;">${escapeHtml(iss.target_path)}</td>
                <td style="color: #f87171;">${escapeHtml(iss.current_value)}</td>
                <td style="color: #10b981; font-weight: 600;">${escapeHtml(iss.suggested_value)}</td>
            `;
            tbody.appendChild(tr);
        });

    } catch (err) {
        loading.style.display = "none";
        content.style.display = "block";
        countText.textContent = `Erreur : ${err.message}`;
    }
}

// Câblage modale audit
const auditModal = document.getElementById("audit-modal-backdrop");
const btnCloseAudit = document.getElementById("audit-modal-close-btn");
const btnCancelAudit = document.getElementById("audit-cancel-btn");
const btnApplyAudit = document.getElementById("audit-apply-btn");
const masterCheck = document.getElementById("audit-table-master-check");
const btnSelectAllAudit = document.getElementById("audit-select-all-btn");
const btnDeselectAllAudit = document.getElementById("audit-deselect-all-btn");

if (btnCloseAudit) btnCloseAudit.addEventListener("click", () => { auditModal.style.display = "none"; });
if (btnCancelAudit) btnCancelAudit.addEventListener("click", () => { auditModal.style.display = "none"; });

if (masterCheck) {
    masterCheck.addEventListener("change", () => {
        document.querySelectorAll(".audit-item-check").forEach(cb => { cb.checked = masterCheck.checked; });
    });
}
if (btnSelectAllAudit) {
    btnSelectAllAudit.addEventListener("click", () => {
        document.querySelectorAll(".audit-item-check").forEach(cb => { cb.checked = true; });
        if (masterCheck) masterCheck.checked = true;
    });
}
if (btnDeselectAllAudit) {
    btnDeselectAllAudit.addEventListener("click", () => {
        document.querySelectorAll(".audit-item-check").forEach(cb => { cb.checked = false; });
        if (masterCheck) masterCheck.checked = false;
    });
}

if (btnApplyAudit) {
    btnApplyAudit.addEventListener("click", async () => {
        const checkedBoxes = Array.from(document.querySelectorAll(".audit-item-check:checked"));
        if (checkedBoxes.length === 0) {
            showToast("Aucune correction sélectionnée.", "warning");
            return;
        }

        const selectedIds = new Set(checkedBoxes.map(cb => cb.getAttribute("data-id")));
        const fixesToApply = currentAuditIssues.filter(iss => selectedIds.has(iss.id));

        const confirmed = await showModalConfirm(
            "Confirmer l'harmonisation",
            `Appliquer ${fixesToApply.length} correction(s) sur votre collection ?\nLes modifications seront tracées dans le journal d'activité.`,
            "Appliquer les corrections"
        );
        if (!confirmed) return;

        btnApplyAudit.disabled = true;
        btnApplyAudit.textContent = "Application en cours...";

        try {
            const res = await fetch("/api/library/harmonize", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fixes: fixesToApply })
            });
            const data = await res.json();
            btnApplyAudit.disabled = false;
            btnApplyAudit.textContent = "Appliquer les corrections sélectionnées";

            if (data.success || data.success_count > 0) {
                showToast(`${data.success_count} correction(s) appliquée(s) avec succès !`, "success");
                auditModal.style.display = "none";
            } else {
                showToast(`Erreur : ${data.errors?.join(", ") || "Impossible d'appliquer"}`, "danger");
            }
        } catch (err) {
            btnApplyAudit.disabled = false;
            btnApplyAudit.textContent = "Appliquer les corrections sélectionnées";
            showToast(`Erreur : ${err.message}`, "danger");
        }
    });
}
// =========================================================================
// Modale de Recherche & Choix de Pochette Multi-Sources & Import Local
// =========================================================================

let selectedCandidateCoverUrl = null;
let selectedCandidateCoverBase64 = null;
let currentCoverCandidates = [];
let activeCoverFilter = "all";

const coverSearchModal = document.getElementById("cover-search-modal-backdrop");
const btnOpenCoverSearch = document.getElementById("btn-search-cover-ytm");
const btnCloseCoverSearch = document.getElementById("cover-search-modal-close-btn");
const btnCancelCoverSearch = document.getElementById("cover-search-cancel-btn");
const btnApplyCover = document.getElementById("cover-search-apply-btn");
const coverSearchForm = document.getElementById("cover-search-form");
const coverSearchInput = document.getElementById("cover-search-query-input");
const coverSearchLoading = document.getElementById("cover-search-loading");
const coverSearchEmpty = document.getElementById("cover-search-empty");
const coverSearchGrid = document.getElementById("cover-search-results-grid");
const coverSearchHint = document.getElementById("cover-search-selected-hint");
const coverSearchApplyText = document.getElementById("cover-search-apply-text");
const coverDropzone = document.getElementById("cover-dropzone");
const btnBrowseLocalCover = document.getElementById("btn-browse-local-cover");
const btnPasteClipboardCover = document.getElementById("btn-paste-clipboard-cover");
const coverLocalFileInput = document.getElementById("cover-local-file-input");

function getActiveEditorAlbumPath() {
    if (window.currentAlbumPath) return window.currentAlbumPath;
    if (typeof currentAlbumPath !== "undefined" && currentAlbumPath) return currentAlbumPath;
    const colSelect = document.getElementById("editor-collection-select");
    if (colSelect && colSelect.value) return colSelect.value;
    const pathEl = document.getElementById("editor-album-path");
    if (pathEl && pathEl.textContent && pathEl.textContent.trim() !== "Aucun dossier chargé") {
        return pathEl.textContent.trim();
    }
    return null;
}

function openCoverSearchModal(preloadedLocalFile = null, overrideAlbum = null, preloadedSourceLabel = "Fichier local") {
    let albumPath = (overrideAlbum && overrideAlbum.path) ? overrideAlbum.path : getActiveEditorAlbumPath();
    if (!albumPath) {
        showToast("Veuillez d'abord sélectionner ou ouvrir un album dans l'Éditeur.", "warning");
        return;
    }

    // Sauvegarder le chemin de l'album ciblé
    window.currentAlbumPath = albumPath;
    window._coverModalTargetAlbumPath = albumPath;
    window._coverModalOverrideAlbum = overrideAlbum;

    let artist = "";
    let album = "";
    if (overrideAlbum) {
        artist = (overrideAlbum.artist || overrideAlbum.album_artist || "").trim();
        album = (overrideAlbum.title || overrideAlbum.album_name || "").trim();
    } else {
        const artistInput = document.getElementById("edit-album-artist");
        const albumInput = document.getElementById("edit-album-name");
        artist = artistInput ? artistInput.value.trim() : "";
        album = albumInput ? albumInput.value.trim() : "";
    }

    const query = [artist, album].filter(Boolean).join(" ");
    if (coverSearchInput) {
        coverSearchInput.value = query;
    }

    selectedCandidateCoverUrl = null;
    selectedCandidateCoverBase64 = null;
    currentCoverCandidates = [];
    activeCoverFilter = "all";

    // Réinitialiser les filtres
    document.querySelectorAll(".btn-cover-filter").forEach(btn => {
        if (btn.getAttribute("data-filter") === "all") btn.classList.add("active");
        else btn.classList.remove("active");
    });
    const localFilterBtn = document.getElementById("cover-filter-local");
    if (localFilterBtn) localFilterBtn.style.display = "none";

    if (btnApplyCover) btnApplyCover.disabled = true;
    if (coverSearchHint) coverSearchHint.textContent = "Aucune jaquette sélectionnée.";
    if (coverSearchGrid) coverSearchGrid.innerHTML = "";
    if (coverSearchEmpty) coverSearchEmpty.style.display = "none";

    if (coverSearchModal) {
        coverSearchModal.style.display = "flex";
        void coverSearchModal.offsetWidth;
        coverSearchModal.classList.add("active");
    }

    if (preloadedLocalFile) {
        handleLocalCoverFile(preloadedLocalFile, preloadedSourceLabel);
    } else if (query) {
        performCoverSearch(query);
    }
}
window.openCoverSearchModal = openCoverSearchModal;

function closeCoverSearchModal() {
    if (!coverSearchModal) return;
    coverSearchModal.classList.remove("active");
    setTimeout(() => {
        coverSearchModal.style.display = "none";
    }, 200);
}
window.closeCoverSearchModal = closeCoverSearchModal;

async function performCoverSearch(query) {
    if (!query || !query.trim()) return;
    if (coverSearchLoading) coverSearchLoading.style.display = "flex";
    if (coverSearchEmpty) coverSearchEmpty.style.display = "none";
    if (coverSearchGrid) coverSearchGrid.innerHTML = "";
    selectedCandidateCoverUrl = null;
    selectedCandidateCoverBase64 = null;
    if (btnApplyCover) btnApplyCover.disabled = true;
    if (coverSearchHint) coverSearchHint.textContent = "Recherche en cours dans les discographies...";

    try {
        const res = await fetch(`/api/album/search-covers?query=${encodeURIComponent(query.trim())}`);
        const data = await res.json();

        if (coverSearchLoading) coverSearchLoading.style.display = "none";

        const candidates = data.candidates || [];
        // Conserver les fichiers locaux déjà présents
        const locals = currentCoverCandidates.filter(c => c.isLocal);
        currentCoverCandidates = [...locals, ...candidates];

        if (currentCoverCandidates.length === 0) {
            if (coverSearchEmpty) coverSearchEmpty.style.display = "block";
            return;
        }

        renderCoverCandidates(currentCoverCandidates);

        // Sélectionner automatiquement la 1ère pochette haute résolution officielle
        if (currentCoverCandidates.length > 0 && coverSearchGrid && coverSearchGrid.firstElementChild) {
            selectCoverCandidate(currentCoverCandidates[0], coverSearchGrid.firstElementChild);
        }
    } catch (err) {
        if (coverSearchLoading) coverSearchLoading.style.display = "none";
        showToast(`Erreur recherche de jaquettes : ${err.message}`, "danger");
    }
}

function handleLocalCoverFile(file, sourceLabel = "Fichier local") {
    if (!file || (!file.type.startsWith("image/") && !file.type.includes("octet-stream"))) {
        showToast("Veuillez sélectionner ou coller un format d'image valide (.jpg, .png, .webp).", "warning");
        return;
    }

    const isClipboard = (sourceLabel === "Presse-papier");
    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUrl = e.target.result;
        const localCandidate = {
            title: isClipboard ? "Pochette presse-papier" : (file.name || "Image personnalisée"),
            artist: isClipboard ? "Copiée depuis votre presse-papier" : "Image locale de votre PC",
            year: `${(file.size / 1024).toFixed(0)} Ko`,
            track_count: null,
            thumbnail: dataUrl,
            source: isClipboard ? "Presse-papier" : "Fichier local",
            badge: isClipboard ? "📋 Presse-papier" : "📁 Fichier local",
            isLocal: true,
            base64: dataUrl
        };

        const localFilterBtn = document.getElementById("cover-filter-local");
        if (localFilterBtn) {
            localFilterBtn.textContent = isClipboard ? "📋 Presse-papier" : "📁 Fichier local";
            localFilterBtn.setAttribute("data-filter", isClipboard ? "Presse-papier" : "Fichier local");
            localFilterBtn.style.display = "inline-block";
        }

        currentCoverCandidates = [localCandidate, ...currentCoverCandidates.filter(c => !c.isLocal)];
        renderCoverCandidates(currentCoverCandidates);

        if (coverSearchGrid && coverSearchGrid.firstElementChild) {
            selectCoverCandidate(localCandidate, coverSearchGrid.firstElementChild);
        }
        showToast(isClipboard ? "Image collée depuis le presse-papier ! Cliquez sur 'Appliquer la pochette' pour valider." : "Image locale chargée ! Cliquez sur 'Appliquer la pochette' pour valider.", "info");
    };
    reader.readAsDataURL(file);
}

function renderCoverCandidates(candidates) {
    if (!coverSearchGrid) return;
    coverSearchGrid.innerHTML = "";

    const filtered = candidates.filter(c => {
        if (activeCoverFilter === "all") return true;
        return c.source && c.source.toLowerCase().includes(activeCoverFilter.toLowerCase());
    });

    if (filtered.length === 0) {
        if (coverSearchEmpty) coverSearchEmpty.style.display = "block";
        return;
    } else {
        if (coverSearchEmpty) coverSearchEmpty.style.display = "none";
    }

    filtered.forEach((cand, idx) => {
        const card = document.createElement("div");
        card.className = "cover-candidate-card";
        card.setAttribute("data-index", idx);

        const thumb = cand.thumbnail || "/static/placeholder-cover.svg";
        const metaParts = [];
        if (cand.year) metaParts.push(cand.year);
        if (cand.track_count) metaParts.push(`${cand.track_count} pistes`);
        const metaStr = metaParts.join(" • ");

        // Classe de badge source
        let tagClass = "apple";
        let srcLabel = cand.badge || cand.source || "Officiel";
        if (cand.source === "Presse-papier" || (cand.badge && cand.badge.includes("Presse-papier"))) {
            tagClass = "clipboard";
            srcLabel = "📋 Presse-papier";
        } else if (cand.isLocal) {
            tagClass = "local";
            srcLabel = "📁 Fichier local";
        } else if (cand.source === "Deezer") {
            tagClass = "deezer";
            srcLabel = "🎵 Deezer HD";
        } else if (cand.source === "YouTube Music") {
            tagClass = "youtube";
            srcLabel = "▶ YouTube Music";
        } else if (cand.source === "Apple Music") {
            tagClass = "apple";
            srcLabel = "🍎 Apple Music";
        }

        const isCurrentlySelected = (cand.isLocal && selectedCandidateCoverBase64 === cand.base64) ||
            (!cand.isLocal && selectedCandidateCoverUrl === cand.thumbnail);

        if (isCurrentlySelected) {
            card.classList.add("selected");
        }

        card.innerHTML = `
            <div class="cover-candidate-thumb-wrap">
                <span class="cover-source-tag ${tagClass}">${escapeHtml(srcLabel)}</span>
                <img class="cover-candidate-thumb" src="${escapeHtml(thumb)}" alt="Pochette candidate" referrerpolicy="no-referrer" loading="lazy" onerror="window.handleCoverError(this);">
                <span class="cover-candidate-badge">✓ Choisi</span>
            </div>
            <div class="cover-candidate-info">
                <span class="cover-candidate-title" title="${escapeHtml(cand.title)}">${escapeHtml(cand.title)}</span>
                <span class="cover-candidate-artist" title="${escapeHtml(cand.artist)}">${escapeHtml(cand.artist)}</span>
                ${metaStr ? `<span class="cover-candidate-meta">${escapeHtml(metaStr)}</span>` : ""}
            </div>
        `;

        card.addEventListener("click", () => {
            selectCoverCandidate(cand, card);
        });

        // Double-clic = validation immédiate
        card.addEventListener("dblclick", () => {
            selectCoverCandidate(cand, card);
            applySelectedCover();
        });

        coverSearchGrid.appendChild(card);
    });
}

function selectCoverCandidate(cand, cardEl = null) {
    document.querySelectorAll(".cover-candidate-card").forEach(c => c.classList.remove("selected"));
    if (cardEl) {
        cardEl.classList.add("selected");
    } else {
        const firstCard = document.querySelector(".cover-candidate-card");
        if (firstCard) firstCard.classList.add("selected");
    }

    if (cand.isLocal) {
        selectedCandidateCoverBase64 = cand.base64;
        selectedCandidateCoverUrl = null;
    } else {
        selectedCandidateCoverUrl = cand.thumbnail;
        selectedCandidateCoverBase64 = null;
    }

    if (btnApplyCover) {
        btnApplyCover.disabled = false;
    }
    if (coverSearchHint) {
        const srcText = cand.badge || cand.source || "Source";
        coverSearchHint.innerHTML = `Sélectionné : <strong>${escapeHtml(cand.title)}</strong> (${escapeHtml(srcText)})`;
    }
}

async function applySelectedCover() {
    const albumPath = window._coverModalTargetAlbumPath || getActiveEditorAlbumPath();
    if (!albumPath) {
        showToast("Chemin de l'album introuvable.", "danger");
        return;
    }
    if (!selectedCandidateCoverUrl && !selectedCandidateCoverBase64) {
        showToast("Veuillez sélectionner une pochette à appliquer.", "warning");
        return;
    }

    if (btnApplyCover) {
        btnApplyCover.disabled = true;
    }
    if (coverSearchApplyText) {
        coverSearchApplyText.textContent = "Application de la pochette...";
    }

    try {
        const payload = {
            album_path: albumPath,
            cover_url: selectedCandidateCoverUrl,
            cover_base64: selectedCandidateCoverBase64,
            embed_in_tags: true
        };

        const res = await fetch("/api/album/apply-cover", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.success) {
            const canonicalPath = data.album_path || albumPath;
            const cacheBuster = Date.now();
            const newCoverSrc = `/api/audio/cover?path=${encodeURIComponent(canonicalPath)}&t=${cacheBuster}`;

            function isSameAlbumPath(p1, p2) {
                if (!p1 || !p2) return false;
                const c1 = String(p1).replace(/[\\/]+/g, "/").toLowerCase().replace(/\/+$/, "").trim();
                const c2 = String(p2).replace(/[\\/]+/g, "/").toLowerCase().replace(/\/+$/, "").trim();
                return c1 === c2;
            }

            // 1. Mettre à jour l'image de couverture dans l'Éditeur
            const editorCover = document.getElementById("editor-cover");
            if (editorCover) {
                editorCover.src = newCoverSrc;
            }

            // Si cet album est actuellement ouvert dans l'Éditeur
            if (typeof currentAlbumInfo !== "undefined" && currentAlbumInfo && isSameAlbumPath(currentAlbumInfo.album_dir, canonicalPath)) {
                currentAlbumInfo.cover_art = `${canonicalPath}/cover.jpg`;
                currentAlbumInfo.cover_url = newCoverSrc;
            }

            // 2. Mettre à jour dans le lecteur audio s'il est en cours
            if (typeof AudioPlayer !== "undefined" && AudioPlayer) {
                if (AudioPlayer.currentAlbum && (isSameAlbumPath(AudioPlayer.currentAlbum.path, canonicalPath) || isSameAlbumPath(AudioPlayer.currentAlbum.album_path, canonicalPath))) {
                    AudioPlayer.currentAlbum.cover_url = newCoverSrc;
                    const npThumb = document.getElementById("player-cover-img");
                    if (npThumb) npThumb.src = newCoverSrc;
                    const miniThumb = document.getElementById("mini-player-thumb");
                    if (miniThumb) miniThumb.src = newCoverSrc;
                }
                if (AudioPlayer.libraryAlbums && Array.isArray(AudioPlayer.libraryAlbums)) {
                    AudioPlayer.libraryAlbums.forEach(alb => {
                        if (isSameAlbumPath(alb.path, canonicalPath)) {
                            alb.has_cover = true;
                            alb.cover_file = `${canonicalPath}/cover.jpg`;
                            alb.cover_url = newCoverSrc;
                            alb.mtime = Math.floor(cacheBuster / 1000);
                        }
                    });
                }
                if (typeof AudioPlayer.renderCurrentView === "function") {
                    AudioPlayer.renderCurrentView();
                }
            }

            // 3. Mettre à jour dans la Galerie des Jaquettes (Onglet Jaquettes)
            if (window.coversGalleryAlbums && Array.isArray(window.coversGalleryAlbums)) {
                window.coversGalleryAlbums.forEach(alb => {
                    if (isSameAlbumPath(alb.path, canonicalPath)) {
                        alb.has_cover = true;
                        alb.cover_url = newCoverSrc;
                        alb.mtime = Math.floor(cacheBuster / 1000);
                    }
                });
            }

            // 3b. Mettre à jour dans la liste des genres par lots (Onglet Genres par lots)
            if (window.genreBatchAlbums && Array.isArray(window.genreBatchAlbums)) {
                window.genreBatchAlbums.forEach(alb => {
                    if (isSameAlbumPath(alb.path, canonicalPath)) {
                        alb.has_cover = true;
                        alb.cover_url = newCoverSrc;
                        alb.mtime = Math.floor(cacheBuster / 1000);
                    }
                });
            }

            // 3c. Invalider le cache des playlists pour rafraîchir les collages de pochettes
            if (typeof UserPlaylists !== "undefined" && UserPlaylists.playlistCache) {
                UserPlaylists.playlistCache.clear();
            }

            // Mettre à jour immédiatement les éléments existants dans le DOM de la galerie
            document.querySelectorAll(".cover-gallery-card").forEach(card => {
                const cardPath = card.getAttribute("data-path");
                if (isSameAlbumPath(cardPath, canonicalPath)) {
                    const img = card.querySelector("img");
                    if (img) {
                        img.src = newCoverSrc;
                    }
                }
            });

            // Si la fonction de re-rendu de la galerie est disponible, rafraîchir la grille
            if (typeof window.renderCoversGallery === "function") {
                window.renderCoversGallery();
            }

            // 4. Mettre à jour toutes les images du DOM qui référencent cet album
            document.querySelectorAll("img").forEach(img => {
                const card = img.closest("[data-path]");
                if (card && isSameAlbumPath(card.getAttribute("data-path"), canonicalPath)) {
                    img.src = newCoverSrc;
                    return;
                }
                const rawSrc = img.getAttribute("src") || img.src || "";
                if (rawSrc && (rawSrc.includes("/api/audio/cover") || rawSrc.includes("/api/cover"))) {
                    try {
                        const urlObj = new URL(rawSrc, window.location.origin);
                        const p = urlObj.searchParams.get("path");
                        if (p && isSameAlbumPath(p, canonicalPath)) {
                            img.src = newCoverSrc;
                        }
                    } catch (_) {}
                }
            });

            window.coversModifiedInWorkshopCount = (window.coversModifiedInWorkshopCount || 0) + 1;
            closeCoverSearchModal();
            showToast("Jaquette officielle appliquée avec succès (Règle d'Or 100% hauteur) !", "success");
        } else {
            showToast(`Erreur : ${data.detail || data.message || "Échec de l'application"}`, "danger");
        }
    } catch (err) {
        showToast(`Erreur réseau : ${err.message}`, "danger");
    } finally {
        if (btnApplyCover) {
            btnApplyCover.disabled = false;
        }
        if (coverSearchApplyText) {
            coverSearchApplyText.textContent = "Appliquer la pochette";
        }
    }
}

// Filtres par source (Toutes, Apple Music, Deezer, YouTube Music, Local)
document.querySelectorAll(".btn-cover-filter").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".btn-cover-filter").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        activeCoverFilter = btn.getAttribute("data-filter") || "all";
        renderCoverCandidates(currentCoverCandidates);
    });
});

// Événements d'ouverture et fermeture
if (btnOpenCoverSearch) {
    btnOpenCoverSearch.addEventListener("click", () => openCoverSearchModal());
}
if (btnCloseCoverSearch) {
    btnCloseCoverSearch.addEventListener("click", () => closeCoverSearchModal());
}
if (btnCancelCoverSearch) {
    btnCancelCoverSearch.addEventListener("click", () => closeCoverSearchModal());
}
if (coverSearchModal) {
    coverSearchModal.addEventListener("click", (e) => {
        if (e.target === coverSearchModal) {
            closeCoverSearchModal();
        }
    });
}
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && coverSearchModal && coverSearchModal.classList.contains("active")) {
        closeCoverSearchModal();
    }
});
if (btnApplyCover) {
    btnApplyCover.addEventListener("click", applySelectedCover);
}
if (coverSearchForm) {
    coverSearchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const q = coverSearchInput ? coverSearchInput.value.trim() : "";
        if (q) performCoverSearch(q);
    });
}

// Parcourir un fichier local
if (btnBrowseLocalCover && coverLocalFileInput) {
    btnBrowseLocalCover.addEventListener("click", (e) => {
        e.stopPropagation();
        coverLocalFileInput.click();
    });
}
if (coverLocalFileInput) {
    coverLocalFileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) {
            handleLocalCoverFile(e.target.files[0]);
        }
    });
}

// Glisser-déposer sur la zone dédiée dans la modale
if (coverDropzone) {
    coverDropzone.addEventListener("click", () => {
        if (coverLocalFileInput) coverLocalFileInput.click();
    });

    ["dragenter", "dragover"].forEach(evtName => {
        coverDropzone.addEventListener(evtName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            coverDropzone.classList.add("dragover");
        });
    });

    ["dragleave", "drop"].forEach(evtName => {
        coverDropzone.addEventListener(evtName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            coverDropzone.classList.remove("dragover");
        });
    });

    coverDropzone.addEventListener("drop", (e) => {
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            handleLocalCoverFile(files[0]);
        }
    });
}

// Glisser-déposer direct sur la pochette de l'éditeur
const editorCoverBox = document.querySelector(".album-cover-box");
if (editorCoverBox) {
    ["dragenter", "dragover"].forEach(evtName => {
        editorCoverBox.addEventListener(evtName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            editorCoverBox.classList.add("dragover");
        });
    });

    ["dragleave", "drop"].forEach(evtName => {
        editorCoverBox.addEventListener(evtName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            editorCoverBox.classList.remove("dragover");
        });
    });

    editorCoverBox.addEventListener("drop", (e) => {
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            const f = files[0];
            if (f.type.startsWith("image/")) {
                openCoverSearchModal(f);
            }
        }
    });
}

// Coller une image depuis le presse-papier via le bouton dédié
async function pasteImageFromClipboard() {
    try {
        if (navigator.clipboard && navigator.clipboard.read) {
            const clipboardItems = await navigator.clipboard.read();
            for (const item of clipboardItems) {
                for (const type of item.types) {
                    if (type.startsWith("image/")) {
                        const blob = await item.getType(type);
                        if (blob) {
                            handleLocalCoverFile(blob, "Presse-papier");
                            return true;
                        }
                    }
                }
            }
        }
        showToast("Aucune image trouvée dans le presse-papier. Copiez d'abord une image ou utilisez Ctrl+V.", "info");
        return false;
    } catch (err) {
        console.warn("Clipboard read error:", err);
        showToast("Accès direct au presse-papier restreint : utilisez directement le raccourci Ctrl+V !", "info");
        return false;
    }
}
window.pasteImageFromClipboard = pasteImageFromClipboard;

if (btnPasteClipboardCover) {
    btnPasteClipboardCover.addEventListener("click", (e) => {
        e.stopPropagation();
        pasteImageFromClipboard();
    });
}

// Raccourci global Ctrl+V : Détection du collage d'image presse-papier
document.addEventListener("paste", (e) => {
    const items = (e.clipboardData || window.clipboardData)?.items;
    if (!items || items.length === 0) return;

    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
            const file = items[i].getAsFile();
            if (file) {
                e.preventDefault();
                // 1. Si la modale de jaquette est déjà ouverte :
                if (coverSearchModal && coverSearchModal.classList.contains("active")) {
                    handleLocalCoverFile(file, "Presse-papier");
                } else {
                    // 2. Si un album est chargé dans l'Éditeur :
                    const albumPath = getActiveEditorAlbumPath();
                    if (albumPath) {
                        openCoverSearchModal(file, null, "Presse-papier");
                    } else {
                        showToast("Veuillez d'abord sélectionner ou ouvrir un album dans l'Éditeur pour lui coller cette pochette.", "warning");
                    }
                }
                break;
            }
        }
    }
});

// Configuration de la modale d'information lors de la première réduction dans le Systray (zone de notification)
function setupTrayNoticeModal() {
    const modal = document.getElementById("tray-notice-modal");
    const confirmBtn = document.getElementById("tray-notice-confirm-btn");
    if (!modal || !confirmBtn) return;

    confirmBtn.addEventListener("click", () => {
        modal.style.display = "none";

        if (window.electronAPI && window.electronAPI.markTrayNoticeSeen) {
            window.electronAPI.markTrayNoticeSeen();
        }

        fetch("/api/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ has_seen_tray_notice: true })
        }).catch(() => {});

        if (window.electronAPI && window.electronAPI.minimizeToTray) {
            window.electronAPI.minimizeToTray();
        }
    });

    if (window.electronAPI && window.electronAPI.onShowTrayNotice) {
        window.electronAPI.onShowTrayNotice(() => {
            modal.style.display = "flex";
        });
    }

    if (window.electronAPI && window.electronAPI.onNavigateToTab) {
        window.electronAPI.onNavigateToTab((tabId) => {
            if (typeof switchTab === "function") {
                switchTab(tabId);
            }
        });
    }
}

// Configuration de la modale de confirmation de fermeture (✕) avec proposition Systray et sécurisation des processus
function setupCloseConfirmModal() {
    const modal = document.getElementById("close-confirm-modal");
    const quitBtn = document.getElementById("close-confirm-quit-btn");
    const quitText = document.getElementById("close-confirm-quit-text");
    const quitIcon = document.getElementById("close-confirm-quit-icon");
    const minimizeBtn = document.getElementById("close-confirm-minimize-btn");
    const cancelBtn = document.getElementById("close-confirm-cancel-btn");
    const cancelText = document.getElementById("close-confirm-cancel-text");
    const closeIconBtn = document.getElementById("close-confirm-modal-close-btn");
    const busyBox = document.getElementById("close-confirm-busy-box");
    const busyDetails = document.getElementById("close-confirm-busy-details");
    const busyAdvice = document.getElementById("close-confirm-busy-advice");

    if (!modal) return;

    let isCurrentlyBusy = false;
    let isShuttingDown = false;

    async function openModal() {
        isShuttingDown = false;
        if (quitBtn) quitBtn.disabled = false;
        if (minimizeBtn) minimizeBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        if (closeIconBtn) closeIconBtn.disabled = false;

        // Afficher immédiatement la modale pour une réactivité instantanée à la fermeture
        modal.style.display = "flex";
        requestAnimationFrame(() => modal.classList.add("active"));

        try {
            const urlParams = new URLSearchParams(window.location.search);
            let data = null;
            if (urlParams.get("mockBusy") === "true") {
                data = {
                    busy: true,
                    details: ["Synchronisation et organisation de la collection musicale (en cours...)"]
                };
            } else {
                const res = await fetch("/api/system/busy-status");
                if (res.ok) {
                    data = await res.json();
                }
            }
            if (data) {
                isCurrentlyBusy = Boolean(data.busy);
                if (data.busy) {
                    if (busyBox) busyBox.style.display = "block";
                    if (busyDetails) {
                        const items = (data.details || []).map(d => `• ${d}`).join("<br>");
                        busyDetails.innerHTML = items || "Opérations d'arrière-plan en cours d'exécution...";
                    }
                    if (busyAdvice) {
                        busyAdvice.textContent = "L'interruption attendra la fin du fichier en cours (quelques ms) pour couper les opérations proprement sans aucun risque de corruption. Il reste vivement conseillé de réduire près de l'horloge ou de patienter.";
                    }

                    // Interrompre proprement : à gauche (order: 1)
                    if (quitBtn) {
                        quitBtn.className = "btn btn-ghost-danger";
                        quitBtn.style.order = "1";
                        quitBtn.style.marginRight = "auto";
                        quitBtn.title = "Termine le fichier actuel et quitte proprement sans corruption";
                    }
                    if (quitText) quitText.textContent = "🛑 Interrompre & Quitter";
                    if (quitIcon) quitIcon.style.display = "none";

                    // Réduire près de l'horloge : au centre (order: 2)
                    if (minimizeBtn) {
                        minimizeBtn.className = "btn btn-secondary btn-sm";
                        minimizeBtn.style.order = "2";
                    }

                    // Annuler et patienter : MIS EN AVANT à droite (order: 3)
                    if (cancelBtn) {
                        cancelBtn.className = "btn btn-safe-prominent";
                        cancelBtn.style.order = "3";
                        cancelBtn.style.marginRight = "0";
                    }
                    if (cancelText) cancelText.innerHTML = "🛡️ Patienter (Annuler)";
                } else {
                    if (busyBox) busyBox.style.display = "none";

                    // Mode standard : Annuler à gauche (order: 1)
                    if (cancelBtn) {
                        cancelBtn.className = "btn btn-secondary btn-sm";
                        cancelBtn.style.order = "1";
                        cancelBtn.style.marginRight = "auto";
                    }
                    if (cancelText) cancelText.textContent = "Annuler";

                    // Réduire au centre (order: 2)
                    if (minimizeBtn) {
                        minimizeBtn.className = "btn btn-secondary btn-sm";
                        minimizeBtn.style.order = "2";
                    }

                    // Fermer à droite en rouge classique (order: 3)
                    if (quitBtn) {
                        quitBtn.className = "btn btn-danger btn-sm";
                        quitBtn.style.order = "3";
                        quitBtn.style.marginRight = "0";
                        quitBtn.title = "Arrêter complètement l'application et les serveurs";
                    }
                    if (quitText) quitText.textContent = "✕ Fermer l'application";
                    if (quitIcon) quitIcon.style.display = "inline";
                }
            }
        } catch (e) {
            // Mode silencieux si indisponible
        }
    }

    function closeModal() {
        modal.classList.remove("active");
        setTimeout(() => {
            if (!modal.classList.contains("active")) {
                modal.style.display = "none";
            }
        }, 250);
    }

    if (quitBtn) {
        quitBtn.addEventListener("click", async () => {
            if (isShuttingDown) return;
            if (isCurrentlyBusy) {
                isShuttingDown = true;
                if (quitBtn) quitBtn.disabled = true;
                if (minimizeBtn) minimizeBtn.disabled = true;
                if (cancelBtn) cancelBtn.disabled = true;
                if (closeIconBtn) closeIconBtn.disabled = true;
                if (quitText) quitText.innerHTML = "⏳ Sécurisation...";
                try {
                    const res = await fetch("/api/system/graceful-shutdown", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" }
                    });
                    if (res.ok) {
                        const r = await res.json();
                        console.log("[GracefulShutdown] Arrêt propre confirmé:", r);
                    }
                } catch (e) {
                    console.warn("[GracefulShutdown] Exception fetch:", e);
                }
            }
            closeModal();
            if (window.electronAPI && window.electronAPI.confirmQuit) {
                window.electronAPI.confirmQuit();
            }
        });
    }

    if (minimizeBtn) {
        minimizeBtn.addEventListener("click", () => {
            closeModal();
            if (window.electronAPI && window.electronAPI.minimizeToTray) {
                window.electronAPI.minimizeToTray();
            }
        });
    }

    if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
    if (closeIconBtn) closeIconBtn.addEventListener("click", closeModal);

    const headerQuitBtn = document.getElementById("btn-header-quit");
    if (headerQuitBtn) {
        headerQuitBtn.addEventListener("click", () => {
            openModal();
        });
    }

    window.openCloseConfirmModal = openModal;

    modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();
    });

    if (window.electronAPI && window.electronAPI.onShowCloseConfirmModal) {
        window.electronAPI.onShowCloseConfirmModal(() => {
            openModal();
        });
    }

    const initParams = new URLSearchParams(window.location.search);
    if (initParams.get("modal") === "close-confirm") {
        setTimeout(openModal, 400);
    }
}

// Configuration du bouton flottant plein écran universel (F11)
function setupFloatingFullscreen() {
    const btn = document.getElementById("floating-fullscreen-btn");
    const iconExpand = document.getElementById("fullscreen-icon-expand");
    const iconCompress = document.getElementById("fullscreen-icon-compress");

    if (!btn) return;

    function updateFullscreenUI(isFs) {
        window.isAppFullscreen = Boolean(isFs);
        if (iconExpand) iconExpand.style.display = isFs ? "none" : "block";
        if (iconCompress) iconCompress.style.display = isFs ? "block" : "none";
        btn.title = isFs ? "Quitter le plein écran (F11)" : "Basculer en plein écran (F11)";
        if (window.ScreenWakeLockManager) {
            window.ScreenWakeLockManager.update();
        }
    }

    btn.addEventListener("click", async () => {
        if (window.electronAPI && window.electronAPI.toggleFullscreen) {
            try {
                const isFs = await window.electronAPI.toggleFullscreen();
                updateFullscreenUI(Boolean(isFs));
            } catch (e) {
                console.warn("Fullscreen toggle error:", e);
            }
        } else {
            // Repli HTML5 standard
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
            } else {
                document.exitFullscreen().catch(() => {});
            }
        }
    });

    // Écouteur des changements provenant d'Electron
    if (window.electronAPI && window.electronAPI.onFullscreenChanged) {
        window.electronAPI.onFullscreenChanged((isFs) => {
            updateFullscreenUI(Boolean(isFs));
        });
    }

    // Écouteur HTML5 pour F11 ou changements manuels
    document.addEventListener("fullscreenchange", () => {
        updateFullscreenUI(Boolean(document.fullscreenElement));
    });

    // État initial
    if (window.electronAPI && window.electronAPI.isFullscreen) {
        window.electronAPI.isFullscreen().then(isFs => updateFullscreenUI(Boolean(isFs))).catch(() => {});
    }
}


window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.switchSettingsSubtab = switchSettingsSubtab;
window.showMigrationModal = showMigrationModal;
window.closeMigrationModal = closeMigrationModal;
window.setupSettings = setupSettings;
window.setupAppReset = setupAppReset;
window.updateQuickDestButtons = updateQuickDestButtons;
window.setupQuickDestButtons = setupQuickDestButtons;
window.loadConfiguration = loadConfiguration;
window.setupTrayNoticeModal = setupTrayNoticeModal;
window.setupCloseConfirmModal = setupCloseConfirmModal;
window.setupFloatingFullscreen = setupFloatingFullscreen;

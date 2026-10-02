/**
 * SoundStash - Gestionnaire de Mises à Jour de l'Application (GitHub Releases)
 * Permet la détection automatique ou manuelle, le téléchargement in-app avec progression,
 * le lancement de l'installeur ou la redirection vers le navigateur.
 */

window.AppUpdater = {
    currentVersion: "3.2.4",
    latestRelease: null,
    isChecking: false,
    isDownloading: false,
    pollInterval: null,
    installerPath: null,

    init() {
        const btnCheck = document.getElementById("btn-check-app-update");
        const autoCheckCheckbox = document.getElementById("cfg-auto-check-app-updates");
        const headerUpdateBtn = document.getElementById("btn-header-update");
        const modalCloseBtn = document.getElementById("app-update-btn-close");
        const modalBrowserBtn = document.getElementById("app-update-btn-browser");
        const modalDownloadBtn = document.getElementById("app-update-btn-download");
        const modalInstallBtn = document.getElementById("app-update-btn-install");
        const modalBackdrop = document.getElementById("app-update-modal-backdrop");

        if (btnCheck) {
            btnCheck.addEventListener("click", () => this.check(true));
        }

        if (autoCheckCheckbox) {
            autoCheckCheckbox.addEventListener("change", async (e) => {
                try {
                    await fetch("/api/config", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ auto_check_app_updates: e.target.checked })
                    });
                } catch (err) {
                    console.error("Erreur enregistrement option auto_check_app_updates:", err);
                }
            });
        }

        if (headerUpdateBtn) {
            headerUpdateBtn.addEventListener("click", () => {
                if (this.latestRelease) {
                    this.openModal(this.latestRelease);
                } else {
                    this.check(true);
                }
            });
        }

        if (modalCloseBtn) {
            modalCloseBtn.addEventListener("click", () => this.closeModal());
        }

        if (modalBackdrop) {
            modalBackdrop.addEventListener("click", (e) => {
                if (e.target === modalBackdrop && !this.isDownloading) {
                    this.closeModal();
                }
            });
        }

        if (modalBrowserBtn) {
            modalBrowserBtn.addEventListener("click", () => this.openInBrowser());
        }

        if (modalDownloadBtn) {
            modalDownloadBtn.addEventListener("click", () => this.startDownload());
        }

        if (modalInstallBtn) {
            modalInstallBtn.addEventListener("click", () => this.installUpdate());
        }

        // Vérification silencieuse différée au démarrage
        setTimeout(() => {
            this.checkStartup();
        }, 3500);
    },

    async checkStartup() {
        try {
            const cfgRes = await fetch("/api/config");
            if (cfgRes.ok) {
                const cfg = await cfgRes.json();
                if (cfg.auto_check_app_updates !== false) {
                    await this.check(false);
                }
            }
        } catch (e) {
            // Ignorer silencieusement les erreurs de check au démarrage
        }
    },

    async check(isManual = false) {
        if (this.isChecking) return;
        this.isChecking = true;

        const btnCheck = document.getElementById("btn-check-app-update");
        const iconCheck = document.getElementById("icon-check-app-update");
        const labelCheck = document.getElementById("label-check-app-update");
        const alertCard = document.getElementById("app-update-result-alert");

        if (btnCheck) btnCheck.disabled = true;
        if (iconCheck) iconCheck.style.animation = "spin 1s linear infinite";
        if (labelCheck) labelCheck.textContent = "Recherche en cours...";
        if (alertCard && isManual) alertCard.style.display = "none";

        try {
            const res = await fetch("/api/app/update/check");
            const data = await res.json();

            if (!res.ok || data.error) {
                throw new Error(data.error || "Impossible de vérifier les mises à jour");
            }

            if (data.update_available) {
                this.latestRelease = data;
                this.updateHeaderBadge(data);

                if (alertCard) {
                    alertCard.style.display = "block";
                    alertCard.style.background = "rgba(16, 185, 129, 0.15)";
                    alertCard.style.border = "1px solid #10b981";
                    alertCard.style.color = "#6ee7b7";
                    alertCard.innerHTML = `🎉 <strong>Nouvelle version disponible :</strong> v${escapeHtml(data.latest_version)} ! <button type="button" class="btn btn-sm btn-primary" style="margin-left: 8px; padding: 2px 10px; font-size: 0.8rem; font-weight: 600;" onclick="window.AppUpdater.openModal(window.AppUpdater.latestRelease)">Voir les détails</button>`;
                }

                if (isManual) {
                    this.openModal(data);
                } else {
                    if (typeof showToast === "function") {
                        showToast(`Nouvelle mise à jour SoundStash v${data.latest_version} disponible !`, "info");
                    }
                }
            } else {
                this.latestRelease = null;
                const headerBadge = document.getElementById("btn-header-update");
                if (headerBadge) headerBadge.style.display = "none";

                if (isManual) {
                    if (alertCard) {
                        alertCard.style.display = "block";
                        alertCard.style.background = "rgba(59, 130, 246, 0.15)";
                        alertCard.style.border = "1px solid #3b82f6";
                        alertCard.style.color = "#93c5fd";
                        alertCard.innerHTML = `✓ <strong>SoundStash est à jour :</strong> vous utilisez déjà la version la plus récente (<code>v${escapeHtml(data.current_version || this.currentVersion)}</code>).`;
                    }
                    if (typeof showToast === "function") {
                        showToast(`SoundStash est à jour (v${data.current_version || this.currentVersion})`, "info");
                    }
                }
            }
        } catch (err) {
            console.error("Erreur lors de la vérification de mise à jour SoundStash:", err);
            if (isManual) {
                if (alertCard) {
                    alertCard.style.display = "block";
                    alertCard.style.background = "rgba(239, 68, 68, 0.2)";
                    alertCard.style.border = "1px solid #ef4444";
                    alertCard.style.color = "#fca5a5";
                    alertCard.innerHTML = `⚠️ <strong>Erreur :</strong> ${escapeHtml(err.message || "Échec de connexion aux serveurs GitHub")}`;
                }
                if (typeof showToast === "function") {
                    showToast("Impossible de vérifier les mises à jour SoundStash", "danger");
                }
            }
        } finally {
            this.isChecking = false;
            if (btnCheck) btnCheck.disabled = false;
            if (iconCheck) iconCheck.style.animation = "";
            if (labelCheck) labelCheck.textContent = "Rechercher une mise à jour";
        }
    },

    updateHeaderBadge(data) {
        const headerBadge = document.getElementById("btn-header-update");
        const headerLabel = document.getElementById("header-update-label");
        if (headerBadge) {
            headerBadge.style.display = "inline-flex";
            if (headerLabel) headerLabel.textContent = `MÀJ v${data.latest_version}`;
        }
    },

    openModal(data) {
        if (!data) return;
        const modal = document.getElementById("app-update-modal-backdrop");
        if (!modal) return;

        const currentVerEl = document.getElementById("app-update-current-ver");
        const targetVerEl = document.getElementById("app-update-target-ver");
        const assetSizeEl = document.getElementById("app-update-asset-size");
        const releaseNotesEl = document.getElementById("app-update-release-notes");
        const progressContainer = document.getElementById("app-update-progress-container");
        const errorAlert = document.getElementById("app-update-error-alert");
        const btnDownload = document.getElementById("app-update-btn-download");
        const btnInstall = document.getElementById("app-update-btn-install");

        if (currentVerEl) currentVerEl.textContent = `v${data.current_version || this.currentVersion}`;
        if (targetVerEl) targetVerEl.textContent = `v${data.latest_version}`;
        if (assetSizeEl) {
            const mb = data.asset_size ? (data.asset_size / (1024 * 1024)).toFixed(1) : "--";
            assetSizeEl.textContent = `${mb} Mo`;
        }

        if (releaseNotesEl) {
            releaseNotesEl.textContent = data.release_notes || "Aucune note de version fournie.";
        }

        if (progressContainer) progressContainer.style.display = "none";
        if (errorAlert) errorAlert.style.display = "none";
        if (btnDownload) {
            btnDownload.style.display = "inline-flex";
            btnDownload.disabled = false;
        }
        if (btnInstall) btnInstall.style.display = "none";

        modal.style.display = "flex";
        modal.classList.add("active");
    },

    closeModal() {
        const modal = document.getElementById("app-update-modal-backdrop");
        if (!modal) return;
        modal.classList.remove("active");
        setTimeout(() => {
            modal.style.display = "none";
        }, 200);
    },

    async openInBrowser() {
        const url = (this.latestRelease && this.latestRelease.html_url) || "https://github.com/lehcimcramtrebor/SoundStash/releases";
        try {
            if (window.electronAPI && typeof window.electronAPI.openExternal === "function") {
                await window.electronAPI.openExternal(url);
                return;
            }
        } catch (e) {
            console.warn("electronAPI.openExternal a échoué, essai fallback HTTP:", e);
        }

        try {
            await fetch("/api/app/update/open-browser", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: url })
            });
        } catch (e) {
            window.open(url, "_blank");
        }
    },

    async startDownload() {
        if (!this.latestRelease || !this.latestRelease.download_url) {
            if (typeof showToast === "function") showToast("URL de téléchargement introuvable pour Windows.", "danger");
            return;
        }

        const btnDownload = document.getElementById("app-update-btn-download");
        const progressContainer = document.getElementById("app-update-progress-container");
        const errorAlert = document.getElementById("app-update-error-alert");
        const progressBar = document.getElementById("app-update-progress-bar");
        const progressPercent = document.getElementById("app-update-progress-percent");
        const progressStatus = document.getElementById("app-update-progress-status");
        const progressDetails = document.getElementById("app-update-progress-details");

        this.isDownloading = true;
        if (btnDownload) btnDownload.disabled = true;
        if (progressContainer) progressContainer.style.display = "block";
        if (errorAlert) errorAlert.style.display = "none";
        if (progressBar) progressBar.style.width = "0%";
        if (progressPercent) progressPercent.textContent = "0%";
        if (progressStatus) {
            progressStatus.textContent = "Initialisation du téléchargement...";
            progressStatus.style.color = "#60a5fa";
        }
        if (progressDetails) progressDetails.textContent = "Connexion...";

        try {
            const startRes = await fetch("/api/app/update/download", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    download_url: this.latestRelease.download_url,
                    asset_name: this.latestRelease.asset_name,
                    version: this.latestRelease.latest_version
                })
            });

            const startData = await startRes.json();
            if (!startRes.ok || (startData.status !== "started" && startData.status !== "already_downloading")) {
                throw new Error(startData.error || "Impossible de démarrer le téléchargement");
            }

            // Polling de progression
            if (this.pollInterval) clearInterval(this.pollInterval);
            this.pollInterval = setInterval(async () => {
                try {
                    const progRes = await fetch("/api/app/update/progress");
                    const prog = await progRes.json();

                    if (prog.status === "downloading") {
                        if (progressBar) progressBar.style.width = `${prog.percentage}%`;
                        if (progressPercent) progressPercent.textContent = `${prog.percentage}%`;
                        if (progressStatus) progressStatus.textContent = "Téléchargement de la mise à jour...";
                        const curMb = (prog.downloaded_bytes / (1024 * 1024)).toFixed(1);
                        const totMb = (prog.total_bytes / (1024 * 1024)).toFixed(1);
                        if (progressDetails) progressDetails.textContent = `${curMb} Mo / ${totMb} Mo`;
                    } else if (prog.status === "completed") {
                        clearInterval(this.pollInterval);
                        this.pollInterval = null;
                        this.isDownloading = false;
                        this.installerPath = prog.installer_path;

                        if (progressBar) progressBar.style.width = "100%";
                        if (progressPercent) progressPercent.textContent = "100%";
                        if (progressStatus) {
                            progressStatus.textContent = "Téléchargement terminé avec succès ! Prêt à installer.";
                            progressStatus.style.color = "#10b981";
                        }
                        if (btnDownload) btnDownload.style.display = "none";
                        const btnInstall = document.getElementById("app-update-btn-install");
                        if (btnInstall) {
                            btnInstall.style.display = "inline-flex";
                            btnInstall.disabled = false;
                        }
                    } else if (prog.status === "error") {
                        clearInterval(this.pollInterval);
                        this.pollInterval = null;
                        this.isDownloading = false;
                        if (btnDownload) btnDownload.disabled = false;
                        if (errorAlert) {
                            errorAlert.style.display = "block";
                            errorAlert.textContent = `Erreur : ${prog.error || "Échec du téléchargement"}`;
                        }
                    }
                } catch (pe) {
                    console.error("Erreur polling progress:", pe);
                }
            }, 400);

        } catch (err) {
            this.isDownloading = false;
            if (btnDownload) btnDownload.disabled = false;
            if (errorAlert) {
                errorAlert.style.display = "block";
                errorAlert.textContent = `Erreur : ${err.message}`;
            }
        }
    },

    async installUpdate() {
        if (!this.installerPath) {
            if (typeof showToast === "function") showToast("Chemin de l'installeur introuvable", "danger");
            return;
        }

        const btnInstall = document.getElementById("app-update-btn-install");
        if (btnInstall) {
            btnInstall.disabled = true;
            btnInstall.textContent = "Lancement de l'installeur...";
        }

        try {
            // Vérification de sécurité : vérifier si un téléchargement est en cours
            try {
                const checkRes = await fetch("/api/status");
                if (checkRes.ok) {
                    const statusData = await checkRes.json();
                    if (statusData.is_downloading) {
                        if (typeof showToast === "function") {
                            showToast("Un téléchargement est en cours. Veuillez patienter avant d'installer la mise à jour.", "warning", 5000);
                        }
                        if (btnInstall) {
                            btnInstall.disabled = false;
                            btnInstall.textContent = "Lancer l'installation";
                        }
                        return;
                    }
                }
            } catch (ignore) {}

            // 1. Priorité Electron native : détachement absolu de l'installeur et fermeture propre
            if (window.electronAPI && typeof window.electronAPI.installUpdate === "function") {
                if (typeof showToast === "function") {
                    showToast("Fermeture de SoundStash pour application de la mise à jour...", "info", 4000);
                }
                this.closeModal();
                const res = await window.electronAPI.installUpdate(this.installerPath);
                if (res && res.error) {
                    throw new Error(res.error);
                }
                return;
            }

            // 2. Fallback hors Electron (ex: mode web standard)
            const res = await fetch("/api/app/update/install", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ installer_path: this.installerPath })
            });
            const data = await res.json();
            const isSuccess = data.success === true || data.status === "success";
            if (!res.ok || !isSuccess) {
                if (data.status === "downloading_active") {
                    if (typeof showToast === "function") {
                        showToast(data.error || "Téléchargement en cours. Veuillez patienter.", "warning", 5000);
                    }
                    if (btnInstall) {
                        btnInstall.disabled = false;
                        btnInstall.textContent = "Lancer l'installation";
                    }
                    return;
                }
                throw new Error(data.error || "Impossible d'exécuter l'installeur");
            }

            if (typeof showToast === "function") {
                showToast("Fermeture de SoundStash pour application de la mise à jour...", "info", 3000);
            }

            this.closeModal();

            // Fermeture propre de SoundStash pour laisser l'installeur s'exécuter
            setTimeout(() => {
                if (window.electronAPI && typeof window.electronAPI.confirmQuit === "function") {
                    window.electronAPI.confirmQuit();
                } else {
                    window.close();
                }
            }, 800);

        } catch (err) {
            if (btnInstall) {
                btnInstall.disabled = false;
                btnInstall.textContent = "Lancer l'installation";
            }
            if (typeof showToast === "function") showToast(`Erreur : ${err.message}`, "danger");
        }
    }
};

document.addEventListener("DOMContentLoaded", () => {
    window.AppUpdater.init();
});

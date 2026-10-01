/**
 * SoundStash Extras - Guide Utilisateur & Assistant de Premier Démarrage (Wizard)
 * Manuel d'utilisation interactif et assistant de configuration des répertoires de collection.
 */

// =========================================================
// Grand Guide / Manuel d'Utilisation Intégré
// =========================================================
function setupUserGuideModal() {
    const backdrop = document.getElementById("user-guide-modal-backdrop");
    const closeBtn = document.getElementById("close-user-guide-btn");
    const navItems = document.querySelectorAll(".guide-nav-item");

    if (!backdrop) return;

    function openGuide() {
        backdrop.style.display = "flex";
        void backdrop.offsetWidth;
        backdrop.classList.add("active");
    }

    function closeGuide() {
        backdrop.classList.remove("active");
        setTimeout(() => {
            backdrop.style.display = "none";
        }, 200);
    }

    if (closeBtn) closeBtn.addEventListener("click", closeGuide);

    backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) closeGuide();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && backdrop.classList.contains("active")) {
            closeGuide();
            e.stopPropagation();
        }
    });

    navItems.forEach(btn => {
        btn.addEventListener("click", () => {
            navItems.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            const targetId = btn.getAttribute("data-guide-target");
            const targetEl = document.getElementById(targetId);
            if (targetEl) {
                targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        });
    });

    const btnHeaderHelp = document.getElementById("btn-header-help");
    if (btnHeaderHelp) btnHeaderHelp.addEventListener("click", openGuide);

    const btnSettingsManual = document.getElementById("btn-settings-header-manual");
    if (btnSettingsManual) btnSettingsManual.addEventListener("click", openGuide);

    const btnSubtabManual = document.getElementById("btn-settings-open-manual");
    if (btnSubtabManual) btnSubtabManual.addEventListener("click", openGuide);

    const btnWizardManual = document.getElementById("btn-wizard-open-manual");
    if (btnWizardManual) btnWizardManual.addEventListener("click", openGuide);

    window.openUserGuideModal = openGuide;
}

// =========================================================
// Assistant d'Accueil & Configuration Rapide (Wizard)
// =========================================================
function openWelcomeWizard() {
    const backdrop = document.getElementById("welcome-wizard-backdrop");
    if (!backdrop) return;

    const musicInput = document.getElementById("wizard-music-dir");
    const videoInput = document.getElementById("wizard-video-dir");
    const dontShowCheckbox = document.getElementById("wizard-dont-show-again");

    if (currentConfig) {
        if (musicInput) musicInput.value = currentConfig.library_dir || currentConfig.export_dir || "";
        if (videoInput) videoInput.value = currentConfig.video_library_dir || currentConfig.video_export_dir || "";
    }
    if (dontShowCheckbox) {
        dontShowCheckbox.checked = localStorage.getItem("ytm_hide_welcome_wizard") === "true";
    }

    backdrop.style.display = "flex";
    void backdrop.offsetWidth;
    backdrop.classList.add("active");
}

function closeWelcomeWizard() {
    const backdrop = document.getElementById("welcome-wizard-backdrop");
    const dontShowCheckbox = document.getElementById("wizard-dont-show-again");
    if (dontShowCheckbox) {
        if (dontShowCheckbox.checked) {
            localStorage.setItem("ytm_hide_welcome_wizard", "true");
        } else {
            localStorage.removeItem("ytm_hide_welcome_wizard");
        }
    }
    if (backdrop) {
        backdrop.classList.remove("active");
        setTimeout(() => {
            backdrop.style.display = "none";
        }, 200);
    }
}

async function saveWizardDirs() {
    const musicInput = document.getElementById("wizard-music-dir");
    const videoInput = document.getElementById("wizard-video-dir");
    const musicDir = musicInput ? musicInput.value.trim() : "";
    const videoDir = videoInput ? videoInput.value.trim() : "";

    const payload = {};
    if (musicDir) {
        payload.library_dir = musicDir;
        payload.export_dir = musicDir;
    }
    if (videoDir) {
        payload.video_library_dir = videoDir;
        payload.video_export_dir = videoDir;
    }

    try {
        const res = await fetch("/api/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            const updated = await res.json();
            currentConfig = { ...currentConfig, ...updated };
            showSyncToast("Dossiers de collection enregistrés !", "green", "", 3500);
            if (typeof loadLibrary === "function") loadLibrary();
            if (typeof loadConfiguration === "function") loadConfiguration();
        } else {
            showSyncToast("Erreur lors de l'enregistrement", "orange", "", 3500);
        }
    } catch (e) {
        console.error("Erreur saveWizardDirs:", e);
        showSyncToast("Erreur réseau lors de la sauvegarde", "orange", "", 3500);
    }
}

function setupWelcomeWizard() {
    const backdrop = document.getElementById("welcome-wizard-backdrop");
    const closeBtn = document.getElementById("close-welcome-wizard-btn");
    const finishBtn = document.getElementById("btn-wizard-finish");
    const browseMusicBtn = document.getElementById("btn-wizard-browse-music");
    const browseVideoBtn = document.getElementById("btn-wizard-browse-video");
    const saveDirsBtn = document.getElementById("btn-wizard-save-dirs");
    const openWizardFromSettingsBtn = document.getElementById("btn-settings-open-wizard");

    if (!backdrop) return;

    if (closeBtn) closeBtn.addEventListener("click", closeWelcomeWizard);
    if (finishBtn) {
        finishBtn.addEventListener("click", async () => {
            await saveWizardDirs();
            closeWelcomeWizard();
        });
    }

    if (browseMusicBtn) {
        browseMusicBtn.addEventListener("click", () => {
            browseFolder("wizard-music-dir");
        });
    }
    if (browseVideoBtn) {
        browseVideoBtn.addEventListener("click", () => {
            browseFolder("wizard-video-dir");
        });
    }
    if (saveDirsBtn) {
        saveDirsBtn.addEventListener("click", saveWizardDirs);
    }
    if (openWizardFromSettingsBtn) {
        openWizardFromSettingsBtn.addEventListener("click", () => {
            closeSettingsModal();
            openWelcomeWizard();
        });
    }

    backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) closeWelcomeWizard();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && backdrop.classList.contains("active")) {
            closeWelcomeWizard();
            e.stopPropagation();
        }
    });

    // Ouverture automatique au premier démarrage si non masqué
    const shouldHide = localStorage.getItem("ytm_hide_welcome_wizard") === "true";
    const urlParams = new URLSearchParams(window.location.search);
    const isAudit = urlParams.has("tab") || urlParams.has("modal") || urlParams.has("theme") || urlParams.has("wizard");
    if (!shouldHide && !isAudit) {
        setTimeout(() => {
            openWelcomeWizard();
        }, 800);
    } else if (urlParams.get("wizard") === "open" || urlParams.get("modal") === "wizard") {
        setTimeout(() => {
            openWelcomeWizard();
        }, 300);
    }
}


window.setupUserGuideModal = setupUserGuideModal;
window.openWelcomeWizard = openWelcomeWizard;
window.closeWelcomeWizard = closeWelcomeWizard;
window.setupWelcomeWizard = setupWelcomeWizard;

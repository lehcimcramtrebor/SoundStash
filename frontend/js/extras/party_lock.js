/**
 * SoundStash Extras - Mode Soirée & Sécurité par Code PIN (Party Lock)
 * Verrouillage de la file d'attente, neutralisation des suppressions et restriction d'accès.
 */

// =========================================================
// Gestionnaire Sécurité & Verrouillage Mode Soirée (Party Lock)
// =========================================================
const PartyLock = {
    PIN_STORAGE_KEY: "ytm_party_lock_pin",
    ACTIVE_STORAGE_KEY: "ytm_party_lock_active",
    _onUnlockSuccess: null,
    _onSetupSuccess: null,

    hasPin() {
        try {
            const p = localStorage.getItem(this.PIN_STORAGE_KEY);
            return Boolean(p && p.trim().length === 4);
        } catch (e) {
            return false;
        }
    },

    getPin() {
        try {
            return localStorage.getItem(this.PIN_STORAGE_KEY) || "";
        } catch (e) {
            return "";
        }
    },

    setPin(pin) {
        try {
            localStorage.setItem(this.PIN_STORAGE_KEY, String(pin).trim());
        } catch (e) {}
        this.updateSettingsUI();
        this.updateUI();
    },

    async removePin() {
        const confirmed = await showModalConfirm(
            "Supprimer le Code PIN",
            "Voulez-vous vraiment désactiver le verrouillage par code PIN du Mode Soirée ?",
            "Supprimer",
            true
        );
        if (!confirmed) return;

        try {
            localStorage.removeItem(this.PIN_STORAGE_KEY);
        } catch (e) {}

        if (window.isPartyLockActive) {
            this.unlock(false);
        }
        this.updateSettingsUI();
        this.updateUI();
        if (typeof showToast === "function") {
            showToast("Code PIN du Mode Soirée supprimé.", "info");
        }
    },

    updateSettingsUI() {
        const statusBadge = document.getElementById("cfg-party-pin-status-badge");
        const btnSetup = document.getElementById("btn-cfg-party-pin-setup");
        const btnRemove = document.getElementById("btn-cfg-party-pin-remove");

        const configured = this.hasPin();
        if (statusBadge) {
            if (configured) {
                statusBadge.textContent = "Configuré (4 chiffres)";
                statusBadge.className = "badge badge-success";
            } else {
                statusBadge.textContent = "Non configuré";
                statusBadge.className = "badge badge-warning";
            }
        }
        if (btnSetup) {
            btnSetup.textContent = configured ? "Modifier le code PIN" : "Définir un code PIN";
        }
        if (btnRemove) {
            btnRemove.style.display = configured ? "inline-flex" : "none";
        }
    },

    updateUI() {
        const btn = document.getElementById("btn-party-lock");
        if (!btn) return;

        // Le bouton de verrouillage est affiché en mode lecteur ou si le verrouillage est actif
        const shouldShow = Boolean(isPlayerModeActive || window.isPartyLockActive);
        btn.style.display = shouldShow ? "inline-flex" : "none";

        const iconUnlocked = document.getElementById("party-lock-icon-unlocked");
        const iconLocked = document.getElementById("party-lock-icon-locked");
        const label = document.getElementById("party-lock-btn-label");

        if (window.isPartyLockActive) {
            btn.classList.add("is-locked");
            if (iconUnlocked) iconUnlocked.style.display = "none";
            if (iconLocked) iconLocked.style.display = "inline-flex";
            if (label) label.textContent = "Verrouillé";
            btn.title = "Mode Soirée Actif (Cliquer pour déverrouiller avec le PIN)";
        } else {
            btn.classList.remove("is-locked");
            if (iconUnlocked) iconUnlocked.style.display = "inline-flex";
            if (iconLocked) iconLocked.style.display = "none";
            if (label) label.textContent = "Mode Soirée";
            btn.title = "Activer le Mode Soirée (Verrouillage du lecteur par PIN)";
        }
    },

    lock() {
        if (!this.hasPin()) {
            if (typeof showToast === "function") {
                showToast("Veuillez d'abord configurer un code PIN à 4 chiffres.", "warning");
            }
            this.openSetupModal(() => {
                this.lock();
            });
            return;
        }

        if (!isPlayerModeActive) {
            if (typeof enterPlayerMode === "function") enterPlayerMode();
        }

        // Fermer impérativement le tiroir Atelier si ouvert
        if (typeof closeWorkshopDrawer === "function") {
            closeWorkshopDrawer();
        }

        // Verrouiller la source du lecteur sur Ma Collection
        if (typeof playerStore !== "undefined" && typeof playerStore.setSource === "function") {
            playerStore.setSource("library");
        }

        window.isPartyLockActive = true;
        try {
            localStorage.setItem(this.ACTIVE_STORAGE_KEY, "true");
        } catch (e) {}
        document.body.classList.add("party-lock-active");
        this.updateUI();

        if (typeof showToast === "function") {
            showToast("🔒 Mode Soirée Activé ! L'application est verrouillée en mode lecteur.", "success");
        }
    },

    unlock(notify = true) {
        window.isPartyLockActive = false;
        try {
            localStorage.removeItem(this.ACTIVE_STORAGE_KEY);
        } catch (e) {}
        document.body.classList.remove("party-lock-active");
        this.updateUI();
        this.closeUnlockModal();

        if (notify && typeof showToast === "function") {
            showToast("🔓 Mode Soirée Déverrouillé.", "info");
        }
    },

    toggle() {
        if (window.isPartyLockActive) {
            this.requestUnlock("Veuillez saisir votre code PIN pour désactiver le Mode Soirée.");
        } else {
            this.lock();
        }
    },

    requestUnlock(customMessage, onSuccess) {
        if (!window.isPartyLockActive) {
            if (typeof onSuccess === "function") onSuccess();
            return;
        }

        const modal = document.getElementById("party-lock-unlock-modal");
        if (!modal) return;

        const msgEl = document.getElementById("party-lock-unlock-msg");
        if (msgEl) {
            msgEl.textContent = customMessage || "Entrez votre code PIN à 4 chiffres pour déverrouiller l'accès :";
        }
        const errEl = document.getElementById("party-unlock-error-msg");
        if (errEl) errEl.style.display = "none";

        this._onUnlockSuccess = onSuccess || null;

        for (let i = 1; i <= 4; i++) {
            const box = document.getElementById(`party-unlock-digit-${i}`);
            if (box) {
                box.value = "";
                box.classList.remove("error");
            }
        }

        modal.style.display = "flex";
        void modal.offsetWidth;
        modal.classList.add("active");

        const first = document.getElementById("party-unlock-digit-1");
        if (first) setTimeout(() => first.focus(), 60);
    },

    closeUnlockModal() {
        const modal = document.getElementById("party-lock-unlock-modal");
        if (!modal) return;
        modal.classList.remove("active");
        setTimeout(() => {
            modal.style.display = "none";
        }, 200);
        this._onUnlockSuccess = null;
    },

    verifyUnlock() {
        let pin = "";
        for (let i = 1; i <= 4; i++) {
            const b = document.getElementById(`party-unlock-digit-${i}`);
            pin += (b ? b.value.trim() : "");
        }

        const storedPin = this.getPin();
        const errEl = document.getElementById("party-unlock-error-msg");

        if (pin.length !== 4 || pin !== storedPin) {
            if (errEl) errEl.style.display = "block";
            for (let i = 1; i <= 4; i++) {
                const b = document.getElementById(`party-unlock-digit-${i}`);
                if (b) {
                    b.classList.add("error");
                    b.value = "";
                }
            }
            const first = document.getElementById("party-unlock-digit-1");
            if (first) first.focus();
            return false;
        }

        const cb = this._onUnlockSuccess;
        this.unlock(true);
        if (typeof cb === "function") {
            try { cb(); } catch (e) { console.error(e); }
        }
        return true;
    },

    openSetupModal(onSuccess) {
        const modal = document.getElementById("party-lock-setup-modal");
        if (!modal) return;

        this._onSetupSuccess = onSuccess || null;

        const title = document.getElementById("party-setup-title");
        if (title) {
            title.textContent = this.hasPin() ? "Modifier le Code PIN Soirée" : "Configurer le Code PIN Soirée";
        }
        const errEl = document.getElementById("party-setup-error-msg");
        if (errEl) errEl.style.display = "none";

        for (let i = 1; i <= 4; i++) {
            const b1 = document.getElementById(`party-setup-digit-${i}`);
            const b2 = document.getElementById(`party-confirm-digit-${i}`);
            if (b1) { b1.value = ""; b1.classList.remove("error"); }
            if (b2) { b2.value = ""; b2.classList.remove("error"); }
        }

        modal.style.display = "flex";
        void modal.offsetWidth;
        modal.classList.add("active");

        const first = document.getElementById("party-setup-digit-1");
        if (first) setTimeout(() => first.focus(), 60);
    },

    closeSetupModal() {
        const modal = document.getElementById("party-lock-setup-modal");
        if (!modal) return;
        modal.classList.remove("active");
        setTimeout(() => {
            modal.style.display = "none";
        }, 200);
        this._onSetupSuccess = null;
    },

    saveSetupPin() {
        let pin1 = "";
        let pin2 = "";
        for (let i = 1; i <= 4; i++) {
            const b1 = document.getElementById(`party-setup-digit-${i}`);
            const b2 = document.getElementById(`party-confirm-digit-${i}`);
            pin1 += (b1 ? b1.value.trim() : "");
            pin2 += (b2 ? b2.value.trim() : "");
        }

        const errEl = document.getElementById("party-setup-error-msg");
        if (pin1.length !== 4 || !/^\d{4}$/.test(pin1)) {
            if (errEl) {
                errEl.textContent = "Le code PIN doit comporter exactement 4 chiffres.";
                errEl.style.display = "block";
            }
            const first = document.getElementById("party-setup-digit-1");
            if (first) first.focus();
            return false;
        }

        if (pin1 !== pin2) {
            if (errEl) {
                errEl.textContent = "Les deux codes saisis ne correspondent pas.";
                errEl.style.display = "block";
            }
            for (let i = 1; i <= 4; i++) {
                const b2 = document.getElementById(`party-confirm-digit-${i}`);
                if (b2) {
                    b2.classList.add("error");
                    b2.value = "";
                }
            }
            const c1 = document.getElementById("party-confirm-digit-1");
            if (c1) c1.focus();
            return false;
        }

        this.setPin(pin1);
        const cb = this._onSetupSuccess;
        this.closeSetupModal();
        if (typeof showToast === "function") {
            showToast("Code PIN du Mode Soirée enregistré !", "success");
        }
        if (typeof cb === "function") {
            try { cb(); } catch (e) { console.error(e); }
        }
        return true;
    },

    _setupPinInputs(containerId, onSubmit, nextContainerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const inputs = Array.from(container.querySelectorAll(".party-pin-box"));

        inputs.forEach((input, idx) => {
            input.addEventListener("input", () => {
                input.classList.remove("error");
                const val = input.value.replace(/\D/g, "");
                input.value = val ? val[0] : "";

                if (val && idx < inputs.length - 1) {
                    inputs[idx + 1].focus();
                } else if (val && idx === inputs.length - 1) {
                    if (nextContainerId) {
                        const nextFirst = document.querySelector(`#${nextContainerId} .party-pin-box`);
                        if (nextFirst) nextFirst.focus();
                    } else if (typeof onSubmit === "function") {
                        onSubmit();
                    }
                }
            });

            input.addEventListener("keydown", (e) => {
                if (e.key === "Backspace") {
                    if (!input.value && idx > 0) {
                        inputs[idx - 1].focus();
                        inputs[idx - 1].value = "";
                    } else {
                        input.value = "";
                    }
                } else if (e.key === "ArrowLeft" && idx > 0) {
                    inputs[idx - 1].focus();
                } else if (e.key === "ArrowRight" && idx < inputs.length - 1) {
                    inputs[idx + 1].focus();
                } else if (e.key === "Enter") {
                    e.preventDefault();
                    if (typeof onSubmit === "function") onSubmit();
                }
            });

            input.addEventListener("paste", (e) => {
                e.preventDefault();
                const pasted = (e.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "");
                if (!pasted) return;
                for (let i = 0; i < inputs.length; i++) {
                    inputs[i].value = pasted[i] || "";
                    inputs[i].classList.remove("error");
                }
                const targetIdx = Math.min(pasted.length, inputs.length - 1);
                inputs[targetIdx].focus();
                if (pasted.length >= 4) {
                    if (nextContainerId) {
                        const nextFirst = document.querySelector(`#${nextContainerId} .party-pin-box`);
                        if (nextFirst) nextFirst.focus();
                    } else if (typeof onSubmit === "function") {
                        onSubmit();
                    }
                }
            });
        });
    },

    init() {
        this._setupPinInputs("party-unlock-pin-container", () => this.verifyUnlock());
        this._setupPinInputs("party-setup-pin-container", () => this.saveSetupPin(), "party-setup-confirm-container");
        this._setupPinInputs("party-setup-confirm-container", () => this.saveSetupPin());

        const btnUnlockSubmit = document.getElementById("btn-party-unlock-submit");
        const btnUnlockCancel = document.getElementById("btn-party-unlock-cancel");
        if (btnUnlockSubmit) btnUnlockSubmit.addEventListener("click", () => this.verifyUnlock());
        if (btnUnlockCancel) btnUnlockCancel.addEventListener("click", () => this.closeUnlockModal());

        const btnSetupSubmit = document.getElementById("btn-party-setup-submit");
        const btnSetupCancel = document.getElementById("btn-party-setup-cancel");
        if (btnSetupSubmit) btnSetupSubmit.addEventListener("click", () => this.saveSetupPin());
        if (btnSetupCancel) btnSetupCancel.addEventListener("click", () => this.closeSetupModal());

        const btnCfgSetup = document.getElementById("btn-cfg-party-pin-setup");
        const btnCfgRemove = document.getElementById("btn-cfg-party-pin-remove");
        if (btnCfgSetup) btnCfgSetup.addEventListener("click", () => this.openSetupModal());
        if (btnCfgRemove) btnCfgRemove.addEventListener("click", () => this.removePin());

        const unlockModal = document.getElementById("party-lock-unlock-modal");
        if (unlockModal) {
            unlockModal.addEventListener("click", (e) => {
                if (e.target === unlockModal) this.closeUnlockModal();
            });
        }
        const setupModal = document.getElementById("party-lock-setup-modal");
        if (setupModal) {
            setupModal.addEventListener("click", (e) => {
                if (e.target === setupModal) this.closeSetupModal();
            });
        }

        this.updateSettingsUI();

        // Restaurer l'état verrouillé si l'application avait le Mode Soirée actif
        try {
            const wasActive = localStorage.getItem(this.ACTIVE_STORAGE_KEY) === "true";
            if (wasActive && this.hasPin()) {
                window.isPartyLockActive = true;
                document.body.classList.add("party-lock-active");
                if (typeof closeWorkshopDrawer === "function") {
                    closeWorkshopDrawer();
                }
                if (typeof playerStore !== "undefined" && typeof playerStore.setSource === "function") {
                    playerStore.setSource("library");
                }
            }
        } catch (e) {}

        this.updateUI();
    }
};

window.PartyLock = PartyLock;



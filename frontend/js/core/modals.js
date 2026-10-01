/**
 * SoundStash Core - Modales Système & Notifications Toast
 * Remplace les dialogues bloquants natifs (alert, confirm, prompt) par des modales asynchrones et gère les toasts.
 */

// ===================================================
// Détection d'ouverture d'une modale générique
// ===================================================
function isCustomModalOpen() {
    const backdrop = document.getElementById("custom-modal-backdrop");
    return Boolean(backdrop && backdrop.classList.contains("active") && backdrop.style.display !== "none");
}
window.isCustomModalOpen = isCustomModalOpen;

// ===================================================
// Modale Alert Personnalisée
// ===================================================
function showModalAlert(title, message, type = "info") {
    return new Promise((resolve) => {
        const backdrop = document.getElementById("custom-modal-backdrop");
        const titleEl = document.getElementById("modal-title");
        const msgEl = document.getElementById("modal-message");
        const iconBox = document.getElementById("modal-icon-box");
        const btnCancel = document.getElementById("modal-btn-cancel");
        const btnConfirm = document.getElementById("modal-btn-confirm");

        titleEl.textContent = title;
        msgEl.textContent = message;
        iconBox.className = `modal-icon-box icon-${type}`;
        iconBox.innerHTML = (window.ICONS_SVG && window.ICONS_SVG[type]) || (window.ICONS_SVG && window.ICONS_SVG.info) || "";

        btnCancel.style.display = "none";
        btnConfirm.textContent = "OK";
        btnConfirm.className = "btn btn-primary";

        backdrop.style.display = "flex";
        void backdrop.offsetWidth;
        backdrop.classList.add("active");

        function cleanup(result) {
            backdrop.classList.remove("active");
            setTimeout(() => {
                backdrop.style.display = "none";
            }, 200);
            btnConfirm.removeEventListener("click", onConfirm);
            resolve(result);
        }

        function onConfirm() { cleanup(true); }

        btnConfirm.addEventListener("click", onConfirm, { once: true });
        btnConfirm.focus();
    });
}
window.showModalAlert = showModalAlert;

// ===================================================
// Modale Confirm Personnalisée
// ===================================================
function showModalConfirm(title, message, confirmText = "Confirmer", isDanger = false, cancelText = "Annuler") {
    return new Promise((resolve) => {
        const backdrop = document.getElementById("custom-modal-backdrop");
        const titleEl = document.getElementById("modal-title");
        const msgEl = document.getElementById("modal-message");
        const iconBox = document.getElementById("modal-icon-box");
        const btnCancel = document.getElementById("modal-btn-cancel");
        const btnConfirm = document.getElementById("modal-btn-confirm");

        const type = isDanger ? "danger" : "warning";
        titleEl.textContent = title;
        msgEl.textContent = message;
        iconBox.className = `modal-icon-box icon-${type}`;
        iconBox.innerHTML = (window.ICONS_SVG && window.ICONS_SVG[type]) || (window.ICONS_SVG && window.ICONS_SVG.warning) || "";

        const inputEl = document.getElementById("modal-input");
        if (inputEl) inputEl.style.display = "none";

        btnCancel.style.display = "inline-flex";
        btnCancel.textContent = cancelText;
        btnConfirm.textContent = confirmText;
        btnConfirm.className = isDanger ? "btn btn-danger" : "btn btn-primary";

        backdrop.style.display = "flex";
        void backdrop.offsetWidth;
        backdrop.classList.add("active");

        function cleanup(result) {
            backdrop.classList.remove("active");
            setTimeout(() => {
                backdrop.style.display = "none";
                btnCancel.textContent = "Annuler";
            }, 200);
            btnConfirm.removeEventListener("click", onConfirm);
            btnCancel.removeEventListener("click", onCancel);
            resolve(result);
        }

        function onConfirm() { cleanup(true); }
        function onCancel() { cleanup(false); }

        btnConfirm.addEventListener("click", onConfirm, { once: true });
        btnCancel.addEventListener("click", onCancel, { once: true });
        btnConfirm.focus();
    });
}
window.showModalConfirm = showModalConfirm;

// ===================================================
// Modale Prompt Personnalisée
// ===================================================
function showModalPrompt(title, message, defaultValue = "", placeholder = "") {
    return new Promise((resolve) => {
        const backdrop = document.getElementById("custom-modal-backdrop");
        const titleEl = document.getElementById("modal-title");
        const msgEl = document.getElementById("modal-message");
        const iconBox = document.getElementById("modal-icon-box");
        const inputEl = document.getElementById("modal-input");
        const btnCancel = document.getElementById("modal-btn-cancel");
        const btnConfirm = document.getElementById("modal-btn-confirm");

        titleEl.textContent = title;
        msgEl.textContent = message;
        iconBox.className = "modal-icon-box icon-info";
        iconBox.innerHTML = (window.ICONS_SVG && window.ICONS_SVG.info) || "";

        if (inputEl) {
            inputEl.style.display = "block";
            inputEl.value = defaultValue;
            inputEl.placeholder = placeholder;
        }

        btnCancel.style.display = "inline-flex";
        btnCancel.textContent = "Annuler";
        btnConfirm.textContent = "Valider";
        btnConfirm.className = "btn btn-primary";

        backdrop.style.display = "flex";
        void backdrop.offsetWidth;
        backdrop.classList.add("active");

        if (inputEl) {
            setTimeout(() => {
                inputEl.focus();
                inputEl.select();
            }, 60);
        }

        function cleanup(result) {
            backdrop.classList.remove("active");
            setTimeout(() => {
                backdrop.style.display = "none";
                if (inputEl) {
                    inputEl.style.display = "none";
                    inputEl.value = "";
                }
            }, 200);
            btnConfirm.removeEventListener("click", onConfirm);
            btnCancel.removeEventListener("click", onCancel);
            if (inputEl) inputEl.removeEventListener("keydown", onKeyDown);
            resolve(result);
        }

        function onConfirm() {
            const val = inputEl ? inputEl.value.trim() : "";
            cleanup(val);
        }
        function onCancel() { cleanup(null); }
        function onKeyDown(e) {
            if (e.key === "Enter") {
                e.preventDefault();
                onConfirm();
            } else if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
            }
        }

        btnConfirm.addEventListener("click", onConfirm, { once: true });
        btnCancel.addEventListener("click", onCancel, { once: true });
        if (inputEl) inputEl.addEventListener("keydown", onKeyDown);
    });
}
window.showModalPrompt = showModalPrompt;

// ===================================================
// Modale à 3 Choix Personnalisée
// ===================================================
function showModalChoice3(title, message, confirmText = "Confirmer", cancelText = "Annuler", extraText = "Extra", isDangerExtra = true) {
    return new Promise((resolve) => {
        const backdrop = document.getElementById("custom-modal-backdrop");
        const titleEl = document.getElementById("modal-title");
        const msgEl = document.getElementById("modal-message");
        const iconBox = document.getElementById("modal-icon-box");
        const btnCancel = document.getElementById("modal-btn-cancel");
        const btnConfirm = document.getElementById("modal-btn-confirm");
        const btnExtra = document.getElementById("modal-btn-extra");

        titleEl.textContent = title;
        msgEl.textContent = message;
        iconBox.className = "modal-icon-box icon-warning";
        iconBox.innerHTML = (window.ICONS_SVG && window.ICONS_SVG.warning) || "";

        const inputEl = document.getElementById("modal-input");
        if (inputEl) inputEl.style.display = "none";

        btnConfirm.style.display = "inline-flex";
        btnConfirm.textContent = confirmText;
        btnConfirm.className = "btn btn-primary";

        btnCancel.style.display = "inline-flex";
        btnCancel.textContent = cancelText;
        btnCancel.className = "btn btn-secondary";

        if (btnExtra) {
            btnExtra.style.display = "inline-flex";
            btnExtra.textContent = extraText;
            btnExtra.className = isDangerExtra ? "btn btn-danger" : "btn btn-secondary";
        }

        backdrop.style.display = "flex";
        void backdrop.offsetWidth;
        backdrop.classList.add("active");

        function cleanup(result) {
            backdrop.classList.remove("active");
            setTimeout(() => {
                backdrop.style.display = "none";
                if (btnExtra) {
                    btnExtra.style.display = "none";
                    btnExtra.textContent = "Extra";
                }
                btnCancel.textContent = "Annuler";
            }, 200);
            btnConfirm.removeEventListener("click", onConfirm);
            btnCancel.removeEventListener("click", onCancel);
            if (btnExtra) btnExtra.removeEventListener("click", onExtra);
            resolve(result);
        }

        function onConfirm() { cleanup("confirm"); }
        function onCancel() { cleanup("cancel"); }
        function onExtra() { cleanup("extra"); }

        btnConfirm.addEventListener("click", onConfirm, { once: true });
        btnCancel.addEventListener("click", onCancel, { once: true });
        if (btnExtra) btnExtra.addEventListener("click", onExtra, { once: true });
        btnConfirm.focus();
    });
}
window.showModalChoice3 = showModalChoice3;

// =========================================================
// Notifications Toast Universelles (Premier plan absolu)
// =========================================================
function showToast(message, arg2 = null, arg3 = null, arg4 = null) {
    const container = document.getElementById("toast-container");
    if (!container) return;

    let type = "info";
    let actionLabel = null;
    let actionCallback = null;

    if (typeof arg2 === "function") {
        actionCallback = arg2;
    } else if (typeof arg3 === "function") {
        if (["success", "info", "warning", "danger", "error"].includes(String(arg2).toLowerCase())) {
            type = String(arg2).toLowerCase();
            actionCallback = arg3;
        } else {
            actionLabel = arg2;
            actionCallback = arg3;
        }
    } else if (typeof arg4 === "function") {
        type = String(arg2).toLowerCase();
        actionLabel = arg3;
        actionCallback = arg4;
    } else if (arg2 && typeof arg2 === "string") {
        const lower = arg2.toLowerCase();
        if (["success", "info", "warning", "danger", "error"].includes(lower)) {
            type = lower;
        } else {
            actionLabel = arg2;
        }
    }
    if (type === "error") type = "danger";

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;

    // Icône vectorielle réactive
    const iconSpan = document.createElement("span");
    iconSpan.className = "toast-icon";
    if (type === "success") {
        iconSpan.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    } else if (type === "danger") {
        iconSpan.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
    } else if (type === "warning") {
        iconSpan.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    } else {
        iconSpan.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
    }
    toast.appendChild(iconSpan);

    const content = document.createElement("div");
    content.className = "toast-content";
    content.textContent = message;
    toast.appendChild(content);

    // Bouton d'action optionnel
    if (actionLabel && actionCallback) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "toast-action-btn";
        btn.textContent = actionLabel;
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            actionCallback();
            toast.remove();
        });
        toast.appendChild(btn);
    }

    // Bouton fermeture directe
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "toast-close-btn";
    closeBtn.innerHTML = "&times;";
    closeBtn.title = "Fermer";
    closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toast.style.opacity = "0";
        toast.style.transform = "translateX(110%)";
        setTimeout(() => toast.remove(), 250);
    });
    toast.appendChild(closeBtn);

    // Clic n'importe où pour fermer
    toast.addEventListener("click", () => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(110%)";
        setTimeout(() => toast.remove(), 250);
    });

    container.appendChild(toast);

    const duration = type === "danger" || type === "warning" ? 5500 : 4200;
    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.opacity = "0";
            toast.style.transform = "translateX(110%)";
            toast.style.transition = "opacity 0.3s ease, transform 0.3s ease";
            setTimeout(() => toast.remove(), 300);
        }
    }, duration);
}
window.showToast = showToast;

// =========================================================
// Notifications Flottantes Spéciales de Synchronisation (Orange / Vert)
// =========================================================
function showSyncToast(message, color = "orange", detail = "", duration = 5000) {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    const isOrange = color === "orange" || color === "warning";
    toast.className = `toast ${isOrange ? 'toast-sync-orange' : 'toast-sync-green'}`;

    const iconSpan = document.createElement("span");
    iconSpan.className = "toast-sync-icon";
    if (isOrange) {
        iconSpan.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>`;
    } else {
        iconSpan.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    }
    toast.appendChild(iconSpan);

    const content = document.createElement("div");
    content.className = "toast-content";
    
    const msgEl = document.createElement("div");
    msgEl.className = "toast-sync-title";
    msgEl.textContent = message;
    content.appendChild(msgEl);

    if (detail) {
        const detailEl = document.createElement("div");
        detailEl.className = "toast-sync-detail";
        detailEl.textContent = detail;
        content.appendChild(detailEl);
    }

    toast.appendChild(content);

    // Clic pour fermer immédiatement
    toast.addEventListener("click", () => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(100%)";
        setTimeout(() => toast.remove(), 250);
    });

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(100%)";
        toast.style.transition = "opacity 0.3s ease, transform 0.3s ease";
        setTimeout(() => toast.remove(), 300);
    }, duration);
}
window.showSyncToast = showSyncToast;

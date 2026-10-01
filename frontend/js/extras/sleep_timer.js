/**
 * SoundStash Extras - Minuteur de Veille & Arrêt Programmé (Sleep Timer)
 * Arrêt en fondu sonore progressif par durée prédéfinie ou fin d'album.
 */

// =========================================================
// Minuteur de Veille / Arrêt Programmé (Sleep Timer)
// =========================================================
const SleepTimer = {
    active: false,
    mode: null, // "duration" | "end_of_album"
    totalSeconds: 0,
    remainingSeconds: 0,
    timerId: null,

    start(minutes) {
        this.clear();
        this.active = true;
        this.mode = "duration";
        this.totalSeconds = Math.round(minutes * 60);
        this.remainingSeconds = this.totalSeconds;
        this.updateUI();

        this.timerId = setInterval(() => {
            this.remainingSeconds--;
            if (this.remainingSeconds <= 0) {
                this.triggerSleep();
            } else {
                this.updateUI();
            }
        }, 1000);

        showToast(`🌙 Minuteur de veille activé : extinction dans ${minutes} minutes.`, "info");
    },

    setEndOfAlbum() {
        this.clear();
        this.active = true;
        this.mode = "end_of_album";
        this.updateUI();
        showToast("🌙 Minuteur de veille activé : extinction à la fin de l'album en cours.", "info");
    },

    clear() {
        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
        this.active = false;
        this.mode = null;
        this.totalSeconds = 0;
        this.remainingSeconds = 0;
        this.updateUI();
    },

    cancel() {
        this.clear();
        showToast("Minuteur de veille désactivé.", "info");
    },

    async triggerSleep() {
        this.clear();
        if (window.AudioPlayer && window.AudioPlayer.audio && !window.AudioPlayer.audio.paused) {
            if (window.AudioFader && window.AudioFader.enabled) {
                await window.AudioFader.fadeOut(window.AudioPlayer.audio, 800);
            }
            window.AudioPlayer.audio.pause();
            window.AudioPlayer.isPlaying = false;
            window.AudioPlayer.updatePlayStateUI();
        }
        const videoPlayer = document.getElementById("video-modal-player");
        if (videoPlayer && !videoPlayer.paused) {
            if (window.AudioFader && window.AudioFader.enabled) {
                await window.AudioFader.fadeOut(videoPlayer, 800);
            }
            videoPlayer.pause();
        }
        showToast("🌙 Minuteur de veille : mise en pause automatique de la lecture. Bonne nuit !", "info");
    },

    onAlbumEnded() {
        if (this.active && this.mode === "end_of_album") {
            this.triggerSleep();
            return true;
        }
        return false;
    },

    updateUI() {
        const label = document.getElementById("player-sleep-timer-label");
        const activeBadge = document.getElementById("player-sleep-active-badge");
        const miniBadge = document.getElementById("mini-sleep-active-badge");
        const banner = document.getElementById("sleep-timer-status-banner");
        const countdownDisplay = document.getElementById("sleep-timer-countdown-display");
        const cancelBtn = document.getElementById("sleep-timer-cancel-btn");
        const optBtns = document.querySelectorAll(".sleep-timer-opt-btn");

        if (this.active) {
            if (activeBadge) activeBadge.style.display = "inline-block";
            if (miniBadge) miniBadge.style.display = "inline-block";
            if (banner) banner.style.display = "block";
            if (cancelBtn) cancelBtn.style.display = "inline-block";

            let timeStr = "";
            if (this.mode === "duration") {
                const mins = Math.floor(this.remainingSeconds / 60);
                const secs = this.remainingSeconds % 60;
                timeStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
                if (label) label.textContent = timeStr;
                if (countdownDisplay) countdownDisplay.textContent = timeStr;
            } else if (this.mode === "end_of_album") {
                timeStr = "Fin d'album";
                if (label) label.textContent = "Fin d'album";
                if (countdownDisplay) countdownDisplay.textContent = "À la fin de l'album en cours";
            }

            optBtns.forEach(btn => {
                const m = btn.getAttribute("data-sleep-minutes");
                const mode = btn.getAttribute("data-sleep-mode");
                if (this.mode === "duration" && m && Math.round(parseFloat(m) * 60) === this.totalSeconds) {
                    btn.classList.add("active");
                } else if (this.mode === "end_of_album" && mode === "end_of_album") {
                    btn.classList.add("active");
                } else {
                    btn.classList.remove("active");
                }
            });
        } else {
            if (label) label.textContent = "Veille";
            if (activeBadge) activeBadge.style.display = "none";
            if (miniBadge) miniBadge.style.display = "none";
            if (banner) banner.style.display = "none";
            if (cancelBtn) cancelBtn.style.display = "none";
            optBtns.forEach(btn => btn.classList.remove("active"));
        }
    }
};

function openSleepTimerModal() {
    const modal = document.getElementById("sleep-timer-modal-backdrop");
    if (!modal) return;
    SleepTimer.updateUI();
    modal.style.display = "flex";
    void modal.offsetWidth;
    modal.classList.add("active");
}

function closeSleepTimerModal() {
    const modal = document.getElementById("sleep-timer-modal-backdrop");
    if (!modal) return;
    modal.classList.remove("active");
    setTimeout(() => {
        modal.style.display = "none";
    }, 200);
}

function setupSleepTimerModal() {
    const btnMain = document.getElementById("player-btn-sleep-timer");
    const btnMini = document.getElementById("mini-player-sleep-btn");
    const closeBtn = document.getElementById("sleep-timer-close-btn");
    const modalCloseBtn = document.getElementById("sleep-timer-modal-close-btn");
    const cancelBtn = document.getElementById("sleep-timer-cancel-btn");
    const modal = document.getElementById("sleep-timer-modal-backdrop");

    if (btnMain) btnMain.addEventListener("click", openSleepTimerModal);
    if (btnMini) btnMini.addEventListener("click", openSleepTimerModal);
    if (closeBtn) closeBtn.addEventListener("click", closeSleepTimerModal);
    if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeSleepTimerModal);

    if (modal) {
        modal.addEventListener("click", (e) => {
            if (e.target === modal) closeSleepTimerModal();
        });
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal && modal.classList.contains("active")) {
            closeSleepTimerModal();
            e.stopPropagation();
        }
    });

    const optBtns = document.querySelectorAll(".sleep-timer-opt-btn");
    optBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const minutes = btn.getAttribute("data-sleep-minutes");
            const mode = btn.getAttribute("data-sleep-mode");
            if (minutes) {
                SleepTimer.start(parseFloat(minutes));
            } else if (mode === "end_of_album") {
                SleepTimer.setEndOfAlbum();
            }
            closeSleepTimerModal();
        });
    });

    if (cancelBtn) {
        cancelBtn.addEventListener("click", () => {
            SleepTimer.cancel();
            closeSleepTimerModal();
        });
    }
}


window.SleepTimer = SleepTimer;
window.openSleepTimerModal = openSleepTimerModal;
window.closeSleepTimerModal = closeSleepTimerModal;
window.setupSleepTimerModal = setupSleepTimerModal;

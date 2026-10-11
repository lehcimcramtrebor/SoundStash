/**
 * SoundStash Ambient - Rendu Visuel Canvas 2D & Thèmes Synthwave / Rétro
 * Gestionnaire AmbientThemeManager, animation audio-réactive et presets visuels.
 */

// =========================================================
// MOTEUR VISUEL SYNTHWAVE & ONDE SONORE TEMPS RÉEL (CANVAS)
// =========================================================

const AmbientThemeManager = {
    canvas: null,
    ctx: null,
    animationId: null,
    lastTime: 0,
    time: 0,
    theme: "dark",
    currentThemeIndex: 0,

    // Lissage dynamique des composantes audio
    smoothedBass: 0,
    smoothedMid: 0,
    smoothedTreble: 0,
    smoothedEnergy: 0,
    beatTimer: 0,
    prevRawBass: 0,
    prevRawMid: 0,
    prevRawTreble: 0,
    prevRawEnergy: 0,
    percussionPulse: 0,
    kickPulse: 0,
    snarePulse: 0,

    init() {
        this.canvas = document.getElementById("synthwave-canvas");
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext("2d");
        if (!this.ctx) return;

        this.handleResize = this.handleResize.bind(this);
        this.handleResize();
        window.addEventListener("resize", this.handleResize, { passive: true });

        this.updateThemeMode();
        if (typeof MutationObserver !== "undefined") {
            const observer = new MutationObserver(() => this.updateThemeMode());
            observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
        }

        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                if (this.animationId) {
                    cancelAnimationFrame(this.animationId);
                    this.animationId = null;
                }
            } else {
                if (!this.animationId) {
                    this.lastTime = performance.now();
                    this.animate();
                }
            }
        });

        // Restaurer le thème actif sauvegardé
        let savedTheme = 0;
        try {
            const stored = localStorage.getItem("ytm_ambient_active_theme");
            if (stored !== null) {
                savedTheme = parseInt(stored, 10);
                if (isNaN(savedTheme) || savedTheme < 0 || savedTheme >= this.themes.length) {
                    savedTheme = 0;
                }
            }
        } catch (_) {}

        this.setTheme(savedTheme, false);
        this.lastTime = performance.now();
        // Le canvas ne tourne QUE lorsque le mode ambiance est actif pour libérer 100% du GPU
        if (document.body.classList.contains("ambient-mode-active")) {
            this.start();
        }
    },

    updateThemeMode() {
        this.theme = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
        this.updateStaticBackdrop();
    },

    updateStaticBackdrop() {
        const backdropImg = document.getElementById("ambient-backdrop-image");
        if (!backdropImg) return;

        const isBackdropDisabled = localStorage.getItem("ytm_static_backdrop_enabled") === "false";
        document.body.classList.toggle("static-backdrop-disabled", isBackdropDisabled);
        if (isBackdropDisabled) return;

        const currentTheme = this.themes[this.currentThemeIndex] || this.themes[0];
        const themeId = currentTheme ? currentTheme.id : "synthwave";
        const mode = this.theme === "light" ? "light" : "dark";

        const imgUrl = `/static/assets/backdrops/${themeId}_${mode}.webp`;
        backdropImg.style.backgroundImage = `url('${imgUrl}')`;
    },

    handleResize() {
        if (!this.canvas) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.canvas.width = Math.floor(w * dpr);
        this.canvas.height = Math.floor(h * dpr);
        this.canvas.style.width = `${w}px`;
        this.canvas.style.height = `${h}px`;
        if (this.ctx) {
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
    },

    getAudioMetrics() {
        const player = (typeof AudioPlayer !== "undefined" && AudioPlayer) || (window.AudioPlayer || null);
        const videoEl = document.getElementById("video-modal-player");
        const isVideoActive = Boolean(videoEl && window.VideoAudioManager && window.VideoAudioManager.isPlaying(videoEl));
        const isAudioActive = Boolean(player && player.isPlaying);
        const isPlaying = isVideoActive || isAudioActive;

        let waveform = null;
        let freqs = null;

        if (isVideoActive && window.VideoAudioManager) {
            waveform = window.VideoAudioManager.getWaveform(videoEl);
            freqs = window.VideoAudioManager.getFrequencies(videoEl);
        } else if (isAudioActive && player && player.getAudioWaveform) {
            waveform = player.getAudioWaveform();
            freqs = player.getAudioFrequencies();
        }

        let rawEnergy = 0;
        let rawBass = 0;
        let rawMid = 0;
        let rawTreble = 0;

        if (freqs && freqs.length > 0) {
            const len = freqs.length;
            const bEnd = Math.max(2, Math.floor(len * 0.12));
            const mEnd = Math.max(bEnd + 1, Math.floor(len * 0.5));
            let sumTot = 0, sumB = 0, sumM = 0, sumT = 0;
            for (let i = 0; i < len; i++) {
                const v = freqs[i] / 255;
                sumTot += v;
                if (i < bEnd) sumB += v;
                else if (i < mEnd) sumM += v;
                else sumT += v;
            }
            rawEnergy = len > 0 ? sumTot / len : 0;
            rawBass = bEnd > 0 ? sumB / bEnd : 0;
            rawMid = (mEnd > bEnd) ? sumM / (mEnd - bEnd) : 0;
            rawTreble = (len > mEnd) ? sumT / (len - mEnd) : 0;

            // Sous-basses pures & basses profondes (bins 0 à 3)
            const subBins = Math.min(3, len);
            let sumSub = 0;
            for (let i = 0; i < subBins; i++) {
                sumSub += freqs[i] / 255;
            }
            const rawSubBass = subBins > 0 ? (sumSub / subBins) : 0;
            rawBass = Math.max(rawBass, rawSubBass * 1.15);
        }

        // Lissage temporel exponentiel
        this.smoothedBass += (rawBass - this.smoothedBass) * 0.35;
        this.smoothedMid += (rawMid - this.smoothedMid) * 0.3;
        this.smoothedTreble += (rawTreble - this.smoothedTreble) * 0.4;
        this.smoothedEnergy += (rawEnergy - this.smoothedEnergy) * 0.3;

        // Détection de battement (Kick / Beat classique)
        const isBeat = rawBass > 0.38 && (rawBass - this.smoothedBass) > 0.06;
        if (isBeat) {
            this.beatTimer = 1.0;
        } else {
            this.beatTimer = Math.max(0, this.beatTimer - 0.08);
        }

        // Détection transitoire fine des percussions (Kicks, Snares, Claps, Hi-hats)
        // Permet aux thèmes de s'exciter sur les percussions et de rester calmes/fluides sur le reste
        if (!isPlaying) {
            this.percussionPulse = 0;
            this.kickPulse = 0;
            this.snarePulse = 0;
        } else {
            const deltaBass = Math.max(0, rawBass - this.prevRawBass);
            const deltaMid = Math.max(0, rawMid - this.prevRawMid);
            const deltaTreble = Math.max(0, rawTreble - this.prevRawTreble);
            const deltaEnergy = Math.max(0, rawEnergy - this.prevRawEnergy);

            // Attaque de Kick (Grosse caisse) : transitoire sec dans les sous-basses
            const kickTransient = Math.max(deltaBass * 3.6, (rawBass - this.smoothedBass > 0.05) ? (rawBass - this.smoothedBass) * 3.0 : 0);
            if (kickTransient > 0.18 && rawBass > 0.16) {
                this.kickPulse = Math.min(1.0, kickTransient * 1.6);
            } else {
                this.kickPulse = Math.max(0, this.kickPulse - 0.085);
            }

            // Attaque de Snare / Caisse claire / Clap / Rimshot : pic transitoire dans les médiums/aigus
            const snareTransient = Math.max(deltaMid * 3.2 + deltaTreble * 1.6, deltaEnergy * 2.8);
            if (snareTransient > 0.22 && (rawMid > 0.22 || rawTreble > 0.20)) {
                this.snarePulse = Math.min(1.0, snareTransient * 1.6);
            } else {
                this.snarePulse = Math.max(0, this.snarePulse - 0.10);
            }

            // Enveloppe globale d'excitation percussive (0 = tranquille, 1 = excitation percussive maximale)
            const instantPerc = Math.max(this.kickPulse, this.snarePulse);
            this.percussionPulse = Math.max(this.percussionPulse * 0.90, instantPerc);

            this.prevRawBass = rawBass;
            this.prevRawMid = rawMid;
            this.prevRawTreble = rawTreble;
            this.prevRawEnergy = rawEnergy;
        }

        return {
            isPlaying,
            waveform,
            freqs,
            energy: this.smoothedEnergy,
            rawEnergy,
            bass: this.smoothedBass,
            rawBass,
            mid: this.smoothedMid,
            treble: this.smoothedTreble,
            beat: isBeat,
            beatIntensity: this.beatTimer,
            percussion: this.percussionPulse,
            kick: this.kickPulse,
            snare: this.snarePulse,
            isPercussion: this.percussionPulse > 0.35,
            calm: Math.max(0, 1.0 - this.percussionPulse)
        };
    },

    getCurrentTheme() {
        return this.themes[this.currentThemeIndex] || this.themes[0];
    },

    nextTheme() {
        const nextIdx = (this.currentThemeIndex + 1) % this.themes.length;
        this.setTheme(nextIdx, true);
    },

    prevTheme() {
        const prevIdx = (this.currentThemeIndex - 1 + this.themes.length) % this.themes.length;
        this.setTheme(prevIdx, true);
    },

    setTheme(index, notify = true) {
        if (index < 0 || index >= this.themes.length) return;
        const oldTheme = this.themes[this.currentThemeIndex];
        if (oldTheme && typeof oldTheme.destroy === "function") {
            try { oldTheme.destroy(); } catch (e) { console.warn(e); }
        }

        this.currentThemeIndex = index;
        try {
            localStorage.setItem("ytm_ambient_active_theme", String(index));
        } catch (_) {}

        const newTheme = this.themes[this.currentThemeIndex];
        if (newTheme && typeof newTheme.init === "function") {
            try { newTheme.init(this.canvas, this.ctx); } catch (e) { console.warn(e); }
        }

        this.updateThemeUI();
        this.updateStaticBackdrop();

        if (notify && typeof showToast === "function" && document.body.classList.contains("ambient-mode-active")) {
            showToast(`${newTheme.icon} ${newTheme.name} (${this.currentThemeIndex + 1}/${this.themes.length})`, "info", 1800);
        }
    },

    updateThemeUI() {
        const t = this.themes[this.currentThemeIndex];
        if (!t) return;
        const iconEl = document.getElementById("ambient-theme-icon");
        const nameEl = document.getElementById("ambient-theme-name");
        const pillEl = document.getElementById("ambient-theme-pill");
        if (iconEl) iconEl.textContent = t.icon;
        if (nameEl) nameEl.textContent = t.name;
        if (pillEl) {
            pillEl.title = `Thème : ${t.name} (Touche T ou Clic pour changer)`;
        }
    },

    start() {
        if (!this.canvas) {
            this.canvas = document.getElementById("synthwave-canvas");
            if (this.canvas) this.ctx = this.canvas.getContext("2d");
        }
        if (this.canvas) {
            this.canvas.style.display = "block";
        }
        this.handleResize();
        if (!this.animationId) {
            this.lastTime = performance.now();
            this.animate();
        }
    },

    stop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this.canvas) {
            this.canvas.style.display = "none";
        }
    },

    animate(timestamp = 0) {
        const isAmbientNow = document.body.classList.contains("ambient-mode-active");
        if (!isAmbientNow) {
            this.animationId = null;
            if (this.canvas) this.canvas.style.display = "none";
            return;
        }

        this.animationId = requestAnimationFrame((ts) => this.animate(ts));
        const now = timestamp || performance.now();

        const dt = Math.min(Math.max((now - this.lastTime) * 0.001, 0.001), 0.1);
        this.lastTime = now;
        this.time += dt;

        this.render(this.time, dt);
    },

    render(time, dt) {
        if (!this.ctx || !this.canvas) return;
        const ctx = this.ctx;
        const isLight = this.theme === "light";
        const isAmbient = document.body.classList.contains("ambient-mode-active");
        const audio = this.getAudioMetrics();

        const activeTheme = this.themes[this.currentThemeIndex] || this.themes[0];
        try {
            activeTheme.render(this.canvas, ctx, audio, time, dt, isLight, isAmbient);
        } catch (err) {
            console.error("Theme render error:", activeTheme.name, err);
        }
    },

    // =========================================================
    // LISTE DES THÈMES VISUELS PROCÉDURAUX (CANVAS 2D 60 FPS)
    // =========================================================
    themes: [
        // ---------------------------------------------------------
        // THÈME 0 : SYNTHWAVE 80s (Soleil néon & grille de perspective)
        // ---------------------------------------------------------
        {
            id: "synthwave",
            name: "Synthwave 80s",
            icon: "🌴",
            gridOffset: 0,
            init() { this.gridOffset = 0; },
            render(canvas, ctx, audio, time, dt, isLight, isAmbient) {
                const w = window.innerWidth;
                const h = window.innerHeight;
                const horizonY = Math.floor(h * 0.62);

                ctx.clearRect(0, 0, w, h);

                // 1. Ciel & Horizon
                const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
                if (isLight) {
                    skyGrad.addColorStop(0, "#e8edfa");
                    skyGrad.addColorStop(0.5, "#f4e9f7");
                    skyGrad.addColorStop(1, "#ffe4e8");
                } else {
                    skyGrad.addColorStop(0, "#05060b");
                    skyGrad.addColorStop(0.4, "#0d0819");
                    skyGrad.addColorStop(0.85, "#180a2b");
                    skyGrad.addColorStop(1, "#260e3a");
                }
                ctx.fillStyle = skyGrad;
                ctx.fillRect(0, 0, w, horizonY);

                // 2. Soleil Rétro
                const centerX = w / 2;
                const sunRadius = Math.min(w, h) * 0.22;
                const sunGlow = ctx.createRadialGradient(centerX, horizonY, 5, centerX, horizonY, sunRadius * 1.6);
                if (isLight) {
                    sunGlow.addColorStop(0, `rgba(244, 63, 94, ${0.4 + audio.energy * 0.3})`);
                    sunGlow.addColorStop(0.4, `rgba(236, 72, 153, ${0.25 + audio.energy * 0.2})`);
                    sunGlow.addColorStop(0.8, "rgba(168, 85, 247, 0.1)");
                    sunGlow.addColorStop(1, "rgba(240, 243, 248, 0)");
                } else {
                    sunGlow.addColorStop(0, `rgba(255, 42, 100, ${0.5 + audio.energy * 0.4})`);
                    sunGlow.addColorStop(0.35, `rgba(180, 30, 200, ${0.32 + audio.energy * 0.25})`);
                    sunGlow.addColorStop(0.75, "rgba(79, 70, 229, 0.12)");
                    sunGlow.addColorStop(1, "rgba(5, 6, 11, 0)");
                }
                ctx.fillStyle = sunGlow;
                ctx.beginPath();
                ctx.arc(centerX, horizonY, sunRadius * 1.6, 0, Math.PI * 2);
                ctx.fill();

                ctx.save();
                ctx.beginPath();
                ctx.arc(centerX, horizonY - 8, sunRadius, Math.PI, 0, false);
                ctx.closePath();
                ctx.clip();

                const sunGrad = ctx.createLinearGradient(0, horizonY - sunRadius - 8, 0, horizonY);
                if (isLight) {
                    sunGrad.addColorStop(0, "#fbbf24");
                    sunGrad.addColorStop(0.5, "#f43f5e");
                    sunGrad.addColorStop(1, "#c026d3");
                } else {
                    sunGrad.addColorStop(0, "#fde047");
                    sunGrad.addColorStop(0.4, "#ff2a5f");
                    sunGrad.addColorStop(1, "#831843");
                }
                ctx.fillStyle = sunGrad;
                ctx.fillRect(centerX - sunRadius, horizonY - sunRadius - 8, sunRadius * 2, sunRadius + 10);

                const blindsCount = 6;
                for (let b = 1; b <= blindsCount; b++) {
                    const blindY = horizonY - (b * (sunRadius / (blindsCount + 2)));
                    const blindThickness = 2.5 + (blindsCount - b) * 1.2;
                    ctx.clearRect(centerX - sunRadius, blindY, sunRadius * 2, blindThickness);
                }
                ctx.restore();

                // 3. Sol & Perspective
                const floorH = h - horizonY;
                const floorGrad = ctx.createLinearGradient(0, horizonY, 0, h);
                if (isLight) {
                    floorGrad.addColorStop(0, "#fad2e1");
                    floorGrad.addColorStop(0.35, "#edd9fa");
                    floorGrad.addColorStop(1, "#dfe7fd");
                } else {
                    floorGrad.addColorStop(0, "#190829");
                    floorGrad.addColorStop(0.4, "#0f051b");
                    floorGrad.addColorStop(1, "#07030e");
                }
                ctx.fillStyle = floorGrad;
                ctx.fillRect(0, horizonY, w, floorH);

                const speed = audio.isPlaying ? (28 + audio.energy * 35) : 18;
                this.gridOffset = (this.gridOffset + speed * dt) % 1;

                ctx.save();
                ctx.beginPath();
                ctx.rect(0, horizonY, w, floorH);
                ctx.clip();

                const vpX = centerX;
                const vpY = horizonY;
                const fov = 1.35;
                const numLines = Math.floor(w / 45);
                const gridColorRadial = isLight ? "rgba(217, 70, 239, 0.25)" : "rgba(0, 240, 255, 0.28)";

                ctx.strokeStyle = gridColorRadial;
                ctx.lineWidth = 1;
                for (let i = -numLines; i <= numLines; i++) {
                    const bottomX = vpX + i * 50 * fov;
                    ctx.beginPath();
                    ctx.moveTo(vpX, vpY);
                    ctx.lineTo(bottomX, h);
                    ctx.stroke();
                }

                const totalHLines = 14;
                for (let j = 0; j < totalHLines; j++) {
                    const p = (j + this.gridOffset) / totalHLines;
                    const y = horizonY + Math.pow(p, 2.6) * floorH;
                    const alpha = Math.pow(p, 1.8) * (isLight ? 0.32 : 0.6);
                    ctx.strokeStyle = isLight ? `rgba(236, 72, 153, ${alpha})` : `rgba(255, 42, 125, ${alpha})`;
                    ctx.lineWidth = Math.max(1, p * 2.2);
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(w, y);
                    ctx.stroke();
                }
                ctx.restore();

                // 4. Ligne d'horizon
                const horizonLineColor = isLight ? "#ec4899" : "#ff2a7a";
                ctx.strokeStyle = horizonLineColor;
                ctx.lineWidth = 2;
                ctx.shadowColor = horizonLineColor;
                ctx.shadowBlur = 10 + audio.energy * 16;
                ctx.beginPath();
                ctx.moveTo(0, horizonY);
                ctx.lineTo(w, horizonY);
                ctx.stroke();
                ctx.shadowBlur = 0;

                // 5. Onde sonore en temps réel
                ctx.save();
                if (audio.waveform && audio.waveform.length > 1 && audio.isPlaying) {
                    const sliceWidth = w / (audio.waveform.length - 1);
                    const waveAmp = isAmbient ? (75 + audio.energy * 115) : (45 + audio.energy * 70);
                    for (let pass = 0; pass < 2; pass++) {
                        const isBackPass = pass === 0;
                        const waveColor = isBackPass
                            ? (isLight ? "#0284c7" : "#00f0ff")
                            : (isLight ? "#f43f5e" : "#ff2a8d");
                        ctx.strokeStyle = waveColor;
                        ctx.lineWidth = isBackPass ? (isAmbient ? 4.5 : 3.5) : (isAmbient ? 2.5 : 2);
                        ctx.shadowColor = waveColor;
                        ctx.shadowBlur = isBackPass ? (isAmbient ? 28 : 20) : (isAmbient ? 16 : 10);
                        ctx.beginPath();
                        for (let i = 0; i < audio.waveform.length; i++) {
                            const v = (audio.waveform[i] - 128) / 128.0;
                            const offsetPhase = isBackPass ? 0.85 : 1.0;
                            const y = horizonY + v * waveAmp * offsetPhase;
                            const x = i * sliceWidth;
                            if (i === 0) {
                                ctx.moveTo(x, y);
                            } else {
                                const prevX = (i - 1) * sliceWidth;
                                const prevV = (audio.waveform[i - 1] - 128) / 128.0;
                                const prevY = horizonY + prevV * waveAmp * offsetPhase;
                                const midX = (prevX + x) / 2;
                                ctx.quadraticCurveTo(prevX, prevY, midX, (prevY + y) / 2);
                            }
                        }
                        ctx.stroke();
                    }
                } else {
                    const restingPoints = 80;
                    const sliceWidth = w / (restingPoints - 1);
                    const idleColor = isLight ? "rgba(236, 72, 153, 0.65)" : "rgba(255, 42, 125, 0.75)";
                    const idleCyan = isLight ? "rgba(14, 165, 233, 0.45)" : "rgba(0, 240, 255, 0.55)";
                    ctx.strokeStyle = idleCyan;
                    ctx.lineWidth = 2;
                    ctx.shadowColor = idleCyan;
                    ctx.shadowBlur = 8;
                    ctx.beginPath();
                    for (let i = 0; i < restingPoints; i++) {
                        const x = i * sliceWidth;
                        const normX = (x / w) * Math.PI * 4;
                        const y = horizonY + Math.sin(normX - time * 1.8) * 8 + Math.cos(normX * 2 + time * 1.2) * 4;
                        if (i === 0) ctx.moveTo(x, y);
                        else ctx.lineTo(x, y);
                    }
                    ctx.stroke();

                    ctx.strokeStyle = idleColor;
                    ctx.lineWidth = 2.5;
                    ctx.shadowColor = idleColor;
                    ctx.shadowBlur = 12;
                    ctx.beginPath();
                    for (let i = 0; i < restingPoints; i++) {
                        const x = i * sliceWidth;
                        const normX = (x / w) * Math.PI * 3.5;
                        const y = horizonY + Math.sin(normX + time * 2.2) * 11 + Math.sin(normX * 1.5 - time * 1.4) * 5;
                        if (i === 0) ctx.moveTo(x, y);
                        else ctx.lineTo(x, y);
                    }
                    ctx.stroke();
                }
                ctx.restore();
            }
        },

        // ---------------------------------------------------------
        // THÈME 1 : CYBER SUBWOOFER (Subwoofer 3D dynamique, débattement physique de membrane, lasers multi-harmoniques & égaliseurs LED)
        // ---------------------------------------------------------
        {
            id: "subwoofer",
            name: "Cyber Subwoofer",
            icon: "🔊",
            coneExcursion: 0,
            coneVelocity: 0,
            shockwaves: [],
            particles: [],
            peakHoldLeft: [],
            peakHoldRight: [],
            polygons: [],
            lastKickTime: 0,

            init() {
                this.particles = [];
                for (let i = 0; i < 90; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = 30 + Math.random() * 850;
                    this.particles.push({
                        angle: angle,
                        dist: dist,
                        speed: 40 + Math.random() * 110,
                        size: 1.0 + Math.random() * 2.5,
                        baseAlpha: 0.25 + Math.random() * 0.75,
                        hue: Math.random() > 0.45 ? 188 : (Math.random() > 0.5 ? 285 : 45),
                        sparkleSpeed: 2 + Math.random() * 5,
                        trailLen: 5 + Math.random() * 16
                    });
                }
                this.peakHoldLeft = new Array(16).fill(0);
                this.peakHoldRight = new Array(16).fill(0);
                this.shockwaves = [];
                this.coneExcursion = 0;
                this.coneVelocity = 0;
                this.polygons = [
                    { pts: [[0, 0], [0.30, 0], [0.22, 0.25], [0, 0.40]], hue: 195, alpha: 0.08 },
                    { pts: [[0, 0.40], [0.22, 0.25], [0.15, 0.50], [0, 0.60]], hue: 280, alpha: 0.06 },
                    { pts: [[0.22, 0.25], [0.36, 0.18], [0.30, 0.42], [0.15, 0.50]], hue: 200, alpha: 0.05 },
                    { pts: [[0, 0.70], [0.18, 0.60], [0.25, 0.88], [0, 1.0]], hue: 190, alpha: 0.09 },
                    { pts: [[0.18, 0.60], [0.34, 0.54], [0.38, 0.80], [0.25, 0.88]], hue: 290, alpha: 0.06 },
                    { pts: [[0.70, 0], [1.0, 0], [1.0, 0.42], [0.78, 0.24]], hue: 285, alpha: 0.08 },
                    { pts: [[0.78, 0.24], [1.0, 0.42], [1.0, 0.62], [0.85, 0.46]], hue: 190, alpha: 0.06 },
                    { pts: [[0.64, 0.18], [0.78, 0.24], [0.85, 0.46], [0.70, 0.40]], hue: 275, alpha: 0.05 },
                    { pts: [[0.75, 0.88], [1.0, 0.68], [1.0, 1.0], [0.68, 1.0]], hue: 185, alpha: 0.10 },
                    { pts: [[0.62, 0.64], [0.84, 0.58], [0.88, 0.82], [0.68, 0.86]], hue: 295, alpha: 0.07 }
                ];
            },

            render(canvas, ctx, audio, time, dt, isLight, isAmbient) {
                const w = window.innerWidth;
                const h = window.innerHeight;
                const cx = w * 0.50;
                const cy = h * 0.48;

                // 1. FOND STUDIO CYBERNÉTIQUE
                ctx.clearRect(0, 0, w, h);

                const bgGrad = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(w, h) * 0.75);
                if (isLight) {
                    bgGrad.addColorStop(0, "#eef2ff");
                    bgGrad.addColorStop(0.45, "#e0e7ff");
                    bgGrad.addColorStop(1, "#cbd5e1");
                } else {
                    bgGrad.addColorStop(0, `rgba(10, 18, 42, ${0.85 + audio.bass * 0.15})`);
                    bgGrad.addColorStop(0.35, "#060914");
                    bgGrad.addColorStop(0.75, "#030408");
                    bgGrad.addColorStop(1, "#010204");
                }
                ctx.fillStyle = bgGrad;
                ctx.fillRect(0, 0, w, h);

                // 2. FACETTES GÉOMÉTRIQUES AMBIANTES
                ctx.save();
                for (const poly of this.polygons) {
                    ctx.beginPath();
                    const p0 = poly.pts[0];
                    ctx.moveTo(p0[0] * w, p0[1] * h);
                    for (let p = 1; p < poly.pts.length; p++) {
                        ctx.lineTo(poly.pts[p][0] * w, poly.pts[p][1] * h);
                    }
                    ctx.closePath();

                    const pGrad = ctx.createLinearGradient(
                        poly.pts[0][0] * w, poly.pts[0][1] * h,
                        poly.pts[2][0] * w, poly.pts[2][1] * h
                    );
                    const alphaBoost = poly.alpha * (1.0 + (poly.hue < 220 ? audio.bass : audio.mid) * 0.8);
                    pGrad.addColorStop(0, `hsla(${poly.hue}, 85%, 60%, ${alphaBoost * 1.5})`);
                    pGrad.addColorStop(1, `hsla(${poly.hue + 25}, 90%, 40%, 0)`);
                    ctx.fillStyle = pGrad;
                    ctx.fill();

                    ctx.strokeStyle = `hsla(${poly.hue}, 95%, 75%, ${alphaBoost * 1.3})`;
                    ctx.lineWidth = 0.8;
                    ctx.stroke();
                }
                ctx.restore();

                // 3. TOURS D'ÉGALISEURS SPECTRAUX SEGMENTÉS (Gauche & Droite avec Peak Hold)
                const numBars = 16;
                const numSegments = 22;
                const segH = 4;
                const segGap = 2.5;
                const leftStart = w * 0.04;
                const leftEnd = w * 0.28;
                const rightStart = w * 0.72;
                const rightEnd = w * 0.96;
                const barSpacingL = (leftEnd - leftStart) / numBars;
                const barSpacingR = (rightEnd - rightStart) / numBars;
                const barW = Math.max(3.5, barSpacingL - 3.5);
                const horizonY = h * 0.50;

                const freqs = audio.freqs || [];
                const freqLen = freqs.length;

                const drawEqColumn = (bx, colIdx, peakArray) => {
                    let level = 0;
                    if (audio.isPlaying && freqLen > 0) {
                        const fIdx = Math.min(freqLen - 1, Math.floor(Math.pow(colIdx / numBars, 1.35) * (freqLen * 0.75)));
                        level = (freqs[fIdx] || 0) / 255;
                    } else {
                        level = Math.sin(colIdx * 0.45 + time * 2.2) * 0.14 + 0.10;
                    }

                    if (level > peakArray[colIdx]) {
                        peakArray[colIdx] = level;
                    } else {
                        peakArray[colIdx] = Math.max(0, peakArray[colIdx] - dt * 0.35);
                    }

                    const activeSegs = Math.round(level * numSegments);
                    const peakSeg = Math.min(numSegments - 1, Math.round(peakArray[colIdx] * numSegments));

                    for (let s = 0; s < numSegments; s++) {
                        const sy = horizonY - (s * (segH + segGap)) + (numSegments * (segH + segGap) * 0.42);
                        const progress = s / numSegments;
                        let segColor, glowColor;
                        if (progress < 0.55) {
                            segColor = isLight ? "#0284c7" : "#00f0ff";
                            glowColor = "#00f0ff";
                        } else if (progress < 0.80) {
                            segColor = isLight ? "#9333ea" : "#a855f7";
                            glowColor = "#a855f7";
                        } else {
                            segColor = isLight ? "#e11d48" : "#f43f5e";
                            glowColor = "#ff007f";
                        }

                        if (s <= activeSegs && activeSegs > 0) {
                            ctx.fillStyle = segColor;
                            ctx.shadowColor = glowColor;
                            ctx.shadowBlur = isLight ? 4 : 8;
                            ctx.fillRect(bx, sy, barW, segH);
                        } else {
                            ctx.fillStyle = isLight ? "rgba(100, 116, 139, 0.12)" : "rgba(30, 41, 59, 0.35)";
                            ctx.shadowBlur = 0;
                            ctx.fillRect(bx, sy, barW, segH);
                        }
                    }

                    if (peakSeg > 0) {
                        const peakY = horizonY - (peakSeg * (segH + segGap)) + (numSegments * (segH + segGap) * 0.42) - 1;
                        ctx.fillStyle = isLight ? "#0f172a" : "#ffffff";
                        ctx.shadowColor = isLight ? "#0284c7" : "#00f0ff";
                        ctx.shadowBlur = isLight ? 6 : 12;
                        ctx.fillRect(bx - 0.5, peakY, barW + 1, 2.5);
                    }
                    ctx.shadowBlur = 0;
                };

                for (let i = 0; i < numBars; i++) {
                    const bxL = leftStart + i * barSpacingL;
                    drawEqColumn(bxL, i, this.peakHoldLeft);

                    const bxR = rightEnd - (i + 1) * barSpacingR;
                    drawEqColumn(bxR, i, this.peakHoldRight);
                }

                // 4. FAISCEAUX LASERS HORIZONTAUX & OSCILLOSCOPE DYNAMIQUE
                const waveform = audio.waveform;
                const waveLen = waveform ? waveform.length : 0;
                const waveAmp = (audio.isPlaying ? (28 + audio.bass * 42) : 14);

                ctx.save();
                ctx.globalCompositeOperation = isLight ? "source-over" : "screen";

                // Faisceau Cyan
                ctx.beginPath();
                ctx.lineWidth = isLight ? 1.8 : 2.4;
                ctx.strokeStyle = isLight ? "rgba(2, 132, 199, 0.75)" : "rgba(0, 240, 255, 0.85)";
                ctx.shadowColor = "#00f0ff";
                ctx.shadowBlur = isLight ? 8 : 16;
                for (let x = 0; x <= w; x += 6) {
                    const normX = x / w;
                    const env = Math.sin(normX * Math.PI);
                    const sinVal = Math.sin(x * 0.014 + time * 3.4) * Math.cos(x * 0.006 - time * 1.8);
                    const y = horizonY + sinVal * waveAmp * env;
                    if (x === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.stroke();

                // Faisceau Magenta / Violet
                ctx.beginPath();
                ctx.lineWidth = isLight ? 1.6 : 2.0;
                ctx.strokeStyle = isLight ? "rgba(147, 51, 234, 0.70)" : "rgba(217, 70, 239, 0.85)";
                ctx.shadowColor = "#d946ef";
                ctx.shadowBlur = isLight ? 8 : 16;
                for (let x = 0; x <= w; x += 6) {
                    const normX = x / w;
                    const env = Math.sin(normX * Math.PI);
                    const sinVal = Math.sin(x * 0.018 - time * 2.6 + 1.2) * Math.sin(x * 0.009 + time * 1.5);
                    const y = horizonY - sinVal * (waveAmp * 0.85) * env;
                    if (x === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.stroke();

                // Faisceau central blanc-bleuté haute énergie (Oscilloscope réel)
                ctx.beginPath();
                ctx.lineWidth = isLight ? 2.0 : 2.8;
                ctx.strokeStyle = isLight ? "#0284c7" : "#ffffff";
                ctx.shadowColor = "#00f0ff";
                ctx.shadowBlur = isLight ? 10 : 20;

                const stepX = 5;
                for (let x = 0; x <= w; x += stepX) {
                    const normX = x / w;
                    const env = Math.sin(normX * Math.PI);
                    let val = 0;
                    if (audio.isPlaying && waveLen > 0) {
                        const sampleIdx = Math.floor(normX * (waveLen - 1));
                        val = ((waveform[sampleIdx] - 128) / 128) * (waveAmp * 1.15) * env;
                    } else {
                        val = Math.sin(x * 0.02 + time * 4.0) * 8 * env;
                    }
                    const y = horizonY + val;
                    if (x === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.stroke();
                ctx.shadowBlur = 0;
                ctx.restore();

                // 5. MODÈLE PHYSIQUE : DÉBATTEMENT DE MEMBRANE (Sensible aux percussions & basses)
                const perc = Math.max(audio.kick || 0, (audio.percussion || 0) * 0.7);
                const effectiveBass = Math.max(audio.bass || 0, (audio.rawBass || 0) * 0.85);

                const targetExcursion = (audio.isPlaying
                    ? (perc * 42 + effectiveBass * 26 + (audio.rawEnergy || 0) * 6)
                    : (Math.sin(time * 1.8) * 2.5)
                );
                const springForce = (targetExcursion - this.coneExcursion) * 28;
                this.coneVelocity = (this.coneVelocity + springForce * dt) * 0.82;
                this.coneExcursion += this.coneVelocity * dt;

                const tiltAngle = -0.32; // ~ -18.3° d'inclinaison
                const normalAngle = tiltAngle + Math.PI / 2;
                const aspectY = 0.84; // Raccourcissement de perspective
                const baseR = Math.min(w * 0.25, h * 0.35, 245);

                const excX = Math.cos(normalAngle) * this.coneExcursion * 0.58;
                const excY = Math.sin(normalAngle) * this.coneExcursion * 0.58;

                // 6. ONDES DE CHOC NÉON CONCENTRIQUES
                const kickOrDrop = Math.max(audio.kick || 0, audio.beat ? 0.42 : 0, (effectiveBass > 0.45) ? 0.40 : 0);
                if (kickOrDrop > 0.38 && (time - this.lastKickTime > 0.16)) {
                    this.lastKickTime = time;
                    this.shockwaves.push({
                        r: baseR * 1.02,
                        maxR: baseR * 2.8,
                        alpha: 0.95,
                        speed: 210 + kickOrDrop * 240,
                        hue: Math.random() > 0.4 ? 188 : 285
                    });
                }

                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate(tiltAngle);

                for (let i = this.shockwaves.length - 1; i >= 0; i--) {
                    const sw = this.shockwaves[i];
                    sw.r += sw.speed * dt;
                    sw.alpha -= dt * 1.35;
                    if (sw.alpha <= 0 || sw.r >= sw.maxR) {
                        this.shockwaves.splice(i, 1);
                        continue;
                    }

                    ctx.beginPath();
                    ctx.ellipse(0, 0, sw.r, sw.r * aspectY, 0, 0, Math.PI * 2);
                    ctx.lineWidth = Math.max(1, 4 * sw.alpha);
                    ctx.strokeStyle = `hsla(${sw.hue}, 95%, 65%, ${sw.alpha * 0.85})`;
                    ctx.shadowColor = `hsl(${sw.hue}, 100%, 50%)`;
                    ctx.shadowBlur = 16 * sw.alpha;
                    ctx.stroke();
                }
                ctx.restore();

                // 7. STRUCTURE 3D DU SUBWOOFER (Châssis, aimant, couronne, membrane & dôme)
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate(tiltAngle);

                // A. Aimant / Culasse arrière (profondeur)
                const rearOffset = 18;
                ctx.beginPath();
                ctx.ellipse(0, rearOffset, baseR * 0.96, baseR * 0.96 * aspectY, 0, 0, Math.PI * 2);
                const magnetGrad = ctx.createLinearGradient(0, -baseR, 0, baseR + rearOffset);
                if (isLight) {
                    magnetGrad.addColorStop(0, "#cbd5e1");
                    magnetGrad.addColorStop(1, "#64748b");
                } else {
                    magnetGrad.addColorStop(0, "#1e293b");
                    magnetGrad.addColorStop(0.5, "#0f172a");
                    magnetGrad.addColorStop(1, "#020617");
                }
                ctx.fillStyle = magnetGrad;
                ctx.fill();

                // Évents acoustiques
                const ventAngles = [0.3, 0.8, 1.3, 1.8, 2.3, 2.8, 3.3, 3.8, 4.3, 4.8, 5.3, 5.8];
                for (const vAng of ventAngles) {
                    const vx = Math.cos(vAng) * baseR * 0.82;
                    const vy = Math.sin(vAng) * baseR * 0.82 * aspectY + (rearOffset * 0.6);
                    ctx.beginPath();
                    ctx.arc(vx, vy, 4.5, 0, Math.PI * 2);
                    ctx.fillStyle = isLight ? "#f59e0b" : `rgba(245, 158, 11, ${0.45 + effectiveBass * 0.45})`;
                    ctx.shadowColor = "#f59e0b";
                    ctx.shadowBlur = 6;
                    ctx.fill();
                }
                ctx.shadowBlur = 0;

                // B. Halos néon extérieurs
                ctx.beginPath();
                const haloCyanR = baseR * (1.08 + effectiveBass * 0.08);
                ctx.ellipse(0, 0, haloCyanR, haloCyanR * aspectY, 0, 0, Math.PI * 2);
                ctx.lineWidth = 3.2;
                ctx.strokeStyle = isLight ? "rgba(2, 132, 199, 0.7)" : `rgba(0, 240, 255, ${0.75 + effectiveBass * 0.25})`;
                ctx.shadowColor = "#00f0ff";
                ctx.shadowBlur = isLight ? 12 : 24;
                ctx.stroke();

                ctx.beginPath();
                const haloMagR = baseR * (1.02 + audio.mid * 0.06);
                ctx.ellipse(0, 0, haloMagR, haloMagR * aspectY, 0, 0, Math.PI * 2);
                ctx.lineWidth = 2.4;
                ctx.strokeStyle = isLight ? "rgba(147, 51, 234, 0.65)" : `rgba(217, 70, 239, ${0.70 + audio.mid * 0.30})`;
                ctx.shadowColor = "#d946ef";
                ctx.shadowBlur = isLight ? 10 : 20;
                ctx.stroke();
                ctx.shadowBlur = 0;

                // C. Couronne externe (Bezel métallique chromé avec 8 boulons hexagonaux)
                const bezelOuterR = baseR;
                const bezelInnerR = baseR * 0.88;

                ctx.beginPath();
                ctx.ellipse(0, 0, bezelOuterR, bezelOuterR * aspectY, 0, 0, Math.PI * 2);
                const bezelGrad = ctx.createLinearGradient(-baseR * 0.7, -baseR * 0.7, baseR * 0.7, baseR * 0.7);
                if (isLight) {
                    bezelGrad.addColorStop(0, "#f8fafc");
                    bezelGrad.addColorStop(0.3, "#94a3b8");
                    bezelGrad.addColorStop(0.7, "#e2e8f0");
                    bezelGrad.addColorStop(1, "#475569");
                } else {
                    bezelGrad.addColorStop(0, "#64748b");
                    bezelGrad.addColorStop(0.25, "#1e293b");
                    bezelGrad.addColorStop(0.5, "#475569");
                    bezelGrad.addColorStop(0.75, "#0f172a");
                    bezelGrad.addColorStop(1, "#334155");
                }
                ctx.fillStyle = bezelGrad;
                ctx.fill();

                ctx.beginPath();
                ctx.ellipse(0, 0, bezelInnerR, bezelInnerR * aspectY, 0, 0, Math.PI * 2);
                ctx.fillStyle = isLight ? "#334155" : "#020617";
                ctx.fill();

                const numBolts = 8;
                for (let b = 0; b < numBolts; b++) {
                    const bAng = (b / numBolts) * Math.PI * 2;
                    const bDist = (bezelOuterR + bezelInnerR) * 0.5;
                    const bx = Math.cos(bAng) * bDist;
                    const by = Math.sin(bAng) * bDist * aspectY;

                    ctx.beginPath();
                    ctx.arc(bx, by, 4.5, 0, Math.PI * 2);
                    ctx.fillStyle = isLight ? "#475569" : "#0f172a";
                    ctx.fill();

                    ctx.beginPath();
                    ctx.arc(bx - 0.5, by - 0.5, 2.8, 0, Math.PI * 2);
                    ctx.fillStyle = isLight ? "#f1f5f9" : "#94a3b8";
                    ctx.fill();
                }

                // D. Suspension périphérique (Surround en caoutchouc toroïdal)
                const surroundShiftX = excX * 0.35;
                const surroundShiftY = excY * 0.35;
                const surroundOuterR = bezelInnerR;
                const surroundInnerR = baseR * 0.74;

                ctx.save();
                ctx.translate(surroundShiftX, surroundShiftY);

                ctx.beginPath();
                ctx.ellipse(0, 0, surroundOuterR, surroundOuterR * aspectY, 0, 0, Math.PI * 2);
                const surroundGrad = ctx.createRadialGradient(
                    0, 0, surroundInnerR,
                    0, 0, surroundOuterR
                );
                if (isLight) {
                    surroundGrad.addColorStop(0, "#475569");
                    surroundGrad.addColorStop(0.5, "#1e293b");
                    surroundGrad.addColorStop(1, "#334155");
                } else {
                    surroundGrad.addColorStop(0, "#090d16");
                    surroundGrad.addColorStop(0.5, "#1e2536");
                    surroundGrad.addColorStop(1, "#070a10");
                }
                ctx.fillStyle = surroundGrad;
                ctx.fill();
                ctx.restore();

                // E. Cône mobile (Membrane conique composite concave)
                ctx.save();
                ctx.translate(excX, excY);

                const coneOuterR = surroundInnerR;
                const capR = baseR * 0.28;

                ctx.beginPath();
                ctx.ellipse(0, 0, coneOuterR, coneOuterR * aspectY, 0, 0, Math.PI * 2);
                const coneGrad = ctx.createRadialGradient(
                    -coneOuterR * 0.15, -coneOuterR * 0.15, capR * 0.8,
                    0, 0, coneOuterR
                );
                if (isLight) {
                    coneGrad.addColorStop(0, "#64748b");
                    coneGrad.addColorStop(0.4, "#94a3b8");
                    coneGrad.addColorStop(0.8, "#cbd5e1");
                    coneGrad.addColorStop(1, "#475569");
                } else {
                    coneGrad.addColorStop(0, "#05070d");
                    coneGrad.addColorStop(0.35, "#111726");
                    coneGrad.addColorStop(0.7, "#1a233a");
                    coneGrad.addColorStop(1, "#0d1320");
                }
                ctx.fillStyle = coneGrad;
                ctx.fill();

                // 6 anneaux concentriques de renfort
                const numRipples = 6;
                ctx.lineWidth = 0.8;
                for (let r = 1; r <= numRipples; r++) {
                    const ripR = capR + (r / (numRipples + 1)) * (coneOuterR - capR);
                    ctx.beginPath();
                    ctx.ellipse(0, 0, ripR, ripR * aspectY, 0, 0, Math.PI * 2);
                    ctx.strokeStyle = isLight ? "rgba(255, 255, 255, 0.25)" : "rgba(0, 240, 255, 0.12)";
                    ctx.stroke();
                }

                // F. Dôme central brillant (Dust cap avec reflet spéculaire courbé)
                const capShiftX = excX * 0.22;
                const capShiftY = excY * 0.22;

                ctx.beginPath();
                ctx.ellipse(capShiftX, capShiftY, capR, capR * aspectY, 0, 0, Math.PI * 2);
                const capGrad = ctx.createRadialGradient(
                    capShiftX - capR * 0.25, capShiftY - capR * 0.25, 2,
                    capShiftX, capShiftY, capR
                );
                if (isLight) {
                    capGrad.addColorStop(0, "#ffffff");
                    capGrad.addColorStop(0.35, "#94a3b8");
                    capGrad.addColorStop(0.85, "#334155");
                    capGrad.addColorStop(1, "#1e293b");
                } else {
                    capGrad.addColorStop(0, "#475569");
                    capGrad.addColorStop(0.35, "#1e293b");
                    capGrad.addColorStop(0.8, "#090d16");
                    capGrad.addColorStop(1, "#030508");
                }
                ctx.fillStyle = capGrad;
                ctx.fill();

                // Reflet spéculaire courbé sur le dôme
                ctx.beginPath();
                ctx.ellipse(
                    capShiftX - capR * 0.22,
                    capShiftY - capR * 0.20 * aspectY,
                    capR * 0.45,
                    capR * 0.25 * aspectY,
                    -0.2, 0, Math.PI * 2
                );
                ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.75)" : "rgba(255, 255, 255, 0.55)";
                ctx.fill();

                ctx.restore();
                ctx.restore();

                // 8. ÉTOILES DE DIAMANT / LENS FLARES SPECTACULAIRES
                const drawLensStar = (starX, starY, starSize, starColor) => {
                    ctx.save();
                    ctx.translate(starX, starY);

                    const flareGlow = ctx.createRadialGradient(0, 0, 1, 0, 0, starSize * 1.8);
                    flareGlow.addColorStop(0, starColor);
                    flareGlow.addColorStop(0.3, "rgba(255, 255, 255, 0.8)");
                    flareGlow.addColorStop(1, "rgba(255, 255, 255, 0)");
                    ctx.fillStyle = flareGlow;
                    ctx.beginPath();
                    ctx.arc(0, 0, starSize * 1.8, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.fillStyle = "#ffffff";
                    ctx.beginPath();
                    ctx.moveTo(0, -starSize);
                    ctx.quadraticCurveTo(0, 0, starSize * 0.15, 0);
                    ctx.quadraticCurveTo(0, 0, 0, starSize);
                    ctx.quadraticCurveTo(0, 0, -starSize * 0.15, 0);
                    ctx.quadraticCurveTo(0, 0, 0, -starSize);
                    ctx.fill();

                    ctx.beginPath();
                    ctx.moveTo(-starSize, 0);
                    ctx.quadraticCurveTo(0, 0, 0, starSize * 0.15);
                    ctx.quadraticCurveTo(0, 0, starSize, 0);
                    ctx.quadraticCurveTo(0, 0, 0, -starSize * 0.15);
                    ctx.quadraticCurveTo(0, 0, -starSize, 0);
                    ctx.fill();

                    ctx.restore();
                };

                // Étoile 1 : Haut-droit de la couronne (Cyan scintillant avec les aigus & percussions)
                const starAngle1 = tiltAngle - 0.70;
                const starDist1 = baseR * 0.98;
                const s1X = cx + Math.cos(starAngle1) * starDist1;
                const s1Y = cy + Math.sin(starAngle1) * starDist1 * aspectY;
                const s1Size = (14 + audio.treble * 16 + audio.snare * 14);
                drawLensStar(s1X, s1Y, s1Size, "rgba(0, 240, 255, 0.95)");

                // Étoile 2 : Bas-gauche de la couronne (Magenta scintillant avec les médiums & caisse claire)
                const starAngle2 = tiltAngle + 2.45;
                const starDist2 = baseR * 0.98;
                const s2X = cx + Math.cos(starAngle2) * starDist2;
                const s2Y = cy + Math.sin(starAngle2) * starDist2 * aspectY;
                const s2Size = (10 + audio.mid * 12 + audio.snare * 10);
                drawLensStar(s2X, s2Y, s2Size, "rgba(217, 70, 239, 0.90)");

                // 9. NUÉE DE PARTICULES RADIALES 3D
                ctx.save();
                for (const p of this.particles) {
                    const speedMultiplier = audio.isPlaying ? (1.0 + audio.energy * 2.2) : 0.6;
                    p.dist += p.speed * speedMultiplier * dt;
                    if (p.dist > Math.max(w, h) * 0.72) {
                        p.dist = 30 + Math.random() * 40;
                        p.angle = Math.random() * Math.PI * 2;
                    }

                    const px = cx + Math.cos(p.angle) * p.dist;
                    const py = cy + Math.sin(p.angle) * p.dist * aspectY;
                    const twinkle = Math.sin(time * p.sparkleSpeed) * 0.3 + 0.7;
                    const alpha = p.baseAlpha * twinkle;

                    const trailLen = p.trailLen * (1.0 + audio.energy * 1.5);
                    const tx = px - Math.cos(p.angle) * trailLen;
                    const ty = py - Math.sin(p.angle) * trailLen * aspectY;

                    ctx.beginPath();
                    ctx.moveTo(tx, ty);
                    ctx.lineTo(px, py);
                    ctx.strokeStyle = `hsla(${p.hue}, 95%, 70%, ${alpha * 0.65})`;
                    ctx.lineWidth = p.size * 0.8;
                    ctx.stroke();

                    ctx.beginPath();
                    ctx.arc(px, py, p.size, 0, Math.PI * 2);
                    ctx.fillStyle = isLight ? `hsl(${p.hue}, 90%, 50%)` : `hsla(${p.hue}, 100%, 75%, ${alpha})`;
                    ctx.shadowColor = `hsl(${p.hue}, 100%, 60%)`;
                    ctx.shadowBlur = isLight ? 3 : 8;
                    ctx.fill();
                }
                ctx.shadowBlur = 0;
                ctx.restore();

                // 10. VIGNETTAGE CINÉMATIQUE SUBTIL
                const vigGrad = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.45, cx, cy, Math.max(w, h) * 0.82);
                if (isLight) {
                    vigGrad.addColorStop(0, "rgba(255, 255, 255, 0)");
                    vigGrad.addColorStop(1, "rgba(148, 163, 184, 0.28)");
                } else {
                    vigGrad.addColorStop(0, "rgba(0, 0, 0, 0)");
                    vigGrad.addColorStop(1, "rgba(0, 0, 0, 0.55)");
                }
                ctx.fillStyle = vigGrad;
                ctx.fillRect(0, 0, w, h);
            }
        },

        // ---------------------------------------------------------
        // THÈME 2 : CYBERPUNK / NIGHT CITY (Skyline filaire, autoroute & Oscilloscope laser épuré)
        // ---------------------------------------------------------
        {
            id: "cyberpunk_city",
            name: "Night City Filaire",
            icon: "🏙️",
            rainDrops: [],
            buildings: [],
            shakeTimer: 0,
            init() {
                this.rainDrops = [];
                for (let i = 0; i < 140; i++) {
                    this.rainDrops.push({
                        x: Math.random() * 2500,
                        y: Math.random() * 1400,
                        len: 14 + Math.random() * 22,
                        speed: 450 + Math.random() * 550
                    });
                }
                this.buildings = [];
                const count = 28;
                for (let b = 0; b < count; b++) {
                    this.buildings.push({
                        seed: Math.random(),
                        hRatio: 0.3 + Math.random() * 0.52,
                        antenna: Math.random() > 0.35,
                        sign: Math.random() > 0.55 ? ["ネオ", "CYBER", "2084", "光", "AUDIO", "YTM", "NEO-TOKYO"][Math.floor(Math.random() * 7)] : null
                    });
                }
            },
            render(canvas, ctx, audio, time, dt, isLight, isAmbient) {
                const w = window.innerWidth;
                const h = window.innerHeight;
                const horizonY = h * 0.72;
                const perc = audio.percussion || 0;
                const kick = audio.kick || 0;
                const energy = audio.energy || 0;

                if (!this.buildings.length) this.init();

                // Screen shake sec et percutant UNIQUEMENT sur impact de grosse caisse
                if (kick > 0.58) this.shakeTimer = 0.16;
                let shakeX = 0, shakeY = 0;
                if (this.shakeTimer > 0) {
                    this.shakeTimer -= dt;
                    const str = this.shakeTimer * 12 * kick;
                    shakeX = (Math.random() - 0.5) * str;
                    shakeY = (Math.random() - 0.5) * str;
                }

                ctx.save();
                ctx.translate(shakeX, shakeY);

                // Ciel dégradé (Lumière cyber pastel en mode clair, nuit profonde en mode sombre)
                const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
                if (isLight) {
                    skyGrad.addColorStop(0, "#dbeafe");
                    skyGrad.addColorStop(0.5, "#e0e7ff");
                    skyGrad.addColorStop(1, "#fce7f3");
                } else {
                    skyGrad.addColorStop(0, "#03040c");
                    skyGrad.addColorStop(0.5, "#0b0922");
                    skyGrad.addColorStop(1, "#1c0d36");
                }
                ctx.fillStyle = skyGrad;
                ctx.fillRect(0, 0, w, horizonY);

                // Éclair néon d'ambiance UNIQUEMENT sur frappe de percussion
                if (perc > 0.52) {
                    ctx.fillStyle = isLight
                        ? `rgba(56, 189, 248, ${perc * 0.28})`
                        : `rgba(180, 230, 255, ${perc * 0.38})`;
                    ctx.fillRect(0, 0, w, horizonY);
                }

                // Gratte-ciels filaires procéduraux sur 100% de la largeur
                const bCount = this.buildings.length;
                const bWidth = w / bCount;
                for (let i = 0; i < bCount; i++) {
                    const b = this.buildings[i];
                    const bx = i * bWidth;
                    const bh = b.hRatio * horizonY;
                    const by = horizonY - bh;

                    const isCyan = i % 2 === 0;
                    const neonColor = isLight
                        ? (isCyan ? "#0284c7" : "#d946ef")
                        : (isCyan ? "#00f0ff" : "#ff0077");

                    if (isLight) {
                        ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
                        ctx.fillRect(bx + 2, by, bWidth - 4, bh);
                    }

                    ctx.strokeStyle = neonColor;
                    ctx.lineWidth = 1.5 + perc * 1.5;
                    ctx.strokeRect(bx + 2, by, bWidth - 4, bh);

                    // Fenêtres matrice : calmes en veille, jaillissent sur percussions
                    const rows = 14;
                    const cols = 4;
                    const wPadX = (bWidth - 8) / cols;
                    const wPadY = (bh - 14) / rows;
                    const freqIndex = Math.min((audio.freqs ? audio.freqs.length - 1 : 0), Math.floor((i / bCount) * (audio.freqs ? audio.freqs.length : 32)));
                    const baseFreq = audio.freqs ? (audio.freqs[freqIndex] / 255) : (0.15 + (audio.mid || 0) * 0.3);
                    const litRows = Math.floor(Math.min(rows, (baseFreq * 0.4 + perc * 0.7) * rows));

                    for (let r = 0; r < rows; r++) {
                        for (let c = 0; c < cols; c++) {
                            const isLit = (rows - 1 - r) < litRows;
                            if (isLit) {
                                if (isLight) {
                                    ctx.fillStyle = isCyan 
                                        ? `rgba(2, 132, 199, ${0.75 + perc * 0.25})` 
                                        : `rgba(234, 88, 12, ${0.8 + perc * 0.2})`;
                                } else {
                                    ctx.fillStyle = isCyan 
                                        ? `rgba(0, 240, 255, ${0.7 + perc * 0.3})` 
                                        : `rgba(255, 230, 90, ${0.7 + perc * 0.3})`;
                                }
                                ctx.fillRect(bx + 4 + c * wPadX, by + 6 + r * wPadY, Math.max(2, wPadX - 3), Math.max(2, wPadY - 3));
                            }
                        }
                    }

                    // Antenne de toit avec balise rouge clignotante
                    if (b.antenna) {
                        ctx.beginPath();
                        ctx.moveTo(bx + bWidth / 2, by);
                        ctx.lineTo(bx + bWidth / 2, by - 28);
                        ctx.strokeStyle = isLight ? "rgba(71, 85, 105, 0.75)" : "rgba(255, 255, 255, 0.7)";
                        ctx.stroke();
                        if (Math.sin(time * 6 + i) > 0 || perc > 0.4) {
                            ctx.fillStyle = perc > 0.4 ? "#dc2626" : "#ef4444";
                            ctx.beginPath();
                            ctx.arc(bx + bWidth / 2, by - 28, 3.5 + perc * 2, 0, Math.PI * 2);
                            ctx.fill();
                        }
                    }

                    // Enseigne néon sur le toit
                    if (b.sign && bh > 110) {
                        ctx.font = "bold 12px monospace";
                        ctx.fillStyle = neonColor;
                        ctx.shadowColor = neonColor;
                        ctx.shadowBlur = isLight ? (4 + perc * 8) : (6 + perc * 14);
                        ctx.fillText(b.sign, bx + 6, by + 20);
                        ctx.shadowBlur = 0;
                    }
                }

                // Autoroute néon & bitume réfléchissant
                const roadH = h - horizonY;
                ctx.fillStyle = isLight ? "#cbd5e1" : "#06050e";
                ctx.fillRect(0, horizonY, w, roadH);

                // Lignes de fuite de route fuyant vers l'horizon
                ctx.strokeStyle = isLight 
                    ? `rgba(2, 132, 199, ${0.35 + perc * 0.45})` 
                    : `rgba(0, 240, 255, ${0.3 + perc * 0.4})`;
                ctx.lineWidth = 1.5 + perc * 1.5;
                const lanes = 20;
                for (let k = 0; k <= lanes; k++) {
                    const rx = (k / lanes) * w;
                    ctx.beginPath();
                    ctx.moveTo(rx, horizonY);
                    ctx.lineTo(w / 2 + (rx - w / 2) * 2.2, h);
                    ctx.stroke();
                }

                // Pluie numérique angulée : régulière au repos, sursaut sur percussions
                const rainSpeedBoost = 0.65 + (energy * 0.25) + (perc * 2.2);
                ctx.strokeStyle = isLight ? "rgba(37, 99, 235, 0.65)" : "rgba(160, 230, 255, 0.7)";
                ctx.lineWidth = 1;
                for (let j = 0; j < this.rainDrops.length; j++) {
                    const rd = this.rainDrops[j];
                    rd.y += rd.speed * rainSpeedBoost * dt;
                    rd.x += rd.speed * 0.3 * dt;
                    if (rd.y > h || rd.x > w) {
                        rd.y = -20;
                        rd.x = Math.random() * (w + 400) - 200;
                    }
                    ctx.beginPath();
                    ctx.moveTo(rd.x, rd.y);
                    ctx.lineTo(rd.x + 4, rd.y + rd.len + perc * 10);
                    ctx.stroke();
                }

                // OSCILLOSCOPE CYBERPUNK : Ligne laser cyan néon
                const wave = audio.waveform;
                const numPts = (wave && wave.length > 1) ? wave.length : 128;
                const stepX = w / (numPts - 1);
                const scopeY = horizonY;

                ctx.beginPath();
                for (let i = 0; i < numPts; i++) {
                    const px = i * stepX;
                    let val = 0;
                    if (wave && wave.length && audio.isPlaying) {
                        val = ((wave[i] - 128) / 128.0) * (h * (0.15 + perc * 0.18));
                    } else {
                        val = Math.sin(i * 0.2 + time * 3.5) * 16;
                    }
                    const py = scopeY + val;
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.strokeStyle = isLight ? "rgba(2, 132, 199, 0.45)" : "rgba(0, 240, 255, 0.4)";
                ctx.lineWidth = 4 + perc * 8;
                ctx.stroke();

                ctx.strokeStyle = isLight ? "#0369a1" : "#ffffff";
                ctx.lineWidth = 2 + perc * 1.5;
                ctx.shadowColor = isLight ? "#38bdf8" : "#00f0ff";
                ctx.shadowBlur = 10 + perc * 18;
                ctx.stroke();
                ctx.shadowBlur = 0;
                ctx.restore();
            }
        },

        // ---------------------------------------------------------
        // THÈME 3 : VECTORIEL ARCADE 1983 (Montagnes filaires & Oscilloscope CRT épuré)
        // ---------------------------------------------------------
        {
            id: "vector_wireframe",
            name: "Vectoriel 1983",
            icon: "📐",
            rotX: 0,
            rotY: 0,
            stars: [],
            init() {
                this.rotX = 0;
                this.rotY = 0;
                this.stars = [];
                for (let i = 0; i < 70; i++) {
                    this.stars.push({ x: Math.random() * 2000, y: Math.random() * 800 });
                }
            },
            render(canvas, ctx, audio, time, dt, isLight, isAmbient) {
                const w = window.innerWidth;
                const h = window.innerHeight;
                const horizonY = h * 0.60;
                const perc = audio.percussion || 0;
                const kick = audio.kick || 0;
                const energy = audio.energy || 0;

                ctx.fillStyle = isLight ? "#f0fdf4" : "#010501";
                ctx.fillRect(0, 0, w, h);

                if (!this.stars.length) this.init();

                // Aberration chromatique laser : UNIQUEMENT sur percussion percutante
                const isChroma = perc > 0.42;
                const chromaDist = Math.pow(perc, 2) * 8.5;
                const baseLaser = isLight ? "#047857" : "#00ff66";
                const passes = isChroma ? (
                    isLight ? [
                        { col: "#e11d48", ox: -chromaDist, oy: -chromaDist * 0.4 },
                        { col: "#047857", ox: 0, oy: 0 },
                        { col: "#0284c7", ox: chromaDist, oy: chromaDist * 0.4 }
                    ] : [
                        { col: "#ff0055", ox: -chromaDist, oy: -chromaDist * 0.4 },
                        { col: "#00ff66", ox: 0, oy: 0 },
                        { col: "#00f0ff", ox: chromaDist, oy: chromaDist * 0.4 }
                    ]
                ) : [{ col: baseLaser, ox: 0, oy: 0 }];

                for (let pass of passes) {
                    ctx.save();
                    ctx.translate(pass.ox, pass.oy);
                    ctx.strokeStyle = pass.col;
                    ctx.shadowColor = isLight ? "#10b981" : pass.col;
                    ctx.shadowBlur = isLight ? (3 + perc * 5) : (7 + perc * 10);
                    ctx.lineWidth = 1.5 + perc * 1.2;

                    // Étoiles vectorielles en losanges
                    for (let st of this.stars) {
                        const sx = st.x % w;
                        const sy = st.y % (horizonY - 20);
                        ctx.strokeRect(sx - 1.5, sy - 1.5, 3 + perc * 2, 3 + perc * 2);
                    }

                    // 1. Montagnes vectorielles : calmes au repos, jaillissent en pics sur percussion
                    const mSegments = 32;
                    const mStep = w / mSegments;
                    ctx.beginPath();
                    for (let s = 0; s <= mSegments; s++) {
                        const freqIdx = Math.min((audio.freqs ? audio.freqs.length - 1 : 0), Math.floor((s / mSegments) * (audio.freqs ? audio.freqs.length : 32)));
                        const baseAmp = (audio.freqs ? (audio.freqs[freqIdx] / 255) : (0.15 + energy * 0.2)) * 0.35;
                        const peakH = 28 + (baseAmp + perc * 0.75) * 165 + Math.sin(s * 0.9 + time * 1.6) * 16;
                        const mx = s * mStep;
                        const my = horizonY - peakH;
                        if (s === 0) ctx.moveTo(mx, my);
                        else ctx.lineTo(mx, my);
                    }
                    ctx.stroke();

                    // Lignes descendantes vers l'horizon
                    ctx.beginPath();
                    for (let s = 0; s <= mSegments; s += 2) {
                        const mx = s * mStep;
                        ctx.moveTo(mx, horizonY);
                        ctx.lineTo(mx + (s % 4 === 0 ? 18 : -18), horizonY - 45);
                    }
                    ctx.stroke();

                    // 2. Grille vectorielle au sol sur toute la largeur
                    ctx.beginPath();
                    ctx.moveTo(0, horizonY);
                    ctx.lineTo(w, horizonY);
                    ctx.stroke();

                    const vLines = 20;
                    for (let vl = -vLines; vl <= vLines; vl++) {
                        ctx.beginPath();
                        ctx.moveTo(w / 2, horizonY);
                        ctx.lineTo(w / 2 + vl * 85, h);
                        ctx.stroke();
                    }

                    // Lignes horizontales en perspective
                    for (let hl = 1; hl <= 10; hl++) {
                        const py = horizonY + Math.pow(hl / 10, 2) * (h - horizonY);
                        ctx.beginPath();
                        ctx.moveTo(0, py);
                        ctx.lineTo(w, py);
                        ctx.stroke();
                    }

                    // 3. Polyèdre 3D rotatif au centre : vitesse posée en repos, accélération angulaire sur percussion
                    this.rotX += (0.45 + perc * 2.4) * dt;
                    this.rotY += (0.65 + perc * 3.0) * dt;

                    const polyCX = w / 2;
                    const polyCY = horizonY - 150;
                    const size = 52 + (energy * 10) + (Math.pow(perc, 2) * 38);

                    const vertices = [
                        [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
                        [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]
                    ];
                    const edges = [
                        [0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],
                        [0,4],[1,5],[2,6],[3,7]
                    ];

                    const proj = [];
                    for (let v of vertices) {
                        let x = v[0] * size;
                        let y = v[1] * size;
                        let z = v[2] * size;

                        const y1 = y * Math.cos(this.rotX) - z * Math.sin(this.rotX);
                        const z1 = y * Math.sin(this.rotX) + z * Math.cos(this.rotX);
                        const x2 = x * Math.cos(this.rotY) + z1 * Math.sin(this.rotY);
                        const z2 = -x * Math.sin(this.rotY) + z1 * Math.cos(this.rotY);

                        const fov = 380 / (380 + z2);
                        proj.push([polyCX + x2 * fov, polyCY + y1 * fov]);
                    }

                    for (let e of edges) {
                        ctx.beginPath();
                        ctx.moveTo(proj[e[0]][0], proj[e[0]][1]);
                        ctx.lineTo(proj[e[1]][0], proj[e[1]][1]);
                        ctx.stroke();
                    }

                    // Réticule de visée vectoriel épuré
                    ctx.beginPath();
                    ctx.arc(polyCX, polyCY, 75 + perc * 18, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(polyCX - 90, polyCY); ctx.lineTo(polyCX - 60, polyCY);
                    ctx.moveTo(polyCX + 60, polyCY); ctx.lineTo(polyCX + 90, polyCY);
                    ctx.moveTo(polyCX, polyCY - 90); ctx.lineTo(polyCX, polyCY - 60);
                    ctx.moveTo(polyCX, polyCY + 60); ctx.lineTo(polyCX + 90, polyCY);
                    ctx.stroke();

                    // 4. OSCILLOSCOPE VECTORIEL SUR L'HORIZON (Faisceau vectoriel vert)
                    const wave = audio.waveform;
                    const numPts = (wave && wave.length > 1) ? wave.length : 128;
                    const stepX = w / (numPts - 1);

                    ctx.beginPath();
                    for (let i = 0; i < numPts; i++) {
                        const px = i * stepX;
                        let val = 0;
                        if (wave && wave.length && audio.isPlaying) {
                            val = ((wave[i] - 128) / 128.0) * (h * (0.13 + perc * 0.16));
                        } else {
                            val = Math.sin(i * 0.15 + time * 3.5) * 14;
                        }
                        const py = horizonY + val;
                        if (i === 0) ctx.moveTo(px, py);
                        else ctx.lineTo(px, py);
                    }
                    ctx.lineWidth = 2.0 + perc * 2.0;
                    ctx.stroke();

                    ctx.restore();
                }
            }
        },

        // ---------------------------------------------------------
        // THÈME 4 : PUITS TETRIS INFINI (Tours de briques latérales & Oscilloscope matriciel)
        // ---------------------------------------------------------
        {
            id: "infinite_tetris",
            name: "Puits Tetris Rétro",
            icon: "🧱",
            fallY: 0,
            activePieceType: 0,
            lineFlashTimer: 0,
            matrixRain: [],
            init() {
                this.fallY = 0;
                this.activePieceType = 0;
                this.lineFlashTimer = 0;
                this.matrixRain = [];
                for (let i = 0; i < 40; i++) {
                    this.matrixRain.push({
                        x: Math.random() * 2000,
                        y: Math.random() * 1200,
                        speed: 80 + Math.random() * 140,
                        color: ["#9bbc0f", "#8bac0f", "#306230", "#38bdf8", "#ec4899", "#f59e0b"][Math.floor(Math.random() * 6)]
                    });
                }
            },
            render(canvas, ctx, audio, time, dt, isLight, isAmbient) {
                const w = window.innerWidth;
                const h = window.innerHeight;
                const perc = audio.percussion || 0;
                const kick = audio.kick || 0;
                const snare = audio.snare || 0;
                const energy = audio.energy || 0;

                // Fond d'écran Game Boy LCD clair vs arcade sombre
                ctx.fillStyle = isLight ? "#e9eee0" : "#0a120a";
                ctx.fillRect(0, 0, w, h);

                if (!this.matrixRain.length) this.init();

                // Faint Matrix Rain de tétrominos en arrière-plan plein écran
                for (let m of this.matrixRain) {
                    m.y += m.speed * dt * (0.5 + perc * 1.8);
                    if (m.y > h) m.y = -20;
                    ctx.fillStyle = m.color;
                    ctx.globalAlpha = isLight ? (0.18 + perc * 0.15) : (0.12 + perc * 0.12);
                    ctx.fillRect(m.x % w, m.y, 14, 14);
                    ctx.globalAlpha = 1.0;
                }

                const cols = 10;
                const rows = 18;
                const bSize = Math.floor(Math.min(w * 0.038, h * 0.046));
                const wellW = cols * bSize;
                const wellH = rows * bSize;
                const wellX = Math.floor((w - wellW) / 2);
                const wellY = Math.floor((h - wellH) / 2);

                const colors = isLight
                    ? ["#16a34a", "#0284c7", "#e11d48", "#d97706", "#9333ea", "#0d9488", "#2563eb"]
                    : ["#9bbc0f", "#8bac0f", "#306230", "#38bdf8", "#ec4899", "#f59e0b", "#a855f7"];

                // Puits central : fond légèrement contrasté en mode clair
                if (isLight) {
                    ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
                    ctx.fillRect(wellX, wellY, wellW, wellH);
                }

                // Bordures du puits central
                ctx.strokeStyle = isLight
                    ? (perc > 0.4 ? "#166534" : "#1f3d1f")
                    : (perc > 0.4 ? "#9bbc0f" : "#8bac0f");
                ctx.lineWidth = 3.5 + perc * 1.5;
                ctx.strokeRect(wellX - 3, wellY - 3, wellW + 6, wellH + 6);

                // Pièces fixes empilées au fond
                const settledRows = 6;
                for (let r = rows - settledRows; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        const filled = (r * 7 + c * 13) % 5 !== 0;
                        if (filled) {
                            ctx.fillStyle = colors[(r + c) % colors.length];
                            ctx.fillRect(wellX + c * bSize + 1, wellY + r * bSize + 1, bSize - 2, bSize - 2);
                        }
                    }
                }

                // Pièce active : descente tranquille au repos, chute accélérée / slam sur impact de grosse caisse
                const speed = 12 + (energy * 8) + (kick * 65);
                this.fallY = (this.fallY + speed * dt) % (rows - settledRows - 2);
                const curRow = Math.floor(this.fallY);
                const curCol = 4;
                ctx.fillStyle = isLight
                    ? (perc > 0.4 ? "#d97706" : "#15803d")
                    : (perc > 0.4 ? "#facc15" : "#9bbc0f");
                ctx.fillRect(wellX + curCol * bSize + 1, wellY + curRow * bSize + 1, bSize - 2, bSize - 2);
                ctx.fillRect(wellX + (curCol + 1) * bSize + 1, wellY + curRow * bSize + 1, bSize - 2, bSize - 2);
                ctx.fillRect(wellX + curCol * bSize + 1, wellY + (curRow + 1) * bSize + 1, bSize - 2, bSize - 2);
                ctx.fillRect(wellX + (curCol + 1) * bSize + 1, wellY + (curRow + 1) * bSize + 1, bSize - 2, bSize - 2);

                // Flash de ligne complète : UNIQUEMENT sur frappe de snare / caisse claire
                if (snare > 0.55 || perc > 0.6) this.lineFlashTimer = 0.22;
                if (this.lineFlashTimer > 0) {
                    this.lineFlashTimer -= dt;
                    ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, this.lineFlashTimer * 4.5)})`;
                    ctx.fillRect(wellX, wellY + (rows - 3) * bSize, wellW, bSize);
                }

                // COLONNES LATÉRALES : Grandes tours d'égaliseurs en briques (calmes au repos, jaillissent sur percussions)
                const towerColsLeft = Math.max(4, Math.floor((wellX - 60) / bSize));
                const towerColsRight = towerColsLeft;

                // Tour Gauche
                for (let tc = 0; tc < towerColsLeft; tc++) {
                    const freqIdx = Math.min((audio.freqs ? audio.freqs.length - 1 : 0), tc * 3);
                    const baseAmp = (audio.freqs ? (audio.freqs[freqIdx] / 255) : energy) * 0.35;
                    const litCount = Math.floor(Math.min(rows, (baseAmp + perc * 0.75) * rows));
                    const tx = 20 + tc * bSize;
                    for (let tr = 0; tr < litCount; tr++) {
                        const ry = wellY + (rows - 1 - tr) * bSize;
                        ctx.fillStyle = colors[tc % colors.length];
                        ctx.fillRect(tx + 1, ry + 1, bSize - 2, bSize - 2);
                    }
                }

                // Tour Droite
                for (let tc = 0; tc < towerColsRight; tc++) {
                    const freqIdx = Math.min((audio.freqs ? audio.freqs.length - 1 : 0), (towerColsRight - tc) * 3);
                    const baseAmp = (audio.freqs ? (audio.freqs[freqIdx] / 255) : energy) * 0.35;
                    const litCount = Math.floor(Math.min(rows, (baseAmp + perc * 0.75) * rows));
                    const tx = (w - 20 - towerColsRight * bSize) + tc * bSize;
                    for (let tr = 0; tr < litCount; tr++) {
                        const ry = wellY + (rows - 1 - tr) * bSize;
                        ctx.fillStyle = colors[(tc + 2) % colors.length];
                        ctx.fillRect(tx + 1, ry + 1, bSize - 2, bSize - 2);
                    }
                }

                // HUD Rétro Arcade en haut
                ctx.font = "bold 14px monospace";
                ctx.fillStyle = isLight ? "#1f3d1f" : "#8bac0f";
                ctx.fillText(`SCORE: ${(time * 120).toFixed(0).padStart(6, '0')}`, 30, 40);
                ctx.fillText(`LEVEL: ${(1 + Math.floor(time / 30))}`, 30, 60);
                ctx.fillText(`LINES: ${(Math.floor(time * 2))}`, w - 160, 40);
                ctx.fillText(`PERC: ${(perc * 100).toFixed(0)}%`, w - 160, 60);

                // OSCILLOSCOPE MATRICIEL TETRIS : Ligne de briques néon sur toute la largeur
                const wave = audio.waveform;
                const numPts = (wave && wave.length > 1) ? wave.length : 128;
                const stepX = w / 32;
                const scopeBaseY = h - 50;

                ctx.save();
                for (let i = 0; i < 32; i++) {
                    const waveIdx = Math.floor((i / 32) * numPts);
                    let val = 0;
                    if (wave && wave.length && audio.isPlaying) {
                        val = ((wave[waveIdx] - 128) / 128.0) * (bSize * (1.8 + perc * 2.2));
                    } else {
                        val = Math.sin(i * 0.35 + time * 3.5) * (bSize * 1.2);
                    }
                    const bx = i * stepX + (stepX - bSize) / 2;
                    const by = scopeBaseY + val;

                    ctx.fillStyle = colors[i % colors.length];
                    ctx.shadowColor = colors[i % colors.length];
                    ctx.shadowBlur = isLight ? (4 + perc * 6) : (6 + perc * 10);
                    ctx.fillRect(bx, by, bSize, bSize);
                }
                ctx.shadowBlur = 0;
                ctx.restore();
            }
        }
    ]
};

// Aliases pour rétrocompatibilité
const SynthwaveVisualizer = AmbientThemeManager;
window.SynthwaveVisualizer = AmbientThemeManager;
window.AmbientThemeManager = AmbientThemeManager;
window.AmbientCanvas = AmbientThemeManager;

function setupSynthwaveVisualizer() {
    try {
        AmbientThemeManager.init();
    } catch (err) {
        console.warn("AmbientThemeManager init warning:", err);
    }
}


window.setupSynthwaveVisualizer = setupSynthwaveVisualizer;

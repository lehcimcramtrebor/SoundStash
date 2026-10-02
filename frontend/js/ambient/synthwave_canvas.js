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
        }

        // Lissage temporel exponentiel
        this.smoothedBass += (rawBass - this.smoothedBass) * 0.35;
        this.smoothedMid += (rawMid - this.smoothedMid) * 0.3;
        this.smoothedTreble += (rawTreble - this.smoothedTreble) * 0.4;
        this.smoothedEnergy += (rawEnergy - this.smoothedEnergy) * 0.3;

        // Détection de battement (Kick / Beat classique)
        const isBeat = rawBass > 0.52 && (rawBass - this.smoothedBass) > 0.1;
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
            const kickTransient = Math.max(deltaBass * 3.6, (rawBass - this.smoothedBass > 0.08) ? (rawBass - this.smoothedBass) * 3.0 : 0);
            if (kickTransient > 0.28 && rawBass > 0.26) {
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
    // LISTE DES 11 THÈMES VISUELS PROCÉDURAUX (CANVAS 2D 60 FPS)
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
        // THÈME 1 : CYBERPUNK / NIGHT CITY (Skyline filaire, autoroute & Oscilloscope laser épuré)
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
        // THÈME 2 : VECTORIEL ARCADE 1983 (Montagnes filaires & Oscilloscope CRT épuré)
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
        // THÈME 3 : PUITS TETRIS INFINI (Tours de briques latérales & Oscilloscope matriciel)
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

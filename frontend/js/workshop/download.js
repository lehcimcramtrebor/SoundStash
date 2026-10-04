// =========================================================
// SoundStash - Module Workshop / Download
// Téléchargement de flux, import local & file d'attente
// =========================================================

// =========================================================
// Téléchargement Direct depuis la Recherche
// =========================================================
async function downloadItemFromSearch(url, title, formatParam, btnEl = null, originalHtml = null, item = null) {
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = `⏳ Ajout...`;
    }
    try {
        const defaultQuality = currentConfig.default_quality || (document.getElementById("quality-select") ? document.getElementById("quality-select").value : "auto");
        const autoRetag = currentConfig.auto_retag !== false;
        const namingPattern = currentConfig.naming_pattern || "{track:02d} {title}";
        const cleanTitles = currentConfig.clean_titles !== false;

        const isPlaylist = isPlaylistUrlOrItem(item, url);

        const effectiveTitle = (item && item.title) ? item.title : title;
        const effectiveArtist = (item && item.artist) ? item.artist : null;
        const dlRes = await fetch("/api/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                url: url,
                title: effectiveTitle,
                format: formatParam,
                quality: defaultQuality,
                auto_retag: autoRetag,
                naming_pattern: namingPattern,
                clean_titles: cleanTitles,
                is_playlist: isPlaylist,
                custom_album: isPlaylist ? effectiveTitle : null,
                custom_artist: isPlaylist ? effectiveArtist : null,
                origin_album: (item && item.type === "track" && item.album) ? item.album : null,
                thumbnail_url: item && item.thumbnail ? item.thumbnail : null
            })
        });

        const dlData = await dlRes.json();
        if (dlData.success) {
            const isPlayerBtn = btnEl && (btnEl.id === "player-btn-download-online" || btnEl.id === "player-btn-download-album" || btnEl.id === "mini-player-download-btn");
            if (btnEl && !isPlayerBtn) {
                btnEl.innerHTML = `✓ Ajouté`;
            }
            const successLabel = formatParam === "mp4" ? `Clip vidéo "${title}" ajouté à la file d'attente (MP4) !` : `"${title}" ajouté à la file d'attente !`;
            showToast(successLabel, "Voir la file", () => {
                switchTab("tab-download");
            });

            if (item) {
                item.status = "queued";
                item.statusLabel = "⏳ En file";
                item.statusBadgeClass = "badge-status-queued";
                if (typeof window.updateCardStatusBadge === "function") {
                    window.updateCardStatusBadge(item);
                }
            }
            if (btnEl && originalHtml && !isPlayerBtn) {
                setTimeout(() => {
                    btnEl.disabled = false;
                    btnEl.innerHTML = originalHtml;
                }, 2500);
            }
            if (typeof AudioPlayer !== "undefined" && typeof AudioPlayer.updateOnlineDownloadButtons === "function") {
                AudioPlayer.updateOnlineDownloadButtons();
            }
        } else {
            if (btnEl && originalHtml) {
                btnEl.disabled = false;
                btnEl.innerHTML = originalHtml;
            }
            if (typeof AudioPlayer !== "undefined" && typeof AudioPlayer.updateOnlineDownloadButtons === "function") {
                AudioPlayer.updateOnlineDownloadButtons();
            }
            await showModalAlert("Erreur", dlData.detail || "Impossible d'ajouter à la file d'attente.", "danger");
        }
    } catch (err) {
        if (btnEl && originalHtml) {
            btnEl.disabled = false;
            btnEl.innerHTML = originalHtml;
        }
        if (typeof AudioPlayer !== "undefined" && typeof AudioPlayer.updateOnlineDownloadButtons === "function") {
            AudioPlayer.updateOnlineDownloadButtons();
        }
        await showModalAlert("Erreur réseau", err.message, "danger");
    }
}

function isYouTubeUrl(rawUrl) {
    if (!rawUrl) return false;
    try {
        const parsed = new URL(rawUrl.startsWith("http") ? rawUrl : ("https://" + rawUrl));
        const host = parsed.hostname.toLowerCase();
        return (
            host === "youtube.com" ||
            host.endsWith(".youtube.com") ||
            host === "youtu.be" ||
            host.endsWith(".youtu.be")
        );
    } catch (e) {
        return false;
    }
}

function setupDownloadForm() {
    const form = document.getElementById("download-form");
    const pasteBtn = document.getElementById("paste-btn");
    const urlInput = document.getElementById("url-input");
    const cancelBtn = document.getElementById("cancel-download-btn");
    const clearLogsBtn = document.getElementById("clear-logs-btn");
    const startBtn = document.getElementById("start-download-btn");
    const clearQueueBtn = document.getElementById("clear-queue-btn");

    // Bascule dynamique qualité audio / vidéo selon le format sélectionné
    const formatSelect = document.getElementById("format-select");
    const audioQualityGroup = document.getElementById("audio-quality-group");
    const videoQualityGroup = document.getElementById("video-quality-group");

    function updateFormatQualityVisibility() {
        if (!formatSelect) return;
        const isMp4 = formatSelect.value === "mp4";
        if (audioQualityGroup) audioQualityGroup.style.display = isMp4 ? "none" : "";
        if (videoQualityGroup) videoQualityGroup.style.display = isMp4 ? "" : "none";
    }

    if (formatSelect) {
        formatSelect.addEventListener("change", updateFormatQualityVisibility);
        updateFormatQualityVisibility();
    }


    function updateUrlSourceBadge() {
        const badge = document.getElementById("url-source-badge");
        if (!badge || !urlInput) return;
        const val = urlInput.value.trim();
        if (!val) {
            badge.style.display = "none";
            return;
        }
        badge.style.display = "inline-flex";
        if (isYouTubeUrl(val)) {
            badge.className = "badge-source-yt";
            badge.textContent = "Flux Web";
        } else {
            badge.className = "badge-source-ext";
            badge.textContent = "🌐 Source Externe";
        }
    }

    // Persistance du texte saisi dans l'URL et actualisation du badge de source
    if (urlInput) {
        urlInput.addEventListener("input", () => {
            const val = urlInput.value;
            updateUrlSourceBadge();
            try {
                if (val.trim()) {
                    localStorage.setItem("ytm_download_url", val);
                } else {
                    localStorage.removeItem("ytm_download_url");
                }
            } catch (e) {}
        });
    }

    pasteBtn.addEventListener("click", async () => {
        let pasted = false;

        // 0. Essai via l'API native Electron si disponible
        if (window.electronAPI && typeof window.electronAPI.readClipboard === "function") {
            try {
                const text = await window.electronAPI.readClipboard();
                if (text && text.trim()) {
                    urlInput.value = text.trim();
                    try { localStorage.setItem("ytm_download_url", urlInput.value); } catch (e) {}
                    pasted = true;
                }
            } catch (err) {
                console.warn("window.electronAPI.readClipboard error:", err);
            }
        }

        // 1. Essai via l'API Clipboard standard
        if (!pasted && navigator.clipboard && navigator.clipboard.readText) {
            try {
                const text = await navigator.clipboard.readText();
                if (text && text.trim()) {
                    urlInput.value = text.trim();
                    try { localStorage.setItem("ytm_download_url", urlInput.value); } catch (e) {}
                    pasted = true;
                }
            } catch (err) {
                console.warn("navigator.clipboard.readText inaccessible ou refusé:", err);
            }
        }

        // 2. Si non collé, donner le focus et tenter execCommand
        if (!pasted) {
            urlInput.focus();
            urlInput.select();
            try {
                if (document.execCommand("paste")) {
                    pasted = true;
                    try { localStorage.setItem("ytm_download_url", urlInput.value); } catch (e) {}
                }
            } catch (_) {}
        }

        updateUrlSourceBadge();

        // 3. Si toujours vide, afficher un message d'aide clair
        if (!pasted && !urlInput.value.trim()) {
            await showModalAlert(
                "Accès au Presse-papiers Bloqué",
                "L'accès direct au presse-papiers a été restreint par votre navigateur.\n\nVeuillez coller directement avec le raccourci Clavier Ctrl+V (ou clic droit > Coller) dans le champ de saisie.",
                "info"
            );
            urlInput.focus();
        }
    });

    clearLogsBtn.addEventListener("click", () => {
        document.getElementById("console-output").innerHTML = "";
    });

    cancelBtn.addEventListener("click", async () => {
        const confirmed = await showModalConfirm(
            "Annuler le téléchargement",
            "Voulez-vous vraiment annuler le téléchargement en cours ?",
            "Oui, Annuler",
            true
        );
        if (confirmed) {
            await fetch("/api/queue/cancel-current", { method: "POST" });
        }
    });

    if (clearQueueBtn) {
        clearQueueBtn.addEventListener("click", async () => {
            const confirmed = await showModalConfirm(
                "Vider la file d'attente",
                "Voulez-vous vraiment annuler tous les téléchargements en attente dans la file ?",
                "Tout annuler",
                true
            );
            if (confirmed) {
                await fetch("/api/queue/cancel-all", { method: "POST" });
            }
        });
    }

    async function handleDownloadSubmit(e) {
        if (e) e.preventDefault();
        
        let url = urlInput.value.trim();
        url = url.replace(/^["']|["']$/g, "").trim();

        if (!url) {
            await showModalAlert(
                "URL requise",
                "Veuillez renseigner ou coller une URL.",
                "warning"
            );
            urlInput.focus();
            return;
        }

        // Ajouter https:// si omis
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "https://" + url;
        }

        const isExternal = !isYouTubeUrl(url);

        // Vider immédiatement la barre d'adresse et lui redonner le focus
        urlInput.value = "";
        updateUrlSourceBadge();
        urlInput.focus();
        try {
            localStorage.removeItem("ytm_download_url");
        } catch (e) {}

        const format = document.getElementById("format-select").value;
        const quality = document.getElementById("quality-select").value;
        const videoQuality = document.getElementById("video-quality-select") ? document.getElementById("video-quality-select").value : (currentConfig.default_video_quality || "1080p");
        const autoRetag = document.getElementById("auto-retag-checkbox").checked;
        const cleanTitles = document.getElementById("clean-titles-checkbox").checked;

        document.getElementById("progress-container").style.display = "block";

        const isPlaylist = isPlaylistUrlOrItem(null, url);
        const isAlbum = url.includes("OLAK") || url.includes("MPREb_") || url.includes("/album");
        currentTaskIsPlaylist = isPlaylist;
        currentTaskIsSingle = !isPlaylist && !isAlbum && (url.includes("watch?v=") || url.includes("/watch") || url.includes("/shorts/") || url.includes("youtu.be/"));
        const itemCountEl = document.getElementById("progress-item-count");
        if (itemCountEl) {
            itemCountEl.textContent = isPlaylist ? "Playlist" : (currentTaskIsSingle ? "Titre unique" : (isExternal ? "Source externe" : "Piste -- / --"));
        }

        try {
            const res = await fetch("/api/download", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    url: url,
                    format: format,
                    quality: quality,
                    video_quality: videoQuality,
                    auto_retag: autoRetag,
                    clean_titles: cleanTitles,
                    is_playlist: isPlaylist,
                    is_external: isExternal
                })
            });

            const result = await res.json();
            if (!res.ok) {
                await showModalAlert("Erreur", result.detail || "Erreur lors du démarrage du téléchargement.", "danger");
            }
        } catch (err) {
            await showModalAlert("Erreur réseau", err.message, "danger");
        }
    }

    form.addEventListener("submit", handleDownloadSubmit);

    // Câblage de l'import local de médias et zone de glisser-déposer vers _imports
    async function handleLocalImport(paths) {
        if (!paths || paths.length === 0) return;
        showToast("Dépôt immédiat dans le sas _imports de la collection...", "info");
        try {
            const res = await fetch("/api/library/import-local", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ paths: Array.isArray(paths) ? paths : [paths] })
            });
            const data = await res.json();
            if (data.success) {
                showToast(data.message || "Éléments déposés dans _imports avec succès ! Intégration prioritaire en cours...", "success");
                if (typeof loadLibrary === "function") loadLibrary();
                if (window.AudioPlayer) {
                    if (window.AudioPlayer.librarySource !== "library") {
                        window.AudioPlayer.librarySource = "library";
                    }
                    if (typeof window.AudioPlayer.loadLibraryData === "function") {
                        window.AudioPlayer.loadLibraryData();
                    }
                }
            } else {
                showToast(data.message || "Erreur lors de l'importation locale.", "danger");
            }
        } catch (e) {
            showToast("Erreur import local : " + e.message, "danger");
        }
    }

    const btnImportFolder = document.getElementById("btn-import-folder");
    if (btnImportFolder) {
        btnImportFolder.addEventListener("click", async () => {
            let selected = "";
            if (window.electronAPI && typeof window.electronAPI.selectFolder === "function") {
                selected = await window.electronAPI.selectFolder();
            } else {
                const res = await fetch("/api/browse-folder", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({})
                });
                const bData = await res.json();
                selected = bData.path || "";
            }
            if (selected) {
                await handleLocalImport([selected]);
            }
        });
    }

    const btnImportFiles = document.getElementById("btn-import-files");
    if (btnImportFiles) {
        btnImportFiles.addEventListener("click", async () => {
            let files = [];
            if (window.electronAPI && typeof window.electronAPI.selectFiles === "function") {
                files = await window.electronAPI.selectFiles();
            } else {
                const input = document.createElement("input");
                input.type = "file";
                input.multiple = true;
                input.accept = "audio/*,video/*,image/*";
                input.onchange = () => {
                    const paths = Array.from(input.files).map(f => {
                        if (window.electronAPI && typeof window.electronAPI.getPathForFile === "function") {
                            const p = window.electronAPI.getPathForFile(f);
                            if (p) return p;
                        }
                        return f.path || f.name;
                    }).filter(Boolean);
                    if (paths.length > 0) handleLocalImport(paths);
                };
                input.click();
                return;
            }
            if (files && files.length > 0) {
                await handleLocalImport(files);
            }
        });
    }

    const dropZone = document.getElementById("import-drop-zone");
    if (dropZone) {
        dropZone.addEventListener("click", () => {
            if (btnImportFiles) btnImportFiles.click();
        });
        dropZone.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add("drag-over");
        });
        dropZone.addEventListener("dragleave", (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove("drag-over");
        });
        dropZone.addEventListener("drop", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove("drag-over");
            const dt = e.dataTransfer;
            if (!dt || !dt.files || dt.files.length === 0) return;
            const paths = [];
            for (let i = 0; i < dt.files.length; i++) {
                const f = dt.files[i];
                let p = f.path;
                if (!p && window.electronAPI && typeof window.electronAPI.getPathForFile === "function") {
                    try {
                        p = window.electronAPI.getPathForFile(f);
                    } catch (err) {
                        console.warn("getPathForFile error:", err);
                    }
                }
                if (p) paths.push(p);
            }
            if (paths.length > 0) {
                await handleLocalImport(paths);
            } else {
                showToast("Fichiers déposés sans chemin d'accès absolu accessible.", "warning");
            }
        });

        // Empêcher l'ouverture sauvage par le navigateur en cas de glisser-déposer hors zone
        window.addEventListener("dragover", (e) => {
            if (!e.target.closest || !e.target.closest("#import-drop-zone")) {
                e.preventDefault();
            }
        });
        window.addEventListener("drop", (e) => {
            if (!e.target.closest || !e.target.closest("#import-drop-zone")) {
                e.preventDefault();
            }
        });
    }

    // Restauration de l'URL précédemment saisie
    try {
        const savedUrl = localStorage.getItem("ytm_download_url");
        if (savedUrl && urlInput) {
            urlInput.value = savedUrl;
            updateUrlSourceBadge();
        }
    } catch (e) {}
}


// Exports globaux
window.downloadItemFromSearch = downloadItemFromSearch;
window.setupDownloadForm = setupDownloadForm;
window.isYouTubeUrl = isYouTubeUrl;


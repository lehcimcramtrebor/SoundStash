# 🏛️ Architecture Frontend Modulaire — SoundStash v3.0.0
> **Guide de référence technique pour les développeurs et les IA locales à contexte restreint.**

---

## 📌 1. Principes Fondamentaux de l'Architecture

L'application frontend de **SoundStash v3.0.0** a été intégralement découpée pour éliminer les fichiers monolithiques géants (~20 000 lignes) et permettre à n'importe quelle IA locale (avec une fenêtre de contexte de 4k à 16k tokens) d'analyser, comprendre et modifier un composant sans risque d'effet de bord.

1. **Modularité Forte & Responsabilité Unique** : Chaque fichier CSS et JS traite un domaine métier spécifique et délimité.
2. **Compatibilité Ascendante Totale (Non-Module & Inline HTML)** : Tous les gestionnaires d'événements inline du DOM (`onclick="AudioPlayer.play()"`, etc.) continuent de fonctionner sans rupture car les objets et fonctions publiques sont systématiquement exposés sur `window`.
3. **Idempotence des Variables d'État** : Les états partagés sont stockés sur `window` (ex: `window.currentAlbumPath`, `window.isWorkshopDrawerOpen`) afin d'éviter tout conflit de déclaration `let` entre scripts.
4. **Validation Systématique** : Tout changement doit valider la suite de tests automatisée sous Electron réel (`npx electron scripts/test_core_modules.js`) et la concordance SHA256 des builds (`python scripts/deploy_audit_fixes.py`).

---

## 🎨 2. Cartographie des Feuilles de Style CSS (`frontend/css/`)

Le fichier racine `frontend/style.css` (45 lignes) sert uniquement de chef d'orchestre via des directives `@import` vers 11 fichiers spécialisés :

| Fichier CSS | Taille | Rôle & Composants Cibles |
| :--- | :--- | :--- |
| `frontend/css/variables.css` | 134 lignes | Variables CSS globales (`--bg-primary`, `--accent-color`, `--text-main`, gradients synthwave, tokens de thèmes sombre/clair). |
| `frontend/css/base.css` | 240 lignes | Reset, typographie, boutons de base (`.btn`, `.btn-primary`), barres de défilement personnalisées et animations globales. |
| `frontend/css/layout.css` | 741 lignes | En-tête global (`#main-header`), indicateurs de statut, barre de transport supérieure et conteneurs d'onglets. |
| `frontend/css/modals.css` | 1 093 lignes | Modales génériques, système de dialogue custom (Alert, Confirm, Prompt), modale des paramètres (`#settings-modal`), panneau de migration v3. |
| `frontend/css/workshop.css` | 1 129 lignes | Tiroir escamotable Atelier (`#workshop-drawer`), grille de recherche en ligne, cartes de résultats, formulaire de téléchargement et logs temps réel. |
| `frontend/css/editor.css` | 2 546 lignes | Interface d'édition de tags Kid3 (`#tab-editor`), tableau des pistes, sélecteur de pochettes, autocomplétion intelligente, modale de reconstitution d'album (`#reconstitute-modal`). |
| `frontend/css/playlists.css` | 845 lignes | Vue Playlists (`#player-view-playlists`), mosaïques de 4 pochettes dynamiques, modale d'ajout à une playlist, formulaires de critères intelligents. |
| `frontend/css/player.css` | 3 138 lignes | Écran d'accueil permanent (`#player-panel`), vue En cours d'écoute, grille d'albums/artistes, catalogue Tout, tiroir de file d'attente (`#queue-drawer`), mini-dock flottant. |
| `frontend/css/equalizer.css` | 1 144 lignes | Modale de l'égaliseur 10 bandes DSP (`#equalizer-modal-backdrop`), sliders verticaux, potentiomètre de loudness physiologique, affichage de la courbe de réponse. |
| `frontend/css/video.css` | 1 086 lignes | Hub Vidéo Musical 16:9 (`#player-view-videos`), modale de lecture cinéma in-app (`#video-modal-backdrop`), barres de contrôles vidéo, sélecteurs de qualité MP4. |
| `frontend/css/ambient.css` | 517 lignes | Mode Ambiance plein écran immersif (`#ambient-mode-overlay`), canvas audio-réactif, idle auto-hide des commandes, horloge rétro synthwave. |

---

## ⚡ 3. Cartographie des Modules JavaScript (`frontend/js/`)

L'arborescence JS regroupe **20 modules autonomes** et un orchestrateur ultra-léger :

```
frontend/
├── app.js                          # (455 lignes) Orchestrateur principal & cycle de vie
└── js/
    ├── core/                       # Socle universel partagé
    │   ├── icons.js                # (14 lignes)   ICONS_SVG (info, success, warning, danger)
    │   ├── utils.js                # (231 lignes)  escapeHtml, cleanArtistName, formatTime, isPlaylistUrlOrItem
    │   ├── modals.js               # (411 lignes)  showModalAlert, showModalConfirm, showModalPrompt, showToast
    │   └── websocket.js            # (515 lignes)  setupWebSocket, handleWsEvent, updateSyncWatchIndicator
    ├── ambient/                    # Mode immersif audio-réactif
    │   ├── synthwave_canvas.js     # (1 132 lignes) AmbientThemeManager, canvas 2D, presets visuels
    │   └── ambient_manager.js      # (512 lignes)  ScreenWakeLockManager, AmbientVisualizer, idle auto-hide
    ├── playlists/                  # Playlists personnalisées
    │   └── user_playlists.js       # (1 698 lignes) UserPlaylists, mosaïques dynamiques, critères intelligents
    ├── extras/                     # Fonctionnalités avancées & sécurité
    │   ├── settings.js             # (1 591 lignes) openSettingsModal, configuration, maintenance, Kid3 audit
    │   ├── sleep_timer.js          # (209 lignes)  SleepTimer (minuteur fade-out & mode fin d'album)
    │   ├── party_lock.js           # (455 lignes)  PartyLock (code PIN, protection contre suppression)
    │   └── user_guide.js           # (217 lignes)  WelcomeWizard, setupUserGuideModal
    ├── workshop/                   # Atelier de recherche & téléchargement
    │   ├── workbench.js            # (377 lignes)  Tiroir escamotable canopy, switchWorkflowTab, setupTabs
    │   ├── search.js               # (1 606 lignes) setupSearch, filtres, tri, setupAlbumPreview, openAlbumPreview
    │   └── download.js             # (459 lignes)  setupDownloadForm, downloadItemFromSearch, isYouTubeUrl
    ├── editor/                     # Édition & reconstitution
    │   ├── tag_editor.js           # (1 872 lignes) loadAlbumInEditor, setupEditorActions, autocomplétion
    │   └── reconstitute.js         # (682 lignes)  openReconstituteModal, enqueuePendingMissingAlbum, submit
    ├── library/                    # Discothèque locale & Corbeille
    │   └── library_manager.js      # (1 050 lignes) setupLibrary, loadLibrary, confirmDeleteCollectionItem
    ├── player/                     # Moteur audio & raccourcis
    │   ├── audio_player.js         # (6 561 lignes) AudioPlayer, EQ_PRESETS, AudioFader, vues, dock flottant
    │   └── shortcuts.js            # (303 lignes)  setupPlayerShortcutsAndWheel, suspension GPU
    └── video/                      # Lecteur vidéo clip
        └── video_player.js         # (803 lignes)  VideoAudioManager, setupVideoModal, openVideoModal
```

---

## 🎯 4. Guide d'Intervention Rapide pour IA Locale

Si vous êtes une IA locale avec un contexte restreint, voici **où intervenir directement selon l'instruction de l'utilisateur** :

### 🎵 1. Modifier la Lecture Audio, les Vues du Lecteur ou le Mini-Dock
- **Fichier JS** : `frontend/js/player/audio_player.js`
- **Fichier CSS** : `frontend/css/player.css`
- **Objets Clés** : `window.AudioPlayer` (méthodes `playTrackAtIndex`, `setView`, `togglePlayPause`, `setVolume`, `renderPlayerTab`).

### 🎚️ 2. Modifier l'Égaliseur 10 Bandes ou le Loudness
- **Fichier JS** : `frontend/js/player/audio_player.js` (section `setupAudioContext`, `applyEqualizerGains`, `setLoudness`, `EQ_PRESETS`)
- **Fichier CSS** : `frontend/css/equalizer.css`
- **Méthodes Clés** : `AudioPlayer.openEqualizerModal()`, `AudioPlayer.setEqualizerPreset(key)`.

### 🔍 3. Modifier la Recherche en Ligne ou l'Aperçu d'Album
- **Fichier JS** : `frontend/js/workshop/search.js`
- **Fichier CSS** : `frontend/css/workshop.css`
- **Fonctions Clés** : `setupSearch()`, `performSearch()`, `openAlbumPreview(item)`.

### 📥 4. Modifier le Téléchargement, l'Import Local ou le Tiroir Atelier
- **Fichiers JS** : `frontend/js/workshop/download.js` & `frontend/js/workshop/workbench.js`
- **Fichier CSS** : `frontend/css/workshop.css`
- **Fonctions Clés** : `downloadItemFromSearch()`, `setupDownloadForm()`, `openWorkshopDrawer()`, `closeWorkshopDrawer()`.

### 🏷️ 5. Modifier l'Éditeur de Tags (Kid3, MusicBrainz) ou la Reconstitution
- **Fichiers JS** : `frontend/js/editor/tag_editor.js` & `frontend/js/editor/reconstitute.js`
- **Fichier CSS** : `frontend/css/editor.css`
- **Fonctions Clés** : `loadAlbumInEditor(path)`, `setupEditorActions()`, `openReconstituteModal(albumDir)`.

### 📚 6. Modifier la Discothèque Locale, le Scan ou la Corbeille
- **Fichier JS** : `frontend/js/library/library_manager.js`
- **Fichier CSS** : `frontend/css/player.css` & `frontend/css/layout.css`
- **Fonctions Clés** : `loadLibrary()`, `confirmDeleteCollectionItem()`, `autoConfigureAndScanLibrary()`.

### 📜 7. Modifier les Playlists Utilisateur (Mosaïques, Smart Playlists)
- **Fichier JS** : `frontend/js/playlists/user_playlists.js`
- **Fichier CSS** : `frontend/css/playlists.css`
- **Objet Clé** : `window.UserPlaylists` (`openDetail`, `generateSmartPlaylist`, `renderGrid`).

### 🎬 8. Modifier le Hub Vidéo ou le Lecteur Vidéo Clip
- **Fichiers JS** : `frontend/js/video/video_player.js` & `frontend/js/player/audio_player.js` (méthode `loadAndRenderVideosCatalog`)
- **Fichier CSS** : `frontend/css/video.css`
- **Objets Clés** : `window.VideoAudioManager`, `window.openVideoModal()`, `window.closeVideoModal()`.

### 🌌 9. Modifier le Mode Ambiance Synthwave ou le Canvas
- **Fichiers JS** : `frontend/js/ambient/synthwave_canvas.js` & `frontend/js/ambient/ambient_manager.js`
- **Fichier CSS** : `frontend/css/ambient.css`
- **Objets Clés** : `window.AmbientThemeManager`, `window.AmbientVisualizer`.

### ⚙️ 10. Modifier les Paramètres, la Veille ou le Mode Soirée
- **Fichiers JS** : `frontend/js/extras/settings.js`, `frontend/js/extras/sleep_timer.js`, `frontend/js/extras/party_lock.js`
- **Fichier CSS** : `frontend/css/modals.css`
- **Objets Clés** : `openSettingsModal()`, `window.SleepTimer`, `window.PartyLock`.

---

## 🔒 5. Procédure Obligatoire de Test & Déploiement

Après toute modification sur les fichiers frontend :

1. **Vérifier la syntaxe JS** :
   ```powershell
   node -c frontend/js/<module>/<fichier>.js
   node -c frontend/app.js
   ```

2. **Lancer la suite de tests automatisée en environnement réel Electron** :
   ```powershell
   npx electron scripts/test_core_modules.js
   ```
   *(Tous les 152+ tests doivent être au vert `[PASS]`, avec 0 erreur console).*

3. **Déployer et synchroniser les builds de production (`app.asar` et répertoires décompressés)** :
   ```powershell
   python scripts/deploy_audit_fixes.py
   ```
   *(Ce script met à jour automatiquement `dist/win-unpacked`, l'installation locale de SoundStash et re-packagera `app.asar` avec vérification de concordance SHA256 à 100%).*

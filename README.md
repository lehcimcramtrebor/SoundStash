# 🎵 SoundStash v4.0.0

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011%20x64-0078D6.svg)](https://microsoft.com)
[![Electron](https://img.shields.io/badge/Electron-33.2.1-47848F.svg)](https://www.electronjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688.svg)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB.svg)](https://www.python.org/)
[![Tests](https://img.shields.io/badge/Tests-152%2F152%20passed-brightgreen.svg)]()
[![Audio](https://img.shields.io/badge/Audio-Hi--Res%20%7C%20Lossless%20%7C%2010--Band%20EQ-orange.svg)]()

**SoundStash** par [Helmicretro](https://github.com/Helmicretro) (développé avec l'assistance d'**Antigravity**) est une station musicale desktop complète pour Windows : lecteur audio sanctuaire haute fidélité, hub vidéo 16:9, et atelier d'acquisition, d'édition et d'organisation de métadonnées.

Entièrement autonome, elle fonctionne en local sans cloud tiers et conserve toutes ses données utilisateur de manière pérenne et sécurisée dans `%APPDATA%\SoundStash` (ou en mode portable isolé).

---

## ✨ Nouveautés & Fonctionnalités Clés (v4.0.0)

### 1. 🎧 Lecteur Audio Sanctuaire & Expérience d'Écoute
- **Double colonne ergonomique** sanctuarisée (largeur minimale 1040px) avec file d'attente intuitive (« Lire », « Ensuite », « + File »).
- **Sélecteur de sortie son Windows 11 en direct** : basculez instantanément votre flux audio vers votre casque, vos haut-parleurs ou votre écran HDMI/DisplayPort depuis la barre de lecture et le dock du Mode Ambiance sans aucune micro-coupure.
- **Navigation ergonomique fluide & Souris X1 / Backspace** : pile de navigation intelligente avec boutons retour contextuels précis (`← Revenir aux albums (Artiste / Genre)`), support natif du bouton précédent de la souris (Bouton 4 / X1) et fermeture progressive des tiroirs et modales.
- **Égaliseur 10 bandes** haute précision avec 10 presets DSP (Basses profondes, Voix claire, R&B, Rock, etc.).
- **Correction physiologique (Loudness contour)** : compensation dynamique pour préserver l'équilibre basses/aigus à faible volume.
- **Fondu audio (Audio Fader / Crossfade)** paramétrable pour des transitions musicales sans rupture.
- **Mode Ambiance immersif** plein écran avec visualiseur procédural réactif (4 univers rétro-futuristes).
- **Mode Soirée (Party Lock)** verrouillable par code PIN à 4 chiffres pour sanctuariser la lecture lors d'événements tout en laissant la navigation et la file d'attente libres.
- **Minidock persistant** : lecture continue et contrôles accessibles partout lors de la navigation dans l'atelier ou la bibliothèque.
- **Diffusion Réseau** : Intégration Chromium Media Router pour diffuser directement vers les Smart TVs (LG WebOS, Chromecast, DLNA).
- **Badges de format et débit audio** : affichage discret et élégant du format et du débit réel (FLAC, AAC 256k, MP3 320k) aligné avant la durée des pistes.

### 2. 🌐 Catalogue Global « Tout » & Fluidité Extrême
- **Vue continue « Tout » sans pop-in** : exploration fluide de l'ensemble de votre collection sans découpage saccadé.
- **Virtualisation CSS native** (`content-visibility: auto`) : calcul et peinture limités aux éléments visibles dans le viewport, garantissant 60 FPS constants même sur des bibliothèques de 5 000+ pistes.
- **Préchargement silencieux en arrière-plan (Prefetch)** : catalogue indexé et pré-rendu en tâche de fond dès l'ouverture de l'application, rendant l'onglet disponible instantanément au clic.
- **Recherche globale ultra-rapide (< 1ms)** : indexation normalisée en temps réel pour filtrer immédiatement titres, albums ou artistes, avec surlignage des termes trouvés.
- **Tri multi-modes dynamique** : tri instantané par artiste, titre, genre, année, nombre de pistes ou durée.

### 3. 🎬 Hub Vidéo Musical & Concerts 16:9
- **Double univers vidéo dédié** : séparation automatique et intelligente entre les **Clips musicaux** et les **Concerts intégraux**.
- **Lecteur vidéo haute performance** : sélecteur de résolutions (jusqu'à la 4K / 2160p à 60 FPS) et contrôle de la vitesse de lecture (0.5x à 2.0x).
- **Picture-in-Picture & Mode Cinéma** : mini-lecteur flottant persistant et mode plein écran avec masquage automatique des contrôles en période d'inactivité.
- **Mixage synchronisé** : pont audio transparent entre le flux vidéo et l'infrastructure audio du lecteur.

### 4. 🏷️ Atelier d'Organisation "Tag-First" & Reconstitution
- **Reconstitution intelligente d'albums (v4.0.0)** : modale 960px dédiée comparant les fichiers disque avec la discographie officielle, extraction automatique du cœur de titre pour les bandes originales (OST / Soundtracks) et recherche/téléchargement de pistes manquantes en 1 clic avec conservation des tags d'origine.
- **Surveillance continue en direct (Windows Explorer Sync)** : surveillance continue par `LibraryWatcher` de votre bibliothèque et du dossier `temp_downloads`. Tout ajout, déplacement ou suppression effectué depuis l'Explorateur Windows est reflété instantanément sans recharger l'application (F5).
- **Atelier et zone de transit dédiée** : téléchargez ou importez vos médias dans un dossier temporaire dédié (`temp_downloads`), vérifiez leur structure, écoutez-les et éditez leurs métadonnées avant l'exportation finale vers votre bibliothèque musicale (`Library`).
- **Gestion des cookies YouTube (`cookies.txt`)** : importateur sécurisé 100% local avec guide pas-à-pas intégré dans les paramètres pour contourner sans effort les restrictions réseau.
- **Nettoyage automatique des bruits et tags superflus** : suppression des mentions parasites (`(Official Audio)`, `[Clip Officiel]`, `4K Remaster`, etc.).
- **Normalisation Kid3-CLI** : standardisation des métadonnées ID3v2, Vorbis et MP4 pilotée par moteur natif.
- **Pochettes HD & Métadonnées certifiées** : intégration automatique de jaquettes haute définition et tags officiels.
- **Support des albums multi-disques** : gestion transparente des disques multiples (`Disc 1`, `Disc 2`, etc.).

### 5. 🗂️ Bibliothèque Modulaire, Playlists & Smart Playlists
- **Vues spécialisées** : **Albums**, **Tout**, **Artistes** (grille réactive commutable 3 ou 4 colonnes), **Genres**, **Clips**, **Concerts** et **Listes** (Playlists).
- **Smart Playlists Illimitées & Multi-genres stricts (v4.0.0)** : génération dynamique de listes thématiques (par genre ou décennie) avec sélection jusqu'à l'intégralité des pistes disponibles et suggestion exclusive des tags de genre réels.
- **Tuiles d'albums enrichies** : affichage du tag de genre directement sous le nom de l'album avec filtrage direct au clic, badges de type (Album, Single, EP, Rip Audio).
- **Playlists Mixtes auto-guérissantes** : listage exclusif de titres physiquement présents sur le disque, élimination automatique des fichiers supprimés et reconstitution dynamique en temps réel via WebSocket.

---

## ⌨️ Raccourcis Clavier & Ergonomie

| Raccourci | Action |
|---|---|
| `Espace` | Lecture / Pause |
| `Flèche Gauche` / `Flèche Droite` | Recul / Avance rapide (5 secondes) |
| `Flèche Haut` / `Flèche Bas` | Volume (+ / - 5%) |
| `Molette de la souris` | Réglage précis du volume sur la barre de lecture ou le mini-lecteur |
| `M` | Couper / Rétablir le son (Mute) |
| `V` | Alterner l'affichage de la vidéo (Mode standard et Mode ambiance) |
| `L` | Basculer le mode de répétition (Désactivé / Répéter tout / Répéter la piste) |
| `Ctrl + F` | Activer instantanément la barre de recherche |
| `Échap` | Fermer le volet ouvert / Quitter le mode plein écran |

---

## 🏗️ Architecture du Projet

```
SoundStash/
├── backend/                  # Serveur local FastAPI (API REST, gestionnaires audio/vidéo)
│   ├── app.py                # Point d'entrée de l'API & orchestration
│   ├── catalog_manager.py    # Indexation et synchronisation du catalogue musical
│   ├── video_manager.py      # Gestionnaire du hub vidéo (clips & concerts)
│   ├── tagger.py             # Moteur de taggage et normalisation Kid3-CLI
│   └── ytm_service.py        # Connecteur d'indexation musicale (recherche de discographie, métadonnées)
├── frontend/                 # Interface Web moderne modulaire (Vanilla JS & CSS découplé)
│   ├── css/                  # 11 modules CSS spécialisés (player, layout, tagger, eq...)
│   └── js/                   # 20 modules JS (audio_player, tagger, ambient, video, playlists...)
├── scripts/                  # Outils d'automatisation, tests unitaires et bootstrap
│   ├── bootstrap_dependencies.py # Script de récupération 1-clic des binaires requis
│   └── test_core_modules.js      # Suite d'assurance qualité (152 tests unitaires)
├── build/                    # Icônes et métadonnées d'empaquetage Windows
├── bin/                      # (Local) Exécutables d'exécution : yt-dlp, ffmpeg, ffprobe, kid3
├── python_runtime/           # (Local) Environnement Python 3.11 embarqué
├── main.js                   # Processus principal Electron & IPC
├── preload.js                # Pont de communication sécurisé Electron
├── SoundStash.bat            # Lanceur Windows 1-clic direct
├── Build_Environment.bat     # Assistant de configuration, vérification & compilation 1-clic
├── requirements.txt          # Dépendances Python
├── package.json              # Dépendances Node & scripts npm
└── THIRD_PARTY_LICENSES.md   # Mentions légales & rétribution des projets tiers
```

---

## 🚀 Installation & Développement

### Prérequis
- Windows 10 ou 11 (64-bit)
- [Node.js](https://nodejs.org/) (v18+)
- [Python](https://www.python.org/) (v3.11+)

### 1. Cloner le dépôt
```bash
git clone https://github.com/Helmicretro/SoundStash.git
cd SoundStash
```

### 2. Configuration & Bootstrap Automatisé (Recommandé)
Double-cliquez simplement sur **`Build_Environment.bat`** à la racine du projet. Ce script tout-en-un s'occupe de :
- Vérifier la présence de Node.js et Python 3.11 sur votre système.
- Installer les modules npm et les paquets Python (`requirements.txt`).
- Télécharger et configurer l'ensemble des outils autonomes dans `bin/` (`yt-dlp`, `ffmpeg`, `kid3`, `rcedit`) ainsi que le runtime embarqué pour la compilation.
- Vous offrir un menu 1-clic pour tester, lancer en dev ou compiler vos versions portables et installateurs.

---

### Alternative manuelle en ligne de commande :

```bash
# Installation des dépendances
npm install
pip install -r requirements.txt

# Téléchargement des outils externes autonomes
python scripts/bootstrap_dependencies.py

# Lancement en mode développement
npm start
```
*Ou double-cliquez directement sur `SoundStash.bat`.*

---

## 📦 Compilation & Empaquetage

Pour générer les exécutables Windows finaux autonomes :

```bash
# Générer l'installateur NSIS classique (.exe) et la version Portable
npm run dist

# Générer uniquement la version Portable autonome
npm run dist:portable

# Générer uniquement l'installateur NSIS
npm run dist:installer
```
Les exécutables générés se trouvent dans le dossier `dist/`.

---

## 🧪 Tests & Assurance Qualité

SoundStash intègre une suite de validation modulaire complète pour certifier l'intégrité fonctionnelle :

```bash
npx electron scripts/test_core_modules.js
```
*Valide l'intégrité des 152 tests unitaires couvrant le lecteur audio, le catalogue, le tagger, l'égaliseur et les playlists.*

---

## ⚖️ Licence, Crédits & Rétributions Open-Source

- **SoundStash** est sous licence [MIT](LICENSE) - Copyright (c) 2026 Helmicretro.
- **Conception & Développement** : Conçu et développé par [Helmicretro](https://github.com/Helmicretro) en pair programming avec l'assistance de l'IA **Antigravity** (Google DeepMind).
- **Projets Tiers** : Ce logiciel s'appuie sur d'excellents projets open-source dont **yt-dlp**, **FFmpeg**, **Kid3**, **Electron**, **FastAPI**, et bien d'autres.
- Pour consulter la liste exhaustive des licences, auteurs et clauses de conformité LGPL/GPL, veuillez vous référer à [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/a57c41e7-8665-4e14-82d8-fce750a46408" />

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/a6a99456-d27c-4bdf-852b-463362012970" />

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/57a4ba1c-088c-44bc-848a-1ab0a292db92" />

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/cdcb2d3f-3c51-4703-bbde-c7cde2f46305" />

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/c188eb99-044c-4926-a129-4518d0268c58" />

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/f3b5e76c-4b2e-483f-a1e9-20f86311362d" />

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/5013e98c-eb54-41e6-8c31-6e90adf6d8f8" />

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/bbd76cfd-e9f4-4297-be00-cc85ad2125d3" />

<img width="1919" height="1079" alt="image" src="https://github.com/user-attachments/assets/4cb2727b-e607-4563-a1e6-ac7a722ed802" />

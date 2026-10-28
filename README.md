# 🎵 SoundStash v6.0.0

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011%20x64-0078D6.svg)](https://microsoft.com)
[![Electron](https://img.shields.io/badge/Electron-33.2.1-47848F.svg)](https://www.electronjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688.svg)](https://fastapi.tiangolo.com/)
[![Python](https://python.org/)](https://python.org/)
[![Tests](https://img.shields.io/badge/Tests-152%2F152%20passed-brightgreen.svg)]()
[![Audio](https://img.shields.io/badge/Audio-Hi--Res%20%7C%20Lossless%20%7C%2010--Band%20EQ-orange.svg)]()

**SoundStash** par [Helmicretro](https://github.com/Helmicretro) (développé avec l'assistance d'**Antigravity**) est une station musicale desktop complète pour Windows : lecteur audio sanctuaire haute fidélité, hub vidéo 16:9, et atelier d'acquisition, d'édition et d'organisation de métadonnées.

Entièrement autonome, elle fonctionne en local sans cloud tiers et conserve toutes ses données utilisateur de manière pérenne et sécurisée dans `%APPDATA%\SoundStash` (ou en mode portable isolé).

---

## 🚀 Nouveautés v6.0.0

### 🌍 Internationalisation Intégrale (Français & English) — Détection Automatique & Bascule à Chaud
- **Détection transparente selon l'environnement utilisateur (`Auto`)** : Dès le premier lancement, SoundStash détecte automatiquement la langue de votre système d'exploitation / environnement (`navigator.language` & `app.getLocale()`) et affiche l'intégralité de l'application en **Français** ou en **Anglais** sans aucune configuration préalable.
- **Sélecteur de langue avec bascule instantanée à chaud (sans rechargement)** : Choisissez à tout moment entre **`🌐 Automatique (selon le système)`**, **`🇫🇷 Français`** et **`🇬🇧 English`** depuis **Paramètres > Système** ou directement depuis l'assistant de premier démarrage (**Welcome Wizard**). L'interface complète bascule instantanément et réversiblement en temps réel (`Hot-Switch`), sans interrompre la lecture audio ou vidéo en cours.
- **Couverture 100 % de l'application (`frontend/js/core/i18n.js`)** : Traduction intégrale de tous les espaces — **Sanctuaire Musical & Hub Vidéo 16:9**, **Mode Ambiant Plein Écran**, **Égaliseur 10 bandes & Presets DSP**, **Atelier de Recherche, File d'Attente & Éditeur de Tags**, **Outils de Bibliothèque** (Doublons, Reconstitution d'Albums, Nettoyage des Tags, Galerie des Jaquettes), **Paramètres**, **Modales, Infobulles & Notifications Toast**.
- **Guide Utilisateur (`❓ Aide`) intégralement bilingue** : Les 10 chapitres complets du manuel interactif intégré (Présentation, Démarrage, Recherche, Téléchargement, Éditeur & Tags, Bibliothèque, Lecteur & Égaliseur, Mode Ambiant, Paramètres & Cookies, Raccourcis Clavier) sont disponibles intégralement en français et en anglais.
- **Intégration native Windows / Electron (`main.js`)** : Localisation dynamique du menu de la zone de notification (**System Tray**), des boutons de contrôle média de la barre des tâches Windows (**Taskbar Thumbar Buttons**), de l'écran de démarrage (**Splash Screen**) et des boîtes de dialogue natives du système.

---

## 🚀 Nouveautés v5.1.0

### 🔍 Refonte du Moteur & de l'Interface de Recherche de l'Atelier (Albums, EPs, Singles, Vidéos)
- **Enrichissement automatique par la discographie officielle de l'artiste** : Lors d'une recherche d'artiste en filtre `Albums`, `EPs` ou `Singles`, SoundStash sonde en parallèle la page officielle de l'artiste sur YouTube Music et fusionne sa discographie studio officielle complète (Albums Studio, EPs, Singles) tout en pénalisant les albums hommages, karaoké et reprises non sollicités.
- **Extraction de la carte « Résultat Principal » (`musicCardShelfRenderer`)** : Détection et intégration native du résultat vedette (album ou artiste exact) et surclassement systématique des miniatures en haute définition (`544×544`).
- **Classification déterministe Album vs EP vs Single** : Réconciliation croisée entre le tag officiel d'en-tête YouTube Music (`Album`, `EP`, `Single`) et le nombre de pistes (1-3 pistes = `Single`, 4-6 pistes = `EP`, ≥ 7 pistes = `Album`), alignant le badge de chaque carte, son bouton d'action et son filtre.
- **Nouveaux filtres et sous-pilules dynamiques** : Ajout des filtres dédiés `📀 EPs officiels` et `💿 Singles officiels`, barre de 5 sous-pilules (`Tous`, `💿 Albums Studio`, `📀 EPs`, `💿 Singles`, `⚡ Singles & EPs`) synchronisées instantanément sans requête réseau superflue, et pilules de filtrage rapide par catégorie en mode `Tous les types` avec compteurs en temps réel.
- **Protection des pistes audio Live & Durcissement « Artiste strict »** : Les morceaux audio officiels (`ATV`) contenant *Live* restent classés comme pistes audio, et le mode `🎯 Artiste strict` écarte désormais automatiquement les artistes hommages (*Tribute to...*, *Hommage à...*) tout en résolvant l'artiste lors d'une recherche combinée *« Artiste + Album »*.

### 📥 Fiabilisation des Téléchargements, des Tags & de l'Éditeur de l'Atelier
- **Résolution InnerTube proactive des albums officiels (`MPREb_` / `OLAK`) & Persistance `.album_meta.json`** : Avant chaque téléchargement d'album, d'EP ou de single officiel, SoundStash résout et sauvegarde la tracklist de référence dans `.album_meta.json` (nombre total de pistes, titres, artistes, durées et année officielle) et verrouille un dossier de destination unique et déterministe dans `temp_downloads`, éliminant toute scission d'un même album en plusieurs dossiers lorsque certaines pistes ont un tag d'album hétérogène sur YouTube.
- **Préservation des featurings natifs YouTube Music & Extraction `Artiste - Titre`** : Correction de l'ordre des règles `--parse-metadata` de `yt-dlp` (`%(artist,creator,channel,uploader)s:%(artist)s` avant `%(title)s:%(artist)s - %(title)s`) afin de ne jamais écraser les artistes et featurings natifs de piste par le nom de la chaîne YouTube (`- Topic`), et indexation exacte des crédits par numéro de piste réel dans `uniformize_album`.
- **Transmission complète des métadonnées depuis la Recherche & File d'attente enrichie** : `downloadItemFromSearch` transmet désormais systématiquement l'album, l'artiste, l'année et la qualité vidéo (`video_quality`) pour tous les types de médias ; la file d'attente affiche `Artiste — Titre` ainsi que la résolution vidéo (`MP4 · 1080p`), et réinitialise proprement la barre de progression à `0%` entre deux tâches consécutives.
- **Persistance intégrale des brouillons & Isolation de la Galerie des Jaquettes** : Mémorisation du type manuel d'album (`manual_type`) et des numéros de pistes MusicBrainz dans les brouillons de l'Éditeur et lors du `Tout exporter`, prise en charge des types `video` et `clip` sur `/api/album/set-type`, et isolation complète de la Galerie des Jaquettes (`🖼️ Jaquettes`) pour ne jamais altérer l'album en cours d'édition dans l'onglet individuel.

---

## 🚀 Nouveautés v5.0.4

### ⏯️ Mémorisation & Reprise Transparente de Session Musicale (Smart Resume)
- **Sauvegarde automatique et continue de votre écoute** : Lorsque vous fermez SoundStash ou installez une mise à jour, l'application mémorise intégralement l'état de votre écoute (morceau actif, position exacte à la seconde près, album, playlist ou catalogue complet « Tout », mode Aléatoire, mode Répétition et file d'attente prioritaire).
- **Reprise instantanée en 1 touche (`Espace` ou `▶`)** : Dès la réouverture de l'application, votre titre vous attend dans le centre de commandes inférieur exactement là où vous l'aviez laissé. Une simple pression sur la **barre d'espace** (ou un clic sur **Play**) relance immédiatement la musique avec fondu doux sans perdre le fil de votre session.
- **Notification intelligente de première réouverture** : Lors de la première réouverture suivant une sauvegarde de lecture, une notification discrète vous informe que votre morceau est prêt à reprendre à son horodatage exact.

---

## 🚀 Nouveautés v5.0.3

### 🎧 Écoute Sanctuarisée & Alerte Cookies Contextualisée (Atelier uniquement)
- **Zéro interruption au lancement en mode écoute** : La vérification de session YouTube (`cookies.txt`) s'effectue désormais de manière totalement silencieuse au démarrage de l'application. Vous pouvez lancer SoundStash uniquement pour écouter votre musique sans jamais être interrompu par une fenêtre d'alerte sur le Lecteur Audio.
- **Déclenchement contextuel à l'ouverture de l'Atelier** : La modale d'alerte *« Session YouTube Expirée »* (avec accès direct en 1 clic aux Paramètres) ne s'affiche désormais **qu'au moment où vous ouvrez l'Atelier** (`openWorkshopDrawer`) pour effectuer des recherches ou des téléchargements.
- **Badges de statut toujours synchronisés** : Les indicateurs visuels de session dans l'Atelier et les Paramètres restent pré-vérifiés et à jour en temps réel dès l'arrière-plan.

### 🛠️ Consolidations & Correctifs Techniques
- **Repli automatique sur expiration de cookies fiabilisé** : Correction du flux de relance en mode anonyme dans `downloader.py` lors de l'expiration d'une session en cours de téléchargement.
- **Extraction parallèle des pochettes & Restauration RGB** : Parallélisation asynchrone (`asyncio.as_completed`) de l'extraction des couvertures embarquées et conversion automatique des profils avec transparence (`RGBA`, `LA`, `P` ➔ `RGB`) lors de la réparation JPEG haute qualité.
- **Destinations rapides d'exportation & Détection de concerts** : Résolution complète des sous-dossiers par défaut (`Bureau`, `Musique`, `Téléchargements`) dans l'Atelier d'exportation et discrimination stricte des concerts via le marqueur explicite `is_concert`.

---

## 🚀 Nouveautés v5.0.2

### 💎 Reconstitution d'Album Haute Fidélité (Flux 256K AAC / itag 141)
- **Alignement avec la session active** : Le module de reconstitution d'album transmet désormais automatiquement les cookies de session YouTube Music lors du téléchargement des pistes substituées.
- **Priorité au flux studio natif** : Sélection prioritaire du conteneur AAC 256 kbps (`itag 141`), alignant le débit des substituts (~259k - 260k) sur le reste de l'album officiel.

### 🛡️ Navigation Sanctuaire & Fluidité de Défilement
- **Maintien intégral du scroll en téléchargement** : Débouncing intelligent (500 ms) des notifications WebSocket `library_updated` et préservation chirurgicale de la position de défilement pendant l'arrivée de nouvelles pistes (plus aucun retour forcé en haut de page).
- **Isolation déterministe des vues de détail** : Le niveau de défilement de la grille des albums et playlists est sanctuarisé lors des consultations de détails d'albums avec retour au pixel près.
- **Élimination définitive du scintillement de sélection** : Règle de visibilité sécurisée empêchant toute micro-oscillation ou conflit de scroll lors du clic sur une piste d'album.

---

## 🚀 Nouveautés v5.0.1

### 🔊 Nouveau Visualiseur Audio « Cyber Subwoofer » 3D (Mode Ambiance)
- **Modèle physique réactif & noble** : Subwoofer 3D incliné avec perspective ~ -18°, châssis métallique gunmetal/chrome, 8 boulons hexagonaux, suspension en caoutchouc toroïdale et membrane conique concave avec 6 anneaux concentriques nets.
- **Dôme central ultra-brillant** : Dust cap avec reflet spéculaire courbé élégant et débattement mécanique fluide calé sur les basses et percussions.
- **Réactivité acoustique calibrée** : Piston mécanique fluide (~20-25 px sur les drops) animé par la combinaison des attaques percussives (`kick` et transitoires) et de la pression des sous-basses (`20 Hz - 350 Hz`).
- **Ondes de choc & Lasers d'horizon** : Génération d'ondes de choc néon concentriques sur les frappes rythmiques franches, triple faisceau laser traversant l'horizon avec oscilloscope temps réel connecté à `waveform`.
- **Tours LED spectrales & Étoiles diamant** : 32 colonnes spectrales (16 gauche + 16 droite) avec *peak hold*, étoiles de diamant spéculaires à 4 branches sur la couronne et nuée stellaire 3D de 90 particules.
- **Stabilisation & Protection Anti-Flood** : Optimisation des écouteurs de recherche et dédoublonnage strict des toasts de notification.

---

## 🚀 Nouveautés v5.0.0

### 📦 Atelier d'Exportation Multimédia Hautes Performances (Multi-threading)
- **Exportation universelle audio & vidéo** : Exportez tout ou partie de votre collection vers n'importe quel dossier ou support externe (clé USB, smartphone, baladeur audiophile).
- **Parallélisation multi-cœurs (jusqu'à 12 threads simultanés)** : L'export tire parti de l'intégralité du processeur (`ThreadPoolExecutor` à concurrence dynamique), garantissant des transferts et transcodages ultra-rapides sans goulot d'étranglement.
- **Transcodage audio & préservation de qualité** :
  - **Mode copie brute** : conservation intégrale des conteneurs (`.m4a`, `.flac`, `.opus`, `.mp3`) et métadonnées d'origine.
  - **Mode conversion FFmpeg haute fidélité** : conversion vers MP3 (128 / 192 / 256 / 320 kbps), AAC, OGG Vorbis, FLAC (lossless) et OPUS avec tags injectés.
- **Hiérarchies de dossiers personnalisables** :
  - `Artiste / Album / Titre` (organisation hiérarchique classique).
  - `Artiste - Album / Titre` (regroupement par dossier d'album).
  - À plat `Artiste - Album - Titre` (idéal pour autoradios et lecteurs sans navigation arborescente).
- **Séparation automatique & Playlists M3U8** :
  - Répartition nette en sous-dossiers dédiés `Audio/` et `Vidéo/`.
  - Génération automatique d'une playlist universelle `Playlist_Export.m3u8` encodée en UTF-8 avec directives `#EXTINF`.
- **Sélecteur interactif d'albums et pistes avec panier persistant** :
  - Recherche instantanée par nom d'artiste, album ou piste.
  - Dépliage accordéon des albums pour cocher ou décocher des pistes individuelles à la volée.
  - Sélecteur de vidéos intégré.
  - Sauvegarde et restauration automatique du panier de sélection (`export_selected_items.json`) pour ne jamais perdre son travail de sélection.
- **Estimation de stockage en temps réel & Progression WebSocket** :
  - Calcul dynamique de l'espace disque requis et de l'espace disponible sur la destination avec alerte visuelle en cas de saturation.
  - Barre de progression fluide en temps réel avec statistiques (pistes traitées, vitesse, temps restant estimé).

### 🛠️ Refonte Ergonomique de l'Atelier
- **Fusion et lisibilité accrue** : Réorganisation des sous-onglets de l'Atelier pour une productivité maximale.
- **Accès direct « Tags par lot »** : Accès direct au taggage groupé sans intermédiaire redondant.
- **Cohérence stylistique et fluidité** : Interface modernisée avec icônes contextuelles, boutons d'action rapide et retour visuel instantané.

---

## 🚀 Nouveautés v4.2.3

### ⚡ Détection Magique de l'Année Officielle Intégrée au Téléchargement
- **Recherche automatique au téléchargement** : chaque album téléchargé déclenche désormais la recherche de sa véritable date de sortie studio originale via MusicBrainz `release-group` (`first-release-date`) avec repli ultra-rapide sur l'API iTunes.
- **Fin des années d'upload YouTube erronées** : les années parasites (dates de rééditions numériques, remasters tardifs ou uploads YouTube de 2015/2017/2021) sont automatiquement remplacées par la première parution historique.
- **Écriture physique réelle Kid3** : application instantanée et pérenne sur chaque piste physique en session directe par flux (`set date` + `set year` pour les conteneurs QuickTime `.m4a`/AAC et tags ID3 `.mp3`). Synchronisation instantanée du fichier `.album_meta.json` et de l'indexothèque.

### 🏷️ Onglet « Tags par Lot » & Édition Rapide Multi-Champs
- **Évolution de l'onglet** : l'ancien sous-onglet « Genres par lot » devient **« Tags par lot »** et permet d'appliquer simultanément ou séparément l'**Artiste**, le **Genre** et l'**Année** sur une sélection d'albums.
- **Bouton Magique Unitaire `⚡` & Détection Groupée** : bouton éclair sur chaque ligne d'album et bouton d'action par lot `⚡ Années officielles` pour corriger rapidement sa collection sans ressaisir manuellement.
- **Ergonomie & Espacement** : élargissement des colonnes Genres et Année, masquage des steppers natifs de Chromium (spin-buttons) pour éliminer toute troncature du 4e chiffre (ex: `2020` 100% visible).

### 🛡️ Verrouillage Hermétique du Scroll Arrière-Plan dans l'Atelier
- **Arrière-plan sanctuaire immobile** : au survol et à l'ouverture de l'Atelier, le lecteur audio et la discothèque en arrière-plan ne bougent plus d'un millimètre (`overflow: hidden` sur `body` et `html` + `overscroll-behavior: contain`).
- **Capture intelligente de molette** : le contenu interne de l'Atelier (recherches, tableaux, logs) défile avec une fluidité totale, mais dès que les extrémités sont atteintes ou que la souris survole l'en-tête/les zones statiques, la propagation de l'événement `wheel` est immédiatement neutralisée.
- **Mémorisation de position** : la position exacte de scroll de la collection est sauvegardée et restaurée au pixel près à la fermeture de l'Atelier.

---

### 🎯 Dissociation Intelligente des Albums Homonymes par Artiste
- **Élimination des faux positifs « Déjà dans ma collection »** : le moteur de reconnaissance (`SmartMatcher`) vérifie désormais strictement la compatibilité d'artiste avant de comparer les titres d'albums. Deux albums portant le même nom mais composés par des artistes distincts (ex. *Metropolis* de *Marvel83'* vs *Metropolis* de *Timecop1983*) ne sont plus jamais confondus.
- **Score déterministe** : lorsque les artistes sont identifiés et sans lien de parenté, le score de similarité est immédiatement verrouillé à `0.0`. L'album recherché s'affiche comme neuf et téléchargeable directement en un clic.
- **Préservation des variantes légitimes** : prise en charge native des collaborations (*Marvel83' & Timecop1983*), des variantes typographiques (*AC/DC* / *AC DC*), des chaînes YouTube thématiques (*- Topic*, *- Thème*) et des compilations multi-artistes (*Various Artists*).
- **Sécurisation des dossiers temporaires et des prévisualisations** : la vérification empêche également les fausses alertes de « pistes manquantes » dans la modale d'album et les collisions dans le répertoire temporaire.

### ⚡ Résilience & Déblocage du Moteur de Téléchargement
- **Correction d'un blocage silencieux de file** : résolution d'une collision de portée de variable interne (`UnboundLocalError`) liée à la vérification de session YouTube dans `backend/downloader.py`.
- **Tolérance aux pannes renforcée** : sécurisation intégrale de la boucle de file d'attente avec journalisation complète des traces d'erreurs (`exc_info=True`) et notification temps réel via WebSocket pour éviter tout gel du worker d'arrière-plan.

---

## 🚀 Nouveautés v4.2.1

### ⚡ Visibilité & Clarté de la File de Téléchargement (Batch)
- **Affichage permanent du téléchargement en cours** : le panneau de la file d'attente ne disparaît plus quand il n'y a qu'un seul téléchargement. Il met désormais en valeur la tâche active avec un badge `⚡ En cours` et son titre, éliminant tout doute sur le lancement de l'opération.
- **Libellés de notification intelligents** : le message de confirmation distingue désormais clairement un téléchargement qui démarre immédiatement (*« « Album » en cours de téléchargement ! »*) d'un album mis en attente après un autre (*« « Album » ajouté à la file d'attente ! »*).
- **Annulation directe depuis la file** : bouton d'annulation rapide directement présent sur l'élément en cours dans la file d'attente.

### 🛡️ Réconciliation Dynamique des Boutons de Téléchargement
- **Élimination définitive du blocage « En file d'attente »** : les boutons du Lecteur Audio, de la modale d'album et des cartes de recherche vérifient désormais en temps réel l'état effectif de la file WebSocket. Si un téléchargement s'achève ou est annulé, le bouton est automatiquement dégrisé et redevient immédiatement cliquable.
- **Repli automatique anti-expiration des cookies (Fallback transparent)** : si vos cookies YouTube expirent en plein téléchargement, SoundStash tente automatiquement et sans interruption un repli en accès standard anonyme (pour récupérer les pistes publiques sans planter), tout en avertissant l'utilisateur de renouveler sa session pour la haute fidélité.

---

## 🚀 Nouveautés v4.2.0

### 🎧 Sanctuarisation Intégrale de la Lecture dans l'Onglet « Tout »
- **Clic sur une piste non-destructif** : cliquer sur un titre dans le catalogue ou la recherche dense lance immédiatement l'écoute sans restreindre la file au seul album cliqué. La collection intégrale demeure active en toile de fond.
- **Respect absolu des options utilisateur (Aléatoire & Répétition)** :
  - **Aléatoire préservé** : si le mode Aléatoire (`🔀`) est actif, le titre cliqué est joué puis la lecture continue de brasser aléatoirement l'ensemble de votre discothèque.
  - **Séquentiel continu** : si l'Aléatoire est désactivé, la lecture avance naturellement piste par piste, puis enchaîne automatiquement avec l'album suivant du catalogue sans coupure.
  - **Répétition intacte** : les modes Répéter (`🔁` Tout / `🔂` Titre) ne sont plus jamais écrasés ni réinitialisés par un clic ou par l'activation du shuffle.
- **Métadonnées fidèles** : l'album d'origine réel de chaque morceau s'affiche en grand sur la barre persistante et dans le mode Ambiance (remplaçant le libellé générique « Toute la Collection »).

### 🌌 Restauration Déterministe de la Lecture en Cours (« N ») & Mode Ambiance
- **Retour direct sur l'écran d'écoute** : à la fermeture du Mode Ambiance (bouton fermer ou raccourci clavier), votre vue de lecture en cours (« En cours d'écoute » ou détail d'album) est instantanément réancrée avec recentrage automatique de la piste active.
- **Touche `N` universelle** : utilisable directement depuis le Mode Ambiance pour quitter instantanément le visualiseur plein écran et basculer sur les détails du titre en cours.
- **Navigation arrière protégée** : les boutons souris précédent / retour arrière ne ferment plus les détails d'albums en sourdine pendant le visionnage du visualiseur Synthwave.

### 🏷️ Détection Fine des Genres Musicaux (Apple Music / iTunes)
- **Élimination du tag générique « Music »** : correction automatique des tags hérités des imports YouTube (qui classent tout arbitrairement sous la catégorie unique « Music »).
- **Interrogation automatique de l'API Apple Music / iTunes** : identification précise et intelligente des véritables styles musicaux (*Synthwave, Heavy Metal, French Pop, Progressive Rock, Trip Hop, etc.*) lors de la récupération et de l'uniformisation d'albums.

### 🎛️ Centre de Commandes Standard Flottant Permanent
- **Visibilité permanente de la barre de lecture** : le centre de commandes inférieur (`#persistent-player-bar`) reste désormais présent en continu, même à l'arrêt ou au démarrage de l'application, prêt à lancer la musique en 1 clic.
- **Sanctuarisation du Mode Ambiance** : masquage propre et automatique de la barre standard en Mode Ambiance pour laisser place nette au dock immersif dédié.

### 📐 Finitions Visuelles & Ergonomie du Cadre
- **Zéro distorsion au survol** : suppression du zoom/décalage sur le bouton « En cours d'écoute » qui tronquait ses arrondis et sa bordure supérieure.
- **Marges respirantes sur les playlists** : harmonisation des tuiles de playlists avec 12px de marge interne élégante (identique aux albums).
- **Fin naturelle du cadre de contenu** : suppression des grands rectangles noirs vides sous les listes courtes (Clips, Genres, Artistes).
- **Cadre supérieur compact et stable** : hauteur fixe de 173px sans renvoi à la ligne en mode fenêtré, et largeur minimale portée à 1100px sanctuarisant la disposition spacieuse à 5 colonnes.

---

## ✨ Nouveautés v4.1.2

### 🔀 Logique de Lecture & Aléatoire Perfectionnée dans l'Onglet « Tout »
- **Matrice Aléatoire & Répétition claire et intuitive** :
  - **Aléatoire désactivé (`🔀` OFF)** : lecture séquentielle stricte (piste suivante dans la liste).
  - **Aléatoire activé (`🔀` ON)** : brasse l'ensemble de la discothèque (équivalent direct à « Aléatoire collection »).
  - **Rester dans l'album en cours grâce à la Répétition (`🔁`)** :
    - **`🔁` Activé + `🔀` OFF** : boucle sur l'album en cours en lecture séquentielle ordonnée (repart à la piste 1 à la fin).
    - **`🔁` Activé + `🔀` ON** : lecture aléatoire confinée strictement à l'intérieur de cet album.
    - **`🔂` Répéter 1** : rejoue la même piste en boucle.
- **Enchaînement séquentiel automatique entre albums** :
  - Si la répétition est désactivée (`repeatMode: "none"`), la fin d'un album enchaîne directement avec l'album suivant selon le tri actif du catalogue.
- **Application immédiate de tous les tris du catalogue** :
  - Réactivité instantanée de l'intégralité des modes de tri de l'onglet « Tout » (Artiste, Album, Genre, Année, Nombre de pistes, etc.) avec réordonnancement immédiat du DOM sans blocage.

---

## ✨ Nouveautés v4.1.1

### 🎬 Envoi de Vidéos vers la File d'Attente (Clips & Concerts)
- **Options complètes de file d'attente sur les vidéos** : boutons dédiés « Lire ensuite (priorité) » et « + File (Ajouter à la file d'attente) » intégrés directement sur chaque carte de clip vidéo, concert et résultat de recherche vidéo.
- **Enchaînement et lecture mixte fluide** : les vidéos en file d'attente s'intercalent naturellement avec vos pistes audio, ouvrent automatiquement la vidéo et enchaînent avec la suite de votre écoute sans interruption.

### ✋ Réorganisation des Playlists par Glisser-Déposer (Drag & Drop)
- **Poignée de saisie à barres (`☰`) à droite de chaque piste** : déplacez vos titres à la souris pour réorganiser l'ordre exact de vos playlists personnalisées.
- **Indicateurs visuels dynamiques** : surbrillance immédiate de la position cible (ligne d'insertion supérieure ou inférieure) et mise à jour 0ms de l'affichage avec renumérotation automatique.
- **Sauvegarde et synchronisation instantanée** : le nouvel ordre est immédiatement enregistré et propagé en direct dans le lecteur si la playlist est en cours d'écoute.

### 📑 Actions Playlists dans l'Onglet « Tout » (Catalogue Intégral) & Envoi d'Albums
- **Envoi de morceaux vers une playlist depuis l'onglet « Tout »** : bouton dédié `+ Playlist` sur chaque piste individuelle de tous les blocs d'albums et lignes de recherche denses du catalogue continu.
- **Envoi d'albums entiers vers une playlist en 1 clic** : bouton `+ Playlist` sur la barre latérale de chaque album du catalogue complet pour injecter instantanément l'intégralité de ses pistes.
- **Synchronisation temps réel universelle (Zéro Ctrl+F5)** :
  - **Mise à jour immédiate de la vue détail de playlist** (tableau DOM, compteurs, durées cumulées, badges audio/vidéo).
  - **Mise à jour en continu de la grille des cartes de playlists** et du badge de décompte du sous-onglet.
  - **Synchronisation en direct du lecteur audio et de la file d'attente** : si la playlist modifiée est activement jouée, sa liste interne, le panneau de lecture (`PlayerTab`) et le tiroir latéral (`QueueDrawer`) sont rafraîchis en temps réel sans interrompre le morceau en cours d'écoute.

---

## ✨ Nouveautés v4.1.0

### 🔍 Recherche Globale Unifiée & Intelligente
- **Moteur de recherche unifié et transversal** : accessible depuis n'importe quel onglet du lecteur via la barre de recherche supérieure ou les raccourcis `/` et `Ctrl+F`.
- **Résultats multi-catégories instantanés** : agrégation en temps réel de tous vos médias musicaux et audiovisuels :
  - **⭐ Meilleur résultat (Top Match)** : mise en avant dynamique du résultat le plus pertinent sous forme de carte grand format interactive.
  - **🎵 Titres** : recherche stricte par nom de morceau pour éviter la pollution par les artistes ou noms d'albums, avec jaquette compacte (44×44px), métadonnées complètes et bouton d'action directe.
  - **💿 Albums** : grille carrée d'albums correspondants avec lecture d'album en 1 clic.
  - **🎬 Clips & Concerts** : vignettes 16:9 avec badges de durée et de type, lancement direct sans quitter l'interface.
  - **🎤 Artistes** : cartes d'artistes avec compteur d'albums et accès direct à la discographie.
  - **🏷️ Genres & 📑 Playlists** : exploration rapide de vos classifications et sélections personnalisées.
- **Filtres par pilules réactives** : basculez en un clic entre `[Tout]`, `[Titres]`, `[Albums]`, `[Clips & Concerts]`, `[Artistes]`, `[Genres]` et `[Playlists]`.
- **Navigation non-destructive** : mémorisation de l'onglet et de la position de scroll précédents. Sortie instantanée via la touche `Échap`, la croix `✕` ou le bouton contextuel `← Revenir`.

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

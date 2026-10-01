# Third-Party Notices & Licenses (Mentions Légales & Rétributions)

SoundStash intègre et interagit avec plusieurs composants et outils open-source tiers exceptionnels.
Ce document détaille les licences, les auteurs et les conditions d'utilisation applicables à chacun de ces projets.

Nous exprimons toute notre gratitude à leurs créateurs et mainteneurs respectifs.

---

## Sommaire

1. [Outils Externes & Binaires d'Exécution](#1-outils-externes--binaires-dexécution)
   - [yt-dlp](#yt-dlp)
   - [FFmpeg & FFprobe](#ffmpeg--ffprobe)
   - [Kid3 - Audio Tag Editor](#kid3---audio-tag-editor)
   - [rcedit](#rcedit)
2. [Runtime & Framework Desktop](#2-runtime--framework-desktop)
   - [Electron](#electron)
   - [Chromium & Node.js](#chromium--nodejs)
3. [Serveur & Backend Python](#3-serveur--backend-python)
   - [Python Runtime](#python-runtime)
   - [FastAPI](#fastapi)
   - [Starlette](#starlette)
   - [Uvicorn](#uvicorn)
   - [Pydantic](#pydantic)
   - [HTTPX & HTTPCore](#httpx--httpcore)
   - [Mutagen](#mutagen)
   - [Pillow (PIL)](#pillow-pil)
4. [Typographies & Assets Graphiques](#4-typographies--assets-graphiques)
   - [Outfit Font](#outfit-font)
   - [Inter Font](#inter-font)
   - [JetBrains Mono Font](#jetbrains-mono-font)
   - [Lucide Icons](#lucide-icons)
5. [Clause de Conformité GPL / LGPL (Offre de Code Source)](#5-clause-de-conformité-gpl--lgpl)

---

## 1. Outils Externes & Binaires d'Exécution

### yt-dlp
- **Projet** : yt-dlp (Command-line audio/video downloader)
- **Dépôt** : https://github.com/yt-dlp/yt-dlp
- **Licence** : The Unlicense (Domaine Public)
```text
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.
```

---

### FFmpeg & FFprobe
- **Projet** : FFmpeg (Hyper fast audio and video encoder/decoder)
- **Site officiel** : https://ffmpeg.org
- **Licence** : GNU Lesser General Public License (LGPL) v2.1+ / GNU General Public License (GPL) v2+
- **Usage dans SoundStash** : SoundStash exécute les binaires précompilés `ffmpeg.exe` et `ffprobe.exe` en tant que sous-processus indépendants en ligne de commande (CLI invocation), sans modification de leur code source.
- **Code source** : Conformément à la licence LGPL/GPL, le code source complet de FFmpeg est disponible publiquement sur https://ffmpeg.org/download.html.

---

### Kid3 - Audio Tag Editor
- **Auteur** : Urs Fleisch
- **Site officiel** : https://kid3.kde.org
- **Dépôt** : https://invent.kde.org/multimedia/kid3
- **Licence** : GNU General Public License (GPL) v2+
- **Usage dans SoundStash** : SoundStash fait appel à l'outil en ligne de commande `kid3-cli.exe` via des processus enfants pour la standardisation des métadonnées audio (ID3v2, Vorbis Comments, MP4 Atoms) et l'intégration des pochettes.
- **Code source** : Le code source complet de Kid3 est librement téléchargeable sur https://invent.kde.org/multimedia/kid3 ou https://kid3.kde.org/#download.

---

### rcedit
- **Auteur** : GitHub, Inc.
- **Dépôt** : https://github.com/electron/rcedit
- **Licence** : MIT License
```text
Copyright (c) 2013 GitHub, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.
```

---

## 2. Runtime & Framework Desktop

### Electron
- **Organisation** : OpenJS Foundation & Electron contributors
- **Site officiel** : https://www.electronjs.org
- **Licence** : MIT License
```text
Copyright (c) Electron contributors
Copyright (c) 2013-2020 GitHub Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.
```

### Chromium & Node.js
- **Chromium** : BSD 3-Clause License (Copyright 2015 The Chromium Authors).
- **Node.js** : MIT License (Copyright Node.js contributors).

---

## 3. Serveur & Backend Python

### Python Runtime
- **Organisation** : Python Software Foundation
- **Licence** : Python Software Foundation License Version 2 (PSF-2.0)
- **Site officiel** : https://www.python.org

### FastAPI
- **Auteur** : Sebastián Ramírez
- **Dépôt** : https://github.com/tiangolo/fastapi
- **Licence** : MIT License
```text
Copyright (c) 2018 Sebastián Ramírez
```

### Starlette
- **Auteur** : Encode OSS Ltd
- **Dépôt** : https://github.com/encode/starlette
- **Licence** : BSD 3-Clause License
```text
Copyright © 2018, Encode OSS Ltd. All rights reserved.
```

### Uvicorn
- **Auteur** : Encode OSS Ltd
- **Dépôt** : https://github.com/encode/uvicorn
- **Licence** : BSD 3-Clause License
```text
Copyright © 2017-present, Encode OSS Ltd. All rights reserved.
```

### Pydantic & Pydantic-Core
- **Auteur** : Samuel Colvin and contributors
- **Dépôt** : https://github.com/pydantic/pydantic
- **Licence** : MIT License
```text
Copyright (c) 2017 to present, Pydantic Services Inc. and individual contributors.
```

### HTTPX & HTTPCore
- **Auteur** : Encode OSS Ltd
- **Dépôt** : https://github.com/encode/httpx
- **Licence** : BSD 3-Clause License
```text
Copyright © 2019, Encode OSS Ltd. All rights reserved.
```

### Mutagen
- **Auteurs** : Joe Wreschnig, Michael Urman, Lukas Lalinsky, Christoph Burgmer et contributeurs
- **Dépôt** : https://github.com/quodlibet/mutagen
- **Licence** : GNU General Public License (GPL) v2+

### Pillow (PIL)
- **Auteurs** : Secret Labs AB, Fredrik Lundh, Alex Clark et contributeurs
- **Dépôt** : https://github.com/python-pillow/Pillow
- **Licence** : HPND License (Historical Permission Notice and Disclaimer)

---

## 4. Typographies & Assets Graphiques

### Outfit
- **Auteur** : Copyright 2021 The Outfit Project Authors (https://github.com/Outfit-Font/Outfit)
- **Licence** : SIL Open Font License, Version 1.1 (OFL-1.1)

### Inter
- **Auteur** : Copyright (c) 2016-2024 The Inter Project Authors (https://github.com/rsms/inter)
- **Licence** : SIL Open Font License, Version 1.1 (OFL-1.1)

### JetBrains Mono
- **Auteur** : Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)
- **Licence** : SIL Open Font License, Version 1.1 (OFL-1.1)

### Lucide Icons
- **Auteurs** : Lucide Project Authors (https://lucide.dev)
- **Licence** : ISC License / MIT License

---

## 5. Clause de Conformité GPL / LGPL

SoundStash respecte scrupuleusement les termes des licences libres et copyleft (notamment GNU General Public License et GNU Lesser General Public License).

1. **Architecture d'Isolation** : SoundStash n'incorpore aucun code source dérivé de FFmpeg ou de Kid3 au sein de son propre code applicatif. SoundStash communique exclusivement avec ces logiciels via des mécanismes standards de système d'exploitation (appels de processus indépendants en ligne de commande via `subprocess` et passage d'arguments CLI).
2. **Fourniture du Code Source** : Conformément à la section 3 de la licence GNU GPL v2 et à la section 4 de la licence GNU LGPL v2.1, toute personne recevant une copie binaire compilée de SoundStash peut obtenir sur simple demande et sans frais additionnels une copie intégrale du code source correspondant des composants FFmpeg et Kid3, ou les télécharger directement depuis leurs dépôts officiels respectifs cités plus haut.

# Architecture & Spécifications du Mécanisme de Mise à Jour In-App (SoundStash)

Document de référence fixant les protocoles d'exécution et de versioning de SoundStash.

---

## 1. Cycle de Vie et Détachement du Processus Installeur

Lorsqu'une mise à jour est déclenchée par l'utilisateur :
1. **Canal IPC Electron Direct** : `frontend/js/core/app_updater.js` appelle `window.electronAPI.installUpdate(installerPath)`.
2. **Détachement du Noyau Windows** :
   ```javascript
   const child = spawn(installerPath, [], {
       detached: true,
       stdio: 'ignore'
   });
   child.unref();
   ```
   L'installeur est ainsi lancé dans un groupe de processus distinct, sans descendance liée à SoundStash.

3. **Libération Immédiate des Ressources & Fermeture Propre** :
   - `mainWindow.removeAllListeners('close');` et `mainWindow.hide();` : désactive l'interception de réduction dans la zone de notification (Systray).
   - Arrêt de Python : `taskkill /pid ${pythonProcess.pid} /F` (**sans l'argument `/T`** pour ne jamais tuer l'arborescence enfant).
   - `tray.destroy();` : suppression de l'icône dans la barre des tâches.
   - `setTimeout(() => app.exit(0), 400);` : arrêt complet d'Electron.

---

## 2. Résolution Dynamique des Versions & Source de Vérité

Pour garantir qu'une mise à jour appliquée n'est plus proposée au redémarrage :

| Composant | Fichier source | Mécanisme |
| :--- | :--- | :--- |
| **Package Electron** | `package.json` | Version centrale de l'application. |
| **Backend Python** | `backend/version.json` | Lu dynamiquement par `get_current_app_version()` dans `backend/app_updater.py`. |
| **Packaging Automatisé** | `scripts/afterPack.js` | Injecte automatiquement la version dans `resources/backend/version.json`. |
| **Interface Frontend** | `frontend/js/core/app_updater.js` | Résout dynamiquement la version depuis `#app-installed-version`. |
| **Normalisation des Tags** | `parse_semver()` | Élimine les préfixes (`v`, `v.`) pour comparer rigoureusement les tuples `(major, minor, patch)`. |

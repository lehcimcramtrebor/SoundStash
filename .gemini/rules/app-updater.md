# Règle d'Architecture : Mécanisme de Mise à Jour In-App (SoundStash)

Cette règle fige et sanctuarise le fonctionnement du système de mise à jour applicative in-app de SoundStash. Toute modification future de l'updater doit impérativement respecter ces spécifications.

---

## 1. Lancement de l'Installeur & Détachement de Processus
- **Canal Natif Electron Prioritaire** :
  L'application de la mise à jour s'effectue via le handler IPC `install-update` dans `main.js`, appelé depuis `frontend/js/core/app_updater.js`.
- **Détachement Absolu du Noyau Win32** :
  L'installeur exécutable doit être lancé via :
  ```javascript
  const child = spawn(installerPath, [], {
      detached: true,
      stdio: 'ignore'
  });
  child.unref();
  ```
  Le processus de l'installeur ne doit avoir aucun lien de parenté direct ou descendance active qui pourrait être tué lors de la fermeture de SoundStash.

---

## 2. Fermeture Propre & Déverrouillage Système
Avant que l'installeur NSIS ne prenne la main, l'application doit libérer instantanément tous ses verrous :
1. **Désactivation de l'interception Systray** :
   `mainWindow.removeAllListeners('close');` et `mainWindow.hide();`
   (Empêche l'application de se réduire dans la zone de notification lors du signal de fermeture envoyé par l'installeur NSIS).
2. **Extinction Ciblée du Serveur Python (SANS `/T`)** :
   `taskkill /pid ${pythonProcess.pid} /F`
   **PROHIBITION FORMELLE** : Ne JAMAIS utiliser le drapeau `/T` (*Tree Kill*), qui ordonne à Windows d'abattre tous les processus enfants et anéantit l'installeur.
3. **Destruction du Systray** :
   `tray.destroy();`
4. **Sortie immédiate d'Electron** :
   `app.exit(0);` après un court délai (~400ms) pour garantir l'exécution de l'installeur.

---

## 3. Source Unique de Vérité pour la Version Applicative
Pour éviter qu'une mise à jour ne continue d'être proposée après son installation :
1. **`package.json`** définit la version de référence (`version`).
2. **`backend/version.json`** conserve l'état de version déployé pour le backend Python en environnement packagé.
3. **`scripts/afterPack.js`** synchronise automatiquement `context.packager.appInfo.version` dans `resources/backend/version.json`.
4. **`backend/app_updater.py`** résout dynamiquement la version via `get_current_app_version()` en lisant `version.json` puis `package.json` (aucun numéro codé en dur).
5. **`frontend/js/core/app_updater.js`** résout dynamiquement sa version au chargement depuis l'élément `#app-installed-version`.
6. **Nettoyage Robuste des Tags GitHub** :
   La fonction `parse_semver` et la lecture de tag nettoient tous les formats courants (`v3.2.5`, `v.3.2.5`, `3.2.5`) via `re.sub(r'^[vV\.\s]+', '', tag)` afin d'éviter tout faux positif `v.3.2.5 > v3.2.5`.

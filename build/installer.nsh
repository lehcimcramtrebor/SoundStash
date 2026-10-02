; ==============================================================================
; SoundStash - Script d'extension d'installation NSIS (electron-builder)
; v3.2.2 - Protection anti-corruption pendant les téléchargements actifs
; ==============================================================================

!macro customInit
  ; Vérifier si SoundStash est en train de télécharger du contenu
  IfFileExists "$TEMP\soundstash_download.lock" download_in_progress 0
  IfFileExists "$LOCALAPPDATA\SoundStash\download.lock" download_in_progress 0
  Goto install_allowed

  download_in_progress:
    MessageBox MB_YESNO|MB_ICONEXCLAMATION \
      "SoundStash est actuellement en cours de téléchargement de musique ou conversion audio.$\r$\n$\r$\nPour garantir l'intégrité absolue de vos fichiers, la mise à jour ne peut pas s'effectuer pendant un téléchargement actif.$\r$\n$\r$\nSouhaitez-vous patienter que le téléchargement se termine ?$\r$\n(L'installeur vérifiera automatiquement l'état toutes les 5 secondes)$\r$\n$\r$\n- Cliquez sur 'Oui' pour patienter.$\r$\n- Cliquez sur 'Non' pour annuler l'installation." \
      IDYES start_wait_loop IDNO cancel_install

  start_wait_loop:
    ; Boucle de vérification automatique toutes les 5 secondes
    Sleep 5000
    IfFileExists "$TEMP\soundstash_download.lock" start_wait_loop 0
    IfFileExists "$LOCALAPPDATA\SoundStash\download.lock" start_wait_loop 0

    ; Le téléchargement vient de se terminer avec succès
    MessageBox MB_OK|MB_ICONINFORMATION \
      "Le téléchargement SoundStash est maintenant terminé !$\r$\n$\r$\nL'installation de la mise à jour va maintenant se poursuivre."
    Goto install_allowed

  cancel_install:
    Abort

  install_allowed:
!macroend

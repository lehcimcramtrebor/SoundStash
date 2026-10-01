import os
import ctypes
from pathlib import Path
import subprocess

def refresh_windows_icons():
    print("=== Rafraîchissement des raccourcis et du cache d'icônes Windows ===")
    
    ps_update_shortcuts = r"""
    $sh = New-Object -ComObject WScript.Shell
    $p1 = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\SoundStash.lnk"
    $p2 = "$env:USERPROFILE\Desktop\SoundStash.lnk"
    $exe = "$env:LOCALAPPDATA\Programs\SoundStash\SoundStash.exe"
    $ico = "$env:LOCALAPPDATA\Programs\SoundStash\resources\build\icon.ico"
    
    foreach ($p in @($p1, $p2)) {
        if (Test-Path $p) {
            $lnk = $sh.CreateShortcut($p)
            $lnk.TargetPath = $exe
            $lnk.WorkingDirectory = [System.IO.Path]::GetDirectoryName($exe)
            $lnk.IconLocation = "$exe,0"
            $lnk.Description = "SoundStash - Station musicale desktop et tagueur d'albums haute-fidélité 100% autonome"
            $lnk.Save()
            (Get-Item $p).LastWriteTime = Get-Date
            Write-Output "Raccourci mis à jour avec succès : $p"
        }
    }
    """
    res = subprocess.run(["powershell", "-NoProfile", "-Command", ps_update_shortcuts], capture_output=True, text=True)
    print(res.stdout)
    if res.stderr:
        print("Erreur:", res.stderr)

    # Notification globale au Shell Windows pour recharger les icônes
    print("Notification du Shell Windows (SHCNE_ASSOCCHANGED)...")
    try:
        # SHCNE_ASSOCCHANGED = 0x08000000, SHCNF_IDLIST = 0
        ctypes.windll.shell32.SHChangeNotify(0x08000000, 0, None, None)
        print("SHChangeNotify exécuté avec succès.")
    except Exception as e:
        print("Erreur SHChangeNotify:", e)

    # Exécution de ie4uinit pour rafraîchir le cache icône
    try:
        subprocess.run(["ie4uinit.exe", "-show"], timeout=3)
    except Exception:
        pass

if __name__ == "__main__":
    refresh_windows_icons()

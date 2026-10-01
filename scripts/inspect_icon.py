import os
import subprocess
from pathlib import Path

ps_cmd = r"""
$sh = New-Object -ComObject WScript.Shell
$p1 = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\SoundStash.lnk"
$p2 = "$env:USERPROFILE\Desktop\SoundStash.lnk"
foreach ($p in @($p1, $p2)) {
    if (Test-Path $p) {
        $lnk = $sh.CreateShortcut($p)
        Write-Output ("LNK: " + $p)
        Write-Output ("  Target: " + $lnk.TargetPath)
        Write-Output ("  Icon: " + $lnk.IconLocation)
    }
}
"""

res = subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], capture_output=True, text=True)
print(res.stdout)

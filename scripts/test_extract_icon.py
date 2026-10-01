import os
import subprocess

ps_script = r"""
Add-Type -AssemblyName System.Drawing
$exe = 'dist\SoundStash Setup 3.0.0.exe'
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
$bmp = $icon.ToBitmap()
$dest = 'scratch\extracted_setup_icon.png'
$bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "Extracted setup icon size: $($bmp.Width)x$($bmp.Height)"
"""

res = subprocess.run(["powershell", "-NoProfile", "-Command", ps_script], capture_output=True, text=True)
print(res.stdout)
if res.stderr:
    print("Stderr:", res.stderr)

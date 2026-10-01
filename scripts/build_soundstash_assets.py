"""
Générateur officiel des assets graphiques SoundStash par Helmicretro
Produit :
- frontend/favicon.svg
- frontend/icon.svg
- build/icon.svg
- build/icon.png (512x512)
- frontend/icon.png (512x512)
- build/icon.ico (multi-résolution Windows : 256, 128, 64, 48, 32, 24, 16)
- frontend/icon.ico
- build/soundstash_logo.png
- frontend/soundstash_logo.png
"""
import os
import shutil
import sys
from pathlib import Path
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent

SVG_SOUNDSTASH_ICON = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="soundstashBg" x1="15%" y1="0%" x2="85%" y2="100%">
      <stop offset="0%" stop-color="#ff2e58"/>
      <stop offset="100%" stop-color="#dc183f"/>
    </linearGradient>
  </defs>

  <!-- Squircle Base -->
  <rect x="0" y="0" width="512" height="512" rx="116" ry="116" fill="url(#soundstashBg)"/>

  <!-- Outer Soft Halo Ring -->
  <circle cx="256" cy="256" r="168" fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="14"/>

  <!-- Left Bracket Arc -->
  <path d="M 144 190 A 136 136 0 0 0 144 322" fill="none" stroke="#ffffff" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- Right Bracket Arc -->
  <path d="M 368 190 A 136 136 0 0 1 368 322" fill="none" stroke="#ffffff" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- Inner Groove Circle -->
  <circle cx="256" cy="256" r="95" fill="none" stroke="#ffffff" stroke-width="22"/>

  <!-- Center Vinyl Dot -->
  <circle cx="256" cy="256" r="28" fill="#ffffff"/>
</svg>'''

def main():
    print("=== GÉNÉRATION DES ASSETS VECTORIELS ET ICÔNES SOUNDSTASH ===")
    
    # 1. Écrire les fichiers SVG
    svg_paths = [
        ROOT / "frontend" / "favicon.svg",
        ROOT / "frontend" / "icon.svg",
        ROOT / "build" / "icon.svg",
        ROOT / "scratch" / "soundstash_icon.svg"
    ]
    for p in svg_paths:
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write(SVG_SOUNDSTASH_ICON)
        print(f"  ✓ SVG généré : {p}")

    # 2. Utiliser le crop haute fidélité du logo utilisateur ou rendu Pillow
    user_img = ROOT / "frontend" / "stash_logo.png"
    if not user_img.exists():
        user_img = ROOT / "frontend" / "soundstash_logo.png"
    
    im_logo = Image.open(user_img).convert("RGBA")
    raw_icon = im_logo.crop((0, 0, 40, 40))
    
    master_512 = raw_icon.resize((512, 512), Image.Resampling.LANCZOS)
    
    master_512.save(ROOT / "build" / "icon.png")
    master_512.save(ROOT / "frontend" / "icon.png")
    print(f"  ✓ PNG 512x512 enregistré dans build/icon.png et frontend/icon.png")

    sizes = [16, 24, 32, 48, 64, 128, 256]
    ico_images = []
    for s in sizes:
        ico_images.append(raw_icon.resize((s, s), Image.Resampling.LANCZOS))
    
    build_ico = ROOT / "build" / "icon.ico"
    frontend_ico = ROOT / "frontend" / "icon.ico"
    
    largest = ico_images[-1]
    other_sizes = ico_images[:-1]
    
    largest.save(build_ico, format="ICO", sizes=[(s, s) for s in sizes])
    largest.save(frontend_ico, format="ICO", sizes=[(s, s) for s in sizes])
    print(f"  ✓ ICO multi-résolution enregistré : {build_ico} et {frontend_ico}")

    # Synchroniser les logos
    if user_img.exists():
        shutil.copy2(user_img, ROOT / "frontend" / "soundstash_logo.png")
        shutil.copy2(user_img, ROOT / "build" / "soundstash_logo.png")
        print(f"  ✓ soundstash_logo.png synchronisé")

    print("=== ASSETS GRAPHICS SOUNDSTASH PRÊTS À 100% ===")

if __name__ == "__main__":
    main()

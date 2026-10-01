"""
Générateur de pochettes thématiques vectorielles SVG pour les playlists SoundStash.
Crée 24 visuels haute fidélité (400x400) rétro, gaming, 8-bit, cinéma, instruments, véhicules et synthwave.
"""

import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

DEST_DIR = Path(__file__).resolve().parent.parent / "frontend" / "playlist_covers"
DEST_DIR.mkdir(parents=True, exist_ok=True)

COVERS = {
    # --- RETROGAMING ---
    "retrogaming_arcade.svg": {
        "title": "Arcade 80s",
        "category": "retrogaming",
        "bg_start": "#0f051d", "bg_end": "#290849", "accent": "#ff007f", "accent2": "#00f0ff",
        "svg_content": """
            <!-- Borne d'arcade stylisée -->
            <path d="M140 330 L140 130 L180 80 L280 80 L260 130 L260 330 Z" fill="#1b1233" stroke="#00f0ff" stroke-width="4" filter="url(#glow)"/>
            <polygon points="175,95 245,95 240,125 170,125" fill="#ff007f"/>
            <text x="207" y="116" font-family="'Outfit', sans-serif" font-weight="900" font-size="16" fill="#fff" text-anchor="middle" letter-spacing="3">ARCADE</text>
            <!-- Écran CRT incurvé -->
            <rect x="160" y="140" width="80" height="70" rx="8" fill="#090515" stroke="#00f0ff" stroke-width="2"/>
            <path d="M170 175 L185 160 L200 175 L215 160 L230 175" fill="none" stroke="#ff007f" stroke-width="3" stroke-linecap="round"/>
            <circle cx="185" cy="188" r="4" fill="#ffdd00"/>
            <circle cx="215" cy="188" r="4" fill="#00f0ff"/>
            <!-- Panneau de contrôle & Joystick -->
            <polygon points="145,225 255,225 260,260 140,260" fill="#241442" stroke="#ff007f" stroke-width="2"/>
            <line x1="175" y1="248" x2="175" y2="232" stroke="#aaa" stroke-width="4"/>
            <circle cx="175" cy="230" r="8" fill="#ff2a4b" filter="url(#glow)"/>
            <circle cx="210" cy="242" r="5" fill="#00f0ff"/>
            <circle cx="225" cy="238" r="5" fill="#ffdd00"/>
            <circle cx="240" cy="242" r="5" fill="#10b981"/>
            <!-- Fente monnayeur -->
            <rect x="185" y="280" width="30" height="40" rx="4" fill="#0e071f" stroke="#00f0ff" stroke-width="1.5"/>
            <line x1="200" y1="290" x2="200" y2="305" stroke="#ffdd00" stroke-width="2.5"/>
        """
    },
    "retrogaming_cartridge.svg": {
        "title": "Cartouche 16-Bit",
        "category": "retrogaming",
        "bg_start": "#111424", "bg_end": "#1e2238", "accent": "#f59e0b", "accent2": "#3b82f6",
        "svg_content": """
            <!-- Cartouche de jeu rétro 16-Bit -->
            <rect x="110" y="90" width="180" height="230" rx="14" fill="#2d3248" stroke="#4f567a" stroke-width="4"/>
            <rect x="130" y="80" width="140" height="20" rx="4" fill="#1e2235"/>
            <!-- Rainures latérales -->
            <line x1="120" y1="120" x2="120" y2="280" stroke="#1e2235" stroke-width="4"/>
            <line x1="280" y1="120" x2="280" y2="280" stroke="#1e2235" stroke-width="4"/>
            <!-- Étiquette brillante -->
            <rect x="135" y="125" width="130" height="140" rx="8" fill="#0f172a" stroke="#f59e0b" stroke-width="2.5"/>
            <path d="M135 125 L265 125 L265 175 L135 155 Z" fill="url(#grad_accent)"/>
            <text x="200" y="150" font-family="'Outfit', sans-serif" font-weight="900" font-size="20" fill="#fff" text-anchor="middle" letter-spacing="2">16-BIT</text>
            <text x="200" y="170" font-family="'Outfit', sans-serif" font-weight="700" font-size="11" fill="#fde047" text-anchor="middle" letter-spacing="1">ORIGINAL SOUNDTRACK</text>
            <!-- Illustration pixel sur étiquette -->
            <circle cx="200" cy="215" r="22" fill="#1e293b" stroke="#38bdf8" stroke-width="2"/>
            <path d="M192 215 L204 207 L204 223 Z" fill="#38bdf8"/>
            <!-- Connecteur doré en bas -->
            <rect x="145" y="310" width="110" height="15" fill="#d97706" rx="2"/>
        """
    },
    "retrogaming_controller.svg": {
        "title": "Manette Rétro Classic",
        "category": "retrogaming",
        "bg_start": "#0a0a14", "bg_end": "#181829", "accent": "#ef4444", "accent2": "#9ca3af",
        "svg_content": """
            <!-- Manette rétro grise & bordeaux -->
            <rect x="80" y="140" width="240" height="130" rx="28" fill="#d1d5db" stroke="#9ca3af" stroke-width="4"/>
            <rect x="100" y="160" width="200" height="90" rx="14" fill="#1f2937"/>
            <!-- Croix directionnelle D-Pad -->
            <path d="M135 185 h15 v-15 h15 v15 h15 v15 h-15 v15 h-15 v-15 h-15 z" fill="#111827" stroke="#374151" stroke-width="2"/>
            <circle cx="157" cy="200" r="4" fill="#1f2937"/>
            <!-- Boutons Select / Start -->
            <rect x="185" y="210" width="20" height="8" rx="4" transform="rotate(-25 195 214)" fill="#4b5563"/>
            <rect x="215" y="210" width="20" height="8" rx="4" transform="rotate(-25 225 214)" fill="#4b5563"/>
            <!-- Boutons B & A Rouges -->
            <circle cx="255" cy="212" r="14" fill="#dc2626" stroke="#991b1b" stroke-width="2" filter="url(#glow)"/>
            <circle cx="282" cy="190" r="14" fill="#dc2626" stroke="#991b1b" stroke-width="2" filter="url(#glow)"/>
            <text x="255" y="217" font-family="'Outfit', sans-serif" font-weight="800" font-size="12" fill="#fff" text-anchor="middle">B</text>
            <text x="282" y="195" font-family="'Outfit', sans-serif" font-weight="800" font-size="12" fill="#fff" text-anchor="middle">A</text>
        """
    },

    # --- GAMING MODERNE ---
    "gaming_modern.svg": {
        "title": "Gamepad Cyber Néon",
        "category": "gaming",
        "bg_start": "#070814", "bg_end": "#13162f", "accent": "#00f0ff", "accent2": "#7928ca",
        "svg_content": """
            <!-- Manette moderne ergonomique avec lueur cyber -->
            <path d="M120 130 C90 130 65 170 75 250 C80 280 110 290 130 260 L155 220 L245 220 L270 260 C290 290 320 280 325 250 C335 170 310 130 280 130 Z" fill="#121526" stroke="#00f0ff" stroke-width="3" filter="url(#glow)"/>
            <!-- Mini-stick gauche -->
            <circle cx="135" cy="180" r="18" fill="#1e223d" stroke="#00f0ff" stroke-width="2"/>
            <circle cx="135" cy="180" r="8" fill="#00f0ff"/>
            <!-- D-pad moderne -->
            <path d="M150 205 h8 v-8 h8 v8 h8 v8 h-8 v8 h-8 v-8 h-8 z" fill="#2d3356"/>
            <!-- Mini-stick droit -->
            <circle cx="225" cy="205" r="18" fill="#1e223d" stroke="#ff007f" stroke-width="2"/>
            <circle cx="225" cy="205" r="8" fill="#ff007f"/>
            <!-- Boutons d'action X Y A B -->
            <circle cx="265" cy="165" r="7" fill="#3b82f6"/>
            <circle cx="280" cy="180" r="7" fill="#ef4444"/>
            <circle cx="250" cy="180" r="7" fill="#eab308"/>
            <circle cx="265" cy="195" r="7" fill="#10b981"/>
            <!-- Pavé tactile central avec néon -->
            <rect x="175" y="145" width="50" height="30" rx="6" fill="#1a1e36" stroke="#7928ca" stroke-width="2"/>
            <line x1="185" y1="145" x2="215" y2="145" stroke="#00f0ff" stroke-width="3" filter="url(#glow)"/>
        """
    },
    "gaming_headset.svg": {
        "title": "Casque Gamer RGB",
        "category": "gaming",
        "bg_start": "#0a0614", "bg_end": "#190e30", "accent": "#a855f7", "accent2": "#06b6d4",
        "svg_content": """
            <!-- Arceau supérieur -->
            <path d="M110 200 C110 110 290 110 290 200" fill="none" stroke="#2a1f4a" stroke-width="20" stroke-linecap="round"/>
            <path d="M110 200 C110 110 290 110 290 200" fill="none" stroke="#a855f7" stroke-width="4" stroke-linecap="round" filter="url(#glow)"/>
            <!-- Coussin arceau -->
            <path d="M140 135 C170 120 230 120 260 135" fill="none" stroke="#4c1d95" stroke-width="8" stroke-linecap="round"/>
            <!-- Écouteur gauche -->
            <rect x="85" y="180" width="40" height="70" rx="16" fill="#160d2b" stroke="#06b6d4" stroke-width="3" filter="url(#glow)"/>
            <circle cx="105" cy="215" r="12" fill="none" stroke="#a855f7" stroke-width="2"/>
            <!-- Écouteur droit -->
            <rect x="275" y="180" width="40" height="70" rx="16" fill="#160d2b" stroke="#06b6d4" stroke-width="3" filter="url(#glow)"/>
            <circle cx="295" cy="215" r="12" fill="none" stroke="#a855f7" stroke-width="2"/>
            <!-- Micro perche -->
            <path d="M105 240 C110 280 160 295 190 290" fill="none" stroke="#06b6d4" stroke-width="4" stroke-linecap="round"/>
            <rect x="190" y="284" width="16" height="12" rx="4" fill="#a855f7" filter="url(#glow)"/>
        """
    },

    # --- 8-BIT & PIXEL ART ---
    "eight_bit_handheld.svg": {
        "title": "Console 8-Bit Portable",
        "category": "eight_bit",
        "bg_start": "#0a1910", "bg_end": "#163322", "accent": "#84cc16", "accent2": "#22c55e",
        "svg_content": """
            <!-- Console portable type Game Boy -->
            <rect x="115" y="70" width="170" height="265" rx="16" fill="#c4cad0" stroke="#8a949e" stroke-width="4"/>
            <path d="M260 335 L285 310" stroke="#8a949e" stroke-width="3"/>
            <!-- Écran vert matrix rétro -->
            <rect x="135" y="95" width="130" height="105" rx="10" fill="#6f7972"/>
            <rect x="155" y="110" width="90" height="75" rx="4" fill="#8bac0f" stroke="#306230" stroke-width="3"/>
            <!-- Sprite pixel art sur écran -->
            <rect x="185" y="130" width="10" height="10" fill="#0f380f"/>
            <rect x="195" y="130" width="10" height="10" fill="#0f380f"/>
            <rect x="205" y="130" width="10" height="10" fill="#0f380f"/>
            <rect x="175" y="140" width="50" height="10" fill="#0f380f"/>
            <rect x="185" y="150" width="30" height="10" fill="#0f380f"/>
            <!-- D-pad noir -->
            <rect x="145" y="235" width="40" height="14" fill="#1f2937"/>
            <rect x="158" y="222" width="14" height="40" fill="#1f2937"/>
            <!-- Boutons violets B / A inclinés -->
            <circle cx="230" cy="245" r="11" fill="#9333ea"/>
            <circle cx="260" cy="235" r="11" fill="#9333ea"/>
            <text x="230" y="270" font-family="'JetBrains Mono', monospace" font-size="10" font-weight="700" fill="#475569">B</text>
            <text x="260" y="260" font-family="'JetBrains Mono', monospace" font-size="10" font-weight="700" fill="#475569">A</text>
        """
    },
    "eight_bit_pixel_heart.svg": {
        "title": "Pixel Art 8-Bit Life",
        "category": "eight_bit",
        "bg_start": "#0f0514", "bg_end": "#260d33", "accent": "#ff2a5f", "accent2": "#fbbf24",
        "svg_content": """
            <!-- Cœur Pixel Art géant avec reflet -->
            <g transform="translate(110, 110) scale(1.8)" fill="#ff2a5f" filter="url(#glow)">
                <rect x="10" y="10" width="10" height="10"/><rect x="20" y="10" width="10" height="10"/>
                <rect x="50" y="10" width="10" height="10"/><rect x="60" y="10" width="10" height="10"/>
                <rect x="0" y="20" width="40" height="10"/><rect x="40" y="20" width="40" height="10"/>
                <rect x="0" y="30" width="80" height="10"/>
                <rect x="0" y="40" width="80" height="10"/>
                <rect x="10" y="50" width="60" height="10"/>
                <rect x="20" y="60" width="40" height="10"/>
                <rect x="30" y="70" width="20" height="10"/>
                <!-- Reflet blanc pixel -->
                <rect x="10" y="20" width="10" height="10" fill="#ffffff"/>
                <rect x="20" y="20" width="10" height="10" fill="#ffffff"/>
                <rect x="10" y="30" width="10" height="10" fill="#ffffff"/>
            </g>
            <!-- Étoiles pixel art flottantes -->
            <g fill="#fbbf24">
                <rect x="80" y="90" width="8" height="8"/><rect x="88" y="82" width="8" height="8"/><rect x="88" y="98" width="8" height="8"/><rect x="96" y="90" width="8" height="8"/>
                <rect x="300" y="140" width="6" height="6"/><rect x="306" y="134" width="6" height="6"/><rect x="306" y="146" width="6" height="6"/><rect x="312" y="140" width="6" height="6"/>
                <rect x="100" y="280" width="6" height="6"/><rect x="106" y="274" width="6" height="6"/><rect x="106" y="286" width="6" height="6"/><rect x="112" y="280" width="6" height="6"/>
            </g>
            <text x="200" y="330" font-family="'JetBrains Mono', monospace" font-size="16" font-weight="800" fill="#00f0ff" text-anchor="middle" letter-spacing="4">LEVEL UP !</text>
        """
    },

    # --- CINÉMA & B.O. ---
    "cinema_clapperboard.svg": {
        "title": "Clap de Cinéma 35mm",
        "category": "cinema",
        "bg_start": "#111827", "bg_end": "#1f2937", "accent": "#f59e0b", "accent2": "#ef4444",
        "svg_content": """
            <!-- Clap de cinéma incliné -->
            <g transform="rotate(-6 200 200)">
                <!-- Corps du clap -->
                <rect x="90" y="140" width="220" height="160" rx="8" fill="#18181b" stroke="#3f3f46" stroke-width="4"/>
                <line x1="90" y1="190" x2="310" y2="190" stroke="#f59e0b" stroke-width="2"/>
                <text x="110" y="175" font-family="'Outfit', sans-serif" font-weight="900" font-size="18" fill="#fff" letter-spacing="2">YTM CINEMA</text>
                <text x="260" y="175" font-family="'Outfit', sans-serif" font-weight="700" font-size="14" fill="#f59e0b">TAKE 01</text>
                <text x="110" y="230" font-family="'JetBrains Mono', monospace" font-size="12" fill="#a1a1aa">SCENE: SOUNDTRACK</text>
                <text x="110" y="260" font-family="'JetBrains Mono', monospace" font-size="12" fill="#a1a1aa">DIR: HELMICRETRO</text>
                <!-- Clavier / Charnière supérieure zébrée -->
                <g transform="rotate(-18 90 140)">
                    <rect x="90" y="105" width="220" height="35" rx="4" fill="#18181b" stroke="#f59e0b" stroke-width="2"/>
                    <polygon points="120,105 145,105 125,140 100,140" fill="#ffffff"/>
                    <polygon points="170,105 195,105 175,140 150,140" fill="#ffffff"/>
                    <polygon points="220,105 245,105 225,140 200,140" fill="#ffffff"/>
                    <polygon points="270,105 295,105 275,140 250,140" fill="#ffffff"/>
                </g>
            </g>
        """
    },
    "cinema_projector.svg": {
        "title": "Projecteur Salle Obscure",
        "category": "cinema",
        "bg_start": "#05060f", "bg_end": "#111429", "accent": "#38bdf8", "accent2": "#fde047",
        "svg_content": """
            <!-- Projecteur rétro avec bobines et faisceau lumineux -->
            <!-- Faisceau conique de lumière -->
            <polygon points="220,205 380,100 380,310" fill="url(#beam_grad)" opacity="0.35"/>
            <!-- Deux bobines rondes -->
            <circle cx="150" cy="130" r="38" fill="none" stroke="#94a3b8" stroke-width="5"/>
            <circle cx="150" cy="130" r="8" fill="#38bdf8"/>
            <line x1="150" y1="92" x2="150" y2="168" stroke="#94a3b8" stroke-width="2"/>
            <line x1="112" y1="130" x2="188" y2="130" stroke="#94a3b8" stroke-width="2"/>

            <circle cx="230" cy="140" r="32" fill="none" stroke="#94a3b8" stroke-width="5"/>
            <circle cx="230" cy="140" r="7" fill="#38bdf8"/>
            <!-- Corps du projecteur -->
            <rect x="130" y="175" width="90" height="70" rx="8" fill="#1e293b" stroke="#38bdf8" stroke-width="3"/>
            <!-- Objectif et lampe -->
            <path d="M220 190 L245 180 L245 230 L220 220 Z" fill="#334155" stroke="#38bdf8" stroke-width="2"/>
            <circle cx="245" cy="205" r="10" fill="#fde047" filter="url(#glow)"/>
            <!-- Pied / Trépied -->
            <line x1="175" y1="245" x2="175" y2="330" stroke="#64748b" stroke-width="6"/>
            <line x1="175" y1="290" x2="120" y2="340" stroke="#64748b" stroke-width="4"/>
            <line x1="175" y1="290" x2="230" y2="340" stroke="#64748b" stroke-width="4"/>
        """
    },
    "cinema_orchestra.svg": {
        "title": "Grand Orchestre Symphonique",
        "category": "cinema",
        "bg_start": "#1a0808", "bg_end": "#361010", "accent": "#f59e0b", "accent2": "#ef4444",
        "svg_content": """
            <!-- Violon / Violoncelle stylisé avec portée musicale dorée -->
            <path d="M200 70 L200 330" stroke="#f59e0b" stroke-width="3"/>
            <!-- Silhouette violon -->
            <path d="M170 120 C150 140 150 170 170 190 C140 210 140 260 170 290 C200 305 200 305 230 290 C260 260 260 210 230 190 C250 170 250 140 230 120 Z" fill="#2d1313" stroke="#f59e0b" stroke-width="3" filter="url(#glow)"/>
            <!-- Ouïes en f -->
            <path d="M175 220 C180 230 180 240 175 250" fill="none" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/>
            <path d="M225 220 C220 230 220 240 225 250" fill="none" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/>
            <!-- Baguette de chef d'orchestre en diagonale -->
            <line x1="90" y1="310" x2="310" y2="90" stroke="#ffffff" stroke-width="3" filter="url(#glow)"/>
            <circle cx="95" cy="305" r="7" fill="#f59e0b"/>
            <!-- Notes musicales flottantes -->
            <text x="120" y="110" font-size="28" fill="#f59e0b">♩</text>
            <text x="280" y="130" font-size="34" fill="#fde047">♫</text>
            <text x="100" y="220" font-size="24" fill="#f59e0b">♬</text>
            <text x="200" y="350" font-family="'Outfit', sans-serif" font-weight="800" font-size="14" fill="#fde047" text-anchor="middle" letter-spacing="3">ORIGINAL SCORE</text>
        """
    },
    "cinema_scifi.svg": {
        "title": "Space Sci-Fi Thriller",
        "category": "cinema",
        "bg_start": "#020617", "bg_end": "#0b1536", "accent": "#00f0ff", "accent2": "#6366f1",
        "svg_content": """
            <!-- Planète annelée et vaisseau spatial cinématique -->
            <!-- Planète avec anneau -->
            <circle cx="200" cy="180" r="65" fill="#1e1b4b" stroke="#6366f1" stroke-width="2"/>
            <ellipse cx="200" cy="180" rx="120" ry="32" fill="none" stroke="#00f0ff" stroke-width="3" transform="rotate(-18 200 180)" filter="url(#glow)"/>
            <!-- Silhouette vaisseau spatial -->
            <polygon points="200,240 225,300 200,285 175,300" fill="#f8fafc" filter="url(#glow)"/>
            <polygon points="200,285 208,320 200,310 192,320" fill="#00f0ff" filter="url(#glow)"/>
            <!-- Étoiles lointaines -->
            <circle cx="100" cy="90" r="2" fill="#fff"/>
            <circle cx="310" cy="110" r="2.5" fill="#fff"/>
            <circle cx="70" cy="240" r="1.5" fill="#fff"/>
            <circle cx="330" cy="260" r="2" fill="#fff"/>
            <text x="200" y="350" font-family="'Outfit', sans-serif" font-weight="900" font-size="15" fill="#00f0ff" text-anchor="middle" letter-spacing="5">INTERSTELLAR</text>
        """
    },

    # --- INSTRUMENTS ---
    "instrument_guitar.svg": {
        "title": "Guitare Électrique Neon",
        "category": "instruments",
        "bg_start": "#13051e", "bg_end": "#2d0b45", "accent": "#ff2a5f", "accent2": "#00f0ff",
        "svg_content": """
            <!-- Guitare électrique de profil diagonal -->
            <g transform="rotate(-32 200 200)">
                <!-- Corps de guitare type Strat / Superstrat -->
                <path d="M150 160 C120 190 120 260 170 290 C220 310 260 270 250 220 C240 180 200 170 180 180 C170 170 170 140 150 160 Z" fill="#200b38" stroke="#ff2a5f" stroke-width="4" filter="url(#glow)"/>
                <!-- Pickguard blanc translucide -->
                <path d="M165 195 C145 220 155 260 185 270 C210 275 230 250 225 220 Z" fill="rgba(255,255,255,0.12)" stroke="#00f0ff" stroke-width="1.5"/>
                <!-- Micros double bobinage -->
                <rect x="180" y="210" width="30" height="10" rx="3" fill="#0b0416" stroke="#ff2a5f" stroke-width="1.5"/>
                <rect x="185" y="230" width="30" height="10" rx="3" fill="#0b0416" stroke="#ff2a5f" stroke-width="1.5"/>
                <!-- Manche et frettes -->
                <rect x="162" y="30" width="14" height="140" fill="#3b1d5a" stroke="#00f0ff" stroke-width="2"/>
                <line x1="162" y1="50" x2="176" y2="50" stroke="#ff2a5f" stroke-width="1"/>
                <line x1="162" y1="80" x2="176" y2="80" stroke="#ff2a5f" stroke-width="1"/>
                <line x1="162" y1="110" x2="176" y2="110" stroke="#ff2a5f" stroke-width="1"/>
                <line x1="162" y1="140" x2="176" y2="140" stroke="#ff2a5f" stroke-width="1"/>
                <!-- Tête inversée avec mécaniques -->
                <polygon points="160,30 176,30 182,5 155,10" fill="#200b38" stroke="#ff2a5f" stroke-width="2"/>
            </g>
        """
    },
    "instrument_synth.svg": {
        "title": "Synthétiseur Analogique 80s",
        "category": "instruments",
        "bg_start": "#070b1a", "bg_end": "#111f3d", "accent": "#00f0ff", "accent2": "#f43f5e",
        "svg_content": """
            <!-- Synthétiseur analogique avec clavier et potentiomètres -->
            <polygon points="70,180 330,180 350,290 50,290" fill="#161e36" stroke="#00f0ff" stroke-width="3" filter="url(#glow)"/>
            <!-- Panneau commandes supérieur -->
            <polygon points="75,185 325,185 320,225 80,225" fill="#0b1021"/>
            <!-- Boutons / Potards colorés -->
            <circle cx="110" cy="205" r="7" fill="#f43f5e" filter="url(#glow)"/>
            <circle cx="135" cy="205" r="7" fill="#f43f5e"/>
            <circle cx="170" cy="205" r="6" fill="#00f0ff"/>
            <circle cx="195" cy="205" r="6" fill="#00f0ff"/>
            <circle cx="220" cy="205" r="6" fill="#00f0ff"/>
            <circle cx="260" cy="205" r="8" fill="#eab308"/>
            <circle cx="290" cy="205" r="8" fill="#10b981"/>
            <!-- Clavier touches blanches -->
            <g fill="#f8fafc" stroke="#334155" stroke-width="1.5">
                <rect x="75" y="230" width="16" height="55" rx="2"/>
                <rect x="91" y="230" width="16" height="55" rx="2"/>
                <rect x="107" y="230" width="16" height="55" rx="2"/>
                <rect x="123" y="230" width="16" height="55" rx="2"/>
                <rect x="139" y="230" width="16" height="55" rx="2"/>
                <rect x="155" y="230" width="16" height="55" rx="2"/>
                <rect x="171" y="230" width="16" height="55" rx="2"/>
                <rect x="187" y="230" width="16" height="55" rx="2"/>
                <rect x="203" y="230" width="16" height="55" rx="2"/>
                <rect x="219" y="230" width="16" height="55" rx="2"/>
                <rect x="235" y="230" width="16" height="55" rx="2"/>
                <rect x="251" y="230" width="16" height="55" rx="2"/>
                <rect x="267" y="230" width="16" height="55" rx="2"/>
                <rect x="283" y="230" width="16" height="55" rx="2"/>
                <rect x="299" y="230" width="16" height="55" rx="2"/>
                <rect x="315" y="230" width="16" height="55" rx="2"/>
            </g>
            <!-- Touches noires -->
            <g fill="#0f172a">
                <rect x="86" y="230" width="10" height="34" rx="1"/>
                <rect x="102" y="230" width="10" height="34" rx="1"/>
                <rect x="134" y="230" width="10" height="34" rx="1"/>
                <rect x="150" y="230" width="10" height="34" rx="1"/>
                <rect x="166" y="230" width="10" height="34" rx="1"/>
                <rect x="198" y="230" width="10" height="34" rx="1"/>
                <rect x="214" y="230" width="10" height="34" rx="1"/>
                <rect x="246" y="230" width="10" height="34" rx="1"/>
                <rect x="262" y="230" width="10" height="34" rx="1"/>
                <rect x="278" y="230" width="10" height="34" rx="1"/>
                <rect x="310" y="230" width="10" height="34" rx="1"/>
            </g>
        """
    },
    "instrument_saxophone.svg": {
        "title": "Saxophone Jazz Club",
        "category": "instruments",
        "bg_start": "#1c1006", "bg_end": "#38200c", "accent": "#f59e0b", "accent2": "#fbbf24",
        "svg_content": """
            <!-- Saxophone doré stylisé avec courbes de jazz -->
            <path d="M160 80 L180 80 L180 230 C180 270 230 270 240 220 L245 170 C245 150 280 150 290 190 C300 230 250 310 180 300 C130 290 130 220 130 190" fill="none" stroke="#f59e0b" stroke-width="14" stroke-linecap="round" filter="url(#glow)"/>
            <!-- Pavillon évasé -->
            <ellipse cx="270" cy="180" rx="28" ry="38" fill="#b45309" stroke="#fbbf24" stroke-width="4"/>
            <ellipse cx="270" cy="180" rx="16" ry="24" fill="#451a03"/>
            <!-- Clés de saxophone -->
            <circle cx="160" cy="120" r="5" fill="#fde047"/>
            <circle cx="160" cy="140" r="5" fill="#fde047"/>
            <circle cx="160" cy="160" r="5" fill="#fde047"/>
            <circle cx="160" cy="180" r="5" fill="#fde047"/>
            <circle cx="160" cy="200" r="5" fill="#fde047"/>
            <!-- Volutes de fumée / notes -->
            <path d="M280 140 C290 110 320 110 330 80" fill="none" stroke="rgba(251,191,36,0.5)" stroke-width="3" stroke-dasharray="4 4"/>
            <text x="330" y="80" font-size="24" fill="#fbbf24">♪</text>
        """
    },

    # --- VÉHICULES & NIGHT DRIVE ---
    "vehicle_outrun.svg": {
        "title": "Supercar Outrun Sunset",
        "category": "vehicles",
        "bg_start": "#180629", "bg_end": "#3d0b4e", "accent": "#ff2a5f", "accent2": "#00f0ff",
        "svg_content": """
            <!-- Soleil rétro géant découpé -->
            <circle cx="200" cy="170" r="75" fill="url(#sun_grad)"/>
            <line x1="120" y1="150" x2="280" y2="150" stroke="#180629" stroke-width="4"/>
            <line x1="120" y1="165" x2="280" y2="165" stroke="#180629" stroke-width="6"/>
            <line x1="120" y1="182" x2="280" y2="182" stroke="#180629" stroke-width="8"/>
            <line x1="120" y1="202" x2="280" y2="202" stroke="#180629" stroke-width="11"/>
            <!-- Grille perspective au sol -->
            <line x1="0" y1="240" x2="400" y2="240" stroke="#ff2a5f" stroke-width="2"/>
            <line x1="200" y1="240" x2="50" y2="400" stroke="#00f0ff" stroke-width="2"/>
            <line x1="200" y1="240" x2="130" y2="400" stroke="#00f0ff" stroke-width="2"/>
            <line x1="200" y1="240" x2="270" y2="400" stroke="#00f0ff" stroke-width="2"/>
            <line x1="200" y1="240" x2="350" y2="400" stroke="#00f0ff" stroke-width="2"/>
            <!-- Silhouette sportive 80s vue de dos -->
            <path d="M140 285 L160 250 L240 250 L260 285 L275 305 L125 305 Z" fill="#0f071a" stroke="#ff2a5f" stroke-width="3"/>
            <!-- Feux arrières néon bordeaux horizontaux -->
            <rect x="135" y="285" width="130" height="12" rx="3" fill="#ff0044" filter="url(#glow)"/>
            <line x1="135" y1="291" x2="265" y2="291" stroke="#ffdd00" stroke-width="2"/>
            <!-- Pots d'échappement & pneus -->
            <rect x="120" y="295" width="18" height="25" rx="4" fill="#05020a"/>
            <rect x="262" y="295" width="18" height="25" rx="4" fill="#05020a"/>
        """
    },
    "vehicle_cyber_bike.svg": {
        "title": "Cyber Moto Cruising",
        "category": "vehicles",
        "bg_start": "#060b17", "bg_end": "#0f203d", "accent": "#00f0ff", "accent2": "#3b82f6",
        "svg_content": """
            <!-- Moto futuriste néon de profil -->
            <!-- Roue arrière lumineuse -->
            <circle cx="120" cy="250" r="45" fill="none" stroke="#00f0ff" stroke-width="8" filter="url(#glow)"/>
            <circle cx="120" cy="250" r="25" fill="#0a1224"/>
            <!-- Roue avant lumineuse -->
            <circle cx="280" cy="250" r="45" fill="none" stroke="#00f0ff" stroke-width="8" filter="url(#glow)"/>
            <circle cx="280" cy="250" r="25" fill="#0a1224"/>
            <!-- Cadre caréné profilé néon -->
            <path d="M120 250 L180 200 L240 185 L280 250 L230 250 L190 230 L150 250 Z" fill="#0f1933" stroke="#3b82f6" stroke-width="4"/>
            <path d="M170 195 L250 185" stroke="#ff0055" stroke-width="4" filter="url(#glow)"/>
            <!-- Phare avant laser -->
            <polygon points="280,195 360,180 360,240 280,210" fill="url(#beam_cyan)" opacity="0.4"/>
        """
    },

    # --- SYNTHWAVE & 80s ---
    "synthwave_sunset.svg": {
        "title": "Sunset Néon & Palmiers",
        "category": "synthwave",
        "bg_start": "#130524", "bg_end": "#320b4a", "accent": "#ff2a5f", "accent2": "#fbbf24",
        "svg_content": """
            <!-- Coucher de soleil Synthwave avec silhouette de palmier -->
            <circle cx="200" cy="180" r="80" fill="url(#sun_grad)" filter="url(#glow)"/>
            <!-- Lignes de découpure soleil -->
            <rect x="110" y="160" width="180" height="4" fill="#130524"/>
            <rect x="110" y="175" width="180" height="6" fill="#130524"/>
            <rect x="110" y="193" width="180" height="9" fill="#130524"/>
            <rect x="110" y="214" width="180" height="13" fill="#130524"/>
            <!-- Palmier tropical à droite -->
            <path d="M310 330 C300 240 270 180 250 140" fill="none" stroke="#0d0417" stroke-width="10" stroke-linecap="round"/>
            <path d="M250 140 C220 130 180 145 160 165" fill="none" stroke="#0d0417" stroke-width="6" stroke-linecap="round"/>
            <path d="M250 140 C230 110 200 100 170 110" fill="none" stroke="#0d0417" stroke-width="6" stroke-linecap="round"/>
            <path d="M250 140 C260 100 280 90 320 95" fill="none" stroke="#0d0417" stroke-width="6" stroke-linecap="round"/>
            <path d="M250 140 C280 120 310 130 335 150" fill="none" stroke="#0d0417" stroke-width="6" stroke-linecap="round"/>
            <!-- Ligne d'horizon violette -->
            <line x1="0" y1="250" x2="400" y2="250" stroke="#00f0ff" stroke-width="3" filter="url(#glow)"/>
        """
    },
    "synthwave_grid.svg": {
        "title": "Grille Perspective Wireframe",
        "category": "synthwave",
        "bg_start": "#0a0418", "bg_end": "#200938", "accent": "#a855f7", "accent2": "#00f0ff",
        "svg_content": """
            <!-- Grille perspective 3D pure et ondes vectorielles -->
            <!-- Montagnes vectorielles violettes en fond -->
            <polygon points="0,220 60,160 140,220 220,130 310,220 400,170 400,220 0,220" fill="#160829" stroke="#a855f7" stroke-width="2"/>
            <!-- Lignes de fuite perspective -->
            <line x1="200" y1="220" x2="-40" y2="400" stroke="#00f0ff" stroke-width="2.5" filter="url(#glow)"/>
            <line x1="200" y1="220" x2="40" y2="400" stroke="#00f0ff" stroke-width="2"/>
            <line x1="200" y1="220" x2="120" y2="400" stroke="#00f0ff" stroke-width="2"/>
            <line x1="200" y1="220" x2="200" y2="400" stroke="#00f0ff" stroke-width="2"/>
            <line x1="200" y1="220" x2="280" y2="400" stroke="#00f0ff" stroke-width="2"/>
            <line x1="200" y1="220" x2="360" y2="400" stroke="#00f0ff" stroke-width="2"/>
            <line x1="200" y1="220" x2="440" y2="400" stroke="#00f0ff" stroke-width="2.5" filter="url(#glow)"/>
            <!-- Lignes horizontales à espacement logarithmique -->
            <line x1="0" y1="225" x2="400" y2="225" stroke="#a855f7" stroke-width="1.5"/>
            <line x1="0" y1="235" x2="400" y2="235" stroke="#a855f7" stroke-width="1.5"/>
            <line x1="0" y1="250" x2="400" y2="250" stroke="#a855f7" stroke-width="1.8"/>
            <line x1="0" y1="275" x2="400" y2="275" stroke="#a855f7" stroke-width="2"/>
            <line x1="0" y1="315" x2="400" y2="315" stroke="#a855f7" stroke-width="2.5"/>
            <line x1="0" y1="370" x2="400" y2="370" stroke="#a855f7" stroke-width="3"/>
        """
    },

    # --- VINTAGE & OBJETS AUDIO ---
    "vintage_cassette.svg": {
        "title": "Cassette Audio C60",
        "category": "vintage",
        "bg_start": "#16161a", "bg_end": "#27272a", "accent": "#f59e0b", "accent2": "#ef4444",
        "svg_content": """
            <!-- Cassette audio compacte vintage -->
            <rect x="70" y="110" width="260" height="170" rx="14" fill="#18181b" stroke="#52525b" stroke-width="4"/>
            <!-- Étiquette rétro avec dégradé -->
            <rect x="90" y="125" width="220" height="105" rx="8" fill="#fef08a" stroke="#d97706" stroke-width="2"/>
            <rect x="90" y="125" width="220" height="30" fill="#ea580c"/>
            <text x="105" y="145" font-family="'JetBrains Mono', monospace" font-size="12" font-weight="800" fill="#fff">SIDE A • C-60</text>
            <!-- Fenêtre transparente et deux bobines -->
            <rect x="125" y="165" width="150" height="50" rx="6" fill="#18181b" stroke="#a1a1aa" stroke-width="2"/>
            <!-- Deux trous d'engrenage -->
            <circle cx="155" cy="190" r="14" fill="#ffffff" stroke="#71717a" stroke-width="3"/>
            <circle cx="245" cy="190" r="14" fill="#ffffff" stroke="#71717a" stroke-width="3"/>
            <!-- Bande magnétique entre les deux -->
            <rect x="169" y="185" width="62" height="10" fill="#78350f"/>
            <!-- Trapèze inférieur -->
            <polygon points="120,280 280,280 260,250 140,250" fill="#09090b" stroke="#3f3f46" stroke-width="2"/>
            <circle cx="160" cy="265" r="4" fill="#52525b"/>
            <circle cx="240" cy="265" r="4" fill="#52525b"/>
        """
    },
    "vintage_vinyl.svg": {
        "title": "Disque Vinyle 33 Tours",
        "category": "vintage",
        "bg_start": "#0a0a0a", "bg_end": "#171717", "accent": "#ff2a4b", "accent2": "#a1a1aa",
        "svg_content": """
            <!-- Disque vinyle avec sillons brillants et macaron central -->
            <circle cx="200" cy="200" r="130" fill="#121212" stroke="#262626" stroke-width="4"/>
            <!-- Sillons concentriques -->
            <circle cx="200" cy="200" r="115" fill="none" stroke="#222222" stroke-width="1.5"/>
            <circle cx="200" cy="200" r="100" fill="none" stroke="#2a2a2a" stroke-width="1.5"/>
            <circle cx="200" cy="200" r="85" fill="none" stroke="#222222" stroke-width="1.5"/>
            <circle cx="200" cy="200" r="70" fill="none" stroke="#2a2a2a" stroke-width="1.5"/>
            <!-- Reflet brillant vinyle en cône -->
            <path d="M200 200 L110 90 A130 130 0 0 1 200 70 Z" fill="rgba(255,255,255,0.06)"/>
            <path d="M200 200 L290 310 A130 130 0 0 1 200 330 Z" fill="rgba(255,255,255,0.06)"/>
            <!-- Macaron rouge central -->
            <circle cx="200" cy="200" r="45" fill="#dc2626" stroke="#f87171" stroke-width="3" filter="url(#glow)"/>
            <text x="200" y="195" font-family="'Outfit', sans-serif" font-weight="900" font-size="12" fill="#fff" text-anchor="middle" letter-spacing="1">33 RPM</text>
            <text x="200" y="212" font-family="'Outfit', sans-serif" font-weight="600" font-size="8" fill="#fecaca" text-anchor="middle">STEREO</text>
            <!-- Trou de broche centrale -->
            <circle cx="200" cy="200" r="7" fill="#000000"/>
        """
    },
    "vintage_boombox.svg": {
        "title": "Ghetto-Blaster 80s",
        "category": "vintage",
        "bg_start": "#0f172a", "bg_end": "#1e293b", "accent": "#06b6d4", "accent2": "#f43f5e",
        "svg_content": """
            <!-- Boombox stéréo avec deux gros haut-parleurs -->
            <!-- Poignée supérieure -->
            <path d="M130 120 L130 85 L270 85 L270 120" fill="none" stroke="#64748b" stroke-width="10" stroke-linecap="round"/>
            <!-- Corps du poste -->
            <rect x="60" y="120" width="280" height="170" rx="14" fill="#0f172a" stroke="#06b6d4" stroke-width="4" filter="url(#glow)"/>
            <!-- Haut-parleur gauche -->
            <circle cx="125" cy="210" r="42" fill="#020617" stroke="#f43f5e" stroke-width="3" filter="url(#glow)"/>
            <circle cx="125" cy="210" r="22" fill="#1e293b" stroke="#f43f5e" stroke-width="2"/>
            <circle cx="125" cy="210" r="8" fill="#f43f5e"/>
            <!-- Haut-parleur droit -->
            <circle cx="275" cy="210" r="42" fill="#020617" stroke="#f43f5e" stroke-width="3" filter="url(#glow)"/>
            <circle cx="275" cy="210" r="22" fill="#1e293b" stroke="#f43f5e" stroke-width="2"/>
            <circle cx="275" cy="210" r="8" fill="#f43f5e"/>
            <!-- Compartiment cassette central -->
            <rect x="175" y="180" width="50" height="60" rx="4" fill="#1e293b" stroke="#06b6d4" stroke-width="2"/>
            <!-- VU-mètre / diodes LED -->
            <rect x="175" y="145" width="8" height="15" fill="#10b981"/>
            <rect x="187" y="145" width="8" height="15" fill="#10b981"/>
            <rect x="199" y="145" width="8" height="15" fill="#eab308"/>
            <rect x="211" y="145" width="8" height="15" fill="#ef4444"/>
        """
    },

    # --- CHILL & AMBIANCE ---
    "ambient_galaxy.svg": {
        "title": "Nébuleuse Galaxie",
        "category": "chill",
        "bg_start": "#070214", "bg_end": "#1d083d", "accent": "#8b5cf6", "accent2": "#ec4899",
        "svg_content": """
            <!-- Nébuleuse étoilée cosmique et ondes de relaxation -->
            <ellipse cx="200" cy="200" rx="130" ry="60" fill="url(#grad_accent)" opacity="0.45" transform="rotate(-25 200 200)" filter="url(#glow)"/>
            <ellipse cx="200" cy="200" rx="90" ry="35" fill="#ec4899" opacity="0.3" transform="rotate(35 200 200)" filter="url(#glow)"/>
            <!-- Cœur stellaire lumineux -->
            <circle cx="200" cy="200" r="16" fill="#ffffff" filter="url(#glow)"/>
            <!-- Étoiles scintillantes -->
            <circle cx="90" cy="110" r="3" fill="#ffffff" filter="url(#glow)"/>
            <circle cx="310" cy="130" r="2.5" fill="#ffffff" filter="url(#glow)"/>
            <circle cx="120" cy="290" r="2.5" fill="#ffffff"/>
            <circle cx="290" cy="270" r="3" fill="#ffffff"/>
            <text x="200" y="345" font-family="'Outfit', sans-serif" font-weight="700" font-size="14" fill="#c4b5fd" text-anchor="middle" letter-spacing="4">DEEP SPACE • CHILL</text>
        """
    }
}

TEMPLATE = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
    <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="{bg_start}" />
            <stop offset="100%" stop-color="{bg_end}" />
        </linearGradient>
        <linearGradient id="grad_accent" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="{accent}" />
            <stop offset="100%" stop-color="{accent2}" />
        </linearGradient>
        <linearGradient id="sun_grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#ffdd00" />
            <stop offset="60%" stop-color="#ff2a5f" />
            <stop offset="100%" stop-color="#7928ca" />
        </linearGradient>
        <linearGradient id="beam_grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#fde047" stop-opacity="0.8"/>
            <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="beam_cyan" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#00f0ff" stop-opacity="0.9"/>
            <stop offset="100%" stop-color="#00f0ff" stop-opacity="0"/>
        </linearGradient>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
    </defs>
    <!-- Fond -->
    <rect width="400" height="400" fill="url(#bg)" />
    <!-- Contenu Graphique -->
    {svg_content}
    <!-- Cadre subtil intérieur -->
    <rect x="2" y="2" width="396" height="396" rx="16" fill="none" stroke="{accent}" stroke-width="1.5" opacity="0.35" />
</svg>"""

total = 0
for filename, info in COVERS.items():
    svg_code = TEMPLATE.format(
        bg_start=info["bg_start"],
        bg_end=info["bg_end"],
        accent=info["accent"],
        accent2=info["accent2"],
        svg_content=info["svg_content"].strip()
    )
    filepath = DEST_DIR / filename
    filepath.write_text(svg_code, encoding="utf-8")
    total += 1
    print(f"  ✓ Généré: {filename} ({info['category']} - {info['title']})")

print(f"\nTotal: {total} pochettes thématiques vectorielles générées avec succès dans {DEST_DIR} !")

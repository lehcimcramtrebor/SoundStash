import re

with open('frontend/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

print("=== Modals and Overlays in index.html ===")
for m in re.finditer(r'<div[^>]+id="([^"]*)"[^>]*class="([^"]*)"[^>]*style="([^"]*)"', html):
    cid, cls, style = m.groups()
    if any(k in cid.lower() or k in cls.lower() for k in ['modal', 'drawer', 'toast', 'overlay', 'backdrop']):
        z_match = re.search(r'z-index:\s*(\d+)', style)
        z_val = z_match.group(1) if z_match else "none in inline style"
        print(f"ID: {cid:<30} | Class: {cls:<40} | z-index: {z_val}")

print("\n=== Elements with id containing modal/overlay without style attribute ===")
for m in re.finditer(r'<div[^>]+id="([^"]*(?:modal|overlay|drawer|toast)[^"]*)"[^>]*>', html):
    tag = m.group(0)
    if 'style=' not in tag:
        print(f"Tag: {tag}")

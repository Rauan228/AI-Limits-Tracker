"""Renders the app icon (same design as web/public/icon.svg) to PNG sizes for PWA, extension and Expo."""
import os, sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def render(size: int, rounded: bool = True) -> Image.Image:
    s = 4  # supersampling
    S = size * s
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = S / 512
    if rounded:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(116 * k), fill='#18181b')
    else:
        d.rectangle([0, 0, S, S], fill='#18181b')
    r, w = 150 * k, 44 * k
    box = [S / 2 - r, S / 2 - r, S / 2 + r, S / 2 + r]
    d.arc(box, 0, 360, fill='#3f3f46', width=int(w))
    d.arc(box, -90, 162, fill='#1f9d74', width=int(w))
    # round caps
    import math
    for ang in (-90, 162):
        a = math.radians(ang)
        cx, cy = S / 2 + (r - w / 2) * math.cos(a), S / 2 + (r - w / 2) * math.sin(a)
        d.ellipse([cx - w / 2, cy - w / 2, cx + w / 2, cy + w / 2], fill='#1f9d74')
    c = 46 * k
    d.ellipse([S / 2 - c, S / 2 - c, S / 2 + c, S / 2 + c], fill='#e2683c')
    return img.resize((size, size), Image.LANCZOS)

targets = {
    'web/public/icon-192.png': (192, True),
    'web/public/icon-512.png': (512, True),
    'extension/public/icons/16.png': (16, True),
    'extension/public/icons/32.png': (32, True),
    'extension/public/icons/48.png': (48, True),
    'extension/public/icons/128.png': (128, True),
    'landing/favicon.png': (64, True),
    'landing/apple-touch-icon.png': (180, False),
}
for rel, (size, rounded) in targets.items():
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    render(size, rounded).save(path)
    print('wrote', rel)

"""Generate the CamVerse app icon set.

Mark: a white "C" drawn as a camera-lens ring, open on the right, with a red
record dot inside, on a deep green rounded square (a nod to Bangladesh's
green field and red disc). Run from the repo root:

    python3 branding/camverse/make_icons.py
"""

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
SS = 4  # supersampling for smooth edges

GREEN_TOP = (10, 110, 78)
GREEN_BOTTOM = (4, 72, 52)
WHITE = (255, 255, 255)
RED = (244, 42, 65)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw_mark(size: int, mac: bool) -> Image.Image:
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    # macOS icons sit inside a margin; Windows/Linux icons fill the square.
    inset = round(s * 0.09) if mac else 0
    box = (inset, inset, s - inset, s - inset)
    w = box[2] - box[0]
    radius = round(w * 0.225)

    # Background: vertical green gradient clipped to a rounded square.
    grad = Image.new("RGBA", (s, s))
    gd = ImageDraw.Draw(grad)
    for y in range(s):
        t = min(1.0, max(0.0, (y - box[1]) / max(1, w)))
        gd.line([(0, y), (s, y)], fill=lerp(GREEN_TOP, GREEN_BOTTOM, t) + (255,))
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)
    if mac:
        shadow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle(
            (box[0], box[1] + round(s * 0.012), box[2], box[3] + round(s * 0.012)),
            radius=radius,
            fill=(0, 0, 0, 90),
        )
        img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(s * 0.012)))
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)
    cx = box[0] + w / 2
    cy = box[1] + w / 2

    # "C" lens ring, open on the right.
    ring_r = w * 0.30
    stroke = w * 0.105
    gap = 52  # degrees of opening, centred on 0deg (pointing right)
    bbox = (cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r)
    d.arc(bbox, start=gap / 2, end=360 - gap / 2, fill=WHITE, width=round(stroke))
    # Round the arc ends.
    for angle in (gap / 2, -gap / 2):
        a = math.radians(angle)
        mid_r = ring_r - stroke / 2
        ex, ey = cx + mid_r * math.cos(a), cy + mid_r * math.sin(a)
        r = stroke / 2
        d.ellipse((ex - r, ey - r, ex + r, ey + r), fill=WHITE)

    # Record dot, slightly left of centre like the flag's disc.
    dot_r = w * 0.115
    dx = cx - w * 0.015
    d.ellipse((dx - dot_r, cy - dot_r, dx + dot_r, cy + dot_r), fill=RED)

    return img.resize((size, size), Image.LANCZOS)


def main():
    png_dir = ROOT / "icons/icons/png"
    for size in (16, 24, 32, 48, 64, 128, 256, 512, 1024):
        draw_mark(size, mac=False).save(png_dir / f"{size}x{size}.png")

    big = draw_mark(1024, mac=False)
    big.save(
        ROOT / "icons/icons/win/icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    draw_mark(1024, mac=True).save(ROOT / "icons/icons/mac/icon.icns")

    app_icons = ROOT / "public/app-icons"
    for old in app_icons.glob("recordly*.png"):
        old.unlink()
    for size in (16, 32, 64, 128, 256, 512, 1024):
        draw_mark(size, mac=False).save(app_icons / f"camverse-{size}.png")
        draw_mark(size, mac=True).save(app_icons / f"camversemac-{size}.png")

    draw_mark(1024, mac=False).save(ROOT / "branding/camverse/camverse-1024.png")


if __name__ == "__main__":
    main()

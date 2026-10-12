"""Generate the CamVerse app icon set from the official logo.

Source: branding/camverse/camverse-logo.png (red square, white sound-wave
pills spelling "camverse"). Run from the repo root:

    python3 branding/camverse/make_icons.py

- 48 px and up: the full logo, re-centred, on a rounded red square.
- 32 px and below: the letters can't be read, so the pills are drawn solid
  white (same sound-wave silhouette, no text) to stay crisp in the taskbar.
- macOS variants sit inside the usual margin with a soft shadow.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
LOGO = ROOT / "branding/camverse/camverse-logo.png"
SMALL_MAX = 32


def load_logo() -> tuple[Image.Image, tuple[int, int, int]]:
    src = Image.open(LOGO).convert("RGB")
    red = src.getpixel((8, 8))
    # Bounding box of the white pills, so the mark can be centred and enlarged.
    px_src = src.load()
    w, h = src.size
    xs, ys = [], []
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            p = px_src[x, y]
            if min(p) > 200:
                xs.append(x)
                ys.append(y)
    left, right, top, bottom = min(xs), max(xs), min(ys), max(ys)
    cx, cy = (left + right) / 2, (top + bottom) / 2
    side = round((right - left) * 1.13)  # ~6.5% red margin left and right
    canvas = Image.new("RGB", (side, side), red)
    canvas.paste(src, (round(side / 2 - cx), round(side / 2 - cy)))
    return canvas, red


def solid_silhouette(logo: Image.Image, red) -> Image.Image:
    """Same logo with the red letters filled in white (pills only)."""
    img = logo.copy()
    marker = (0, 255, 0)
    ImageDraw.floodfill(img, (1, 1), marker, thresh=90)
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            px[x, y] = red if px[x, y] == marker else (255, 255, 255)
    return img


def compose(art: Image.Image, size: int, mac: bool) -> Image.Image:
    ss = 4
    s = size * ss
    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    inset = round(s * 0.09) if mac else 0
    box = (inset, inset, s - inset, s - inset)
    w = box[2] - box[0]
    radius = round(w * 0.225)
    if mac:
        shadow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        off = round(s * 0.012)
        ImageDraw.Draw(shadow).rounded_rectangle(
            (box[0], box[1] + off, box[2], box[3] + off), radius=radius, fill=(0, 0, 0, 90)
        )
        out.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(s * 0.012)))
    mask = Image.new("L", (w, w), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, w - 1), radius=radius, fill=255)
    out.paste(art.resize((w, w), Image.LANCZOS).convert("RGBA"), box[:2], mask)
    return out.resize((size, size), Image.LANCZOS)


def main():
    logo, red = load_logo()
    simple = solid_silhouette(logo, red)

    def icon(size: int, mac: bool = False) -> Image.Image:
        return compose(simple if size <= SMALL_MAX else logo, size, mac)

    png_dir = ROOT / "icons/icons/png"
    for size in (16, 24, 32, 48, 64, 128, 256, 512, 1024):
        icon(size).save(png_dir / f"{size}x{size}.png")

    # .ico: hand Pillow a frame per size so small frames use the simple mark.
    ico_sizes = (16, 24, 32, 48, 64, 128, 256)
    frames = [icon(s) for s in ico_sizes]
    frames[-1].save(
        ROOT / "icons/icons/win/icon.ico",
        sizes=[(s, s) for s in ico_sizes],
        append_images=frames[:-1],
    )
    icon(1024, mac=True).save(ROOT / "icons/icons/mac/icon.icns")

    app_icons = ROOT / "public/app-icons"
    for old in app_icons.glob("recordly*.png"):
        old.unlink()
    for size in (16, 32, 64, 128, 256, 512, 1024):
        icon(size).save(app_icons / f"camverse-{size}.png")
        icon(size, mac=True).save(app_icons / f"camversemac-{size}.png")

    icon(1024).save(ROOT / "branding/camverse/camverse-1024.png")


if __name__ == "__main__":
    main()

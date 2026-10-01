#!/usr/bin/env python3
"""Generate favicons, PWA icons, and the social preview card from the thermometer mark.

Run after editing apps/web/public/logo-thermometer.svg:

    python3 scripts/generate-brand-assets.py
"""

from __future__ import annotations

import io
from pathlib import Path

import cairosvg
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "apps/web/public"
SOURCE = PUBLIC / "logo-thermometer.svg"

# Mirrors the palette in apps/web/app/globals.css.
BG = (16, 21, 28, 255)  # --bg   #10151c
BG_RAISED = (27, 35, 46, 255)  # --card #1b232e
LINE = (44, 54, 68, 255)  # --line #2c3644
TEXT = (232, 238, 244, 255)  # --text #e8eef4
MUTED = (139, 155, 176, 255)  # --muted #8b9bb0
ACCENT = (224, 122, 61, 255)  # --accent #e07a3d
ACCENT_HI = (243, 160, 92, 255)  # --accent-hi #f3a05c

SANS_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def render_mark(size: int) -> Image.Image:
    """Rasterize the SVG mark at `size`x`size` with a transparent background."""
    png = cairosvg.svg2png(
        url=str(SOURCE), output_width=size, output_height=size, background_color=None
    )
    return Image.open(io.BytesIO(png)).convert("RGBA")


def vertical_gradient(size: tuple[int, int], top: tuple, bottom: tuple) -> Image.Image:
    """Single-column gradient stretched to `size` — cheap and smooth enough for flat art."""
    w, h = size
    strip = Image.new("RGBA", (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        strip.putpixel(
            (0, y),
            tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(4)),
        )
    return strip.resize(size, Image.Resampling.BILINEAR)


def icon_tile(size: int, mark_ratio: float = 0.62, radius_ratio: float = 0.22) -> Image.Image:
    """Mark centered on a rounded dark tile, so it keeps contrast on light and dark tabs."""
    tile = vertical_gradient((size, size), BG_RAISED, BG)

    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=int(size * radius_ratio), fill=255
    )
    tile.putalpha(mask)

    mark_box = max(1, int(size * mark_ratio))
    mark = render_mark(mark_box)
    # Nudge up slightly: the thermometer's visual mass sits in the bulb.
    offset = ((size - mark_box) // 2, (size - mark_box) // 2 - max(1, size // 64))
    tile.alpha_composite(mark, offset)
    return tile


def wrap(text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    lines: list[str] = []
    words = text.split()
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if font.getlength(candidate) <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def social_card() -> Image.Image:
    """1200x630 Open Graph / Twitter card."""
    w, h = 1200, 630
    card = vertical_gradient((w, h), (24, 32, 42, 255), BG).convert("RGBA")
    draw = ImageDraw.Draw(card)

    # Accent rule along the top edge.
    draw.rectangle((0, 0, w, 8), fill=ACCENT)

    title_font = ImageFont.truetype(SANS_BOLD, 76)
    sub_font = ImageFont.truetype(SANS, 32)
    host_font = ImageFont.truetype(SANS_BOLD, 30)

    # (text, font, color, extra gap below this line)
    rows: list[tuple[str, ImageFont.FreeTypeFont, tuple, int]] = [
        ("Temperature", title_font, TEXT, 0),
        ("monitor", title_font, ACCENT_HI, 34),
    ]
    sub_lines = wrap("Live probe readings, history, and out-of-range alerts.", sub_font, 560)
    for i, line in enumerate(sub_lines):
        rows.append((line, sub_font, MUTED, 20 if i == len(sub_lines) - 1 else 0))
    rows.append(("temperatura.live", host_font, ACCENT, 0))

    def line_height(font: ImageFont.FreeTypeFont) -> int:
        return round(font.size * 1.18)

    # Center mark + text as one group.
    mark_box = 300
    gap_x = 56
    text_w = max(font.getlength(text) for text, font, _, _ in rows)
    mark_x = round((w - (mark_box + gap_x + text_w)) / 2)
    text_x = mark_x + mark_box + gap_x

    # Measure rendered ink rather than trusting font metrics, so the stack is
    # optically centered instead of metric-centered.
    probe = Image.new("L", (w, h * 2), 0)
    probe_draw = ImageDraw.Draw(probe)
    y = 0
    for text, font, _, gap in rows:
        probe_draw.text((text_x, y), text, font=font, fill=255)
        y += line_height(font) + gap
    _, ink_top, _, ink_bottom = probe.getbbox()

    y = (h - (ink_bottom - ink_top)) // 2 - ink_top
    for text, font, color, gap in rows:
        draw.text((text_x, y), text, font=font, fill=color)
        y += line_height(font) + gap

    card.alpha_composite(render_mark(mark_box), (mark_x, (h - mark_box) // 2))
    return card


def main() -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)

    # Google wants a favicon that is a square multiple of 48px; ICO carries the small sizes.
    # Tab-sized renders need a tighter margin than app icons or the mark turns to mush.
    ico = icon_tile(256, mark_ratio=0.8, radius_ratio=0.16)
    ico.save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

    icon_tile(192).save(PUBLIC / "icon-192.png")
    icon_tile(512).save(PUBLIC / "icon-512.png")
    # Apple crops to a squircle itself, so render on an opaque square with no rounding.
    icon_tile(180, radius_ratio=0.0).save(PUBLIC / "apple-touch-icon.png")

    social_card().convert("RGB").save(PUBLIC / "og-image.png", optimize=True)

    for name in (
        "favicon.ico",
        "icon-192.png",
        "icon-512.png",
        "apple-touch-icon.png",
        "og-image.png",
    ):
        path = PUBLIC / name
        print(f"{path.relative_to(ROOT)}  {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()

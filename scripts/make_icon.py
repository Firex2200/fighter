"""Render an app icon as a 1024x1024 PNG — pure stdlib, no PIL.

Dark rounded square with a play triangle, or a stop square for the Stop
launcher. Adapted from the Sideline version with --accent/--bg so the game's
icons don't look identical to Sideline's in the Dock.

Usage: make_icon.py OUT.png [--glyph play|stop] [--accent RRGGBB] [--bg RRGGBB]
"""
import math
import struct
import sys
import zlib

S = 1024
BG_TOP = (18, 26, 40)
BG_BOT = (10, 14, 22)
GREEN = (39, 201, 63)
RED = (239, 68, 68)


def parse_hex(value):
    v = value.lstrip("#")
    return tuple(int(v[i : i + 2], 16) for i in (0, 2, 4))


def opt(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default

# play triangle, nudged right of center for optical balance
TRI_A = (402.0, 330.0)
TRI_B = (402.0, 694.0)
TRI_C = (716.0, 512.0)


def rounded_rect_sd(x, y, cx, cy, hw, hh, r):
    dx = abs(x - cx) - (hw - r)
    dy = abs(y - cy) - (hh - r)
    qx = max(dx, 0.0)
    qy = max(dy, 0.0)
    return math.hypot(qx, qy) + min(max(dx, dy), 0.0) - r


def in_triangle(px, py):
    d1 = (TRI_B[0] - TRI_A[0]) * (py - TRI_A[1]) - (TRI_B[1] - TRI_A[1]) * (px - TRI_A[0])
    d2 = (TRI_C[0] - TRI_B[0]) * (py - TRI_B[1]) - (TRI_C[1] - TRI_B[1]) * (px - TRI_B[0])
    d3 = (TRI_A[0] - TRI_C[0]) * (py - TRI_C[1]) - (TRI_A[1] - TRI_C[1]) * (px - TRI_C[0])
    has_neg = d1 < 0 or d2 < 0 or d3 < 0
    has_pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (has_neg and has_pos)


def clamp01(v):
    return 0.0 if v < 0 else (1.0 if v > 1 else v)


def main():
    global BG_TOP, BG_BOT

    out = sys.argv[1]
    glyph = opt("--glyph", "play")
    color = GREEN if glyph == "play" else RED

    accent_hex = opt("--accent")
    if accent_hex:
        color = parse_hex(accent_hex)

    bg_hex = opt("--bg")
    if bg_hex:
        BG_TOP = parse_hex(bg_hex)
        # Darken toward the bottom for the same subtle gradient as the original.
        BG_BOT = tuple(max(0, int(c * 0.55)) for c in BG_TOP)

    def glyph_hit(px, py):
        if glyph == "play":
            return in_triangle(px, py)
        return rounded_rect_sd(px, py, 512, 512, 160, 160, 36) <= 0

    def glyph_cov(x, y):
        hits = 0
        for sx in (-0.33, 0.0, 0.33):
            for sy in (-0.33, 0.0, 0.33):
                if glyph_hit(x + sx, y + sy):
                    hits += 1
        return hits / 9.0

    rows = []
    for y in range(S):
        t = y / (S - 1.0)
        bg = [BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t for i in range(3)]
        row = bytearray()
        for x in range(S):
            sd = rounded_rect_sd(x + 0.5, y + 0.5, 512, 512, 412, 412, 184)
            a = clamp01(0.5 - sd)
            if a <= 0.0:
                row += b"\x00\x00\x00\x00"
                continue
            cov = glyph_cov(x + 0.5, y + 0.5) if (340 <= x <= 740 and 300 <= y <= 720) else 0.0
            r = bg[0] + (color[0] - bg[0]) * cov
            g = bg[1] + (color[1] - bg[1]) * cov
            b = bg[2] + (color[2] - bg[2]) * cov
            row += bytes((int(r), int(g), int(b), int(a * 255)))
        rows.append(bytes(row))

    def chunk(tag, data):
        body = struct.pack(">I", len(data)) + tag + data
        return body + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + r for r in rows)
    with open(out, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", S, S, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


if __name__ == "__main__":
    main()

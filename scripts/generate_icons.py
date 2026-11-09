#!/usr/bin/env python3
"""Generate crisp PNG icons for TabPilot extension."""

import struct
import zlib
from pathlib import Path


def write_png(filename: Path, width: int, height: int, rgba_bytes: bytes):
    def chunk(chunk_type: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)

    header = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))

    raw_data = bytearray()
    row_bytes = width * 4
    for y in range(height):
        raw_data.append(0)  # filter type 0
        raw_data.extend(rgba_bytes[y * row_bytes : (y + 1) * row_bytes])

    idat = chunk(b"IDAT", zlib.compress(bytes(raw_data), 9))
    iend = chunk(b"IEND", b"")

    with open(filename, "wb") as f:
        f.write(header + ihdr + idat + iend)


def draw_icon(size: int) -> bytes:
    buf = bytearray(size * size * 4)
    center = (size - 1) / 2.0
    radius = size * 0.46
    inner_rad = size * 0.30
    center_dot = size * 0.12
    corner_rad = size * 0.22

    for y in range(size):
        for x in range(size):
            dx = abs(x - center)
            dy = abs(y - center)
            dist = (dx * dx + dy * dy) ** 0.5

            # Background rounded rect
            max_d = max(dx, dy)
            in_rect = False
            # Check rounded box
            box_limit = size * 0.46
            box_corner = box_limit - corner_rad
            if dx <= box_corner and dy <= box_limit:
                in_rect = True
            elif dy <= box_corner and dx <= box_limit:
                in_rect = True
            else:
                corner_d = ((dx - box_corner) ** 2 + (dy - box_corner) ** 2) ** 0.5
                if corner_d <= corner_rad:
                    in_rect = True

            idx = (y * size + x) * 4
            if not in_rect:
                buf[idx : idx + 4] = b"\x00\x00\x00\x00"
                continue

            # Base gradient: Indigo/Navy #1e1e38 to #0f172a
            ratio = y / float(size)
            r = int(24 + 10 * (1 - ratio))
            g = int(30 + 15 * (1 - ratio))
            b = int(58 + 25 * (1 - ratio))

            # Pilot crosshair ring: Cyan #06b6d4 / #38bdf8
            ring_thickness = max(1.0, size * 0.07)
            if abs(dist - inner_rad) < ring_thickness:
                r, g, b = 56, 189, 248  # #38bdf8
            elif dist <= center_dot:
                r, g, b = 34, 197, 94   # #22c55e (Green active pilot dot)
            # Crosshair ticks (top, bottom, left, right)
            cross_thickness = max(1.0, size * 0.05)
            tick_start = inner_rad - size * 0.05
            tick_end = inner_rad + size * 0.14
            if (dx < cross_thickness and tick_start <= dy <= tick_end) or \
               (dy < cross_thickness and tick_start <= dx <= tick_end):
                r, g, b = 125, 211, 252  # Light cyan

            buf[idx] = r
            buf[idx + 1] = g
            buf[idx + 2] = b
            buf[idx + 3] = 255  # Fully opaque

    return bytes(buf)


def main():
    icons_dir = Path("tab-pilot/icons")
    icons_dir.mkdir(parents=True, exist_ok=True)
    for s in (16, 32, 48, 128):
        data = draw_icon(s)
        p = icons_dir / f"icon{s}.png"
        write_png(p, s, s, data)
        print(f"Generated {p} ({s}x{s})")


if __name__ == "__main__":
    main()

"""Check the packed archive holds the four paths the game actually looks up.

A perfectly valid VPK can mount and change nothing: retail Panorama loads the
compiled `.vxml_c`/`.vjs_c`/`.vcss_c` assets, so an archive with only `.xml`,
`.js` and `.css` paths renders no strip at all. This walks the real tree instead
of searching the bytes for file names, and requires both the compiled assets and
the raw sources.

usage:
  python tools/verify_vpk.py [dist/soul_lens/pak01_dir.vpk]
"""

from __future__ import annotations

import pathlib
import struct
import sys

MAGIC = 0x55AA1234
EXPECTED = (
    "panorama/layout/tooltips/citadel_tooltip_mod_details.vxml_c",
    "panorama/scripts/soul_lens.vjs_c",
    "panorama/scripts/soul_lens_data.vjs_c",
    "panorama/styles/soul_lens.vcss_c",
    "panorama/scripts/soul_lens.js",
    "panorama/scripts/soul_lens_data.js",
    "panorama/styles/soul_lens.css",
)


def _cstring(data: bytes, at: int) -> tuple[str, int]:
    end = data.index(b"\0", at)
    return data[at:end].decode("utf-8", "replace"), end + 1


def paths(data: bytes) -> list[str]:
    """Every file path in a VPK v1 tree."""
    magic, version, tree_size = struct.unpack("<III", data[:12])
    if magic != MAGIC or version not in (1, 2) or tree_size <= 0:
        raise ValueError(f"header is {hex(magic)} v{version} tree={tree_size}")
    header = 12 if version == 1 else 28
    if version == 2 and len(data) < header:
        raise ValueError("v2 header is truncated")
    at = header
    end = header + tree_size
    out: list[str] = []
    while at < end:
        ext, at = _cstring(data, at)
        if not ext:
            break
        while True:
            directory, at = _cstring(data, at)
            if not directory:
                break
            while True:
                name, at = _cstring(data, at)
                if not name:
                    break
                at += 18  # crc, preload, archive, offset, length, terminator
                full = f"{directory}/{name}.{ext}" if directory else f"{name}.{ext}"
                out.append(full.lstrip("/"))
    return out


def main() -> int:
    path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "dist/soul_lens/pak01_dir.vpk")
    if not path.exists():
        print(f"REFUSED: {path} does not exist", file=sys.stderr)
        return 1
    data = path.read_bytes()
    try:
        found = paths(data)
    except (ValueError, struct.error) as error:
        print(f"REFUSED: {error}", file=sys.stderr)
        return 1
    missing = [name for name in EXPECTED if name not in found]
    if missing:
        print(f"REFUSED: {path} does not carry: {', '.join(missing)}", file=sys.stderr)
        print(f"REFUSED: stored paths were {found}", file=sys.stderr)
        return 1
    magic, version, _ = struct.unpack("<III", data[:12])
    print(f"{path}: {len(data)} bytes, v{version}, {len(found)} file(s), every required path mounted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Check the packed archive is the four files the mod needs.

The packer writes a VPK v1 with inline data; this reads the header and confirms the
four paths are in the tree, so a release asset is checked after packing instead of
being assumed good because pack_vpk.py exited zero.

usage:
  python tools/verify_vpk.py [dist/soul_lens/pak01_dir.vpk]
"""

from __future__ import annotations

import pathlib
import struct
import sys

MAGIC = 0x55AA1234
EXPECTED = (b"citadel_tooltip_mod_hover", b"soul_lens.js", b"soul_lens_data.js", b"soul_lens.css")


def main() -> int:
    path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "dist/soul_lens/pak01_dir.vpk")
    if not path.exists():
        print(f"REFUSED: {path} does not exist", file=sys.stderr)
        return 1
    data = path.read_bytes()
    if len(data) < 12:
        print(f"REFUSED: {path} is shorter than a VPK header", file=sys.stderr)
        return 1
    magic, version, tree = struct.unpack("<III", data[:12])
    if magic != MAGIC or version != 1 or tree <= 0:
        print(f"REFUSED: header is {hex(magic)} v{version} tree={tree}", file=sys.stderr)
        return 1
    missing = [name.decode() for name in EXPECTED if name not in data]
    if missing:
        print(f"REFUSED: missing from the archive: {', '.join(missing)}", file=sys.stderr)
        return 1
    print(f"{path}: {len(data)} bytes, v{version}, four files present")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

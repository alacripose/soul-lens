"""Compile Soul Lens with the CSDK resource compiler and pack it with Source2Viewer.

Retail Panorama loads compiled assets (`.vxml_c`, `.vjs_c`, `.vcss_c`); a plain
`.xml`/`.js`/`.css` override mounts and renders nothing, which is what the first
in-game attempt shipped. The hand-rolled VPK writer is gone: Source2Viewer CLI
writes the archive, the same tool the family uses for every other addon.

usage:
  python tools/build_addon.py
  python tools/build_addon.py --csdk C:/path/to/Reduced_CSDK_13 --s2v C:/path/to/Source2Viewer-CLI.exe
  python tools/build_addon.py --out dist/soul_lens/pak01_dir.vpk

Environment fallbacks: CSDK13, SOURCE2VIEWER_CLI.
"""

from __future__ import annotations

import argparse
import os
import pathlib
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent.parent
CONTENT = pathlib.Path("panorama")
SOURCES = (
    "layout/tooltips/citadel_tooltip_mod_details.xml",
    "scripts/soul_lens_build.js",
    "scripts/soul_lens.js",
    "scripts/soul_lens_data.js",
    "styles/soul_lens.css",
)
# Only scripts and styles ride along raw: a raw `.xml` beside the compiled
# `.vxml_c` lets the loader pick the uncompiled layout, which renders nothing.
RAW_SUFFIXES = (".js", ".css")


def build(csdk: pathlib.Path, s2v: pathlib.Path, out: pathlib.Path) -> int:
    compiler = csdk / "game/bin/win64/resourcecompiler.exe"
    if not compiler.exists():
        print(f"REFUSED: {compiler} is missing", file=sys.stderr)
        return 1
    if not s2v.exists():
        print(f"REFUSED: {s2v} is missing (Source2Viewer CLI)", file=sys.stderr)
        return 1

    content = csdk / "content/citadel_addons/soul_lens" / CONTENT
    compiled = csdk / "game/citadel_addons/soul_lens" / CONTENT
    inputs = []
    for rel in SOURCES:
        src = HERE / CONTENT / rel
        if not src.exists():
            print(f"REFUSED: {src} is missing", file=sys.stderr)
            return 1
        dst = content / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        inputs.append(str(dst))

    command = [str(compiler), "-f", "-i", *inputs,
               "-game", str(csdk / "game/citadel") + "/", "-nop4"]
    print("compile:", " ".join(command[:3]), f"... {len(inputs)} inputs")
    result = subprocess.run(command, capture_output=True, text=True, cwd=csdk)
    tail = [line for line in result.stdout.splitlines() if "ERROR" in line or "OK:" in line]
    for line in tail[-3:]:
        print(" ", line.strip())
    if result.returncode != 0 or "0 failed" not in result.stdout:
        print(result.stdout[-2000:], file=sys.stderr)
        return 1

    stage = HERE / "dist/stage"
    if stage.exists():
        shutil.rmtree(stage)
    (stage / "panorama").mkdir(parents=True)
    count = 0
    for path in compiled.rglob("*"):
        if path.suffix in (".vxml_c", ".vjs_c", ".vcss_c", ".vtex_c"):
            target = stage / CONTENT / path.relative_to(compiled)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
            count += 1

    # The raw sources ride along beside the compiled ones so a build survives a
    # loader that resolves the include path as written rather than through the
    # compiled name; the compiled asset wins when both are present.
    for rel in SOURCES:
        if pathlib.Path(rel).suffix in RAW_SUFFIXES:
            target = stage / CONTENT / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(HERE / CONTENT / rel, target)
            count += 1

    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()
    pack = subprocess.run([str(s2v), "-i", str(stage), "--vpk_create", str(out)],
                          capture_output=True, text=True)
    if pack.returncode != 0 or not out.exists():
        print(pack.stdout[-1500:], pack.stderr[-1500:], file=sys.stderr)
        return 1
    print(f"packed {count} file(s) into {out} ({out.stat().st_size} bytes) with {s2v.name}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csdk", default=os.environ.get("CSDK13", "C:/Users/ala/Downloads/Reduced_CSDK_13"))
    parser.add_argument("--s2v", default=os.environ.get(
        "SOURCE2VIEWER_CLI", "C:/Users/ala/Downloads/cli-windows-x64/Source2Viewer-CLI.exe"))
    parser.add_argument("--out", default="dist/soul_lens/pak01_dir.vpk")
    args = parser.parse_args()
    return build(pathlib.Path(args.csdk), pathlib.Path(args.s2v), HERE / args.out)


if __name__ == "__main__":
    raise SystemExit(main())

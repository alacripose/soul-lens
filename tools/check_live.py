"""Refuse to ship an override that no longer matches the live details layout.

The mod replaces one of the game's own files, `panorama/layout/tooltips/
citadel_tooltip_mod_details.xml` (the card the shop's click-through/hover popup
draws; the hover layout is a separate, narrower card). That is only safe while the copy under
`panorama/layout/tooltips/` is the current file from the installed build plus the
Soul Lens additions. When Valve edits the layout, a stale copy would quietly
replace the stock tooltip with an older one, so this command compares the two and
exits 1 with the paths that differ.

usage:
  python tools/check_live.py                 # check against the installed build
  python tools/check_live.py --write-report  # also record data/live-layout.json
  python tools/check_live.py --base FILE     # check a saved live copy instead of S2V

The comparison ignores the additions by comparing the *body* of the file: the
`<scripts>` element, the soul_lens stylesheet include and the #SoulLens panel are
removed from the mod copy, and the rest must equal the live file's body.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import sys

LAYOUT = "panorama/layout/tooltips/citadel_tooltip_mod_details.xml"
VPK = pathlib.Path("D:/SteamLibrary/steamapps/common/Deadlock/game/citadel/pak01_dir.vpk")
STEAM_INF = pathlib.Path("D:/SteamLibrary/steamapps/common/Deadlock/game/citadel/steam.inf")
S2V = pathlib.Path("C:/Users/ala/Downloads/cli-windows-x64/Source2Viewer-CLI.exe")
MOD = pathlib.Path("panorama/layout/tooltips/citadel_tooltip_mod_details.xml")

# The additions are removed wholly, indentation and line ending included: a CRLF file (which
# Windows writes) and an LF one must strip to the same body, and the line after the block must
# not keep four orphaned tabs of the block's indentation.
SCRIPTS_BLOCK = re.compile(r"\r?\n\t<scripts>.*?</scripts>", re.S)
SOUL_CSS = re.compile(r"\r?\n\t\t<include src=\"file://\{resources\}/styles/soul_lens\.css\" />")
SOUL_BLOCK = re.compile(r"[ \t]*<!-- soul-lens:begin.*?soul-lens:end -->[^\r\n]*\r?\n", re.S)


def strip_additions(text: str) -> str:
    text = SCRIPTS_BLOCK.sub("", text)
    text = SOUL_CSS.sub("", text)
    text = SOUL_BLOCK.sub("", text)
    return text


COMMENT = re.compile(r"<!--.*?-->", re.S)


def body_digest(text: str) -> str:
    """Digest the layout's own lines: comments and blank lines dropped."""
    lines = []
    for line in COMMENT.sub("", text).splitlines():
        line = line.rstrip()
        if line.strip():
            lines.append(line)
    return hashlib.blake2b("\n".join(lines).encode("utf-8"), digest_size=16).hexdigest()


def live_text(base: pathlib.Path | None) -> tuple[str, dict]:
    info = {"vpk": "game/citadel/pak01_dir.vpk", "layout": LAYOUT, "s2v": S2V.name}
    if base is not None:
        info["source"] = f"saved copy {base}"
        return base.read_text(encoding="utf-8", errors="replace"), info
    if not VPK.exists():
        raise SystemExit(f"REFUSED: {VPK} is not the installed build")
    if not S2V.exists():
        raise SystemExit(f"REFUSED: {S2V} is missing; pass --base with a saved live copy")
    work = pathlib.Path("data/live")
    work.mkdir(parents=True, exist_ok=True)
    target = work / LAYOUT
    if target.exists():
        target.unlink()
    result = subprocess.run(
        [str(S2V), "-i", str(VPK), "-f", LAYOUT.replace(".xml", ".vxml_c"),
         "-o", str(work), "-d", "-q"],
        capture_output=True, text=True,
    )
    if result.returncode != 0 or not target.exists():
        raise SystemExit(f"REFUSED: S2V did not write {target}: {result.stderr.strip()}")
    info["source"] = "installed build through S2V"
    return target.read_text(encoding="utf-8", errors="replace"), info


def build() -> str:
    if not STEAM_INF.exists():
        return "unknown"
    for line in STEAM_INF.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.startswith("ClientVersion"):
            return line.partition("=")[2].strip()
    return "unknown"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="")
    parser.add_argument("--write-report", action="store_true")
    args = parser.parse_args()

    live, info = live_text(pathlib.Path(args.base) if args.base else None)
    mod = MOD.read_text(encoding="utf-8")
    stripped = strip_additions(mod)
    live_body = body_digest(live)
    mod_body = body_digest(stripped)

    report = {
        "schema": "soul-lens.live-layout/1",
        "layout": LAYOUT,
        "build": build(),
        **info,
        "live_digest": live_body,
        "mod_body_digest": mod_body,
        "same": live_body == mod_body,
    }
    if args.write_report:
        out = pathlib.Path("data/live-layout.json")
        out.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")

    if live_body != mod_body:
        print(f"REFUSED drift: {LAYOUT} differs from the installed build ({build()})")
        live_lines = [l.strip() for l in COMMENT.sub("", live).splitlines() if l.strip()]
        mod_lines = [l.strip() for l in COMMENT.sub("", stripped).splitlines() if l.strip()]
        for index, (a, b) in enumerate(zip(live_lines, mod_lines)):
            if a.strip() != b.strip():
                print(f"  first difference at line {index + 1}:")
                print(f"    live: {a.strip()}")
                print(f"    mod : {b.strip()}")
                break
        else:
            print(f"  line count: live {len(live_lines)} mod {len(mod_lines)}")
        return 1

    print(f"details layout matches the installed build ({build()}): {mod_body}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

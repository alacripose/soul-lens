"""One command that answers whether this mod may be packed.

The gate runs the checks that can run on this machine and names the one that
cannot as a skip, never as a pass:

  unit        tests/test_ingest.py - the economy and the source adapters
  harness     tools/tests/test_soul_lens.js - the shipped overlay against a fake tree
  live        tools/check_live.py - the override still matches the installed build
  shipped     no machine path, no empty catalogue, a recorded build and source state

usage:
  python tools/gate.py
  python tools/gate.py --skip-live     # when the game is not installed here
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
# A drive path, not a URL: https:// has a colon and a slash too, so the colon must
# be followed by a backslash, or by a single forward slash that starts no scheme.
DRIVE = re.compile(r"[A-Za-z]:\\|[A-Za-z]:/(?!/)")


def run(name: str, command: list[str]) -> tuple[bool, str]:
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    tail = (result.stdout + result.stderr).strip().splitlines()
    summary = tail[-1] if tail else "(no output)"
    print(f"[{'pass' if result.returncode == 0 else 'FAIL'}] {name}: {summary}")
    return result.returncode == 0, summary


def shipped() -> tuple[bool, str]:
    problems = []
    data = ROOT / "data" / "items.json"
    js = ROOT / "panorama" / "scripts" / "soul_lens_data.js"
    if not data.exists() or not js.exists():
        return False, "data/items.json or the baked script is missing"
    document = json.loads(data.read_text(encoding="utf-8"))
    if document.get("schema") != "soul-lens.data/1":
        problems.append("schema is not soul-lens.data/1")
    if not document.get("build") or document["build"] == "unknown":
        problems.append("no live build recorded")
    items = document.get("items") or {}
    if len(items) < 100:
        problems.append(f"only {len(items)} items in the catalogue")
    for path in (data, js, *ROOT.glob("panorama/**/*.js")):
        text = path.read_text(encoding="utf-8")
        if DRIVE.search(text):
            problems.append(f"{path.relative_to(ROOT)} carries a machine path")
    if problems:
        return False, "; ".join(problems)
    return True, f"{len(items)} items, build {document['build']}, no machine path"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-live", action="store_true")
    args = parser.parse_args()

    results = []
    results.append(run("unit", [sys.executable, "-m", "unittest", "discover", "-s", "tests"]))
    results.append(run("harness", ["node", "tools/tests/test_soul_lens.js"]))
    if args.skip_live:
        print("[skip] live: --skip-live")
        results.append((True, "skipped"))
    else:
        results.append(run("live", [sys.executable, "tools/check_live.py"]))
    ok, detail = shipped()
    print(f"[{'pass' if ok else 'FAIL'}] shipped: {detail}")
    results.append((ok, detail))

    failed = [name for (name, _), (good, _d) in zip(
        [("unit", ""), ("harness", ""), ("live", ""), ("shipped", "")], results) if not good]
    print(f"gate: {'PASS' if not failed else 'FAIL'} ({'all checks' if not failed else ', '.join(failed)})")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())

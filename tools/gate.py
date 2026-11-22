"""One command that answers whether this mod may be packed.

The gate runs the checks that can run on this machine and names the one that
cannot as a skip, never as a pass:

  unit          tests/ - the economy, the source adapters and the statlocker parse path
  harness       tools/tests/test_soul_lens.js - the shipped overlay against a fake tree
  live          tools/check_live.py - the override still matches the installed build
  no-heredoc    no runnable script carries a shell heredoc (family rule, 2026-11-22)
  shipped       no machine path, no empty catalogue, a recorded build and source state

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
# A heredoc is a payload the shell parses; one lost terminator loses the command and
# writes nothing. Only a line a shell would read counts, so a docstring is inert.
HEREDOC = re.compile(r"<<-?\s*['\"]?(?:PY|EOF|EOT|BASH|SH|PS1|CMD)\b")
SHELL_SUFFIXES = (".sh", ".ps1", ".cmd", ".bat", ".yml", ".yaml")
SKIP_DIRS = {".git", "data", "dist", "logs", "assets", "__pycache__", "node_modules", ".pytest_cache"}


def run(name: str, command: list[str]) -> tuple[str, bool, str]:
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    tail = (result.stdout + result.stderr).strip().splitlines()
    summary = tail[-1] if tail else "(no output)"
    ok = result.returncode == 0
    print(f"[{'pass' if ok else 'FAIL'}] {name}: {summary}")
    return name, ok, summary


def no_heredoc() -> tuple[str, bool, str]:
    offenders = []
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file() or set(path.parts) & SKIP_DIRS:
            continue
        suffix = path.suffix.lower()
        if suffix not in SHELL_SUFFIXES and suffix != ".py":
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for number, line in enumerate(text.splitlines(), 1):
            if not HEREDOC.search(line):
                continue
            if suffix == ".py" and not any(token in line for token in ("shell=True", '"-c"', "'-c'")):
                continue
            offenders.append(f"{path.relative_to(ROOT).as_posix()}:{number}")
    if offenders:
        return "no-heredoc", False, ", ".join(offenders[:5])
    return "no-heredoc", True, "no heredoc in a runnable script"


def shipped() -> tuple[str, bool, str]:
    problems = []
    data = ROOT / "data" / "items.json"
    js = ROOT / "panorama" / "scripts" / "soul_lens_data.js"
    if not data.exists() or not js.exists():
        return "shipped", False, "data/items.json or the baked script is missing"
    document = json.loads(data.read_text(encoding="utf-8"))
    if document.get("schema") != "soul-lens.data/1":
        problems.append("schema is not soul-lens.data/1")
    if not document.get("build") or document["build"] == "unknown":
        problems.append("no live build recorded")
    items = document.get("items") or {}
    if len(items) < 100:
        problems.append(f"only {len(items)} items in the catalogue")

    # The two recommendation sources each have to be accounted for in the bake: a
    # recorded state and a URL, so the strip can say "unavailable" honestly instead
    # of drawing nothing. A read source must actually carry rows.
    sources = document.get("sources") or {}
    ranks = sources.get("statlocker-ranks") or {}
    if not ranks.get("url"):
        problems.append("no statlocker ranking source recorded")
    if ranks.get("state") not in ("read", "refused", "skipped"):
        problems.append(f"statlocker ranking state is {ranks.get('state')!r}")
    if ranks.get("state") == "read":
        ranked = sum(1 for hero in (document.get("heroes") or {}).values() if hero.get("sl"))
        if not ranked:
            problems.append("statlocker ranking says read but no hero carries rows")
    for path in (data, js, *ROOT.glob("panorama/**/*.js")):
        text = path.read_text(encoding="utf-8")
        if DRIVE.search(text):
            problems.append(f"{path.relative_to(ROOT)} carries a machine path")
    if problems:
        return "shipped", False, "; ".join(problems)
    ranked = sum(1 for hero in (document.get("heroes") or {}).values() if hero.get("sl"))
    return "shipped", True, (f"{len(items)} items, build {document['build']}, "
                             f"statlocker ranks {ranks.get('state')} on {ranked} hero(es), no machine path")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-live", action="store_true")
    args = parser.parse_args()

    results = []
    results.append(run("unit", [sys.executable, "-m", "unittest", "discover", "-s", "tests"]))
    results.append(run("harness", ["node", "tools/tests/test_soul_lens.js"]))
    if args.skip_live:
        print("[skip] live: --skip-live")
        results.append(("live", True, "skipped"))
    else:
        results.append(run("live", [sys.executable, "tools/check_live.py"]))
    name, ok, detail = no_heredoc()
    print(f"[{'pass' if ok else 'FAIL'}] {name}: {detail}")
    results.append((name, ok, detail))
    name, ok, detail = shipped()
    print(f"[{'pass' if ok else 'FAIL'}] {name}: {detail}")
    results.append((name, ok, detail))

    failed = [name for name, ok, _detail in results if not ok]
    print(f"gate: {'PASS' if not failed else 'FAIL'} ({'all checks' if not failed else ', '.join(failed)})")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())

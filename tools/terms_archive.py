"""Per-build item terms, snapshotted the way the forge VPK tracker snapshots builds.

The forge's `tools/vpk_tracker.py` keeps one immutable snapshot per build under an
artifact directory, binds each snapshot with a digest, and writes an `index.json`
so a build is looked up rather than guessed. This is the same contract for the one
thing in Soul Lens that a patch can silently stale: the item's weapon terms
(`wp`, `fire`, `dps`) and its cost/tier.

A behavioural number (WPA, purchase time) is measured from matches and moves every
day; it is not a build snapshot and does not live here. The terms are.

usage:
  python tools/terms_archive.py --status 6864
  python tools/terms_archive.py --list
  python tools/terms_archive.py --verify
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import pathlib
import sys

SCHEMA = "soul-lens.terms/1"
INDEX_SCHEMA = "soul-lens.builds/1"
ARCHIVE = pathlib.Path("data/builds")

TERM_FIELDS = ("wp", "fire", "dps", "cost", "tier", "slot", "upgrades_to")


class TermsConflict(RuntimeError):
    """The archived terms and a new bake disagree for the same build."""


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def digest(value) -> str:
    # stdlib-only: the digest is a binding, not a security boundary, and the
    # algorithm is named so a reader never confuses it with the tracker's BLAKE3.
    return "blake2b:" + hashlib.blake2b(canonical(value), digest_size=32).hexdigest()


def terms_from_rows(rows: dict[str, dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for key, row in sorted(rows.items()):
        out[key] = {field: row.get(field) for field in TERM_FIELDS}
        out[key]["name"] = row.get("name")
    return out


def write_snapshot(build: str, version_date: str, rows: dict[str, dict],
                   *, archive: pathlib.Path = ARCHIVE, replace: bool = False,
                   captured_at: str | None = None) -> dict:
    """Archive one build's terms. The same build with other terms is a refusal.

    deadlock-api serves only the current build, so a second bake of the same build
    should be byte-identical. A different digest means the item data moved under a
    build that did not, and the first snapshot is kept rather than overwritten.
    """
    build = str(build or "").strip()
    if not build or build == "unknown":
        raise TermsConflict("refused: the bake has no build number")
    terms = terms_from_rows(rows)
    snapshot = {
        "schema": SCHEMA,
        "build": build,
        "version_date": version_date or "",
        "captured_at": captured_at or datetime.datetime.now(datetime.timezone.utc).replace(
            microsecond=0).isoformat(),
        "items": terms,
    }
    # The digest covers what the build contains, not when it was copied: a re-bake
    # of the same build must be the same snapshot.
    snapshot["digest"] = digest({key: snapshot[key] for key in ("schema", "build", "version_date", "items")})

    archive.mkdir(parents=True, exist_ok=True)
    path = archive / f"{build}.json"
    if path.exists():
        previous = json.loads(path.read_text(encoding="utf-8"))
        if previous.get("digest") == snapshot["digest"]:
            return previous
        if not replace:
            raise TermsConflict(
                f"refused: build {build} is archived with {previous.get('digest')} and this bake is "
                f"{snapshot['digest']}; the archived snapshot is kept (pass --replace-terms to replace it)")
    path.write_text(json.dumps(snapshot, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    write_index(archive)
    return snapshot


def load(archive: pathlib.Path = ARCHIVE) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if not archive.exists():
        return out
    for path in sorted(archive.glob("*.json")):
        if path.name == "index.json":
            continue
        try:
            snapshot = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        build = str(snapshot.get("build") or path.stem)
        if isinstance(snapshot.get("items"), dict):
            out[build] = snapshot
    return out


def write_index(archive: pathlib.Path = ARCHIVE) -> dict:
    snapshots = load(archive)
    rows = []
    for build in sorted(snapshots, key=lambda value: (len(value), value)):
        snapshot = snapshots[build]
        rows.append({
            "build": build,
            "version_date": snapshot.get("version_date", ""),
            "captured_at": snapshot.get("captured_at", ""),
            "digest": snapshot.get("digest", ""),
            "items": len(snapshot.get("items") or {}),
            "path": f"data/builds/{build}.json",
        })
    index = {"schema": INDEX_SCHEMA, "builds": rows}
    archive.mkdir(parents=True, exist_ok=True)
    (archive / "index.json").write_text(json.dumps(index, indent=1) + "\n", encoding="utf-8")
    return index


def status(build: str, archive: pathlib.Path = ARCHIVE) -> dict:
    snapshots = load(archive)
    snapshot = snapshots.get(str(build))
    if not snapshot:
        return {"build": build, "state": "missing",
                "reason": f"no terms snapshot for build {build}; the strip will withhold terms"}
    return {"build": build, "state": "read", "digest": snapshot.get("digest"),
            "version_date": snapshot.get("version_date"), "items": len(snapshot.get("items") or {})}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", default=str(ARCHIVE))
    parser.add_argument("--status", default="")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    archive = pathlib.Path(args.archive)

    if args.status:
        row = status(args.status, archive)
        print(json.dumps(row))
        return 0 if row["state"] == "read" else 1
    if args.list:
        for row in write_index(archive)["builds"]:
            print(f"{row['build']}  {row['version_date']:<14} {row['items']:>4} items  {row['digest']}")
        return 0
    if args.verify:
        bad = 0
        for build, snapshot in load(archive).items():
            recorded = snapshot.get("digest", "")
            covered = {key: snapshot.get(key) for key in ("schema", "build", "version_date", "items")}
            if digest(covered) != recorded:
                print(f"REFUSED: build {build} digest does not cover its contents", file=sys.stderr)
                bad += 1
        return 1 if bad else 0
    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

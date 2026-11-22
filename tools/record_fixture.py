"""Record a slice of the real analytics answers as a test fixture.

The WPA row is only defensible if the number in the shipped catalogue can be
recomputed from the response it came from. This command records that response --
one hero's item rows plus the hero-stats row that holds the baseline -- into
`tests/fixtures/<hero>-wpa.json`, with the endpoint URLs, the cache file and its
digest, so a test can recompute the figure without the network.

usage:
  python tools/record_fixture.py --hero Haze
  python tools/record_fixture.py --hero Haze --out tests/fixtures/haze-wpa.json
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import ingest  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hero", default="Haze")
    parser.add_argument("--cache", default="data/cache")
    parser.add_argument("--out", default="")
    args = parser.parse_args()

    cache = pathlib.Path(args.cache)
    heroes = json.loads((cache / "heroes.json").read_text(encoding="utf-8"))
    hero_stats = json.loads((cache / "hero-stats.json").read_text(encoding="utf-8"))
    assets = json.loads((cache / "items.json").read_text(encoding="utf-8"))

    hero = next((row for row in heroes if (row.get("name") or "").lower() == args.hero.lower()), None)
    if not hero:
        print(f"REFUSED: no hero named {args.hero} in the heroes asset", file=sys.stderr)
        return 1
    hero_id = hero["id"]
    baseline_row = next((row for row in hero_stats if row.get("hero_id") == hero_id), None)
    if not baseline_row:
        print(f"REFUSED: no hero-stats row for {args.hero} ({hero_id})", file=sys.stderr)
        return 1

    cache_file = cache / f"hero-{hero_id}.json"
    if not cache_file.exists():
        print(f"REFUSED: {cache_file} is not present; run tools/ingest.py first", file=sys.stderr)
        return 1
    payload = json.loads(cache_file.read_text(encoding="utf-8"))

    by_id = {item.get("id"): item for item in assets if item.get("type") == "upgrade"}
    items = []
    for row in payload:
        item = by_id.get(row.get("item_id"))
        if not item:
            continue
        items.append({
            "item_id": row["item_id"],
            "name": item.get("name"),
            "class_name": item.get("class_name"),
            "cost": item.get("cost"),
            "wins": row.get("wins"),
            "losses": row.get("losses"),
            "matches": row.get("matches"),
            "avg_buy_time_s": row.get("avg_buy_time_s"),
        })

    baseline = ingest.hero_baselines([baseline_row]).get(hero_id)
    document = {
        "schema": "soul-lens.fixture/1",
        "recorded": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
        "why": "recomputation source for the WPA row; recorded from the keyless analytics endpoint",
        "endpoints": {
            "hero_item_stats": ingest.HERO_ITEM_URL.format(id=hero_id),
            "hero_stats": ingest.HERO_STATS_URL,
            "items": ingest.ITEM_URL,
        },
        "cache": {
            "file": f"data/cache/hero-{hero_id}.json",
            "sha256": hashlib.sha256(cache_file.read_bytes()).hexdigest(),
        },
        "hero": {"hero_id": hero_id, "name": hero.get("name"), "baseline": baseline,
                 "wins": baseline_row.get("wins"), "losses": baseline_row.get("losses")},
        "items": items,
    }
    out = pathlib.Path(args.out or f"tests/fixtures/{args.hero.lower()}-wpa.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(document, indent=1) + "\n", encoding="utf-8")
    print(f"recorded {len(items)} item rows for {hero.get('name')} in {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

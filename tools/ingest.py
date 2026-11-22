"""Build the soul-lens data the client overlay reads.

Three sources, each named in the output so the overlay never attributes a number to
the wrong one:

  live game     the installed build's ``steam.inf`` version and the item catalog it
                ships; the hover itself supplies the price at the moment of reading
  deadlock-api  ITEM_URL for cost, tier, slot and weapon terms; STATS_URL for the
                measured average purchase time per item
  statlocker    WPA_URL with STATLOCKER_API_KEY, or a file from --statlocker-file.
                Without either, the statlocker column is refused by name rather
                than filled with a guess.

The economy is item-local on purpose: souls per +1% weapon power and souls per +1%
DPS of the hero's own current weapon. DPS is a multiplier, (1+damage)(1+fire rate)-1,
so it does not need a base damage per hero and cannot silently invent one.

usage:
  python tools/ingest.py --out data/items.json --js panorama/scripts/soul_lens_data.js
  python tools/ingest.py --from-cache
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import pathlib
import re
import sys
import urllib.request

ITEM_URL = "https://api.deadlock-api.com/v1/assets/items"
STATS_URL = "https://api.deadlock-api.com/v1/analytics/item-stats"
HERO_URL = "https://api.deadlock-api.com/v1/assets/heroes"
HERO_STATS_URL = "https://api.deadlock-api.com/v1/analytics/item-stats?hero_id={id}"
WPA_URL = "https://statlocker.gg/api/info/wpa-filtered-items"
STEAM_INF = pathlib.Path("D:/SteamLibrary/steamapps/common/Deadlock/game/citadel/steam.inf")

# The weapon terms this economy reads. A conditional or on-active term is not a
# standing increase, so it is excluded and named in the legend instead.
WP_KEYS = ("BaseAttackDamagePercent", "WeaponPower")
FIRE_KEYS = ("BonusFireRate",)
EXCLUDED_PREFIXES = ("Active", "Fervor", "CloseRange", "LongRange", "Proc", "Ambush",
                     "Air", "WeaponPowerPerStack", "WeaponDamagePerStack", "BulletsBonus")


def _number(value) -> float | None:
    """A property cell is a string in the asset; anything else is not a number."""
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return None
    text = value.strip().rstrip("%").strip()
    try:
        return float(text)
    except ValueError:
        return None


def prop_number(props: dict, key: str) -> float:
    cell = props.get(key)
    if not isinstance(cell, dict):
        return 0.0
    value = _number(cell.get("value"))
    return value if value is not None else 0.0


def weapon_terms(props: dict) -> dict:
    """The item's standing weapon terms, as percentages."""
    wp = 0.0
    for key in WP_KEYS:
        wp += prop_number(props, key)
    fire = 0.0
    for key in FIRE_KEYS:
        fire += prop_number(props, key)
    dps = ((1.0 + wp / 100.0) * (1.0 + fire / 100.0) - 1.0) * 100.0
    return {"wp": round(wp, 4), "fire": round(fire, 4), "dps": round(dps, 4)}


def souls_per(cost: float | None, gain: float | None) -> float | None:
    """Souls per +1 unit of gain. Zero or missing gain has no ratio, not infinity."""
    if not cost or not gain or gain <= 0:
        return None
    return round(cost / gain, 1)


def normalize(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()


def item_rows(assets: list[dict], stats: list[dict]) -> dict[str, dict]:
    buy: dict[int, float] = {}
    for row in stats:
        item_id = row.get("item_id")
        seconds = row.get("avg_buy_time_s")
        if isinstance(item_id, int) and isinstance(seconds, (int, float)) and seconds > 0:
            current = buy.get(item_id)
            if current is None or seconds < current:
                buy[item_id] = float(seconds)

    rows: dict[str, dict] = {}
    for item in assets:
        if item.get("type") != "upgrade" or not item.get("shopable"):
            continue
        props = item.get("properties") or {}
        if not isinstance(props, dict):
            continue
        terms = weapon_terms(props)
        cost = item.get("cost")
        if not isinstance(cost, (int, float)) or cost <= 0:
            cost = None
        seconds = buy.get(item.get("id"))
        rows[normalize(item.get("name", ""))] = {
            "name": item.get("name"),
            "class_name": item.get("class_name"),
            "cost": int(cost) if cost else None,
            "tier": item.get("item_tier"),
            "slot": item.get("item_slot_type"),
            "wp": terms["wp"],
            "fire": terms["fire"],
            "dps": terms["dps"],
            "souls_per_wp": souls_per(cost, terms["wp"]),
            "souls_per_dps": souls_per(cost, terms["dps"]),
            "avg_buy_s": round(seconds, 1) if seconds is not None else None,
            "item_id": item.get("id"),
            "upgrades_to": item.get("upgrades") or [],
        }
    return rows


def statlocker_rows(payload, rows: dict[str, dict]) -> tuple[dict[str, dict], dict]:
    """Read statlocker's WPA listing, whatever row shape it uses, by item name.

    Their published endpoint answers with an array of objects that carry an item
    name and a WPA-like number. Every field is optional here: a row that does not
    name its item is skipped and counted, so a changed shape is a refusal and not
    a silent zero.
    """
    source = {"state": "absent", "rows": 0, "skipped": 0, "reason": None}
    if payload is None:
        source["reason"] = "no STATLOCKER_API_KEY and no --statlocker-file"
        return {}, source
    if isinstance(payload, dict):
        for key in ("data", "items", "results"):
            if isinstance(payload.get(key), list):
                payload = payload[key]
                break
    if not isinstance(payload, list):
        source["state"] = "refused"
        source["reason"] = "unrecognised payload shape"
        return {}, source
    out: dict[str, dict] = {}
    for row in payload:
        if not isinstance(row, dict):
            source["skipped"] += 1
            continue
        name = row.get("name") or row.get("item_name") or row.get("itemName")
        wpa = None
        for key in ("wpa", "WPA", "win_probability_added", "winProbabilityAdded", "winrate_delta"):
            value = row.get(key)
            if isinstance(value, (int, float)):
                wpa = float(value)
                break
        if not name or wpa is None:
            source["skipped"] += 1
            continue
        key = normalize(str(name))
        if key in rows:
            out[key] = {"wpa": wpa}
            source["rows"] += 1
        else:
            source["skipped"] += 1
    source["state"] = "read" if out else "refused"
    if not out:
        source["reason"] = "no row named an item in the catalog"
    return out, source


def hero_buy_times(heroes: list[dict], rows: dict[str, dict], cache: pathlib.Path, *, use_cache: bool,
                   progress=None) -> tuple[dict[str, dict], dict]:
    """Per-hero purchase times, asked of the API one hero at a time.

    The same item is bought at a different minute by a Haze and by an Abrams, so the
    hero the player is on is the one that decides the buy line. A hero the API has
    no rows for is left out rather than given the global average under its name.
    """
    item_id_to_key = {}
    out: dict[str, dict] = {}
    source = {"state": "read", "heroes": 0, "rows": 0, "skipped": 0, "reason": None}
    for hero in heroes:
        hero_id = hero.get("id")
        name = hero.get("name") or ""
        if not isinstance(hero_id, int) or not name or hero.get("disabled"):
            source["skipped"] += 1
            continue
        try:
            payload = fetch(HERO_STATS_URL.format(id=hero_id), cache / f"hero-{hero_id}.json",
                            use_cache=use_cache)
        except Exception as error:
            source["reason"] = f"hero {name}: {error}"
            continue
        if not isinstance(payload, list):
            source["skipped"] += 1
            continue
        buy: dict[str, float] = {}
        for row in payload:
            item_key = item_id_to_key.get(row.get("item_id"))
            if item_key is None:
                # The rows are keyed by the item's numeric id; resolve that id through
                # the catalog once, before this hero's rows are read.
                item_key = next((key for key, value in rows.items()
                                 if value.get("item_id") == row.get("item_id")), None)
                if item_key is not None:
                    item_id_to_key[row["item_id"]] = item_key
            seconds = row.get("avg_buy_time_s")
            if item_key and isinstance(seconds, (int, float)) and seconds > 0:
                current = buy.get(item_key)
                if current is None or seconds < current:
                    buy[item_key] = float(seconds)
        if buy:
            out[normalize(name)] = {"name": name, "buy": {k: round(v, 1) for k, v in buy.items()}}
            source["heroes"] += 1
            source["rows"] += len(buy)
        else:
            source["skipped"] += 1
        if progress:
            progress(name, len(buy))
    if not out and source["state"] == "read":
        source["state"] = "refused"
        source["reason"] = source["reason"] or "no hero answered with purchase times"
    return out, source


def live_build() -> dict:
    if not STEAM_INF.exists():
        return {"state": "absent", "reason": f"{STEAM_INF} not found"}
    text = STEAM_INF.read_text(encoding="utf-8", errors="replace")
    values = {}
    for line in text.splitlines():
        key, _, value = line.partition("=")
        if key.strip() in ("ClientVersion", "ServerVersion", "VersionDate", "ProductName"):
            values[key.strip()] = value.strip()
    if not values:
        return {"state": "absent", "reason": "steam.inf carried no version keys"}
    values["state"] = "read"
    # The install root is a machine detail and stays out of a file that ships.
    values["path"] = "game/citadel/steam.inf"
    return values


def fetch(url: str, cache: pathlib.Path, *, headers: dict | None = None, use_cache: bool) -> object:
    if use_cache and cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    request = urllib.request.Request(url, headers=headers or {"User-Agent": "soul-lens/1"})
    with urllib.request.urlopen(request, timeout=60) as response:
        body = response.read()
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(body)
    return json.loads(body.decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="data/items.json")
    parser.add_argument("--js", default="panorama/scripts/soul_lens_data.js")
    parser.add_argument("--cache", default="data/cache")
    parser.add_argument("--from-cache", action="store_true")
    parser.add_argument("--no-heroes", action="store_true",
                        help="skip the per-hero purchase times (one request per hero)")
    parser.add_argument("--statlocker-file", default="")
    args = parser.parse_args()

    cache = pathlib.Path(args.cache)
    try:
        assets = fetch(ITEM_URL, cache / "items.json", use_cache=args.from_cache)
        stats = fetch(STATS_URL, cache / "item-stats.json", use_cache=args.from_cache)
    except Exception as error:  # network is a refusal, not a crash
        print(f"REFUSED network: {error}", file=sys.stderr)
        return 1

    if not isinstance(assets, list) or not isinstance(stats, list):
        print("REFUSED: an asset endpoint did not answer with a list", file=sys.stderr)
        return 1

    rows = item_rows(assets, stats)
    if not rows:
        print("REFUSED: no shopable upgrade rows in the catalog", file=sys.stderr)
        return 1

    statlocker_payload = None
    key = os.environ.get("STATLOCKER_API_KEY", "").strip()
    if args.statlocker_file:
        statlocker_payload = json.loads(pathlib.Path(args.statlocker_file).read_text(encoding="utf-8"))
    elif key:
        try:
            statlocker_payload = fetch(WPA_URL, cache / "statlocker-wpa.json",
                                       headers={"X-API-Key": key, "User-Agent": "soul-lens/1"},
                                       use_cache=args.from_cache)
        except Exception as error:
            statlocker_payload = None
            sl_error = str(error)
    hero_source = {"state": "skipped", "heroes": 0, "rows": 0, "skipped": 0,
                   "reason": "--no-heroes"}
    hero_rows: dict[str, dict] = {}
    if not args.no_heroes:
        try:
            heroes = fetch(HERO_URL, cache / "heroes.json", use_cache=args.from_cache)
            if isinstance(heroes, list):
                hero_rows, hero_source = hero_buy_times(heroes, rows, cache, use_cache=args.from_cache)
            else:
                hero_source = {"state": "refused", "reason": "heroes asset was not a list"}
        except Exception as error:
            hero_source = {"state": "refused", "reason": str(error)}

    sl_rows, sl_source = statlocker_rows(statlocker_payload, rows)
    if statlocker_payload is None and key and not args.statlocker_file:
        sl_source["reason"] = locals().get("sl_error", "request failed")
    for item_key, extra in sl_rows.items():
        rows[item_key].update(extra)

    build = live_build()
    sources = {
        "deadlock-api": {"state": "read", "items": len(rows), "stats_rows": len(stats),
                         "url": ITEM_URL, "stats_url": STATS_URL},
        "deadlock-api-heroes": hero_source,
        "statlocker": sl_source,
        "live-game": build,
    }
    document = {
        "schema": "soul-lens.data/1",
        "generated": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
        "build": build.get("ClientVersion") or build.get("ServerVersion") or "unknown",
        "build_date": build.get("VersionDate", ""),
        "model": {
            "wp": "sum of BaseAttackDamagePercent and WeaponPower",
            "dps": "(1 + wp/100) * (1 + fire_rate/100) - 1, in percent of current weapon DPS",
            "souls": "cost / gain, +infinity refused as null",
            "buy": "measured average purchase time across the matches deadlock-api holds",
            "excluded": list(EXCLUDED_PREFIXES),
        },
        "sources": sources,
        "items": dict(sorted(rows.items())),
        "heroes": dict(sorted(hero_rows.items())),
    }

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(document, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    js = pathlib.Path(args.js)
    js.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(document, ensure_ascii=False, separators=(",", ":"))
    js.write_text(
        "// generated by tools/ingest.py; do not hand-edit\n"
        f"window.SoulLensData = {payload};\n",
        encoding="utf-8",
    )

    with_wp = sum(1 for row in rows.values() if row["wp"] > 0)
    with_dps = sum(1 for row in rows.values() if row["dps"] > 0)
    print(f"items {len(rows)} with weapon power {with_wp} with dps {with_dps}")
    print(f"statlocker {sl_source['state']} rows={sl_source['rows']} reason={sl_source['reason']}")
    print(f"heroes {hero_source['heroes']} with {hero_source['rows']} purchase times ({hero_source['state']})")
    print(f"live build {document['build']} {document['build_date']}")
    print(f"wrote {out} and {js}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

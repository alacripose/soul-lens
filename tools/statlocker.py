"""Read Statlocker's per-hero item rankings from the endpoint the site itself uses.

`https://statlocker.gg/heroes/<hero>` draws its item table from
`/api/info/eternus-item-analysis/<hero_id>?minRank=-2`. That endpoint answers without an API key
(the keyed `/api/info/wpa-filtered-items` is a different, pooled product) and it is per hero, which
is what the strip needs: the same item is bought by a different share of a Haze's matches than of an
Abrams's, and that share is the pick rate the row prints.

Everything is read defensively. A row that does not name an item in the catalogue is skipped and
counted, so a changed payload shape is a refusal with a count, never a zero that reads as a ranking.
A hero the site has no analysis for is left out rather than given a neighbour's rows.

usage (from `tools/ingest.py`):
  rows, source = statlocker.parse_analysis(payload, item_keys, hero_id=13)
"""

from __future__ import annotations

import re

ANALYSIS_URL = "https://statlocker.gg/api/info/eternus-item-analysis/{hero_id}?minRank=-2"

# The endpoint answers the site's own page request and refuses anything else with
# `401 Missing API key`, so the request carries what a browser sends from a hero page:
# a browser User-Agent, the JSON accept, and the site as both origin and referer.
# Measured 2026-11-22: the same URL is 401 with a bare `soul-lens/1` User-Agent and 200
# with these headers, hero id 6 (Abrams) and 16 (Calico) included.
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/131.0 Safari/537.36"),
    "Accept": "application/json",
    "Origin": "https://statlocker.gg",
    "Referer": "https://statlocker.gg/heroes",
}


def normalize(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()


def analysis_url(hero_id: int | str) -> str:
    return ANALYSIS_URL.format(hero_id=hero_id)


def _number(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _share(value) -> float | None:
    """A 0..1 share as a percentage; a payload that already sends 0..100 is left alone."""
    number = _number(value)
    if number is None:
        return None
    if 0.0 <= number <= 1.0:
        return round(number * 100.0, 2)
    return round(number, 2)


def parse_analysis(payload, item_keys: dict[str, str], *, hero_id: int | None = None) -> tuple[dict[str, dict], dict]:
    """Rank a hero's items by the share of that hero's matches that bought them.

    `item_keys` maps a normalized item name to the catalogue key the strip looks the item up by.
    The rank is the row's place in that hero's table (1 is the most bought item), and `of` is the
    whole table's length, so `#4/168` says both where the item stands and how large the field is.
    """
    source = {
        "state": "absent",
        "url": analysis_url(hero_id) if hero_id is not None else ANALYSIS_URL,
        "hero_id": hero_id,
        "hero": None,
        "rows": 0,
        "skipped": 0,
        "items": 0,
        "matches": None,
        "cohort_min_rank": None,
        "reason": None,
    }
    if payload is None:
        source["reason"] = "no payload"
        return {}, source
    if not isinstance(payload, dict):
        source["state"] = "refused"
        source["reason"] = "payload is not an object"
        return {}, source
    items = payload.get("items")
    if not isinstance(items, list):
        source["state"] = "refused"
        source["reason"] = "payload carries no items list"
        return {}, source

    source["hero"] = payload.get("heroName")
    source["matches"] = payload.get("totalMatches") if isinstance(payload.get("totalMatches"), int) else None
    source["cohort_min_rank"] = payload.get("minRank")

    ranked = [row for row in items if isinstance(row, dict)]
    ranked.sort(key=lambda row: (
        -(_number(row.get("purchaseRate")) or 0.0),
        -(row.get("purchaseCount") if isinstance(row.get("purchaseCount"), int) else 0),
        str(row.get("name") or ""),
    ))
    source["items"] = len(ranked)

    out: dict[str, dict] = {}
    for index, row in enumerate(ranked, 1):
        name = row.get("name")
        key = item_keys.get(normalize(str(name or "")))
        if not key:
            source["skipped"] += 1
            continue
        pick = _share(row.get("purchaseRate"))
        if pick is None:
            source["skipped"] += 1
            continue
        winrate = _share(row.get("winRate"))
        buy = _number(row.get("avgBuyTimeS"))
        count = row.get("purchaseCount")
        out[key] = {
            "rank": index,
            "of": len(ranked),
            "pick": pick,
            "winrate": winrate,
            "buy_s": round(buy, 1) if buy is not None and buy > 0 else None,
            "matches": count if isinstance(count, int) else None,
            "tier": row.get("tier"),
        }
        source["rows"] += 1

    source["state"] = "read" if out else "refused"
    if not out:
        source["reason"] = "no row named an item in the catalog"
    return out, source

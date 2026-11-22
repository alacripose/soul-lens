# Soul Lens

A single Deadlock mod: the game's own shop item hover card, with one more block
under the item's name — what the item costs per point of weapon power and per
percent of DPS, when the match usually buys it, and where it sits in the shop
list that is open.

It is one Panorama VPK. There is no server, no companion app and no overlay
process: the mod replaces exactly one of the game's layouts,
`panorama/layout/tooltips/citadel_tooltip_mod_hover.xml`, and appends the strip
inside it, so the stock tooltip is still the thing drawing the card.

## What the strip says

```
SOUL LENS · HAZE
power   +8% power · 100 souls / +1%
dps     +8.0% dps · 100 souls / +1%
buy ≈ 7:30 (average) · 2 of 2 in this list
deadlock-api · statlocker: no STATLOCKER_API_KEY and no --statlocker-file
```

| Line | Where the number comes from |
|---|---|
| `+N% power` | the item's `BaseAttackDamagePercent` and `WeaponPower`, from the live build's item catalogue |
| `souls / +1%` | the item's price divided by that percentage — the price is read from the hover card at the moment it is hovered, so a changed price shows immediately |
| `+N% dps` | `(1 + power/100) × (1 + fire rate/100) − 1`, the standing weapon multiplier the item adds |
| `souls / +1%` (dps) | the same division against the DPS percentage |
| `buy ≈` | the measured purchase time for the hero on the shop header, from that hero's own rows in the public API; the global average, labelled `(average)`, when the hero has none — a measurement, not a recommendation |
| `N of M in this list` | the hovered item's place in the shop list that is open, read from the shop's own panels |
| `statlocker` | WPA and build order, only when statlocker's API answers with a key; otherwise the line names the refusal |

`souls / +1% DPS` is item-local on purpose. It is the rise in *your current
weapon DPS*, so it needs no base damage per hero and cannot quietly invent one.
An item with no standing weapon terms — most spirit and vitality items — shows
`no weapon power term` / `no standing dps term` instead of a zero or a guess.

## Install

Close Deadlock first: the game reads `gameinfo.gi` at launch.

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

The script packs `panorama/` into `dist/soul_lens/pak01_dir.vpk`, copies it to
`game/citadel/addons/soul_lens/pak01_dir.vpk`, and adds one line to the
`SearchPaths` block of `game/citadel/gameinfo.gi`:

```
game			citadel/addons/soul_lens
```

It backs the file up once as `gameinfo.gi.soul-lens-bak`, and refuses when the
SearchPaths block does not look like the build it was written for. Pass
`-DeadlockRoot <path>` or set `DEADLOCK_GAME` for another install, and `-DryRun`
to pack and report without writing into the game folder.

To remove the mod, delete that `pak01_dir.vpk` and that one SearchPaths line.

## Refresh the data

The catalogue is baked into the VPK so the client never needs the network:

```bash
python tools/ingest.py                       # live network, writes data/items.json and the baked script
python tools/ingest.py --from-cache          # rebuild from data/cache without a request
python tools/check_live.py --write-report    # compare the override with the installed build
```

`tools/ingest.py` records every source in `data/sources.json`'s sibling fields
inside `data/items.json`: the Deadlock API endpoints it read, the statlocker
state, and the live build (`steam.inf`) the bake was made against.

### Statlocker

statlocker's data endpoints require an `X-API-Key`. Set `STATLOCKER_API_KEY` for
the ingest, or pass `--statlocker-file <export.json>`, and its WPA numbers and
build order join the strip. Without either, the source is recorded as `absent`
with that reason and the strip says so; nothing is filled with a placeholder.

## The live-layout check

The mod ships a copy of one of the game's files. `tools/check_live.py` extracts
the same file from the installed VPK through Source 2 Viewer, removes the Soul
Lens additions from the copy, and compares the rest line by line. When Valve
edits the hover layout the check refuses and names the first differing line, so
a stale copy cannot quietly replace a newer stock tooltip.

```bash
python tools/check_live.py
python tools/check_live.py --write-report   # writes data/live-layout.json
python tools/check_live.py --base saved.xml # compare against a saved live copy
```

## Gate

```bash
python tools/gate.py
python tools/gate.py --skip-live   # when this machine has no Deadlock install
```

The gate runs the Python tests, the overlay harness, the live-layout check and
the shipped-data checks. A check that cannot run is printed as `skip`, never as
a pass.

## What is here

| Path | Purpose |
|---|---|
| `panorama/layout/tooltips/citadel_tooltip_mod_hover.xml` | the live hover layout plus the strip and its two script includes |
| `panorama/scripts/soul_lens.js` | reads the card and the open shop, fills the strip, refuses unknown items |
| `panorama/scripts/soul_lens_data.js` | generated catalogue the overlay reads |
| `panorama/styles/soul_lens.css` | the strip's family styling |
| `tools/ingest.py` | Deadlock API + statlocker + live build → `data/items.json` and the baked script |
| `tools/check_live.py` | refuses a stale override against the installed build |
| `tools/gate.py` | the checks above in one command |
| `tools/pack_vpk.py` | VPK v1 writer (same one the family shell uses) |
| `tools/tests/test_soul_lens.js` | the shipped overlay script against a fake Panorama tree |
| `tests/test_ingest.py` | economy, source adapters and shipped-data checks |
| `docs/soul-lens-surface.html` | browser witness: the shipped script drawing three real cards |
| `install.ps1` | pack, install, mount |

## Boundaries

- **One game file is replaced.** The hover layout, and nothing else. The
  live-layout check is what keeps that honest.
- **Cost is live; terms are baked.** Price comes from the card being hovered;
  percentages come from the catalogue the bake recorded, with its build.
- **No invented numbers.** A missing item, a missing term or a missing key is
  named in the strip, not filled.
- **No network in the client.** The VPK carries the catalogue; the ingest is a
  build step that runs on this machine.
- **No hero baseline.** DPS is a percentage of the current weapon, so a number
  does not depend on a base damage table that could drift from the game.

## Evidence

- Override matches the installed build 6864 (Nov 18 2026); the live-layout
  digest is in `data/live-layout.json`.
- Catalogue: 173 shopable items, 27 with a weapon power term, 45 with a DPS term,
  from `api.deadlock-api.com/v1/assets/items` and `.../analytics/item-stats`.
- Hero purchase times: 44 heroes, 6,831 hero × item rows, one request per hero.
- `python -m unittest discover -s tests` — 17 tests.
- `node tools/tests/test_soul_lens.js` — 14 checks.
- `python tools/gate.py` — unit, harness, live and shipped all pass.
- `docs/soul-lens-surface.html` draws all three cards from the shipped script:
  a weapon item with both ratios, a spirit item with both refusals, and an item
  the bake does not know, each with its buy line and source line.
- The packed VPK is 244,590 bytes (`tools/pack_vpk.py`, four files).
- Not witnessed: the strip inside the running game, and the mod is not installed
  on this machine. `install.ps1` writes into the game folder, so it waits for
  the owner to close Deadlock and run it; a live capture would follow that.

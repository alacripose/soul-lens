# Soul Lens

A single Deadlock mod: the game's own shop item hover card, with one more block
under the item's name — what the item costs per point of weapon power, per point
of win probability added, and per percent of DPS, when the match usually buys it,
and where it sits in the shop list that is open.

It is one Panorama VPK. There is no server, no companion app and no overlay
process: the mod replaces exactly one of the game's layouts,
`panorama/layout/tooltips/citadel_tooltip_mod_hover.xml`, and appends the strip
inside it, so the stock tooltip is still the thing drawing the card.

## What the strip says

A worked example, Haze and Glass Cannon, from the catalogue this repository ships:

```
SOUL LENS · HAZE
power   +85% power · 75 souls / +1%              dl-api
wpa     +8.9% WPA · 716 souls / +1%              dl-api
dps     +85.0% dps · 75 souls / +1%              dl-api
buy ≈ 30:51 (Haze) · 2 of 7 in this list
shop price live · dl-api Haze · statlocker: no STATLOCKER_API_KEY and no --statlocker-file
```

| Line | Where the number comes from |
|---|---|
| `+N% power` | the item's `BaseAttackDamagePercent` and `WeaponPower`, from the live build's item catalogue (`/v1/assets/items`) |
| `souls / +1%` | the item's price divided by that percentage — the price is read from the hover card at the moment it is hovered, so a changed price shows immediately |
| `+N% WPA` | the item's win rate for **this hero** minus the hero's own win rate, in percentage points, from the recorded wins and losses (`/v1/analytics/item-stats?hero_id=…` and `/v1/analytics/hero-stats`) |
| `souls / +1%` (WPA) | the item's price divided by that WPA |
| `+N% dps` | `(1 + power/100) × (1 + fire rate/100) − 1`, the standing weapon multiplier the item adds |
| `souls / +1%` (dps) | the same division against the DPS percentage |
| `buy ≈` | the measured purchase time for the hero on the shop header, from that hero's own rows; the global average, labelled `(average)`, when the hero has none |
| `N of M in this list` | the hovered item's place in the shop list that is open, read from the shop's own panels |
| the right-hand tag | which source the number on that row came from: `dl-api` or `statlocker` |

### WPA is measured, not modelled

`WPA = item win rate − that hero's win rate`, in percentage points, from the wins
and losses the keyless analytics endpoint returns. It is not a causal estimate
and it is labelled by its source so it is not mistaken for one. A row with fewer
than `model.min_matches` matches (2,000) prints its count and refuses the figure
— `WPA: 1,432 matches, under 2000` — and a negative delta prints
`−0.4% WPA · no gain` with no souls ratio, because there is no gain to divide by.

Statlocker is the authoritative source *when it answers*: with `STATLOCKER_API_KEY`
set at bake time (or `--statlocker-file`), its WPA replaces the measured one for
the items it names and the row is tagged `statlocker`. Without a key the measured
value stands and the source line records the refusal; the mod never needs the key
to be useful.

An item with no standing weapon terms — most spirit and vitality items — shows
`no weapon power term` / `no standing dps term` instead of a zero. Its WPA row
still prints, because the win/loss data covers every item.

## Install

The mod is installed on this machine so the owner can look at it in the shop. To
install it again or elsewhere, close Deadlock first (the game reads `gameinfo.gi`
at launch):

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

The catalogue and the per-hero outcome data are baked into the VPK so the client
never needs the network and a card cannot hang:

```bash
python tools/ingest.py                       # live network; writes data/items.json, data/provenance.json and the baked script
python tools/ingest.py --from-cache          # rebuild from data/cache without a request
python tools/record_fixture.py --hero Haze   # re-record the WPA recomputation fixture
python tools/check_live.py --write-report    # compare the override with the installed build
```

Endpoints read at bake time, all keyless:

| Purpose | Endpoint |
|---|---|
| item catalogue: cost, tier, slot, weapon terms | `api.deadlock-api.com/v1/assets/items` |
| global purchase time per item | `.../v1/analytics/item-stats` |
| hero list and ids | `.../v1/assets/heroes` |
| each hero's own win rate (the WPA baseline) | `.../v1/analytics/hero-stats` |
| each hero's item wins, losses and purchase time | `.../v1/analytics/item-stats?hero_id=<id>` |
| statlocker WPA (optional, keyed) | `statlocker.gg/api/info/wpa-filtered-items` |

`data/provenance.json` records, per hero, the endpoint, the cache file and its
SHA-256, and the baseline the WPA was measured against.

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

The click-through details tooltip (`citadel_tooltip_mod_details.xml`) is a
separate layout the hover layout does not load; reaching it would mean
overriding a second game file, which this mod does not do. Why is recorded in
`logs/records.md` rather than worked around.

## Gate and release

```bash
python tools/gate.py
python tools/gate.py --skip-live   # when this machine has no Deadlock install
python tools/verify_vpk.py         # the packed archive holds the four files
```

`.github/workflows/ci.yml` runs the gate with `--skip-live` on every push and pull
request, packs and verifies the VPK, and uploads it as an artifact. A `v*` tag
publishes the same archive as a GitHub release asset. The live-layout comparison
is the local check because a CI runner has no game install; the gate prints it as
a skip, never as a pass.

## What is here

| Path | Purpose |
|---|---|
| `panorama/layout/tooltips/citadel_tooltip_mod_hover.xml` | the live hover layout plus the strip and its two script includes |
| `panorama/scripts/soul_lens.js` | reads the card and the open shop, fills the strip, labels each row, refuses unknown data |
| `panorama/scripts/soul_lens_data.js` | generated catalogue the overlay reads |
| `panorama/styles/soul_lens.css` | the strip's family styling |
| `tools/ingest.py` | item catalogue, per-hero WPA and purchase times, live build → `data/` and the baked script |
| `tools/record_fixture.py` | records one hero's real response as the WPA recomputation fixture |
| `tools/check_live.py` | refuses a stale override against the installed build |
| `tools/gate.py` | unit, harness, live and shipped checks in one command |
| `tools/verify_vpk.py` | checks the packed archive |
| `tools/pack_vpk.py` | VPK v1 writer (same one the family shell uses) |
| `tools/tests/test_soul_lens.js` | the shipped overlay script against a fake Panorama tree |
| `tests/test_ingest.py` | economy, source adapters and shipped-data checks |
| `tests/test_wpa.py` | recomputes the baked WPA from the recorded fixture |
| `tests/fixtures/haze-wpa.json` | recorded Haze response: 156 item rows plus the hero baseline |
| `docs/soul-lens-surface.html` | browser witness: the shipped script drawing three cards |
| `install.ps1` | pack, install, mount |

## Boundaries

- **One game file is replaced.** The hover layout, and nothing else. The
  live-layout check is what keeps that honest.
- **Cost and hero are live.** Price and name come from the card being hovered, the
  hero and the list order from the open shop. The bake supplies the item terms,
  the recorded outcome data and the purchase times.
- **No invented numbers.** A missing item, a missing term, a small sample, a
  missing hero or a missing key is named in the strip, not filled.
- **No network in the client.** The VPK carries the catalogue; the ingest is a
  build step that runs on this machine.
- **No hero baseline damage.** DPS is a percentage of the current weapon, so a
  number does not depend on a base damage table that could drift from the game.
- **WPA is a delta, not a model.** It is the measured win-rate difference; the
  strip does not claim causality.

## Evidence

- Worked example, Haze / Glass Cannon: cost 6,400; WPA +8.9443 points from
  212,423 recorded matches (item win rate 54.55% against Haze's 53.61%); 716
  souls per +1% WPA; +85% power (75 souls / +1%); buy ≈ 30:51 for Haze.
  `tests/test_wpa.py` recomputes the figure from `tests/fixtures/haze-wpa.json`
  and compares it to the baked row.
- Override matches the installed build 6864 (Nov 18 2026); the live-layout
  digest is in `data/live-layout.json`.
- Catalogue: 173 shopable items, 27 with a weapon power term, 45 with a DPS term.
- Hero outcome data: 44 heroes, 6,831 WPA rows, 702 of them under the 2,000-match
  floor and printed as refusals, from the keyless analytics endpoints.
- `python -m unittest discover -s tests` — 28 tests.
- `node tools/tests/test_soul_lens.js` — 28 checks.
- `python tools/gate.py` — unit, harness, live and shipped all pass.
- `docs/soul-lens-surface.html` draws all three cases from the shipped script:
  the worked example with both ratios and both tags, a spirit item with its two
  refusals and a live WPA, and an item the bake does not know.
- The packed VPK is 729,578 bytes (`tools/pack_vpk.py`, four files,
  `tools/verify_vpk.py`).
- Installed into the game on this machine for the owner to look at; the strip in
  the running shop is the acceptance step and has not been photographed here.

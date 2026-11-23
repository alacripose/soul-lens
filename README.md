# Soul Lens

A single Deadlock mod: the game's own shop item card, with a passive-style
**Soul Lens** section under the item's stat block. The section's sentence names the
hero and the headline; six tiles carry what the item costs per point of weapon
power, per point of win probability added, and per percent of DPS, when the match
usually buys it, and what the two recommendation sources say about it — its place in
the shop's own recommended list, and Statlocker's rank and pick rate for the hero
being played.

It is one Panorama VPK. There is no server, no companion app and no overlay
process: the mod replaces exactly one of the game's layouts,
`panorama/layout/tooltips/citadel_tooltip_mod_details.xml` — the card the shop's
item popup actually draws — and appends the section inside it, so the stock tooltip
is still the thing drawing the card. The narrower hover layout is left untouched.
Retail Panorama loads compiled assets, so the build runs the CSDK resource
compiler and packs the `.vxml_c`/`.vjs_c`/`.vcss_c` output with Source2Viewer CLI.

## What the passive section says

The section is laid out like the card's own passive blocks: a `Soul Lens` header,
one sentence for the shop's hero, then two columns of stat tiles. The header and
summary borrow the card's `CooldownHeader`, `ActivePassiveLabel` and `ModInfoLabel`
classes; the tiles use the card's `#00000060` stat-box ground.

A worked example, Haze and Glass Cannon, from the catalogue this repository ships:

```
Across 212,423 recorded matches, this item adds +8.94% WPA for Haze at 716 souls per +1%, bought at 30:51.

+85%              +8.94%
Weapon Power      WPA
75 souls / +1%    716 souls / +1% · dl-api

+85.0%            30:51
Standing DPS      Average Buy
75 souls / +1%    measured for Haze

#3/9              #69/168
Shop List         Statlocker
this shop         1.3% picked · statlocker
```

The shop tile's `#3/9` is the open list's shape at hover time, not a baked number.
`sl` is Statlocker's rank and pick rate for the hero, baked from the endpoint its
own hero page calls. The WPA and Statlocker notes name their source (`dl-api` or
`statlocker`); the other notes name what the number measures.

| Tile | What it shows | Where the number comes from |
|---|---|---|
| Weapon Power | `+N%` and `souls / +1%` | the item's `BaseAttackDamagePercent` and `WeaponPower`, from the live build's item catalogue (`/v1/assets/items`) |
| WPA | `+N%` and `souls / +1%` | the item's win rate for **this hero** minus the hero's own win rate, in percentage points, from the recorded wins and losses (`/v1/analytics/item-stats?hero_id=…` and `/v1/analytics/hero-stats`) |
| Standing DPS | `+N%` and `souls / +1%` | `(1 + power/100) × (1 + fire rate/100) − 1`, the standing weapon multiplier the item adds |
| Average Buy | `m:ss` | the measured purchase time for the hero on the shop header, from that hero's own rows; the global average, noted `all matches`, when the hero has none |
| Shop List | `#N/M` | the hovered item's place in the shop's own recommended list (`#ShopModsRecommended`), read live from the panel tree; `not listed` when the open list does not name it |
| Statlocker | `#N/M` and `P% picked` | Statlocker's per-hero ranking: the item's place in that hero's table and the share of that hero's analyzed matches that bought it (`/api/info/eternus-item-analysis/<hero_id>`) |

The `souls / +1%` figure is the item's price divided by that percentage. The price
is read from the hover card at the moment it is hovered, so a changed price shows
immediately.

### WPA is measured, not modelled

`WPA = item win rate − that hero's win rate`, in percentage points, from the wins
and losses the keyless analytics endpoint returns. It is not a causal estimate
and its tile names the source so it is not mistaken for one. A tile with fewer
than `model.min_matches` matches (2,000) prints its count and refuses the figure —
`1,432 matches` over `under 2,000 · no WPA` — and a negative delta prints `−0.4%`
over `no gain · dl-api`, with no souls ratio, because there is no gain to divide by.

Statlocker is the authoritative source *when it answers*: with `STATLOCKER_API_KEY`
set at bake time (or `--statlocker-file`), its WPA replaces the measured one for
the items it names and the WPA tile is noted `statlocker`. Without a key the measured
value stands and the tile records the refusal; the mod never needs the key
to be useful.

### The two recommendation tiles are not blended

`shop` and `sl` are separate tiles because they are separate sources and they
disagree, and a blended number would hide that:

- `shop` is the game's own list: the hovered item's index in
  `#ShopModsRecommended`, the panel `citadel_hud_hero_shop.xml` fills for the
  selected hero. It is read from the shop's panel tree at hover time, so no bake is
  involved and none can go stale. A closed shop (`no shop`), a panel that is not
  there or holds no items (`no list`) and an item the list does not name
  (`not listed`) are three different sentences.
- `sl` is Statlocker's own ranking, baked per hero.
  `/api/info/eternus-item-analysis/<hero_id>?minRank=-2` is the endpoint
  `statlocker.gg/heroes/<hero>` calls for its item table: rank by purchase share,
  pick rate, win rate and measured buy time for that hero's matches. It needs no key
  but does need the page's request headers — a browser User-Agent plus the site as
  origin and referer; with a bare `soul-lens/1` User-Agent the same URL answers
  `401 Missing API key` (measured 2026-11-22). The ingest records `read`, `refused`
  or `skipped`, and the tile prints `unavailable` when the source did not answer —
  never a neighbouring hero's row.

The measured WPA keeps its own tile and is never replaced by either source.

An item with no standing weapon terms — most spirit and vitality items — collapses
the Weapon Power and Standing DPS tiles instead of printing a zero. Its WPA tile
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
python tools/ingest.py --from-cache          # rebuild from data/cache (only statlocker's new heroes are fetched)
python tools/ingest.py --no-statlocker       # skip statlocker's per-hero ranking, one request per hero
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
| statlocker per-hero ranking (keyless) | `statlocker.gg/api/info/eternus-item-analysis/<hero_id>?minRank=-2` |

`data/provenance.json` records, per hero, the endpoint, the cache file and its
SHA-256, and the baseline the WPA was measured against.

## Builds, bakes and refusals

Weapon terms belong to a build; a patch can change them under a bake that still
looks current. Two pieces keep that honest:

- `python tools/terms_archive.py` keeps one immutable terms snapshot per build
  under `data/builds/<build>.json`, bound with a digest and listed in
  `data/builds/index.json` — the same per-build snapshot convention the forge's
  VPK tracker uses. A re-bake of the same build with different terms is refused;
  the first snapshot is kept.
- `python tools/stamp_build.py` reads the installed `steam.inf` at install time
  (Panorama has no build API and no file access) and writes the build into
  `panorama/scripts/soul_lens_build.js`. The section draws terms only for that
  build: the current bake, or an archived snapshot for that build. Otherwise the
  Weapon Power tile reads `no <build>` and the empty tiles collapse.

`install.ps1` stamps the build, reports whether its terms are baked, then builds.
deadlock-api serves only the current build (`?client_version=6800` is a 404), so
the archive grows forward one patch at a time.

## The live-layout check

The mod ships a copy of one of the game's files. `tools/check_live.py` extracts
the same file from the installed VPK through Source 2 Viewer, removes the Soul
Lens additions from the copy, and compares the rest line by line. When Valve
edits the details layout the check refuses and names the first differing line, so
a stale copy cannot quietly replace a newer stock tooltip.

```bash
python tools/check_live.py
python tools/check_live.py --write-report   # writes data/live-layout.json
python tools/check_live.py --base saved.xml # compare against a saved live copy
```

The narrower `citadel_tooltip_mod_hover.xml` is the other tooltip layout the shop
builds; the drawn card is the details layout, which is the one this mod owns. An
equal override of the hover layout only added a stray second strip to the item
icon tooltip, so it was dropped and the one-file boundary holds.

## Gate and release

```bash
python tools/gate.py
python tools/gate.py --skip-live   # when this machine has no Deadlock install
python tools/build_addon.py        # CSDK compile + S2V pack
python tools/verify_vpk.py         # the archive holds the compiled assets
```

`.github/workflows/ci.yml` runs the gate with `--skip-live` on every push and pull
request, verifies the committed VPK and uploads it as an artifact. A `v*` tag
publishes the same archive as a GitHub release asset. CI does not pack: the CSDK
compiler and Source2Viewer are Windows tools on the build machine, and a
hand-packed archive of raw `.xml`/`.js`/`.css` mounts and renders nothing. The live-layout comparison
is the local check because a CI runner has no game install; the gate prints it as
a skip, never as a pass.

## What is here

| Path | Purpose |
|---|---|
| `panorama/layout/tooltips/citadel_tooltip_mod_details.xml` | the live details layout plus the passive section and its script includes |
| `panorama/scripts/soul_lens.js` | reads the card and the open shop, writes the section's sentence and six tiles, refuses unknown data |
| `panorama/scripts/soul_lens_data.js` | generated catalogue the overlay reads |
| `panorama/styles/soul_lens.css` | the section's passive header, summary and tile layout |
| `tools/ingest.py` | item catalogue, per-hero WPA, purchase times, Statlocker rankings and live build → `data/` and the baked script |
| `tools/statlocker.py` | reads Statlocker's per-hero ranking endpoint into rank, pick rate and buy time |
| `tests/test_statlocker.py` | the parse path against the captured response |
| `tests/fixtures/statlocker-eternus-haze.json` | captured `/api/info/eternus-item-analysis/13` response, 168 ranked items |
| `data/probes/2026-11-22-heredoc-code-authoring.md` | kept patch probe: why a heredoc was planned for authoring this repo, and the measurement that made it unnecessary |
| `tools/record_fixture.py` | records one hero's real response as the WPA recomputation fixture |
| `tools/check_live.py` | refuses a stale override against the installed build |
| `tools/gate.py` | unit, harness, live and shipped checks in one command |
| `tools/verify_vpk.py` | checks the packed archive for the compiled and raw paths |
| `tools/build_addon.py` | CSDK resource compile + Source2Viewer VPK pack |
| `tools/drive.py` | focuses Deadlock, sends the shop keys and photographs the result |
| `tools/tests/test_soul_lens.js` | the shipped overlay script against a fake Panorama tree |
| `tests/test_ingest.py` | economy, source adapters and shipped-data checks |
| `tests/test_wpa.py` | recomputes the baked WPA from the recorded fixture |
| `tests/fixtures/haze-wpa.json` | recorded Haze response: 156 item rows plus the hero baseline |
| `docs/soul-lens-surface.html` | browser witness: the shipped script drawing three cards |
| `install.ps1` | compile, pack, install, mount |

## Boundaries

- **One game file is replaced.** The details layout, and nothing else. The
  live-layout check is what keeps that honest.
- **Cost and hero are live.** Price and name come from the card being hovered, the
  hero and the list order from the open shop. The bake supplies the item terms,
  the recorded outcome data and the purchase times.
- **No invented numbers.** A missing item, a missing term, a small sample, a
  missing hero or a missing key is named in the section, not filled.
- **No network in the client.** The VPK carries the catalogue; the ingest is a
  build step that runs on this machine.
- **No hero baseline damage.** DPS is a percentage of the current weapon, so a
  number does not depend on a base damage table that could drift from the game.
- **WPA is a delta, not a model.** It is the measured win-rate difference; the
  section does not claim causality.

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
- `python -m unittest discover -s tests` — 43 tests, `tests/test_statlocker.py`'s nine
  of them against `tests/fixtures/statlocker-eternus-haze.json`.
- `node tools/tests/test_soul_lens.js` — 54 checks, including the six tile ids, the
  reused card's shop place and statlocker rank, a header change under the same
  hovered item after 700 ticks, and a refused statlocker source reading `unavailable`.
- `python tools/gate.py` — unit, harness, live, no-heredoc and shipped all pass.
- Statlocker rankings: `python tools/ingest.py --from-cache` read 44 heroes, 7,372
  item rows (172-item tables, cohort `minRank=103`, 416,571 analyzed matches), 0
  refused; each hero's URL, cache file and SHA-256 is in `data/provenance.json`.
- `docs/soul-lens-surface.html` draws all three cases from the shipped script:
  the worked example with all six tiles, Slowing Hex in the screenshot's passive
  shape, and an item the bake does not know collapsing the section.
- The packed VPK (`tools/build_addon.py`, CSDK 13 compile + S2V) carries nine
  paths: the compiled details layout, three compiled scripts, the compiled
  stylesheet, and the raw `.js`/`.css` alongside them; `tools/verify_vpk.py`
  refuses an archive without the compiled assets.
- `install.ps1` end to end on this machine: stamp 6864, terms snapshot
  `blake2b:05fd3356…`, `OK: 5 compiled, 0 failed`, nine files packed, mount line
  present, installed VPK byte-identical to `dist/` (`sha256 a2a53ba8…`).
- The passive section is not yet witnessed in game: the browser witness is the
  current proof. The prior raw-row shape was witnessed in build 6864 as
  `wpa +5.0% · 1277 souls/%`, `buy 29:18` under Ricochet's stat boxes
  (`data/shots/native6.jpg`).
- A stamped build with no snapshot was witnessed refusing before that:
  `power no 9999`, dps collapsed, wpa still drawn
  (`data/shots/stale-terms-zoom6.jpg`).
- The six-row strip was the shape before 2026-11-23; witnessed together, Stalker
  at 1600 souls: `wpa +0.35% · 4.5k/1%`, `buy 6:19`, `shop #37/156`,
  `sl #4/165 · 90%` (`data/shots/sixrows6.jpg`). The
  first install of those two rows drew neither: both were collapsed by the flag
  that decides whether a row is worth drawing, which was `!!refusal` — true only
  when the reader had *failed*. `data/probes/2026-11-22-row-hidden-on-success.md`
  keeps the elimination chain and the `shown()` checks that now catch it.


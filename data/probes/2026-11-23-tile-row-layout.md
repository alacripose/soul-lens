# Probe — 2026-11-23 — the tile row and the open VPK

Kept on purpose: the in-game screenshot is the evidence, and the two measurements
below are why the tile row is no longer a hand-sized grid. Do not delete it.

## What the game showed

Two screenshots, same installed build 6864:

1. Spirit Shredder: four visible tiles (WPA, Average Buy, Shop List, Statlocker),
   each one full card width and stacked one per row. The native Passive above it
   had two boxes side by side.
2. Arctic Blast: the native Active row had three boxes in one row (Damage, Move
   Speed, Duration); the Soul Lens tiles below it were still one per row.

The section's text, values, refusals and summary were correct. Only the row was
wrong.

## Why it happened

`.SoulLensTile` asked for `width: 49%` and also carried `padding: 5px 6px 6px 6px`
and `margin: 0px 1% 2px 0px`. Panorama adds a panel's padding outside its
percentage width. On the 450px card the content row is about 386px, so each tile
was 49% + 12px + 1% — wider than half the row. The `right-wrap` flow could not put
two in a row, and the single tile took the row, which is the full-width stack in
the screenshot.

The native row does not use individual percentage boxes. `#ImportantAttributeContainer`
is `flow-children: right` and `#ImportantAttribute` is `fill-parent-flow(1)` for
two or three boxes; four boxes switch to `right-wrap` at 49%. The section was
fighting that layout instead of using its grouping.

## The fix

- The tile's padding moved to `.SoulLensTile .ImportantStatContent`, so `49%` (and
  `32.5%`) is the whole box and two or three fit without overflow.
- `soul_lens.js` counts the tiles that survived the render and sets
  `SoulLensThreeUpTile` on each tile for three, five or six visible tiles; four
  stay 2x2. Refusals count as visible because the tile is still shown.
- `.SoulLensThreeUpTile` is `width: 32.5%`, matching the card's 3-up
  important-attribute row; the default stays `49%`. The grid also carries
  `SoulLensThreeUp`, but the width rides on the tile: the first v0.2.1 build used
  `.SoulLensGrid.SoulLensThreeUp .SoulLensTile`, and that compound grid selector
  did not apply in the game, so five and six tiles stayed two across.
- The grid gained `id="SoulLensGrid"` so the script can set that class.

## Measured

- `python tools/gate.py`: unit, harness, live (build 6864, digest
  `20783fc663bbbed0041962ae3d26ef4e`), no-heredoc and shipped all pass.
- `node tools/tests/test_soul_lens.js`: PASS, including “four visible tiles stay
  two across” and “six visible tiles use three across”.
- `tools/build_addon.py`: `OK: 5 compiled, 0 failed`; 9 files packed;
  2,998,969 bytes; sha256 `2fbf83a649f0fcbd1245636bcb53061103b515b18be8993a7a3b2ccd97cd8b6f`.
- `tools/verify_vpk.py`: every required path mounted. The compiled stylesheet
  carries `.SoulLensGrid.SoulLensThreeUp .SoulLensTile { width: 32.5%; }` and the
  inner `padding: 5px 6px 6px 6px`.

## Install

`install.ps1` built and stamped the archive, but the first copy was refused because
Deadlock still had the old VPK open:

```
Copy-Item : The process cannot access the file
'...\game\citadel\addons\soul_lens\pak01_dir.vpk' because it is being used by another process.
```

After the game closed, the retry succeeded. The installed archive is byte-identical
to `dist/`: 2,998,969 bytes, sha256
`2fbf83a649f0fcbd1245636bcb53061103b515b18be8993a7a3b2ccd97cd8b6f`. The two
screenshots are the v0.2.1 two-across build; this build is installed and the next
in-game hover is the witness for the three-up row.

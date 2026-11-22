# DESIGN

## Surface

One strip inside the game's own shop item hover card. Not a window, not a
tooltip of our own, not a second panel beside the shop. The player already has
the card open; the strip is the last four lines of it.

## Direction

The family web-dark register, at tooltip scale: near-black ground (`#0d0d0f`),
one gold rule (`#c8a04a`), tracked uppercase micro-labels, and monospaced
numerals so two items compare by eye without the digits moving. The card's own
colours and type stay untouched above the rule — the strip reads as part of the
tooltip rather than as a sticker on it.

The gold is the same attention colour as the family's pinned look; it is used
once per strip, on the rule and the head, so it never competes with the item's
own tier tag. Labels (`power`, `dps`) are muted; values are the bright ink; the
source line is the faintest thing in the block because it is for when a number is
questioned, not for the first read.

## States

- **Reading** — the card is created before the game fills it, so the strip says
  `reading the shop…` rather than showing an empty line.
- **Reading found** — two rows with gold values and the muted buy line.
- **No term** — `no weapon power term` / `no standing dps term` in the muted
  colour. This is a refusal, and it is styled like one.
- **Unknown item** — `no stat line for this item`, with the build the bake was
  made against in the source line.
- **Source absent** — the source line names statlocker's refusal; the rest of the
  strip still draws, because the Deadlock API numbers do not depend on it.
- **Block missing** — a different tooltip layout, or a mod conflict: the script
  logs once and leaves the card alone.

## Numbers

- Souls are rounded to whole souls; a ratio is `souls / +1%`, so a smaller number
  is a better item.
- DPS is shown to one decimal because the multiplier composition produces
  fractions; weapon power is shown as the integer the game's own tooltips use.
- Buy time is `m:ss`, the game's own clock, not a minute count.
- Ratios that would divide by zero are `null` in the data and a refusal in the
  strip. There is no `∞` and no `0`.

## 2026-11-22 — the copy is checked, not trusted

The mod's layout file is the live build's file plus additions, and
`tools/check_live.py` proves the difference is exactly the additions by removing
them and comparing digests. That check is a design constraint, not housekeeping:
it is why the additions are marked with one `soul-lens:begin`/`soul-lens:end`
pair and why the script and stylesheet includes are single named lines.

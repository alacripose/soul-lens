# DESIGN

## Surface

One passive-style section inside the game's own shop item hover card. Not a
window, not a tooltip of our own, not a second panel beside the shop. The player
already has the card open; the section is the last block of it.

## Direction

The card's own passive register: the game's 32px `offBlack&90` header, an italic
half-opacity label, a `ModInfoLabel` sentence, and stat boxes on the card's
`#00000060` ground. The card's colours, type and spacing stay untouched above the
section — it reads as another passive block in the tooltip rather than as a
sticker on it.

The game's green (`deadlockGreen`) marks a gain, the card's ink marks a place or a
time, and the refusal red marks a negative WPA. The tile note is the faintest line
in the block because it is for when a number is questioned, not for the first read.

## States

- **Reading** — the card is created before the game fills it, so the section stays
  collapsed rather than showing an empty header.
- **Reading found** — a sentence naming the hero and the headline, then six tiles
  with their values and one-line notes.
- **No term** — the Weapon Power and Standing DPS tiles collapse. A missing term is
  not a zero, so the section does not print one.
- **Unknown item** — the whole section collapses, rather than drawing an empty
  passive header.
- **Source absent** — the tile names statlocker's refusal; the rest of the section
  still draws, because the Deadlock API numbers do not depend on it.
- **Block missing** — a different tooltip layout, or a mod conflict: the script
  logs once and leaves the card alone.

## Numbers

- Souls are rounded to whole souls; a ratio is `souls / +1%`, so a smaller number
  is a better item.
- DPS is shown to one decimal because the multiplier composition produces
  fractions; weapon power is shown as the integer the game's own tooltips use.
- Buy time is `m:ss`, the game's own clock, not a minute count.
- Ratios that would divide by zero are `null` in the data and a refusal in the
  section. There is no `∞` and no `0`.

## 2026-11-22 — the WPA row is the recommendation row

Power and DPS price what the item does; WPA prices what happened when this hero
bought it. It sits between them because it is the only row whose source can be a
recommendation service rather than the game's own stat list, and the right-hand
tag is what keeps that legible: `dl-api` for the measured win-rate delta,
`statlocker` when the keyed service answered for that item. The tag is smaller and
dimmer than the value, so a refusal (`under 2000` in the refusal colour) reads as
a refusal before it is read as a number.

## 2026-11-22 — the recommendation rows are two rows, not one score

`shop` and `sl` sit under `buy` because they answer the question the ratios raise:
should I buy this now, and does anyone else? They are two rows rather than one
blended rank because the populations differ — the shop's list is the game's own
recommendation for the selected hero, Statlocker's rank is the purchase share of
that hero's recent matches. A player comparing them is comparing two populations,
so each key names its source and each value keeps that source's own unit: `#N/M`
for a place, `%` for a share.

Three states, all the size of a number: `#3/9` (found), `not listed` (the source
answered and does not name the item), `unavailable` (the source did not answer).
None is a zero, and none borrows a neighbour's figure.

The placed item is the one the card names at the moment it is read, not the one it
was created with, and the hero is the one the shop header names on that same read —
which is why the section re-renders on a slow tick as well as on a card change.

## 2026-11-23 — the stats are a passive block, not raw lines

The six key/value rows were readable but not part of the card's language: they
read as a debug strip under a native passive. The section now uses the same
hierarchy the game uses for a passive: a 32px `offBlack&90` header with an italic
half-opacity `ActivePassiveLabel`, a `ModInfoLabel` sentence that names the hero
and the headline, and a two-column grid of stat boxes on the card's `#00000060`
ground. The values keep their units and their source in the note line; a refusal
is still a value, not a blank.

The sentence is not decorative. It states the hero the numbers belong to, the
matches they come from when the Deadlock API supplied them, the WPA and its
souls-per-point price, and the measured buy time. A negative or refused WPA is a
sentence too, so the section never looks like a passive with a missing effect.

This supersedes the 2026-11-22 shape that deliberately had no title, no tags and
no type of its own. That shape was a reaction to the gold-panel overlay; the
answer to "it does not look like the card" is to use the card's passive classes,
not to flatten the numbers into bare lines.

## 2026-11-22 — the copy is checked, not trusted

The mod's layout file is the live build's file plus additions, and
`tools/check_live.py` proves the difference is exactly the additions by removing
them and comparing digests. That check is a design constraint, not housekeeping:
it is why the additions are marked with one `soul-lens:begin`/`soul-lens:end`
pair and why the script and stylesheet includes are single named lines.

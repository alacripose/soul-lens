"""Build the shop's details-tooltip override from the live build's own file.

The shop's hover card is `citadel_tooltip_mod_details`, not the `..._hover` layout
that was replaced first: hovering a shop item opens the details card, which is why
the strip did not appear in the game even when the addon was mounted. This takes
the live details layout exactly as extracted from the installed VPK, adds the
stylesheet, the scripts and the `#SoulLens` block, and writes the override.

The block goes directly under `#SectionsContainer`, where the card already draws
the item's own stat rows. That is the whole point of the placement: the strip is
card content inside the card's contoured ground, at the card's text density, and
it carries no prose beyond the six row keys — power, wpa, dps, buy, then the two
recommendation sources, `shop` (the shop's own recommended list) and `sl`
(statlocker's per-hero ranking).

The copy stays a copy: the only inserted text is inside the soul-lens:begin/end
markers, and tools/check_live.py removes that block before comparing the rest
with the installed build.

usage:
  python tools/overlay_details.py [--live data/live2/panorama/layout/tooltips/citadel_tooltip_mod_details.xml]
                                  [--out panorama/layout/tooltips/citadel_tooltip_mod_details.xml]
"""

from __future__ import annotations

import argparse
import pathlib
import sys

STYLE_LINE = '\t\t<include src="file://{resources}/styles/soul_lens.css" />\n'
SCRIPTS = (
    "\t<scripts>\n"
    '\t\t<include src="file://{resources}/scripts/soul_lens_build.js" />\n'
    '\t\t<include src="file://{resources}/scripts/soul_lens_data.js" />\n'
    '\t\t<include src="file://{resources}/scripts/soul_lens.js" />\n'
    "\t</scripts>\n"
)

# The stats block the card builds its item rows into; the strip sits right under
# it, still inside #AttributesContainer.
STATS_BLOCK = '\t\t\t\t\t\t<Panel id="SectionsContainer" class="TopBottomFlow" />\n'


def row(row_id: str, value_id: str, key: str) -> str:
    return (
        f'\t\t\t\t\t\t\t<Panel id="{row_id}" class="SoulLensRow LeftRightFlow">\n'
        f'\t\t\t\t\t\t\t\t<Label class="SoulLensKey componentsLabel" text="{key}" />\n'
        f'\t\t\t\t\t\t\t\t<Label id="{value_id}" class="SoulLensValue" text="" />\n'
        "\t\t\t\t\t\t\t</Panel>\n"
    )


ROWS = (
    row("SoulLensWpRow", "SoulLensWp", "power")
    + row("SoulLensWpaRow", "SoulLensWpa", "wpa")
    + row("SoulLensDpsRow", "SoulLensDps", "dps")
    + row("SoulLensBuyRow", "SoulLensBuy", "buy")
    + row("SoulLensShopRow", "SoulLensShop", "shop")
    + row("SoulLensSlRow", "SoulLensSl", "sl")
)

PANEL = (
    '\t\t\t\t\t\t<!-- soul-lens:begin (tools/check_live.py removes this block before comparing) -->\n'
    '\t\t\t\t\t\t<Panel id="SoulLens" class="SoulLens TopBottomFlow" hittest="false" hittestchildren="false">\n'
    + ROWS
    + "\t\t\t\t\t\t</Panel>\n"
    '\t\t\t\t\t\t<!-- soul-lens:end -->\n'
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", default="data/live2/panorama/layout/tooltips/citadel_tooltip_mod_details.xml")
    parser.add_argument("--out", default="panorama/layout/tooltips/citadel_tooltip_mod_details.xml")
    args = parser.parse_args()

    live = pathlib.Path(args.live)
    if not live.exists():
        print(f"REFUSED: {live} is not present; extract it from the installed build first", file=sys.stderr)
        return 1
    text = live.read_text(encoding="utf-8")
    if "soul-lens:begin" in text:
        print("REFUSED: the input already carries the block; extract a clean copy", file=sys.stderr)
        return 1
    if "</styles>" not in text or "</CitadelTooltipModDetails>" not in text:
        print("REFUSED: the layout does not look like citadel_tooltip_mod_details", file=sys.stderr)
        return 1
    if STATS_BLOCK not in text:
        print("REFUSED: the layout has no SectionsContainer to put the strip under", file=sys.stderr)
        return 1

    text = text.replace("\t</styles>\n", STYLE_LINE + "\t</styles>\n", 1)
    text = text.replace("\t</styles>\n", "\t</styles>\n" + SCRIPTS, 1)
    text = text.replace(STATS_BLOCK, STATS_BLOCK + PANEL, 1)

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    print(f"overlaid {out} ({len(text.splitlines())} lines, markers in place)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

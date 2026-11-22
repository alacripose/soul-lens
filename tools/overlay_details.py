"""Build the shop's details-tooltip override from the live build's own file.

The shop's hover card is `citadel_tooltip_mod_details`, not the `..._hover` layout
that was replaced first: hovering a shop item opens the details card, which is why
the strip did not appear in the game even when the addon was mounted. This takes
the live details layout exactly as extracted from the installed VPK, adds the
stylesheet, the two scripts and the `#SoulLens` panel, and writes the override.

The copy stays a copy: the only inserted text is inside the soul-lens:begin/end
markers, and tools/check_live.py2 compares the rest with the installed build.

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
    '\t\t<include src="file://{resources}/scripts/soul_lens_data.js" />\n'
    '\t\t<include src="file://{resources}/scripts/soul_lens.js" />\n'
    "\t</scripts>\n"
)
PANEL = """\t\t<!-- soul-lens:begin (tools/check_live.py removes this block before comparing) -->
\t\t<Panel id="SoulLens" class="SoulLens" hittest="false" hittestchildren="false">
\t\t\t<Panel class="SoulLensRule" />
\t\t\t<Label id="SoulLensHead" class="SoulLensHead" text="SOUL LENS" />
\t\t\t<Panel class="SoulLensRow">
\t\t\t\t<Label class="SoulLensKey" text="power" />
\t\t\t\t<Label id="SoulLensWp" class="SoulLensValue" text="reading the shop…" />
\t\t\t\t<Label id="SoulLensWpSrc" class="SoulLensTag" text="" />
\t\t\t</Panel>
\t\t\t<Panel class="SoulLensRow">
\t\t\t\t<Label class="SoulLensKey" text="wpa" />
\t\t\t\t<Label id="SoulLensWpa" class="SoulLensValue" text="" />
\t\t\t\t<Label id="SoulLensWpaSrc" class="SoulLensTag" text="" />
\t\t\t</Panel>
\t\t\t<Panel class="SoulLensRow">
\t\t\t\t<Label class="SoulLensKey" text="dps" />
\t\t\t\t<Label id="SoulLensDps" class="SoulLensValue" text="" />
\t\t\t\t<Label id="SoulLensDpsSrc" class="SoulLensTag" text="" />
\t\t\t</Panel>
\t\t\t<Label id="SoulLensBuy" class="SoulLensBuy" text="" />
\t\t\t<Label id="SoulLensSrc" class="SoulLensSrc" text="" />
\t\t</Panel>
\t\t<!-- soul-lens:end -->
"""


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

    text = text.replace("\t</styles>\n", STYLE_LINE + "\t</styles>\n", 1)
    text = text.replace("\t</styles>\n", "\t</styles>\n" + SCRIPTS, 1)
    close = "\t</CitadelTooltipModDetails>"
    text = text.replace(close, PANEL + close, 1)

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    print(f"overlaid {out} ({len(text.splitlines())} lines, markers in place)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

// Soul Lens: fill the strip under the built-in shop item hover card.
//
// This file is included by the mod's copy of panorama/layout/tooltips/
// citadel_tooltip_mod_hover.xml, so it runs once per hover card and shares that
// card's context panel. It never throws into the tooltip: the stock card is the
// game's own layout, and a missing data row, a renamed panel or a closed shop must
// leave the card exactly as Valve drew it.
//
// What it reads, in order:
//   1. the card itself (`#ModView`) - item name and price, live values
//   2. window.SoulLensData, baked by tools/ingest.py - weapon terms, per-hero
//      WPA from recorded wins and losses, and measured purchase times
//   3. the open shop, when it can be found - the hero name, and the item's place
//      in the visible list ("3 of 12 in this list")
//
// Every row carries the source of its number. A number that a source cannot
// answer for is a sentence in the row, never a zero or a blank.
(function () {
    "use strict";

    function log(text) {
        try { $.Msg("[soul-lens] ", text); } catch (e) {}
    }

    function normalize(name) {
        return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/^\s+|\s+$/g, "");
    }

    function data() {
        // Panorama's global object is not `window`; the baked file declares a bare
        // global and the browser witness also attaches it to window.
        try { if (typeof SoulLensData !== "undefined" && SoulLensData) return SoulLensData; } catch (e) {}
        try { return window.SoulLensData || null; } catch (e) { return null; }
    }

    // The installed build is stamped by tools/stamp_build.py at install time:
    // Panorama has no build API and cannot read steam.inf, and the install is the
    // one place that file is readable. A missing stamp is a refusal, not a guess.
    function liveBuild() {
        try { if (typeof SoulLensLiveBuild !== "undefined" && SoulLensLiveBuild) return String(SoulLensLiveBuild); } catch (e) {}
        try { return window.SoulLensLiveBuild ? String(window.SoulLensLiveBuild) : ""; } catch (e) { return ""; }
    }

    // Weapon terms belong to a build. The current bake is the build the ingest ran
    // on; any other installed build must have its own archived snapshot
    // (tools/terms_archive.py) or the terms are withheld. WPA and purchase times
    // are match measurements, not build contents, so they still draw.
    function termsFor(document, live) {
        if (!live) return { refusal: "installed build not stamped; run install.ps1" };
        if (!document.build) return { refusal: "bake build unknown" };
        if (document.build === live) return { terms: document.items || {}, build: live };
        var archived = document.term_builds ? document.term_builds[live] : null;
        if (archived) return { terms: archived, build: live };
        return { refusal: "no terms baked for build " + live, baked: document.build };
    }

    function text(panel) {
        try { return panel && panel.text ? String(panel.text) : ""; } catch (e) { return ""; }
    }

    function byId(root, id) {
        try { return root.FindChildTraverse(id); } catch (e) { return null; }
    }

    function hasClass(panel, needle) {
        // Panorama panels expose HasClass; GetAttributeString is not a panel method and
        // silently returned nothing, which is why hero detection never matched.
        try { if (panel.HasClass && panel.HasClass(needle)) return true; } catch (e) {}
        try {
            var cls = panel.GetAttributeString ? (panel.GetAttributeString("class", "") || "") : "";
            return cls.toLowerCase().indexOf(String(needle).toLowerCase()) !== -1;
        } catch (e) { return false; }
    }

    function kids(panel) {
        var out = [];
        var count = 0;
        try { count = panel.GetChildCount ? panel.GetChildCount() : 0; } catch (e) { count = 0; }
        for (var i = 0; i < count; i += 1) {
            var kid = null;
            try { kid = panel.GetChild(i); } catch (e) { kid = null; }
            if (kid) out.push(kid);
        }
        return out;
    }

    // The card's name label is `.modName`; the price is `#ItemCost`. Both sit under
    // #ModView in the stock layout, and both are re-written when the card is reused
    // for the next hovered item, so they are read every tick rather than cached.
    function readCard(root) {
        var view = byId(root, "ModView") || byId(root, "CitadelTooltipModDetails") || root;
        // The details tooltip names the item `#ModName`; the hover card names it
        // `.modName`. Both are read here so the same script serves either layout.
        var nameNode = byId(view, "ModName") || byId(root, "ModName");
        var queue = [view];
        var seen = 0;
        while (queue.length && !nameNode && seen < 120) {
            var panel = queue.shift();
            seen += 1;
            if (hasClass(panel, "modname")) nameNode = panel;
            var next = kids(panel);
            for (var i = 0; i < next.length; i += 1) queue.push(next[i]);
        }
        var name = text(nameNode);
        if (!name) {
            try {
                name = view.mod_name ? String(view.mod_name) : "";
            } catch (e) { name = ""; }
        }
        var costNode = byId(view, "ItemCost") || byId(root, "ItemCost") || byId(view, "ModCost");
        if (!costNode) {
            var costQueue = [view];
            var costSeen = 0;
            while (costQueue.length && !costNode && costSeen < 120) {
                var costPanel = costQueue.shift();
                costSeen += 1;
                if (hasClass(costPanel, "modcost")) costNode = costPanel;
                var costKids = kids(costPanel);
                for (var ci = 0; ci < costKids.length; ci += 1) costQueue.push(costKids[ci]);
            }
        }
        var cost = 0;
        try { cost = parseInt(String(text(costNode)).replace(/[^0-9]/g, ""), 10) || 0; } catch (e) { cost = 0; }
        return { name: name, cost: cost };
    }

    function clock(seconds) {
        var s = Math.round(Number(seconds) || 0);
        if (s <= 0) return "";
        var m = Math.floor(s / 60);
        var rest = s % 60;
        return m + ":" + (rest < 10 ? "0" + rest : String(rest));
    }

    function souls(value) {
        if (value === null || value === undefined || !isFinite(value)) return "";
        return Math.round(Number(value)) + " souls";
    }

    // WPA is a percentage-point figure; below one point the first decimal would
    // read as zero, so it keeps two.
    function points(value) {
        var number = Number(value);
        if (!isFinite(number)) return String(value);
        var digits = Math.abs(number) < 10 ? 2 : 1;
        var sign = number > 0 ? "+" : (number < 0 ? "" : "+");
        return sign + number.toFixed(digits);
    }

    // The hero's name is in the shop layout, and a tooltip is its own popup tree:
    // the label is a *class* (`HeroFavoritesHeaderLabel`), not an id, and it is not
    // an ancestor of the card. Walk to the outermost ancestor this context can see
    // and search that subtree by class, bounded so a huge HUD cannot stall a hover.
    function heroName() {
        try {
            var node = $.GetContextPanel();
            var outer = node;
            var up = 0;
            while (node && up < 60) {
                outer = node;
                node = node.GetParent ? node.GetParent() : null;
                up += 1;
            }
            // Panorama's own class lookup is cheap and exact; the manual BFS below is
            // only a fallback for the browser witness.
            try {
                var hits = outer.FindChildrenWithClassTraverse ? outer.FindChildrenWithClassTraverse("HeroFavoritesHeaderLabel") : null;
                if (hits && hits.length) {
                    var hitText = text(hits[0]);
                    if (hitText) {
                        var hitMatch = hitText.match(/^(.+?)'s /);
                        return hitMatch ? hitMatch[1] : hitText;
                    }
                }
            } catch (e) {}
            var queue = [outer];
            var seen = 0;
            while (queue.length && seen < 6000) {
                var panel = queue.shift();
                seen += 1;
                if (hasClass(panel, "HeroFavoritesHeaderLabel")) {
                    var raw = text(panel);
                    if (raw) {
                        var match = raw.match(/^(.+?)'s /);
                        return match ? match[1] : raw;
                    }
                }
                var next = kids(panel);
                for (var i = 0; i < next.length; i += 1) queue.push(next[i]);
            }
        } catch (e) {}
        return "";
    }

    // The list the shop is showing. Entries are panels whose class says `mod` and
    // whose subtree carries a name label; the hovered item's index is its place in
    // that order, which is the shop build menu's own ordering, not a guess.
    function listPosition(itemName) {
        if (!itemName) return "";
        try {
            var node = $.GetContextPanel();
            var container = null;
            var guard = 0;
            while (node && guard < 60 && !container) {
                container = node.FindChildTraverse ? node.FindChildTraverse("ShopModListsContainer") : null;
                node = node.GetParent ? node.GetParent() : null;
                guard += 1;
            }
            if (!container) return "";
            var entries = [];
            var queue = [container];
            var seen = 0;
            while (queue.length && seen < 2500) {
                var panel = queue.shift();
                seen += 1;
                var id = "";
                try { id = panel.id || ""; } catch (e) { id = ""; }
                if (/shop.?mod.?list/i.test(id) || hasClass(panel, "modlist")) entries.push(panel);
                var next = kids(panel);
                for (var i = 0; i < next.length; i += 1) queue.push(next[i]);
            }
            if (!entries.length) return "";
            var wanted = normalize(itemName);
            var names = [];
            for (var e = 0; e < entries.length; e += 1) {
                var found = null;
                var walk = [entries[e]];
                var steps = 0;
                while (walk.length && !found && steps < 400) {
                    var row = walk.shift();
                    steps += 1;
                    if (hasClass(row, "modname")) found = text(row);
                    var children = kids(row);
                    for (var c = 0; c < children.length; c += 1) walk.push(children[c]);
                }
                if (found) names.push(normalize(found));
            }
            for (var n = 0; n < names.length; n += 1) {
                if (names[n] === wanted) return (n + 1) + " of " + names.length + " in this list";
            }
        } catch (e) {}
        return "";
    }

    function setRow(node, value, missing, tag, tagText, tagMissing) {
        if (node) {
            node.text = value;
            try {
                node.RemoveClass("SoulLensHave");
                node.RemoveClass("SoulLensNone");
                node.AddClass(missing ? "SoulLensNone" : "SoulLensHave");
            } catch (e) {}
        }
        if (tag) {
            tag.text = tagText || "";
            try {
                tag.RemoveClass("SoulLensTagNone");
                if (tagMissing) tag.AddClass("SoulLensTagNone");
            } catch (e) {}
        }
    }

    // Which WPA the strip may print: statlocker's when its keyed answer carried the
    // item, otherwise the measured one for this hero, and otherwise the reason the
    // measured one is not there.
    function wpaReading(document, hero, heroRow, key, row, cost) {
        var sources = document.sources || {};
        var sl = sources["statlocker"] || {};
        if (sl.state === "read" && row && typeof row.wpa === "number") {
            return {
                source: "sl",
                value: row.wpa,
                matches: null,
                ratio: cost && row.wpa > 0 ? Math.round(cost / row.wpa) : null,
            };
        }
        if (!hero) {
            return { refusal: "no hero", source: "api" };
        }
        if (!heroRow) {
            return { refusal: "no hero rows", source: "api" };
        }
        var measured = heroRow.wpa ? heroRow.wpa[key] : null;
        if (!measured) {
            return { refusal: "no item row", source: "api" };
        }
        var minimum = (document.model && document.model.min_matches) || 0;
        if (measured.matches < minimum) {
            return { refusal: measured.matches + "m<" + minimum, source: "api" };
        }
        return {
            source: "dl-api",
            value: measured.wpa,
            matches: measured.matches,
            ratio: cost && measured.wpa > 0 ? Math.round(cost / measured.wpa) : null,
        };
    }

    // Terse by construction: no title, no tags, no sentence. Each row is a
    // number or a one-word refusal, and a row with nothing to say is collapsed so
    // an item with no weapon term does not print "none".
    // Souls paid per one percentage point of the effect, and the unit says so:
    // a small measured effect gives a large price per point (a bad-value signal),
    // which read as a payout when the unit was only implied.
    function ratio(cost, gain) {
        if (!cost || !gain || gain <= 0) return "";
        var souls = cost / gain;
        var shown = souls >= 1000 ? (souls / 1000).toFixed(1) + "k" : String(Math.round(souls));
        return shown + "/1%";
    }

    function fill(rowPanel, valuePanel, value, has) {
        if (valuePanel) valuePanel.text = value || "";
        if (!rowPanel) return;
        try {
            if (rowPanel.SetHasClass) rowPanel.SetHasClass("SoulLensHidden", !has);
            else if (has) rowPanel.RemoveClass("SoulLensHidden");
            else rowPanel.AddClass("SoulLensHidden");
        } catch (e) {}
    }

    function render(block, card, document) {
        var wpRow = byId(block, "SoulLensWpRow");
        var wpaRow = byId(block, "SoulLensWpaRow");
        var dpsRow = byId(block, "SoulLensDpsRow");
        var buyRow = byId(block, "SoulLensBuyRow");

        var key = normalize(card.name);
        var row = key && document && document.items ? document.items[key] : null;
        if (!row) {
            fill(wpRow, byId(block, "SoulLensWp"), "", false);
            fill(wpaRow, byId(block, "SoulLensWpa"), "", false);
            fill(dpsRow, byId(block, "SoulLensDps"), "", false);
            fill(buyRow, byId(block, "SoulLensBuy"), "", false);
            return;
        }

        var live = liveBuild();
        var picked = termsFor(document, live);
        var term = picked.terms && key ? picked.terms[key] : null;
        var termCost = term && term.cost ? term.cost : null;
        var cost = card.cost || termCost || row.cost;

        if (picked.refusal) {
            fill(wpRow, byId(block, "SoulLensWp"), live ? "no " + live : "no build", true);
            fill(dpsRow, byId(block, "SoulLensDps"), "", false);
        } else {
            fill(wpRow, byId(block, "SoulLensWp"),
                term && term.wp > 0 ? "+" + term.wp + "% · " + ratio(cost, term.wp) : "", term && term.wp > 0);
            fill(dpsRow, byId(block, "SoulLensDps"),
                term && term.dps > 0 ? "+" + term.dps.toFixed(1) + "% · " + ratio(cost, term.dps) : "",
                term && term.dps > 0);
        }

        var hero = heroName();
        var heroRow = hero && document.heroes ? document.heroes[normalize(hero)] : null;
        var reading = wpaReading(document, hero, heroRow, key, row, cost);
        if (reading.refusal) {
            fill(wpaRow, byId(block, "SoulLensWpa"), reading.refusal, true);
        } else if (reading.value <= 0) {
            fill(wpaRow, byId(block, "SoulLensWpa"), points(reading.value) + "% · no gain", true);
        } else {
            fill(wpaRow, byId(block, "SoulLensWpa"),
                points(reading.value) + "% · " + ratio(cost, reading.value), true);
        }

        var heroBuy = heroRow && heroRow.buy ? heroRow.buy[key] : null;
        var minute = clock(heroBuy || row.avg_buy_s);
        fill(buyRow, byId(block, "SoulLensBuy"), minute, !!minute);
    }

    function start() {
        var root = null;
        try { root = $.GetContextPanel(); } catch (e) { root = null; }
        if (!root) { log("no context panel; hover card untouched"); return; }

        var block = byId(root, "SoulLens");
        if (!block) { log("no SoulLens block in the layout; hover card untouched"); return; }

        var document = data();
        if (!document) {
            setRow(byId(block, "SoulLensWp"), "no data", true);
            log("data refused: no SoulLensData global");
            return;
        }

        // State the reading row before the card is filled, so a strip that never
        // receives a name says so instead of showing an empty line.
        render(block, { name: "", cost: 0 }, document);

        var lastKey = "";
        var ticks = 0;
        function tick() {
            try {
                var card = readCard(root);
                var key = normalize(card.name) + "|" + card.cost;
                // The card is filled after it is created, so the first few ticks see
                // an empty name; once it holds a name the strip is written, and it is
                // rewritten only when the card is reused for another item.
                if (key !== lastKey && card.name) {
                    lastKey = key;
                    render(block, card, document);
                }
                ticks += 1;
                $.Schedule(0.1, tick);
            } catch (e) {
                log("tick refused: " + String(e));
            }
        }
        tick();
    }

    try {
        $.Schedule(0.01, start);
    } catch (e) {
        log("REFUSED: " + String(e) + "; hover card untouched");
    }
})();

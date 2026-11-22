// Soul Lens: fill the strip under the built-in shop item hover card.
//
// This file is included by the mod's copy of panorama/layout/tooltips/
// citadel_tooltip_mod_details.xml, so it runs once per hover card and shares that
// card's context panel. It never throws into the tooltip: the stock card is the
// game's own layout, and a missing data row, a renamed panel or a closed shop must
// leave the card exactly as Valve drew it.
//
// What it reads, in order:
//   1. the card itself (`#ModView`) - item name and price, live values
//   2. window.SoulLensData, baked by tools/ingest.py - weapon terms, per-hero
//      measured WPA and purchase times, and Statlocker's per-hero ranking
//   3. the open shop, when it can be found - the hero the header names, and the
//      hovered item's place in the shop's own recommended list (`#ShopModsRecommended`)
//
// Every row carries the source of its number. A number that a source cannot
// answer for is a sentence in the row, never a zero or a blank, and never another
// item's or another hero's number.
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

    // Every descendant of `panel` carrying `needle`, in tree order. Panorama's own
    // class lookup is exact and cheap, so it is tried first; the bounded walk is the
    // fallback for the browser witness and for a class spelled another way.
    function collect(panel, needle) {
        if (!panel) return [];
        try {
            var hits = panel.FindChildrenWithClassTraverse ? panel.FindChildrenWithClassTraverse(needle) : null;
            if (hits && hits.length) return hits;
        } catch (e) {}
        var out = [];
        var queue = [panel];
        var seen = 0;
        while (queue.length && seen < 4000) {
            var node = queue.shift();
            seen += 1;
            if (hasClass(node, needle)) out.push(node);
            var next = kids(node);
            for (var i = 0; i < next.length; i += 1) queue.push(next[i]);
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

    // A tooltip is its own popup tree, and the shop is not an ancestor of the card
    // but the outermost panel this context can see. Both the hero label and the
    // recommended list are found from there.
    function outerPanel() {
        try {
            var node = $.GetContextPanel();
            var outer = node;
            var up = 0;
            while (node && up < 60) {
                outer = node;
                node = node.GetParent ? node.GetParent() : null;
                up += 1;
            }
            return outer;
        } catch (e) { return null; }
    }

    // The hero's name is a *class* (`HeroFavoritesHeaderLabel`) in the shop layout, not
    // an id, and it reads "<Hero>'s Recommended Mods".
    function heroName() {
        var outer = outerPanel();
        if (!outer) return "";
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
        return "";
    }

    // The shop's own recommendation list. `citadel_hud_hero_shop.xml` puts it at
    // `#ShopModsRecommended`; the hero-build editor is a different panel and is not
    // read here. Each entry is a `CitadelShopMod` (`mod_view`) carrying a `.modName`
    // label, and the item's place in that list is the shop's own ordering.
    function shopRecommendation(itemName) {
        if (!itemName) return { value: "" };
        var outer = outerPanel();
        if (!outer) return { refusal: "no shop" };
        var list = byId(outer, "ShopModsRecommended");
        if (!list) return { refusal: "no list" };
        var entries = collect(list, "mod_view");
        var names = [];
        for (var i = 0; i < entries.length; i += 1) {
            var labels = collect(entries[i], "modName");
            var name = labels.length ? text(labels[0]) : "";
            var key = normalize(name);
            if (key && names.indexOf(key) === -1) names.push(key);
        }
        if (!names.length) return { refusal: "no list" };
        var index = names.indexOf(normalize(itemName));
        if (index === -1) return { refusal: "not listed" };
        return { value: "#" + (index + 1) + "/" + names.length };
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

    // Statlocker's own per-hero ranking, baked by tools/ingest.py from the endpoint its
    // hero page calls. The rank is a place in that hero's table, the percentage is the
    // share of that hero's analyzed matches that bought the item. A source that did not
    // answer says so; an item it did not rank says that instead.
    function slReading(document, hero, heroRow, key) {
        var source = (document.sources && document.sources["statlocker-ranks"]) || null;
        if (!source || source.state !== "read") return { refusal: "unavailable" };
        if (!hero) return { refusal: "no hero" };
        if (!heroRow) return { refusal: "no hero rows" };
        var row = heroRow.sl ? heroRow.sl[key] : null;
        if (!row) return { refusal: "not listed" };
        // A pick rate under ten percent keeps a decimal: rounding 1.27% to "1%" erases the
        // difference between a niche item and one nobody buys.
        var pick = typeof row.pick === "number"
            ? (row.pick < 10 ? row.pick.toFixed(1) : String(Math.round(row.pick)))
            : null;
        return { value: "#" + row.rank + "/" + row.of + (pick === null ? "" : " \u00b7 " + pick + "%") };
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
        var shopRow = byId(block, "SoulLensShopRow");
        var slRow = byId(block, "SoulLensSlRow");

        var key = normalize(card.name);
        var row = key && document && document.items ? document.items[key] : null;
        if (!row) {
            fill(wpRow, byId(block, "SoulLensWp"), "", false);
            fill(wpaRow, byId(block, "SoulLensWpa"), "", false);
            fill(dpsRow, byId(block, "SoulLensDps"), "", false);
            fill(buyRow, byId(block, "SoulLensBuy"), "", false);
            fill(shopRow, byId(block, "SoulLensShop"), "", false);
            fill(slRow, byId(block, "SoulLensSl"), "", false);
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
                term && term.wp > 0 ? "+" + term.wp + "% \u00b7 " + ratio(cost, term.wp) : "", term && term.wp > 0);
            fill(dpsRow, byId(block, "SoulLensDps"),
                term && term.dps > 0 ? "+" + term.dps.toFixed(1) + "% \u00b7 " + ratio(cost, term.dps) : "",
                term && term.dps > 0);
        }

        var hero = heroName();
        var heroRow = hero && document.heroes ? document.heroes[normalize(hero)] : null;
        var reading = wpaReading(document, hero, heroRow, key, row, cost);
        if (reading.refusal) {
            fill(wpaRow, byId(block, "SoulLensWpa"), reading.refusal, true);
        } else if (reading.value <= 0) {
            fill(wpaRow, byId(block, "SoulLensWpa"), points(reading.value) + "% \u00b7 no gain", true);
        } else {
            fill(wpaRow, byId(block, "SoulLensWpa"),
                points(reading.value) + "% \u00b7 " + ratio(cost, reading.value), true);
        }

        var heroBuy = heroRow && heroRow.buy ? heroRow.buy[key] : null;
        var minute = clock(heroBuy || row.avg_buy_s);
        fill(buyRow, byId(block, "SoulLensBuy"), minute, !!minute);

        // A throw in either recommendation read must not take the card with it, and it
        // must not leave an empty row that reads as "no opinion": the row says which
        // reader refused.
        var shop = null;
        try { shop = shopRecommendation(card.name); } catch (e) {
            shop = { refusal: "shop err" };
            log("shop read refused: " + String(e));
        }
        // A row is collapsed only when it has nothing to say. Hiding it on "no refusal"
        // collapsed every row that succeeded, which is the report it exists to make.
        fill(shopRow, byId(block, "SoulLensShop"), shop.refusal || shop.value,
            !!(shop.refusal || shop.value));

        var locker = null;
        try { locker = slReading(document, hero, heroRow, key); } catch (e) {
            locker = { refusal: "sl err" };
            log("statlocker read refused: " + String(e));
        }
        fill(slRow, byId(block, "SoulLensSl"), locker.refusal || locker.value,
            !!(locker.refusal || locker.value));
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
                // rewritten only when the card is reused for another item. The slow
                // re-render catches the one case the card cannot: the same item hovered
                // across a hero change (a new match's shop), which must not keep the
                // previous hero's ranking.
                if (card.name && (key !== lastKey || ticks % 50 === 0)) {
                    lastKey = key;
                    render(block, card, document);
                }
                ticks += 1;
                // The card is one panel reused for every hover and lives as long as the
                // tooltip, so this loop is not bounded: a fixed budget froze the strip on
                // whichever item was hovered when the budget ran out.
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

// Soul Lens: fill the strip under the built-in shop item hover card.
//
// This file is included by the mod's copy of panorama/layout/tooltips/
// citadel_tooltip_mod_hover.xml, so it runs once per hover card and shares that
// card's context panel. It never throws into the tooltip: the stock card is the
// game's own layout, and a missing data row, a renamed panel or a closed shop must
// leave the card exactly as Valve drew it.
//
// What it reads, in order:
//   1. the card itself (`#ModView`) - item name and price, which are live values
//   2. window.SoulLensData, baked by tools/ingest.py - the weapon terms and the
//      measured buy time
//   3. the open shop, when it can be found - the hero name and the item's place in
//      the visible list ("3 of 12 in this tab")
//
// Nothing is computed from a hero baseline here. "souls / +1% power" and
// "souls / +1% dps" are item-local, so a number is either in the data with a named
// source behind it or the row says it has none.
(function () {
    "use strict";

    function log(text) {
        try { $.Msg("[soul-lens] ", text); } catch (e) {}
    }

    function normalize(name) {
        return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/^\s+|\s+$/g, "");
    }

    function data() {
        try { return window.SoulLensData || null; } catch (e) { return null; }
    }

    function text(panel) {
        try { return panel && panel.text ? String(panel.text) : ""; } catch (e) { return ""; }
    }

    function byId(root, id) {
        try { return root.FindChildTraverse(id); } catch (e) { return null; }
    }

    function hasClass(panel, needle) {
        try {
            var cls = panel.GetAttributeString ? (panel.GetAttributeString("class", "") || "") : "";
            return cls.toLowerCase().indexOf(needle) !== -1;
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
        var view = byId(root, "ModView") || root;
        var nameNode = null;
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
        var costNode = byId(view, "ItemCost") || byId(root, "ItemCost");
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

    function heroName() {
        try {
            var rootPanel = $.GetContextPanel();
            var node = rootPanel;
            var guard = 0;
            while (node && guard < 40) {
                var label = node.FindChildTraverse ? node.FindChildTraverse("HeroFavoritesHeaderLabel") : null;
                if (label) {
                    var raw = text(label);
                    var match = raw.match(/^(.+?)'s /);
                    if (match) return match[1];
                    return raw;
                }
                node = node.GetParent ? node.GetParent() : null;
                guard += 1;
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

    function setRow(node, value, missing) {
        if (!node) return;
        node.text = value;
        try {
            node.RemoveClass("SoulLensHave");
            node.RemoveClass("SoulLensNone");
            node.AddClass(missing ? "SoulLensNone" : "SoulLensHave");
        } catch (e) {}
    }

    function render(block, card, document) {
        var head = byId(block, "SoulLensHead");
        var wpRow = byId(block, "SoulLensWp");
        var dpsRow = byId(block, "SoulLensDps");
        var buyRow = byId(block, "SoulLensBuy");
        var srcRow = byId(block, "SoulLensSrc");

        var hero = heroName();
        if (head) head.text = hero ? ("SOUL LENS · " + hero.toUpperCase()) : "SOUL LENS";

        var key = normalize(card.name);
        var row = key && document && document.items ? document.items[key] : null;
        if (!row) {
            setRow(wpRow, key ? "no stat line for this item" : "reading the shop…", true);
            setRow(dpsRow, "", true);
            if (buyRow) buyRow.text = "";
            if (srcRow) srcRow.text = document ? "soul-lens data: " + (document.build || "unknown build") : "soul-lens data missing";
            return;
        }

        var cost = card.cost || row.cost;
        var priceNote = "";
        if (card.cost && row.cost && card.cost !== row.cost) {
            priceNote = " (baked " + row.cost + ", live " + card.cost + ")";
        }

        if (row.wp > 0) {
            setRow(wpRow, "+" + row.wp + "% power · " + souls(row.souls_per_wp) + " / +1%", false);
        } else {
            setRow(wpRow, "no weapon power term", true);
        }
        if (row.dps > 0) {
            setRow(dpsRow, "+" + row.dps.toFixed(1) + "% dps · " + souls(row.souls_per_dps) + " / +1%", false);
        } else {
            setRow(dpsRow, "no standing dps term", true);
        }

        // The hero on the shop header decides the buy line. The API was asked per
        // hero, so this is that hero's own measured minute, not the global average
        // wearing the hero's name; when the hero has no rows the average is used and
        // labelled.
        var heroKey = normalize(hero);
        var heroRow = heroKey && document.heroes ? document.heroes[heroKey] : null;
        var heroBuy = heroRow && heroRow.buy ? heroRow.buy[key] : null;
        var parts = [];
        if (heroBuy) parts.push("buy ≈ " + clock(heroBuy) + " (" + heroRow.name + ")");
        else if (row.avg_buy_s) parts.push("buy ≈ " + clock(row.avg_buy_s) + " (average)");
        if (row.sl_slot) parts.push("statlocker build #" + row.sl_slot);
        var place = listPosition(card.name);
        if (place) parts.push(place);
        if (buyRow) buyRow.text = parts.join(" · ");

        var sources = ["deadlock-api"];
        var sl = document.sources && document.sources["statlocker"];
        if (sl && sl.state === "read") sources.push("statlocker");
        else if (sl) sources.push("statlocker: " + (sl.reason || sl.state));
        if (row.wpa !== undefined && row.wpa !== null) sources.push("WPA " + row.wpa);
        if (priceNote) sources.push(priceNote.replace(/^ \(|\)$/g, ""));
        if (srcRow) srcRow.text = sources.join(" · ");
    }

    function start() {
        var root = null;
        try { root = $.GetContextPanel(); } catch (e) { root = null; }
        if (!root) { log("no context panel; hover card untouched"); return; }

        var block = byId(root, "SoulLens");
        if (!block) { log("no SoulLens block in the layout; hover card untouched"); return; }

        var document = data();
        if (!document) {
            setRow(byId(block, "SoulLensWp"), "soul_lens_data.js did not load", true);
            log("data refused: no window.SoulLensData");
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
                if (ticks > 400) return;
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

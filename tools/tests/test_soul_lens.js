// The Soul Lens harness: run the shipped script against a fake Panorama tree.
//
// The tooltip is the game's own panel, so the behaviour that matters here is what
// the script does with a tree it did not build: read the card, write the strip,
// label each row with its source, refuse an unknown item, and never throw. The
// panel API below is the subset the script uses (FindChildTraverse,
// GetChildCount/GetChild, GetAttributeString, GetParent, text, AddClass/RemoveClass),
// so a method the script calls and the game does not have would show up here as a
// missing function first.
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");

class Panel {
    constructor(id, className, parent) {
        this.id = id || "";
        this.className = className || "";
        this.parent = parent || null;
        this.children = [];
        this.textValue = "";
        this.classes = new Set(this.className.split(/\s+/).filter(Boolean));
        this.style = {};
        if (parent) parent.children.push(this);
    }
    get text() { return this.textValue; }
    set text(value) { this.textValue = String(value == null ? "" : value); }
    FindChildTraverse(id) {
        if (this.id === id) return this;
        for (const child of this.children) {
            const found = child.FindChildTraverse(id);
            if (found) return found;
        }
        return null;
    }
    GetChildCount() { return this.children.length; }
    GetChild(index) { return this.children[index] || null; }
    GetParent() { return this.parent; }
    GetAttributeString(key) { return key === "class" ? (this.className || "") : ""; }
    AddClass(name) { this.classes.add(name); }
    RemoveClass(name) { this.classes.delete(name); }
    HasClass(name) { return this.classes.has(name); }
}

function tree(itemName, cost, hero) {
    const root = new Panel("", "root", null);
    if (hero) {
        const header = new Panel("HeroFavoritesHeaderLabel", "HeroFavoritesHeaderLabel", root);
        header.text = hero + "'s Recommended Mods";
    }
    const contents = new Panel("", "ModHoverContents", root);
    new Panel("BackgroundTexture", "", contents);
    const view = new Panel("ModView", "", contents);
    const card = new Panel("ModCard", "", view);
    const nameArea = new Panel("", "mod_name_area", card);
    const name = new Panel("", "modName", nameArea);
    name.text = itemName;
    const costLabel = new Panel("ItemCost", "", card);
    costLabel.text = String(cost);
    const lens = new Panel("SoulLens", "SoulLens", contents);
    new Panel("SoulLensHead", "SoulLensHead", lens);
    for (const row of [["SoulLensWp", "SoulLensWpSrc"], ["SoulLensWpa", "SoulLensWpaSrc"],
                       ["SoulLensDps", "SoulLensDpsSrc"]]) {
        const wrapper = new Panel("", "SoulLensRow", lens);
        new Panel("", "SoulLensKey", wrapper);
        new Panel(row[0], "SoulLensValue", wrapper);
        new Panel(row[1], "SoulLensTag", wrapper);
    }
    new Panel("SoulLensBuy", "SoulLensBuy", lens);
    new Panel("SoulLensSrc", "SoulLensSrc", lens);
    return { root, lens };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function load(panel, dataSource) {
    const queue = [];
    const sandbox = {
        console,
        window: {},
        $: {
            Msg() {},
            GetContextPanel: () => panel,
            Schedule(delay, fn) { queue.push(fn); },
            CreatePanel() { return new Panel("", "", panel); },
        },
    };
    vm.createContext(sandbox);
    if (dataSource !== null) {
        const source = "window.SoulLensData = " + JSON.stringify(dataSource) + ";";
        vm.runInContext(source, sandbox);
    } else {
        sandbox.window.SoulLensData = null;
    }
    vm.runInContext(fs.readFileSync(path.join(ROOT, "panorama/scripts/soul_lens.js"), "utf8"), sandbox);
    // Drain a bounded number of scheduled callbacks: the script ticks four times a
    // second for forty seconds, so three ticks is a card that has been filled.
    for (let step = 0; step < 3 && queue.length; step += 1) queue.shift()();
    return { panel, queue };
}

function rowOf(lens, id) { return lens.FindChildTraverse(id); }
function tagOf(lens, id) { return lens.FindChildTraverse(id); }

let failures = 0;
function check(name, condition, detail) {
    if (condition) {
        console.log("ok   " + name);
    } else {
        failures += 1;
        console.log("FAIL " + name + (detail ? " :: " + detail : ""));
    }
}

const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data/items.json"), "utf8"));
const minMatches = data.model.min_matches;

// A worked example: a hero with a positive, well-sampled WPA row for a weapon item.
const worked = (() => {
    for (const [heroKey, hero] of Object.entries(data.heroes)) {
        for (const [itemKey, measured] of Object.entries(hero.wpa)) {
            const item = data.items[itemKey];
            if (!item || measured.wpa <= 0 || measured.matches < minMatches) continue;
            if (!item.souls_per_wp) continue;
            return { hero, heroKey, item, measured };
        }
    }
    return null;
})();

{
    check("the bake has a worked example", worked !== null);
    const { root, lens } = tree(worked.item.name, worked.item.cost, worked.hero.name);
    load(root, data);
    const wp = rowOf(lens, "SoulLensWp").text;
    check("weapon row names the ratio", wp.includes("souls / +1%"), wp);
    check("weapon row uses the catalog number", wp.includes("+" + worked.item.wp + "% power"), wp);
    check("weapon row is tagged with its source", tagOf(lens, "SoulLensWpSrc").text === "dl-api",
        tagOf(lens, "SoulLensWpSrc").text);

    const wpa = rowOf(lens, "SoulLensWpa").text;
    check("wpa row prints the measured percentage", wpa.includes("WPA"), wpa);
    check("wpa row names souls per +1%", wpa.includes("souls / +1%"), wpa);
    const expected = Math.round(worked.item.cost / worked.measured.wpa);
    check("wpa ratio is cost over the measured wpa", wpa.includes(String(expected)), wpa);
    check("wpa row is tagged dl-api", tagOf(lens, "SoulLensWpaSrc").text === "dl-api",
        tagOf(lens, "SoulLensWpaSrc").text);

    const dps = rowOf(lens, "SoulLensDps").text;
    check("dps row is present", dps.includes("souls / +1%"), dps);
    check("dps row is tagged with its source", tagOf(lens, "SoulLensDpsSrc").text === "dl-api",
        tagOf(lens, "SoulLensDpsSrc").text);

    const buy = rowOf(lens, "SoulLensBuy").text;
    check("buy line carries the hero's own measured time", buy.includes("(" + worked.hero.name + ")"), buy);
    const src = rowOf(lens, "SoulLensSrc").text;
    check("source line names statlocker's refusal", src.includes("statlocker"), src);
}

{
    // statlocker, when its keyed answer carries the item, is the WPA the row prints.
    const itemKey = Object.keys(data.items).find((key) => data.items[key].souls_per_wp);
    const item = data.items[itemKey];
    const withStatlocker = clone(data);
    withStatlocker.sources.statlocker = { state: "read", rows: 1, skipped: 0, reason: null };
    withStatlocker.items[itemKey].wpa = 0.5;
    const { root, lens } = tree(item.name, item.cost);
    load(root, withStatlocker);
    const wpa = rowOf(lens, "SoulLensWpa").text;
    check("statlocker wpa is printed", wpa.includes("+0.5% WPA"), wpa);
    check("statlocker wpa ratio uses statlocker's figure", wpa.includes(String(Math.round(item.cost / 0.5))), wpa);
    check("statlocker row is tagged statlocker", tagOf(lens, "SoulLensWpaSrc").text === "statlocker",
        tagOf(lens, "SoulLensWpaSrc").text);
}

{
    // A hero the bake does not know must explain itself, not fall back to a number
    // that belongs to another hero.
    const itemKey = Object.keys(data.items).find((key) => data.items[key].souls_per_wp);
    const { root, lens } = tree(data.items[itemKey].name, data.items[itemKey].cost, "Test Hero");
    load(root, data);
    const wpa = rowOf(lens, "SoulLensWpa").text;
    check("an unknown hero is named in the wpa row", wpa.includes("no Test Hero rows in this bake"), wpa);
    check("the unknown hero row is styled as missing", tagOf(lens, "SoulLensWpaSrc").HasClass("SoulLensTagNone"));
}

{
    // An item the hero has no rows for is a sentence about that item.
    const hero = Object.values(data.heroes)[0];
    const missing = Object.keys(data.items).find((key) => data.items[key].souls_per_wp && !hero.wpa[key]);
    if (missing) {
        const { root, lens } = tree(data.items[missing].name, data.items[missing].cost, hero.name);
        load(root, data);
        const wpa = rowOf(lens, "SoulLensWpa").text;
        check("a missing hero item row says so", wpa.includes("no " + hero.name + " rows for this item"), wpa);
    } else {
        check("a missing hero item row says so", false, "every item has a row for the first hero");
    }
}

{
    // A row under the sample floor prints its count and refuses the figure.
    let small = null;
    for (const hero of Object.values(data.heroes)) {
        for (const [itemKey, measured] of Object.entries(hero.wpa)) {
            if (measured.matches < minMatches && data.items[itemKey]) { small = { hero, itemKey, measured }; break; }
        }
        if (small) break;
    }
    check("the bake has an under-threshold row", small !== null);
    if (small) {
        const { root, lens } = tree(data.items[small.itemKey].name, data.items[small.itemKey].cost, small.hero.name);
        load(root, data);
        const wpa = rowOf(lens, "SoulLensWpa").text;
        check("a small sample prints its count and the floor",
            wpa.includes(String(small.measured.matches)) && wpa.includes("under " + minMatches), wpa);
    }
}

{
    const spirit = Object.values(data.items).find((row) => row.wp === 0 && row.cost);
    const { root, lens } = tree(spirit.name, spirit.cost);
    load(root, data);
    const wp = rowOf(lens, "SoulLensWp");
    check("a spirit item refuses a weapon number", wp.text.includes("no weapon power term"), wp.text);
    check("the refusal is styled as missing", wp.HasClass("SoulLensNone"));
}

{
    const { root, lens } = tree("An Item From A Later Patch", 3200);
    load(root, data);
    check("an unknown item is named, not guessed",
        rowOf(lens, "SoulLensWp").text.includes("no stat line for this item"));
    check("an unknown item has no wpa number", rowOf(lens, "SoulLensWpa").text === "",
        rowOf(lens, "SoulLensWpa").text);
}

{
    const { root, lens } = tree(worked.item.name, worked.item.cost);
    load(root, null);
    check("a missing data file is a refusal, not a crash",
        rowOf(lens, "SoulLensWp").text.includes("did not load"));
}

{
    const { root, lens } = tree(worked.item.name, 9999, worked.hero.name);
    load(root, data);
    const src = rowOf(lens, "SoulLensSrc").text;
    check("a live price that disagrees with the bake is shown", src.includes("live price 9999"), src);
}

{
    // A card with no name yet (the tooltip is created before it is filled) must
    // leave the strip on its reading state rather than writing an empty lookup.
    const { root, lens } = tree("", 0);
    load(root, data);
    check("an unfilled card stays on reading",
        rowOf(lens, "SoulLensWp").text.includes("reading the shop"), rowOf(lens, "SoulLensWp").text);
}

{
    // A tree without the block (a different tooltip layout) must not throw.
    const root = new Panel("", "root", null);
    new Panel("", "ModHoverContents", root);
    let threw = null;
    try { load(root, data); } catch (error) { threw = error; }
    check("a layout without the block is untouched", threw === null, threw && String(threw));
}

console.log(failures ? `harness: FAIL (${failures})` : "harness: PASS");
process.exit(failures ? 1 : 0);

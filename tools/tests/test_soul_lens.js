// The Soul Lens harness: run the shipped script against a fake Panorama tree.
//
// The strip is card content now, so the behaviour that matters is small: fill the
// four rows with real numbers, collapse a row that has nothing to say, refuse a
// build with no terms snapshot, and never throw into the game's own card.
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
    SetHasClass(name, on) { if (on) this.classes.add(name); else this.classes.delete(name); }
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
    for (const [key, valueId] of [["power", "SoulLensWp"], ["wpa", "SoulLensWpa"],
                                  ["dps", "SoulLensDps"], ["buy", "SoulLensBuy"]]) {
        const row = new Panel(valueId + "Row", "SoulLensRow", lens);
        const label = new Panel("", "SoulLensKey", row);
        label.text = key;
        new Panel(valueId, "SoulLensValue", row);
    }
    return { root, lens };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function load(panel, dataSource, liveBuild) {
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
        vm.runInContext("window.SoulLensData = " + JSON.stringify(dataSource) + ";", sandbox);
    } else {
        sandbox.window.SoulLensData = null;
    }
    const stamp = liveBuild === undefined ? (dataSource && dataSource.build) : liveBuild;
    vm.runInContext('var SoulLensLiveBuild = ' + JSON.stringify(stamp === undefined || stamp === null ? "" : stamp) + ";", sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "panorama/scripts/soul_lens.js"), "utf8"), sandbox);
    for (let step = 0; step < 3 && queue.length; step += 1) queue.shift()();
    return { panel, queue };
}

function row(lens, id) { return lens.FindChildTraverse(id + "Row"); }
function value(lens, id) { return lens.FindChildTraverse(id).text; }
function shown(lens, id) { return !row(lens, id).HasClass("SoulLensHidden"); }

let failures = 0;
function check(name, condition, detail) {
    if (condition) console.log("ok   " + name);
    else { failures += 1; console.log("FAIL " + name + (detail ? " :: " + detail : "")); }
}

const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data/items.json"), "utf8"));
const minMatches = data.model.min_matches;

const worked = (() => {
    for (const [heroKey, hero] of Object.entries(data.heroes)) {
        for (const [itemKey, measured] of Object.entries(hero.wpa)) {
            const item = data.items[itemKey];
            if (!item || measured.wpa <= 0 || measured.matches < minMatches) continue;
            if (!item.souls_per_wp) continue;
            return { hero, heroKey, item, itemKey, measured };
        }
    }
    return null;
})();

{
    check("the bake has a worked example", worked !== null);
    const { root, lens } = tree(worked.item.name, worked.item.cost, worked.hero.name);
    load(root, data);
    const wp = value(lens, "SoulLensWp");
    check("the weapon row is a number, not a sentence", wp.includes("+" + worked.item.wp + "%"), wp);
    check("the weapon row carries souls per point", wp.includes("souls/%"), wp);
    check("the weapon row is shown", shown(lens, "SoulLensWp"));
    const wpa = value(lens, "SoulLensWpa");
    check("the wpa row carries the measured points", wpa.includes("% · "), wpa);
    check("the wpa ratio is cost over the measured wpa",
        wpa.includes(String(Math.round(worked.item.cost / worked.measured.wpa))), wpa);
    const dump = value(lens, "SoulLensDps");
    check("the dps row carries souls per point", dump.includes("souls/%"), dump);
    const buy = value(lens, "SoulLensBuy");
    check("the buy row is just the minute", /^\d+:\d\d$/.test(buy), buy);
    check("there is no title row in the shipped tree",
        lens.FindChildTraverse("SoulLensHead") === null);
}

{
    // A spirit item has no weapon or dps term: those rows collapse instead of
    // printing "none".
    const spirit = Object.values(data.items).find((row) => row.wp === 0 && row.dps === 0 && row.cost);
    const { root, lens } = tree(spirit.name, spirit.cost);
    load(root, data);
    check("a missing weapon term is collapsed", !shown(lens, "SoulLensWp"));
    check("a missing dps term is collapsed", !shown(lens, "SoulLensDps"));
    check("the wpa row still draws", shown(lens, "SoulLensWpa"), value(lens, "SoulLensWpa"));
}

{
    const { root, lens } = tree(worked.item.name, worked.item.cost, "Test Hero");
    load(root, data);
    check("an unknown hero is one phrase", value(lens, "SoulLensWpa") === "no hero rows",
        value(lens, "SoulLensWpa"));
}

{
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
        check("a small sample prints count against floor",
            value(lens, "SoulLensWpa").includes(small.measured.matches + "m<" + minMatches),
            value(lens, "SoulLensWpa"));
    }
}

{
    // The installed build has no terms snapshot: the weapon and dps rows refuse
    // with the build number, and the match-measured wpa row still draws.
    const { root, lens } = tree(worked.item.name, worked.item.cost, worked.hero.name);
    load(root, data, "9999");
    check("a stale build refuses the weapon terms", value(lens, "SoulLensWp") === "no 9999",
        value(lens, "SoulLensWp"));
    check("the stale dps row is collapsed", !shown(lens, "SoulLensDps"));
    check("the measured wpa row still draws", shown(lens, "SoulLensWpa"), value(lens, "SoulLensWpa"));
}

{
    // An archived build draws its own terms.
    const archived = clone(data);
    archived.term_builds = { "6800": {} };
    archived.term_builds["6800"][worked.itemKey] = {
        name: worked.item.name, wp: 12.5, fire: 0, dps: 12.5,
        cost: worked.item.cost, tier: worked.item.tier, slot: worked.item.slot, upgrades_to: [],
    };
    const { root, lens } = tree(worked.item.name, worked.item.cost, worked.hero.name);
    load(root, archived, "6800");
    check("an archived build draws its own number", value(lens, "SoulLensWp").includes("+12.5%"),
        value(lens, "SoulLensWp"));
    check("the archived ratio uses cost",
        value(lens, "SoulLensWp").includes(String(Math.round(worked.item.cost / 12.5))),
        value(lens, "SoulLensWp"));
}

{
    const { root, lens } = tree(worked.item.name, worked.item.cost, worked.hero.name);
    load(root, data, "");
    check("an unstamped install refuses", value(lens, "SoulLensWp") === "no build",
        value(lens, "SoulLensWp"));
}

{
    const { root, lens } = tree("An Item From A Later Patch", 3200);
    load(root, data);
    check("an unknown item writes nothing", value(lens, "SoulLensWp") === ""
        && !shown(lens, "SoulLensWp"));
    check("an unknown item hides the buy row", !shown(lens, "SoulLensBuy"));
}

{
    const { root, lens } = tree(worked.item.name, worked.item.cost);
    load(root, null);
    check("a missing data file is a refusal, not a crash",
        value(lens, "SoulLensWp") === "no data", value(lens, "SoulLensWp"));
}

{
    const { root, lens } = tree("", 0);
    load(root, data);
    check("an unfilled card writes no row", value(lens, "SoulLensWp") === "");
}

{
    const root = new Panel("", "root", null);
    new Panel("", "ModHoverContents", root);
    let threw = null;
    try { load(root, data); } catch (error) { threw = error; }
    check("a layout without the block is untouched", threw === null, threw && String(threw));
}

console.log(failures ? `harness: FAIL (${failures})` : "harness: PASS");
process.exit(failures ? 1 : 0);

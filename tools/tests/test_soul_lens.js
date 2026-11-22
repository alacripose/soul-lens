// The Soul Lens harness: run the shipped script against a fake Panorama tree.
//
// The tooltip is the game's own panel, so the behaviour that matters here is what
// the script does with a tree it did not build: read the card, write the strip,
// refuse an unknown item, and never throw. The panel API below is the subset the
// script uses (FindChildTraverse, GetChildCount/GetChild, GetAttributeString,
// GetParent, text, AddClass/RemoveClass), so a method the script calls and the
// game does not have would show up here as a missing function first.
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
    new Panel("SoulLensWp", "SoulLensValue", lens);
    new Panel("SoulLensDps", "SoulLensValue", lens);
    new Panel("SoulLensBuy", "SoulLensBuy", lens);
    new Panel("SoulLensSrc", "SoulLensSrc", lens);
    return { root, lens };
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
        vm.runInContext(fs.readFileSync(path.join(ROOT, "panorama/scripts/soul_lens_data.js"), "utf8"), sandbox);
    } else {
        sandbox.window.SoulLensData = null;
    }
    vm.runInContext(fs.readFileSync(path.join(ROOT, "panorama/scripts/soul_lens.js"), "utf8"), sandbox);
    // Drain a bounded number of scheduled callbacks: the script ticks four times a
    // second for forty seconds, so three ticks is a card that has been filled.
    for (let step = 0; step < 3 && queue.length; step += 1) queue.shift()();
    return { panel, queue };
}

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
const weapon = Object.values(data.items).find((row) => row.wp > 0 && row.souls_per_wp);
const spirit = Object.values(data.items).find((row) => row.wp === 0 && row.cost);

{
    const { root, lens } = tree(weapon.name, weapon.cost);
    load(root, data);
    const wp = lens.FindChildTraverse("SoulLensWp").text;
    const dps = lens.FindChildTraverse("SoulLensDps").text;
    check("weapon row names the ratio", wp.includes("souls / +1%"), wp);
    check("weapon row uses the catalog number", wp.includes("+" + weapon.wp + "% power"), wp);
    check("dps row is present", dps.includes("souls / +1%"), dps);
    check("price comes from the live card", wp.includes(String(Math.round(weapon.cost / weapon.wp))), wp);
    const buy = lens.FindChildTraverse("SoulLensBuy").text;
    check("buy line carries the measured time", buy.includes("buy ≈"), buy);
    const src = lens.FindChildTraverse("SoulLensSrc").text;
    check("source line names statlocker's refusal", src.includes("statlocker"), src);
}

{
    const { root, lens } = tree(spirit.name, spirit.cost);
    load(root, data);
    const wp = lens.FindChildTraverse("SoulLensWp");
    check("a spirit item refuses a weapon number", wp.text.includes("no weapon power term"), wp.text);
    check("the refusal is styled as missing", wp.HasClass("SoulLensNone"));
}

{
    const { root, lens } = tree("An Item From A Later Patch", 3200);
    load(root, data);
    check("an unknown item is named, not guessed",
        lens.FindChildTraverse("SoulLensWp").text.includes("no stat line for this item"));
}

{
    const { root, lens } = tree(weapon.name, weapon.cost);
    load(root, null);
    check("a missing data file is a refusal, not a crash",
        lens.FindChildTraverse("SoulLensWp").text.includes("did not load"));
}

{
    const { root, lens } = tree(weapon.name, 9999);
    load(root, data);
    const src = lens.FindChildTraverse("SoulLensSrc").text;
    check("a live price that disagrees with the bake is shown", src.includes("live 9999"), src);
}

{
    // The hero on the shop header selects that hero's own purchase time. The
    // harness uses the hero the catalogue actually has rows for.
    const heroKey = Object.keys(data.heroes || {})[0];
    if (heroKey) {
        const hero = data.heroes[heroKey];
        const itemKey = Object.keys(hero.buy).find((key) => data.items[key] && data.items[key].name);
        const { root, lens } = tree(data.items[itemKey].name, data.items[itemKey].cost, hero.name);
        load(root, data);
        const buy = lens.FindChildTraverse("SoulLensBuy").text;
        check("the header hero's own buy time is used", buy.includes("(" + hero.name + ")"), buy);
        const head = lens.FindChildTraverse("SoulLensHead").text;
        check("the header names the hero", head.includes(hero.name.toUpperCase()), head);
    } else {
        check("the bake has per-hero purchase times", false, "no heroes in data/items.json");
    }
}

{
    // A card with no name yet (the tooltip is created before it is filled) must
    // leave the strip on its reading state rather than writing an empty lookup.
    const { root, lens } = tree("", 0);
    load(root, data);
    check("an unfilled card stays on reading",
        lens.FindChildTraverse("SoulLensWp").text.includes("reading the shop"), lens.FindChildTraverse("SoulLensWp").text);
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

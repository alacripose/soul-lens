// The Soul Lens harness: run the shipped script against a fake Panorama tree.
//
// The section is card content now, so the behaviour that matters is small: fill
// the six tiles with real numbers from the source that owns each one, collapse a
// tile that has nothing to say, refuse a build with no terms snapshot, and never
// throw into the game's own card.
//
// The last block is the regression that matters most: the card is one panel reused
// for every hover, and the two recommendation tiles must follow the card's current
// item and the shop header's current hero — never the item or hero that was there
// when the tick loop started.
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
    FindChildrenWithClassTraverse(name) {
        const out = [];
        const walk = (panel) => {
            for (const child of panel.children) {
                if (child.classes.has(name)) out.push(child);
                walk(child);
            }
        };
        walk(this);
        return out;
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

// The shop's own recommended list: one `CitadelShopMod` (`mod_view`) per item, each
// carrying a `.modName` label, exactly the shape `citadel_hud_hero_shop.xml` builds.
function recommended(root, names, id) {
    const list = new Panel(id || "ShopModsRecommended", "", root);
    for (const name of names) {
        const entry = new Panel("", "mod_view", list);
        const label = new Panel("", "modName", entry);
        label.text = name;
    }
    return list;
}

function tree(itemName, cost, hero, recommendNames) {
    const root = new Panel("", "root", null);
    if (hero) {
        const header = new Panel("HeroFavoritesHeaderLabel", "HeroFavoritesHeaderLabel", root);
        header.text = hero + "'s Recommended Mods";
    }
    if (recommendNames) recommended(root, recommendNames);
    const contents = new Panel("", "ModHoverContents", root);
    new Panel("BackgroundTexture", "", contents);
    const view = new Panel("ModView", "", contents);
    const card = new Panel("ModCard", "", view);
    const nameArea = new Panel("", "mod_name_area", card);
    const name = new Panel("ModName", "modName", nameArea);
    name.text = itemName;
    const costLabel = new Panel("ItemCost", "", card);
    costLabel.text = String(cost);

    const lens = new Panel("SoulLens", "SoulLens", contents);
    const header = new Panel("SoulLensHeader", "SoulLensHeader", lens);
    const head = new Panel("SoulLensHead", "ActivePassiveLabel", header);
    head.text = "Soul Lens";
    const body = new Panel("SoulLensBody", "SoulLensBody", lens);
    new Panel("SoulLensSummary", "SoulLensSummary ModInfoLabel", body);
    const grid = new Panel("SoulLensGrid", "SoulLensGrid", body);
    for (const [valueId, label] of [
        ["SoulLensWp", "Weapon Power"],
        ["SoulLensWpa", "WPA"],
        ["SoulLensDps", "Standing DPS"],
        ["SoulLensBuy", "Average Buy"],
        ["SoulLensShop", "Shop List"],
        ["SoulLensSl", "Statlocker"],
    ]) {
        const tile = new Panel(valueId + "Tile", "SoulLensTile", grid);
        const content = new Panel("", "ImportantStatContent", tile);
        new Panel(valueId, "SoulLensTileValue", content);
        const labelPanel = new Panel("", "SoulLensTileLabel", content);
        labelPanel.text = label;
        new Panel(valueId + "Note", "SoulLensTileNote", content);
    }
    return { root, lens };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function load(panel, dataSource, liveBuild, ticks) {
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
    const budget = ticks === undefined ? 3 : ticks;
    for (let step = 0; step < budget && queue.length; step += 1) queue.shift()();
    return { panel, queue };
}

function tile(lens, id) { return lens.FindChildTraverse(id + "Tile"); }
function value(lens, id) { return lens.FindChildTraverse(id).text; }
function note(lens, id) { return lens.FindChildTraverse(id + "Note").text; }
function shown(lens, id) { const found = tile(lens, id); return !!found && !found.HasClass("SoulLensHidden"); }
function hidden(lens) { return lens.HasClass("SoulLensHidden"); }
function summary(lens) { return lens.FindChildTraverse("SoulLensSummary").text; }
function gridOf(lens) { return lens.FindChildTraverse("SoulLensGrid"); }

function points(number) {
    const digits = Math.abs(number) < 10 ? 2 : 1;
    const sign = number > 0 ? "+" : (number < 0 ? "" : "+");
    return sign + Number(number).toFixed(digits);
}

function commas(number) {
    return String(number).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

let failures = 0;
function check(name, condition, detail) {
    if (condition) console.log("ok   " + name);
    else { failures += 1; console.log("FAIL " + name + (detail ? " :: " + detail : "")); }
}

const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data/items.json"), "utf8"));
const minMatches = data.model.min_matches;

// Statlocker's own tile, rendered the way the script renders it, so a test compares
// against the bake rather than against a number copied into this file.
function slValue(hero, itemKey) {
    const ranked = hero && hero.sl ? hero.sl[itemKey] : null;
    return ranked ? "#" + ranked.rank + "/" + ranked.of : null;
}

function slPick(hero, itemKey) {
    const ranked = hero && hero.sl ? hero.sl[itemKey] : null;
    if (!ranked || typeof ranked.pick !== "number") return null;
    return (ranked.pick < 10 ? ranked.pick.toFixed(1) : String(Math.round(ranked.pick))) + "% picked";
}

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
    check("the passive has a header", value(lens, "SoulLensHead") === "Soul Lens", value(lens, "SoulLensHead"));
    check("the section has six tiles", lens.FindChildrenWithClassTraverse("SoulLensTile").length === 6,
        String(lens.FindChildrenWithClassTraverse("SoulLensTile").length));
    const wp = value(lens, "SoulLensWp");
    check("the weapon tile carries the item's term", wp === "+" + worked.item.wp + "%", wp);
    check("the weapon tile carries souls per point", note(lens, "SoulLensWp").includes("souls / +1%"), note(lens, "SoulLensWp"));
    check("the weapon tile is shown", shown(lens, "SoulLensWp"));
    check("the weapon tile reads as a gain", tile(lens, "SoulLensWp").HasClass("SoulLensGain"));
    const wpa = value(lens, "SoulLensWpa");
    check("the wpa tile carries the measured points", wpa === points(worked.measured.wpa) + "%", wpa);
    check("the wpa tile note is cost over the measured wpa",
        note(lens, "SoulLensWpa").includes(String(Math.round(worked.item.cost / worked.measured.wpa))),
        note(lens, "SoulLensWpa"));
    check("the wpa tile names its source", note(lens, "SoulLensWpa").includes("dl-api"), note(lens, "SoulLensWpa"));
    const dump = note(lens, "SoulLensDps");
    check("the dps tile carries souls per point", dump.includes("souls / +1%"), dump);
    const buy = value(lens, "SoulLensBuy");
    check("the buy tile is just the minute", /^\d+:\d\d$/.test(buy), buy);
    check("the summary is a sentence for this hero",
        summary(lens).includes(worked.hero.name) && summary(lens).includes("souls per +1%") && summary(lens).endsWith("."),
        summary(lens));
}

{
    // A spirit item has no weapon or dps term: those tiles collapse instead of
    // printing "none".
    const spirit = Object.values(data.items).find((row) => row.wp === 0 && row.dps === 0 && row.cost);
    const { root, lens } = tree(spirit.name, spirit.cost);
    load(root, data);
    check("a missing weapon term is collapsed", !shown(lens, "SoulLensWp"));
    check("a missing dps term is collapsed", !shown(lens, "SoulLensDps"));
    check("the wpa tile still draws", shown(lens, "SoulLensWpa"), value(lens, "SoulLensWpa"));
    check("four visible tiles stay two across", !gridOf(lens).HasClass("SoulLensThreeUp"));
}

{
    // Six visible terms use the card's 3-up row, the same grouping it gives three
    // important attributes; four keep the 2x2 witness shape above.
    const entry = Object.entries(data.items).find(([, row]) => row.wp > 0 && row.dps > 0);
    check("the bake has an item with both weapon terms", !!entry);
    if (entry) {
        const [, item] = entry;
        const hero = Object.values(data.heroes)[0];
        const { root, lens } = tree(item.name, item.cost, hero.name);
        load(root, data);
        check("six visible tiles use three across", gridOf(lens).HasClass("SoulLensThreeUp"));
    }
}

{
    const { root, lens } = tree(worked.item.name, worked.item.cost, "Test Hero");
    load(root, data);
    check("an unknown hero is one phrase", value(lens, "SoulLensWpa") === "no hero rows",
        value(lens, "SoulLensWpa"));
    check("an unknown hero says where the rows come from", note(lens, "SoulLensWpa").includes("this hero has no item rows"),
        note(lens, "SoulLensWpa"));
    check("an unknown hero has no statlocker rank", value(lens, "SoulLensSl") === "no hero rows",
        value(lens, "SoulLensSl"));
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
        check("a small sample prints its count",
            value(lens, "SoulLensWpa") === commas(small.measured.matches) + " matches",
            value(lens, "SoulLensWpa"));
        check("a small sample refuses the figure against the floor",
            note(lens, "SoulLensWpa").includes("under " + commas(minMatches)) && note(lens, "SoulLensWpa").includes("no WPA"),
            note(lens, "SoulLensWpa"));
    }
}

{
    // The installed build has no terms snapshot: the weapon and dps tiles refuse
    // with the build number, and the match-measured wpa tile still draws.
    const { root, lens } = tree(worked.item.name, worked.item.cost, worked.hero.name);
    load(root, data, "9999");
    check("a stale build refuses the weapon terms", value(lens, "SoulLensWp") === "no 9999",
        value(lens, "SoulLensWp"));
    check("the stale refusal reads as a refusal", tile(lens, "SoulLensWp").HasClass("SoulLensRefused"));
    check("the stale dps tile is collapsed", !shown(lens, "SoulLensDps"));
    check("the measured wpa tile still draws", shown(lens, "SoulLensWpa"), value(lens, "SoulLensWpa"));
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
    check("an archived build draws its own number", value(lens, "SoulLensWp") === "+12.5%",
        value(lens, "SoulLensWp"));
    check("the archived ratio uses cost",
        note(lens, "SoulLensWp").includes(String(Math.round(worked.item.cost / 12.5))),
        note(lens, "SoulLensWp"));
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
    check("an unknown item collapses the section", hidden(lens));
    check("an unknown item writes nothing", value(lens, "SoulLensWp") === "");
    check("an unknown item hides the buy tile", !shown(lens, "SoulLensBuy"));
}

{
    const { root, lens } = tree(worked.item.name, worked.item.cost);
    load(root, null);
    check("a missing data file is a refusal, not a crash",
        value(lens, "SoulLensWp") === "no data", value(lens, "SoulLensWp"));
    check("a missing data file says so in the summary", summary(lens).includes("no baked data"), summary(lens));
}

{
    const { root, lens } = tree("", 0);
    load(root, data);
    check("an unfilled card writes no tile", value(lens, "SoulLensWp") === "");
    check("an unfilled card leaves the section collapsed", hidden(lens));
}

// ---- the shop's own recommended list -------------------------------------------
{
    const names = [worked.item.name, "Burst Fire", "Extra Spirit"];
    const { root, lens } = tree(worked.item.name, worked.item.cost, worked.hero.name, names);
    const { queue } = load(root, data, undefined, 3);
    check("the shop tile is the item's place in the shop's own list",
        value(lens, "SoulLensShop") === "#1/3", value(lens, "SoulLensShop"));
    // A reading is a report, not a refusal: the tile must draw. Collapsing it on success
    // is the same blank card as having no source at all, which is what shipped once.
    check("the shop tile draws when it has a reading", shown(lens, "SoulLensShop"),
        value(lens, "SoulLensShop"));

    // The same card, reused for an item further down that list: the running loop must
    // read the card again, not keep the first item's place.
    root.FindChildTraverse("ModName").text = "Extra Spirit";
    root.FindChildTraverse("ItemCost").text = "1000";
    for (let step = 0; step < 3 && queue.length; step += 1) queue.shift()();
    check("the shop tile follows the reused card", value(lens, "SoulLensShop") === "#3/3",
        value(lens, "SoulLensShop"));
}

{
    const names = ["Burst Fire", "Extra Spirit"];
    const { root, lens } = tree(worked.item.name, worked.item.cost, worked.hero.name, names);
    load(root, data);
    check("an item the shop does not recommend says so", value(lens, "SoulLensShop") === "not listed",
        value(lens, "SoulLensShop"));
}

{
    const { root, lens } = tree(worked.item.name, worked.item.cost, worked.hero.name);
    load(root, data);
    check("a shop without the recommended panel says so", value(lens, "SoulLensShop") === "no list",
        value(lens, "SoulLensShop"));
}

// ---- statlocker's per-hero ranking ---------------------------------------------
const rankedHero = (() => {
    for (const [heroKey, hero] of Object.entries(data.heroes)) {
        const keys = hero.sl ? Object.keys(hero.sl) : [];
        if (keys.length >= 2) return { heroKey, hero, keys };
    }
    return null;
})();

{
    check("the bake carries statlocker rankings", rankedHero !== null);
    if (rankedHero) {
        const [firstKey, secondKey] = rankedHero.keys;
        const first = data.items[firstKey];
        const second = data.items[secondKey];
        const { root, lens } = tree(first.name, first.cost, rankedHero.hero.name);
        const { queue } = load(root, data, undefined, 3);
        check("the statlocker tile is the hero's own rank",
            value(lens, "SoulLensSl") === slValue(rankedHero.hero, firstKey),
            value(lens, "SoulLensSl") + " expected " + slValue(rankedHero.hero, firstKey));
        check("the statlocker tile carries the pick rate",
            note(lens, "SoulLensSl").includes(slPick(rankedHero.hero, firstKey)),
            note(lens, "SoulLensSl") + " expected " + slPick(rankedHero.hero, firstKey));
        check("the statlocker tile draws when it has a reading", shown(lens, "SoulLensSl"),
            value(lens, "SoulLensSl"));

        // The card is reused for another item: the rank must be that item's, not the
        // one the section drew a moment ago.
        const before = value(lens, "SoulLensSl");
        root.FindChildTraverse("ModName").text = second.name;
        root.FindChildTraverse("ItemCost").text = String(second.cost);
        for (let step = 0; step < 3 && queue.length; step += 1) queue.shift()();
        const after = value(lens, "SoulLensSl");
        check("the statlocker tile follows the reused card to the new item",
            after === slValue(rankedHero.hero, secondKey) && after !== before,
            before + " -> " + after);
    }
}

{
    // The same item hovered while the shop header names another hero: the ranking is
    // that hero's, and an item the new hero has no row for is a refusal, never the
    // previous hero's number.
    const other = rankedHero && Object.entries(data.heroes).find(([heroKey, hero]) =>
        heroKey !== rankedHero.heroKey && hero.sl);
    check("the bake has a second ranked hero", !!other);
    if (rankedHero && other) {
        const [otherKey, otherHero] = other;
        const itemKey = rankedHero.keys[0];
        const item = data.items[itemKey];
        const { root, lens } = tree(item.name, item.cost, otherHero.name);
        const { queue } = load(root, data, undefined, 3);
        const expected = slValue(otherHero, itemKey);
        check("the statlocker tile is the header hero's, not the first hero's",
            value(lens, "SoulLensSl") === (expected || "not listed"),
            value(lens, "SoulLensSl") + " expected " + (expected || "not listed"));

        // Now change the header under the running loop: after the slow re-render the
        // tile must be the new hero's.
        root.FindChildTraverse("HeroFavoritesHeaderLabel").text = rankedHero.hero.name + "'s Recommended Mods";
        for (let step = 0; step < 700 && queue.length; step += 1) queue.shift()();
        check("a hero change under the same hovered item re-reads the ranking",
            value(lens, "SoulLensSl") === (slValue(rankedHero.hero, itemKey) || "not listed"),
            value(lens, "SoulLensSl"));
    }
}

{
    const refused = clone(data);
    refused.sources["statlocker-ranks"] = { state: "refused", reason: "HTTP 429", heroes: 0, rows: 0 };
    const itemKey = rankedHero ? rankedHero.keys[0] : worked.itemKey;
    const item = data.items[itemKey];
    const { root, lens } = tree(item.name, item.cost, rankedHero ? rankedHero.hero.name : worked.hero.name);
    load(root, refused);
    check("a refused statlocker source reads unavailable, not stale",
        value(lens, "SoulLensSl") === "unavailable", value(lens, "SoulLensSl"));
}

{
    // The old tick budget froze every card after it; the loop is unbounded now and the
    // tiles must still be this card's after 40 s of shop uptime (700 ticks at 0.1 s).
    const first = worked.item;
    const second = Object.values(data.items).find((item) =>
        item.souls_per_wp && item.name !== first.name && item.cost &&
        data.heroes[worked.heroKey].wpa[Object.keys(data.items).find((k) => data.items[k] === item)]);
    const names = [first.name, second.name, "Extra Spirit"];
    const { root, lens } = tree(first.name, first.cost, worked.hero.name, names);
    const { queue } = load(root, data, undefined, 60);
    const before = value(lens, "SoulLensWp");
    const beforeShop = value(lens, "SoulLensShop");
    const namePanel = root.FindChildTraverse("ModName");
    const costPanel = root.FindChildTraverse("ItemCost");
    namePanel.text = second.name;
    costPanel.text = String(second.cost);
    for (let step = 0; step < 700 && queue.length; step += 1) queue.shift()();
    const after = value(lens, "SoulLensWp");
    check("the section keeps ticking past the old 40 s budget", after !== "" && after !== before,
        before + " -> " + after);
    check("the section follows the reused card to the new item",
        Math.abs(second.wp - first.wp) < 1e-9 || after === "+" + second.wp + "%",
        after);
    check("the shop tile is the new item's after 40 s, not the first item's",
        value(lens, "SoulLensShop") === "#2/3" && beforeShop === "#1/3",
        beforeShop + " -> " + value(lens, "SoulLensShop"));
}

{
    const root = new Panel("", "root", null);
    new Panel("", "ModHoverContents", root);
    let threw = null;
    try { load(root, data); } catch (error) { threw = error; }
    check("a layout without the section is untouched", threw === null, threw && String(threw));
}

console.log(failures ? `harness: FAIL (${failures})` : "harness: PASS");
process.exit(failures ? 1 : 0);

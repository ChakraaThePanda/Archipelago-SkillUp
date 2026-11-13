"use strict";
// SkillUp: the browser game and its Archipelago client.
// Game content comes from data/game_data.json and every number from data/balance.json (both baked
// in by tools/build_client.py), the same files the balance simulator (tools/simulate.py) uses.

const GAME = "SkillUp";
const SAVE_VERSION = 2;
const ICON = n => `https://wow.zamimg.com/images/wow/icons/large/${n}.jpg`;
const $ = id => document.getElementById(id);
$("favicon").href = LOGO;
document.querySelectorAll("[data-logo]").forEach(img => img.src = LOGO);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
Object.defineProperty(HTMLElement.prototype, "html", { set(v) { if (this._html !== v) { this._html = v; this.innerHTML = v; } } });

// ============================================================================================
// Static data
// ============================================================================================
const RANKS = GD.ranks, RANK_CAPS = RANKS.map(r => r.cap);
const PROFS = GD.professions, P = Object.fromEntries(PROFS.map(p => [p.key, p]));
const GATHER = PROFS.filter(p => p.kind === "gathering").map(p => p.key);
const CRAFT = PROFS.filter(p => p.kind === "crafting").map(p => p.key);
const GROUPS = [["Fighting", "combat"], ["Gathering", "gathering"], ["Crafting", "crafting"]];
const BY_KIND = Object.fromEntries(GROUPS.map(([, kind]) => [kind, PROFS.filter(p => p.kind === kind).sort((a, b) => a.name.localeCompare(b.name))]));
const byKind = kind => BY_KIND[kind];
const GEAR_PROFS = new Set(["blacksmithing", "leatherworking", "tailoring", "engineering"]);
for (const r of GD.recipes) if (GEAR_PROFS.has(r.profession)) r.quality = r.rank + 1;   // white, green, blue, purple
const TF = BAL.thunderfury;   // the legendary sword, crafted next to the Fire Resistance set
GD.fire_resistance_set.push({ name: TF.name, icon: TF.icon, profession: TF.profession, slot: "Sword", unlock: TF.unlock, reagents: TF.reagents, weapon: true });
for (const f of GD.fire_resistance_set) { f.legendary = true; f.rank = 3; if (GEAR_PROFS.has(f.profession)) f.quality = 5; }
const BY_NAME = Object.fromEntries([...GD.materials, ...GD.recipes, ...GD.fire_resistance_set].map(e => [e.name, e]));
const TRINKET = BAL.trinket;   // the hidden legendary trinket
BY_NAME[TRINKET.name] = { name: TRINKET.name, icon: TRINKET.icon, quality: 5, legendary: true, role: "Trinket" };
const MOB = Object.fromEntries(GD.mobs.map(m => [m.name, m]));
const ARMOR_SLOTS = ["Head", "Shoulder", "Back", "Chest", "Hands", "Legs", "Feet"];
const WEAPONS = ["Sword", "Dagger", "Mace", "Axe"];
const GOLD_CAP = 2147483647;   // copper: 214,748g 36s 47c, the gold cap from Classic WoW
const TOOL_FOR = { "Mining tool": "mining", "Skinning tool": "skinning", "Fishing tool": "fishing", "Herbalism tool": "herbalism" };
const BUFF_ROLES = Object.keys(BAL.buffs.effects);
const STRONG = { Sword: "Good against everything. Cheap to make.",
  ...Object.fromEntries(Object.entries(GD.traits).map(([t, v]) => [v.weapon, `Strong against ${t} creatures.`])) };
const thingsOf = (k, rank) => P[k].kind === "combat" ? GD.mobs.filter(m => m.rank === rank)
  : P[k].kind === "crafting" ? GD.recipes.filter(r => r.profession === k && r.rank === rank)
  : GD.materials.filter(m => m.profession === k && m.rank === rank && m.slot !== null);
const locationName = (k, name) => `${P[k].name}: ${name}`;
const milestoneName = (k, rank) => `${RANKS[rank].name} ${P[k].title}`;
const slotNum = e => typeof e.slot === "number" ? e.slot : 3;   // legendary recipes use the rank's last slot

// ============================================================================================
// Save state
// ============================================================================================
let S = null;          // the save
let slotData = {};     // from the server
let ranks = {};        // rank items received, per profession
let moltenCore = false;
let received = [];     // every item received, in order (server index)
let selected = "combat", tab = 0, rtab = "char";

function newSave() {
  const per = v => Object.fromEntries(PROFS.map(p => [p.key, v]));
  return { v: SAVE_VERSION, savedAt: Date.now(), clock: 0, level: per(1), xp: per(0), speedLv: per(0), xpLv: per(0),
    gold: 0, stock: {}, bags: 0, crafted: [], firsts: [], weapons: {}, armor: {}, tools: {}, supplies: {}, buffs: {},
    debuffs: {}, rested: 0, field: null, fieldT: 0, work: null, workT: 0, applied: 0, bagBonus: 0, sellBonus: 0,
    clothAcc: 0, unsold: 0, corpseUntil: 0, ambush: 0, ambushing: null, ragnarosWon: false, goalSent: false, deaths: 0, deathStreak: 0,
    trinket: false, trinketNew: false, trinketBonus: 0 };
}

// ============================================================================================
// Rules (same formulas as tools/simulate.py)
// ============================================================================================
const cap = k => ranks[k] ? RANK_CAPS[ranks[k] - 1] : 0;
const learned = k => (ranks[k] || 0) > 0;
const xpNeed = L => BAL.xp.base * (1 + L / BAL.xp.per_level);
const speedName = () => ({ long: "Long", normal: "Normal", sync: "Sync" }[slotData.game_speed] || "Normal");
const gameSpeed = () => BAL.xp.game_speed[speedName()];
const baseTime = (kind, rank, slot) => BAL.actions[kind] * BAL.actions.rank_growth ** rank * (1 + BAL.actions.slot_growth * slot);
const bagCap = () => Math.floor((BAL.storage.start_by_speed[speedName()] ?? BAL.storage.start) * BAL.storage.per_bag_mult ** S.bags * (1 + S.bagBonus));

function colorOf(level, unlock) {
  const gap = level - unlock;
  if (gap < 0) {
    const chance = BAL.red.chances.find(([upto]) => -gap <= upto)[1];
    return { name: "red", mult: 1, chance, slow: 1 + -gap / BAL.red.slow_per_levels };
  }
  for (const [name, [upto, mult]] of Object.entries(BAL.xp.colors)) if (gap < upto) return { name, mult };
  return { name: "grey", mult: 0 };
}
const COLOR_TIP = { red: "Above your skill: low chance, slow", orange: "Full XP", yellow: "75% XP", green: "25% XP", grey: "No XP" };

function active(map, name) { return map[name] && map[name].until > S.clock; }
function buffValue(role) {
  if (!active(S.buffs, role)) return 0;
  return BAL.buffs.effects[role] * (1 + BAL.buffs.rank_scale * S.buffs[role].rank);
}
function speed(k) {
  let s = 1 + S.speedLv[k] * BAL.gold.speed_step;
  const tool = S.tools[k];
  if (tool && !active(S.debuffs, "Broken Tool")) s *= 1 + (BY_NAME[tool].rank + 1) * BAL.tools.step;
  if (GATHER.includes(k)) s *= 1 + buffValue("Gathering speed");
  if (CRAFT.includes(k)) s *= 1 + buffValue("Crafting speed");
  if (k === "combat" && active(S.debuffs, "Resurrection Sickness")) s *= BAL.traps["Resurrection Sickness"].combat_slow;
  return s;
}

// ---- combat: weapon -> DPS (speed), armor -> HP (survival) ---------------------------------
const C = BAL.combat;
const itemRank = n => BY_NAME[n]?.legendary ? BAL.ragnaros.fr_armor_rank : BY_NAME[n]?.rank ?? 0;
function weaponDps(trait) {
  let best = C.fists_dps;
  for (const [w, name] of Object.entries(S.weapons)) {
    let d = C.weapon_dps * C.rank_growth ** itemRank(name);
    if (BY_NAME[name]?.weapon || (trait && GD.traits[trait].weapon === w)) d *= C.trait_match;   // Thunderfury: right against everything else if (!trait && w === "Sword") d *= C.sword_bonus;
    best = Math.max(best, d);
  }
  return best;
}
const armorHp = rankList => C.base_hp + rankList.reduce((t, r) => t + C.armor_hp * C.rank_growth ** r, 0);
const wornRanks = () => ARMOR_SLOTS.filter(s => S.armor[s]).map(s => itemRank(S.armor[s]));
const maxHp = () => armorHp(wornRanks()) * (1 + buffValue("Combat food"));
const mobBase = m => baseTime("combat_time", m.rank, m.slot) * (m.boss ? BAL.actions.boss_time_mult : 1);
const needDps = m => C.weapon_dps * C.rank_growth ** m.rank * (1 + C.slot_growth * m.slot) * (m.boss ? C.boss_dps_mult : 1);
function mobDamage(m) {
  const e = m.rank - 1 + m.slot / 3;
  const expected = C.base_hp + 7 * C.armor_hp * C.rank_growth ** e * (e < 0 ? Math.min(1, 1 + e) : 1);
  return C.danger * expected * (m.boss ? C.boss_damage_mult : 1);
}
const deathChance = (m, hp = maxHp()) => clamp((mobDamage(m) / hp - C.death_start) / C.death_span, 0, 1);
const gearFightTime = m => mobBase(m) * clamp(needDps(m) / (weaponDps(m.trait) * (1 + buffValue("Combat elixir"))), C.ratio_min, C.ratio_max);
const recCache = {};
// The lowest armor Gear Level where you win 95% of fights. Counts partial sets: 3 white pieces and
// 4 empty slots is Gear Level 9. Tiers: empty, white, green, blue, purple, legendary. Never changes.
const GEAR_TIERS = [[null, 0], [0, 20], [1, 40], [2, 60], [3, 80], [BAL.ragnaros.fr_armor_rank, 100]];
function recommended(m) {
  if (m.name in recCache) return recCache[m.name];
  let G = 100;
  search: for (let i = 0; i < GEAR_TIERS.length - 1; i++) for (let k = 0; k <= 7; k++) {
    const [lo, loLv] = GEAR_TIERS[i], [hi, hiLv] = GEAR_TIERS[i + 1];
    const worn = [...Array(7 - k).fill(lo), ...Array(k).fill(hi)].filter(r => r !== null);
    if (deathChance(m, armorHp(worn)) <= .05) { G = Math.round(((7 - k) * loLv + k * hiLv) / 7); break search; }
  }
  return recCache[m.name] = G;
}
const ilvl = n => !n ? 0 : BY_NAME[n].legendary ? 100 : 20 * (BY_NAME[n].rank + 1);
// Your Gear Level comes from your HP (Combat food included): the Gear Level of an evenly upgraded set
// with that much HP, on the same ladder recommended() uses, so the two numbers compare like for like.
const GEAR_LADDER = GEAR_TIERS.slice(0, -1).flatMap(([lo, loLv], i) => {
  const [hi, hiLv] = GEAR_TIERS[i + 1];
  return Array.from({ length: 7 }, (_, k) => ({ gl: ((7 - k) * loLv + k * hiLv) / 7,
    hp: armorHp([...Array(7 - k).fill(lo), ...Array(k).fill(hi)].filter(r => r !== null)) }));
}).concat([{ gl: 100, hp: armorHp(Array(7).fill(GEAR_TIERS[GEAR_TIERS.length - 1][0])) }]);
function gearLevel() {
  const hp = maxHp(), i = GEAR_LADDER.findIndex(s => s.hp >= hp);
  if (i < 0) return 100;
  if (i === 0) return 0;
  const a = GEAR_LADDER[i - 1], b = GEAR_LADDER[i];
  return Math.round(a.gl + (b.gl - a.gl) * (hp - a.hp) / (b.hp - a.hp));
}

// ---- actions --------------------------------------------------------------------------------
function ambushTarget() { // the first creature you don't always beat with your gear (the last one if you beat them all)
  return GD.mobs.find(m => deathChance(m) > .005) || GD.mobs[GD.mobs.length - 1];
}
function actionOf(slot) { // {kind, entry, time, k} for the gathering/fighting slot ("field") or crafting ("work")
  if (slot === "field" && S.ambushing) {
    const m = MOB[S.ambushing];
    return { kind: "mob", entry: m, k: "combat", time: Math.max(gearFightTime(m) / speed("combat"), BAL.actions.min_action_time), ambush: true };
  }
  const a = S[slot];
  if (!a) return null;
  if (a.kind === "ragnaros") return { kind: "ragnaros", time: ragFate(a).time, k: "combat" };
  if (a.kind === "mob") {
    const m = MOB[a.name], t = Math.max(gearFightTime(m) / speed("combat"), BAL.actions.min_action_time);
    return { kind: "mob", entry: m, k: "combat", time: t };
  }
  const e = BY_NAME[a.name], k = e.profession, kind = slot === "field" ? "gather_time" : "craft_time";
  let t = Math.max(baseTime(kind, e.rank, slotNum(e)) / speed(k), BAL.actions.min_action_time);
  const c = colorOf(S.level[k], e.unlock);
  if (c.name === "red") t *= c.slow;
  return { kind: slot === "field" ? "gather" : "craft", entry: e, k, time: t, color: c };
}
const qtyOf = r => r.legendary ? BAL.recipes.fr_qty : Math.ceil(BAL.recipes.reagent_qty * (BAL.recipes.role_qty_mult[r.role] || 1));
const missing = r => r.reagents.find(n => (S.stock[n] || 0) < qtyOf(r));

function addXp(k, amount, field) {
  if (!learned(k) || S.level[k] >= cap(k)) return;
  amount *= gameSpeed() * (1 + S.xpLv[k] * BAL.gold.xp_step) * (1 + buffValue(field ? "Gathering XP food" : "Crafting XP food"));
  if (S.rested > 0) amount *= 2;
  S.xp[k] += amount;
  while (S.level[k] < cap(k) && S.xp[k] >= xpNeed(S.level[k])) {
    S.xp[k] -= xpNeed(S.level[k]);
    levelUp(k);
    skillPoint(k);
  }
  if (S.level[k] >= cap(k)) S.xp[k] = 0;
}
function levelUp(k) {
  S.level[k]++;
  const r = RANK_CAPS.indexOf(S.level[k]);
  if (r >= 0) check(milestoneName(k, r));
}
// Every skill point gained: a tiny chance to find the Darkmoon Card, and once it's worn, a chance
// of one more point (never past the rank's cap; the extra point doesn't roll again).
function skillPoint(k) {
  if (!S.trinket) {
    if (Math.random() < TRINKET.find_chance) {
      S.trinket = true; S.trinketNew = true;
      log(`<span class="pl-me">You</span> found <span class="q5">${esc(TRINKET.name)}</span>, a legendary trinket! It is now equipped.`);
    }
    return;
  }
  if (S.level[k] < cap(k) && Math.random() < TRINKET.bonus_chance) { levelUp(k); S.trinketBonus++; }
}

function baseValue(name) {
  const e = BY_NAME[name];
  if (!e) return 0;
  if (e.reagents) return e.reagents.reduce((t, n) => t + baseValue(n) * qtyOf(e), 0) * BAL.gold.crafted_markup;
  return Math.max(BAL.gold.min_sell, e.sell * BAL.gold.sell_mult);
}
const sellValue = name => baseValue(name) * (1 + S.sellBonus);
function store(name, qty, offline) {
  const kept = Math.min(qty, Math.max(0, bagCap() - (S.stock[name] || 0)));
  S.stock[name] = (S.stock[name] || 0) + kept;
  if (qty > kept && !offline) S.gold += (qty - kept) * sellValue(name);
}

function finishField(offline) {
  const a = actionOf("field");
  if (!a) return;
  if (a.kind === "ragnaros") return finishRagnaros(offline);
  if (a.kind === "mob") return finishFight(a.entry, offline, false, takeFate(a.entry));
  const e = a.entry, k = a.k, base = baseTime("gather_time", e.rank, e.slot);
  if (a.color.name === "red" && Math.random() >= a.color.chance) return;      // failed attempt: only time lost
  addXp(k, base * BAL.actions.xp_per_second * a.color.mult, true);
  const [lo, hi] = BAL.actions.gather_yield;
  store(e.name, lo + Math.floor(Math.random() * (hi - lo + 1)), offline);
  first(k, e.name);
}

// How a fight ends. A Healing Potion is drunk only when a fight goes wrong: the best one you have
// restores its HP (balance.json buffs.healing_hp) and the same fight is checked again with that HP.
const healingHp = name => BAL.buffs.healing_hp[BY_NAME[name].rank];
function rollFight(m) {
  const roll = Math.random(), hp = maxHp();
  if (roll >= deathChance(m, hp)) return { dies: false, potion: false };
  const heal = Math.max(0, ...(S.supplies.Healing || []).map(healingHp));
  return { dies: roll < deathChance(m, hp + heal), potion: heal > 0 };
}
function fateFor(m) { // this fight's outcome, rolled once when it starts
  if (S.fightFate?.mob !== m.name) S.fightFate = { ...rollFight(m), mob: m.name };
  return S.fightFate;
}
function takeFate(m) { const f = fateFor(m); S.fightFate = null; return f; }
// What the bars show at time t of a fight lasting `time`: you hit about once a second, it hits back
// about every 1.5 s. Losing: you reach 0 while it keeps about 40%. Winning: it reaches 0, you keep some.
function fightBars(m, time, t, dies) {
  const foeMax = Math.round(needDps(m) * mobBase(m)), youMax = Math.round(maxHp());
  const mine = Math.max(2, Math.round(time)), his = Math.max(1, Math.round(time / 1.5));
  const myHits = Math.min(mine, Math.floor(t / (time / mine) + 1e-9)), hisHits = Math.min(his, Math.floor(t / (time / his) + 1e-9));
  const dmg = dies ? youMax : Math.min(youMax * .9, mobDamage(m));
  return { foe: Math.round(foeMax * (1 - (dies ? .6 : 1) * myHits / mine)), foeMax,
    you: Math.max(dies ? 0 : 1, Math.round(youMax - dmg * hisHits / his)), youMax };
}
function finishFight(m, offline, forced = false, fate = takeFate(m)) {
  if (fate.potion) takeSupply("Healing");
  if (fate.dies) {
    die(`was defeated by ${m.name}`, offline);
    if (!forced && ++S.deathStreak >= 3) easierMob(m, offline);
    return;
  }
  if (!forced) S.deathStreak = 0;
  addXp("combat", mobBase(m) * BAL.actions.xp_per_second * colorOf(S.level.combat, m.unlock).mult, true);
  S.clothAcc += C.cloth_per_kill;
  const cloth = Math.floor(S.clothAcc);
  if (cloth) { S.clothAcc -= cloth; store(m.cloth, cloth, offline); }
  S.gold += C.gold_per_kill * C.rank_growth ** m.rank;
  if (!forced) first("combat", m.name);
}
function easierMob(m, offline) { // after 3 deaths in a row, step down to the next creature you can fight
  S.deathStreak = 0;
  const easier = GD.mobs.filter(x => x.unlock < m.unlock && S.level.combat >= x.unlock && ranks.combat > x.rank)
    .sort((a, b) => b.unlock - a.unlock)[0];
  S.field = easier ? { kind: "mob", name: easier.name } : null;
  if (!offline) toast(easier ? `Died 3 times in a row. Switched to ${easier.name}.` : "Died 3 times in a row. Stopped fighting.");
}
// A death: corpse run, then Resurrection Sickness. quiet = not sent to DeathLink (offline, or it came from DeathLink).
function die(cause, quiet = false) {
  S.deaths++;
  S.corpseUntil = S.clock + C.corpse_run;
  S.debuffs["Resurrection Sickness"] = { until: S.clock + C.corpse_run + BAL.traps["Resurrection Sickness"].minutes * 60 };
  S.fieldT = 0;
  if (!quiet) sendDeathLink(cause);
}

function finishWork(offline) {
  const a = actionOf("work");
  if (!a) return;
  const r = a.entry;
  if (missing(r)) return;                                                    // waits for materials
  if (a.color.name === "red" && Math.random() >= a.color.chance) return;     // failed: materials kept
  for (const n of r.reagents) S.stock[n] -= qtyOf(r);
  if (!r.legendary) addXp(a.k, baseTime("craft_time", r.rank, r.slot) * BAL.actions.xp_per_second * BAL.actions.craft_xp_mult
    * (BAL.recipes.role_xp_mult[r.role] || 1) * a.color.mult, false);
  keepOrSell(r, offline);
  if (!r.legendary) first(a.k, r.name);
}
function keepOrSell(r, offline) { // a crafted item is equipped, kept as a supply, or sold
  const firstTime = !S.crafted.includes(r.name);
  if (firstTime) S.crafted.push(r.name);
  const role = r.role || r.slot;
  if (WEAPONS.includes(role) && (!S.weapons[role] || itemRank(r.name) > itemRank(S.weapons[role]))) return void (S.weapons[role] = r.name);
  if (ARMOR_SLOTS.includes(role) && (!S.armor[role] || ilvl(r.name) > ilvl(S.armor[role]))) return void (S.armor[role] = r.name);
  if (TOOL_FOR[role] && (!S.tools[TOOL_FOR[role]] || r.rank > BY_NAME[S.tools[TOOL_FOR[role]]].rank)) return void (S.tools[TOOL_FOR[role]] = r.name);
  if (role === "Bag" && firstTime) return void S.bags++;
  const kind = r.legendary ? (r.slot === "Potion" ? "Fire protection" : r.slot === "Food" ? "Fire food" : null) : role;
  if (kind && (BUFF_ROLES.includes(kind) || ["Healing", "Fire protection", "Fire food"].includes(kind))) {
    // only your best rank of each kind is kept: anything lower is sold
    const list = S.supplies[kind] ||= [];
    const best = Math.max(-1, ...list.map(n => BY_NAME[n].rank));
    if (r.rank > best) { list.forEach(n => sellItem(n, offline)); list.length = 0; }
    if (r.rank >= best && list.length < BAL.buffs.keep) return void list.push(r.name);
  }
  sellItem(r.name, offline);
}
function sellItem(name, offline) {
  if (offline) S.unsold += sellValue(name); else S.gold += sellValue(name);
}
function takeSupply(kind) {
  const list = S.supplies[kind] || [];
  list.sort((a, b) => BY_NAME[b].rank - BY_NAME[a].rank);
  return list.shift();
}
function refreshBuffs() {
  for (const role of BUFF_ROLES) if (!active(S.buffs, role) && (S.supplies[role] || []).length) {
    const name = takeSupply(role);
    S.buffs[role] = { until: S.clock + BAL.buffs.minutes * 60, rank: BY_NAME[name].rank, name };
  }
}

// ---- Ragnaros --------------------------------------------------------------------------------
function ragnarosOdds() {
  const r = BAL.ragnaros, worn = ARMOR_SLOTS.map(s => S.armor[s]).filter(Boolean);
  let fr = worn.reduce((t, n) => t + (BY_NAME[n].fire_resistance || 0), 0);
  if ((S.supplies["Fire protection"] || []).length) fr += r.potion_fr;
  if ((S.supplies["Fire food"] || []).length) fr += r.food_fr;
  const dps = weaponDps("Tough"), hp = maxHp();
  const win = r.max_win * Math.min(1, dps / r.dps_need) ** 2 * Math.min(1, hp / r.hp_need)
    * (r.fr_floor + (1 - r.fr_floor) * Math.min(1, fr / r.fr_need) ** 2);
  return { win, fr, dps, hp };
}
// The outcome is rolled when the fight starts, so the bars show what really happens. A win takes the
// whole fight; a loss comes sooner the weaker you are (a few seconds when you have no chance at all).
function ragFate(f) {
  if (f.dies === undefined) {
    const { win } = ragnarosOdds(), full = BAL.ragnaros.fight_minutes * 60;
    f.dies = Math.random() >= win;
    f.time = f.dies ? Math.max(3, full * (win / BAL.ragnaros.max_win) * (0.6 + 0.4 * Math.random())) : full;
  }
  return f;
}
function ragBars(t) { // Ragnaros's health and yours at time t of the fight
  const f = ragFate(S.field), o = ragnarosOdds(), full = BAL.ragnaros.fight_minutes * 60;
  const foeMax = BAL.ragnaros.dps_need * full, youMax = Math.round(o.hp);
  const hits = Math.max(1, Math.round(f.time / 1.5)), taken = Math.min(hits, Math.floor(t / (f.time / hits) + 1e-9)) / hits;
  const foe = f.dies ? 1 - Math.min(1, o.dps / BAL.ragnaros.dps_need) * t / full : 1 - t / f.time;
  const you = f.dies ? 1 - taken : 1 - (0.9 - 0.75 * o.win / BAL.ragnaros.max_win) * taken;
  return { foe: Math.round(foeMax * clamp(foe, 0, 1)), foeMax, you: Math.max(f.dies ? 0 : 1, Math.round(youMax * you)), youMax };
}
function finishRagnaros(offline) {
  const won = !ragFate(S.field).dies;
  takeSupply("Fire protection"); takeSupply("Fire food");
  S.field = null;
  if (won) { S.ragnarosWon = true; toast("Ragnaros is defeated!"); checkGoal(); }
  else { die("was defeated by Ragnaros", offline); toast("Ragnaros won this time. Try again when you're ready."); }
}

// ---- time ------------------------------------------------------------------------------------
// Moves the game forward by dt seconds. Offline (page closed): both slots only repeat what they
// were doing, nothing sells, and the Shop isn't used.
function advance(dt, offline) {
  let guard = 0;
  while (dt > 1e-6 && guard++ < 2e6) {
    refreshBuffs();
    if (S.ambush > 0 && !S.ambushing && !S.field && learned("combat")) startAmbush(offline);   // nothing running: it hits now
    const fa = S.clock < S.corpseUntil ? null : actionOf("field"), wa = actionOf("work");
    const workStuck = wa && missing(wa.entry);
    const tf = fa ? Math.max(0, fa.time - S.fieldT) : Infinity;
    const tw = wa && !workStuck ? Math.max(0, wa.time - S.workT) : Infinity;
    const corpse = S.clock < S.corpseUntil ? S.corpseUntil - S.clock : Infinity;
    const step = Math.min(dt, tf, tw, corpse, 60);
    S.clock += step; dt -= step;
    if (fa) S.fieldT += step;
    if (wa && !workStuck) S.workT += step;
    if (fa || (wa && !workStuck)) S.rested = Math.max(0, S.rested - step);   // used up while anything is running
    if (fa && S.fieldT >= fa.time - 1e-9) {
      S.fieldT = 0;
      if (fa.ambush) {
        S.ambushing = null; S.ambush--;
        const deaths = S.deaths;
        finishFight(fa.entry, offline, true, takeFate(fa.entry));
        if (!offline && ambushView) { ambushView.result = S.deaths > deaths ? "lost" : "won"; ambushView.hp = maxHp(); renderAmbush();
          setTimeout(() => { if (ambushView?.result) { ambushView = null; renderAmbush(); } }, 6000); }
      }
      else finishField(offline);
      if (S.ambush > 0 && !S.ambushing && learned("combat") && S.clock >= S.corpseUntil) startAmbush(offline);   // after the current action
    }
    if (wa && !workStuck && S.workT >= wa.time - 1e-9) { S.workT = 0; finishWork(offline); }
  }
}
function startAmbush(offline) {
  S.ambushing = ambushTarget().name; S.fieldT = 0;
  fateFor(MOB[S.ambushing]);   // decided up front, so the fight on screen shows what really happens
  if (!offline) { ambushView = { name: S.ambushing, result: null, hidden: false }; renderAmbush(); }
}
function catchUpOffline() { catchUp(Math.max(0, (Date.now() - S.savedAt) / 1000)); }
function catchUp(away) { // offline rules: page closed, or the tab slept for a long time
  if (away < 5) return;
  const cap = BAL.offline.cap_hours * 3600;
  advance(Math.min(away, cap), true);
  if (away > cap) S.rested = Math.min(S.rested + (away - cap) / 3600 * BAL.offline.rested_per_hour * 60, BAL.offline.rested_cap * 60);
  S.gold += S.unsold; S.unsold = 0;
}

// ---- checks and goal ------------------------------------------------------------------------
function first(k, name) {
  if (!S.firsts.includes(name)) S.firsts.push(name);
  check(locationName(k, name));
}
const pendingChecks = new Set();
function check(locName) { pendingChecks.add(locName); }
function flushChecks() {
  if (solo) return soloChecks();
  if (!ws || ws.readyState !== 1 || !nameToLoc) return;
  const ids = [...pendingChecks].map(n => nameToLoc[n]).filter(id => id !== undefined && !checked.has(id));
  pendingChecks.clear();
  if (ids.length) { send([{ cmd: "LocationChecks", locations: ids }]); ids.forEach(i => checked.add(i)); }
}
function resendAllChecks() {
  for (const k of Object.keys(P)) {
    for (let r = 0; r < 4; r++) if (S.level[k] >= RANK_CAPS[r]) check(milestoneName(k, r));
    for (let r = 0; r < 4; r++) for (const e of thingsOf(k, r)) if (S.firsts.includes(e.name)) check(locationName(k, e.name));
  }
}
const masteredCount = () => PROFS.filter(p => S.level[p.key] >= 300).length;
function goalDone() {
  const g = slotData.goal || "ragnaros", need = slotData.professions_to_master || 6;
  const rag = S.ragnarosWon, mas = masteredCount() >= need;
  return g === "ragnaros" ? rag : g === "master_professions" ? mas : rag && mas;
}
function checkGoal(resend = false) {
  if (solo && !S.goalSent && goalDone()) { S.goalSent = true; dirty = true; toast("Goal complete!"); log(`<span class="pl-me">You</span> completed your goal!`); }
  if ((S.goalSent && !resend) || !goalDone() || !ws || ws.readyState !== 1) return;
  send([{ cmd: "StatusUpdate", status: 30 }]);
  if (!S.goalSent) toast("Goal complete!");
  S.goalSent = true;
}

// ---- items from the multiworld --------------------------------------------------------------
function applyItems(quiet = false) { // quiet: loading a save, so items that came in while you were away don't pop up
  ranks = Object.fromEntries(PROFS.map(p => [p.key, 0]));
  moltenCore = false;
  for (const it of received) {
    const name = it.name ?? itemIdToName[it.item];
    const prof = PROFS.find(p => name === `Progressive ${p.name}`);
    if (prof) ranks[prof.key] = Math.min(4, ranks[prof.key] + 1);
    if (name === "Molten Core") moltenCore = true;
  }
  if (!S) return;
  for (; S.applied < received.length; S.applied++) {
    const it = received[S.applied], name = it.name ?? itemIdToName[it.item];
    const effect = oneShot(name);
    if (started && !quiet) receivedPopup(it, name, effect);
  }
  if (!learned(selected)) selected = PROFS.find(p => learned(p.key))?.key || selected;
}
// Applies one item and returns what it did, in plain words (HTML), for its popup. "" = nothing to say.
function oneShot(name) {
  const open = PROFS.map(p => p.key).filter(k => learned(k) && S.level[k] < 300);
  const lowest = list => list.sort((a, b) => S.level[a] - S.level[b])[0];
  const pctOf = v => `${Math.round(v * 100)}%`;
  const prof = PROFS.find(p => name === `Progressive ${p.name}`);
  if (prof) return ranks[prof.key] ? `${esc(prof.name)} can now reach ${cap(prof.key)}` : "";
  switch (name) {
    case "Molten Core": return "Ragnaros can now be fought";
    case "Speed Upgrade": case "XP Upgrade": {
      const speedUp = name === "Speed Upgrade", lv = speedUp ? S.speedLv : S.xpLv, step = speedUp ? BAL.gold.speed_step : BAL.gold.xp_step;
      const k = open.filter(k => lv[k] < BAL.gold.steps).sort((a, b) => lv[a] - lv[b] || S.level[a] - S.level[b])[0];
      if (!k) return "Every profession already has the most";
      lv[k]++;
      return `${esc(P[k].name)} ${speedUp ? "speed" : "XP"} +${pctOf(step)} (now +${pctOf(lv[k] * step)})`;
    }
    case "Bag Upgrade": S.bagBonus += BAL.pool.useful["Bag Upgrade"].storage; return `Bags now hold ${bagCap()} of each material`;
    case "Better Prices": S.sellBonus += BAL.pool.useful["Better Prices"].sell;
      return `Materials sell for +${pctOf(BAL.pool.useful["Better Prices"].sell)} (now +${pctOf(S.sellBonus)})`;
    case "Coin Pouch": {
      const top = Math.max(...PROFS.map(p => Math.floor((S.level[p.key] - 1) / 75)));
      const amount = BAL.pool.filler["Coin pouch"].gold * C.rank_growth ** top;
      S.gold += amount;
      return `+<span class="coins">${coins(amount, true)}</span>`;
    }
    case "Rested XP": {
      const before = S.rested;
      S.rested = Math.min(S.rested + BAL.pool.filler["Rested XP"].rested_min * 60, BAL.offline.rested_cap * 60);
      const added = Math.round((S.rested - before) / 60);
      return added ? `+${added} min of double XP (now ${Math.round(S.rested / 60)} min)` : "Rested is already full";
    }
    case "Tome of Experience": {
      const k = lowest(open);
      if (!k) return "Nothing left to train";
      const before = S.level[k];
      for (let i = 0; i < BAL.pool.filler["Tome of experience"].levels; i++) addXp(k, xpNeed(S.level[k]) / gameSpeed(), true);
      const gained = S.level[k] - before;
      return gained ? `${esc(P[k].name)} +${gained} (now ${S.level[k]})` : `XP for ${esc(P[k].name)} (at its cap of ${cap(k)})`;
    }
    case "Resurrection Sickness": case "Broken Tool": {
      S.debuffs[name] = { until: S.clock + BAL.traps[name].minutes * 60 };
      return `${BAL.traps[name].minutes} min: ${esc(DEBUFFS.find(d => d[0] === name)[2])}`;
    }
    case "Repair Bill": {
      const lost = S.gold * BAL.traps["Repair Bill"].gold_percent / 100;
      S.gold -= lost;
      return `-<span class="coins">${coins(lost, true)}</span> (${BAL.traps["Repair Bill"].gold_percent}% of your gold)`;
    }
    case "Murloc Ambush":
      if (!learned("combat")) return "No effect: you can't fight yet";
      S.ambush += BAL.traps["Murloc Ambush"].fights; return "A murloc is coming for you";
  }
  return "";
}

// ---- solo play: no server, the game places and hands out its own items ---------------------------
// Same pool and the same logic as the apworld (worlds/skillup/__init__.py and Rules.py), so a solo
// game plays like a one-player seed. One solo save per browser, kept apart from every room's save.
let solo = false;
const SOLO_KEY = "skillup:solo";
const SOLO_CONN = { solo: true, seed: "solo", team: 0, slot: 0, slotName: "Solo", server: "this browser", players: { 0: "You" } };
const PAIRS = { mining: "blacksmithing", herbalism: "alchemy", skinning: "leatherworking", fishing: "cooking" };
const USEFUL = Object.fromEntries(Object.entries(BAL.pool.useful).map(([n, v]) => [n, v.count]));
const FILLER = { "Coin Pouch": BAL.pool.filler["Coin pouch"].count, "Rested XP": BAL.pool.filler["Rested XP"].count,
  "Tome of Experience": BAL.pool.filler["Tome of experience"].count };
const TRAPS = ["Resurrection Sickness", "Repair Bill", "Broken Tool", "Murloc Ambush"];
const itemKind = n => n.startsWith("Progressive ") || n === "Molten Core" ? "prog" : n in USEFUL ? "use" : TRAPS.includes(n) ? "trap" : "fill";
// every check: 16 firsts and 4 rank milestones per profession
const LOCATIONS = PROFS.flatMap(p => [0, 1, 2, 3].flatMap(r => [
  ...thingsOf(p.key, r).map(e => ({ name: locationName(p.key, e.name), k: p.key, rank: r, boss: !!e.boss })),
  { name: milestoneName(p.key, r), k: p.key, rank: r, milestone: true }]));
function soloLogic(have) { // Rules.py: ranks gate everything, fighting also needs armor
  const R = (p, n) => n <= 0 || (have[p] || 0) >= n;
  const armor = n => n <= 0 || (R("leatherworking", n) && R("tailoring", n) && R("skinning", n) && fight(n - 1));
  const fight = r => R("combat", r + 1) && armor(r);
  const mats = (k, r) => P[k].source === "combat" ? fight(r) : R(P[k].source, r + 1);
  const reach = (k, r) => P[k].kind === "gathering" ? R(k, r + 1) : P[k].kind === "combat" ? fight(r) : R(k, r + 1) && mats(k, r);
  return { loc: l => l.milestone || P[l.k].kind !== "combat" ? reach(l.k, l.rank) : fight(l.rank) && (!l.boss || armor(l.rank + 1)) };
}
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function makeSoloGame(opts) {
  const pairs = Object.keys(PAIRS);
  const first = opts.starting_pair in PAIRS ? opts.starting_pair : pairs[Math.floor(Math.random() * 4)];
  const starting = [first, PAIRS[first], "combat"];
  const prog = PROFS.flatMap(p => Array(4 - (starting.includes(p.key) ? 1 : 0)).fill(`Progressive ${p.name}`));
  if (opts.goal !== "master_professions") prog.push("Molten Core");
  // Assumed fill: place each progression item where it can be reached with everything not yet placed.
  let placement = null;
  for (let tries = 0; !placement && tries < 50; tries++) {
    placement = {};
    const left = shuffle([...prog]), open = new Set(LOCATIONS.map(l => l.name));
    while (left.length) {
      const item = left.pop(), have = {};
      for (const k of starting) have[k] = 1;
      for (const n of left) { const p = PROFS.find(p => n === `Progressive ${p.name}`); if (p) have[p.key] = (have[p.key] || 0) + 1; }
      const rules = soloLogic(have);
      const spots = LOCATIONS.filter(l => open.has(l.name) && rules.loc(l));
      if (!spots.length) { placement = null; break; }
      const spot = spots[Math.floor(Math.random() * spots.length)].name;
      placement[spot] = item; open.delete(spot);
    }
  }
  const rest = shuffle(LOCATIONS.map(l => l.name).filter(n => !(n in placement)));
  const extras = Object.entries(USEFUL).flatMap(([n, c]) => Array(c).fill(n));
  const pick = table => { let r = Math.random() * Object.values(table).reduce((a, b) => a + b, 0);
    for (const [n, w] of Object.entries(table)) if ((r -= w) < 0) return n; return Object.keys(table)[0]; };
  while (extras.length < rest.length) extras.push(Math.random() * 100 < BAL.pool.trap_percent ? TRAPS[Math.floor(Math.random() * 4)] : pick(FILLER));
  rest.forEach((loc, i) => placement[loc] = extras[i]);
  return { opts: { ...opts, starting_professions: starting }, placement, received: starting.map(k => `Progressive ${P[k].name}`), checked: [] };
}
function soloChecks() { // a check in solo hands out the item placed there
  let got = false;
  for (const loc of pendingChecks) {
    if (checked.has(loc) || !(loc in S.solo.placement)) continue;
    const item = S.solo.placement[loc];
    checked.add(loc); S.solo.checked.push(loc); S.solo.received.push(item); received.push({ name: item, loc });
    const html = `<span class="it-${itemKind(item)}">${esc(item)}</span>`;
    log(`<span class="pl-me">You</span> found your ${html} (<span class="loc">${esc(loc)}</span>)`);
    got = dirty = true;
  }
  pendingChecks.clear();
  if (got) { applyItems(); if (started) render(); }
}
const soloSaved = () => { try { const x = JSON.parse(lsGet(SOLO_KEY) || "null"); return x?.v === SAVE_VERSION && x.solo ? x : null; } catch { return null; } };
function startSolo(opts) {
  if (ws) { sock++; ws.onclose = ws.onmessage = null; ws.close(); ws = null; }
  solo = true; conn = SOLO_CONN;
  S = opts ? Object.assign(newSave(), { solo: makeSoloGame(opts) }) : normalize(soloSaved());
  slotData = S.solo.opts;
  received = S.solo.received.map(name => ({ name }));
  checked = new Set(S.solo.checked);
  applyItems(true);
  log(`<span class="sys">${opts ? "New solo game. Every check you do gives you one of this game's items." : "Solo game resumed."}</span>`);
  startGame();
}

// ---- shop --------------------------------------------------------------------------------------
const shopCost = lv => BAL.gold.cost_base * BAL.gold.cost_growth ** lv;
function buy(k, kind) {
  const lv = kind === "speed" ? S.speedLv : S.xpLv;
  if (lv[k] >= BAL.gold.steps || S.gold < shopCost(lv[k])) return;
  S.gold -= shopCost(lv[k]); lv[k]++;
  render();
}
function sell(name) { const n = Math.floor(S.stock[name] || 0); S.gold += n * sellValue(name); S.stock[name] = (S.stock[name] || 0) - n; }
function sellAll(name) { sell(name); render(); }
function sellEverything() { Object.keys(S.stock).forEach(sell); render(); }

// ============================================================================================
// Saving: a copy in this browser + the Archipelago server's data storage (any device can resume)
// ============================================================================================
const storageKey = () => `skillup_save_${conn.team}_${conn.slot}`;
const localKey = () => solo ? SOLO_KEY : `skillup:${conn.seed}:${conn.team}:${conn.slot}`;
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
let dirty = false;
const roomId = () => `${conn.seed}:${conn.team}:${conn.slot}`;
function save(remote = true) {
  if (!S || !conn || replaced) return;
  S.savedAt = Date.now();
  if (S.gold > GOLD_CAP) S.gold = GOLD_CAP;
  S.room = roomId();
  lsSet(localKey(), JSON.stringify(S));
  if (remote && ws && ws.readyState === 1)
    send([{ cmd: "Set", key: storageKey(), default: null, want_reply: false, operations: [{ operation: "replace", value: S }] }]);
  rememberRoom();
  dirty = false;
}
function loadSave(remote) {
  let local = null;
  try { local = JSON.parse(lsGet(localKey()) || "null"); } catch {}
  const pick = [remote, local].filter(x => x && x.v === SAVE_VERSION && (!x.room || x.room === roomId()))
    .sort((a, b) => b.savedAt - a.savedAt)[0];
  S = normalize(pick);
}
function normalize(saved) { // fills in anything an older save doesn't have
  const s = Object.assign(newSave(), saved || {});
  for (const k of ["level", "xp", "speedLv", "xpLv"]) s[k] = { ...newSave()[k], ...s[k] };
  for (const list of Object.values(s.supplies)) {   // older saves: only the best rank of each supply is kept, the rest sold
    const best = Math.max(-1, ...list.map(n => BY_NAME[n]?.rank ?? -1));
    for (const n of list.filter(n => (BY_NAME[n]?.rank ?? -1) < best)) s.gold += baseValue(n) * (1 + s.sellBonus);
    list.splice(0, list.length, ...list.filter(n => (BY_NAME[n]?.rank ?? -1) === best));
  }
  return s;
}

// ============================================================================================
// Archipelago connection
// ============================================================================================
let ws = null, conn = null, nameToLoc = null, itemIdToName = {}, checked = new Set(), playerGames = {};
const gamesPackage = {};
function send(packets) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(packets)); }

let sock = 0;   // bumps on every new connection; handlers from an older one are ignored
// One window per slot: each window claims the slot when it connects, and an older window that sees
// someone else's claim saves, disconnects and stops, so two windows never overwrite each other's progress.
const WINDOW_ID = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
const activeKey = () => `skillup_active_${conn.team}_${conn.slot}`;
let replaced = false, claiming = false;
function connect(server, slotName, password) {
  server = server.trim();
  if (ws) { ws.onclose = ws.onmessage = null; ws.close(); }
  const mine = ++sock;
  const urls = /^wss?:\/\//.test(server) ? [server] : location.protocol === "https:" ? [`wss://${server}`] : [`wss://${server}`, `ws://${server}`];
  $("c-err").textContent = "Connecting…";
  let attempt = 0, opened = false, room = null;
  const open = () => {
    if (mine !== sock) return;
    ws = new WebSocket(urls[attempt]);
    ws.onopen = () => { opened = true; };
    ws.onmessage = ev => { if (mine === sock) for (const pkt of JSON.parse(ev.data)) handle(pkt); };
    ws.onclose = () => {
      if (mine !== sock) return;
      if (!opened && ++attempt < urls.length) return open();
      setOnline(false);
      if (!S) { $("c-err").textContent = "Could not connect. Check the server address and port."; return; }
      log(`<span class="sys">Disconnected. Retrying in 10 seconds; your progress keeps going and is saved in this browser.</span>`);
      setTimeout(() => { if (mine === sock && (!ws || ws.readyState > 1)) { attempt = 0; opened = false; open(); } }, 10000);
    };
  };
  function claim() {
    claiming = true;
    send([{ cmd: "Set", key: activeKey(), default: null, want_reply: true, operations: [{ operation: "replace", value: WINDOW_ID }] }]);
  }
  function stopHere(flush) { // this slot was opened in another window
    if (flush && S) { flushChecks(); save(); }
    replaced = true;
    sock++; if (ws) { ws.onclose = ws.onmessage = null; ws.close(); ws = null; }
    setOnline(false);
    if (!S) { $("c-err").textContent = "This game was just opened in another window."; return; }
    const ov = document.createElement("div");
    ov.className = "away-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-label", "Playing somewhere else");
    ov.innerHTML = `<div class="away-card frame"><div class="amb-title won">Playing somewhere else</div>
      <div class="amb-sub">${esc(conn.slotName)} was opened in another window or device, so this one stopped. Your progress was saved and carries on over there.</div>
      <button class="wbtn">Play here instead</button></div>`;
    ov.querySelector("button").onclick = () => {
      try { sessionStorage.setItem("skillup:pass", password || ""); } catch {}
      location.href = `${location.pathname}?${new URLSearchParams({ server, slot: slotName })}`;
    };
    document.body.append(ov);
    ov.querySelector("button").focus();
  }
  function wrongRoom() { // the address now hosts something else: stop without sending anything
    sock++; ws.onclose = ws.onmessage = null; ws.close(); setOnline(false);
    log(`<span class="sys">This address now hosts a different room, so nothing was sent. Your progress here is saved. Click your name at the top to connect to another room.</span>`);
    toast("The server now hosts a different room. Nothing was sent.");
  }
  function handle(pkt) {
    switch (pkt.cmd) {
      case "RoomInfo":
        room = pkt;
        if (S && conn && pkt.seed_name !== conn.seed) return wrongRoom();
        { const need = pkt.games.filter(gm => !gamesPackage[gm]);   // reconnects reuse what we have
          if (need.length) send([{ cmd: "GetDataPackage", games: need }]); else handle({ cmd: "DataPackage", data: { games: {} } }); }
        break;
      case "DataPackage": {
        Object.assign(gamesPackage, pkt.data.games);
        const pkg = gamesPackage[GAME];
        if (!pkg) { $("c-err").textContent = "This room has no SkillUp game."; ws.onclose = null; ws.close(); return; }
        nameToLoc = pkg.location_name_to_id;
        itemIdToName = Object.fromEntries(Object.entries(pkg.item_name_to_id).map(([k, v]) => [v, k]));
        send([{ cmd: "Connect", game: GAME, name: slotName, password: password || "", uuid: uuid(),
          version: { major: 0, minor: 6, build: 7, class: "Version" }, items_handling: 0b111, tags: [], slot_data: true }]);
        break;
      }
      case "ConnectionRefused": {
        const pw = (pkt.errors || []).includes("InvalidPassword");
        const msg = pw ? "This room needs a password." : "The server refused the connection: " + (pkt.errors || []).join(", ");
        if (S) log(`<span class="sys">${esc(msg)} Reload the page to try again.</span>`);
        else { $("c-err").textContent = msg; if (pw) $("c-pass").focus(); }
        ws.onclose = null; ws.close(); setOnline(false);
        break;
      }
      case "Connected":
        if (S && conn && (room.seed_name !== conn.seed || pkt.team !== conn.team || pkt.slot !== conn.slot)) return wrongRoom();
        slotData = pkt.slot_data || {};
        conn = { seed: room.seed_name, team: pkt.team, slot: pkt.slot, slotName, server, players: Object.fromEntries(pkt.players.map(p => [p.slot, p.alias || p.name])) };
        checked = new Set(pkt.checked_locations);
        playerGames = Object.fromEntries(Object.entries(pkt.slot_info || {}).map(([k, v]) => [k, v.game]));
        if (slotData.death_link) send([{ cmd: "ConnectUpdate", tags: ["DeathLink"] }]);
        setOnline(true);
        send([{ cmd: "SetNotify", keys: [activeKey()] }]);
        if (S) send([{ cmd: "Get", keys: [activeKey()] }]);   // reconnect: keep playing, unless another window took over meanwhile
        else claim();
        break;
      case "Retrieved":
        if (S && conn && activeKey() in pkt.keys && !replaced) {
          const owner = pkt.keys[activeKey()];
          if (owner && owner !== WINDOW_ID) return stopHere(false);
          claim(); resendAllChecks(); flushChecks(); checkGoal(true);
        }
        if (!S && conn && storageKey() in pkt.keys && !replaced) { loadSave(pkt.keys[storageKey()]); applyItems(true); startGame(); }
        break;
      case "SetReply":
        if (!conn || pkt.key !== activeKey()) break;
        if (pkt.value !== WINDOW_ID) { if (!replaced) stopHere(true); break; }
        if (!claiming) break;
        claiming = false;
        if (S) break;
        // Taking over from another window: give it a moment to save before loading.
        { const other = pkt.original_value && pkt.original_value !== WINDOW_ID;
          if (other) $("c-err").textContent = "Taking over from your other window…";
          setTimeout(() => { if (mine === sock) send([{ cmd: "Get", keys: [storageKey()] }]); }, other ? 2000 : 0); }
        break;
      case "ReceivedItems":
        if (pkt.index === 0) received = [];
        if (pkt.index !== received.length) { send([{ cmd: "Sync" }]); break; }
        received.push(...pkt.items);
        applyItems();
        if (S) render();
        break;
      case "RoomUpdate":
        (pkt.checked_locations || []).forEach(i => checked.add(i));
        break;
      case "PrintJSON":
        log(renderJson(pkt.data), pkt.type === "Hint" ? "hint" : "");
        // items you send; items you get pop up when they're applied (applyItems), so they can say what they did
        if (pkt.type === "ItemSend" && conn && pkt.item?.player === conn.slot && pkt.receiving !== conn.slot) {
          const item = renderJson([{ type: "item_id", text: String(pkt.item.item), player: pkt.receiving, flags: pkt.item.flags }]);
          itemPopup({ sent: true, item, who: renderJson([{ type: "player_id", text: String(pkt.receiving) }]),
            why: checkReason(lookup("location", pkt.item.location, conn.slot)) });
        }
        break;
      case "Bounced":
        if ((pkt.tags || []).includes("DeathLink") && pkt.data?.source !== conn?.slotName && S) {
          if (S.field?.kind === "mob") die(pkt.data?.cause || "", true);
          else S.debuffs["Resurrection Sickness"] = { until: S.clock + BAL.traps["Resurrection Sickness"].minutes * 60 };
          toast(`${pkt.data?.source || "Someone"} died. ${pkt.data?.cause || ""}`);
        }
        break;
    }
  }
  open();
}
function sendDeathLink(cause) {
  if (!slotData.death_link || !conn) return;
  send([{ cmd: "Bounce", tags: ["DeathLink"], data: { time: Date.now() / 1000, source: conn.slotName, cause: `${conn.slotName} ${cause}` } }]);
}
const reverse = {};
function lookup(kind, id, player) {
  const game = playerGames[player], pkg = gamesPackage[game];
  if (!pkg) return String(id);
  reverse[kind + game] ||= Object.fromEntries(Object.entries(kind === "item" ? pkg.item_name_to_id : pkg.location_name_to_id).map(([k, v]) => [v, k]));
  return reverse[kind + game][id] ?? String(id);
}
function renderJson(parts) {
  return parts.map(p => {
    switch (p.type) {
      case "player_id": return `<span class="${+p.text === conn?.slot ? "pl-me" : "pl"}">${esc(conn?.players[+p.text] || p.text)}</span>`;
      case "player_name": return `<span class="pl">${esc(p.text)}</span>`;
      case "item_id": case "item_name": {
        const kind = p.flags & 4 ? "trap" : p.flags & 1 ? "prog" : p.flags & 2 ? "use" : "fill";
        return `<span class="it-${kind}">${esc(p.type === "item_id" ? lookup("item", +p.text, p.player) : p.text)}</span>`;
      }
      case "location_id": case "location_name": return `<span class="loc">${esc(p.type === "location_id" ? lookup("location", +p.text, p.player) : p.text)}</span>`;
      case "entrance_name": return `<span class="ent">${esc(p.text)}</span>`;
      default: return esc(p.text ?? "");
    }
  }).join("");
}
function uuid() {
  let u = lsGet("skillup:uuid");
  if (!u) { u = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36); lsSet("skillup:uuid", u); }
  return u;
}
function rememberRoom() {
  let rooms = [];
  try { rooms = JSON.parse(lsGet("skillup:rooms") || "[]"); } catch {}
  rooms = rooms.filter(r => solo ? !r.solo : r.solo || !(r.server === conn.server && r.slot === conn.slotName));
  rooms.unshift(solo ? { solo: true, at: Date.now(), checks: checked.size, done: S.goalSent }
    : { server: conn.server, slot: conn.slotName, at: Date.now(), checks: checked.size, done: S.goalSent });
  // the solo game always stays in the list, plus up to 5 rooms
  const soloRow = rooms.find(r => r.solo);
  rooms = rooms.filter(r => !r.solo).slice(0, 5);
  if (soloRow) rooms.splice(rooms.filter(r => r.at > soloRow.at).length, 0, soloRow);
  lsSet("skillup:rooms", JSON.stringify(rooms));
}

// ============================================================================================
// Interface
// ============================================================================================
const DEBUFFS = [   // shown top right in the header while active
  ["Resurrection Sickness", GD.ui_icons.res_sickness, `combat speed -${Math.round((1 - BAL.traps["Resurrection Sickness"].combat_slow) * 100)}%`],
  ["Broken Tool", "inv_misc_wrench_01", "your gathering tools don't help"],
];
const pct = v => `${Math.round(v * 100)}%`;
const fmtT = s => !isFinite(s) ? "—" : s < 10 ? s.toFixed(1) + "s" : s < 59.5 ? Math.round(s) + "s"
  : s < 3599.5 ? Math.floor(Math.round(s) / 60) + "m" + String(Math.round(s) % 60).padStart(2, "0") : (s / 3600).toFixed(1) + "h";
const ic = ICON;
function coins(c, compact = false, short = false) { // short: from 1000 gold on, leave the copper off
  c = Math.floor(c);
  const g = Math.floor(c / 10000), s = Math.floor(c / 100) % 100, cp = c % 100;
  const parts = [[g, GD.ui_icons.gold, "gold"], [s, GD.ui_icons.silver, "silver"], [cp, GD.ui_icons.copper, "copper"]];
  if (short && g >= 1000) parts.pop();
  const shown = compact ? parts.filter(([v]) => v) : parts.filter(([v], i) => v || i === 2 || (i === 1 && g));
  return (shown.length ? shown : [parts[2]]).map(([v, i, a]) => `<span class="n">${v}</span><img src="${ic(i)}" alt="${a}">`).join("");
}
const lvl = (c, u) => `<span class="lvl c-${c.name}" title="Skill ${u}: ${COLOR_TIP[c.name]}">${u}</span>`;
const pace = hr => hr > 0 ? `<span title="One skill level every ${fmtT(3600 / hr)}">+1 / <b>${fmtT(3600 / hr)}</b></span>` : "";
const pips = lv => `<span class="pips">${Array.from({ length: 10 }, (_, i) => `<i class="${i < lv ? "on" : ""}"></i>`).join("")}</span>`;
function popup(html, cls = "") {
  let stack = $("toasts");
  if (!stack) { stack = document.createElement("div"); stack.id = "toasts"; stack.className = "toasts"; stack.setAttribute("aria-live", "polite"); document.body.append(stack); }
  const el = document.createElement("div");
  el.className = `toast ${cls}`; el.innerHTML = html;
  stack.append(el);
  while (stack.childElementCount > 4) stack.firstElementChild.remove();
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 400); }, 5000);
}
const toast = text => popup(esc(text));
// Item popups: a small header, then what happened. "why" is the check that sent it, in plain words.
const VERB = { mining: "mined", herbalism: "gathered", skinning: "skinned", fishing: "caught", combat: "defeated", cooking: "cooked" };
function checkReason(loc) {
  const m = /^(.+?): (.+)$/.exec(loc), p = m && PROFS.find(q => q.name === m[1]);
  if (p) return `First ${m[2]} ${VERB[p.key] || "crafted"}`;
  if (PROFS.some(q => RANKS.some(r => loc === `${r.name} ${q.title}`))) return `Reached ${loc}`;
  return loc;
}
// No "who" = your own item from your own check (every check in solo play): "Item Found".
function itemPopup({ sent, item, who, why, effect }) {
  popup(`<div class="toast-h">${sent ? "Item Sent" : who ? "Item Received" : "Item Found"}</div>`
    + (why ? `<div class="toast-why">${esc(why)}</div>` : "")
    + `<div>${item}${who ? ` <span class="mute">${sent ? "to" : "from"}</span> ${who}` : ""}</div>`
    + (effect ? `<div class="toast-fx">${effect}</div>` : ""), sent ? "sent" : "got");
}
// An item that just reached you (solo: { name, loc }; online: the server's item, with who found it and where).
function receivedPopup(it, name, effect) {
  const item = `<span class="it-${it.flags === undefined ? itemKind(name) : it.flags & 4 ? "trap" : it.flags & 1 ? "prog" : it.flags & 2 ? "use" : "fill"}">${esc(name)}</span>`;
  if (solo) return itemPopup({ item, why: it.loc && checkReason(it.loc), effect });
  const own = it.player === conn.slot;
  itemPopup({ item, effect, who: own ? "" : it.player === 0 ? `<span class="pl">Archipelago</span>` : renderJson([{ type: "player_id", text: String(it.player) }]),
    why: own ? checkReason(lookup("location", it.location, conn.slot)) : "" });
}
const logLines = [], LOG_MAX = 300;
function log(html, cls = "") {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const line = `<p class="${cls}"><time>${time}</time>${html}</p>`;
  logLines.push(line);
  if (logLines.length > LOG_MAX) logLines.shift();
  const box = $("logbox");
  if (!box) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;   // don't jump if you scrolled up to read
  box.querySelector(".empty")?.remove();
  box.insertAdjacentHTML("beforeend", line);
  while (box.childElementCount > LOG_MAX) box.firstElementChild.remove();
  if (atBottom) box.scrollTop = box.scrollHeight;
}
const LOG_SKELETON = `<div class="log" id="logbox" role="log" aria-live="polite"></div>
  <form class="say" id="say" autocomplete="off"><input id="say-text" maxlength="500" placeholder="Message or !command" aria-label="Message to the room"><button class="wbtn" type="submit">Send</button></form>`;
const SOLO_LOG = `<div class="log" id="logbox" role="log" aria-live="polite"></div>`;
function renderLog(el) {
  const skeleton = solo ? SOLO_LOG : LOG_SKELETON;
  if (el._html === skeleton) return;          // already showing: new lines are added as they arrive
  el.html = skeleton;
  const box = $("logbox");
  box.innerHTML = logLines.join("") || `<p class="sys empty">${solo ? "The items you find show here." : "Messages from the Archipelago server show here."}</p>`;
  box.scrollTop = box.scrollHeight;
  if (solo) return;
  $("say").onsubmit = ev => {
    ev.preventDefault();
    const text = $("say-text").value.trim();
    if (!text) return;
    if (!ws || ws.readyState !== 1) return log(`<span class="sys">Not connected: message not sent.</span>`);
    send([{ cmd: "Say", text }]);
    $("say-text").value = "";
  };
}
function setOnline(on) { $("online").classList.toggle("off", !on); }

// XP multiplier from Rested and the XP foods, the same ones addXp applies
const xpBoost = field => (S.rested > 0 ? 2 : 1) * (1 + buffValue(field ? "Gathering XP food" : "Crafting XP food"));
function perHour(k, e, craft) { // time per attempt, color, and skill levels per hour
  const c = colorOf(S.level[k], e.unlock), base = baseTime(craft ? "craft_time" : "gather_time", e.rank, slotNum(e));
  let t = Math.max(base / speed(k), BAL.actions.min_action_time);
  let xp = base * c.mult * (craft ? BAL.actions.craft_xp_mult * (BAL.recipes.role_xp_mult[e.role] || 1) : 1);
  if (c.name === "red") { t *= c.slow; xp *= c.chance; }
  return { c, t, hr: S.level[k] >= cap(k) ? 0 : 3600 * xp * gameSpeed() * (1 + S.xpLv[k] * BAL.gold.xp_step) * xpBoost(!craft) / t / xpNeed(S.level[k]) };
}
const perHourGather = (k, e) => perHour(k, e, false), perHourCraft = (k, r) => perHour(k, r, true);
function perHourFight(m) {
  const c = colorOf(S.level.combat, m.unlock), p = deathChance(m);
  const t = Math.max(gearFightTime(m) / speed("combat"), BAL.actions.min_action_time);
  const xp = mobBase(m) * c.mult * (1 - p) * gameSpeed() * (1 + S.xpLv.combat * BAL.gold.xp_step) * xpBoost(true);
  return { c, t, win: 1 - p, hr: S.level.combat >= cap("combat") ? 0 : 3600 * xp / (t + p * (C.corpse_run + t)) / xpNeed(S.level.combat) };
}

// Your bag: the Small Brown Pouch you start with, then the best bag you've crafted.
const bagIconName = () => GD.recipes.filter(r => r.role === "Bag" && S.crafted.includes(r.name)).sort((a, b) => b.rank - a.rank)[0]?.icon || "inv_misc_bag_09";
function renderHeader() {
  $("gold").html = coins(S.gold, false, true);
  $("bags").html = `<span class="hstat" title="Each material holds up to ${bagCap()}. Crafting bags and Bag Upgrades raise it."><img class="icon sm" src="${ic(bagIconName())}" alt=""> ${bagCap()} each</span>`;
  $("rested").html = S.rested > 0 && S.rested < 60
    ? `${Math.ceil(S.rested)}<span class="u-long"> sec</span><span class="u-short">s</span>`
    : `${Math.round(S.rested / 60)}<span class="u-long"> min</span><span class="u-short">m</span>`;
  $("rested-bar").style.width = pct(S.rested / (BAL.offline.rested_cap * 60));
  $("checks").textContent = `${checked.size} / 220`;
  $("debuffs").html = DEBUFFS.filter(([name]) => active(S.debuffs, name)).map(([name, icon, what]) => {
    const left = S.debuffs[name].until - S.clock;
    return `<span class="debuff" title="${name}: ${what}"><img class="icon" src="${ic(icon)}" alt="${name}"><span>${fmtT(left)}</span></span>`;
  }).join("");
  $("who").textContent = conn.slotName; $("where").textContent = solo ? "" : "· " + conn.server;
  $("online").hidden = solo;
}

function renderList() {
  $("proflist").html = GROUPS.map(([label, kind]) => `<div class="glabel">${label}</div>` + byKind(kind).map(p => {
    const k = p.key, r = ranks[k] || 0, full = r && S.level[k] >= cap(k);
    const running = S.field && (S.field.kind === "mob" ? k === "combat" : BY_NAME[S.field.name]?.profession === k) || S.work && BY_NAME[S.work.name]?.profession === k;
    const width = r ? (S.level[k] + (S.xp[k] / xpNeed(S.level[k]))) / cap(k) : 0;
    return `<button class="prof ${k === selected ? "sel" : ""} ${running ? "active" : ""}" data-k="${k}" ${r ? "" : 'disabled title="Not learned yet"'}>
      <img class="icon" src="${ic(p.icon)}" alt="" ${r ? "" : 'style="filter:grayscale(1);opacity:.5"'}><span class="nm"><span>${p.name}</span><small>${r ? RANKS[r - 1].name : "Not learned"}</small></span>
      <div class="sbar ${full ? "full" : ""}"><i style="width:${pct(Math.min(1, width))}"></i><span><span></span><span>${r ? `${S.level[k]} / ${cap(k)}` : ""}</span></span></div></button>`;
  }).join("")).join("");
}

function slotHtml(slot) {
  const a = actionOf(slot);
  if (!a) return `<div class="slot"><div></div><div><div class="k">${slot === "field" ? "Gathering or fighting" : "Crafting"}</div><div class="sub">Nothing running. Pick something below.</div></div></div>`;
  if (a.kind === "ragnaros") return `<div class="slot"><img class="icon lg" src="${ic(GD.ui_icons.ragnaros)}" alt=""><div><div class="k">Fighting · Molten Core</div><div class="what q5">Ragnaros</div><div class="sub">Win chance ${pct(ragnarosOdds().win)}</div></div>
    <div class="fight" data-fight="1"><div class="sbar foe"><i></i><span><span>Ragnaros</span><span></span></span></div>
    <div class="sbar you"><i></i><span><span>You</span><span></span></span></div></div></div>`;
  const e = a.entry, k = a.k;
  const label = slot === "work" ? "Crafting" : a.ambush ? "Ambushed" : a.kind === "mob" ? "Fighting" : "Gathering";
  const hr = a.kind === "mob" ? perHourFight(e) : a.kind === "gather" ? perHourGather(k, e) : perHourCraft(k, e);
  const waiting = slot === "work" && missing(e), dead = slot === "field" && S.clock < S.corpseUntil;
  const status = dead ? `<span class="wait">Running back from the graveyard…</span>` : waiting ? `<span class="wait">Waiting for ${esc(missing(e))}</span>`
    : `${lvl(hr.c, e.unlock)} ${hr.hr > 0 ? pace(hr.hr) : "no skill"}`;
  const img = a.kind === "mob" ? ic(P.combat.icon) : ic(e.icon);
  const bars = a.kind === "mob" && !dead
    ? `<div class="fight" data-fight="1"><div class="sbar foe"><i></i><span><span>${esc(e.name)}</span><span></span></span></div>
       <div class="sbar you"><i></i><span><span>You</span><span></span></span></div></div>`
    : `<div class="cast ${slot === "work" ? "green" : ""}" data-cast="${slot}"><i></i><span></span></div>`;
  return `<div class="slot ${a.ambush ? "ambushed" : ""}"><img class="icon lg" src="${img}" alt=""><div><div class="k">${label} · ${P[k].name}</div>
    <div class="what q${e.quality || 1}">${esc(e.name)}</div><div class="sub">${status}</div></div>${bars}</div>`;
}
// ---- tooltips, styled like the game's ------------------------------------------------------------
const BUFF_TEXT = { "Gathering speed": "gathering speed", "Crafting speed": "crafting speed", "Combat elixir": "damage",
  "Combat food": "health", "Gathering XP food": "skill gain from gathering and fighting", "Crafting XP food": "skill gain from crafting" };
function itemTip(name, note) {
  const e = BY_NAME[name];
  if (!e) return `<div class="tt-name">${esc(name)}</div>`;
  const q = e.legendary ? 5 : e.quality || 1, role = e.role || e.slot, L = [];
  const row = (a, b = "") => L.push(`<div class="tt-row"><span>${a}</span><span>${b}</span></div>`);
  const line = (t, cls = "") => L.push(`<div class="${cls}">${t}</div>`);
  if (role === "Trinket") {
    row("Trinket", "Legendary");
    line(`Equip: Each skill point you gain has a ${pct(TRINKET.bonus_chance)} chance to give you one more, up to your rank's cap.`, "tt-green");
    if (S.trinketBonus) line(`Extra skill points so far: ${S.trinketBonus}`, "tt-mute");
  }
  else if (ARMOR_SLOTS.includes(role)) { row(role, e.legendary ? "Legendary" : ""); line(`Gear Level ${ilvl(name)}`, "tt-gold"); }
  else if (e.weapon) { row("Main Hand", "Sword · Legendary"); line("Equip: Counts as the right weapon against every creature, Ragnaros included.", "tt-green"); }
  else if (WEAPONS.includes(role)) { row("Main Hand", role); line(STRONG[role], "tt-green"); }
  else if (TOOL_FOR[role]) line(`Equip: Increases your ${P[TOOL_FOR[role]].name} speed by ${Math.round((e.rank + 1) * BAL.tools.step * 100)}%.`, "tt-green");
  else if (role === "Bag") line("Crafting your first one doubles how much of each material you can hold.", "tt-green");
  else if (role === "Healing") line(`Use: Restores ${healingHp(name)} health. Automatically consumed when a fight would kill you.`, "tt-green");
  else if (BAL.buffs.effects[role]) line(`Use: Increases your ${BUFF_TEXT[role]} by ${Math.round(BAL.buffs.effects[role] * (1 + BAL.buffs.rank_scale * e.rank) * 100)}% for ${BAL.buffs.minutes} min.`, "tt-green");
  else if (e.legendary && e.slot === "Potion") line(`Use: Increases your Fire Resistance by ${BAL.ragnaros.potion_fr} for the Ragnaros fight.`, "tt-green");
  else if (e.legendary && e.slot === "Food") line(`Use: Increases your Fire Resistance by ${BAL.ragnaros.food_fr} for the Ragnaros fight.`, "tt-green");
  if (e.reagents) {
    const k = e.profession, ok = S.level[k] >= e.unlock;
    line(`Requires ${P[k].name} (${e.unlock})`, ok ? "" : "tt-red");
    line(`Reagents: ${e.reagents.map(n => `${qtyOf(e)}× ${esc(n)}`).join(", ")}`, "tt-mute");
  } else if (e.profession === "combat") line("Dropped by creatures", "tt-mute");
  else if (e.profession) line(`${P[e.profession].name} (${e.unlock})`, S.level[e.profession] >= e.unlock ? "tt-mute" : "tt-red");
  if (note) line(esc(note), "tt-gold");
  if (!e.legendary) L.push(`<div class="tt-sell">Sell Price: <span class="coins">${coins(sellValue(name), true)}</span></div>`);
  return `<div class="tt-name q${q}">${esc(name)}</div>${L.join("")}`;
}
function textTip(text) { // "Title: details" shows the title in gold on its own line
  const i = text.indexOf(": ");
  const rest = text.slice(i + 2);
  return i > 0 && i < 40 ? `<div class="tt-name tt-gold">${esc(text.slice(0, i))}</div><div>${esc(rest[0].toUpperCase() + rest.slice(1))}</div>` : `<div>${esc(text)}</div>`;
}
let tipFor = null;
function showTip(el, x, y) {
  let tt = $("tt");
  if (!tt) { tt = document.createElement("div"); tt.id = "tt"; tt.className = "tt"; tt.setAttribute("role", "tooltip"); document.body.append(tt); }
  if (el.title) { el.dataset.tip = el.title; el.removeAttribute("title"); }   // no browser tooltip on top of ours
  if (tipFor !== el) {
    tipFor?.classList.remove("hot");
    tipFor = el; el.classList.add("hot");
    tt.innerHTML = el.dataset.item ? itemTip(el.dataset.item, el.dataset.note) : textTip(el.dataset.tip || "");
    tt.hidden = false;
  }
  tt.style.left = "0px";   // measure at full width: near the right edge the browser would squish it
  const pad = 14, w = tt.offsetWidth, h = tt.offsetHeight;
  tt.style.left = Math.min(x + pad, innerWidth - w - 6) + "px";
  tt.style.top = (y + pad + h > innerHeight - 6 ? Math.max(6, y - h - pad) : y + pad) + "px";
}
function hideTip() { tipFor?.classList.remove("hot"); tipFor = null; const tt = $("tt"); if (tt) tt.hidden = true; }
let mouse = null;
function tipAt(x, y, target = document.elementFromPoint(x, y)) {
  const el = target?.closest?.("[title], [data-tip], [data-item]");
  if (el) showTip(el, x, y); else if (tipFor) hideTip();
}
document.addEventListener("pointermove", ev => {
  if (ev.pointerType !== "mouse") return;
  mouse = { x: ev.clientX, y: ev.clientY };
  tipAt(mouse.x, mouse.y, ev.target);
});
document.addEventListener("pointerleave", () => { mouse = null; hideTip(); });
// after a refresh replaced what you're pointing at, put the tooltip back on the new one
function refreshTip() { if (tipFor && !tipFor.isConnected) { tipFor = null; if (mouse) tipAt(mouse.x, mouse.y); else hideTip(); } }
document.addEventListener("pointerdown", ev => { if (ev.pointerType !== "mouse") hideTip(); });
document.addEventListener("scroll", hideTip, true);

// ---- the ambush: a full-screen fight ------------------------------------------------------------
let ambushView = null;   // { name, result: null | "won" | "lost", hidden }
function renderAmbush() {
  let ov = $("ambush");
  if (!ambushView || ambushView.hidden) { if (ov) ov.hidden = true; return; }
  const m = MOB[ambushView.name], a = S.ambushing === m.name ? actionOf("field") : null;
  const progress = ambushView.result ? 1 : a ? Math.min(1, S.fieldT / a.time) : 0;
  const foeMax = Math.round(needDps(m) * mobBase(m)), you = maxHp();
  const dies = ambushView.result ? ambushView.result === "lost" : !!(S.fightFate?.mob === m.name && S.fightFate.dies);
  const time = a ? a.time : 1, fb = fightBars(m, time, progress * time, dies), foe = fb.foe, yours = fb.you;
  if (!ov) {
    ov = document.createElement("div"); ov.id = "ambush"; ov.className = "ambush-ov";
    ov.setAttribute("role", "dialog"); ov.setAttribute("aria-label", "Ambush");
    document.body.append(ov);
    ov.addEventListener("click", ev => { if (ev.target === ov || ev.target.closest("[data-hide]")) { ambushView.hidden = true; renderAmbush(); } });
  }
  ov.hidden = false;
  const head = ambushView.result === "won" ? `<div class="amb-title won">Victory</div><div class="amb-sub">You fought off ${esc(m.name)}.</div>`
    : ambushView.result === "lost" ? `<div class="amb-title">You died</div><div class="amb-sub">${esc(m.name)} killed you. Running back from the graveyard.</div>`
    : `<div class="amb-title">Ambush!</div><div class="amb-sub">${esc(m.name)} attacks you. You go back to what you were doing after the fight.</div>`;
  ov.html = `<div class="amb-card frame">${head}
    <img class="amb-mob" src="${m.image}" alt="">
    <div class="plate"><span class="nm">${esc(m.name)}</span><span class="lv">Level ${m.level}${m.classification !== "Normal" ? " · " + m.classification : ""}</span></div>
    <div class="amb-bars">
      <div><div class="amb-k">${esc(m.name)}</div><div class="sbar foe"><i data-amb="foe"></i><span><span></span><span data-amb="foe-t"></span></span></div></div>
      <div><div class="amb-k">You</div><div class="sbar you"><i data-amb="you"></i><span><span></span><span data-amb="you-t"></span></span></div></div>
    </div>
    ${ambushView.result ? "" : `<div class="amb-sub">Win chance ${pct(1 - deathChance(m))}</div>`}
    <button class="wbtn" data-hide="1">${ambushView.result ? "Back to work" : "Hide"}</button></div>`;
  ov.querySelector('[data-amb="foe"]').style.width = pct(foe / foeMax);
  ov.querySelector('[data-amb="foe-t"]').textContent = `${foe.toLocaleString("en-US")} / ${foeMax.toLocaleString("en-US")}`;
  ov.querySelector('[data-amb="you"]').style.width = pct(yours / you);
  ov.querySelector('[data-amb="you-t"]').textContent = `${yours.toLocaleString("en-US")} / ${Math.round(you).toLocaleString("en-US")}`;
}
// ---- a legendary find: a glowing card in the middle of the screen, then it's worn -------------------
function renderLegend() {
  let ov = $("legend");
  if (!S?.trinketNew) { if (ov) ov.remove(); return; }
  if (ov) return;
  ov = document.createElement("div"); ov.id = "legend"; ov.className = "legend-ov";
  ov.setAttribute("role", "dialog"); ov.setAttribute("aria-label", "Legendary item found");
  ov.innerHTML = `<div class="legend-card frame"><div class="lk">Legendary item found</div>
    <img src="${ic(TRINKET.icon)}" alt=""><div class="nm">${esc(TRINKET.name)}</div>
    <div class="fx">Equip: Each skill point you gain has a ${pct(TRINKET.bonus_chance)} chance to give you one more, up to your rank's cap.</div>
    <div class="sub">A hidden trinket, found by pure luck. It is now equipped for the rest of your game.</div>
    <button class="wbtn" data-legend="1">Equip</button></div>`;
  ov.addEventListener("click", () => { S.trinketNew = false; dirty = true; ov.remove(); rtab = "char"; render(); });
  document.body.append(ov);
  ov.querySelector("button").focus();
}
function renderSlots() {
  if (ambushView) renderAmbush();

  $("slots").html = slotHtml("field") + slotHtml("work");
  paintBars();
  refreshTip();
}
// The game moves 4 times a second; the bars are drawn every frame from the time since then, so they glide.
function paintBars() {
  if (!S) return;
  const since = Math.min((performance.now() - lastTick) / 1000, .5);
  for (const bar of $("slots").querySelectorAll("[data-cast]")) {
    const slot = bar.dataset.cast, a = actionOf(slot);
    if (!a) continue;
    const back = slot === "field" ? S.corpseUntil - S.clock - since : 0;
    if (S.corpseUntil > S.clock && slot === "field") {   // corpse run: the bar counts down to when you're back
      bar.firstElementChild.style.width = (clamp(1 - back / C.corpse_run, 0, 1) * 100).toFixed(2) + "%";
      bar.lastElementChild.textContent = `Back in ${Math.max(0, Math.ceil(back))}s`;
      continue;
    }
    const moving = slot === "field" || !missing(a.entry);
    const t = Math.min(a.time, (slot === "field" ? S.fieldT : S.workT) + (moving ? since : 0));
    bar.firstElementChild.style.width = (t / a.time * 100).toFixed(2) + "%";
    bar.lastElementChild.textContent = a.kind === "ragnaros" ? `${fmtT(t)} / ${fmtT(a.time)}` : `${t.toFixed(1)}s / ${a.time.toFixed(1)}s`;
  }
  const fight = $("slots").querySelector("[data-fight]"), a = actionOf("field");
  if (!fight || !a || (a.kind !== "mob" && a.kind !== "ragnaros")) return;
  const t = Math.min(a.time, S.fieldT + since);
  const fb = a.kind === "ragnaros" ? ragBars(t) : fightBars(a.entry, a.time, t, fateFor(a.entry).dies);
  const [foeBar, youBar] = fight.querySelectorAll(".sbar");
  foeBar.firstElementChild.style.width = pct(fb.foe / fb.foeMax);
  foeBar.querySelector("span > span:last-child").textContent = `${fb.foe.toLocaleString("en-US")} / ${fb.foeMax.toLocaleString("en-US")}`;
  youBar.firstElementChild.style.width = pct(fb.you / fb.youMax);
  youBar.querySelector("span > span:last-child").textContent = `${fb.you.toLocaleString("en-US")} / ${fb.youMax.toLocaleString("en-US")}`;
}
function frame() { paintBars(); requestAnimationFrame(frame); }

function renderDetail() {
  const k = selected, p = P[k], L = S.level[k], owned = ranks[k] || 0;
  if (!owned) { $("detail").html = `<div class="locked">🔒 ${p.name} isn't learned yet</div>`; return; }
  tab = Math.min(tab, 3);
  const head = `<div class="dhead"><img class="icon lg" src="${ic(p.icon)}" alt="">
      <div><h3 class="title">${p.name}</h3><div class="rk">${RANKS[owned - 1].name} · ${L} / ${cap(k)}</div></div>
      <div class="mini">${[["Speed", S.speedLv[k], BAL.gold.speed_step], ["XP", S.xpLv[k], BAL.gold.xp_step]].map(([l, lv, st]) =>
        `<span class="mt"><span class="mute">${l}</span>${pips(lv)}<b>+${Math.round(lv * st * 100)}%</b></span>`).join("")}</div></div>`;
  const tabs = `<div class="rtabs" role="tablist">${RANKS.map((r, i) =>
    `<button class="${i === tab ? "on" : ""} ${i >= owned ? "locked" : ""}" data-t="${i}" ${i >= owned ? `title="Locked: this rank comes from ${solo ? "one of your checks" : "the multiworld"}"` : ""}><span>${i >= owned ? '<span class="lock">🔒 </span>' : ""}${r.name}</span><small>${r.start}-${r.cap}</small></button>`).join("")}</div>`;
  let body;
  if (tab >= owned) body = `<div class="locked">🔒 Locked</div>`;
  else if (p.kind === "combat") body = combatHtml();
  else body = rowsHtml(k);
  $("detail").html = head + tabs + body;
}
function checkLabel(done) { return `<span class="chk ${done ? "done" : "todo"}" title="${done ? "Check already sent" : "Doing this the first time sends a check"}">${done ? "✓ Sent" : "◆ Check"}</span>`; }
function rowsHtml(k) {
  const kind = P[k].kind === "crafting" ? "craft" : "gather";
  const list = thingsOf(k, tab).concat(kind === "craft" && tab === 3 && moltenCore ? GD.fire_resistance_set.filter(f => f.profession === k) : []);
  const bagIcon = ic(bagIconName());
  return `<div class="rows">` + list.map((e, i) => {
    const hr = kind === "craft" ? perHourCraft(k, e) : perHourGather(k, e);
    const running = (S.field && S.field.name === e.name) || (S.work && S.work.name === e.name);
    const done = e.legendary ? S.crafted.includes(e.name) : S.firsts.includes(e.name);
    const mats = kind === "craft"
      ? `<ul class="mats">${e.reagents.map(n => { const have = Math.floor(S.stock[n] || 0), need = qtyOf(e);
          return `<li class="${have < need ? "short" : ""}" data-item="${esc(n)}"><img src="${ic(BY_NAME[n].icon)}" alt=""><span>${need}× ${esc(n)}</span><span class="have">${have}</span></li>`; }).join("")}</ul>`
      : `<ul class="mats"><li><img src="${bagIcon}" alt=""><span>In bags</span><span class="have">${Math.floor(S.stock[e.name] || 0)} / ${bagCap()}</span></li></ul>`;
    const rate = hr.c.name === "red" ? `<b class="c-red">${pct(hr.c.chance)}</b> per try<br><span title="Average time per success">~${fmtT(hr.t / hr.c.chance)} per success</span>`
      : hr.hr > 0 ? `${pace(hr.hr)}<br><span>${fmtT(hr.t)} each</span>` : `${S.level[k] >= 300 ? "Maxed" : e.legendary ? "Legendary" : "no skill"}<br><span>${fmtT(hr.t)} each</span>`;
    const legendLbl = e.legendary && !list[i - 1]?.legendary ? `<div class="legendary-lbl" style="grid-column:1/-1">Legendary · for Ragnaros</div>` : "";
    return `${legendLbl}<div class="row"><img class="icon" src="${ic(e.icon)}" alt="" data-item="${esc(e.name)}">
      <div class="info"><div class="nmline"><span class="nm q${e.quality}" data-item="${esc(e.name)}">${esc(e.name)}</span></div>
        <div class="meta">${lvl(hr.c, e.unlock)}${kind === "craft" ? `<span class="cat">${esc(e.role || e.slot)}</span>` : ""}</div>${mats}</div>
      ${e.legendary ? `<span></span>` : checkLabel(done)}
      <div class="rate">${rate}</div>
      <div class="act"><button class="wbtn ${running ? "on" : ""}" data-do="${kind}" data-name="${esc(e.name)}">${running ? "Stop" : kind === "craft" ? "Craft" : "Gather"}</button></div></div>`;
  }).join("") + `</div>`;
}
function combatHtml() {
  const zone = GD.mobs.filter(m => m.rank === tab);
  const yours = gearLevel();
  return `<div class="zone"><span class="title">${zone[0].zone}</span><span class="mute" style="font-size:13.5px">Every creature drops ${zone[0].cloth}</span></div><div class="mobs">` +
    zone.map(m => {
      const r = perHourFight(m), seen = S.firsts.includes(m.name), locked = S.level.combat < m.unlock;
      const rec = recommended(m), running = S.field?.kind === "mob" && S.field.name === m.name;
      const verdict = r.win >= .995 ? `<span class="verdict v-safe" title="You always win with your gear">Safe</span>`
        : `<span class="verdict ${r.win >= .5 ? "v-risky" : "v-deadly"}" title="You win ${pct(r.win)} of fights with your gear">${r.win >= .5 ? "Risky" : "Deadly"} · ${pct(r.win)}</span>`;
      const gear = `<span class="gear" style="color:${glColor(rec)}" title="Gear Level ${rec}: the armor you need to win 95% of these fights. Yours is ${yours}. Your weapon only changes how fast you kill."><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z"/></svg>Gear Level ${rec}</span>`;
      return `<div class="mob ${m.boss ? "boss" : ""}"><img src="${m.image}" alt="">
        ${m.trait ? `<span class="trait" title="${GD.traits[m.trait].text}">${m.trait}</span>` : ""}
        <div class="plate"><span class="nm">${m.name}</span>
        <span class="lv">${lvl(r.c, m.unlock)} Level ${m.level}${m.classification !== "Normal" ? " · " + m.classification : ""} · <span class="mhp">${Math.round(needDps(m) * mobBase(m)).toLocaleString("en-US")} HP</span></span></div>
        <div class="gearrow">${gear}${locked ? "" : verdict}</div>
        <div class="rate">${locked ? `<span class="mute">Not enough Combat skill yet</span>` : `${r.hr > 0 ? pace(r.hr) : "no skill"} · ${fmtT(r.t)} per kill`}</div>
        ${checkLabel(seen)}
        ${locked ? `<button class="wbtn" disabled>Requires Combat ${m.unlock}</button>` : `<button class="wbtn ${running ? "on" : ""}" data-do="mob" data-name="${esc(m.name)}">${running ? "Stop" : "Fight"}</button>`}</div>`;
    }).join("") + `</div>`;
}
function glColor(v) {
  const stops = [[0, [157, 157, 157]], [20, [255, 255, 255]], [40, [30, 255, 0]], [60, [0, 112, 221]], [80, [163, 53, 238]], [100, [255, 128, 0]]];
  v = clamp(v, 0, 100);
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) {
    const [a, ca] = stops[i - 1], [b, cb] = stops[i], f = (v - a) / (b - a);
    return `rgb(${ca.map((c, j) => Math.round(c + (cb[j] - c) * f)).join(",")})`;
  }
  return "rgb(255,128,0)";
}

function eqBox(name, slot, extra = "", tip = "") {
  if (!name) return `<div class="eq empty" title="${slot}: empty"><img src="${ic(GD.ui_icons["slot_" + slot] || GD.ui_icons.slot_Bag)}" alt="${slot} empty"></div>`;
  const e = BY_NAME[name];
  return `<div class="eq q${e.quality || 1}" data-item="${esc(name)}"${tip ? ` data-note="${esc(tip)}"` : ""}><img src="${ic(e.icon)}" alt="${esc(name)}">${extra}</div>`;
}
function renderPane() {
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === rtab));
  const el = $("pane");
  if (rtab === "char") {
    const gl = gearLevel(), fighting = S.field?.kind === "mob" ? MOB[S.field.name] : null;
    const now = fighting ? (WEAPONS.find(w => S.weapons[w] && GD.traits[fighting.trait]?.weapon === w) || (S.weapons.Sword ? "Sword" : null)) : null;
    const title = kind => kind.replace(/\b[a-z]/g, c => c.toUpperCase());   // "Gathering XP food" -> "Gathering XP Food"
    const buffs = BUFF_ROLES.filter(r => active(S.buffs, r)).map(r => eqBox(S.buffs[r].name, "", `<span class="timer">${fmtT(S.buffs[r].until - S.clock)}</span>`, title(r)));
    // one box per kind, showing the one used next (the best); its tooltip says how full the kind is
    const supplies = Object.entries(S.supplies).flatMap(([kind, list]) => {
      if (!list.length) return [];
      const best = [...list].sort((a, b) => BY_NAME[b].rank - BY_NAME[a].rank)[0];
      return [eqBox(best, "", `<span class="count">${list.length}</span>`, `${title(kind)} ${list.length}/${BAL.buffs.keep}`)];
    });
    el.html = `<div class="doll">
        <div class="col">${["Head", "Shoulder", "Back", "Chest"].map(s => eqBox(S.armor[s], s)).join("")}</div>
        <div class="stats"><div><div class="v" title="DPS: damage per second with your best weapon, Shop speed and Combat elixir included. A weapon matching a creature's trait deals more.">${Math.round(weaponDps(null) * speed("combat") * (1 + buffValue("Combat elixir")))}</div><div class="k">DPS</div></div>
          <div><div class="v hp" title="HP: refills after every fight. Armor and combat food raise it.">${Math.round(maxHp()).toLocaleString("en-US")}</div><div class="k">HP</div></div>
          <div title="Gear Level: how tough your armor makes you, from your HP (Combat food included). A full white set is 20, green 40, blue 60, purple 80, legendary 100. Compare it with a creature's Gear Level."><div class="v gl" style="color:${glColor(gl)}">${gl}</div><div class="k">Gear Level</div><div class="glbar"><i style="left:${gl}%"></i></div></div></div>
        <div class="col">${["Hands", "Legs", "Feet"].map(s => eqBox(S.armor[s], s)).join("")}${S.trinket ? eqBox(TRINKET.name, "Trinket").replace('class="eq', 'class="eq trinket') : ""}</div></div>
      <div class="weapons" style="margin-top:14px">${WEAPONS.map(w => `<div class="${w === now ? "now" : ""}">${S.weapons[w] ? eqBox(S.weapons[w], "MainHand")
        : `<div class="eq empty" title="${w}: ${STRONG[w]} Craft one with Blacksmithing."><img src="${ic(GD.ui_icons.slot_MainHand)}" alt="${w} empty"></div>`}${w}</div>`).join("")}</div>
      <div class="subh">Tools</div>
      <div class="irow">${GATHER.slice().sort().map(k => S.tools[k] ? eqBox(S.tools[k], "MainHand") : `<div class="eq empty" title="${P[k].name} tool: craft one with Engineering"><img src="${ic(P[k].icon)}" alt="" style="filter:grayscale(1)"></div>`).join("")}</div>
      <div class="subh">Buffs <span>· one of each kind</span></div><div class="irow">${buffs.join("") || `<span class="mute small">None running. Craft potions and food.</span>`}</div>
      <div class="subh">Supplies <span>· up to ${BAL.buffs.keep} of each kind</span></div><div class="irow">${supplies.join("") || `<span class="mute small">None yet.</span>`}</div>`;
  } else if (rtab === "shop") {
    const track = (k, label, lv, step, kind) => {
      const cost = shopCost(lv), can = cost <= S.gold, max = lv >= BAL.gold.steps;
      return `<div class="trk"><span class="tl">${label}</span>${pips(lv)}<span class="bonus">+${Math.round(lv * step * 100)}%</span>
        ${max ? `<span class="maxed">Max</span>` : `<button class="wbtn ${can ? "" : "dim"}" data-buy="${k}:${kind}" title="${can ? "Buy level " + (lv + 1) : "Not enough gold"}"><span class="coins">${coins(cost, true)}</span></button>`}</div>`;
    };
    el.html = `<div class="shophead"><span>Permanent upgrades. Each level costs double the last.</span><span class="coins">${coins(S.gold)}</span></div>` +
      GROUPS.map(([label, kind]) => `<div class="glabel" style="padding:12px 0 2px">${label}</div>` + byKind(kind).map(p =>
        `<div class="trainer"><img class="icon" src="${ic(p.icon)}" alt=""><div class="tn">${p.name}</div>
        ${track(p.key, "Speed", S.speedLv[p.key], BAL.gold.speed_step, "speed")}${track(p.key, "XP", S.xpLv[p.key], BAL.gold.xp_step, "xp")}</div>`).join("")).join("");
  } else if (rtab === "bags") {
    const mats = GD.materials.filter(m => (S.stock[m.name] || 0) >= 1);
    const total = mats.reduce((t, m) => t + Math.floor(S.stock[m.name]) * sellValue(m.name), 0);
    el.html = `<div class="shophead"><span>Up to ${bagCap()} of each. Extras sell while you play; nothing sells while the page is closed.</span>
        ${mats.length ? `<button class="wbtn" data-sellall="1">Sell everything · <span class="coins">${coins(total, true)}</span></button>` : ""}</div>` +
      (mats.map(m => { const n = Math.floor(S.stock[m.name]); return `<div class="li"><img class="icon sm" src="${ic(m.icon)}" alt="" data-item="${esc(m.name)}">
        <span class="q${m.quality}" data-item="${esc(m.name)}">${esc(m.name)}</span><button class="wbtn" style="padding:1px 8px;font-size:12.5px" data-sell="${esc(m.name)}">Sell all</button>
        <div class="sbar ${n >= bagCap() ? "full" : ""}"><i style="width:${pct(n / bagCap())}"></i><span><span></span><span>${n} / ${bagCap()}</span></span></div></div>`; }).join("")
      || `<p class="mute">Your bags are empty.</p>`);
  } else {
    renderLog(el);
  }
}
const needLine = (have, want, label, tip) => `<li class="${have >= want ? "ok" : "no"}" title="${tip}">${have >= want ? "✓" : "·"} ${label} ${Math.round(have).toLocaleString("en-US")} / ${want.toLocaleString("en-US")}</li>`;
function renderGoal() {
  const g = slotData.goal || "ragnaros", need = slotData.professions_to_master || 6;
  const showRag = g !== "master_professions", showMaster = g !== "ragnaros";
  const legendary = ARMOR_SLOTS.filter(s => S.armor[s] && BY_NAME[S.armor[s]].legendary).length;
  const odds = ragnarosOdds();
  const reqs = ["combat", "blacksmithing", "leatherworking", "tailoring", "alchemy", "cooking"];
  let html = `<img src="https://wow.zamimg.com/modelviewer/classic/webthumbs/npc/113/11121.png" alt="Ragnaros"><div>`;
  if (showRag) html += `<div class="title" style="font-size:15px">Defeat Ragnaros</div><ul>
      ${moltenCore ? `<li class="ok">✓ Molten Core</li>` : `<li class="no">✗ Molten Core (from ${solo ? "one of your checks" : "the multiworld"})</li>`}
      <li class="${legendary === 7 ? "ok" : "no"}">${legendary === 7 ? "✓" : "·"} Legendary armor ${legendary} / 7</li>
      ${needLine(odds.dps, BAL.ragnaros.dps_need, "Weapon DPS", "Your best weapon against Ragnaros: an Axe or Thunderfury does the most. Unlike the DPS on your character, Shop speed doesn't count in this fight.")}
      ${needLine(odds.hp, BAL.ragnaros.hp_need, "Health", "Health comes from your armor.")}
      ${needLine(odds.fr, BAL.ragnaros.fr_need, "Fire Resistance", "Fire Resistance comes from the legendary armor, Greater Fire Protection Potion and Dragonbreath Chili.")}
      ${S.ragnarosWon ? `<li class="ok">✓ Ragnaros defeated</li>` : moltenCore ? `<li><button class="wbtn ragbtn" data-rag="1" ${S.field?.kind === "ragnaros" ? "disabled" : ""}>Fight Ragnaros · win ${pct(odds.win)}</button></li>` : ""}</ul>`;
  if (showMaster) html += `<div class="title" style="font-size:15px;margin-top:6px">Master Professions</div><ul>
      <li><b>Professions at 300: ${masteredCount()} / ${need}</b></li></ul>`;
  if (showRag && !showMaster) html += `<ul><li class="mute">Ready when these are at 300: ${reqs.map(k => `<span class="${S.level[k] >= 300 ? "ok" : ""}">${P[k].name}</span>`).join(", ")}</li></ul>`;
  $("goal").html = html + `</div>`;
}
function render() {
  if (S && S.gold > GOLD_CAP) S.gold = GOLD_CAP;
  if (!S) return;
  renderHeader(); renderList(); $("vt-main").textContent = P[selected].name; renderSlots(); renderDetail(); renderPane(); renderGoal(); renderLegend();
  refreshTip();
}

// ---- input -------------------------------------------------------------------------------
document.addEventListener("click", ev => {
  const t = ev.target.closest("button");
  if (!t || !S) return;
  if (t.matches(".prof")) { selected = t.dataset.k; tab = rankTabFor(selected); showView("main"); render(); return; }
  if (t.dataset.t !== undefined) { tab = +t.dataset.t; (S.lastTab ||= {})[selected] = tab; dirty = true; renderDetail(); return; }
  if (t.dataset.tab) { rtab = t.dataset.tab; renderPane(); return; }
  if (t.dataset.do) {
    const name = t.dataset.name, slot = t.dataset.do === "craft" ? "work" : "field";
    const same = S[slot] && S[slot].name === name;
    S[slot] = same ? null : { kind: t.dataset.do === "mob" ? "mob" : t.dataset.do, name };
    if (slot === "field") S.fieldT = 0; else S.workT = 0;
    dirty = true; render(); return;
  }
  if (t.dataset.buy) { const [k, kind] = t.dataset.buy.split(":"); buy(k, kind); dirty = true; return; }
  if (t.dataset.sell) { sellAll(t.dataset.sell); dirty = true; return; }
  if (t.dataset.sellall) { sellEverything(); dirty = true; return; }
  if (t.dataset.rag) { S.field = { kind: "ragnaros", name: "Ragnaros" }; S.fieldT = 0; dirty = true; render(); return; }
});
// Which rank to show when opening a profession: always the one you last looked at. The first time,
// the highest rank you own with something orange or yellow (still worth XP), else anything doable.
function rankTabFor(k) {
  const owned = ranks[k] || 1, last = S.lastTab?.[k];
  if (last !== undefined && last < owned) return last;
  const good = e => ["orange", "yellow"].includes(colorOf(S.level[k], e.unlock).name);
  for (let r = owned - 1; r > 0; r--) if (thingsOf(k, r).some(good)) return r;
  for (let r = owned - 1; r > 0; r--) if (thingsOf(k, r).some(e => e.unlock <= S.level[k])) return r;
  return 0;
}
// Phone: the tab bar shows one view at a time (Professions, the open profession, Character).
function showView(v) { document.body.dataset.view = v; window.scrollTo(0, 0); }
$("vtabs").onclick = ev => { const b = ev.target.closest("[data-view]"); if (b) showView(b.dataset.view); };
$("to-connect").onclick = () => { save(); location.href = location.pathname; };

// ---- connect screen ------------------------------------------------------------------------
function showRecent() {
  let rooms = [];
  try { rooms = JSON.parse(lsGet("skillup:rooms") || "[]"); } catch {}
  if (!soloSaved()) rooms = rooms.filter(r => !r.solo);
  const status = r => r.done ? "Goal complete" : `${r.checks}/220 checks`;
  $("recent").html = rooms.length ? `<div class="glabel" style="padding:0">Recent rooms</div>` + rooms.map(r => r.solo
    ? `<button type="button" data-solo="1"><b>Solo game<span class="tag-solo">Solo</span></b><span class="mute" style="font-size:12.5px">${new Date(r.at).toLocaleDateString()}</span>
       <span class="mute" style="font-size:13px">Saved in this browser · ${status(r)}</span></button>`
    : `<button type="button" data-server="${esc(r.server)}" data-slot="${esc(r.slot)}"><b>${esc(r.slot)}</b><span class="mute" style="font-size:12.5px">${new Date(r.at).toLocaleDateString()}</span>
     <span class="mute" style="font-size:13px">${esc(r.server)} · ${status(r)}</span></button>`).join("") : "";
  $("recent").querySelectorAll("button").forEach(b => b.onclick = () => {
    if (b.dataset.solo) return startSolo();
    $("c-server").value = b.dataset.server; $("c-slot").value = b.dataset.slot; $("connect-form").requestSubmit();
  });
  showSolo(false);
}
// Solo play: one game per browser, no server. Starting a new one replaces the old one.
function showSolo(open) {
  const saved = soloSaved();
  if (!open) {
    $("solo").html = saved
      ? `<button type="button" class="wbtn" data-solo-new="1" style="background:none;border-color:var(--steel-dk)">New solo game</button>`
      : `<div class="or">No room? Play on your own.</div><button type="button" class="wbtn" data-solo-new="1">Play solo</button>`;
  } else {
    const opt = (v, t, on) => `<option value="${v}" ${on ? "selected" : ""}>${t}</option>`;
    $("solo").html = `<div class="glabel" style="padding:0">New solo game</div>
      <div class="fld"><label for="s-goal">Goal</label><select id="s-goal">${opt("ragnaros", "Defeat Ragnaros", 1)}${opt("master_professions", "Master professions")}${opt("both", "Both")}</select></div>
      <div class="fld" id="s-master-f" hidden><label for="s-master">Professions to master</label><input id="s-master" type="number" min="1" max="11" value="6"></div>
      <div class="row2"><div class="fld"><label for="s-speed">Game speed</label><select id="s-speed">${opt("long", "Long (~20 h)")}${opt("normal", "Normal (~10 h)", 1)}${opt("sync", "Sync (~4 h)")}</select></div>
      <div class="fld"><label for="s-pair">Starting pair</label><select id="s-pair">${opt("random", "Random", 1)}${Object.entries(PAIRS).map(([g, c]) => opt(g, `${P[g].name} + ${P[c].name}`)).join("")}</select></div></div>
      ${saved ? `<div class="warn">This replaces your solo game in this browser (${saved.solo.checked.length}/220 checks).</div>` : ""}
      <button type="button" class="wbtn" data-solo-start="1">${saved ? "Replace it and start" : "Start"}</button>
      <button type="button" class="wbtn" data-solo-cancel="1" style="background:none;border-color:var(--steel-dk)">Cancel</button>`;
    $("s-goal").onchange = () => $("s-master-f").hidden = $("s-goal").value === "ragnaros";
  }
}
$("solo").addEventListener("click", ev => {
  const b = ev.target.closest("button");
  if (!b) return;
  if (b.dataset.soloNew) showSolo(true);
  else if (b.dataset.soloCancel) showSolo(false);
  else if (b.dataset.soloStart) startSolo({ goal: $("s-goal").value, professions_to_master: clamp(+$("s-master").value || 6, 1, 11),
    game_speed: $("s-speed").value, starting_pair: $("s-pair").value });
});
$("connect-form").addEventListener("submit", ev => {
  ev.preventDefault();
  const server = $("c-server").value || "archipelago.gg:38281", slot = $("c-slot").value.trim();
  if (!slot) { $("c-err").textContent = "Enter your slot name."; return; }
  connect(server, slot, $("c-pass").value);
});
{
  const q = new URLSearchParams(location.search);
  if (q.get("server")) $("c-server").value = q.get("server");
  if (q.get("slot")) $("c-slot").value = q.get("slot");
  try { const pw = sessionStorage.getItem("skillup:pass"); if (pw !== null) { $("c-pass").value = pw; sessionStorage.removeItem("skillup:pass"); } } catch {}
  showRecent();
  // A bookmarked link with both server and slot goes straight into the game.
  if (q.get("server") && q.get("slot")) $("connect-form").requestSubmit();
}

// ---- main loop ------------------------------------------------------------------------------
let lastTick = 0, started = false;
function startGame() {
  started = true;
  $("connect").hidden = true;
  ["top", "vtabs", "game", "foot"].forEach(id => $(id).hidden = false);
  if (!learned(selected)) selected = PROFS.find(p => learned(p.key))?.key || "combat";
  tab = rankTabFor(selected);
  catchUpOffline();
  resendAllChecks(); flushChecks(); checkGoal(true);
  save();
  render();
  lastTick = performance.now();
  setInterval(tick, 250);
  requestAnimationFrame(frame);
  setInterval(() => { if (dirty) save(); }, 20000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });
  window.addEventListener("pagehide", () => save());
}
let renderAcc = 0;
function tick() {
  if (replaced) return;
  const now = performance.now(), dt = (now - lastTick) / 1000;
  lastTick = now;
  if (dt > 300) { catchUp(dt); render(); return; }
  advance(dt, false);
  if (S.field || S.work) dirty = true;
  flushChecks(); checkGoal();
  renderAcc += dt;
  renderSlots();
  if (renderAcc >= 1) { renderAcc = 0; render(); }
}

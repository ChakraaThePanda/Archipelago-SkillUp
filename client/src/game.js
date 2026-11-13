"use strict";
// Skillup: the browser game and its Archipelago client.
// Game content comes from data/game_data.json and every number from data/balance.json (both baked
// in by tools/build_client.py), the same files the balance simulator (tools/simulate.py) uses.

const GAME = "Skillup";
const SAVE_VERSION = 2;
const ICON = n => `https://wow.zamimg.com/images/wow/icons/large/${n}.jpg`;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ============================================================================================
// Static data
// ============================================================================================
const RANKS = GD.ranks, RANK_CAPS = RANKS.map(r => r.cap);
const PROFS = GD.professions, P = Object.fromEntries(PROFS.map(p => [p.key, p]));
const GATHER = PROFS.filter(p => p.kind === "gathering").map(p => p.key);
const CRAFT = PROFS.filter(p => p.kind === "crafting").map(p => p.key);
const GROUPS = [["Fighting", "combat"], ["Gathering", "gathering"], ["Crafting", "crafting"]];
const byKind = kind => PROFS.filter(p => p.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
const GEAR_PROFS = new Set(["blacksmithing", "leatherworking", "tailoring", "engineering"]);
for (const r of GD.recipes) if (GEAR_PROFS.has(r.profession)) r.quality = r.rank + 1;   // white, green, blue, purple
for (const f of GD.fire_resistance_set) { f.legendary = true; f.rank = 3; if (GEAR_PROFS.has(f.profession)) f.quality = 5; }
const BY_NAME = Object.fromEntries([...GD.materials, ...GD.recipes, ...GD.fire_resistance_set].map(e => [e.name, e]));
const MOB = Object.fromEntries(GD.mobs.map(m => [m.name, m]));
const CLOTH = GD.materials.filter(m => m.profession === "combat").sort((a, b) => a.rank - b.rank).map(m => m.name);
const ARMOR_SLOTS = ["Head", "Shoulder", "Back", "Chest", "Hands", "Legs", "Feet"];
const WEAPONS = ["Sword", "Dagger", "Mace", "Axe"];
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
    clothAcc: 0, unsold: 0, corpseUntil: 0, ambush: 0, ragnarosWon: false, goalSent: false, deaths: 0 };
}

// ============================================================================================
// Rules (same formulas as tools/simulate.py)
// ============================================================================================
const cap = k => ranks[k] ? RANK_CAPS[ranks[k] - 1] : 0;
const learned = k => (ranks[k] || 0) > 0;
const xpNeed = L => BAL.xp.base * (1 + L / BAL.xp.per_level);
const gameSpeed = () => BAL.xp.game_speed[{ long: "Long", normal: "Normal", fast: "Fast" }[slotData.game_speed] || "Normal"];
const baseTime = (kind, rank, slot) => BAL.actions[kind] * BAL.actions.rank_growth ** rank * (1 + BAL.actions.slot_growth * slot);
const bagCap = () => Math.floor(BAL.storage.start * BAL.storage.per_bag_mult ** S.bags * (1 + S.bagBonus));

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
    if (trait && GD.traits[trait].weapon === w) d *= C.trait_match; else if (!trait && w === "Sword") d *= C.sword_bonus;
    best = Math.max(best, d);
  }
  return best;
}
const armorHp = rankList => C.base_hp + rankList.reduce((t, r) => t + C.armor_hp * C.rank_growth ** r, 0);
const wornRanks = () => ARMOR_SLOTS.filter(s => S.armor[s]).map(s => itemRank(S.armor[s]));
const maxHp = () => armorHp(wornRanks()) * (1 + buffValue("Combat food"));
const mobBase = (m, boss = true) => baseTime("combat_time", m.rank, m.slot) * (boss && m.boss ? BAL.actions.boss_time_mult : 1);
const needDps = m => C.weapon_dps * C.rank_growth ** m.rank * (1 + C.slot_growth * m.slot) * (m.boss ? C.boss_dps_mult : 1);
function mobDamage(m) {
  const e = m.rank - 1 + m.slot / 3;
  const expected = C.base_hp + 7 * C.armor_hp * C.rank_growth ** e * (e < 0 ? Math.min(1, 1 + e) : 1);
  return C.danger * expected * (m.boss ? C.boss_damage_mult : 1);
}
const deathChance = (m, hp = maxHp()) => clamp((mobDamage(m) / hp - C.death_start) / C.death_span, 0, 1);
const gearFightTime = m => mobBase(m) * clamp(needDps(m) / (weaponDps(m.trait) * (1 + buffValue("Combat elixir"))), C.ratio_min, C.ratio_max);
function recommended(m) { // lowest armor Gear Level (all slots alike) where you win 95% of fights
  if (deathChance(m, C.base_hp) <= .05) return 0;
  for (let G = 20; G <= 100; G++) if (deathChance(m, armorHp(Array(7).fill(G / 20 - 1))) <= .05) return G;
  return 100;
}
const ilvl = n => !n ? 0 : BY_NAME[n].legendary ? 100 : 20 * (BY_NAME[n].rank + 1);
const gearLevel = () => Math.round(ARMOR_SLOTS.reduce((t, s) => t + ilvl(S.armor[s]), 0) / 7);

// ---- actions --------------------------------------------------------------------------------
function actionOf(slot) { // {kind, entry, time, k} for the Field ("field") or Workshop ("work")
  const a = S[slot];
  if (!a) return null;
  if (a.kind === "ragnaros") return { kind: "ragnaros", time: BAL.ragnaros.fight_minutes * 60, k: "combat" };
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
    S.level[k]++;
    const r = RANK_CAPS.indexOf(S.level[k]);
    if (r >= 0) check(milestoneName(k, r));
  }
  if (S.level[k] >= cap(k)) S.xp[k] = 0;
}

function sellValue(name) {
  const e = BY_NAME[name];
  if (!e) return 0;
  if (e.reagents) return e.reagents.reduce((t, n) => t + sellValue(n) * qtyOf(e), 0) * BAL.gold.crafted_markup * (1 + S.sellBonus);
  return Math.max(BAL.gold.min_sell, e.sell * BAL.gold.sell_mult) * (1 + S.sellBonus);
}
function store(name, qty, offline) {
  const kept = Math.min(qty, Math.max(0, bagCap() - (S.stock[name] || 0)));
  S.stock[name] = (S.stock[name] || 0) + kept;
  if (qty > kept && !offline) S.gold += (qty - kept) * sellValue(name);
}

function finishField(offline) {
  const a = actionOf("field");
  if (!a) return;
  if (a.kind === "ragnaros") return finishRagnaros();
  if (a.kind === "mob") return finishFight(a.entry, offline);
  const e = a.entry, k = a.k, base = baseTime("gather_time", e.rank, e.slot);
  if (a.color.name === "red" && Math.random() >= a.color.chance) return;      // failed attempt: only time lost
  addXp(k, base * BAL.actions.xp_per_second * a.color.mult, true);
  store(e.name, BAL.actions.gather_yield, offline);
  first(k, e.name);
}

function finishFight(m, offline) {
  if (Math.random() < deathChanceWithPotion(m)) return die(`was defeated by ${m.name}`);
  addXp("combat", mobBase(m) * BAL.actions.xp_per_second * colorOf(S.level.combat, m.unlock).mult, true);
  S.clothAcc += C.cloth_per_kill;
  const cloth = Math.floor(S.clothAcc);
  if (cloth) { S.clothAcc -= cloth; store(CLOTH[m.rank], cloth, offline); }
  if (!offline) S.gold += C.gold_per_kill * C.rank_growth ** m.rank;
  first("combat", m.name);
}
function deathChanceWithPotion(m) { // a Healing Potion is drunk when a fight goes badly
  const p = deathChance(m);
  if (p <= 0 || !(S.supplies.Healing || []).length) return p;
  const potion = takeSupply("Healing");
  return deathChance(m, maxHp() * (1 + 0.35 * (1 + BAL.buffs.rank_scale * BY_NAME[potion].rank)));
}
function die(cause, fromLink = false) {
  S.deaths++;
  S.corpseUntil = S.clock + 30;
  S.debuffs["Resurrection Sickness"] = { until: S.clock + 30 + BAL.traps["Resurrection Sickness"].minutes * 60 };
  S.fieldT = 0;
  if (!fromLink) sendDeathLink(cause);
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
    const list = S.supplies[kind] ||= [];
    if (list.length < BAL.buffs.keep) return void list.push(r.name);
  }
  if (offline) S.unsold += sellValue(r.name); else S.gold += sellValue(r.name);
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
function finishRagnaros() {
  const { win } = ragnarosOdds();
  takeSupply("Fire protection"); takeSupply("Fire food");
  S.field = null;
  if (Math.random() < win) { S.ragnarosWon = true; toast("Ragnaros is defeated!"); checkGoal(); }
  else { die("was defeated by Ragnaros"); toast("Ragnaros won this time. Try again when you're ready."); }
}

// ---- time ------------------------------------------------------------------------------------
// Moves the game forward by dt seconds. Offline (page closed): both slots only repeat what they
// were doing, nothing sells, and the Shop isn't used.
function advance(dt, offline) {
  let guard = 0;
  while (dt > 1e-6 && guard++ < 2e6) {
    refreshBuffs();
    const fa = S.clock < S.corpseUntil ? null : actionOf("field"), wa = actionOf("work");
    const workStuck = wa && missing(wa.entry);
    const tf = fa ? Math.max(0, fa.time - S.fieldT) : Infinity;
    const tw = wa && !workStuck ? Math.max(0, wa.time - S.workT) : Infinity;
    const corpse = S.clock < S.corpseUntil ? S.corpseUntil - S.clock : Infinity;
    const step = Math.min(dt, tf, tw, corpse, 60);
    S.clock += step; dt -= step;
    if (fa) { S.fieldT += step; S.rested = Math.max(0, S.rested - step); }
    if (wa && !workStuck) S.workT += step;
    if (fa && S.fieldT >= fa.time - 1e-9) { S.fieldT = 0; if (S.ambush > 0) { S.ambush--; finishFight(MOB["Murloc Forager"], offline); } else finishField(offline); }
    if (wa && !workStuck && S.workT >= wa.time - 1e-9) { S.workT = 0; finishWork(offline); }
  }
}
function catchUpOffline() {
  const away = Math.max(0, (Date.now() - S.savedAt) / 1000);
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
function checkGoal() {
  if (S.goalSent || !goalDone() || !ws || ws.readyState !== 1) return;
  send([{ cmd: "StatusUpdate", status: 30 }]);
  S.goalSent = true;
  toast("Goal complete!");
}

// ---- items from the multiworld --------------------------------------------------------------
function applyItems() {
  ranks = Object.fromEntries(PROFS.map(p => [p.key, 0]));
  moltenCore = false;
  for (const it of received) {
    const name = itemIdToName[it.item];
    const prof = PROFS.find(p => name === `Progressive ${p.name}`);
    if (prof) ranks[prof.key] = Math.min(4, ranks[prof.key] + 1);
    if (name === "Molten Core") moltenCore = true;
  }
  if (!S) return;
  for (; S.applied < received.length; S.applied++) oneShot(itemIdToName[received[S.applied].item]);
  if (!learned(selected)) selected = PROFS.find(p => learned(p.key))?.key || selected;
}
function oneShot(name) {
  const open = PROFS.map(p => p.key).filter(k => learned(k) && S.level[k] < 300);
  const lowest = list => list.sort((a, b) => S.level[a] - S.level[b])[0];
  switch (name) {
    case "Speed Upgrade": case "XP Upgrade": {
      const lv = name === "Speed Upgrade" ? S.speedLv : S.xpLv;
      const k = open.filter(k => lv[k] < BAL.gold.steps).sort((a, b) => lv[a] - lv[b] || S.level[a] - S.level[b])[0];
      if (k) lv[k]++;
      break;
    }
    case "Bag Upgrade": S.bagBonus += BAL.pool.useful["Bag Upgrade"].storage; break;
    case "Better Prices": S.sellBonus += BAL.pool.useful["Better Prices"].sell; break;
    case "Coin Pouch": {
      const top = Math.max(...PROFS.map(p => Math.floor((S.level[p.key] - 1) / 75)));
      S.gold += BAL.pool.filler["Coin pouch"].gold * C.rank_growth ** top;
      break;
    }
    case "Rested XP": S.rested = Math.min(S.rested + BAL.pool.filler["Rested XP"].rested_min * 60, BAL.offline.rested_cap * 60); break;
    case "Tome of Experience": { const k = lowest(open); if (k) addXp(k, xpNeed(S.level[k]) / gameSpeed(), true); break; }
    case "Resurrection Sickness": case "Broken Tool":
      S.debuffs[name] = { until: S.clock + BAL.traps[name].minutes * 60 }; break;
    case "Repair Bill": S.gold *= 1 - BAL.traps["Repair Bill"].gold_percent / 100; break;
    case "Murloc Ambush": if (learned("combat")) S.ambush += BAL.traps["Murloc Ambush"].fights; break;
  }
}

// ---- shop --------------------------------------------------------------------------------------
const shopCost = lv => BAL.gold.cost_base * BAL.gold.cost_growth ** lv;
function buy(k, kind) {
  const lv = kind === "speed" ? S.speedLv : S.xpLv;
  if (lv[k] >= BAL.gold.steps || S.gold < shopCost(lv[k])) return;
  S.gold -= shopCost(lv[k]); lv[k]++;
  render();
}
function sellAll(name) { S.gold += (S.stock[name] || 0) * sellValue(name); S.stock[name] = 0; render(); }
function sellEverything() { for (const n of Object.keys(S.stock)) sellAll(n); }

// ============================================================================================
// Saving: a copy in this browser + the Archipelago server's data storage (any device can resume)
// ============================================================================================
const storageKey = () => `skillup_save_${conn.team}_${conn.slot}`;
const localKey = () => `skillup:${conn.seed}:${conn.team}:${conn.slot}`;
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
let dirty = false;
function save(remote = true) {
  if (!S || !conn) return;
  S.savedAt = Date.now();
  lsSet(localKey(), JSON.stringify(S));
  if (remote && ws && ws.readyState === 1)
    send([{ cmd: "Set", key: storageKey(), default: null, want_reply: false, operations: [{ operation: "replace", value: S }] }]);
  rememberRoom();
  dirty = false;
}
function loadSave(remote) {
  let local = null;
  try { local = JSON.parse(lsGet(localKey()) || "null"); } catch {}
  const pick = [remote, local].filter(x => x && x.v === SAVE_VERSION).sort((a, b) => b.savedAt - a.savedAt)[0];
  S = Object.assign(newSave(), pick || {});
}

// ============================================================================================
// Archipelago connection
// ============================================================================================
let ws = null, conn = null, nameToLoc = null, itemIdToName = {}, checked = new Set(), playerGames = {};
const gamesPackage = {};
function send(packets) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(packets)); }

function connect(server, slotName, password) {
  server = server.trim();
  const urls = /^wss?:\/\//.test(server) ? [server] : location.protocol === "https:" ? [`wss://${server}`] : [`wss://${server}`, `ws://${server}`];
  $("c-err").textContent = "Connecting…";
  let attempt = 0, opened = false, room = null;
  const open = () => {
    ws = new WebSocket(urls[attempt]);
    ws.onopen = () => { opened = true; };
    ws.onmessage = ev => { for (const pkt of JSON.parse(ev.data)) handle(pkt); };
    ws.onclose = () => {
      if (!opened && ++attempt < urls.length) return open();
      setOnline(false);
      if (!S) { $("c-err").textContent = "Could not connect. Check the server address and port."; return; }
      log(`<span class="sys">Disconnected. Retrying in 10 seconds; your progress keeps going and is saved in this browser.</span>`);
      setTimeout(() => { if (!ws || ws.readyState > 1) { attempt = 0; opened = false; open(); } }, 10000);
    };
  };
  function handle(pkt) {
    switch (pkt.cmd) {
      case "RoomInfo":
        room = pkt;
        send([{ cmd: "GetDataPackage", games: pkt.games }]);
        break;
      case "DataPackage": {
        Object.assign(gamesPackage, pkt.data.games);
        const pkg = gamesPackage[GAME];
        if (!pkg) { $("c-err").textContent = "This room has no Skillup game."; ws.onclose = null; ws.close(); return; }
        nameToLoc = pkg.location_name_to_id;
        itemIdToName = Object.fromEntries(Object.entries(pkg.item_name_to_id).map(([k, v]) => [v, k]));
        send([{ cmd: "Connect", game: GAME, name: slotName, password: password || "", uuid: uuid(),
          version: { major: 0, minor: 6, build: 7, class: "Version" }, items_handling: 0b111, tags: [], slot_data: true }]);
        break;
      }
      case "ConnectionRefused":
        $("c-err").textContent = "Refused: " + (pkt.errors || []).join(", ");
        ws.onclose = null; ws.close();
        break;
      case "Connected":
        slotData = pkt.slot_data || {};
        conn = { seed: room.seed_name, team: pkt.team, slot: pkt.slot, slotName, server, players: Object.fromEntries(pkt.players.map(p => [p.slot, p.alias || p.name])) };
        checked = new Set(pkt.checked_locations);
        playerGames = Object.fromEntries(Object.entries(pkt.slot_info || {}).map(([k, v]) => [k, v.game]));
        if (slotData.death_link) send([{ cmd: "ConnectUpdate", tags: ["DeathLink"] }]);
        setOnline(true);
        if (S) { resendAllChecks(); flushChecks(); checkGoal(); break; }   // reconnect: keep playing
        send([{ cmd: "Get", keys: [storageKey()] }]);
        break;
      case "Retrieved":
        if (!S && conn && storageKey() in pkt.keys) { loadSave(pkt.keys[storageKey()]); applyItems(); startGame(); }
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
      case "player_id": return `<span class="pl">${esc(conn?.players[+p.text] || p.text)}</span>`;
      case "item_id": return `<span class="${p.flags & 1 ? "it" : p.flags & 4 ? "c-red" : "q2"}">${esc(lookup("item", +p.text, p.player))}</span>`;
      case "location_id": return `<span class="loc">${esc(lookup("location", +p.text, p.player))}</span>`;
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
  rooms = rooms.filter(r => !(r.server === conn.server && r.slot === conn.slotName));
  rooms.unshift({ server: conn.server, slot: conn.slotName, at: Date.now(), checks: checked.size, done: S.goalSent });
  lsSet("skillup:rooms", JSON.stringify(rooms.slice(0, 5)));
}

// ============================================================================================
// Interface
// ============================================================================================
const pct = v => `${Math.round(v * 100)}%`;
const fmtT = s => !isFinite(s) ? "—" : s < 10 ? s.toFixed(1) + "s" : s < 60 ? Math.round(s) + "s" : s < 3600 ? Math.floor(s / 60) + "m" + String(Math.round(s % 60)).padStart(2, "0") : (s / 3600).toFixed(1) + "h";
const ic = n => ICON(n);
function coins(c, compact = false) {
  c = Math.floor(c);
  const g = Math.floor(c / 10000), s = Math.floor(c / 100) % 100, cp = c % 100;
  const parts = [[g, GD.ui_icons.gold, "gold"], [s, GD.ui_icons.silver, "silver"], [cp, GD.ui_icons.copper, "copper"]];
  const shown = compact ? parts.filter(([v]) => v) : parts.filter(([v], i) => v || i === 2 || (i === 1 && g));
  return (shown.length ? shown : [parts[2]]).map(([v, i, a]) => `${v}<img src="${ic(i)}" alt="${a}">`).join("");
}
const lvl = (c, u) => `<span class="lvl c-${c.name}" title="Skill ${u}: ${COLOR_TIP[c.name]}">${u}</span>`;
const pace = hr => hr > 0 ? `<span title="One skill level every ${fmtT(3600 / hr)}">+1 / <b>${fmtT(3600 / hr)}</b></span>` : "";
const pips = lv => `<span class="pips">${Array.from({ length: 10 }, (_, i) => `<i class="${i < lv ? "on" : ""}"></i>`).join("")}</span>`;
let toastTimer = null;
function toast(text) {
  let el = $("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; document.body.append(el); }
  el.textContent = text; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
}
const logLines = [];
function log(html, cls = "") {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  logLines.unshift(`<p class="${cls}"><time>${time}</time>${html}</p>`);
  logLines.length = Math.min(logLines.length, 300);
  if (rtab === "log") renderPane();
}
function setOnline(on) { $("online").classList.toggle("off", !on); }

function perHourGather(k, e) {
  const c = colorOf(S.level[k], e.unlock), base = baseTime("gather_time", e.rank, e.slot);
  let t = Math.max(base / speed(k), BAL.actions.min_action_time), xp = base * c.mult;
  if (c.name === "red") { t *= c.slow; xp *= c.chance; }
  return { c, t, hr: S.level[k] >= cap(k) ? 0 : 3600 * xp * gameSpeed() * (1 + S.xpLv[k] * BAL.gold.xp_step) / t / xpNeed(S.level[k]) };
}
function perHourCraft(k, r) {
  const c = colorOf(S.level[k], r.unlock), base = baseTime("craft_time", r.rank, slotNum(r));
  let t = Math.max(base / speed(k), BAL.actions.min_action_time), xp = base * BAL.actions.craft_xp_mult * (BAL.recipes.role_xp_mult[r.role] || 1) * c.mult;
  if (c.name === "red") { t *= c.slow; xp *= c.chance; }
  return { c, t, hr: S.level[k] >= cap(k) ? 0 : 3600 * xp * gameSpeed() * (1 + S.xpLv[k] * BAL.gold.xp_step) / t / xpNeed(S.level[k]) };
}
function perHourFight(m) {
  const c = colorOf(S.level.combat, m.unlock), p = deathChance(m);
  const t = Math.max(gearFightTime(m) / speed("combat"), BAL.actions.min_action_time);
  const xp = mobBase(m) * c.mult * (1 - p) * gameSpeed() * (1 + S.xpLv.combat * BAL.gold.xp_step);
  return { c, t, win: 1 - p, hr: S.level.combat >= cap("combat") ? 0 : 3600 * xp / (t + p * (30 + t)) / xpNeed(S.level.combat) };
}

function renderHeader() {
  $("gold").innerHTML = coins(S.gold);
  const bag = [...GD.recipes].filter(r => r.role === "Bag" && S.crafted.includes(r.name)).sort((a, b) => b.rank - a.rank)[0];
  $("bags").innerHTML = `<span class="hstat">${bag ? `<img class="icon sm" src="${ic(bag.icon)}" alt="">` : ""} ${bagCap()} each</span>`;
  $("rested").textContent = `${Math.round(S.rested / 60)} min`;
  $("rested-bar").style.width = pct(S.rested / (BAL.offline.rested_cap * 60));
  $("checks").textContent = `${checked.size} / 220`;
  $("who").textContent = conn.slotName; $("where").textContent = "· " + conn.server;
}

function renderList() {
  $("proflist").innerHTML = GROUPS.map(([label, kind]) => `<div class="glabel">${label}</div>` + byKind(kind).map(p => {
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
    <div class="cast"><i style="width:${pct(S.fieldT / a.time)}"></i><span>${fmtT(S.fieldT)} / ${fmtT(a.time)}</span></div></div>`;
  const e = a.entry, k = a.k;
  const label = slot === "work" ? "Crafting" : a.kind === "mob" ? "Fighting" : "Gathering";
  const hr = a.kind === "mob" ? perHourFight(e) : a.kind === "gather" ? perHourGather(k, e) : perHourCraft(k, e);
  const t = slot === "field" ? S.fieldT : S.workT;
  const waiting = slot === "work" && missing(e), dead = slot === "field" && S.clock < S.corpseUntil;
  const status = dead ? `<span class="wait">Running back from the graveyard…</span>` : waiting ? `<span class="wait">Waiting for ${esc(missing(e))}</span>`
    : `${lvl(hr.c, e.unlock)} ${hr.hr > 0 ? pace(hr.hr) : "no skill"}`;
  const img = a.kind === "mob" ? ic(P.combat.icon) : ic(e.icon);
  return `<div class="slot"><img class="icon lg" src="${img}" alt=""><div><div class="k">${label} · ${P[k].name}</div>
    <div class="what q${e.quality || 1}">${esc(e.name)}</div><div class="sub">${status}</div></div>
    <div class="cast ${slot === "work" ? "green" : ""}"><i style="width:${pct(Math.min(1, t / a.time))}"></i><span>${t.toFixed(1)}s / ${a.time.toFixed(1)}s</span></div></div>`;
}
function renderSlots() { $("slots").innerHTML = slotHtml("field") + slotHtml("work"); }

function renderDetail() {
  const k = selected, p = P[k], L = S.level[k], owned = ranks[k] || 0;
  if (!owned) { $("detail").innerHTML = `<div class="locked">🔒 ${p.name} isn't learned yet</div>`; return; }
  tab = Math.min(tab, 3);
  const head = `<div class="dhead"><img class="icon lg" src="${ic(p.icon)}" alt="">
      <div><h3 class="title">${p.name}</h3><div class="rk">${RANKS[owned - 1].name} · ${L} / ${cap(k)}</div></div>
      <div class="mini">${[["Speed", S.speedLv[k], BAL.gold.speed_step], ["XP", S.xpLv[k], BAL.gold.xp_step]].map(([l, lv, st]) =>
        `<span class="mt"><span class="mute">${l}</span>${pips(lv)}<b>+${Math.round(lv * st * 100)}%</b></span>`).join("")}</div></div>`;
  const tabs = `<div class="rtabs" role="tablist">${RANKS.map((r, i) =>
    `<button class="${i === tab ? "on" : ""} ${i >= owned ? "locked" : ""}" data-t="${i}" ${i >= owned ? 'title="Locked: this rank comes from the multiworld"' : ""}><span>${i >= owned ? '<span class="lock">🔒 </span>' : ""}${r.name}</span><small>${r.start}-${r.cap}</small></button>`).join("")}</div>`;
  let body;
  if (tab >= owned) body = `<div class="locked">🔒 Locked</div>`;
  else if (p.kind === "combat") body = combatHtml();
  else body = rowsHtml(k);
  $("detail").innerHTML = head + tabs + body;
}
function checkLabel(done) { return `<span class="chk ${done ? "done" : "todo"}" title="${done ? "Check already sent" : "Doing this the first time sends a check"}">${done ? "✓ Sent" : "◆ Check"}</span>`; }
function rowsHtml(k) {
  const kind = P[k].kind === "crafting" ? "craft" : "gather";
  const list = thingsOf(k, tab).concat(kind === "craft" && tab === 3 && moltenCore ? GD.fire_resistance_set.filter(f => f.profession === k) : []);
  const bagIcon = ic(GD.ui_icons.slot_Bag);
  return `<div class="rows">` + list.map((e, i) => {
    const hr = kind === "craft" ? perHourCraft(k, e) : perHourGather(k, e);
    const running = (S.field && S.field.name === e.name) || (S.work && S.work.name === e.name);
    const done = e.legendary ? S.crafted.includes(e.name) : S.firsts.includes(e.name);
    const mats = kind === "craft"
      ? `<ul class="mats">${e.reagents.map(n => { const have = Math.floor(S.stock[n] || 0), need = qtyOf(e);
          return `<li class="${have < need ? "short" : ""}"><img src="${ic(BY_NAME[n].icon)}" alt=""><span>${need}× ${esc(n)}</span><span class="have">${have}</span></li>`; }).join("")}</ul>`
      : `<ul class="mats"><li><img src="${bagIcon}" alt=""><span>In bags</span><span class="have">${Math.floor(S.stock[e.name] || 0)} / ${bagCap()}</span></li></ul>`;
    const rate = hr.c.name === "red" ? `<b class="c-red">${pct(hr.c.chance)}</b> per try<br><span title="Average time per success">~${fmtT(hr.t / hr.c.chance)} per success</span>`
      : hr.hr > 0 ? `${pace(hr.hr)}<br>${fmtT(hr.t)} each` : `${S.level[k] >= 300 ? "Maxed" : e.legendary ? "Legendary" : "no skill"}<br>${fmtT(hr.t)} each`;
    const legendLbl = e.legendary && !list[i - 1]?.legendary ? `<div class="legendary-lbl" style="grid-column:1/-1">Legendary · for Ragnaros</div>` : "";
    return `${legendLbl}<div class="row"><img class="icon" src="${ic(e.icon)}" alt="">
      <div class="info"><div class="nmline"><span class="nm q${e.quality}" title="${esc(e.name)}">${esc(e.name)}</span></div>
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
      const gear = `<span class="gear" style="color:${glColor(rec)}" title="Armor Gear Level to always win: ${rec}. Yours: ${yours}. Your weapon only changes how fast you kill."><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z"/></svg>Gear Level ${rec}</span>`;
      const hp = Math.round(needDps(m) * mobBase(m));
      return `<div class="mob ${m.boss ? "boss" : ""}"><img src="${m.image}" alt="">
        ${m.trait ? `<span class="trait" title="${GD.traits[m.trait].text}">${m.trait}</span>` : ""}
        <div class="plate"><span class="nm">${m.name}</span><span class="hpb"><span>100%</span><span>${hp.toLocaleString("en-US")}</span></span>
        <span class="lv">${lvl(r.c, m.unlock)} Level ${m.level}${m.classification !== "Normal" ? " · " + m.classification : ""}</span></div>
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
  return `<div class="eq q${e.quality || 1}" title="${esc(name)}${tip ? ": " + tip : ""}"><img src="${ic(e.icon)}" alt="${esc(name)}">${extra}</div>`;
}
function renderPane() {
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === rtab));
  const el = $("pane");
  if (rtab === "char") {
    const gl = gearLevel(), fighting = S.field?.kind === "mob" ? MOB[S.field.name] : null;
    const now = fighting ? (WEAPONS.find(w => S.weapons[w] && GD.traits[fighting.trait]?.weapon === w) || (S.weapons.Sword ? "Sword" : null)) : null;
    const buffs = BUFF_ROLES.filter(r => active(S.buffs, r)).map(r => eqBox(S.buffs[r].name, "", `<span class="timer">${fmtT(S.buffs[r].until - S.clock)}</span>`, r));
    const supplies = Object.entries(S.supplies).flatMap(([kind, list]) => list.length ? [eqBox(list[0], "", `<span class="count">${list.length}</span>`, kind)] : []);
    el.innerHTML = `<div class="doll">
        <div class="col">${["Head", "Shoulder", "Back", "Chest"].map(s => eqBox(S.armor[s], s)).join("")}</div>
        <div class="stats"><div><div class="v" title="Damage per second with your best weapon, Shop speed included. A weapon matching a creature's trait deals more.">${Math.round(weaponDps(null) * speed("combat"))}</div><div class="k">DPS</div></div>
          <div><div class="v hp" title="Refills after every fight. Armor and combat food raise it.">${Math.round(maxHp()).toLocaleString("en-US")}</div><div class="k">HP</div></div>
          <div title="Average of your 7 armor slots (white 20, green 40, blue 60, purple 80, legendary 100). Empty slots count as 0."><div class="v gl" style="color:${glColor(gl)}">${gl}</div><div class="k">Gear Level</div><div class="glbar"><i style="left:${gl}%"></i></div></div></div>
        <div class="col">${["Hands", "Legs", "Feet"].map(s => eqBox(S.armor[s], s)).join("")}</div></div>
      <div class="weapons" style="margin-top:14px">${WEAPONS.map(w => `<div class="${w === now ? "now" : ""}" title="${STRONG[w]}">${eqBox(S.weapons[w], "MainHand", "", STRONG[w])}${w}</div>`).join("")}</div>
      <div class="subh">Tools</div>
      <div class="irow">${GATHER.slice().sort().map(k => S.tools[k] ? eqBox(S.tools[k], "MainHand") : `<div class="eq empty" title="${P[k].name} tool: craft one with Engineering"><img src="${ic(P[k].icon)}" alt="" style="filter:grayscale(1)"></div>`).join("")}</div>
      <div class="subh">Buffs <span>· one of each kind</span></div><div class="irow">${buffs.join("") || `<span class="mute small">None running. Craft potions and food.</span>`}</div>
      <div class="subh">Supplies <span>· up to ${BAL.buffs.keep} each</span></div><div class="irow">${supplies.join("") || `<span class="mute small">None yet.</span>`}</div>`;
  } else if (rtab === "shop") {
    const track = (k, label, lv, step, kind) => {
      const cost = shopCost(lv), can = cost <= S.gold, max = lv >= BAL.gold.steps;
      return `<div class="trk"><span class="tl">${label}</span>${pips(lv)}<span class="bonus">+${Math.round(lv * step * 100)}%</span>
        ${max ? `<span class="maxed">Max</span>` : `<button class="wbtn ${can ? "" : "dim"}" data-buy="${k}:${kind}" title="${can ? "Buy level " + (lv + 1) : "Not enough gold"}"><span class="coins">${coins(cost, true)}</span></button>`}</div>`;
    };
    el.innerHTML = `<div class="shophead"><span>Permanent upgrades. Each level costs double the last.</span><span class="coins">${coins(S.gold)}</span></div>` +
      GROUPS.map(([label, kind]) => `<div class="glabel" style="padding:12px 0 2px">${label}</div>` + byKind(kind).map(p =>
        `<div class="trainer"><img class="icon" src="${ic(p.icon)}" alt=""><div class="tn">${p.name}</div>
        ${track(p.key, "Speed", S.speedLv[p.key], BAL.gold.speed_step, "speed")}${track(p.key, "XP", S.xpLv[p.key], BAL.gold.xp_step, "xp")}</div>`).join("")).join("");
  } else if (rtab === "bags") {
    const mats = GD.materials.filter(m => (S.stock[m.name] || 0) >= 1);
    const total = mats.reduce((t, m) => t + Math.floor(S.stock[m.name]) * sellValue(m.name), 0);
    el.innerHTML = `<div class="shophead"><span>Up to ${bagCap()} of each. Extras sell while you play; nothing sells while the page is closed.</span>
        ${mats.length ? `<button class="wbtn" data-sellall="1">Sell everything · <span class="coins">${coins(total, true)}</span></button>` : ""}</div>` +
      (mats.map(m => { const n = Math.floor(S.stock[m.name]); return `<div class="li"><img class="icon sm" src="${ic(m.icon)}" alt="">
        <span class="q${m.quality}">${esc(m.name)}</span><button class="wbtn" style="padding:1px 8px;font-size:12.5px" data-sell="${esc(m.name)}">Sell all</button>
        <div class="sbar ${n >= bagCap() ? "full" : ""}"><i style="width:${pct(n / bagCap())}"></i><span><span></span><span>${n} / ${bagCap()}</span></span></div></div>`; }).join("")
      || `<p class="mute">Your bags are empty.</p>`);
  } else {
    el.innerHTML = `<div class="log">${logLines.join("") || `<p class="sys">Messages from the Archipelago server show here.</p>`}</div>`;
  }
}
function renderGoal() {
  const g = slotData.goal || "ragnaros", need = slotData.professions_to_master || 6;
  const showRag = g !== "master_professions", showMaster = g !== "ragnaros";
  const legendary = ARMOR_SLOTS.filter(s => S.armor[s] && BY_NAME[S.armor[s]].legendary).length;
  const odds = ragnarosOdds();
  const reqs = ["combat", "blacksmithing", "leatherworking", "tailoring", "alchemy", "cooking"];
  let html = `<img src="https://wow.zamimg.com/modelviewer/classic/webthumbs/npc/113/11121.png" alt="Ragnaros"><div>`;
  if (showRag) html += `<div class="title" style="font-size:15px">Defeat Ragnaros</div><ul>
      ${moltenCore ? `<li class="ok">✓ Molten Core</li>` : `<li class="no">✗ Molten Core (from the multiworld)</li>`}
      <li class="${legendary === 7 ? "ok" : "no"}">${legendary === 7 ? "✓" : "·"} Legendary armor ${legendary} / 7</li>
      ${S.ragnarosWon ? `<li class="ok">✓ Ragnaros defeated</li>` : moltenCore ? `<li><button class="wbtn ragbtn" data-rag="1" ${S.field?.kind === "ragnaros" ? "disabled" : ""}>Fight Ragnaros · win ${pct(odds.win)}</button></li>` : ""}</ul>`;
  if (showMaster) html += `<div class="title" style="font-size:15px;margin-top:6px">Master Professions</div><ul>
      <li><b>Professions at 300: ${masteredCount()} / ${need}</b></li></ul>`;
  if (showRag && !showMaster) html += `<ul><li class="mute">Ready when these are at 300: ${reqs.map(k => `<span class="${S.level[k] >= 300 ? "ok" : ""}">${P[k].name}</span>`).join(", ")}</li></ul>`;
  $("goal").innerHTML = html + `</div>`;
}
function render() {
  if (!S) return;
  renderHeader(); renderList(); renderSlots(); renderDetail(); renderPane(); renderGoal();
}

// ---- input -------------------------------------------------------------------------------
document.addEventListener("click", ev => {
  const t = ev.target.closest("button");
  if (!t || !S) return;
  if (t.matches(".prof")) { selected = t.dataset.k; tab = Math.max(0, (ranks[selected] || 1) - 1); closeDrawer(); render(); return; }
  if (t.dataset.t !== undefined) { tab = +t.dataset.t; renderDetail(); return; }
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
$("burger").onclick = () => document.body.classList.contains("drawer-open") ? closeDrawer() : openDrawer();
$("shade").onclick = closeDrawer;
function openDrawer() { document.body.classList.add("drawer-open"); $("shade").hidden = false; $("burger").setAttribute("aria-expanded", "true"); }
function closeDrawer() { document.body.classList.remove("drawer-open"); $("shade").hidden = true; $("burger").setAttribute("aria-expanded", "false"); }
$("to-connect").onclick = () => { if (confirmLeave()) location.reload(); };
const confirmLeave = () => { save(); return true; };

// ---- connect screen ------------------------------------------------------------------------
function showRecent() {
  let rooms = [];
  try { rooms = JSON.parse(lsGet("skillup:rooms") || "[]"); } catch {}
  $("recent").innerHTML = rooms.length ? `<div class="glabel" style="padding:0">Recent rooms</div>` + rooms.map(r =>
    `<button type="button" data-server="${esc(r.server)}" data-slot="${esc(r.slot)}"><b>${esc(r.slot)}</b><span class="mute" style="font-size:12.5px">${new Date(r.at).toLocaleDateString()}</span>
     <span class="mute" style="font-size:13px">${esc(r.server)} · ${r.done ? "Goal complete" : `${r.checks}/220 checks`}</span></button>`).join("") : "";
  $("recent").querySelectorAll("button").forEach(b => b.onclick = () => { $("c-server").value = b.dataset.server; $("c-slot").value = b.dataset.slot; $("c-pass").focus(); });
}
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
  showRecent();
}

// ---- main loop ------------------------------------------------------------------------------
let lastTick = 0;
function startGame() {
  ["connect"].forEach(id => $(id).hidden = true);
  ["top", "game", "foot"].forEach(id => $(id).hidden = false);
  if (!learned(selected)) selected = PROFS.find(p => learned(p.key))?.key || "combat";
  tab = Math.max(0, (ranks[selected] || 1) - 1);
  catchUpOffline();
  resendAllChecks(); flushChecks(); checkGoal();
  save();
  render();
  lastTick = performance.now();
  setInterval(tick, 250);
  setInterval(() => { if (dirty) save(); }, 20000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });
  window.addEventListener("pagehide", () => save());
}
let renderAcc = 0;
function tick() {
  const now = performance.now(), dt = Math.min((now - lastTick) / 1000, 3600);
  lastTick = now;
  advance(dt, false);
  dirty = true;
  flushChecks(); checkGoal();
  renderAcc += dt;
  renderSlots();
  if (renderAcc >= 1) { renderAcc = 0; render(); }
}

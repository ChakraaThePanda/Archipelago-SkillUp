"""
Balance simulator for SkillUp.

Plays the game the way a typical player would, using data/game_data.json (content) and
data/balance.json (every tunable number), and reports how long everything takes.

Usage:
    python tools/simulate.py                  # Normal speed summary
    python tools/simulate.py --speed Sync
    python tools/simulate.py --write          # full report of every test -> docs/BALANCE.md

How the simulated player plays (Field and Workshop run at the same time):
- Workshop: works on the lowest-level crafting profession that has something useful to
  craft, picking the recipe with the best XP per second. If it lacks materials, it asks the
  Field for them.
- Field: first gathers whatever the Workshop is waiting on; otherwise levels the
  lowest-level Field profession (4 gathering + Combat), picking the best XP per second.
- Spends gold right away on the cheapest trainer upgrade (speed or XP), while playing.
- Equips the best gear, swaps weapons for mob traits, uses potions and food automatically,
  keeps a few of each and sells everything else. Never gambles on red.
- Default start: Mining + Blacksmithing and Combat at Apprentice. Every other rank is an
  item from other players: it arrives `delay` minutes after it's needed (0 = on time).
- Offline (when a play schedule is given): while the page is closed, both slots keep
  repeating what they were doing, up to the offline cap; time past the cap becomes Rested XP.
Once every requirement for Ragnaros is met, it crafts the Fire Resistance set.
"""
from __future__ import annotations

import argparse
import json
import math
import pathlib
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = json.loads((ROOT / "data" / "game_data.json").read_text(encoding="utf-8"))
BAL = json.loads((ROOT / "data" / "balance.json").read_text(encoding="utf-8"))

RANK_CAPS = [r["cap"] for r in DATA["ranks"]]
PROFS = {p["key"]: p for p in DATA["professions"]}
FIELD = [k for k, p in PROFS.items() if p["kind"] in ("gathering", "combat")]
GATHER = [k for k, p in PROFS.items() if p["kind"] == "gathering"]
CRAFT = [k for k, p in PROFS.items() if p["kind"] == "crafting"]
START = ["mining", "blacksmithing", "combat"]
RAGNAROS_NEEDS = ["combat", "blacksmithing", "leatherworking", "tailoring", "alchemy", "cooking"]
ARMOR_SLOTS = {"Head", "Shoulder", "Back", "Chest", "Hands", "Legs", "Feet"}
WEAPONS = {"Dagger", "Sword", "Mace", "Axe"}
TOOL_FOR = {"Mining tool": "mining", "Skinning tool": "skinning", "Fishing tool": "fishing",
            "Herbalism tool": "herbalism"}
BUFF_ROLES = set(BAL["buffs"]["effects"]) | {"Healing"}
H = 3600.0
# The realistic player per game speed: minutes between check-ins at the start of a run and near
# the end (busy early while bags are small, calmer later). Sync players watch closely.
PLAYERS = {"Long": (2, 5), "Normal": (2, 5), "Sync": (1, 3)}


def fmt_t(sec: float | None) -> str:
    if sec is None:
        return "not reached"
    h, m = divmod(int(round(sec / 60)), 60)
    return f"{h}h{m:02d}" if h else f"{m}m"


class Sim:
    def __init__(self, speed="Normal", pool=None, delay=30.0, schedule=None, buffs=True,
                 traps=None, offline_cap_h=None, offline_mode=None, start=None, combat_delay=None,
                 goal="ragnaros", master_n=4, trinket_at=None, attention=None):
        """start: professions you start with (default: Mining + Blacksmithing + Combat).
        combat_delay: minutes until Apprentice Combat arrives when it isn't a starting item.
        goal: "ragnaros", "master" (master_n professions at 300) or "both".
        trinket_at: the skill point (counting every profession) on which the Darkmoon Card is found,
        or None for never. Its extra points are given on average (bonus_chance per point).
        attention: minutes between the player's check-ins (None = a perfect player who reacts
        instantly), or "ramp" for the realistic player of this speed (see PLAYERS): checking in
        often at the start of a run, less often as skills near 300. Between check-ins both slots keep repeating what they were doing (selling
        overflow as usual); at a check-in the player picks the best thing for each slot and
        spends gold in the Shop."""
        start = START if start is None else start
        self.goal, self.master_n, self.goal_time = goal, master_n, None
        # A player going for "master N professions" levels N of them first: the starting ones,
        # then gathering (fastest), then crafting, then Combat (it needs armor from crafting).
        order = list(dict.fromkeys([p for p in start if p != "combat"] + GATHER + CRAFT + ["combat"]))
        self.focus = set(order[:master_n]) if goal == "master" else None
        self.xpb, self.act, self.rec = BAL["xp"], BAL["actions"], BAL["recipes"]
        self.gold_cfg, self.cmb, self.buff_cfg = BAL["gold"], BAL["combat"], BAL["buffs"]
        self.game_speed = BAL["xp"]["game_speed"][speed]
        self.speed_name = speed
        self.delay = delay * 60
        self.schedule = schedule            # {"active_hours": A} or None (page always open)
        self.use_buffs = buffs
        self.offline_cap = (BAL["offline"]["cap_hours"] if offline_cap_h is None else offline_cap_h) * H
        self.t = 0.0
        self.attention = attention if attention == "ramp" else attention * 60 if attention else None
        self.next_check = 0.0
        self.decide = {"field": True, "work": True}
        self.points = 0                     # skill points gained so far, every profession
        self.trinket_at, self.trinket_acc, self.trinket_bonus = trinket_at, 0.0, 0
        self.level = {k: 1 for k in PROFS}
        self.xp = {k: 0.0 for k in PROFS}
        self.ranks = {k: (1 if k in start else 0) for k in PROFS}
        self.arrivals = [((combat_delay * 60 if k == "combat" and combat_delay is not None else self.delay), k)
                         for k in PROFS if k not in start]
        self.requested = {k: 1 for k in PROFS}
        self.speed_up = {k: 0 for k in PROFS}
        self.xp_up = {k: 0 for k in PROFS}
        self.stock = defaultdict(float)
        self.gold = self.gold_earned = self.gold_spent = 0.0
        self.earned_by = defaultdict(float)
        self.hourly = []
        self.pool = sorted(pool or [], key=lambda e: e[0])
        self.traps = sorted(traps or [], key=lambda e: e[0])
        self.pool_speed = defaultdict(float)
        self.pool_xp = defaultdict(float)
        self.storage_bonus = self.sell_bonus = self.rested = 0.0
        self.crafted = set()
        self.bags = 0
        self.tools, self.weapons, self.armor = {}, {}, {}
        self.consumables = defaultdict(list)        # role -> list of ranks in stock
        self.buff = {}                              # role -> (until, rank)
        self.debuff = {}                            # name -> until
        self.fr_done = set()
        self.need = None
        self.milestones = {k: {} for k in PROFS}
        self.idle_workshop = self.field_feeding = self.deaths = 0.0
        self.waiting_ranks = 0.0
        self.mat_by_name = {m["name"]: m for m in DATA["materials"]}
        self.ragnaros_ready = self.fr_finished = None
        self.last_field = self.last_recipe = None
        self.offline = False
        self.offline_mode = offline_mode or BAL["offline"]["mode"]
        self.unsold_crafts = 0.0
        self.sell_value = {e["name"]: max(self.gold_cfg["min_sell"], e["sell"] * self.gold_cfg["sell_mult"])
                           for e in DATA["materials"] + DATA["recipes"] + DATA["fire_resistance_set"]}

    # ---- ranks and leveling --------------------------------------------------------------
    def cap(self, prof):
        return RANK_CAPS[self.ranks[prof] - 1] if self.ranks[prof] else 0

    def open(self, prof):
        return self.ranks[prof] > 0 and self.level[prof] < self.cap(prof)

    def color_mult(self, prof, unlock):
        gap = self.level[prof] - unlock
        if gap < 0:
            return 0.0
        for upto, mult in self.xpb["colors"].values():
            if gap < upto:
                return mult
        return 0.0

    def xp_needed(self, level):
        return self.xpb["base"] * (1 + level / self.xpb["per_level"])

    def add_xp(self, prof, amount, field: bool):
        if not self.open(prof):
            return
        amount *= self.game_speed * (1 + self.xp_up[prof] * self.gold_cfg["xp_step"] + self.pool_xp[prof])
        amount *= 1 + self.buff_value("Gathering XP food" if field else "Crafting XP food")
        if self.rested > 0:
            amount *= 2
        self.xp[prof] += amount
        while self.level[prof] < self.cap(prof) and self.xp[prof] >= self.xp_needed(self.level[prof]):
            self.xp[prof] -= self.xp_needed(self.level[prof])
            self.level_up(prof)
            self.points += 1
            if self.trinket_at is not None and self.points > self.trinket_at and self.level[prof] < self.cap(prof):
                self.trinket_acc += BAL["trinket"]["bonus_chance"]
                if self.trinket_acc >= 1:
                    self.trinket_acc -= 1
                    self.trinket_bonus += 1
                    self.level_up(prof)
        if self.level[prof] >= self.cap(prof):
            self.xp[prof] = 0
            if self.ranks[prof] < 4 and self.requested[prof] == self.ranks[prof]:
                self.requested[prof] += 1
                self.arrivals.append((self.t + self.delay, prof))

    def level_up(self, prof):
        self.level[prof] += 1
        if self.level[prof] in RANK_CAPS:
            self.milestones[prof][self.level[prof]] = self.t

    def speed(self, prof):
        s = 1 + self.speed_up[prof] * self.gold_cfg["speed_step"] + self.pool_speed[prof]
        if prof in self.tools and self.debuff.get("Broken Tool", 0) <= self.t:
            s *= 1 + (self.tools[prof] + 1) * BAL["tools"]["step"]
        if prof in GATHER:
            s *= 1 + self.buff_value("Gathering speed")
        if prof in CRAFT:
            s *= 1 + self.buff_value("Crafting speed")
        if prof == "combat" and self.debuff.get("Resurrection Sickness", 0) > self.t:
            s *= BAL["traps"]["Resurrection Sickness"]["combat_slow"]
        return s

    def base_time(self, kind, rank, slot):
        return self.act[kind] * self.act["rank_growth"] ** rank * (1 + self.act["slot_growth"] * slot)

    # ---- buffs ---------------------------------------------------------------------------
    def buff_value(self, role):
        if role not in self.buff or self.buff[role][0] <= self.t:
            return 0.0
        return self.buff_cfg["effects"][role] * (1 + self.buff_cfg["rank_scale"] * self.buff[role][1])

    def refresh_buffs(self):
        if not self.use_buffs:
            return
        for role in self.buff_cfg["effects"]:
            if (role not in self.buff or self.buff[role][0] <= self.t) and self.consumables[role]:
                rank = max(self.consumables[role])
                self.consumables[role].remove(rank)
                self.buff[role] = (self.t + self.buff_cfg["minutes"] * 60, rank)

    # ---- gold ----------------------------------------------------------------------------
    def earn(self, copper, source="selling materials"):
        self.gold += copper
        self.gold_earned += copper
        self.earned_by[source] += copper

    def storage_cap(self):
        start = BAL["storage"]["start_by_speed"].get(self.speed_name, BAL["storage"]["start"])
        return start * BAL["storage"]["per_bag_mult"] ** self.bags * (1 + self.storage_bonus)

    def store(self, name, qty):
        kept = min(qty, max(0.0, self.storage_cap() - self.stock[name]))
        self.stock[name] += kept
        if qty > kept and not self.offline:      # nothing sells while the page is closed
            self.earn((qty - kept) * self.sell_value[name] * (1 + self.sell_bonus))

    def buy_upgrades(self):
        g = self.gold_cfg
        while True:
            options = []
            for k in PROFS:
                if self.level[k] >= 300:
                    continue
                if self.speed_up[k] < g["steps"]:
                    options.append((g["cost_base"] * g["cost_growth"] ** self.speed_up[k], k, "speed"))
                if self.xp_up[k] < g["steps"]:
                    options.append((g["cost_base"] * g["cost_growth"] ** self.xp_up[k], k, "xp"))
            if not options:
                return
            cost, k, kind = min(options)
            if cost > self.gold:
                return
            self.gold -= cost
            self.gold_spent += cost
            (self.speed_up if kind == "speed" else self.xp_up)[k] += 1

    # ---- combat --------------------------------------------------------------------------
    def weapon_dps(self, trait):
        """Best weapon for this trait (always picked automatically), before buffs."""
        c = self.cmb
        best = c["fists_dps"]
        for wtype, r in self.weapons.items():
            d = c["weapon_dps"] * c["rank_growth"] ** r
            if trait and DATA["traits"][trait]["weapon"] == wtype:
                d *= c["trait_match"]
            elif not trait and wtype == "Sword":
                d *= c["sword_bonus"]
            best = max(best, d)
        return best

    def armor_hp(self, ranks):
        c = self.cmb
        return c["base_hp"] + sum(c["armor_hp"] * c["rank_growth"] ** r for r in ranks)

    def max_hp(self):
        return self.armor_hp(self.armor.values()) * (1 + self.buff_value("Combat food"))

    def mob_base_time(self, mob, boss=True):
        return self.base_time("combat_time", mob["rank"], mob["slot"]) * (self.act["boss_time_mult"] if boss and mob["boss"] else 1)

    def need_dps(self, mob):
        c = self.cmb
        need = c["weapon_dps"] * c["rank_growth"] ** mob["rank"] * (1 + c["slot_growth"] * mob["slot"])
        return need * (c["boss_dps_mult"] if mob["boss"] else 1)

    def gear_fight_time(self, mob):
        """Fight length from gear alone (weapon + combat elixir). Shop speed shortens the real
        time but not the damage you take: survival comes from gear, speed from the Shop."""
        c = self.cmb
        dps = self.weapon_dps(mob["trait"]) * (1 + self.buff_value("Combat elixir"))
        return self.mob_base_time(mob) * min(max(self.need_dps(mob) / dps, c["ratio_min"]), c["ratio_max"])

    def fight(self, mob):
        """(real fight time, XP if you win, expected time lost to deaths) for one fight."""
        c = self.cmb
        t = max(self.gear_fight_time(mob) / self.speed("combat"), self.act["min_action_time"])
        p_death = self.death_chance(mob)
        return t, self.mob_base_time(mob) * self.act["xp_per_second"] * (1 - p_death), p_death * (c["death_time"] + t)

    def mob_damage(self, mob):
        """Damage one fight against this creature deals: fixed per creature, so only armor (HP)
        decides survival. Set so gear of the creature's own rank takes `danger` of its HP."""
        c = self.cmb
        # Armor each creature expects: the previous zone's gear for the 1st creature (no armor at
        # all in Elwynn), rising to the zone's own gear at the boss.
        e = mob["rank"] - 1 + mob["slot"] / 3
        expected = c["base_hp"] + 7 * c["armor_hp"] * c["rank_growth"] ** e * (min(1.0, 1 + e) if e < 0 else 1)
        return c["danger"] * expected * (c["boss_damage_mult"] if mob["boss"] else 1)

    def death_chance(self, mob, extra_hp=0.0):
        c = self.cmb
        taken = self.mob_damage(mob) / (self.max_hp() + extra_hp)
        return min(1.0, max(0.0, (taken - c["death_start"]) / c["death_span"]))

    # ---- the Field -----------------------------------------------------------------------
    def field_options(self, prof):
        out = []
        if self.ranks[prof] == 0:
            return out
        if prof == "combat":
            for m in DATA["mobs"]:
                if self.level["combat"] < m["unlock"] or m["rank"] >= self.ranks["combat"]:
                    continue
                t, xp, death = self.fight(m)
                out.append((xp * self.color_mult("combat", m["unlock"]) / (t + death), "mob", m))
        else:
            for m in DATA["materials"]:
                if m["profession"] != prof or self.level[prof] < m["unlock"]:
                    continue
                t = max(self.base_time("gather_time", m["rank"], m["slot"]) / self.speed(prof), self.act["min_action_time"])
                xp = self.base_time("gather_time", m["rank"], m["slot"]) * self.act["xp_per_second"]
                out.append((xp * self.color_mult(prof, m["unlock"]) / t, "gather", m))
        return out

    def check_interval(self):
        """Seconds until the player looks at the game again."""
        if self.attention != "ramp":
            return self.attention
        start, end = PLAYERS[self.speed_name]
        progress = sum(self.level.values()) / (300 * len(PROFS))
        return (start + (end - start) * progress) * 60

    def on_autopilot(self, slot):
        """True when this slot just repeats its last action: the page is closed (repeat mode),
        or the player isn't looking right now (between check-ins)."""
        if self.offline and self.offline_mode == "repeat":
            return True
        if not self.attention or self.ragnaros_ready is not None:
            return False
        if self.decide[slot]:
            self.decide[slot] = False
            return False
        return True

    def do_field(self):
        if self.on_autopilot("field"):
            if not self.last_field:
                return 5.0
            return self.run_field(self.last_field)   # storage full: still gains skill, extras are lost
        # A player who isn't watching every second gathers what levels their skills while crafting
        # still has materials in the bags, and stocks up for crafting once the bags run dry.
        if self.need and (not self.attention or not self.focused([p for p in FIELD if self.open(p)])
                          or self.sustainable_recipe(self.check_interval()) is None):
            mat = self.mat_by_name[self.need]
            prof = mat["profession"]
            if prof == "combat":
                mobs = [o for o in self.field_options("combat") if o[2]["rank"] == mat["rank"]]
                if mobs:
                    return self.feed(max(mobs, key=lambda o: o[0]))
            elif self.ranks[prof] and self.level[prof] >= mat["unlock"]:
                return self.feed(next(o for o in self.field_options(prof) if o[2]["name"] == self.need))
        todo = self.focused([p for p in FIELD if self.open(p)])
        if not todo:
            self.waiting_ranks += 5
            return 5.0
        prof = min(todo, key=lambda p: self.level[p])
        opts = [o for o in self.field_options(prof) if o[0] > 0] or self.field_options(prof)
        return self.run_field(max(opts, key=lambda o: (o[0], o[2]["slot"])))

    def feed(self, opt):
        dt = self.run_field(opt)
        self.field_feeding += dt
        return dt

    def run_field(self, opt):
        self.last_field = opt
        _, kind, e = opt
        if kind == "mob":
            t, xp, death = self.fight(e)
            self.add_xp("combat", xp * self.color_mult("combat", e["unlock"]), True)
            self.store(e["cloth"], self.cmb["cloth_per_kill"])
            self.earn(self.cmb["gold_per_kill"] * self.cmb["rank_growth"] ** e["rank"], "combat loot")
            if death and self.use_buffs and self.consumables["Healing"]:
                best = max(self.consumables["Healing"])          # the best potion is drunk
                self.consumables["Healing"].remove(best)
                # the same fight, checked again with the potion's HP added
                death *= self.death_chance(e, self.buff_cfg["healing_hp"][best]) / self.death_chance(e)
            self.deaths += death / self.cmb["death_time"]
            return t + death
        prof = e["profession"]
        base = self.base_time("gather_time", e["rank"], e["slot"])
        self.add_xp(prof, base * self.act["xp_per_second"] * self.color_mult(prof, e["unlock"]), True)
        self.store(e["name"], self.act["gather_yield"])
        return max(base / self.speed(prof), self.act["min_action_time"])

    # ---- the Workshop --------------------------------------------------------------------
    def qty(self, recipe):
        return math.ceil(self.rec["reagent_qty"] * self.rec["role_qty_mult"].get(recipe["role"], 1))  # whole items, like the game

    def missing(self, r):
        return next((n for n in r["reagents"] if self.stock[n] < self.qty(r) - 1e-9), None)

    def recipe_xp(self, r):
        prof = r["profession"]
        col = self.color_mult(prof, r["unlock"]) * self.rec["role_xp_mult"].get(r["role"], 1)
        t = max(self.base_time("craft_time", r["rank"], r["slot"]) / self.speed(prof), self.act["min_action_time"])
        return self.base_time("craft_time", r["rank"], r["slot"]) * self.act["xp_per_second"] * self.act["craft_xp_mult"] * col, t

    def do_workshop(self):
        if self.on_autopilot("work"):
            r = self.last_recipe
            if r and self.missing(r) is None:
                xp, t = self.recipe_xp(r)
                self.craft(r)
                self.add_xp(r["profession"], xp, False)
                return t
            self.idle_workshop += 5
            return 5.0
        # the Fire Resistance set comes first once Ragnaros is in reach (if the goal needs him);
        # after it's done, the Workshop goes back to levelling whatever the goal still needs
        if self.ragnaros_ready is not None and self.goal != "master" and self.fr_finished is None:
            return self.craft_fr()
        if self.attention:      # checking in: craft what the bags can keep going until the next check-in
            r = self.sustainable_recipe(self.check_interval())
            if r:
                xp, t = self.recipe_xp(r)
                self.need, self.last_recipe = None, r
                self.craft(r)
                self.add_xp(r["profession"], xp, False)
                return t
        first_missing = waiting_on = None
        for prof in sorted(self.focused([p for p in CRAFT if self.open(p)]), key=lambda p: self.level[p]):
            cands = []
            for r in DATA["recipes"]:
                if r["profession"] != prof or self.level[prof] < r["unlock"]:
                    continue
                xp, t = self.recipe_xp(r)
                if xp > 0:
                    cands.append((xp / t, r, t, xp))
            for _, r, t, xp in sorted(cands, key=lambda c: -c[0]):
                miss = self.missing(r)
                if miss is None:
                    self.need = None
                    self.last_recipe = r
                    self.craft(r)
                    self.add_xp(prof, xp, False)
                    return t
                if not first_missing:
                    first_missing, waiting_on = miss, r
        self.need = first_missing
        if waiting_on:          # like the game: the recipe stays set and starts once its materials arrive
            self.last_recipe = waiting_on
        self.idle_workshop += 5
        return 5.0

    def craft(self, r):
        for name in r["reagents"]:
            self.stock[name] -= self.qty(r)
        first = r["name"] not in self.crafted
        self.crafted.add(r["name"])
        role, keep = r["role"], False
        if role in WEAPONS and self.weapons.get(role, -1) < r["rank"]:
            self.weapons[role], keep = r["rank"], True
        elif role in ARMOR_SLOTS and self.armor.get(role, -1) < r["rank"]:
            self.armor[role], keep = r["rank"], True
        elif role in TOOL_FOR and self.tools.get(TOOL_FOR[role], -1) < r["rank"]:
            self.tools[TOOL_FOR[role]], keep = r["rank"], True
        elif role == "Bag" and first:
            self.bags, keep = self.bags + 1, True
        elif role in BUFF_ROLES and self.use_buffs and r["rank"] >= max(self.consumables[role], default=-1):
            # like the game: only the best rank of each kind is kept (lower ones are sold;
            # their few coins aren't counted here)
            if r["rank"] > max(self.consumables[role], default=-1):
                self.consumables[role].clear()
            if len(self.consumables[role]) < self.buff_cfg["keep"]:
                self.consumables[role].append(r["rank"])
                keep = True
        if not keep and self.offline:
            self.unsold_crafts += self.craft_price(r)
        elif not keep:
            self.earn(self.craft_price(r) * (1 + self.sell_bonus), "selling crafts")

    def craft_price(self, r):
        """A crafted item sells for the value of its materials, marked up."""
        return sum(self.sell_value[n] * self.qty(r) for n in r["reagents"]) * self.gold_cfg["crafted_markup"]

    def craft_fr(self):
        q = self.rec["fr_qty"]
        for f in DATA["fire_resistance_set"]:
            if f["name"] in self.fr_done:
                continue
            miss = next((n for n in f["reagents"] if self.stock[n] < q), None)
            if miss:
                self.need = miss
                self.idle_workshop += 5
                return 5.0
            for n in f["reagents"]:
                self.stock[n] -= q
            self.fr_done.add(f["name"])
            self.need = None
            return self.base_time("craft_time", 3, 3)
        if self.fr_finished is None:
            self.fr_finished = self.t
        return 5.0

    # ---- items from other players --------------------------------------------------------
    def receive(self, name, spec):
        open_profs = [k for k in PROFS if self.ranks[k] and self.level[k] < 300] or list(PROFS)
        target = min(open_profs, key=lambda k: self.level[k])
        top_rank = max((self.level[k] - 1) // 75 for k in PROFS)
        if "shop" in spec:  # a free Shop level for the profession with the fewest of that kind
            levels = self.speed_up if spec["shop"] == "speed" else self.xp_up
            open_shop = [k for k in open_profs if levels[k] < self.gold_cfg["steps"]]
            if open_shop:
                levels[min(open_shop, key=lambda k: (levels[k], self.level[k]))] += 1
        if "storage" in spec:
            self.storage_bonus += spec["storage"]
        if "sell" in spec:
            self.sell_bonus += spec["sell"]
        if "gold" in spec:
            self.earn(spec["gold"] * self.cmb["rank_growth"] ** top_rank, "coin pouches")
        if "rested_min" in spec:
            self.rested = min(self.rested + spec["rested_min"] * 60, BAL["offline"]["rested_cap"] * 60)
        if "levels" in spec:
            self.add_xp(target, spec["levels"] * self.xp_needed(self.level[target]) / self.game_speed, True)

    def spring_trap(self, name):
        cfg = BAL["traps"][name]
        if name in ("Resurrection Sickness", "Broken Tool"):
            self.debuff[name] = self.t + cfg["minutes"] * 60
        elif name == "Repair Bill":
            lost = self.gold * cfg["gold_percent"] / 100
            self.gold -= lost
            self.trap_gold_lost = getattr(self, "trap_gold_lost", 0) + lost
        elif name == "Murloc Ambush":
            murloc = next(m for m in DATA["mobs"] if m["name"] == "Murloc Forager")
            t, _, death = self.fight(murloc)
            return (t + death) * cfg["fights"]
        return 0.0

    def sustainable_recipe(self, horizon):
        """The recipe that earns the most skill over `horizon` seconds from what's in the bags
        (what a player picks before looking away), or None if nothing can be crafted."""
        best = None
        for r in DATA["recipes"]:
            if not self.focused_open(r["profession"]) or self.level[r["profession"]] < r["unlock"]:
                continue
            xp, t = self.recipe_xp(r)
            runs = min(self.stock[n] for n in r["reagents"]) // self.qty(r)
            if xp <= 0 or runs < 1:
                continue
            score = min(runs * t, horizon) * xp / t
            if best is None or score > best[0]:
                best = (score, r)
        return best[1] if best else None

    def focused_open(self, prof):
        return self.open(prof) and prof in self.focused([p for p in PROFS if self.open(p)])

    def set_up_for_offline(self):
        """Before closing the page, a player sets both slots on something worth repeating:
        the Field on the best XP action of its lowest open profession, the Workshop on the
        best recipe it can keep crafting from stock."""
        todo = [p for p in FIELD if self.open(p)]
        if todo:
            prof = min(todo, key=lambda p: self.level[p])
            opts = [o for o in self.field_options(prof) if o[0] > 0]
            if opts:
                self.last_field = max(opts, key=lambda o: (o[0], o[2]["slot"]))
        best = self.sustainable_recipe(self.offline_cap)
        if best:
            self.last_recipe = best
        # make room: sell the stock of the material the Field will gather, unless the Workshop needs it
        if self.last_field and self.last_field[1] == "gather":
            name = self.last_field[2]["name"]
            if not (self.last_recipe and name in self.last_recipe["reagents"]):
                self.earn(self.stock[name] * self.sell_value[name] * (1 + self.sell_bonus))
                self.stock[name] = 0.0

    # ---- main loop -----------------------------------------------------------------------
    def focused(self, profs):
        """Professions to work on: the focus set first if there is one and any is open."""
        if self.focus:
            return [p for p in profs if p in self.focus] or profs
        return profs

    def goal_done(self):
        ragnaros = self.fr_finished is not None
        master = sum(self.level[p] >= 300 for p in PROFS) >= self.master_n
        return {"ragnaros": ragnaros, "master": master, "both": ragnaros and master}[self.goal]

    def run(self, limit_h=24 * 30):
        nf = nw = 0.0
        while self.t < limit_h * H:
            if self.ragnaros_ready is None and all(self.level[p] >= 300 for p in RAGNAROS_NEEDS):
                self.ragnaros_ready = self.t
            if self.goal_done():
                self.goal_time = self.t
                break
            for queue, fn in ((self.pool, self.receive), (self.arrivals, None)):
                queue.sort(key=lambda e: e[0])
                while queue and queue[0][0] <= self.t:
                    e = queue.pop(0)
                    if fn:
                        fn(*e[1:])
                    else:
                        self.ranks[e[1]] += 1
            while self.traps and self.traps[0][0] <= self.t:
                nf += self.spring_trap(self.traps.pop(0)[1])
            # offline handling: closed page repeats actions up to the cap, then sleeps
            if self.schedule:
                day = self.t // 86400 * 86400
                closed_at = day + self.schedule["active_hours"] * H
                was_offline = self.offline
                self.offline = self.t >= closed_at
                if self.offline and not was_offline:
                    self.set_up_for_offline()
                if was_offline and not self.offline and self.unsold_crafts:
                    self.earn(self.unsold_crafts * (1 + self.sell_bonus), "selling crafts")
                    self.unsold_crafts = 0.0
                if self.offline and self.t >= closed_at + self.offline_cap:
                    past_cap = day + 86400 - (closed_at + self.offline_cap)
                    if past_cap > 0:
                        gain = past_cap / H * BAL["offline"]["rested_per_hour"] * 60
                        self.rested = min(self.rested + gain, BAL["offline"]["rested_cap"] * 60)
                    nf = nw = self.t = day + 86400
                    self.offline = False
                    continue
            self.refresh_buffs()
            if nf <= nw:
                self.t = nf
                dt = self.do_field()
                nf += dt
                self.rested = max(0.0, self.rested - dt)
            else:
                self.t = nw
                nw += self.do_workshop()
            if self.attention and self.t >= self.next_check:      # the player looks at the game
                while self.next_check <= self.t:
                    self.next_check += self.check_interval()
                self.decide = {"field": True, "work": True}
                if not self.offline:
                    self.buy_upgrades()
            elif not self.offline and not self.attention:
                self.buy_upgrades()
            if self.t >= len(self.hourly) * H:
                n = len(PROFS)
                self.hourly.append((sum(self.speed_up.values()) / n, sum(self.xp_up.values()) / n))
        self.end = self.t
        return self


# ---- scenarios ---------------------------------------------------------------------------
def build_pool(finish, only=None):
    """Spread the pool's items evenly between 2% and 95% of a seed, interleaving kinds."""
    cfg = BAL["pool"]
    queue = []
    for name, spec in {**cfg["useful"], **cfg["filler"]}.items():
        if only is not None and name not in only:
            continue
        for i in range(spec["count"]):
            queue.append(((i + 0.5) / spec["count"], name, spec))
    queue.sort(key=lambda q: q[0])
    n = len(queue)
    return [(finish * (0.02 + 0.93 * (j + 0.5) / n), name, spec) for j, (_, name, spec) in enumerate(queue)]


def seed(speed="Normal", pool=True, perfect=False, **kw):
    """A seed with its full item pool, spread over its own length, played by the realistic player
    of that speed (or a perfect one)."""
    kw.setdefault("attention", None if perfect else "ramp")
    base = Sim(speed, **kw).run()
    if not pool:
        return base
    sim = Sim(speed, build_pool(base.goal_time or base.end), **kw).run()
    sim.no_pool = base.ragnaros_ready
    return sim


def main_report(sim, speed, perfect=None):
    out = [f"### {speed} speed", ""]
    if perfect:
        start, end = PLAYERS[speed]
        out.append(f"- **Goal done: {fmt_t(sim.goal_time)}** for a player checking in every {start} min early, every "
                   f"{end} min late; a perfect player (reacts instantly) {fmt_t(perfect.goal_time)}")
    out.append(f"- **Ragnaros ready** (300 in {', '.join(PROFS[p]['name'] for p in RAGNAROS_NEEDS)}): "
               f"**{fmt_t(sim.ragnaros_ready)}**; Fire Resistance set done {fmt_t(sim.fr_finished)}")
    if getattr(sim, "no_pool", None):
        out.append(f"- Same seed without the item pool: {fmt_t(sim.no_pool)}")
    out.append(f"- Workshop idle waiting for materials: {fmt_t(sim.idle_workshop)}; Field time fetching "
               f"materials for it: {fmt_t(sim.field_feeding)}")
    out.append(f"- Gold earned {sim.gold_earned / 10000:.0f}g, spent {sim.gold_spent / 10000:.0f}g "
               f"({', '.join(f'{k} {v / 10000:.0f}g' for k, v in sim.earned_by.items())}); deaths about {sim.deaths:.0f}")
    out.append("- Trainer upgrades owned per profession, by hour (speed/XP, out of "
               f"{BAL['gold']['steps']}): " + ", ".join(f"{h}h {a:.1f}/{b:.1f}" for h, (a, b) in enumerate(sim.hourly) if h % 2 == 0))
    out += ["", "| Profession | 75 | 150 | 225 | 300 |", "| --- | --- | --- | --- | --- |"]
    for k, p in PROFS.items():
        ms = sim.milestones[k]
        out.append(f"| {p['name']} | " + " | ".join(fmt_t(ms.get(c)) if c in ms else "-" for c in RANK_CAPS) + " |")
    return "\n".join(out)


def options_report():
    """Time to finish a seed for every YAML option that changes play (Normal speed unless noted).
    Rank items arrive 30 min after they're needed; full item pool; page always open."""
    pairs = {"Mining + Blacksmithing": ["mining", "blacksmithing"], "Herbalism + Alchemy": ["herbalism", "alchemy"],
             "Skinning + Leatherworking": ["skinning", "leatherworking"], "Fishing + Cooking": ["fishing", "cooking"]}
    def run(label, speed="Normal", **kw):
        s = seed(speed, **kw)
        return f"| {label} | **{fmt_t(s.goal_time)}** | {s.deaths:.0f} |"
    out = ["## Every option", "", "Time until the goal is done (Ragnaros: Fire Resistance set crafted).", "",
           "| Setting | Goal done | Deaths |", "| --- | --- | --- |"]
    for speed in BAL["xp"]["game_speed"]:
        out.append(run(f"Game speed: {speed}", speed))
    for goal, n in (("master", 1), ("master", 4), ("master", 11), ("both", 4)):
        out.append(run(f"Goal: {'Master Professions' if goal == 'master' else 'Both'}, {n} to master", goal=goal, master_n=n))
    for name, prof in pairs.items():
        out.append(run(f"Starting pair: {name}", start=prof + ["combat"]))
    out.append(run("Starting pairs: 4 (everything gathering + its craft)", start=[p for v in pairs.values() for p in v] + ["combat"]))
    out.append(run("Combat access: Early (arrives in ~10 min)", start=["mining", "blacksmithing"], combat_delay=10))
    out.append(run("Combat access: Anywhere (arrives in ~1 h)", start=["mining", "blacksmithing"], combat_delay=60))
    out.append(run("Combat access: Anywhere, late (arrives in ~3 h)", start=["mining", "blacksmithing"], combat_delay=180))
    return "\n".join(out)


def pool_report():
    t0 = seed(pool=False, delay=0).ragnaros_ready
    full = seed(delay=0).ragnaros_ready
    cfg = BAL["pool"]
    out = ["## Item pool", "",
           f"Without the pool: {fmt_t(t0)}. With every pool item: **{fmt_t(full)}** ({(1 - full / t0) * 100:.0f}% faster).",
           "Measured with rank items arriving on time (waiting adds noise). Each row adds only that item to an "
           "empty pool. Offline items only matter with a play schedule (see below).", "",
           "| Item | Count | Time saved, all copies | Per copy |", "| --- | --- | --- | --- |"]
    for group in ("useful", "filler"):
        for name, spec in cfg[group].items():
            t = Sim("Normal", build_pool(t0, {name}), delay=0).run().ragnaros_ready
            out.append(f"| {name} ({group}) | {spec['count']} | {fmt_t(max(0, t0 - t))} | {(t0 - t) / spec['count'] / 60:.1f} min |")
    return "\n".join(out)


def buffs_report():
    on, off = seed(), seed(buffs=False)
    return "\n".join(["## Potions and food", "",
                      f"With potions and food used automatically: **{fmt_t(on.ragnaros_ready)}**. "
                      f"Without any: {fmt_t(off.ragnaros_ready)} "
                      f"({(1 - on.ragnaros_ready / off.ragnaros_ready) * 100:.0f}% faster with them). "
                      f"Deaths: {on.deaths:.0f} with, {off.deaths:.0f} without."])


def delay_report():
    out = ["## Waiting for rank items", "",
           "Every rank except the starting ones comes from other players. Here each one arrives this long "
           "after you need it (the other slot keeps working meanwhile).", "",
           "| Average wait per rank | Ragnaros ready | Field idle (all its professions capped) |", "| --- | --- | --- |"]
    for d in (0, 15, 30, 60, 120):
        s = seed(delay=d)
        out.append(f"| {d} min | {fmt_t(s.ragnaros_ready)} | {fmt_t(s.waiting_ranks)} |")
    return "\n".join(out)


def schedule_report():
    def marks(active, mode, cap_h):
        sim = Sim("Normal", schedule={"active_hours": active}, offline_mode=mode, offline_cap_h=cap_h)
        out, orig = [], sim.set_up_for_offline

        def mark():
            out.append(sum(sim.level.values()))
            orig()
        sim.set_up_for_offline = mark
        sim.run(limit_h=24 * 2 + active)
        out.append(sum(sim.level.values()))
        return out + [3300] * (3 - len(out))

    rows = [("No offline progress (Rested XP only)", "repeat", 0), ("Repeat last action, 8 h cap (chosen)", "repeat", 8),
            ("Smart (keeps choosing), 8 h cap (rejected: too strong)", "auto", 8)]
    out = ["## Offline time and play schedules", "",
           "Total skill levels (all 11 professions, 3300 = everything maxed) at the end of each day's play "
           "session, for someone who opens the page this many hours a day. Before closing, the player sets "
           "both slots on something worth repeating. Time past the offline cap becomes Rested XP.", "",
           "| Open per day | While closed | Day 1 | Day 2 | Day 3 |", "| --- | --- | --- | --- | --- |"]
    for a in (1, 2, 4):
        for label, mode, cap in rows:
            m = marks(a, mode, cap)
            out.append(f"| {a} h | {label} | {m[0]} | {m[1]} | {m[2]} |")
    return "\n".join(out)


def traps_report():
    base = Sim("Normal").run().ragnaros_ready
    out = ["## Traps", "", "One copy of each trap, sprung a third of the way into a seed (no item pool, to isolate it).", "",
           "| Trap | Time lost | Notes |", "| --- | --- | --- |"]
    for name in (k for k in BAL["traps"] if not k.startswith("_")):
        s = Sim("Normal", traps=[(base / 3, name)]).run()
        note = f"lost {getattr(s, 'trap_gold_lost', 0) / 10000:.1f}g" if name == "Repair Bill" else ""
        out.append(f"| {name} | {fmt_t(max(0, s.ragnaros_ready - base))} | {note} |")
    filler = sum(v["count"] for v in BAL["pool"]["filler"].values())
    out.append("")
    out.append(f"At {BAL['pool']['trap_percent']}% of {filler} filler slots, a default seed has about "
               f"{filler * BAL['pool']['trap_percent'] / 100:.0f} traps.")
    return "\n".join(out)


def trinket_report():
    """The Darkmoon Card: how likely a game finds it, and how much time it saves when it does."""
    find = BAL["trinket"]["find_chance"]
    out = ["## Darkmoon Card (hidden legendary trinket)", "",
           f"Each skill point has a {find:.1%} chance to find it; once worn, each skill point has a "
           f"{BAL['trinket']['bonus_chance']:.0%} chance to give one more (never past the rank's cap). "
           "Extra points don't roll again. Time saved by when in the game it's found:", "",
           "| Speed | Skill points in a game | Chance to find it | Found at the start | A quarter in | Halfway | Three quarters in |",
           "| --- | --- | --- | --- | --- | --- | --- |"]
    for speed in ("Normal", "Sync"):
        base = seed(speed)
        n, t0 = base.points, base.goal_time
        chance = 1 - (1 - find) ** n
        cells = []
        for frac in (0, 0.25, 0.5, 0.75):
            t = seed(speed, trinket_at=int(n * frac)).goal_time
            cells.append(f"{fmt_t(max(0, t0 - t))} ({(t0 - t) / t0:.0%})")
        out.append(f"| {speed} ({fmt_t(t0)}) | {n} | {chance:.0%} | " + " | ".join(cells) + " |")
    return "\n".join(out)


def red_chance(gap):
    for upto, chance in BAL["red"]["chances"]:
        if gap <= upto:
            return chance
    return BAL["red"]["chances"][-1][1]


def red_report():
    """Expected time to a first success on each rank's rarest material, from below."""
    typical = seed()
    speed_at = {}
    # upgrades owned when Mining reached each 50 levels, from the typical seed's hourly log
    for lvl in (1, 50, 100, 150, 200, 250):
        t = next((t for c, t in sorted(typical.milestones["mining"].items()) if c >= lvl), typical.end)
        h = min(int(t // H), len(typical.hourly) - 1)
        speed_at[lvl] = 1 + typical.hourly[h][0] * BAL["gold"]["speed_step"]
    out = ["## Red attempts", "",
           "Expected time to the first success on each rank's last Mining material (the gem), attempted from "
           "a lower level while owning its rank. Attempts get slower the further below you are. *Bare* = no upgrades; *typical* = the trainer speed a "
           "typical player has at that level, plus the matching tool.", "",
           "| Target (unlocks at) | From level | Chance | Bare | Typical |", "| --- | --- | --- | --- | --- |"]
    sim = Sim("Normal")
    for m in DATA["materials"]:
        if m["profession"] != "mining" or m["slot"] != 3:
            continue
        for lvl in (1, 50, 100, 150, 200, 250):
            if lvl >= m["unlock"]:
                continue
            ch = red_chance(m["unlock"] - lvl)
            base = sim.base_time("gather_time", m["rank"], m["slot"]) * (1 + (m["unlock"] - lvl) / BAL["red"]["slow_per_levels"])
            tool = 1 + (min(m["rank"], max(0, (lvl - 1) // 75)) + 1) * BAL["tools"]["step"]
            out.append(f"| {m['name']} ({m['unlock']}) | {lvl} | {ch:.0%} | {fmt_t(base / ch)} | "
                       f"{fmt_t(base / ch / speed_at[lvl] / tool)} |")
    return "\n".join(out)


def ragnaros_report():
    r, c = BAL["ragnaros"], BAL["combat"]
    rag = {"trait": "Tough"}

    def win(weapon_rank, armor_rank, fr_pieces, consumables):
        sim = Sim("Normal")
        sim.weapons = {"Axe": weapon_rank}
        fr_items = [f for f in DATA["fire_resistance_set"] if f.get("fire_resistance")]
        fr_items.sort(key=lambda f: -f["fire_resistance"])
        worn = fr_items[:fr_pieces]
        fr = sum(f["fire_resistance"] for f in worn) + (r["potion_fr"] + r["food_fr"] if consumables else 0)
        armor = [r["fr_armor_rank"]] * len(worn) + [armor_rank] * (7 - len(worn))
        dps, hp = sim.weapon_dps("Tough"), sim.armor_hp(armor)
        chance = (r["max_win"] * min(1, dps / r["dps_need"]) ** 2 * min(1, hp / r["hp_need"])
                  * (r["fr_floor"] + (1 - r["fr_floor"]) * min(1, fr / r["fr_need"]) ** 2))
        tries = 1 / chance if chance > 0 else float("inf")
        cost = tries * r["fight_minutes"] * 60 + (tries - 1) * c["death_time"]
        return chance, cost, fr, f"{dps:.0f} / {hp:,.0f}"

    out = ["## Ragnaros", "",
           f"Win chance per attempt (fights last {r['fight_minutes']} min). Weapon: an Axe of that rank (Ragnaros is Tough). "
           "Fire Resistance pieces replace main-set armor; the rest is main-set armor of the same rank.", "",
           "| Gear rank | FR pieces | Potion + food | Fire Resistance | DPS / HP | Win chance | Expected time to win |",
           "| --- | --- | --- | --- | --- | --- | --- |"]
    for gear in (2, 3):
        for pieces in (0, 3, 5, 7):
            for cons in (False, True):
                if pieces == 0 and cons:
                    continue
                ch, cost, fr, power = win(gear, gear, pieces, cons)
                out.append(f"| {DATA['ranks'][gear]['name']} | {pieces}/7 | {'yes' if cons else 'no'} | {fr} | "
                           f"{power} | {ch:.0%} | {fmt_t(cost) if ch > 0.001 else 'never'} |")
    return "\n".join(out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--speed", default="Normal", choices=list(BAL["xp"]["game_speed"]))
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--trinket", action="store_true", help="only the Darkmoon Card report")
    a = ap.parse_args()
    if a.trinket:
        print(trinket_report())
    elif not a.write:
        print(main_report(seed(a.speed), a.speed))
    else:
        parts = ["# SkillUp: balance simulation", "",
                 "Generated by `tools/simulate.py` from `data/balance.json` and `data/game_data.json`.",
                 "Unless a section says otherwise: page always open, each rank item arrives 30 min after it's needed, full item pool,",
                 "potions and food used automatically, no traps, no red gambles, and a realistic player: between check-ins both",
                 "slots keep repeating what they were doing (see PLAYERS in the script for how often each speed's player looks).",
                 "Sections built on `Sim(...)` directly (item pool, traps, offline schedules) use the perfect player to compare options.", "",
                 "## Game speeds", ""]
        for s in BAL["xp"]["game_speed"]:
            parts += [main_report(seed(s), s, seed(s, perfect=True)), ""]
        for fn in (options_report, trinket_report, pool_report, buffs_report, delay_report, schedule_report, traps_report, red_report, ragnaros_report):
            parts += [fn(), ""]
        text = "\n".join(parts)
        (ROOT / "docs" / "BALANCE.md").write_text(text, encoding="utf-8")
        print(text)

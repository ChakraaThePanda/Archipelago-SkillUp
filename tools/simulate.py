"""
Balance simulator for Skillup.

Plays the game the way a typical player would, using data/game_data.json (content) and
data/balance.json (every tunable number), and reports how long everything takes.

Usage:
    python tools/simulate.py                  # Normal speed summary
    python tools/simulate.py --speed Fast
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


def fmt_t(sec: float | None) -> str:
    if sec is None:
        return "not reached"
    h, m = divmod(int(round(sec / 60)), 60)
    return f"{h}h{m:02d}" if h else f"{m}m"


def fmt_days(sec: float | None) -> str:
    return "not reached" if sec is None else f"{sec / 86400:.1f} days"


class Sim:
    def __init__(self, speed="Normal", pool=None, delay=30.0, schedule=None, buffs=True,
                 traps=None, offline_items=0, offline_mode=None):
        self.xpb, self.act, self.rec = BAL["xp"], BAL["actions"], BAL["recipes"]
        self.gold_cfg, self.cmb, self.buff_cfg = BAL["gold"], BAL["combat"], BAL["buffs"]
        self.game_speed = BAL["xp"]["game_speed"][speed]
        self.delay = delay * 60
        self.schedule = schedule            # {"active_hours": A} or None (page always open)
        self.use_buffs = buffs
        self.offline_cap = (BAL["offline"]["cap_hours"] + BAL["offline"]["per_item_hours"] * offline_items) * H
        self.t = 0.0
        self.level = {k: 1 for k in PROFS}
        self.xp = {k: 0.0 for k in PROFS}
        self.ranks = {k: (1 if k in START else 0) for k in PROFS}
        self.arrivals = [(self.delay, k) for k in PROFS if k not in START]
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
        amount *= 1 + self.buff_value("XP food (Field)" if field else "XP food (Workshop)")
        if self.rested > 0:
            amount *= 2
        self.xp[prof] += amount
        while self.level[prof] < self.cap(prof) and self.xp[prof] >= self.xp_needed(self.level[prof]):
            self.xp[prof] -= self.xp_needed(self.level[prof])
            self.level[prof] += 1
            if self.level[prof] in RANK_CAPS:
                self.milestones[prof][self.level[prof]] = self.t
        if self.level[prof] >= self.cap(prof):
            self.xp[prof] = 0
            if self.ranks[prof] < 4 and self.requested[prof] == self.ranks[prof]:
                self.requested[prof] += 1
                self.arrivals.append((self.t + self.delay, prof))

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

    def store(self, name, qty):
        cap = BAL["storage"]["start"] * BAL["storage"]["per_bag_mult"] ** self.bags * (1 + self.storage_bonus)
        kept = min(qty, max(0.0, cap - self.stock[name]))
        self.stock[name] += kept
        if qty > kept:
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
    def weapon_power(self, trait):
        c = self.cmb
        best = c["fists"]
        for wtype, r in self.weapons.items():
            p = c["weapon_power"] * c["rank_growth"] ** r
            if trait and DATA["traits"][trait]["weapon"] == wtype:
                p *= c["trait_match"]
            elif trait:
                p *= c["trait_miss"]
            elif wtype == "Sword":
                p *= c["sword_bonus"]
            best = max(best, p)
        return best

    def armor_power(self, ranks):
        c = self.cmb
        return sum(c["armor_power"] * c["rank_growth"] ** r for r in ranks)

    def power_vs(self, mob):
        p = self.weapon_power(mob["trait"]) + self.armor_power(self.armor.values())
        return p * (1 + self.buff_value("Combat elixir")) * (1 + self.buff_value("Combat food"))

    def mob_need(self, mob):
        c = self.cmb
        need = c["need_base"] * c["rank_growth"] ** mob["rank"] * (1 + c["slot_growth"] * mob["slot"])
        return need * (c["boss_mult"] if mob["boss"] else 1)

    def fight(self, mob):
        c = self.cmb
        base = self.base_time("combat_time", mob["rank"], mob["slot"]) * (self.act["boss_time_mult"] if mob["boss"] else 1)
        ratio = self.mob_need(mob) / self.power_vs(mob)
        t = base * min(max(ratio, c["ratio_min"]), c["ratio_max"]) / self.speed("combat")
        death = c["death_time"] * max(0.0, ratio - c["death_ratio"])
        return max(t, self.act["min_action_time"]), base * self.act["xp_per_second"], death

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

    def do_field(self):
        if self.offline and self.offline_mode == "repeat":
            return self.run_field(self.last_field) if self.last_field else 5.0
        if self.need:
            mat = self.mat_by_name[self.need]
            prof = mat["profession"]
            if prof == "combat":
                mobs = [o for o in self.field_options("combat") if o[2]["rank"] == mat["rank"]]
                if mobs:
                    return self.feed(max(mobs, key=lambda o: o[0]))
            elif self.ranks[prof] and self.level[prof] >= mat["unlock"]:
                return self.feed(next(o for o in self.field_options(prof) if o[2]["name"] == self.need))
        todo = [p for p in FIELD if self.open(p)]
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
                self.consumables["Healing"].pop()
                death /= 2
            self.deaths += death / self.cmb["death_time"]
            return t + death
        prof = e["profession"]
        base = self.base_time("gather_time", e["rank"], e["slot"])
        self.add_xp(prof, base * self.act["xp_per_second"] * self.color_mult(prof, e["unlock"]), True)
        self.store(e["name"], self.act["gather_yield"])
        return max(base / self.speed(prof), self.act["min_action_time"])

    # ---- the Workshop --------------------------------------------------------------------
    def qty(self, recipe):
        return self.rec["reagent_qty"] * self.rec["role_qty_mult"].get(recipe["role"], 1)

    def missing(self, r):
        return next((n for n in r["reagents"] if self.stock[n] < self.qty(r) - 1e-9), None)

    def recipe_xp(self, r):
        prof = r["profession"]
        col = self.color_mult(prof, r["unlock"]) * self.rec["role_xp_mult"].get(r["role"], 1)
        t = max(self.base_time("craft_time", r["rank"], r["slot"]) / self.speed(prof), self.act["min_action_time"])
        return self.base_time("craft_time", r["rank"], r["slot"]) * self.act["xp_per_second"] * self.act["craft_xp_mult"] * col, t

    def do_workshop(self):
        if self.offline and self.offline_mode == "repeat":
            r = self.last_recipe
            if r and self.missing(r) is None:
                xp, t = self.recipe_xp(r)
                self.craft(r)
                self.add_xp(r["profession"], xp, False)
                return t
            self.idle_workshop += 5
            return 5.0
        if self.ragnaros_ready is not None:
            return self.craft_fr()
        first_missing = None
        for prof in sorted((p for p in CRAFT if self.open(p)), key=lambda p: self.level[p]):
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
                first_missing = first_missing or miss
        self.need = first_missing
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
        elif role in BUFF_ROLES and self.use_buffs and len(self.consumables[role]) < self.buff_cfg["keep"]:
            self.consumables[role].append(r["rank"])
            keep = True
        if not keep:
            self.earn(self.sell_value[r["name"]] * self.gold_cfg["crafted_sell_mult"] * (1 + self.sell_bonus), "selling crafts")

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
        if "speed" in spec:
            self.pool_speed[target] += spec["speed"]
        if "xp" in spec:
            self.pool_xp[target] += spec["xp"]
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
        if spec.get("offline"):
            self.offline_cap += BAL["offline"]["per_item_hours"] * H

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
            return t + death
        return 0.0

    # ---- main loop -----------------------------------------------------------------------
    def active_at(self, t):
        if not self.schedule:
            return True
        return (t % 86400) < self.schedule["active_hours"] * H

    def run(self, limit_h=24 * 30):
        nf = nw = 0.0
        while self.t < limit_h * H:
            if self.ragnaros_ready is None and all(self.level[p] >= 300 for p in RAGNAROS_NEEDS):
                self.ragnaros_ready = self.t
            if self.fr_finished is not None and all(self.level[p] >= 300 for p in PROFS):
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
                self.offline = self.t >= closed_at
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
            if not self.offline:
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
        spec = dict(spec)
        if name == "Longer offline time":
            spec["offline"] = True
        for i in range(spec["count"]):
            queue.append(((i + 0.5) / spec["count"], name, spec))
    queue.sort(key=lambda q: q[0])
    n = len(queue)
    return [(finish * (0.02 + 0.93 * (j + 0.5) / n), name, spec) for j, (_, name, spec) in enumerate(queue)]


def seed(speed="Normal", pool=True, **kw):
    """A seed with its full item pool, spread over its own length."""
    base = Sim(speed, **kw).run()
    if not pool:
        return base
    sim = Sim(speed, build_pool(base.ragnaros_ready or base.end), **kw).run()
    sim.no_pool = base.ragnaros_ready
    return sim


def main_report(sim, speed):
    out = [f"### {speed} speed", ""]
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
    out = ["## Offline time and play schedules", "",
           "Real days until Ragnaros is ready, for someone who opens the page this many hours a day. While "
           "closed, both slots repeat what they were doing (no new choices, no shopping) up to the offline "
           "cap; time past it becomes Rested XP. *Smart* = the game keeps choosing the next material and "
           "recipe by itself (but never shops); *repeat-only* = it just repeats the last action. Item pool "
           "spread over the real days.", "",
           "| Page open per day | Smart offline, 8 h cap | Smart offline, 24 h cap | Repeat-only offline, 8 h cap | No offline progress |",
           "| --- | --- | --- | --- | --- |"]
    for a in (24, 8, 4, 2, 1):
        sched = {"active_hours": a} if a < 24 else None
        if not sched:
            out.append(f"| 24 h | {fmt_days(seed().ragnaros_ready)} | same | same | same |")
            continue
        row = [fmt_days(seed(schedule=sched).ragnaros_ready),
               fmt_days(seed(schedule=sched, offline_items=4).ragnaros_ready),
               fmt_days(seed(schedule=sched, offline_mode="repeat").ragnaros_ready)]
        nooff = Sim("Normal", schedule=sched)
        nooff.offline_cap = 0
        row.append(fmt_days(nooff.run().ragnaros_ready))
        out.append(f"| {a} h | " + " | ".join(row) + " |")
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
        power = sim.weapon_power("Tough") + sim.armor_power(armor)
        chance = r["max_win"] * min(1, power / r["power_need"]) ** 3 * (r["fr_floor"] + (1 - r["fr_floor"]) * min(1, fr / r["fr_need"]) ** 2)
        tries = 1 / chance if chance > 0 else float("inf")
        cost = tries * r["fight_minutes"] * 60 + (tries - 1) * c["death_time"]
        return chance, cost, fr, power

    out = ["## Ragnaros", "",
           f"Win chance per attempt (fights last {r['fight_minutes']} min). Weapon: an Axe of that rank (Ragnaros is Tough). "
           "Fire Resistance pieces replace main-set armor; the rest is main-set armor of the same rank.", "",
           "| Gear rank | FR pieces | Potion + food | Fire Resistance | Power | Win chance | Expected time to win |",
           "| --- | --- | --- | --- | --- | --- | --- |"]
    for gear in (2, 3):
        for pieces in (0, 3, 5, 7):
            for cons in (False, True):
                if pieces == 0 and cons:
                    continue
                ch, cost, fr, power = win(gear, gear, pieces, cons)
                out.append(f"| {DATA['ranks'][gear]['name']} | {pieces}/7 | {'yes' if cons else 'no'} | {fr} | "
                           f"{power:.0f} | {ch:.0%} | {fmt_t(cost) if ch > 0.001 else 'never'} |")
    return "\n".join(out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--speed", default="Normal", choices=list(BAL["xp"]["game_speed"]))
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    if not a.write:
        print(main_report(seed(a.speed), a.speed))
    else:
        parts = ["# Skillup: balance simulation", "",
                 "Generated by `tools/simulate.py` from `data/balance.json` and `data/game_data.json`.",
                 "Unless a section says otherwise: page always open, each rank item arrives 30 min after it's needed, full item pool,",
                 "potions and food used automatically, no traps, no red gambles.", "",
                 "## Game speeds", ""]
        for s in BAL["xp"]["game_speed"]:
            parts += [main_report(seed(s), s), ""]
        for fn in (pool_report, buffs_report, delay_report, schedule_report, traps_report, red_report, ragnaros_report):
            parts += [fn(), ""]
        text = "\n".join(parts)
        (ROOT / "docs" / "BALANCE.md").write_text(text, encoding="utf-8")
        print(text)

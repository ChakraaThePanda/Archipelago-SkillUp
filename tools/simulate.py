"""
Balance simulator for Skillup.

Plays the game the way a typical player would, using data/game_data.json (content) and
data/balance.json (every tunable number), and reports how long everything takes.

Usage:
    python tools/simulate.py                  # Normal speed, prints the report
    python tools/simulate.py --speed Fast
    python tools/simulate.py --write          # also writes docs/BALANCE.md (all 3 speeds)

How the simulated player plays (Field and Workshop run at the same time):
- Workshop: works on the lowest-level crafting profession that has something useful to
  craft, picking the recipe with the best XP per second. If it lacks materials, it asks the
  Field for them.
- Field: first gathers whatever the Workshop is waiting on; otherwise levels the
  lowest-level Field profession (4 gathering + Combat), picking the best XP per second.
- Spends gold right away on the cheapest trainer upgrade (speed or XP).
- Ranks are assumed to arrive the moment a profession reaches its cap (best case: in a
  real seed they come from other players, and the slots switch to other work meanwhile).
- Equips the best gear, swaps weapons for mob traits, sells everything else.
- Never gambles on red. No buffs, offline time or Rested XP (pure active play).
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
CRAFT = [k for k, p in PROFS.items() if p["kind"] == "crafting"]
RAGNAROS_NEEDS = ["combat", "blacksmithing", "leatherworking", "tailoring", "alchemy", "cooking"]
ARMOR_SLOTS = {"Head", "Shoulder", "Back", "Chest", "Hands", "Legs", "Feet"}
WEAPONS = {"Dagger", "Sword", "Mace", "Axe"}
TOOL_FOR = {"Mining tool": "mining", "Skinning tool": "skinning", "Fishing tool": "fishing",
            "Herbalism tool": "herbalism"}


def fmt_t(sec: float) -> str:
    h, m = divmod(int(round(sec / 60)), 60)
    return f"{h}h{m:02d}" if h else f"{m}m"


class Sim:
    def __init__(self, speed: str = "Normal", pool: list | None = None):
        self.xpb = BAL["xp"]
        self.act = BAL["actions"]
        self.rec = BAL["recipes"]
        self.gold_cfg = BAL["gold"]
        self.cmb = BAL["combat"]
        self.game_speed = BAL["xp"]["game_speed"][speed]
        self.t = 0.0
        self.level = {k: 1 for k in PROFS}
        self.xp = {k: 0.0 for k in PROFS}
        self.speed_up = {k: 0 for k in PROFS}
        self.xp_up = {k: 0 for k in PROFS}
        self.stock = defaultdict(float)
        self.gold = 0.0
        self.gold_earned = 0.0
        self.gold_spent = 0.0
        self.earned_by = defaultdict(float)
        self.hourly = []
        self.pool = sorted(pool or [], key=lambda e: e[0])  # (time, item name, spec)
        self.pool_speed = defaultdict(float)
        self.pool_xp = defaultdict(float)
        self.storage_bonus = 0.0
        self.sell_bonus = 0.0
        self.rested = 0.0
        self.received = defaultdict(int)
        self.crafted = set()          # names crafted at least once
        self.bags = 0
        self.tools = {}               # gathering prof -> best tool rank
        self.weapons = {}             # type -> best rank
        self.armor = {}               # slot -> best rank
        self.fr_done = set()
        self.need = None              # material the Workshop is waiting for
        self.milestones = {k: {} for k in PROFS}
        self.events = []
        self.idle_workshop = 0.0
        self.field_feeding = 0.0
        self.deaths = 0.0
        self.mat_by_name = {m["name"]: m for m in DATA["materials"]}
        self.ragnaros_ready = None
        self.fr_finished = None
        self.sell_value = {e["name"]: max(self.gold_cfg["min_sell"], e["sell"] * self.gold_cfg["sell_mult"])
                           for e in DATA["materials"] + DATA["recipes"] + DATA["fire_resistance_set"]}

    # ---- leveling ----------------------------------------------------------------------
    def cap(self, prof: str) -> int:
        return 300  # ranks arrive on time in the simulation

    def color_mult(self, prof: str, unlock: int) -> float:
        gap = self.level[prof] - unlock
        if gap < 0:
            return 0.0  # red: the simulated player never gambles
        for upto, mult in self.xpb["colors"].values():
            if gap < upto:
                return mult
        return 0.0

    def xp_needed(self, level: int) -> float:
        return self.xpb["base"] * (1 + level / self.xpb["per_level"])

    def add_xp(self, prof: str, amount: float):
        amount *= self.game_speed * (1 + self.xp_up[prof] * self.gold_cfg["xp_step"] + self.pool_xp[prof])
        if self.rested > 0:
            amount *= 2
        self.xp[prof] += amount
        while self.level[prof] < 300 and self.xp[prof] >= self.xp_needed(self.level[prof]):
            self.xp[prof] -= self.xp_needed(self.level[prof])
            self.level[prof] += 1
            if self.level[prof] in RANK_CAPS:
                self.milestones[prof][self.level[prof]] = self.t
        if self.level[prof] >= 300:
            self.xp[prof] = 0

    def speed(self, prof: str) -> float:
        s = 1 + self.speed_up[prof] * self.gold_cfg["speed_step"] + self.pool_speed[prof]
        if prof in self.tools:
            s *= 1 + (self.tools[prof] + 1) * BAL["tools"]["step"]
        return s

    def base_time(self, kind: str, rank: int, slot: int) -> float:
        return self.act[kind] * self.act["rank_growth"] ** rank * (1 + self.act["slot_growth"] * slot)

    # ---- gold --------------------------------------------------------------------------
    def earn(self, copper: float, source: str = "selling materials"):
        self.gold += copper
        self.gold_earned += copper
        self.earned_by[source] += copper

    def store(self, name: str, qty: float):
        cap = BAL["storage"]["start"] * BAL["storage"]["per_bag_mult"] ** self.bags * (1 + self.storage_bonus)
        room = max(0.0, cap - self.stock[name])
        kept = min(qty, room)
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

    # ---- combat ------------------------------------------------------------------------
    def power_vs(self, mob: dict) -> float:
        c = self.cmb
        armor = sum(c["armor_power"] * c["rank_growth"] ** r for r in self.armor.values())
        best = c["fists"]
        for wtype, r in self.weapons.items():
            p = c["weapon_power"] * c["rank_growth"] ** r
            trait = mob["trait"]
            if trait and DATA["traits"][trait]["weapon"] == wtype:
                p *= c["trait_match"]
            elif trait:
                p *= c["trait_miss"]
            elif wtype == "Sword":
                p *= c["sword_bonus"]
            best = max(best, p)
        return best + armor

    def mob_need(self, mob: dict) -> float:
        c = self.cmb
        need = c["need_base"] * c["rank_growth"] ** mob["rank"] * (1 + c["slot_growth"] * mob["slot"])
        return need * (c["boss_mult"] if mob["boss"] else 1)

    def fight(self, mob: dict):
        """Returns (time, xp, death_time) for one fight."""
        c = self.cmb
        base = self.base_time("combat_time", mob["rank"], mob["slot"]) * (self.act["boss_time_mult"] if mob["boss"] else 1)
        ratio = self.mob_need(mob) / self.power_vs(mob)
        t = base * min(max(ratio, c["ratio_min"]), c["ratio_max"]) / self.speed("combat")
        death = c["death_time"] * max(0.0, ratio - c["death_ratio"])
        return max(t, self.act["min_action_time"]), base * self.act["xp_per_second"], death

    # ---- choices -----------------------------------------------------------------------
    def field_options(self, prof: str):
        """(xp_per_sec, kind, entry) for things the Field can do in this profession."""
        out = []
        if prof == "combat":
            for m in DATA["mobs"]:
                col = self.color_mult("combat", m["unlock"])
                if self.level["combat"] < m["unlock"]:
                    continue
                t, xp, death = self.fight(m)
                out.append((xp * col / (t + death), "mob", m))
        else:
            for m in DATA["materials"]:
                if m["profession"] != prof or self.level[prof] < m["unlock"]:
                    continue
                col = self.color_mult(prof, m["unlock"])
                t = max(self.base_time("gather_time", m["rank"], m["slot"]) / self.speed(prof), self.act["min_action_time"])
                xp = self.base_time("gather_time", m["rank"], m["slot"]) * self.act["xp_per_second"]
                out.append((xp * col / t, "gather", m))
        return out

    def do_field(self) -> float:
        # 1) feed the Workshop
        if self.need:
            mat = self.mat_by_name[self.need]
            prof = mat["profession"]
            if prof == "combat":
                mobs = [o for o in self.field_options("combat") if o[2]["rank"] == mat["rank"]]
                if mobs:
                    return self.field_feeding_add(self.run_field(max(mobs, key=lambda o: o[0])))
            elif self.level[prof] >= mat["unlock"]:
                opt = next(o for o in self.field_options(prof) if o[2]["name"] == self.need)
                return self.field_feeding_add(self.run_field(opt))
        # 2) level the lowest Field profession
        todo = [p for p in FIELD if self.level[p] < 300]
        if not todo:
            return 5.0
        prof = min(todo, key=lambda p: self.level[p])
        opts = [o for o in self.field_options(prof) if o[0] > 0] or self.field_options(prof)
        return self.run_field(max(opts, key=lambda o: (o[0], o[2]["slot"])))

    def field_feeding_add(self, dt: float) -> float:
        self.field_feeding += dt
        return dt

    def run_field(self, opt) -> float:
        _, kind, e = opt
        if kind == "mob":
            t, xp, death = self.fight(e)
            col = self.color_mult("combat", e["unlock"])
            self.add_xp("combat", xp * col)
            self.store(e["cloth"], self.cmb["cloth_per_kill"])
            self.earn(self.cmb["gold_per_kill"] * self.cmb["rank_growth"] ** e["rank"], "combat loot")
            self.deaths += death / self.cmb["death_time"]
            return t + death
        prof = e["profession"]
        base = self.base_time("gather_time", e["rank"], e["slot"])
        self.add_xp(prof, base * self.act["xp_per_second"] * self.color_mult(prof, e["unlock"]))
        self.store(e["name"], self.act["gather_yield"])
        return max(base / self.speed(prof), self.act["min_action_time"])

    def qty(self, recipe: dict) -> float:
        return self.rec["reagent_qty"] * self.rec["role_qty_mult"].get(recipe["role"], 1)

    def craftable(self, r: dict) -> str | None:
        """None if craftable now, else the first missing reagent."""
        for name in r["reagents"]:
            if self.stock[name] < self.qty(r) - 1e-9:
                return name
        return None

    def do_workshop(self) -> float:
        ready = self.ragnaros_ready is not None
        if ready:
            return self.craft_fr()
        todo = sorted((p for p in CRAFT if self.level[p] < 300), key=lambda p: self.level[p])
        first_missing = None
        for prof in todo:
            cands = []
            for r in DATA["recipes"]:
                if r["profession"] != prof or self.level[prof] < r["unlock"]:
                    continue
                col = self.color_mult(prof, r["unlock"]) * self.rec["role_xp_mult"].get(r["role"], 1)
                if col <= 0:
                    continue
                t = max(self.base_time("craft_time", r["rank"], r["slot"]) / self.speed(prof), self.act["min_action_time"])
                xp = self.base_time("craft_time", r["rank"], r["slot"]) * self.act["xp_per_second"] * self.act["craft_xp_mult"] * col
                cands.append((xp / t, r, t, xp))
            cands.sort(key=lambda c: -c[0])
            for _, r, t, xp in cands:
                missing = self.craftable(r)
                if missing is None:
                    self.need = None
                    self.craft(r)
                    self.add_xp(prof, xp)
                    return t
                if first_missing is None:
                    first_missing = missing
        self.need = first_missing
        self.idle_workshop += 5
        return 5.0

    def craft(self, r: dict):
        for name in r["reagents"]:
            self.stock[name] -= self.qty(r)
        first = r["name"] not in self.crafted
        self.crafted.add(r["name"])
        role = r["role"]
        keep = False
        if role in WEAPONS and self.weapons.get(role, -1) < r["rank"]:
            self.weapons[role], keep = r["rank"], True
        elif role in ARMOR_SLOTS and self.armor.get(role, -1) < r["rank"]:
            self.armor[role], keep = r["rank"], True
        elif role in TOOL_FOR and self.tools.get(TOOL_FOR[role], -1) < r["rank"]:
            self.tools[TOOL_FOR[role]], keep = r["rank"], True
        elif role == "Bag" and first:
            self.bags += 1
            keep = True
        if not keep:
            self.earn(self.sell_value[r["name"]] * self.gold_cfg["crafted_sell_mult"] * (1 + self.sell_bonus), "selling crafts")

    def craft_fr(self) -> float:
        q = self.rec["fr_qty"]
        for f in DATA["fire_resistance_set"]:
            if f["name"] in self.fr_done:
                continue
            missing = next((n for n in f["reagents"] if self.stock[n] < q), None)
            if missing:
                self.need = missing
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

    # ---- item pool ---------------------------------------------------------------------
    def receive(self, name: str, spec: dict):
        open_profs = [k for k in PROFS if self.level[k] < 300] or list(PROFS)
        target = min(open_profs, key=lambda k: self.level[k])
        top_rank = max((self.level[k] - 1) // 75 for k in PROFS)
        self.received[name] += 1
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
            self.rested += spec["rested_min"] * 60
        if "levels" in spec:
            self.add_xp(target, spec["levels"] * self.xp_needed(self.level[target]))
        if "mats" in spec and self.need:
            self.store(self.need, spec["mats"])
        elif "mats" in spec:
            gather = [k for k in FIELD if k != "combat" and self.level[k] < 300] or ["mining"]
            prof = min(gather, key=lambda k: self.level[k])
            rank = min(3, (self.level[prof] - 1) // 75)
            mats = [m for m in DATA["materials"] if m["profession"] == prof and m["rank"] == rank]
            self.store(mats[self.received[name] % len(mats)]["name"], spec["mats"])

    # ---- main loop ---------------------------------------------------------------------
    def run(self, limit_h: float = 60):
        next_field = next_work = 0.0
        while self.t < limit_h * 3600:
            if self.ragnaros_ready is None and all(self.level[p] >= 300 for p in RAGNAROS_NEEDS):
                self.ragnaros_ready = self.t
            if self.fr_finished is not None and all(self.level[p] >= 300 for p in PROFS):
                break
            while self.pool and self.pool[0][0] <= self.t:
                self.receive(*self.pool.pop(0)[1:])
            if next_field <= next_work:
                self.t = next_field
                dt = self.do_field()
                next_field += dt
                self.rested = max(0.0, self.rested - dt)
            else:
                self.t = next_work
                next_work += self.do_workshop()
            self.buy_upgrades()
            if self.t >= len(self.hourly) * 3600:
                n = len(PROFS)
                self.hourly.append((sum(self.speed_up.values()) / n, sum(self.xp_up.values()) / n, self.gold))
        self.end = self.t
        return self


def build_pool(finish: float, only: set | None = None) -> list:
    """Spread the pool's items evenly between 2% and 95% of a seed, interleaving kinds."""
    cfg = BAL["pool"]
    kinds = {**cfg["useful"], **cfg["filler"]}
    queue = []
    for name, spec in kinds.items():
        if only is not None and name not in only:
            continue
        for i in range(spec["count"]):
            queue.append(((i + 0.5) / spec["count"], name, spec))
    queue.sort(key=lambda q: q[0])
    n = len(queue)
    return [(finish * (0.02 + 0.93 * (j + 0.5) / n), name, spec) for j, (_, name, spec) in enumerate(queue)]


def with_pool(speed: str) -> "Sim":
    """A seed with its full item pool (what players actually get)."""
    base = Sim(speed).run()
    sim = Sim(speed, build_pool(base.ragnaros_ready)).run()
    sim.no_pool = base.ragnaros_ready
    return sim


def pool_report(speed: str) -> str:
    t0 = Sim(speed).run().ragnaros_ready
    full = Sim(speed, build_pool(t0)).run().ragnaros_ready
    cfg = BAL["pool"]
    out = [f"### Item pool impact ({speed} speed)", "",
           f"Without the pool: {fmt_t(t0)}. With every pool item: **{fmt_t(full)}** "
           f"({(1 - full / t0) * 100:.0f}% faster).", "",
           "| Item | Count | Time saved by all copies | Per copy |", "| --- | --- | --- | --- |"]
    for group in ("useful", "filler"):
        for name, spec in cfg[group].items():
            t = Sim(speed, build_pool(t0, {name})).run().ragnaros_ready
            saved = t0 - t
            out.append(f"| {name} ({group}) | {spec['count']} | {fmt_t(saved) if saved > 30 else '~0'} | "
                       f"{saved / spec['count'] / 60:.1f} min |")
    return "\n".join(out)


def report(sim: Sim, speed: str) -> str:
    out = [f"### {speed} speed (with the item pool)", ""]
    out.append(f"- **Ragnaros requirements met** (Artisan 300 in {', '.join(PROFS[p]['name'] for p in RAGNAROS_NEEDS)}): "
               f"**{fmt_t(sim.ragnaros_ready) if sim.ragnaros_ready else 'not reached'}**")
    if getattr(sim, "no_pool", None):
        out.append(f"- Same seed without any pool items: {fmt_t(sim.no_pool)}")
    out.append(f"- **Fire Resistance set finished:** {fmt_t(sim.fr_finished) if sim.fr_finished else 'not reached'}")
    out.append(f"- Everything at 300: {fmt_t(sim.end)}")
    out.append(f"- Workshop idle (waiting for materials): {fmt_t(sim.idle_workshop)}; "
               f"Field time spent fetching materials for it: {fmt_t(sim.field_feeding)}")
    out.append(f"- Gold earned {sim.gold_earned / 10000:.1f}g, spent {sim.gold_spent / 10000:.1f}g; "
               f"expected deaths {sim.deaths:.0f}")
    out.append("- Gold by source: " + ", ".join(f"{k} {v / 10000:.1f}g" for k, v in sim.earned_by.items()))
    out.append("- Average trainer upgrades bought per profession, hour by hour (speed / XP, out of "
               f"{BAL['gold']['steps']}): " + ", ".join(f"{h}h {a:.1f}/{b:.1f}" for h, (a, b, _) in enumerate(sim.hourly)))
    out += ["", "| Profession | 75 | 150 | 225 | 300 | Speed upgrades | XP upgrades |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for k, p in PROFS.items():
        ms = sim.milestones[k]
        out.append(f"| {p['name']} | " + " | ".join(fmt_t(ms[c]) if c in ms else "-" for c in RANK_CAPS)
                   + f" | {sim.speed_up[k]} | {sim.xp_up[k]} |")
    return "\n".join(out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--speed", default="Normal", choices=list(BAL["xp"]["game_speed"]))
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    if a.write:
        parts = ["# Skillup: balance simulation", "",
                 "Generated by `tools/simulate.py` from `data/balance.json`. Times are game time of active",
                 "play (Field and Workshop running together), assuming ranks arrive on time, with the",
                 "item pool spread evenly over the seed.", ""]
        for s in BAL["xp"]["game_speed"]:
            parts += [report(with_pool(s), s), ""]
        parts += [pool_report("Normal"), ""]
        (ROOT / "docs" / "BALANCE.md").write_text("\n".join(parts), encoding="utf-8")
        print("\n".join(parts))
    else:
        print(report(with_pool(a.speed), a.speed))
        print()
        print(pool_report(a.speed))

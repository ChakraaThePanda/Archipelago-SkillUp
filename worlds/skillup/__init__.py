from __future__ import annotations

from typing import Any

from BaseClasses import Item, ItemClassification, Location, Region, Tutorial
from worlds.AutoWorld import WebWorld, World

from .data import (
    FILLER, GAME, GATHERING, ITEM_NAME_TO_ID, LOCATION_NAME_TO_ID, MOLTEN_CORE, PROF, PROFESSIONS, RANKS,
    STARTING_PAIRS, THINGS, TRAPS, USEFUL, VICTORY_MASTERY, VICTORY_RAGNAROS, milestone,
)
from .Options import CombatAccess, Goal, SkillupOptions, StartingPair
from .Rules import SkillupLogic


class SkillupItem(Item):
    game = GAME


class SkillupLocation(Location):
    game = GAME


class SkillupWeb(WebWorld):
    tutorials = [Tutorial(
        "Multiworld Setup Guide",
        "How to play Skillup in your browser with Archipelago.",
        "English",
        "setup_en.md",
        "setup/en",
        ["Chakraa"],
    )]
    theme = "partyTime"


class SkillupWorld(World):
    """An idle game of Classic World of Warcraft professions, played in your browser. Gather,
    craft and fight to level 11 professions; every profession rank is an item somewhere in the
    multiworld, and every first gather, first craft, first kill and rank reached sends a check."""

    game = GAME
    author: str = "Chakraa"
    web = SkillupWeb()
    options_dataclass = SkillupOptions
    options: SkillupOptions

    item_name_to_id = ITEM_NAME_TO_ID
    location_name_to_id = LOCATION_NAME_TO_ID
    item_name_groups = {
        "Ranks": {p.item for p in PROFESSIONS},
        "Gathering": {p.item for p in GATHERING},
        "Traps": set(TRAPS),
    }
    location_name_groups = {
        p.name: {t.location for t in THINGS if t.profession == p.key} | {milestone(p, r) for r in range(len(RANKS))}
        for p in PROFESSIONS
    }

    starting: list[str]  # professions you start with at Apprentice

    def generate_early(self) -> None:
        pairs = list(STARTING_PAIRS)
        if self.options.starting_pair != StartingPair.option_random:
            first = pairs[self.options.starting_pair.value - 1]
        else:
            first = self.random.choice(pairs)
        others = [g for g in pairs if g != first]
        chosen = [first] + self.random.sample(others, self.options.starting_pairs_count.value - 1)
        self.starting = [p for g in chosen for p in (g, STARTING_PAIRS[g])]
        if self.options.combat_access == CombatAccess.option_start_with_it:
            self.starting.append("combat")
        elif self.options.combat_access == CombatAccess.option_early:
            self.multiworld.early_items[self.player][PROF["combat"].item] = 1

    # ---- items ------------------------------------------------------------------------------
    def create_item(self, name: str) -> SkillupItem:
        if name.startswith("Progressive ") or name == MOLTEN_CORE:
            cls = ItemClassification.progression
        elif name in USEFUL:
            cls = ItemClassification.useful
        elif name in TRAPS:
            cls = ItemClassification.trap
        else:
            cls = ItemClassification.filler
        return SkillupItem(name, cls, ITEM_NAME_TO_ID[name], self.player)

    def get_filler_item_name(self) -> str:
        o = self.options
        if self.random.random() * 100 < o.trap_chance.value:
            weights = [o.resurrection_sickness_weight.value, o.repair_bill_weight.value,
                       o.broken_tool_weight.value, o.murloc_ambush_weight.value]
            if sum(weights):
                return self.random.choices(TRAPS, weights)[0]
        return self.random.choices(list(FILLER), list(FILLER.values()))[0]

    def create_items(self) -> None:
        pool: list[Item] = []
        for p in PROFESSIONS:
            copies = len(RANKS)
            if p.key in self.starting:
                self.multiworld.push_precollected(self.create_item(p.item))
                copies -= 1
            pool += [self.create_item(p.item) for _ in range(copies)]
        if self.options.goal != Goal.option_master_professions:
            pool.append(self.create_item(MOLTEN_CORE))
        for name, count in USEFUL.items():
            pool += [self.create_item(name) for _ in range(count)]
        open_slots = len(self.multiworld.get_unfilled_locations(self.player)) - len(pool)
        pool += [self.create_filler() for _ in range(open_slots)]
        self.multiworld.itempool += pool

    # ---- locations and rules ----------------------------------------------------------------
    def create_regions(self) -> None:
        logic = SkillupLogic(self.player)
        menu = Region("Menu", self.player, self.multiworld)
        self.multiworld.regions.append(menu)

        def add(name: str, rule) -> None:
            loc = SkillupLocation(self.player, name, LOCATION_NAME_TO_ID[name], menu)
            loc.access_rule = rule
            menu.locations.append(loc)

        for t in THINGS:
            add(t.location, lambda state, t=t: logic.thing(state, t))
        for p in PROFESSIONS:
            for r in range(len(RANKS)):
                add(milestone(p, r), lambda state, p=p.key, r=r: logic.reach_cap(state, p, r))

        goal = self.options.goal
        events = []
        if goal != Goal.option_master_professions:
            events.append((VICTORY_RAGNAROS, logic.ragnaros))
        if goal != Goal.option_ragnaros:
            need = self.options.professions_to_master.value
            events.append((VICTORY_MASTERY, lambda state: logic.mastered(state, need)))
        for name, rule in events:
            loc = SkillupLocation(self.player, name, None, menu)
            loc.access_rule = rule
            loc.place_locked_item(SkillupItem(name, ItemClassification.progression, None, self.player))
            menu.locations.append(loc)
        names = [n for n, _ in events]
        self.multiworld.completion_condition[self.player] = lambda state: all(state.has(n, self.player) for n in names)

    def fill_slot_data(self) -> dict[str, Any]:
        o = self.options
        return {
            "goal": o.goal.current_key,
            "professions_to_master": o.professions_to_master.value,
            "game_speed": o.game_speed.current_key,
            "starting_professions": self.starting,
            "combat_access": o.combat_access.current_key,
            "death_link": bool(o.death_link.value),
        }

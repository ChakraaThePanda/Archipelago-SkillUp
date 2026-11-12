from typing import Any

from BaseClasses import Item, ItemClassification, Location, Region, Tutorial
from worlds.AutoWorld import WebWorld, World

from .data import (
    BAG_UPGRADES_IN_POOL, CRAFTING, FILLER_ITEMS, GATHERING, ITEM_NAME_TO_ID, LOCATION_NAME_TO_ID,
    MAX_LEVEL, PROFESSIONS, TIERS, USEFUL_ITEMS, VICTORY_ITEM, VICTORY_LOCATION, Profession,
    location_name, tier_for_level,
)
from .Options import SkillupOptions

GAME = "Skillup"


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


def can_reach_tier(state, player: int, prof: Profession, tier: int) -> bool:
    """Tier `tier` of `prof` is usable: you have that many copies of its Progressive item and,
    for a crafting profession, the same tier of the gathering profession that feeds it."""
    if not state.has(prof.item, player, tier):
        return False
    if prof.source is not None:
        return state.has(f"Progressive {prof.source}", player, tier)
    return True


class SkillupWorld(World):
    """A browser idle game about leveling gathering and crafting professions. Every
    profession tier (Copper, then Tin, then Iron...) is a Progressive item, and reaching
    levels in a profession sends checks."""

    game = GAME
    author: str = "Chakraa"
    web = SkillupWeb()

    options_dataclass = SkillupOptions
    options: SkillupOptions

    item_name_to_id = ITEM_NAME_TO_ID
    location_name_to_id = LOCATION_NAME_TO_ID
    item_name_groups = {
        "Gathering": {p.item for p in GATHERING},
        "Crafting": {p.item for p in CRAFTING},
    }

    starting_professions: list[str]

    def check_levels(self) -> list[int]:
        interval = self.options.check_interval.value
        levels = list(range(interval, MAX_LEVEL + 1, interval))
        if levels[-1] != MAX_LEVEL:
            levels.append(MAX_LEVEL)
        return levels

    def generate_early(self) -> None:
        count = self.options.starting_professions.value
        self.starting_professions = [p.name for p in self.random.sample(GATHERING, count)]

    def create_item(self, name: str) -> SkillupItem:
        if name.startswith("Progressive "):
            classification = ItemClassification.progression
        elif name in USEFUL_ITEMS:
            classification = ItemClassification.useful
        else:
            classification = ItemClassification.filler
        return SkillupItem(name, classification, ITEM_NAME_TO_ID[name], self.player)

    def get_filler_item_name(self) -> str:
        return self.random.choice(list(FILLER_ITEMS))

    def create_regions(self) -> None:
        menu = Region("Menu", self.player, self.multiworld)
        self.multiworld.regions.append(menu)
        for prof in PROFESSIONS:
            for level in self.check_levels():
                name = location_name(prof.name, level)
                loc = SkillupLocation(self.player, name, LOCATION_NAME_TO_ID[name], menu)
                tier = tier_for_level(level)
                loc.access_rule = lambda state, p=prof, t=tier: can_reach_tier(state, self.player, p, t)
                menu.locations.append(loc)

        victory = SkillupLocation(self.player, VICTORY_LOCATION, None, menu)
        victory.place_locked_item(
            SkillupItem(VICTORY_ITEM, ItemClassification.progression, None, self.player))
        goal = self.options.professions_to_max.value
        victory.access_rule = lambda state: sum(
            can_reach_tier(state, self.player, p, TIERS) for p in PROFESSIONS) >= goal
        menu.locations.append(victory)

    def create_items(self) -> None:
        pool: list[Item] = []
        for prof in PROFESSIONS:
            copies = TIERS
            if prof.name in self.starting_professions:
                self.multiworld.push_precollected(self.create_item(prof.item))
                copies -= 1
            pool += [self.create_item(prof.item) for _ in range(copies)]

        total = len(self.multiworld.get_unfilled_locations(self.player))
        bags = min(BAG_UPGRADES_IN_POOL, max(0, total - len(pool)))
        pool += [self.create_item("Bag Upgrade") for _ in range(bags)]
        pool += [self.create_filler() for _ in range(total - len(pool))]
        self.multiworld.itempool += pool

    def set_rules(self) -> None:
        self.multiworld.completion_condition[self.player] = lambda state: state.has(VICTORY_ITEM, self.player)

    def fill_slot_data(self) -> dict[str, Any]:
        return {
            "check_interval": self.options.check_interval.value,
            "professions_to_max": self.options.professions_to_max.value,
            "experience_rate": self.options.experience_rate.value,
            "starting_professions": self.starting_professions,
        }

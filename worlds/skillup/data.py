"""
Static game data shared by every part of the world.

The browser game (Skillup.html) has its own copy of the profession list, tier count
and level math. It never hardcodes item or location IDs though: it looks them up by name
from the server's data package, so only the *names* below have to stay in sync with the JS.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

BASE_ID = 47_110_000

TIERS = 6
LEVELS_PER_TIER = 50
MAX_LEVEL = TIERS * LEVELS_PER_TIER  # 300


@dataclass(frozen=True)
class Profession:
    name: str
    index: int
    source: str | None = None  # crafting professions need this gathering profession's materials

    @property
    def gathering(self) -> bool:
        return self.source is None

    @property
    def item(self) -> str:
        return f"Progressive {self.name}"


_P = Profession
PROFESSIONS: list[Profession] = [
    _P("Mining", 0),
    _P("Herbalism", 1),
    _P("Skinning", 2),
    _P("Fishing", 3),
    _P("Blacksmithing", 4, "Mining"),
    _P("Jewelcrafting", 5, "Mining"),
    _P("Alchemy", 6, "Herbalism"),
    _P("Inscription", 7, "Herbalism"),
    _P("Leatherworking", 8, "Skinning"),
    _P("Cooking", 9, "Fishing"),
]
PROFESSION_BY_NAME = {p.name: p for p in PROFESSIONS}
GATHERING = [p for p in PROFESSIONS if p.gathering]
CRAFTING = [p for p in PROFESSIONS if not p.gathering]


def tier_for_level(level: int) -> int:
    """Tier you need unlocked to be able to *reach* this level.

    In game, tier-t content only gives XP while your level is below t * 50, so reaching
    level 50 needs tier 1, level 51 needs tier 2, ... level 300 needs tier 6."""
    return max(1, math.ceil(level / LEVELS_PER_TIER))


def location_name(prof: str, level: int) -> str:
    return f"{prof} Level {level}"


# Every level of every profession has a fixed ID, whatever check_interval a slot picked, so
# the data package is the same for every seed.
LOCATION_NAME_TO_ID: dict[str, int] = {
    location_name(p.name, lvl): BASE_ID + 1000 + p.index * 1000 + lvl
    for p in PROFESSIONS
    for lvl in range(1, MAX_LEVEL + 1)
}

# name -> (id offset, copies placed in the pool or None for "fills the rest")
USEFUL_ITEMS = {
    "Bag Upgrade": 100,
}
FILLER_ITEMS = {
    "Pouch of Gold": 110,
    "Elixir of Insight": 111,
    "Swiftness Potion": 112,
    "Crate of Materials": 113,
}
BAG_UPGRADES_IN_POOL = 10

ITEM_NAME_TO_ID: dict[str, int] = {p.item: BASE_ID + p.index for p in PROFESSIONS}
ITEM_NAME_TO_ID.update({name: BASE_ID + off for name, off in USEFUL_ITEMS.items()})
ITEM_NAME_TO_ID.update({name: BASE_ID + off for name, off in FILLER_ITEMS.items()})

VICTORY_LOCATION = "Grand Master of Tradeskills"
VICTORY_ITEM = "Victory"

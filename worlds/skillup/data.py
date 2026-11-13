"""
Static game data for the world, loaded from data.json (built by tools/build_game_data.py from
the same source the browser game uses), plus every item and location name and ID.

IDs never depend on options, so the data package is the same for every seed.
"""
from __future__ import annotations

import json
import pkgutil
from dataclasses import dataclass

_DATA = json.loads(pkgutil.get_data(__name__, "data.json").decode("utf-8"))

BASE_ID = 47_110_000
GAME = "Skillup"

RANKS: list[str] = [r["name"] for r in _DATA["ranks"]]          # Apprentice ... Artisan
RANK_CAPS: list[int] = [r["cap"] for r in _DATA["ranks"]]       # 75, 150, 225, 300


@dataclass(frozen=True)
class Profession:
    key: str
    name: str
    kind: str            # gathering | combat | crafting
    title: str           # "Miner", for the "<Rank> <Title>" milestone checks
    source: str | None   # profession whose materials a crafting profession uses
    index: int

    @property
    def item(self) -> str:
        return f"Progressive {self.name}"


PROFESSIONS: list[Profession] = [
    Profession(p["key"], p["name"], p["kind"], p["title"], p["source"], i) for i, p in enumerate(_DATA["professions"])
]
PROF = {p.key: p for p in PROFESSIONS}
GATHERING = [p for p in PROFESSIONS if p.kind == "gathering"]
CRAFTING = [p for p in PROFESSIONS if p.kind == "crafting"]

# Combat gear: Leatherworking and Tailoring make the 7 armor pieces; Ragnaros also needs these.
ARMOR_PROFS = ("leatherworking", "tailoring")
RAGNAROS_CRAFTS = ("blacksmithing", "leatherworking", "tailoring", "alchemy", "cooking")

STARTING_PAIRS = {
    "mining": "blacksmithing",
    "herbalism": "alchemy",
    "skinning": "leatherworking",
    "fishing": "cooking",
}


@dataclass(frozen=True)
class Thing:
    """Something that sends a check the first time: a material gathered, a creature killed,
    or a recipe crafted. Four per rank per profession."""
    profession: str
    name: str
    rank: int          # 0..3
    slot: int          # 0..3, unlock order inside the rank
    boss: bool = False

    @property
    def location(self) -> str:
        return f"{PROF[self.profession].name}: {self.name}"


THINGS: list[Thing] = (
    [Thing(m["profession"], m["name"], m["rank"], m["slot"]) for m in _DATA["materials"] if m["slot"] is not None]
    + [Thing("combat", m["name"], m["rank"], m["slot"], m["boss"]) for m in _DATA["mobs"]]
    + [Thing(r["profession"], r["name"], r["rank"], r["slot"]) for r in _DATA["recipes"]]
)


def milestone(prof: Profession, rank: int) -> str:
    """Reaching a rank's cap, named like WoW's achievements: "Journeyman Alchemist" at 150."""
    return f"{RANKS[rank]} {prof.title}"


# ---- names and IDs ------------------------------------------------------------------------
LOCATION_NAME_TO_ID: dict[str, int] = {}
for t in THINGS:
    LOCATION_NAME_TO_ID[t.location] = BASE_ID + 1000 + PROF[t.profession].index * 100 + t.rank * 10 + t.slot
for p in PROFESSIONS:
    for r in range(len(RANKS)):
        LOCATION_NAME_TO_ID[milestone(p, r)] = BASE_ID + 1000 + p.index * 100 + r * 10 + 9
assert len(LOCATION_NAME_TO_ID) == len(THINGS) + len(PROFESSIONS) * len(RANKS) == 220

MOLTEN_CORE = "Molten Core"
USEFUL = {  # name -> copies in the pool
    "Speed Upgrade": 22,     # a free Shop Speed level for the profession with the fewest
    "XP Upgrade": 22,        # a free Shop XP level for the profession with the fewest
    "Bag Upgrade": 8,        # +15% bag space per material
    "Better Prices": 3,      # +10% sell prices
}
FILLER = {  # name -> weight
    "Coin Pouch": 60,
    "Rested XP": 25,
    "Tome of Experience": 35,
}
TRAPS = ["Resurrection Sickness", "Repair Bill", "Broken Tool", "Murloc Ambush"]

ITEM_NAME_TO_ID: dict[str, int] = {p.item: BASE_ID + 1 + p.index for p in PROFESSIONS}
ITEM_NAME_TO_ID[MOLTEN_CORE] = BASE_ID + 20
ITEM_NAME_TO_ID.update({n: BASE_ID + 30 + i for i, n in enumerate(USEFUL)})
ITEM_NAME_TO_ID.update({n: BASE_ID + 40 + i for i, n in enumerate(FILLER)})
ITEM_NAME_TO_ID.update({n: BASE_ID + 50 + i for i, n in enumerate(TRAPS)})

VICTORY_RAGNAROS = "Defeat Ragnaros"
VICTORY_MASTERY = "Master Your Professions"

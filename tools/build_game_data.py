"""
Builds data/game_data.json (the one source of game content for the browser game and the
apworld) and docs/DATA.md (a review page with icons), from the spec below.

The spec only holds names and design choices. Item IDs, icons, quality and vendor sell
prices are looked up on Wowhead Classic, so they can't be mistyped. Lookups are cached in
tools/.wowhead_cache/ (gitignored).

Usage:
    python tools/build_game_data.py

Quantities, times, XP and stats are NOT here yet: the balance simulator sets those.
"""
from __future__ import annotations

import json
import pathlib
import re
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools" / ".wowhead_cache"
OUT_JSON = ROOT / "data" / "game_data.json"
OUT_MD = ROOT / "docs" / "DATA.md"
ICON_URL = "https://wow.zamimg.com/images/wow/icons/large/{}.jpg"
NPC_IMG_URL = "https://wow.zamimg.com/modelviewer/classic/webthumbs/npc/{}/{}.png"

RANKS = ["Apprentice", "Journeyman", "Expert", "Artisan"]
RANK_START = [1, 75, 150, 225]
RANK_CAP = [75, 150, 225, 300]
UNLOCK_OFFSETS = [0, 20, 40, 55]  # the 4 things inside a rank unlock at rank start + these

# ---------------------------------------------------------------------------------------
# Spec
# ---------------------------------------------------------------------------------------

PROFESSIONS = [
    # key, name, kind, title (for "<Rank> <Title>" checks), icon, feeds from
    ("mining", "Mining", "gathering", "Miner", "trade_mining", None),
    ("herbalism", "Herbalism", "gathering", "Herbalist", "trade_herbalism", None),
    ("skinning", "Skinning", "gathering", "Skinner", "inv_misc_pelt_wolf_01", None),
    ("fishing", "Fishing", "gathering", "Fisherman", "trade_fishing", None),
    ("combat", "Combat", "combat", "Fighter", "ability_dualwield", None),
    ("blacksmithing", "Blacksmithing", "crafting", "Blacksmith", "trade_blacksmithing", "mining"),
    ("leatherworking", "Leatherworking", "crafting", "Leatherworker", "trade_leatherworking", "skinning"),
    ("tailoring", "Tailoring", "crafting", "Tailor", "trade_tailoring", "combat"),
    ("engineering", "Engineering", "crafting", "Engineer", "trade_engineering", "mining"),
    ("alchemy", "Alchemy", "crafting", "Alchemist", "trade_alchemy", "herbalism"),
    ("cooking", "Cooking", "crafting", "Cook", "inv_misc_food_15", "fishing"),
]

# Gathered materials, 4 per rank in unlock order. Cloth comes from Combat (every creature).
GATHERED = {
    "mining": [
        ["Copper Ore", "Tin Ore", "Rough Stone", "Malachite"],
        ["Iron Ore", "Silver Ore", "Heavy Stone", "Jade"],
        ["Mithril Ore", "Gold Ore", "Solid Stone", "Citrine"],
        ["Thorium Ore", "Truesilver Ore", "Dense Stone", "Star Ruby"],
    ],
    "herbalism": [
        ["Peacebloom", "Silverleaf", "Earthroot", "Mageroyal"],
        ["Briarthorn", "Bruiseweed", "Wild Steelbloom", "Kingsblood"],
        ["Fadeleaf", "Goldthorn", "Khadgar's Whisker", "Purple Lotus"],
        ["Sungrass", "Dreamfoil", "Mountain Silversage", "Black Lotus"],
    ],
    "skinning": [
        ["Ruined Leather Scraps", "Light Leather", "Light Hide", "Thin Kodo Leather"],
        ["Medium Leather", "Medium Hide", "Heavy Leather", "Heavy Hide"],
        ["Thick Leather", "Thick Hide", "Turtle Scale", "Scorpid Scale"],
        ["Rugged Leather", "Rugged Hide", "Devilsaur Leather", "Black Dragonscale"],
    ],
    "fishing": [
        ["Raw Brilliant Smallfish", "Raw Slitherskin Mackerel", "Raw Longjaw Mud Snapper", "Raw Loch Frenzy"],
        ["Raw Bristle Whisker Catfish", "Raw Rainbow Fin Albacore", "Raw Sagefish", "Firefin Snapper"],
        ["Raw Rockscale Cod", "Raw Mithril Head Trout", "Raw Spotted Yellowtail", "Raw Redgill"],
        ["Raw Nightfin Snapper", "Raw Sunscale Salmon", "Raw Whitescale Salmon", "Raw Glossy Mightfish"],
    ],
}
CLOTH = ["Linen Cloth", "Silk Cloth", "Mageweave Cloth", "Runecloth"]

# Combat: 3 mobs + elite boss per zone, unlock order by real level. (npc id, display id)
ZONES = [
    ("Elwynn Forest", [
        ("Kobold Vermin", 6, 10913, "1-2", None, None),
        ("Murloc Forager", 46, 441, "9-10", None, None),
        ("Prowler", 118, 11415, "9-10", None, None),
        ("Hogger", 448, 384, "11", "Elite", "Tough"),
    ]),
    ("Duskwood", [
        ("Skeletal Warrior", 48, 200, "21-22", None, "Armored"),
        ("Rotted One", 948, 137, "25-26", None, None),
        ("Nightbane Dark Runner", 205, 736, "28-29", None, None),
        ("Stitches", 412, 1693, "35", "Elite", "Tough"),
    ]),
    ("Stranglethorn Vale", [
        ("Mistvale Gorilla", 1108, 843, "32-33", None, None),
        ("Shadowmaw Panther", 684, 633, "37-38", None, "Evasive"),
        ("Bloodsail Swashbuckler", 1563, 796, "42-43", None, None),
        ("King Bangalash", 731, 616, "43", "Elite", "Tough"),
    ]),
    ("Un'Goro Crater", [
        ("Ravasaur Runner", 6506, 5290, "49-50", None, None),
        ("Frenzied Pterrordax", 9167, 8412, "52-54", None, "Evasive"),
        ("Thunderstomp Stegodon", 6504, 5289, "54-55", "Elite", "Armored"),
        ("King Mosh", 6584, 5305, "60", "Rare Elite", "Tough"),
    ]),
]
TRAITS = {
    "Tough": ("Axe", "Huge health. Axes crit harder and chew through it."),
    "Armored": ("Mace", "Heavy armor. Crushing mace blows ignore it."),
    "Evasive": ("Dagger", "Hard to hit. Fast dagger strikes land more often."),
}
RAGNAROS = ("Ragnaros", 11502)

# Crafting recipes per rank, in unlock order. Reagents use material slots of the source
# profession's rank: m1..m4 (unlock order). A recipe only uses materials unlocked no later
# than itself, so recipe 1 is craftable right at rank start. "role" drives the game effect.
# Quantities come from the simulator.
RECIPES = {
    "blacksmithing": {
        "roles": ["Dagger", "Sword", "Axe", "Mace"],
        "reagents": [["m1"], ["m1", "m2"], ["m1", "m3"], ["m1", "m3", "m4"]],
        "items": [
            ["Copper Dagger", "Copper Shortsword", "Copper Axe", "Copper Mace"],
            ["Big Bronze Knife", "Hardened Iron Shortsword", "Bronze Axe", "Mighty Iron Hammer"],
            ["Searing Golden Blade", "Wicked Mithril Blade", "Heavy Mithril Axe", "Runed Mithril Hammer"],
            ["Heartseeker", "Blazing Rapier", "Annihilator", "Masterwork Stormhammer"],
        ],
    },
    "engineering": {
        "roles": ["Mining tool", "Skinning tool", "Fishing tool", "Herbalism tool"],
        "reagents": [["m1"], ["m1", "m2"], ["m2", "m3"], ["m3", "m4"]],
        "items": [
            ["Mining Pick", "Skinning Knife", "Fishing Pole", "Herbalist's Gloves"],
            ["Arclight Spanner", "Harpy Skinner", "Strong Fishing Pole", "Flying Tiger Goggles"],
            ["Goblin Mining Helmet", "Zulian Slicer", "Big Iron Fishing Pole", "Green Tinted Goggles"],
            ["Thorium Grenade", "Pip's Skinner", "Arcanite Fishing Pole", "Deepdive Helmet"],
        ],
    },
    "leatherworking": {
        "roles": ["Feet", "Hands", "Legs", "Chest"],
        "reagents": [["m1"], ["m1", "m2"], ["m2", "m3"], ["m2", "m3", "m4"]],
        "items": [
            ["Embossed Leather Boots", "Embossed Leather Gloves", "Embossed Leather Pants", "Embossed Leather Vest"],
            ["Dark Leather Boots", "Dark Leather Gloves", "Dark Leather Pants", "Dark Leather Tunic"],
            ["Nightscape Boots", "Turtle Scale Gloves", "Turtle Scale Leggings", "Turtle Scale Breastplate"],
            ["Black Dragonscale Boots", "Devilsaur Gauntlets", "Devilsaur Leggings", "Black Dragonscale Breastplate"],
        ],
    },
    "tailoring": {
        "roles": ["Back", "Bag", "Shoulder", "Head"],
        "reagents": [["cloth"], ["cloth"], ["cloth"], ["cloth"]],
        "items": [
            ["Linen Cloak", "Linen Bag", "Double-stitched Woolen Shoulders", "Azure Silk Hood"],
            ["Crimson Silk Cloak", "Small Silk Pack", "Crimson Silk Shoulders", "Shadow Hood"],
            ["Cindercloth Cloak", "Mageweave Bag", "Black Mageweave Shoulders", "Black Mageweave Headband"],
            ["Runecloth Cloak", "Runecloth Bag", "Runecloth Shoulders", "Runecloth Headband"],
        ],
        # Classic had no crafted item of the right cloth for these; the closest real one is used.
        "stand_ins": {"Double-stitched Woolen Shoulders", "Azure Silk Hood", "Shadow Hood", "Cindercloth Cloak"},
    },
    "alchemy": {
        "roles": ["Healing", "Combat elixir", "Gathering speed", "Crafting speed"],
        "reagents": [["m1"], ["m1", "m2"], ["m2", "m3"], ["m3", "m4"]],
        "items": [
            ["Minor Healing Potion", "Elixir of Lion's Strength", "Swiftness Potion", "Elixir of Wisdom"],
            ["Healing Potion", "Elixir of Ogre's Strength", "Free Action Potion", "Elixir of Greater Intellect"],
            ["Superior Healing Potion", "Elixir of Giants", "Elixir of Agility", "Mageblood Potion"],
            ["Major Healing Potion", "Elixir of the Mongoose", "Living Action Potion", "Elixir of the Sages"],
        ],
    },
    "cooking": {
        "roles": ["XP food (Field)", "Combat food", "XP food (Workshop)", "Combat food"],
        "reagents": [["m1"], ["m2"], ["m3"], ["m4"]],
        "items": [
            ["Brilliant Smallfish", "Slitherskin Mackerel", "Longjaw Mud Snapper", "Loch Frenzy Delight"],
            ["Bristle Whisker Catfish", "Rainbow Fin Albacore", "Smoked Sagefish", "Sagefish Delight"],
            ["Rockscale Cod", "Mithril Head Trout", "Spotted Yellowtail", "Filet of Redgill"],
            ["Nightfin Soup", "Poached Sunscale Salmon", "Baked Salmon", "Cooked Glossy Mightfish"],
        ],
        # Firefin Snapper (Journeyman Fishing) is an Alchemy reagent, so this dish uses
        # Sagefish and Albacore instead of a 4th fish.
        "overrides": {(1, 3): ["Raw Sagefish", "Raw Rainbow Fin Albacore"]},
    },
}

# Fire Resistance set for Ragnaros: real Classic fire resistance gear. Not checks.
# Unlocks with the Artisan rank's last tier (+55) of its profession.
FR_SET = [
    ("leatherworking", "Head", "Molten Helm", ["Rugged Leather", "Black Dragonscale", "Star Ruby"]),
    ("leatherworking", "Chest", "Volcanic Breastplate", ["Rugged Leather", "Black Dragonscale", "Star Ruby"]),
    ("leatherworking", "Legs", "Volcanic Leggings", ["Rugged Leather", "Black Dragonscale", "Star Ruby"]),
    ("leatherworking", "Feet", "Corehound Boots", ["Rugged Leather", "Devilsaur Leather", "Star Ruby"]),
    ("tailoring", "Back", "Cloak of Fire", ["Runecloth", "Star Ruby"]),
    ("tailoring", "Shoulder", "Flarecore Mantle", ["Runecloth", "Star Ruby"]),
    ("tailoring", "Hands", "Flarecore Gloves", ["Runecloth", "Star Ruby"]),
    ("alchemy", "Potion", "Greater Fire Protection Potion", ["Dreamfoil", "Firefin Snapper"]),
    ("cooking", "Food", "Dragonbreath Chili", ["Raw Glossy Mightfish", "Sungrass"]),
]

UI_ICONS = {
    "slot_Head": "inventoryslot_head", "slot_Shoulder": "inventoryslot_shoulder",
    "slot_Back": "inventoryslot_chest",  # WoW shows the chest outline for an empty back slot
    "slot_Chest": "inventoryslot_chest", "slot_Hands": "inventoryslot_hands",
    "slot_Legs": "inventoryslot_legs", "slot_Feet": "inventoryslot_feet",
    "slot_MainHand": "inventoryslot_mainhand", "slot_Bag": "inventoryslot_bag",
    "unarmed": "ability_meleedamage",
    "gold": "inv_misc_coin_01", "silver": "inv_misc_coin_03", "copper": "inv_misc_coin_05",
    "rested": "spell_nature_sleep", "res_sickness": "spell_holy_resurrection",
    "molten_core": "inv_hammer_unique_sulfuras", "ragnaros": "achievement_boss_ragnaros",
    "fire_resistance": "spell_fire_fire", "offline": "inv_misc_pocketwatch_01",
    "storage": "inv_misc_bag_08", "trap_murloc": "inv_misc_head_murloc_01",
}

# ---------------------------------------------------------------------------------------
# Wowhead lookups
# ---------------------------------------------------------------------------------------

def _get(url: str):
    CACHE.mkdir(parents=True, exist_ok=True)
    key = CACHE / (re.sub(r"[^A-Za-z0-9]+", "_", url)[-150:] + ".json")
    if key.exists():
        return json.loads(key.read_text(encoding="utf-8"))
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
    key.write_text(json.dumps(data), encoding="utf-8")
    time.sleep(0.3)
    return data


def item(name: str) -> dict:
    res = _get("https://www.wowhead.com/classic/search/suggestions-template?q=" + urllib.parse.quote(name))
    exact = [r for r in res.get("results", []) if r.get("type") == 3 and r["name"].lower() == name.lower()]
    if not exact:
        raise SystemExit(f"Not found on Wowhead Classic: {name!r}")
    r = exact[0]
    tip = _get(f"https://nether.wowhead.com/classic/tooltip/item/{r['id']}")["tooltip"]
    copper = 0
    for unit, mult in (("gold", 10000), ("silver", 100), ("copper", 1)):
        m = re.search(rf'money{unit}">(\d+)<', tip)
        copper += int(m.group(1)) * mult if m else 0
    fr = re.search(r"\+?(\d+) Fire Resistance", re.sub("<[^>]+>", " ", tip))
    return {"name": r["name"], "id": r["id"], "icon": r["icon"], "quality": r.get("quality", 1),
            "sell": copper, **({"fire_resistance": int(fr.group(1))} if fr else {})}


# ---------------------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------------------

def build() -> dict:
    prof_by_key = {p[0]: p for p in PROFESSIONS}
    data = {
        "ranks": [{"name": n, "start": s, "cap": c} for n, s, c in zip(RANKS, RANK_START, RANK_CAP)],
        "unlock_offsets": UNLOCK_OFFSETS,
        "professions": [
            {"key": k, "name": n, "kind": kind, "title": t, "icon": i, "source": src}
            for k, n, kind, t, i, src in PROFESSIONS
        ],
        "materials": [], "mobs": [], "recipes": [], "fire_resistance_set": [],
        "traits": {k: {"weapon": w, "text": txt} for k, (w, txt) in TRAITS.items()},
        "boss": {"name": RAGNAROS[0], "npc": RAGNAROS[1]},
        "ui_icons": UI_ICONS,
    }

    def unlock(rank, slot):
        return RANK_START[rank] + UNLOCK_OFFSETS[slot] if slot else RANK_START[rank]

    mats_by_rank: dict[str, list[list[str]]] = {}
    for prof, ranks in GATHERED.items():
        mats_by_rank[prof] = ranks
        for r, names in enumerate(ranks):
            for s, n in enumerate(names):
                data["materials"].append({**item(n), "profession": prof, "rank": r, "slot": s,
                                          "unlock": unlock(r, s)})
    mats_by_rank["combat"] = [[c] * 4 for c in CLOTH]
    for r, c in enumerate(CLOTH):
        data["materials"].append({**item(c), "profession": "combat", "rank": r, "slot": None,
                                  "unlock": RANK_START[r], "note": "dropped by every creature"})

    for r, (zone, mobs) in enumerate(ZONES):
        for s, (name, npc, display, level, cls, trait) in enumerate(mobs):
            data["mobs"].append({
                "name": name, "npc": npc, "display": display, "level": level,
                "classification": cls or "Normal", "trait": trait, "boss": s == 3,
                "zone": zone, "rank": r, "slot": s, "unlock": unlock(r, s),
                "image": NPC_IMG_URL.format(display % 256, display), "cloth": CLOTH[r],
            })

    for prof, spec in RECIPES.items():
        src = prof_by_key[prof][5]
        for r, names in enumerate(spec["items"]):
            for s, n in enumerate(names):
                if (r, s) in spec.get("overrides", {}):
                    reagents = spec["overrides"][(r, s)]
                elif spec["reagents"][s] == ["cloth"]:
                    reagents = [CLOTH[r]]
                else:
                    reagents = [mats_by_rank[src][r][int(m[1]) - 1] for m in spec["reagents"][s]]
                data["recipes"].append({
                    **item(n), "profession": prof, "rank": r, "slot": s, "unlock": unlock(r, s),
                    "role": spec["roles"][s], "reagents": reagents,
                    **({"stand_in": True} if n in spec.get("stand_ins", ()) else {}),
                })

    for prof, slot, n, reagents in FR_SET:
        data["fire_resistance_set"].append({**item(n), "profession": prof, "slot": slot,
                                            "unlock": unlock(3, 3), "reagents": reagents})
    return data


def icon(i: str, size: int = 18) -> str:
    return f'<img src="{ICON_URL.format(i)}" width="{size}" height="{size}">'


def link(e: dict) -> str:
    return f'{icon(e["icon"])} [{e["name"]}](https://www.wowhead.com/classic/item={e["id"]})'


def write_md(data: dict) -> str:
    out = ["# Skillup: game data for review", "",
           "Generated by `tools/build_game_data.py` from Wowhead Classic. Every name, ID and icon",
           "below was looked up there. Quantities, times, XP and stats come later from the balance",
           "simulator. Click a name for its Wowhead page.", ""]
    profs = {p["key"]: p for p in data["professions"]}
    hdr = "| | " + " | ".join(f"{n} ({s}-{c})" for n, s, c in zip(RANKS, RANK_START, RANK_CAP)) + " |"
    sep = "| --- " * 5 + "|"

    out += ["## Gathering", "", "Inside a rank, the 4 materials unlock at +0, +20, +40 and +55.", "", hdr, sep]
    for key in GATHERED:
        cells = []
        for r in range(4):
            ms = [m for m in data["materials"] if m["profession"] == key and m["rank"] == r]
            cells.append("<br>".join(f'{link(m)} ({m["unlock"]})' for m in ms))
        out.append(f'| {icon(profs[key]["icon"])} **{profs[key]["name"]}** | ' + " | ".join(cells) + " |")
    cloth = [m for m in data["materials"] if m["profession"] == "combat"]
    out.append(f'| {icon(profs["combat"]["icon"])} **Cloth** (every creature) | '
               + " | ".join(link(c) for c in cloth) + " |")

    out += ["", "## Combat", "", "Bosses are elite: about 3x health, hit harder, better loot.", "",
            "| | " + " | ".join(z for z, _ in ZONES) + " |", sep]
    for s in range(4):
        cells = []
        for r in range(4):
            m = next(m for m in data["mobs"] if m["rank"] == r and m["slot"] == s)
            trait = f' · **{m["trait"]}** → {TRAITS[m["trait"]][0]}' if m["trait"] else ""
            cls = f' ({m["classification"]})' if m["classification"] != "Normal" else ""
            cells.append(f'<img src="{m["image"]}" width="64"><br>[{m["name"]}](https://www.wowhead.com/classic/npc={m["npc"]}) '
                         f'lvl {m["level"]}{cls}{trait}<br>unlocks at {m["unlock"]}')
        out.append(f'| {"Boss" if s == 3 else f"Mob {s + 1}"} | ' + " | ".join(cells) + " |")
    out += ["", "Traits: " + "; ".join(f'**{k}** ({v[1]})' for k, v in TRAITS.items())
            + " Creatures without a trait: any weapon, Sword gets a small bonus against everything."]

    out += ["", "## Crafting", "",
            "Reagents listed in order; amounts come from the simulator. *Stand-in* = Classic had no",
            "crafted item of that cloth for that slot, so the closest real item is used.", ""]
    for key, spec in RECIPES.items():
        p = profs[key]
        out += [f'### {icon(p["icon"])} {p["name"]} (from {profs[p["source"]]["name"]})', "",
                "| Role | " + " | ".join(RANKS) + " |", sep]
        for s, role in enumerate(spec["roles"]):
            cells = []
            for r in range(4):
                rc = next(x for x in data["recipes"] if x["profession"] == key and x["rank"] == r and x["slot"] == s)
                si = " *(stand-in)*" if rc.get("stand_in") else ""
                cells.append(f'{link(rc)}{si} ({rc["unlock"]})<br><sub>{" + ".join(rc["reagents"])}</sub>')
            out.append(f"| {role} | " + " | ".join(cells) + " |")
        out.append("")

    out += ["## Ragnaros: Fire Resistance set", "",
            "Real Classic fire resistance gear (FR from Wowhead). Unlocks at 280 in its profession.",
            "Not checks. The weapon is your best Blacksmithing weapon.", "",
            "| Slot | Item | From | Classic FR | Reagents |", "| --- | --- | --- | --- | --- |"]
    for f in data["fire_resistance_set"]:
        out.append(f'| {f["slot"]} | {link(f)} | {profs[f["profession"]]["name"]} | '
                   f'{f.get("fire_resistance", "")} | {" + ".join(f["reagents"])} |')

    out += ["", "## Interface icons", "", " ".join(f'{icon(v, 32)} `{k}`' for k, v in UI_ICONS.items()), ""]
    return "\n".join(out)


if __name__ == "__main__":
    d = build()
    OUT_JSON.parent.mkdir(exist_ok=True)
    OUT_JSON.write_text(json.dumps(d, indent=1, ensure_ascii=False), encoding="utf-8")
    OUT_MD.write_text(write_md(d), encoding="utf-8")
    print(f"{len(d['materials'])} materials, {len(d['mobs'])} mobs, {len(d['recipes'])} recipes, "
          f"{len(d['fire_resistance_set'])} fire resistance pieces")
    print(f"Wrote {OUT_JSON.relative_to(ROOT)} and {OUT_MD.relative_to(ROOT)}")

# Skillup: design spec

Everything decided with Chakraa on 2026-11-12, in one place, so implementation can start from
here. Committed to the repo until the game is built, then gitignored again. Numbers marked *(sim)* are first guesses to be tuned with the balance simulator.
The original prototype notes and the data storage research are kept at the end.

## Identity

- **Name:** Skillup. Repo `Archipelago-Skillup`, game page `client/Skillup.html`, apworld
  `skillup.apworld`, Archipelago game name `Skillup`.
- **Theme:** fully World of Warcraft **Classic** (skill 1-300). Real names, Wowhead icons
  (`https://wow.zamimg.com/images/wow/icons/large/<icon>.jpg`, same CDN as aethernal.net),
  Wowhead Classic hover tooltips (`wowhead.com/classic/item=<id>`).
- **Hosting:** GitHub Pages (more reliable than htmlpreview for a page left open for hours).
  HTTPS page, so only `wss://` servers (archipelago.gg is fine).
- **Feel:** an idle game for a second monitor. Few decisions, actions repeat on their own,
  upgrades are obvious. Simpler than Idle Iktah. Switching what you gather or craft is
  always instant and free.

## Professions and ranks

11 professions, 4 ranks each. Each rank is a `Progressive <Profession>` item from the pool:
Apprentice (1-75), Journeyman (75-150), Expert (150-225), Artisan (225-300). Without the next
rank you're capped at 75/150/225.

| Type | Profession | Feeds |
| --- | --- | --- |
| Gathering | Mining | Blacksmithing, Engineering |
| Gathering | Herbalism | Alchemy |
| Gathering | Skinning | Leatherworking |
| Gathering | Fishing | Cooking |
| Fighting | Combat (title "Fighter") | Cloth for Tailoring, gold |
| Crafting | Blacksmithing | Weapons |
| Crafting | Leatherworking | Armor (Chest, Legs, Gloves, Boots) |
| Crafting | Tailoring | Armor (Cloak, Hat, Shoulders) and Bags (storage) |
| Crafting | Engineering | One tool per gathering profession |
| Crafting | Alchemy | Potions (temporary buffs, Healing Potion) |
| Crafting | Cooking | Food (temporary buffs) |

Not in v1: Enchanting, First Aid, Jewelcrafting/Inscription (not Classic). Riding was tried
and dropped (hard to balance); idea kept for later.

## Content per rank (4 per rank everywhere)

Inside a rank, the 4 things unlock at +0, +20, +40, +55 (so 1/20/40/55, 75/95/115/130,
150/170/190/205, 225/245/265/280).

| Profession | Apprentice | Journeyman | Expert | Artisan |
| --- | --- | --- | --- | --- |
| Mining (ore, ore, stone, gem) | Copper Ore, Tin Ore, Rough Stone, Malachite | Iron Ore, Silver Ore, Heavy Stone, Jade | Mithril Ore, Gold Ore, Solid Stone, Citrine | Thorium Ore, Truesilver Ore, Dense Stone, Star Ruby |
| Herbalism | Peacebloom, Silverleaf, Earthroot, Mageroyal | Briarthorn, Bruiseweed, Wild Steelbloom, Kingsblood | Fadeleaf, Goldthorn, Khadgar's Whisker, Purple Lotus | Sungrass, Dreamfoil, Mountain Silversage, Black Lotus |
| Skinning | Ruined Leather Scraps, Light Leather, Light Hide, Thin Kodo Leather | Medium Leather, Medium Hide, Heavy Leather, Heavy Hide | Thick Leather, Thick Hide, Turtle Scale, Scorpid Scale | Rugged Leather, Rugged Hide, Devilsaur Leather, Black Dragonscale |
| Fishing | Raw Brilliant Smallfish, Raw Slitherskin Mackerel, Raw Longjaw Mud Snapper, Raw Loch Frenzy | Raw Bristle Whisker Catfish, Raw Rainbow Fin Albacore, Oily Blackmouth, Firefin Snapper | Raw Rockscale Cod, Raw Mithril Head Trout, Raw Spotted Yellowtail, Raw Redgill | Raw Nightfin Snapper, Raw Sunscale Salmon, Raw Whitescale Salmon, Stonescale Eel |
| Blacksmithing | Sword, Axe, Mace, Dagger | same | same | same |
| Leatherworking | Chest, Legs, Gloves, Boots | same | same | same |
| Tailoring | Cloak, Hat, Shoulders, Bag | same | same | same |
| Engineering | Mining, Herbalism, Skinning, Fishing tool | same | same | same |
| Alchemy | Healing Potion, combat elixir, gathering speed potion, crafting speed potion | same | same | same |
| Cooking | 4 dishes, one per fish of the rank: 2 XP foods, 2 combat foods | same | same | same |

Cloth per rank (dropped by every creature): Linen, Silk, Mageweave, Runecloth. Real Classic
bags: Linen Bag, Small Silk Pack, Mageweave Bag, Runecloth Bag.

Still to pick in the data step: real recipe names and their reagents, Wowhead item IDs and
icon names for everything, verify the material names above on Wowhead.

### Combat zones (verified on Wowhead Classic)

Unlock order follows real levels. Format: name, level, (NPC id / display id).

| Rank | Zone | Mob 1 | Mob 2 | Mob 3 | Boss (elite) |
| --- | --- | --- | --- | --- | --- |
| Apprentice | Elwynn Forest (small forest creatures) | Kobold Vermin 1-2 (6 / 10913) | Murloc Forager 9-10 (46 / 441) | Prowler 9-10 (118 / 11415) | Hogger 11 elite (448 / 384) |
| Journeyman | Duskwood (skeletons, ghouls) | Skeletal Warrior 21-22 (48 / 200) | Rotted One 25-26 (948 / 137) | Nightbane Dark Runner 28-29 (205 / 736) | Stitches 35 elite (412 / 1693) |
| Expert | Stranglethorn Vale (gorillas, panthers, pirates) | Mistvale Gorilla 32-33 (1108 / 843) | Shadowmaw Panther 37-38 (684 / 633) | Bloodsail Swashbuckler 42-43 (1563 / 796) | King Bangalash 43 elite (731 / 616) |
| Artisan | Un'Goro Crater (dinosaurs) | Ravasaur Runner 49-50 (6506 / 5290) | Frenzied Pterrordax 52-54 (9167 / 8412) | Thunderstomp Stegodon 54-55 elite (6504 / 5289) | King Mosh 60 rare elite (6584 / 5305) |

- Creature images: 300x300 transparent PNG, hotlink-friendly (CORS `*`), all 16 confirmed:
  `https://wow.zamimg.com/modelviewer/classic/webthumbs/npc/<displayId % 256>/<displayId>.png`
  One angle only. Bring them to life with CSS: idle bob, shake when hit, flash on crits.
  Wowhead's 3D viewer could animate but is heavy, undocumented and has broken embeds before.
- Bosses: about 3x HP *(sim)*, hit harder, unlock like a 4th material, more cloth and gold,
  win chance shown before the fight.

## Checks: 20 per profession, 220 total

- 16 "firsts": first gather of each material, first kill of each mob, first craft of each recipe.
- 4 rank milestones named like WoW achievements: Apprentice/Journeyman/Expert/Artisan
  `<Title>` at 75/150/225/300. Titles: Miner, Herbalist, Skinner, Fisherman, Fighter,
  Blacksmith, Leatherworker, Tailor, Engineer, Alchemist, Cook.
- Not checks: Ragnaros (goal), Fire Resistance recipes, gold shop purchases.

## Leveling

- **XP per skill point:** each point costs XP, growing with level *(sim)*. Actions give XP.
  The XP curve controls pacing; the 1-300 scale stays WoW's.
- **Skill colors** from a thing's unlock level U: orange until U+15 (100% XP), yellow until
  U+30 (75%), green until U+45 (25%), grey after (0%).
- **Red:** anything in a rank you own but above your level can be attempted, even far above
  (Mining 10 with all 4 ranks can try Star Ruby). Success chance by gap below the unlock:
  10% within 25 levels, 5% within 75, 2% within 150, 1% beyond. Success gives full XP and
  counts for its "first" check. Failure costs only time, never materials. Ranks you don't
  own stay locked. Logic is unaffected (it only looks at ranks).
- **Action times:** every material and recipe has its own base time, growing steeply with
  difficulty (about 2 s for Copper Ore, about 10 s+ for Thorium / Black Lotus / Star Ruby
  *(sim)*). Upgrades multiply speed, so early things become very fast and late things only
  feel normal after many upgrades. Minimum action time about 0.5 s.
- **Skill points per hour** shown for every material/recipe/mob, using current speed, XP,
  color, success chance and buffs.

## Slots, storage, offline

- **Field** (gather or fight) and **Workshop** (craft) run at the same time (to try in
  playtest). Both repeat until changed.
- **Storage:** no inventory slots. Each material has a cap; start small (50 per material
  *(sim)*) so bags matter. Each first-crafted Tailoring bag raises the cap for every material
  (for example 50, 100, 200, 400, 800 *(sim)*). Overflow sells automatically, so gathering
  never stops.
- **Offline:** progress continues while the page is closed on every device. Base 8 h, +4 h
  per offline item, up to 24 h. Each hour past the cap gives 10 min of Rested XP; the Rested
  pool is capped at 2 h. Rested XP = double XP (XP only, not materials or gold) until used.
  Checks earned offline are sent on reconnect.

## Upgrades and buffs

- **Gold** (from selling and mob drops) buys permanent per-profession speed and XP upgrades
  at the trainer. Steps and costs *(sim)*.
- **Tools** (Engineering, one per gathering profession, upgraded per rank): gathering speed.
- **Potions** (Alchemy) and **food** (Cooking): temporary buffs. Healing Potions are drunk
  automatically at low HP, combat food is eaten between fights.

## Combat and gear

- **One Combat skill** (weapon skill 1-300). XP goes to Combat whatever weapon you use;
  there are no separate per-weapon skills.
- **Weapon types have flavour** (they don't need to be perfectly balanced, but must clearly
  feel different and the UI must explain them): Sword balanced, Axe higher crits, Mace takes
  less damage, Dagger faster kills *(sim)*. Unarmed (fists) when nothing is crafted yet.
- **Mob traits give weapons a reason** (confirmed). Only some creatures have a trait, so
  they feel special and are worth crafting for. The matching weapon gets a clear bonus
  *(sim)*. Proposed assignment: every boss is **Tough** → Axe (Hogger, Stitches, King
  Bangalash, King Mosh); **Armored** → Mace: Skeletal Warrior, Thunderstomp Stegodon;
  **Evasive** → Dagger: Shadowmaw Panther, Frenzied Pterrordax. The other 8 mobs have no
  trait; Sword has no specialty but a small bonus against everything (the safe pick).
  Elwynn only has Hogger, to introduce the idea gently.
- **Auto-swap** toggle on the equipment screen (an on/off switch): uses the best weapon for
  the current mob among the ones you've crafted.
- Weapon recipe cost and XP *(sim)*: Sword is the baseline. Axe and Mace cost more
  materials and give more Blacksmithing XP per craft. Dagger is small: fewer materials and
  less XP per craft (cheap to make, so it suits leveling when materials are short).
- **Gear stats:** Power (everywhere) and Fire Resistance (Ragnaros only).
- **Equipment screen:** WoW character sheet with the real empty-slot icons (check that
  Wowhead hosts `inventoryslot_*` icons). Slots: Head, Shoulders, Back, Chest | Hands, Legs,
  Feet | Main Hand. Stats in the middle (Power, Fire Resistance, HP). Below: the 4 tools,
  active buffs with timers, potion and food stock.
- **Two sets:** Main set = best piece per slot, automatic. Fire Resistance set = FR piece
  per slot if owned, otherwise the main piece. Ragnaros uses the FR set automatically.
- **Death:** fights have an HP bar. Dying = release spirit, short corpse-run timer, then a
  few minutes of Resurrection Sickness (slower Combat). No gold, item or XP loss. After 3
  deaths in a row, the game moves you to an easier mob. **DeathLink** option: your death
  kills linked players; a received death kills you if fighting, otherwise gives
  Resurrection Sickness.

## Goal: Ragnaros

- **Molten Core** is a single progression item that unlocks the Ragnaros fight (no trash zone).
- He needs a full **Fire Resistance set**: a sidegrade with Power between Expert and Artisan
  gear plus Fire Resistance, made from normal Artisan materials: Leatherworking Chest, Legs,
  Gloves, Boots; Tailoring Cloak, Hat, Shoulders; Alchemy Greater Fire Protection Potion;
  Cooking fire resistance food. Weapon = your best Blacksmithing weapon. FR recipes are not
  checks.
- Win chance grows with total Fire Resistance; shown before the fight.
- **In logic** with Molten Core + Artisan Combat, Blacksmithing, Leatherworking, Tailoring,
  Alchemy, Cooking (and so their gathering sources). Trying earlier is allowed (sequence
  break), just harder.

## Archipelago

- **Items:** 44 rank items (11 x 4) + Molten Core = 45 progression. With the default start,
  3 are given at start, 42 go in the pool. The other ~178 slots:
  - **Useful** (each weaker than one gold-shop upgrade, total capped *(sim)*): permanent XP
    and speed boosts per profession, larger storage, longer offline time, better sell prices.
  - **Filler:** small gold (Copper/Silver/Gold pouches scaling with your highest rank),
    Rested XP, small XP to a random learned profession, crate of current-rank materials,
    free potion or food buff.
  - **Traps** (mild): Resurrection Sickness, Repair Bill (a little gold), Broken Tool (tool
    off for a few minutes), Murloc Ambush (forced fight). One weight option per trap;
    overall trap chance default 2% of filler.
- **Logic:** a crafting rank needs the same rank of its source (Tailoring's source is
  Combat). Tools, gear, gold upgrades and buffs never appear in logic.
- **YAML options:**
  - `goal`: Ragnaros (default) / Master professions / Both.
  - `professions_to_master`: default 4.
  - `game_speed`: Long 50% / Normal 100% / Fast 200% XP, with estimated finish times in the
    option text. Target: 10-15 h on Normal.
  - `starting_pair`: Random or a specific pair (Mining+Blacksmithing,
    Herbalism+Alchemy, Skinning+Leatherworking, Fishing+Cooking).
  - `starting_pairs_count`: 1-4, default 1.
  - `combat_access`: Start with it (default) / Early (sphere 1 anywhere in the multiworld,
    Archipelago early items) / Anywhere.
  - `death_link`.
  - Trap chance + one weight per trap.

## Still open

- Crafting chains: decided no intermediate steps for now. Ore → weapon, cloth → gear (no
  bars, no bolts). Recipes keep their real Classic names. Confirmed: every material gets at
  least one use, by having recipes mix the rank's materials (main ore + stone, second ore,
  gems for the best recipes) so nothing is gathered only to be sold.
- Balance simulator: first pass done 2026-11-12. `tools/simulate.py` plays a typical
  player from `data/game_data.json` + `data/balance.json` (every tunable number) and writes
  `docs/BALANCE.md`. Second pass (all features tested). A realistic default seed (full
  pool, potions and food, each rank item arriving 30 min after it's needed) reaches
  Ragnaros in about 22 h (Long), 12 h (Normal), 6 h (Fast). Use these in the
  `game_speed` YAML text. Findings:
  - Gold: materials sell at their Wowhead vendor price; extra crafted items sell for the
    value of their materials x1.5 (Wowhead's own craft prices jump ~7x at Expert and made
    late game flood: up to 585g/h with 370g unspent at the end). Now income stays at about
    60-120g/h from hour 4 on. Trainer upgrades cost 10s doubling each step (10 steps of
    +15% speed, 10 of +10% XP); players own about 2 per profession at 1 h, 5 at 4 h, 8-9
    by the end, so the shop matters all game and the last steps stay aspirational. Gold
    comes mostly from extra crafts and material overflow, about 10-15% from coin pouches.
  - Crafting earns 1.4x XP per second: one Workshop slot levels 6 professions while the
    Field levels 5, so both finish together. XP cost base 13.
  - Item pool (178 slots), material crates cut: useful 22 speed +7%, 22 XP +7%, 4 storage
    +15%, 3 sell price +10%, 4 offline +4 h; filler 60 coin pouches (50s x rank growth),
    25 Rested XP (1 min each), 35 XP tomes (1 skill point's worth). Full pool: about 15%
    faster in a realistic seed. Useful items save 2-5 min per copy, filler under 1.5 min.
  - Potions and food (used automatically, 10 min, keep 5 of each): seeds are about 20%
    faster with them, so Alchemy and Cooking pull their weight. Decided: the stock stays a
    fixed 5 per kind (not the bag cap), so buffs can't be banked into permanent uptime;
    one buff of each kind at a time, extra potions and food sell.
  - Waiting for rank items: 30 min average wait costs about 50 min overall, 2 h waits
    cost about 6 h (the other slot keeps busy, but the Field runs out of open professions).
  - Offline (decided with Chakraa: offline must stay weaker than playing; bags are the
    reason to come back): while closed, each slot only repeats what it was doing, at full
    speed, up to the 8 h cap. It limits itself: the material goes grey, the rank caps, or
    crafting runs out of materials (bigger bags = longer offline crafting). At 1 h of play
    a day, repeat offline adds about 20% to a day's progress; "smart" offline (the game
    keeps choosing) was 3-4x a play session, far too strong. Slowing repeat offline to 50-
    75% barely changes it (the grey limit dominates), so no slowdown is needed.
    A longer offline cap makes things worse (time past the cap becomes Rested XP, which
    beats repeating a grey action). Decided: the offline cap stays a fixed 8 h (covers a
    night); the 4 "Longer offline time" pool items became 4 more storage items (8 total).
  - Offline and gold (proposed): nothing auto-sells while the page is closed. Once a
    material's storage is full, gathering keeps going for XP but extra materials are lost;
    crafted items made offline sell when you come back. Without this, one night of
    repeating sold up to 800-2200g of materials (40-70 shop upgrades at once). With it,
    offline gold is limited by your bags and the shop is paced by actual play. Before
    leaving, a player can "Sell all" a material to make room. The shop never buys
    anything by itself; you spend what you have when you return.
  - Traps: one of each costs at most about 1-2 minutes. Mild, as intended.
  - Red: proposed rule, attempts also take (1 + levels below / 25) times longer. Star
    Ruby from Mining 1 then takes about 5 h bare, 2.5 h with typical upgrades; from 200,
    about 15 min.
  - Ragnaros: Fire Resistance needed 160. Full set + potion + food: 95% per attempt;
    full set alone 82%; Artisan gear with no FR set 5% (about 2 h of attempts); Expert
    gear with no FR about 1%.
  - Still rough: the combat model (power ratio; deaths are rare with on-time gear).
- Data step: done 2026-11-12, see `docs/DATA.md` (review page with icons) and
  `data/game_data.json` (built by `tools/build_game_data.py`, every name looked up on
  Wowhead Classic). Choices made while doing it, for Chakraa to review:
  - Fishing swaps: Oily Blackmouth → Raw Sagefish (Journeyman), Stonescale Eel → Raw
    Glossy Mightfish (Artisan), so every rank has cookable fish. Firefin Snapper stays as an
    Alchemy fish (it feeds the Greater Fire Protection Potion, like Fire Oil in Classic).
  - Recipe order inside each rank, so recipe 1 only needs the rank's first material:
    Blacksmithing Dagger, Sword, Mace, Axe (Axe needs the gem and unlocks with the zone boss); Leatherworking Boots,
    Gloves, Legs, Chest; Tailoring Cloak, Bag, Shoulders, Hat; Engineering Mining, Skinning,
    Fishing, Herbalism tool; Alchemy Healing, combat elixir, gathering speed, crafting speed.
  - Blacksmithing weapons are all one-handers (real Classic recipes).
  - Tailoring: Classic has no linen hat or shoulders and no mageweave cloak, so 4 pieces
    are the closest real items ("stand-ins"): Double-stitched Woolen Shoulders, Azure Silk
    Hood, Shadow Hood, Cindercloth Cloak. Tailoring reagents are cloth only.
  - Tools are real Classic items even when Engineering didn't make them in Classic
    (Mining Pick, fishing poles, skinning knives). Herbalism line: Herbalist's Gloves,
    Pruning Knife, Compact Harvest Reaper Kit, Blood Scythe (the Zul'Gurub herb-cutting tool).
  - Fire Resistance set uses real Classic FR gear (values checked on Wowhead): Molten Helm,
    Volcanic Breastplate, Volcanic Leggings, Corehound Boots (Leatherworking), Cloak of
    Fire, Flarecore Mantle, Flarecore Gloves (Tailoring), Greater Fire Protection Potion,
    Dragonbreath Chili. Every armor piece needs a Star Ruby (a reason to gamble on red).
  - Wowhead hover tooltips show Classic's own stats, not ours. Use our own tooltip for
    gear, and Wowhead tooltips only for materials and flavour.
- Main screen layout: mockup to review (character sheet, Field and Workshop, skill/hr).
- Housekeeping: delete the old HTML-Minigames branch, test generation with the installed
  Archipelago (needs `skillup.apworld` in `custom_worlds`, ask first).

---

# Appendix: the original prototype (mobile Claude Code, HTML-Minigames branch)

Files:

| Path | What |
| --- | --- |
| `client/Skillup.html` | The whole game and its Archipelago client, one file, no dependencies. |
| `worlds/skillup/` | The Archipelago world: `data.py` (professions, IDs), `Options.py`, `__init__.py` (regions, items, logic). |
| `tools/build_apworld.py` | Packs the world: `python tools/build_apworld.py 0.1.0` → `skillup.apworld`. |

What it does (to be replaced by the spec above):
- 10 professions (with Jewelcrafting and Inscription), 6 tiers including Fel Iron, levels
  0-300, a tier stops giving XP at its cap. One recipe per tier.
- One gathering and one crafting action at the same time, offline up to 12 h.
- Inventory slots (stacks of 20), gold, bag purchases, auto-sell.
- `Progressive <Profession>` x6, checks every `check_interval` levels (300 checks at default),
  goal = max N professions, `experience_rate` option.
- The game looks up item and location IDs by name from the server's data package, so only
  names and rules have to match between `data.py` and the HTML. Keep this.

Saves (keep this design):
- Saved to the Archipelago server's data storage under `skillup_save_<team>_<slot>`, plus a
  localStorage copy keyed by seed, team and slot. On connect, the newer one wins.
- Saves every 20 s when something changed and when the tab is hidden.
- Playing the same slot on two devices at once means the last save wins.
- `?server=archipelago.gg:38281&slot=Name` in the URL pre-fills the connect screen.

## Cross-device saves: how it works and who else uses data storage

Archipelago servers have built-in **data storage**: any connected client can store and read
small JSON values on the server by key (`Get`, `Set`, `SetNotify` in the network protocol).
The prototype keeps the whole save there, so PC and phone share one save:

1. While you play, the game uploads its save under `skillup_save_<team>_<slot>`, every 20 s
   when something changed and when the tab is hidden or closed.
2. Another browser connecting to the same room and slot reads that key and loads the save,
   then adds the time since the last save as idle progress.
3. Each browser also keeps a local copy; on connect the newer timestamp wins.

Caveats: the save lives as long as the room does (archipelago.gg rooms sleep and keep their
data; a deleted room loses levels and inventory, but items and checks always come back from
the server). Any client in the room could technically read or change the key.

Other games using data storage (official Archipelago repo, `main` at f5b97c5), all for small
pieces of progress or shared data, none for a full save: Pokémon Emerald
(`pokemon_emerald_events_<team>_<slot>`), Castlevania: Circle of the Moon, Mario & Luigi:
Superstar Saga, Jak and Daxter, Zillion, Adventure, Lufia II, Undertale; trackers in Kingdom
Hearts 2, Super Mario World, The Wind Waker, Link's Awakening DX; EnergyLink (Factorio,
EarthBound, Mega Man 2 and 3, Super Mario Land 2, Pokémon Red/Blue, Satisfactory), trading
pools (Pokémon Emerald, StarCraft 2), gifting (Kirby's Dream Land 3).

Tested on the prototype: ~35 seeds with random options (Archipelago `main` f5b97c5), a
headless browser run against a local server (checks and items flowed correctly), and a
second phone-size browser resuming the save from the server.

Screenshots of the prototype: `screenshot-desktop.png`, `screenshot-mobile.png`.

# Skillup: design spec

Everything decided with Chakraa on 2026-11-12, in one place, so implementation can start from
here. Committed to the repo until the game is built, then gitignored again. Numbers marked *(sim)* are first guesses to be tuned with the balance simulator.
The original prototype notes and the data storage research are kept at the end.

## Identity

- **Name:** Skillup. Repo `Archipelago-Skillup`, game page `client/index.html` (built from `client/src/` by `tools/build_client.py`), apworld
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
- **Weapons (decided 2026-11-12, replaces the earlier flavour/auto-swap idea):**
  - Sword is the default: first recipe of each rank, cheapest (main ore only), good against
    everything (small bonus). Specialty weapons get harder to make in this order:
    Dagger, Mace, Axe (the Axe needs the gem and unlocks with the zone's boss). Costs and
    crafting XP *(sim)*: Sword 1x/1x, Dagger 1.25x/1.15x, Mace 1.5x/1.3x, Axe 2x/1.5x.
  - Only some creatures have a trait: every boss is **Tough** (Axe), Skeletal Warrior and
    Thunderstomp Stegodon are **Armored** (Mace), Shadowmaw Panther and Frenzied Pterrordax
    are **Evasive** (Dagger). The matching weapon is x2.2 power, enough that a specialty
    weapon one rank lower beats a Sword one rank higher (Journeyman Axe ~40 vs Expert Sword
    ~36 against Tough). No penalty for not matching.
  - Always automatic, no switch: every fight uses your best weapon for that creature. You
    keep your best weapon of each type (4 max); everything else sells.
  - Creatures show only their trait ("Tough", hover: "Huge health."). The weapon's hover
    says what it's strong against ("Strong against Tough creatures."), so players connect
    the two themselves.
  - Fighting uses the gathering slot (no gathering while fighting); crafting keeps going.
  - Sim result: Normal still about 11.5 h; deaths per seed rose from about 1 to about 10
    (more fights with only a Sword), still mild.
- **Combat stats (decided 2026-11-12, replaces "Power"):** weapon -> **DPS** (how fast you
  kill, so skill/hr, cloth and gold per hour); armor -> **HP** (whether you survive one
  fight). HP refills after every fight, so it never needs managing. A creature's HP =
  the DPS it expects x its base fight time; its damage is set so a normal fight against
  gear of its own rank costs ~30% of your HP (bosses hit relatively harder over a longer
  fight). Over 80% of your HP in one fight you start dying (certain at 160%). Shop Speed
  for Combat raises DPS; combat elixir raises DPS, combat food raises HP. On screen:
  DPS and HP on the character sheet (no Health/Power), each creature's nameplate shows a
  red HP bar with "100%" left and its HP right, plus skill/hr, time per kill and win
  chance when it isn't certain. The character sheet has no weapon slot; the 4 weapons
  sit below it. Sim: Normal ~11.5 h unchanged; Ragnaros win chances unchanged.
- **Gear stats:** Power (everywhere) and Fire Resistance (Ragnaros only).
- **Equipment screen:** WoW character sheet with the real empty-slot icons (check that
  Wowhead hosts `inventoryslot_*` icons). Slots: Head, Shoulders, Back, Chest | Hands, Legs,
  Feet | Main Hand. Stats in the middle (Power, Fire Resistance, HP). Below: the 4 tools,
  active buffs with timers, potion and food stock.
- **One set only (decided):** your best piece per slot is always worn, automatically. The
  Fire Resistance set is the best armor in the game (legendary, counts as above Artisan),
  so each piece simply replaces its Artisan piece as you craft it. No second set.
- **Item colors follow rank (decided):** crafted gear, tools and bags are white
  (Apprentice), green (Journeyman), blue (Expert), purple (Artisan); the Fire Resistance
  set is legendary orange. Materials, potions and food keep their Wowhead color.
- **No red roll in combat (decided):** a creature above your Combat skill shows its level
  in red but has no success chance; it's simply a slow, dangerous fight with a win
  chance. Red rolls stay for materials and recipes.
- **Bosses (tuned):** e.g. King Bangalash (Expert): green armor + Axe ~29% win, blue armor
  + Sword ~63%, blue armor + Axe 100%. Blue gear is what kills Expert bosses.
- **Gear Level (decided):** a score per rank on a 0-100 scale: white 20, green 40, blue 60,
  purple 80, legendary (Fire Resistance set) 100. (Real Wowhead item levels were checked and
  rejected: messy across ranks, and the Fire Resistance set's are below Artisan.) Gear Level = average of the 7 armor slots plus your
  best weapon (empty slot = 0). Shown on the character sheet instead of a Fire Resistance
  stat, colored along grey > white > green > blue > purple > orange, with a small gradient
  bar marking where you are.
- **Creature cards:** a shield with the recommended Gear Level for the zone (20/40/60/80,
  same coloring; never names the weapon type) plus a verdict for your current gear:
  Safe (always win), Risky (win 50-99%, shown), Deadly (under 50%).
- The Ragnaros goal tracker says "Legendary armor 0 / 7" (not "Fire Resistance set").
- **Recommended Gear Level per creature (computed, follows your weapons):** the lowest Gear
  Level where you win 95% of fights with the weapons you own: the right weapon for the
  creature's trait if you have it, else your Sword (so crafting the right weapon visibly
  lowers it). Locked creatures show only this, no verdict. Sword-only values: Elwynn 20/20/20, Hogger 37; Duskwood 25/31/37, Stitches 56;
  Stranglethorn 44/53/57, Bangalash 75; Un'Goro 65/74/79, King Mosh 94. The right weapon
  beats it earlier (Bangalash with an Axe at 60). Bosses at their zone's gear level: Sword
  0%, right weapon ~98%.
- **One job per gear type (decided 2026-11-12, replaces weapon-dependent survival):**
  armor decides survival (each creature deals a fixed damage per fight; HP from armor
  decides if you live), the weapon decides speed only (DPS -> kill time -> skill/hr,
  cloth, gold). The recommended Gear Level is fixed per creature and never moves with
  weapons. Gear Level = average of the 7 armor slots only. Tuned: base HP 50, armor 30
  per piece x 1.8 per rank, danger 0.4, boss damage x1.22. Recommendations: Elwynn 20
  everywhere; Duskwood 20/20/24, Stitches 38; Stranglethorn 32/40/45, Bangalash 58 (blue);
  Un'Goro 54/60/66, King Mosh 78 (purple). Sim: Normal ~10.2 h, but ~84 deaths per seed
  (players fight risky creatures for XP): raise the cost of dying later.
- **Layout (swept 2026-11-12 at the user's real width, ~1233px of page in a 1250px browser):**
  three columns (232px | flexible | 316px) down to 1180px wide; below that the right panel
  moves under the rest at a compact width. Item rows: icon (fixed size); the name in full,
  then colored level and category; then a list with one line per material ("2x Thorium
  Ore (158)", red when short) or "In storage (44 / 800)" for gathered items. Right side of
  each row: "✓ Sent" (green) or "◆ Check" (gold) as text, never a bare symbol (hover
  explains), the pace ("+1 / 22s", hover: one skill level every 22 s; "no skill" when grey,
  "Maxed" at 300) with time per action, and the button. Shop levels at 10 show "Max".
  Testing note: test pages at ~1233px wide (browser chrome and scrollbar eat ~17px).
- **Character sheet layout:** left Head, Shoulder, Back, Chest; right Hands, Legs, Feet,
  then an empty spot. Idea for later: a Trinket slot there (Engineering made trinkets in
  Classic: Mechanical Dragonlings, Gnomish Universal Remote; `inventoryslot_trinket` icon
  exists on Wowhead).
- **Combat tuning v3 (2026-11-12):** steeper death curve (start 80% of HP, certain at 120%);
  a death costs ~2 min (30 s corpse run + Resurrection Sickness). Each creature expects
  armor rising through its zone: the 1st expects the previous zone's gear (none in Elwynn,
  so Kobolds are safe naked), the boss the zone's own. Base HP 100, danger 0.75.
  Recommended Gear Level: Elwynn 0/20/20/20, Duskwood 20/23/30/37, Stranglethorn
  37/43/50/57, Un'Goro 57/64/70/77. Sim: Normal ~11.4 h, ~1-2 deaths per seed (an earlier
  version had ~60, almost all naked players dying to Kobold Vermin).
- **Combat skill lock (decided):** a creature can't be fought until your Combat skill
  reaches its unlock level ("Requires Combat 170"). No red attempts in combat.
- **Survival comes from gear only:** damage taken depends on fight length from your weapon
  (and combat elixir) and your HP from armor (and combat food). Shop Combat speed shortens
  the real fight time but never the damage. Tuned: danger 0.4, boss danger x0.35.
  Sim: Normal ~10.3 h; deaths ~40 per seed (watch this in playtests).
- **Combat shares the gathering slot:** you gather OR fight, and craft at the same time.
- **Death:** fights have an HP bar. Dying = release spirit, short corpse-run timer, then a
  few minutes of Resurrection Sickness (slower Combat). No gold, item or XP loss. After 3
  deaths in a row, the game moves you to an easier mob. **DeathLink** option: your death
  kills linked players; a received death kills you if fighting, otherwise gives
  Resurrection Sickness.

## Goal: Ragnaros

- **Molten Core** is a single progression item that unlocks the Ragnaros fight (no trash zone).
- He needs a full **Fire Resistance set** (also the best armor in the game; it used to be a
  sidegrade, decided otherwise 2026-11-12). Originally: a sidegrade with Power between Expert and Artisan
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

## Full sweep (2026-11-12)

- **Apworld rewritten to this design** (was still the prototype): `worlds/skillup/` now reads
  `data.json` (a trimmed copy built by `tools/build_game_data.py`), has 220 locations (16
  firsts + 4 rank milestones per profession, named "Mining: Copper Ore", "Journeyman
  Alchemist"), 44 rank items + Molten Core (only when the goal includes Ragnaros), 55 useful
  items, filler and traps by weight. Logic (`Rules.py`): ranks gate everything; crafting also
  needs its source rank (Tailoring's is Combat); fighting a zone needs the previous zone's
  armor (Leatherworking + Tailoring + Skinning ranks), its boss the zone's own armor.
  Options: goal, professions_to_master, game_speed, starting_pair, starting_pairs_count,
  combat_access (Early uses Archipelago's early items), trap_chance + 4 trap weights,
  death_link. IDs never depend on options.
- **Generation tests** with the installed Archipelago: solo default, hardest combos, traps at
  100% (a weight of 0 removes that trap), Early combat in a 2-player seed (lands in sphere 1),
  a 36-player options matrix and an 18-player multiworld with 15 other games. All pass; goals
  are reached in 15-25 spheres solo, 40-57 in big multiworlds.
- **Simulator** now takes every option. Normal unchanged (~11h45 Ragnaros). Master
  Professions (a focused player): 1 ~4 h, 4 ~8.5 h, 11 ~11.5 h. Starting pairs and combat
  access change the time by under an hour, except Combat arriving very late (~3 h in: +1 h).
- **Mockup:** dead code removed, layout capped at 1480px on wide screens, phone layout fixed
  (materials wrap, two-line rows, two-column profession grid). Audited at 1920 / 1233 / 390.

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
    Blacksmithing Sword, Dagger, Mace, Axe (Axe needs the gem and unlocks with the zone boss); Leatherworking Boots,
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
- Main screen layout: mockup at https://claude.ai/artifact/LWxAwo3tHX8mWt3Wgs6GmS (private).
  Profession list order decided: Fighting (Combat) on top, then Gathering, then Crafting,
  so gathering and crafting sit together.
  Wording on screen: no "Field" or "Workshop" (not WoW terms; they stay internal names
  in these notes and the simulator). The two running slots are labelled by what they do:
  "Gathering" or "Fighting", and "Crafting". The list shows running professions as a
  green-tinted row (no tag); no extra tag for capped ranks (the full bar shows it). Skill colors
  show as the unlock level colored the WoW way, never as words.
  Connect screen (in the mockup): Server, Slot name, Password (optional), Connect;
  "Recent rooms" list to reconnect in one click; Discord and GitHub links at the bottom,
  styled like aethernal.net's footer (gold icons, diamond separator). The connection status in the header goes back
  to it. `?server=...&slot=...` in the link still pre-fills it (from the prototype).
  Look (decided): Classic WoW interface language. Night-blue tooltip-style panels with steel
  borders on a dark blue/purple background, WoW title gold, Classic's blue Skills-tab bars
  with text on the bar (gold when a rank is capped), the yellow cast bar for gathering and a
  green one for crafting, red-and-gold buttons (green "Running" when active), red
  nameplate health bars on creatures, blue Rested bar. Fonts: Nunito Sans for text, Cinzel
  for titles, tabs and big numbers. Combat always shows its 4 creatures in one row.
  The gold shop is called "Shop" on screen (not "Trainer"). Layout: grouped like the
  profession list; each profession shows Speed and XP as 10 level pips, the total bonus
  (+90%), and a buy button with the next level's price, dimmed when you can't afford it.
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

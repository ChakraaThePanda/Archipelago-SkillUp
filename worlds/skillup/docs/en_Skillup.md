# Skillup

## What is this game?

A small browser idle game about leveling professions. There are 4 gathering professions
(Mining, Herbalism, Skinning, Fishing) and 6 crafting professions that use their materials
(Blacksmithing and Jewelcrafting use Mining, Alchemy and Inscription use Herbalism,
Leatherworking uses Skinning, Cooking uses Fishing). One gathering action and one crafting
action run at the same time, and keep running while the page is closed (up to 12 hours).

Each profession has 6 tiers (for Mining: Copper, Tin, Iron, Mithril, Thorium, Fel Iron) and
goes from level 0 to 300. A tier only gives XP until level 50, 100, 150... so you need the
next tier to keep leveling.

## What gets randomized?

* **Items:** `Progressive <Profession>` x6 per profession. The first copy teaches the
  profession, each next copy unlocks its next tier. You start with one random gathering
  profession (configurable). Also Bag Upgrades (+4 slots) and filler: Pouch of Gold, Elixir
  of Insight (double XP for 5 min), Swiftness Potion (+30% speed for 5 min) and Crate of
  Materials.
* **Locations:** reaching every `check_interval` levels (10 by default) in each profession,
  plus level 300.

A crafting tier is in logic once you have that tier of both the crafting profession and the
gathering profession that feeds it.

## Goal

Bring `professions_to_max` professions (3 by default) to level 300.

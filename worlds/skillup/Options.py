from dataclasses import dataclass

from Options import Choice, DeathLink, PerGameCommonOptions, Range


class Goal(Choice):
    """What finishes your game.
    Ragnaros: defeat Ragnaros in Molten Core. You need the Molten Core item and the Legendary
    armor set, which uses Artisan materials from almost every profession.
    Master Professions: bring a number of professions to 300 (see Professions to Master).
    Both: do both."""
    display_name = "Goal"
    option_ragnaros = 0
    option_master_professions = 1
    option_both = 2
    default = 0


class ProfessionsToMaster(Range):
    """How many professions must reach 300 for the Master Professions goal (and Both).
    Estimated play time on Normal speed: 1 about 4 hours, 6 about 10 to 11 hours, 11 about 11 to 12 hours."""
    display_name = "Professions to Master"
    range_start = 1
    range_end = 11
    default = 6


class GameSpeed(Choice):
    """How fast you gain skill. Estimated play time for the Ragnaros goal with the page open:
    Long about 22 hours, Normal about 11 to 12 hours, Fast about 6 hours."""
    display_name = "Game Speed"
    option_long = 0
    option_normal = 1
    option_fast = 2
    default = 1


class StartingPair(Choice):
    """The gathering profession you start with, together with the crafting profession that uses
    its materials, both at Apprentice."""
    display_name = "Starting Pair"
    option_random = 0
    option_mining_and_blacksmithing = 1
    option_herbalism_and_alchemy = 2
    option_skinning_and_leatherworking = 3
    option_fishing_and_cooking = 4
    default = 0


class StartingPairsCount(Range):
    """How many gathering and crafting pairs you start with. More pairs make a gentler start in
    small games. The extra pairs are random."""
    display_name = "Starting Pairs"
    range_start = 1
    range_end = 4
    default = 1


class CombatAccess(Choice):
    """When you can start fighting.
    Start With It: you start with Apprentice Combat (with your fists until you craft a weapon).
    Early: Apprentice Combat is placed in one of the first checks anyone in the multiworld can do.
    Anywhere: it can be anywhere in the multiworld."""
    display_name = "Combat Access"
    option_start_with_it = 0
    option_early = 1
    option_anywhere = 2
    default = 0


class TrapChance(Range):
    """Percent of filler items that are mild traps instead (a few minutes of slower combat, a
    small repair bill, a tool that breaks for a few minutes, or a quick Murloc ambush)."""
    display_name = "Trap Chance"
    range_start = 0
    range_end = 100
    default = 2


class ResurrectionSicknessWeight(Range):
    """How often a trap is Resurrection Sickness (combat is slower for a few minutes)."""
    display_name = "Resurrection Sickness Trap Weight"
    range_start = 0
    range_end = 10
    default = 5


class RepairBillWeight(Range):
    """How often a trap is a Repair Bill (you lose a small part of your gold)."""
    display_name = "Repair Bill Trap Weight"
    range_start = 0
    range_end = 10
    default = 5


class BrokenToolWeight(Range):
    """How often a trap is a Broken Tool (your gathering tool stops working for a few minutes)."""
    display_name = "Broken Tool Trap Weight"
    range_start = 0
    range_end = 10
    default = 5


class MurlocAmbushWeight(Range):
    """How often a trap is a Murloc Ambush (a quick forced fight)."""
    display_name = "Murloc Ambush Trap Weight"
    range_start = 0
    range_end = 10
    default = 5


@dataclass
class SkillUpOptions(PerGameCommonOptions):
    goal: Goal
    professions_to_master: ProfessionsToMaster
    game_speed: GameSpeed
    starting_pair: StartingPair
    starting_pairs_count: StartingPairsCount
    combat_access: CombatAccess
    trap_chance: TrapChance
    resurrection_sickness_weight: ResurrectionSicknessWeight
    repair_bill_weight: RepairBillWeight
    broken_tool_weight: BrokenToolWeight
    murloc_ambush_weight: MurlocAmbushWeight
    death_link: DeathLink

from dataclasses import dataclass

from Options import Range, PerGameCommonOptions


class CheckInterval(Range):
    """A check is sent every this many levels in each profession (level 300 always counts).
    10 gives 30 checks per profession, 300 in total; 50 gives 6 per profession."""
    display_name = "Check Interval"
    range_start = 5
    range_end = 50
    default = 10


class StartingProfessions(Range):
    """How many random gathering professions (Mining, Herbalism, Skinning, Fishing) you start
    with, at their first tier."""
    display_name = "Starting Gathering Professions"
    range_start = 1
    range_end = 4
    default = 1


class ProfessionsToMax(Range):
    """Goal: how many professions you must bring to level 300."""
    display_name = "Professions to Max"
    range_start = 1
    range_end = 10
    default = 3


class ExperienceRate(Range):
    """Percent multiplier on all profession XP. 100 is roughly an hour of active play per
    gathering profession from 1 to 300; crafting takes longer since you gather its materials
    too."""
    display_name = "Experience Rate"
    range_start = 25
    range_end = 1000
    default = 100


@dataclass
class SkillupOptions(PerGameCommonOptions):
    check_interval: CheckInterval
    starting_professions: StartingProfessions
    professions_to_max: ProfessionsToMax
    experience_rate: ExperienceRate

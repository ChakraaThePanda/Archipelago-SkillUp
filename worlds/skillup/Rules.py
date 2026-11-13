"""
Logic. Ranks are the only progression: what you can gather, craft or fight depends on the
ranks you own, never on gear stats, shop upgrades or buffs (those only make things faster).

The one exception is survival in combat, which comes from armor: a zone's first creatures
expect the previous zone's armor and its boss expects the zone's own armor, so fighting
needs the ranks that make that armor (Leatherworking and Tailoring, plus their materials).
"""
from __future__ import annotations

from BaseClasses import CollectionState

from .data import ARMOR_PROFS, MOLTEN_CORE, PROF, RAGNAROS_CRAFTS, Thing


class SkillUpLogic:
    def __init__(self, player: int):
        self.player = player

    def has_rank(self, state: CollectionState, prof: str, ranks: int) -> bool:
        return ranks <= 0 or state.has(PROF[prof].item, self.player, ranks)

    def armor(self, state: CollectionState, ranks: int) -> bool:
        """Can make the full armor set of rank index ranks-1 (0 = no armor needed)."""
        if ranks <= 0:
            return True
        return (all(self.has_rank(state, p, ranks) for p in ARMOR_PROFS)
                and self.has_rank(state, "skinning", ranks)     # leather
                and self.fight(state, ranks - 1))               # cloth drops from that zone

    def fight(self, state: CollectionState, rank: int) -> bool:
        """Can fight the regular creatures of zone `rank` (0 = Elwynn ... 3 = Un'Goro)."""
        return self.has_rank(state, "combat", rank + 1) and self.armor(state, rank)

    def materials(self, state: CollectionState, prof: str, rank: int) -> bool:
        """Can get the materials a crafting profession uses at this rank."""
        source = PROF[prof].source
        if source == "combat":
            return self.fight(state, rank)
        return self.has_rank(state, source, rank + 1)

    def thing(self, state: CollectionState, t: Thing) -> bool:
        p = PROF[t.profession]
        if p.kind == "gathering":
            return self.has_rank(state, p.key, t.rank + 1)
        if p.kind == "combat":
            return self.fight(state, t.rank) and (not t.boss or self.armor(state, t.rank + 1))
        return self.has_rank(state, p.key, t.rank + 1) and self.materials(state, p.key, t.rank)

    def reach_cap(self, state: CollectionState, prof: str, rank: int) -> bool:
        """Can level a profession to the cap of this rank (75/150/225/300)."""
        p = PROF[prof]
        if p.kind == "gathering":
            return self.has_rank(state, prof, rank + 1)
        if p.kind == "combat":
            return self.fight(state, rank)
        return self.has_rank(state, prof, rank + 1) and self.materials(state, prof, rank)

    def ragnaros(self, state: CollectionState) -> bool:
        """Molten Core, Artisan combat in Artisan armor, and every Artisan profession that
        makes the Legendary armor set, its potion, its food and a good weapon.
        The set also needs Star Ruby (Mining) and Firefin Snapper (Fishing)."""
        return (state.has(MOLTEN_CORE, self.player)
                and self.fight(state, 3) and self.armor(state, 4)
                and all(self.reach_cap(state, c, 3) for c in RAGNAROS_CRAFTS)
                and self.has_rank(state, "mining", 4))

    def mastered(self, state: CollectionState, count: int) -> bool:
        return sum(self.reach_cap(state, p, 3) for p in PROF) >= count

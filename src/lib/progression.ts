// ═══════════════════════════════════════════════════════════
// PROGRESSION — shared d20 Modern leveling rules
// Pure data + functions, safe for both client (UI) and server
// (validation/apply). No server-only imports here.
// ═══════════════════════════════════════════════════════════

import type { AbilityName, Character, HeroClass, PendingAdvancement, Skill } from './types';

export type { PendingAdvancement };

export interface FeatOption {
	name: string;
	desc: string;
	prereq?: string;
}

// General feats — available to every class at general-feat levels.
export const GENERAL_FEATS: FeatOption[] = [
	{ name: 'Alertness', desc: '+2 Listen and Spot checks' },
	{ name: 'Brawl', desc: '+1 unarmed attack, 1d6 unarmed damage' },
	{ name: 'Cautious', desc: '+2 Demolitions and Disable Device' },
	{ name: 'Combat Martial Arts', desc: '+1 unarmed, 1d4 lethal unarmed damage', prereq: 'BAB +1' },
	{ name: 'Confident', desc: '+2 Gamble and Intimidate' },
	{ name: 'Creative', desc: '+2 Craft and Perform' },
	{ name: 'Deceptive', desc: '+2 Bluff and Disguise' },
	{ name: 'Dodge', desc: '+1 dodge bonus to AC' },
	{ name: 'Educated', desc: '+2 Knowledge (Technology) and Research' },
	{ name: 'Endurance', desc: '+4 on extended physical activity checks' },
	{ name: 'Great Fortitude', desc: '+2 Fortitude saves' },
	{ name: 'Guide', desc: '+2 Navigate and Survival' },
	{ name: 'Improved Initiative', desc: '+4 Initiative rolls' },
	{ name: 'Iron Will', desc: '+2 Will saves' },
	{ name: 'Lightning Reflexes', desc: '+2 Reflex saves' },
	{ name: 'Low Profile', desc: '+2 Hide, less likely to be recognized' },
	{ name: 'Meticulous', desc: '+2 Investigate and Search' },
	{ name: 'Nimble', desc: '+2 Escape Artist and Sleight of Hand' },
	{ name: 'Point Blank Shot', desc: '+1 attack and damage within 30 ft.' },
	{ name: 'Power Attack', desc: 'Trade attack bonus for melee damage' },
	{ name: 'Stealthy', desc: '+2 Hide and Move Silently' },
	{ name: 'Studious', desc: '+2 Research' },
	{ name: 'Toughness', desc: '+3 hit points' },
	{ name: 'Trustworthy', desc: '+2 Diplomacy and Gather Information' }
];

// Class bonus feats — drawn from a per-class pool at class-feat levels.
export const CLASS_BONUS_FEATS: Record<HeroClass, FeatOption[]> = {
	'Strong Hero': [
		{ name: 'Animal Affinity', desc: '+2 Handle Animal' },
		{ name: 'Archaic Weapons Proficiency', desc: 'No penalty with swords, axes, etc.' },
		{ name: 'Brawl', desc: '+1 unarmed attack, 1d6 unarmed damage' },
		{ name: 'Cleave', desc: 'Extra melee attack after dropping a foe', prereq: 'Power Attack' },
		{ name: 'Combat Reflexes', desc: 'Additional attacks of opportunity' },
		{ name: 'Great Cleave', desc: 'Unlimited cleave attacks per round', prereq: 'Cleave' },
		{ name: 'Improved Brawl', desc: '+2 unarmed, 1d8 unarmed damage', prereq: 'Brawl' },
		{ name: 'Power Attack', desc: 'Trade attack bonus for melee damage' }
	],
	'Fast Hero': [
		{ name: 'Combat Reflexes', desc: 'Additional attacks of opportunity' },
		{ name: 'Dodge', desc: '+1 dodge bonus to AC' },
		{ name: 'Double Tap', desc: '+1 damage with firearms at close range', prereq: 'Point Blank Shot' },
		{ name: 'Mobility', desc: '+4 AC vs. attacks of opportunity from movement', prereq: 'Dodge' },
		{ name: 'Point Blank Shot', desc: '+1 attack and damage within 30 ft.' },
		{ name: 'Stealthy', desc: '+2 Hide and Move Silently' }
	],
	'Tough Hero': [
		{ name: 'Alertness', desc: '+2 Listen and Spot checks' },
		{ name: 'Brawl', desc: '+1 unarmed attack, 1d6 unarmed damage' },
		{ name: 'Endurance', desc: '+4 on extended physical activity checks' },
		{ name: 'Great Fortitude', desc: '+2 Fortitude saves' },
		{ name: 'Improved Damage Threshold', desc: '+3 massive damage threshold' },
		{ name: 'Toughness', desc: '+3 hit points' }
	],
	'Smart Hero': [
		{ name: 'Cautious', desc: '+2 Demolitions and Disable Device' },
		{ name: 'Educated', desc: '+2 Knowledge (Technology) and Research' },
		{ name: 'Meticulous', desc: '+2 Investigate and Search' },
		{ name: 'Studious', desc: '+2 Research' },
		{ name: 'Vehicle Expert', desc: '+2 Drive and Pilot' }
	],
	'Dedicated Hero': [
		{ name: 'Alertness', desc: '+2 Listen and Spot checks' },
		{ name: 'Attentive', desc: '+2 Investigate and Sense Motive' },
		{ name: 'Educated', desc: '+2 Knowledge (Technology) and Research' },
		{ name: 'Focused', desc: '+2 Concentration' },
		{ name: 'Iron Will', desc: '+2 Will saves' },
		{ name: 'Studious', desc: '+2 Research' }
	],
	'Charismatic Hero': [
		{ name: 'Confident', desc: '+2 Gamble and Intimidate' },
		{ name: 'Creative', desc: '+2 Craft and Perform' },
		{ name: 'Deceptive', desc: '+2 Bluff and Disguise' },
		{ name: 'Dodge', desc: '+1 dodge bonus to AC' },
		{ name: 'Trustworthy', desc: '+2 Diplomacy and Gather Information' },
		{ name: 'Windfall', desc: 'Start with extra wealth' }
	]
};

// Every skill in the game, in display order.
export const ALL_SKILLS: Skill[] = [
	'Balance', 'Bluff', 'Climb', 'Computer Use', 'Concentration', 'Craft',
	'Demolitions', 'Diplomacy', 'Disable Device', 'Disguise', 'Drive',
	'Escape Artist', 'Forgery', 'Gamble', 'Gather Information', 'Handle Animal',
	'Hide', 'Intimidate', 'Investigate', 'Jump', 'Knowledge (Arcane)',
	'Knowledge (Current Events)', 'Knowledge (Streetwise)', 'Knowledge (Technology)',
	'Listen', 'Move Silently', 'Navigate', 'Perception', 'Perform', 'Pilot',
	'Profession', 'Repair', 'Research', 'Search', 'Sense Motive',
	'Sleight of Hand', 'Spot', 'Survival', 'Swim', 'Treat Injury', 'Tumble'
];

// Class skills per hero class — these can be raised to the full cap and seed
// the auto-assigned starter kit for quick-start (template) characters.
export const HERO_CLASS_SKILLS: Record<HeroClass, Skill[]> = {
	'Strong Hero': ['Climb', 'Intimidate', 'Jump', 'Swim'],
	'Fast Hero': ['Balance', 'Drive', 'Escape Artist', 'Hide', 'Move Silently', 'Tumble'],
	'Tough Hero': ['Climb', 'Concentration', 'Intimidate', 'Survival'],
	'Smart Hero': ['Computer Use', 'Disable Device', 'Investigate', 'Knowledge (Technology)', 'Repair', 'Research'],
	'Dedicated Hero': ['Concentration', 'Gather Information', 'Listen', 'Sense Motive', 'Spot', 'Treat Injury'],
	'Charismatic Hero': ['Bluff', 'Diplomacy', 'Disguise', 'Gather Information', 'Intimidate', 'Perform']
};

// Base skill points per level by class (d20 Modern), before INT modifier.
export const CLASS_SKILL_POINTS: Record<HeroClass, number> = {
	'Strong Hero': 3,
	'Fast Hero': 5,
	'Tough Hero': 3,
	'Smart Hero': 9,
	'Dedicated Hero': 5,
	'Charismatic Hero': 5
};

export function abilityMod(score: number): number {
	return Math.floor((score - 10) / 2);
}

export function isClassSkill(cls: HeroClass, skill: Skill): boolean {
	return HERO_CLASS_SKILLS[cls].includes(skill);
}

// Skill points granted at a given level. First level gets ×4 (d20 Modern).
export function skillPointsForLevel(cls: HeroClass, intScore: number, isFirstLevel = false): number {
	const perLevel = Math.max(1, CLASS_SKILL_POINTS[cls] + abilityMod(intScore));
	return isFirstLevel ? perLevel * 4 : perLevel;
}

// Max ranks in a skill: class skills cap at level+3, cross-class at half that.
export function maxSkillRank(level: number, classSkill: boolean): number {
	return classSkill ? level + 3 : Math.floor((level + 3) / 2);
}

// ── Advancement cadence (house d20 rules) ──────────────────
// General feat every 3rd level; class bonus feat every even level;
// +1 ability score every 4th level; skill points every level.
export function generalFeatsAtLevel(level: number): number {
	return level >= 3 && level % 3 === 0 ? 1 : 0;
}
export function classFeatsAtLevel(level: number): number {
	return level >= 2 && level % 2 === 0 ? 1 : 0;
}
export function abilityPointsAtLevel(level: number): number {
	return level >= 4 && level % 4 === 0 ? 1 : 0;
}

export interface LevelGrants {
	generalFeats: number;
	classFeats: number;
	abilityPoints: number;
	skillPoints: number;
}

export function grantsForLevel(cls: HeroClass, intScore: number, level: number): LevelGrants {
	return {
		generalFeats: generalFeatsAtLevel(level),
		classFeats: classFeatsAtLevel(level),
		abilityPoints: abilityPointsAtLevel(level),
		skillPoints: skillPointsForLevel(cls, intScore, false)
	};
}

// Static bonuses applied the moment a feat is gained (mirrors char-creation
// logic, expanded). Feats not listed here are narrative/combat-only and the
// Director handles them in the fiction — no stored stat change.
export interface FeatBonus {
	hp?: number;
	ac?: number;
	init?: number;
	skills?: Partial<Record<Skill, number>>;
}
export const FEAT_BONUSES: Record<string, FeatBonus> = {
	Toughness: { hp: 3 },
	Dodge: { ac: 1 },
	'Improved Initiative': { init: 4 },
	Alertness: { skills: { Listen: 2, Spot: 2 } },
	Educated: { skills: { 'Knowledge (Technology)': 2, Research: 2 } },
	Trustworthy: { skills: { Diplomacy: 2, 'Gather Information': 2 } },
	Cautious: { skills: { Demolitions: 2, 'Disable Device': 2 } },
	Confident: { skills: { Gamble: 2, Intimidate: 2 } },
	Creative: { skills: { Craft: 2, Perform: 2 } },
	Deceptive: { skills: { Bluff: 2, Disguise: 2 } },
	Guide: { skills: { Navigate: 2, Survival: 2 } },
	Meticulous: { skills: { Investigate: 2, Search: 2 } },
	Nimble: { skills: { 'Escape Artist': 2, 'Sleight of Hand': 2 } },
	Stealthy: { skills: { Hide: 2, 'Move Silently': 2 } },
	Studious: { skills: { Research: 2 } },
	'Low Profile': { skills: { Hide: 2 } },
	Attentive: { skills: { Investigate: 2, 'Sense Motive': 2 } },
	Focused: { skills: { Concentration: 2 } },
	'Vehicle Expert': { skills: { Drive: 2, Pilot: 2 } },
	'Animal Affinity': { skills: { 'Handle Animal': 2 } }
};

// Apply a freshly-gained feat's static bonuses to a character in place.
// Incremental (no full recompute) — matches how AC/init/HP are stored.
export function applyFeatBonuses(char: Character, feat: string): void {
	const bonus = FEAT_BONUSES[feat];
	if (!bonus) return;
	if (bonus.hp) {
		char.maxHp += bonus.hp;
		char.hp += bonus.hp;
	}
	if (bonus.ac) char.ac += bonus.ac;
	if (bonus.init) char.initiative += bonus.init;
	if (bonus.skills) {
		for (const [skill, amt] of Object.entries(bonus.skills) as [Skill, number][]) {
			char.skills[skill] = (char.skills[skill] ?? 0) + amt;
		}
	}
}

// Raise one ability by +1 and propagate derived stats incrementally.
// CON crossing a modifier threshold grants retroactive HP (+1/level);
// DEX crossing one bumps AC and Initiative.
export function applyAbilityIncrease(char: Character, ability: AbilityName): void {
	const oldMod = abilityMod(char.abilities[ability]);
	char.abilities[ability] += 1;
	const newMod = abilityMod(char.abilities[ability]);
	if (newMod === oldMod) return;
	const delta = newMod - oldMod;
	if (ability === 'CON') {
		char.maxHp += char.level * delta;
		char.hp += char.level * delta;
	} else if (ability === 'DEX') {
		char.ac += delta;
		char.initiative += delta;
	}
}

// Roll any newly-gained levels into the character's pending advancement pool.
// Idempotent: guarded by advancementResolvedThrough, so it's safe to call from
// both the level-up path and on every state load (this is what backfills
// characters created before the leveling system existed). HP is NOT touched
// here — award_xp already grants per-level HP. Returns true if it changed.
export function syncAdvancement(char: Character): boolean {
	const resolved = char.advancementResolvedThrough ?? 1;
	if (char.level <= resolved) return false;
	const p: PendingAdvancement = char.pendingAdvancement ?? {
		generalFeats: 0,
		classFeats: 0,
		abilityPoints: 0,
		skillPoints: 0,
		fromLevel: resolved + 1,
		toLevel: char.level
	};
	for (let lvl = resolved + 1; lvl <= char.level; lvl++) {
		const g = grantsForLevel(char.class, char.abilities.INT, lvl);
		p.generalFeats += g.generalFeats;
		p.classFeats += g.classFeats;
		p.abilityPoints += g.abilityPoints;
		p.skillPoints += g.skillPoints;
	}
	p.fromLevel = Math.min(p.fromLevel, resolved + 1);
	p.toLevel = char.level;
	char.pendingAdvancement = p;
	char.advancementResolvedThrough = char.level;
	return true;
}

export function hasPendingAdvancement(p?: PendingAdvancement | null): boolean {
	return !!p && (p.generalFeats > 0 || p.classFeats > 0 || p.abilityPoints > 0 || p.skillPoints > 0);
}

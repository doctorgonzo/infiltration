// ═══════════════════════════════════════════════════════════
// JOIN — Create a character and enter the world
// POST { playerName, characterName, heroClass }
// ═══════════════════════════════════════════════════════════

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getState, addCharacter, addSession, addLogEntry } from '$lib/server/engine/state';
import { rollAbilityScore, abilityModifier } from '$lib/server/engine/dice';
import { ITEMS } from '$lib/server/world/madison';
import type { Character, AbilityScores, PlayerSession, AbilityName, Skill } from '$lib/types';
import { CLASS_KEY_ABILITY, CLASS_HIT_DIE } from '$lib/types';
import type { HeroClass } from '$lib/types';
import { HERO_CLASS_SKILLS, ALL_SKILLS, applyFeatBonuses, skillPointsForLevel, maxSkillRank, isClassSkill } from '$lib/progression';

const VALID_CLASSES: HeroClass[] = [
	'Strong Hero', 'Fast Hero', 'Tough Hero',
	'Smart Hero', 'Dedicated Hero', 'Charismatic Hero'
];

const CLASS_STARTING_GEAR: Record<HeroClass, string[]> = {
	'Strong Hero': ['baseball_bat', 'leather_jacket', 'first_aid_kit'],
	'Fast Hero': ['pocket_knife', 'leather_jacket', 'flashlight', 'cell_phone'],
	'Tough Hero': ['baseball_bat', 'leather_jacket', 'first_aid_kit', 'spotted_cow'],
	'Smart Hero': ['pocket_knife', 'flashlight', 'first_aid_kit', 'cell_phone'],
	'Dedicated Hero': ['pocket_knife', 'first_aid_kit', 'flashlight', 'cell_phone'],
	'Charismatic Hero': ['pocket_knife', 'leather_jacket', 'spotted_cow', 'cell_phone']
};

const CLASS_STARTING_FEAT: Record<HeroClass, string> = {
	'Strong Hero': 'Power Attack',
	'Fast Hero': 'Dodge',
	'Tough Hero': 'Toughness',
	'Smart Hero': 'Educated',
	'Dedicated Hero': 'Alertness',
	'Charismatic Hero': 'Trustworthy'
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { playerName, characterName, heroClass } = body;

	if (!playerName || !characterName || !heroClass) {
		return json({ error: 'Missing required fields: playerName, characterName, heroClass' }, { status: 400 });
	}

	if (!VALID_CLASSES.includes(heroClass)) {
		return json({ error: `Invalid class. Choose from: ${VALID_CLASSES.join(', ')}` }, { status: 400 });
	}

	// Check for duplicate character names
	const state = getState();
	const nameExists = Object.values(state.players).some(
		p => p.name.toLowerCase() === characterName.toLowerCase() && p.alive
	);
	if (nameExists) {
		return json({ error: 'A living character with that name already exists. Choose another.' }, { status: 409 });
	}

	// ── Ability Scores ─────────────────────────────────────
	let abilities: AbilityScores;

	if (body.abilities && typeof body.abilities === 'object') {
		// Player rolled their own stats — validate them
		const abilityKeys: AbilityName[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
		abilities = { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 };
		for (const key of abilityKeys) {
			const val = body.abilities[key];
			if (typeof val !== 'number' || val < 3 || val > 18) {
				return json({ error: `Invalid ability score for ${key}: must be 3-18` }, { status: 400 });
			}
			abilities[key] = val;
		}
	} else {
		// Auto-roll and assign (legacy / fallback)
		const abilityRolls = Array.from({ length: 6 }, () => rollAbilityScore());
		const sortedScores = abilityRolls.map(r => r.total).sort((a, b) => b - a);
		const priorityOrder = getAbilityPriority(heroClass as HeroClass);
		abilities = { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 };
		let scoreIdx = 0;
		for (const ab of priorityOrder) {
			abilities[ab] = sortedScores[scoreIdx++];
		}
	}

	// ── Derived Stats ──────────────────────────────────────
	const hitDie = CLASS_HIT_DIE[heroClass as HeroClass];
	const conMod = abilityModifier(abilities.CON);
	const dexMod = abilityModifier(abilities.DEX);

	// ── Feats ──────────────────────────────────────────────
	const feats: string[] = body.feats && Array.isArray(body.feats)
		? ['Simple Weapons Proficiency', ...body.feats]
		: ['Simple Weapons Proficiency', CLASS_STARTING_FEAT[heroClass as HeroClass]];

	// ── Skills ─────────────────────────────────────────────
	// Custom characters allocate their level-1 skill pool ((class base + INT)×4)
	// in the creation Skills step; quick-start templates get the auto class kit.
	const skills: Partial<Record<Skill, number>> = {};
	const heroClassTyped = heroClass as HeroClass;
	if (body.skillRanks && typeof body.skillRanks === 'object') {
		const pool = skillPointsForLevel(heroClassTyped, abilities.INT, true);
		let spent = 0;
		for (const [skill, rawRank] of Object.entries(body.skillRanks)) {
			if (!ALL_SKILLS.includes(skill as Skill)) continue;
			const rank = Math.max(0, Math.floor(Number(rawRank) || 0));
			const cap = maxSkillRank(1, isClassSkill(heroClassTyped, skill as Skill));
			if (rank > cap) {
				return json({ error: `${skill} can't exceed rank ${cap} at level 1.` }, { status: 400 });
			}
			if (rank > 0) {
				skills[skill as Skill] = rank;
				spent += rank;
			}
		}
		if (spent > pool) {
			return json({ error: `Too many skill ranks: spent ${spent}, you have ${pool}.` }, { status: 400 });
		}
	} else {
		// Template / fallback: class skills at rank 2.
		for (const skill of HERO_CLASS_SKILLS[heroClassTyped] ?? []) {
			skills[skill] = 2;
		}
	}

	const maxHp = Math.max(1, hitDie + conMod);

	// ── Starting Gear ──────────────────────────────────────
	const gearIds = CLASS_STARTING_GEAR[heroClassTyped] ?? [];
	const inventory = gearIds.map(id => ({ ...ITEMS[id] })).filter(Boolean);

	// ── Create Character ───────────────────────────────────
	const playerId = crypto.randomUUID();

	const character: Character = {
		id: playerId,
		name: characterName,
		playerName,
		class: heroClassTyped,
		level: 1,
		xp: 0,
		abilities,
		hp: maxHp,
		maxHp,
		ac: 10 + dexMod + (inventory.find(i => i.type === 'armor')?.acBonus ?? 0),
		initiative: dexMod,
		speed: 30,
		skills,
		feats,
		advancementResolvedThrough: 1,
		inventory,
		equippedWeapon: inventory.find(i => i.type === 'weapon')?.id,
		equippedArmor: inventory.find(i => i.type === 'armor')?.id,
		conditions: [],
		location: 'the_rigby',
		actionPoints: 5,
		wealth: 100 + Math.floor(Math.random() * 300),
		notes: [],
		alive: true,
		inebriation: 0,
		createdAt: new Date().toISOString(),
		stats: {
			enemiesKilled: 0,
			damageDealt: 0,
			damageTaken: 0,
			moneyEarned: 0,
			moneySpent: 0,
			drinksConsumed: 0,
			itemsFound: 0,
			criticalHits: 0,
			criticalFails: 0,
			romances: 0,
			actionsPerformed: 0
		}
	};

	// Apply static feat bonuses (Toughness HP, Dodge AC, Improved Init, skill feats).
	for (const feat of feats) applyFeatBonuses(character, feat);
	character.hp = character.maxHp;

	addCharacter(character);

	// ── Session ────────────────────────────────────────────
	const session: PlayerSession = {
		playerId,
		playerName,
		characterId: playerId,
		connectedAt: new Date().toISOString(),
		lastAction: new Date().toISOString()
	};
	addSession(session);

	// ── Announce Arrival ───────────────────────────────────
	addLogEntry({
		timestamp: new Date().toISOString(),
		type: 'system',
		text: `${characterName} the ${heroClass} pushes through the door of The Rigby. The resistance grows stronger.`
	});

	return json({
		playerId,
		character,
		message: `Welcome to Madison, ${characterName}. Something is very wrong here.`
	});
};

/**
 * Get ability score assignment priority per class.
 * Key ability first, then stats that matter for the archetype.
 */
function getAbilityPriority(heroClass: HeroClass): AbilityName[] {
	switch (heroClass) {
		case 'Strong Hero':   return ['STR', 'CON', 'DEX', 'WIS', 'INT', 'CHA'];
		case 'Fast Hero':     return ['DEX', 'CON', 'STR', 'WIS', 'INT', 'CHA'];
		case 'Tough Hero':    return ['CON', 'STR', 'DEX', 'WIS', 'CHA', 'INT'];
		case 'Smart Hero':    return ['INT', 'DEX', 'CON', 'WIS', 'CHA', 'STR'];
		case 'Dedicated Hero': return ['WIS', 'CON', 'DEX', 'INT', 'CHA', 'STR'];
		case 'Charismatic Hero': return ['CHA', 'DEX', 'CON', 'WIS', 'INT', 'STR'];
	}
}

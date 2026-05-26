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

const VALID_CLASSES: HeroClass[] = [
	'Strong Hero', 'Fast Hero', 'Tough Hero',
	'Smart Hero', 'Dedicated Hero', 'Charismatic Hero'
];

const CLASS_SKILLS: Record<HeroClass, Skill[]> = {
	'Strong Hero': ['Climb', 'Intimidate', 'Jump', 'Swim'],
	'Fast Hero': ['Balance', 'Drive', 'Escape Artist', 'Hide', 'Move Silently', 'Tumble'],
	'Tough Hero': ['Climb', 'Concentration', 'Intimidate', 'Survival'],
	'Smart Hero': ['Computer Use', 'Disable Device', 'Investigate', 'Knowledge (Technology)', 'Repair', 'Research'],
	'Dedicated Hero': ['Concentration', 'Gather Information', 'Listen', 'Sense Motive', 'Spot', 'Treat Injury'],
	'Charismatic Hero': ['Bluff', 'Diplomacy', 'Disguise', 'Gather Information', 'Intimidate', 'Perform']
};

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

	// ── Roll Ability Scores (4d6 drop lowest × 6) ──────────
	const abilityRolls = Array.from({ length: 6 }, () => rollAbilityScore());
	const sortedScores = abilityRolls.map(r => r.total).sort((a, b) => b - a);

	// Assign highest to key ability, then prioritize smartly per class
	const keyAbility = CLASS_KEY_ABILITY[heroClass as HeroClass];
	const priorityOrder = getAbilityPriority(heroClass as HeroClass);

	const abilities: AbilityScores = { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 };
	let scoreIdx = 0;
	for (const ab of priorityOrder) {
		abilities[ab] = sortedScores[scoreIdx++];
	}

	// ── Derived Stats ──────────────────────────────────────
	const hitDie = CLASS_HIT_DIE[heroClass as HeroClass];
	const conMod = abilityModifier(abilities.CON);
	const dexMod = abilityModifier(abilities.DEX);
	const maxHp = Math.max(1, hitDie + conMod);

	// ── Skills (class skills at rank 2) ────────────────────
	const skills: Partial<Record<Skill, number>> = {};
	for (const skill of CLASS_SKILLS[heroClass as HeroClass] ?? []) {
		skills[skill] = 2;
	}

	// ── Starting Gear ──────────────────────────────────────
	const gearIds = CLASS_STARTING_GEAR[heroClass as HeroClass] ?? [];
	const inventory = gearIds.map(id => ({ ...ITEMS[id] })).filter(Boolean);

	// ── Create Character ───────────────────────────────────
	const playerId = crypto.randomUUID();

	const character: Character = {
		id: playerId,
		name: characterName,
		playerName,
		class: heroClass as HeroClass,
		level: 1,
		xp: 0,
		abilities,
		hp: maxHp,
		maxHp,
		ac: 10 + dexMod + (inventory.find(i => i.type === 'armor')?.acBonus ?? 0),
		initiative: dexMod,
		speed: 30,
		skills,
		feats: ['Simple Weapons Proficiency', CLASS_STARTING_FEAT[heroClass as HeroClass]],
		inventory,
		equippedWeapon: inventory.find(i => i.type === 'weapon')?.id,
		equippedArmor: inventory.find(i => i.type === 'armor')?.id,
		conditions: [],
		location: 'the_rigby',
		actionPoints: 5,
		wealth: 100 + Math.floor(Math.random() * 300),
		notes: [],
		alive: true
	};

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
		abilityRolls: abilityRolls.map(r => ({
			rolls: r.rolls,
			dropped: r.dropped,
			total: r.total
		})),
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

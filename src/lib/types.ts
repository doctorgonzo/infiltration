// ═══════════════════════════════════════════════════════════
// d20 Modern — Core Types
// ═══════════════════════════════════════════════════════════

// ── Ability Scores ─────────────────────────────────────────
export type AbilityName = 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA';

export interface AbilityScores {
	STR: number;
	DEX: number;
	CON: number;
	INT: number;
	WIS: number;
	CHA: number;
}

// ── Classes (d20 Modern) ───────────────────────────────────
export type HeroClass =
	| 'Strong Hero'
	| 'Fast Hero'
	| 'Tough Hero'
	| 'Smart Hero'
	| 'Dedicated Hero'
	| 'Charismatic Hero';

export const CLASS_KEY_ABILITY: Record<HeroClass, AbilityName> = {
	'Strong Hero': 'STR',
	'Fast Hero': 'DEX',
	'Tough Hero': 'CON',
	'Smart Hero': 'INT',
	'Dedicated Hero': 'WIS',
	'Charismatic Hero': 'CHA'
};

export const CLASS_HIT_DIE: Record<HeroClass, number> = {
	'Strong Hero': 8,
	'Fast Hero': 8,
	'Tough Hero': 10,
	'Smart Hero': 6,
	'Dedicated Hero': 6,
	'Charismatic Hero': 6
};

// ── Skills (d20 Modern subset) ─────────────────────────────
export type Skill =
	| 'Balance' | 'Bluff' | 'Climb' | 'Computer Use'
	| 'Concentration' | 'Craft' | 'Demolitions' | 'Diplomacy'
	| 'Disable Device' | 'Disguise' | 'Drive' | 'Escape Artist'
	| 'Forgery' | 'Gamble' | 'Gather Information' | 'Handle Animal'
	| 'Hide' | 'Intimidate' | 'Investigate' | 'Jump'
	| 'Knowledge (Arcane)' | 'Knowledge (Current Events)' | 'Knowledge (Streetwise)' | 'Knowledge (Technology)'
	| 'Listen' | 'Move Silently' | 'Navigate' | 'Perception'
	| 'Perform' | 'Pilot' | 'Profession' | 'Repair'
	| 'Research' | 'Search' | 'Sense Motive' | 'Sleight of Hand'
	| 'Spot' | 'Survival' | 'Swim' | 'Treat Injury' | 'Tumble';

// ── Items ──────────────────────────────────────────────────
export interface Item {
	id: string;
	name: string;
	description: string;
	weight: number; // lbs
	type: 'weapon' | 'armor' | 'gear' | 'consumable' | 'quest' | 'junk';
	// Weapon stats
	damage?: string;        // e.g. "1d6", "2d6"
	damageType?: string;    // e.g. "ballistic", "bludgeoning", "slashing"
	range?: number;         // feet, 0 = melee
	critRange?: number;     // natural roll threshold, default 20
	critMultiplier?: number; // default x2
	// Armor stats
	acBonus?: number;
	maxDex?: number;
	armorPenalty?: number;
	// Consumable
	uses?: number;
	effect?: string;
	// Misc
	value?: number;         // in dollars
	properties?: string[];  // special properties
}

// ── Character ──────────────────────────────────────────────
export interface Character {
	id: string;
	name: string;
	playerName: string;     // the human controlling this character
	class: HeroClass;
	level: number;
	xp: number;
	abilities: AbilityScores;
	hp: number;
	maxHp: number;
	ac: number;
	initiative: number;
	speed: number;          // feet per round
	skills: Partial<Record<Skill, number>>; // skill ranks
	feats: string[];
	inventory: Item[];
	equippedWeapon?: string;  // item id
	equippedArmor?: string;   // item id
	conditions: string[];     // poisoned, prone, etc.
	location: string;         // location id
	actionPoints: number;     // d20 Modern action points
	wealth: number;           // dollars
	notes: string[];          // character-specific notes/flags
	alive: boolean;
	lastActive?: string;      // ISO timestamp — characters fade after 60s of inactivity
	godMode?: boolean;        // /admin toggle — 1000 HP, always nat 20
	originalMaxHp?: number;   // stash real maxHp when godMode activates
	inebriation: number;      // 0-10 drunk/high scale
	lastDrinkDecay?: string;  // ISO timestamp — last time inebriation decayed
	romanceMode?: boolean;    // routed to local uncensored model
	romanceNpc?: string;      // NPC id or name for active romance
	romanceContext?: string;  // scene context from the Director
	partyId?: string;         // party id if in a group
	// ── Lifetime Stats ────────────────────────────────
	createdAt: string;        // ISO timestamp
	stats: CharacterStats;
}

export interface CharacterStats {
	enemiesKilled: number;
	damageDealt: number;
	damageTaken: number;
	moneyEarned: number;
	moneySpent: number;
	drinksConsumed: number;
	itemsFound: number;
	criticalHits: number;
	criticalFails: number;
	romances: number;
	actionsPerformed: number;
}

// ── Location ───────────────────────────────────────────────
export interface Location {
	id: string;
	name: string;
	description: string;
	type: 'outdoor' | 'indoor' | 'dungeon' | 'underground';
	connections: string[];    // location ids you can travel to
	npcs: string[];           // npc ids present here
	items: string[];          // item ids on the ground
	enemies: string[];        // enemy ids present
	flags: Record<string, boolean>; // location-specific state
	discovered: boolean;
	dangerLevel: number;      // 0-10
}

// ── NPC ────────────────────────────────────────────────────
export interface NPC {
	id: string;
	name: string;
	description: string;
	location: string;
	attitude: 'friendly' | 'neutral' | 'hostile' | 'suspicious';
	dialogue: string[];       // conversation topics
	isInfiltrator: boolean;   // body-snatched?
	alive: boolean;
	questGiver: boolean;
	inventory: Item[];
	relationshipScore: number;    // -100 to +100, starts at 0
	memories: string[];           // short strings like "Player helped me escape", "Player threatened me"
}

// ── Random Encounters ─────────────────────────────────────
export interface EncounterEntry {
	name: string;
	type: 'combat' | 'social' | 'skill' | 'loot' | 'atmosphere' | 'none';
	description: string;
	enemies?: Array<{name: string; hp: number; ac: number; attackBonus: number; damage: string; xpValue: number}>;
	minDay?: number;        // minimum dayNumber for this encounter to appear
	weight: number;         // relative probability weight
}

// ── Enemy ──────────────────────────────────────────────────
export interface Enemy {
	id: string;
	name: string;
	description: string;
	type: 'infiltrator' | 'drone' | 'construct' | 'boss' | 'swarm';
	hp: number;
	maxHp: number;
	ac: number;
	attackBonus: number;
	damage: string;           // e.g. "1d8+3"
	abilities: Partial<AbilityScores>;
	skills: Partial<Record<Skill, number>>;
	xpValue: number;
	loot: string[];           // item ids
	special: string[];        // special abilities
	alive: boolean;
}

// ── Combat ─────────────────────────────────────────────────
export interface CombatState {
	active: boolean;
	round: number;
	initiativeOrder: Array<{ id: string; type: 'player' | 'enemy'; initiative: number }>;
	currentTurn: number;      // index in initiative order
	location: string;
}

// ── Quest ──────────────────────────────────────────────────
export interface Quest {
	id: string;
	name: string;
	description: string;
	status: 'unknown' | 'active' | 'complete' | 'failed';
	objectives: Array<{
		description: string;
		complete: boolean;
	}>;
	xpReward: number;
	itemRewards: string[];
	giver: string;            // npc id
}

// ── Party ─────────────────────────────────────────────────
export interface Party {
	id: string;
	name: string;
	leaderId: string;         // character id of party leader
	memberIds: string[];      // character ids in the party
	pendingInvites: string[]; // character ids invited but not yet joined
	createdAt: string;
}

// ── Game State (the whole persistent world) ────────────────
export interface GameState {
	worldTime: string;        // in-game time
	dayNumber: number;
	actionCounter: number;    // increments per processAction call; drives auto time advancement
	combatSecondsElapsed?: number;  // tracks 6-second combat rounds for clock ticking
	players: Record<string, Character>;   // keyed by player id
	locations: Record<string, Location>;
	npcs: Record<string, NPC>;
	enemies: Record<string, Enemy>;
	quests: Record<string, Quest>;
	combat: CombatState;
	parties: Record<string, Party>;        // keyed by party id
	globalFlags: Record<string, boolean>; // world-state flags
	invasionLevel: number;    // 0-100, how far the invasion has progressed
	gameLog: GameLogEntry[];  // recent events
}

export interface GameLogEntry {
	timestamp: string;
	type: 'narration' | 'action' | 'combat' | 'system' | 'dialogue' | 'roll';
	actor?: string;           // who triggered this
	targetPlayer?: string;    // if set, only this player sees the entry (private narration/rolls)
	targetParty?: string;     // if set, all party members see the entry
	text: string;
	roll?: {
		dice: string;
		result: number;
		modifier: number;
		total: number;
		success?: boolean;
		dc?: number;
	};
}

// ── Player Session ─────────────────────────────────────────
export interface PlayerSession {
	playerId: string;
	playerName: string;
	characterId: string | null; // null until character is created
	connectedAt: string;
	lastAction: string;
}

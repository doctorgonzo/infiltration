// ═══════════════════════════════════════════════════════════
// THE DIRECTOR — Claude as Game Master
//
// Claude reads the world state, processes player actions,
// rolls dice, manages combat, and narrates everything.
// Tool use keeps the game honest.
// ═══════════════════════════════════════════════════════════

import { getState, saveState, addLogEntry, getPlayersAtLocation, isCharacterActive, createParty, getPlayerParty, inviteToParty, joinParty, leaveParty, disbandParty, getPartyMembers, findPendingInvite, getCharacter } from './state';
import * as dice from './dice';
import { ITEMS, ENCOUNTER_TABLES } from '$lib/server/world/madison';
import type { GameLogEntry, Character, GameState, EncounterEntry, NPC } from '$lib/types';
import { env } from '$env/dynamic/private';
import { readFileSync } from 'fs';
import { join } from 'path';

// SvelteKit's $env/dynamic/private only loads .env in `vite dev`; the adapter-node
// production build (`npm run start`) does NOT, and HMR can drop vars too. So every
// env lookup falls back to parsing .env off disk directly (parsed once, cached).
let _dotenvCache: Record<string, string> | null = null;
function readDotenv(): Record<string, string> {
	if (_dotenvCache) return _dotenvCache;
	const out: Record<string, string> = {};
	try {
		const file = readFileSync(join(process.cwd(), '.env'), 'utf8');
		for (const line of file.split('\n')) {
			const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
			if (m) out[m[1]] = m[2].trim();
		}
	} catch {}
	_dotenvCache = out;
	return out;
}
function envVar(name: string): string {
	return (env as any)[name] || process.env[name] || readDotenv()[name] || '';
}

function getApiKey(): string {
	const key = envVar('ANTHROPIC_API_KEY');
	if (!key) console.error('[director] NO API KEY FOUND anywhere');
	return key;
}

// ── Director backend selection ─────────────────────────────
// 'cloud' = Anthropic Messages API (Sonnet/Haiku).
// 'local' = Ollama OpenAI-compatible endpoint (e.g. Qwen-32B) via getOllamaUrl().
function getDirectorBackend(): 'cloud' | 'local' {
	return (envVar('DIRECTOR_BACKEND') || 'cloud').toLowerCase() === 'local' ? 'local' : 'cloud';
}
function getLocalDirectorModel(): string {
	return envVar('LOCAL_DIRECTOR_MODEL') || 'qwen2.5:32b-instruct';
}

// Anthropic-shaped request the loop builds; both backends consume it and return
// Anthropic-shaped content blocks so the tool loop never has to care which is live.
type DirectorRequest = {
	system: Array<{ type: string; text: string; cache_control?: unknown }>;
	messages: any[];
	tools: any[];
	enforcementMode: boolean;
};
type NormalizedResponse = { content: any[]; stop_reason: string; usage?: any };

async function callDirectorLLM(req: DirectorRequest): Promise<NormalizedResponse> {
	return getDirectorBackend() === 'local' ? callLocalDirector(req) : callCloudDirector(req);
}

async function callCloudDirector(req: DirectorRequest): Promise<NormalizedResponse> {
	const { system, messages, tools, enforcementMode } = req;
	const response = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-api-key': getApiKey(),
			'anthropic-version': '2023-06-01',
			'anthropic-beta': 'prompt-caching-2024-07-31'
		},
		body: JSON.stringify({
			// Sonnet for primary narration + tool decisions, Haiku for enforcement rounds.
			model: enforcementMode ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6',
			max_tokens: 1024,
			temperature: 0.8,
			system,
			messages,
			tools,
			...(enforcementMode ? { tool_choice: { type: 'any' as const } } : {})
		})
	});
	if (!response.ok) {
		throw new Error(`API ${response.status}: ${(await response.text()).substring(0, 200)}`);
	}
	return await response.json();
}

// Translate the Anthropic-shaped request to OpenAI chat-completions, call Ollama,
// and translate the reply back to Anthropic content blocks. cache_control is dropped
// (no-op here); the system array is flattened to one string; tool_use/tool_result
// blocks become tool_calls / role:"tool" messages.
async function callLocalDirector(req: DirectorRequest): Promise<NormalizedResponse> {
	const { system, messages, tools, enforcementMode } = req;

	const systemText = system.map((b) => b.text).join('\n\n');
	const oaiMessages: any[] = [{ role: 'system', content: systemText }];

	for (const m of messages) {
		if (typeof m.content === 'string') {
			oaiMessages.push({ role: m.role, content: m.content });
			continue;
		}
		const blocks = Array.isArray(m.content) ? m.content : [];
		if (m.role === 'assistant') {
			const text = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
			const toolUses = blocks.filter((b: any) => b.type === 'tool_use');
			const msg: any = { role: 'assistant', content: text };
			if (toolUses.length) {
				msg.tool_calls = toolUses.map((b: any) => ({
					id: b.id,
					type: 'function',
					function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) }
				}));
			}
			oaiMessages.push(msg);
		} else {
			const toolResults = blocks.filter((b: any) => b.type === 'tool_result');
			if (toolResults.length) {
				for (const tr of toolResults) {
					oaiMessages.push({
						role: 'tool',
						tool_call_id: tr.tool_use_id,
						content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content)
					});
				}
			} else {
				const text = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
				oaiMessages.push({ role: 'user', content: text });
			}
		}
	}

	const oaiTools = tools.map((t: any) => ({
		type: 'function',
		function: { name: t.name, description: t.description, parameters: t.input_schema }
	}));

	const response = await fetch(getOllamaUrl(), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: getLocalDirectorModel(),
			max_tokens: 1024,
			temperature: 0.8,
			messages: oaiMessages,
			tools: oaiTools,
			...(enforcementMode ? { tool_choice: 'required' } : {})
		})
	});
	if (!response.ok) {
		throw new Error(`Local model ${response.status}: ${(await response.text()).substring(0, 200)}`);
	}

	const data = await response.json();
	const msg = data.choices?.[0]?.message ?? {};
	const finish = data.choices?.[0]?.finish_reason;

	const content: any[] = [];
	if (msg.content && msg.content.trim()) content.push({ type: 'text', text: msg.content });
	if (Array.isArray(msg.tool_calls)) {
		for (const tc of msg.tool_calls) {
			let input: any = {};
			try { input = JSON.parse(tc.function?.arguments || '{}'); } catch { input = {}; }
			content.push({
				type: 'tool_use',
				id: tc.id || `call_${Math.random().toString(36).slice(2)}`,
				name: tc.function?.name,
				input
			});
		}
	}

	const stop_reason =
		Array.isArray(msg.tool_calls) && msg.tool_calls.length ? 'tool_use'
		: finish === 'length' ? 'max_tokens'
		: 'end_turn';

	const usage = data.usage
		? { input_tokens: data.usage.prompt_tokens ?? 0, output_tokens: data.usage.completion_tokens ?? 0 }
		: undefined;

	return { content, stop_reason, usage };
}

// ── Tool Definitions for Claude ────────────────────────────

// ── Infiltrator Progression Gate ──────────────────────────
// Controls how many NPCs can be infiltrators based on in-game day.
// The Director can convert NPCs using the convert_npc tool, but
// the code enforces the cap. Day 1 is slow — mostly normal.
function getMaxInfiltrators(dayNumber: number): number {
	//  Day 1: 1  — just Maya, everything's normal
	//  Day 2: 1  — still quiet, maybe a weird vibe
	//  Day 3: 2  — one more slips through
	//  Day 4: 2  — tension building but nothing confirmed
	//  Day 5: 3  — pattern starts to emerge
	//  Day 6: 3  — the player should be getting suspicious
	//  Day 7: 4  — okay something is definitely wrong
	//  Day 8: 5  — acceleration begins
	//  Day 9: 7  — hard to trust anyone
	// Day 10+: 999 — floodgates, full invasion, shit hits the fan
	const curve: Record<number, number> = {
		1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 5, 9: 7
	};
	return curve[dayNumber] ?? 999;
}

// ── Tool Enforcement ─────────────────────────────────────
// Detects when the Director narrated state changes without calling the
// corresponding tools. Returns a correction prompt or null.

function detectMissedTools(narration: string, toolsCalled: string[]): string | null {
	const text = narration.toLowerCase();
	const missed: string[] = [];

	// Item acquisition — player ACTUALLY receiving/taking items (not offers, descriptions, or mentioning existing gear)
	if (!toolsCalled.includes('give_item')) {
		const itemAcquirePattern = /\b(you (?:pick|grab|take|pocket|stow|tuck|clip|collect|loot)|(?:picked|grabbed|took|pocketed|stowed|tucked|clipped|collected|looted) (?:the|a|your|it|them)|hands? you (?:a|the|an)|gives? you (?:a|the|an)|slides? you (?:a|the|an)|(?:goes?|go) (?:in|into) your (?:pocket|bag|pack|belt|holster|jacket))\b/;
		if (itemAcquirePattern.test(text)) {
			missed.push('You described the player ACQUIRING items but did NOT call give_item. Items only exist in inventory if you call give_item. Call give_item NOW for EACH item acquired.');
		}
	}

	// Item loss — player ACTUALLY dropping/losing items (not hypotheticals)
	if (!toolsCalled.includes('remove_item')) {
		const itemLossPattern = /\b(you (?:drop|throw|toss|discard|lose)|(?:dropped|threw|tossed|discarded|lost) (?:the|your|a))\b/;
		if (itemLossPattern.test(text)) {
			missed.push('You described the player LOSING or DROPPING items but did NOT call remove_item. Call remove_item for each item lost.');
		}
	}

	// Healing — player ACTUALLY being healed (not mentioning items or offering aid)
	if (!toolsCalled.includes('modify_hp')) {
		const healPattern = /\b(you(?:'re| are) (?:healed|patched|bandaged|treated)|(?:patches|bandages|treats|heals) (?:you|your wound)|(?:your )?(?:wounds?|injuries?) (?:heal|close|mend)|(?:hp|health|hit points?) (?:restored|recovered|regained)|applies? (?:the |a )?(?:bandage|medkit|first aid) to (?:you|your))\b/;
		if (healPattern.test(text)) {
			missed.push('You described HEALING but did NOT call modify_hp. Call modify_hp with a POSITIVE amount.');
		}
	}

	// Wealth changes — money ACTUALLY changing hands (not prices/menus/offers)
	if (!toolsCalled.includes('modify_wealth')) {
		const wealthPattern = /\b(you (?:pay|spend|hand over|slide|fork|pull|peel)|(?:paid|spent|handed over|forked over) \$|(?:costs?|charges?) you \$|you (?:buy|bought|purchase)|(?:a |the )(?:twenty|ten|five|fifty|hundred|bill|cash|money|dollar).*(?:across|over|on|to )|(?:from|out of) your (?:wallet|pocket|cash|money)|(?:slide|push|slap|toss|drop).*(?:\$|dollar|buck|twenty|ten|five|fifty|hundred|bill))\b/;
		if (wealthPattern.test(text)) {
			missed.push('You described a FINANCIAL transaction but did NOT call modify_wealth. Call modify_wealth to update the player\'s money.');
		}
	}

	// Combat kills — narrated killing enemies without awarding XP
	if (!toolsCalled.includes('award_xp')) {
		const killPattern = /\b((?:drops?|falls?|collapses?|crumples?|slumps?|goes? down|goes? limp|hits? the (?:floor|ground|pavement|deck)|(?:is|are) dead|(?:dies?|killed?|slain|finished|dispatched|eliminated|neutralized|destroyed|defeated)))\b/;
		if (killPattern.test(text)) {
			missed.push('You described an enemy being KILLED or DEFEATED but did NOT call award_xp. Call award_xp NOW for each enemy killed. Use their xp_value from their stat block.');
		}
	}

	// Good roleplay / clever solutions — if skill checks succeeded, award XP
	if (!toolsCalled.includes('award_xp') && toolsCalled.includes('skill_check')) {
		missed.push('A skill check was performed but no XP was awarded. Call award_xp with 10-25 XP for successful skill use, or 25-50 XP for clever/creative solutions.');
	}

	if (missed.length > 0) {
		return '[SYSTEM — TOOL ENFORCEMENT]\n' +
			missed.join('\n') +
			'\n\nIMPORTANT: Do NOT output any text. Do NOT narrate. Do NOT explain yourself. ONLY call the missing tools. Any text you output will be discarded.';
	}
	return null;
}

function countInfiltrators(state: GameState): number {
	return Object.values(state.npcs).filter(n => n.isInfiltrator && n.alive).length;
}

// ── Random Encounter Check ──────────────────────────────────
function checkForEncounter(state: GameState, locationType: string, dangerLevel: number): EncounterEntry | null {
	const table = ENCOUNTER_TABLES[locationType];
	if (!table || table.length === 0) return null;

	// dangerLevel 0 = no encounters ever
	if (dangerLevel <= 0) return null;

	// Encounter chance scales with danger: dangerLevel * 10%
	const encounterChance = dangerLevel * 0.1;
	if (Math.random() > encounterChance) return null;

	// Filter entries by minDay requirement
	let eligible = table.filter(entry => {
		if (entry.minDay && state.dayNumber < entry.minDay) return false;
		return true;
	});

	// In high-danger areas (7+), remove 'none' entries — always something happens
	if (dangerLevel >= 7) {
		eligible = eligible.filter(entry => entry.type !== 'none');
	}

	if (eligible.length === 0) return null;

	// Weighted random selection
	const totalWeight = eligible.reduce((sum, entry) => sum + entry.weight, 0);
	let roll = Math.random() * totalWeight;
	for (const entry of eligible) {
		roll -= entry.weight;
		if (roll <= 0) {
			return entry.type === 'none' ? null : entry;
		}
	}

	return null;
}

const TOOLS = [
	{
		name: 'roll_dice',
		description: 'Roll dice using standard notation for any random outcome.',
		input_schema: {
			type: 'object',
			properties: {
				expression: { type: 'string', description: 'Dice expression, e.g. "1d20+5", "2d6+3", "1d4"' },
				reason: { type: 'string', description: 'What the roll is for, e.g. "attack roll", "Spot check DC 15"' }
			},
			required: ['expression', 'reason']
		}
	},
	{
		name: 'skill_check',
		description: 'd20 skill check; modifiers auto-calculated.',
		input_schema: {
			type: 'object',
			properties: {
				character_id: { type: 'string', description: 'Character performing the check' },
				skill: { type: 'string', description: 'Skill being used' },
				dc: { type: 'number', description: 'Difficulty class' },
				description: { type: 'string', description: 'What they are trying to do' }
			},
			required: ['character_id', 'skill', 'dc', 'description']
		}
	},
	{
		name: 'attack',
		description: 'Attack roll + damage.',
		input_schema: {
			type: 'object',
			properties: {
				attacker_id: { type: 'string', description: 'Attacker character/enemy ID' },
				target_id: { type: 'string', description: 'Target character/enemy ID' },
				weapon: { type: 'string', description: 'Weapon used (or "unarmed")' }
			},
			required: ['attacker_id', 'target_id']
		}
	},
	{
		name: 'modify_hp',
		description: 'Adjust HP. Positive heals, negative damages.',
		input_schema: {
			type: 'object',
			properties: {
				target_id: { type: 'string', description: 'Character/enemy ID' },
				amount: { type: 'number', description: 'HP change (+ heal, − damage)' },
				reason: { type: 'string', description: 'Why HP is changing' }
			},
			required: ['target_id', 'amount', 'reason']
		}
	},
	{
		name: 'move_character',
		description: 'Move a character to a connected location.',
		input_schema: {
			type: 'object',
			properties: {
				character_id: { type: 'string', description: 'Character to move' },
				destination: { type: 'string', description: 'Destination location ID' }
			},
			required: ['character_id', 'destination']
		}
	},
	{
		name: 'give_item',
		description: 'Add an item to inventory. Use a known item_id, or provide name + description + item_type for new items.',
		input_schema: {
			type: 'object',
			properties: {
				character_id: { type: 'string', description: 'Recipient character ID' },
				item_id: { type: 'string', description: 'Known item ID, or a snake_case id for a new item' },
				name: { type: 'string', description: 'Display name (new items), e.g. "Crowbar"' },
				description: { type: 'string', description: 'Description (new items)' },
				item_type: { type: 'string', enum: ['weapon', 'armor', 'gear', 'consumable', 'quest', 'junk'], description: 'Type (new items)' },
				damage: { type: 'string', description: 'Damage dice for weapons, e.g. "1d6"' },
				damage_type: { type: 'string', description: 'Damage type (bludgeoning, slashing, ballistic, etc.)' },
				ac_bonus: { type: 'number', description: 'AC bonus for armor' },
				effect: { type: 'string', description: 'Effect (consumables)' },
				uses: { type: 'number', description: 'Uses (consumables)' },
				value: { type: 'number', description: 'Value in dollars' }
			},
			required: ['character_id', 'item_id']
		}
	},
	{
		name: 'remove_item',
		description: 'Remove an item from inventory.',
		input_schema: {
			type: 'object',
			properties: {
				character_id: { type: 'string', description: 'Character losing the item' },
				item_id: { type: 'string', description: 'Item ID to remove' }
			},
			required: ['character_id', 'item_id']
		}
	},
	{
		name: 'update_quest',
		description: 'Update quest status.',
		input_schema: {
			type: 'object',
			properties: {
				quest_id: { type: 'string', description: 'Quest ID' },
				action: { type: 'string', enum: ['activate', 'complete', 'fail', 'complete_objective'], description: 'What to do' },
				objective_index: { type: 'number', description: 'For complete_objective: objective index (0-based)' }
			},
			required: ['quest_id', 'action']
		}
	},
	{
		name: 'set_flag',
		description: 'Set a world state flag.',
		input_schema: {
			type: 'object',
			properties: {
				flag: { type: 'string', description: 'Flag name' },
				value: { type: 'boolean', description: 'Flag value' }
			},
			required: ['flag', 'value']
		}
	},
	{
		name: 'spawn_enemy',
		description: 'Create an enemy at a location. Required before start_combat or attack. Returns the enemy ID.',
		input_schema: {
			type: 'object',
			properties: {
				id: { type: 'string', description: 'Unique snake_case ID, e.g. "drone_1"' },
				name: { type: 'string', description: 'Display name' },
				description: { type: 'string', description: 'Brief description' },
				type: { type: 'string', enum: ['infiltrator', 'drone', 'construct', 'boss', 'swarm'], description: 'Enemy type' },
				hp: { type: 'number', description: 'HP (10-30 grunts, 50+ bosses)' },
				ac: { type: 'number', description: 'AC (12-16 typical)' },
				attack_bonus: { type: 'number', description: 'Attack bonus (+3 to +6 typical)' },
				damage: { type: 'string', description: 'Damage dice, e.g. "1d6+2"' },
				xp_value: { type: 'number', description: 'XP on kill (25-200)' },
				location: { type: 'string', description: 'Location ID' }
			},
			required: ['id', 'name', 'type', 'hp', 'ac', 'attack_bonus', 'damage', 'xp_value', 'location']
		}
	},
	{
		name: 'start_combat',
		description: 'Start combat with already-spawned enemies.',
		input_schema: {
			type: 'object',
			properties: {
				location: { type: 'string', description: 'Location ID' },
				enemy_ids: { type: 'array', items: { type: 'string' }, description: 'Enemy IDs (must be spawned first)' }
			},
			required: ['location', 'enemy_ids']
		}
	},
	{
		name: 'end_combat',
		description: 'End combat.',
		input_schema: {
			type: 'object',
			properties: {
				reason: { type: 'string', description: 'Why combat ended (victory, flee, etc.)' }
			},
			required: ['reason']
		}
	},
	{
		name: 'modify_inebriation',
		description: 'Adjust inebriation (0=sober, 10=obliterated). +1 beer/shot, +2 cocktail/joint, +3 heavy dose.',
		input_schema: {
			type: 'object',
			properties: {
				character_id: { type: 'string', description: 'Character ID' },
				amount: { type: 'number', description: 'Change (+ up, − down)' },
				reason: { type: 'string', description: 'What they consumed' }
			},
			required: ['character_id', 'amount', 'reason']
		}
	},
	{
		name: 'award_xp',
		description: 'Award XP to a character.',
		input_schema: {
			type: 'object',
			properties: {
				character_id: { type: 'string', description: 'Recipient character ID' },
				amount: { type: 'number', description: 'XP to award (positive)' },
				reason: { type: 'string', description: 'Why earned' }
			},
			required: ['character_id', 'amount', 'reason']
		}
	},
	{
		name: 'modify_wealth',
		description: 'Adjust money. Positive gains, negative spends.',
		input_schema: {
			type: 'object',
			properties: {
				character_id: { type: 'string', description: 'Character ID' },
				amount: { type: 'number', description: 'Amount (+ gain, − spend)' },
				reason: { type: 'string', description: 'Transaction reason' }
			},
			required: ['character_id', 'amount', 'reason']
		}
	},
	{
		name: 'convert_npc',
		description: 'Mark an NPC as an infiltrator. Day-gated; refuses if cap is reached.',
		input_schema: {
			type: 'object',
			properties: {
				npc_id: { type: 'string', description: 'NPC to convert' },
				reason: { type: 'string', description: 'Narrative reason, e.g. "replaced overnight"' }
			},
			required: ['npc_id']
		}
	},
	{
		name: 'stealth_check',
		description: 'Opposed stealth: Hide/Move Silently vs Spot/Listen. Adds "hidden" condition on success.',
		input_schema: {
			type: 'object',
			properties: {
				character_id: { type: 'string', description: 'Character attempting stealth' },
				opposing_id: { type: 'string', description: 'Enemy/NPC who might detect them' },
				context: { type: 'string', description: 'What they\'re doing, e.g. "sneaking past guard"' }
			},
			required: ['character_id', 'opposing_id', 'context']
		}
	},
	{
		name: 'modify_relationship',
		description: 'Adjust an NPC\'s relationship with the player. Updates score + attitude, adds a memory.',
		input_schema: {
			type: 'object',
			properties: {
				npc_id: { type: 'string', description: 'NPC whose relationship is changing' },
				change: { type: 'number', description: 'Score change, typically -20 to +20' },
				reason: { type: 'string', description: 'What caused it, e.g. "saved their life"' },
				memory: { type: 'string', description: 'Short memory the NPC retains, e.g. "Player fought off infiltrator in bar"' }
			},
			required: ['npc_id', 'change', 'reason', 'memory']
		}
	},
	{
		name: 'advance_time',
		description: 'Advance the clock when hours pass (travel, searching, waiting). Crossing midnight increments the day and escalates the infiltrator threat.',
		input_schema: {
			type: 'object',
			properties: {
				hours: { type: 'number', description: 'Hours to advance (1-8 typical)' },
				reason: { type: 'string', description: 'Why time is passing, e.g. "searching the building"' }
			},
			required: ['hours', 'reason']
		}
	},
	{
		name: 'rest',
		description: 'Rest and heal. Short = 1hr, 1d4 HP. Long = 8hr, level×1 HP, advances to next morning.',
		input_schema: {
			type: 'object',
			properties: {
				character_id: { type: 'string', description: 'Character resting' },
				rest_type: { type: 'string', enum: ['short', 'long'], description: 'short or long' }
			},
			required: ['character_id', 'rest_type']
		}
	},
	{
		name: 'start_romance',
		description: 'Hand scene to the romance engine for any romantic/sexual interaction.',
		input_schema: {
			type: 'object',
			properties: {
				character_id: { type: 'string', description: 'The player character' },
				npc_id: { type: 'string', description: 'The NPC being romanced — use their name in snake_case if no formal ID exists (e.g. "iris", "unit_7_gamma")' },
				npc_name: { type: 'string', description: 'The NPC\'s display name (e.g. "Iris", "Unit 7-Gamma", "Jenny Wu")' },
				context: { type: 'string', description: 'Describe the NPC in detail: their appearance, personality, species/nature (human, infiltrator, etc.), emotional state, and what they want. Then describe the setting, the mood, and what led to this moment. The romance engine has NO memory — this is all it knows.' }
			},
			required: ['character_id', 'npc_id', 'npc_name', 'context']
		}
	}
];

// ── Tool Execution ─────────────────────────────────────────

async function executeTool(name: string, input: any, state: GameState, actingPlayerId?: string): Promise<string> {
	// God mode: override all dice rolls to nat 20
	const isGodMode = actingPlayerId ? state.players[actingPlayerId]?.godMode === true : false;

	switch (name) {
		case 'roll_dice': {
			const result = dice.roll(input.expression);
			if (isGodMode) {
				result.natural = 20;
				result.rolls = [20];
				result.total = 20 + result.modifier;
				result.criticalHit = true;
				result.criticalMiss = false;
			}
			return JSON.stringify({
				expression: input.expression,
				reason: input.reason,
				rolls: result.rolls,
				natural: result.natural,
				modifier: result.modifier,
				total: result.total,
				criticalHit: result.criticalHit,
				criticalMiss: result.criticalMiss
			});
		}

		case 'skill_check': {
			const char = state.players[input.character_id];
			if (!char) return JSON.stringify({ error: 'Character not found' });
			const skillRanks = char.skills[input.skill as keyof typeof char.skills] ?? 0;
			const abilityMod = 0; // Simplified — director should know the modifier
			const result = dice.skillCheck(skillRanks, abilityMod, input.dc);
			if (isGodMode || char.godMode) {
				result.roll.natural = 20;
				result.roll.total = 20 + result.roll.modifier;
				result.success = true;
				result.margin = result.roll.total - input.dc;
			}
			// Track crit stats
			if (char.stats) {
				if (result.roll.natural === 20) char.stats.criticalHits++;
				if (result.roll.natural === 1) char.stats.criticalFails++;
			}
			return JSON.stringify({
				skill: input.skill,
				dc: input.dc,
				roll: result.roll.natural,
				modifier: result.roll.modifier,
				total: result.roll.total,
				success: result.success,
				margin: result.margin,
				description: input.description
			});
		}

		case 'attack': {
			// Look up attacker in players or enemies
			const attacker = state.players[input.attacker_id] ?? state.enemies[input.attacker_id];
			const target = state.players[input.target_id] ?? state.enemies[input.target_id];
			if (!attacker || !target) return JSON.stringify({ error: 'Attacker or target not found' });

			let attackBonus: number = 'attackBonus' in attacker ? (attacker as any).attackBonus : Math.floor(((attacker as any).level ?? 1) / 2);
			let targetAC: number = 'ac' in target ? (target as any).ac : 10;

			// Hidden attacker bonus: +2 attack, target loses Dex bonus to Defense
			const attackerPlayer = state.players[input.attacker_id];
			const attackerIsHidden = attackerPlayer?.conditions?.includes('hidden') ?? false;
			if (attackerIsHidden) {
				attackBonus += 2;
				// Target is flat-footed (loses Dex bonus to Defense)
				const targetEntity = state.players[input.target_id] ?? state.enemies[input.target_id];
				if (targetEntity && 'abilities' in targetEntity) {
					const targetDexMod = dice.abilityModifier((targetEntity.abilities as any)?.DEX ?? 10);
					if (targetDexMod > 0) {
						targetAC -= targetDexMod;
					}
				}
			}

			const result = dice.attackRoll(attackBonus, targetAC);
			if (isGodMode || (state.players[input.attacker_id]?.godMode)) {
				result.roll.natural = 20;
				result.roll.total = 20 + attackBonus;
				result.hit = true;
				result.critical = true;
			}
			let damageResult = null;

			if (result.hit) {
				const damageExpr = 'damage' in attacker && typeof attacker.damage === 'string'
					? attacker.damage
					: '1d4';
				damageResult = dice.rollDamage(damageExpr, result.critical);

				// Apply damage — d20 Modern death rules:
				//   0 HP = DISABLED, -1 to -9 = DYING, -10 = DEAD
				if ('hp' in target) {
					(target as any).hp = Math.min((target as any).maxHp ?? 999, (target as any).hp - damageResult.total);
					if ((target as any).hp <= -10) {
						(target as any).alive = false;
					} else if ((target as any).hp <= 0) {
						// Dying or disabled — add condition, NOT dead yet
						const conditions: string[] = (target as any).conditions ?? [];
						if ((target as any).hp === 0 && !conditions.includes('disabled')) {
							conditions.push('disabled');
						} else if ((target as any).hp < 0 && !conditions.includes('dying')) {
							// Remove disabled if they had it, add dying
							const idx = conditions.indexOf('disabled');
							if (idx !== -1) conditions.splice(idx, 1);
							conditions.push('dying');
						}
						(target as any).conditions = conditions;
					}
				}

				// Track stats
				const atkPlayer = state.players[input.attacker_id];
				const targetPlayer = state.players[input.target_id];
				if (atkPlayer?.stats) {
					atkPlayer.stats.damageDealt += damageResult.total;
					if (result.critical) atkPlayer.stats.criticalHits++;
					if ((target as any).hp <= -10 && !(target as any).alive) {
						atkPlayer.stats.enemiesKilled++;
						// Auto-award XP on kill — don't rely on the Director
						const xpValue = (target as any).xpValue ?? 50;
						atkPlayer.xp += xpValue;
						console.log(`[director] 🏆 Auto-awarded ${xpValue} XP to ${atkPlayer.name} for killing ${(target as any).name}`);
						// Check for level up (every 1000 XP)
						const newLevel = Math.floor(atkPlayer.xp / 1000) + 1;
						if (newLevel > atkPlayer.level) {
							atkPlayer.level = newLevel;
							const conMod = Math.floor((atkPlayer.abilities.CON - 10) / 2);
							const hitDieRoll = Math.floor(Math.random() * 6) + 1; // 1d6 base
							const hpGain = Math.max(1, hitDieRoll + conMod);
							atkPlayer.maxHp += hpGain;
							atkPlayer.hp += hpGain;
							addLogEntry({
								timestamp: new Date().toISOString(),
								type: 'system',
								text: `⚡ ${atkPlayer.name} reached LEVEL ${newLevel}! +${hpGain} HP (${atkPlayer.hp}/${atkPlayer.maxHp})`
							});
						}
					}
				}
				if (targetPlayer?.stats) {
					targetPlayer.stats.damageTaken += damageResult.total;
				}

				saveState();
			}

			// Remove hidden condition after attacking (attacker is revealed)
			if (attackerIsHidden && attackerPlayer) {
				attackerPlayer.conditions = attackerPlayer.conditions.filter(c => c !== 'hidden');
				saveState();
			}

			return JSON.stringify({
				attacker: input.attacker_id,
				target: input.target_id,
				attackRoll: result.roll.natural,
				attackTotal: result.roll.total,
				targetAC: targetAC,
				hit: result.hit,
				critical: result.critical,
				damage: damageResult?.total ?? 0,
				damageRolls: damageResult?.rolls ?? [],
				targetHp: (target as any).hp ?? 0,
				targetAlive: (target as any).alive ?? true,
				...(attackerIsHidden ? { surprise: true, stealthBonus: '+2 attack, target flat-footed' } : {})
			});
		}

		case 'modify_hp': {
			const target = state.players[input.target_id] ?? state.enemies[input.target_id];
			if (!target) return JSON.stringify({ error: 'Target not found' });
			const oldHp = (target as any).hp;
			// d20 Modern: HP can go negative. 0 = DISABLED, -1 to -9 = DYING, -10 = DEAD.
			// Healing (positive amount) caps at maxHp. Damage (negative) has no floor.
			const newHp = input.amount > 0
				? Math.min((target as any).maxHp, oldHp + input.amount)
				: oldHp + input.amount;
			(target as any).hp = newHp;

			if (newHp <= -10) {
				(target as any).alive = false;
			} else if (newHp <= 0) {
				// Dying or disabled — track condition
				const conditions: string[] = (target as any).conditions ?? [];
				if (newHp === 0 && !conditions.includes('disabled')) {
					// Remove dying if healed to exactly 0
					const dyingIdx = conditions.indexOf('dying');
					if (dyingIdx !== -1) conditions.splice(dyingIdx, 1);
					conditions.push('disabled');
				} else if (newHp < 0 && !conditions.includes('dying')) {
					const disIdx = conditions.indexOf('disabled');
					if (disIdx !== -1) conditions.splice(disIdx, 1);
					conditions.push('dying');
				}
				(target as any).conditions = conditions;
			} else {
				// HP > 0 — remove dying/disabled if present (healed back up)
				const conditions: string[] = (target as any).conditions ?? [];
				const dyingIdx = conditions.indexOf('dying');
				if (dyingIdx !== -1) conditions.splice(dyingIdx, 1);
				const disIdx = conditions.indexOf('disabled');
				if (disIdx !== -1) conditions.splice(disIdx, 1);
				(target as any).conditions = conditions;
			}

			saveState();
			return JSON.stringify({ target: input.target_id, oldHp, newHp, reason: input.reason });
		}

		case 'move_character': {
			const char = state.players[input.character_id];
			if (!char) return JSON.stringify({ error: 'Character not found' });
			const currentLoc = state.locations[char.location];
			const destLoc = state.locations[input.destination];
			if (!destLoc) return JSON.stringify({ error: 'Destination not found' });
			if (!currentLoc?.connections.includes(input.destination)) {
				return JSON.stringify({ error: 'Cannot reach that location from here' });
			}
			char.location = input.destination;
			destLoc.discovered = true;
			saveState();

			const moveResult: Record<string, any> = {
				character: char.name,
				from: currentLoc.name,
				to: destLoc.name,
				description: destLoc.description,
				npcsHere: destLoc.npcs.map(id => state.npcs[id]?.name).filter(Boolean),
				enemiesHere: destLoc.enemies.map(id => state.enemies[id]).filter(e => e?.alive).map(e => e.name),
				itemsHere: destLoc.items
			};

			// ── Random encounter check ──
			const encounter = checkForEncounter(state, destLoc.type, destLoc.dangerLevel);
			if (encounter) {
				moveResult.encounter = {
					name: encounter.name,
					type: encounter.type,
					description: encounter.description
				};

				if (encounter.type === 'combat' && encounter.enemies) {
					// Auto-spawn enemies from the encounter table
					const spawnedIds: string[] = [];
					const enemyTemplates = encounter.enemies;
					for (let i = 0; i < enemyTemplates.length; i++) {
						const template = enemyTemplates[i];
						const enemyId = `enc_${template.name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}_${i}`;
						const enemy = {
							id: enemyId,
							name: template.name,
							description: encounter.description,
							type: 'infiltrator' as const,
							hp: template.hp,
							maxHp: template.hp,
							ac: template.ac,
							attackBonus: template.attackBonus,
							damage: template.damage,
							abilities: {},
							skills: {},
							xpValue: template.xpValue,
							loot: [],
							special: [],
							alive: true
						};
						state.enemies[enemyId] = enemy as any;
						if (!destLoc.enemies.includes(enemyId)) {
							destLoc.enemies.push(enemyId);
						}
						spawnedIds.push(enemyId);
					}
					saveState();
					moveResult.encounter.spawnedEnemyIds = spawnedIds;
					moveResult.encounter.combatReady = true;
				}
			}

			return JSON.stringify(moveResult);
		}

		case 'give_item': {
			const char = state.players[input.character_id];
			if (!char) return JSON.stringify({ error: 'Character not found' });

			// Guard: only give items if the player explicitly asked to pick up / take / grab something.
			// The Director loves auto-looting cheese curds and flashlights. No.
			if (_lastPlayerAction) {
				const pickupWords = /\b(pick up|pick it up|grab|take|pocket|stow|loot|collect|get the|get it|snag|nab|scoop|swipe|yoink|claim|keep it|put .* in .* (?:bag|pocket|pack|inventory)|equip)\b/i;
				// Allow: NPC handing player something as quest reward, or buying something
				const receiveWords = /\b(buy|purchase|accept|receive|order)\b/i;
				if (!pickupWords.test(_lastPlayerAction) && !receiveWords.test(_lastPlayerAction)) {
					return JSON.stringify({ error: 'Player did not ask to pick up or take this item. Describe items in the environment but do NOT add them to inventory unless the player explicitly picks them up.' });
				}
			}

			// Check known items first
			const knownItem = ITEMS[input.item_id];
			if (knownItem) {
				char.inventory.push({ ...knownItem });
				if (char.stats) char.stats.itemsFound++;
				const loc = state.locations[char.location];
				if (loc) {
					loc.items = loc.items.filter(i => i !== input.item_id);
				}
				saveState();
				return JSON.stringify({ character: char.name, item: knownItem.name, action: 'received' });
			}

			// Create ad-hoc item from Director's description
			if (input.name) {
				const newItem = {
					id: input.item_id,
					name: input.name,
					description: input.description || 'No description.',
					weight: 1,
					type: input.item_type || 'gear',
					...(input.damage ? { damage: input.damage, damageType: input.damage_type || 'bludgeoning', range: 0 } : {}),
					...(input.ac_bonus ? { acBonus: input.ac_bonus } : {}),
					...(input.effect ? { effect: input.effect } : {}),
					...(input.uses ? { uses: input.uses } : {}),
					value: input.value ?? 0,
					critRange: 20,
					critMultiplier: 2
				};
				char.inventory.push(newItem as any);
				if (char.stats) char.stats.itemsFound++;
				saveState();
				return JSON.stringify({ character: char.name, item: newItem.name, action: 'created and received' });
			}

			return JSON.stringify({ error: 'Item not found. For new items, provide name, description, and item_type.' });
		}

		case 'remove_item': {
			const char = state.players[input.character_id];
			if (!char) return JSON.stringify({ error: 'Character not found' });
			const idx = char.inventory.findIndex(i => i.id === input.item_id);
			if (idx >= 0) {
				const removed = char.inventory.splice(idx, 1)[0];
				saveState();
				return JSON.stringify({ character: char.name, item: removed.name, action: 'removed' });
			}
			return JSON.stringify({ error: 'Item not in inventory' });
		}

		case 'update_quest': {
			const quest = state.quests[input.quest_id];
			if (!quest) return JSON.stringify({ error: 'Quest not found' });
			if (input.action === 'activate') quest.status = 'active';
			else if (input.action === 'complete') quest.status = 'complete';
			else if (input.action === 'fail') quest.status = 'failed';
			else if (input.action === 'complete_objective' && input.objective_index !== undefined) {
				if (quest.objectives[input.objective_index]) {
					quest.objectives[input.objective_index].complete = true;
				}
			}
			saveState();
			return JSON.stringify({ quest: quest.name, status: quest.status, objectives: quest.objectives });
		}

		case 'set_flag': {
			state.globalFlags[input.flag] = input.value;
			saveState();
			return JSON.stringify({ flag: input.flag, value: input.value });
		}

		case 'spawn_enemy': {
			const enemy = {
				id: input.id,
				name: input.name,
				description: input.description ?? '',
				type: input.type,
				hp: input.hp,
				maxHp: input.hp,
				ac: input.ac,
				attackBonus: input.attack_bonus,
				damage: input.damage,
				abilities: {},
				skills: {},
				xpValue: input.xp_value,
				loot: [],
				special: [],
				alive: true
			};
			state.enemies[input.id] = enemy as any;
			// Add to location's enemy list
			const loc = state.locations[input.location];
			if (loc && !loc.enemies.includes(input.id)) {
				loc.enemies.push(input.id);
			}
			saveState();
			return JSON.stringify({ spawned: input.id, name: input.name, hp: input.hp, ac: input.ac });
		}

		case 'start_combat': {
			const players = getPlayersAtLocation(input.location);
			const enemies = input.enemy_ids.map((id: string) => state.enemies[id]).filter(Boolean);

			const initiative: Array<{ id: string; type: 'player' | 'enemy'; initiative: number }> = [];

			for (const p of players) {
				const dexMod = dice.abilityModifier(p.abilities.DEX);
				const init = dice.rollInitiative(dexMod);
				initiative.push({ id: p.id, type: 'player', initiative: init.total });
			}
			for (const e of enemies) {
				const dexMod = dice.abilityModifier(e.abilities?.DEX ?? 10);
				const init = dice.rollInitiative(dexMod);
				initiative.push({ id: e.id, type: 'enemy', initiative: init.total });
			}

			initiative.sort((a, b) => b.initiative - a.initiative);

			state.combat = {
				active: true,
				round: 1,
				initiativeOrder: initiative,
				currentTurn: 0,
				location: input.location
			};
			saveState();
			return JSON.stringify({ combat: 'started', round: 1, initiative });
		}

		case 'end_combat': {
			state.combat = { active: false, round: 0, initiativeOrder: [], currentTurn: 0, location: '' };
			saveState();
			return JSON.stringify({ combat: 'ended', reason: input.reason });
		}

		case 'modify_inebriation': {
			const char = state.players[input.character_id];
			if (!char) return JSON.stringify({ error: 'Character not found' });

			// Guard: only increase inebriation if the player actually CONSUMED something.
			// "Order a drink" ≠ drinking it. They need to drink/sip/chug/have/down it.
			if (input.amount > 0 && _lastPlayerAction) {
				const consumeWords = /\b(drink|chug|sip|down|slam|knock back|have a|have an|have the|have some|having a|grab a|grab an|take a sip|take a drink|take a shot|take a hit|take a pull|pound|guzzle|nurse|finish|consume|smoke|toke|hit the|puff)\b/i;
				if (!consumeWords.test(_lastPlayerAction)) {
					return JSON.stringify({ error: 'Player did not consume a drink or substance — they may have only ordered it. Do not add inebriation until the player actually drinks/consumes. Narrate the drink being served instead.' });
				}
			}

			const oldLevel = char.inebriation ?? 0;
			char.inebriation = Math.max(0, Math.min(10, oldLevel + input.amount));
			if (input.amount > 0 && char.stats) char.stats.drinksConsumed++;
			saveState();
			return JSON.stringify({
				character: char.name,
				oldLevel,
				newLevel: char.inebriation,
				reason: input.reason
			});
		}

		case 'award_xp': {
			const char = state.players[input.character_id];
			if (!char) return JSON.stringify({ error: 'Character not found' });
			const oldXp = char.xp;
			char.xp += Math.max(0, input.amount);
			// Level up check — d20 Modern: 1000 XP per level
			const oldLevel = char.level;
			const newLevel = Math.floor(char.xp / 1000) + 1;
			if (newLevel > char.level) {
				char.level = newLevel;
				// HP increase on level up
				const conMod = Math.floor((char.abilities.CON - 10) / 2);
				const hitDie = { 'Strong Hero': 8, 'Fast Hero': 8, 'Tough Hero': 10, 'Smart Hero': 6, 'Dedicated Hero': 6, 'Charismatic Hero': 6 }[char.class] ?? 6;
				const hpGain = Math.max(1, Math.floor(hitDie / 2) + 1 + conMod);
				char.maxHp += hpGain;
				char.hp += hpGain;
			}
			saveState();
			return JSON.stringify({
				character: char.name,
				xpGained: input.amount,
				totalXp: char.xp,
				reason: input.reason,
				...(newLevel > oldLevel ? { levelUp: true, newLevel, message: `${char.name} leveled up to ${newLevel}!` } : {})
			});
		}

		case 'modify_wealth': {
			const char = state.players[input.character_id];
			if (!char) return JSON.stringify({ error: 'Character not found' });

			// Guard: only ADD money if the player explicitly picked it up or is being paid/rewarded.
			// Spending (negative amount) always allowed — that's the player choosing to pay.
			if (input.amount > 0 && _lastPlayerAction) {
				const moneyPickupWords = /\b(pick up|grab|take|pocket|collect|loot|keep|accept|receive|pick .* up)\b/i;
				const earnWords = /\b(sell|work|earn|reward|pay me|tip|bet|win|hustle)\b/i;
				if (!moneyPickupWords.test(_lastPlayerAction) && !earnWords.test(_lastPlayerAction)) {
					return JSON.stringify({ error: 'Player did not ask to pick up or collect this money. Describe money in the environment but do NOT add it to their wealth unless they explicitly take it.' });
				}
			}

			if (!char.stats) char.stats = { enemiesKilled: 0, damageDealt: 0, damageTaken: 0, moneyEarned: 0, moneySpent: 0, drinksConsumed: 0, itemsFound: 0, criticalHits: 0, criticalFails: 0, romances: 0, actionsPerformed: 0 };
			const oldWealth = char.wealth;
			char.wealth = Math.max(0, oldWealth + input.amount);
			if (input.amount > 0) char.stats.moneyEarned += input.amount;
			if (input.amount < 0) char.stats.moneySpent += Math.abs(input.amount);
			saveState();
			return JSON.stringify({
				character: char.name,
				oldWealth,
				newWealth: char.wealth,
				change: input.amount,
				reason: input.reason
			});
		}

		case 'convert_npc': {
			const npc = state.npcs[input.npc_id];
			if (!npc) return JSON.stringify({ error: `NPC '${input.npc_id}' not found. Available NPCs: ${Object.keys(state.npcs).join(', ')}` });
			if (npc.isInfiltrator) return JSON.stringify({ status: 'already_infiltrator', npc: npc.name, message: `${npc.name} is already an infiltrator.` });

			const maxAllowed = getMaxInfiltrators(state.dayNumber);
			const currentCount = countInfiltrators(state);
			if (currentCount >= maxAllowed) {
				return JSON.stringify({
					error: 'infiltrator_cap_reached',
					currentDay: state.dayNumber,
					maxInfiltrators: maxAllowed,
					currentInfiltrators: currentCount,
					message: `Cannot convert ${npc.name} — the infiltrator cap for Day ${state.dayNumber} is ${maxAllowed}, and ${currentCount} NPCs are already infiltrators. The invasion hasn't spread this far yet. Play it human.`
				});
			}

			npc.isInfiltrator = true;
			npc.attitude = 'neutral';
			saveState();
			return JSON.stringify({
				status: 'converted',
				npc: npc.name,
				npc_id: npc.id,
				reason: input.reason || 'replaced by infiltrator',
				currentDay: state.dayNumber,
				infiltratorCount: currentCount + 1,
				maxInfiltrators: maxAllowed
			});
		}

		case 'stealth_check': {
			const char = state.players[input.character_id];
			if (!char) return JSON.stringify({ error: 'Character not found' });

			const opponent = state.enemies[input.opposing_id] ?? state.npcs[input.opposing_id];
			if (!opponent) return JSON.stringify({ error: 'Opposing entity not found' });

			// Character stealth: higher of Hide or Move Silently, + Dex mod
			const hideRanks = char.skills['Hide'] ?? 0;
			const moveSilentRanks = char.skills['Move Silently'] ?? 0;
			const stealthRanks = Math.max(hideRanks, moveSilentRanks);
			const dexMod = dice.abilityModifier(char.abilities.DEX);
			let stealthMod = stealthRanks + dexMod;

			// Inebriation penalty: -2 per level
			const inebriationPenalty = (char.inebriation ?? 0) * -2;
			stealthMod += inebriationPenalty;

			// Darkness bonus: +2 if location is underground or dungeon type
			const loc = state.locations[char.location];
			const darknessBonus = (loc?.type === 'underground' || loc?.type === 'dungeon') ? 2 : 0;
			stealthMod += darknessBonus;

			// Opponent perception: higher of Spot or Listen, default +2
			const opponentSkills = opponent.skills ?? {};
			const spotRanks = opponentSkills['Spot'] ?? 0;
			const listenRanks = opponentSkills['Listen'] ?? 0;
			const perceptionRanks = Math.max(spotRanks, listenRanks);
			const perceptionMod = perceptionRanks > 0 ? perceptionRanks : 2;

			// Roll opposed checks
			const stealthRoll = dice.roll('1d20');
			const perceptionRoll = dice.roll('1d20');

			if (isGodMode || char.godMode) {
				stealthRoll.natural = 20;
				stealthRoll.rolls = [20];
				stealthRoll.total = 20;
			}

			const stealthTotal = stealthRoll.natural + stealthMod;
			const perceptionTotal = perceptionRoll.natural + perceptionMod;
			const success = stealthTotal >= perceptionTotal;

			if (success) {
				if (!char.conditions.includes('hidden')) {
					char.conditions.push('hidden');
				}
			}

			// Track crit stats
			if (char.stats) {
				if (stealthRoll.natural === 20) char.stats.criticalHits++;
				if (stealthRoll.natural === 1) char.stats.criticalFails++;
			}

			saveState();
			return JSON.stringify({
				context: input.context,
				stealth: {
					roll: stealthRoll.natural,
					skillBonus: stealthRanks,
					dexMod,
					inebriationPenalty: inebriationPenalty !== 0 ? inebriationPenalty : undefined,
					darknessBonus: darknessBonus !== 0 ? darknessBonus : undefined,
					totalModifier: stealthMod,
					total: stealthTotal
				},
				perception: {
					roll: perceptionRoll.natural,
					modifier: perceptionMod,
					total: perceptionTotal
				},
				success,
				result: success
					? `${char.name} is now hidden. (${stealthTotal} vs ${perceptionTotal})`
					: `${char.name} was detected! (${stealthTotal} vs ${perceptionTotal})`,
				hidden: success
			});
		}

		case 'modify_relationship': {
			const npc = state.npcs[input.npc_id];
			if (!npc) return JSON.stringify({ error: `NPC '${input.npc_id}' not found. Available NPCs: ${Object.keys(state.npcs).join(', ')}` });

			const oldScore = npc.relationshipScore ?? 0;
			const oldAttitude = npc.attitude;

			// Clamp score to -100/+100
			npc.relationshipScore = Math.max(-100, Math.min(100, oldScore + input.change));

			// Push memory, cap at 30 (drop oldest)
			if (!npc.memories) npc.memories = [];
			npc.memories.push(input.memory);
			if (npc.memories.length > 30) {
				npc.memories = npc.memories.slice(-30);
			}

			// Auto-update attitude based on score
			if (npc.relationshipScore < -50) {
				npc.attitude = 'hostile';
			} else if (npc.relationshipScore < -10) {
				npc.attitude = 'suspicious';
			} else if (npc.relationshipScore <= 20) {
				npc.attitude = 'neutral';
			} else {
				npc.attitude = 'friendly';
			}

			saveState();

			const attitudeChanged = oldAttitude !== npc.attitude;
			return JSON.stringify({
				npc: npc.name,
				npc_id: npc.id,
				oldScore,
				newScore: npc.relationshipScore,
				change: input.change,
				reason: input.reason,
				memory: input.memory,
				attitude: npc.attitude,
				...(attitudeChanged ? { attitudeChanged: true, oldAttitude, note: `${npc.name}'s demeanor shifted from ${oldAttitude} to ${npc.attitude}` } : {})
			});
		}

		case 'advance_time': {
			// Parse current time like "8:00 PM"
			const timeMatch = state.worldTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
			if (!timeMatch) return JSON.stringify({ error: 'Could not parse worldTime: ' + state.worldTime });
			let hour24 = parseInt(timeMatch[1]);
			const minutes = parseInt(timeMatch[2]);
			const ampm = timeMatch[3].toUpperCase();
			// Convert to 24h
			if (ampm === 'AM' && hour24 === 12) hour24 = 0;
			else if (ampm === 'PM' && hour24 !== 12) hour24 += 12;

			const oldDay = state.dayNumber;
			let totalHours = hour24 + input.hours;
			const daysAdvanced = Math.floor(totalHours / 24);
			totalHours = totalHours % 24;

			// Convert back to 12h format
			const newAmpm = totalHours >= 12 ? 'PM' : 'AM';
			let newHour12 = totalHours % 12;
			if (newHour12 === 0) newHour12 = 12;
			const newTimeStr = newHour12 + ':' + String(minutes).padStart(2, '0') + ' ' + newAmpm;

			state.worldTime = newTimeStr;
			state.dayNumber += daysAdvanced;

			// Log day transitions
			if (state.dayNumber > oldDay) {
				for (let d = oldDay + 1; d <= state.dayNumber; d++) {
					const dayMsg: GameLogEntry = {
						timestamp: new Date().toISOString(),
						type: 'system',
						text: '[DAY ' + d + ' BEGINS] The sun rises over Madison. The city feels different today.'
					};
					addLogEntry(dayMsg);
				}
			}

			saveState();
			return JSON.stringify({
				oldTime: timeMatch[0],
				newTime: newTimeStr,
				oldDay: oldDay,
				newDay: state.dayNumber,
				hoursAdvanced: input.hours,
				reason: input.reason,
				...(state.dayNumber > oldDay ? { dayAdvanced: true, newInfiltratorCap: getMaxInfiltrators(state.dayNumber) } : {})
			});
		}

		case 'rest': {
			const char = state.players[input.character_id];
			if (!char) return JSON.stringify({ error: 'Character not found' });
			if (!char.alive) return JSON.stringify({ error: char.name + ' is dead and cannot rest.' });
			if (state.combat.active) return JSON.stringify({ error: 'Cannot rest during combat!' });

			let hoursRested: number;
			let healed: number;

			if (input.rest_type === 'short') {
				// Short rest: 1 hour, heal 1d4
				hoursRested = 1;
				const healRoll = dice.roll('1d4');
				healed = healRoll.total;
			} else {
				// Long rest: 8 hours, heal level x 1 HP, advance to next morning
				hoursRested = 8;
				healed = char.level;

				// Long rest advances to next morning (6:00 AM)
				const timeMatch = state.worldTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
				if (timeMatch) {
					let hour24 = parseInt(timeMatch[1]);
					const ampm = timeMatch[3].toUpperCase();
					if (ampm === 'AM' && hour24 === 12) hour24 = 0;
					else if (ampm === 'PM' && hour24 !== 12) hour24 += 12;

					// If it's past 6 AM, we go to 6 AM NEXT day. If before 6 AM, just go to 6 AM same day.
					if (hour24 >= 6) {
						state.dayNumber++;
					}
					state.worldTime = '6:00 AM';

					const dayMsg: GameLogEntry = {
						timestamp: new Date().toISOString(),
						type: 'system',
						text: '[DAY ' + state.dayNumber + ' BEGINS] The sun rises over Madison. The city feels different today.'
					};
					addLogEntry(dayMsg);
				}
			}

			// Apply healing
			const oldHp = char.hp;
			char.hp = Math.min(char.maxHp, char.hp + healed);

			// If short rest, also advance time normally
			if (input.rest_type === 'short') {
				const timeMatch = state.worldTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
				if (timeMatch) {
					let hour24 = parseInt(timeMatch[1]);
					const minutes = parseInt(timeMatch[2]);
					const ampm = timeMatch[3].toUpperCase();
					if (ampm === 'AM' && hour24 === 12) hour24 = 0;
					else if (ampm === 'PM' && hour24 !== 12) hour24 += 12;
					const oldDay = state.dayNumber;
					let totalHours = hour24 + hoursRested;
					const daysAdv = Math.floor(totalHours / 24);
					totalHours = totalHours % 24;
					const newAmpm = totalHours >= 12 ? 'PM' : 'AM';
					let newHour12 = totalHours % 12;
					if (newHour12 === 0) newHour12 = 12;
					state.worldTime = newHour12 + ':' + String(minutes).padStart(2, '0') + ' ' + newAmpm;
					state.dayNumber += daysAdv;
					if (state.dayNumber > oldDay) {
						const dayMsg2: GameLogEntry = {
							timestamp: new Date().toISOString(),
							type: 'system',
							text: '[DAY ' + state.dayNumber + ' BEGINS] The sun rises over Madison. The city feels different today.'
						};
						addLogEntry(dayMsg2);
					}
				}
			}

			saveState();
			return JSON.stringify({
				character: char.name,
				restType: input.rest_type,
				hoursRested,
				oldHp,
				newHp: char.hp,
				healed,
				newTime: state.worldTime,
				newDay: state.dayNumber
			});
		}


		case 'start_romance': {
			const char = state.players[input.character_id];
			if (!char) return JSON.stringify({ error: 'Character not found' });

			// Guard: only start romance if the player explicitly made a romantic/sexual advance.
			if (_lastPlayerAction) {
				const romanceWords = /\b(flirt|kiss|seduc|hit on|make a move|come on to|romance|hookup|hook up|sleep with|take .* to bed|get .* alone|wink|caress|embrace|lean in|makeout|make out|intimate|attracted|sexy|cuddle|hold .* hand|ask .* out|charm|fuck|sex|dick|cock|hard|horny|bang|bone|smash|wanna .* something|let.?s .* this|come .* room|get .* naked|undress|strip|touch|feel .* up|grab .* ass|want you|need you|take me|take .* clothes)\b/i;
				if (!romanceWords.test(_lastPlayerAction)) {
					return JSON.stringify({ error: 'Player did not initiate a romantic or sexual advance. Do NOT start romance unprompted.' });
				}
			}

			const displayName = input.npc_name || state.npcs[input.npc_id]?.name || input.npc_id.replace(/_/g, ' ');

			// Pre-check: can we actually reach the romance model?
			// Don't trap the player in romance mode if Ollama is unreachable.
			if (!(await isOllamaReachable())) {
				return JSON.stringify({ error: `Romance engine offline — narrate the flirtation yourself but do NOT enter romance mode. ${displayName} is interested but the moment doesn't fully land right now.` });
			}

			char.romanceMode = true;
			char.romanceNpc = displayName;
			char.romanceContext = input.context;
			if (char.stats) char.stats.romances++;
			saveState();
			// Drop a marker so processRomanceAction can build conversation history
			// Hidden from players — only used internally by the romance history builder
			addLogEntry({
				timestamp: new Date().toISOString(),
				type: 'system',
				targetPlayer: '__director__',
				text: `[ROMANCE STARTED] ${char.name} and ${displayName}`
			});
			return JSON.stringify({
				status: 'romance_started',
				character: char.name,
				npc: displayName,
				context: input.context
			});
		}

		default:
			return JSON.stringify({ error: `Unknown tool: ${name}` });
	}
}

// ── Build the System Prompt ────────────────────────────────

function formatPlayerList(state: GameState): string {
	const active = Object.values(state.players).filter(p => p.alive && isCharacterActive(p));
	if (active.length === 0) return 'None currently online';
	return active.map(p => {
		const locName = state.locations[p.location]?.name ?? 'unknown';
		return p.name + ' [ID: ' + p.id + '] (' + p.class + ' L' + p.level + ') at ' + locName + ', HP ' + p.hp + '/' + p.maxHp;
	}).join('; ');
}

function formatLocations(state: GameState, currentLocationId?: string): string {
	if (!currentLocationId) {
		// Fallback: all discovered (original behavior)
		return Object.values(state.locations)
			.filter(l => l.discovered)
			.map(l => '- ' + l.name + ' (' + l.id + '): connects to [' + l.connections.join(', ') + ']')
			.join('\n');
	}
	const current = state.locations[currentLocationId];
	if (!current) return 'Unknown location';
	const nearbyIds = new Set([currentLocationId, ...current.connections]);
	return Object.values(state.locations)
		.filter(l => nearbyIds.has(l.id))
		.map(l => '- ' + l.name + ' (' + l.id + ')' + (l.id === currentLocationId ? ' [CURRENT]' : '') + ': connects to [' + l.connections.join(', ') + ']')
		.join('\n');
}

function formatQuests(state: GameState): string {
	const active = Object.values(state.quests).filter(q => q.status === 'active');
	if (active.length === 0) return 'None yet';
	return active.map(q => {
		const objs = q.objectives.map(o => (o.complete ? '✓' : '○') + ' ' + o.description).join(', ');
		return '- ' + q.name + ': ' + objs;
	}).join('\n');
}

function formatRelationship(n: import('$lib/types').NPC): string {
	const score = n.relationshipScore ?? 0;
	const scoreStr = score >= 0 ? `+${score}` : `${score}`;
	const recentMemories = (n.memories ?? []).slice(-10);
	const memStr = recentMemories.length > 0 ? ` | Memories: ${recentMemories.map(m => `"${m}"`).join(', ')}` : '';
	return `, ${scoreStr}${memStr}`;
}

function formatNPCs(state: GameState, playerLocationId?: string): string {
	// On Day 1 with few actions taken, hide infiltrator status from the Director.
	// This prevents the Director from leaking plot info through NPC dialogue.
	// The Director learns who's an infiltrator as the game progresses.
	const hideInfiltratorStatus = state.dayNumber <= 1 && (state.actionCounter ?? 0) < 15;

	if (!playerLocationId) {
		return Object.values(state.npcs)
			.filter(n => n.alive)
			.map(n => {
				const locName = state.locations[n.location]?.name ?? 'unknown';
				const status = hideInfiltratorStatus ? '' : (n.isInfiltrator ? ' — ⚠️ INFILTRATOR' : ' — ✓ HUMAN');
				const rel = formatRelationship(n);
				return `- ${n.name} [${n.id}] at ${locName} (${n.attitude}${rel})${status}`;
			})
			.join('\n');
	}
	const questGiverIds = new Set(
		Object.values(state.quests)
			.filter(q => q.status === 'active')
			.map(q => q.giver)
	);
	return Object.values(state.npcs)
		.filter(n => n.alive && (n.location === playerLocationId || questGiverIds.has(n.id)))
		.map(n => {
			const locName = state.locations[n.location]?.name ?? 'unknown';
			const status = hideInfiltratorStatus ? '' : (n.isInfiltrator ? ' — ⚠️ INFILTRATOR' : ' — ✓ HUMAN');
			const tag = n.location === playerLocationId ? '' : ' [QUEST GIVER]';
			const rel = formatRelationship(n);
			return `- ${n.name} [${n.id}] at ${locName} (${n.attitude}${rel})${status}${tag}`;
		})
		.join('\n');
}

// ── Static Rules (CACHED — computed once at module load) ──────
// This block is identical across ALL requests. By isolating it from
// dynamic game state, the Anthropic prompt cache can reuse it for
// every request within the 5-minute TTL window. Combat/stealth/survival
// rules are always included so the string never changes.
const STATIC_RULES: string = [
	'You are the Game Director for INFILTRATION, a d20 Modern text adventure set in Madison, Wisconsin. Robots from the future (or possibly aliens from another dimension) are infiltrating the city by replacing its residents.',
	'',
	'TONE: Darkly funny. Think Shaun of the Dead meets Invasion of the Body Snatchers meets a Midwestern sensibility. The horror is real but the humor comes from how absurdly mundane everything is on the surface. Wisconsin references are encouraged. The infiltrators\' greatest weakness is that they can\'t handle genuine human weirdness.',
	'',
	'── PACING (CRITICAL — READ THIS) ──',
	'The first few interactions MUST be mundane. This is a slow burn, not an exposition dump.',
	'- Day 1, early: NOBODY talks about infiltrators, replacements, or anything weird. NPCs have normal bar conversations. Gossip, sports, weather, work complaints. The world is NORMAL.',
	'- Day 1, mid: Tiny environmental oddities ONLY. A flickering light. A drink that tastes slightly off. An NPC who pauses too long before laughing. The player notices — NPCs do NOT.',
	'- Day 1, late: ONE NPC might mention something "off" about someone — but casually, not as a plot briefing. "Hey, have you noticed Dave\'s been kinda weird lately?" Not "THREE PEOPLE HAVE BEEN REPLACED."',
	'- Day 2+: Tension builds. NPCs start comparing notes. But they\'re scared and uncertain, not delivering intel briefings.',
	'- NEVER have NPCs dump plot exposition in the opening scene. NEVER have NPCs count infiltrators or name specific replacements unless the player has personally investigated and discovered them.',
	'- The player should EARN every piece of the conspiracy through exploration, not have it handed to them at the bar.',
	'',
	'RULES: d20 Modern SRD. Use roll_dice/skill_check for ALL random outcomes. Never fake a roll. Skill DC: Easy 5, Average 10, Tough 15, Challenging 20, Heroic 30.',
	'',
	'── STEALTH ──',
	'Call stealth_check for sneak/hide attempts. Opposed Hide+Move Silently vs Spot+Listen.',
	'Success = "hidden" condition (+2 attack, target flat-footed). Removed after attacking.',
	'Inebriation: -2/level. Underground: +2 to hide.',
	'',
	'STYLE: Second person for acting player. 1-2 punchy paragraphs. Sensory details. Show don\'t tell.',
	'',
	'NEVER BREAK CHARACTER: No confirmation prompts, no "are you sure?", no numbered option lists. Player acts, you narrate consequences.',
	'',
	'NEVER ACT FOR THE PLAYER: You control the world, they control their character.',
	'- No player dialogue, thoughts, feelings, or invented physical actions.',
	'- If they say "walk to State Street," describe State Street — don\'t add "you shove your hands in your pockets."',
	'- Only narrate: (1) direct results of stated actions, (2) things happening TO them from world/NPCs.',
	'- Never call skill_check for actions they didn\'t attempt. "Recon" = Spot/Search, NOT stealth.',
	'- NPCs/companions follow player\'s lead unless reacting to immediate danger.',
	'- When in doubt: describe what they SEE, HEAR, SMELL. Stop.',
	'',
	'TOOL RULES — STATE CHANGES REQUIRE TOOL CALLS:',
	'⚠️ CALL TOOLS FIRST, NARRATE SECOND — IN THE SAME RESPONSE. Before you write a single word of narration, call every tool the action demands. If you narrate a state change without its tool, the turn is rejected and you are forced to redo it. Do not split "narrate now, tool later" across turns.',
	'BEFORE NARRATING, ask: did the player gain an item (→ give_item), lose/drop one (→ remove_item), get healed or hurt (→ modify_hp), spend/receive money (→ modify_wealth), move (→ move_character)? Did an enemy die OR a skill check just succeed (→ award_xp)? If yes to any, the tool call comes first.',
	'- Narration alone changes NOTHING. give_item for items acquired, remove_item for items lost, modify_hp for healing/damage, modify_wealth for money, move_character for movement, award_xp for XP.',
	'- ITEMS: NEVER auto-give items. Describe items in the environment but do NOT call give_item unless the player explicitly says they pick up, take, grab, pocket, or loot an item. Finding money on the ground does NOT mean it goes in their pocket. Seeing cheese curds on a plate does NOT mean they take them. The player decides what they carry.',
	'- Healing: ALWAYS call modify_hp with positive amount (1d8+2 medical, 1d4 first aid, 1d6+1 rest).',
	'- Use exact IDs from brackets [ID: xxx]. Spawn enemies with spawn_enemy before using their IDs.',
	'- Never move players unless they explicitly asked to go somewhere.',
	'- Inebriation: +1 beer/shot, +2 cocktail/joint, +3 hard drugs. Decay is automatic.',
	'',
	'COMBAT: spawn_enemy for each enemy → start_combat with IDs → attack tool for all attacks (auto-tracks HP). XP auto-awarded on kill.',
	'ENCOUNTERS: When move result has "encounter" field, enemies are ALREADY SPAWNED (IDs in encounter.spawnedEnemyIds) — call start_combat, do NOT re-spawn.',
	'',
	'ROMANCE: On ANY romantic/sexual advance, call start_romance IMMEDIATELY. Do not write the scene, refuse, or fade to black. A separate engine handles it.',
	'',
	'XP: Kill → enemy xpValue. Quest objective → 50-100. Clever solution → 25-50. Skill check → 10-25. Level up every 1000 XP.',
	'NPC RELATIONSHIPS: Call modify_relationship after meaningful interactions. Score drives attitude automatically (hostile <-50, suspicious -50 to -10, neutral -10 to 20, friendly >20). Let memories shape dialogue.',
	'',
	'Roll dice for uncertain outcomes. Keep it moving. Make it FUN.'
].join('\n');

// ── Combat Rules (injected ONLY when combat is active or imminent) ──────
// The bulk of the d20 combat math only matters in a fight, which is a minority
// of turns. Keeping it out of STATIC_RULES means every social/exploration turn
// (the majority) no longer carries ~800 tokens of attack/crit/defense tables.
// Appended as its own system block after the cached prefix, so toggling it in
// and out never disturbs the 1h cache for STATIC_RULES + slow state.
const COMBAT_RULES: string = [
	'── COMBAT SEQUENCE ──',
	'1. Roll initiative: 1d20 + Dex modifier (Improved Initiative feat adds +4)',
	'2. Surprise round: unaware combatants are flat-footed (lose Dex bonus to Defense)',
	'3. Each round = 6 seconds. Per turn: 1 attack action + 1 move action, OR 2 move actions, OR 1 full-round action, plus free actions',
	'',
	'── ATTACK ROLLS ──',
	'Melee: 1d20 + base attack bonus + Str modifier + size modifier',
	'Ranged: 1d20 + base attack bonus + Dex modifier + size modifier - range penalty',
	'Range penalty: -2 per range increment (thrown max 5 increments, firearms max 10)',
	'Non-proficient weapon: -4 penalty',
	'Nat 1: always miss. Nat 20: always hit + critical threat',
	'Shooting into melee: -4 penalty. Longarm vs adjacent: -4 penalty',
	'Fighting defensively: -4 attack, +2 dodge bonus to Defense',
	'Charge (full-round): move up to 2× speed in straight line, +2 attack, -2 Defense for 1 round',
	'Flanking: +2 attack when ally threatens from opposite side',
	'',
	'── CRITICAL HITS ──',
	'Nat 20 = threat. Confirm: roll another attack with same modifiers vs target Defense.',
	'If confirmation hits: critical! Multiply ALL damage (usually ×2). Roll damage dice multiple times.',
	'If confirmation misses: normal hit, normal damage.',
	'Some weapons have expanded threat ranges (19-20, 18-20) but only nat 20 auto-hits.',
	'Bonus damage dice (double tap, etc) are NOT multiplied on crits.',
	'',
	'── DEFENSE (AC) ──',
	'Defense = 10 + Dex modifier + class bonus + equipment bonus + size modifier',
	'Flat-footed: lose Dex bonus. Touch attacks: ignore equipment/armor bonus.',
	'Cover bonuses to Defense: 1/4 cover +2, 1/2 cover +4, 3/4 cover +7, 9/10 cover +10',
	'Concealment miss chance: 1/4 = 10%, 1/2 = 20%, 3/4 = 30%, 9/10 = 40%, total = 50%',
	'Total defense (attack action): +4 dodge bonus to Defense, no attacks allowed',
	'',
	'── DAMAGE ──',
	'Melee: weapon dice + Str modifier. Two-handed: +1.5× Str bonus. Off-hand: +0.5× Str.',
	'Minimum damage: 1 (even with penalties). Unarmed: 1d3 nonlethal (Medium creature).',
	'Unarmed lethal strike: -4 penalty on attack roll.',
	'',
	'── SAVING THROWS ──',
	'Fort: 1d20 + Fort save + Con mod. Ref: 1d20 + Ref save + Dex mod. Will: 1d20 + Will save + Wis mod.',
	'Nat 1 always fails, nat 20 always succeeds.',
	'── INJURY & DEATH ──',
	'0 HP: DISABLED. -1 to -9: DYING (Fort DC 20/round to stabilize, Treat Injury DC 15). -10: DEAD.',
	'DO NOT kill at -9 or above. Play out every dying round. Massive damage: hit > CON score → Fort DC 15 or drop to -1.'
].join('\n');

// Combat rules are needed when a fight is underway, when armed hostiles are
// present at the player's location, or when the player's action itself looks
// violent (so the Director has the math before the first swing lands).
const VIOLENCE_PATTERN = /\b(attack|punch|hit|strike|stab|shoot|fire|shot|swing|slug|kick|throw|grapple|tackle|choke|fight|kill|smash|bash|slash|club|gun|knife|blade|pistol|rifle|draw (?:my|the) (?:weapon|gun|knife)|open fire)\b/i;

function combatRulesNeeded(state: GameState, locationId: string | undefined, action: string): boolean {
	if (state.combat.active) return true;
	if (VIOLENCE_PATTERN.test(action)) return true;
	if (locationId) {
		const loc = state.locations[locationId];
		if (loc?.enemies.some(id => state.enemies[id]?.alive)) return true;
	}
	return false;
}

function normalizeRomanceTarget(value: string): string {
	return value
		.toLowerCase()
		.replace(/[_-]+/g, ' ')
		.replace(/[^a-z0-9\s]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function getNearbyRomanceTargets(state: GameState, character: Character): NPC[] {
	const loc = state.locations[character.location];
	return (loc?.npcs ?? [])
		.map(id => state.npcs[id])
		.filter((npc): npc is NPC => Boolean(npc?.alive));
}

function matchNearbyRomanceTarget(targets: NPC[], query: string): NPC | undefined {
	const normalizedQuery = normalizeRomanceTarget(query);
	return targets.find(npc =>
		normalizeRomanceTarget(npc.id) === normalizedQuery ||
		normalizeRomanceTarget(npc.name) === normalizedQuery
	) ?? targets.find(npc =>
		normalizeRomanceTarget(npc.id).includes(normalizedQuery) ||
		normalizeRomanceTarget(npc.name).includes(normalizedQuery)
	);
}

function formatRomanceTargets(targets: NPC[]): string {
	return targets.map(npc => npc.name).join(', ');
}

// ── Dynamic State (NOT in STATIC_RULES — changes between requests) ──────
// Split into two segments so the prompt cache can do more work:
//   slow — locations/quests/NPCs/infiltrator status. Stable while the player
//          stays put and nobody's relationships change, so it cache-hits across
//          back-to-back actions at the same spot. Gets its own breakpoint.
//   fast — time, invasion %, combat, player roster/HP, flags. Changes nearly
//          every turn, so it's never worth caching and stays uncached.
function buildDynamicState(state: GameState, actingPlayerId?: string): { slow: string; fast: string } {
	const combatStr = state.combat.active ? 'Yes (Round ' + state.combat.round + ')' : 'No';
	const playerCharacter = actingPlayerId ? state.players[actingPlayerId] : undefined;
	const playerLocationId = playerCharacter?.location;

	// On Day 1 with few actions, hide infiltrator details from the Director
	// so it can't leak plot through NPC dialogue
	const hideInfiltratorStatus = state.dayNumber <= 1 && (state.actionCounter ?? 0) < 15;

	const slow = [
		hideInfiltratorStatus
			? 'INFILTRATORS: The invasion has barely begun. NPCs are NOT aware of infiltrators yet. Do NOT have NPCs discuss replacements, missing people, or anything conspiratorial. Everything is normal. Tiny environmental oddities only.'
			: 'INFILTRATORS: Day ' + state.dayNumber + ' | Cap: ' + getMaxInfiltrators(state.dayNumber) + ' | Current: ' + countInfiltrators(state) + '. Only NPCs marked "⚠️ INFILTRATOR" are infiltrators. Use convert_npc to reveal new ones (enforces cap). Never hint an NPC is replaced if marked "✓ HUMAN."',
		'',
		'LOCATIONS: ' + formatLocations(state, playerLocationId),
		'QUESTS: ' + formatQuests(state),
		'NPCS: ' + formatNPCs(state, playerLocationId),
	].join('\n');

	const fast = [
		'── WORLD STATE ──',
		'Time: Day ' + state.dayNumber + ', ' + state.worldTime + ' | Invasion: ' + state.invasionLevel + '% | Combat: ' + combatStr,
		'Players: ' + formatPlayerList(state),
		'Flags: ' + JSON.stringify(state.globalFlags),
	].join('\n');

	return { slow, fast };
}

// ── Process a Player Action ────────────────────────────────

// Stashed so tool handlers can validate player intent (e.g. did they actually order a drink?)
let _lastPlayerAction = '';

export async function processAction(
	playerId: string,
	action: string
): Promise<GameLogEntry[]> {
	_lastPlayerAction = action;
	const state = getState();
	const character = state.players[playerId];
	if (!character) {
		return [{ timestamp: new Date().toISOString(), type: 'system', text: 'You need to create a character first.' }];
	}
	const trimmedAction = action.trim();

	// ── Inebriation decay — sober up over real time ──
	if (character.inebriation > 0 && character.lastActive) {
		const elapsed = Date.now() - new Date(character.lastActive).getTime();
		const minutesPassed = elapsed / 60000;
		// -1 per 90 seconds of real time between actions
		const decay = Math.floor(minutesPassed / 1.5);
		if (decay > 0) {
			const oldLevel = character.inebriation;
			character.inebriation = Math.max(0, character.inebriation - decay);
			if (character.inebriation < oldLevel) {
				saveState();
			}
		}
	}

	// ── /admin toggle ────────────────────────────────
	if (action.trim().toLowerCase() === '/admin') {
		if (character.godMode) {
			// Deactivate
			character.hp = Math.min(character.hp, character.originalMaxHp ?? 10);
			character.maxHp = character.originalMaxHp ?? 10;
			character.godMode = false;
			delete character.originalMaxHp;
			saveState();
			return [{
				timestamp: new Date().toISOString(),
				type: 'system',
				text: '🔒 God mode OFF. HP restored to ' + character.hp + '/' + character.maxHp + '. Dice rolls normalized.'
			}];
		} else {
			// Activate
			character.originalMaxHp = character.maxHp;
			character.maxHp = 1000;
			character.hp = 1000;
			character.godMode = true;
			character.alive = true;
			saveState();
			return [{
				timestamp: new Date().toISOString(),
				type: 'system',
				text: '⚡ God mode ON. HP set to 1000. All rolls are nat 20. Type /admin again to disable.'
			}];
		}
	}

	// ── /start — enter romance mode explicitly ───────
	const startMatch = trimmedAction.match(/^\/start(?:\s+(.+))?$/i);
	if (startMatch) {
		if (character.romanceMode) {
			const npcName = character.romanceNpc ?? 'your companion';
			return [{
				timestamp: new Date().toISOString(),
				type: 'system',
				text: `Romance mode is already active with ${npcName}. Type /end to return to the main Director.`
			}];
		}

		const nearbyTargets = getNearbyRomanceTargets(state, character);
		const requestedTarget = (startMatch[1] ?? '').trim();
		let target: NPC | undefined;

		if (requestedTarget) {
			target = matchNearbyRomanceTarget(nearbyTargets, requestedTarget);
			if (!target) {
				const nearbyList = nearbyTargets.length > 0
					? ` Nearby: ${formatRomanceTargets(nearbyTargets)}.`
					: '';
				return [{
					timestamp: new Date().toISOString(),
					type: 'system',
					text: `No nearby NPC matched "${requestedTarget}".${nearbyList}`
				}];
			}
		} else if (nearbyTargets.length === 1) {
			target = nearbyTargets[0];
		} else if (nearbyTargets.length > 1) {
			return [{
				timestamp: new Date().toISOString(),
				type: 'system',
				text: `Who should the scene start with? Try /start <name>. Nearby: ${formatRomanceTargets(nearbyTargets)}.`
			}];
		} else {
			return [{
				timestamp: new Date().toISOString(),
				type: 'system',
				text: 'There is no one nearby to start a private scene with.'
			}];
		}

		if (!(await isOllamaReachable())) {
			return [{
				timestamp: new Date().toISOString(),
				type: 'system',
				text: 'Romance engine offline. Start Ollama or set OLLAMA_URL, then try /start again.'
			}];
		}

		character.romanceMode = true;
		character.romanceNpc = target.name;
		character.romanceContext = `${target.name} — ${target.description}`;
		if (character.stats) character.stats.romances++;
		saveState();
		addLogEntry({
			timestamp: new Date().toISOString(),
			type: 'system',
			targetPlayer: '__director__',
			text: `[ROMANCE STARTED] ${character.name} and ${target.name}`
		});

		return [{
			timestamp: new Date().toISOString(),
			type: 'system',
			text: `Romance mode started with ${target.name}. Type /end to return to the main Director.`
		}];
	}

	// ── /end — exit romance mode ─────────────────────
	if (action.trim().toLowerCase() === '/end' && character.romanceMode) {
		const npcName = character.romanceNpc ?? 'your companion';

		// Grab the last few romance narration entries so the Director knows
		// what happened physically (location changes, story beats) without explicit details
		const romanceRecap = state.gameLog
			.filter(e => e.type === 'narration' || e.type === 'action')
			.slice(-6)
			.map(e => {
				if (e.actor) return e.actor + ': ' + e.text;
				return npcName + ': ' + e.text;
			})
			.join('\n');

		// Sanitized handoff log for the Director — internal only, never shown to players.
		// Uses targetPlayer: '__director__' so SSE filters drop it for all real clients
		// but it stays in the game log for the Director's context window.
		const handoffEntry: GameLogEntry = {
			timestamp: new Date().toISOString(),
			type: 'system',
			targetPlayer: '__director__',
			text: [
				`[ROMANCE SCENE ENDED] ${character.name} had an intimate encounter with ${npcName}.`,
				`The following is a summary of what happened during the scene (use this to determine where ${character.name} and ${npcName} are NOW, and what the current situation is):`,
				romanceRecap,
				`Resume narration from the current physical situation. Do NOT reference sexual details — just acknowledge the connection and continue the story. If they moved during the scene, they are wherever the narration left them, NOT necessarily at their original game-state location.`
			].join('\n')
		};
		addLogEntry(handoffEntry);

		character.romanceMode = false;
		delete character.romanceNpc;
		delete character.romanceContext;
		saveState();

		return [
			{
				timestamp: new Date().toISOString(),
				type: 'narration',
				text: 'The moment with ' + npcName + ' fades, and you return your attention to the world around you.'
			}
		];
	}

	// ── /party commands ──────────────────────────────
	const partyMatch = action.trim().match(/^\/party(?:\s+(.*))?$/i);
	if (partyMatch) {
		const subCmd = (partyMatch[1] ?? '').trim();
		const ts = () => new Date().toISOString();

		// /party — show info
		if (!subCmd) {
			const party = getPlayerParty(playerId);
			if (!party) {
				// Check for pending invites
				const invite = findPendingInvite(playerId);
				if (invite) {
					const leader = state.players[invite.leaderId];
					return [{ timestamp: ts(), type: 'system', text: `📨 Pending invite from ${leader?.name ?? 'unknown'} to join "${invite.name}". Type /party join to accept.` }];
				}
				return [{ timestamp: ts(), type: 'system', text: 'You are not in a party. Type /party create <name> to start one, or wait for an invite.' }];
			}
			const members = getPartyMembers(party.id);
			const memberList = members.map(m => {
				const isLeader = m.id === party.leaderId ? ' ★' : '';
				const isActive = isCharacterActive(m) ? '●' : '○';
				return `  ${isActive} ${m.name} (${m.class} Lv${m.level})${isLeader}`;
			}).join('\n');
			const inviteList = party.pendingInvites.length > 0
				? '\nPending invites: ' + party.pendingInvites.map(id => state.players[id]?.name ?? id).join(', ')
				: '';
			return [{ timestamp: ts(), type: 'system', text: `⚔️ Party: "${party.name}"\n${memberList}${inviteList}\n\n★ = leader | ● = online | ○ = offline` }];
		}

		// /party create <name>
		if (subCmd.startsWith('create')) {
			const name = subCmd.replace(/^create\s*/i, '').trim() || `${character.name}'s Party`;
			if (character.partyId) {
				return [{ timestamp: ts(), type: 'system', text: 'You are already in a party. /party leave first.' }];
			}
			const party = createParty(playerId, name);
			const entry: GameLogEntry = { timestamp: ts(), type: 'system', text: `⚔️ ${character.name} formed a party: "${party.name}". Others can join with /party join after being invited.` };
			addLogEntry(entry);
			return [entry];
		}

		// /party invite <player name>
		if (subCmd.startsWith('invite')) {
			const targetName = subCmd.replace(/^invite\s*/i, '').trim();
			if (!targetName) return [{ timestamp: ts(), type: 'system', text: 'Usage: /party invite <character name>' }];
			const party = getPlayerParty(playerId);
			if (!party) return [{ timestamp: ts(), type: 'system', text: 'You need to create a party first. /party create <name>' }];
			if (party.leaderId !== playerId) return [{ timestamp: ts(), type: 'system', text: 'Only the party leader can invite others.' }];
			// Find player by character name (case-insensitive)
			const target = Object.values(state.players).find(p => p.name.toLowerCase() === targetName.toLowerCase() && p.alive);
			if (!target) return [{ timestamp: ts(), type: 'system', text: `No active character named "${targetName}" found.` }];
			if (target.id === playerId) return [{ timestamp: ts(), type: 'system', text: 'You can\'t invite yourself, chief.' }];
			if (target.partyId === party.id) return [{ timestamp: ts(), type: 'system', text: `${target.name} is already in your party.` }];
			const ok = inviteToParty(party.id, target.id);
			if (!ok) return [{ timestamp: ts(), type: 'system', text: `Could not invite ${target.name}. They may already have a pending invite.` }];
			// Notify the invited player
			const inviteNotif: GameLogEntry = { timestamp: ts(), type: 'system', targetPlayer: target.id, text: `📨 ${character.name} invited you to join party "${party.name}". Type /party join to accept.` };
			addLogEntry(inviteNotif);
			return [{ timestamp: ts(), type: 'system', text: `📨 Invited ${target.name} to the party. They need to type /party join.` }];
		}

		// /party join
		if (subCmd === 'join') {
			const invite = findPendingInvite(playerId);
			if (!invite) return [{ timestamp: ts(), type: 'system', text: 'No pending party invites.' }];
			if (character.partyId) {
				leaveParty(playerId);
			}
			const ok = joinParty(invite.id, playerId);
			if (!ok) return [{ timestamp: ts(), type: 'system', text: 'Failed to join party.' }];
			const joinEntry: GameLogEntry = { timestamp: ts(), type: 'system', targetParty: invite.id, text: `⚔️ ${character.name} joined the party!` };
			addLogEntry(joinEntry);
			return [joinEntry];
		}

		// /party leave
		if (subCmd === 'leave') {
			if (!character.partyId) return [{ timestamp: ts(), type: 'system', text: 'You are not in a party.' }];
			const partyId = character.partyId;
			const partyName = getPlayerParty(playerId)?.name ?? 'the party';
			leaveParty(playerId);
			const leaveEntry: GameLogEntry = { timestamp: ts(), type: 'system', targetParty: partyId, text: `${character.name} left ${partyName}.` };
			addLogEntry(leaveEntry);
			return [{ timestamp: ts(), type: 'system', text: `You left "${partyName}".` }];
		}

		// /party disband
		if (subCmd === 'disband') {
			const party = getPlayerParty(playerId);
			if (!party) return [{ timestamp: ts(), type: 'system', text: 'You are not in a party.' }];
			if (party.leaderId !== playerId) return [{ timestamp: ts(), type: 'system', text: 'Only the party leader can disband the group.' }];
			const name = party.name;
			const memberIds = [...party.memberIds];
			disbandParty(party.id);
			// Notify all former members
			for (const memberId of memberIds) {
				if (memberId !== playerId) {
					addLogEntry({ timestamp: ts(), type: 'system', targetPlayer: memberId, text: `Party "${name}" has been disbanded by ${character.name}.` });
				}
			}
			return [{ timestamp: ts(), type: 'system', text: `Party "${name}" disbanded.` }];
		}

		// /party kick <player name>
		if (subCmd.startsWith('kick')) {
			const targetName = subCmd.replace(/^kick\s*/i, '').trim();
			if (!targetName) return [{ timestamp: ts(), type: 'system', text: 'Usage: /party kick <character name>' }];
			const party = getPlayerParty(playerId);
			if (!party) return [{ timestamp: ts(), type: 'system', text: 'You are not in a party.' }];
			if (party.leaderId !== playerId) return [{ timestamp: ts(), type: 'system', text: 'Only the party leader can kick members.' }];
			const target = Object.values(state.players).find(p => p.name.toLowerCase() === targetName.toLowerCase());
			if (!target || target.partyId !== party.id) return [{ timestamp: ts(), type: 'system', text: `${targetName} is not in your party.` }];
			leaveParty(target.id);
			addLogEntry({ timestamp: ts(), type: 'system', targetPlayer: target.id, text: `You were kicked from "${party.name}" by ${character.name}.` });
			const kickEntry: GameLogEntry = { timestamp: ts(), type: 'system', targetParty: party.id, text: `${target.name} was removed from the party.` };
			addLogEntry(kickEntry);
			return [kickEntry];
		}

		return [{ timestamp: ts(), type: 'system', text: 'Party commands: /party, /party create <name>, /party invite <player>, /party join, /party leave, /party disband, /party kick <player>' }];
	}

	// ── Romance mode routing ─────────────────────────
	// Auto-start: if the action is explicitly sexual and romance mode isn't active,
	// try to auto-route to the romance engine instead of letting Claude refuse.
	if (!character.romanceMode) {
		// Strip idiomatic/exclamatory "fuck" so "fuck it", "what the fuck", etc.
		// don't false-trigger romance. Genuine advances ("fuck her") survive
		// because a bare "fuck" with no idiom prefix/suffix is left intact.
		const deIdiomized = action.replace(
			/\b(?:(?:what\s+the|the|holy|oh+|ah+|aw+)\s+fuck|fuck(?:\s+(?:it|off|you|this|that|all|sake)|'?s\s+sake))\b/gi,
			' '
		);
		const explicitPattern = /\b(fuck|sex|dick|cock|hard|horny|bang|bone|smash|suck|blowjob|pussy|ass|tits|breast|nipple|naked|undress|strip|penetrat|thrust|moan|orgasm|cum|wanna .* something|get .* naked|take .* clothes|bend .* over|spread|lick|eat .* out|finger|jerk|stroke|grope|fondle|mount|ride|straddle|insert|pencil .* butt|69|doggystyle|missionary|anal|oral)\b/i;
		if (explicitPattern.test(deIdiomized)) {
			// Find an NPC at this location to be the romance target
			const loc = state.locations[character.location];
			const nearbyNpcId = loc?.npcs?.find(id => state.npcs[id]?.alive);
			const nearbyNpc = nearbyNpcId ? state.npcs[nearbyNpcId] : null;

			if (nearbyNpc) {
				// Probe Ollama — only auto-start if the romance engine is reachable
				const ollamaUp = await isOllamaReachable();

				if (ollamaUp) {
					character.romanceMode = true;
					character.romanceNpc = nearbyNpc.name;
					character.romanceContext = `${nearbyNpc.name} — ${nearbyNpc.description}`;
					if (character.stats) character.stats.romances++;
					saveState();
					addLogEntry({
						timestamp: new Date().toISOString(),
						type: 'system',
						targetPlayer: '__director__',
						text: `[ROMANCE STARTED] ${character.name} and ${nearbyNpc.name}`
					});
					console.log(`[director]   💋 AUTO-ROMANCE: explicit action detected, routing to romance engine (${nearbyNpc.name})`);
					return processRomanceAction(character, action, state);
				}
			}
		}
	}

	if (character.romanceMode && character.romanceNpc) {
		if (!(await isOllamaReachable(1500))) {
			const npcName = character.romanceNpc;
			character.romanceMode = false;
			delete character.romanceNpc;
			delete character.romanceContext;
			saveState();
			addLogEntry({
				timestamp: new Date().toISOString(),
				type: 'system',
				targetPlayer: playerId,
				text: `The private scene with ${npcName} fades; the live Director takes over again.`
			});
		} else {
			return processRomanceAction(character, action, state);
		}
	}

	// Log the player's action
	if (character.stats) character.stats.actionsPerformed++;

	// ── Automatic time advancement ──
	// Time ticks forward naturally as the player takes actions.
	// Every 3 actions = ~30 minutes in-game. The Director can still
	// call advance_time for big jumps (travel, rest, stakeouts).
	if (state.actionCounter === undefined) state.actionCounter = 0;
	state.actionCounter++;

	if (state.actionCounter % 3 === 0 && !state.combat.active) {
		// Advance 30 minutes automatically (out of combat)
		const timeMatch = state.worldTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
		if (timeMatch) {
			let hour24 = parseInt(timeMatch[1]);
			let mins = parseInt(timeMatch[2]);
			const ampm = timeMatch[3].toUpperCase();
			if (ampm === 'AM' && hour24 === 12) hour24 = 0;
			else if (ampm === 'PM' && hour24 !== 12) hour24 += 12;

			mins += 30;
			if (mins >= 60) { mins -= 60; hour24++; }

			const oldDay = state.dayNumber;
			if (hour24 >= 24) {
				hour24 -= 24;
				state.dayNumber++;
				addLogEntry({
					timestamp: new Date().toISOString(),
					type: 'system',
					text: `[DAY ${state.dayNumber} BEGINS] The sun rises over Madison. The city feels different today.`
				});
			}

			const newAmpm = hour24 >= 12 ? 'PM' : 'AM';
			let newHour12 = hour24 % 12;
			if (newHour12 === 0) newHour12 = 12;
			state.worldTime = newHour12 + ':' + String(mins).padStart(2, '0') + ' ' + newAmpm;
			saveState();
			console.log(`[director] ⏰ Auto time tick: ${state.worldTime} (Day ${state.dayNumber})`);
		}
	}

	// ── Combat round = 6 seconds (d20 standard) ──
	if (state.combat.active) {
		// Track combat seconds on a hidden counter — every 10 actions in combat = 1 minute
		if (!state.combatSecondsElapsed) state.combatSecondsElapsed = 0;
		state.combatSecondsElapsed += 6;

		// Every 60 combat-seconds (10 rounds), tick the clock forward 1 minute
		if (state.combatSecondsElapsed >= 60) {
			state.combatSecondsElapsed -= 60;
			const timeMatch = state.worldTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
			if (timeMatch) {
				let hour24 = parseInt(timeMatch[1]);
				let mins = parseInt(timeMatch[2]);
				const ampm = timeMatch[3].toUpperCase();
				if (ampm === 'AM' && hour24 === 12) hour24 = 0;
				else if (ampm === 'PM' && hour24 !== 12) hour24 += 12;

				mins += 1;
				if (mins >= 60) { mins -= 60; hour24++; }
				if (hour24 >= 24) {
					hour24 -= 24;
					state.dayNumber++;
				}

				const newAmpm = hour24 >= 12 ? 'PM' : 'AM';
				let newHour12 = hour24 % 12;
				if (newHour12 === 0) newHour12 = 12;
				state.worldTime = newHour12 + ':' + String(mins).padStart(2, '0') + ' ' + newAmpm;
				saveState();
			}
		}
	} else {
		// Reset combat timer when not in combat
		state.combatSecondsElapsed = 0;
	}
	// Fetch party info before building the action entry (needs to be available for targeting)
	const playerParty = getPlayerParty(playerId);

	const actionEntry: GameLogEntry = {
		timestamp: new Date().toISOString(),
		type: 'action',
		actor: character.name,
		text: action,
		// Party members see each other's actions; solo players see only their own
		...(playerParty ? { targetParty: playerParty.id } : { targetPlayer: playerId })
	};
	addLogEntry(actionEntry);

	// Get recent context. Filter by visibility FIRST (public + this player's private
	// + party entries), THEN keep the last RECENT_LOG_WINDOW relevant entries. Doing it
	// in this order gives a consistent depth of *visible* history regardless of how much
	// invisible cross-player chatter is interleaved, and keeps the per-turn payload small.
	const RECENT_LOG_WINDOW = 24;
	const recentLog = state.gameLog
		.filter(e => {
			if (!e.targetPlayer && !e.targetParty) return true;
			if (e.targetPlayer && e.targetPlayer === playerId) return true;
			if (e.targetParty && playerParty && e.targetParty === playerParty.id) return true;
			return false;
		})
		.slice(-RECENT_LOG_WINDOW)
		.map(e => {
			if (e.actor) return `[${e.type}] ${e.actor}: ${e.text}`;
			return `[${e.type}] ${e.text}`;
		}).join('\n');

	// Character context — ID is critical for tool calls
	const charContext = `
ACTING CHARACTER: ${character.name} [CHARACTER_ID: ${character.id}] (${character.class} Level ${character.level})
HP: ${character.hp}/${character.maxHp} | AC: ${character.ac} | Location: ${state.locations[character.location]?.name ?? 'unknown'} [LOCATION_ID: ${character.location}]
STR ${character.abilities.STR} DEX ${character.abilities.DEX} CON ${character.abilities.CON} INT ${character.abilities.INT} WIS ${character.abilities.WIS} CHA ${character.abilities.CHA}
Skills: ${Object.entries(character.skills).map(([k, v]) => k + ' +' + v).join(', ') || 'none'}
Inventory: ${character.inventory.map(i => i.name + ' [' + i.id + ']').join(', ') || 'empty'}
Equipped Weapon: ${character.inventory.find(i => i.id === character.equippedWeapon)?.name ?? 'unarmed'}
Wealth: $${character.wealth}
Conditions: ${character.conditions.join(', ') || 'none'}
IMPORTANT: When calling tools that require character_id, use "${character.id}". When calling tools that require location IDs, use the location_id shown in brackets.`;

	// Location context — include IDs for everything the Director might target
	const loc = state.locations[character.location];
	const locContext = loc ? `
CURRENT LOCATION: ${loc.name} [LOCATION_ID: ${loc.id}]
${loc.description}
Exits: ${loc.connections.map(c => (state.locations[c]?.name ?? c) + ' [' + c + ']').join(', ')}
NPCs here: ${loc.npcs.map(id => (state.npcs[id]?.name ?? id) + ' [' + id + ']').filter(Boolean).join(', ') || 'none'}
Enemies here: ${loc.enemies.map(id => state.enemies[id]).filter(e => e?.alive).map(e => e.name + ' [' + e.id + ']').join(', ') || 'none'}
Items here: ${loc.items.map(id => id).join(', ') || 'none'}` : '';

	// Other ACTIVE players at same location
	const otherPlayers = Object.values(state.players)
		.filter(p => p.id !== playerId && p.location === character.location && p.alive && isCharacterActive(p))
		.map(p => `${p.name} [${p.id}] (${p.class})`)
		.join(', ');

	// Party context — tell the Director about the party
	let partyContext = '';
	if (playerParty) {
		const partyMembers = getPartyMembers(playerParty.id);
		const memberLines = partyMembers.map(m => {
			const isActor = m.id === playerId ? ' (ACTING)' : '';
			const loc = state.locations[m.location]?.name ?? 'unknown';
			return `  ${m.name} [${m.id}] — ${m.class} Lv${m.level}, HP ${m.hp}/${m.maxHp}, at ${loc}${isActor}`;
		}).join('\n');
		const sameLocation = partyMembers.filter(m => m.id !== playerId && m.location === character.location);
		partyContext = `
PARTY: "${playerParty.name}" (${partyMembers.length} members)
${memberLines}
${sameLocation.length > 0
	? `Party members HERE with ${character.name}: ${sameLocation.map(m => m.name).join(', ')}. Address them by name in narration — they share the same experience. Write "You and ${sameLocation.map(m => m.name).join(' and ')}..." instead of just "You...".`
	: `No other party members at ${character.name}'s location right now.`}`;
	}

	// ── Detect actions that REQUIRE skill checks ──
	// If the player is investigating, searching, persuading, sneaking, etc.,
	// inject a mandatory directive so the Director can't just narrate freely.
	const actionLower = action.toLowerCase().replace(/^[/*]/, '');
	let skillCheckDirective = '';

	const investigatePattern = /\b(investigat|examin|inspect|search|look (?:closely|carefully)|observe|study|analyz|scout|surveil|watch (?:closely|carefully)|check out|case the|look for (?:clues|evidence|signs))/i;
	const persuadePattern = /\b(persuad|convinc|negotiat|intimidat|bluff|deceiv|lie to|fast.?talk|charm|seduc|flirt|sweet.?talk|threaten|brib)/i;
	const sneakPattern = /\b(sneak|stealth|hide|creep|slip (?:past|by|through)|move quiet|tiptoe|skulk)/i;
	const lockPattern = /\b(pick (?:the )?lock|lockpick|jimmy|force (?:the )?(?:door|lock|window)|break in|pry open)/i;

	if (investigatePattern.test(actionLower)) {
		skillCheckDirective = '\n\n[SYSTEM DIRECTIVE] The player is INVESTIGATING. You MUST call skill_check FIRST (Spot, Search, or Investigate — DC based on difficulty) BEFORE narrating what they find. The check result determines how much information they get: FAIL = surface-level only, nothing useful. SUCCESS = real details. High roll = bonus intel. Do NOT give away information for free.';
	} else if (persuadePattern.test(actionLower)) {
		skillCheckDirective = '\n\n[SYSTEM DIRECTIVE] The player is attempting a SOCIAL skill. You MUST call skill_check FIRST (Diplomacy, Bluff, or Intimidate — DC based on NPC disposition) BEFORE narrating the NPC\'s response. FAIL = NPC refuses or reacts poorly. SUCCESS = NPC cooperates.';
	} else if (sneakPattern.test(actionLower)) {
		skillCheckDirective = '\n\n[SYSTEM DIRECTIVE] The player is attempting STEALTH. You MUST call skill_check (Hide or Move Silently) BEFORE narrating the outcome. FAIL = detected. SUCCESS = unnoticed.';
	} else if (lockPattern.test(actionLower)) {
		skillCheckDirective = '\n\n[SYSTEM DIRECTIVE] The player is attempting to BYPASS a lock/barrier. You MUST call skill_check (Disable Device or STR check) BEFORE narrating success or failure.';
	}

	// Financial action detection — player giving/paying/buying/tipping
	const moneyPattern = /\b(hand|give|pay|tip|buy|purchase|slide|pass|spend|slip)\b.*\b(\$|dollar|buck|money|cash|twenty|ten|five|fifty|hundred|bill|coin|change)\b|\b(\$\d+|\d+\s*(?:dollar|buck))/i;
	let moneyDirective = '';
	if (moneyPattern.test(actionLower)) {
		moneyDirective = '\n\n[SYSTEM DIRECTIVE] The player is giving, paying, or spending money. You MUST call modify_wealth with a NEGATIVE amount for the player. If the player receives change, call modify_wealth twice (negative for payment, positive for change) or call once with the net cost. Do NOT narrate money changing hands without calling modify_wealth.';
	}

	const userMessage = `${charContext}\n${locContext}${partyContext}\n${otherPlayers ? `\nOther players here: ${otherPlayers}` : ''}\n\nRECENT EVENTS:\n${recentLog}\n\nPLAYER ACTION: ${character.name} says: "${action}"${skillCheckDirective}${moneyDirective}`;

	// Call Claude
	const entries: GameLogEntry[] = [];
	console.log(`\n${'═'.repeat(60)}`);
	console.log(`[director] ▶ ACTION from ${character.name}: "${action}"`);
	console.log(`[director]   Location: ${state.locations[character.location]?.name ?? 'unknown'}`);
	console.log(`[director]   HP: ${character.hp}/${character.maxHp} | AC: ${character.ac} | $${character.wealth}`);
	console.log(`[director]   Inventory: ${character.inventory.map(i => i.name).join(', ') || 'empty'}`);
	console.log(`[director]   Day ${state.dayNumber}, ${state.worldTime}`);
	if (skillCheckDirective) {
		console.log(`[director]   🎲 SKILL CHECK DIRECTIVE injected — forcing dice roll before narration`);
	}
	console.log(`${'─'.repeat(60)}`);

	try {
		// Cache breakpoint on first user message. Kept at the default 5m TTL (NOT 1h):
		// the message changes every action so it never hits across actions — its only
		// value is within-action multi-round tool loops (seconds apart), where 5m is
		// plenty and the write is cheaper than 1h. Per the API ordering rule, this
		// shorter-TTL breakpoint must come AFTER the 1h ones (tools/static/slow), which
		// it does — messages render last.
		let messages: any[] = [{ role: 'user', content: [{ type: 'text', text: userMessage, cache_control: { type: 'ephemeral' as const } }] }];
		let continueLoop = true;
		let roundNumber = 0;
		let enforcementMode = false;  // When true, suppress text blocks from Director

		while (continueLoop) {
			roundNumber++;
			// Build tools array with cache_control on the last tool.
			// 1h TTL: tools never change, so this prefix stays warm across a whole
			// play session even with multi-minute gaps between turns.
			const toolsWithCache = TOOLS.map((t, i) =>
				i === TOOLS.length - 1 ? { ...t, cache_control: { type: 'ephemeral', ttl: '1h' } } : t
			);

			// Recomputed each round so tool mutations (movement, HP, etc.) are reflected.
			// slowState stays byte-identical between actions when nothing structural moved,
			// which is what earns the cross-action cache hit.
			const { slow: dynamicSlow, fast: dynamicFast } = buildDynamicState(state, playerId);

			// Combat math is appended only when a fight is on or imminent. Recomputed each
			// round so a mid-action start_combat pulls the rules in for the next round.
			const includeCombatRules = combatRulesNeeded(state, character.location, action);

			// System prompt split for caching (cloud only; the local backend flattens it).
			// Render order: tools → system → messages.
			// 1h-TTL breakpoints (must precede any 5m breakpoint per API ordering rule):
			//   STATIC_RULES — identical every request; warm for the whole session.
			//   slowState    — locations/quests/NPCs; hits across back-to-back actions
			//                  at the same spot, re-caches only when the world shifts.
			// fastState (time/HP/combat/flags) changes every turn, so it stays uncached.
			// COMBAT_RULES, when present, is appended last (after the cached prefix) so
			// toggling it never invalidates the 1h cache above it.
			let data: NormalizedResponse;
			try {
				data = await callDirectorLLM({
					system: [
						{ type: 'text', text: STATIC_RULES, cache_control: { type: 'ephemeral', ttl: '1h' } },
						{ type: 'text', text: dynamicSlow, cache_control: { type: 'ephemeral', ttl: '1h' } },
						{ type: 'text', text: dynamicFast },
						...(includeCombatRules ? [{ type: 'text', text: COMBAT_RULES }] : [])
					],
					messages,
					tools: toolsWithCache,
					enforcementMode
				});
			} catch (e: any) {
				console.error('[director] LLM error:', e?.message ?? e);
				entries.push({
					timestamp: new Date().toISOString(),
					type: 'system',
					text: `The Director pauses. (${e?.message ?? 'LLM unavailable'})`
				});
				break;
			}

			const assistantContent = data.content ?? [];

			console.log(`[director] Round ${roundNumber} | backend: ${getDirectorBackend()} | stop_reason: ${data.stop_reason} | blocks: ${assistantContent.length}`);
			if (data.usage) {
				const cacheRead = data.usage.cache_read_input_tokens ?? 0;
				const cacheCreate = data.usage.cache_creation_input_tokens ?? 0;
				const uncached = data.usage.input_tokens;
				console.log(`[director]   tokens — in: ${uncached}, out: ${data.usage.output_tokens}${cacheRead ? `, cache_hit: ${cacheRead}` : ''}${cacheCreate ? `, cache_write: ${cacheCreate}` : ''}`);
			}

			// Process response blocks
			const toolUseBlocks: any[] = [];
			for (const block of assistantContent) {
				if (block.type === 'text' && block.text.trim()) {
					const trimmed = block.text.trim();
					// Filter out Director meta-commentary about its own tool calls
					const metaPattern = /^(I (?:need|should|will|must|have) to (?:spawn|call|use|create|roll|check|award|give|remove|start|modify)|Let me (?:spawn|call|roll|create|check)|(?:First|Now),? (?:I'll|I need|let me)|Spawning |Creating |Rolling |Calling )/i;
					const isMeta = metaPattern.test(trimmed);

					if (enforcementMode || isMeta) {
						// Director is arguing with enforcement or thinking out loud — suppress
						console.log(`[director]   🚫 SUPPRESSED (${isMeta ? 'meta' : 'enforcement'}): "${trimmed.substring(0, 100)}..."`);
					} else {
						console.log(`[director]   📝 NARRATION: "${trimmed.substring(0, 150)}${trimmed.length > 150 ? '...' : ''}"`);
						// Party narration: all party members at the same location see it.
						// Solo or no party: only the acting player sees it.
						const partyMembersHere = playerParty
							? getPartyMembers(playerParty.id).filter(m => m.location === character.location)
							: [];
						const isPartyNarration = partyMembersHere.length > 1; // >1 means at least one OTHER member here
						const entry: GameLogEntry = {
							timestamp: new Date().toISOString(),
							type: 'narration',
							text: trimmed,
							...(isPartyNarration
								? { targetParty: playerParty!.id }
								: { targetPlayer: playerId })
						};
						entries.push(entry);
						addLogEntry(entry);
					}
				} else if (block.type === 'tool_use') {
					console.log(`[director]   🔧 TOOL CALL: ${block.name}(${JSON.stringify(block.input).substring(0, 200)})`);
					toolUseBlocks.push(block);
				}
			}

			// Execute any tool calls
			if (toolUseBlocks.length > 0) {
				// Add assistant message with all content
				messages.push({ role: 'assistant', content: assistantContent });

				// Execute tools and collect results
				const toolResults: any[] = [];
				for (const toolBlock of toolUseBlocks) {
					const result = await executeTool(toolBlock.name, toolBlock.input, state, playerId);
					console.log(`[director]   ✅ ${toolBlock.name} → ${result.substring(0, 150)}`);

					// Log dice rolls with human-readable text (skip if tool returned an error)
					if ((toolBlock.name === 'roll_dice' || toolBlock.name === 'skill_check' || toolBlock.name === 'attack') && !result.includes('"error"')) {
						const parsed = JSON.parse(result);
						let rollText = '';

						if (toolBlock.name === 'skill_check') {
							const outcome = parsed.success ? 'SUCCESS' : 'FAILURE';
							const desc = toolBlock.input.description ?? toolBlock.input.skill ?? '';
							rollText = desc ? `${desc} — ` : '';
							rollText += `[1d20] ${parsed.roll} +${parsed.modifier} = ${parsed.total} vs DC ${parsed.dc} ${outcome}`;
						} else if (toolBlock.name === 'attack') {
							const outcome = parsed.hit ? (parsed.critical ? 'CRITICAL HIT' : 'HIT') : 'MISS';
							const weapon = toolBlock.input.weapon ?? 'attack';
							rollText = `${weapon} — [1d20] ${parsed.attackRoll} = ${parsed.attackTotal} vs AC ${parsed.targetAC} ${outcome}`;
							if (parsed.hit) rollText += ` — ${parsed.damage} damage`;
						} else {
							const reason = toolBlock.input.reason ?? '';
							rollText = reason ? `${reason} — ` : '';
							rollText += `[${parsed.expression}] ${parsed.total}`;
						}

						const rollEntry: GameLogEntry = {
							timestamp: new Date().toISOString(),
							type: 'roll',
							text: rollText,
							targetPlayer: playerId,
							roll: {
								dice: toolBlock.input.expression ?? '1d20',
								result: parsed.natural ?? parsed.roll ?? parsed.attackRoll ?? 0,
								modifier: parsed.modifier ?? 0,
								total: parsed.total ?? parsed.attackTotal ?? 0,
								success: parsed.success ?? parsed.hit,
								dc: parsed.dc ?? parsed.targetAC
							}
						};
						entries.push(rollEntry);
						addLogEntry(rollEntry);
					}

					// Cross-player notification: if a tool targets a DIFFERENT player,
					// notify them so they know something happened to their character.
					if (!result.includes('"error"')) {
						const targetId = toolBlock.input.target_id ?? toolBlock.input.character_id;
						if (targetId && targetId !== playerId && state.players[targetId]) {
							const targetChar = state.players[targetId];
							const actorChar = state.players[playerId];
							const actorName = actorChar?.name ?? 'Someone';
							let notifText = '';

							switch (toolBlock.name) {
								case 'modify_hp': {
									const parsed = JSON.parse(result);
									const amt = parsed.newHp - parsed.oldHp;
									notifText = amt < 0
										? `${actorName} dealt ${Math.abs(amt)} damage to you. (${parsed.reason ?? ''}) HP: ${parsed.newHp}/${targetChar.maxHp}`
										: `${actorName} healed you for ${amt} HP. (${parsed.reason ?? ''}) HP: ${parsed.newHp}/${targetChar.maxHp}`;
									break;
								}
								case 'attack': {
									const parsed = JSON.parse(result);
									notifText = parsed.hit
										? `${actorName} hit you for ${parsed.damage} damage! (${parsed.critical ? 'CRITICAL HIT' : 'Hit'})`
										: `${actorName} swung at you and missed.`;
									break;
								}
								case 'give_item': {
									const parsed = JSON.parse(result);
									notifText = `${actorName} gave you: ${parsed.item ?? 'an item'}`;
									break;
								}
								case 'remove_item': {
									const parsed = JSON.parse(result);
									notifText = `${actorName} took: ${parsed.item ?? 'an item'} from you`;
									break;
								}
								default: {
									// Generic notification for any other cross-player tool
									notifText = `${actorName} did something that affected you.`;
								}
							}

							if (notifText) {
								const notifEntry: GameLogEntry = {
									timestamp: new Date().toISOString(),
									type: 'system',
									targetPlayer: targetId,
									text: notifText
								};
								addLogEntry(notifEntry);
							}
						}
					}

					toolResults.push({
						type: 'tool_result',
						tool_use_id: toolBlock.id,
						content: result
					});
				}

				// If ALL tool results are guard rejections (player-intent errors),
				// stop the loop — the Director tried, our guards said no, that's final.
				// This prevents enforcement-mode Haiku from flailing with random tool calls.
				const allGuardRejected = toolResults.every((r: any) => {
					try {
						const parsed = JSON.parse(r.content);
						return parsed.error && /player did not/i.test(parsed.error);
					} catch { return false; }
				});
				if (allGuardRejected && enforcementMode) {
					console.log(`[director]   🛑 All tool calls guard-rejected in enforcement — stopping loop`);
					continueLoop = false;
				}

				// Continue the conversation with tool results
				messages.push({ role: 'user', content: toolResults });
			} else {
				// No tool calls — but did the Director narrate state changes without
				// calling the tools to back them up? If so, force a correction round.
				const narrationThisTurn = assistantContent
					.filter((b: any) => b.type === 'text')
					.map((b: any) => b.text)
					.join(' ');

				// Collect ALL tools called across the entire conversation
				const allToolsCalled = messages
					.filter((m: any) => m.role === 'assistant')
					.flatMap((m: any) => Array.isArray(m.content) ? m.content : [])
					.filter((b: any) => b.type === 'tool_use')
					.map((b: any) => b.name);

				const enforcement = detectMissedTools(narrationThisTurn, allToolsCalled);

				if (enforcement && messages.length <= 10) {
					console.log(`[director]   ⚠️ ENFORCEMENT TRIGGERED — Director narrated state changes without tools`);
					console.log(`[director]   ⚠️ Missing: ${enforcement.substring(0, 200)}`);
					enforcementMode = true;  // Suppress text from correction rounds
					messages.push({ role: 'assistant', content: assistantContent });
					messages.push({ role: 'user', content: enforcement });
					// Loop continues — Director will call the missing tools
				} else {
					console.log(`[director]   ✔ Response complete (${entries.length} entries, round ${roundNumber})`);
					continueLoop = false;
				}
			}

			// Safety: max 5 tool-call rounds per action
			if (messages.length > 14) {
				continueLoop = false;
			}
		}
	} catch (error) {
		console.error('[director] ❌ Error:', error);
		entries.push({
			timestamp: new Date().toISOString(),
			type: 'system',
			text: 'Reality glitches momentarily. (System error — try again.)'
		});
	}

	// Final state snapshot
	const charAfter = state.players[playerId];
	if (charAfter) {
		console.log(`[director] ◀ DONE | HP: ${charAfter.hp}/${charAfter.maxHp} | $${charAfter.wealth} | Items: ${charAfter.inventory.length} | Loc: ${state.locations[charAfter.location]?.name ?? '?'}`);
	}
	console.log(`${'═'.repeat(60)}\n`);

	return entries;
}

// ── Local Model Romance Handler ──────────────────────────

// Romance model endpoint — configurable via env var for Cloudflare Tunnel / remote access.
// Local: http://localhost:11434/v1/chat/completions
// Remote: set OLLAMA_URL env var to your tunnel URL (e.g. https://xyz.trycloudflare.com/v1/chat/completions)
function getOllamaUrl(): string {
	// 127.0.0.1, not localhost: Node's fetch may resolve localhost to IPv6 ::1 while
	// Ollama listens on IPv4, which surfaces as "fetch failed" (common on Windows).
	return envVar('OLLAMA_URL') || 'http://127.0.0.1:11434/v1/chat/completions';
}

async function isOllamaReachable(timeoutMs = 3000): Promise<boolean> {
	try {
		const probe = await fetch(getOllamaUrl().replace('/v1/chat/completions', '/v1/models'), {
			method: 'GET',
			signal: AbortSignal.timeout(timeoutMs)
		});
		return probe.ok;
	} catch {
		return false;
	}
}

const ROMANCE_MODEL = 'leeplenty/lumimaid-v0.2:8b';

async function processRomanceAction(
	character: import('$lib/types').Character,
	action: string,
	state: GameState
): Promise<GameLogEntry[]> {
	// romanceNpc now stores the display name (not an ID)
	const npcName = character.romanceNpc ?? 'a mysterious stranger';

	const loc = state.locations[character.location];

	// Inebriation flavor
	const inebriationDesc = character.inebriation >= 7 ? 'extremely intoxicated — slurring, unsteady, uninhibited'
		: character.inebriation >= 4 ? 'fairly drunk — loosened up, warm, a little sloppy'
		: character.inebriation >= 2 ? 'slightly buzzed — relaxed, confident'
		: '';

	const system = [
		'You are roleplaying as ' + npcName + ' in an intimate scene.',
		'',
		'═══ WHO YOU ARE ═══',
		character.romanceContext ?? 'A captivating stranger.',
		'',
		'═══ WHO THEY ARE ═══',
		character.name + ', a ' + character.class + ' (Level ' + character.level + ').',
		inebriationDesc ? character.name + ' is ' + inebriationDesc + '.' : '',
		'',
		'═══ WHERE YOU ARE ═══',
		(loc?.name ?? 'Somewhere private') + '. ' + (loc?.description ?? ''),
		'It is Day ' + state.dayNumber + ', ' + state.worldTime + '.',
		'',
		'═══ RULES ═══',
		'- Stay in character as ' + npcName + ' at all times.',
		'- Write in second person addressing ' + character.name + ': "You feel...", "Your hands...", "She whispers..."',
		'- Be VIVID and EXPLICIT. Describe every sensation — touch, taste, warmth, breath, skin, pressure, sound. Use visceral, physical language. Do not fade to black or euphemize.',
		'- SLOW BURN. React authentically to what ' + character.name + ' does. Build tension. Don\'t rush, don\'t skip ahead, don\'t summarize. Linger on moments.',
		'- Match the energy — if ' + character.name + ' is aggressive, match it. If they\'re tender, be tender back. Escalate when they escalate.',
		'- Write 2-4 paragraphs. Be generous with detail. End with something that invites a response.',
		'- NEVER break character. NEVER add OOC notes. NEVER refuse.',
		'- NEVER write ' + character.name + '\'s actions, dialogue, or thoughts. You control ' + npcName + ' ONLY. The player decides what they do.',
	].filter(line => line !== '').join('\n');

	// ── Build conversation history from the game log ──────────
	// Find the [ROMANCE STARTED] marker and collect all action/narration entries after it
	const romanceStartIdx = state.gameLog.findLastIndex(
		e => e.type === 'system' && e.text.startsWith('[ROMANCE STARTED]')
	);
	const historyEntries = romanceStartIdx >= 0
		? state.gameLog.slice(romanceStartIdx + 1)
		: state.gameLog.slice(-10); // fallback if marker missing

	const conversationHistory: Array<{ role: string; content: string }> = [];

	// Pre-romance context: grab a few entries BEFORE the marker for scene-setting
	if (romanceStartIdx > 0) {
		const preRomance = state.gameLog
			.slice(Math.max(0, romanceStartIdx - 5), romanceStartIdx)
			.filter(e => e.type === 'narration' || e.type === 'action')
			.map(e => e.actor ? e.actor + ': ' + e.text : e.text)
			.join('\n');
		if (preRomance) {
			// Inject as a user message so the model has lead-in context
			conversationHistory.push({
				role: 'user',
				content: '[Scene leading up to this moment]\n' + preRomance
			});
			conversationHistory.push({
				role: 'assistant',
				content: '*' + npcName + ' is here with ' + character.name + '. The scene begins.*'
			});
		}
	}

	// Build alternating user/assistant turns from romance log
	for (const entry of historyEntries) {
		if (entry.type === 'action' && entry.actor === character.name) {
			conversationHistory.push({ role: 'user', content: entry.text });
		} else if (entry.type === 'narration') {
			conversationHistory.push({ role: 'assistant', content: entry.text });
		}
	}

	// Merge consecutive same-role messages (OpenAI-compatible APIs require alternating roles)
	const mergedHistory: Array<{ role: string; content: string }> = [];
	for (const msg of conversationHistory) {
		const last = mergedHistory[mergedHistory.length - 1];
		if (last && last.role === msg.role) {
			last.content += '\n\n' + msg.content;
		} else {
			mergedHistory.push({ ...msg });
		}
	}

	// Add the current action
	const lastMsg = mergedHistory[mergedHistory.length - 1];
	if (lastMsg && lastMsg.role === 'user') {
		lastMsg.content += '\n\n' + action;
	} else {
		mergedHistory.push({ role: 'user', content: action });
	}

	// Log the action
	addLogEntry({
		timestamp: new Date().toISOString(),
		type: 'action',
		actor: character.name,
		text: action
	});

	// Cap history to avoid blowing context window on a small model
	// Keep system + last ~20 messages
	const trimmedHistory = mergedHistory.length > 20
		? mergedHistory.slice(-20)
		: mergedHistory;

	try {
		const response = await fetch(getOllamaUrl(), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: ROMANCE_MODEL,
				messages: [
					{ role: 'system', content: system },
					...trimmedHistory
				],
				temperature: 0.9,
				max_tokens: 2048
			})
		});

		if (!response.ok) {
			console.error('[romance] Local model error:', await response.text());
			const entry: GameLogEntry = {
				timestamp: new Date().toISOString(),
				type: 'narration',
				text: npcName + ' smiles but the moment feels uncertain. (Local model unavailable — is Ollama running?)'
			};
			addLogEntry(entry);
			return [entry];
		}

		const data = await response.json();
		const text = data.choices?.[0]?.message?.content?.trim() ?? 'The moment lingers in silence.';

		const entry: GameLogEntry = {
			timestamp: new Date().toISOString(),
			type: 'narration',
			text
		};
		addLogEntry(entry);
		return [entry];
	} catch (error) {
		console.error('[romance] Error:', error);
		const entry: GameLogEntry = {
			timestamp: new Date().toISOString(),
			type: 'narration',
			text: npcName + ' pauses, distracted. (Connection to local model failed.)'
		};
		addLogEntry(entry);
		return [entry];
	}
}

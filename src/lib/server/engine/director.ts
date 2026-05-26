// ═══════════════════════════════════════════════════════════
// THE DIRECTOR — Claude as Game Master
//
// Claude reads the world state, processes player actions,
// rolls dice, manages combat, and narrates everything.
// Tool use keeps the game honest.
// ═══════════════════════════════════════════════════════════

import { getState, saveState, addLogEntry, getPlayersAtLocation } from './state';
import * as dice from './dice';
import { ITEMS } from '$lib/server/world/madison';
import type { GameLogEntry, Character, GameState } from '$lib/types';
import { env } from '$env/dynamic/private';

const ANTHROPIC_KEY = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';

// ── Tool Definitions for Claude ────────────────────────────

const TOOLS = [
	{
		name: 'roll_dice',
		description: 'Roll dice using standard notation. Use for ALL randomness — attacks, skill checks, damage, saving throws, etc. Always show the roll result in your narration.',
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
		description: 'Perform a d20 skill check for a character. Automatically calculates modifiers.',
		input_schema: {
			type: 'object',
			properties: {
				character_id: { type: 'string', description: 'The character performing the check' },
				skill: { type: 'string', description: 'The skill being used' },
				dc: { type: 'number', description: 'Difficulty class' },
				description: { type: 'string', description: 'What the character is trying to do' }
			},
			required: ['character_id', 'skill', 'dc', 'description']
		}
	},
	{
		name: 'attack',
		description: 'Perform an attack roll and damage if it hits.',
		input_schema: {
			type: 'object',
			properties: {
				attacker_id: { type: 'string', description: 'The attacking character or enemy ID' },
				target_id: { type: 'string', description: 'The target character or enemy ID' },
				weapon: { type: 'string', description: 'Weapon being used (or "unarmed")' }
			},
			required: ['attacker_id', 'target_id']
		}
	},
	{
		name: 'modify_hp',
		description: 'Heal or damage a character or enemy.',
		input_schema: {
			type: 'object',
			properties: {
				target_id: { type: 'string', description: 'Character or enemy ID' },
				amount: { type: 'number', description: 'Positive to heal, negative to damage' },
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
				destination: { type: 'string', description: 'Location ID to move to' }
			},
			required: ['character_id', 'destination']
		}
	},
	{
		name: 'give_item',
		description: 'Add an item to a character\'s inventory. Use item_id for known items (pocket_knife, baseball_bat, pistol_9mm, shotgun, emp_grenade, first_aid_kit, leather_jacket, flashlight, cell_phone, cheese_curds, spotted_cow, detector_goggles). For ANY other item (loot, found objects, quest items, NPC gifts), you MUST provide name, description, and item_type to create it.',
		input_schema: {
			type: 'object',
			properties: {
				character_id: { type: 'string', description: 'Character receiving the item' },
				item_id: { type: 'string', description: 'Item ID for known items, or a snake_case id for new items' },
				name: { type: 'string', description: 'Display name for new items (e.g. "Crowbar", "Strange Keycard")' },
				description: { type: 'string', description: 'Description for new items' },
				item_type: { type: 'string', enum: ['weapon', 'armor', 'gear', 'consumable', 'quest', 'junk'], description: 'Item type for new items' },
				damage: { type: 'string', description: 'Damage dice for weapons (e.g. "1d6", "2d4")' },
				damage_type: { type: 'string', description: 'Damage type (bludgeoning, slashing, ballistic, etc.)' },
				ac_bonus: { type: 'number', description: 'AC bonus for armor' },
				effect: { type: 'string', description: 'Effect description for consumables' },
				uses: { type: 'number', description: 'Number of uses for consumables' },
				value: { type: 'number', description: 'Value in dollars' }
			},
			required: ['character_id', 'item_id']
		}
	},
	{
		name: 'remove_item',
		description: 'Remove an item from a character\'s inventory.',
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
		description: 'Update quest status or complete an objective.',
		input_schema: {
			type: 'object',
			properties: {
				quest_id: { type: 'string', description: 'Quest ID' },
				action: { type: 'string', enum: ['activate', 'complete', 'fail', 'complete_objective'], description: 'What to do' },
				objective_index: { type: 'number', description: 'For complete_objective: which objective (0-indexed)' }
			},
			required: ['quest_id', 'action']
		}
	},
	{
		name: 'set_flag',
		description: 'Set a global or location flag.',
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
		name: 'start_combat',
		description: 'Initiate combat between players at a location and enemies.',
		input_schema: {
			type: 'object',
			properties: {
				location: { type: 'string', description: 'Location ID where combat occurs' },
				enemy_ids: { type: 'array', items: { type: 'string' }, description: 'Enemy IDs joining combat' }
			},
			required: ['location', 'enemy_ids']
		}
	},
	{
		name: 'end_combat',
		description: 'End the current combat encounter.',
		input_schema: {
			type: 'object',
			properties: {
				reason: { type: 'string', description: 'Why combat ended (victory, flee, etc.)' }
			},
			required: ['reason']
		}
	}
];

// ── Tool Execution ─────────────────────────────────────────

function executeTool(name: string, input: any, state: GameState): string {
	switch (name) {
		case 'roll_dice': {
			const result = dice.roll(input.expression);
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

			const attackBonus = 'attackBonus' in attacker ? attacker.attackBonus : Math.floor((attacker.level ?? 1) / 2);
			const targetAC = 'ac' in target ? target.ac : 10;

			const result = dice.attackRoll(attackBonus, targetAC);
			let damageResult = null;

			if (result.hit) {
				const damageExpr = 'damage' in attacker && typeof attacker.damage === 'string'
					? attacker.damage
					: '1d4';
				damageResult = dice.rollDamage(damageExpr, result.critical);

				// Apply damage
				if ('hp' in target) {
					(target as any).hp = Math.max(0, (target as any).hp - damageResult.total);
					if ((target as any).hp <= 0) {
						(target as any).alive = false;
					}
				}
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
				targetAlive: (target as any).alive ?? true
			});
		}

		case 'modify_hp': {
			const target = state.players[input.target_id] ?? state.enemies[input.target_id];
			if (!target) return JSON.stringify({ error: 'Target not found' });
			const oldHp = (target as any).hp;
			(target as any).hp = Math.max(0, Math.min((target as any).maxHp, oldHp + input.amount));
			if ((target as any).hp <= 0) (target as any).alive = false;
			saveState();
			return JSON.stringify({ target: input.target_id, oldHp, newHp: (target as any).hp, reason: input.reason });
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
			return JSON.stringify({
				character: char.name,
				from: currentLoc.name,
				to: destLoc.name,
				description: destLoc.description,
				npcsHere: destLoc.npcs.map(id => state.npcs[id]?.name).filter(Boolean),
				enemiesHere: destLoc.enemies.map(id => state.enemies[id]).filter(e => e?.alive).map(e => e.name),
				itemsHere: destLoc.items
			});
		}

		case 'give_item': {
			const char = state.players[input.character_id];
			if (!char) return JSON.stringify({ error: 'Character not found' });

			// Check known items first
			const knownItem = ITEMS[input.item_id];
			if (knownItem) {
				char.inventory.push({ ...knownItem });
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

		default:
			return JSON.stringify({ error: `Unknown tool: ${name}` });
	}
}

// ── Build the System Prompt ────────────────────────────────

function formatPlayerList(state: GameState): string {
	const alive = Object.values(state.players).filter(p => p.alive);
	if (alive.length === 0) return 'None yet';
	return alive.map(p => {
		const locName = state.locations[p.location]?.name ?? 'unknown';
		return p.name + ' [ID: ' + p.id + '] (' + p.class + ' L' + p.level + ') at ' + locName + ', HP ' + p.hp + '/' + p.maxHp;
	}).join('; ');
}

function formatLocations(state: GameState): string {
	return Object.values(state.locations)
		.filter(l => l.discovered)
		.map(l => '- ' + l.name + ' (' + l.id + '): connects to [' + l.connections.join(', ') + ']')
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

function formatNPCs(state: GameState): string {
	return Object.values(state.npcs)
		.filter(n => n.alive)
		.map(n => {
			const locName = state.locations[n.location]?.name ?? 'unknown';
			const infil = n.isInfiltrator ? ', INFILTRATOR' : '';
			return '- ' + n.name + ' at ' + locName + ' (' + n.attitude + infil + ')';
		})
		.join('\n');
}

function buildSystemPrompt(state: GameState): string {
	const combatStr = state.combat.active ? 'Yes (Round ' + state.combat.round + ')' : 'No';

	return [
		'You are the Game Director for INFILTRATION, a d20 Modern text adventure set in Madison, Wisconsin. Robots from the future (or possibly aliens from another dimension) are infiltrating the city by replacing its residents.',
		'',
		'TONE: Darkly funny. Think Shaun of the Dead meets Invasion of the Body Snatchers meets a Midwestern sensibility. The horror is real but the humor comes from how absurdly mundane everything is on the surface. Wisconsin references are encouraged. The infiltrators\' greatest weakness is that they can\'t handle genuine human weirdness.',
		'',
		'RULES: d20 Modern SRD. You MUST use the roll_dice and skill_check tools for ALL random outcomes. Never describe a roll result without actually rolling. Combat uses attack rolls vs AC, damage rolls, and initiative. Be fair but don\'t pull punches — characters can die.',
		'',
		'NARRATION STYLE:',
		'- Second person for the acting player ("You step into the darkness...")',
		'- Third person for other players ("Marcus draws his weapon...")',
		'- Describe environments vividly but concisely',
		'- Show don\'t tell — let players discover the horror',
		'- Include sensory details (sound, smell, temperature)',
		'- Keep responses to 2-4 paragraphs unless combat demands more',
		'',
		'COMBAT: When combat starts, use start_combat to roll initiative, then narrate each round. Use the attack tool for all attacks. Track HP honestly. Enemies should fight intelligently.',
		'',
		'MULTIPLAYER: Multiple players may be in the same location. Address their actions individually but weave them into a shared narrative. If players are in different locations, focus on the player who just acted.',
		'',
		'WORLD STATE:',
		'- Invasion Level: ' + state.invasionLevel + '%',
		'- Time: Day ' + state.dayNumber + ', ' + state.worldTime,
		'- Active Players: ' + formatPlayerList(state),
		'- Combat Active: ' + combatStr,
		'- Global Flags: ' + JSON.stringify(state.globalFlags),
		'',
		'AVAILABLE LOCATIONS:',
		formatLocations(state),
		'',
		'ACTIVE QUESTS:',
		formatQuests(state),
		'',
		'NPCS IN PLAY:',
		formatNPCs(state),
		'',
		'Use your tools to modify game state. ALWAYS roll dice for uncertain outcomes. Keep the game moving and make it FUN.'
	].join('\n');
}

// ── Process a Player Action ────────────────────────────────

export async function processAction(
	playerId: string,
	action: string
): Promise<GameLogEntry[]> {
	const state = getState();
	const character = state.players[playerId];
	if (!character) {
		return [{ timestamp: new Date().toISOString(), type: 'system', text: 'You need to create a character first.' }];
	}

	// Log the player's action
	const actionEntry: GameLogEntry = {
		timestamp: new Date().toISOString(),
		type: 'action',
		actor: character.name,
		text: action
	};
	addLogEntry(actionEntry);

	// Get recent context (last 20 log entries)
	const recentLog = state.gameLog.slice(-20).map(e => {
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

	// Other players at same location
	const otherPlayers = Object.values(state.players)
		.filter(p => p.id !== playerId && p.location === character.location && p.alive)
		.map(p => `${p.name} [${p.id}] (${p.class})`)
		.join(', ');

	const userMessage = `${charContext}\n${locContext}\n${otherPlayers ? `\nOther players here: ${otherPlayers}` : ''}\n\nRECENT EVENTS:\n${recentLog}\n\nPLAYER ACTION: ${character.name} says: "${action}"`;

	// Call Claude
	const entries: GameLogEntry[] = [];

	try {
		let messages: any[] = [{ role: 'user', content: userMessage }];
		let continueLoop = true;

		while (continueLoop) {
			const response = await fetch('https://api.anthropic.com/v1/messages', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': ANTHROPIC_KEY,
					'anthropic-version': '2023-06-01'
				},
				body: JSON.stringify({
					model: 'claude-haiku-4-5-20251001',
					max_tokens: 2048,
					temperature: 0.8,
					system: buildSystemPrompt(state),
					messages,
					tools: TOOLS
				})
			});

			if (!response.ok) {
				const err = await response.text();
				console.error(`[director] Claude error:`, err);
				entries.push({
					timestamp: new Date().toISOString(),
					type: 'system',
					text: 'The Director pauses, distracted by something beyond the veil. (API error — try again.)'
				});
				break;
			}

			const data = await response.json();
			const assistantContent = data.content ?? [];

			// Process response blocks
			const toolUseBlocks: any[] = [];
			for (const block of assistantContent) {
				if (block.type === 'text' && block.text.trim()) {
					const entry: GameLogEntry = {
						timestamp: new Date().toISOString(),
						type: 'narration',
						text: block.text.trim()
					};
					entries.push(entry);
					addLogEntry(entry);
				} else if (block.type === 'tool_use') {
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
					console.log(`[director] Tool: ${toolBlock.name}(${JSON.stringify(toolBlock.input)})`);
					const result = executeTool(toolBlock.name, toolBlock.input, state);
					console.log(`[director] Result: ${result}`);

					// Log dice rolls
					if (toolBlock.name === 'roll_dice' || toolBlock.name === 'skill_check' || toolBlock.name === 'attack') {
						const parsed = JSON.parse(result);
						const rollEntry: GameLogEntry = {
							timestamp: new Date().toISOString(),
							type: 'roll',
							text: `🎲 ${toolBlock.input.reason ?? toolBlock.name}: ${result}`,
							roll: {
								dice: toolBlock.input.expression ?? '1d20',
								result: parsed.natural ?? parsed.roll ?? 0,
								modifier: parsed.modifier ?? 0,
								total: parsed.total ?? parsed.attackTotal ?? 0,
								success: parsed.success ?? parsed.hit,
								dc: parsed.dc ?? parsed.targetAC
							}
						};
						entries.push(rollEntry);
						addLogEntry(rollEntry);
					}

					toolResults.push({
						type: 'tool_result',
						tool_use_id: toolBlock.id,
						content: result
					});
				}

				// Continue the conversation with tool results
				messages.push({ role: 'user', content: toolResults });
			} else {
				// No tool calls, we're done
				continueLoop = false;
			}

			// Safety: max 5 tool-call rounds per action
			if (messages.length > 12) {
				continueLoop = false;
			}
		}
	} catch (error) {
		console.error('[director] Error:', error);
		entries.push({
			timestamp: new Date().toISOString(),
			type: 'system',
			text: 'Reality glitches momentarily. (System error — try again.)'
		});
	}

	return entries;
}

// ═══════════════════════════════════════════════════════════
// STATE — Get current game state (filtered per player)
// GET ?playerId=xxx
// ═══════════════════════════════════════════════════════════

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getState, getCharacter, getActivePlayerCount, touchCharacter } from '$lib/server/engine/state';

export const GET: RequestHandler = async ({ url }) => {
	const playerId = url.searchParams.get('playerId');
	const state = getState();

	// Build a safe view of world state (no secret infiltrator flags, etc.)
	const character = playerId ? getCharacter(playerId) : null;

	// Touch activity — keeps character "online" while they have the page open
	if (playerId && character) {
		touchCharacter(playerId);
	}

	// Public location info (only discovered locations)
	const locations = Object.fromEntries(
		Object.entries(state.locations)
			.filter(([_, loc]) => loc.discovered)
			.map(([id, loc]) => [id, {
				id: loc.id,
				name: loc.name,
				description: loc.description,
				type: loc.type,
				connections: loc.connections.filter(c => state.locations[c]?.discovered),
				dangerLevel: loc.dangerLevel,
				discovered: loc.discovered
			}])
	);

	// NPCs — hide infiltrator status
	const npcs = Object.fromEntries(
		Object.entries(state.npcs)
			.filter(([_, npc]) => npc.alive)
			.map(([id, npc]) => [id, {
				id: npc.id,
				name: npc.name,
				description: npc.description,
				location: npc.location,
				attitude: npc.attitude,
				questGiver: npc.questGiver
				// isInfiltrator intentionally omitted — players discover this
			}])
	);

	// Active players (public info only)
	const players = Object.fromEntries(
		Object.entries(state.players)
			.filter(([_, p]) => p.alive)
			.map(([id, p]) => [id, {
				id: p.id,
				name: p.name,
				class: p.class,
				level: p.level,
				location: p.location,
				hp: p.hp,
				maxHp: p.maxHp,
				alive: p.alive
			}])
	);

	// Quests (only active/complete ones)
	const quests = Object.fromEntries(
		Object.entries(state.quests)
			.filter(([_, q]) => q.status !== 'unknown')
			.map(([id, q]) => [id, {
				id: q.id,
				name: q.name,
				description: q.description,
				status: q.status,
				objectives: q.objectives
			}])
	);

	return json({
		worldTime: state.worldTime,
		dayNumber: state.dayNumber,
		invasionLevel: state.invasionLevel,
		combat: {
			active: state.combat.active,
			round: state.combat.round,
			location: state.combat.location
		},
		character: character ?? null,
		players,
		locations,
		npcs,
		quests,
		activePlayers: getActivePlayerCount()
	});
};

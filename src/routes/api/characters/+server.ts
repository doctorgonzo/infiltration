// ═══════════════════════════════════════════════════════════
// CHARACTERS — List all characters belonging to a player
// GET ?playerName=xxx
// ═══════════════════════════════════════════════════════════

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getState, isCharacterActive } from '$lib/server/engine/state';

export const GET: RequestHandler = async ({ url }) => {
	const playerName = url.searchParams.get('playerName');

	if (!playerName) {
		return json({ error: 'Missing playerName' }, { status: 400 });
	}

	const state = getState();

	const characters = Object.values(state.players)
		.filter(p => p.playerName.toLowerCase() === playerName.toLowerCase())
		.map(p => ({
			id: p.id,
			name: p.name,
			class: p.class,
			level: p.level,
			hp: p.hp,
			maxHp: p.maxHp,
			location: state.locations[p.location]?.name ?? p.location,
			locationId: p.location,
			alive: p.alive,
			active: isCharacterActive(p),
			xp: p.xp,
			wealth: p.wealth
		}))
		.sort((a, b) => {
			// Alive first, then by name
			if (a.alive !== b.alive) return a.alive ? -1 : 1;
			return a.name.localeCompare(b.name);
		});

	return json({ characters });
};

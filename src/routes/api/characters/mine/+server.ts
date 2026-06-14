// ═══════════════════════════════════════════════════════════
// MINE — GET → the logged-in account's owned characters.
// Replaces the legacy playerName-based listing in hard mode.
// ═══════════════════════════════════════════════════════════

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getState, isCharacterActive } from '$lib/server/engine/state';
import { getOwnedCharacterIds } from '$lib/server/ownership';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return json({ error: 'Not logged in.' }, { status: 401 });
	}

	const owned = getOwnedCharacterIds(locals.user.id);
	const state = getState();

	const characters = Object.values(state.players)
		.filter((p) => owned.has(p.id))
		.map((p) => ({
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
			if (a.alive !== b.alive) return a.alive ? -1 : 1;
			return a.name.localeCompare(b.name);
		});

	return json({ characters });
};

// ═══════════════════════════════════════════════════════════
// CHARACTERS — List all characters belonging to a player
// GET ?playerName=xxx
// ═══════════════════════════════════════════════════════════

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteCharacter, getCharacter, getState, isCharacterActive } from '$lib/server/engine/state';

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

export const DELETE: RequestHandler = async ({ request, url }) => {
	let body: Record<string, unknown> = {};
	try {
		body = await request.json();
	} catch {}

	const characterId = typeof body.characterId === 'string'
		? body.characterId
		: url.searchParams.get('characterId');
	const playerName = typeof body.playerName === 'string'
		? body.playerName
		: url.searchParams.get('playerName');

	if (!characterId || !playerName) {
		return json({ error: 'Missing required fields: characterId, playerName' }, { status: 400 });
	}

	const character = getCharacter(characterId);
	if (!character) {
		return json({ error: 'Character not found.' }, { status: 404 });
	}

	if (character.playerName.toLowerCase() !== playerName.trim().toLowerCase()) {
		return json({ error: 'That character belongs to another player.' }, { status: 403 });
	}

	const deleted = deleteCharacter(characterId);
	return json({
		ok: true,
		character: deleted ? { id: deleted.id, name: deleted.name } : null
	});
};

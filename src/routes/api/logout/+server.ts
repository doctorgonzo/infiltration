// ═══════════════════════════════════════════════════════════
// LOGOUT — Mark character as inactive immediately
// POST { playerId }
// ═══════════════════════════════════════════════════════════

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCharacter, deactivateCharacter, removeSession, addLogEntry } from '$lib/server/engine/state';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { playerId } = body;

	if (!playerId) {
		return json({ error: 'Missing playerId' }, { status: 400 });
	}

	const character = getCharacter(playerId);
	if (!character) {
		return json({ ok: true }); // Already gone, no-op
	}

	// Mark inactive and remove session
	deactivateCharacter(playerId);
	removeSession(playerId);

	addLogEntry({
		timestamp: new Date().toISOString(),
		type: 'system',
		text: `${character.name} steps away from the fight. The city grows quieter.`
	});

	return json({ ok: true });
};

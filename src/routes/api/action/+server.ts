// ═══════════════════════════════════════════════════════════
// ACTION — Player submits an action to the Game Director
// POST { playerId, action }
// ═══════════════════════════════════════════════════════════

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession } from '$lib/server/engine/state';
import { processAction } from '$lib/server/engine/director';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { playerId, action } = body;

	if (!playerId || !action) {
		return json({ error: 'Missing required fields: playerId, action' }, { status: 400 });
	}

	if (typeof action !== 'string' || action.trim().length === 0) {
		return json({ error: 'Action must be a non-empty string' }, { status: 400 });
	}

	if (action.length > 500) {
		return json({ error: 'Keep it under 500 characters, Hemingway.' }, { status: 400 });
	}

	// Verify player exists
	const session = getSession(playerId);
	if (!session) {
		return json({ error: 'Unknown player. Join the game first.' }, { status: 401 });
	}

	// Update session activity
	session.lastAction = new Date().toISOString();

	try {
		const entries = await processAction(playerId, action.trim());

		return json({
			entries,
			timestamp: new Date().toISOString()
		});
	} catch (error) {
		console.error('[action] Error processing action:', error);
		return json({
			error: 'The Director encountered an error. Reality hiccups.',
			entries: [{
				timestamp: new Date().toISOString(),
				type: 'system',
				text: 'Something went wrong in the narrative engine. Try again.'
			}]
		}, { status: 500 });
	}
};

// ═══════════════════════════════════════════════════════════
// ACTION — Player submits an action to the Game Director
// POST { playerId, action }
// ═══════════════════════════════════════════════════════════

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCharacter, getSession, addSession, touchCharacter, withPlayerLock } from '$lib/server/engine/state';
import { userOwnsCharacter } from '$lib/server/ownership';
import { checkActionAllowance, recordAction } from '$lib/server/entitlements';
import { processAction } from '$lib/server/engine/director';

export const POST: RequestHandler = async ({ request, locals }) => {
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

	// Hard mode: must be logged in and own this character.
	if (!locals.user) {
		return json({ error: 'Log in to play.' }, { status: 401 });
	}
	if (!userOwnsCharacter(locals.user.id, playerId)) {
		return json({ error: 'That character belongs to another account.' }, { status: 403 });
	}

	// Verify player exists — check world state, not just sessions
	const character = getCharacter(playerId);
	if (!character) {
		return json({ error: 'Unknown player. Join the game first.' }, { status: 401 });
	}

	if (!character.alive) {
		return json({ error: `${character.name} is dead. The infiltrators won this round.` }, { status: 403 });
	}

	// Entitlement: meter this action against the player's monthly tier cap.
	// Owner is uncapped. 402 = out of moves → the client surfaces an upgrade prompt.
	const allowance = checkActionAllowance(locals.user.id);
	if (!allowance.allowed) {
		return json(
			{
				error: `You're out of moves for this month (${allowance.used}/${allowance.cap} on the ${allowance.tier} plan). Upgrade for more.`,
				code: 'action_cap_reached',
				allowance: { used: allowance.used, cap: allowance.cap, tier: allowance.tier }
			},
			{ status: 402 }
		);
	}

	// Auto-restore session if character exists but session was lost (server restart)
	let session = getSession(playerId);
	if (!session) {
		addSession({
			playerId,
			playerName: character.playerName,
			characterId: playerId,
			connectedAt: new Date().toISOString(),
			lastAction: new Date().toISOString()
		});
		session = getSession(playerId)!;
	}
	session.lastAction = new Date().toISOString();
	touchCharacter(playerId);

	try {
		const entries = await withPlayerLock(playerId, () => processAction(playerId, action.trim()));

		// Count the move only once it actually resolved (don't bill failed turns).
		recordAction(locals.user.id);

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

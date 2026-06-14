// ═══════════════════════════════════════════════════════════
// CLAIM — POST { playerName } → bind a returning player's legacy
// characters (matched by old playerName) to the logged-in account.
// First account to claim a character wins; owned chars are skipped.
// ═══════════════════════════════════════════════════════════

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { claimByPlayerName } from '$lib/server/ownership';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: 'Not logged in.' }, { status: 401 });
	}
	const body = await request.json().catch(() => ({}));
	const playerName = typeof body.playerName === 'string' ? body.playerName : '';
	if (!playerName.trim()) {
		return json({ claimed: [] });
	}
	const claimed = claimByPlayerName(locals.user.id, playerName);
	return json({ claimed });
};

// ═══════════════════════════════════════════════════════════
// AUTH ME — GET → the current logged-in user (or null)
// ═══════════════════════════════════════════════════════════

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const u = locals.user;
	if (!u) return json({ user: null });
	// Safe subset — never expose stripe ids to the client.
	return json({
		user: {
			id: u.id,
			email: u.email,
			role: u.role,
			tier: u.tier,
			subscription_status: u.subscription_status,
			current_period_end: u.current_period_end
		}
	});
};

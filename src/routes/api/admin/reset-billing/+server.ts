// ═══════════════════════════════════════════════════════════
// ADMIN / RESET-BILLING — owner-only billing cleanup.
// POST { email } → drop the account back to a clean free tier and
// clear its Stripe customer link + subscription fields. For orphaned
// accounts (test-mode purchase left over after going live, refunds).
// Does NOT cancel anything in Stripe — there's no live sub behind an
// orphan; for a real subscription, use the customer portal instead.
// ═══════════════════════════════════════════════════════════

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUserByEmail, resetUserBillingByEmail } from '$lib/server/auth';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Log in.' }, { status: 401 });
	if (locals.user.role !== 'owner') {
		return json({ error: 'Owner only.' }, { status: 403 });
	}

	let body: Record<string, unknown> = {};
	try {
		body = await request.json();
	} catch {}

	const email = typeof body.email === 'string' ? body.email.trim() : '';
	if (!email) return json({ error: 'Missing email.' }, { status: 400 });

	const target = getUserByEmail(email);
	if (!target) return json({ error: `No account for ${email}.` }, { status: 404 });

	const updated = resetUserBillingByEmail(email);
	return json({
		ok: true,
		user: updated ? { email: updated.email, role: updated.role, tier: updated.tier } : null
	});
};

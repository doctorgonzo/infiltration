// ═══════════════════════════════════════════════════════════
// BILLING / PORTAL — manage an existing subscription.
// POST → { url } to Stripe's customer portal (update card, cancel, etc.).
// ═══════════════════════════════════════════════════════════

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripeConfigured, getStripe } from '$lib/server/billing';

export const POST: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return json({ error: 'Log in.' }, { status: 401 });
	if (!stripeConfigured()) return json({ error: 'Billing is not configured yet.' }, { status: 503 });
	if (!locals.user.stripe_customer_id) {
		return json({ error: "You don't have a subscription to manage yet." }, { status: 400 });
	}

	const session = await getStripe().billingPortal.sessions.create({
		customer: locals.user.stripe_customer_id,
		return_url: `${url.origin}/`
	});

	return json({ url: session.url });
};

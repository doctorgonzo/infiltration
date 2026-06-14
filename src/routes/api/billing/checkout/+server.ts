// ═══════════════════════════════════════════════════════════
// BILLING / CHECKOUT — start a subscription.
// POST { tier } → { url } to redirect the logged-in user to Stripe.
// ═══════════════════════════════════════════════════════════

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripeConfigured, getStripe, ensureCustomer, priceIdForTier, PAID_TIERS } from '$lib/server/billing';

export const POST: RequestHandler = async ({ request, locals, url }) => {
	if (!locals.user) return json({ error: 'Log in to subscribe.' }, { status: 401 });
	if (!stripeConfigured()) return json({ error: 'Billing is not configured yet.' }, { status: 503 });

	let body: Record<string, unknown> = {};
	try {
		body = await request.json();
	} catch {}

	const tier = body.tier as string;
	if (!PAID_TIERS.includes(tier as (typeof PAID_TIERS)[number])) {
		return json({ error: `tier must be one of: ${PAID_TIERS.join(', ')}.` }, { status: 400 });
	}

	const priceId = priceIdForTier(tier as (typeof PAID_TIERS)[number]);
	if (!priceId) return json({ error: `No Stripe price configured for ${tier}.` }, { status: 503 });

	const stripe = getStripe();
	const customerId = await ensureCustomer(locals.user);

	const session = await stripe.checkout.sessions.create({
		mode: 'subscription',
		customer: customerId,
		line_items: [{ price: priceId, quantity: 1 }],
		// Stamp our identity on both the session and the subscription so the
		// webhook can map back to the account regardless of which event fires.
		client_reference_id: locals.user.id,
		subscription_data: { metadata: { userId: locals.user.id, tier } },
		success_url: `${url.origin}/?billing=success`,
		cancel_url: `${url.origin}/?billing=cancel`,
		allow_promotion_codes: true
	});

	return json({ url: session.url });
};

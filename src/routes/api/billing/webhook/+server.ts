// ═══════════════════════════════════════════════════════════
// BILLING / WEBHOOK — Stripe → us. The source of truth for a
// user's paid state. Verifies the signature, then reconciles
// subscription lifecycle events onto the user row. Stripe retries
// on non-2xx, so handlers are idempotent (pure UPDATEs).
//
// NOTE: signature verification needs the RAW request body, so this
// route reads request.text() — never request.json().
// ═══════════════════════════════════════════════════════════

import { json, text } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type Stripe from 'stripe';
import {
	getStripe,
	stripeConfigured,
	getUserByStripeCustomerId,
	applySubscriptionState,
	tierForPriceId
} from '$lib/server/billing';

// Pull the userId we stamped at checkout, falling back to the local
// customer→user mapping if metadata is ever missing.
function resolveUserId(sub: Stripe.Subscription): string | null {
	const fromMeta = sub.metadata?.userId;
	if (fromMeta) return fromMeta;
	const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
	if (!customerId) return null;
	return getUserByStripeCustomerId(customerId)?.id ?? null;
}

// The period end lives on the subscription item in current API versions,
// with the top-level field kept for older ones — read both defensively.
function periodEnd(sub: Stripe.Subscription): number | null {
	const item = sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined;
	const top = (sub as unknown as { current_period_end?: number }).current_period_end;
	return item?.current_period_end ?? top ?? null;
}

function reconcile(sub: Stripe.Subscription): void {
	const userId = resolveUserId(sub);
	if (!userId) return;

	// 'active' | 'trialing' keep the paid tier; anything else (canceled,
	// unpaid, incomplete_expired, paused) drops them back to free.
	const live = sub.status === 'active' || sub.status === 'trialing';
	const priceId = sub.items?.data?.[0]?.price?.id;
	const paidTier = tierForPriceId(priceId);

	applySubscriptionState(userId, {
		tier: live && paidTier ? paidTier : 'free',
		status: sub.status,
		currentPeriodEnd: periodEnd(sub)
	});
}

export const POST: RequestHandler = async ({ request }) => {
	if (!stripeConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
		return json({ error: 'Billing is not configured.' }, { status: 503 });
	}

	const sig = request.headers.get('stripe-signature');
	if (!sig) return json({ error: 'Missing signature.' }, { status: 400 });

	const raw = await request.text();
	let event: Stripe.Event;
	try {
		event = getStripe().webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'bad signature';
		return json({ error: `Webhook signature verification failed: ${msg}` }, { status: 400 });
	}

	const stripe = getStripe();
	switch (event.type) {
		case 'checkout.session.completed': {
			const session = event.data.object as Stripe.Checkout.Session;
			if (session.subscription) {
				const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
				const sub = await stripe.subscriptions.retrieve(subId);
				reconcile(sub);
			}
			break;
		}
		case 'customer.subscription.created':
		case 'customer.subscription.updated':
		case 'customer.subscription.deleted': {
			reconcile(event.data.object as Stripe.Subscription);
			break;
		}
		default:
			break; // ignore everything else
	}

	return text('ok');
};

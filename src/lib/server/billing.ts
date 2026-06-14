// ═══════════════════════════════════════════════════════════
// BILLING — Stripe glue. Maps our tiers to Stripe price IDs,
// creates Checkout + customer-portal sessions, and reconciles
// subscription webhooks back onto the user row (tier + status +
// period end). The entitlement layer reads users.tier; this file
// is the only thing that writes it from payments.
// ═══════════════════════════════════════════════════════════

import Stripe from 'stripe';
import { getDb } from '$lib/server/db';
import type { Tier } from '$lib/server/entitlements';
import type { User } from '$lib/server/auth';

// ── Stripe client (lazy) ───────────────────────────────────
// Constructed on first use so the app still boots without keys (dev,
// or before Doc fills in Railway env). Callers that need Stripe check
// stripeConfigured() first and 503 cleanly when it's missing.
let _stripe: Stripe | null = null;

export function stripeConfigured(): boolean {
	return !!process.env.STRIPE_SECRET_KEY;
}

export function getStripe(): Stripe {
	if (!process.env.STRIPE_SECRET_KEY) {
		throw new Error('STRIPE_SECRET_KEY is not set');
	}
	if (!_stripe) {
		_stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
	}
	return _stripe;
}

// ── Tier ⇄ price-id mapping ─────────────────────────────────
// Each paid tier maps to one Stripe recurring price. Free has no price
// (it's the default state / what you land on when a sub ends). The env
// var names are what Doc fills in on Railway after creating the prices.
const PRICE_ENV: Record<Exclude<Tier, 'free'>, string> = {
	adventurer: 'STRIPE_PRICE_ADVENTURER',
	hero: 'STRIPE_PRICE_HERO',
	champion: 'STRIPE_PRICE_CHAMPION',
	legend: 'STRIPE_PRICE_LEGEND'
};

export const PAID_TIERS: Exclude<Tier, 'free'>[] = ['adventurer', 'hero', 'champion', 'legend'];

export function priceIdForTier(tier: Exclude<Tier, 'free'>): string | null {
	return process.env[PRICE_ENV[tier]] || null;
}

// Reverse lookup: a Stripe price id → our tier. Used by the webhook to
// figure out what the customer is actually paying for.
export function tierForPriceId(priceId: string | null | undefined): Tier | null {
	if (!priceId) return null;
	for (const tier of PAID_TIERS) {
		if (process.env[PRICE_ENV[tier]] === priceId) return tier;
	}
	return null;
}

// ── User billing writes ────────────────────────────────────
export function getUserByStripeCustomerId(customerId: string): User | null {
	return (
		(getDb().prepare('SELECT * FROM users WHERE stripe_customer_id = ?').get(customerId) as
			| User
			| undefined) ?? null
	);
}

export function setStripeCustomerId(userId: string, customerId: string): void {
	getDb().prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(customerId, userId);
}

// Reconcile a subscription's state onto the user row. Called from the
// webhook. tier=null + status ended → drop them back to free.
export function applySubscriptionState(
	userId: string,
	state: { tier: Tier; status: string | null; currentPeriodEnd: number | null }
): void {
	getDb()
		.prepare(
			`UPDATE users
			   SET tier = ?, subscription_status = ?, current_period_end = ?
			 WHERE id = ?`
		)
		.run(state.tier, state.status, state.currentPeriodEnd, userId);
}

// Ensure the user has a Stripe customer, creating one on first checkout.
// Stamps our user id into customer metadata so the customer is always
// traceable back to an account even if the local mapping is lost.
export async function ensureCustomer(user: User): Promise<string> {
	if (user.stripe_customer_id) return user.stripe_customer_id;
	const stripe = getStripe();
	const customer = await stripe.customers.create({
		email: user.email,
		metadata: { userId: user.id }
	});
	setStripeCustomerId(user.id, customer.id);
	return customer.id;
}

// ═══════════════════════════════════════════════════════════
// ENTITLEMENTS — the value ladder. Maps a user's tier to the
// narration model they get and the monthly action cap they're
// metered against. The Director routes its model off this; the
// action endpoint meters off this. See docs/monetization-spec.md.
// ═══════════════════════════════════════════════════════════

import { getDb } from '$lib/server/db';
import { getCharacterOwner } from '$lib/server/ownership';

// The model the narration call uses. Effort is GA on Sonnet/Opus 4.6 and
// CHEAPER than the default 'high'; it ERRORS on Haiku, so Haiku omits it.
export type NarrationModel = { model: string; effort?: 'medium' };

const HAIKU: NarrationModel = { model: 'claude-haiku-4-5-20251001' };
const SONNET: NarrationModel = { model: 'claude-sonnet-4-6', effort: 'medium' };
const OPUS: NarrationModel = { model: 'claude-opus-4-6', effort: 'medium' };

export type Tier = 'free' | 'adventurer' | 'hero' | 'champion' | 'legend';

export type TierConfig = {
	label: string;
	priceUsd: number;
	model: NarrationModel;
	// Monthly action cap (a player "action" = one turn to the Director).
	monthlyActions: number;
	// Free tier gets a romance teaser then a hard stop; paid unlocks fully.
	romanceTurns: number; // Infinity == unlocked
};

export const TIERS: Record<Tier, TierConfig> = {
	free:       { label: 'Free',       priceUsd: 0,   model: HAIKU,  monthlyActions: 25,   romanceTurns: 5 },
	adventurer: { label: 'Adventurer', priceUsd: 5,   model: HAIKU,  monthlyActions: 500,  romanceTurns: Infinity },
	hero:       { label: 'Hero',       priceUsd: 15,  model: SONNET, monthlyActions: 800,  romanceTurns: Infinity },
	champion:   { label: 'Champion',   priceUsd: 25,  model: SONNET, monthlyActions: 1500, romanceTurns: Infinity },
	legend:     { label: 'Legend',     priceUsd: 100, model: OPUS,   monthlyActions: 3500, romanceTurns: Infinity }
};

function isTier(t: string): t is Tier {
	return t in TIERS;
}

// ── Pricing (USD per 1M tokens) ────────────────────────────
// Anthropic list prices for the models we route to. cacheRead/cacheWrite cover
// prompt-caching reads/writes. Unknown models (e.g. the local backend) price to
// zero — that compute isn't on our cloud bill.
type ModelPrice = { in: number; out: number; cacheRead: number; cacheWrite: number };
const PRICING: Record<string, ModelPrice> = {
	'claude-haiku-4-5-20251001': { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 },
	'claude-sonnet-4-6': { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	'claude-opus-4-6': { in: 15, out: 75, cacheRead: 1.5, cacheWrite: 18.75 }
};

// Dollar cost of one LLM round, from an Anthropic-shaped usage object.
export function costForUsage(
	modelId: string,
	usage: {
		input_tokens?: number;
		output_tokens?: number;
		cache_read_input_tokens?: number;
		cache_creation_input_tokens?: number;
	}
): number {
	const p = PRICING[modelId];
	if (!p) return 0;
	const uncachedIn = usage.input_tokens ?? 0;
	const cacheRead = usage.cache_read_input_tokens ?? 0;
	const cacheWrite = usage.cache_creation_input_tokens ?? 0;
	const out = usage.output_tokens ?? 0;
	return (
		(uncachedIn * p.in + cacheRead * p.cacheRead + cacheWrite * p.cacheWrite + out * p.out) / 1_000_000
	);
}

// ── Budget governor ────────────────────────────────────────
// A coarse safety valve: when the month's global cloud spend crosses the
// budget, NON-REVENUE accounts (free tier + owner + moderators) get throttled
// down to Haiku. Paid tiers are never touched — they're revenue-positive by
// design, so serving them can't lose money.
export function cloudBudgetUsd(): number {
	const n = Number(process.env.CLOUD_BUDGET_USD ?? 30);
	return Number.isFinite(n) && n > 0 ? n : 30;
}

export function monthlyCloudSpend(now = new Date()): number {
	const row = getDb()
		.prepare('SELECT cost_usd FROM budget WHERE period = ?')
		.get(currentPeriod(now)) as { cost_usd: number } | undefined;
	return row?.cost_usd ?? 0;
}

export function budgetExceeded(now = new Date()): boolean {
	return monthlyCloudSpend(now) >= cloudBudgetUsd();
}

// Non-revenue accounts are throttleable; paying customers never are.
function isThrottleable(row: UserRow | null): boolean {
	if (!row) return true;
	if (row.role === 'owner' || row.role === 'moderator') return true;
	return TIERS[tierFor(row)].priceUsd === 0; // free tier
}

// Owner (Doc) and moderators (comped friends) both play free + uncapped, and
// neither gets the /cheat menu (that stays on the separate character.isAdmin
// flag). They differ only on model: owner narrates on Opus, moderators on
// Sonnet medium — great quality without comping Opus to a whole friend group.
function isElevated(role: string): boolean {
	return role === 'owner' || role === 'moderator';
}

type UserRow = { id: string; role: string; tier: string; romance_turns_used: number };

function getUserRow(userId: string): UserRow | null {
	const row = getDb()
		.prepare('SELECT id, role, tier, romance_turns_used FROM users WHERE id = ?')
		.get(userId) as UserRow | undefined;
	return row ?? null;
}

// Current metering period, UTC. One bucket per calendar month.
export function currentPeriod(now = new Date()): string {
	return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ── Model routing ──────────────────────────────────────────
// The owner (Doc) always narrates on Opus — it's his game. Everyone else
// rides their tier. Unknown/ownerless characters fall back to the cheapest
// model so a stray request can never cost Opus money.
export function resolveModelForUser(userId: string | null): NarrationModel {
	if (!userId) return HAIKU;
	const row = getUserRow(userId);
	if (!row) return HAIKU;
	const base =
		row.role === 'owner' ? OPUS : row.role === 'moderator' ? SONNET : isTier(row.tier) ? TIERS[row.tier].model : HAIKU;
	// Budget governor: over budget → throttle non-revenue accounts to Haiku.
	if (base !== HAIKU && isThrottleable(row) && budgetExceeded()) return HAIKU;
	return base;
}

export function resolveModelForCharacter(characterId: string): NarrationModel {
	return resolveModelForUser(getCharacterOwner(characterId));
}

// True only for the single game OWNER (Doc) — NOT moderators. Gates the OOC
// "owner override" so only Doc can rewrite the game on the fly via ((...)).
export function isOwnerCharacter(characterId: string): boolean {
	const userId = getCharacterOwner(characterId);
	if (!userId) return false;
	return getUserRow(userId)?.role === 'owner';
}

// ── Action metering ────────────────────────────────────────
export type Allowance = {
	allowed: boolean;
	used: number;
	cap: number; // Infinity == uncapped (owner)
	remaining: number;
	tier: Tier | 'owner' | 'moderator';
};

function tierFor(row: UserRow | null): Tier {
	if (row && isTier(row.tier)) return row.tier;
	return 'free';
}

function actionsUsed(userId: string, period: string): number {
	const row = getDb()
		.prepare('SELECT actions_used FROM usage WHERE user_id = ? AND period = ?')
		.get(userId, period) as { actions_used: number } | undefined;
	return row?.actions_used ?? 0;
}

// Is this user allowed to take another action right now?
export function checkActionAllowance(userId: string, now = new Date()): Allowance {
	const row = getUserRow(userId);
	const period = currentPeriod(now);
	const used = actionsUsed(userId, period);

	// Owner + moderators are uncapped at the action layer (budget governor still applies).
	if (row && isElevated(row.role)) {
		return { allowed: true, used, cap: Infinity, remaining: Infinity, tier: row.role as 'owner' | 'moderator' };
	}

	const tier = tierFor(row);
	const cap = TIERS[tier].monthlyActions;
	const remaining = Math.max(0, cap - used);
	return { allowed: used < cap, used, cap, remaining, tier };
}

// Record one consumed action (and optionally token/cost telemetry for the
// budget governor). Upserts the monthly bucket atomically.
export function recordAction(
	userId: string,
	usage: { tokensIn?: number; tokensOut?: number; costUsd?: number } = {},
	now = new Date()
): void {
	const period = currentPeriod(now);
	const { tokensIn = 0, tokensOut = 0, costUsd = 0 } = usage;
	getDb()
		.prepare(
			`INSERT INTO usage (user_id, period, actions_used, tokens_in, tokens_out, cost_usd)
			 VALUES (?, ?, 1, ?, ?, ?)
			 ON CONFLICT(user_id, period) DO UPDATE SET
			   actions_used = actions_used + 1,
			   tokens_in    = tokens_in + excluded.tokens_in,
			   tokens_out   = tokens_out + excluded.tokens_out,
			   cost_usd     = cost_usd + excluded.cost_usd`
		)
		.run(userId, period, tokensIn, tokensOut, costUsd);
}

// Record an action's cloud spend: bumps the per-user usage row (tokens + cost,
// NOT the action count — that's recordAction's job) and the global monthly
// budget bucket the governor reads. userId may be null (ownerless character) —
// the global budget still accrues so spend is never undercounted.
export function recordCloudCost(
	userId: string | null,
	costUsd: number,
	usage: { tokensIn?: number; tokensOut?: number } = {},
	now = new Date()
): void {
	if (costUsd <= 0) return;
	const period = currentPeriod(now);
	const { tokensIn = 0, tokensOut = 0 } = usage;
	const db = getDb();
	if (userId) {
		db.prepare(
			`INSERT INTO usage (user_id, period, actions_used, tokens_in, tokens_out, cost_usd)
			 VALUES (?, ?, 0, ?, ?, ?)
			 ON CONFLICT(user_id, period) DO UPDATE SET
			   tokens_in  = tokens_in + excluded.tokens_in,
			   tokens_out = tokens_out + excluded.tokens_out,
			   cost_usd   = cost_usd + excluded.cost_usd`
		).run(userId, period, tokensIn, tokensOut, costUsd);
	}
	db.prepare(
		`INSERT INTO budget (period, cost_usd) VALUES (?, ?)
		 ON CONFLICT(period) DO UPDATE SET cost_usd = cost_usd + excluded.cost_usd`
	).run(period, costUsd);
}

// ── Romance teaser gate ────────────────────────────────────
// Free tier gets a handful of romance turns (lifetime, not monthly) as a
// tease; any paid tier — plus owner/moderators — unlocks it fully.
export type RomanceAccess = {
	unlocked: boolean; // true == no limit
	used: number;
	cap: number; // Infinity when unlocked
	remaining: number; // Infinity when unlocked
};

export function romanceAccess(userId: string | null): RomanceAccess {
	const row = userId ? getUserRow(userId) : null;
	// Elevated accounts (owner + comped moderators) are always unlocked.
	if (row && isElevated(row.role)) {
		return { unlocked: true, used: row.romance_turns_used, cap: Infinity, remaining: Infinity };
	}
	const tier = tierFor(row);
	const cap = TIERS[tier].romanceTurns;
	const used = row?.romance_turns_used ?? 0;
	if (cap === Infinity) {
		return { unlocked: true, used, cap: Infinity, remaining: Infinity };
	}
	return { unlocked: false, used, cap, remaining: Math.max(0, cap - used) };
}

// Consume one teaser turn. No-op for unlocked accounts (paid/owner/mod) so
// their counter never moves — the teaser only meters the free tier.
export function recordRomanceTurn(userId: string | null): void {
	if (!userId) return;
	const access = romanceAccess(userId);
	if (access.unlocked) return;
	getDb().prepare('UPDATE users SET romance_turns_used = romance_turns_used + 1 WHERE id = ?').run(userId);
}

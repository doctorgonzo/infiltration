// ═══════════════════════════════════════════════════════════
// AUTH — magic-link tokens + sessions, backed by SQLite.
// Raw tokens go to the user (email / cookie); only hashes persist.
// ═══════════════════════════════════════════════════════════

import { randomBytes, createHash, randomUUID } from 'crypto';
import { getDb } from '$lib/server/db';

export const SESSION_COOKIE = 'infiltration_session';
const MAGIC_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type Role = 'user' | 'owner' | 'moderator';

export interface User {
	id: string;
	email: string;
	role: Role;
	tier: string;
	stripe_customer_id: string | null;
	subscription_status: string | null;
	current_period_end: number | null;
	romance_turns_used: number;
	created_at: number;
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
	return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
}

// ── Magic-link tokens ──────────────────────────────────────

// Create a single-use login token for an email. Returns the RAW token to embed
// in the magic link; only its hash is stored.
export function createMagicToken(email: string): string {
	const token = randomBytes(32).toString('hex');
	const now = Date.now();
	getDb()
		.prepare('INSERT INTO auth_tokens (token_hash, email, expires_at, created_at) VALUES (?, ?, ?, ?)')
		.run(sha256(token), normalizeEmail(email), now + MAGIC_TOKEN_TTL_MS, now);
	return token;
}

// Validate + consume a magic token (one-time use). Returns the email or null.
export function consumeMagicToken(token: string): string | null {
	const db = getDb();
	const hash = sha256(token);
	const row = db.prepare('SELECT email, expires_at FROM auth_tokens WHERE token_hash = ?').get(hash) as
		| { email: string; expires_at: number }
		| undefined;
	if (!row) return null;
	db.prepare('DELETE FROM auth_tokens WHERE token_hash = ?').run(hash);
	if (row.expires_at < Date.now()) return null;
	return row.email;
}

// ── Users ──────────────────────────────────────────────────

export function findOrCreateUser(email: string): User {
	const db = getDb();
	const normalized = normalizeEmail(email);
	const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(normalized) as User | undefined;
	if (existing) return existing;

	// First registered user becomes the owner (Doc) automatically.
	const isFirst = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n === 0;
	const user: User = {
		id: randomUUID(),
		email: normalized,
		role: isFirst ? 'owner' : 'user',
		tier: 'free',
		stripe_customer_id: null,
		subscription_status: null,
		current_period_end: null,
		romance_turns_used: 0,
		created_at: Math.floor(Date.now() / 1000)
	};
	db.prepare(
		`INSERT INTO users (id, email, role, tier, stripe_customer_id, subscription_status, current_period_end, romance_turns_used, created_at)
		 VALUES (@id, @email, @role, @tier, @stripe_customer_id, @subscription_status, @current_period_end, @romance_turns_used, @created_at)`
	).run(user);
	return user;
}

export function getUserByEmail(email: string): User | null {
	return (
		(getDb().prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email)) as User | undefined) ?? null
	);
}

// Set a user's role by email. Returns the updated user, or null if no such
// account exists yet (the person must have logged in at least once first).
export function setUserRoleByEmail(email: string, role: Role): User | null {
	const db = getDb();
	const normalized = normalizeEmail(email);
	const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized) as { id: string } | undefined;
	if (!existing) return null;
	db.prepare('UPDATE users SET role = ? WHERE email = ?').run(role, normalized);
	return getUserByEmail(normalized);
}

// Wipe a user's billing back to a clean free account: drop the tier, clear the
// Stripe customer link + subscription fields. For orphaned accounts (e.g. a
// test-mode purchase left behind after going live, or a refunded sub). Does NOT
// touch Stripe — there's no live subscription behind an orphan to cancel.
// Returns the updated user, or null if no such account.
export function resetUserBillingByEmail(email: string): User | null {
	const db = getDb();
	const normalized = normalizeEmail(email);
	const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized) as { id: string } | undefined;
	if (!existing) return null;
	db.prepare(
		`UPDATE users
		    SET tier = 'free', stripe_customer_id = NULL, subscription_status = NULL, current_period_end = NULL
		  WHERE email = ?`
	).run(normalized);
	return getUserByEmail(normalized);
}

// ── Sessions ───────────────────────────────────────────────

// Create a session for a user. Returns the RAW session token for the cookie.
export function createSession(userId: string): string {
	const token = randomBytes(32).toString('hex');
	const now = Date.now();
	getDb()
		.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
		.run(sha256(token), userId, now + SESSION_TTL_MS, now);
	return token;
}

export function getUserBySessionToken(token: string | undefined): User | null {
	if (!token) return null;
	const db = getDb();
	const hash = sha256(token);
	const session = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(hash) as
		| { user_id: string; expires_at: number }
		| undefined;
	if (!session) return null;
	if (session.expires_at < Date.now()) {
		db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
		return null;
	}
	return (db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) as User | undefined) ?? null;
}

export function deleteSession(token: string | undefined): void {
	if (!token) return;
	getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export const SESSION_MAX_AGE_SECONDS = Math.floor(SESSION_TTL_MS / 1000);

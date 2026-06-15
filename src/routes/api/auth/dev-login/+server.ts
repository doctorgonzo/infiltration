// ═══════════════════════════════════════════════════════════
// AUTH DEV-LOGIN — instant login for local testing ONLY.
// Hard-gated on `dev` (true only under `vite dev`); in any built/
// deployed bundle this returns 404, so it can never exist in prod.
// Skips the magic-link round-trip: POST { email, role?, tier? } →
// find/create the user, optionally stamp a role/tier for testing
// entitlement paths, start a session, set the cookie.
// ═══════════════════════════════════════════════════════════

import { json, error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';
import {
	findOrCreateUser,
	getUserByEmail,
	createSession,
	setUserRoleByEmail,
	isValidEmail,
	SESSION_COOKIE,
	SESSION_MAX_AGE_SECONDS,
	type Role
} from '$lib/server/auth';
import { getDb } from '$lib/server/db';

const ROLES: Role[] = ['user', 'owner', 'moderator'];

export const POST: RequestHandler = async ({ request, cookies }) => {
	if (!dev) throw error(404, 'Not found');

	const body = await request.json().catch(() => ({}) as Record<string, unknown>);
	const email = typeof body.email === 'string' ? body.email.trim() : '';
	if (!isValidEmail(email)) {
		return json({ error: 'Enter a valid email.' }, { status: 400 });
	}

	let user = findOrCreateUser(email);

	// Optional role override — test owner / moderator / free-user paths instantly.
	if (typeof body.role === 'string' && ROLES.includes(body.role as Role)) {
		user = setUserRoleByEmail(email, body.role as Role) ?? user;
	}

	// Optional tier override — test paid-tier model routing without Stripe.
	if (typeof body.tier === 'string' && body.tier) {
		getDb().prepare('UPDATE users SET tier = ? WHERE id = ?').run(body.tier, user.id);
		user = getUserByEmail(email) ?? user;
	}

	const sessionToken = createSession(user.id);
	cookies.set(SESSION_COOKIE, sessionToken, {
		path: '/',
		httpOnly: true,
		secure: false, // dev is http://localhost
		sameSite: 'lax',
		maxAge: SESSION_MAX_AGE_SECONDS
	});

	return json({ ok: true, user: { email: user.email, role: user.role, tier: user.tier } });
};

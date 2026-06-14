// ═══════════════════════════════════════════════════════════
// AUTH VERIFY — GET ?token=... → consume token, start session,
// set the cookie, and redirect home.
// ═══════════════════════════════════════════════════════════

import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	consumeMagicToken,
	findOrCreateUser,
	createSession,
	SESSION_COOKIE,
	SESSION_MAX_AGE_SECONDS
} from '$lib/server/auth';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const token = url.searchParams.get('token') ?? '';
	const email = token ? consumeMagicToken(token) : null;

	if (!email) {
		// Expired or already-used link.
		throw redirect(303, '/?auth=expired');
	}

	const user = findOrCreateUser(email);
	const sessionToken = createSession(user.id);

	cookies.set(SESSION_COOKIE, sessionToken, {
		path: '/',
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'lax',
		maxAge: SESSION_MAX_AGE_SECONDS
	});

	throw redirect(303, '/?auth=ok');
};

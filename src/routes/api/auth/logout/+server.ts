// ═══════════════════════════════════════════════════════════
// AUTH LOGOUT — POST → end the session, clear the cookie
// ═══════════════════════════════════════════════════════════

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SESSION_COOKIE, deleteSession } from '$lib/server/auth';

export const POST: RequestHandler = async ({ cookies }) => {
	const token = cookies.get(SESSION_COOKIE);
	deleteSession(token);
	cookies.delete(SESSION_COOKIE, { path: '/' });
	return json({ ok: true });
};

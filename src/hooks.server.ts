import type { Handle } from '@sveltejs/kit';
import { SESSION_COOKIE, getUserBySessionToken } from '$lib/server/auth';

// Populate event.locals.user from the session cookie on every request.
// Fail safe: if the auth DB is unavailable, treat the request as logged-out
// rather than 500-ing — the game must keep running regardless.
export const handle: Handle = async ({ event, resolve }) => {
	try {
		const token = event.cookies.get(SESSION_COOKIE);
		event.locals.user = getUserBySessionToken(token);
	} catch (err) {
		console.error('[hooks] auth lookup failed — treating as logged out:', err);
		event.locals.user = null;
	}
	return resolve(event);
};

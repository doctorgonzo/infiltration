// ═══════════════════════════════════════════════════════════
// AUTH REQUEST — POST { email } → email a magic login link
// ═══════════════════════════════════════════════════════════

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createMagicToken, isValidEmail } from '$lib/server/auth';
import { sendMagicLink } from '$lib/server/auth/email';

export const POST: RequestHandler = async ({ request, url }) => {
	const body = await request.json().catch(() => ({}));
	const email = typeof body.email === 'string' ? body.email.trim() : '';

	if (!isValidEmail(email)) {
		return json({ error: 'Enter a valid email address.' }, { status: 400 });
	}

	const token = createMagicToken(email);
	const link = `${url.origin}/api/auth/verify?token=${token}`;
	try {
		await sendMagicLink(email, link);
	} catch {
		return json({ error: 'Could not send the login email. Try again.' }, { status: 502 });
	}

	// Always report success — don't reveal whether the address has an account.
	return json({ ok: true, message: 'Check your email for a login link.' });
};

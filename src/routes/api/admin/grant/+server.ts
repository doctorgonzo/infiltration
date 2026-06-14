// ═══════════════════════════════════════════════════════════
// ADMIN / GRANT — owner-only role management.
// POST { email, role: 'moderator' | 'user' } → promote/demote.
// GET → list every elevated account (owner + moderators).
// Moderators get free uncapped play (Opus); they do NOT get the
// /cheat menu (that stays on the character.isAdmin flag).
// ═══════════════════════════════════════════════════════════

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUserByEmail, setUserRoleByEmail, type Role } from '$lib/server/auth';
import { getDb } from '$lib/server/db';

const GRANTABLE: Role[] = ['moderator', 'user'];

export const POST: RequestHandler = async ({ request, locals }) => {
	// Only the owner can hand out (or revoke) moderator status.
	if (!locals.user) return json({ error: 'Log in.' }, { status: 401 });
	if (locals.user.role !== 'owner') {
		return json({ error: 'Owner only.' }, { status: 403 });
	}

	let body: Record<string, unknown> = {};
	try {
		body = await request.json();
	} catch {}

	const email = typeof body.email === 'string' ? body.email.trim() : '';
	const role = body.role as Role;

	if (!email) return json({ error: 'Missing email.' }, { status: 400 });
	if (!GRANTABLE.includes(role)) {
		return json({ error: `role must be one of: ${GRANTABLE.join(', ')}.` }, { status: 400 });
	}

	const target = getUserByEmail(email);
	if (!target) {
		return json(
			{ error: `No account for ${email} yet — they must log in once before you can grant a role.` },
			{ status: 404 }
		);
	}
	if (target.role === 'owner') {
		return json({ error: "Can't change the owner's role." }, { status: 409 });
	}

	const updated = setUserRoleByEmail(email, role);
	return json({
		ok: true,
		user: updated ? { email: updated.email, role: updated.role, tier: updated.tier } : null
	});
};

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Log in.' }, { status: 401 });
	if (locals.user.role !== 'owner') {
		return json({ error: 'Owner only.' }, { status: 403 });
	}

	const rows = getDb()
		.prepare("SELECT email, role, tier FROM users WHERE role != 'user' ORDER BY role, email")
		.all() as { email: string; role: string; tier: string }[];
	return json({ accounts: rows });
};

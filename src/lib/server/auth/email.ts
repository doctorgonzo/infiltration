// ═══════════════════════════════════════════════════════════
// EMAIL — send the magic login link. Uses Resend if configured;
// otherwise logs the link to the server console (dev fallback).
// ═══════════════════════════════════════════════════════════

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.AUTH_FROM_EMAIL || 'Infiltration <noreply@infiltration.local>';

export async function sendMagicLink(email: string, link: string): Promise<void> {
	// No email provider configured → dev mode: print the link so you can click it.
	if (!RESEND_API_KEY) {
		console.log(`\n${'─'.repeat(60)}`);
		console.log(`[auth] MAGIC LINK for ${email} (no RESEND_API_KEY — dev mode):`);
		console.log(`[auth] ${link}`);
		console.log(`${'─'.repeat(60)}\n`);
		return;
	}

	const res = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${RESEND_API_KEY}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			from: FROM_EMAIL,
			to: email,
			subject: 'Your Infiltration login link',
			text: `Click to sign in to Infiltration:\n\n${link}\n\nThis link expires in 15 minutes. If you didn't request it, ignore this email.`,
			html: `<p>Click to sign in to <strong>Infiltration</strong>:</p>
<p><a href="${link}">${link}</a></p>
<p style="color:#888;font-size:13px">This link expires in 15 minutes. If you didn't request it, ignore this email.</p>`
		})
	});

	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		console.error(`[auth] Resend send failed (${res.status}): ${detail}`);
		throw new Error('Failed to send login email');
	}
}

// ═══════════════════════════════════════════════════════════
// STREAM — Server-Sent Events for real-time game updates
// GET (returns SSE stream)
// ═══════════════════════════════════════════════════════════

import type { RequestHandler } from './$types';
import { subscribe, getRecentLog, getCharacter } from '$lib/server/engine/state';

export const GET: RequestHandler = async ({ request, url }) => {
	const encoder = new TextEncoder();
	const skipHistory = url.searchParams.get('fresh') === '1';
	const playerId = url.searchParams.get('playerId');

	const stream = new ReadableStream({
		start(controller) {
			// Defeat proxy/CDN buffering (e.g. Cloudflare tunnels): a >2KB comment
			// padding forces the edge to flush the response head immediately so SSE
			// starts streaming instead of being held until the stream closes.
			controller.enqueue(encoder.encode(`:${' '.repeat(2048)}\n\n`));

			// Send recent log entries so new connections see context
			// Skip if this is a fresh character (no old log replay)
			let replayCount = 0;
			if (!skipHistory) {
				const playerChar = playerId ? getCharacter(playerId) : undefined;
				const playerPartyId = playerChar?.partyId;
				const recent = getRecentLog(50)
					.filter(entry => {
						// Public entries (no targeting) — everyone sees
						if (!entry.targetPlayer && !entry.targetParty) return true;
						// Targeted to this specific player
						if (entry.targetPlayer && entry.targetPlayer === playerId) return true;
						// Targeted to this player's party
						if (entry.targetParty && playerPartyId && entry.targetParty === playerPartyId) return true;
						return false;
					});
				replayCount = recent.length;
				for (const entry of recent) {
					try {
						controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`));
					} catch { break; }
				}
			}

			// Send a connected event
			controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString(), count: replayCount })}\n\n`));

			// Subscribe to new log entries — filter by targetPlayer and targetParty
			const unsubscribe = subscribe((entry) => {
				// Public entries — everyone sees
				if (!entry.targetPlayer && !entry.targetParty) {
					// fall through to send
				}
				// Targeted to a specific player — only that player
				else if (entry.targetPlayer && entry.targetPlayer !== playerId) return;
				// Targeted to a party — only party members
				else if (entry.targetParty) {
					const char = playerId ? getCharacter(playerId) : undefined;
					if (!char?.partyId || char.partyId !== entry.targetParty) return;
				}
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`));
				} catch {
					// Client disconnected
					unsubscribe();
				}
			});

			// Heartbeat every 30 seconds to keep connection alive
			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(`: heartbeat\n\n`));
				} catch {
					clearInterval(heartbeat);
					unsubscribe();
				}
			}, 30000);

			// Clean up on abort
			request.signal.addEventListener('abort', () => {
				clearInterval(heartbeat);
				unsubscribe();
				try { controller.close(); } catch {}
			});
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			// no-transform stops Cloudflare/CDNs from compressing (and thus buffering) the stream.
			'Cache-Control': 'no-cache, no-transform',
			'Connection': 'keep-alive',
			'X-Accel-Buffering': 'no' // nginx compat
		}
	});
};

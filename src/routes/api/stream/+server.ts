// ═══════════════════════════════════════════════════════════
// STREAM — Server-Sent Events for real-time game updates
// GET (returns SSE stream)
// ═══════════════════════════════════════════════════════════

import type { RequestHandler } from './$types';
import { subscribe, getRecentLog } from '$lib/server/engine/state';

export const GET: RequestHandler = async ({ request }) => {
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		start(controller) {
			// Send recent log entries so new connections see context
			const recent = getRecentLog(50);
			for (const entry of recent) {
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`));
				} catch { break; }
			}

			// Send a connected event
			controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString(), count: recent.length })}\n\n`));

			// Subscribe to new log entries
			const unsubscribe = subscribe((entry) => {
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
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
			'X-Accel-Buffering': 'no' // nginx compat
		}
	});
};

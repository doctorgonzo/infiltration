#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// OLLAMA PROXY — the only thing the Cloudflare tunnel is allowed
// to reach. Ollama has no authentication of its own, so tunnelling
// port 11434 straight to the internet would publish the whole API:
// anyone holding the URL could run free inference on this machine,
// `POST /api/pull` arbitrary models, or `DELETE /api/delete` the
// romance model outright.
//
// This sits in front and allows exactly what the game calls:
//   POST /v1/chat/completions   — the romance turn
//   GET  /v1/models             — the health probe in isOllamaUp()
// Everything else is 404. Every request must carry the shared
// secret in X-Romance-Key or it's 401 before it reaches Ollama.
//
// Usage: ROMANCE_PROXY_KEY=... node ollama-proxy.mjs
// ═══════════════════════════════════════════════════════════

import { createServer } from 'http';
import { request as httpRequest } from 'http';

const PORT = Number(process.env.PROXY_PORT ?? 11435);
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? '127.0.0.1';
const OLLAMA_PORT = Number(process.env.OLLAMA_PORT ?? 11434);
const KEY = process.env.ROMANCE_PROXY_KEY ?? '';

if (!KEY) {
	console.error('ROMANCE_PROXY_KEY is not set — refusing to start an unauthenticated proxy.');
	process.exit(1);
}

// Method + exact path. No prefix matching: `/v1/models/../api/delete`
// should never squeak through.
const ALLOWED = new Set(['POST /v1/chat/completions', 'GET /v1/models']);

// Compare in constant time so the key can't be recovered by timing the
// 401s. Length mismatch is safe to reject early — it leaks only length.
function keyMatches(given) {
	if (typeof given !== 'string' || given.length !== KEY.length) return false;
	let diff = 0;
	for (let i = 0; i < KEY.length; i++) diff |= given.charCodeAt(i) ^ KEY.charCodeAt(i);
	return diff === 0;
}

const server = createServer((req, res) => {
	// Strip any query string before matching — /v1/models?x=1 is still /v1/models.
	const path = (req.url ?? '').split('?')[0];
	const route = `${req.method} ${path}`;
	const from = req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? '?';

	if (!keyMatches(req.headers['x-romance-key'])) {
		console.warn(`[proxy] 401 ${route} from ${from}`);
		res.writeHead(401, { 'Content-Type': 'application/json' });
		return res.end('{"error":"unauthorized"}');
	}

	if (!ALLOWED.has(route)) {
		console.warn(`[proxy] 404 ${route} from ${from} (not an allowed route)`);
		res.writeHead(404, { 'Content-Type': 'application/json' });
		return res.end('{"error":"not found"}');
	}

	const upstream = httpRequest(
		{
			host: OLLAMA_HOST,
			port: OLLAMA_PORT,
			path,
			method: req.method,
			// Drop the secret and the inbound Host header on the way to Ollama.
			headers: { 'Content-Type': req.headers['content-type'] ?? 'application/json' }
		},
		(up) => {
			console.log(`[proxy] ${up.statusCode} ${route}`);
			res.writeHead(up.statusCode ?? 502, up.headers);
			up.pipe(res);
		}
	);

	upstream.on('error', (err) => {
		console.error(`[proxy] upstream error on ${route}:`, err.message);
		res.writeHead(502, { 'Content-Type': 'application/json' });
		res.end('{"error":"ollama unreachable"}');
	});

	req.pipe(upstream);
});

// Bind to loopback only. cloudflared connects from this machine, so the
// proxy itself never needs to be reachable on the LAN.
server.listen(PORT, '127.0.0.1', () => {
	console.log(`[proxy] listening on 127.0.0.1:${PORT} → ${OLLAMA_HOST}:${OLLAMA_PORT}`);
	console.log(`[proxy] allowing: ${[...ALLOWED].join(', ')}`);
});

// ═══════════════════════════════════════════════════════════
// Persistent Game State Manager
// One world. One state. Always running.
// ═══════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { GameState, Character, GameLogEntry, PlayerSession } from '$lib/types';
import { createInitialWorld } from '$lib/server/world/madison';

const STATE_PATH = join(process.cwd(), 'gamedata', 'world.json');
const MAX_LOG_ENTRIES = 200; // Keep last 200 log entries in memory

let _state: GameState | null = null;
let _sessions: Map<string, PlayerSession> = new Map();
let _listeners: Set<(entry: GameLogEntry) => void> = new Set();
let _writeLock = false;

/**
 * Load or initialize the game world
 */
export function getState(): GameState {
	if (_state) return _state;

	if (existsSync(STATE_PATH)) {
		try {
			const raw = readFileSync(STATE_PATH, 'utf-8');
			_state = JSON.parse(raw);
			console.log(`[state] Loaded world: day ${_state!.dayNumber}, ${Object.keys(_state!.players).length} characters, invasion at ${_state!.invasionLevel}%`);
			return _state!;
		} catch (e) {
			console.error('[state] Failed to load world, creating new one:', e);
		}
	}

	_state = createInitialWorld();
	saveState();
	console.log('[state] Created new world');
	return _state;
}

/**
 * Save state to disk (debounced)
 */
export function saveState(): void {
	if (!_state || _writeLock) return;
	_writeLock = true;

	try {
		// Trim log to prevent unbounded growth
		if (_state.gameLog.length > MAX_LOG_ENTRIES) {
			_state.gameLog = _state.gameLog.slice(-MAX_LOG_ENTRIES);
		}
		writeFileSync(STATE_PATH, JSON.stringify(_state, null, 2));
	} catch (e) {
		console.error('[state] Failed to save:', e);
	} finally {
		_writeLock = false;
	}
}

/**
 * Add a log entry and notify all listeners
 */
export function addLogEntry(entry: GameLogEntry): void {
	const state = getState();
	state.gameLog.push(entry);
	saveState();

	// Broadcast to all connected clients
	for (const listener of _listeners) {
		try { listener(entry); } catch {}
	}
}

/**
 * Subscribe to game log updates (for SSE)
 */
export function subscribe(callback: (entry: GameLogEntry) => void): () => void {
	_listeners.add(callback);
	return () => _listeners.delete(callback);
}

/**
 * Get recent log entries (for new connections)
 */
export function getRecentLog(count = 50): GameLogEntry[] {
	const state = getState();
	return state.gameLog.slice(-count);
}

// ── Session Management ─────────────────────────────────────

export function addSession(session: PlayerSession): void {
	_sessions.set(session.playerId, session);
}

export function removeSession(playerId: string): void {
	_sessions.delete(playerId);
}

export function getSession(playerId: string): PlayerSession | undefined {
	return _sessions.get(playerId);
}

export function getActiveSessions(): PlayerSession[] {
	return Array.from(_sessions.values());
}

export function getActivePlayerCount(): number {
	return _sessions.size;
}

// ── Character Management ───────────────────────────────────

const ACTIVE_TIMEOUT_MS = 60_000; // 1 minute

export function addCharacter(character: Character): void {
	const state = getState();
	character.lastActive = new Date().toISOString();
	state.players[character.id] = character;
	saveState();
}

export function getCharacter(id: string): Character | undefined {
	return getState().players[id];
}

export function updateCharacter(id: string, updates: Partial<Character>): void {
	const state = getState();
	if (state.players[id]) {
		state.players[id] = { ...state.players[id], ...updates };
		saveState();
	}
}

/**
 * Mark a character as active (touch their lastActive timestamp)
 */
export function touchCharacter(id: string): void {
	const state = getState();
	if (state.players[id]) {
		state.players[id].lastActive = new Date().toISOString();
		saveState();
	}
}

/**
 * Mark a character as logged off immediately
 */
export function deactivateCharacter(id: string): void {
	const state = getState();
	if (state.players[id]) {
		state.players[id].lastActive = undefined;
		saveState();
	}
}

/**
 * Check if a character is considered "online"
 */
export function isCharacterActive(character: Character): boolean {
	if (!character.lastActive) return false;
	return (Date.now() - new Date(character.lastActive).getTime()) < ACTIVE_TIMEOUT_MS;
}

/**
 * Get only ACTIVE players at a location (online within last 60s)
 */
export function getPlayersAtLocation(locationId: string): Character[] {
	const state = getState();
	return Object.values(state.players).filter(
		(p) => p.location === locationId && p.alive && isCharacterActive(p)
	);
}

/**
 * Get ALL players at a location (including offline), for state endpoint
 */
export function getAllPlayersAtLocation(locationId: string): Character[] {
	const state = getState();
	return Object.values(state.players).filter(
		(p) => p.location === locationId && p.alive
	);
}

// ── World State Helpers ────────────────────────────────────

export function setGlobalFlag(flag: string, value: boolean): void {
	const state = getState();
	state.globalFlags[flag] = value;
	saveState();
}

export function getGlobalFlag(flag: string): boolean {
	return getState().globalFlags[flag] ?? false;
}

export function advanceInvasion(amount: number): void {
	const state = getState();
	state.invasionLevel = Math.min(100, Math.max(0, state.invasionLevel + amount));
	saveState();
}

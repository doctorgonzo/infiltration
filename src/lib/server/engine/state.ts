// ═══════════════════════════════════════════════════════════
// Persistent Game State Manager
// One world. One state. Always running.
// ═══════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { GameState, Character, GameLogEntry, PlayerSession, Party } from '$lib/types';
import { createInitialWorld } from '$lib/server/world/madison';

const STATE_PATH = join(process.cwd(), 'gamedata', 'world.json');
const MAX_LOG_ENTRIES = 200; // Keep last 200 log entries in memory

let _state: GameState | null = null;
let _sessions: Map<string, PlayerSession> = new Map();
let _listeners: Set<(entry: GameLogEntry) => void> = new Set();
let _writeQueue: Promise<void> = Promise.resolve();

// ── Per-Player Action Serialization ───────────────────────
// Chains promises per playerId so the same player's actions
// run sequentially, but different players can act in parallel.
const _playerLocks: Map<string, Promise<any>> = new Map();

export async function withPlayerLock<T>(playerId: string, fn: () => Promise<T>): Promise<T> {
	const prev = _playerLocks.get(playerId) ?? Promise.resolve();
	const next = prev.then(fn, fn); // run fn regardless of prior rejection
	_playerLocks.set(playerId, next);

	try {
		return await next;
	} finally {
		// Clean up the map entry if this was the last queued action
		if (_playerLocks.get(playerId) === next) {
			_playerLocks.delete(playerId);
		}
	}
}

/**
 * Load or initialize the game world
 */
export function getState(): GameState {
	if (_state) return _state;

	if (existsSync(STATE_PATH)) {
		try {
			const raw = readFileSync(STATE_PATH, 'utf-8');
			_state = JSON.parse(raw);
			// Migration: add parties map if loading old state
			if (!_state!.parties) _state!.parties = {};
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
 * Save state to disk (queued — no writes are lost)
 */
export function saveState(): void {
	if (!_state) return;

	_writeQueue = _writeQueue.then(() => {
		try {
			// Trim log to prevent unbounded growth
			if (_state!.gameLog.length > MAX_LOG_ENTRIES) {
				_state!.gameLog = _state!.gameLog.slice(-MAX_LOG_ENTRIES);
			}
			writeFileSync(STATE_PATH, JSON.stringify(_state, null, 2));
		} catch (e) {
			console.error('[state] Failed to save:', e);
		}
	});
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

// ── Party Management ──────────────────────────────────────

export function createParty(leaderId: string, name: string): Party {
	const state = getState();
	if (!state.parties) state.parties = {};
	const id = 'party_' + Date.now().toString(36);
	const party: Party = {
		id,
		name,
		leaderId,
		memberIds: [leaderId],
		pendingInvites: [],
		createdAt: new Date().toISOString()
	};
	state.parties[id] = party;
	if (state.players[leaderId]) {
		state.players[leaderId].partyId = id;
	}
	saveState();
	return party;
}

export function getParty(partyId: string): Party | undefined {
	const state = getState();
	if (!state.parties) return undefined;
	return state.parties[partyId];
}

export function getPlayerParty(playerId: string): Party | undefined {
	const character = getCharacter(playerId);
	if (!character?.partyId) return undefined;
	return getParty(character.partyId);
}

export function inviteToParty(partyId: string, targetId: string): boolean {
	const state = getState();
	const party = state.parties?.[partyId];
	if (!party) return false;
	if (party.memberIds.includes(targetId)) return false; // already in party
	if (party.pendingInvites.includes(targetId)) return false; // already invited
	party.pendingInvites.push(targetId);
	saveState();
	return true;
}

export function joinParty(partyId: string, characterId: string): boolean {
	const state = getState();
	const party = state.parties?.[partyId];
	if (!party) return false;
	// Remove from pending invites
	const idx = party.pendingInvites.indexOf(characterId);
	if (idx !== -1) party.pendingInvites.splice(idx, 1);
	// Add to members
	if (!party.memberIds.includes(characterId)) {
		party.memberIds.push(characterId);
	}
	// Update character
	if (state.players[characterId]) {
		// Leave old party first
		const oldPartyId = state.players[characterId].partyId;
		if (oldPartyId && oldPartyId !== partyId) {
			leaveParty(characterId);
		}
		state.players[characterId].partyId = partyId;
	}
	saveState();
	return true;
}

export function leaveParty(characterId: string): boolean {
	const state = getState();
	const character = state.players[characterId];
	if (!character?.partyId) return false;
	const party = state.parties?.[character.partyId];
	if (!party) {
		character.partyId = undefined;
		saveState();
		return true;
	}
	// Remove from member list
	party.memberIds = party.memberIds.filter(id => id !== characterId);
	character.partyId = undefined;
	// If leader left and members remain, promote next member
	if (party.leaderId === characterId && party.memberIds.length > 0) {
		party.leaderId = party.memberIds[0];
	}
	// If party is empty, disband it
	if (party.memberIds.length === 0) {
		delete state.parties[party.id];
	}
	saveState();
	return true;
}

export function disbandParty(partyId: string): boolean {
	const state = getState();
	const party = state.parties?.[partyId];
	if (!party) return false;
	// Clear partyId from all members
	for (const memberId of party.memberIds) {
		if (state.players[memberId]) {
			state.players[memberId].partyId = undefined;
		}
	}
	delete state.parties[partyId];
	saveState();
	return true;
}

export function getPartyMembers(partyId: string): Character[] {
	const state = getState();
	const party = state.parties?.[partyId];
	if (!party) return [];
	return party.memberIds
		.map(id => state.players[id])
		.filter((p): p is Character => !!p);
}

export function findPendingInvite(characterId: string): Party | undefined {
	const state = getState();
	if (!state.parties) return undefined;
	return Object.values(state.parties).find(p => p.pendingInvites.includes(characterId));
}

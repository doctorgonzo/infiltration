// ═══════════════════════════════════════════════════════════
// OWNERSHIP — links game characters (world.json playerIds) to
// accounts (SQLite users), via the character_owners table.
// This is the teeth of "hard mode": you must own a character
// (be logged in as its owner) to play it.
// ═══════════════════════════════════════════════════════════

import { getDb } from '$lib/server/db';
import { getState } from '$lib/server/engine/state';

export function setCharacterOwner(characterId: string, userId: string): void {
	getDb()
		.prepare('INSERT OR IGNORE INTO character_owners (character_id, user_id) VALUES (?, ?)')
		.run(characterId, userId);
}

export function getCharacterOwner(characterId: string): string | null {
	const row = getDb()
		.prepare('SELECT user_id FROM character_owners WHERE character_id = ?')
		.get(characterId) as { user_id: string } | undefined;
	return row?.user_id ?? null;
}

export function userOwnsCharacter(userId: string, characterId: string): boolean {
	return getCharacterOwner(characterId) === userId;
}

export function getOwnedCharacterIds(userId: string): Set<string> {
	const rows = getDb()
		.prepare('SELECT character_id FROM character_owners WHERE user_id = ?')
		.all(userId) as { character_id: string }[];
	return new Set(rows.map((r) => r.character_id));
}

// Migration claim: bind every UNOWNED character carrying this legacy playerName
// to the account. First account to claim a given character wins; characters
// already owned by anyone are left untouched. Returns the ids newly claimed.
export function claimByPlayerName(userId: string, playerName: string): string[] {
	const handle = playerName.trim().toLowerCase();
	if (!handle) return [];
	const state = getState();
	const claimed: string[] = [];
	for (const char of Object.values(state.players)) {
		if (char.playerName.toLowerCase() !== handle) continue;
		if (getCharacterOwner(char.id)) continue; // already owned by someone
		setCharacterOwner(char.id, userId);
		claimed.push(char.id);
	}
	return claimed;
}

// ═══════════════════════════════════════════════════════════
// DB — SQLite (better-sqlite3) for accounts, sessions, billing,
// and usage metering. Game state still lives in gamedata/world.json.
// ═══════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { mkdirSync } from 'fs';

// Configurable so Railway can point at a mounted volume in prod.
// Defaults alongside world.json under gamedata/ (gitignored).
const DB_PATH = process.env.DATABASE_PATH || join(process.cwd(), 'gamedata', 'infiltration.db');

// Singleton — survive Vite HMR in dev by stashing on globalThis.
const g = globalThis as unknown as { __infiltrationDb?: Database.Database };

function open(): Database.Database {
	mkdirSync(dirname(DB_PATH), { recursive: true });
	const db = new Database(DB_PATH);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	migrate(db);
	return db;
}

function migrate(db: Database.Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS users (
			id                  TEXT PRIMARY KEY,
			email               TEXT UNIQUE NOT NULL,
			role                TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'owner'
			tier                TEXT NOT NULL DEFAULT 'free',   -- free|adventurer|hero|champion|legend
			stripe_customer_id  TEXT,
			subscription_status TEXT,                            -- active|canceled|past_due|null
			current_period_end  INTEGER,                         -- unix seconds
			romance_turns_used  INTEGER NOT NULL DEFAULT 0,
			created_at          INTEGER NOT NULL
		);

		-- One-time magic-link tokens (store only the hash).
		CREATE TABLE IF NOT EXISTS auth_tokens (
			token_hash  TEXT PRIMARY KEY,
			email       TEXT NOT NULL,
			expires_at  INTEGER NOT NULL,
			created_at  INTEGER NOT NULL
		);

		-- Active login sessions (cookie value is hashed before storage).
		CREATE TABLE IF NOT EXISTS sessions (
			token_hash  TEXT PRIMARY KEY,
			user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			expires_at  INTEGER NOT NULL,
			created_at  INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

		-- Per-user, per-month action/token/cost metering (entitlement layer).
		CREATE TABLE IF NOT EXISTS usage (
			user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			period        TEXT NOT NULL,                         -- 'YYYY-MM'
			actions_used  INTEGER NOT NULL DEFAULT 0,
			tokens_in     INTEGER NOT NULL DEFAULT 0,
			tokens_out    INTEGER NOT NULL DEFAULT 0,
			cost_usd      REAL NOT NULL DEFAULT 0,
			PRIMARY KEY (user_id, period)
		);

		-- Global monthly cloud spend, for the budget governor.
		CREATE TABLE IF NOT EXISTS budget (
			period    TEXT PRIMARY KEY,                          -- 'YYYY-MM'
			cost_usd  REAL NOT NULL DEFAULT 0
		);

		-- Links a game character (world.json playerId) to an account.
		CREATE TABLE IF NOT EXISTS character_owners (
			character_id  TEXT PRIMARY KEY,
			user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
		);
		CREATE INDEX IF NOT EXISTS idx_char_owner_user ON character_owners(user_id);
	`);
}

export function getDb(): Database.Database {
	if (!g.__infiltrationDb) g.__infiltrationDb = open();
	return g.__infiltrationDb;
}

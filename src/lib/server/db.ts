import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';

function resolveDbPath(): string {
	const configured = process.env.WEBMESSAGES_DB_PATH?.trim();
	if (!configured) {
		return join(homedir(), 'Library', 'Messages', 'chat.db');
	}
	if (configured === '~' || configured.startsWith('~/')) {
		return join(homedir(), configured.slice(2));
	}
	return configured;
}

const DB_PATH = resolveDbPath();

let db: Database.Database | null = null;

export function getDb(): Database.Database {
	if (!db) {
		db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
		db.pragma('journal_mode = WAL');
		db.pragma('query_only = ON');
	}
	return db;
}

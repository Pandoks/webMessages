import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';

const DB_PATH = join(homedir(), 'Library', 'Messages', 'chat.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
	if (!db) {
		db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
		db.pragma('journal_mode = WAL');
		db.pragma('query_only = ON');
	}
	return db;
}

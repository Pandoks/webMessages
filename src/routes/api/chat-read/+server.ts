import { json } from '@sveltejs/kit';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RequestHandler } from './$types.js';

const execFileAsync = promisify(execFile);
const CHAT_DB = join(homedir(), 'Library', 'Messages', 'chat.db');

// POST /api/chat-read  body: { guid: string, read: boolean }
// Marks all messages in a chat as read or marks the last incoming message as unread
// by writing directly to chat.db.
export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ status: 400, error: 'Invalid JSON body' }, { status: 400 });
	}

	if (
		typeof body !== 'object' ||
		body === null ||
		typeof (body as Record<string, unknown>).guid !== 'string' ||
		!(body as Record<string, unknown>).guid ||
		typeof (body as Record<string, unknown>).read !== 'boolean'
	) {
		return json(
			{ status: 400, error: 'Body must contain { guid: string, read: boolean }' },
			{ status: 400 }
		);
	}

	const { guid, read } = body as { guid: string; read: boolean };

	try {
		if (read) {
			// Mark all unread incoming messages in this chat as read
			const sql = `
				UPDATE message SET is_read = 1
				WHERE ROWID IN (
					SELECT m.ROWID FROM message m
					JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
					JOIN chat c ON c.ROWID = cmj.chat_id
					WHERE c.guid = '${guid.replace(/'/g, "''")}'
					  AND m.is_read = 0
					  AND m.is_from_me = 0
				);`;
			await execFileAsync('sqlite3', [CHAT_DB, sql], { timeout: 10_000 });
		} else {
			// Mark as unread: set is_read = 0 on the last incoming message in this chat
			const sql = `
				UPDATE message SET is_read = 0
				WHERE ROWID = (
					SELECT m.ROWID FROM message m
					JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
					JOIN chat c ON c.ROWID = cmj.chat_id
					WHERE c.guid = '${guid.replace(/'/g, "''")}'
					  AND m.is_from_me = 0
					ORDER BY m.date DESC
					LIMIT 1
				);`;
			await execFileAsync('sqlite3', [CHAT_DB, sql], { timeout: 10_000 });
		}

		return json({ status: 200, data: { ok: true } });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to update chat.db';
		return json({ status: 500, error: message }, { status: 500 });
	}
};

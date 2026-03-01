import { json } from '@sveltejs/kit';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RequestHandler } from './$types.js';

const execFileAsync = promisify(execFile);
const CHAT_DB = join(homedir(), 'Library/Messages/chat.db');

/**
 * Returns preview overrides for chats where the last visible message is retracted.
 * imessage-rs filters out retracted messages entirely, so the API can never surface them.
 * This endpoint queries chat.db directly to detect them.
 *
 * Detection: macOS clears date_retracted after retraction completes, so we detect
 * retracted messages by their content signature (all content removed) in addition
 * to the date_retracted flag (for mid-retraction state).
 */
export const GET: RequestHandler = async () => {
	try {
		const sql = `
			SELECT
				c.guid as chat_guid,
				m.is_from_me
			FROM chat c
			JOIN chat_message_join cmj ON c.ROWID = cmj.chat_id
			JOIN message m ON cmj.message_id = m.ROWID
			WHERE m.ROWID = (
				SELECT m2.ROWID
				FROM chat_message_join cmj2
				JOIN message m2 ON cmj2.message_id = m2.ROWID
				WHERE cmj2.chat_id = c.ROWID
				AND m2.associated_message_type = 0
				ORDER BY m2.date DESC
				LIMIT 1
			)
			AND (
				m.date_retracted > 0
				OR (
					m.text IS NULL
					AND (m.attributedBody IS NULL OR LENGTH(m.attributedBody) = 0)
					AND m.cache_has_attachments = 0
					AND m.item_type = 0
					AND m.group_action_type = 0
				)
			)
		`;

		const { stdout } = await execFileAsync('sqlite3', ['-json', CHAT_DB, sql], {
			timeout: 5_000
		});

		const rows = JSON.parse(stdout || '[]') as Array<{
			chat_guid: string;
			is_from_me: number;
		}>;

		const result: Record<string, string> = {};

		for (const row of rows) {
			result[row.chat_guid] = row.is_from_me
				? 'You unsent a message'
				: 'This message was unsent';
		}

		return json({ data: result });
	} catch {
		return json({ data: {} });
	}
};

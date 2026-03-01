import { json } from '@sveltejs/kit';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RequestHandler } from './$types.js';

const execFileAsync = promisify(execFile);
const CHAT_DB = join(homedir(), 'Library', 'Messages', 'chat.db');

const UNREAD_QUERY = `
SELECT c.guid, COUNT(m.ROWID) as unread_count
FROM chat c
JOIN chat_message_join cmj ON c.ROWID = cmj.chat_id
JOIN message m ON cmj.message_id = m.ROWID
WHERE m.is_read = 0
  AND m.is_from_me = 0
  AND m.item_type = 0
  AND m.is_finished = 1
  AND m.is_system_message = 0
GROUP BY c.ROWID;`;

export const GET: RequestHandler = async () => {
	try {
		const { stdout } = await execFileAsync('sqlite3', ['-separator', '\t', CHAT_DB, UNREAD_QUERY], {
			timeout: 10_000
		});

		const counts: Record<string, number> = {};
		for (const line of stdout.split('\n')) {
			const [guid, count] = line.split('\t');
			if (guid && count) {
				counts[guid] = parseInt(count, 10);
			}
		}

		return json({ status: 200, data: counts });
	} catch {
		return json({ status: 200, data: {} });
	}
};

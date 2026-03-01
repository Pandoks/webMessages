import { json } from '@sveltejs/kit';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RequestHandler } from './$types.js';

const execFileAsync = promisify(execFile);
const CHAT_DB = join(homedir(), 'Library/Messages/chat.db');

// iMessage edit/unsend windows (same values IMCore uses internally)
const EDIT_TIMEOUT_S = 900; // 15 minutes
const UNSEND_TIMEOUT_S = 120; // 2 minutes

/**
 * Returns eligibility data for all sent messages still within the edit window.
 * Pure SQLite query — no IMCore needed. Uses the same fields eligibilityForEditType checks:
 * is_from_me, service (iMessage only — SMS can't edit/unsend), balloon_bundle_id, and time elapsed.
 */
export const GET: RequestHandler = async () => {
	try {
		const sql = `
			SELECT
				m.guid,
				(m.date / 1000000000 + 978307200) as sent_epoch,
				CAST(strftime('%s', 'now') AS INTEGER) as now_epoch,
				m.balloon_bundle_id,
				m.is_sent
			FROM message m
			WHERE m.is_from_me = 1
				AND m.service = 'iMessage'
				AND m.date_retracted = 0
				AND (m.date / 1000000000 + 978307200) > (CAST(strftime('%s', 'now') AS INTEGER) - ${EDIT_TIMEOUT_S})
			ORDER BY m.date DESC
		`;

		const { stdout } = await execFileAsync('sqlite3', ['-json', CHAT_DB, sql], {
			timeout: 5_000
		});

		const rows = JSON.parse(stdout || '[]') as Array<{
			guid: string;
			sent_epoch: number;
			now_epoch: number;
			balloon_bundle_id: string | null;
			is_sent: number;
		}>;

		const result: Record<
			string,
			{
				editExpiresAt: number | null;
				unsendExpiresAt: number | null;
			}
		> = {};

		for (const row of rows) {
			const isSent = row.is_sent !== 0;
			const isAppMessage = row.balloon_bundle_id != null && row.balloon_bundle_id !== '';

			if (!isSent || isAppMessage) continue;

			const sentMs = row.sent_epoch * 1000;

			result[row.guid] = {
				editExpiresAt: sentMs + EDIT_TIMEOUT_S * 1000,
				unsendExpiresAt: sentMs + UNSEND_TIMEOUT_S * 1000
			};
		}

		return json({ data: result });
	} catch {
		return json({ data: {} });
	}
};

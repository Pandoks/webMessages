import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db.js';
import { appleToUnixMs } from '$lib/server/date-utils.js';
import { getMessageText } from '$lib/server/attributed-body.js';
import { resolveContact } from '$lib/server/contacts.js';

interface SearchRow {
	message_rowid: number;
	message_guid: string;
	text: string | null;
	attributedBody: Buffer | null;
	is_from_me: number;
	date: number;
	chat_id: number;
	chat_guid: string;
	chat_display_name: string | null;
	chat_identifier: string;
	handle_identifier: string | null;
}

export const GET: RequestHandler = ({ url }) => {
	const query = url.searchParams.get('q');
	if (!query || query.length < 2) {
		return json({ results: [] });
	}

	const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);

	const db = getDb();
	const rows = db
		.prepare<[string, number], SearchRow>(
			`
		SELECT
			m.ROWID as message_rowid,
			m.guid as message_guid,
			m.text,
			m.attributedBody,
			m.is_from_me,
			m.date,
			cmj.chat_id,
			c.guid as chat_guid,
			c.display_name as chat_display_name,
			c.chat_identifier,
			h.id as handle_identifier
		FROM message m
		JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
		JOIN chat c ON cmj.chat_id = c.ROWID
		LEFT JOIN handle h ON m.handle_id = h.ROWID
		WHERE m.text LIKE '%' || ? || '%'
			AND m.associated_message_type = 0
		ORDER BY m.date DESC
		LIMIT ?
	`
		)
		.all(query, limit);

	const results = rows.map((row) => ({
		message_rowid: row.message_rowid,
		message_guid: row.message_guid,
		text: getMessageText(row.text, row.attributedBody),
		is_from_me: row.is_from_me === 1,
		date: appleToUnixMs(row.date),
		chat_id: row.chat_id,
		chat_display_name: row.chat_display_name || resolveContact(row.chat_identifier),
		sender: row.is_from_me ? 'Me' : resolveContact(row.handle_identifier ?? row.chat_identifier)
	}));

	return json({ results });
};

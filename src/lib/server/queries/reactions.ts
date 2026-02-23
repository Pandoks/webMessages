import { getDb } from '../db.js';
import type { Reaction } from '$lib/types/index.js';

interface ReactionRow {
	rowid: number;
	associated_message_guid: string;
	associated_message_type: number;
	associated_message_emoji: string | null;
	handle_id: number;
	is_from_me: number;
	handle_identifier: string | null;
}

let _reactionsByChatStmt: ReturnType<ReturnType<typeof getDb>['prepare']> | null = null;

function reactionsByChatStmt() {
	if (!_reactionsByChatStmt) {
		_reactionsByChatStmt = getDb().prepare(`
			SELECT
				m.ROWID as rowid,
				m.associated_message_guid,
				m.associated_message_type,
				m.associated_message_emoji,
				m.handle_id,
				m.is_from_me,
				h.id as handle_identifier
			FROM message m
			JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
			LEFT JOIN handle h ON m.handle_id = h.ROWID
			WHERE cmj.chat_id = ?
				AND m.associated_message_type >= 2000
				AND m.associated_message_type <= 3006
			ORDER BY m.ROWID ASC
		`);
	}
	return _reactionsByChatStmt;
}

export function getReactionsByChat(chatId: number): Reaction[] {
	const rows = reactionsByChatStmt().all(chatId) as ReactionRow[];
	return rows.map((row) => ({
		message_rowid: row.rowid,
		associated_message_guid: row.associated_message_guid,
		associated_message_type: row.associated_message_type,
		handle_id: row.handle_id,
		sender: row.handle_identifier ?? 'Me',
		emoji: row.associated_message_emoji,
		is_from_me: row.is_from_me === 1
	}));
}

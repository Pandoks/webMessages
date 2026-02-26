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

type DbStmt = ReturnType<ReturnType<typeof getDb>['prepare']>;

const reactionsByChatsStmtCache = new Map<number, DbStmt>();

function reactionsByChatsStmt(chatCount: number): DbStmt {
  const cached = reactionsByChatsStmtCache.get(chatCount);
  if (cached) return cached;

  const placeholders = Array.from({ length: chatCount }, () => '?').join(',');
  const stmt = getDb().prepare(`
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
		WHERE cmj.chat_id IN (${placeholders})
			AND m.associated_message_type >= 2000
			AND m.associated_message_type <= 3006
		ORDER BY m.ROWID ASC
	`);
  reactionsByChatsStmtCache.set(chatCount, stmt);
  return stmt;
}

function rowToReaction(row: ReactionRow): Reaction {
  return {
    message_rowid: row.rowid,
    associated_message_guid: row.associated_message_guid,
    associated_message_type: row.associated_message_type,
    handle_id: row.handle_id,
    sender: row.handle_identifier ?? 'Me',
    emoji: row.associated_message_emoji,
    is_from_me: row.is_from_me === 1
  };
}

export function getReactionsByChat(chatId: number): Reaction[] {
  return getReactionsByChats([chatId]);
}

export function getReactionsByChats(chatIds: number[]): Reaction[] {
  if (chatIds.length === 0) return [];

  const rows = reactionsByChatsStmt(chatIds.length).all(...chatIds) as ReactionRow[];
  return rows.map(rowToReaction);
}

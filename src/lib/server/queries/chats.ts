import { getDb } from '../db.js';
import { appleToUnixMs } from '../date-utils.js';
import { getMessageText } from '../attributed-body.js';
import type { Chat, Participant } from '$lib/types/index.js';
import { isPhoneNumber, normalizePhone } from '$lib/utils/phone.js';

interface ChatRow {
  rowid: number;
  guid: string;
  chat_identifier: string;
  display_name: string | null;
  service_name: string;
  style: number;
  is_archived: number;
  unread_count: number;
  last_message_rowid: number | null;
  last_message_guid: string | null;
  last_message_text: string | null;
  last_message_attributed_body: Buffer | null;
  last_message_date: number;
  last_message_is_from_me: number;
  last_message_service: string | null;
  last_message_associated_message_type: number;
  last_message_schedule_type: number;
  last_message_schedule_state: number;
}

interface HandleRow {
  handle_id: number;
  handle_identifier: string;
  service: string;
}

interface DirectChatRow {
  rowid: number;
  guid: string;
  handle_identifier: string;
}

interface ChatReadSnapshotRow {
  rowid: number;
  last_read_message_timestamp: number;
}

type DbStmt = ReturnType<ReturnType<typeof getDb>['prepare']>;

// Cache prepared statements (created once, reused)
let _chatListStmt: DbStmt | null = null;
let _chatParticipantsStmt: DbStmt | null = null;
let _chatByIdStmt: DbStmt | null = null;
let _directChatsByHandleStmt: DbStmt | null = null;
let _chatReadSnapshotsStmt: DbStmt | null = null;

const UNREAD_COUNT_SQL = `
	(
		SELECT COUNT(*)
		FROM chat_message_join cmj_unread
		JOIN message mu ON mu.ROWID = cmj_unread.message_id
		WHERE cmj_unread.chat_id = c.ROWID
			AND mu.is_from_me = 0
			AND mu.associated_message_type = 0
			AND NOT (mu.item_type != 0 AND mu.group_action_type = 0 AND mu.group_title IS NULL)
			AND mu.date > COALESCE(c.last_read_message_timestamp, 0)
	) as unread_count
`;

// Exclude pending "Send Later" rows from sidebar preview/last-message selection.
const LAST_MESSAGE_FILTER_SQL = `
	m3.associated_message_type = 0
	AND m3.item_type = 0
	AND COALESCE(m3.schedule_state, 0) != 2
`;

function chatListStmt() {
  if (!_chatListStmt) {
    _chatListStmt = getDb().prepare<[], ChatRow>(`
			SELECT
				c.ROWID as rowid,
				c.guid,
				c.chat_identifier,
				c.display_name,
				c.service_name,
				c.style,
				c.is_archived,
				${UNREAD_COUNT_SQL},
				m.ROWID as last_message_rowid,
				m.guid as last_message_guid,
				m.text as last_message_text,
				m.attributedBody as last_message_attributed_body,
				m.date as last_message_date,
				m.is_from_me as last_message_is_from_me,
				m.service as last_message_service,
				m.associated_message_type as last_message_associated_message_type,
				COALESCE(m.schedule_type, 0) as last_message_schedule_type,
				COALESCE(m.schedule_state, 0) as last_message_schedule_state
			FROM chat c
			INNER JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
			INNER JOIN message m ON m.ROWID = cmj.message_id
				WHERE m.ROWID = (
					SELECT cmj3.message_id
					FROM chat_message_join cmj3
					INNER JOIN message m3 ON m3.ROWID = cmj3.message_id
					WHERE cmj3.chat_id = c.ROWID
						AND ${LAST_MESSAGE_FILTER_SQL}
					ORDER BY m3.date DESC
					LIMIT 1
				)
			ORDER BY m.date DESC
		`);
  }
  return _chatListStmt;
}

function chatParticipantsStmt() {
  if (!_chatParticipantsStmt) {
    _chatParticipantsStmt = getDb().prepare<[number], HandleRow>(`
			SELECT
				h.ROWID as handle_id,
				h.id as handle_identifier,
				h.service
			FROM handle h
			JOIN chat_handle_join chj ON h.ROWID = chj.handle_id
			WHERE chj.chat_id = ?
		`);
  }
  return _chatParticipantsStmt;
}

function chatByIdStmt() {
  if (!_chatByIdStmt) {
    _chatByIdStmt = getDb().prepare<[number], ChatRow>(`
			SELECT
				c.ROWID as rowid,
				c.guid,
				c.chat_identifier,
				c.display_name,
				c.service_name,
				c.style,
				c.is_archived,
				${UNREAD_COUNT_SQL},
				m.ROWID as last_message_rowid,
				m.guid as last_message_guid,
				m.text as last_message_text,
				m.attributedBody as last_message_attributed_body,
				m.date as last_message_date,
				m.is_from_me as last_message_is_from_me,
				m.service as last_message_service,
				m.associated_message_type as last_message_associated_message_type,
				COALESCE(m.schedule_type, 0) as last_message_schedule_type,
				COALESCE(m.schedule_state, 0) as last_message_schedule_state
			FROM chat c
			LEFT JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
			LEFT JOIN message m ON m.ROWID = cmj.message_id
				WHERE c.ROWID = ?
					AND m.ROWID = (
						SELECT cmj3.message_id
						FROM chat_message_join cmj3
						JOIN message m3 ON m3.ROWID = cmj3.message_id
						WHERE cmj3.chat_id = c.ROWID
							AND ${LAST_MESSAGE_FILTER_SQL}
						ORDER BY m3.date DESC
						LIMIT 1
					)
		`);
  }
  return _chatByIdStmt;
}

function directChatsByHandleStmt() {
  if (!_directChatsByHandleStmt) {
    _directChatsByHandleStmt = getDb().prepare<[string, string], DirectChatRow>(`
			SELECT
				c.ROWID as rowid,
				c.guid as guid,
				h.id as handle_identifier
			FROM chat c
			JOIN chat_handle_join chj ON chj.chat_id = c.ROWID
			JOIN handle h ON h.ROWID = chj.handle_id
			WHERE c.style = 45
				AND (
					LOWER(h.id) = LOWER(?)
					OR h.id LIKE '%' || ? || '%'
				)
			ORDER BY c.ROWID DESC
		`);
  }
  return _directChatsByHandleStmt;
}

function chatReadSnapshotsStmt() {
  if (!_chatReadSnapshotsStmt) {
    _chatReadSnapshotsStmt = getDb().prepare<[], ChatReadSnapshotRow>(`
			SELECT
				c.ROWID as rowid,
				COALESCE(c.last_read_message_timestamp, 0) as last_read_message_timestamp
			FROM chat c
		`);
  }
  return _chatReadSnapshotsStmt;
}

function directChatsByHandle(identifier: string): DirectChatRow[] {
  return directChatsByHandleStmt().all(identifier, identifier) as DirectChatRow[];
}

function sameHandleIdentifier(a: string, b: string): boolean {
  const left = a.trim();
  const right = b.trim();
  if (!left || !right) return false;
  if (left.toLowerCase() === right.toLowerCase()) return true;
  if (isPhoneNumber(left) && isPhoneNumber(right)) {
    return normalizePhone(left) === normalizePhone(right);
  }
  return false;
}

export function getChatList(): Chat[] {
  const rows = chatListStmt().all() as ChatRow[];
  return rows.map(rowToChat);
}

export function getChatParticipants(chatId: number): Participant[] {
  const rows = chatParticipantsStmt().all(chatId) as HandleRow[];
  return rows.map((r) => ({
    handle_id: r.handle_id,
    handle_identifier: r.handle_identifier,
    display_name: r.handle_identifier,
    service: r.service
  }));
}

export function getChatById(chatId: number): Chat | null {
  const row = chatByIdStmt().get(chatId) as ChatRow | undefined;
  if (!row) return null;
  return rowToChat(row);
}

export function getChatReadSnapshots(): Array<{ chatId: number; lastReadTimestamp: number }> {
  const rows = chatReadSnapshotsStmt().all() as ChatReadSnapshotRow[];
  return rows.map((row) => ({
    chatId: row.rowid,
    lastReadTimestamp: row.last_read_message_timestamp
  }));
}

export function findDirectChatByHandleIdentifier(
  identifier: string
): { rowid: number; guid: string } | null {
  const needle = identifier.trim();
  if (!needle) return null;

  const rows = directChatsByHandle(needle);
  if (rows.length === 0) return null;

  const lowerNeedle = needle.toLowerCase();
  const normalizedNeedle = isPhoneNumber(needle) ? normalizePhone(needle) : null;

  // Prefer exact identifier match before fuzzy matching.
  const exact = rows.find((row) => row.handle_identifier.toLowerCase() === lowerNeedle);
  if (exact) return { rowid: exact.rowid, guid: exact.guid };

  if (normalizedNeedle) {
    const normalized = rows.find(
      (row) =>
        isPhoneNumber(row.handle_identifier) &&
        normalizePhone(row.handle_identifier) === normalizedNeedle
    );
    if (normalized) return { rowid: normalized.rowid, guid: normalized.guid };
  }

  return { rowid: rows[0].rowid, guid: rows[0].guid };
}

export function findLatestDirectChatByHandleIdentifiers(
  identifiers: string[]
): { rowid: number; guid: string } | null {
  let latest: { rowid: number; guid: string } | null = null;

  for (const identifier of identifiers) {
    const match = findDirectChatByHandleIdentifier(identifier);
    if (!match) continue;
    if (!latest || match.rowid > latest.rowid) {
      latest = match;
    }
  }

  return latest;
}

export function findDirectChatsByHandleIdentifiers(
  identifiers: string[]
): Array<{ rowid: number; guid: string; handle_identifier: string }> {
  const out: Array<{ rowid: number; guid: string; handle_identifier: string }> = [];
  const seen = new Set<number>();

  for (const identifier of identifiers) {
    const needle = identifier.trim();
    if (!needle) continue;

    const candidates: string[] = [needle];
    if (isPhoneNumber(needle)) {
      const normalized = normalizePhone(needle);
      if (!candidates.some((v) => v.toLowerCase() === normalized.toLowerCase())) {
        candidates.push(normalized);
      }
    }

    for (const candidate of candidates) {
      const rows = directChatsByHandle(candidate);
      for (const row of rows) {
        if (!sameHandleIdentifier(row.handle_identifier, candidate)) continue;
        if (seen.has(row.rowid)) continue;
        seen.add(row.rowid);
        out.push({ rowid: row.rowid, guid: row.guid, handle_identifier: row.handle_identifier });
      }
    }
  }

  out.sort((a, b) => b.rowid - a.rowid);
  return out;
}

function rowToChat(row: ChatRow): Chat {
  const lastMessageText =
    row.last_message_rowid !== null
      ? getMessageText(row.last_message_text, row.last_message_attributed_body)
      : undefined;

  return {
    rowid: row.rowid,
    guid: row.guid,
    chat_identifier: row.chat_identifier,
    display_name: row.display_name || null,
    service_name: row.service_name,
    style: row.style,
    is_archived: row.is_archived === 1,
    unread_count: Math.max(0, row.unread_count || 0),
    last_message:
      row.last_message_rowid !== null
        ? {
            rowid: row.last_message_rowid,
            guid: row.last_message_guid!,
            text: row.last_message_text,
            handle_id: 0,
            service: row.last_message_service ?? '',
            is_from_me: row.last_message_is_from_me === 1,
            date: appleToUnixMs(row.last_message_date),
            date_read: null,
            date_delivered: null,
            date_retracted: null,
            date_edited: null,
            schedule_type: row.last_message_schedule_type,
            schedule_state: row.last_message_schedule_state,
            is_delivered: false,
            is_sent: false,
            is_read: false,
            cache_has_attachments: false,
            associated_message_type: row.last_message_associated_message_type,
            associated_message_guid: null,
            associated_message_emoji: null,
            thread_originator_guid: null,
            thread_originator_part: null,
            group_title: null,
            group_action_type: 0,
            item_type: 0,
            other_handle: 0,
            chat_id: row.rowid,
            body: lastMessageText
          }
        : undefined
  };
}

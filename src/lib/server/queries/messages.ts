import { getDb } from '../db.js';
import { appleToUnixMs } from '../date-utils.js';
import { getMessageText } from '../attributed-body.js';
import type { Message } from '$lib/types/index.js';

interface MessageRow {
	rowid: number;
	guid: string;
	text: string | null;
	attributedBody: Buffer | null;
	handle_id: number;
	service: string;
	is_from_me: number;
	date: number;
	date_read: number;
	date_delivered: number;
	date_retracted: number;
	date_edited: number;
	is_delivered: number;
	is_sent: number;
	is_read: number;
	cache_has_attachments: number;
	associated_message_type: number;
	associated_message_guid: string | null;
	associated_message_emoji: string | null;
	thread_originator_guid: string | null;
	thread_originator_part: string | null;
	group_title: string | null;
	group_action_type: number;
	item_type: number;
	other_handle: number;
	handle_identifier: string | null;
	chat_id?: number;
	chat_guid?: string;
}

const MESSAGE_COLUMNS = `
	m.ROWID as rowid,
	m.guid,
	m.text,
	m.attributedBody,
	m.handle_id,
	m.service,
	m.is_from_me,
	m.date,
	m.date_read,
	m.date_delivered,
	COALESCE(m.date_retracted, 0) as date_retracted,
	COALESCE(m.date_edited, 0) as date_edited,
	m.is_delivered,
	m.is_sent,
	m.is_read,
	m.cache_has_attachments,
	m.associated_message_type,
	m.associated_message_guid,
	m.associated_message_emoji,
	m.thread_originator_guid,
	m.thread_originator_part,
	m.group_title,
	m.group_action_type,
	m.item_type,
	m.other_handle,
	h.id as handle_identifier
`;

// Cached prepared statements
let _messagesByChatStmt: ReturnType<ReturnType<typeof getDb>['prepare']> | null = null;
let _messageByGuidStmt: ReturnType<ReturnType<typeof getDb>['prepare']> | null = null;
let _newMessagesStmt: ReturnType<ReturnType<typeof getDb>['prepare']> | null = null;
let _maxRowIdStmt: ReturnType<ReturnType<typeof getDb>['prepare']> | null = null;

function messagesByChatStmt() {
	if (!_messagesByChatStmt) {
		_messagesByChatStmt = getDb().prepare(`
			SELECT ${MESSAGE_COLUMNS},
				cmj.chat_id as chat_id,
				c.guid as chat_guid
			FROM message m
			JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
			JOIN chat c ON c.ROWID = cmj.chat_id
			LEFT JOIN handle h ON m.handle_id = h.ROWID
			WHERE cmj.chat_id = ?
				AND m.associated_message_type = 0
				AND NOT (m.item_type != 0 AND m.group_action_type = 0 AND m.group_title IS NULL)
			ORDER BY m.date DESC
			LIMIT ? OFFSET ?
		`);
	}
	return _messagesByChatStmt;
}

function messageByGuidStmt() {
	if (!_messageByGuidStmt) {
		_messageByGuidStmt = getDb().prepare(`
			SELECT ${MESSAGE_COLUMNS}
			FROM message m
			LEFT JOIN handle h ON m.handle_id = h.ROWID
			WHERE m.guid = ?
		`);
	}
	return _messageByGuidStmt;
}

function newMessagesStmt() {
	if (!_newMessagesStmt) {
		_newMessagesStmt = getDb().prepare(`
			SELECT ${MESSAGE_COLUMNS},
				cmj.chat_id,
				c.guid as chat_guid
			FROM message m
			JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
			JOIN chat c ON c.ROWID = cmj.chat_id
			LEFT JOIN handle h ON m.handle_id = h.ROWID
			WHERE m.ROWID > ?
			ORDER BY m.ROWID ASC
		`);
	}
	return _newMessagesStmt;
}

function maxRowIdStmt() {
	if (!_maxRowIdStmt) {
		_maxRowIdStmt = getDb().prepare('SELECT MAX(ROWID) as max_id FROM message');
	}
	return _maxRowIdStmt;
}

export function getMessagesByChat(
	chatId: number,
	limit = 50,
	offset = 0
): Message[] {
	return getMessagesByChats([chatId], limit, offset);
}

export function getMessagesByChats(chatIds: number[], limit = 50, offset = 0): Message[] {
	if (chatIds.length === 0) return [];
	if (chatIds.length === 1) {
		const rows = messagesByChatStmt().all(chatIds[0], limit, offset) as MessageRow[];
		return rows
			.map((row) => rowToMessage(row, row.chat_id ?? chatIds[0], row.chat_guid ?? undefined))
			.reverse();
	}

	const placeholders = chatIds.map(() => '?').join(',');
	const stmt = getDb().prepare(`
		SELECT ${MESSAGE_COLUMNS},
			cmj.chat_id as chat_id,
			c.guid as chat_guid
		FROM message m
		JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
		JOIN chat c ON c.ROWID = cmj.chat_id
		LEFT JOIN handle h ON m.handle_id = h.ROWID
		WHERE cmj.chat_id IN (${placeholders})
			AND m.associated_message_type = 0
			AND NOT (m.item_type != 0 AND m.group_action_type = 0 AND m.group_title IS NULL)
		ORDER BY m.date DESC
		LIMIT ? OFFSET ?
	`);
	const rows = stmt.all(...chatIds, limit, offset) as MessageRow[];
	return rows
		.map((row) => rowToMessage(row, row.chat_id ?? chatIds[0], row.chat_guid ?? undefined))
		.reverse();
}

export function getMessageByGuid(guid: string): Message | null {
	const row = messageByGuidStmt().get(guid) as MessageRow | undefined;
	if (!row) return null;
	return rowToMessage(row, 0);
}

export function getNewMessages(sinceRowId: number): { chatId: number; message: Message }[] {
	const rows = newMessagesStmt().all(sinceRowId) as (MessageRow & { chat_id: number })[];

	return rows.map((row) => ({
		chatId: row.chat_id,
		message: rowToMessage(row, row.chat_id, row.chat_guid ?? undefined)
	}));
}

export function getMaxMessageRowId(): number {
	const row = maxRowIdStmt().get() as { max_id: number } | undefined;
	return row?.max_id ?? 0;
}

function rowToMessage(row: MessageRow, chatId: number, chatGuid?: string): Message {
	const body = getMessageText(row.text, row.attributedBody);
	const syntheticRetracted =
		row.date_retracted === 0 &&
		row.date_edited > 0 &&
		row.associated_message_type === 0 &&
		row.is_from_me === 1 &&
		row.service === 'iMessage' &&
		body.trim().length === 0;
	const effectiveDateRetracted = row.date_retracted || (syntheticRetracted ? row.date_edited : 0);
	const effectiveDateEdited = syntheticRetracted ? 0 : row.date_edited;

	return {
		rowid: row.rowid,
		guid: row.guid,
		text: row.text,
		handle_id: row.handle_id,
		service: row.service,
		is_from_me: row.is_from_me === 1,
		date: appleToUnixMs(row.date),
		date_read: row.date_read ? appleToUnixMs(row.date_read) : null,
		date_delivered: row.date_delivered ? appleToUnixMs(row.date_delivered) : null,
		date_retracted: effectiveDateRetracted ? appleToUnixMs(effectiveDateRetracted) : null,
		date_edited: effectiveDateEdited ? appleToUnixMs(effectiveDateEdited) : null,
		is_delivered: row.is_delivered === 1,
		is_sent: row.is_sent === 1,
		is_read: row.is_read === 1,
		cache_has_attachments: row.cache_has_attachments === 1,
		associated_message_type: row.associated_message_type,
		associated_message_guid: row.associated_message_guid,
		associated_message_emoji: row.associated_message_emoji,
		thread_originator_guid: row.thread_originator_guid,
		thread_originator_part: row.thread_originator_part,
		group_title: row.group_title,
		group_action_type: row.group_action_type,
		item_type: row.item_type,
		other_handle: row.other_handle,
		chat_id: chatId,
		chat_guid: chatGuid,
		sender: row.handle_identifier ?? undefined,
		body
	};
}

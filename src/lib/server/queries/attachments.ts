import { getDb } from '../db.js';
import type { Attachment } from '$lib/types/index.js';

interface AttachmentRow {
	rowid: number;
	guid: string;
	filename: string | null;
	mime_type: string | null;
	uti: string | null;
	transfer_name: string | null;
	total_bytes: number;
	is_outgoing: number;
	is_sticker: number;
	hide_attachment: number;
}

let _attachmentsByMessageStmt: ReturnType<ReturnType<typeof getDb>['prepare']> | null = null;
let _attachmentByIdStmt: ReturnType<ReturnType<typeof getDb>['prepare']> | null = null;

function attachmentsByMessageStmt() {
	if (!_attachmentsByMessageStmt) {
		_attachmentsByMessageStmt = getDb().prepare(`
			SELECT
				a.ROWID as rowid,
				a.guid,
				a.filename,
				a.mime_type,
				a.uti,
				a.transfer_name,
				a.total_bytes,
				a.is_outgoing,
				a.is_sticker,
				a.hide_attachment
			FROM attachment a
			JOIN message_attachment_join maj ON a.ROWID = maj.attachment_id
			WHERE maj.message_id = ?
			ORDER BY a.ROWID ASC
		`);
	}
	return _attachmentsByMessageStmt;
}

function attachmentByIdStmt() {
	if (!_attachmentByIdStmt) {
		_attachmentByIdStmt = getDb().prepare(`
			SELECT
				ROWID as rowid,
				guid,
				filename,
				mime_type,
				uti,
				transfer_name,
				total_bytes,
				is_outgoing,
				is_sticker,
				hide_attachment
			FROM attachment
			WHERE ROWID = ?
		`);
	}
	return _attachmentByIdStmt;
}

export function getAttachmentsByMessage(messageRowId: number): Attachment[] {
	const rows = attachmentsByMessageStmt().all(messageRowId) as AttachmentRow[];
	return rows.map(rowToAttachment);
}

export function getAttachmentById(id: number): Attachment | null {
	const row = attachmentByIdStmt().get(id) as AttachmentRow | undefined;
	if (!row) return null;
	return rowToAttachment(row);
}

function rowToAttachment(row: AttachmentRow): Attachment {
	return {
		rowid: row.rowid,
		guid: row.guid,
		filename: row.filename,
		mime_type: row.mime_type,
		uti: row.uti,
		transfer_name: row.transfer_name,
		total_bytes: row.total_bytes,
		is_outgoing: row.is_outgoing === 1,
		is_sticker: row.is_sticker === 1,
		hide_attachment: row.hide_attachment === 1
	};
}

export interface Message {
	rowid: number;
	guid: string;
	text: string | null;
	handle_id: number;
	service: string;
	is_from_me: boolean;
	date: number; // unix ms
	date_read: number | null;
	date_delivered: number | null;
	date_retracted: number | null;
	date_edited: number | null;
	is_delivered: boolean;
	is_sent: boolean;
	is_read: boolean;
	cache_has_attachments: boolean;
	associated_message_type: number;
	associated_message_guid: string | null;
	associated_message_emoji: string | null;
	thread_originator_guid: string | null;
	thread_originator_part: string | null;
	group_title: string | null;
	group_action_type: number;
	item_type: number;
	other_handle: number;
	chat_id: number;
	chat_guid?: string;
	sender?: string; // resolved handle id
	attachments?: Attachment[];
	reactions?: Reaction[];
	body?: string; // parsed text (from text or attributedBody)
}

export interface Chat {
	rowid: number;
	guid: string;
	chat_identifier: string;
	display_name: string | null;
	service_name: string;
	style: number; // 43=group, 45=1:1
	is_archived: boolean;
	is_pinned?: boolean;
	pin_rank?: number | null;
	last_message?: Message;
	participants?: Participant[];
	unread_count?: number;
}

export interface Participant {
	handle_id: number;
	handle_identifier: string;
	display_name: string;
	service: string;
}

export interface Handle {
	rowid: number;
	id: string;
	service: string;
	country: string | null;
}

export interface Attachment {
	rowid: number;
	guid: string;
	filename: string | null;
	mime_type: string | null;
	uti: string | null;
	transfer_name: string | null;
	total_bytes: number;
	is_outgoing: boolean;
	is_sticker: boolean;
	hide_attachment: boolean;
}

export interface Reaction {
	message_rowid: number;
	associated_message_guid: string;
	associated_message_type: number;
	handle_id: number;
	sender: string;
	emoji: string | null;
	is_from_me: boolean;
}

export interface Contact {
	name: string;
	phones: string[];
	emails: string[];
}

export interface SSEEvent {
	type: 'new_messages' | 'updated_messages' | 'typing' | 'connected';
	data: unknown;
}

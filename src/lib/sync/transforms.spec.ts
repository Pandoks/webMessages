import { describe, it, expect } from 'vitest';
import { chatToDb, messageToDb, handleToDb, attachmentToDb } from './transforms.js';
import type { Chat, Message, Handle, Attachment } from '$lib/types/index.js';

describe('transforms', () => {
	it('transforms Chat to DbChat', () => {
		const chat = {
			guid: 'iMessage;-;+1234567890',
			chatIdentifier: '+1234567890',
			displayName: null,
			style: 45,
			isArchived: false,
			participants: [{ address: '+1234567890', service: 'iMessage', country: 'us', originalROWID: 1, uncanonicalizedId: null }],
			lastMessage: { dateCreated: 1700000000000, text: 'Hello' } as Message
		} as Chat;

		const db = chatToDb(chat);
		expect(db.guid).toBe('iMessage;-;+1234567890');
		expect(db.lastMessageDate).toBe(1700000000000);
		expect(db.lastMessageText).toBe('Hello');
		expect(db.participants).toEqual(['+1234567890']);
		expect(db.isPinned).toBe(false);
		expect(db.unreadCount).toBe(0);
	});

	it('transforms Message to DbMessage', () => {
		const msg = {
			guid: 'msg-1',
			text: 'Hello',
			handleId: 1,
			handle: { address: '+1234567890', service: 'iMessage', country: 'us', originalROWID: 1, uncanonicalizedId: null },
			isFromMe: false,
			dateCreated: 1700000000000,
			dateRead: null,
			dateDelivered: 1700000000500,
			attachments: [],
			chats: [{ guid: 'iMessage;-;+1234567890' } as Chat],
			associatedMessageGuid: null,
			associatedMessageType: 0,
			threadOriginatorGuid: null,
			error: 0,
			isDelivered: true,
			dateEdited: null,
			dateRetracted: null,
			expressiveSendStyleId: null,
			subject: null,
			associatedMessageEmoji: null,
			groupTitle: null,
			groupActionType: 0,
			isSystemMessage: false,
			itemType: 0
		} as Message;

		const db = messageToDb(msg);
		expect(db.guid).toBe('msg-1');
		expect(db.chatGuid).toBe('iMessage;-;+1234567890');
		expect(db.handleAddress).toBe('+1234567890');
		expect(db.attachmentGuids).toEqual([]);
	});

	it('handles null handle in message', () => {
		const msg = {
			guid: 'msg-2',
			handle: null,
			chats: [{ guid: 'chat-1' } as Chat],
			attachments: [{ guid: 'att-1' } as Attachment],
			text: null, handleId: 0, isFromMe: true, dateCreated: 0, dateRead: null,
			dateDelivered: null, dateEdited: null, dateRetracted: null, subject: null,
			associatedMessageGuid: null, associatedMessageType: 0, associatedMessageEmoji: null,
			threadOriginatorGuid: null, error: 0, expressiveSendStyleId: null, isDelivered: true,
			groupTitle: null, groupActionType: 0, isSystemMessage: false, itemType: 0
		} as Message;

		const db = messageToDb(msg);
		expect(db.handleAddress).toBeNull();
		expect(db.attachmentGuids).toEqual(['att-1']);
	});

	it('transforms Handle to DbHandle', () => {
		const handle: Handle = { originalROWID: 1, address: '+1234567890', service: 'iMessage', country: 'us', uncanonicalizedId: null };
		const db = handleToDb(handle);
		expect(db.address).toBe('+1234567890');
		expect(db.displayName).toBeNull();
		expect(db.avatarBase64).toBeNull();
	});

	it('transforms Attachment to DbAttachment', () => {
		const att = {
			guid: 'att-1', originalROWID: 1, mimeType: 'image/jpeg', transferName: 'photo.jpg',
			totalBytes: 12345, width: 1080, height: 1920, hasLivePhoto: false, isSticker: false,
			uti: null, transferState: 5, isOutgoing: false, hideAttachment: false, originalGuid: null, metadata: null
		} as Attachment;
		const db = attachmentToDb(att, 'msg-1');
		expect(db.guid).toBe('att-1');
		expect(db.messageGuid).toBe('msg-1');
		expect(db.mimeType).toBe('image/jpeg');
		expect(db.blurhash).toBeNull();
	});
});

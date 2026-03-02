import { describe, it, expect } from 'vitest';
import { chatToDb, messageToDb, handleToDb, attachmentToDb } from './transforms.js';
import type { Chat, Message, Handle, Attachment } from '$lib/types/index.js';

function testMessage(overrides: Partial<Message> = {}): Message {
	return {
		originalROWID: 0,
		guid: '',
		text: null,
		attributedBody: [],
		handle: null,
		handleId: 0,
		otherHandle: 0,
		attachments: [],
		subject: null,
		error: 0,
		dateCreated: 0,
		dateRead: null,
		dateDelivered: null,
		isDelivered: false,
		isFromMe: false,
		hasDdResults: false,
		isArchived: false,
		itemType: 0,
		groupTitle: null,
		groupActionType: 0,
		balloonBundleId: null,
		associatedMessageGuid: null,
		associatedMessageType: 0,
		associatedMessageEmoji: null,
		expressiveSendStyleId: null,
		threadOriginatorGuid: null,
		threadOriginatorPart: null,
		hasPayloadData: false,
		isDelayed: false,
		isAutoReply: false,
		isSystemMessage: false,
		isServiceMessage: false,
		isForward: false,
		isCorrupt: false,
		datePlayed: null,
		isSpam: false,
		isExpired: false,
		isAudioMessage: false,
		replyToGuid: null,
		shareStatus: 0,
		shareDirection: 0,
		wasDeliveredQuietly: false,
		didNotifyRecipient: false,
		chats: [],
		dateEdited: null,
		dateRetracted: null,
		partCount: null,
		...overrides
	};
}

describe('transforms', () => {
	it('transforms Chat to DbChat', () => {
		const chat = {
			guid: 'iMessage;-;+1234567890',
			chatIdentifier: '+1234567890',
			displayName: null,
			style: 45,
			isArchived: false,
			participants: [
				{
					address: '+1234567890',
					service: 'iMessage',
					country: 'us',
					originalROWID: 1,
					uncanonicalizedId: null
				}
			],
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

	it('transforms Chat with no lastMessage', () => {
		const chat = {
			guid: 'iMessage;-;+9876543210',
			chatIdentifier: '+9876543210',
			displayName: 'Test Group',
			style: 43,
			isArchived: false,
			participants: [
				{
					address: '+9876543210',
					service: 'iMessage',
					country: 'us',
					originalROWID: 2,
					uncanonicalizedId: null
				}
			]
		} as Chat;

		const db = chatToDb(chat);
		expect(db.lastMessageDate).toBe(0);
		expect(db.lastMessageText).toBeNull();
	});

	it('transforms Chat with no participants', () => {
		const chat = {
			guid: 'iMessage;-;+5555555555',
			chatIdentifier: '+5555555555',
			displayName: null,
			style: 45,
			isArchived: false,
			participants: undefined as unknown as Handle[],
			lastMessage: null
		} as Chat;

		const db = chatToDb(chat);
		expect(db.participants).toEqual([]);
	});

	it('transforms Message to DbMessage', () => {
		const msg = testMessage({
			guid: 'msg-1',
			text: 'Hello',
			handleId: 1,
			handle: {
				address: '+1234567890',
				service: 'iMessage',
				country: 'us',
				originalROWID: 1,
				uncanonicalizedId: null
			},
			isFromMe: false,
			dateCreated: 1700000000000,
			dateDelivered: 1700000000500,
			chats: [{ guid: 'iMessage;-;+1234567890' } as Chat],
			isDelivered: true
		});

		const db = messageToDb(msg);
		expect(db.guid).toBe('msg-1');
		expect(db.chatGuid).toBe('iMessage;-;+1234567890');
		expect(db.handleAddress).toBe('+1234567890');
		expect(db.attachmentGuids).toEqual([]);
	});

	it('handles null handle in message', () => {
		const msg = testMessage({
			guid: 'msg-2',
			chats: [{ guid: 'chat-1' } as Chat],
			attachments: [{ guid: 'att-1' } as Attachment],
			isFromMe: true,
			isDelivered: true
		});

		const db = messageToDb(msg);
		expect(db.handleAddress).toBeNull();
		expect(db.attachmentGuids).toEqual(['att-1']);
	});

	it('uses chatGuidOverride when provided', () => {
		const msg = testMessage({
			guid: 'msg-override',
			text: 'Override test',
			chats: [{ guid: 'iMessage;-;+1234567890' } as Chat],
			isFromMe: true,
			isDelivered: true
		});

		const db = messageToDb(msg, 'iMessage;-;+9999999999');
		expect(db.chatGuid).toBe('iMessage;-;+9999999999');
	});

	it('uses chatGuidOverride when chats is empty', () => {
		const msg = testMessage({
			guid: 'msg-override-empty',
			text: 'No chats',
			chats: undefined as unknown as Chat[],
			isFromMe: true,
			isDelivered: true
		});

		const db = messageToDb(msg, 'iMessage;-;+5555555555');
		expect(db.chatGuid).toBe('iMessage;-;+5555555555');
	});

	it('handles message with no chats', () => {
		const msg = testMessage({
			guid: 'msg-no-chats',
			text: 'Orphaned',
			chats: undefined as unknown as Chat[],
			dateCreated: 100
		});

		const db = messageToDb(msg);
		expect(db.chatGuid).toBe('');
	});

	it('handles message with no attachments', () => {
		const msg = testMessage({
			guid: 'msg-no-att',
			text: 'No attachments',
			chats: [{ guid: 'chat-1' } as Chat],
			attachments: undefined as unknown as Attachment[],
			isFromMe: true,
			dateCreated: 200,
			isDelivered: true
		});

		const db = messageToDb(msg);
		expect(db.attachmentGuids).toEqual([]);
	});

	it('transforms reaction message', () => {
		const msg = testMessage({
			guid: 'msg-reaction',
			handle: {
				address: '+1111111111',
				service: 'iMessage',
				country: 'us',
				originalROWID: 3,
				uncanonicalizedId: null
			},
			chats: [{ guid: 'iMessage;-;+1234567890' } as Chat],
			text: '\ufffc Loved "Hello"',
			handleId: 3,
			dateCreated: 1700000001000,
			associatedMessageGuid: 'p:0/msg-1',
			associatedMessageType: 2000,
			isDelivered: true
		});

		const db = messageToDb(msg);
		expect(db.associatedMessageGuid).toBe('p:0/msg-1');
		expect(db.associatedMessageType).toBe(2000);
		expect(db.handleAddress).toBe('+1111111111');
	});

	it('transforms Handle to DbHandle', () => {
		const handle: Handle = {
			originalROWID: 1,
			address: '+1234567890',
			service: 'iMessage',
			country: 'us',
			uncanonicalizedId: null
		};
		const db = handleToDb(handle);
		expect(db.address).toBe('+1234567890');
		expect(db.displayName).toBeNull();
		expect(db.avatarBase64).toBeNull();
	});

	it('transforms Attachment to DbAttachment', () => {
		const att = {
			guid: 'att-1',
			originalROWID: 1,
			mimeType: 'image/jpeg',
			transferName: 'photo.jpg',
			totalBytes: 12345,
			width: 1080,
			height: 1920,
			hasLivePhoto: false,
			isSticker: false,
			uti: null,
			transferState: 5,
			isOutgoing: false,
			hideAttachment: false,
			originalGuid: null,
			metadata: null
		} as Attachment;
		const db = attachmentToDb(att, 'msg-1');
		expect(db.guid).toBe('att-1');
		expect(db.messageGuid).toBe('msg-1');
		expect(db.mimeType).toBe('image/jpeg');
		expect(db.blurhash).toBeNull();
	});

	it('transforms Attachment with hasLivePhoto true', () => {
		const att = {
			guid: 'att-live',
			originalROWID: 2,
			mimeType: 'image/heic',
			transferName: 'live.heic',
			totalBytes: 54321,
			width: 3024,
			height: 4032,
			hasLivePhoto: true,
			isSticker: false,
			uti: 'public.heic',
			transferState: 5,
			isOutgoing: false,
			hideAttachment: false,
			originalGuid: null,
			metadata: null
		} as Attachment;
		const db = attachmentToDb(att, 'msg-live');
		expect(db.hasLivePhoto).toBe(true);
		expect(db.messageGuid).toBe('msg-live');
		expect(db.width).toBe(3024);
		expect(db.height).toBe(4032);
		expect(db.isSticker).toBe(false);
	});
});

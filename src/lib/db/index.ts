import Dexie, { type EntityTable } from 'dexie';
import type { DbChat, DbMessage, DbHandle, DbAttachment, DbSyncMeta } from './types.js';

export class WebMessagesDB extends Dexie {
	chats!: EntityTable<DbChat, 'guid'>;
	messages!: EntityTable<DbMessage, 'guid'>;
	handles!: EntityTable<DbHandle, 'address'>;
	attachments!: EntityTable<DbAttachment, 'guid'>;
	syncMeta!: EntityTable<DbSyncMeta, 'key'>;

	constructor() {
		super('webMessages');

		this.version(1).stores({
			chats: 'guid, chatIdentifier, lastMessageDate, isPinned',
			messages: 'guid, chatGuid, dateCreated, associatedMessageGuid, threadOriginatorGuid',
			handles: 'address',
			attachments: 'guid, messageGuid',
			syncMeta: 'key'
		});

		// v2: Fix messages stored with empty chatGuid — clear syncMeta to force full re-sync
		this.version(2)
			.stores({
				chats: 'guid, chatIdentifier, lastMessageDate, isPinned',
				messages: 'guid, chatGuid, dateCreated, associatedMessageGuid, threadOriginatorGuid',
				handles: 'address',
				attachments: 'guid, messageGuid',
				syncMeta: 'key'
			})
			.upgrade((tx) => tx.table('syncMeta').clear());

		// v3: Fix null associatedMessageType and handles with stale displayName
		this.version(3)
			.stores({
				chats: 'guid, chatIdentifier, lastMessageDate, isPinned',
				messages: 'guid, chatGuid, dateCreated, associatedMessageGuid, threadOriginatorGuid',
				handles: 'address',
				attachments: 'guid, messageGuid',
				syncMeta: 'key'
			})
			.upgrade(async (tx) => {
				await tx.table('messages').clear();
				await tx.table('handles').clear();
				await tx.table('syncMeta').clear();
			});

		// v4: Re-resolve contacts now that Private API is enabled
		this.version(4)
			.stores({
				chats: 'guid, chatIdentifier, lastMessageDate, isPinned',
				messages: 'guid, chatGuid, dateCreated, associatedMessageGuid, threadOriginatorGuid',
				handles: 'address',
				attachments: 'guid, messageGuid',
				syncMeta: 'key'
			})
			.upgrade(async (tx) => {
				await tx.table('handles').clear();
				await tx.table('syncMeta').clear();
			});

		// v5: Re-resolve contacts using macOS Contacts.app bulk API
		this.version(5)
			.stores({
				chats: 'guid, chatIdentifier, lastMessageDate, isPinned',
				messages: 'guid, chatGuid, dateCreated, associatedMessageGuid, threadOriginatorGuid',
				handles: 'address',
				attachments: 'guid, messageGuid',
				syncMeta: 'key'
			})
			.upgrade(async (tx) => {
				await tx.table('handles').clear();
				await tx.table('syncMeta').clear();
			});

		// v6: Re-sync to store avatar data from iCloud contacts
		this.version(6)
			.stores({
				chats: 'guid, chatIdentifier, lastMessageDate, isPinned',
				messages: 'guid, chatGuid, dateCreated, associatedMessageGuid, threadOriginatorGuid',
				handles: 'address',
				attachments: 'guid, messageGuid',
				syncMeta: 'key'
			})
			.upgrade(async (tx) => {
				await tx.table('handles').clear();
				await tx.table('syncMeta').clear();
			});

		// v7: Re-resolve contacts with early resolution + Contacts.app priority
		this.version(7)
			.stores({
				chats: 'guid, chatIdentifier, lastMessageDate, isPinned',
				messages: 'guid, chatGuid, dateCreated, associatedMessageGuid, threadOriginatorGuid',
				handles: 'address',
				attachments: 'guid, messageGuid',
				syncMeta: 'key'
			})
			.upgrade(async (tx) => {
				await tx.table('handles').clear();
				await tx.table('syncMeta').clear();
			});

		// v8: Fix messages corrupted by webhook events (chatGuid overwritten to '')
		this.version(8)
			.stores({
				chats: 'guid, chatIdentifier, lastMessageDate, isPinned',
				messages: 'guid, chatGuid, dateCreated, associatedMessageGuid, threadOriginatorGuid',
				handles: 'address',
				attachments: 'guid, messageGuid',
				syncMeta: 'key'
			})
			.upgrade(async (tx) => {
				await tx.table('messages').clear();
				await tx.table('syncMeta').clear();
			});
	}
}

export const db = new WebMessagesDB();

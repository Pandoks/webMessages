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
	}
}

export const db = new WebMessagesDB();

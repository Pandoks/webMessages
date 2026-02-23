import Dexie, { type EntityTable } from 'dexie';
import type { Message, Chat } from '$lib/types/index.js';

interface SyncState {
	key: string;
	value: string;
}

const db = new Dexie('webMessages') as Dexie & {
	messages: EntityTable<Message, 'rowid'>;
	chats: EntityTable<Chat, 'rowid'>;
	syncState: EntityTable<SyncState, 'key'>;
};

db.version(1).stores({
	messages: 'rowid, guid, chat_id, date',
	chats: 'rowid, guid',
	syncState: 'key'
});

export { db };

/** Store messages in IndexedDB */
export async function cacheMessages(messages: Message[]): Promise<void> {
	if (messages.length === 0) return;
	await db.messages.bulkPut(messages);
}

/** Store chats in IndexedDB */
export async function cacheChats(chats: Chat[]): Promise<void> {
	if (chats.length === 0) return;
	await db.chats.bulkPut(chats);
}

/** Get cached messages for a chat */
export async function getCachedMessages(chatId: number, limit = 50): Promise<Message[]> {
	return db.messages
		.where('chat_id')
		.equals(chatId)
		.reverse()
		.sortBy('date')
		.then((msgs) => msgs.slice(0, limit).reverse());
}

/** Get cached chat list */
export async function getCachedChats(): Promise<Chat[]> {
	return db.chats.toArray();
}

/** Update sync state */
export async function setSyncState(key: string, value: string): Promise<void> {
	await db.syncState.put({ key, value });
}

/** Get sync state */
export async function getSyncState(key: string): Promise<string | undefined> {
	const record = await db.syncState.get(key);
	return record?.value;
}

import Dexie, { type EntityTable } from 'dexie';
import type { Message, Chat, Participant } from '$lib/types/index.js';

interface SyncState {
	key: string;
	value: string;
}

interface ParticipantRow extends Participant {
	chat_id: number;
	id?: number;
}

const db = new Dexie('webMessages') as Dexie & {
	messages: EntityTable<Message, 'rowid'>;
	chats: EntityTable<Chat, 'rowid'>;
	syncState: EntityTable<SyncState, 'key'>;
	participants: EntityTable<ParticipantRow, 'id'>;
};

db.version(1).stores({
	messages: 'rowid, guid, chat_id, date',
	chats: 'rowid, guid',
	syncState: 'key'
});

db.version(2)
	.stores({
		messages: 'rowid, guid, chat_id, date',
		chats: 'rowid, guid',
		syncState: 'key',
		participants: '++id, [chat_id+handle_id], chat_id'
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
	const msgs = await db.messages.where('chat_id').equals(chatId).sortBy('date');
	return msgs.slice(-limit);
}

/** Get cached messages for a chat older than a given date */
export async function getCachedMessagesBefore(
	chatId: number,
	beforeDate: number,
	limit: number
): Promise<Message[]> {
	const msgs = await db.messages.where('chat_id').equals(chatId).sortBy('date');
	const older = msgs.filter((m) => m.date < beforeDate);
	return older.slice(-limit);
}

/** Get cached chat list */
export async function getCachedChats(): Promise<Chat[]> {
	return db.chats.toArray();
}

/** Store participants for a chat in IndexedDB */
export async function cacheParticipantsInDb(
	chatId: number,
	participants: Participant[]
): Promise<void> {
	if (participants.length === 0) return;
	// Clear existing participants for this chat, then add new ones
	await db.participants.where('chat_id').equals(chatId).delete();
	await db.participants.bulkAdd(
		participants.map((p) => ({ ...p, chat_id: chatId }))
	);
}

/** Get cached participants for a chat from IndexedDB */
export async function getCachedParticipantsFromDb(chatId: number): Promise<Participant[]> {
	const rows = await db.participants.where('chat_id').equals(chatId).toArray();
	return rows.map(({ chat_id: _, id: _id, ...rest }) => rest as Participant);
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

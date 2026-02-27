import { db } from '$lib/db/index.js';
import { chatToDb, messageToDb, handleToDb, attachmentToDb } from '$lib/sync/transforms.js';
import type { Chat, Message } from '$lib/types/index.js';
import type { ApiResponse } from '$lib/types/index.js';
import { SSEClient } from '$lib/sync/sse.js';

const MESSAGES_PER_CHAT = 50;

export class SyncEngine {
	syncing = $state(false);
	connected = $state(false);
	typingIndicators: Map<string, Set<string>> = $state(new Map());

	private sse = new SSEClient();

	async start() {
		this.sse.onEvent((type, data) => this.handleEvent(type, data));
		this.sse.connect('/api/events');
		this.connected = true;

		const meta = await db.syncMeta.get('lastSyncTimestamp');
		if (meta) {
			await this.incrementalSync(meta.value);
		} else {
			await this.initialSync();
		}
	}

	stop() {
		this.sse.disconnect();
		this.connected = false;
	}

	async initialSync() {
		this.syncing = true;
		try {
			// Fetch all chats
			const chatRes = await proxyPost<Chat[]>('/api/proxy/chat/query', {
				with: ['participants', 'lastMessage'],
				sort: 'lastmessage',
				limit: 1000
			});

			if (!chatRes.data?.length) {
				await this.saveSyncTimestamp();
				return;
			}

			// Store chats and handles
			await db.transaction('rw', [db.chats, db.handles], async () => {
				for (const chat of chatRes.data) {
					const dbChat = chatToDb(chat);
					// Preserve client-side isPinned if chat already exists
					const existing = await db.chats.get(dbChat.guid);
					if (existing) {
						dbChat.isPinned = existing.isPinned;
					}
					await db.chats.put(dbChat);

					// Store participant handles
					if (chat.participants) {
						for (const handle of chat.participants) {
							await db.handles.put(handleToDb(handle));
						}
					}
				}
			});

			// Fetch recent messages per chat
			for (const chat of chatRes.data) {
				await this.syncChatMessages(chat.guid, MESSAGES_PER_CHAT);
			}

			await this.saveSyncTimestamp();
		} finally {
			this.syncing = false;
		}
	}

	async incrementalSync(since: string) {
		this.syncing = true;
		try {
			// Fetch messages updated since last sync
			const msgRes = await proxyPost<Message[]>('/api/proxy/message/query', {
				with: ['chats', 'attachment', 'handle'],
				sort: 'DESC',
				after: since,
				limit: 1000
			});

			if (msgRes.data?.length) {
				await db.transaction(
					'rw',
					[db.messages, db.attachments, db.handles],
					async () => {
						for (const msg of msgRes.data) {
							await db.messages.put(messageToDb(msg));

							if (msg.handle) {
								await db.handles.put(handleToDb(msg.handle));
							}
							if (msg.attachments) {
								for (const att of msg.attachments) {
									await db.attachments.put(attachmentToDb(att, msg.guid));
								}
							}
						}
					}
				);
			}

			// Re-fetch chat list to pick up any new/updated chats
			const chatRes = await proxyPost<Chat[]>('/api/proxy/chat/query', {
				with: ['participants', 'lastMessage'],
				sort: 'lastmessage',
				limit: 1000
			});

			if (chatRes.data?.length) {
				await db.transaction('rw', [db.chats, db.handles], async () => {
					for (const chat of chatRes.data) {
						const dbChat = chatToDb(chat);
						// Preserve client-side isPinned
						const existing = await db.chats.get(dbChat.guid);
						if (existing) {
							dbChat.isPinned = existing.isPinned;
						}
						await db.chats.put(dbChat);

						if (chat.participants) {
							for (const handle of chat.participants) {
								await db.handles.put(handleToDb(handle));
							}
						}
					}
				});
			}

			await this.saveSyncTimestamp();
		} finally {
			this.syncing = false;
		}
	}

	async handleEvent(type: string, data: unknown) {
		switch (type) {
			case 'new-message': {
				const msg = data as Message;
				await db.transaction(
					'rw',
					[db.messages, db.chats, db.attachments, db.handles],
					async () => {
						await db.messages.put(messageToDb(msg));

						if (msg.handle) {
							await db.handles.put(handleToDb(msg.handle));
						}
						if (msg.attachments) {
							for (const att of msg.attachments) {
								await db.attachments.put(attachmentToDb(att, msg.guid));
							}
						}

						// Update chat's last message and unread count
						const chatGuid = msg.chats?.[0]?.guid;
						if (chatGuid) {
							const chat = await db.chats.get(chatGuid);
							if (chat) {
								const updates: Partial<typeof chat> = {
									lastMessageDate: msg.dateCreated,
									lastMessageText: msg.text
								};
								if (!msg.isFromMe) {
									updates.unreadCount = (chat.unreadCount ?? 0) + 1;
								}
								await db.chats.update(chatGuid, updates);
							}
						}
					}
				);
				break;
			}

			case 'updated-message': {
				const msg = data as Message;
				await db.transaction('rw', [db.messages, db.attachments], async () => {
					await db.messages.put(messageToDb(msg));

					if (msg.attachments) {
						for (const att of msg.attachments) {
							await db.attachments.put(attachmentToDb(att, msg.guid));
						}
					}
				});
				break;
			}

			case 'typing-indicator': {
				const indicator = data as { chatGuid: string; address: string; isTyping: boolean };
				const current = this.typingIndicators.get(indicator.chatGuid) ?? new Set<string>();
				if (indicator.isTyping) {
					current.add(indicator.address);
				} else {
					current.delete(indicator.address);
				}
				// Reassign to trigger reactivity
				this.typingIndicators = new Map(this.typingIndicators.set(indicator.chatGuid, current));
				break;
			}

			case 'chat-read-status-changed': {
				const event = data as { chatGuid: string };
				await db.chats.update(event.chatGuid, { unreadCount: 0 });
				break;
			}

			case 'group-name-change': {
				const event = data as { chatGuid: string; newName: string };
				await db.chats.update(event.chatGuid, { displayName: event.newName });
				break;
			}

			case 'participant-added':
			case 'participant-removed':
			case 'participant-left': {
				// Re-fetch the chat to get updated participant list
				const event = data as { chatGuid: string };
				const chatRes = await proxyGet<Chat>(
					`/api/proxy/chat/${encodeURIComponent(event.chatGuid)}?with=participants,lastMessage`
				);
				if (chatRes.data) {
					const dbChat = chatToDb(chatRes.data);
					const existing = await db.chats.get(dbChat.guid);
					if (existing) {
						dbChat.isPinned = existing.isPinned;
						dbChat.unreadCount = existing.unreadCount;
					}
					await db.transaction('rw', [db.chats, db.handles], async () => {
						await db.chats.put(dbChat);
						if (chatRes.data.participants) {
							for (const handle of chatRes.data.participants) {
								await db.handles.put(handleToDb(handle));
							}
						}
					});
				}
				break;
			}
		}
	}

	async loadOlderMessages(chatGuid: string, beforeDate: number): Promise<number> {
		const res = await proxyGet<Message[]>(
			`/api/proxy/chat/${encodeURIComponent(chatGuid)}/message?limit=${MESSAGES_PER_CHAT}&sort=DESC&before=${beforeDate}&with=attachment,handle`
		);

		if (!res.data?.length) return 0;

		await db.transaction('rw', [db.messages, db.attachments, db.handles], async () => {
			for (const msg of res.data) {
				await db.messages.put(messageToDb(msg));

				if (msg.handle) {
					await db.handles.put(handleToDb(msg.handle));
				}
				if (msg.attachments) {
					for (const att of msg.attachments) {
						await db.attachments.put(attachmentToDb(att, msg.guid));
					}
				}
			}
		});

		return res.data.length;
	}

	private async syncChatMessages(chatGuid: string, limit: number) {
		const res = await proxyGet<Message[]>(
			`/api/proxy/chat/${encodeURIComponent(chatGuid)}/message?limit=${limit}&sort=DESC&with=attachment,handle`
		);

		if (!res.data?.length) return;

		await db.transaction('rw', [db.messages, db.attachments, db.handles], async () => {
			for (const msg of res.data) {
				await db.messages.put(messageToDb(msg));

				if (msg.handle) {
					await db.handles.put(handleToDb(msg.handle));
				}
				if (msg.attachments) {
					for (const att of msg.attachments) {
						await db.attachments.put(attachmentToDb(att, msg.guid));
					}
				}
			}
		});
	}

	private async saveSyncTimestamp() {
		await db.syncMeta.put({
			key: 'lastSyncTimestamp',
			value: new Date().toISOString()
		});
	}
}

// Proxy helpers that call through the SvelteKit proxy
async function proxyGet<T>(path: string): Promise<ApiResponse<T>> {
	const res = await fetch(path);
	return res.json() as Promise<ApiResponse<T>>;
}

async function proxyPost<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
	const res = await fetch(path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: body !== undefined ? JSON.stringify(body) : undefined
	});
	return res.json() as Promise<ApiResponse<T>>;
}

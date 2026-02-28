import { db } from '$lib/db/index.js';
import { chatToDb, messageToDb, handleToDb, attachmentToDb } from '$lib/sync/transforms.js';
import type { Chat, Message, Handle } from '$lib/types/index.js';
import type { ApiResponse } from '$lib/types/index.js';
import { SSEClient } from '$lib/sync/sse.js';

const MESSAGES_PER_CHAT = 50;

export class SyncEngine {
	syncing = $state(false);
	connected = $state(false);
	typingIndicators: Map<string, Set<string>> = $state(new Map());

	private sse = new SSEClient();
	private syncedChatGuids = new Set<string>();
	private chatMessageSyncPromises = new Map<string, Promise<void>>();

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
			// Step 1: Fetch and store chats immediately — UI shows chat list
			const chatRes = await proxyPost<Chat[]>('/api/proxy/chat/query', {
				with: ['participants', 'lastMessage'],
				sort: 'lastmessage',
				limit: 1000
			});

			if (!chatRes.data?.length) {
				await this.saveSyncTimestamp();
				return;
			}

			await db.transaction('rw', [db.chats, db.handles], async () => {
				for (const chat of chatRes.data) {
					const dbChat = chatToDb(chat);
					const existing = await db.chats.get(dbChat.guid);
					if (existing) {
						dbChat.isPinned = existing.isPinned;
					}
					await db.chats.put(dbChat);

					if (chat.participants) {
						for (const handle of chat.participants) {
							await this.upsertHandle(handle);
						}
					}
				}
			});

			// Save timestamp early so next load uses incremental sync
			await this.saveSyncTimestamp();
		} finally {
			// Chat list is now visible — stop showing "Syncing..."
			this.syncing = false;
		}

		// Step 2: Background tasks — don't block UI
		// These run concurrently and progressively update the UI
		this.resolveContacts().catch(() => {});
		this.syncPinnedChats().catch(() => {});
		this.syncAllChatMessagesInBackground().catch(() => {});
	}

	async incrementalSync(since: string) {
		this.syncing = true;
		try {
			// Fetch messages updated since last sync
			const msgRes = await proxyPost<Message[]>('/api/proxy/message/query', {
				with: ['chats', 'attachment', 'handle'],
				sort: 'DESC',
				after: Number(since),
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
								await this.upsertHandle(msg.handle);
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
						const existing = await db.chats.get(dbChat.guid);
						if (existing) {
							dbChat.isPinned = existing.isPinned;
						}
						await db.chats.put(dbChat);

						if (chat.participants) {
							for (const handle of chat.participants) {
								await this.upsertHandle(handle);
							}
						}
					}
				});
			}

			await this.saveSyncTimestamp();
		} finally {
			this.syncing = false;
		}

		// Background: resolve any new contacts and pinned chats
		this.resolveContacts().catch(() => {});
		this.syncPinnedChats().catch(() => {});
	}

	/**
	 * Ensure messages are loaded for a specific chat.
	 * Called by ChatView when a conversation is opened.
	 * Returns immediately if already synced; otherwise fetches on demand.
	 */
	async ensureChatMessages(chatGuid: string): Promise<void> {
		// Already synced this session
		if (this.syncedChatGuids.has(chatGuid)) return;

		// Already in-flight — wait for it
		const existing = this.chatMessageSyncPromises.get(chatGuid);
		if (existing) return existing;

		// Check if messages already exist in IndexedDB (from a previous session)
		const count = await db.messages
			.where('chatGuid')
			.equals(chatGuid)
			.count();

		if (count > 0) {
			this.syncedChatGuids.add(chatGuid);
			return;
		}

		// Fetch messages on demand
		const promise = this.syncChatMessages(chatGuid, MESSAGES_PER_CHAT)
			.then(() => {
				this.syncedChatGuids.add(chatGuid);
			})
			.finally(() => {
				this.chatMessageSyncPromises.delete(chatGuid);
			});

		this.chatMessageSyncPromises.set(chatGuid, promise);
		return promise;
	}

	async handleEvent(type: string, data: unknown) {
		switch (type) {
			case 'new-message': {
				const msg = data as Message;
				await db.transaction(
					'rw',
					[db.messages, db.chats, db.attachments, db.handles],
					async () => {
						// Webhook payloads have chats: [] — resolve chatGuid
						let chatGuid = msg.chats?.[0]?.guid ?? '';
						if (!chatGuid) {
							const existing = await db.messages.get(msg.guid);
							if (existing?.chatGuid) {
								chatGuid = existing.chatGuid;
							}
						}
						if (!chatGuid && msg.handle?.address) {
							chatGuid = await this.resolveChatGuid(msg.handle.address);
						}

						await db.messages.put(messageToDb(msg, chatGuid || undefined));

						if (msg.handle) {
							await this.upsertHandle(msg.handle);
						}
						if (msg.attachments) {
							for (const att of msg.attachments) {
								await db.attachments.put(attachmentToDb(att, msg.guid));
							}
						}

						// Update chat's last message and unread count
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
				await db.transaction('rw', [db.messages, db.attachments, db.chats], async () => {
					// Webhook payloads have chats: [] — resolve chatGuid
					const existing = await db.messages.get(msg.guid);
					let chatGuid = msg.chats?.[0]?.guid || existing?.chatGuid || '';
					if (!chatGuid && msg.handle?.address) {
						chatGuid = await this.resolveChatGuid(msg.handle.address);
					}
					await db.messages.put(messageToDb(msg, chatGuid || undefined));

					if (msg.attachments) {
						for (const att of msg.attachments) {
							await db.attachments.put(attachmentToDb(att, msg.guid));
						}
					}

					// Update chat preview if this was the latest message (e.g. unsend)
					if (chatGuid) {
						const chat = await db.chats.get(chatGuid);
						if (chat && msg.dateCreated >= chat.lastMessageDate) {
							await db.chats.update(chatGuid, {
								lastMessageText: msg.text
							});
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
								await this.upsertHandle(handle);
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
				await db.messages.put(messageToDb(msg, chatGuid));

				if (msg.handle) {
					await this.upsertHandle(msg.handle);
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
				await db.messages.put(messageToDb(msg, chatGuid));

				if (msg.handle) {
					await this.upsertHandle(msg.handle);
				}
				if (msg.attachments) {
					for (const att of msg.attachments) {
						await db.attachments.put(attachmentToDb(att, msg.guid));
					}
				}
			}
		});
	}

	/** Sync messages for all chats in background, yielding between each */
	private async syncAllChatMessagesInBackground() {
		const chats = await db.chats.orderBy('lastMessageDate').reverse().toArray();
		for (const chat of chats) {
			// Skip if already synced on-demand by ChatView
			if (this.syncedChatGuids.has(chat.guid)) continue;

			try {
				await this.syncChatMessages(chat.guid, MESSAGES_PER_CHAT);
				this.syncedChatGuids.add(chat.guid);
			} catch {
				// Continue with next chat on failure
			}

			// Yield to avoid blocking the main thread
			await new Promise((r) => setTimeout(r, 0));
		}
	}

	private async resolveContacts() {
		const handles = await db.handles.filter((h) => !h.displayName).toArray();
		if (!handles.length) return;

		// Step 1: Bulk-load contacts from macOS Contacts.app
		try {
			const res = await fetch('/api/contacts');
			if (res.ok) {
				const { data } = (await res.json()) as { data: Record<string, string> };
				if (data && typeof data === 'object') {
					await db.transaction('rw', db.handles, async () => {
						for (const h of handles) {
							const normalized = h.address.replace(/[\s\-()]/g, '').toLowerCase();
							const name = data[normalized];
							if (name) {
								await db.handles.update(h.address, { displayName: name });
							}
						}
					});
				}
			}
		} catch {
			// Contacts.app not available — continue to fallback
		}

		// Step 2: For any remaining unresolved handles, try imessage-rs API
		const remaining = await db.handles.filter((h) => h.displayName === null).toArray();
		if (!remaining.length) return;

		// Probe first handle to check if the iCloud contact API is available
		try {
			const probeRes = await fetch(
				`/api/proxy/icloud/contact?address=${encodeURIComponent(remaining[0].address)}`
			);
			if (!probeRes.ok) {
				await db.transaction('rw', db.handles, async () => {
					for (const h of remaining) {
						await db.handles.update(h.address, { displayName: '' });
					}
				});
				return;
			}
		} catch {
			await db.transaction('rw', db.handles, async () => {
				for (const h of remaining) {
					await db.handles.update(h.address, { displayName: '' });
				}
			});
			return;
		}

		const BATCH_SIZE = 25;
		for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
			const batch = remaining.slice(i, i + BATCH_SIZE);
			const results = await Promise.allSettled(
				batch.map(async (h) => {
					const res = await fetch(
						`/api/proxy/icloud/contact?address=${encodeURIComponent(h.address)}`
					);
					if (!res.ok) return null;
					return res.json();
				})
			);

			for (let j = 0; j < results.length; j++) {
				const result = results[j];
				if (result.status === 'fulfilled' && result.value?.data) {
					const data = result.value.data as {
						name?: string | null;
						avatar?: string | null;
					};
					const updates: Record<string, string> = {
						displayName: data.name || ''
					};
					if (data.avatar) {
						updates.avatarBase64 = data.avatar;
					}
					await db.handles.update(batch[j].address, updates);
				} else {
					await db.handles.update(batch[j].address, { displayName: '' });
				}
			}
		}
	}

	private async syncPinnedChats() {
		try {
			const res = await fetch('/api/plist/pinned');
			if (!res.ok) return;
			const { data } = (await res.json()) as { data: string[] };
			if (!Array.isArray(data)) return;

			const pinnedSet = new Set(data);
			const chats = await db.chats.toArray();

			await db.transaction('rw', db.chats, async () => {
				for (const chat of chats) {
					const shouldBePinned = pinnedSet.has(chat.chatIdentifier);

					if (chat.isPinned !== shouldBePinned) {
						await db.chats.update(chat.guid, { isPinned: shouldBePinned });
					}
				}
			});
		} catch {
			// Silently fail — plist may not be accessible
		}
	}

	/** Resolve chatGuid from a handle address by looking up 1:1 chats in IndexedDB */
	private async resolveChatGuid(address: string): Promise<string> {
		const chats = await db.chats
			.filter((c) => c.style === 45 && c.participants.length === 1 && c.participants[0] === address)
			.toArray();
		return chats[0]?.guid ?? '';
	}

	/** Upsert a handle, preserving existing displayName and avatarBase64 */
	private async upsertHandle(handle: Handle) {
		const existing = await db.handles.get(handle.address);
		if (existing) {
			// Only update API-provided fields, keep resolved contact info
			await db.handles.update(handle.address, {
				service: handle.service,
				country: handle.country
			});
		} else {
			await db.handles.put(handleToDb(handle));
		}
	}

	private async saveSyncTimestamp() {
		await db.syncMeta.put({
			key: 'lastSyncTimestamp',
			value: String(Date.now())
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

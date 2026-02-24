import {
	getChatStore,
	setServerChats,
	loadCachedChats,
	updateChatLastMessage,
	incrementChatUnread,
	clearChatUnread,
	setChatMessages,
	appendMessage,
	prependMessages,
	removeMessage,
	removeMatchingOptimisticMessage,
	updateMessageReactions,
	updateMessageBody,
	markMessageRetracted,
	setParticipants
} from './chats.svelte.js';
import {
	connect,
	disconnect,
	onNewMessages,
	onContactsReady,
	getConnectionState
} from './connection.svelte.js';
import {
	cacheMessages,
	getCachedMessages,
	getCachedMessagesBefore,
	cacheParticipantsInDb,
	getCachedParticipantsFromDb
} from '$lib/db/client-db.js';
import { isReactionType, isReactionRemoval, parseAssociatedGuid } from '$lib/utils/reactions.js';
import type { Message } from '$lib/types/index.js';

let activeChatId: number | null = null;
let unsubscribeMessages: (() => void) | null = null;
let unsubscribeContacts: (() => void) | null = null;

/** Initialize the sync engine. Call once from layout onMount. */
export function initSync() {
	// 1. Load chats from IndexedDB instantly
	loadCachedChats();

	// 2. Fetch fresh chats from API in background
	refreshChatList();

	// 3. Connect SSE
	connect();

	// 4. Register SSE handlers
	unsubscribeMessages = onNewMessages(handleNewMessages);
	unsubscribeContacts = onContactsReady(() => {
		refreshChatList();
		if (activeChatId !== null) {
			loadChat(activeChatId);
		}
	});

	return () => {
		if (unsubscribeMessages) {
			unsubscribeMessages();
			unsubscribeMessages = null;
		}
		if (unsubscribeContacts) {
			unsubscribeContacts();
			unsubscribeContacts = null;
		}
		disconnect();
	};
}

/** Load a chat's messages and participants. Called when chatId changes. */
export async function loadChat(chatId: number) {
	activeChatId = chatId;
	clearChatUnread(chatId);
	const chatStore = getChatStore();

	// If messages are already loaded, skip to background refresh
	const cached = chatStore.getMessages(chatId);
	if (cached.length === 0) {
		// Try IndexedDB
		const dbMessages = await getCachedMessages(chatId, 100);
		if (dbMessages.length > 0 && activeChatId === chatId) {
			setChatMessages(chatId, dbMessages);
		}

		// Try IndexedDB for participants
		const dbParticipants = await getCachedParticipantsFromDb(chatId);
		if (dbParticipants.length > 0 && activeChatId === chatId) {
			setParticipants(chatId, dbParticipants);
		}
	}

	// Background fetch from API
	try {
		const res = await fetch(`/api/messages/${chatId}?limit=100`);
		if (!res.ok) return;
		const data = await res.json();

		// Only apply if this chat is still active
		if (activeChatId !== chatId) return;

		if (data.messages) {
			setChatMessages(chatId, data.messages);
			cacheMessages(data.messages);
		}

		if (data.participants) {
			setParticipants(chatId, data.participants);
			cacheParticipantsInDb(chatId, data.participants);
		}
	} catch (err) {
		console.error('Failed to load chat:', err);
	}
}

/** Clear active chat (navigated to home). */
export function clearActiveChat() {
	activeChatId = null;
}

/** Load older messages for pagination. */
export async function loadOlderMessages(
	chatId: number,
	oldestDate: number,
	currentCount: number
): Promise<{ hasMore: boolean }> {
	const PAGE_SIZE = 100;

	// Try IndexedDB first
	const cached = await getCachedMessagesBefore(chatId, oldestDate, PAGE_SIZE);
	if (cached.length > 0) {
		prependMessages(chatId, cached);
		if (cached.length >= PAGE_SIZE) {
			return { hasMore: true };
		}
	}

	// Fetch from server
	try {
		const offset = currentCount + (cached.length > 0 ? cached.length : 0);
		const res = await fetch(`/api/messages/${chatId}?limit=${PAGE_SIZE}&offset=${offset}`);
		if (!res.ok) return { hasMore: false };
		const data = await res.json();
		const older: Message[] = data.messages ?? [];

		if (older.length > 0) {
			prependMessages(chatId, older);
			cacheMessages(older);
		}

		return { hasMore: older.length >= PAGE_SIZE };
	} catch (err) {
		console.error('Failed to load older messages:', err);
		return { hasMore: false };
	}
}

/** Handle incoming SSE messages */
function handleNewMessages(events: { chatId: number; message: Message }[]) {
	for (const event of events) {
		const { chatId, message } = event;

		if (isReactionType(message.associated_message_type)) {
			// Reaction message — update target message's reactions
			if (message.associated_message_guid) {
				const parsed = parseAssociatedGuid(message.associated_message_guid);
				if (parsed) {
					updateMessageReactions(
						chatId,
						parsed.guid,
						{
							message_rowid: message.rowid,
							associated_message_guid: message.associated_message_guid,
							associated_message_type: message.associated_message_type,
							handle_id: message.handle_id,
							sender: message.sender ?? '',
							emoji: message.associated_message_emoji,
							is_from_me: message.is_from_me
						},
						isReactionRemoval(message.associated_message_type)
					);
				}
			}
		} else if (message.associated_message_type === 1000) {
			// Edit event — update target message body in place
			if (message.associated_message_guid) {
				const parsed = parseAssociatedGuid(message.associated_message_guid);
				const editedText = message.body ?? message.text ?? '';
				if (parsed && editedText.trim().length > 0) {
					updateMessageBody(chatId, parsed.guid, editedText, Date.now());
				}
			}
		} else {
			// Regular message — append to store and cache
			removeMatchingOptimisticMessage(chatId, message);
			appendMessage(chatId, message);
			cacheMessages([message]);
			updateChatLastMessage(chatId, message);
			if (!message.is_from_me && activeChatId !== chatId) {
				incrementChatUnread(chatId);
			}
		}
	}

	// Check if any events are for unknown chats
	const chatStore = getChatStore();
	const knownChatIds = new Set(chatStore.chats.map((c) => c.rowid));
	const hasUnknown = events.some((e) => !knownChatIds.has(e.chatId));
	if (hasUnknown) {
		refreshChatList();
		if (activeChatId !== null) {
			loadChat(activeChatId);
		}
	}
}

/** Fetch fresh chat list from API */
export async function refreshChatList() {
	try {
		const res = await fetch('/api/chats');
		if (!res.ok) return;
		const data = await res.json();
		if (data.chats) {
			setServerChats(data.chats);
		}
	} catch (err) {
		console.error('Failed to refresh chat list:', err);
	}
}

/** Add an optimistic message to the store */
export function addOptimisticMessage(chatId: number, message: Message) {
	appendMessage(chatId, message);
}

/** Remove an optimistic message on send failure */
export function removeOptimisticMessage(chatId: number, guid: string) {
	removeMessage(chatId, guid);
}

/** Apply local in-thread message edit immediately. */
export function applyLocalMessageEdit(chatId: number, messageGuid: string, text: string) {
	updateMessageBody(chatId, messageGuid, text, Date.now());
}

/** Apply local unsend/retract immediately. */
export function applyLocalMessageUnsend(chatId: number, messageGuid: string) {
	markMessageRetracted(chatId, messageGuid, Date.now());
}

/** Handle SSE reconnection — refresh data to catch missed messages */
export function setupReconnectionHandler() {
	const connection = getConnectionState();
	let wasDisconnected = false;

	return () => {
		if (!connection.connected) {
			wasDisconnected = true;
		} else if (wasDisconnected) {
			wasDisconnected = false;
			// Reconnected — refresh to catch missed messages
			refreshChatList();
			if (activeChatId !== null) {
				loadChat(activeChatId);
			}
		}
	};
}

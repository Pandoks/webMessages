import type { Chat, Message, Participant, Reaction } from '$lib/types/index.js';
import { getCachedChats, cacheChats } from '$lib/db/client-db.js';
import { addVariantOf, reactionEmoji } from '$lib/utils/reactions.js';

let chats: Chat[] = $state([]);
let source: 'cache' | 'server' | 'none' = $state('none');
let messageMemoryCache: Map<number, Message[]> = $state(new Map());
let participantCache: Map<number, Participant[]> = $state(new Map());

function setMessages(chatId: number, messages: Message[]) {
	const next = new Map(messageMemoryCache);
	next.set(chatId, messages);
	messageMemoryCache = next;
}

function setParticipantsForChat(chatId: number, participants: Participant[]) {
	const next = new Map(participantCache);
	next.set(chatId, participants);
	participantCache = next;
}

function updateChatById(chatId: number, updater: (chat: Chat) => Chat | null) {
	const index = chats.findIndex((chat) => chat.rowid === chatId);
	if (index === -1) return;

	const nextChat = updater(chats[index]);
	if (!nextChat) return;

	const nextChats = [...chats];
	nextChats[index] = nextChat;
	chats = nextChats;
}

function updateMessageByGuid(
	chatId: number,
	messageGuid: string,
	updater: (message: Message) => Message | null
): Message | null {
	const existing = messageMemoryCache.get(chatId);
	if (!existing) return null;

	const index = existing.findIndex((message) => message.guid === messageGuid);
	if (index === -1) return null;

	const updated = updater(existing[index]);
	if (!updated) return null;

	const nextMessages = [...existing];
	nextMessages[index] = updated;
	setMessages(chatId, nextMessages);
	return updated;
}

export function getChatStore() {
	return {
		get chats() {
			return chats;
		},
		get source() {
			return source;
		},
		getMessages(chatId: number): Message[] {
			return messageMemoryCache.get(chatId) ?? [];
		},
		getParticipants(chatId: number): Participant[] {
			return participantCache.get(chatId) ?? [];
		}
	};
}

export async function loadCachedChats() {
	const cached = await getCachedChats();
	if (cached.length > 0 && source !== 'server') {
		chats = cached.sort((a, b) => (b.last_message?.date ?? 0) - (a.last_message?.date ?? 0));
		source = 'cache';
	}
}

export function setServerChats(serverChats: Chat[]) {
	// Preserve cached display names when server returns unresolved names
	if (chats.length > 0) {
		const cachedNames = new Map<number, string>();
		for (const c of chats) {
			if (c.display_name) cachedNames.set(c.rowid, c.display_name);
		}
		for (const sc of serverChats) {
			const cached = cachedNames.get(sc.rowid);
			if (cached && (!sc.display_name || looksUnresolved(sc.display_name))) {
				sc.display_name = cached;
			}
		}
	}

	chats = serverChats;
	source = 'server';
	cacheChats(serverChats);
}

/** Check if a display name looks like a raw phone number or email (not a real contact name) */
function looksUnresolved(name: string): boolean {
	// Phone-like: starts with + or digit, mostly digits/spaces/dashes/parens
	if (/^[+\d][\d\s()\-+.]+$/.test(name)) return true;
	// Email
	if (name.includes('@') && name.includes('.')) return true;
	return false;
}

export function updateChatLastMessage(chatId: number, message: Message) {
	const idx = chats.findIndex((c) => c.rowid === chatId);
	if (idx === -1) return;

	const updated = { ...chats[idx], last_message: message };
	const without = chats.filter((_, i) => i !== idx);
	chats = [updated, ...without];
}

export function incrementChatUnread(chatId: number, delta = 1) {
	if (delta <= 0) return;
	updateChatById(chatId, (chat) => ({
		...chat,
		unread_count: (chat.unread_count ?? 0) + delta
	}));
}

export function clearChatUnread(chatId: number) {
	updateChatById(chatId, (chat) =>
		(chat.unread_count ?? 0) === 0 ? null : { ...chat, unread_count: 0 }
	);
}

/** Replace all messages for a chat */
export function setChatMessages(chatId: number, messages: Message[]) {
	setMessages(chatId, messages);
}

/** Append messages to a chat, deduplicating by guid */
export function appendMessage(chatId: number, message: Message) {
	const existing = messageMemoryCache.get(chatId) ?? [];
	if (existing.some((m) => m.guid === message.guid)) return;
	setMessages(chatId, [...existing, message]);
}

/** Prepend older messages (for pagination) */
export function prependMessages(chatId: number, messages: Message[]) {
	const existing = messageMemoryCache.get(chatId) ?? [];
	const existingGuids = new Set(existing.map((m) => m.guid));
	const fresh = messages.filter((m) => !existingGuids.has(m.guid));
	if (fresh.length === 0) return;
	setMessages(chatId, [...fresh, ...existing]);
}

/** Remove a message by guid (e.g. optimistic message on failure) */
export function removeMessage(chatId: number, guid: string) {
	const existing = messageMemoryCache.get(chatId);
	if (!existing) return;
	setMessages(chatId, existing.filter((m) => m.guid !== guid));
}

/** Remove one optimistic temp message that matches a confirmed server message. */
export function removeMatchingOptimisticMessage(chatId: number, message: Message) {
	const existing = messageMemoryCache.get(chatId);
	if (!existing) return;
	if (!message.is_from_me) return;

	const normalizedBody = (message.body ?? message.text ?? '').trim();
	if (!normalizedBody) return;
	const matchingWindowMs = message.schedule_type === 2 ? 10 * 60 * 1000 : 120_000;

	// Find nearest optimistic sent message with same text in a short window.
	const idx = existing.findIndex((m) => {
		if (!m.is_from_me) return false;
		if (m.rowid >= 0) return false;
		if (m.schedule_type !== message.schedule_type) return false;
		const optimisticBody = (m.body ?? m.text ?? '').trim();
		if (optimisticBody !== normalizedBody) return false;
		return Math.abs(m.date - message.date) < matchingWindowMs;
	});
	if (idx === -1) return;

	const updated = [...existing];
	updated.splice(idx, 1);
	setMessages(chatId, updated);
}

/** Incrementally update reactions on a specific message */
export function updateMessageReactions(
	chatId: number,
	messageGuid: string,
	reaction: Reaction,
	isRemoval: boolean
) {
	updateMessageByGuid(chatId, messageGuid, (message) => {
		const reactions = [...(message.reactions ?? [])];
		const addType = isRemoval
			? addVariantOf(reaction.associated_message_type)
			: reaction.associated_message_type;
		const key = `${reaction.is_from_me ? 'me' : reaction.handle_id}:${addType}`;

		if (isRemoval) {
			const removeIdx = reactions.findIndex(
				(r) =>
					`${r.is_from_me ? 'me' : r.handle_id}:${r.associated_message_type}` === key
			);
			if (removeIdx !== -1) reactions.splice(removeIdx, 1);
		} else {
			const emoji = reaction.emoji || reactionEmoji(reaction.associated_message_type) || '';
			reactions.push({ ...reaction, emoji });
		}

		return { ...message, reactions };
	});
}

/** Update message body text locally (used for edits). */
export function updateMessageBody(chatId: number, messageGuid: string, body: string, editedAt = Date.now()) {
	const updatedMsg = updateMessageByGuid(chatId, messageGuid, (message) => ({
		...message,
		text: body,
		body,
		date_edited: editedAt
	}));
	if (!updatedMsg) return;

	const chat = chats.find((c) => c.rowid === chatId);
	if (chat?.last_message?.guid === messageGuid) {
		updateChatLastMessage(chatId, updatedMsg);
	}
}

/** Mark message as unsent/retracted locally. */
export function markMessageRetracted(chatId: number, messageGuid: string, retractedAt = Date.now()) {
	const updatedMsg = updateMessageByGuid(chatId, messageGuid, (message) => ({
		...message,
		date_retracted: retractedAt,
		text: '',
		body: ''
	}));
	if (!updatedMsg) return;

	const chat = chats.find((c) => c.rowid === chatId);
	if (chat?.last_message?.guid === messageGuid) {
		updateChatLastMessage(chatId, updatedMsg);
	}
}

/** Set participants for a chat */
export function setParticipants(chatId: number, participants: Participant[]) {
	setParticipantsForChat(chatId, participants);
}

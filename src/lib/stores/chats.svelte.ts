import type { Chat, Message, Participant, Reaction } from '$lib/types/index.js';
import { getCachedChats, cacheChats } from '$lib/db/client-db.js';
import { isReactionRemoval, addVariantOf, reactionEmoji, parseAssociatedGuid } from '$lib/utils/reactions.js';

let chats: Chat[] = $state([]);
let source: 'cache' | 'server' | 'none' = $state('none');
let messageMemoryCache: Map<number, Message[]> = $state(new Map());
let participantCache: Map<number, Participant[]> = $state(new Map());

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
	const idx = chats.findIndex((c) => c.rowid === chatId);
	if (idx === -1) return;

	const chat = chats[idx];
	const next = [...chats];
	next[idx] = { ...chat, unread_count: (chat.unread_count ?? 0) + delta };
	chats = next;
}

export function clearChatUnread(chatId: number) {
	const idx = chats.findIndex((c) => c.rowid === chatId);
	if (idx === -1) return;

	const chat = chats[idx];
	if ((chat.unread_count ?? 0) === 0) return;
	const next = [...chats];
	next[idx] = { ...chat, unread_count: 0 };
	chats = next;
}

/** Replace all messages for a chat */
export function setChatMessages(chatId: number, messages: Message[]) {
	const next = new Map(messageMemoryCache);
	next.set(chatId, messages);
	messageMemoryCache = next;
}

/** Append messages to a chat, deduplicating by guid */
export function appendMessage(chatId: number, message: Message) {
	const existing = messageMemoryCache.get(chatId) ?? [];
	if (existing.some((m) => m.guid === message.guid)) return;
	const next = new Map(messageMemoryCache);
	next.set(chatId, [...existing, message]);
	messageMemoryCache = next;
}

/** Prepend older messages (for pagination) */
export function prependMessages(chatId: number, messages: Message[]) {
	const existing = messageMemoryCache.get(chatId) ?? [];
	const existingGuids = new Set(existing.map((m) => m.guid));
	const fresh = messages.filter((m) => !existingGuids.has(m.guid));
	if (fresh.length === 0) return;
	const next = new Map(messageMemoryCache);
	next.set(chatId, [...fresh, ...existing]);
	messageMemoryCache = next;
}

/** Remove a message by guid (e.g. optimistic message on failure) */
export function removeMessage(chatId: number, guid: string) {
	const existing = messageMemoryCache.get(chatId);
	if (!existing) return;
	const next = new Map(messageMemoryCache);
	next.set(chatId, existing.filter((m) => m.guid !== guid));
	messageMemoryCache = next;
}

/** Remove one optimistic temp message that matches a confirmed server message. */
export function removeMatchingOptimisticMessage(chatId: number, message: Message) {
	const existing = messageMemoryCache.get(chatId);
	if (!existing) return;
	if (!message.is_from_me) return;

	const normalizedBody = (message.body ?? message.text ?? '').trim();
	if (!normalizedBody) return;

	// Find nearest optimistic sent message with same text in a short window.
	const idx = existing.findIndex((m) => {
		if (!m.is_from_me) return false;
		if (m.rowid >= 0) return false;
		const optimisticBody = (m.body ?? m.text ?? '').trim();
		if (optimisticBody !== normalizedBody) return false;
		return Math.abs(m.date - message.date) < 120_000;
	});
	if (idx === -1) return;

	const next = new Map(messageMemoryCache);
	const updated = [...existing];
	updated.splice(idx, 1);
	next.set(chatId, updated);
	messageMemoryCache = next;
}

/** Incrementally update reactions on a specific message */
export function updateMessageReactions(
	chatId: number,
	messageGuid: string,
	reaction: Reaction,
	isRemoval: boolean
) {
	const existing = messageMemoryCache.get(chatId);
	if (!existing) return;

	const msgIdx = existing.findIndex((m) => m.guid === messageGuid);
	if (msgIdx === -1) return;

	const msg = existing[msgIdx];
	const reactions = [...(msg.reactions ?? [])];
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

	const updatedMsg = { ...msg, reactions };
	const updatedMessages = [...existing];
	updatedMessages[msgIdx] = updatedMsg;

	const next = new Map(messageMemoryCache);
	next.set(chatId, updatedMessages);
	messageMemoryCache = next;
}

/** Update message body text locally (used for edits). */
export function updateMessageBody(chatId: number, messageGuid: string, body: string, editedAt = Date.now()) {
	const existing = messageMemoryCache.get(chatId);
	if (!existing) return;

	const msgIdx = existing.findIndex((m) => m.guid === messageGuid);
	if (msgIdx === -1) return;

	const msg = existing[msgIdx];
	const updatedMsg: Message = {
		...msg,
		text: body,
		body,
		date_edited: editedAt
	};

	const updatedMessages = [...existing];
	updatedMessages[msgIdx] = updatedMsg;

	const next = new Map(messageMemoryCache);
	next.set(chatId, updatedMessages);
	messageMemoryCache = next;

	const chat = chats.find((c) => c.rowid === chatId);
	if (chat?.last_message?.guid === messageGuid) {
		updateChatLastMessage(chatId, updatedMsg);
	}
}

/** Mark message as unsent/retracted locally. */
export function markMessageRetracted(chatId: number, messageGuid: string, retractedAt = Date.now()) {
	const existing = messageMemoryCache.get(chatId);
	if (!existing) return;

	const msgIdx = existing.findIndex((m) => m.guid === messageGuid);
	if (msgIdx === -1) return;

	const msg = existing[msgIdx];
	const updatedMsg: Message = {
		...msg,
		date_retracted: retractedAt,
		text: '',
		body: ''
	};

	const updatedMessages = [...existing];
	updatedMessages[msgIdx] = updatedMsg;

	const next = new Map(messageMemoryCache);
	next.set(chatId, updatedMessages);
	messageMemoryCache = next;

	const chat = chats.find((c) => c.rowid === chatId);
	if (chat?.last_message?.guid === messageGuid) {
		updateChatLastMessage(chatId, updatedMsg);
	}
}

/** Set participants for a chat */
export function setParticipants(chatId: number, participants: Participant[]) {
	const next = new Map(participantCache);
	next.set(chatId, participants);
	participantCache = next;
}

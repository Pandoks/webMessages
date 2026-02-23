import type { LayoutServerLoad } from './$types';
import { getChatList, getChatParticipants } from '$lib/server/queries/chats.js';
import { resolveContact, waitForContacts, contactsLoaded } from '$lib/server/contacts.js';
import type { Chat } from '$lib/types/index.js';

// Cache the resolved chat list so we don't re-query + re-resolve on every navigation
let cachedChats: Chat[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30_000; // refresh at most every 30s
let cachedWithContacts = false; // whether the cache was built with contacts loaded

function resolveChats(): Chat[] {
	const chats = getChatList();

	for (const chat of chats) {
		if (!chat.display_name) {
			const participants = getChatParticipants(chat.rowid);
			if (participants.length === 1) {
				chat.display_name = resolveContact(participants[0].handle_identifier);
			} else if (participants.length > 1) {
				chat.display_name = participants
					.map((p) => resolveContact(p.handle_identifier))
					.slice(0, 3)
					.join(', ');
				if (participants.length > 3) {
					chat.display_name += ` + ${participants.length - 3}`;
				}
			} else {
				chat.display_name = resolveContact(chat.chat_identifier);
			}
		}
	}

	return chats;
}

export const load: LayoutServerLoad = async () => {
	// Wait for contacts to load so names resolve correctly (up to 90s on cold start)
	await waitForContacts(90_000);

	const now = Date.now();
	const hasContacts = contactsLoaded();

	// Invalidate cache if contacts just became available or TTL expired
	if (cachedChats && now - cacheTimestamp < CACHE_TTL && (cachedWithContacts || !hasContacts)) {
		return { chats: cachedChats };
	}

	const chats = resolveChats();
	cachedChats = chats;
	cacheTimestamp = now;
	cachedWithContacts = hasContacts;
	return { chats };
};

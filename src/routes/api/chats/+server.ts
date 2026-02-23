import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getChatList, getChatParticipants } from '$lib/server/queries/chats.js';
import { resolveContact } from '$lib/server/contacts.js';

export const GET: RequestHandler = () => {
	const chats = getChatList();

	for (const chat of chats) {
		const participants = getChatParticipants(chat.rowid);

		// Resolve participant display names
		for (const p of participants) {
			p.display_name = resolveContact(p.handle_identifier);
		}

		chat.participants = participants;

		// Resolve chat display name if not set
		if (!chat.display_name) {
			if (participants.length === 1) {
				chat.display_name = resolveContact(participants[0].handle_identifier);
			} else if (participants.length > 1) {
				chat.display_name = participants
					.map((p) => p.display_name)
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

	return json({ chats });
};

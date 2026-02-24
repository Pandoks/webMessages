import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getChatList, getChatParticipants } from '$lib/server/queries/chats.js';
import { getRelatedContactIdentifiers, resolveContact } from '$lib/server/contacts.js';
import { isPhoneNumber, normalizePhone } from '$lib/utils/phone.js';
import type { Chat, Participant } from '$lib/types/index.js';

type MergedChat = Chat & {
	merged_chat_ids: number[];
	merged_chat_guids: string[];
};

function canonicalIdentifier(identifier: string): string {
	const trimmed = identifier.trim();
	if (!trimmed) return '';
	if (isPhoneNumber(trimmed)) {
		return normalizePhone(trimmed).toLowerCase();
	}
	return trimmed.toLowerCase();
}

function directMergeKey(participants: Participant[]): string | null {
	if (participants.length !== 1) return null;
	const base = participants[0].handle_identifier;
	if (!base) return null;
	const related = getRelatedContactIdentifiers(base);
	const keys = Array.from(
		new Set(related.map((id) => canonicalIdentifier(id)).filter((id) => id.length > 0))
	).sort();
	if (keys.length === 0) return null;
	return `direct:${keys.join('|')}`;
}

function resolveDisplayName(chat: Chat, participants: Participant[]): string {
	if (chat.display_name) return chat.display_name;
	if (participants.length === 1) {
		return resolveContact(participants[0].handle_identifier);
	}
	if (participants.length > 1) {
		let label = participants
			.map((p) => p.display_name)
			.slice(0, 3)
			.join(', ');
		if (participants.length > 3) label += ` + ${participants.length - 3}`;
		return label;
	}
	return resolveContact(chat.chat_identifier);
}

export const GET: RequestHandler = () => {
	const chats = getChatList();
	const merged = new Map<string, MergedChat>();

	for (const chat of chats) {
		const participants = getChatParticipants(chat.rowid);

		// Resolve participant display names
		for (const p of participants) {
			p.display_name = resolveContact(p.handle_identifier);
		}

		chat.participants = participants;
		chat.display_name = resolveDisplayName(chat, participants);

		const key = chat.style === 45 ? directMergeKey(participants) ?? `chat:${chat.rowid}` : `chat:${chat.rowid}`;
		const existing = merged.get(key);
		if (!existing) {
			merged.set(key, {
				...chat,
				participants: [...participants],
				merged_chat_ids: [chat.rowid],
				merged_chat_guids: [chat.guid]
			});
			continue;
		}

		const participantMap = new Map<string, Participant>();
		for (const p of existing.participants ?? []) {
			participantMap.set(p.handle_identifier.toLowerCase(), p);
		}
		for (const p of participants) {
			const participantKey = p.handle_identifier.toLowerCase();
			if (!participantMap.has(participantKey)) {
				participantMap.set(participantKey, p);
			}
		}
		existing.participants = Array.from(participantMap.values());

		if (!existing.merged_chat_ids.includes(chat.rowid)) {
			existing.merged_chat_ids.push(chat.rowid);
		}
		if (!existing.merged_chat_guids.includes(chat.guid)) {
			existing.merged_chat_guids.push(chat.guid);
		}

		const existingLast = existing.last_message?.date ?? 0;
		const incomingLast = chat.last_message?.date ?? 0;
		if (incomingLast > existingLast) {
			existing.rowid = chat.rowid;
			existing.guid = chat.guid;
			existing.chat_identifier = chat.chat_identifier;
			existing.service_name = chat.service_name;
			existing.style = chat.style;
			existing.is_archived = chat.is_archived;
			existing.last_message = chat.last_message;
			existing.display_name = chat.display_name;
		}
	}

	const mergedChats = Array.from(merged.values()).sort(
		(a, b) => (b.last_message?.date ?? 0) - (a.last_message?.date ?? 0)
	);
	return json({ chats: mergedChats });
};

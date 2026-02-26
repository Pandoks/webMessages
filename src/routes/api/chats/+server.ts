import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getChatList, getChatParticipants } from '$lib/server/queries/chats.js';
import { getRelatedContactIdentifiers, resolveContact } from '$lib/server/contacts.js';
import { getPinnedRank } from '$lib/server/pinning.js';
import { isPhoneNumber, normalizePhone } from '$lib/utils/phone.js';
import type { Chat, Participant } from '$lib/types/index.js';

type MergedChat = Chat & {
	merged_chat_ids: number[];
	merged_chat_guids: string[];
};

const DIRECT_CHAT_STYLE = 45;

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

function pinCandidates(chat: Chat, participants: Participant[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const add = (value: string | null | undefined) => {
		if (!value) return;
		const trimmed = value.trim();
		if (!trimmed) return;
		if (seen.has(trimmed)) return;
		seen.add(trimmed);
		out.push(trimmed);
	};

	add(chat.chat_identifier);
	add(chat.guid);

	// "any;-;<identifier>" / "any;+;<identifier>" guid format.
	const guidParts = chat.guid.split(';');
	if (guidParts.length >= 3) {
		add(guidParts[guidParts.length - 1]);
	}

	// Contact-handle pins should only match direct chats.
	if (chat.style === DIRECT_CHAT_STYLE) {
		for (const p of participants) {
			add(p.handle_identifier);
		}
	}

	return out;
}

function mergeParticipants(existing: Participant[] = [], incoming: Participant[]): Participant[] {
	const merged = new Map<string, Participant>(
		existing.map((participant) => [participant.handle_identifier.toLowerCase(), participant])
	);
	for (const participant of incoming) {
		const key = participant.handle_identifier.toLowerCase();
		if (!merged.has(key)) {
			merged.set(key, participant);
		}
	}
	return Array.from(merged.values());
}

function pushUnique<T>(items: T[], value: T) {
	if (!items.includes(value)) items.push(value);
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
		chat.pin_rank = getPinnedRank(pinCandidates(chat, participants));
		chat.is_pinned = chat.pin_rank !== null;

		const key =
			chat.style === DIRECT_CHAT_STYLE
				? directMergeKey(participants) ?? `chat:${chat.rowid}`
				: `chat:${chat.rowid}`;
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

		existing.unread_count = (existing.unread_count ?? 0) + (chat.unread_count ?? 0);
		const existingPinRank = existing.pin_rank ?? Number.POSITIVE_INFINITY;
		const incomingPinRank = chat.pin_rank ?? Number.POSITIVE_INFINITY;
		if (incomingPinRank < existingPinRank) {
			existing.pin_rank = chat.pin_rank;
			existing.is_pinned = chat.is_pinned;
		}

		existing.participants = mergeParticipants(existing.participants, participants);
		pushUnique(existing.merged_chat_ids, chat.rowid);
		pushUnique(existing.merged_chat_guids, chat.guid);

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
		(a, b) => {
			const pinRankA = a.pin_rank ?? Number.POSITIVE_INFINITY;
			const pinRankB = b.pin_rank ?? Number.POSITIVE_INFINITY;
			if (pinRankA !== pinRankB) return pinRankA - pinRankB;
			return (b.last_message?.date ?? 0) - (a.last_message?.date ?? 0);
		}
	);
	return json({ chats: mergedChats });
};

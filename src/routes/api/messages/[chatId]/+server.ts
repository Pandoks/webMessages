import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMessagesByChats } from '$lib/server/queries/messages.js';
import { getAttachmentsByMessage } from '$lib/server/queries/attachments.js';
import { getReactionsByChats } from '$lib/server/queries/reactions.js';
import {
	findDirectChatsByHandleIdentifiers,
	getChatById,
	getChatParticipants
} from '$lib/server/queries/chats.js';
import { getRelatedContactIdentifiers, resolveContact } from '$lib/server/contacts.js';
import { aggregateReactions } from '$lib/utils/reactions.js';
import type { Message } from '$lib/types/index.js';

export const GET: RequestHandler = ({ params, url }) => {
	const chatId = parseInt(params.chatId, 10);
	if (isNaN(chatId)) return json({ error: 'Invalid chat ID' }, { status: 400 });

	const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
	const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

	const chat = getChatById(chatId);
	if (!chat) return json({ error: 'Chat not found' }, { status: 404 });

	let participants = getChatParticipants(chatId);
	const mergedChatIds = new Set<number>([chatId]);
	const mergedChatGuids = new Map<number, string>([[chatId, chat.guid]]);

	// Merge direct chats that map to the same contact (multiple phone/email handles).
	if (chat.style === 45 && participants.length === 1) {
		const baseIdentifier = participants[0].handle_identifier;
		const relatedIdentifiers = getRelatedContactIdentifiers(baseIdentifier);
		const relatedChats = findDirectChatsByHandleIdentifiers(relatedIdentifiers);

		for (const related of relatedChats) {
			mergedChatIds.add(related.rowid);
			mergedChatGuids.set(related.rowid, related.guid);
		}

		if (relatedChats.length > 0) {
			const participantMap = new Map<string, (typeof participants)[number]>();
			for (const memberChatId of mergedChatIds) {
				for (const p of getChatParticipants(memberChatId)) {
					const key = p.handle_identifier.toLowerCase();
					if (!participantMap.has(key)) {
						participantMap.set(key, p);
					}
				}
			}
			participants = Array.from(participantMap.values());
		}
	}

	const chatIds = Array.from(mergedChatIds);
	const messages = getMessagesByChats(chatIds, limit, offset);

	// Attach attachments
	for (const msg of messages) {
		if (msg.cache_has_attachments) {
			msg.attachments = getAttachmentsByMessage(msg.rowid);
		}
		if (!msg.chat_guid) {
			msg.chat_guid = mergedChatGuids.get(msg.chat_id);
		}
	}

	// Build reaction map
	const rawReactions = getReactionsByChats(chatIds);
	const reactionMap = aggregateReactions(rawReactions);

	// Attach reactions to already-displayable messages (query-side filtering)
	for (const msg of messages) {
		msg.reactions = reactionMap.get(msg.guid) ?? [];
	}

	// Resolve sender names
	const handleMap = new Map<string, string>();
	for (const p of participants) {
		const name = resolveContact(p.handle_identifier);
		handleMap.set(p.handle_identifier, name);
		p.display_name = name;
	}

	for (const msg of messages) {
		if (msg.is_from_me) {
			msg.sender = 'Me';
		} else if (msg.sender) {
			msg.sender = handleMap.get(msg.sender) ?? resolveContact(msg.sender);
		}
	}

	// Resolve chat display name
	if (!chat.display_name) {
		if (participants.length === 1) {
			chat.display_name =
				handleMap.get(participants[0].handle_identifier) ?? participants[0].handle_identifier;
		} else {
			chat.display_name = participants
				.map((p) => p.display_name)
				.slice(0, 3)
				.join(', ');
		}
	}

	return json({
		chat,
		messages,
		participants,
		merged_chat_ids: chatIds,
		merged_chat_guids: Array.from(new Set(Array.from(mergedChatGuids.values())))
	});
};

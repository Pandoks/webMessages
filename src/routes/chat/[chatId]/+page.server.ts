import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getMessagesByChat } from '$lib/server/queries/messages.js';
import { getAttachmentsByMessage } from '$lib/server/queries/attachments.js';
import { getReactionsByChat } from '$lib/server/queries/reactions.js';
import { getChatById, getChatParticipants } from '$lib/server/queries/chats.js';
import { resolveContact } from '$lib/server/contacts.js';
import { isReactionType, isReactionRemoval, reactionEmoji, parseAssociatedGuid, addVariantOf } from '$lib/utils/reactions.js';
import type { Reaction, Message } from '$lib/types/index.js';

export const load: PageServerLoad = async ({ params }) => {
	const chatId = parseInt(params.chatId, 10);
	if (isNaN(chatId)) error(400, 'Invalid chat ID');

	const chat = getChatById(chatId);
	if (!chat) error(404, 'Chat not found');

	const messages = getMessagesByChat(chatId, 100, 0);

	// Attach attachments to messages that have them
	for (const msg of messages) {
		if (msg.cache_has_attachments) {
			msg.attachments = getAttachmentsByMessage(msg.rowid);
		}
	}

	// Build reaction map: target guid → aggregated reactions
	const rawReactions = getReactionsByChat(chatId);
	const reactionMap = aggregateReactions(rawReactions);

	// Separate real messages from reaction messages, attach reactions
	const displayMessages: Message[] = [];
	for (const msg of messages) {
		if (isReactionType(msg.associated_message_type)) continue;
		if (msg.item_type !== 0 && msg.group_action_type === 0 && !msg.group_title) continue;
		msg.reactions = reactionMap.get(msg.guid) ?? [];
		displayMessages.push(msg);
	}

	// Resolve sender names
	const participants = getChatParticipants(chatId);
	const handleMap = new Map<string, string>();
	for (const p of participants) {
		const name = resolveContact(p.handle_identifier);
		handleMap.set(p.handle_identifier, name);
		p.display_name = name;
	}

	for (const msg of displayMessages) {
		if (msg.is_from_me) {
			msg.sender = 'Me';
		} else if (msg.sender) {
			msg.sender = handleMap.get(msg.sender) ?? resolveContact(msg.sender);
		}
	}

	// Resolve chat display name
	if (!chat.display_name) {
		if (participants.length === 1) {
			chat.display_name = handleMap.get(participants[0].handle_identifier) ?? participants[0].handle_identifier;
		} else {
			chat.display_name = participants.map(p => p.display_name).slice(0, 3).join(', ');
		}
	}

	return {
		chat,
		messages: displayMessages,
		participants
	};
};

/** Aggregate raw reaction messages into a map of target guid → Reaction[] */
function aggregateReactions(reactions: Reaction[]): Map<string, Reaction[]> {
	// Track active reactions: guid → Map<sender+type, Reaction>
	const active = new Map<string, Map<string, Reaction>>();

	for (const r of reactions) {
		const parsed = parseAssociatedGuid(r.associated_message_guid);
		if (!parsed) continue;

		const targetGuid = parsed.guid;
		if (!active.has(targetGuid)) {
			active.set(targetGuid, new Map());
		}

		const isRemoval = isReactionRemoval(r.associated_message_type);
		const addType = isRemoval ? addVariantOf(r.associated_message_type) : r.associated_message_type;
		const key = `${r.is_from_me ? 'me' : r.handle_id}:${addType}`;

		if (isRemoval) {
			active.get(targetGuid)!.delete(key);
		} else {
			const emoji = r.emoji || reactionEmoji(r.associated_message_type) || '';
			active.get(targetGuid)!.set(key, { ...r, emoji });
		}
	}

	// Convert to array map
	const result = new Map<string, Reaction[]>();
	for (const [guid, map] of active) {
		const arr = Array.from(map.values());
		if (arr.length > 0) {
			result.set(guid, arr);
		}
	}
	return result;
}

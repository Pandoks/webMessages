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
import type { Participant } from '$lib/types/index.js';

const DIRECT_CHAT_STYLE = 45;

function parseQueryInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function getMergedParticipants(chatIds: Iterable<number>): Participant[] {
  const participantMap = new Map<string, Participant>();
  for (const chatId of chatIds) {
    for (const participant of getChatParticipants(chatId)) {
      const key = participant.handle_identifier.toLowerCase();
      if (!participantMap.has(key)) {
        participantMap.set(key, participant);
      }
    }
  }
  return Array.from(participantMap.values());
}

function resolveParticipantNames(participants: Participant[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const participant of participants) {
    const name = resolveContact(participant.handle_identifier);
    names.set(participant.handle_identifier, name);
    participant.display_name = name;
  }
  return names;
}

export const GET: RequestHandler = ({ params, url }) => {
  const chatId = Number.parseInt(params.chatId, 10);
  if (Number.isNaN(chatId)) return json({ error: 'Invalid chat ID' }, { status: 400 });

  const limit = parseQueryInt(url.searchParams.get('limit'), 50);
  const offset = parseQueryInt(url.searchParams.get('offset'), 0);

  const chat = getChatById(chatId);
  if (!chat) return json({ error: 'Chat not found' }, { status: 404 });

  let participants = getChatParticipants(chatId);
  const mergedChatIds = new Set<number>([chatId]);
  const mergedChatGuids = new Map<number, string>([[chatId, chat.guid]]);

  // Merge direct chats that map to the same contact (multiple phone/email handles).
  if (chat.style === DIRECT_CHAT_STYLE && participants.length === 1) {
    const baseIdentifier = participants[0].handle_identifier;
    const relatedIdentifiers = getRelatedContactIdentifiers(baseIdentifier);
    const relatedChats = findDirectChatsByHandleIdentifiers(relatedIdentifiers);

    for (const related of relatedChats) {
      mergedChatIds.add(related.rowid);
      mergedChatGuids.set(related.rowid, related.guid);
    }

    if (relatedChats.length > 0) {
      participants = getMergedParticipants(mergedChatIds);
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
  const handleMap = resolveParticipantNames(participants);

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
    merged_chat_guids: Array.from(new Set(mergedChatGuids.values()))
  });
};

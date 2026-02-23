import type { Reaction } from '$lib/types/index.js';

/**
 * Map iMessage associated_message_type to emoji.
 * 2000-2006 = add reaction, 3000-3006 = remove reaction.
 */
const REACTION_MAP: Record<number, string> = {
	2000: '\u2764\ufe0f',  // love (heart)
	2001: '\ud83d\udc4d',  // like (thumbs up)
	2002: '\ud83d\udc4e',  // dislike (thumbs down)
	2003: '\ud83d\ude02',  // laugh
	2004: '\u2757\u2757',  // emphasize (double exclamation)
	2005: '\u2753',        // question mark
};

/** Get emoji for a reaction type. Returns null for non-reaction types. */
export function reactionEmoji(associatedMessageType: number): string | null {
	// Types 2000-2005 are add reactions
	if (associatedMessageType >= 2000 && associatedMessageType <= 2005) {
		return REACTION_MAP[associatedMessageType] ?? null;
	}
	// Type 2006 is custom emoji reaction
	if (associatedMessageType === 2006) {
		return null; // caller should use associated_message_emoji field
	}
	return null;
}

/** Check if a message type is a reaction (add or remove) */
export function isReactionType(associatedMessageType: number): boolean {
	return associatedMessageType >= 2000 && associatedMessageType <= 3006;
}

/** Check if a reaction type is a removal (3000-3006) */
export function isReactionRemoval(associatedMessageType: number): boolean {
	return associatedMessageType >= 3000 && associatedMessageType <= 3006;
}

/** Get the "add" variant of a remove reaction type */
export function addVariantOf(removeType: number): number {
	return removeType - 1000;
}

/**
 * Parse the target message GUID from associated_message_guid.
 * Format is "p:PART/GUID" or "bp:GUID" - we extract the GUID portion.
 */
export function parseAssociatedGuid(raw: string): { part: number; guid: string } | null {
	// Format: p:0/XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
	const match = raw.match(/^(?:bp:|p:(\d+)\/)(.+)$/);
	if (!match) return null;
	return {
		part: match[1] ? parseInt(match[1], 10) : 0,
		guid: match[2]
	};
}

/** Aggregate raw reaction messages into a map of target guid → Reaction[] */
export function aggregateReactions(reactions: Reaction[]): Map<string, Reaction[]> {
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

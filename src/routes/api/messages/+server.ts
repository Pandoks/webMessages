import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sendMessage, sendMessageToHandle } from '$lib/server/send.js';
import { sendScheduledMessage } from '$lib/server/imcore.js';
import { findLatestDirectChatByHandleIdentifiers } from '$lib/server/queries/chats.js';
import { findContactGroupMatches, getRelatedContactIdentifiers } from '$lib/server/contacts.js';
import { trimmedString } from '$lib/server/route-utils.js';
import { isPhoneNumber } from '$lib/utils/phone.js';

function looksLikeHandle(input: string): boolean {
	return isPhoneNumber(input) || input.includes('@');
}

function parseScheduledFor(value: unknown): number | null {
	if (value == null) return null;
	if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) return null;
		const fromNumber = Number(trimmed);
		if (Number.isFinite(fromNumber)) return Math.trunc(fromNumber);
		const fromDate = Date.parse(trimmed);
		if (Number.isFinite(fromDate)) return Math.trunc(fromDate);
	}
	return null;
}

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const chatGuid = trimmedString(body.chatGuid);
	const rawHandle = trimmedString(body.handle);
	const trimmedText = trimmedString(body.text);
	const scheduledFor = parseScheduledFor(body.scheduledFor);
	const service = body.service;

	if (body.scheduledFor != null && scheduledFor == null) {
		return json({ error: 'scheduledFor must be a valid unix timestamp (ms) or ISO date string' }, { status: 400 });
	}
	if (scheduledFor != null && scheduledFor <= Date.now() + 30_000) {
		return json({ error: 'scheduledFor must be at least 30 seconds in the future' }, { status: 400 });
	}

	try {
		if (chatGuid) {
			if (!trimmedText) {
				return json({ error: 'Text is required' }, { status: 400 });
			}
			if (scheduledFor != null) {
				await sendScheduledMessage(chatGuid, trimmedText, scheduledFor);
				return json({ success: true, chatGuid, scheduledFor });
			}
			await sendMessage(chatGuid, trimmedText);
			return json({ success: true, chatGuid, scheduledFor: null });
		}

		if (!rawHandle) {
			return json({ error: 'Either chatGuid or handle is required' }, { status: 400 });
		}

		let resolvedIdentifier = rawHandle;
		let identifiersToTry: string[] = [];
		let existingChat: { rowid: number; guid: string } | null = null;

		if (looksLikeHandle(rawHandle)) {
			identifiersToTry = getRelatedContactIdentifiers(rawHandle);
		} else {
			const matches = findContactGroupMatches(rawHandle, 5);
			if (matches.length === 0) {
				return json({ error: `No contact found for "${rawHandle}"` }, { status: 404 });
			}

			// Prefer an existing conversation from any matching contact first.
			for (const match of matches) {
				const chat = findLatestDirectChatByHandleIdentifiers(match.identifiers);
				if (!chat) continue;
				if (!existingChat || chat.rowid > existingChat.rowid) {
					existingChat = chat;
					identifiersToTry = match.identifiers;
				}
			}

			if (!existingChat) {
				if (matches.length > 1) {
					return json(
						{
							error: 'Multiple contacts matched. Use a more specific name, phone, or email.',
							matches: matches.map((m) => ({ name: m.name, identifiers: m.identifiers }))
						},
						{ status: 409 }
					);
				}
				identifiersToTry = matches[0].identifiers;
			}

			resolvedIdentifier = identifiersToTry[0];
		}

		existingChat = existingChat ?? findLatestDirectChatByHandleIdentifiers(identifiersToTry);
		if (existingChat) {
			if (trimmedText) {
				if (scheduledFor != null) {
					await sendScheduledMessage(existingChat.guid, trimmedText, scheduledFor);
				} else {
					await sendMessage(existingChat.guid, trimmedText);
				}
			}
			return json({
				success: true,
				chatId: existingChat.rowid,
				chatGuid: existingChat.guid,
				reusedChat: true,
				sent: !!trimmedText,
				scheduledFor
			});
		}

		if (!trimmedText) {
			return json(
				{ error: 'No existing conversation found. Enter a message to start a new chat.' },
				{ status: 400 }
			);
		}
		if (scheduledFor != null) {
			return json(
				{
					error:
						'Scheduling is only supported for existing conversations. Send one message first to create the chat, then schedule.'
				},
				{ status: 400 }
			);
		}

		await sendMessageToHandle(resolvedIdentifier, trimmedText, service ?? 'iMessage');
		return json({ success: true, reusedChat: false, sent: true, scheduledFor: null });
	} catch (err) {
		console.error('Send message error:', err);
		return json({ error: 'Failed to send message' }, { status: 500 });
	}
};

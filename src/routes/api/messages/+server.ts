import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sendMessage, sendMessageToHandle } from '$lib/server/send.js';
import { findLatestDirectChatByHandleIdentifiers } from '$lib/server/queries/chats.js';
import { findContactGroupMatches, getRelatedContactIdentifiers } from '$lib/server/contacts.js';
import { isPhoneNumber } from '$lib/utils/phone.js';

function looksLikeHandle(input: string): boolean {
	return isPhoneNumber(input) || input.includes('@');
}

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { chatGuid, handle, text, service } = body;
	const trimmedText = typeof text === 'string' ? text.trim() : '';
	const rawHandle = typeof handle === 'string' ? handle.trim() : '';

	try {
		if (chatGuid) {
			if (!trimmedText) {
				return json({ error: 'Text is required' }, { status: 400 });
			}
			await sendMessage(chatGuid, trimmedText);
			return json({ success: true, chatGuid });
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
				await sendMessage(existingChat.guid, trimmedText);
			}
			return json({
				success: true,
				chatId: existingChat.rowid,
				chatGuid: existingChat.guid,
				reusedChat: true,
				sent: !!trimmedText
			});
		}

		if (!trimmedText) {
			return json(
				{ error: 'No existing conversation found. Enter a message to start a new chat.' },
				{ status: 400 }
			);
		}

		await sendMessageToHandle(resolvedIdentifier, trimmedText, service ?? 'iMessage');
		return json({ success: true, reusedChat: false, sent: true });
	} catch (err) {
		console.error('Send message error:', err);
		return json({ error: 'Failed to send message' }, { status: 500 });
	}
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sendMessage, sendMessageToHandle } from '$lib/server/send.js';
import { findDirectChatByHandleIdentifier } from '$lib/server/queries/chats.js';
import { findContactMatches } from '$lib/server/contacts.js';
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
		if (!looksLikeHandle(rawHandle)) {
			const matches = findContactMatches(rawHandle, 5);
			if (matches.length === 0) {
				return json({ error: `No contact found for "${rawHandle}"` }, { status: 404 });
			}
			if (matches.length > 1) {
				return json(
					{
						error: 'Multiple contacts matched. Use a more specific name, phone, or email.',
						matches
					},
					{ status: 409 }
				);
			}
			resolvedIdentifier = matches[0].identifier;
		}

		const existingChat = findDirectChatByHandleIdentifier(resolvedIdentifier);
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

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sendMessage, sendMessageToHandle } from '$lib/server/send.js';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { chatGuid, handle, text, service } = body;

	if (!text || typeof text !== 'string') {
		return json({ error: 'Text is required' }, { status: 400 });
	}

	try {
		if (chatGuid) {
			await sendMessage(chatGuid, text);
		} else if (handle) {
			await sendMessageToHandle(handle, text, service ?? 'iMessage');
		} else {
			return json({ error: 'Either chatGuid or handle is required' }, { status: 400 });
		}

		return json({ success: true });
	} catch (err) {
		console.error('Send message error:', err);
		return json({ error: 'Failed to send message' }, { status: 500 });
	}
};

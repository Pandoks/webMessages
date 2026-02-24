import { json, type RequestHandler } from '@sveltejs/kit';
import { sendReply } from '$lib/server/imcore.js';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { chatGuid, messageGuid, text, partIndex } = body;

	if (!chatGuid || !messageGuid || !text) {
		return json({ error: 'chatGuid, messageGuid, and text are required' }, { status: 400 });
	}

	try {
		await sendReply(chatGuid, messageGuid, text, partIndex);
		return json({ success: true });
	} catch (err) {
		console.error('Reply error:', err);
		const message = err instanceof Error ? err.message : 'Failed to send reply';
		return json({ error: message }, { status: 500 });
	}
};

import { json, type RequestHandler } from '@sveltejs/kit';
import { sendReply } from '$lib/server/imcore.js';
import { errorMessage, trimmedString } from '$lib/server/route-utils.js';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const chatGuid = trimmedString(body.chatGuid);
	const messageGuid = trimmedString(body.messageGuid);
	const text = trimmedString(body.text);
	const partIndex = body.partIndex;

	if (!chatGuid || !messageGuid || !text) {
		return json({ error: 'chatGuid, messageGuid, and text are required' }, { status: 400 });
	}

	try {
		await sendReply(chatGuid, messageGuid, text, partIndex);
		return json({ success: true });
	} catch (err) {
		console.error('Reply error:', err);
		return json({ error: errorMessage(err, 'Failed to send reply') }, { status: 500 });
	}
};

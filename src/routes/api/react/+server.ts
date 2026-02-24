import { json, type RequestHandler } from '@sveltejs/kit';
import { sendReaction } from '$lib/server/imcore.js';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { chatGuid, messageGuid, reactionType, partIndex } = body;

	if (!chatGuid || !messageGuid || reactionType == null) {
		return json({ error: 'chatGuid, messageGuid, and reactionType are required' }, { status: 400 });
	}

	try {
		await sendReaction(chatGuid, messageGuid, reactionType, partIndex);
		return json({ success: true });
	} catch (err) {
		console.error('React error:', err);
		const message = err instanceof Error ? err.message : 'Failed to send reaction';
		return json({ error: message }, { status: 500 });
	}
};

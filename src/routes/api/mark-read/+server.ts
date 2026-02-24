import { json, type RequestHandler } from '@sveltejs/kit';
import { markAsRead } from '$lib/server/imcore.js';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { chatGuid } = body;

	if (!chatGuid) {
		return json({ error: 'chatGuid is required' }, { status: 400 });
	}

	try {
		await markAsRead(chatGuid);
		return json({ success: true });
	} catch (err) {
		console.error('Mark read error:', err);
		return json({ error: 'Failed to mark as read' }, { status: 500 });
	}
};

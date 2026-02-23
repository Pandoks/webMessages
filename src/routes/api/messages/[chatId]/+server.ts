import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMessagesByChat } from '$lib/server/queries/messages.js';
import { getAttachmentsByMessage } from '$lib/server/queries/attachments.js';

export const GET: RequestHandler = ({ params, url }) => {
	const chatId = parseInt(params.chatId, 10);
	if (isNaN(chatId)) return json({ error: 'Invalid chat ID' }, { status: 400 });

	const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
	const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

	const messages = getMessagesByChat(chatId, limit, offset);

	for (const msg of messages) {
		if (msg.cache_has_attachments) {
			msg.attachments = getAttachmentsByMessage(msg.rowid);
		}
	}

	return json({ messages });
};

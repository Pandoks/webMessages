import { json, type RequestHandler } from '@sveltejs/kit';
import { sendEdit } from '$lib/server/imcore.js';
import { getMessageByGuid } from '$lib/server/queries/messages.js';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { chatGuid, messageGuid, text, partIndex } = body;

	if (!chatGuid || !messageGuid || !text) {
		return json({ error: 'chatGuid, messageGuid, and text are required' }, { status: 400 });
	}

	try {
		const before = getMessageByGuid(messageGuid);
		if (!before) {
			return json({ error: 'Message not found' }, { status: 404 });
		}

		const editWindowMs = 15 * 60 * 1000;
		const ageMs = Date.now() - before.date;
		if (
			!before.is_from_me ||
			before.service !== 'iMessage' ||
			(before.date_retracted ?? 0) > 0 ||
			ageMs > editWindowMs
		) {
			return json(
				{
					error: 'Edit is not available for this message. It may be outside Apple\'s edit window or unsupported for this chat.'
				},
				{ status: 409 }
			);
		}

		const beforeEdited = before?.date_edited ?? 0;
		const beforeBody = (before?.body ?? before?.text ?? '').trim();

		await sendEdit(chatGuid, messageGuid, text, partIndex);

		const deadline = Date.now() + 7000;
		let verified = false;
		while (Date.now() < deadline) {
			const after = getMessageByGuid(messageGuid);
			if (!after) break;
			const afterEdited = after.date_edited ?? 0;
			const afterBody = (after.body ?? after.text ?? '').trim();
			if (afterEdited > beforeEdited || afterBody !== beforeBody) {
				verified = true;
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}

		if (!verified) {
			return json(
				{
					success: false,
					error: 'Edit was accepted by bridge but no message edit appeared in chat.db.'
				},
				{ status: 409 }
			);
		}

		return json({ success: true });
	} catch (err) {
		console.error('Edit error:', err);
		const message = err instanceof Error ? err.message : 'Failed to edit message';
		const noEffect =
			message.includes('No supported edit selector found') ||
			message.includes('no message edit appeared');
		if (noEffect) {
			return json({ error: 'Edit is not available for this message on this chat/device state.' }, { status: 409 });
		}
		return json({ error: message }, { status: 500 });
	}
};

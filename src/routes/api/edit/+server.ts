import { json, type RequestHandler } from '@sveltejs/kit';
import { sendEdit } from '$lib/server/imcore.js';
import { getMessageByGuid } from '$lib/server/queries/messages.js';
import { errorMessage, pollUntil, trimmedString } from '$lib/server/route-utils.js';

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const VERIFY_TIMEOUT_MS = 7000;
const POLL_INTERVAL_MS = 250;

async function waitForEdit(
	messageGuid: string,
	beforeEdited: number,
	beforeBody: string
): Promise<boolean> {
	return pollUntil(() => {
		const after = getMessageByGuid(messageGuid);
		if (!after) return false;

		const afterEdited = after.date_edited ?? 0;
		const afterBody = (after.body ?? after.text ?? '').trim();
		return afterEdited > beforeEdited || afterBody !== beforeBody;
	}, VERIFY_TIMEOUT_MS, POLL_INTERVAL_MS);
}

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
		const before = getMessageByGuid(messageGuid);
		if (!before) {
			return json({ error: 'Message not found' }, { status: 404 });
		}

		const ageMs = Date.now() - before.date;
		if (
			!before.is_from_me ||
			before.service !== 'iMessage' ||
			(before.date_retracted ?? 0) > 0 ||
			ageMs > EDIT_WINDOW_MS
		) {
			return json(
				{
					error: 'Edit is not available for this message. It may be outside Apple\'s edit window or unsupported for this chat.'
				},
				{ status: 409 }
			);
		}

		const beforeEdited = before.date_edited ?? 0;
		const beforeBody = (before.body ?? before.text ?? '').trim();

		await sendEdit(chatGuid, messageGuid, text, partIndex);
		const verified = await waitForEdit(messageGuid, beforeEdited, beforeBody);

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
		const message = errorMessage(err, 'Failed to edit message');
		const noEffect =
			message.includes('No supported edit selector found') ||
			message.includes('no message edit appeared');
		if (noEffect) {
			return json({ error: 'Edit is not available for this message on this chat/device state.' }, { status: 409 });
		}
		return json({ error: message }, { status: 500 });
	}
};

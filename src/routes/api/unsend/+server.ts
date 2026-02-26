import { json, type RequestHandler } from '@sveltejs/kit';
import { debugUnsend, sendUnsend } from '$lib/server/imcore.js';
import { getMessageByGuid } from '$lib/server/queries/messages.js';
import { errorMessage, pollUntil, trimmedString } from '$lib/server/route-utils.js';

const VERIFY_TIMEOUT_MS = 7000;
const POLL_INTERVAL_MS = 250;

async function waitForRetraction(messageGuid: string): Promise<boolean> {
	return pollUntil(() => {
		const message = getMessageByGuid(messageGuid);
		return !!(message?.date_retracted && message.date_retracted > 0);
	}, VERIFY_TIMEOUT_MS, POLL_INTERVAL_MS);
}

async function logDebugUnsend(chatGuid: string, messageGuid: string): Promise<void> {
	try {
		const debug = await debugUnsend(chatGuid, messageGuid);
		console.warn(
			`[unsend] debug no-effect ${messageGuid}: ${JSON.stringify({
				chatClass: debug.chatClass,
				itemClass: debug.itemClass,
				msgClass: debug.msgClass,
				partClass: debug.partClass,
				resolvedPartClass: debug.resolvedPartClass,
				existingPartClass: debug.existingPartClass,
				descriptorPartClass: debug.descriptorPartClass,
				candidatePartClasses: debug.candidatePartClasses,
				retractAllowed: debug.retractAllowed
			})}`
		);
	} catch (debugErr) {
		console.warn(`[unsend] debug_unsend failed for ${messageGuid}:`, debugErr);
	}
}

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const chatGuid = trimmedString(body.chatGuid);
	const messageGuid = trimmedString(body.messageGuid);

	if (!chatGuid || !messageGuid) {
		return json({ error: 'chatGuid and messageGuid are required' }, { status: 400 });
	}

	try {
		console.log(`[unsend] request chatGuid=${chatGuid} messageGuid=${messageGuid}`);
		const target = getMessageByGuid(messageGuid);
		if (!target) {
			console.warn(`[unsend] message not found ${messageGuid}`);
			return json({ error: 'Message not found' }, { status: 404 });
		}
		const ageMs = Date.now() - target.date;
		const ageSec = Math.max(0, Math.floor(ageMs / 1000));
		console.log(
			`[unsend] target service=${target.service} ageSec=${ageSec} is_from_me=${target.is_from_me} retracted=${target.date_retracted ? 1 : 0}`
		);
		await sendUnsend(chatGuid, messageGuid);

		// Verify unsend actually materialized in the DB (can no-op on unsupported messages).
		const verified = await waitForRetraction(messageGuid);

		if (!verified) {
			await logDebugUnsend(chatGuid, messageGuid);
			console.warn(`[unsend] no retraction observed for ${messageGuid}`);
			return json(
				{
					success: false,
					error: 'Undo Send was accepted by bridge but no retraction appeared. This message may be outside Apple\'s unsend window or unsupported for this chat.'
				},
				{ status: 409 }
			);
		}

		console.log(`[unsend] verified retraction for ${messageGuid}`);
		return json({ success: true });
	} catch (err) {
		const message = errorMessage(err, 'Failed to unsend message');
		const noEffect =
			message.includes('No unsend effect') ||
			message.includes('no retraction observed') ||
			message.includes('retractTimeout=');

		if (noEffect) {
			console.warn(`[unsend] no-effect failure for ${messageGuid}: ${message}`);
			return json(
				{
					error: 'Undo Send is not available for this message on this chat/device state.'
				},
				{ status: 409 }
			);
		}

		console.error('Unsend error:', err);
		return json({ error: message }, { status: 500 });
	}
};

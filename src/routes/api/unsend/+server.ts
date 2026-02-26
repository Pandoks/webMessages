import { json, type RequestHandler } from '@sveltejs/kit';
import { debugUnsend, sendUnsend } from '$lib/server/imcore.js';
import { getMessageByGuid } from '$lib/server/queries/messages.js';
import { errorMessage, pollUntil, trimmedString } from '$lib/server/route-utils.js';

const VERIFY_TIMEOUT_MS = 7000;
const POLL_INTERVAL_MS = 250;
const SCHEDULE_STATE_PENDING = 2;

function isScheduledPendingMessage(message: {
	date: number;
	date_retracted: number | null;
	schedule_type: number;
	schedule_state: number;
}): boolean {
	if (message.date_retracted && message.date_retracted > 0) return false;
	if (message.schedule_type !== 2) return false;
	if (message.date <= Date.now()) return false;
	// Some rows can briefly report 0 during transition; treat as pending.
	return message.schedule_state === 0 || message.schedule_state === SCHEDULE_STATE_PENDING;
}

async function waitForRetraction(messageGuid: string): Promise<boolean> {
	return pollUntil(() => {
		const message = getMessageByGuid(messageGuid);
		return !!(message?.date_retracted && message.date_retracted > 0);
	}, VERIFY_TIMEOUT_MS, POLL_INTERVAL_MS);
}

async function waitForScheduledCancel(messageGuid: string): Promise<boolean> {
	return pollUntil(() => {
		const message = getMessageByGuid(messageGuid);
		if (!message) return true;
		if (message.date_retracted && message.date_retracted > 0) return true;
		return !isScheduledPendingMessage(message);
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
		const scheduledPending = isScheduledPendingMessage(target);
		console.log(
			`[unsend] target service=${target.service} ageSec=${ageSec} is_from_me=${target.is_from_me} retracted=${target.date_retracted ? 1 : 0} scheduled_pending=${
				scheduledPending ? 1 : 0
			}`
		);
		await sendUnsend(chatGuid, messageGuid);

		// Scheduled cancellation often changes/removes the row without setting date_retracted.
		const verified = scheduledPending
			? await waitForScheduledCancel(messageGuid)
			: await waitForRetraction(messageGuid);

		if (!verified) {
			await logDebugUnsend(chatGuid, messageGuid);
			console.warn(
				`[unsend] no ${scheduledPending ? 'scheduled cancel' : 'retraction'} observed for ${messageGuid}`
			);
			return json(
				{
					success: false,
					error: scheduledPending
						? 'Cancel Send Later was accepted by bridge but no cancel state appeared. This message may no longer be cancelable on this device state.'
						: 'Undo Send was accepted by bridge but no retraction appeared. This message may be outside Apple\'s unsend window or unsupported for this chat.'
				},
				{ status: 409 }
			);
		}

		console.log(
			`[unsend] verified ${scheduledPending ? 'scheduled cancel' : 'retraction'} for ${messageGuid}`
		);
		return json({ success: true, canceledScheduled: scheduledPending });
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

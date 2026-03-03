import { json } from '@sveltejs/kit';
import { broadcaster } from '$lib/server/events.js';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ request }) => {
	let event: unknown;
	try {
		event = await request.json();
	} catch {
		return json({ status: 400, message: 'Invalid JSON' }, { status: 400 });
	}

	if (
		!event ||
		typeof event !== 'object' ||
		!('type' in event) ||
		!('data' in event)
	) {
		return json({ status: 400, message: 'Missing type or data' }, { status: 400 });
	}

	broadcaster.broadcast(event as { type: string; data: unknown });
	return json({ status: 200, message: 'OK' });
};

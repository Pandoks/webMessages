import { json } from '@sveltejs/kit';
import { broadcaster } from '$lib/server/events.js';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ request }) => {
	const event = await request.json();
	broadcaster.broadcast(event);
	return json({ status: 200, message: 'OK' });
};

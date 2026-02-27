import type { Handle } from '@sveltejs/kit';
import { isAllowedIp } from '$lib/server/auth.js';
import { error } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const ip = event.getClientAddress();
	event.locals.clientIp = ip;

	if (!isAllowedIp(ip)) {
		error(403, 'Access denied: not on Tailscale network');
	}

	return resolve(event);
};

import type { Handle } from '@sveltejs/kit';
import { isAllowedIp } from '$lib/server/auth.js';
import { error } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	let ip: string;
	try {
		ip = event.getClientAddress();
	} catch {
		// Dev server internal requests may not have a client address
		ip = '127.0.0.1';
	}
	event.locals.clientIp = ip;

	if (!isAllowedIp(ip)) {
		error(403, 'Access denied: not on Tailscale network');
	}

	return resolve(event);
};

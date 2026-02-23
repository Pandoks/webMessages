import type { Handle } from '@sveltejs/kit';
import { ensureContactsLoading } from '$lib/server/contacts.js';

/**
 * Tailscale CGNAT range: 100.64.0.0/10
 * This covers 100.64.0.0 - 100.127.255.255
 * We also allow localhost for development.
 */
function isTailscaleIP(ip: string): boolean {
	if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
		return true;
	}

	const cleanIp = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
	const parts = cleanIp.split('.');
	if (parts.length !== 4) return false;

	const first = parseInt(parts[0], 10);
	const second = parseInt(parts[1], 10);
	if (first !== 100) return false;
	return second >= 64 && second <= 127;
}

export const handle: Handle = async ({ event, resolve }) => {
	// Start contact loading in the background — don't block requests
	// Safe to call on every request; deduplicates internally
	ensureContactsLoading();

	const forwarded = event.request.headers.get('x-forwarded-for');
	let ip: string;
	try {
		ip = forwarded?.split(',')[0]?.trim() ?? event.getClientAddress();
	} catch {
		ip = '127.0.0.1';
	}

	if (!isTailscaleIP(ip)) {
		return new Response('Unauthorized', { status: 403 });
	}

	event.locals.ip = ip;
	return resolve(event);
};

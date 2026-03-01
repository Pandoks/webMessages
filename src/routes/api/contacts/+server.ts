import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { loadContacts } from '$lib/server/contacts.js';

export const GET: RequestHandler = async () => {
	try {
		const { data, photos } = await loadContacts();
		return json({ status: 200, data, photos });
	} catch {
		return json({ status: 200, data: {}, photos: {} });
	}
};

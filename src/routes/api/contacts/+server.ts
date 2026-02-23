import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAllContacts } from '$lib/server/contacts.js';

export const GET: RequestHandler = () => {
	return json({ contacts: getAllContacts() });
};

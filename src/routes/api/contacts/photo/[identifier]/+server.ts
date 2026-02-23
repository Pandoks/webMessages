import type { RequestHandler } from './$types';
import { getContactPhoto } from '$lib/server/contacts.js';

export const GET: RequestHandler = async ({ params }) => {
	const identifier = decodeURIComponent(params.identifier);
	const photo = await getContactPhoto(identifier);

	if (!photo) {
		return new Response(null, { status: 404 });
	}

	return new Response(photo.data, {
		headers: {
			'Content-Type': photo.mime,
			'Cache-Control': 'public, max-age=86400'
		}
	});
};

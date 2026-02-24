import type { RequestHandler } from './$types';
import { getContactPhoto } from '$lib/server/contacts.js';

export const GET: RequestHandler = async ({ params }) => {
	const identifier = decodeURIComponent(params.identifier);
	const photo = await getContactPhoto(identifier);

	if (!photo) {
		// No photo for this identifier is expected for many handles.
		// Return 204 to avoid noisy 404 error logs in browser devtools.
		return new Response(null, {
			status: 204,
			headers: {
				'Cache-Control': 'public, max-age=3600'
			}
		});
	}

	return new Response(photo.data, {
		headers: {
			'Content-Type': photo.mime,
			'Cache-Control': 'public, max-age=86400'
		}
	});
};

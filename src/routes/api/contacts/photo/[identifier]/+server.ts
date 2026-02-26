import type { RequestHandler } from './$types';
import { exportContactPhotos, getContactPhoto } from '$lib/server/contacts.js';

export const GET: RequestHandler = async ({ params }) => {
	const identifier = decodeURIComponent(params.identifier);
	// Ensure the photo map is initialized before first lookup.
	await exportContactPhotos(false);
	const photo = await getContactPhoto(identifier);

	if (!photo) {
		// No photo for this identifier is expected for many handles.
		// Return 204 to avoid noisy 404 error logs in browser devtools.
		// Do not cache misses; startup races and newly-added photos should recover quickly.
		return new Response(null, {
			status: 204,
			headers: {
				'Cache-Control': 'no-store'
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

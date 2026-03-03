import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ getClientAddress }) => {
	const clientIp = getClientAddress();

	try {
		const res = await fetch(`https://ipwho.is/${clientIp}`);
		const data = await res.json();

		if (!data.success || data.latitude == null || data.longitude == null) {
			return json({ error: 'IP geolocation failed', details: data.message }, { status: 502 });
		}

		return json({
			latitude: data.latitude,
			longitude: data.longitude,
			city: data.city,
			region: data.region,
			country: data.country
		});
	} catch {
		return json({ error: 'IP geolocation service unavailable' }, { status: 502 });
	}
};

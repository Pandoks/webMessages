import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import https from 'node:https';

function ipwhoGet(ip: string): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		https
			.get(`https://ipwho.is/${ip}`, (res) => {
				let body = '';
				res.on('data', (chunk: Buffer) => (body += chunk));
				res.on('end', () => {
					try {
						resolve(JSON.parse(body));
					} catch {
						reject(new Error('Invalid JSON'));
					}
				});
			})
			.on('error', reject);
	});
}

export const GET: RequestHandler = async ({ url }) => {
	const clientIp = url.searchParams.get('ip');
	if (!clientIp || !/^\d{1,3}(\.\d{1,3}){3}$/.test(clientIp)) {
		return json({ error: 'Missing or invalid ip query param' }, { status: 400 });
	}

	try {
		const data = await ipwhoGet(clientIp);

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

import { IMESSAGE_RS_URL, IMESSAGE_RS_PASSWORD } from '$lib/server/env.js';
import type { RequestHandler } from './$types.js';

const handler: RequestHandler = async ({ params, request, url }) => {
	const targetUrl = new URL(`/api/v1/${params.path}`, IMESSAGE_RS_URL);

	// Preserve original query params
	url.searchParams.forEach((value, key) => {
		targetUrl.searchParams.set(key, value);
	});
	targetUrl.searchParams.set('password', IMESSAGE_RS_PASSWORD);

	const headers = new Headers();
	const contentType = request.headers.get('content-type');
	if (contentType) headers.set('content-type', contentType);

	const res = await fetch(targetUrl.toString(), {
		method: request.method,
		headers,
		body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
		// @ts-expect-error -- duplex needed for streaming body
		duplex: 'half'
	});

	return new Response(res.body, {
		status: res.status,
		headers: {
			'content-type': res.headers.get('content-type') ?? 'application/json'
		}
	});
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;

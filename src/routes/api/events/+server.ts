import { broadcaster } from '$lib/server/events.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async () => {
	let clientId: number;

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();
			const client = {
				enqueue: (data: string) => controller.enqueue(encoder.encode(data)),
				close: () => controller.close()
			};
			clientId = broadcaster.addClient(client);
			controller.enqueue(encoder.encode('event: connected\ndata: {}\n\n'));
		},
		cancel() {
			broadcaster.removeClient(clientId);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};

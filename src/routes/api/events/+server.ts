import type { RequestHandler } from './$types';
import { addClient, removeClient, startWatcher } from '$lib/server/watcher.js';

export const GET: RequestHandler = () => {
  startWatcher();

  const clientId = crypto.randomUUID();
  let client: { id: string; controller: ReadableStreamDefaultController };

  const stream = new ReadableStream({
    start(controller) {
      client = { id: clientId, controller };
      addClient(client);

      // Send connected event
      const msg = `event: connected\ndata: ${JSON.stringify({ id: clientId })}\n\n`;
      controller.enqueue(new TextEncoder().encode(msg));
    },
    cancel() {
      if (client) removeClient(client);
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

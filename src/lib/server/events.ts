import type { WebhookEvent } from '$lib/types/index.js';

interface SSEClient {
	enqueue: (data: string) => void;
	close: () => void;
}

export class EventBroadcaster {
	private clients = new Map<number, SSEClient>();
	private nextId = 0;

	get clientCount() {
		return this.clients.size;
	}

	addClient(controller: SSEClient): number {
		const id = this.nextId++;
		this.clients.set(id, controller);
		return id;
	}

	removeClient(id: number) {
		this.clients.delete(id);
	}

	broadcast(event: WebhookEvent) {
		const data = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
		for (const [id, client] of this.clients) {
			try {
				client.enqueue(data);
			} catch {
				this.clients.delete(id);
			}
		}
	}
}

export const broadcaster = new EventBroadcaster();

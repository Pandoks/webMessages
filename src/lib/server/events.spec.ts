import { describe, it, expect } from 'vitest';
import { EventBroadcaster } from './events.js';

describe('EventBroadcaster', () => {
	it('adds and removes clients', () => {
		const broadcaster = new EventBroadcaster();
		expect(broadcaster.clientCount).toBe(0);

		const id = broadcaster.addClient({ enqueue: () => {}, close: () => {} } as any);
		expect(broadcaster.clientCount).toBe(1);

		broadcaster.removeClient(id);
		expect(broadcaster.clientCount).toBe(0);
	});

	it('broadcasts to all clients', () => {
		const broadcaster = new EventBroadcaster();
		const received: string[] = [];

		const fakeController = {
			enqueue: (data: string) => received.push(data),
			close: () => {}
		};

		broadcaster.addClient(fakeController as any);
		broadcaster.broadcast({ type: 'new-message', data: { guid: 'test' } });

		expect(received.length).toBe(1);
		expect(received[0]).toContain('new-message');
	});
});

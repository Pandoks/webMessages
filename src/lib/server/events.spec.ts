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

	it('multiple clients receive the same broadcast', () => {
		const broadcaster = new EventBroadcaster();
		const received1: string[] = [];
		const received2: string[] = [];
		const received3: string[] = [];

		broadcaster.addClient({ enqueue: (d: string) => received1.push(d), close: () => {} });
		broadcaster.addClient({ enqueue: (d: string) => received2.push(d), close: () => {} });
		broadcaster.addClient({ enqueue: (d: string) => received3.push(d), close: () => {} });

		broadcaster.broadcast({ type: 'chat-read', data: { chatGuid: 'chat-1' } });

		expect(received1.length).toBe(1);
		expect(received2.length).toBe(1);
		expect(received3.length).toBe(1);
		expect(received1[0]).toBe(received2[0]);
		expect(received2[0]).toBe(received3[0]);
	});

	it('removes client that throws on enqueue', () => {
		const broadcaster = new EventBroadcaster();
		const healthy: string[] = [];

		broadcaster.addClient({
			enqueue: () => { throw new Error('connection lost'); },
			close: () => {}
		});
		broadcaster.addClient({
			enqueue: (d: string) => healthy.push(d),
			close: () => {}
		});

		expect(broadcaster.clientCount).toBe(2);
		broadcaster.broadcast({ type: 'new-message', data: { guid: 'msg-1' } });

		expect(broadcaster.clientCount).toBe(1);
		expect(healthy.length).toBe(1);
	});

	it('formats event data as correct SSE format', () => {
		const broadcaster = new EventBroadcaster();
		const received: string[] = [];

		broadcaster.addClient({ enqueue: (d: string) => received.push(d), close: () => {} });
		broadcaster.broadcast({ type: 'typing-indicator', data: { chatGuid: 'chat-1', display: true } });

		const sse = received[0];
		expect(sse).toMatch(/^event: typing-indicator\n/);
		expect(sse).toMatch(/\ndata: /);
		expect(sse).toMatch(/\n\n$/);

		const lines = sse.split('\n');
		const dataLine = lines.find(l => l.startsWith('data: '));
		expect(dataLine).toBeDefined();
		const parsed = JSON.parse(dataLine!.slice('data: '.length));
		expect(parsed).toEqual({ chatGuid: 'chat-1', display: true });
	});

	it('assigns unique IDs to multiple clients', () => {
		const broadcaster = new EventBroadcaster();
		const ids: number[] = [];

		for (let i = 0; i < 5; i++) {
			ids.push(broadcaster.addClient({ enqueue: () => {}, close: () => {} }));
		}

		const uniqueIds = new Set(ids);
		expect(uniqueIds.size).toBe(5);
	});

	it('does not throw when removing non-existent client', () => {
		const broadcaster = new EventBroadcaster();
		expect(() => broadcaster.removeClient(9999)).not.toThrow();
		expect(broadcaster.clientCount).toBe(0);
	});
});

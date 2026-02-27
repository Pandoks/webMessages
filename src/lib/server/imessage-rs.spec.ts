import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImessageClient } from './imessage-rs.js';

describe('ImessageClient', () => {
	let client: ImessageClient;

	beforeEach(() => {
		client = new ImessageClient('http://localhost:1234', 'test-password');
	});

	it('constructs correct URL with password', () => {
		const url = client.buildUrl('/api/v1/ping');
		expect(url).toBe('http://localhost:1234/api/v1/ping?password=test-password');
	});

	it('constructs URL with existing query params', () => {
		const url = client.buildUrl('/api/v1/chat/guid/message?limit=50&sort=DESC');
		expect(url).toContain('password=test-password');
		expect(url).toContain('limit=50');
	});

	it('fetches with correct headers', async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ status: 200, message: 'Success', data: 'pong' }))
		);
		global.fetch = mockFetch;

		await client.get('/api/v1/ping');

		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining('/api/v1/ping'),
			expect.objectContaining({ method: 'GET' })
		);
	});
});

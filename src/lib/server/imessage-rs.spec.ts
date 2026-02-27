import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ImessageClient } from './imessage-rs.js';

describe('ImessageClient', () => {
	let client: ImessageClient;

	beforeEach(() => {
		client = new ImessageClient('http://localhost:1234', 'test-password');
	});

	afterEach(() => {
		vi.restoreAllMocks();
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
		const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ status: 200, message: 'Success', data: 'pong' }))
		);

		await client.get('/api/v1/ping');

		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining('/api/v1/ping'),
			expect.objectContaining({ method: 'GET' })
		);
	});

	it('URL-encodes special characters in password', () => {
		const specialClient = new ImessageClient('http://localhost:1234', 'p@ss w0rd&foo=bar');
		const url = specialClient.buildUrl('/api/v1/ping');

		const parsed = new URL(url);
		expect(parsed.searchParams.get('password')).toBe('p@ss w0rd&foo=bar');
		// The URL class encodes special chars, so the raw URL should not have literal & or spaces in the password value
		expect(url).not.toContain('password=p@ss w0rd&foo=bar');
	});

	it('handles GUIDs with special characters in URL path', () => {
		const guid = 'iMessage;-;+1234567890';
		const url = client.buildUrl(`/api/v1/chat/${encodeURIComponent(guid)}`);

		expect(url).toContain(encodeURIComponent(guid));
		expect(url).toContain('password=test-password');
	});

	it('POST sends correct body and Content-Type', async () => {
		const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ status: 200, message: 'Success', data: {} }))
		);

		const body = { chatGuid: 'iMessage;-;+1234567890', message: 'Hello world', method: 'private-api' };
		await client.post('/api/v1/message/text', body);

		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining('/api/v1/message/text'),
			expect.objectContaining({
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			})
		);
	});

	it('POST without body sends undefined body', async () => {
		const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ status: 200, message: 'Success', data: null }))
		);

		await client.post('/api/v1/chat/some-chat/read');

		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining('/api/v1/chat/some-chat/read'),
			expect.objectContaining({
				method: 'POST',
				body: undefined
			})
		);
	});

	it('returns parsed JSON response from get', async () => {
		const responseData = { status: 200, message: 'Success', data: 'pong' };
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify(responseData))
		);

		const result = await client.get('/api/v1/ping');
		expect(result).toEqual(responseData);
	});

	it('propagates fetch errors', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

		await expect(client.get('/api/v1/ping')).rejects.toThrow('Network error');
	});
});

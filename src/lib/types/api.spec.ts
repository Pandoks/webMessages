import { describe, it, expect } from 'vitest';
import type { Message, Chat, ApiResponse } from './index.js';

describe('types', () => {
	it('ApiResponse type compiles correctly', () => {
		const response: ApiResponse<string> = {
			status: 200,
			message: 'Success',
			data: 'test'
		};
		expect(response.status).toBe(200);
	});

	it('Message type allows null text', () => {
		const msg = { text: null } as Partial<Message>;
		expect(msg.text).toBeNull();
	});

	it('Chat style constants are correct', () => {
		const group: Partial<Chat> = { style: 43 };
		const oneOnOne: Partial<Chat> = { style: 45 };
		expect(group.style).toBe(43);
		expect(oneOnOne.style).toBe(45);
	});
});

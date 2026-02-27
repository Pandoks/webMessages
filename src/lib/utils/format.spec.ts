import { describe, it, expect } from 'vitest';
import { formatRelativeTime, formatPhoneNumber } from './format.js';

describe('formatRelativeTime', () => {
	it('shows "now" for very recent times', () => {
		expect(formatRelativeTime(Date.now() - 5000)).toBe('now');
	});

	it('shows minutes for under an hour', () => {
		expect(formatRelativeTime(Date.now() - 5 * 60 * 1000)).toBe('5m');
	});

	it('shows hours for under a day', () => {
		expect(formatRelativeTime(Date.now() - 3 * 60 * 60 * 1000)).toBe('3h');
	});
});

describe('formatPhoneNumber', () => {
	it('formats US numbers', () => {
		expect(formatPhoneNumber('+11234567890')).toBe('(123) 456-7890');
	});

	it('returns original for non-US', () => {
		expect(formatPhoneNumber('+442012345678')).toBe('+442012345678');
	});

	it('returns original for emails', () => {
		expect(formatPhoneNumber('user@example.com')).toBe('user@example.com');
	});
});

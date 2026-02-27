import { describe, it, expect } from 'vitest';
import { formatRelativeTime, formatPhoneNumber, getChatDisplayName } from './format.js';

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

	it('shows days for 1-6 days ago', () => {
		expect(formatRelativeTime(Date.now() - 1 * 24 * 60 * 60 * 1000)).toBe('1d');
		expect(formatRelativeTime(Date.now() - 3 * 24 * 60 * 60 * 1000)).toBe('3d');
		expect(formatRelativeTime(Date.now() - 6 * 24 * 60 * 60 * 1000)).toBe('6d');
	});

	it('shows date for 7+ days ago', () => {
		const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
		const result = formatRelativeTime(twoWeeksAgo);
		// Should be a localized date string like "Feb 13" rather than "14d"
		expect(result).not.toMatch(/^\d+d$/);
		// Should contain a month abbreviation and day number
		expect(result).toMatch(/\w+ \d+/);
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

describe('getChatDisplayName', () => {
	it('returns displayName when provided', () => {
		const handles = new Map<string, string | null>();
		expect(getChatDisplayName('Family Group', ['+1111111111'], handles)).toBe('Family Group');
	});

	it('returns "Unknown" with no participants and no displayName', () => {
		const handles = new Map<string, string | null>();
		expect(getChatDisplayName(null, [], handles)).toBe('Unknown');
	});

	it('uses handle display names for participants', () => {
		const handles = new Map<string, string | null>([
			['+11234567890', 'Alice'],
			['+19876543210', 'Bob']
		]);
		const result = getChatDisplayName(null, ['+11234567890', '+19876543210'], handles);
		expect(result).toBe('Alice, Bob');
	});

	it('falls back to formatted phone number when handle has no display name', () => {
		const handles = new Map<string, string | null>([
			['+11234567890', null]
		]);
		const result = getChatDisplayName(null, ['+11234567890'], handles);
		expect(result).toBe('(123) 456-7890');
	});

	it('falls back to formatted phone number when handle is not in map', () => {
		const handles = new Map<string, string | null>();
		const result = getChatDisplayName(null, ['+11234567890'], handles);
		expect(result).toBe('(123) 456-7890');
	});

	it('mixes known and unknown participants', () => {
		const handles = new Map<string, string | null>([
			['+11234567890', 'Alice']
		]);
		const result = getChatDisplayName(null, ['+11234567890', '+442012345678'], handles);
		expect(result).toBe('Alice, +442012345678');
	});
});

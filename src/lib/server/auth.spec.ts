import { describe, it, expect } from 'vitest';
import { isTailscaleIp, isAllowedIp } from './auth.js';

describe('auth', () => {
	it('allows Tailscale CGNAT IPs (100.64-127.x.x)', () => {
		expect(isTailscaleIp('100.64.0.1')).toBe(true);
		expect(isTailscaleIp('100.100.50.25')).toBe(true);
		expect(isTailscaleIp('100.127.255.255')).toBe(true);
	});

	it('rejects non-Tailscale IPs', () => {
		expect(isTailscaleIp('192.168.1.1')).toBe(false);
		expect(isTailscaleIp('10.0.0.1')).toBe(false);
		expect(isTailscaleIp('100.63.255.255')).toBe(false);
		expect(isTailscaleIp('100.128.0.0')).toBe(false);
	});

	it('allows localhost', () => {
		expect(isAllowedIp('127.0.0.1')).toBe(true);
		expect(isAllowedIp('::1')).toBe(true);
	});

	it('allows Tailscale IPs', () => {
		expect(isAllowedIp('100.100.50.25')).toBe(true);
	});

	it('rejects random IPs', () => {
		expect(isAllowedIp('8.8.8.8')).toBe(false);
	});
});

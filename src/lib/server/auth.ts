/**
 * Check if IP is in Tailscale CGNAT range (100.64.0.0/10).
 * This covers 100.64.0.0 - 100.127.255.255.
 */
export function isTailscaleIp(ip: string): boolean {
	const parts = ip.split('.').map(Number);
	if (parts.length !== 4) return false;
	return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

export function isAllowedIp(ip: string): boolean {
	if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
	return isTailscaleIp(ip);
}

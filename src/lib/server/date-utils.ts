/**
 * Apple epoch offset: seconds between Unix epoch (1970-01-01) and Apple epoch (2001-01-01).
 * chat.db stores dates as nanoseconds since 2001-01-01.
 */
const APPLE_EPOCH_OFFSET = 978307200;

/** Convert Apple nanosecond timestamp to Unix milliseconds */
export function appleToUnixMs(appleNanos: number): number {
	if (appleNanos === 0) return 0;
	return Math.floor(appleNanos / 1_000_000) + APPLE_EPOCH_OFFSET * 1000;
}

/** Convert Unix milliseconds to Apple nanosecond timestamp */
export function unixMsToApple(unixMs: number): number {
	if (unixMs === 0) return 0;
	return (unixMs - APPLE_EPOCH_OFFSET * 1000) * 1_000_000;
}

/** Convert Apple nanosecond timestamp to Date object, or null if 0 */
export function appleToDate(appleNanos: number): Date | null {
	if (appleNanos === 0) return null;
	return new Date(appleToUnixMs(appleNanos));
}

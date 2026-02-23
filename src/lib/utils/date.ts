/** Format a unix ms timestamp for display in chat list */
export function formatChatListDate(unixMs: number): string {
	if (unixMs === 0) return '';
	const date = new Date(unixMs);
	const now = new Date();
	const diff = now.getTime() - date.getTime();
	const days = Math.floor(diff / (1000 * 60 * 60 * 24));

	if (days === 0) {
		return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
	} else if (days === 1) {
		return 'Yesterday';
	} else if (days < 7) {
		return date.toLocaleDateString([], { weekday: 'long' });
	} else {
		return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
	}
}

/** Format a unix ms timestamp for display in message thread */
export function formatMessageTime(unixMs: number): string {
	if (unixMs === 0) return '';
	return new Date(unixMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Format a timestamp for time separator between message groups */
export function formatTimeSeparator(unixMs: number): string {
	if (unixMs === 0) return '';
	const date = new Date(unixMs);
	const now = new Date();
	const diff = now.getTime() - date.getTime();
	const days = Math.floor(diff / (1000 * 60 * 60 * 24));

	const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

	if (days === 0) {
		return time;
	} else if (days === 1) {
		return `Yesterday ${time}`;
	} else if (days < 7) {
		return `${date.toLocaleDateString([], { weekday: 'long' })} ${time}`;
	} else {
		return `${date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })} ${time}`;
	}
}

/** Check if two timestamps are more than N minutes apart */
export function isTimeSeparatorNeeded(t1: number, t2: number, minuteGap = 15): boolean {
	return Math.abs(t2 - t1) > minuteGap * 60 * 1000;
}

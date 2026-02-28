export function formatRelativeTime(timestamp: number): string {
	const diff = Date.now() - timestamp;
	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (seconds < 60) return 'now';
	if (minutes < 60) return `${minutes}m`;
	if (hours < 24) return `${hours}h`;
	if (days < 7) return `${days}d`;

	return new Date(timestamp).toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric'
	});
}

export function formatPhoneNumber(address: string): string {
	if (address.includes('@')) return address;
	const usMatch = address.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
	if (usMatch) return `(${usMatch[1]}) ${usMatch[2]}-${usMatch[3]}`;
	return address;
}

export function getChatDisplayName(
	displayName: string | null,
	participants: string[],
	handles: Map<string, string | null>
): string {
	if (displayName) return displayName;
	if (participants.length === 0) return 'Unknown';
	return participants
		.map((addr) => handles.get(addr) || formatPhoneNumber(addr))
		.join(', ');
}

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

const STATE_ABBREVS: Record<string, string> = {
	alabama: 'AL',
	alaska: 'AK',
	arizona: 'AZ',
	arkansas: 'AR',
	california: 'CA',
	colorado: 'CO',
	connecticut: 'CT',
	delaware: 'DE',
	florida: 'FL',
	georgia: 'GA',
	hawaii: 'HI',
	idaho: 'ID',
	illinois: 'IL',
	indiana: 'IN',
	iowa: 'IA',
	kansas: 'KS',
	kentucky: 'KY',
	louisiana: 'LA',
	maine: 'ME',
	maryland: 'MD',
	massachusetts: 'MA',
	michigan: 'MI',
	minnesota: 'MN',
	mississippi: 'MS',
	missouri: 'MO',
	montana: 'MT',
	nebraska: 'NE',
	nevada: 'NV',
	'new hampshire': 'NH',
	'new jersey': 'NJ',
	'new mexico': 'NM',
	'new york': 'NY',
	'north carolina': 'NC',
	'north dakota': 'ND',
	ohio: 'OH',
	oklahoma: 'OK',
	oregon: 'OR',
	pennsylvania: 'PA',
	'rhode island': 'RI',
	'south carolina': 'SC',
	'south dakota': 'SD',
	tennessee: 'TN',
	texas: 'TX',
	utah: 'UT',
	vermont: 'VT',
	virginia: 'VA',
	washington: 'WA',
	'west virginia': 'WV',
	wisconsin: 'WI',
	wyoming: 'WY',
	'district of columbia': 'DC'
};

export function extractCityState(address: string | null): string | null {
	if (!address) return null;
	const parts = address.split(',').map((p) => p.trim());
	if (parts.length < 2) return address;
	// Format: "Street, City, ST 94102" or "City, ST 94102" or "City, State"
	// City is always parts[-2], state+zip is parts[-1]
	const city = parts[parts.length - 2];
	const stateZip = parts[parts.length - 1];
	// Extract just the state abbreviation (strip zip code)
	const state = stateZip.split(/\s+/)[0];
	const abbrev = STATE_ABBREVS[state.toLowerCase()] ?? state;
	return `${city}, ${abbrev}`;
}

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const R = 3958.8; // Earth radius in miles
	const dLat = ((lat2 - lat1) * Math.PI) / 180;
	const dLon = ((lon2 - lon1) * Math.PI) / 180;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(miles: number): string {
	if (miles < 0.1) return '0 mi';
	if (miles < 1) return `${miles.toFixed(1)} mi`;
	return `${Math.round(miles).toLocaleString()} mi`;
}

export function getChatDisplayName(
	displayName: string | null,
	participants: string[],
	handles: Map<string, string | null>
): string {
	if (displayName) return displayName;
	if (participants.length === 0) return 'Unknown';
	return participants.map((addr) => handles.get(addr) || formatPhoneNumber(addr)).join(', ');
}

/** Strip all non-digit characters from a phone number */
function digitsOnly(phone: string): string {
	return phone.replace(/\D/g, '');
}

/**
 * Normalize a phone number for comparison.
 * Strips +1 country code, returns last 10 digits.
 */
export function normalizePhone(phone: string): string {
	const digits = digitsOnly(phone);
	// If starts with 1 and has 11 digits, strip the country code
	if (digits.length === 11 && digits.startsWith('1')) {
		return digits.slice(1);
	}
	// Return last 10 digits for comparison
	if (digits.length >= 10) {
		return digits.slice(-10);
	}
	return digits;
}

/** Check if a string looks like a phone number */
export function isPhoneNumber(identifier: string): boolean {
	return /^\+?\d[\d\s()-]{6,}$/.test(identifier.trim());
}

/** Format a phone number for display: +1 (xxx) xxx-xxxx */
export function formatPhone(phone: string): string {
	const digits = normalizePhone(phone);
	if (digits.length === 10) {
		return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
	}
	return phone;
}

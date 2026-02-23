/**
 * Parse NSAttributedString typedstream blob from chat.db `attributedBody` column.
 *
 * Ported from tuimessages/internal/imessage/store.go
 * Finds ALL NSString markers, extracts text segments using byte-level parsing
 * with terminator detection, returns the longest valid candidate after cleanup.
 */

/** Check if a byte is likely the start of text content (printable ASCII or UTF-8 start byte) */
function isLikelyTextByte(b: number): boolean {
	return (b >= 0x20 && b <= 0x7e) || (b >= 0xc2 && b <= 0xf4);
}

/** Check if a byte is a typedstream terminator (0x84-0x91) */
function isAttributedTerminator(b: number): boolean {
	return b >= 0x84 && b <= 0x91;
}

/** Check if text looks like attributed metadata (not real message content) */
function looksLikeAttributedMetadata(s: string): boolean {
	const ls = s.toLowerCase().trim();
	if (!ls) return false;
	return (
		ls.includes('streamtyped') ||
		ls.includes('nsattributedstring') ||
		ls.includes('nsdictionary') ||
		ls.includes('nsobject')
	);
}

/** Check if a small tail string is a typedstream suffix (digits, *, replacement chars, control) */
function isTypedstreamTailSuffix(s: string): boolean {
	if (!s) return true;
	const runes = [...s];
	if (runes.length > 5) return false;
	for (const r of runes) {
		const code = r.codePointAt(0)!;
		if (code >= 0x30 && code <= 0x39) continue; // 0-9
		if (r === '*') continue;
		if (r === '\ufffd' || r === '\ufffc') continue;
		if (code < 0x20) continue; // control chars
		return false;
	}
	return true;
}

/** Strip "iI" tail markers from end of string */
function stripTypedstreamTailMarkers(s: string): string {
	s = s.trim();
	for (;;) {
		if (s.endsWith('iI')) {
			s = s.slice(0, -2).trim();
			continue;
		}
		const idx = s.lastIndexOf('iI');
		if (idx >= 0 && idx >= s.length - 8) {
			const tail = s.slice(idx + 2);
			if (isTypedstreamTailSuffix(tail)) {
				s = s.slice(0, idx).trim();
				continue;
			}
		}
		break;
	}
	return s;
}

/** Remove replacement chars, control chars, normalize whitespace. Cap at 3000 chars. */
function sanitizeText(raw: string): string {
	let result = '';
	let lastSpace = false;

	for (const r of raw) {
		const code = r.codePointAt(0)!;

		// Skip replacement characters
		if (r === '\ufffd' || r === '\ufffc') continue;

		// Preserve newlines (collapse consecutive)
		if (r === '\n') {
			if (result.length > 0 && !lastSpace) {
				result += '\n';
			}
			lastSpace = true;
			continue;
		}

		// Skip control characters (except tab)
		if (code < 0x20 && r !== '\t') continue;
		if (code === 0x7f) continue;

		// Collapse whitespace
		if (/\s/.test(r) && r !== '\n') {
			if (!lastSpace && result.length > 0) {
				result += ' ';
				lastSpace = true;
			}
			continue;
		}

		result += r;
		lastSpace = false;
	}

	result = result.trim();
	if (result.length > 3000) result = result.slice(0, 3000);
	return result;
}

/** Clean up typedstream artifacts from extracted text */
function cleanupTypedstreamText(raw: string, fromAttributed: boolean): string {
	let s = sanitizeText(raw);
	if (!s) return '';

	// Trim leading object replacement characters
	s = s.replace(/^[\ufffc\u{FFFC}]+/gu, '').trim();
	if (!s) return '';

	const hasTypedstreamMarkers =
		fromAttributed ||
		raw.includes('iI') ||
		s.includes('iI') ||
		raw.includes('\ufffd');

	// Some payloads start with garbage runes before the "+" marker
	if (hasTypedstreamMarkers) {
		const plusIdx = s.indexOf('+');
		if (plusIdx >= 0 && plusIdx <= 4) {
			s = s.slice(plusIdx);
		}
	}

	// Strip "+" prefix and optional numeric slot (reaction strings like "+5Emphasized...")
	if (s.startsWith('+') && hasTypedstreamMarkers) {
		s = s.slice(1);
		let i = 0;
		while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
		if (i > 0 && i < s.length && /\p{L}/u.test(s[i])) {
			s = s.slice(i);
		}
	}

	s = stripTypedstreamTailMarkers(s);
	s = s.replace(/^[\ufffc\u{FFFC}]+/gu, '').trim();
	return s;
}

/** Extract a text segment from the bytes following an NSString marker */
function extractNSStringSegment(segment: Buffer): string {
	if (segment.length === 0) return '';

	// Find the first byte that looks like text
	let start = -1;
	for (let i = 0; i < segment.length; i++) {
		if (isLikelyTextByte(segment[i])) {
			start = i;
			break;
		}
	}
	if (start < 0) return '';

	let result = '';
	let i = start;

	while (i < segment.length) {
		const b = segment[i];

		// Stop at terminator bytes (only after we have some content)
		if (result.length > 0 && isAttributedTerminator(b)) break;

		// Decode UTF-8 character
		let codePoint: number;
		let size: number;

		if (b < 0x80) {
			codePoint = b;
			size = 1;
		} else if (b >= 0xc2 && b <= 0xdf && i + 1 < segment.length) {
			codePoint = ((b & 0x1f) << 6) | (segment[i + 1] & 0x3f);
			size = 2;
		} else if (b >= 0xe0 && b <= 0xef && i + 2 < segment.length) {
			codePoint =
				((b & 0x0f) << 12) | ((segment[i + 1] & 0x3f) << 6) | (segment[i + 2] & 0x3f);
			size = 3;
		} else if (b >= 0xf0 && b <= 0xf4 && i + 3 < segment.length) {
			codePoint =
				((b & 0x07) << 18) |
				((segment[i + 1] & 0x3f) << 12) |
				((segment[i + 2] & 0x3f) << 6) |
				(segment[i + 3] & 0x3f);
			size = 4;
		} else {
			// Invalid UTF-8 start byte
			if (result.length > 0) break;
			i++;
			continue;
		}

		// Skip control characters (except newline and tab)
		if (codePoint < 0x20 && codePoint !== 0x0a && codePoint !== 0x09) {
			if (result.length > 0) break;
			i += size;
			continue;
		}

		result += String.fromCodePoint(codePoint);
		i += size;
	}

	return result.trim();
}

/**
 * Find all NSString markers in the blob, extract text segments from each,
 * and return the longest valid candidate after cleanup.
 */
function extractNSStringPayload(blob: Buffer): string {
	const token = Buffer.from('NSString');
	let best = '';
	let search = blob;

	for (;;) {
		const idx = search.indexOf(token);
		if (idx < 0) break;

		const segment = search.subarray(idx + token.length);
		let candidate = extractNSStringSegment(segment);
		candidate = cleanupTypedstreamText(candidate, true);

		if (candidate && !looksLikeAttributedMetadata(candidate)) {
			if ([...candidate].length > [...best].length) {
				best = candidate;
			}
		}

		const advance = idx + token.length;
		if (advance >= search.length) break;
		search = search.subarray(advance);
	}

	return best;
}

export function parseAttributedBody(blob: Buffer | null): string | null {
	if (!blob || blob.length === 0) return null;

	try {
		// Strategy 1: Extract NSString payload (finds longest valid candidate)
		const candidate = extractNSStringPayload(blob);
		if (candidate) return candidate;

		// Strategy 2: Broad fallback - strip nulls, find NSString, cleanup
		const s = blob.toString('utf-8').replace(/\0/g, '');
		const nsIdx = s.indexOf('NSString');
		if (nsIdx >= 0) {
			let fallback = s.slice(nsIdx + 'NSString'.length);
			const dictIdx = fallback.indexOf('NSDictionary');
			if (dictIdx > 0) fallback = fallback.slice(0, dictIdx);
			const cleaned = cleanupTypedstreamText(fallback, true);
			if (cleaned && !looksLikeAttributedMetadata(cleaned)) return cleaned;
		}

		// Strategy 3: Cleanup entire decoded string
		const fullClean = cleanupTypedstreamText(s, true);
		if (fullClean && !looksLikeAttributedMetadata(fullClean)) return fullClean;

		return null;
	} catch {
		return null;
	}
}

/**
 * Get message text with fallback chain: text → attributedBody → empty string
 */
export function getMessageText(
	text: string | null,
	attributedBody: Buffer | null
): string {
	if (text !== null && text.length > 0) return text;
	const parsed = parseAttributedBody(attributedBody);
	if (parsed !== null && parsed.length > 0) return parsed;
	return '';
}

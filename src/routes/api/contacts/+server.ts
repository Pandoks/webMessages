import { json } from '@sveltejs/kit';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { RequestHandler } from './$types.js';

const execFileAsync = promisify(execFile);

// In-memory cache — contacts don't change often
let cachedContacts: Record<string, string> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function normalizeAddress(addr: string): string {
	// Remove all non-alphanumeric except + and @
	const cleaned = addr.replace(/[\s\-()]/g, '');
	// Lowercase for email comparison
	return cleaned.toLowerCase();
}

export const GET: RequestHandler = async () => {
	// Return cached if fresh
	if (cachedContacts && Date.now() - cacheTimestamp < CACHE_TTL) {
		return json({ status: 200, data: cachedContacts });
	}

	try {
		// AppleScript to bulk-load all contacts with phone numbers and emails
		// Prefers nickname over formal name (emojis are often in nicknames)
		const script = `
set output to ""
tell application "Contacts"
	repeat with p in people
		set nn to nickname of p
		if nn is not missing value and nn is not "" then
			set n to nn
		else
			set n to name of p
		end if
		set phoneList to phones of p
		repeat with ph in phoneList
			set output to output & n & linefeed & (value of ph) & linefeed
		end repeat
		set emailList to emails of p
		repeat with em in emailList
			set output to output & n & linefeed & (value of em) & linefeed
		end repeat
	end repeat
end tell
return output`;

		const { stdout } = await execFileAsync('osascript', ['-e', script], {
			timeout: 60_000,
			maxBuffer: 10 * 1024 * 1024
		});

		const contacts: Record<string, string> = {};
		const lines = stdout.split('\n');
		// Lines alternate: name, address, name, address, ...
		for (let i = 0; i + 1 < lines.length; i += 2) {
			const name = lines[i].trim();
			const addr = lines[i + 1].trim();
			if (!name || !addr) continue;

			// Store with normalized key
			const normalized = normalizeAddress(addr);
			contacts[normalized] = name;

			// Also store with +1 prefix for US numbers
			if (/^\d{10}$/.test(normalized)) {
				contacts['+1' + normalized] = name;
			}
			// Store without +1 prefix too (if it has one)
			if (normalized.startsWith('+1') && normalized.length === 12) {
				contacts[normalized.slice(2)] = name;
			}
		}

		cachedContacts = contacts;
		cacheTimestamp = Date.now();

		return json({ status: 200, data: contacts });
	} catch {
		// AppleScript not available or Contacts permission denied
		return json({ status: 200, data: {} });
	}
};

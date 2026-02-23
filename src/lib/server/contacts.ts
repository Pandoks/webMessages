import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { normalizePhone, isPhoneNumber, formatPhone } from '$lib/utils/phone.js';
import type { Contact } from '$lib/types/index.js';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';

const execFileAsync = promisify(execFile);

/** In-memory contact cache: normalized identifier → display name */
let contactMap: Map<string, string> = new Map();
/** Photo cache: normalized identifier → { path, mime } */
let photoMap: Map<string, { path: string; mime: string }> = new Map();
let loaded = false;
let loading: Promise<boolean> | null = null;
let photosLoaded = false;

const PHOTO_CACHE_DIR = join(process.env.HOME ?? '', '.cache/webMessages/contact-photos');
const NICKNAME_CACHE_DIR = join(
	process.env.HOME ?? '',
	'Library/Messages/NickNameCache'
);

// Path to the compiled Swift photo exporter (in project root/scripts/)
const PHOTO_EXPORTER = join(process.cwd(), 'scripts/export-photos');

const APPLESCRIPT = `
tell application "Contacts"
	set output to ""
	set allPeople to every person
	repeat with p in allPeople
		set fullName to ""
		try
			set fn to first name of p
			if fn is not missing value then
				set fullName to (fn as text)
			end if
		end try
		try
			set ln to last name of p
			if ln is not missing value then
				if fullName is "" then
					set fullName to (ln as text)
				else
					set fullName to fullName & " " & (ln as text)
				end if
			end if
		end try
		if fullName is not "" then
			set phoneList to ""
			repeat with ph in phones of p
				set phoneList to phoneList & (value of ph as text) & ","
			end repeat
			set emailList to ""
			repeat with em in emails of p
				set emailList to emailList & (value of em as text) & ","
			end repeat
			set output to output & fullName & "|" & phoneList & "|" & emailList & linefeed
		end if
	end repeat
	return output
end tell
`;

export async function loadContacts(): Promise<boolean> {
	if (loaded) return true;
	if (loading) return loading;

	loading = (async () => {
		try {
			const { stdout } = await execFileAsync('osascript', ['-e', APPLESCRIPT], {
				timeout: 120000,
				maxBuffer: 10 * 1024 * 1024
			});

			const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
			contactMap = new Map();

			for (const line of lines) {
				const [name, phonesStr, emailsStr] = line.split('|');
				if (!name) continue;

				if (phonesStr) {
					for (const phone of phonesStr.split(',').filter((p) => p.trim())) {
						contactMap.set(normalizePhone(phone.trim()), name.trim());
					}
				}

				if (emailsStr) {
					for (const email of emailsStr.split(',').filter((e) => e.trim())) {
						contactMap.set(email.trim().toLowerCase(), name.trim());
					}
				}
			}

			loaded = true;
			console.log(`Loaded ${contactMap.size} contact identifiers`);
			return true;
		} catch (err) {
			console.error('Failed to load contacts:', err);
			loading = null; // Allow retry
			return false;
		}
	})();

	return loading;
}

/** Kick off contact + photo loading in the background. Safe to call multiple times. */
export function ensureContactsLoading(): void {
	loadContacts()
		.then((success) => {
			if (success) {
				exportContactPhotos().catch((err) =>
					console.error('Photo export error:', err)
				);
			}
		})
		.catch(() => {});
}

/** Wait for contacts to finish loading (with optional timeout). Returns true if contacts are available. */
export async function waitForContacts(timeoutMs = 0): Promise<boolean> {
	if (loaded) return true;
	if (!loading) return false;
	if (timeoutMs <= 0) return loading;
	return Promise.race([
		loading,
		new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs))
	]);
}

/** Check if contacts have been loaded */
export function contactsLoaded(): boolean {
	return loaded;
}

/**
 * Load iMessage shared profile photos from NickNameCache.
 * These are the photos people share via "Share Name and Photo" in iMessage.
 * Stored as PNG files at ~/Library/Messages/NickNameCache/{hash}-ad
 */
function loadNickNamePhotos(): number {
	if (!existsSync(NICKNAME_CACHE_DIR)) return 0;

	let count = 0;

	// Read from both handledNicknamesKeyStore and pendingNicknamesKeyStore
	for (const dbName of ['handledNicknamesKeyStore', 'pendingNicknamesKeyStore']) {
		const dbPath = join(NICKNAME_CACHE_DIR, `${dbName}.db`);
		if (!existsSync(dbPath)) continue;

		try {
			// Use sqlite3 CLI to extract key-value pairs (read-only)
			const result = execFileSync('sqlite3', [dbPath, 'SELECT key, value FROM kvtable'], {
				timeout: 5000,
				maxBuffer: 5 * 1024 * 1024
			});

			// Each row: key|value(binary). We need to extract the image path from the plist.
			// Since the value is binary, we'll use a different approach:
			// Extract keys, then decode each plist individually.
			const keysResult = execFileSync(
				'sqlite3',
				[dbPath, 'SELECT key FROM kvtable'],
				{ timeout: 5000 }
			);

			const keys = keysResult
				.toString()
				.split('\n')
				.filter((k) => k.trim());

			for (const key of keys) {
				try {
					// Write plist to temp file and decode
					const tmpPlist = `/tmp/webmsg_nn_${key.replace(/[^a-zA-Z0-9@.+]/g, '_')}.plist`;
					const tmpXml = tmpPlist + '.xml';

					execFileSync('sqlite3', [
						dbPath,
						`SELECT writefile('${tmpPlist}', value) FROM kvtable WHERE key='${key}'`
					], { timeout: 5000 });

					execFileSync('plutil', ['-convert', 'xml1', tmpPlist, '-o', tmpXml], {
						timeout: 5000
					});

					const xml = readFileSync(tmpXml, 'utf-8');

					// Find image path in the plist XML (NSKeyedArchiver format)
					const match = xml.match(
						/<string>(\/[^<]*NickNameCache\/[^<]*-ad)<\/string>/
					);
					if (!match) continue;

					const imgPath = match[1];
					if (!existsSync(imgPath)) continue;

					// Normalize the key (phone or email) and add to photoMap
					const identifier = key.trim();
					const entry = { path: imgPath, mime: 'image/png' };

					if (identifier.includes('@')) {
						photoMap.set(identifier.toLowerCase(), entry);
					} else if (isPhoneNumber(identifier)) {
						photoMap.set(normalizePhone(identifier), entry);
					}

					count++;
				} catch {
					// Skip entries that fail to decode
				}
			}
		} catch {
			// Skip databases that fail to read
		}
	}

	return count;
}

let photosLoading: Promise<void> | null = null;

/** Export contact photos. Loads iMessage NickNameCache photos + Apple Contacts photos. */
export async function exportContactPhotos(): Promise<void> {
	if (photosLoaded) return;
	if (photosLoading) return photosLoading;

	photosLoading = (async () => {
	photoMap = new Map();

	// 1. Load iMessage shared profile photos (NickNameCache) — fast, local PNGs
	const nicknameCount = loadNickNamePhotos();
	console.log(`Loaded ${nicknameCount} iMessage shared profile photos`);

	// 2. Load Apple Contacts photos via Swift helper — fills gaps
	try {
		mkdirSync(PHOTO_CACHE_DIR, { recursive: true });

		if (existsSync(PHOTO_EXPORTER)) {
			const { stdout } = await execFileAsync(PHOTO_EXPORTER, [PHOTO_CACHE_DIR], {
				timeout: 60000,
				maxBuffer: 10 * 1024 * 1024
			});

			const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
			let contactPhotoCount = 0;

			for (const line of lines) {
				const [sanitizedId, phonesStr, emailsStr] = line.split('|');
				if (!sanitizedId) continue;

				const photoPath = join(PHOTO_CACHE_DIR, `${sanitizedId}.jpeg`);
				if (!existsSync(photoPath)) continue;

				const entry = { path: photoPath, mime: 'image/jpeg' };

				// Only add if not already covered by NickNameCache
				if (phonesStr) {
					for (const phone of phonesStr.split(',').filter((p) => p.trim())) {
						const key = normalizePhone(phone.trim());
						if (!photoMap.has(key)) {
							photoMap.set(key, entry);
							contactPhotoCount++;
						}
					}
				}

				if (emailsStr) {
					for (const email of emailsStr.split(',').filter((e) => e.trim())) {
						const key = email.trim().toLowerCase();
						if (!photoMap.has(key)) {
							photoMap.set(key, entry);
							contactPhotoCount++;
						}
					}
				}
			}

			console.log(`Loaded ${contactPhotoCount} additional Apple Contacts photos`);
		}
	} catch (err) {
		console.error('Failed to export Apple Contacts photos:', err);
	}

	photosLoaded = true;
	console.log(`Total photo mappings: ${photoMap.size}`);
	})();

	return photosLoading;
}

/** Get the photo file path for an identifier, or null if no photo */
export function getContactPhotoPath(identifier: string): { path: string; mime: string } | null {
	if (!identifier || !photosLoaded) return null;

	// Try email match
	const emailMatch = photoMap.get(identifier.toLowerCase());
	if (emailMatch) return emailMatch;

	// Try phone match
	if (isPhoneNumber(identifier)) {
		const normalized = normalizePhone(identifier);
		const phoneMatch = photoMap.get(normalized);
		if (phoneMatch) return phoneMatch;
	}

	return null;
}

/** Read photo file data, or null if not found */
export async function getContactPhoto(
	identifier: string
): Promise<{ data: Buffer; mime: string } | null> {
	const info = getContactPhotoPath(identifier);
	if (!info) return null;

	try {
		if (!existsSync(info.path)) return null;
		const data = await readFile(info.path);
		return { data, mime: info.mime };
	} catch {
		return null;
	}
}

/** Resolve a handle identifier (phone/email) to a display name */
export function resolveContact(identifier: string): string {
	if (!identifier) return 'Unknown';

	const lower = identifier.toLowerCase();
	const emailMatch = contactMap.get(lower);
	if (emailMatch) return emailMatch;

	if (isPhoneNumber(identifier)) {
		const normalized = normalizePhone(identifier);
		const phoneMatch = contactMap.get(normalized);
		if (phoneMatch) return phoneMatch;
		// No contact found — format the phone number nicely
		return formatPhone(identifier);
	}

	return identifier;
}

/** Get all contacts as an array */
export function getAllContacts(): Contact[] {
	const byName = new Map<string, Contact>();

	for (const [key, name] of contactMap) {
		let contact = byName.get(name);
		if (!contact) {
			contact = { name, phones: [], emails: [] };
			byName.set(name, contact);
		}
		if (key.includes('@')) {
			contact.emails.push(key);
		} else {
			contact.phones.push(key);
		}
	}

	return Array.from(byName.values());
}

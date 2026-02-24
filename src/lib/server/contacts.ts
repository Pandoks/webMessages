import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { normalizePhone, isPhoneNumber, formatPhone } from '$lib/utils/phone.js';
import type { Contact } from '$lib/types/index.js';
import { existsSync, mkdirSync, readFileSync, statSync } from 'fs';
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
let contactsReadyBroadcasted = false;
let backgroundRefreshTimer: ReturnType<typeof setInterval> | null = null;
let refreshInFlight: Promise<void> | null = null;
let lastRefreshStartedAt = 0;

const CONTACT_REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const MIN_RETRY_INTERVAL_MS = 60 * 1000; // 1 minute

const PHOTO_CACHE_DIR = join(process.env.HOME ?? '', '.cache/webMessages/contact-photos');
const NICKNAME_CACHE_DIR = join(
	process.env.HOME ?? '',
	'Library/Messages/NickNameCache'
);

// Path to the compiled Swift photo exporter (in project root/scripts/)
const PHOTO_EXPORTER = join(process.cwd(), 'scripts/export-photos');
const PHOTO_EXPORTER_SOURCE = join(process.cwd(), 'scripts/export-photos.swift');

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

function contactMapsEqual(a: Map<string, string>, b: Map<string, string>): boolean {
	if (a.size !== b.size) return false;
	for (const [key, value] of a) {
		if (b.get(key) !== value) return false;
	}
	return true;
}

function photoMapsEqual(
	a: Map<string, { path: string; mime: string }>,
	b: Map<string, { path: string; mime: string }>
): boolean {
	if (a.size !== b.size) return false;
	for (const [key, value] of a) {
		const other = b.get(key);
		if (!other) return false;
		if (other.path !== value.path || other.mime !== value.mime) return false;
	}
	return true;
}

async function broadcastContactsReady(): Promise<void> {
	const { broadcast } = await import('./watcher.js');
	broadcast({ type: 'contacts_ready', data: {} });
}

function ensurePhotoExporterBuilt(): boolean {
	if (!existsSync(PHOTO_EXPORTER_SOURCE)) return false;

	let needsBuild = !existsSync(PHOTO_EXPORTER);
	if (!needsBuild) {
		try {
			const sourceMtime = statSync(PHOTO_EXPORTER_SOURCE).mtimeMs;
			const binaryMtime = statSync(PHOTO_EXPORTER).mtimeMs;
			needsBuild = sourceMtime > binaryMtime;
		} catch {
			needsBuild = true;
		}
	}

	if (!needsBuild) return true;

	try {
		execFileSync('swiftc', [PHOTO_EXPORTER_SOURCE, '-o', PHOTO_EXPORTER], {
			timeout: 60000
		});
		return true;
	} catch (err) {
		console.error('Failed to compile export-photos helper:', err);
		return existsSync(PHOTO_EXPORTER);
	}
}

export async function loadContacts(force = false): Promise<boolean> {
	if (!force && loaded) return true;
	if (loading) return loading;

	loading = (async () => {
		try {
			const { stdout } = await execFileAsync('osascript', ['-e', APPLESCRIPT], {
				timeout: 120000,
				maxBuffer: 10 * 1024 * 1024
			});

			const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
			const nextContactMap = new Map<string, string>();

			for (const line of lines) {
				const [name, phonesStr, emailsStr] = line.split('|');
				if (!name) continue;

				if (phonesStr) {
					for (const phone of phonesStr.split(',').filter((p) => p.trim())) {
						nextContactMap.set(normalizePhone(phone.trim()), name.trim());
					}
				}

				if (emailsStr) {
					for (const email of emailsStr.split(',').filter((e) => e.trim())) {
						nextContactMap.set(email.trim().toLowerCase(), name.trim());
					}
				}
			}

			const changed = !contactMapsEqual(contactMap, nextContactMap);
			contactMap = nextContactMap;
			loaded = true;
			if (changed) {
				console.log(`Loaded ${contactMap.size} contact identifiers`);
			} else if (force) {
				console.log(`Contacts unchanged (${contactMap.size} identifiers)`);
			}
			return true;
		} catch (err) {
			console.error('Failed to load contacts:', err);
			return false;
		} finally {
			loading = null; // Allow refreshes/retries later
		}
	})();

	return loading;
}

async function refreshContactsAndPhotos(force: boolean, source: 'request' | 'poll'): Promise<void> {
	const now = Date.now();
	const initialLoadPending = !loaded || !photosLoaded;

	if (
		source === 'request' &&
		initialLoadPending &&
		now - lastRefreshStartedAt < MIN_RETRY_INTERVAL_MS
	) {
		return;
	}

	if (refreshInFlight) {
		return refreshInFlight;
	}

	refreshInFlight = (async () => {
		lastRefreshStartedAt = Date.now();

		const previousContacts = new Map(contactMap);
		const previousPhotos = new Map(photoMap);

		const contactsOk = await loadContacts(force);
		if (!contactsOk) return;

		await exportContactPhotos(force);

		const contactsChanged = !contactMapsEqual(previousContacts, contactMap);
		const photosChanged = !photoMapsEqual(previousPhotos, photoMap);

		if (!contactsReadyBroadcasted) {
			await broadcastContactsReady();
			contactsReadyBroadcasted = true;
			return;
		}

		if (contactsChanged || photosChanged) {
			console.log(
				`[contacts] Refresh detected changes (contacts=${contactsChanged ? 'yes' : 'no'}, photos=${photosChanged ? 'yes' : 'no'})`
			);
			await broadcastContactsReady();
		}
	})().catch((err) => {
		console.error('Contacts/photo refresh error:', err);
	}).finally(() => {
		refreshInFlight = null;
	});

	return refreshInFlight;
}

function startBackgroundRefresh(): void {
	if (backgroundRefreshTimer) return;

	backgroundRefreshTimer = setInterval(() => {
		void refreshContactsAndPhotos(true, 'poll');
	}, CONTACT_REFRESH_INTERVAL_MS);

	if (typeof backgroundRefreshTimer.unref === 'function') {
		backgroundRefreshTimer.unref();
	}
}

/** Kick off contact + photo loading in the background. Safe to call multiple times. */
export function ensureContactsLoading(): void {
	startBackgroundRefresh();
	void refreshContactsAndPhotos(false, 'request');
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
function loadNickNamePhotos(targetMap: Map<string, { path: string; mime: string }>): number {
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
						targetMap.set(identifier.toLowerCase(), entry);
					} else if (isPhoneNumber(identifier)) {
						targetMap.set(normalizePhone(identifier), entry);
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
export async function exportContactPhotos(force = false): Promise<void> {
	if (!force && photosLoaded) return;
	if (photosLoading) return photosLoading;

	photosLoading = (async () => {
		const nextPhotoMap = new Map<string, { path: string; mime: string }>();

		// 1. Load iMessage shared profile photos (NickNameCache) — fast, local PNGs
		const nicknameCount = loadNickNamePhotos(nextPhotoMap);
		console.log(`Loaded ${nicknameCount} iMessage shared profile photos`);

		// 2. Load Apple Contacts photos via Swift helper — fills gaps
		try {
			mkdirSync(PHOTO_CACHE_DIR, { recursive: true });
			const exporterReady = ensurePhotoExporterBuilt();
			if (exporterReady && existsSync(PHOTO_EXPORTER)) {
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
							if (!nextPhotoMap.has(key)) {
								nextPhotoMap.set(key, entry);
								contactPhotoCount++;
							}
						}
					}

					if (emailsStr) {
						for (const email of emailsStr.split(',').filter((e) => e.trim())) {
							const key = email.trim().toLowerCase();
							if (!nextPhotoMap.has(key)) {
								nextPhotoMap.set(key, entry);
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

		const changed = !photoMapsEqual(photoMap, nextPhotoMap);
		photoMap = nextPhotoMap;
		photosLoaded = true;

		if (changed) {
			console.log(`Total photo mappings: ${photoMap.size}`);
		} else if (force) {
			console.log(`Contact photos unchanged (${photoMap.size} mappings)`);
		}
		})().finally(() => {
			photosLoading = null;
		});

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

export interface ContactMatch {
	name: string;
	identifier: string;
}

export interface ContactGroupMatch {
	name: string;
	identifiers: string[];
}

/** Find contact identifiers by display name query (exact > prefix > contains). */
export function findContactMatches(query: string, limit = 5): ContactMatch[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];

	const candidates: Array<{ score: number; name: string; identifier: string }> = [];
	const contacts = getAllContacts();
	for (const contact of contacts) {
		const name = contact.name.trim();
		if (!name) continue;
		const lower = name.toLowerCase();

		let score = 0;
		if (lower === q) score = 3;
		else if (lower.startsWith(q)) score = 2;
		else if (lower.includes(q)) score = 1;
		if (score === 0) continue;

		for (const phone of contact.phones) {
			if (!phone) continue;
			candidates.push({ score, name: contact.name, identifier: phone });
		}
		for (const email of contact.emails) {
			if (!email) continue;
			candidates.push({ score, name: contact.name, identifier: email });
		}
	}

	candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
	const unique: ContactMatch[] = [];
	const seen = new Set<string>();
	for (const item of candidates) {
		const key = item.identifier.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push({ name: item.name, identifier: item.identifier });
		if (unique.length >= limit) break;
	}

	return unique;
}

/** Find contacts by display name query (exact > prefix > contains), grouped by person. */
export function findContactGroupMatches(query: string, limit = 5): ContactGroupMatch[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];

	const candidates: Array<{ score: number; name: string; identifiers: string[] }> = [];
	const contacts = getAllContacts();
	for (const contact of contacts) {
		const name = contact.name.trim();
		if (!name) continue;
		const lower = name.toLowerCase();

		let score = 0;
		if (lower === q) score = 3;
		else if (lower.startsWith(q)) score = 2;
		else if (lower.includes(q)) score = 1;
		if (score === 0) continue;

		const identifiers = [...contact.phones, ...contact.emails].filter((v) => !!v);
		if (identifiers.length === 0) continue;
		candidates.push({ score, name: contact.name, identifiers });
	}

	candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
	return candidates.slice(0, limit).map((item) => ({
		name: item.name,
		identifiers: item.identifiers
	}));
}

/** Return all known identifiers for the same contact as this phone/email. */
export function getRelatedContactIdentifiers(identifier: string): string[] {
	const input = identifier.trim();
	if (!input) return [];

	const lower = input.toLowerCase();
	let name = contactMap.get(lower);
	if (!name && isPhoneNumber(input)) {
		name = contactMap.get(normalizePhone(input));
	}
	if (!name) return [input];

	const contact = getAllContacts().find((c) => c.name === name);
	if (!contact) return [input];

	const ids = [...contact.phones, ...contact.emails]
		.map((v) => v.trim())
		.filter((v) => !!v);
	if (ids.length === 0) return [input];

	const unique = Array.from(new Set(ids.map((v) => v.toLowerCase()))).map(
		(key) => ids.find((v) => v.toLowerCase() === key)!
	);
	if (!unique.some((v) => v.toLowerCase() === lower)) unique.push(input);
	return unique;
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';

const execFileAsync = promisify(execFile);

const AB_DIR = join(homedir(), 'Library', 'Application Support', 'AddressBook');

interface ContactsResult {
	data: Record<string, string>;
	photos: Record<string, string>;
}

let cache: ContactsResult | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60_000; // 60 seconds

function findDatabases(): string[] {
	const sourcesDir = join(AB_DIR, 'Sources');
	try {
		return readdirSync(sourcesDir, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => join(sourcesDir, d.name, 'AddressBook-v22.abcddb'));
	} catch {
		return [];
	}
}

function normalizeAddress(addr: string): string {
	return addr.replace(/[\s\-()]/g, '').toLowerCase();
}

async function queryDb(dbPath: string): Promise<ContactsResult> {
	const data: Record<string, string> = {};
	const photos: Record<string, string> = {};

	// Query 1: Names + phone numbers
	const namesQuery = `
SELECT
  COALESCE(NULLIF(r.ZNICKNAME, ''),
    TRIM(COALESCE(r.ZFIRSTNAME, '') || ' ' || COALESCE(r.ZLASTNAME, '')))
  , p.ZFULLNUMBER
FROM ZABCDRECORD r
JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK
WHERE r.Z_ENT = 22

UNION ALL

SELECT
  COALESCE(NULLIF(r.ZNICKNAME, ''),
    TRIM(COALESCE(r.ZFIRSTNAME, '') || ' ' || COALESCE(r.ZLASTNAME, '')))
  , e.ZADDRESS
FROM ZABCDRECORD r
JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.Z_PK
WHERE r.Z_ENT = 22;`;

	try {
		const { stdout } = await execFileAsync('sqlite3', ['-separator', '\t', dbPath, namesQuery], {
			timeout: 10_000,
			maxBuffer: 10 * 1024 * 1024
		});

		for (const line of stdout.split('\n')) {
			const [name, addr] = line.split('\t');
			if (!name?.trim() || !addr?.trim()) continue;

			const normalized = normalizeAddress(addr);
			data[normalized] = name;

			// US phone number variants
			if (/^\d{10}$/.test(normalized)) {
				data['+1' + normalized] = name;
				data['1' + normalized] = name;
			}
			if (normalized.startsWith('+1') && normalized.length === 12) {
				data[normalized.slice(2)] = name;
				data[normalized.slice(1)] = name;
			}
			if (/^1\d{10}$/.test(normalized)) {
				data['+' + normalized] = name;
				data[normalized.slice(1)] = name;
			}
		}
	} catch {
		// Database not readable
	}

	// Query 2: Photos — inline thumbnails (01 prefix) or fall back to ZIMAGEDATA
	const photosQuery = `
SELECT
  COALESCE(NULLIF(r.ZNICKNAME, ''),
    TRIM(COALESCE(r.ZFIRSTNAME, '') || ' ' || COALESCE(r.ZLASTNAME, '')))
  , p.ZFULLNUMBER
  , CASE
      WHEN HEX(SUBSTR(r.ZTHUMBNAILIMAGEDATA, 1, 1)) = '01'
        THEN 'thumb'
      WHEN HEX(SUBSTR(r.ZIMAGEDATA, 1, 1)) = '01'
        THEN 'full'
      ELSE NULL
    END as img_source
  , CASE
      WHEN HEX(SUBSTR(r.ZTHUMBNAILIMAGEDATA, 1, 1)) = '01'
        THEN HEX(SUBSTR(r.ZTHUMBNAILIMAGEDATA, 2))
      WHEN HEX(SUBSTR(r.ZIMAGEDATA, 1, 1)) = '01'
        THEN HEX(SUBSTR(r.ZIMAGEDATA, 2))
      ELSE NULL
    END as img_hex
FROM ZABCDRECORD r
JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK
WHERE r.Z_ENT = 22
  AND r.ZTHUMBNAILIMAGEDATA IS NOT NULL;`;

	try {
		const { stdout } = await execFileAsync('sqlite3', ['-separator', '\t', dbPath, photosQuery], {
			timeout: 15_000,
			maxBuffer: 50 * 1024 * 1024
		});

		for (const line of stdout.split('\n')) {
			const parts = line.split('\t');
			if (parts.length < 4) continue;
			const [, addr, imgSource, imgHex] = parts;
			if (!addr?.trim() || !imgSource || !imgHex) continue;

			const normalized = normalizeAddress(addr);
			const base64 = Buffer.from(imgHex, 'hex').toString('base64');
			photos[normalized] = base64;

			if (/^\d{10}$/.test(normalized)) {
				photos['+1' + normalized] = base64;
				photos['1' + normalized] = base64;
			}
			if (normalized.startsWith('+1') && normalized.length === 12) {
				photos[normalized.slice(2)] = base64;
				photos[normalized.slice(1)] = base64;
			}
			if (/^1\d{10}$/.test(normalized)) {
				photos['+' + normalized] = base64;
				photos[normalized.slice(1)] = base64;
			}
		}
	} catch {
		// Photos query failed — names still work
	}

	return { data, photos };
}

export async function loadContacts(): Promise<ContactsResult> {
	if (cache && Date.now() - cacheTimestamp < CACHE_TTL) {
		return cache;
	}

	const dbs = findDatabases();
	const merged: ContactsResult = { data: {}, photos: {} };

	for (const dbPath of dbs) {
		const result = await queryDb(dbPath);
		Object.assign(merged.data, result.data);
		Object.assign(merged.photos, result.photos);
	}

	cache = merged;
	cacheTimestamp = Date.now();
	return merged;
}

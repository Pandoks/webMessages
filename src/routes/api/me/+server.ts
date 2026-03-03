import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

const AB_DIR = join(homedir(), 'Library', 'Application Support', 'AddressBook');

let cached: { name: string; photoBase64: string | null } | null = null;

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

// Returns name, and the external data UUID for the thumbnail (if any)
const ME_QUERY = `
SELECT
  COALESCE(NULLIF(ZNICKNAME, ''),
    TRIM(COALESCE(ZFIRSTNAME, '') || ' ' || COALESCE(ZLASTNAME, '')))
  , CASE
      WHEN HEX(SUBSTR(ZTHUMBNAILIMAGEDATA, 1, 1)) = '02'
        THEN SUBSTR(HEX(SUBSTR(ZTHUMBNAILIMAGEDATA, 2)), 1, LENGTH(HEX(SUBSTR(ZTHUMBNAILIMAGEDATA, 2))) - 2)
      WHEN HEX(SUBSTR(ZIMAGEDATA, 1, 1)) = '02'
        THEN SUBSTR(HEX(SUBSTR(ZIMAGEDATA, 2)), 1, LENGTH(HEX(SUBSTR(ZIMAGEDATA, 2))) - 2)
      ELSE NULL
    END
FROM ZABCDRECORD
WHERE Z_ENT = 22 AND ZCONTAINERWHERECONTACTISME IS NOT NULL
LIMIT 1;`;

function hexToAscii(hex: string): string {
	let str = '';
	for (let i = 0; i < hex.length; i += 2) {
		str += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16));
	}
	return str;
}

export const GET: RequestHandler = async () => {
	if (cached) return json(cached);

	try {
		for (const dbPath of findDatabases()) {
			const { stdout } = await execFileAsync('sqlite3', ['-separator', '\t', dbPath, ME_QUERY], {
				timeout: 5000
			});
			const [name, imgRefHex] = stdout.trim().split('\t');
			if (!name) continue;

			let photoBase64: string | null = null;
			if (imgRefHex) {
				const externalId = hexToAscii(imgRefHex);
				const externalDir = dbPath.replace(
					'AddressBook-v22.abcddb',
					'.AddressBook-v22_SUPPORT/_EXTERNAL_DATA'
				);
				try {
					const buf = readFileSync(join(externalDir, externalId));
					photoBase64 = buf.toString('base64');
				} catch {
					// external file not found
				}
			}

			cached = { name, photoBase64 };
			return json(cached);
		}
	} catch {
		// fall through
	}

	cached = { name: 'Me', photoBase64: null };
	return json(cached);
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

let cached: { name: string; photoBase64: string | null } | null = null;

export const GET: RequestHandler = async () => {
	if (cached) return json(cached);

	try {
		const { stdout: name } = await execFileAsync('osascript', [
			'-e',
			'tell application "Contacts" to get name of my card'
		]);

		const { stdout: cardId } = await execFileAsync('osascript', [
			'-e',
			'tell application "Contacts" to get id of my card'
		]);

		let photoBase64: string | null = null;
		const id = cardId.trim().replace(/:/g, '_');
		if (id) {
			const photoPath = join(homedir(), '.cache/webMessages/contact-photos', `${id}.jpeg`);
			try {
				const buf = await readFile(photoPath);
				photoBase64 = buf.toString('base64');
			} catch {
				// no cached photo
			}
		}

		cached = { name: name.trim(), photoBase64 };
		return json(cached);
	} catch {
		return json({ name: 'Me', photoBase64: null });
	}
};

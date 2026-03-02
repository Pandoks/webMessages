import { json } from '@sveltejs/kit';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import type { RequestHandler } from './$types.js';
import { PINNED_CHATS } from '$lib/server/env.js';

export const GET: RequestHandler = async () => {
	const binaryPath = PINNED_CHATS;

	if (!existsSync(binaryPath)) {
		return json({ status: 200, data: [] });
	}

	try {
		const result = execFileSync(binaryPath, { timeout: 5000 });
		const pinned: string[] = JSON.parse(result.toString().trim());
		return json({ status: 200, data: pinned });
	} catch {
		return json({ status: 200, data: [] });
	}
};

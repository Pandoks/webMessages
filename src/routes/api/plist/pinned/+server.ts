import { json } from '@sveltejs/kit';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async () => {
	// Use compiled Swift binary that reads pinned conversations from IMCore's local store
	const binaryPath = join(process.cwd(), 'src', 'lib', 'server', 'pinned-chats');

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

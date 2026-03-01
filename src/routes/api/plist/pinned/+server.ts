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

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ status: 400, error: 'Invalid JSON body' }, { status: 400 });
	}

	if (
		typeof body !== 'object' ||
		body === null ||
		typeof (body as Record<string, unknown>).chatIdentifier !== 'string' ||
		typeof (body as Record<string, unknown>).pinned !== 'boolean'
	) {
		return json(
			{ status: 400, error: 'Body must contain { chatIdentifier: string, pinned: boolean }' },
			{ status: 400 }
		);
	}

	const { chatIdentifier, pinned } = body as { chatIdentifier: string; pinned: boolean };

	const binaryPath = join(process.cwd(), 'src', 'lib', 'server', 'pin-chat');

	if (!existsSync(binaryPath)) {
		return json(
			{ status: 500, error: 'pin-chat binary not found. Compile it first.' },
			{ status: 500 }
		);
	}

	try {
		execFileSync(binaryPath, [chatIdentifier, pinned ? 'pin' : 'unpin'], { timeout: 5000 });
		return json({ status: 200, data: { ok: true } });
	} catch (err) {
		const message =
			err instanceof Error ? err.message : 'pin-chat binary failed with unknown error';
		return json({ status: 500, error: message }, { status: 500 });
	}
};

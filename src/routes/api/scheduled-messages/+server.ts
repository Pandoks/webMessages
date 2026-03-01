import { json } from '@sveltejs/kit';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type { RequestHandler } from './$types.js';

const execFileAsync = promisify(execFile);
const BRIDGE = resolve('src/lib/server/imcore-bridge');

async function runBridge(
	args: string[],
	timeout = 15_000
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
	try {
		const { stdout } = await execFileAsync(BRIDGE, args, { timeout });
		return JSON.parse(stdout);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, error: msg };
	}
}

export const GET: RequestHandler = async ({ url }) => {
	const chatGuid = url.searchParams.get('chatGuid');
	const args = chatGuid ? ['list', chatGuid] : ['list-all'];
	const result = await runBridge(args);

	if (!result.ok) {
		return json({ status: 200, data: [] });
	}
	return json({ status: 200, data: result.data });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { chatGuid, message, scheduledAt } = body;

	if (!chatGuid || typeof chatGuid !== 'string') {
		return json({ status: 400, message: 'chatGuid is required' }, { status: 400 });
	}
	if (!message || typeof message !== 'string' || !message.trim()) {
		return json({ status: 400, message: 'message is required and must be non-empty' }, { status: 400 });
	}
	if (typeof scheduledAt !== 'number' || scheduledAt <= Date.now()) {
		return json(
			{ status: 400, message: 'scheduledAt must be a future Unix timestamp in ms' },
			{ status: 400 }
		);
	}

	const result = await runBridge([
		'schedule',
		chatGuid,
		message.trim(),
		String(scheduledAt)
	]);

	if (!result.ok) {
		return json({ status: 500, message: result.error }, { status: 500 });
	}
	return json({ status: 201, data: result.data }, { status: 201 });
};

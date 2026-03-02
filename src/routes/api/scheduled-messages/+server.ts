import { json } from '@sveltejs/kit';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RequestHandler } from './$types.js';
import type { ScheduledMessage } from '$lib/types/index.js';
import { IMCORE_BRIDGE } from '$lib/server/env.js';

const execFileAsync = promisify(execFile);
const BRIDGE = IMCORE_BRIDGE;

async function runBridge(args: string[], timeout = 15_000): Promise<unknown> {
	const { stdout } = await execFileAsync(BRIDGE, args, { timeout });
	const result = JSON.parse(stdout);
	if (!result.ok) throw new Error(result.error ?? 'Bridge command failed');
	return result.data;
}

export const GET: RequestHandler = async ({ url }) => {
	const chatGuid = url.searchParams.get('chatGuid') ?? undefined;

	try {
		const args = chatGuid ? ['list', chatGuid] : ['list-all'];
		const data = (await runBridge(args)) as ScheduledMessage[];
		return json({ status: 200, data });
	} catch {
		return json({ status: 200, data: [] });
	}
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

	try {
		const data = await runBridge([
			'schedule',
			chatGuid,
			message.trim(),
			String(scheduledAt)
		]);
		return json({ status: 201, data }, { status: 201 });
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to schedule message';
		return json({ status: 500, message: msg }, { status: 500 });
	}
};

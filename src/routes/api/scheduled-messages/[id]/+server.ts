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

export const PUT: RequestHandler = async ({ params, request }) => {
	const body = await request.json();
	const { chatGuid, message, scheduledAt } = body;

	if (!chatGuid || typeof chatGuid !== 'string') {
		return json({ status: 400, message: 'chatGuid is required' }, { status: 400 });
	}

	// Edit text if provided
	if (message !== undefined) {
		if (typeof message !== 'string' || !message.trim()) {
			return json({ status: 400, message: 'message must be non-empty' }, { status: 400 });
		}
		const result = await runBridge(['edit-text', params.id, chatGuid, message.trim()]);
		if (!result.ok) {
			return json({ status: 500, message: result.error }, { status: 500 });
		}
	}

	// Edit time if provided
	if (scheduledAt !== undefined) {
		if (typeof scheduledAt !== 'number' || scheduledAt <= Date.now()) {
			return json({ status: 400, message: 'scheduledAt must be a future timestamp' }, { status: 400 });
		}
		const result = await runBridge(['edit-time', params.id, chatGuid, String(scheduledAt)]);
		if (!result.ok) {
			return json({ status: 500, message: result.error }, { status: 500 });
		}
	}

	return json({ status: 200, data: { guid: params.id } });
};

export const DELETE: RequestHandler = async ({ params, url }) => {
	const chatGuid = url.searchParams.get('chatGuid');

	if (!chatGuid) {
		return json({ status: 400, message: 'chatGuid query param is required' }, { status: 400 });
	}

	const result = await runBridge(['cancel', params.id, chatGuid]);

	if (!result.ok) {
		return json({ status: 500, message: result.error }, { status: 500 });
	}
	return json({ status: 200, data: null });
};

import { json } from '@sveltejs/kit';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RequestHandler } from './$types.js';
import { IMCORE_BRIDGE } from '$lib/server/env.js';

const execFileAsync = promisify(execFile);
const BRIDGE = IMCORE_BRIDGE;

async function runBridge(args: string[], timeout = 15_000): Promise<unknown> {
	const { stdout } = await execFileAsync(BRIDGE, args, { timeout });
	const result = JSON.parse(stdout);
	if (!result.ok) throw new Error(result.error ?? 'Bridge command failed');
	return result.data;
}

export const PUT: RequestHandler = async ({ params, request }) => {
	const body = await request.json();
	const { chatGuid, message, scheduledAt } = body;

	if (!chatGuid || typeof chatGuid !== 'string') {
		return json({ status: 400, message: 'chatGuid is required' }, { status: 400 });
	}

	try {
		if (message !== undefined) {
			if (typeof message !== 'string' || !message.trim()) {
				return json({ status: 400, message: 'message must be non-empty' }, { status: 400 });
			}
			await runBridge(['edit-text', params.id, chatGuid, message.trim()]);
		}
		if (scheduledAt !== undefined) {
			if (typeof scheduledAt !== 'number' || scheduledAt <= Date.now()) {
				return json(
					{ status: 400, message: 'scheduledAt must be a future timestamp' },
					{ status: 400 }
				);
			}
			await runBridge(['edit-time', params.id, chatGuid, String(scheduledAt)]);
		}
		return json({ status: 200 });
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to edit scheduled message';
		return json({ status: 500, message: msg }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params, url }) => {
	const chatGuid = url.searchParams.get('chatGuid');

	if (!chatGuid) {
		return json({ status: 400, message: 'chatGuid query param is required' }, { status: 400 });
	}

	try {
		await runBridge(['cancel', params.id, chatGuid]);
		return json({ status: 200, data: null });
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to cancel scheduled message';
		return json({ status: 500, message: msg }, { status: 500 });
	}
};

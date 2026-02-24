import { writeFile, readFile, unlink, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';

const CMD_PATH = join(homedir(), '.webmessages-cmd.json');
const RESP_PATH = join(homedir(), '.webmessages-resp.json');
const POLL_INTERVAL = 100;
const DEFAULT_TIMEOUT = 8000;
const REPLY_TIMEOUT = 15000;
const MARK_READ_TIMEOUT = 15000;

// Promise queue to serialize commands
let commandQueue = Promise.resolve<unknown>(undefined);

interface IMCoreCommand {
	id: string;
	action: string;
	chatGuid: string;
	messageGuid?: string;
	reactionType?: number;
	text?: string;
	partIndex?: number;
}

interface IMCoreResponse {
	id: string;
	success: boolean;
	error?: string;
	[key: string]: unknown;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendCommand(command: IMCoreCommand, timeoutMs = DEFAULT_TIMEOUT): Promise<IMCoreResponse> {
	// Clear stale response from a previous crashed/aborted bridge run.
	await unlink(RESP_PATH).catch(() => {});

	// Atomic write: write to tmp, then rename
	const tmpPath = CMD_PATH + '.tmp';
	await writeFile(tmpPath, JSON.stringify(command));
	await rename(tmpPath, CMD_PATH);

	// Poll for response
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		await sleep(POLL_INTERVAL);

		if (!existsSync(RESP_PATH)) continue;

		try {
			const data = await readFile(RESP_PATH, 'utf-8');
			const response: IMCoreResponse = JSON.parse(data);

			if (response.id === command.id) {
				await unlink(RESP_PATH).catch(() => {});
				return response;
			}
		} catch {
			// File might be partially written, retry
		}
	}

	throw new Error('IMCore bridge timeout - no response received');
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
	const result = commandQueue.then(fn);
	commandQueue = result.catch(() => {});
	return result;
}

export async function sendReaction(
	chatGuid: string,
	messageGuid: string,
	reactionType: number,
	partIndex?: number
): Promise<void> {
	const response = await enqueue(() =>
		sendCommand({
			id: randomUUID(),
			action: 'react',
			chatGuid,
			messageGuid,
			reactionType,
			partIndex: partIndex ?? 0
		})
	);

	if (!response.success) {
		throw new Error(response.error ?? 'Failed to send reaction');
	}
}

export async function sendUnsend(
	chatGuid: string,
	messageGuid: string
): Promise<void> {
	const response = await enqueue(() =>
		sendCommand({
			id: randomUUID(),
			action: 'unsend',
			chatGuid,
			messageGuid
		})
	);

	if (!response.success) {
		throw new Error(response.error ?? 'Failed to unsend message');
	}
}

export async function debugUnsend(
	chatGuid: string,
	messageGuid: string,
	partIndex?: number
): Promise<IMCoreResponse> {
	return enqueue(() =>
		sendCommand({
			id: randomUUID(),
			action: 'debug_unsend',
			chatGuid,
			messageGuid,
			partIndex: partIndex ?? 0
		})
	);
}

export async function sendReply(
	chatGuid: string,
	messageGuid: string,
	text: string,
	partIndex?: number
): Promise<void> {
	const response = await enqueue(() =>
		sendCommand(
			{
				id: randomUUID(),
				action: 'reply',
				chatGuid,
				messageGuid,
				text,
				partIndex: partIndex ?? 0
			},
			REPLY_TIMEOUT
		)
	);

	if (!response.success) {
		throw new Error(response.error ?? 'Failed to send reply');
	}
}

export async function sendEdit(
	chatGuid: string,
	messageGuid: string,
	text: string,
	partIndex?: number
): Promise<void> {
	const response = await enqueue(() =>
		sendCommand({
			id: randomUUID(),
			action: 'edit',
			chatGuid,
			messageGuid,
			text,
			partIndex: partIndex ?? 0
		})
	);

	if (!response.success) {
		throw new Error(response.error ?? 'Failed to edit message');
	}
}

export async function markAsRead(chatGuid: string): Promise<void> {
	const response = await enqueue(async () => {
		try {
			return await sendCommand(
				{
					id: randomUUID(),
					action: 'mark_read',
					chatGuid
				},
				MARK_READ_TIMEOUT
			);
		} catch (err) {
			// Bridge can be briefly unavailable during restart/hot-reload.
			// Retry once before failing.
			await sleep(250);
			return sendCommand(
				{
					id: randomUUID(),
					action: 'mark_read',
					chatGuid
				},
				MARK_READ_TIMEOUT
			);
		}
	});

	if (!response.success) {
		throw new Error(response.error ?? 'Failed to mark as read');
	}
}

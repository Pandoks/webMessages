import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT = 10000;

function quoted(value: string): string {
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function runAppleScript(script: string, timeout = DEFAULT_TIMEOUT): Promise<unknown> {
	return execFileAsync('osascript', ['-e', script], { timeout });
}

/**
 * Send a text message via AppleScript.
 * Works for both 1:1 and existing group chats.
 */
export async function sendMessage(chatGuid: string, text: string): Promise<void> {
	const script = `
		tell application "Messages"
			set targetChat to a reference to chat id ${quoted(chatGuid)}
			send ${quoted(text)} to targetChat
		end tell
	`;

	await runAppleScript(script);
}

/**
 * Send a text message to a specific handle (phone/email).
 * For new 1:1 conversations.
 */
export async function sendMessageToHandle(
	handle: string,
	text: string,
	service: 'iMessage' | 'SMS' = 'iMessage'
): Promise<void> {
	const script = `
		tell application "Messages"
			set targetService to 1st account whose service type = ${service}
			set targetBuddy to participant ${quoted(handle)} of targetService
			send ${quoted(text)} to targetBuddy
		end tell
	`;

	await runAppleScript(script);
}

/**
 * Send a file attachment via AppleScript.
 */
export async function sendAttachment(chatGuid: string, filePath: string): Promise<void> {
	const script = `
		tell application "Messages"
			set targetChat to a reference to chat id ${quoted(chatGuid)}
			set theAttachment to POSIX file ${quoted(filePath)}
			send theAttachment to targetChat
		end tell
	`;

	await runAppleScript(script, 30000);
}

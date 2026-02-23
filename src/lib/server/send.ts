import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Send a text message via AppleScript.
 * Works for both 1:1 and existing group chats.
 */
export async function sendMessage(chatGuid: string, text: string): Promise<void> {
	// Escape text for AppleScript
	const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

	const script = `
		tell application "Messages"
			set targetChat to a reference to chat id "${chatGuid}"
			send "${escaped}" to targetChat
		end tell
	`;

	await execFileAsync('osascript', ['-e', script], { timeout: 10000 });
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
	const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

	const script = `
		tell application "Messages"
			set targetService to 1st account whose service type = ${service}
			set targetBuddy to participant "${handle}" of targetService
			send "${escaped}" to targetBuddy
		end tell
	`;

	await execFileAsync('osascript', ['-e', script], { timeout: 10000 });
}

/**
 * Send a file attachment via AppleScript.
 */
export async function sendAttachment(chatGuid: string, filePath: string): Promise<void> {
	const script = `
		tell application "Messages"
			set targetChat to a reference to chat id "${chatGuid}"
			set theAttachment to POSIX file "${filePath}"
			send theAttachment to targetChat
		end tell
	`;

	await execFileAsync('osascript', ['-e', script], { timeout: 30000 });
}

import { writeFile, readFile, unlink, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const CMD_PATH = join(homedir(), '.webmessages-cmd.json');
const RESP_PATH = join(homedir(), '.webmessages-resp.json');
const POLL_INTERVAL = 100;
const DEFAULT_TIMEOUT = 8000;
const REPLY_TIMEOUT = 15000;
const MARK_READ_TIMEOUT = 15000;
const BRIDGE_BIN_NAME = 'imcore-bridge';
const BRIDGE_HEALTH_CHECK_INTERVAL = 1000;
const execFileAsync = promisify(execFile);

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
  scheduledForMs?: number;
}

interface IMCoreResponse {
  id: string;
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

interface SendCheckedOptions {
  timeoutMs?: number;
  errorMessage: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureBridgeRunning(): Promise<void> {
  if (!(await isBridgeRunning())) {
    throw new Error(
      `IMCore bridge is not running. Start it with ./scripts/server/start-messages.sh`
    );
  }
}

async function isBridgeRunning(): Promise<boolean> {
  try {
    // macOS-only project: pgrep is available and gives a fast process existence check.
    await execFileAsync('pgrep', ['-x', BRIDGE_BIN_NAME], { timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

async function sendCommand(
  command: IMCoreCommand,
  timeoutMs = DEFAULT_TIMEOUT
): Promise<IMCoreResponse> {
  await ensureBridgeRunning();

  // Clear stale response from a previous crashed/aborted bridge run.
  await unlink(RESP_PATH).catch(() => {});

  // Atomic write: write to tmp, then rename
  const tmpPath = CMD_PATH + '.tmp';
  await writeFile(tmpPath, JSON.stringify(command));
  await rename(tmpPath, CMD_PATH);

  // Poll for response
  const deadline = Date.now() + timeoutMs;
  let nextBridgeHealthCheck = Date.now() + BRIDGE_HEALTH_CHECK_INTERVAL;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL);

    if (existsSync(RESP_PATH)) {
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

    const now = Date.now();
    if (now >= nextBridgeHealthCheck) {
      if (!(await isBridgeRunning())) {
        throw new Error(
          'IMCore bridge exited while waiting for response. Start it with ./scripts/server/start-messages.sh'
        );
      }
      nextBridgeHealthCheck = now + BRIDGE_HEALTH_CHECK_INTERVAL;
    }
  }

  throw new Error('IMCore bridge timeout - no response received');
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = commandQueue.then(fn);
  commandQueue = result.catch(() => {});
  return result;
}

function createCommand(
  action: string,
  chatGuid: string,
  extra: Omit<Partial<IMCoreCommand>, 'id' | 'action' | 'chatGuid'> = {}
): Omit<IMCoreCommand, 'id'> {
  return {
    action,
    chatGuid,
    ...extra
  };
}

async function sendChecked(
  command: Omit<IMCoreCommand, 'id'>,
  { timeoutMs = DEFAULT_TIMEOUT, errorMessage }: SendCheckedOptions
): Promise<IMCoreResponse> {
  const response = await enqueue(() => sendCommand({ id: randomUUID(), ...command }, timeoutMs));
  if (!response.success) {
    throw new Error(response.error ?? errorMessage);
  }
  return response;
}

export async function sendReaction(
  chatGuid: string,
  messageGuid: string,
  reactionType: number,
  partIndex?: number
): Promise<void> {
  await sendChecked(
    createCommand('react', chatGuid, {
      messageGuid,
      reactionType,
      partIndex: partIndex ?? 0
    }),
    { errorMessage: 'Failed to send reaction' }
  );
}

export async function sendUnsend(chatGuid: string, messageGuid: string): Promise<void> {
  await sendChecked(createCommand('unsend', chatGuid, { messageGuid }), {
    errorMessage: 'Failed to unsend message'
  });
}

export async function debugUnsend(
  chatGuid: string,
  messageGuid: string,
  partIndex?: number
): Promise<IMCoreResponse> {
  return enqueue(() =>
    sendCommand({
      id: randomUUID(),
      ...createCommand('debug_unsend', chatGuid, {
        messageGuid,
        partIndex: partIndex ?? 0
      })
    })
  );
}

export async function sendReply(
  chatGuid: string,
  messageGuid: string,
  text: string,
  partIndex?: number
): Promise<void> {
  await sendChecked(
    createCommand('reply', chatGuid, {
      messageGuid,
      text,
      partIndex: partIndex ?? 0
    }),
    {
      timeoutMs: REPLY_TIMEOUT,
      errorMessage: 'Failed to send reply'
    }
  );
}

export async function sendEdit(
  chatGuid: string,
  messageGuid: string,
  text: string,
  partIndex?: number
): Promise<void> {
  await sendChecked(
    createCommand('edit', chatGuid, {
      messageGuid,
      text,
      partIndex: partIndex ?? 0
    }),
    { errorMessage: 'Failed to edit message' }
  );
}

export async function sendEditScheduled(
  chatGuid: string,
  messageGuid: string,
  options: {
    text?: string;
    partIndex?: number;
    scheduledForMs?: number;
  }
): Promise<void> {
  await sendChecked(
    createCommand('edit_scheduled', chatGuid, {
      messageGuid,
      text: options.text,
      partIndex: options.partIndex ?? 0,
      scheduledForMs: options.scheduledForMs
    }),
    {
      timeoutMs: REPLY_TIMEOUT,
      errorMessage: 'Failed to edit scheduled message'
    }
  );
}

export async function markAsRead(chatGuid: string): Promise<void> {
  const createMarkReadCommand = () => createCommand('mark_read', chatGuid);

  const response = await enqueue(async () => {
    try {
      return await sendCommand({ id: randomUUID(), ...createMarkReadCommand() }, MARK_READ_TIMEOUT);
    } catch (err) {
      if (err instanceof Error && !err.message.includes('timeout - no response received')) {
        throw err;
      }
      // Bridge can be briefly unavailable during restart/hot-reload.
      // Retry once before failing.
      await sleep(250);
      return sendCommand({ id: randomUUID(), ...createMarkReadCommand() }, MARK_READ_TIMEOUT);
    }
  });

  if (!response.success) {
    throw new Error(response.error ?? 'Failed to mark as read');
  }
}

export async function sendScheduledMessage(
  chatGuid: string,
  text: string,
  scheduledForMs: number
): Promise<void> {
  await sendChecked(
    createCommand('send_scheduled', chatGuid, {
      text,
      scheduledForMs
    }),
    {
      timeoutMs: REPLY_TIMEOUT,
      errorMessage: 'Failed to schedule message'
    }
  );
}

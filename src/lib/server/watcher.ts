import { getNewMessages, getMaxMessageRowId } from './queries/messages.js';
import { getChatReadSnapshots } from './queries/chats.js';
import { getAttachmentsByMessage } from './queries/attachments.js';
import { resolveContact } from './contacts.js';
import { reactionEmoji } from '$lib/utils/reactions.js';

type SSEClient = {
  id: string;
  controller: ReadableStreamDefaultController;
};

const clients: Set<SSEClient> = new Set();
let lastRowId = 0;
let lastChatReadSnapshot = new Map<number, number>();
let pollInterval: ReturnType<typeof setInterval> | null = null;

function collectChangedReadChats(): number[] {
  const snapshots = getChatReadSnapshots();
  const next = new Map<number, number>();
  for (const snapshot of snapshots) {
    next.set(snapshot.chatId, snapshot.lastReadTimestamp);
  }

  const changed: number[] = [];
  for (const [chatId, lastRead] of next.entries()) {
    if (lastChatReadSnapshot.get(chatId) !== lastRead) {
      changed.push(chatId);
    }
  }
  for (const chatId of lastChatReadSnapshot.keys()) {
    if (!next.has(chatId)) {
      changed.push(chatId);
    }
  }

  lastChatReadSnapshot = next;
  return changed;
}

/** Start the database watcher (polls every 2s) */
export function startWatcher(): void {
  if (pollInterval) return;

  lastRowId = getMaxMessageRowId();
  lastChatReadSnapshot = new Map(
    getChatReadSnapshots().map((snapshot) => [snapshot.chatId, snapshot.lastReadTimestamp])
  );
  console.log(`Watcher started, last ROWID: ${lastRowId}`);

  pollInterval = setInterval(() => {
    try {
      const newMessages = getNewMessages(lastRowId);
      if (newMessages.length > 0) {
        // Update lastRowId
        const maxRowId = Math.max(...newMessages.map((m) => m.message.rowid));
        lastRowId = maxRowId;

        // Enrich messages before broadcasting
        for (const entry of newMessages) {
          const msg = entry.message;

          // Resolve sender name
          if (msg.is_from_me) {
            msg.sender = 'Me';
          } else if (msg.sender) {
            msg.sender = resolveContact(msg.sender);
          }

          // Attach attachments
          if (msg.cache_has_attachments) {
            msg.attachments = getAttachmentsByMessage(msg.rowid);
          }

          // Populate emoji for reaction messages
          if (msg.associated_message_type >= 2000 && msg.associated_message_type <= 3006) {
            if (!msg.associated_message_emoji) {
              msg.associated_message_emoji = reactionEmoji(msg.associated_message_type) ?? null;
            }
          }
        }
        // Broadcast to all SSE clients
        broadcast({
          type: 'new_messages',
          data: newMessages
        });
      }

      const changedReadChats = collectChangedReadChats();
      if (changedReadChats.length > 0) {
        broadcast({
          type: 'chat_read_state',
          data: { chatIds: changedReadChats }
        });
      }
    } catch (err) {
      console.error('Watcher poll error:', err);
    }
  }, 2000);
}

/** Register an SSE client */
export function addClient(client: SSEClient): void {
  clients.add(client);
  if (!pollInterval) startWatcher();
}

/** Remove an SSE client */
export function removeClient(client: SSEClient): void {
  clients.delete(client);
}

/** Broadcast an event to all connected SSE clients */
export function broadcast(event: { type: string; data: unknown }): void {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;

  for (const client of clients) {
    try {
      client.controller.enqueue(new TextEncoder().encode(payload));
    } catch {
      clients.delete(client);
    }
  }
}

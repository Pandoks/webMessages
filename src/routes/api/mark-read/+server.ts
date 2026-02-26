import { json, type RequestHandler } from '@sveltejs/kit';
import { markAsRead } from '$lib/server/imcore.js';
import { errorMessage, trimmedString } from '$lib/server/route-utils.js';

let lastBridgeUnavailableLogAt = 0;

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const chatGuid = trimmedString(body.chatGuid);

  if (!chatGuid) {
    return json({ error: 'chatGuid is required' }, { status: 400 });
  }

  try {
    await markAsRead(chatGuid);
    return json({ success: true });
  } catch (err) {
    const message = errorMessage(err, 'Failed to mark as read');

    if (message.includes('not running') || message.includes('exited while waiting')) {
      // Mark-read is best-effort; bridge can be intentionally down at startup.
      const now = Date.now();
      if (now - lastBridgeUnavailableLogAt > 30000) {
        console.warn('Mark read skipped:', message);
        lastBridgeUnavailableLogAt = now;
      }
      return json({ success: false, skipped: 'bridge_unavailable' });
    }

    if (message.includes('Chat not found:') && message.includes('registry chats: 0')) {
      // Bridge is up but still warming chat registry; mark-read is best-effort.
      return json({ success: false, skipped: 'bridge_not_ready' });
    }

    console.error('Mark read error:', err);
    const status = message.includes('timeout - no response received') ? 504 : 500;
    return json({ error: message }, { status });
  }
};

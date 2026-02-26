import { json, type RequestHandler } from '@sveltejs/kit';
import { sendReaction } from '$lib/server/imcore.js';
import { errorMessage, trimmedString } from '$lib/server/route-utils.js';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const chatGuid = trimmedString(body.chatGuid);
  const messageGuid = trimmedString(body.messageGuid);
  const reactionType = body.reactionType;
  const partIndex = body.partIndex;

  if (!chatGuid || !messageGuid || reactionType == null) {
    return json({ error: 'chatGuid, messageGuid, and reactionType are required' }, { status: 400 });
  }

  try {
    await sendReaction(chatGuid, messageGuid, reactionType, partIndex);
    return json({ success: true });
  } catch (err) {
    console.error('React error:', err);
    return json({ error: errorMessage(err, 'Failed to send reaction') }, { status: 500 });
  }
};

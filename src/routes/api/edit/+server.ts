import { json, type RequestHandler } from '@sveltejs/kit';
import { sendEdit, sendEditScheduled } from '$lib/server/imcore.js';
import { getMessageByGuid } from '$lib/server/queries/messages.js';
import { errorMessage, pollUntil, trimmedString } from '$lib/server/route-utils.js';

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const VERIFY_TIMEOUT_MS = 7000;
const POLL_INTERVAL_MS = 250;

type EditSnapshot = {
  editedAt: number;
  body: string;
  date: number;
  scheduleType: number;
  scheduleState: number;
};

function snapshotForVerification(messageGuid: string): EditSnapshot | null {
  const msg = getMessageByGuid(messageGuid);
  if (!msg) return null;
  return {
    editedAt: msg.date_edited ?? 0,
    body: (msg.body ?? msg.text ?? '').trim(),
    date: msg.date,
    scheduleType: msg.schedule_type,
    scheduleState: msg.schedule_state
  };
}

function parseScheduledFor(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const fromNumber = Number(trimmed);
    if (Number.isFinite(fromNumber)) return Math.trunc(fromNumber);
    const fromDate = Date.parse(trimmed);
    if (Number.isFinite(fromDate)) return Math.trunc(fromDate);
  }
  return null;
}

async function waitForEdit(
  messageGuid: string,
  before: EditSnapshot,
  expectBodyOrEditedChange: boolean,
  expectScheduleChange: boolean
): Promise<boolean> {
  return pollUntil(
    () => {
      const after = snapshotForVerification(messageGuid);
      if (!after) return false;

      const bodyOrEditedChanged = after.editedAt > before.editedAt || after.body !== before.body;
      const scheduleChanged =
        after.date !== before.date ||
        after.scheduleType !== before.scheduleType ||
        after.scheduleState !== before.scheduleState;

      if (expectBodyOrEditedChange && expectScheduleChange) {
        return bodyOrEditedChanged || scheduleChanged;
      }
      if (expectBodyOrEditedChange) {
        return bodyOrEditedChanged;
      }
      if (expectScheduleChange) {
        return scheduleChanged;
      }
      return true;
    },
    VERIFY_TIMEOUT_MS,
    POLL_INTERVAL_MS
  );
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const chatGuid = trimmedString(body.chatGuid);
  const messageGuid = trimmedString(body.messageGuid);
  const text = trimmedString(body.text);
  const scheduledFor = parseScheduledFor(body.scheduledFor);
  const partIndex = body.partIndex;

  if (!chatGuid || !messageGuid) {
    return json({ error: 'chatGuid and messageGuid are required' }, { status: 400 });
  }
  if (body.scheduledFor != null && scheduledFor == null) {
    return json(
      { error: 'scheduledFor must be a valid unix timestamp (ms) or ISO date string' },
      { status: 400 }
    );
  }
  if (scheduledFor != null && scheduledFor <= Date.now() + 30_000) {
    return json(
      { error: 'scheduledFor must be at least 30 seconds in the future' },
      { status: 400 }
    );
  }

  try {
    const before = getMessageByGuid(messageGuid);
    if (!before) {
      return json({ error: 'Message not found' }, { status: 404 });
    }

    const beforeBody = (before.body ?? before.text ?? '').trim();
    const ageMs = Date.now() - before.date;
    const isScheduledPending = before.schedule_type === 2 && before.date > Date.now();
    const hasTextEdit = text.length > 0 && text !== beforeBody;
    const hasScheduleEdit = scheduledFor != null && Math.abs(scheduledFor - before.date) > 1000;

    if (!text && !isScheduledPending) {
      return json({ error: 'text is required' }, { status: 400 });
    }
    if (!hasTextEdit && !hasScheduleEdit) {
      return json({ success: true, no_changes: true });
    }
    if (hasScheduleEdit && !isScheduledPending) {
      return json(
        {
          error: 'Rescheduling is only available for messages that are still in Send Later.'
        },
        { status: 409 }
      );
    }

    if (
      !before.is_from_me ||
      before.service !== 'iMessage' ||
      (before.date_retracted ?? 0) > 0 ||
      (!isScheduledPending && ageMs > EDIT_WINDOW_MS)
    ) {
      return json(
        {
          error:
            "Edit is not available for this message. It may be outside Apple's edit window or unsupported for this chat."
        },
        { status: 409 }
      );
    }

    const beforeSnapshot = snapshotForVerification(messageGuid);
    if (!beforeSnapshot) {
      return json({ error: 'Message not found' }, { status: 404 });
    }

    if (isScheduledPending) {
      await sendEditScheduled(chatGuid, messageGuid, {
        text: hasTextEdit ? text : undefined,
        partIndex,
        scheduledForMs: hasScheduleEdit ? scheduledFor! : undefined
      });
    } else {
      await sendEdit(chatGuid, messageGuid, text, partIndex);
    }

    const verified = await waitForEdit(messageGuid, beforeSnapshot, hasTextEdit, hasScheduleEdit);

    if (!verified) {
      return json(
        {
          success: false,
          error: 'Edit was accepted by bridge but no message change appeared in chat.db.'
        },
        { status: 409 }
      );
    }

    return json({ success: true });
  } catch (err) {
    console.error('Edit error:', err);
    const message = errorMessage(err, 'Failed to edit message');
    const noEffect =
      message.includes('No supported edit selector found') ||
      message.includes('No supported scheduled edit selector found') ||
      message.includes('No supported scheduled text edit selector found') ||
      message.includes('No supported scheduled delivery-time edit selector found') ||
      message.includes('no message change appeared');
    if (noEffect) {
      return json(
        { error: 'Edit is not available for this message on this chat/device state.' },
        { status: 409 }
      );
    }
    return json({ error: message }, { status: 500 });
  }
};

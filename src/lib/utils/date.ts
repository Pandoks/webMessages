/** Format a unix ms timestamp for display in chat list */
export function formatChatListDate(unixMs: number): string {
  if (unixMs === 0) return '';
  const date = new Date(unixMs);
  const now = new Date();
  const dayDiff = dayOffsetFromToday(date, now);

  if (dayDiff === 0) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } else if (dayDiff === -1) {
    return 'Yesterday';
  } else if (dayDiff === 1) {
    return 'Tomorrow';
  } else if (Math.abs(dayDiff) < 7) {
    return date.toLocaleDateString([], { weekday: 'long' });
  } else {
    return date.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  }
}

/** Format a unix ms timestamp for display in message thread */
export function formatMessageTime(unixMs: number): string {
  if (unixMs === 0) return '';
  return new Date(unixMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Format a timestamp for time separator between message groups */
export function formatTimeSeparator(unixMs: number): string {
  if (unixMs === 0) return '';
  const date = new Date(unixMs);
  const now = new Date();
  const dayDiff = dayOffsetFromToday(date, now);

  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (dayDiff === 0) {
    return time;
  } else if (dayDiff === -1) {
    return `Yesterday ${time}`;
  } else if (dayDiff === 1) {
    return `Tomorrow ${time}`;
  } else if (Math.abs(dayDiff) < 7) {
    return `${date.toLocaleDateString([], { weekday: 'long' })} ${time}`;
  } else {
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })} ${time}`;
  }
}

/** Format a scheduled message delivery timestamp */
export function formatScheduledTime(unixMs: number): string {
  if (unixMs === 0) return '';
  const date = new Date(unixMs);
  const now = new Date();
  const dayDiff = dayOffsetFromToday(date, now);
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (dayDiff === 0) return `Today at ${time}`;
  if (dayDiff === 1) return `Tomorrow at ${time}`;
  if (Math.abs(dayDiff) < 7) {
    return `${date.toLocaleDateString([], { weekday: 'long' })} at ${time}`;
  }

  const datePart = date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
  return `${datePart} at ${time}`;
}

/** Check if two timestamps are more than N minutes apart */
export function isTimeSeparatorNeeded(t1: number, t2: number, minuteGap = 15): boolean {
  return Math.abs(t2 - t1) > minuteGap * 60 * 1000;
}

function dayOffsetFromToday(date: Date, now: Date): number {
  const oneDayMs = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((startOfDate - startOfToday) / oneDayMs);
}

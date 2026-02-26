import type { Handle } from '@sveltejs/kit';
import { ensureContactsLoading } from '$lib/server/contacts.js';

export const handle: Handle = async ({ event, resolve }) => {
  // Start contact loading in the background — don't block requests.
  // Safe to call on every request; deduplicates internally.
  ensureContactsLoading();

  return resolve(event);
};

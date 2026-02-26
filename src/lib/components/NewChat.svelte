<script lang="ts">
  import { refreshChatList } from '$lib/stores/sync.svelte.js';
  import { pushState } from '$app/navigation';

  let { open = $bindable(false) }: { open: boolean } = $props();

  let recipient = $state('');
  let message = $state('');
  let sending = $state(false);
  let error = $state('');
  let contactsLoading = $state(false);
  let contactsLoaded = $state(false);
  let contacts: Array<{ name: string; phones: string[]; emails: string[] }> = $state([]);
  let recipientInput: HTMLInputElement | undefined = $state();
  let modalPanel: HTMLDivElement | undefined = $state();

  const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'textarea:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  type ContactSuggestion = {
    name: string;
    primaryIdentifier: string;
    allIdentifiers: string[];
    score: number;
  };

  async function ensureContactsLoaded() {
    if (contactsLoaded || contactsLoading) return;
    contactsLoading = true;
    try {
      const res = await fetch('/api/contacts');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.contacts)) {
        contacts = data.contacts;
        contactsLoaded = true;
      }
    } catch {
      // Silent failure; send still works using backend name resolution.
    } finally {
      contactsLoading = false;
    }
  }

  $effect(() => {
    if (!open) return;
    ensureContactsLoaded();
  });

  $effect(() => {
    if (!open) return;
    queueMicrotask(() => {
      recipientInput?.focus();
    });
  });

  const suggestions = $derived.by(() => {
    const q = recipient.trim().toLowerCase();
    if (!q || !contacts.length) return [] as ContactSuggestion[];

    const all: ContactSuggestion[] = [];
    for (const contact of contacts) {
      const name = contact.name?.trim();
      if (!name) continue;
      const lowerName = name.toLowerCase();

      let nameScore = 0;
      if (lowerName === q) nameScore = 5;
      else if (lowerName.startsWith(q)) nameScore = 4;
      else if (lowerName.includes(q)) nameScore = 3;

      const identifiers = [...contact.phones, ...contact.emails]
        .map((v) => v.trim())
        .filter((v) => !!v);
      if (identifiers.length === 0) continue;

      let identifierScore = 0;
      for (const identifier of identifiers) {
        const id = identifier.trim();
        const lowerId = id.toLowerCase();
        if (lowerId === q) identifierScore = Math.max(identifierScore, 5);
        else if (lowerId.startsWith(q)) identifierScore = Math.max(identifierScore, 3);
        else if (lowerId.includes(q)) identifierScore = Math.max(identifierScore, 2);
      }

      const score = Math.max(nameScore, identifierScore);
      if (score > 0) {
        all.push({ name, primaryIdentifier: identifiers[0], allIdentifiers: identifiers, score });
      }
    }

    all.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const unique: ContactSuggestion[] = [];
    const seen = new Set<string>();
    for (const item of all) {
      const key = item.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
      if (unique.length >= 8) break;
    }
    return unique;
  });

  async function focusExistingChat(identifier: string): Promise<boolean> {
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: identifier,
          text: ''
        })
      });
      if (!res.ok) return false;

      const data = await res.json();
      if (typeof data.chatId !== 'number') return false;

      open = false;
      recipient = '';
      message = '';
      error = '';
      await refreshChatList();
      pushState(`/chat/${data.chatId}`, { chatId: data.chatId });
      return true;
    } catch {
      return false;
    }
  }

  async function chooseSuggestion(suggestion: ContactSuggestion) {
    recipient = suggestion.primaryIdentifier;
    error = '';

    const focused = await focusExistingChat(suggestion.primaryIdentifier);
    if (focused) return;

    queueMicrotask(() => recipientInput?.focus());
  }

  async function handleSend() {
    if (!recipient.trim()) return;
    sending = true;
    error = '';

    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: recipient.trim(),
          text: message.trim()
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        error = data.error ?? 'Failed to send message';
        return;
      }

      const data = await res.json();
      open = false;
      recipient = '';
      message = '';
      await refreshChatList();
      if (typeof data.chatId === 'number') {
        pushState(`/chat/${data.chatId}`, { chatId: data.chatId });
      }
    } catch {
      error = 'Failed to send message';
    } finally {
      sending = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      open = false;
    }
  }

  function closeModal() {
    open = false;
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target !== e.currentTarget) return;
    closeModal();
  }

  function getFocusableElements(): HTMLElement[] {
    if (!modalPanel) return [];
    return Array.from(modalPanel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
      if (el.hasAttribute('disabled')) return false;
      if (el.getAttribute('aria-hidden') === 'true') return false;
      return el.offsetParent !== null || el === document.activeElement;
    });
  }

  function trapTabWithinModal(e: KeyboardEvent) {
    if (!open || e.key !== 'Tab') return;

    const focusable = getFocusableElements();
    if (focusable.length === 0) {
      e.preventDefault();
      modalPanel?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const focusInModal = !!active && modalPanel?.contains(active);

    if (e.shiftKey) {
      if (!focusInModal || active === first) {
        e.preventDefault();
        last.focus();
      }
      return;
    }

    if (!focusInModal || active === last) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

<svelte:window onkeydown={trapTabWithinModal} />

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_interactive_supports_focus -->
  <div
    data-modal-focus-scope="true"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label="New conversation"
    onkeydown={handleKeydown}
    onclick={handleBackdropClick}
  >
    <div
      bind:this={modalPanel}
      tabindex="-1"
      class="mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
    >
      <h2 class="mb-4 text-lg font-semibold">New Conversation</h2>

      <div class="space-y-3">
        <input
          bind:this={recipientInput}
          type="text"
          placeholder="Name, phone number, or email"
          bind:value={recipient}
          class="w-full rounded-lg bg-gray-100 px-4 py-2 text-sm outline-none placeholder:text-gray-400 focus:ring-2 focus:ring-blue-300"
        />
        {#if recipient.trim().length > 0 && suggestions.length > 0}
          <div
            class="-mt-1 max-h-52 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-sm"
          >
            {#each suggestions as suggestion (suggestion.name)}
              <button
                type="button"
                onclick={() => chooseSuggestion(suggestion)}
                class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50"
              >
                <span class="truncate text-sm text-gray-900">{suggestion.name}</span>
                <span class="shrink-0 text-xs text-gray-500">
                  {#if suggestion.allIdentifiers.length > 1}
                    {suggestion.allIdentifiers.length} identifiers
                  {:else}
                    {suggestion.primaryIdentifier}
                  {/if}
                </span>
              </button>
            {/each}
          </div>
        {/if}
        <textarea
          placeholder="Message (optional when chat already exists)"
          bind:value={message}
          rows="3"
          class="w-full resize-none rounded-lg bg-gray-100 px-4 py-2 text-sm outline-none placeholder:text-gray-400 focus:ring-2 focus:ring-blue-300"
        ></textarea>

        {#if error}
          <p class="text-sm text-red-500">{error}</p>
        {/if}

        <div class="flex justify-end gap-2">
          <button
            onclick={closeModal}
            class="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onclick={handleSend}
            disabled={sending || !recipient.trim()}
            class="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:bg-gray-300"
          >
            {sending ? 'Working...' : 'Open / Send'}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<script lang="ts">
  import type { Message } from '$lib/types/index.js';

  let {
    onSend,
    onSendScheduled,
    onSendFile,
    disabled = false,
    offline = false,
    replyTo,
    focusToken = 0,
    onCancelReply
  }: {
    onSend: (text: string) => void | Promise<void>;
    onSendScheduled?: (text: string, scheduledForMs: number) => void | Promise<void>;
    onSendFile?: (file: File) => void | Promise<void>;
    disabled?: boolean;
    offline?: boolean;
    replyTo?: Message;
    focusToken?: number;
    onCancelReply?: () => void;
  } = $props();

  const isDisabled = $derived(disabled || offline);

  let text = $state('');
  let textarea: HTMLTextAreaElement | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();
  let pendingFile: File | null = $state(null);
  let showSendMenu = $state(false);
  let showScheduleDialog = $state(false);
  let scheduleDate = $state('');
  let scheduleTime = $state('');

  $effect(() => {
    const token = focusToken;
    if (!token) return;
    focusComposer();
  });

  function focusComposer() {
    queueMicrotask(() => {
      if (!textarea) return;
      textarea.focus();
      const len = textarea.value.length;
      textarea.setSelectionRange(len, len);
    });
  }

  async function handleSubmit() {
    if (isDisabled) return;
    showSendMenu = false;

    const trimmed = text.trim();

    if (pendingFile && onSendFile) {
      const file = pendingFile;
      pendingFile = null;
      if (fileInput) fileInput.value = '';

      // Keep behavior intuitive: if user typed text + attached file,
      // send both instead of dropping the text.
      if (trimmed) {
        await Promise.resolve(onSend(trimmed));
      }
      await Promise.resolve(onSendFile(file));

      text = '';
      if (textarea) {
        textarea.style.height = 'auto';
      }
      focusComposer();
      return;
    }

    if (!trimmed) return;
    await Promise.resolve(onSend(trimmed));
    text = '';
    if (textarea) {
      textarea.style.height = 'auto';
    }
    focusComposer();
  }

  function localDateInputValue(value: Date): string {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function localTimeInputValue(value: Date): string {
    const h = String(value.getHours()).padStart(2, '0');
    const m = String(value.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  function nextScheduleDefault(): Date {
    const next = new Date(Date.now() + 60 * 60 * 1000);
    next.setSeconds(0, 0);
    const roundedMinutes = Math.ceil(next.getMinutes() / 5) * 5;
    if (roundedMinutes >= 60) {
      next.setHours(next.getHours() + 1, 0, 0, 0);
    } else {
      next.setMinutes(roundedMinutes, 0, 0);
    }
    return next;
  }

  function setScheduleFromDate(value: Date) {
    scheduleDate = localDateInputValue(value);
    scheduleTime = localTimeInputValue(value);
  }

  function openScheduleDialog(withPresetMs?: number) {
    showSendMenu = false;
    showScheduleDialog = true;
    if (withPresetMs && Number.isFinite(withPresetMs)) {
      setScheduleFromDate(new Date(withPresetMs));
      return;
    }
    if (!scheduleDate || !scheduleTime) {
      setScheduleFromDate(nextScheduleDefault());
    }
  }

  function closeScheduleDialog() {
    showScheduleDialog = false;
  }

  const scheduleTimestamp = $derived.by(() => {
    if (!scheduleDate || !scheduleTime) return null;
    const parsed = new Date(`${scheduleDate}T${scheduleTime}`);
    const ms = parsed.getTime();
    return Number.isFinite(ms) ? ms : null;
  });

  const schedulePreview = $derived.by(() => {
    if (!scheduleTimestamp) return '';
    return new Date(scheduleTimestamp).toLocaleString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  });

  const minScheduleDate = $derived(localDateInputValue(new Date()));
  const canUseSchedule = $derived(!!onSendScheduled && !isDisabled && !pendingFile && !replyTo);

  function quickScheduleOptions(now = new Date()): Array<{ label: string; when: number }> {
    const out: Array<{ label: string; when: number }> = [];

    const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
    inOneHour.setSeconds(0, 0);
    out.push({ label: 'In 1 Hour', when: inOneHour.getTime() });

    const tonight = new Date(now);
    tonight.setHours(21, 0, 0, 0);
    if (tonight.getTime() > now.getTime() + 60_000) {
      out.push({ label: 'Tonight 9:00 PM', when: tonight.getTime() });
    }

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    out.push({ label: 'Tomorrow 9:00 AM', when: tomorrow.getTime() });

    return out;
  }

  const quickOptions = $derived.by(() => quickScheduleOptions());

  async function submitScheduled(when: number) {
    const trimmed = text.trim();
    if (!canUseSchedule || !trimmed) return;
    if (when <= Date.now() + 30_000) return;

    await Promise.resolve(onSendScheduled?.(trimmed, when));
    text = '';
    showSendMenu = false;
    showScheduleDialog = false;
    if (textarea) {
      textarea.style.height = 'auto';
    }
    focusComposer();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleInput() {
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }
  }

  function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          pendingFile = file;
        }
        break;
      }
    }
  }

  function handleFileSelect() {
    const files = fileInput?.files;
    if (files && files.length > 0) {
      pendingFile = files[0];
    }
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (showSendMenu || showScheduleDialog) {
        e.preventDefault();
        showSendMenu = false;
        showScheduleDialog = false;
      }
      return;
    }
    if (e.key !== 'Tab') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!textarea) return;
    // Respect modal/tab navigation when a modal dialog is open.
    if (document.querySelector('[data-modal-focus-scope="true"]')) return;

    e.preventDefault();
    focusComposer();
  }

  function clearPendingFile() {
    pendingFile = null;
    if (fileInput) fileInput.value = '';
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="border-t border-gray-200 bg-white p-3">
  {#if replyTo}
    <div
      class="mb-2 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm border-l-2 border-blue-400"
    >
      <div class="min-w-0 flex-1">
        <p class="text-xs font-medium text-blue-600">{replyTo.sender ?? 'Unknown'}</p>
        <p class="truncate text-gray-600">{replyTo.body ?? ''}</p>
      </div>
      <button onclick={() => onCancelReply?.()} class="shrink-0 text-gray-400 hover:text-gray-600"
        >&#x2715;</button
      >
    </div>
  {/if}

  {#if pendingFile}
    <div class="mb-2 flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm">
      {#if pendingFile.type.startsWith('image/')}
        <img
          src={URL.createObjectURL(pendingFile)}
          alt="Preview"
          class="h-16 w-16 rounded object-cover"
        />
      {:else}
        <span class="truncate text-gray-600">{pendingFile.name}</span>
      {/if}
      <button
        onclick={clearPendingFile}
        class="ml-auto text-gray-400 hover:text-gray-600"
        aria-label="Remove attachment"
      >
        <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  {/if}

  <div class="flex items-end gap-2">
    <input
      bind:this={fileInput}
      type="file"
      class="hidden"
      onchange={handleFileSelect}
      accept="image/*,video/*,.pdf,.doc,.docx,.txt"
    />
    <button
      onclick={() => fileInput?.click()}
      disabled={isDisabled}
      aria-label="Attach file"
      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
    >
      <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
      </svg>
    </button>

    <textarea
      bind:this={textarea}
      bind:value={text}
      onkeydown={handleKeydown}
      oninput={handleInput}
      onpaste={handlePaste}
      placeholder={offline ? "You're offline" : 'iMessage'}
      rows="1"
      disabled={isDisabled}
      class="flex-1 resize-none rounded-2xl bg-gray-100 px-4 py-2 text-sm outline-none placeholder:text-gray-400 focus:ring-2 focus:ring-blue-300 disabled:opacity-50"
    ></textarea>
    <div class="relative flex shrink-0 items-center">
      <button
        onclick={handleSubmit}
        disabled={isDisabled || (!text.trim() && !pendingFile)}
        aria-label="Send message"
        class="flex h-9 w-9 items-center justify-center bg-blue-500 text-white transition-colors hover:bg-blue-600 disabled:bg-gray-300
					{canUseSchedule ? 'rounded-l-full rounded-r-sm pr-2' : 'rounded-full'}"
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
          />
        </svg>
      </button>
      {#if canUseSchedule}
        <button
          onclick={() => {
            showSendMenu = !showSendMenu;
          }}
          disabled={isDisabled || !text.trim()}
          aria-label="More send options"
          class="flex h-9 w-5 items-center justify-center rounded-r-full bg-blue-500 text-white transition-colors hover:bg-blue-600 disabled:bg-gray-300"
        >
          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
      {/if}

      {#if showSendMenu}
        <div
          class="absolute bottom-11 right-0 z-40 min-w-52 rounded-xl border border-gray-200 bg-white p-1 shadow-lg"
        >
          {#each quickOptions as option (option.label)}
            <button
              onclick={() => submitScheduled(option.when)}
              class="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              {option.label}
            </button>
          {/each}
          <button
            onclick={() => openScheduleDialog()}
            class="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-blue-600 hover:bg-blue-50"
          >
            Pick Date &amp; Time...
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>

{#if showSendMenu}
  <button
    type="button"
    class="fixed inset-0 z-30 cursor-default bg-transparent"
    aria-label="Close send options"
    onclick={() => {
      showSendMenu = false;
    }}
  ></button>
{/if}

{#if showScheduleDialog}
  <button
    type="button"
    class="fixed inset-0 z-40 bg-black/30"
    aria-label="Close schedule dialog"
    onclick={closeScheduleDialog}
  ></button>
  <div
    class="fixed left-1/2 top-1/2 z-50 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-4 shadow-xl ring-1 ring-black/10"
  >
    <h3 class="text-base font-semibold text-gray-900">Send Later</h3>
    <p class="mt-1 text-xs text-gray-500">Choose when this message should be delivered.</p>
    <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label class="flex flex-col gap-1 text-xs font-medium text-gray-600">
        Date
        <input
          type="date"
          bind:value={scheduleDate}
          min={minScheduleDate}
          class="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-blue-300"
        />
      </label>
      <label class="flex flex-col gap-1 text-xs font-medium text-gray-600">
        Time
        <input
          type="time"
          bind:value={scheduleTime}
          step="60"
          class="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-blue-300"
        />
      </label>
    </div>
    {#if schedulePreview}
      <div class="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
        Sends on {schedulePreview}
      </div>
    {/if}
    <div class="mt-4 flex items-center justify-end gap-2">
      <button
        type="button"
        onclick={closeScheduleDialog}
        class="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
      >
        Cancel
      </button>
      <button
        type="button"
        onclick={() => {
          if (scheduleTimestamp) {
            submitScheduled(scheduleTimestamp);
          }
        }}
        disabled={!scheduleTimestamp || scheduleTimestamp <= Date.now() + 30_000 || !text.trim()}
        class="rounded-lg bg-blue-500 px-3 py-2 text-sm text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-blue-300"
      >
        Schedule Message
      </button>
    </div>
  </div>
{/if}

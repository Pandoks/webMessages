<script lang="ts">
	import { untrack } from 'svelte';
	import AttachmentPreview from './AttachmentPreview.svelte';

	interface Props {
		chatGuid: string;
		onSend: (text: string) => Promise<void>;
		onSendAttachment: (files: File[], text: string, replyToGuid: string | null) => Promise<void>;
		onTypingStart: () => void;
		onTypingStop: () => void;
		replyTo?: { guid: string; text: string | null; senderName: string } | null;
		onCancelReply?: () => void;
		onScheduleSend?: (text: string, scheduledAt: number) => Promise<void>;
	}

	let {
		chatGuid,
		onSend,
		onSendAttachment,
		onTypingStart,
		onTypingStop,
		replyTo = null,
		onCancelReply = () => {},
		onScheduleSend
	}: Props = $props();

	let text = $state('');
	let sending = $state(false);
	let isTyping = $state(false);
	let typingTimer: ReturnType<typeof setTimeout> | null = null;
	let textareaEl: HTMLTextAreaElement | undefined = $state();
	let fileInputEl: HTMLInputElement | undefined = $state();
	let pendingFiles = $state<File[]>([]);
	let showSchedulePopover = $state(false);
	let scheduleDate = $state('');
	let scheduleTime = $state('09:00');
	let popoverEl: HTMLDivElement | undefined = $state();

	function getDefaultScheduleDate(): string {
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		return tomorrow.toISOString().split('T')[0];
	}

	function getTodayStr(): string {
		return new Date().toISOString().split('T')[0];
	}

	function toggleSchedulePopover() {
		showSchedulePopover = !showSchedulePopover;
		if (showSchedulePopover) {
			scheduleDate = getDefaultScheduleDate();
			scheduleTime = '09:00';
		}
	}

	function handlePopoverClickOutside(e: MouseEvent) {
		if (popoverEl && !popoverEl.contains(e.target as Node)) {
			showSchedulePopover = false;
		}
	}

	async function scheduleSend() {
		const trimmed = text.trim();
		if (!trimmed || !onScheduleSend || !scheduleDate || !scheduleTime) return;

		const scheduledAt = new Date(`${scheduleDate}T${scheduleTime}`).getTime();
		if (scheduledAt <= Date.now()) return;

		showSchedulePopover = false;
		await onScheduleSend(trimmed, scheduledAt);
		text = '';
		if (textareaEl) textareaEl.style.height = 'auto';
	}

	$effect(() => {
		if (showSchedulePopover) {
			document.addEventListener('mousedown', handlePopoverClickOutside);
			return () => document.removeEventListener('mousedown', handlePopoverClickOutside);
		}
	});

	function resetTypingTimer() {
		if (typingTimer) clearTimeout(typingTimer);
		typingTimer = setTimeout(() => {
			if (isTyping) {
				isTyping = false;
				onTypingStop();
			}
		}, 3000);
	}

	function handleInput() {
		autoResize();
		if (!isTyping && text.trim().length > 0) {
			isTyping = true;
			onTypingStart();
		}
		if (text.trim().length > 0) {
			resetTypingTimer();
		} else if (isTyping) {
			isTyping = false;
			if (typingTimer) clearTimeout(typingTimer);
			onTypingStop();
		}
	}

	function autoResize() {
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
		textareaEl.style.height = Math.min(textareaEl.scrollHeight, 128) + 'px';
	}

	function handlePaste(e: ClipboardEvent) {
		const files = Array.from(e.clipboardData?.files ?? []);
		if (files.length > 0) {
			e.preventDefault();
			pendingFiles = [...pendingFiles, ...files];
		}
	}

	function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files && input.files.length > 0) {
			pendingFiles = [...pendingFiles, ...Array.from(input.files)];
		}
		// Reset so the same file can be selected again
		input.value = '';
	}

	function removeFile(index: number) {
		pendingFiles = pendingFiles.filter((_, i) => i !== index);
	}

	function openFilePicker() {
		fileInputEl?.click();
	}

	async function send() {
		const trimmed = text.trim();
		const hasFiles = pendingFiles.length > 0;

		if ((!trimmed && !hasFiles) || sending) return;

		sending = true;
		if (isTyping) {
			isTyping = false;
			if (typingTimer) clearTimeout(typingTimer);
			onTypingStop();
		}

		try {
			if (hasFiles) {
				const filesToSend = [...pendingFiles];
				const replyGuid = replyTo?.guid ?? null;
				pendingFiles = [];
				text = '';
				if (textareaEl) {
					textareaEl.style.height = 'auto';
				}
				await onSendAttachment(filesToSend, trimmed, replyGuid);
			} else {
				// Text-only send via existing callback
				await onSend(trimmed);
				text = '';
				if (textareaEl) {
					textareaEl.style.height = 'auto';
				}
			}
		} finally {
			sending = false;
			textareaEl?.focus();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}

	// Reset state when chatGuid changes
	$effect(() => {
		void chatGuid;
		untrack(() => {
			text = '';
			sending = false;
			pendingFiles = [];
			if (isTyping) {
				isTyping = false;
				if (typingTimer) clearTimeout(typingTimer);
			}
		});
	});

	// Focus textarea when replyTo is set
	$effect(() => {
		if (replyTo) {
			textareaEl?.focus();
		}
	});

	// Cleanup timer on destroy
	$effect(() => {
		return () => {
			if (typingTimer) clearTimeout(typingTimer);
		};
	});
</script>

<div class="border-t border-gray-200 dark:border-gray-700">
	{#if replyTo}
		<div class="flex items-center gap-2 border-b border-gray-100 px-3 py-2 dark:border-gray-600">
			<div class="w-0.5 shrink-0 self-stretch rounded-full bg-blue-500"></div>
			<div class="min-w-0 flex-1">
				<p class="text-xs font-medium text-blue-500">Replying to {replyTo.senderName}</p>
				{#if replyTo.text}
					<p class="truncate text-xs text-gray-500 dark:text-gray-400">{replyTo.text}</p>
				{/if}
			</div>
			<button
				onclick={onCancelReply}
				class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-600 dark:hover:text-gray-300"
				aria-label="Cancel reply"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-3.5 w-3.5"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>
	{/if}

	<AttachmentPreview files={pendingFiles} onRemove={removeFile} />

	<!-- Hidden file input -->
	<input bind:this={fileInputEl} type="file" multiple onchange={handleFileSelect} class="hidden" />

	<div class="flex items-end gap-2 p-3">
		<!-- Paperclip / attach button -->
		<button
			onclick={openFilePicker}
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
			aria-label="Attach file"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-5 w-5"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="1.5"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13"
				/>
			</svg>
		</button>

		<textarea
			bind:this={textareaEl}
			bind:value={text}
			oninput={handleInput}
			onkeydown={handleKeydown}
			onpaste={handlePaste}
			placeholder="iMessage"
			rows="1"
			class="max-h-32 flex-1 resize-none rounded-2xl bg-gray-100 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
		></textarea>

		<div class="relative flex shrink-0">
			<button
				onclick={send}
				disabled={(!text.trim() && pendingFiles.length === 0) || sending}
				class="flex h-9 items-center justify-center rounded-l-full bg-blue-500 pl-3 text-white transition-opacity disabled:opacity-40 {onScheduleSend
					? 'pr-1'
					: 'rounded-r-full pr-3'}"
				aria-label="Send message"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-4 w-4"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M12 5l7 7-7 7" />
				</svg>
			</button>
			{#if onScheduleSend}
				<button
					onclick={toggleSchedulePopover}
					disabled={!text.trim() || sending}
					class="flex h-9 w-6 items-center justify-center rounded-r-full border-l border-blue-400 bg-blue-500 text-white transition-opacity disabled:opacity-40"
					aria-label="Schedule send"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-3 w-3"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2.5"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
					</svg>
				</button>
			{/if}

			{#if showSchedulePopover}
				<div
					bind:this={popoverEl}
					class="absolute right-0 bottom-full z-50 mb-2 w-64 rounded-xl border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-600 dark:bg-gray-800"
				>
					<p class="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">Schedule message</p>
					<div class="flex flex-col gap-2">
						<input
							type="date"
							bind:value={scheduleDate}
							min={getTodayStr()}
							class="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
						/>
						<input
							type="time"
							bind:value={scheduleTime}
							class="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
						/>
						<button
							onclick={scheduleSend}
							class="rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
						>
							Schedule Send
						</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

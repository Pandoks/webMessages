<script lang="ts">
	interface Props {
		chatGuid: string;
		onSend: (text: string) => Promise<void>;
		onTypingStart: () => void;
		onTypingStop: () => void;
		replyTo?: { guid: string; text: string | null; senderName: string } | null;
		onCancelReply?: () => void;
	}

	let { chatGuid, onSend, onTypingStart, onTypingStop, replyTo = null, onCancelReply = () => {} }: Props = $props();

	let text = $state('');
	let sending = $state(false);
	let isTyping = $state(false);
	let typingTimer: ReturnType<typeof setTimeout> | null = null;
	let textareaEl: HTMLTextAreaElement | undefined = $state();

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

	async function send() {
		const trimmed = text.trim();
		if (!trimmed || sending) return;

		sending = true;
		if (isTyping) {
			isTyping = false;
			if (typingTimer) clearTimeout(typingTimer);
			onTypingStop();
		}

		try {
			await onSend(trimmed);
			text = '';
			if (textareaEl) {
				textareaEl.style.height = 'auto';
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
		// Read chatGuid to create dependency
		void chatGuid;
		text = '';
		sending = false;
		if (isTyping) {
			isTyping = false;
			if (typingTimer) clearTimeout(typingTimer);
		}
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
				<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>
	{/if}

	<div class="flex items-end gap-2 p-3">
	<textarea
		bind:this={textareaEl}
		bind:value={text}
		oninput={handleInput}
		onkeydown={handleKeydown}
		placeholder="iMessage"
		rows="1"
		class="max-h-32 flex-1 resize-none rounded-2xl bg-gray-100 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
	></textarea>
	<button
		onclick={send}
		disabled={!text.trim() || sending}
		class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white transition-opacity disabled:opacity-40"
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
	</div>
</div>

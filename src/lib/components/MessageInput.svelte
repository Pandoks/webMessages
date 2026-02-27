<script lang="ts">
	interface Props {
		chatGuid: string;
		onSend: (text: string) => Promise<void>;
		onTypingStart: () => void;
		onTypingStop: () => void;
	}

	let { chatGuid, onSend, onTypingStart, onTypingStop }: Props = $props();

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

	// Cleanup timer on destroy
	$effect(() => {
		return () => {
			if (typingTimer) clearTimeout(typingTimer);
		};
	});
</script>

<div class="flex items-end gap-2 border-t border-gray-200 p-3 dark:border-gray-700">
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

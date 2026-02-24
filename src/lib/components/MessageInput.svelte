<script lang="ts">
	import type { Message } from '$lib/types/index.js';

	let {
		onSend,
		onSendFile,
		disabled = false,
		offline = false,
		replyTo,
		focusToken = 0,
		onCancelReply
	}: {
		onSend: (text: string) => void | Promise<void>;
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

	$effect(() => {
		const token = focusToken;
		if (!token) return;
		queueMicrotask(() => {
			if (!textarea) return;
			textarea.focus();
			const len = textarea.value.length;
			textarea.setSelectionRange(len, len);
		});
	});

	async function handleSubmit() {
		if (isDisabled) return;

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
			return;
		}

		if (!trimmed) return;
		await Promise.resolve(onSend(trimmed));
		text = '';
		if (textarea) {
			textarea.style.height = 'auto';
		}
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

	function clearPendingFile() {
		pendingFile = null;
		if (fileInput) fileInput.value = '';
	}
</script>

<div class="border-t border-gray-200 bg-white p-3">
	{#if replyTo}
		<div class="mb-2 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm border-l-2 border-blue-400">
			<div class="min-w-0 flex-1">
				<p class="text-xs font-medium text-blue-600">{replyTo.sender ?? 'Unknown'}</p>
				<p class="truncate text-gray-600">{replyTo.body ?? ''}</p>
			</div>
			<button onclick={() => onCancelReply?.()} class="shrink-0 text-gray-400 hover:text-gray-600">&#x2715;</button>
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
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
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
		<button
			onclick={handleSubmit}
			disabled={isDisabled || (!text.trim() && !pendingFile)}
			aria-label="Send message"
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white transition-colors hover:bg-blue-600 disabled:bg-gray-300"
		>
			<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
			</svg>
		</button>
	</div>
</div>

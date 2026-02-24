<script lang="ts">
	import type { Message } from '$lib/types/index.js';

	let {
		message,
		x,
		y,
		onReact,
		onReply,
		onClose
	}: {
		message: Message;
		x: number;
		y: number;
		onReact: (message: Message, reactionType: number) => void;
		onReply: (message: Message) => void;
		onClose: () => void;
	} = $props();

	let showReactions = $state(false);

	// Tapback types: 2000=love, 2001=like, 2002=dislike, 2003=laugh, 2004=emphasize, 2005=question
	const tapbacks = [
		{ emoji: '\u2764\uFE0F', type: 2000 },
		{ emoji: '\uD83D\uDC4D', type: 2001 },
		{ emoji: '\uD83D\uDC4E', type: 2002 },
		{ emoji: '\uD83D\uDE02', type: 2003 },
		{ emoji: '\u203C\uFE0F', type: 2004 },
		{ emoji: '\u2753', type: 2005 }
	];

	// Clamp position to viewport
	const menuWidth = 200;
	const menuHeight = 160;
	const clampedX = $derived(Math.min(x, window.innerWidth - menuWidth - 8));
	const clampedY = $derived(Math.min(y, window.innerHeight - menuHeight - 8));

	function handleReact(type: number) {
		onReact(message, type);
	}

	function handleReply() {
		onReply(message);
	}

	function handleCopy() {
		navigator.clipboard.writeText(message.body ?? message.text ?? '');
		onClose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

	function handleBackdropKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onClose();
		}
	}

	function handleMenuKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Backdrop -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-50"
	onclick={onClose}
	oncontextmenu={(e) => { e.preventDefault(); onClose(); }}
	tabindex="-1"
	onkeydown={handleBackdropKeydown}
>
	<!-- Menu -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="absolute z-50 min-w-[180px] rounded-xl bg-white py-1 shadow-lg ring-1 ring-black/5"
		style="left: {clampedX}px; top: {clampedY}px"
		onclick={(e) => e.stopPropagation()}
		tabindex="-1"
		onkeydown={handleMenuKeydown}
	>
		{#if showReactions}
			<div class="flex gap-1 px-3 py-2">
				{#each tapbacks as tapback}
					<button
						onclick={() => handleReact(tapback.type)}
						class="flex h-9 w-9 items-center justify-center rounded-full text-lg transition-transform hover:scale-125 hover:bg-gray-100"
					>
						{tapback.emoji}
					</button>
				{/each}
			</div>
		{:else}
			<button
				onclick={() => { showReactions = true; }}
				class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
			>
				<span class="w-5 text-center text-base">+</span>
				React
			</button>
			<button
				onclick={handleReply}
				class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
			>
				<svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
				</svg>
				Reply
			</button>
			<button
				onclick={handleCopy}
				class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
			>
				<svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
				</svg>
				Copy Text
			</button>
		{/if}
	</div>
</div>

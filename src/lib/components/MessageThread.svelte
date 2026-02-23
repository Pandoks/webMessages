<script lang="ts">
	import type { Message } from '$lib/types/index.js';
	import MessageBubble from './MessageBubble.svelte';
	import { isTimeSeparatorNeeded, formatTimeSeparator } from '$lib/utils/date.js';

	let {
		messages,
		isGroup = false,
		onLoadMore,
		hasMore = false,
		loading = false
	}: {
		messages: Message[];
		isGroup?: boolean;
		onLoadMore?: () => void;
		hasMore?: boolean;
		loading?: boolean;
	} = $props();

	let scrollContainer: HTMLDivElement | undefined = $state();
	let wasAtBottom = true;

	// Build a map of guid → message for reply lookups
	const messageMap = $derived.by(() => {
		const map = new Map<string, Message>();
		for (const msg of messages) {
			map.set(msg.guid, msg);
		}
		return map;
	});

	// Scroll to bottom when new messages arrive (if already at bottom)
	$effect(() => {
		if (messages.length && scrollContainer && wasAtBottom) {
			scrollContainer.scrollTop = scrollContainer.scrollHeight;
		}
	});

	function handleScroll() {
		if (!scrollContainer) return;

		// Track if user is at the bottom
		const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
		wasAtBottom = scrollHeight - scrollTop - clientHeight < 50;

		// Load more when scrolled to top
		if (scrollTop < 100 && hasMore && !loading && onLoadMore) {
			const prevHeight = scrollHeight;
			onLoadMore();
			// Preserve scroll position after older messages load
			requestAnimationFrame(() => {
				if (scrollContainer) {
					scrollContainer.scrollTop = scrollContainer.scrollHeight - prevHeight;
				}
			});
		}
	}

	function shouldShowSender(msg: Message, prevMsg: Message | undefined): boolean {
		if (!isGroup || msg.is_from_me) return false;
		if (!prevMsg) return true;
		return prevMsg.is_from_me || prevMsg.sender !== msg.sender;
	}
</script>

<div
	bind:this={scrollContainer}
	onscroll={handleScroll}
	class="flex flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-4 py-3"
>
	{#if loading}
		<div class="py-2 text-center text-xs text-gray-400">Loading older messages...</div>
	{/if}

	{#each messages as msg, i (msg.rowid)}
		{@const prevMsg = i > 0 ? messages[i - 1] : undefined}
		{@const showTimeSep = !prevMsg || isTimeSeparatorNeeded(prevMsg.date, msg.date)}
		{@const replyTo = msg.thread_originator_guid ? messageMap.get(msg.thread_originator_guid) : undefined}
		{@const showSender = shouldShowSender(msg, prevMsg)}

		{#if showTimeSep}
			<div class="py-2 text-center text-xs text-gray-400">
				{formatTimeSeparator(msg.date)}
			</div>
		{/if}

		<MessageBubble
			message={msg}
			{isGroup}
			{replyTo}
			{showSender}
		/>
	{/each}
</div>

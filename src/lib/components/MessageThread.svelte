<script lang="ts">
	import type { Message } from '$lib/types/index.js';
	import MessageBubble from './MessageBubble.svelte';
	import MessageContextMenu from './MessageContextMenu.svelte';
	import { isTimeSeparatorNeeded, formatTimeSeparator } from '$lib/utils/date.js';

	let {
		messages,
		isGroup = false,
		onLoadMore,
		hasMore = false,
		loading = false,
		onReact,
		onReply
	}: {
		messages: Message[];
		isGroup?: boolean;
		onLoadMore?: () => void;
		hasMore?: boolean;
		loading?: boolean;
		onReact?: (message: Message, reactionType: number) => void;
		onReply?: (message: Message) => void;
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

	// Compute delivery status labels (iMessage-style: "Read" at transition, status at end)
	const statusMap = $derived.by(() => {
		const map = new Map<number, string>();
		if (!messages.length) return map;

		// Find the trailing block of consecutive sent messages (no received messages after)
		let trailingStart = messages.length;
		for (let i = messages.length - 1; i >= 0; i--) {
			if (!messages[i].is_from_me) break;
			trailingStart = i;
		}
		if (trailingStart === messages.length) return map;

		// Find the last read message in the trailing block
		let lastReadIdx = -1;
		for (let i = messages.length - 1; i >= trailingStart; i--) {
			if (messages[i].is_read) {
				lastReadIdx = i;
				break;
			}
		}

		// Show "Read" at the last read message if there are non-read messages after it
		if (lastReadIdx !== -1 && lastReadIdx < messages.length - 1) {
			map.set(lastReadIdx, 'Read');
		}

		// Show status on the very last message
		const last = messages[messages.length - 1];
		if (last.is_read) {
			map.set(messages.length - 1, 'Read');
		} else if (last.is_delivered) {
			map.set(messages.length - 1, 'Delivered');
		} else if (last.is_sent) {
			map.set(messages.length - 1, 'Sent');
		} else if (last.rowid < 0) {
			map.set(messages.length - 1, 'Sending...');
		}

		return map;
	});

	let contextMenu: { message: Message; x: number; y: number } | null = $state(null);

	function handleContextMenu(e: MouseEvent, msg: Message) {
		contextMenu = { message: msg, x: e.clientX, y: e.clientY };
	}
</script>

<div
	bind:this={scrollContainer}
	onscroll={handleScroll}
	class="flex min-w-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-3"
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
			statusText={statusMap.get(i)}
			onContextMenu={handleContextMenu}
		/>
	{/each}
</div>

{#if contextMenu}
	<MessageContextMenu
		message={contextMenu.message}
		x={contextMenu.x}
		y={contextMenu.y}
		onReact={(msg, type) => { onReact?.(msg, type); contextMenu = null; }}
		onReply={(msg) => { onReply?.(msg); contextMenu = null; }}
		onClose={() => { contextMenu = null; }}
	/>
{/if}

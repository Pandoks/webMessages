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
		onReply,
		onEdit,
		onUnsend
	}: {
		messages: Message[];
		isGroup?: boolean;
		onLoadMore?: () => void | Promise<void>;
		hasMore?: boolean;
		loading?: boolean;
		onReact?: (message: Message, reactionType: number) => void;
		onReply?: (message: Message) => void;
		onEdit?: (message: Message) => void;
		onUnsend?: (message: Message) => void;
	} = $props();

	let scrollContainer: HTMLDivElement | undefined = $state();
	let wasAtBottom = true;
	let loadInFlight = false;

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

	async function handleScroll() {
		if (!scrollContainer) return;

		// Track if user is at the bottom
		const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
		wasAtBottom = scrollHeight - scrollTop - clientHeight < 50;

		// Load more when scrolled to top
		if (scrollTop < 100 && messages.length > 0 && hasMore && !loading && !loadInFlight && onLoadMore) {
			const prevHeight = scrollHeight;
			const prevTop = scrollTop;
			loadInFlight = true;
			try {
				await onLoadMore();
			} catch (err) {
				console.error('Failed to load older messages:', err);
			} finally {
				loadInFlight = false;
			}
			// Preserve scroll position after older messages load.
			requestAnimationFrame(() => {
				if (scrollContainer) {
					const delta = scrollContainer.scrollHeight - prevHeight;
					scrollContainer.scrollTop = Math.max(0, prevTop + delta);
				}
			});
		}
	}

	function shouldShowSender(msg: Message, prevMsg: Message | undefined): boolean {
		if (!isGroup || msg.is_from_me) return false;
		if (!prevMsg) return true;
		return prevMsg.is_from_me || prevMsg.sender !== msg.sender;
	}

	function isUnsent(msg: Message): boolean {
		return !!(msg.date_retracted && msg.date_retracted > 0);
	}

	// Compute delivery status labels (iMessage-style: "Read" at transition, status at end)
	const statusMap = $derived.by(() => {
		const map = new Map<number, string>();
		if (!messages.length) return map;

		// Find the trailing block of sent messages, ignoring unsent rows.
		// Unsent rows can have is_read=true in chat.db, which should not drive status labels.
		const trailingSentIndexes: number[] = [];
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (!msg.is_from_me) break;
			if (!isUnsent(msg)) trailingSentIndexes.push(i);
		}
		if (trailingSentIndexes.length === 0) return map;
		trailingSentIndexes.reverse();

		// Find the last read message in the trailing block
		let lastReadIdx = -1;
		for (let i = trailingSentIndexes.length - 1; i >= 0; i--) {
			const msgIdx = trailingSentIndexes[i];
			if (messages[msgIdx].is_read) {
				lastReadIdx = msgIdx;
				break;
			}
		}

		// Show "Read" at the last read message if there are non-read messages after it
		const lastStatusIdx = trailingSentIndexes[trailingSentIndexes.length - 1];
		if (lastReadIdx !== -1 && lastReadIdx < lastStatusIdx) {
			map.set(lastReadIdx, 'Read');
		}

		// Show status on the latest non-unsent outgoing message
		const last = messages[lastStatusIdx];
		if (last.is_read) {
			map.set(lastStatusIdx, 'Read');
		} else if (last.is_delivered) {
			map.set(lastStatusIdx, 'Delivered');
		} else if (last.is_sent) {
			map.set(lastStatusIdx, 'Sent');
		} else if (last.rowid < 0) {
			map.set(lastStatusIdx, 'Sending...');
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
		onEdit={(msg) => { onEdit?.(msg); contextMenu = null; }}
		onUnsend={(msg) => { onUnsend?.(msg); contextMenu = null; }}
		onClose={() => { contextMenu = null; }}
	/>
{/if}

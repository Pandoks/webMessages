<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db } from '$lib/db/index.js';
	import type { DbMessage, DbAttachment, DbChat, DbHandle } from '$lib/db/types.js';
	import type { SyncEngine } from '$lib/sync/engine.svelte.js';
	import MessageBubble from './MessageBubble.svelte';
	import MessageInput from './MessageInput.svelte';
	import { getChatDisplayName, formatPhoneNumber } from '$lib/utils/format.js';

	interface Props {
		chatGuid: string;
		syncEngine?: SyncEngine | null;
	}

	let { chatGuid, syncEngine = null }: Props = $props();

	let messages = $state<DbMessage[]>([]);
	let attachmentMap = $state<Map<string, DbAttachment[]>>(new Map());
	let chat = $state<DbChat | undefined>(undefined);
	let handles = $state<DbHandle[]>([]);

	let scrollContainer: HTMLDivElement | undefined = $state();
	let loadingOlder = $state(false);
	let hasMoreOlder = $state(true);
	let wasNearBottom = $state(true);

	// Subscribe to messages for this chat
	$effect(() => {
		const sub = liveQuery(() =>
			db.messages
				.where('chatGuid')
				.equals(chatGuid)
				.filter((m) => m.associatedMessageType === 0)
				.sortBy('dateCreated')
		).subscribe((msgs) => {
			messages = msgs;
		});
		return () => sub.unsubscribe();
	});

	// Subscribe to attachments for messages in this chat
	$effect(() => {
		if (messages.length === 0) {
			attachmentMap = new Map();
			return;
		}

		const messageGuids = messages.map((m) => m.guid);
		const sub = liveQuery(() =>
			db.attachments.where('messageGuid').anyOf(messageGuids).toArray()
		).subscribe((atts) => {
			const map = new Map<string, DbAttachment[]>();
			for (const att of atts) {
				const existing = map.get(att.messageGuid) ?? [];
				existing.push(att);
				map.set(att.messageGuid, existing);
			}
			attachmentMap = map;
		});
		return () => sub.unsubscribe();
	});

	// Subscribe to the chat itself
	$effect(() => {
		const sub = liveQuery(() => db.chats.get(chatGuid)).subscribe((c) => {
			chat = c;
		});
		return () => sub.unsubscribe();
	});

	// Subscribe to handles for sender name resolution
	$effect(() => {
		const sub = liveQuery(() => db.handles.toArray()).subscribe((h) => {
			handles = h;
		});
		return () => sub.unsubscribe();
	});

	// Mark as read when viewing
	$effect(() => {
		if (chat && chat.unreadCount > 0) {
			db.chats.update(chatGuid, { unreadCount: 0 });
		}
	});

	const handleMap = $derived(new Map(handles.map((h) => [h.address, h.displayName])));

	const displayName = $derived.by(() => {
		if (!chat) return 'Loading...';
		return getChatDisplayName(chat.displayName, chat.participants, handleMap);
	});

	const isGroup = $derived(chat?.style === 43);

	const typingAddresses = $derived.by(() => {
		if (!syncEngine) return [];
		const set = syncEngine.typingIndicators.get(chatGuid);
		return set ? Array.from(set) : [];
	});

	function getSenderName(message: DbMessage): string {
		if (message.isFromMe) return 'Me';
		if (message.handleAddress) {
			const name = handleMap.get(message.handleAddress);
			return name ?? formatPhoneNumber(message.handleAddress);
		}
		return 'Unknown';
	}

	// Auto-scroll to bottom on new messages (only if already near bottom)
	$effect(() => {
		// Track messages length to trigger effect on new messages
		void messages.length;

		if (wasNearBottom && scrollContainer) {
			// Use tick-like delay to ensure DOM is updated
			requestAnimationFrame(() => {
				if (scrollContainer) {
					scrollContainer.scrollTop = scrollContainer.scrollHeight;
				}
			});
		}
	});

	function handleScroll() {
		if (!scrollContainer) return;

		const { scrollTop, scrollHeight, clientHeight } = scrollContainer;

		// Check if near bottom (within 100px)
		wasNearBottom = scrollHeight - scrollTop - clientHeight < 100;

		// Load older messages when scrolled near top
		if (scrollTop < 50 && !loadingOlder && hasMoreOlder && messages.length > 0) {
			loadOlderMessages();
		}
	}

	async function loadOlderMessages() {
		if (!syncEngine || loadingOlder || messages.length === 0) return;

		loadingOlder = true;
		const prevScrollHeight = scrollContainer?.scrollHeight ?? 0;

		try {
			const oldestDate = messages[0].dateCreated;
			const count = await syncEngine.loadOlderMessages(chatGuid, oldestDate);
			if (count === 0) {
				hasMoreOlder = false;
			}

			// Preserve scroll position after loading older messages
			requestAnimationFrame(() => {
				if (scrollContainer) {
					const newScrollHeight = scrollContainer.scrollHeight;
					scrollContainer.scrollTop = newScrollHeight - prevScrollHeight;
				}
			});
		} finally {
			loadingOlder = false;
		}
	}

	async function handleSend(text: string) {
		await fetch('/api/proxy/message/text', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				chatGuid,
				message: text,
				method: 'apple-script'
			})
		});
	}

	function handleTypingStart() {
		fetch(`/api/proxy/chat/${encodeURIComponent(chatGuid)}/typing`, {
			method: 'POST'
		});
	}

	function handleTypingStop() {
		fetch(`/api/proxy/chat/${encodeURIComponent(chatGuid)}/typing`, {
			method: 'DELETE'
		});
	}
</script>

<div class="flex h-full flex-col">
	<!-- Header -->
	<header
		class="flex items-center border-b border-gray-200 px-4 py-3 dark:border-gray-700"
	>
		<h2 class="truncate text-base font-semibold dark:text-white">
			{displayName}
		</h2>
		{#if isGroup && chat}
			<span class="ml-2 text-xs text-gray-400">
				{chat.participants.length} members
			</span>
		{/if}
	</header>

	<!-- Messages -->
	<div
		bind:this={scrollContainer}
		onscroll={handleScroll}
		class="flex flex-1 flex-col gap-0.5 overflow-y-auto px-4 py-3"
	>
		{#if loadingOlder}
			<div class="py-2 text-center text-xs text-gray-400">Loading older messages...</div>
		{/if}

		{#each messages as message (message.guid)}
			<MessageBubble
				{message}
				attachments={attachmentMap.get(message.guid) ?? []}
				senderName={getSenderName(message)}
				showSender={isGroup}
			/>
		{:else}
			<div class="flex flex-1 items-center justify-center text-sm text-gray-400">
				No messages yet
			</div>
		{/each}

		{#if typingAddresses.length > 0}
			<div class="mb-1 flex justify-start">
				<div class="rounded-2xl bg-gray-200 px-3 py-2 dark:bg-gray-700">
					<div class="flex items-center gap-1">
						<span class="inline-block h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]"></span>
						<span class="inline-block h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]"></span>
						<span class="inline-block h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]"></span>
					</div>
				</div>
			</div>
		{/if}
	</div>

	<!-- Input -->
	<MessageInput
		{chatGuid}
		onSend={handleSend}
		onTypingStart={handleTypingStart}
		onTypingStop={handleTypingStop}
	/>
</div>

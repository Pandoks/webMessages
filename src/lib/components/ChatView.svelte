<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db } from '$lib/db/index.js';
	import type { DbMessage, DbAttachment, DbChat, DbHandle } from '$lib/db/types.js';
	import type { SyncEngine } from '$lib/sync/engine.svelte.js';
	import type { ScheduledMessage } from '$lib/types/index.js';
	import MessageBubble from './MessageBubble.svelte';
	import MessageInput from './MessageInput.svelte';
	import LocationPanel from './LocationPanel.svelte';
	import { getChatDisplayName, formatPhoneNumber } from '$lib/utils/format.js';
	import { visibilityStore } from '$lib/stores/visibility.svelte.js';
	import { findMyStore } from '$lib/stores/findmy.svelte.js';

	interface Props {
		chatGuid: string;
		syncEngine?: SyncEngine | null;
	}

	let { chatGuid, syncEngine = null }: Props = $props();

	let messages = $state<DbMessage[]>([]);
	let reactionMessages = $state<DbMessage[]>([]);
	let attachmentMap = $state<Map<string, DbAttachment[]>>(new Map());
	let chat = $state<DbChat | undefined>(undefined);
	let handles = $state<DbHandle[]>([]);

	let scrollContainer: HTMLDivElement | undefined = $state();
	let loadingOlder = $state(false);
	let loadingMessages = $state(false);
	let hasMoreOlder = $state(true);
	let wasNearBottom = $state(true);
	let replyTo = $state<{ guid: string; text: string | null; senderName: string } | null>(null);
	let showLocationPanel = $state(false);
	let showScheduled = $state(true);

	// Find sibling chat GUIDs (same contact, different address e.g. phone + email)
	let allChatGuids = $state<string[]>([chatGuid]);

	$effect(() => {
		// Reset to just the primary guid when chat changes
		allChatGuids = [chatGuid];

		// Look up siblings: find other 1:1 chats whose participant resolves to same name
		(async () => {
			const thisChat = await db.chats.get(chatGuid);
			if (!thisChat || thisChat.style !== 45 || thisChat.participants.length !== 1) return;

			const handle = await db.handles.get(thisChat.participants[0]);
			if (!handle?.displayName) return;

			const contactName = handle.displayName;
			const allChats = await db.chats.filter((c) => c.style === 45).toArray();
			const guids: string[] = [];

			for (const c of allChats) {
				if (c.participants.length !== 1) continue;
				const h = await db.handles.get(c.participants[0]);
				if (h?.displayName === contactName) {
					guids.push(c.guid);
				}
			}

			if (guids.length > 1) {
				allChatGuids = guids;
			}
		})();
	});

	// Lazy-load messages when a chat is opened
	$effect(() => {
		if (!syncEngine) return;
		loadingMessages = true;
		// Ensure messages for all sibling chats
		Promise.all(allChatGuids.map((g) => syncEngine!.ensureChatMessages(g))).finally(() => {
			loadingMessages = false;
		});
	});

	// Subscribe to messages for this chat (and siblings)
	$effect(() => {
		const guids = allChatGuids;
		const sub = liveQuery(() =>
			db.messages
				.where('chatGuid')
				.anyOf(guids)
				.filter((m) => m.associatedMessageType === 0 && m.dateCreated <= Date.now())
				.sortBy('dateCreated')
		).subscribe((msgs) => {
			messages = msgs;
		});
		return () => sub.unsubscribe();
	});

	// Subscribe to reaction messages for this chat (and siblings)
	$effect(() => {
		const guids = allChatGuids;
		const sub = liveQuery(() =>
			db.messages
				.where('chatGuid')
				.anyOf(guids)
				.filter((m) => m.associatedMessageType !== 0)
				.toArray()
		).subscribe((msgs) => {
			reactionMessages = msgs;
		});
		return () => sub.unsubscribe();
	});

	// Build a map of messageGuid -> reaction messages
	const reactionMap = $derived.by(() => {
		const map = new Map<string, DbMessage[]>();
		for (const r of reactionMessages) {
			if (!r.associatedMessageGuid) continue;
			// The associatedMessageGuid can have prefixes like "p:0/" or "bp:"
			// Strip the prefix to get the actual message guid
			let targetGuid = r.associatedMessageGuid;
			const slashIndex = targetGuid.indexOf('/');
			if (slashIndex !== -1) {
				targetGuid = targetGuid.substring(slashIndex + 1);
			}
			const existing = map.get(targetGuid) ?? [];
			existing.push(r);
			map.set(targetGuid, existing);
		}
		return map;
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

	// Track whether a read receipt needs to be sent when the app becomes active
	let pendingReadReceipt = $state(false);

	// Mark as read — clear locally always, but only send read receipt when app is active
	$effect(() => {
		if (!chat || chat.unreadCount === 0) return;

		db.chats.update(chatGuid, { unreadCount: 0 });

		if (visibilityStore.isActive) {
			const timer = setTimeout(() => {
				fetch(`/api/proxy/chat/${encodeURIComponent(chatGuid)}/read`, { method: 'POST' });
			}, 2000);
			return () => clearTimeout(timer);
		} else {
			pendingReadReceipt = true;
		}
	});

	// Send deferred read receipt when returning to the app
	$effect(() => {
		if (!visibilityStore.isActive || !pendingReadReceipt) return;

		const timer = setTimeout(() => {
			pendingReadReceipt = false;
			fetch(`/api/proxy/chat/${encodeURIComponent(chatGuid)}/read`, { method: 'POST' });
		}, 2000);
		return () => clearTimeout(timer);
	});

	// Clear reply and pending read receipt when switching chats
	$effect(() => {
		void chatGuid;
		replyTo = null;
		pendingReadReceipt = false;
	});

	let scheduledMessages = $state<ScheduledMessage[]>([]);
	let pendingMutations = $state(0);

	async function fetchScheduledMessages() {
		if (pendingMutations > 0) return;
		try {
			const res = await fetch(`/api/scheduled-messages?chatGuid=${encodeURIComponent(chatGuid)}`);
			if (res.ok) {
				const { data } = await res.json();
				if (pendingMutations === 0) scheduledMessages = data;
			}
		} catch {
			// Silent fail — will retry on next poll
		}
	}

	// Poll scheduled messages every 5s, re-fetch when chatGuid changes
	$effect(() => {
		void chatGuid;
		fetchScheduledMessages();
		const interval = setInterval(fetchScheduledMessages, 5000);
		return () => clearInterval(interval);
	});

	async function handleScheduleSend(text: string, scheduledAt: number) {
		// Optimistic: add a temporary entry immediately
		const tempGuid = `temp-${Date.now()}`;
		scheduledMessages = [...scheduledMessages, {
			guid: tempGuid, chatGuid, text, scheduledAt, scheduleType: 2, scheduleState: 1
		}];

		pendingMutations++;
		try {
			await fetch('/api/scheduled-messages', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ chatGuid, message: text, scheduledAt })
			});
		} finally {
			pendingMutations--;
			await fetchScheduledMessages();
		}
	}

	async function handleEditScheduled(guid: string, message?: string, scheduledAt?: number) {
		// Optimistic: update in place immediately
		scheduledMessages = scheduledMessages.map((sm) =>
			sm.guid === guid
				? { ...sm, ...(message !== undefined && { text: message }), ...(scheduledAt !== undefined && { scheduledAt }) }
				: sm
		);

		const body: Record<string, unknown> = { chatGuid };
		if (message !== undefined) body.message = message;
		if (scheduledAt !== undefined) body.scheduledAt = scheduledAt;

		pendingMutations++;
		fetch(`/api/scheduled-messages/${encodeURIComponent(guid)}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}).then(() => fetchScheduledMessages()).finally(() => { pendingMutations--; });
	}

	async function handleDeleteScheduled(guid: string) {
		// Optimistic: remove immediately
		scheduledMessages = scheduledMessages.filter((sm) => sm.guid !== guid);

		pendingMutations++;
		fetch(
			`/api/scheduled-messages/${encodeURIComponent(guid)}?chatGuid=${encodeURIComponent(chatGuid)}`,
			{ method: 'DELETE' }
		).then(() => fetchScheduledMessages()).finally(() => { pendingMutations--; });
	}

	const handleMap = $derived(new Map(handles.map((h) => [h.address, h.displayName])));

	const displayName = $derived.by(() => {
		if (!chat) return 'Loading...';
		return getChatDisplayName(chat.displayName, chat.participants, handleMap);
	});

	const isGroup = $derived(chat?.style === 43);
	const is1to1 = $derived(chat?.style === 45);
	const participantAddress = $derived(is1to1 && chat?.participants?.length ? chat.participants[0] : null);

	const friendHasLocation = $derived.by(() => {
		if (!participantAddress) return false;
		const friend = findMyStore.friends.find((f) => f.handle === participantAddress);
		return friend !== null && friend !== undefined && friend.latitude !== null && friend.longitude !== null;
	});

	// Fetch Find My friends so we know whether to show the location button
	$effect(() => {
		if (participantAddress && findMyStore.friends.length === 0) {
			findMyStore.fetchFriends();
		}
	});

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

	// Map of message guid -> message text for resolving reply previews
	const messageTextMap = $derived(new Map(messages.map((m) => [m.guid, m.text])));

	function getReplyToText(message: DbMessage): string | null {
		if (!message.threadOriginatorGuid) return null;
		return messageTextMap.get(message.threadOriginatorGuid) ?? null;
	}

	function handleReplyTo(message: DbMessage) {
		replyTo = {
			guid: message.guid,
			text: message.text,
			senderName: getSenderName(message)
		};
	}

	function handleCancelReply() {
		replyTo = null;
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
			// Load older messages from all sibling chats
			const counts = await Promise.all(
				allChatGuids.map((g) => syncEngine!.loadOlderMessages(g, oldestDate))
			);
			const count = counts.reduce((a, b) => a + b, 0);
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
		const tempGuid = crypto.randomUUID();
		const body: Record<string, string> = {
			chatGuid,
			message: text,
			tempGuid
		};
		if (replyTo) {
			body.selectedMessageGuid = replyTo.guid;
		}
		const res = await fetch('/api/proxy/message/text', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (res.ok) {
			const { data } = await res.json();
			const now = data?.dateCreated ?? Date.now();
			const msgGuid = data?.guid ?? tempGuid;
			// Store the sent message locally so it appears immediately
			await db.messages.put({
				guid: msgGuid,
				chatGuid,
				text,
				handleId: 0,
				handleAddress: null,
				isFromMe: true,
				dateCreated: now,
				dateRead: null,
				dateDelivered: null,
				dateEdited: null,
				dateRetracted: null,
				subject: null,
				associatedMessageGuid: null,
				associatedMessageType: 0,
				associatedMessageEmoji: null,
				threadOriginatorGuid: replyTo?.guid ?? null,
				attachmentGuids: [],
				error: 0,
				expressiveSendStyleId: null,
				isDelivered: false,
				groupTitle: null,
				groupActionType: 0,
				isSystemMessage: false,
				itemType: 0
			});
			// Update chat's last message
			await db.chats.update(chatGuid, {
				lastMessageDate: now,
				lastMessageText: text
			});
		}
		replyTo = null;
	}

	async function handleSendAttachment(files: File[], text: string, replyToGuid: string | null) {
		// Send text as a separate message first (imessage-rs attachment API doesn't support inline text)
		if (text) {
			await handleSend(text);
		}

		for (let i = 0; i < files.length; i++) {
			const tempGuid = crypto.randomUUID();
			const formData = new FormData();
			formData.append('chatGuid', chatGuid);
			formData.append('tempGuid', tempGuid);
			if (i === 0 && replyToGuid) formData.append('selectedMessageGuid', replyToGuid);
			formData.append('attachment', files[i]);

			const res = await fetch('/api/proxy/message/attachment', {
				method: 'POST',
				body: formData
			});
			if (res.ok) {
				const { data } = await res.json();
				const now = data?.dateCreated ?? Date.now();
				const msgGuid = data?.guid ?? crypto.randomUUID();

				// Store message in IndexedDB so it appears immediately
				await db.messages.put({
					guid: msgGuid,
					chatGuid,
					text: '\ufffc',
					handleId: 0,
					handleAddress: null,
					isFromMe: true,
					dateCreated: now,
					dateRead: null,
					dateDelivered: null,
					dateEdited: null,
					dateRetracted: null,
					subject: null,
					associatedMessageGuid: null,
					associatedMessageType: 0,
					associatedMessageEmoji: null,
					threadOriginatorGuid: (i === 0 && replyToGuid) ? replyToGuid : null,
					attachmentGuids: data?.attachments?.map((a: { guid: string }) => a.guid) ?? [],
					error: 0,
					expressiveSendStyleId: null,
					isDelivered: data?.isDelivered ?? false,
					groupTitle: null,
					groupActionType: 0,
					isSystemMessage: false,
					itemType: 0
				});

				// Store attachment metadata so it renders inline
				if (data?.attachments) {
					for (const att of data.attachments) {
						await db.attachments.put({
							guid: att.guid,
							messageGuid: msgGuid,
							mimeType: att.mimeType ?? files[i].type ?? null,
							transferName: att.transferName ?? files[i].name,
							totalBytes: att.totalBytes ?? files[i].size,
							width: att.width ?? null,
							height: att.height ?? null,
							hasLivePhoto: att.hasLivePhoto ?? false,
							blurhash: att.blurhash ?? null,
							isSticker: att.isSticker ?? false
						});
					}
				}

				// Update chat's last message
				await db.chats.update(chatGuid, {
					lastMessageDate: now,
					lastMessageText: text || files[i].name
				});
			}
		}
		replyTo = null;
	}

	async function handleReact(messageGuid: string, reaction: string) {
		const res = await fetch('/api/proxy/message/react', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				chatGuid,
				selectedMessageGuid: messageGuid,
				reaction,
				partIndex: 0
			})
		});
		if (res.ok) {
			// Store reaction locally so it appears immediately
			const reactionGuid = crypto.randomUUID();
			await db.messages.put({
				guid: reactionGuid,
				chatGuid,
				text: reaction,
				handleId: 0,
				handleAddress: null,
				isFromMe: true,
				dateCreated: Date.now(),
				dateRead: null,
				dateDelivered: null,
				dateEdited: null,
				dateRetracted: null,
				subject: null,
				associatedMessageGuid: `p:0/${messageGuid}`,
				associatedMessageType: reactionTypeForEmoji(reaction),
				associatedMessageEmoji: reaction,
				threadOriginatorGuid: null,
				attachmentGuids: [],
				error: 0,
				expressiveSendStyleId: null,
				isDelivered: false,
				groupTitle: null,
				groupActionType: 0,
				isSystemMessage: false,
				itemType: 0
			});
		}
	}

	function reactionTypeForEmoji(reaction: string): number {
		const map: Record<string, number> = {
			love: 2000, like: 2001, dislike: 2002,
			laugh: 2003, emphasize: 2004, question: 2005
		};
		return map[reaction] ?? 2000;
	}

	async function handleEdit(messageGuid: string, newText: string) {
		const res = await fetch(`/api/proxy/message/${encodeURIComponent(messageGuid)}/edit`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				editedMessage: newText,
				backwardsCompatibilityMessage: newText,
				partIndex: 0
			})
		});
		if (res.ok) {
			await db.messages.update(messageGuid, {
				text: newText,
				dateEdited: Date.now()
			});
		}
	}

	async function handleUnsend(messageGuid: string) {
		const res = await fetch(`/api/proxy/message/${encodeURIComponent(messageGuid)}/unsend`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ partIndex: 0 })
		});
		if (res.ok) {
			const msg = await db.messages.get(messageGuid);
			await db.messages.update(messageGuid, {
				text: null,
				dateRetracted: Date.now()
			});
			// Update chat preview if this was the latest message
			if (msg && chat && msg.dateCreated >= chat.lastMessageDate) {
				await db.chats.update(chatGuid, { lastMessageText: 'You unsent a message' });
			}
		}
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
		<div class="ml-auto flex items-center gap-1">
			{#if is1to1 && participantAddress && friendHasLocation}
				<button
					onclick={() => (showLocationPanel = !showLocationPanel)}
					class="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
					class:text-blue-500={showLocationPanel}
					class:dark:text-blue-400={showLocationPanel}
					aria-label="Toggle location panel"
					title="Show location"
				>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
					</svg>
				</button>
			{/if}
		</div>
	</header>

	<!-- Messages + Location Panel -->
	<div class="flex min-h-0 flex-1">
		<!-- Messages -->
		<div
			bind:this={scrollContainer}
			onscroll={handleScroll}
			class="flex min-w-0 flex-1 flex-col gap-0.5 overflow-y-auto px-4 py-3"
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
					reactions={reactionMap.get(message.guid) ?? []}
					onReact={handleReact}
					onReply={handleReplyTo}
					onEdit={handleEdit}
					onUnsend={handleUnsend}
					replyToText={getReplyToText(message)}
				/>
			{:else}
				<div class="flex flex-1 items-center justify-center text-sm text-gray-400">
					{#if loadingMessages}Loading messages...{:else}No messages yet{/if}
				</div>
			{/each}

			<!-- Collapsible Scheduled Messages section -->
			{#if scheduledMessages.length > 0}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="my-3 flex items-center gap-3" onclick={() => (showScheduled = !showScheduled)}>
					<div class="h-px flex-1 bg-blue-300 dark:bg-blue-700"></div>
					<button
						class="flex items-center gap-1.5 rounded-full border border-blue-300 px-3 py-1 text-xs font-medium text-blue-500 transition-colors hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/20"
					>
						<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
						Scheduled Messages ({scheduledMessages.length})
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-3 w-3 transition-transform {showScheduled ? 'rotate-180' : ''}"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="2"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
						</svg>
					</button>
					<div class="h-px flex-1 bg-blue-300 dark:bg-blue-700"></div>
				</div>

				{#if showScheduled}
					{#each scheduledMessages as sm (sm.guid)}
						<MessageBubble
							message={{
								guid: sm.guid,
								chatGuid: sm.chatGuid,
								text: sm.text,
								handleId: 0,
								handleAddress: null,
								isFromMe: true,
								dateCreated: sm.scheduledAt,
								dateRead: null,
								dateDelivered: null,
								dateEdited: null,
								dateRetracted: null,
								subject: null,
								associatedMessageGuid: null,
								associatedMessageType: 0,
								associatedMessageEmoji: null,
								threadOriginatorGuid: null,
								attachmentGuids: [],
								error: 0,
								expressiveSendStyleId: null,
								isDelivered: false,
								groupTitle: null,
								groupActionType: 0,
								isSystemMessage: false,
								itemType: 0
							}}
							attachments={[]}
							senderName="Me"
							showSender={false}
							reactions={[]}
							onReact={handleReact}
							onReply={handleReplyTo}
							onEdit={handleEdit}
							onUnsend={handleUnsend}
							replyToText={null}
							onSaveScheduleEdit={(guid, message, scheduledAt) => handleEditScheduled(guid, message, scheduledAt)}
							onCancelSchedule={(guid) => handleDeleteScheduled(guid)}
						/>
					{/each}
				{/if}
			{/if}

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

		<!-- Location Panel -->
		{#if showLocationPanel && participantAddress}
			<LocationPanel address={participantAddress} onClose={() => (showLocationPanel = false)} />
		{/if}
	</div>

	<!-- Input -->
	<MessageInput
		{chatGuid}
		onSend={handleSend}
		onSendAttachment={handleSendAttachment}
		onTypingStart={handleTypingStart}
		onTypingStop={handleTypingStop}
		{replyTo}
		onCancelReply={handleCancelReply}
		onScheduleSend={handleScheduleSend}
	/>
</div>

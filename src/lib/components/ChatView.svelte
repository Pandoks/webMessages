<script lang="ts">
	import { untrack } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import MessageThread from '$lib/components/MessageThread.svelte';
	import MessageInput from '$lib/components/MessageInput.svelte';
	import { getConnectionState } from '$lib/stores/connection.svelte.js';
	import { getChatStore } from '$lib/stores/chats.svelte.js';
	import {
		loadChat,
		loadOlderMessages,
		addOptimisticMessage,
		removeOptimisticMessage,
		applyLocalMessageEdit
	} from '$lib/stores/sync.svelte.js';
	import type { Message } from '$lib/types/index.js';

	let { chatId }: { chatId: number } = $props();

	const connection = getConnectionState();
	const chatStore = getChatStore();

	let sending = $state(false);
	let loadingOlder = $state(false);
	let hasMore = $state(true);
	let replyingTo: Message | null = $state(null);
	let editingMessage: Message | null = $state(null);
	let composerFocusToken = $state(0);
	let lastLoadedChatId: number | null = $state(null);

	const chat = $derived(chatStore.chats.find((c) => c.rowid === chatId) ?? null);
	const allMessages = $derived(chatStore.getMessages(chatId));
	const participants = $derived(chatStore.getParticipants(chatId));

	// Load chat data when chatId changes
	$effect(() => {
		if (chatId === lastLoadedChatId) return;
		lastLoadedChatId = chatId;

		const id = chatId;
		hasMore = true;
		loadingOlder = false;
		replyingTo = null;
		editingMessage = null;
		// Prevent loadChat internals from becoming effect dependencies.
		untrack(() => {
			loadChat(id);
		});
	});

	// Mark chat as read when opened
	let lastMarkedChatGuid: string | null = null;
	$effect(() => {
		if (chat?.guid && chat.guid !== lastMarkedChatGuid) {
			lastMarkedChatGuid = chat.guid;
			fetch('/api/mark-read', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ chatGuid: chat.guid })
			}).catch(() => {});
		}
	});

	async function loadMore() {
		if (loadingOlder || !hasMore) return;
		loadingOlder = true;

		try {
			const oldestDate = allMessages[0]?.date ?? Infinity;
			const result = await loadOlderMessages(chatId, oldestDate, allMessages.length);
			hasMore = result.hasMore;
		} catch (err) {
			console.error('Failed to load older messages:', err);
		} finally {
			loadingOlder = false;
		}
	}

	async function handleSendFile(file: File) {
		if (!chat) return;
		sending = true;
		try {
			const formData = new FormData();
			formData.append('file', file);
			formData.append('chatGuid', chat.guid);

			const res = await fetch('/api/attachments/upload', {
				method: 'POST',
				body: formData
			});
			if (!res.ok) {
				console.error('Failed to send attachment');
			}
		} catch (err) {
			console.error('Upload error:', err);
		} finally {
			sending = false;
		}
	}

	async function handleReact(message: Message, reactionType: number) {
		if (!chat) return;
		await fetch('/api/react', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ chatGuid: chat.guid, messageGuid: message.guid, reactionType })
		}).catch((err) => console.error('React error:', err));
	}

	async function handleSend(text: string) {
		if (!chat) return;
		sending = true;
		const editTarget = editingMessage;
		const editGuid = editTarget?.guid ?? null;
		if (editTarget && editGuid) {
			try {
				const res = await fetch('/api/edit', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						chatGuid: chat.guid,
						messageGuid: editGuid,
						text
					})
				});
				if (!res.ok) {
					console.error('Failed to edit message');
					return;
				}
				applyLocalMessageEdit(chatId, editGuid, text);
				editingMessage = null;
			} catch (err) {
				console.error('Edit error:', err);
			} finally {
				sending = false;
			}
			return;
		}

		const isReply = !!replyingTo;
		const replyGuid = replyingTo?.guid ?? null;
		const optimistic: Message = {
			rowid: -Date.now(),
			guid: `temp-${Date.now()}`,
			text,
			handle_id: 0,
			service: chat.service_name,
			is_from_me: true,
			date: Date.now(),
			date_read: null,
			date_delivered: null,
			date_retracted: null,
			date_edited: null,
			is_delivered: false,
			is_sent: false,
			is_read: false,
			cache_has_attachments: false,
			associated_message_type: 0,
			associated_message_guid: null,
			associated_message_emoji: null,
			thread_originator_guid: replyGuid,
			thread_originator_part: null,
			group_title: null,
			group_action_type: 0,
			item_type: 0,
			other_handle: 0,
			chat_id: chatId,
			sender: 'Me',
			body: text
		};
		replyingTo = null;
		addOptimisticMessage(chatId, optimistic);

		try {
			let res: Response;
			if (isReply && replyGuid) {
				res = await fetch('/api/reply', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						chatGuid: chat.guid,
						messageGuid: replyGuid,
						text
					})
				});
			} else {
				res = await fetch('/api/messages', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						chatGuid: chat.guid,
						text
					})
				});
			}
			if (!res.ok) {
				console.error('Failed to send message');
				removeOptimisticMessage(chatId, optimistic.guid);
			}
		} catch (err) {
			console.error('Send error:', err);
			removeOptimisticMessage(chatId, optimistic.guid);
		} finally {
			sending = false;
		}
	}
</script>

{#if chat}
	<div class="flex h-full flex-col">
		<Header {chat} {participants} />
		<MessageThread
			messages={allMessages}
			isGroup={chat.style === 43}
			onLoadMore={loadMore}
			{hasMore}
			loading={loadingOlder}
			onReact={handleReact}
			onReply={(msg) => {
				editingMessage = null;
				replyingTo = msg;
				composerFocusToken += 1;
			}}
			onEdit={(msg) => {
				replyingTo = null;
				editingMessage = msg;
				composerFocusToken += 1;
			}}
			onUnsend={async (msg) => {
				if (!chat) return;
				try {
					const res = await fetch('/api/unsend', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							chatGuid: chat.guid,
							messageGuid: msg.guid
						})
					});
					if (!res.ok) {
						const payload = await res.json().catch(() => ({}));
						console.error('Failed to unsend message:', payload.error ?? res.statusText);
						return;
					}
					// Do not optimistic-unsend locally; wait for DB/SSE truth.
					// Force refresh shortly after bridge reports success.
					setTimeout(() => {
						loadChat(chatId);
					}, 1200);
				} catch (err) {
					console.error('Unsend error:', err);
				}
			}}
		/>
		<MessageInput
			onSend={handleSend}
			onSendFile={handleSendFile}
			disabled={sending}
			offline={!connection.connected}
			replyTo={replyingTo ?? undefined}
			editTo={editingMessage ?? undefined}
			focusToken={composerFocusToken}
			onCancelReply={() => { replyingTo = null; }}
			onCancelEdit={() => { editingMessage = null; }}
		/>
	</div>
{/if}

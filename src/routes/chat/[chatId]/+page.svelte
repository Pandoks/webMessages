<script lang="ts">
	import type { PageProps } from './$types';
	import type { Message } from '$lib/types/index.js';
	import Header from '$lib/components/Header.svelte';
	import MessageThread from '$lib/components/MessageThread.svelte';
	import MessageInput from '$lib/components/MessageInput.svelte';
	import { onNewMessages } from '$lib/stores/connection.svelte.js';
	import { cacheMessages } from '$lib/db/client-db.js';
	import { onMount } from 'svelte';
	import { page } from '$app/state';

	let { data }: PageProps = $props();

	let sending = $state(false);
	let liveMessages: Message[] = $state([]);
	let olderMessages: Message[] = $state([]);
	let loadingOlder = $state(false);
	let hasMore = $state(true);
	let currentOffset = $state(0);

	const PAGE_SIZE = 100;

	// Combine all messages: older + server-loaded + live SSE
	const allMessages = $derived([...olderMessages, ...data.messages, ...liveMessages]);

	// Reset state when navigating to a different chat
	$effect(() => {
		page.params.chatId;
		liveMessages = [];
		olderMessages = [];
		hasMore = true;
		currentOffset = 0;
	});

	// Cache messages in IndexedDB when they load
	$effect(() => {
		if (data.messages.length > 0) {
			cacheMessages(data.messages);
		}
	});

	onMount(() => {
		currentOffset = data.messages.length;

		const unsubscribe = onNewMessages((events) => {
			const chatId = parseInt(page.params.chatId, 10);
			const relevant = events
				.filter((e) => e.chatId === chatId)
				.map((e) => e.message)
				.filter((m) => !allMessages.some((existing) => existing.guid === m.guid));
			if (relevant.length > 0) {
				liveMessages = [...liveMessages, ...relevant];
				cacheMessages(relevant);
			}
		});
		return unsubscribe;
	});

	async function loadMore() {
		if (loadingOlder || !hasMore) return;
		loadingOlder = true;

		try {
			const chatId = page.params.chatId;
			const res = await fetch(
				`/api/messages/${chatId}?limit=${PAGE_SIZE}&offset=${currentOffset + olderMessages.length}`
			);
			const json = await res.json();
			const older: Message[] = json.messages;

			if (older.length < PAGE_SIZE) {
				hasMore = false;
			}

			if (older.length > 0) {
				olderMessages = [...older, ...olderMessages];
				cacheMessages(older);
			}
		} catch (err) {
			console.error('Failed to load older messages:', err);
		} finally {
			loadingOlder = false;
		}
	}

	async function handleSendFile(file: File) {
		sending = true;
		try {
			const formData = new FormData();
			formData.append('file', file);
			formData.append('chatGuid', data.chat.guid);

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

	async function handleSend(text: string) {
		sending = true;
		const optimistic: Message = {
			rowid: -Date.now(),
			guid: `temp-${Date.now()}`,
			text,
			handle_id: 0,
			service: data.chat.service_name,
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
			thread_originator_guid: null,
			thread_originator_part: null,
			group_title: null,
			group_action_type: 0,
			item_type: 0,
			other_handle: 0,
			chat_id: parseInt(page.params.chatId, 10),
			sender: 'Me',
			body: text
		};
		liveMessages = [...liveMessages, optimistic];

		try {
			const res = await fetch('/api/messages', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					chatGuid: data.chat.guid,
					text
				})
			});
			if (!res.ok) {
				console.error('Failed to send message');
				liveMessages = liveMessages.filter((m) => m.guid !== optimistic.guid);
			}
		} catch (err) {
			console.error('Send error:', err);
			liveMessages = liveMessages.filter((m) => m.guid !== optimistic.guid);
		} finally {
			sending = false;
		}
	}
</script>

<div class="flex h-full flex-col">
	<Header chat={data.chat} participants={data.participants} />
	<MessageThread
		messages={allMessages}
		isGroup={data.chat.style === 43}
		onLoadMore={loadMore}
		{hasMore}
		loading={loadingOlder}
	/>
	<MessageInput onSend={handleSend} onSendFile={handleSendFile} disabled={sending} />
</div>

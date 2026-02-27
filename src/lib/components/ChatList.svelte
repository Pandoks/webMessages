<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db } from '$lib/db/index.js';
	import { page } from '$app/state';
	import ChatListItem from './ChatListItem.svelte';
	import { getChatDisplayName } from '$lib/utils/format.js';
	import type { DbChat, DbHandle } from '$lib/db/types.js';

	let search = $state('');
	let allChats = $state<DbChat[]>([]);
	let allHandles = $state<DbHandle[]>([]);

	// Subscribe to liveQuery via $effect
	$effect(() => {
		const sub = liveQuery(() =>
			db.chats.orderBy('lastMessageDate').reverse().toArray()
		).subscribe((chats) => {
			allChats = chats;
		});
		return () => sub.unsubscribe();
	});

	$effect(() => {
		const sub = liveQuery(() => db.handles.toArray()).subscribe((handles) => {
			allHandles = handles;
		});
		return () => sub.unsubscribe();
	});

	const handleMap = $derived(new Map(allHandles.map((h) => [h.address, h.displayName])));

	const sortedChats = $derived.by(() => {
		const filtered = search
			? allChats.filter((c) => {
					const name = getChatDisplayName(c.displayName, c.participants, handleMap);
					return name.toLowerCase().includes(search.toLowerCase());
				})
			: allChats;

		return [...filtered].sort((a, b) => {
			if (a.isPinned && !b.isPinned) return -1;
			if (!a.isPinned && b.isPinned) return 1;
			return b.lastMessageDate - a.lastMessageDate;
		});
	});

	const activeChatGuid = $derived(
		page.url.pathname.startsWith('/messages/')
			? decodeURIComponent(page.url.pathname.split('/messages/')[1] ?? '')
			: ''
	);
</script>

<div class="flex h-full flex-col">
	<div class="p-3">
		<input
			bind:value={search}
			type="text"
			placeholder="Search conversations..."
			class="w-full rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
		/>
	</div>
	<div class="flex-1 overflow-y-auto">
		{#each sortedChats as chat (chat.guid)}
			<ChatListItem
				guid={chat.guid}
				displayName={getChatDisplayName(chat.displayName, chat.participants, handleMap)}
				lastMessage={chat.lastMessageText}
				lastMessageDate={chat.lastMessageDate}
				unreadCount={chat.unreadCount}
				isActive={chat.guid === activeChatGuid}
			/>
		{:else}
			<p class="p-4 text-center text-sm text-gray-400">No conversations</p>
		{/each}
	</div>
</div>

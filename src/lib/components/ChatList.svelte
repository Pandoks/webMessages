<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db } from '$lib/db/index.js';
	import { page } from '$app/state';
	import ChatListItem from './ChatListItem.svelte';
	import NewChatModal from './NewChatModal.svelte';
	import { getChatDisplayName } from '$lib/utils/format.js';
	import type { DbChat, DbHandle } from '$lib/db/types.js';

	let search = $state('');
	let newChatOpen = $state(false);
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
		<div class="flex items-center gap-2">
			<input
				bind:value={search}
				type="text"
				placeholder="Search conversations..."
				class="flex-1 rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
			/>
			<button
				onclick={() => (newChatOpen = true)}
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
				aria-label="New conversation"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
				</svg>
			</button>
		</div>
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

<NewChatModal open={newChatOpen} onClose={() => (newChatOpen = false)} />

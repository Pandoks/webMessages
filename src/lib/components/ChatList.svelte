<script lang="ts">
	import type { Chat } from '$lib/types/index.js';
	import ChatListItem from './ChatListItem.svelte';
	import NewChat from './NewChat.svelte';
	import SearchModal from './SearchModal.svelte';

	let { chats, navigatingToChatId }: { chats: Chat[]; navigatingToChatId?: string } = $props();
	let searchQuery = $state('');
	let showNewChat = $state(false);
	let showSearch = $state(false);

	const filteredChats = $derived.by(() => {
		if (!searchQuery.trim()) return chats;
		const q = searchQuery.toLowerCase();
		return chats.filter(
			(c) =>
				c.display_name?.toLowerCase().includes(q) ||
				c.chat_identifier.toLowerCase().includes(q) ||
				c.last_message?.body?.toLowerCase().includes(q)
		);
	});
</script>

<div class="flex h-full flex-col border-r border-gray-200 bg-white">
	<!-- Header -->
	<div class="flex items-center justify-between border-b border-gray-200 px-4 py-3">
		<h1 class="text-xl font-bold text-gray-900">Messages</h1>
		<div class="flex gap-1">
			<button
				onclick={() => { showSearch = true; }}
				aria-label="Search messages"
				class="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
			>
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
				</svg>
			</button>
			<button
				onclick={() => { showNewChat = true; }}
				aria-label="New conversation"
				class="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
			>
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
				</svg>
			</button>
		</div>
	</div>

	<!-- Filter bar -->
	<div class="px-3 py-2">
		<input
			type="text"
			placeholder="Filter conversations..."
			bind:value={searchQuery}
			class="w-full rounded-lg bg-gray-100 px-4 py-2 text-sm outline-none placeholder:text-gray-400 focus:ring-2 focus:ring-blue-300"
		/>
	</div>

	<!-- Chat list -->
	<div class="flex-1 overflow-y-auto">
		{#each filteredChats as chat (chat.rowid)}
			<ChatListItem {chat} {navigatingToChatId} />
		{/each}
		{#if filteredChats.length === 0}
			<div class="p-4 text-center text-sm text-gray-400">
				{searchQuery ? 'No conversations found' : 'No conversations'}
			</div>
		{/if}
	</div>
</div>

<NewChat bind:open={showNewChat} />
<SearchModal bind:open={showSearch} />

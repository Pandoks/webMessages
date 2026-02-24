<script lang="ts">
	import type { Chat } from '$lib/types/index.js';
	import ChatListItem from './ChatListItem.svelte';
	import NewChat from './NewChat.svelte';

	let { chats, navigatingToChatId }: { chats: Chat[]; navigatingToChatId?: string } = $props();
	let showNewChat = $state(false);

	const filteredChats = $derived.by(() => chats);
	const pinnedChats = $derived.by(() => {
		return filteredChats
			.filter((chat) => !!chat.is_pinned)
			.sort((a, b) => {
				const rankA = a.pin_rank ?? Number.POSITIVE_INFINITY;
				const rankB = b.pin_rank ?? Number.POSITIVE_INFINITY;
				if (rankA !== rankB) return rankA - rankB;
				return (b.last_message?.date ?? 0) - (a.last_message?.date ?? 0);
			});
	});
	const unpinnedChats = $derived.by(() => filteredChats.filter((chat) => !chat.is_pinned));
</script>

<div class="flex h-full flex-col border-r border-gray-200 bg-white">
	<!-- Header -->
	<div class="flex items-center justify-between border-b border-gray-200 px-4 py-3">
		<h1 class="text-xl font-bold text-gray-900">Messages</h1>
		<div class="flex gap-1">
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

	{#if pinnedChats.length > 0}
		<div class="shrink-0 border-b border-gray-200 bg-white">
			<div class="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
				Pinned
			</div>
			<div class="max-h-72 overflow-y-auto">
				{#each pinnedChats as chat (chat.rowid)}
					<ChatListItem {chat} {navigatingToChatId} />
				{/each}
			</div>
		</div>
	{/if}

	<!-- Unpinned chat list -->
	<div class="min-h-0 flex-1 overflow-y-auto">
		{#each unpinnedChats as chat (chat.rowid)}
			<ChatListItem {chat} {navigatingToChatId} />
		{/each}
		{#if filteredChats.length === 0}
			{#each Array(8) as _}
				<div class="flex items-center gap-3 px-4 py-3">
					<div class="h-12 w-12 shrink-0 animate-pulse rounded-full bg-gray-200"></div>
					<div class="flex-1">
						<div class="h-4 w-28 animate-pulse rounded bg-gray-200"></div>
						<div class="mt-2 h-3 w-44 animate-pulse rounded bg-gray-100"></div>
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>

<NewChat bind:open={showNewChat} />

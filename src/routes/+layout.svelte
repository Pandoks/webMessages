<script lang="ts">
	import '../app.css';
	import type { LayoutProps } from './$types';
	import ChatList from '$lib/components/ChatList.svelte';
	import { page, navigating } from '$app/state';
	import { connect, disconnect, getConnectionState } from '$lib/stores/connection.svelte.js';
	import { onMount } from 'svelte';

	let { children, data }: LayoutProps = $props();

	const hasChatSelected = $derived(!!page.params.chatId);
	const connection = getConnectionState();

	// Detect when navigating to a chat (for loading state)
	const isNavigatingToChat = $derived(
		navigating.to?.params?.chatId != null && navigating.to.params.chatId !== page.params.chatId
	);

	onMount(() => {
		connect();
		return disconnect;
	});
</script>

<div class="flex h-screen">
	<!-- Sidebar -->
	<div class="w-80 shrink-0 {hasChatSelected ? 'hidden md:block' : ''}
		md:w-80 lg:w-96">
		<ChatList chats={data.chats} navigatingToChatId={navigating.to?.params?.chatId} />
	</div>

	<!-- Main content -->
	<div class="flex flex-1 flex-col {!hasChatSelected ? 'hidden md:flex' : 'flex'}">
		{#if isNavigatingToChat}
			<!-- Loading skeleton while navigating to a new chat -->
			<div class="flex h-full flex-col">
				<div class="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
					<div class="h-9 w-9 animate-pulse rounded-full bg-gray-200"></div>
					<div class="flex-1">
						<div class="h-4 w-32 animate-pulse rounded bg-gray-200"></div>
						<div class="mt-1 h-3 w-20 animate-pulse rounded bg-gray-100"></div>
					</div>
				</div>
				<div class="flex flex-1 flex-col gap-3 px-4 py-6">
					{#each [1, 2, 3, 4, 5] as _}
						<div class="flex {_ % 2 === 0 ? 'justify-end' : 'justify-start'}">
							<div class="h-10 animate-pulse rounded-2xl bg-gray-100"
								style="width: {100 + Math.random() * 150}px"></div>
						</div>
					{/each}
				</div>
			</div>
		{:else}
			{@render children()}
		{/if}
	</div>

	<!-- Connection indicator -->
	{#if !connection.connected}
		<div class="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-yellow-500 px-3 py-1 text-xs font-medium text-white shadow-lg">
			Reconnecting...
		</div>
	{/if}
</div>

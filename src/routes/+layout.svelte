<script lang="ts">
	import '../app.css';
	import ChatList from '$lib/components/ChatList.svelte';
	import ChatView from '$lib/components/ChatView.svelte';
	import { page, navigating } from '$app/state';
	import { getConnectionState } from '$lib/stores/connection.svelte.js';
	import { getChatStore } from '$lib/stores/chats.svelte.js';
	import { initSync, setupReconnectionHandler } from '$lib/stores/sync.svelte.js';
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	const connection = getConnectionState();
	const chatStore = getChatStore();

	const shallowChatId = $derived((page.state as any)?.chatId as number | undefined);
	const hasChatSelected = $derived(!!page.params.chatId || !!shallowChatId);

	onMount(() => {
		const cleanup = initSync();
		const checkReconnection = setupReconnectionHandler();

		const reconnectInterval = setInterval(checkReconnection, 1000);

		return () => {
			cleanup();
			clearInterval(reconnectInterval);
		};
	});
</script>

<div class="flex h-screen">
	<!-- Sidebar -->
	<div class="w-80 shrink-0 {hasChatSelected ? 'hidden md:block' : ''}
		md:w-80 lg:w-96">
		<ChatList chats={chatStore.chats} navigatingToChatId={navigating.to?.params?.chatId} />
	</div>

	<!-- Main content -->
	<div class="flex min-w-0 flex-1 flex-col {!hasChatSelected ? 'hidden md:flex' : 'flex'}">
		{#if shallowChatId}
			<!-- Instant cached view via pushState -->
			<ChatView chatId={shallowChatId} />
		{:else}
			{@render children()}
		{/if}
	</div>

	<!-- Connection indicator -->
	{#if connection.isOffline}
		<div class="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-red-500 px-3 py-1 text-xs font-medium text-white shadow-lg">
			Offline — showing cached data
		</div>
	{:else if !connection.connected}
		<div class="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-yellow-500 px-3 py-1 text-xs font-medium text-white shadow-lg">
			Reconnecting...
		</div>
	{/if}
</div>

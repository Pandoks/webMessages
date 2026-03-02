<script lang="ts">
	import './layout.css';
	import { onMount, setContext } from 'svelte';
	import { page } from '$app/state';
	import ModeToggle from '$lib/components/ModeToggle.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { syncEngine } from '$lib/stores/sync.js';
	import { visibilityStore } from '$lib/stores/visibility.svelte.js';
	import faviconMessages from '$lib/assets/favicon-messages.svg';
	import faviconFindmy from '$lib/assets/favicon-findmy.svg';

	let { children } = $props();

	let favicon = $derived(page.url.pathname.startsWith('/findmy') ? faviconFindmy : faviconMessages);

	setContext('syncEngine', syncEngine);

	onMount(() => {
		visibilityStore.start();
		syncEngine.start();
		return () => {
			visibilityStore.stop();
			syncEngine.stop();
		};
	});
</script>

<svelte:head>
	<title>webMessages</title>
	<link rel="icon" type="image/svg+xml" href={favicon} />
</svelte:head>

<div class="flex h-screen flex-col bg-white dark:bg-gray-900">
	<header
		class="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-700"
	>
		<div class="flex items-center gap-2">
			<ModeToggle />
			{#if syncEngine.syncing}
				<span class="text-xs text-gray-400">Syncing...</span>
			{/if}
		</div>
		<ThemeToggle />
	</header>
	<main class="flex min-h-0 flex-1">
		{@render children()}
	</main>
</div>

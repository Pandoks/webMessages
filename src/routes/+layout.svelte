<script lang="ts">
	import './layout.css';
	import { onMount, setContext } from 'svelte';
	import ModeToggle from '$lib/components/ModeToggle.svelte';
	import { syncEngine } from '$lib/stores/sync.js';

	let { children } = $props();

	setContext('syncEngine', syncEngine);

	onMount(() => {
		syncEngine.start();
		return () => syncEngine.stop();
	});
</script>

<svelte:head>
	<title>webMessages</title>
</svelte:head>

<div class="flex h-screen flex-col bg-white dark:bg-gray-900">
	<header class="flex items-center justify-center border-b border-gray-200 px-4 py-2 dark:border-gray-700">
		<ModeToggle />
		{#if syncEngine.syncing}
			<span class="ml-2 text-xs text-gray-400">Syncing...</span>
		{/if}
	</header>
	<main class="flex min-h-0 flex-1">
		{@render children()}
	</main>
</div>

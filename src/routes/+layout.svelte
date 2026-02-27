<script lang="ts">
	import './layout.css';
	import ModeToggle from '$lib/components/ModeToggle.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<title>webMessages</title>
</svelte:head>

<div class="flex h-screen flex-col bg-white dark:bg-gray-900">
	<header class="flex items-center justify-center border-b border-gray-200 px-4 py-2 dark:border-gray-700">
		<ModeToggle />
	</header>
	<main class="flex min-h-0 flex-1">
		{@render children()}
	</main>
</div>

<script lang="ts">
	import ChatList from '$lib/components/ChatList.svelte';

	let { children } = $props();
</script>

<div class="flex h-full w-full">
	<aside class="flex w-80 flex-col border-r border-gray-200 dark:border-gray-700">
		<ChatList />
	</aside>
	<div class="flex flex-1 flex-col">
		{@render children()}
	</div>
</div>

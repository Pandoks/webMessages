<script lang="ts">
	let { children } = $props();
</script>

<div class="flex h-full w-full">
	<aside class="flex w-80 flex-col border-r border-gray-200 dark:border-gray-700">
		<div class="p-4 text-sm text-gray-500">Chat list will go here</div>
	</aside>
	<div class="flex flex-1 flex-col">
		{@render children()}
	</div>
</div>

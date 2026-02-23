<script lang="ts">
	import type { Message } from '$lib/types/index.js';

	let { originalMessage }: { originalMessage: Message | undefined } = $props();
</script>

{#if originalMessage}
	<div class="mb-1 rounded-lg border-l-2 border-gray-300 bg-gray-100/50 px-2 py-1 text-xs text-gray-500">
		<span class="font-medium">{originalMessage.sender ?? 'Unknown'}</span>
		<p class="truncate">{originalMessage.body ?? ''}</p>
	</div>
{/if}

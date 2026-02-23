<script lang="ts">
	import type { Reaction } from '$lib/types/index.js';

	let { reactions }: { reactions: Reaction[] } = $props();

	// Group reactions by emoji
	const grouped = $derived.by(() => {
		const map = new Map<string, number>();
		for (const r of reactions) {
			const emoji = r.emoji || '';
			if (emoji) {
				map.set(emoji, (map.get(emoji) ?? 0) + 1);
			}
		}
		return Array.from(map.entries());
	});
</script>

{#if grouped.length > 0}
	<div class="mt-0.5 flex gap-1">
		{#each grouped as [emoji, count]}
			<span class="inline-flex items-center gap-0.5 rounded-full border border-gray-200 bg-white px-1.5 py-0.5 text-xs shadow-sm">
				{emoji}
				{#if count > 1}
					<span class="text-[10px] text-gray-500">{count}</span>
				{/if}
			</span>
		{/each}
	</div>
{/if}

<script lang="ts">
	interface Props {
		reactions: { emoji: string; count: number; fromMe: boolean }[];
	}

	let { reactions }: Props = $props();
</script>

{#if reactions.length > 0}
	<div class="mt-0.5 flex gap-1">
		{#each reactions as r}
			<span
				class="inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs
					{r.fromMe
					? 'border-blue-300 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/30'
					: 'border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-800'}"
			>
				{r.emoji}
				{#if r.count > 1}<span class="text-gray-500">{r.count}</span>{/if}
			</span>
		{/each}
	</div>
{/if}

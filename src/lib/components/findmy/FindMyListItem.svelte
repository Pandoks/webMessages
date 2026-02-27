<script lang="ts">
	import { formatRelativeTime } from '$lib/utils/format.js';

	interface Props {
		id: string;
		name: string;
		lastUpdated: number | null;
		isStarred: boolean;
		isSelected: boolean;
		onSelect: (id: string) => void;
		onToggleStar: (id: string) => void;
	}

	let { id, name, lastUpdated, isStarred, isSelected, onSelect, onToggleStar }: Props = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	onclick={() => onSelect(id)}
	onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(id); } }}
	role="button"
	tabindex="0"
	class="group relative flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800
		{isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''}"
>
	<div class="flex min-w-0 flex-1 flex-col">
		<span class="truncate text-sm font-medium dark:text-white">{name}</span>
		<span class="text-xs text-gray-500 dark:text-gray-400">
			{#if lastUpdated}
				Last updated: {formatRelativeTime(lastUpdated)}
			{:else}
				Locating...
			{/if}
		</span>
	</div>
	<button
		onclick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleStar(id); }}
		class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-all
			{isStarred ? 'text-yellow-400 opacity-100' : 'text-gray-400 opacity-0 group-hover:opacity-100 hover:text-yellow-400'}"
		aria-label={isStarred ? 'Unstar' : 'Star'}
	>
		<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill={isStarred ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
		</svg>
	</button>
</div>

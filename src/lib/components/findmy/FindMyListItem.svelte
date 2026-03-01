<script lang="ts">
	interface Props {
		id: string;
		name: string;
		subtitle: string;
		distance?: string | null;
		isStarred: boolean;
		isSelected: boolean;
		onSelect: (id: string) => void;
		onToggleStar: (id: string) => void;
		avatarUrl?: string | null;
		emoji?: string | null;
	}

	let { id, name, subtitle, distance = null, isStarred, isSelected, onSelect, onToggleStar, avatarUrl = null, emoji = null }: Props = $props();

	const avatarColors = [
		'#3b82f6', '#22c55e', '#f97316', '#a855f7',
		'#ec4899', '#14b8a6', '#ef4444', '#6366f1'
	];

	function getColor(n: string): string {
		let hash = 0;
		for (let i = 0; i < n.length; i++) hash = n.charCodeAt(i) + ((hash << 5) - hash);
		return avatarColors[Math.abs(hash) % avatarColors.length];
	}

	function getInitials(n: string): string {
		return n.replace(/[^\p{L}\p{N}\s]/gu, '').trim().split(/\s+/).slice(0, 2)
			.map((w) => w[0]?.toUpperCase() ?? '').join('');
	}
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
	<!-- Avatar / Emoji icon -->
	{#if avatarUrl}
		<img src={avatarUrl} alt={name} class="h-9 w-9 shrink-0 rounded-full object-cover" />
	{:else if emoji}
		<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-lg dark:bg-gray-800">
			{emoji}
		</div>
	{:else}
		<div
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
			style="background: {getColor(name)}"
		>
			{getInitials(name) || '?'}
		</div>
	{/if}

	<div class="flex min-w-0 flex-1 flex-col">
		<span class="truncate text-sm font-medium dark:text-white">{name}</span>
		<span class="truncate text-xs text-gray-500 dark:text-gray-400">{subtitle}</span>
	</div>
	{#if distance}
		<span class="shrink-0 text-xs text-gray-400 dark:text-gray-500">{distance}</span>
	{/if}
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

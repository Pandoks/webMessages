<script lang="ts">
	interface Props {
		name: string;
		avatar?: string | null;
		size?: 'sm' | 'md' | 'lg';
	}

	let { name, avatar = null, size = 'md' }: Props = $props();

	const sizes = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-12 w-12 text-base' };
	const initials = $derived(
		name
			.split(/[\s,]+/)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase() ?? '')
			.join('')
	);
</script>

{#if avatar}
	<img src={avatar} alt={name} class="rounded-full object-cover {sizes[size]}" />
{:else}
	<div
		class="flex shrink-0 items-center justify-center rounded-full bg-gray-300 font-medium text-gray-600 dark:bg-gray-600 dark:text-gray-300 {sizes[size]}"
	>
		{initials || '?'}
	</div>
{/if}

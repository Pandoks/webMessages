<script lang="ts">
	type MapView = 'street' | 'satellite' | 'hybrid';

	interface Props {
		currentView: MapView;
		onViewChange: (view: MapView) => void;
	}

	let { currentView, onViewChange }: Props = $props();

	const views: { value: MapView; label: string }[] = [
		{ value: 'street', label: 'Street' },
		{ value: 'satellite', label: 'Satellite' },
		{ value: 'hybrid', label: 'Hybrid' }
	];
</script>

<div class="flex gap-0.5 rounded-lg bg-white/90 p-1 shadow-md backdrop-blur-sm dark:bg-gray-800/90">
	{#each views as view}
		<button
			class="rounded-md px-3 py-1 text-xs font-medium transition-colors {currentView === view.value
				? 'bg-blue-500 text-white shadow-sm'
				: 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700'}"
			onclick={() => onViewChange(view.value)}
		>
			{view.label}
		</button>
	{/each}
</div>

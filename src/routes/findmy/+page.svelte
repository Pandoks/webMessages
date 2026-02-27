<script lang="ts">
	import { onMount } from 'svelte';
	import { findMyStore } from '$lib/stores/findmy.svelte.js';
	import FindMyMap from '$lib/components/findmy/FindMyMap.svelte';
	import FindMySidebar from '$lib/components/findmy/FindMySidebar.svelte';
	import FindMyDetailPanel from '$lib/components/findmy/FindMyDetailPanel.svelte';

	let selectedId = $state<string | null>(null);

	onMount(() => {
		findMyStore.fetchAll();
	});

	// Find the selected device or friend
	const selectedItem = $derived.by(() => {
		if (!selectedId) return null;
		const device = findMyStore.devices.find((d) => d.id === selectedId);
		if (device) return { type: 'device' as const, ...device };
		const friend = findMyStore.friends.find((f) => f.id === selectedId);
		if (friend)
			return {
				type: 'friend' as const,
				name: [friend.firstName, friend.lastName].filter(Boolean).join(' ') || friend.handle,
				...friend
			};
		return null;
	});
</script>

<div class="flex h-full">
	<FindMySidebar
		devices={findMyStore.devices}
		friends={findMyStore.friends}
		{selectedId}
		onSelect={(id) => (selectedId = id)}
		starred={findMyStore.starred}
		onToggleStar={(id) => findMyStore.toggleStar(id)}
	/>
	<div class="relative flex-1">
		<FindMyMap
			devices={findMyStore.devices}
			friends={findMyStore.friends}
			{selectedId}
			onSelect={(id) => (selectedId = id)}
		/>
		{#if findMyStore.loading}
			<div class="absolute inset-0 flex items-center justify-center bg-black/10">
				<div class="rounded-lg bg-white px-4 py-2 text-sm shadow-lg dark:bg-gray-800 dark:text-white">
					Loading locations...
				</div>
			</div>
		{/if}
		{#if findMyStore.error}
			<div class="absolute bottom-4 left-4 rounded-lg bg-red-500 px-4 py-2 text-sm text-white shadow-lg">
				{findMyStore.error}
			</div>
		{/if}
	</div>
	{#if selectedItem}
		<FindMyDetailPanel
			name={selectedItem.name}
			address={selectedItem.address}
			latitude={selectedItem.latitude}
			longitude={selectedItem.longitude}
			lastUpdated={selectedItem.locationTimestamp}
			batteryLevel={selectedItem.type === 'device' ? selectedItem.batteryLevel : null}
			onClose={() => (selectedId = null)}
		/>
	{/if}
</div>

<script lang="ts">
	import { onMount } from 'svelte';
	import { findMyStore } from '$lib/stores/findmy.svelte.js';
	import FindMyMap from '$lib/components/findmy/FindMyMap.svelte';
	import FindMySidebar from '$lib/components/findmy/FindMySidebar.svelte';
	import FindMyDetailPanel from '$lib/components/findmy/FindMyDetailPanel.svelte';

	let selectedId = $state<string | null>(null);

	onMount(() => {
		findMyStore.fetchAll();
		findMyStore.fetchMyLocation();
	});

	// Find the selected device, friend, or "Me"
	const selectedItem = $derived.by(() => {
		if (!selectedId) return null;
		if (selectedId === '__me__' && findMyStore.myLocation) {
			const my = findMyStore.myLocation;
			return {
				type: 'friend' as const,
				name: my.name,
				handle: '__me__',
				displayName: my.name,
				latitude: my.latitude,
				longitude: my.longitude,
				address: my.address,
				locationTimestamp: my.timestamp,
				locatingInProgress: false,
				avatarBase64: null
			};
		}
		const device = findMyStore.devices.find((d) => d.id === selectedId);
		if (device) return { type: 'device' as const, ...device };
		const friend = findMyStore.friends.find((f) => f.handle === selectedId);
		if (friend) return { type: 'friend' as const, name: friend.displayName, ...friend };
		return null;
	});
</script>

<div class="flex h-full w-full">
	<FindMySidebar
		devices={findMyStore.devices}
		friends={findMyStore.friends}
		myLocation={findMyStore.myLocation}
		{selectedId}
		onSelect={(id) => (selectedId = id)}
	/>
	<div class="relative flex-1">
		<FindMyMap
			devices={findMyStore.devices}
			friends={findMyStore.friends}
			myLocation={findMyStore.myLocation}
			{selectedId}
			onSelect={(id) => (selectedId = id)}
		/>
		{#if findMyStore.loading}
			<div class="absolute inset-0 z-[500] flex items-center justify-center bg-black/10">
				<div
					class="rounded-lg bg-white px-4 py-2 text-sm shadow-lg dark:bg-gray-800 dark:text-white"
				>
					Loading locations...
				</div>
			</div>
		{/if}
		{#if findMyStore.error}
			<div
				class="absolute bottom-4 left-4 z-[500] flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm text-white shadow-lg"
			>
				<span>{findMyStore.error}</span>
				<button
					onclick={() => (findMyStore.error = null)}
					class="ml-1 font-bold hover:text-red-200"
					aria-label="Dismiss error">&times;</button
				>
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
			myLatitude={findMyStore.myLocation?.latitude ?? null}
			myLongitude={findMyStore.myLocation?.longitude ?? null}
			onClose={() => (selectedId = null)}
		/>
	{/if}
</div>

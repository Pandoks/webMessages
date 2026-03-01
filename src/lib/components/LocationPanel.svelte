<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { findMyStore } from '$lib/stores/findmy.svelte.js';
	import type { FindMyFriend } from '$lib/types/index.js';

	interface Props {
		address: string;
		onClose: () => void;
	}

	let { address, onClose }: Props = $props();

	let mapContainer: HTMLDivElement | undefined = $state();
	let map: L.Map | null = null;
	let markerLayer: L.LayerGroup | null = null;
	let L: typeof import('leaflet') | null = null;
	let copyFeedback = $state<string | null>(null);

	const friend = $derived.by(() => {
		return findMyStore.friends.find((f) => f.handle === address) ?? null;
	});

	const hasLocation = $derived(
		friend !== null && friend.latitude !== null && friend.longitude !== null
	);

	const friendName = $derived.by(() => {
		if (!friend) return '';
		return friend.displayName;
	});

	const relativeTime = $derived.by(() => {
		if (!friend?.locationTimestamp) return null;
		const now = Date.now();
		const diff = now - friend.locationTimestamp;
		const seconds = Math.floor(diff / 1000);
		if (seconds < 60) return 'just now';
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	});

	async function initMap() {
		if (!mapContainer || !hasLocation || !friend) return;

		const leaflet = await import('leaflet');
		await import('leaflet/dist/leaflet.css');
		L = leaflet.default ?? leaflet;

		delete (L.Icon.Default.prototype as any)._getIconUrl;
		L.Icon.Default.mergeOptions({
			iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
			iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
			shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
		});

		map = L.map(mapContainer, {
			center: [friend.latitude!, friend.longitude!],
			zoom: 15,
			zoomControl: true,
			attributionControl: false
		});

		L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			maxZoom: 19
		}).addTo(map);

		markerLayer = L.layerGroup().addTo(map);
		updateMarker();
	}

	function updateMarker() {
		if (!map || !markerLayer || !L || !friend?.latitude || !friend?.longitude) return;

		markerLayer.clearLayers();

		L.circleMarker([friend.latitude, friend.longitude], {
			radius: 10,
			fillColor: '#10b981',
			color: '#ffffff',
			weight: 2,
			opacity: 1,
			fillOpacity: 0.9
		})
			.bindTooltip(friendName, {
				direction: 'top',
				offset: [0, -10],
				className: 'location-panel-tooltip'
			})
			.addTo(markerLayer);

		map.setView([friend.latitude, friend.longitude], map.getZoom());
	}

	async function copyToClipboard(text: string, label: string) {
		try {
			await navigator.clipboard.writeText(text);
			copyFeedback = label;
			setTimeout(() => (copyFeedback = null), 2000);
		} catch {
			// Clipboard API not available
		}
	}

	onMount(() => {
		if (findMyStore.friends.length === 0) {
			findMyStore.fetchFriends();
		}
		// Delay map init to next tick so container is mounted
		requestAnimationFrame(() => {
			initMap();
		});
	});

	onDestroy(() => {
		if (map) {
			map.remove();
			map = null;
		}
	});

	// Update marker when friend data changes
	$effect(() => {
		friend;
		if (map && L) {
			updateMarker();
		}
	});

	// Init map when friend becomes available (after fetch)
	$effect(() => {
		if (hasLocation && !map && mapContainer) {
			initMap();
		}
	});
</script>

<div class="flex h-full w-80 flex-col border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
	<!-- Header -->
	<header class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
		<h3 class="text-sm font-semibold dark:text-white">Location</h3>
		<button
			onclick={onClose}
			class="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
			aria-label="Close location panel"
		>
			<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
			</svg>
		</button>
	</header>

	<!-- Content -->
	<div class="flex-1 overflow-y-auto">
		{#if !friend}
			<div class="flex h-full items-center justify-center p-4">
				<p class="text-center text-sm text-gray-400">Location not available</p>
			</div>
		{:else if !hasLocation}
			<div class="flex h-full items-center justify-center p-4">
				<p class="text-center text-sm text-gray-400">No location data for {friendName}</p>
			</div>
		{:else}
			<!-- Mini Map -->
			<div class="h-[300px] w-full" bind:this={mapContainer}></div>

			<!-- Location Info -->
			<div class="space-y-3 p-4">
				<div>
					<p class="text-xs font-medium text-gray-500 dark:text-gray-400">Name</p>
					<p class="text-sm dark:text-white">{friendName}</p>
				</div>

				{#if friend.address}
					<div>
						<p class="text-xs font-medium text-gray-500 dark:text-gray-400">Address</p>
						<p class="text-sm dark:text-white">{friend.address}</p>
					</div>
				{/if}

				{#if relativeTime}
					<div>
						<p class="text-xs font-medium text-gray-500 dark:text-gray-400">Last updated</p>
						<p class="text-sm dark:text-white">{relativeTime}</p>
					</div>
				{/if}

				<!-- Action Buttons -->
				<div class="flex flex-col gap-2 pt-1">
					{#if friend.address}
						<button
							onclick={() => copyToClipboard(friend!.address!, 'Address copied')}
							class="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
						>
							<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
							</svg>
							Copy address
						</button>
					{/if}

					<button
						onclick={() => copyToClipboard(`${friend!.latitude}, ${friend!.longitude}`, 'Coordinates copied')}
						class="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
					>
						<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
						</svg>
						Copy coordinates
					</button>
				</div>

				{#if copyFeedback}
					<p class="text-center text-xs text-green-600 dark:text-green-400">{copyFeedback}</p>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	:global(.location-panel-tooltip) {
		background-color: rgba(0, 0, 0, 0.8);
		border: none;
		border-radius: 6px;
		color: white;
		font-size: 12px;
		padding: 4px 8px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
	}

	:global(.location-panel-tooltip::before) {
		border-top-color: rgba(0, 0, 0, 0.8) !important;
	}
</style>

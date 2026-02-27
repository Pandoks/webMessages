<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { FindMyDevice, FindMyFriend } from '$lib/types/index.js';
	import MapViewToggle from './MapViewToggle.svelte';

	type MapView = 'street' | 'satellite' | 'hybrid';

	interface Props {
		devices: FindMyDevice[];
		friends: FindMyFriend[];
		selectedId: string | null;
		onSelect: (id: string) => void;
	}

	let { devices, friends, selectedId, onSelect }: Props = $props();

	let mapContainer: HTMLDivElement;
	let map: L.Map | null = null;
	let markersLayer: L.LayerGroup | null = null;
	let currentTileLayer: L.TileLayer | null = null;
	let labelsLayer: L.TileLayer | null = null;
	let mapView = $state<MapView>('street');
	let L: typeof import('leaflet') | null = null;

	const tileLayers: Record<MapView, { url: string; attribution: string }> = {
		street: {
			url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
			attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
		},
		satellite: {
			url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
			attribution:
				'&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics'
		},
		hybrid: {
			url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
			attribution:
				'&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics'
		}
	};

	const labelsUrl =
		'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';

	function createMarker(
		leaflet: typeof import('leaflet'),
		lat: number,
		lng: number,
		id: string,
		label: string,
		type: 'device' | 'friend',
		isSelected: boolean
	): L.CircleMarker {
		const color = type === 'device' ? '#3b82f6' : '#10b981';
		const selectedColor = type === 'device' ? '#1d4ed8' : '#047857';

		const marker = leaflet.circleMarker([lat, lng], {
			radius: isSelected ? 12 : 8,
			fillColor: isSelected ? selectedColor : color,
			color: isSelected ? '#ffffff' : '#ffffff',
			weight: isSelected ? 3 : 2,
			opacity: 1,
			fillOpacity: isSelected ? 1 : 0.8
		});

		marker.bindTooltip(label, {
			direction: 'top',
			offset: [0, -10],
			className: 'findmy-tooltip'
		});

		marker.on('click', () => onSelect(id));

		return marker;
	}

	function setTileLayer(view: MapView) {
		if (!map || !L) return;

		if (currentTileLayer) {
			map.removeLayer(currentTileLayer);
		}
		if (labelsLayer) {
			map.removeLayer(labelsLayer);
			labelsLayer = null;
		}

		const config = tileLayers[view];
		currentTileLayer = L.tileLayer(config.url, {
			attribution: config.attribution,
			maxZoom: 19
		});
		currentTileLayer.addTo(map);

		if (view === 'hybrid') {
			labelsLayer = L.tileLayer(labelsUrl, { maxZoom: 19 });
			labelsLayer.addTo(map);
		}
	}

	function updateMarkers() {
		if (!map || !markersLayer || !L) return;

		markersLayer.clearLayers();

		const bounds: L.LatLngExpression[] = [];

		for (const device of devices) {
			if (device.latitude != null && device.longitude != null) {
				const marker = createMarker(
					L,
					device.latitude,
					device.longitude,
					device.id,
					device.name,
					'device',
					selectedId === device.id
				);
				markersLayer.addLayer(marker);
				bounds.push([device.latitude, device.longitude]);
			}
		}

		for (const friend of friends) {
			if (friend.latitude != null && friend.longitude != null) {
				const label = [friend.firstName, friend.lastName].filter(Boolean).join(' ') || friend.handle;
				const marker = createMarker(
					L,
					friend.latitude,
					friend.longitude,
					friend.id,
					label,
					'friend',
					selectedId === friend.id
				);
				markersLayer.addLayer(marker);
				bounds.push([friend.latitude, friend.longitude]);
			}
		}

		if (bounds.length > 0) {
			map.fitBounds(bounds as L.LatLngBoundsExpression, { padding: [50, 50], maxZoom: 15 });
		}
	}

	function handleViewChange(view: MapView) {
		mapView = view;
		setTileLayer(view);
	}

	onMount(async () => {
		const leaflet = await import('leaflet');
		await import('leaflet/dist/leaflet.css');
		L = leaflet.default ?? leaflet;

		// Fix Leaflet default icon paths for bundlers
		delete (L.Icon.Default.prototype as any)._getIconUrl;
		L.Icon.Default.mergeOptions({
			iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
			iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
			shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
		});

		map = L.map(mapContainer, {
			center: [39.8283, -98.5795], // Center of US as default
			zoom: 4,
			zoomControl: true
		});

		markersLayer = L.layerGroup().addTo(map);

		setTileLayer(mapView);
		updateMarkers();
	});

	onDestroy(() => {
		if (map) {
			map.remove();
			map = null;
		}
	});

	$effect(() => {
		// Re-run when devices, friends, or selectedId change
		devices;
		friends;
		selectedId;
		updateMarkers();
	});
</script>

<div class="relative h-full w-full">
	<div bind:this={mapContainer} class="h-full w-full"></div>
	<div class="absolute right-3 top-3 z-[1000]">
		<MapViewToggle currentView={mapView} onViewChange={handleViewChange} />
	</div>
</div>

<style>
	:global(.findmy-tooltip) {
		background-color: rgba(0, 0, 0, 0.8);
		border: none;
		border-radius: 6px;
		color: white;
		font-size: 12px;
		padding: 4px 8px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
	}

	:global(.findmy-tooltip::before) {
		border-top-color: rgba(0, 0, 0, 0.8) !important;
	}
</style>

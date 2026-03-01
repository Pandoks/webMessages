<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { FindMyDevice, FindMyFriend } from '$lib/types/index.js';
	import MapViewToggle from './MapViewToggle.svelte';

	type MapView = 'street' | 'satellite' | 'hybrid';

	interface Props {
		devices: FindMyDevice[];
		friends: FindMyFriend[];
		myLocation: {
			latitude: number;
			longitude: number;
			timestamp: number;
			address: string | null;
			name: string;
			photoBase64: string | null;
		} | null;
		selectedId: string | null;
		onSelect: (id: string) => void;
	}

	let { devices, friends, myLocation, selectedId, onSelect }: Props = $props();

	let mapContainer: HTMLDivElement;
	let map: L.Map | null = null;
	let markersLayer: L.LayerGroup | null = null;
	let currentTileLayer: L.TileLayer | null = null;
	let labelsLayer: L.TileLayer | null = null;
	let mapView = $state<MapView>('street');
	let isDark = $state(false);
	let L: typeof import('leaflet') | null = null;
	let observer: MutationObserver | null = null;

	const cartoAttribution =
		'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';

	const satelliteConfig = {
		url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
		attribution:
			'&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics'
	};

	const labelsUrl =
		'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';

	function getStreetConfig(dark: boolean) {
		return {
			url: dark
				? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
				: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
			attribution: cartoAttribution
		};
	}

	function checkDark(): boolean {
		return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
	}

	// --- Marker helpers (adapted from ChatAvatar.svelte for hex colors) ---
	const markerColors = [
		'#3b82f6', '#22c55e', '#f97316', '#a855f7',
		'#ec4899', '#14b8a6', '#ef4444', '#6366f1'
	];

	function getMarkerColor(name: string): string {
		let hash = 0;
		for (let i = 0; i < name.length; i++) {
			hash = name.charCodeAt(i) + ((hash << 5) - hash);
		}
		return markerColors[Math.abs(hash) % markerColors.length];
	}

	function getInitials(name: string): string {
		return name
			.replace(/[^\p{L}\p{N}\s]/gu, '')
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase() ?? '')
			.join('');
	}

	function getDeviceEmoji(device: FindMyDevice): string {
		const dc = (device.deviceClass ?? device.modelDisplayName ?? '').toLowerCase();
		if (device.isConsideredAccessory) return '🎒';
		if (dc.includes('macbook') || dc.includes('laptop')) return '💻';
		if (dc.includes('imac') || dc.includes('mac')) return '🖥️';
		if (dc.includes('ipad')) return '📱';
		if (dc.includes('watch')) return '⌚';
		if (dc.includes('airpods') || dc.includes('pod')) return '🎧';
		if (dc.includes('iphone') || dc.includes('phone')) return '📱';
		return '📍';
	}

	function createFriendMarker(
		leaflet: typeof import('leaflet'),
		lat: number,
		lng: number,
		id: string,
		label: string,
		isSelected: boolean
	): L.Marker {
		const size = isSelected ? 44 : 36;
		const initials = getInitials(label) || '?';
		const color = getMarkerColor(label);
		const selectedClass = isSelected ? ' selected' : '';

		const icon = leaflet.divIcon({
			className: '',
			html: `<div class="findmy-marker findmy-marker--friend${selectedClass}" style="background:${color}">${initials}</div>`,
			iconSize: [size, size],
			iconAnchor: [size / 2, size / 2]
		});

		const marker = leaflet.marker([lat, lng], { icon });

		marker.bindTooltip(label, {
			direction: 'top',
			offset: [0, -(size / 2 + 4)],
			className: 'findmy-tooltip'
		});

		marker.on('click', () => onSelect(id));
		return marker;
	}

	function createDeviceMarker(
		leaflet: typeof import('leaflet'),
		lat: number,
		lng: number,
		id: string,
		label: string,
		device: FindMyDevice,
		isSelected: boolean
	): L.Marker {
		const size = isSelected ? 40 : 32;
		const emoji = getDeviceEmoji(device);
		const selectedClass = isSelected ? ' selected' : '';

		const icon = leaflet.divIcon({
			className: '',
			html: `<div class="findmy-marker findmy-marker--device${selectedClass}">${emoji}</div>`,
			iconSize: [size, size],
			iconAnchor: [size / 2, size / 2]
		});

		const marker = leaflet.marker([lat, lng], { icon });

		marker.bindTooltip(label, {
			direction: 'top',
			offset: [0, -(size / 2 + 4)],
			className: 'findmy-tooltip'
		});

		marker.on('click', () => onSelect(id));
		return marker;
	}

	function setTileLayer(view: MapView, dark: boolean) {
		if (!map || !L) return;

		if (currentTileLayer) {
			map.removeLayer(currentTileLayer);
		}
		if (labelsLayer) {
			map.removeLayer(labelsLayer);
			labelsLayer = null;
		}

		const config = view === 'street' ? getStreetConfig(dark) : satelliteConfig;
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
				const marker = createDeviceMarker(
					L,
					device.latitude,
					device.longitude,
					device.id,
					device.name,
					device,
					selectedId === device.id
				);
				markersLayer.addLayer(marker);
				bounds.push([device.latitude, device.longitude]);
			}
		}

		for (const friend of friends) {
			if (friend.latitude != null && friend.longitude != null) {
				const marker = createFriendMarker(
					L,
					friend.latitude,
					friend.longitude,
					friend.handle,
					friend.displayName,
					selectedId === friend.handle
				);
				markersLayer.addLayer(marker);
				bounds.push([friend.latitude, friend.longitude]);
			}
		}

		// "Me" marker — blue pulsing dot
		if (myLocation) {
			const isSelected = selectedId === '__me__';
			const size = isSelected ? 24 : 18;
			const icon = L.divIcon({
				className: '',
				html: `<div class="findmy-marker findmy-marker--me${isSelected ? ' selected' : ''}"><div class="findmy-me-pulse"></div><div class="findmy-me-dot"></div></div>`,
				iconSize: [size, size],
				iconAnchor: [size / 2, size / 2]
			});
			const marker = L.marker([myLocation.latitude, myLocation.longitude], { icon });
			marker.bindTooltip('Me', {
				direction: 'top',
				offset: [0, -(size / 2 + 4)],
				className: 'findmy-tooltip'
			});
			marker.on('click', () => onSelect('__me__'));
			markersLayer.addLayer(marker);
			bounds.push([myLocation.latitude, myLocation.longitude]);
		}

		// Only fit all bounds on initial load (no selection)
		if (!selectedId && bounds.length > 0) {
			map.fitBounds(bounds as L.LatLngBoundsExpression, { padding: [50, 50], maxZoom: 15 });
		}
	}

	function flyToSelected() {
		if (!map || !selectedId) return;

		if (selectedId === '__me__' && myLocation) {
			map.flyTo([myLocation.latitude, myLocation.longitude], 15, { duration: 0.8 });
			return;
		}

		const device = devices.find((d) => d.id === selectedId);
		if (device?.latitude != null && device?.longitude != null) {
			map.flyTo([device.latitude, device.longitude], 15, { duration: 0.8 });
			return;
		}

		const friend = friends.find((f) => f.handle === selectedId);
		if (friend?.latitude != null && friend?.longitude != null) {
			map.flyTo([friend.latitude, friend.longitude], 15, { duration: 0.8 });
		}
	}

	function fitAll() {
		if (!map || !L) return;
		const bounds: L.LatLngExpression[] = [];
		for (const d of devices) {
			if (d.latitude != null && d.longitude != null) bounds.push([d.latitude, d.longitude]);
		}
		for (const f of friends) {
			if (f.latitude != null && f.longitude != null) bounds.push([f.latitude, f.longitude]);
		}
		if (myLocation) bounds.push([myLocation.latitude, myLocation.longitude]);
		if (bounds.length > 0) {
			map.flyToBounds(bounds as L.LatLngBoundsExpression, {
				padding: [50, 50],
				maxZoom: 15,
				duration: 0.8
			});
		}
	}

	function handleViewChange(view: MapView) {
		mapView = view;
		setTileLayer(view, isDark);
	}

	onMount(async () => {
		isDark = checkDark();
		observer = new MutationObserver(() => {
			isDark = checkDark();
		});
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class']
		});

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
			center: [39.8283, -98.5795],
			zoom: 4,
			zoomControl: false,
			zoomSnap: 0.25,
			zoomDelta: 0.25,
			wheelDebounceTime: 40,
			wheelPxPerZoomLevel: 120
		});

		L.control.zoom({ position: 'bottomright' }).addTo(map);

		markersLayer = L.layerGroup().addTo(map);

		setTileLayer(mapView, isDark);
		updateMarkers();
	});

	onDestroy(() => {
		if (observer) {
			observer.disconnect();
			observer = null;
		}
		if (map) {
			map.remove();
			map = null;
		}
	});

	$effect(() => {
		devices;
		friends;
		myLocation;
		selectedId;
		updateMarkers();
	});

	// Fly to selected marker when selection changes
	let prevSelectedId: string | null = null;
	$effect(() => {
		if (selectedId && selectedId !== prevSelectedId) {
			flyToSelected();
		}
		prevSelectedId = selectedId;
	});

	$effect(() => {
		isDark;
		if (map && mapView === 'street') {
			setTileLayer(mapView, isDark);
		}
	});
</script>

<div class="relative h-full w-full">
	<div bind:this={mapContainer} class="h-full w-full"></div>
	<div class="absolute right-3 top-3 z-[400]">
		<MapViewToggle currentView={mapView} onViewChange={handleViewChange} />
	</div>
	<button
		onclick={fitAll}
		class="absolute bottom-6 left-3 z-[400] flex h-[34px] w-[34px] items-center justify-center rounded-lg bg-white shadow-md transition-colors hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700"
		aria-label="Fit all locations"
		title="Fit all locations"
	>
		<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-700 dark:text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
		</svg>
	</button>
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

	/* Friend markers — circular avatar with initials */
	:global(.findmy-marker) {
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		color: white;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}

	:global(.findmy-marker--friend) {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: 2px solid white;
		font-size: 13px;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
	}

	:global(.findmy-marker--friend.selected) {
		width: 44px;
		height: 44px;
		border-width: 3px;
		font-size: 15px;
		box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35);
	}

	/* Device markers — rounded rect with emoji */
	:global(.findmy-marker--device) {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.9);
		border: 2px solid #e5e7eb;
		font-size: 16px;
		color: inherit;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
	}

	:global(.findmy-marker--device.selected) {
		width: 40px;
		height: 40px;
		border-color: #3b82f6;
		border-width: 3px;
		font-size: 20px;
		box-shadow: 0 3px 10px rgba(0, 0, 0, 0.25);
	}

	:global(.dark .findmy-marker--device) {
		background: rgba(31, 41, 55, 0.9);
		border-color: #4b5563;
	}

	:global(.dark .findmy-marker--device.selected) {
		border-color: #60a5fa;
	}

	/* "Me" marker — blue pulsing dot */
	:global(.findmy-marker--me) {
		position: relative;
		width: 18px;
		height: 18px;
	}

	:global(.findmy-marker--me.selected) {
		width: 24px;
		height: 24px;
	}

	:global(.findmy-me-dot) {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 12px;
		height: 12px;
		background: #3b82f6;
		border: 2px solid white;
		border-radius: 50%;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	}

	:global(.findmy-marker--me.selected .findmy-me-dot) {
		width: 16px;
		height: 16px;
		border-width: 3px;
	}

	:global(.findmy-me-pulse) {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 18px;
		height: 18px;
		background: rgba(59, 130, 246, 0.3);
		border-radius: 50%;
		animation: findmy-pulse 2s ease-out infinite;
	}

	@keyframes findmy-pulse {
		0% {
			transform: translate(-50%, -50%) scale(1);
			opacity: 0.6;
		}
		100% {
			transform: translate(-50%, -50%) scale(2.5);
			opacity: 0;
		}
	}
</style>

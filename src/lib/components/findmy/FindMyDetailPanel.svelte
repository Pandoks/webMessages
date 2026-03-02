<script lang="ts">
	import { formatRelativeTime, haversineDistance, formatDistance } from '$lib/utils/format.js';

	interface Props {
		name: string;
		address: string | null;
		latitude: number | null;
		longitude: number | null;
		lastUpdated: number | null;
		myLatitude: number | null;
		myLongitude: number | null;
		onClose: () => void;
	}

	let { name, address, latitude, longitude, lastUpdated, myLatitude, myLongitude, onClose }: Props =
		$props();

	const distance = $derived.by(() => {
		if (latitude == null || longitude == null || myLatitude == null || myLongitude == null)
			return null;
		const miles = haversineDistance(myLatitude, myLongitude, latitude, longitude);
		return formatDistance(miles);
	});

	let copiedAddress = $state(false);
	let copiedCoords = $state(false);

	async function copyAddress() {
		if (address) {
			await navigator.clipboard.writeText(address);
			copiedAddress = true;
			setTimeout(() => (copiedAddress = false), 2000);
		}
	}

	async function copyCoordinates() {
		if (latitude != null && longitude != null) {
			await navigator.clipboard.writeText(`${latitude}, ${longitude}`);
			copiedCoords = true;
			setTimeout(() => (copiedCoords = false), 2000);
		}
	}
</script>

<div
	class="flex h-full w-80 shrink-0 flex-col border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
>
	<!-- Header -->
	<div
		class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700"
	>
		<h2 class="truncate text-sm font-semibold dark:text-white">{name}</h2>
		<button
			onclick={onClose}
			class="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200"
			aria-label="Close detail panel"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-4 w-4"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
			>
				<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
			</svg>
		</button>
	</div>

	<!-- Content -->
	<div class="flex-1 space-y-4 overflow-y-auto p-4">
		<!-- Address -->
		{#if address}
			{@const parts = address.split(',').map((p: string) => p.trim())}
			<div>
				<h3 class="mb-1 text-xs font-medium tracking-wide text-gray-400 uppercase">Address</h3>
				{#if parts.length >= 3 && /\d/.test(parts[0])}
					<!-- Full address: "123 Main St, City, ST 94102" → two lines -->
					<p class="text-sm dark:text-gray-200">{parts[0]}</p>
					<p class="text-sm dark:text-gray-200">{parts.slice(1).join(', ')}</p>
				{:else}
					<p class="text-sm dark:text-gray-200">{address}</p>
				{/if}
				<button
					onclick={copyAddress}
					class="mt-1 text-xs text-blue-500 transition-colors hover:text-blue-600"
				>
					{copiedAddress ? 'Copied!' : 'Copy address'}
				</button>
			</div>
		{/if}

		<!-- Coordinates -->
		{#if latitude != null && longitude != null}
			<div>
				<h3 class="mb-1 text-xs font-medium tracking-wide text-gray-400 uppercase">Coordinates</h3>
				<p class="font-mono text-sm dark:text-gray-200">
					{latitude.toFixed(6)}, {longitude.toFixed(6)}
				</p>
				<button
					onclick={copyCoordinates}
					class="mt-1 text-xs text-blue-500 transition-colors hover:text-blue-600"
				>
					{copiedCoords ? 'Copied!' : 'Copy coordinates'}
				</button>
			</div>
		{/if}

		<!-- Distance from Me -->
		{#if distance}
			<div>
				<h3 class="mb-1 text-xs font-medium tracking-wide text-gray-400 uppercase">Distance</h3>
				<p class="text-sm dark:text-gray-200">{distance} away</p>
			</div>
		{/if}

		<!-- Last Updated -->
		<div>
			<h3 class="mb-1 text-xs font-medium tracking-wide text-gray-400 uppercase">Last Updated</h3>
			<p class="text-sm dark:text-gray-200">
				{#if lastUpdated}
					{formatRelativeTime(lastUpdated)}
				{:else}
					Locating...
				{/if}
			</p>
		</div>
	</div>
</div>

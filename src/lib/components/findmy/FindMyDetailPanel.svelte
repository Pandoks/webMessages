<script lang="ts">
	import { formatRelativeTime } from '$lib/utils/format.js';

	interface Props {
		name: string;
		address: string | null;
		latitude: number | null;
		longitude: number | null;
		lastUpdated: number | null;
		batteryLevel: number | null;
		onClose: () => void;
	}

	let { name, address, latitude, longitude, lastUpdated, batteryLevel, onClose }: Props = $props();

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

	function batteryColor(level: number): string {
		if (level > 0.5) return 'text-green-500';
		if (level > 0.2) return 'text-yellow-500';
		return 'text-red-500';
	}
</script>

<div class="flex h-full w-80 shrink-0 flex-col border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
	<!-- Header -->
	<div class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
		<h2 class="truncate text-sm font-semibold dark:text-white">{name}</h2>
		<button
			onclick={onClose}
			class="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200"
			aria-label="Close detail panel"
		>
			<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
			</svg>
		</button>
	</div>

	<!-- Content -->
	<div class="flex-1 space-y-4 overflow-y-auto p-4">
		<!-- Address -->
		{#if address}
			<div>
				<h3 class="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">Address</h3>
				<p class="text-sm dark:text-gray-200">{address}</p>
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
				<h3 class="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">Coordinates</h3>
				<p class="font-mono text-sm dark:text-gray-200">{latitude.toFixed(6)}, {longitude.toFixed(6)}</p>
				<button
					onclick={copyCoordinates}
					class="mt-1 text-xs text-blue-500 transition-colors hover:text-blue-600"
				>
					{copiedCoords ? 'Copied!' : 'Copy coordinates'}
				</button>
			</div>
		{/if}

		<!-- Last Updated -->
		<div>
			<h3 class="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">Last Updated</h3>
			<p class="text-sm dark:text-gray-200">
				{#if lastUpdated}
					{formatRelativeTime(lastUpdated)}
				{:else}
					Locating...
				{/if}
			</p>
		</div>

		<!-- Battery -->
		{#if batteryLevel != null}
			<div>
				<h3 class="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">Battery</h3>
				<div class="flex items-center gap-2">
					<div class="h-2 flex-1 rounded-full bg-gray-200 dark:bg-gray-700">
						<div
							class="h-2 rounded-full {batteryColor(batteryLevel)} bg-current"
							style="width: {Math.round(batteryLevel * 100)}%"
						></div>
					</div>
					<span class="text-sm font-medium {batteryColor(batteryLevel)}">{Math.round(batteryLevel * 100)}%</span>
				</div>
			</div>
		{/if}
	</div>
</div>

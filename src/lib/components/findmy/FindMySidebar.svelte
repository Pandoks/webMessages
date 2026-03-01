<script lang="ts">
	import type { FindMyDevice, FindMyFriend } from '$lib/types/index.js';
	import { findMyStore } from '$lib/stores/findmy.svelte.js';
	import { formatRelativeTime, extractCityState, haversineDistance, formatDistance } from '$lib/utils/format.js';
	import FindMyListItem from './FindMyListItem.svelte';

	type Tab = 'people' | 'devices';

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

	function getAvatarUrl(friend: FindMyFriend): string | null {
		if (!friend.avatarBase64) return null;
		return `data:image/jpeg;base64,${friend.avatarBase64}`;
	}

	function buildSubtitle(address: string | null, timestamp: number | null): string {
		const city = extractCityState(address);
		const time = timestamp ? formatRelativeTime(timestamp) : null;
		if (city && time) return `${city} · ${time}`;
		if (city) return city;
		if (time) return time;
		return 'Locating...';
	}

	function getDistanceFromMe(lat: number | null, lon: number | null): string | null {
		if (lat == null || lon == null || !myLocation) return null;
		const miles = haversineDistance(myLocation.latitude, myLocation.longitude, lat, lon);
		return formatDistance(miles);
	}

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
		starred: Set<string>;
		onToggleStar: (id: string) => void;
	}

	let { devices, friends, myLocation, selectedId, onSelect, starred, onToggleStar }: Props = $props();

	let activeTab = $state<Tab>('people');
	let search = $state('');
	let refreshing = $state(false);

	const filteredFriends = $derived.by(() => {
		const q = search.toLowerCase();
		const filtered = q
			? friends.filter((f) => f.displayName.toLowerCase().includes(q))
			: friends;
		return [...filtered].sort((a, b) => {
			const aStarred = starred.has(a.handle);
			const bStarred = starred.has(b.handle);
			if (aStarred && !bStarred) return -1;
			if (!aStarred && bStarred) return 1;
			return a.displayName.localeCompare(b.displayName);
		});
	});

	const filteredDevices = $derived.by(() => {
		const q = search.toLowerCase();
		const filtered = q
			? devices.filter((d) => d.name.toLowerCase().includes(q))
			: devices;
		return [...filtered].sort((a, b) => {
			const aStarred = starred.has(a.id);
			const bStarred = starred.has(b.id);
			if (aStarred && !bStarred) return -1;
			if (!aStarred && bStarred) return 1;
			return a.name.localeCompare(b.name);
		});
	});

	async function handleRefresh() {
		refreshing = true;
		await findMyStore.refreshAll();
		refreshing = false;
	}
</script>

<div class="flex h-full w-80 shrink-0 flex-col border-r border-gray-200 dark:border-gray-700">
	<!-- Header with tabs and refresh -->
	<div class="border-b border-gray-200 p-3 dark:border-gray-700">
		<div class="mb-2 flex items-center gap-2">
			<input
				bind:value={search}
				type="text"
				placeholder="Search..."
				class="flex-1 rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
			/>
			<button
				onclick={handleRefresh}
				disabled={refreshing}
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800"
				aria-label="Refresh locations"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5 {refreshing ? 'animate-spin' : ''}"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="1.5"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.016 4.356v4.992" />
				</svg>
			</button>
		</div>
		<div class="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
			<button
				onclick={() => (activeTab = 'people')}
				class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors
					{activeTab === 'people'
					? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
					: 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}"
			>
				People
			</button>
			<button
				onclick={() => (activeTab = 'devices')}
				class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors
					{activeTab === 'devices'
					? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
					: 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}"
			>
				Devices
			</button>
		</div>
	</div>

	<!-- List -->
	<div class="flex-1 overflow-y-auto">
		{#if activeTab === 'people'}
			{#if myLocation}
				<FindMyListItem
					id="__me__"
					name={myLocation.name}
					subtitle={buildSubtitle(myLocation.address, myLocation.timestamp)}
					isStarred={false}
					isSelected={selectedId === '__me__'}
					avatarUrl={myLocation.photoBase64 ? `data:image/jpeg;base64,${myLocation.photoBase64}` : null}
					{onSelect}
					onToggleStar={() => {}}
				/>
			{/if}
			{#each filteredFriends as friend (friend.handle)}
				<FindMyListItem
					id={friend.handle}
					name={friend.displayName}
					subtitle={buildSubtitle(friend.address, friend.locationTimestamp)}
					distance={getDistanceFromMe(friend.latitude, friend.longitude)}
					isStarred={starred.has(friend.handle)}
					isSelected={selectedId === friend.handle}
					avatarUrl={getAvatarUrl(friend)}
					{onSelect}
					{onToggleStar}
				/>
			{:else}
				<p class="p-4 text-center text-sm text-gray-400">No people found</p>
			{/each}
		{:else}
			{#each filteredDevices as device (device.id)}
				<FindMyListItem
					id={device.id}
					name={device.name}
					subtitle={buildSubtitle(device.address, device.locationTimestamp)}
					distance={getDistanceFromMe(device.latitude, device.longitude)}
					isStarred={starred.has(device.id)}
					isSelected={selectedId === device.id}
					emoji={getDeviceEmoji(device)}
					{onSelect}
					{onToggleStar}
				/>
			{:else}
				<p class="p-4 text-center text-sm text-gray-400">No devices found</p>
			{/each}
		{/if}
	</div>
</div>

<script lang="ts">
	import ContactAvatar from './ContactAvatar.svelte';
	import { formatRelativeTime } from '$lib/utils/format.js';

	interface Props {
		guid: string;
		displayName: string;
		lastMessage: string | null;
		lastMessageDate: number;
		unreadCount: number;
		isActive: boolean;
		avatar?: string | null;
	}

	let {
		guid,
		displayName,
		lastMessage,
		lastMessageDate,
		unreadCount,
		isActive,
		avatar = null
	}: Props = $props();
</script>

<a
	href="/messages/{encodeURIComponent(guid)}"
	class="flex gap-3 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800
		{isActive ? 'bg-blue-50 dark:bg-blue-900/20' : ''}"
>
	<ContactAvatar name={displayName} {avatar} />
	<div class="flex min-w-0 flex-1 flex-col">
		<div class="flex items-center justify-between">
			<span class="truncate text-sm font-medium dark:text-white">{displayName}</span>
			<span class="shrink-0 text-xs text-gray-400">{formatRelativeTime(lastMessageDate)}</span>
		</div>
		<div class="flex items-center justify-between">
			<span class="truncate text-xs text-gray-500 dark:text-gray-400"
				>{lastMessage ?? ''}</span
			>
			{#if unreadCount > 0}
				<span
					class="ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white"
				>
					{unreadCount > 99 ? '99+' : unreadCount}
				</span>
			{/if}
		</div>
	</div>
</a>

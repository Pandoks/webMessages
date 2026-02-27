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
		isPinned: boolean;
		onTogglePin: (guid: string) => void;
		avatar?: string | null;
	}

	let {
		guid,
		displayName,
		lastMessage,
		lastMessageDate,
		unreadCount,
		isActive,
		isPinned,
		onTogglePin,
		avatar = null
	}: Props = $props();
</script>

<a
	href="/messages/{encodeURIComponent(guid)}"
	class="group relative flex gap-3 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800
		{isActive ? 'bg-blue-50 dark:bg-blue-900/20' : ''}"
>
	<ContactAvatar name={displayName} {avatar} />
	<div class="flex min-w-0 flex-1 flex-col">
		<div class="flex items-center justify-between">
			<span class="flex items-center gap-1 truncate text-sm font-medium dark:text-white">
				{displayName}
				{#if isPinned}
					<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 shrink-0 text-blue-500" viewBox="0 0 16 16" fill="currentColor">
						<path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.126.125-.25.224-.354.298v4.431l.078.048c.203.127.476.314.751.555C12.36 7.775 13 8.527 13 9.5a.5.5 0 0 1-.5.5h-4v4.5a.5.5 0 0 1-1 0V10h-4a.5.5 0 0 1-.5-.5c0-.973.64-1.725 1.17-2.189A6 6 0 0 1 5 6.708V2.277a3 3 0 0 1-.354-.298C4.342 1.674 4 1.179 4 .5a.5.5 0 0 1 .146-.354" />
					</svg>
				{/if}
			</span>
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
	<button
		onclick={(e) => { e.preventDefault(); e.stopPropagation(); onTogglePin(guid); }}
		class="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-all
			{isPinned ? 'opacity-100 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20' : 'opacity-0 group-hover:opacity-100 hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-900/20'}"
		aria-label={isPinned ? 'Unpin conversation' : 'Pin conversation'}
	>
		{#if isPinned}
			<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
				<path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.126.125-.25.224-.354.298v4.431l.078.048c.203.127.476.314.751.555C12.36 7.775 13 8.527 13 9.5a.5.5 0 0 1-.5.5h-4v4.5a.5.5 0 0 1-1 0V10h-4a.5.5 0 0 1-.5-.5c0-.973.64-1.725 1.17-2.189A6 6 0 0 1 5 6.708V2.277a3 3 0 0 1-.354-.298C4.342 1.674 4 1.179 4 .5a.5.5 0 0 1 .146-.354" />
			</svg>
		{:else}
			<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
				<path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.126.125-.25.224-.354.298v4.431l.078.048c.203.127.476.314.751.555C12.36 7.775 13 8.527 13 9.5a.5.5 0 0 1-.5.5h-4v4.5a.5.5 0 0 1-1 0V10h-4a.5.5 0 0 1-.5-.5c0-.973.64-1.725 1.17-2.189A6 6 0 0 1 5 6.708V2.277a3 3 0 0 1-.354-.298C4.342 1.674 4 1.179 4 .5a.5.5 0 0 1 .146-.354" />
			</svg>
		{/if}
	</button>
</a>

<script lang="ts">
	import type { Chat } from '$lib/types/index.js';
	import ContactAvatar from './ContactAvatar.svelte';
	import { formatChatListDate } from '$lib/utils/date.js';
	import { page } from '$app/state';
	import { pushState } from '$app/navigation';

	let { chat, navigatingToChatId }: { chat: Chat; navigatingToChatId?: string } = $props();

	const isActive = $derived.by(() => {
		const shallowId = (page.state as any)?.chatId;
		if (shallowId != null) return shallowId === chat.rowid;
		if (navigatingToChatId) return navigatingToChatId === String(chat.rowid);
		return page.params.chatId === String(chat.rowid);
	});

	const preview = $derived.by(() => {
		if (!chat.last_message) return '';
		const body = chat.last_message.body ?? '';
		const prefix = chat.last_message.is_from_me ? 'You: ' : '';
		const text = prefix + body;
		return text.length > 60 ? text.slice(0, 60) + '...' : text;
	});

	const dateStr = $derived(
		chat.last_message ? formatChatListDate(chat.last_message.date) : ''
	);
	const unreadCount = $derived(chat.unread_count ?? 0);
	const hasUnread = $derived(unreadCount > 0);

	function handleClick(e: MouseEvent) {
		e.preventDefault();
		pushState(`/chat/${chat.rowid}`, { chatId: chat.rowid });
	}
</script>

<a
	href="/chat/{chat.rowid}"
	onclick={handleClick}
	class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-100
		{isActive ? 'bg-blue-50' : ''}"
>
	<ContactAvatar
		name={chat.display_name ?? '?'}
		identifier={chat.style !== 43 ? chat.chat_identifier : undefined}
		size={48}
	/>

	<div class="min-w-0 flex-1">
		<div class="flex items-baseline justify-between gap-2">
			<div class="flex min-w-0 items-center gap-1">
				<span class="truncate font-semibold text-gray-900">
					{chat.display_name ?? chat.chat_identifier}
				</span>
				{#if chat.is_pinned}
					<svg
						class="h-3.5 w-3.5 shrink-0 text-gray-400"
						viewBox="0 0 24 24"
						fill="currentColor"
						aria-label="Pinned chat"
					>
						<path d="M16 3a1 1 0 0 1 .8 1.6L15.2 6.7l2.1 6.4a1 1 0 0 1-.95 1.31H13v5.2a1 1 0 0 1-1.71.7l-1.65-1.65a1 1 0 0 1-.29-.7v-3.55H7.05a1 1 0 0 1-.95-1.31l2.1-6.4L6.6 4.6A1 1 0 0 1 7.4 3z" />
					</svg>
				{/if}
			</div>
			<span class="shrink-0 text-xs {hasUnread ? 'text-blue-500' : 'text-gray-400'}">
				{dateStr}
			</span>
		</div>
		<div class="flex items-center gap-2">
			<p class="truncate text-sm {hasUnread ? 'text-gray-700' : 'text-gray-500'}">
				{preview}
			</p>
			{#if hasUnread}
				<span
					class="h-2.5 w-2.5 shrink-0 rounded-full bg-blue-500"
					aria-label={`${unreadCount} unread messages`}
					title={`${unreadCount} unread messages`}
				></span>
			{/if}
		</div>
	</div>
</a>

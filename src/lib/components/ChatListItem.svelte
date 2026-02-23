<script lang="ts">
	import type { Chat } from '$lib/types/index.js';
	import ContactAvatar from './ContactAvatar.svelte';
	import { formatChatListDate } from '$lib/utils/date.js';
	import { page } from '$app/state';
	import { pushState } from '$app/navigation';

	let { chat, navigatingToChatId }: { chat: Chat; navigatingToChatId?: string } = $props();

	const isActive = $derived(
		page.params.chatId === String(chat.rowid) ||
		navigatingToChatId === String(chat.rowid) ||
		(page.state as any).chatId === chat.rowid
	);

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
			<span class="truncate font-semibold text-gray-900">
				{chat.display_name ?? chat.chat_identifier}
			</span>
			<span class="shrink-0 text-xs text-gray-400">
				{dateStr}
			</span>
		</div>
		<div class="flex items-center gap-1">
			<p class="truncate text-sm text-gray-500">
				{preview}
			</p>
		</div>
	</div>
</a>

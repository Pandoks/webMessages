<script lang="ts">
	import type { Chat, Participant } from '$lib/types/index.js';
	import ContactAvatar from './ContactAvatar.svelte';

	let {
		chat,
		participants = []
	}: {
		chat: Chat;
		participants?: Participant[];
	} = $props();

	const isGroup = $derived(chat.style === 43);
	const subtitle = $derived.by(() => {
		if (!isGroup) {
			return chat.service_name === 'iMessage' ? 'iMessage' : 'SMS';
		}
		return participants.map((p) => p.display_name).join(', ');
	});
</script>

<div class="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
	<!-- Back button for mobile -->
	<button onclick={() => history.back()} class="mr-1 text-blue-500 md:hidden" aria-label="Back to conversations">
		<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
		</svg>
	</button>

	<ContactAvatar
		name={chat.display_name ?? '?'}
		identifier={!isGroup ? chat.chat_identifier : undefined}
		size={36}
	/>

	<div class="min-w-0 flex-1">
		<h2 class="truncate text-base font-semibold text-gray-900">
			{chat.display_name ?? chat.chat_identifier}
		</h2>
		<p class="truncate text-xs text-gray-400">
			{subtitle}
		</p>
	</div>
</div>

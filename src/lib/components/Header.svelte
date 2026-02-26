<script lang="ts">
	import type { Chat, Participant } from '$lib/types/index.js';
	import ContactAvatar from './ContactAvatar.svelte';
	import { isPhoneNumber } from '$lib/utils/phone.js';

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
	const avatarIdentifier = $derived.by(() => {
		if (isGroup) return undefined;
		const participantId = participants[0]?.handle_identifier?.trim();
		if (participantId) return participantId;
		return chat.chat_identifier;
	});

	const phoneNumber = $derived.by(() => {
		const fromParticipant = participants.find((p) => isPhoneNumber(p.handle_identifier));
		if (fromParticipant) return fromParticipant.handle_identifier;
		if (isPhoneNumber(chat.chat_identifier)) return chat.chat_identifier;
		return null;
	});

	let contextMenu: { x: number; y: number } | null = $state(null);

	function openContextMenu(e: MouseEvent) {
		if (!phoneNumber) return;
		e.preventDefault();
		contextMenu = { x: e.clientX, y: e.clientY };
	}

	async function copyPhoneNumber() {
		if (!phoneNumber) return;
		try {
			await navigator.clipboard.writeText(phoneNumber);
		} catch (err) {
			console.error('Failed to copy phone number:', err);
		} finally {
			contextMenu = null;
		}
	}

	function closeContextMenu() {
		contextMenu = null;
	}

	function handleOverlayKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			closeContextMenu();
		}
	}
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
		identifier={avatarIdentifier}
		size={36}
	/>

	<div class="min-w-0 flex-1">
		<h2
			oncontextmenu={openContextMenu}
			class="truncate text-base font-semibold text-gray-900"
		>
			{chat.display_name ?? chat.chat_identifier}
		</h2>
		<p class="truncate text-xs text-gray-400">
			{subtitle}
		</p>
	</div>
</div>

{#if contextMenu}
	<div
		class="fixed inset-0 z-50"
		onclick={closeContextMenu}
		oncontextmenu={(e) => { e.preventDefault(); closeContextMenu(); }}
		onkeydown={handleOverlayKeydown}
		role="button"
		tabindex="-1"
		aria-label="Close menu"
	></div>
	<div
		class="fixed z-50 min-w-[180px] rounded-xl bg-white py-1 shadow-lg ring-1 ring-black/5"
		style="left: {Math.min(contextMenu.x, window.innerWidth - 188)}px; top: {Math.min(contextMenu.y, window.innerHeight - 56)}px"
	>
		<button
			onclick={copyPhoneNumber}
			class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
		>
			<svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
			</svg>
			Copy Phone Number
		</button>
	</div>
{/if}

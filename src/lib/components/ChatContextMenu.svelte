<script lang="ts">
	interface Props {
		x: number;
		y: number;
		isPinned: boolean;
		isGroup: boolean;
		hasUnread: boolean;
		onPin: () => void;
		onDelete: () => void;
		onToggleRead: () => void;
		onLeave: () => void;
		onClose: () => void;
	}

	let { x, y, isPinned, isGroup, hasUnread, onPin, onDelete, onToggleRead, onLeave, onClose }: Props = $props();

	// Adjust position so menu stays on-screen
	const menuWidth = 200;
	let adjustedX = $derived(x + menuWidth > window.innerWidth ? window.innerWidth - menuWidth - 8 : x);
	let adjustedY = $derived.by(() => {
		const menuHeight = isGroup ? 220 : 180;
		return y + menuHeight > window.innerHeight ? window.innerHeight - menuHeight - 8 : y;
	});

	// Close on Escape key and scroll
	$effect(() => {
		function handleKeydown(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				onClose();
			}
		}

		function handleScroll() {
			onClose();
		}

		window.addEventListener('keydown', handleKeydown);
		window.addEventListener('scroll', handleScroll, true);

		return () => {
			window.removeEventListener('keydown', handleKeydown);
			window.removeEventListener('scroll', handleScroll, true);
		};
	});

	function handlePin() {
		onPin();
		onClose();
	}

	function handleToggleRead() {
		onToggleRead();
		onClose();
	}

	function handleLeave() {
		onLeave();
		onClose();
	}

	function handleDelete() {
		onDelete();
		onClose();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="fixed inset-0 z-50"
	onclick={onClose}
	oncontextmenu={(e) => {
		e.preventDefault();
		onClose();
	}}
></div>
<div
	class="fixed z-[51] flex flex-col gap-1"
	style="left: {adjustedX}px; top: {adjustedY}px;"
>
	<div class="min-w-[200px] overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-black/10 dark:bg-gray-800 dark:ring-white/10">
		<!-- Pin / Unpin -->
		<button
			onclick={handlePin}
			class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
		>
			<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400" viewBox="0 0 16 16" fill="currentColor">
				<path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.126.125-.25.224-.354.298v4.431l.078.048c.203.127.476.314.751.555C12.36 7.775 13 8.527 13 9.5a.5.5 0 0 1-.5.5h-4v4.5a.5.5 0 0 1-1 0V10h-4a.5.5 0 0 1-.5-.5c0-.973.64-1.725 1.17-2.189A6 6 0 0 1 5 6.708V2.277a3 3 0 0 1-.354-.298C4.342 1.674 4 1.179 4 .5a.5.5 0 0 1 .146-.354" />
			</svg>
			{isPinned ? 'Unpin' : 'Pin'}
		</button>

		<!-- Mark as Read / Mark as Unread -->
		<button
			onclick={handleToggleRead}
			class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
		>
			<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				{#if hasUnread}
					<!-- Open envelope (mark as read) -->
					<path stroke-linecap="round" stroke-linejoin="round" d="M21.75 9v.906a2.25 2.25 0 01-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 001.183 1.981l6.478 3.488m8.839 2.51l-4.66-2.51m0 0l-1.023-.55a2.25 2.25 0 00-2.134 0l-1.022.55m0 0l-4.661 2.51m16.5 1.615a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V8.844a2.25 2.25 0 011.183-1.981l7.5-4.039a2.25 2.25 0 012.134 0l7.5 4.039a2.25 2.25 0 011.183 1.98V19.5z" />
				{:else}
					<!-- Closed envelope (mark as unread) -->
					<path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
				{/if}
			</svg>
			{hasUnread ? 'Mark as Read' : 'Mark as Unread'}
		</button>

		<hr class="border-gray-200 dark:border-gray-700" />

		<!-- Leave Conversation (group only) -->
		{#if isGroup}
			<button
				onclick={handleLeave}
				class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
				</svg>
				Leave Conversation
			</button>
		{/if}

		<!-- Delete Conversation -->
		<button
			onclick={handleDelete}
			class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
		>
			<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
			</svg>
			Delete Conversation
		</button>
	</div>
</div>

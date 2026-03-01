<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db } from '$lib/db/index.js';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import ChatListItem from './ChatListItem.svelte';
	import ChatContextMenu from './ChatContextMenu.svelte';
	import NewChatModal from './NewChatModal.svelte';
	import { getChatDisplayName, formatPhoneNumber } from '$lib/utils/format.js';
	import type { DbChat, DbHandle } from '$lib/db/types.js';

	let search = $state('');
	let newChatOpen = $state(false);
	let allChats = $state<DbChat[]>([]);
	let allHandles = $state<DbHandle[]>([]);

	let contextMenu = $state<{
		x: number;
		y: number;
		chat: DbChat;
	} | null>(null);

	let confirmDialog = $state<{
		title: string;
		message: string;
		onConfirm: () => void;
	} | null>(null);

	// Subscribe to liveQuery via $effect
	$effect(() => {
		const sub = liveQuery(() =>
			db.chats.orderBy('lastMessageDate').reverse().toArray()
		).subscribe((chats) => {
			allChats = chats;
		});
		return () => sub.unsubscribe();
	});

	$effect(() => {
		const sub = liveQuery(() => db.handles.toArray()).subscribe((handles) => {
			allHandles = handles;
		});
		return () => sub.unsubscribe();
	});

	const handleMap = $derived(new Map(allHandles.map((h) => [h.address, h.displayName])));
	const avatarMap = $derived(new Map(allHandles.map((h) => [h.address, h.avatarBase64])));

	// Deduplicate chats:
	// - Group chats (style 43): by sorted participant set
	// - 1:1 chats (style 45): by resolved contact name (merges phone + email for same person)
	const deduplicatedChats = $derived.by(() => {
		const seen = new Map<string, DbChat>();
		const result: DbChat[] = [];

		for (const chat of allChats) {
			if (chat.style === 43 && chat.participants.length > 0) {
				// Group chat: deduplicate by sorted participant set
				const key = [...chat.participants].sort().join(',');
				const existing = seen.get(key);
				if (existing) {
					if (chat.lastMessageDate > existing.lastMessageDate) {
						result[result.indexOf(existing)] = chat;
						seen.set(key, chat);
					}
					continue;
				}
				seen.set(key, chat);
			} else if (chat.style === 45 && chat.participants.length === 1) {
				// 1:1 chat: deduplicate by resolved contact name
				const name = handleMap.get(chat.participants[0]);
				if (name) {
					const key = `1:1:${name}`;
					const existing = seen.get(key);
					if (existing) {
						if (chat.lastMessageDate > existing.lastMessageDate) {
							result[result.indexOf(existing)] = chat;
							seen.set(key, chat);
						}
						continue;
					}
					seen.set(key, chat);
				}
			}
			result.push(chat);
		}

		return result;
	});

	// Map of chatGuid -> all sibling chatGuids (for merged 1:1 contacts)
	const siblingGuidsMap = $derived.by(() => {
		// Group 1:1 chats by resolved contact name
		const nameToGuids = new Map<string, string[]>();
		for (const chat of allChats) {
			if (chat.style === 45 && chat.participants.length === 1) {
				const name = handleMap.get(chat.participants[0]);
				if (name) {
					const guids = nameToGuids.get(name) ?? [];
					guids.push(chat.guid);
					nameToGuids.set(name, guids);
				}
			}
		}

		// Build guid -> allGuids map (only for contacts with multiple chats)
		const map = new Map<string, string[]>();
		for (const guids of nameToGuids.values()) {
			if (guids.length > 1) {
				for (const guid of guids) {
					map.set(guid, guids);
				}
			}
		}
		return map;
	});

	const sortedChats = $derived.by(() => {
		const filtered = search
			? deduplicatedChats.filter((c) => {
					const name = getChatDisplayName(c.displayName, c.participants, handleMap);
					return name.toLowerCase().includes(search.toLowerCase());
				})
			: deduplicatedChats;

		return [...filtered].sort((a, b) => {
			if (a.isPinned && !b.isPinned) return -1;
			if (!a.isPinned && b.isPinned) return 1;
			return b.lastMessageDate - a.lastMessageDate;
		});
	});

	const pinnedChats = $derived(sortedChats.filter((c) => c.isPinned));
	const regularChats = $derived(sortedChats.filter((c) => !c.isPinned));

	const activeChatGuid = $derived(
		page.url.pathname.startsWith('/messages/')
			? decodeURIComponent(page.url.pathname.split('/messages/')[1] ?? '')
			: ''
	);

	// Check if a chat (or any of its siblings) is the active one
	function isChatActive(guid: string): boolean {
		if (guid === activeChatGuid) return true;
		const siblings = siblingGuidsMap.get(guid);
		return siblings?.includes(activeChatGuid) ?? false;
	}

	async function handlePin(chat: DbChat) {
		const newPinned = !chat.isPinned;
		// Optimistic update
		await db.chats.update(chat.guid, { isPinned: newPinned });
		try {
			const res = await fetch('/api/plist/pinned', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ chatIdentifier: chat.chatIdentifier, pinned: newPinned })
			});
			if (!res.ok) {
				await db.chats.update(chat.guid, { isPinned: !newPinned });
			}
		} catch {
			// Revert on failure
			await db.chats.update(chat.guid, { isPinned: !newPinned });
		}
	}

	async function handleToggleRead(chat: DbChat) {
		const allGuids = siblingGuidsMap.get(chat.guid) ?? [chat.guid];
		if (chat.unreadCount > 0) {
			// Mark as read
			for (const guid of allGuids) {
				await db.chats.update(guid, { unreadCount: 0 });
			}
			for (const guid of allGuids) {
				fetch(`/api/proxy/chat/${encodeURIComponent(guid)}/read`, { method: 'POST' }).catch(() => {});
			}
		} else {
			// Mark as unread
			for (const guid of allGuids) {
				await db.chats.update(guid, { unreadCount: 1 });
			}
			for (const guid of allGuids) {
				fetch(`/api/proxy/chat/${encodeURIComponent(guid)}/unread`, { method: 'POST' }).catch(() => {});
			}
		}
	}

	function handleDelete(chat: DbChat) {
		confirmDialog = {
			title: 'Delete Conversation',
			message: 'This conversation will be removed from your Messages app too. This cannot be undone.',
			onConfirm: async () => {
				confirmDialog = null;
				const allGuids = siblingGuidsMap.get(chat.guid) ?? [chat.guid];

				// Navigate away if active
				if (allGuids.some((g) => isChatActive(g))) {
					await goto('/messages');
				}

				// Delete from IndexedDB and API
				for (const guid of allGuids) {
					await db.messages.where('chatGuid').equals(guid).delete();
					await db.chats.delete(guid);
					fetch(`/api/proxy/chat/${encodeURIComponent(guid)}`, { method: 'DELETE' }).catch(() => {});
				}
			}
		};
	}

	function handleLeave(chat: DbChat) {
		confirmDialog = {
			title: 'Leave Conversation',
			message: "You won't receive new messages from this group.",
			onConfirm: async () => {
				confirmDialog = null;
				if (isChatActive(chat.guid)) {
					await goto('/messages');
				}
				await db.messages.where('chatGuid').equals(chat.guid).delete();
				await db.chats.delete(chat.guid);
				fetch(`/api/proxy/chat/${encodeURIComponent(chat.guid)}/leave`, { method: 'POST' }).catch(() => {});
			}
		};
	}

</script>

<div class="flex h-full flex-col">
	<div class="p-3">
		<div class="flex items-center gap-2">
			<input
				bind:value={search}
				type="text"
				placeholder="Search conversations..."
				class="flex-1 rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
			/>
			<button
				onclick={() => (newChatOpen = true)}
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
				aria-label="New conversation"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
				</svg>
			</button>
		</div>
	</div>
	<!-- Pinned chats: sticky at top, always visible -->
	{#if pinnedChats.length > 0}
		<div class="shrink-0 border-b border-gray-200 dark:border-gray-700">
			{#each pinnedChats as chat (chat.guid)}
				{@const chatParticipants = chat.participants.map((addr) => {
					const name = handleMap.get(addr) || formatPhoneNumber(addr);
					const raw = avatarMap.get(addr);
					const mime = raw?.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
					return { name, avatar: raw ? `data:${mime};base64,${raw}` : null };
				})}
				<ChatListItem
					guid={chat.guid}
					displayName={getChatDisplayName(chat.displayName, chat.participants, handleMap)}
					lastMessage={chat.lastMessageText}
					lastMessageDate={chat.lastMessageDate}
					unreadCount={chat.unreadCount}
					isActive={isChatActive(chat.guid)}
					isPinned={chat.isPinned}
					participants={chatParticipants}
					oncontextmenu={(e) => { contextMenu = { x: e.clientX, y: e.clientY, chat }; }}
				/>
			{/each}
		</div>
	{/if}

	<!-- Regular chats: scrollable -->
	<div class="flex-1 overflow-y-auto">
		{#each regularChats as chat (chat.guid)}
			{@const chatParticipants = chat.participants.map((addr) => {
				const name = handleMap.get(addr) || formatPhoneNumber(addr);
				const raw = avatarMap.get(addr);
				const mime = raw?.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
				return { name, avatar: raw ? `data:${mime};base64,${raw}` : null };
			})}
			<ChatListItem
				guid={chat.guid}
				displayName={getChatDisplayName(chat.displayName, chat.participants, handleMap)}
				lastMessage={chat.lastMessageText}
				lastMessageDate={chat.lastMessageDate}
				unreadCount={chat.unreadCount}
				isActive={isChatActive(chat.guid)}
				isPinned={false}
				participants={chatParticipants}
				oncontextmenu={(e) => { contextMenu = { x: e.clientX, y: e.clientY, chat }; }}
			/>
		{:else}
			<p class="p-4 text-center text-sm text-gray-400">No conversations</p>
		{/each}
	</div>
</div>

<NewChatModal open={newChatOpen} onClose={() => (newChatOpen = false)} />

{#if contextMenu}
	<ChatContextMenu
		x={contextMenu.x}
		y={contextMenu.y}
		isPinned={contextMenu.chat.isPinned}
		isGroup={contextMenu.chat.style === 43}
		hasUnread={contextMenu.chat.unreadCount > 0}
		onPin={() => handlePin(contextMenu!.chat)}
		onDelete={() => handleDelete(contextMenu!.chat)}
		onToggleRead={() => handleToggleRead(contextMenu!.chat)}
		onLeave={() => handleLeave(contextMenu!.chat)}
		onClose={() => { contextMenu = null; }}
	/>
{/if}

{#if confirmDialog}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onclick={() => { confirmDialog = null; }}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-800" onclick={(e) => e.stopPropagation()}>
			<h3 class="text-lg font-semibold dark:text-white">{confirmDialog.title}</h3>
			<p class="mt-2 text-sm text-gray-500 dark:text-gray-400">{confirmDialog.message}</p>
			<div class="mt-4 flex justify-end gap-2">
				<button
					onclick={() => { confirmDialog = null; }}
					class="rounded-lg px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
				>
					Cancel
				</button>
				<button
					onclick={confirmDialog.onConfirm}
					class="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
				>
					{confirmDialog.title.startsWith('Leave') ? 'Leave' : 'Delete'}
				</button>
			</div>
		</div>
	</div>
{/if}

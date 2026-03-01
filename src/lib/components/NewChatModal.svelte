<script lang="ts">
	import { goto } from '$app/navigation';
	import { liveQuery } from 'dexie';
	import { db } from '$lib/db/index.js';
	import type { DbHandle, DbChat } from '$lib/db/types.js';
	import { formatPhoneNumber } from '$lib/utils/format.js';

	interface Props {
		open: boolean;
		onClose: () => void;
	}

	let { open, onClose }: Props = $props();

	// ── State ──
	let query = $state('');
	let selectedRecipients = $state<
		{ displayName: string; address: string; avatarBase64: string | null }[]
	>([]);
	let highlightedIndex = $state(0);
	let creating = $state(false);
	let error = $state('');
	let dialogEl: HTMLDialogElement | undefined = $state();
	let inputEl: HTMLInputElement | undefined = $state();

	// ── Dexie live queries ──
	let allHandles = $state<DbHandle[]>([]);
	let allChats = $state<DbChat[]>([]);

	$effect(() => {
		const sub = liveQuery(() => db.handles.toArray()).subscribe((handles) => {
			allHandles = handles;
		});
		return () => sub.unsubscribe();
	});

	$effect(() => {
		const sub = liveQuery(() => db.chats.toArray()).subscribe((chats) => {
			allChats = chats;
		});
		return () => sub.unsubscribe();
	});

	// ── Dialog open/close ──
	$effect(() => {
		if (!dialogEl) return;
		if (open && !dialogEl.open) {
			dialogEl.showModal();
			// Focus input after opening
			setTimeout(() => inputEl?.focus(), 50);
		} else if (!open && dialogEl.open) {
			dialogEl.close();
		}
	});

	// Reset state when modal opens
	$effect(() => {
		if (open) {
			query = '';
			selectedRecipients = [];
			highlightedIndex = 0;
			error = '';
			creating = false;
		}
	});

	// ── Helper maps ──

	// Map: displayName -> all handles with that displayName
	const handlesByName = $derived.by(() => {
		const map = new Map<string, DbHandle[]>();
		for (const h of allHandles) {
			if (!h.displayName) continue;
			const existing = map.get(h.displayName);
			if (existing) {
				existing.push(h);
			} else {
				map.set(h.displayName, [h]);
			}
		}
		return map;
	});

	// Map: address -> DbHandle (for quick lookup)
	const handleByAddress = $derived(new Map(allHandles.map((h) => [h.address, h])));

	// Set of addresses that are in 1:1 chats, with the chat for sorting
	const addressTo1to1Chat = $derived.by(() => {
		const map = new Map<string, DbChat>();
		for (const chat of allChats) {
			if (chat.style === 45 && chat.participants.length === 1) {
				const addr = chat.participants[0];
				const existing = map.get(addr);
				if (!existing || chat.lastMessageDate > existing.lastMessageDate) {
					map.set(addr, chat);
				}
			}
		}
		return map;
	});

	// ── Search results (derived) ──

	interface SearchResult {
		displayName: string;
		address: string;
		avatarBase64: string | null;
		isFallback?: boolean;
	}

	const searchResults = $derived.by((): SearchResult[] => {
		const q = query.trim().toLowerCase();
		if (!q) return [];

		const selectedAddresses = new Set(selectedRecipients.map((r) => r.address));
		const selectedNames = new Set(selectedRecipients.map((r) => r.displayName));

		// Collect all matching handles
		const matchingHandles: DbHandle[] = [];
		for (const h of allHandles) {
			// Skip already-selected addresses
			if (selectedAddresses.has(h.address)) continue;

			const nameMatch = h.displayName?.toLowerCase().includes(q);
			const addrMatch = h.address.toLowerCase().includes(q);
			if (nameMatch || addrMatch) {
				matchingHandles.push(h);
			}
		}

		// Deduplicate by displayName: group handles sharing the same displayName,
		// pick the "primary" address
		const seenNames = new Set<string>();
		const results: SearchResult[] = [];

		// Group by displayName
		const grouped = new Map<string, DbHandle[]>();
		const noName: DbHandle[] = [];
		for (const h of matchingHandles) {
			if (h.displayName) {
				const existing = grouped.get(h.displayName);
				if (existing) {
					existing.push(h);
				} else {
					grouped.set(h.displayName, [h]);
				}
			} else {
				noName.push(h);
			}
		}

		// For each named group, pick a primary address
		for (const [name, handles] of grouped) {
			if (seenNames.has(name)) continue;
			// Skip if this name is already selected
			if (selectedNames.has(name)) continue;
			seenNames.add(name);

			const primary = pickPrimaryHandle(handles);
			results.push({
				displayName: name,
				address: primary.address,
				avatarBase64: primary.avatarBase64
			});
		}

		// Add unnamed handles (matched by address)
		for (const h of noName) {
			results.push({
				displayName: formatPhoneNumber(h.address),
				address: h.address,
				avatarBase64: h.avatarBase64
			});
		}

		// If no results and query looks like phone/email, add fallback
		if (results.length === 0 && looksLikePhoneOrEmail(q)) {
			results.push({
				displayName: `Send to ${query.trim()}`,
				address: query.trim(),
				avatarBase64: null,
				isFallback: true
			});
		}

		return results.slice(0, 8);
	});

	// Reset highlighted index when search results change
	$effect(() => {
		// Access searchResults to track it
		searchResults;
		highlightedIndex = 0;
	});

	function pickPrimaryHandle(handles: DbHandle[]): DbHandle {
		// Prefer address with an existing 1:1 chat (most recently active)
		const withChat = handles
			.filter((h) => addressTo1to1Chat.has(h.address))
			.sort((a, b) => {
				const chatA = addressTo1to1Chat.get(a.address)!;
				const chatB = addressTo1to1Chat.get(b.address)!;
				return chatB.lastMessageDate - chatA.lastMessageDate;
			});
		if (withChat.length > 0) return withChat[0];

		// Prefer phone over email
		const phones = handles.filter((h) => !h.address.includes('@'));
		if (phones.length > 0) return phones[0];

		return handles[0];
	}

	function looksLikePhoneOrEmail(q: string): boolean {
		// Email-like
		if (q.includes('@') && q.includes('.')) return true;
		// Phone-like: starts with + or has mostly digits
		const digits = q.replace(/[\s\-()]/g, '');
		if (digits.startsWith('+') && digits.length >= 8) return true;
		if (/^\d{7,}$/.test(digits)) return true;
		return false;
	}

	// ── Existing conversation detection ──

	function findExisting1to1(address: string): DbChat | null {
		// Find the display name for this address
		const handle = handleByAddress.get(address);
		const name = handle?.displayName;

		// Collect all addresses for the same contact
		const addresses: string[] = [address];
		if (name) {
			const siblings = handlesByName.get(name);
			if (siblings) {
				for (const s of siblings) {
					if (!addresses.includes(s.address)) {
						addresses.push(s.address);
					}
				}
			}
		}

		// Find 1:1 chats with any of these addresses
		let bestChat: DbChat | null = null;
		for (const addr of addresses) {
			const chat = addressTo1to1Chat.get(addr);
			if (chat && (!bestChat || chat.lastMessageDate > bestChat.lastMessageDate)) {
				bestChat = chat;
			}
		}
		return bestChat;
	}

	function findExistingGroup(addresses: string[]): DbChat | null {
		// Expand each address to all addresses for the same contact
		const expandedSets: Set<string>[] = addresses.map((addr) => {
			const set = new Set<string>([addr]);
			const handle = handleByAddress.get(addr);
			if (handle?.displayName) {
				const siblings = handlesByName.get(handle.displayName);
				if (siblings) {
					for (const s of siblings) set.add(s.address);
				}
			}
			return set;
		});

		for (const chat of allChats) {
			if (chat.style !== 43) continue;
			if (chat.participants.length !== addresses.length) continue;

			// Check if each participant matches one of the expanded sets
			const usedSets = new Set<number>();
			let allMatched = true;
			for (const participant of chat.participants) {
				let found = false;
				for (let i = 0; i < expandedSets.length; i++) {
					if (!usedSets.has(i) && expandedSets[i].has(participant)) {
						usedSets.add(i);
						found = true;
						break;
					}
				}
				if (!found) {
					allMatched = false;
					break;
				}
			}
			if (allMatched && usedSets.size === addresses.length) return chat;
		}
		return null;
	}

	// ── Actions ──

	function selectResult(result: SearchResult) {
		if (selectedRecipients.length === 0) {
			// Enter behavior: navigate to existing 1:1 or create new
			navigateTo1to1(result);
		} else {
			// Add to group
			addRecipient(result);
		}
	}

	function addRecipient(result: SearchResult) {
		if (selectedRecipients.some((r) => r.address === result.address)) return;
		selectedRecipients = [
			...selectedRecipients,
			{
				displayName: result.isFallback ? formatPhoneNumber(result.address) : result.displayName,
				address: result.address,
				avatarBase64: result.avatarBase64
			}
		];
		query = '';
		highlightedIndex = 0;
		inputEl?.focus();
	}

	function removeRecipient(index: number) {
		selectedRecipients = selectedRecipients.filter((_, i) => i !== index);
		inputEl?.focus();
	}

	async function navigateTo1to1(result: SearchResult) {
		const existing = findExisting1to1(result.address);
		if (existing) {
			onClose();
			goto(`/messages/${encodeURIComponent(existing.guid)}`);
			return;
		}
		// Create new chat
		await createChat([result.address]);
	}

	async function createGroupChat() {
		if (selectedRecipients.length < 2) return;
		const addresses = selectedRecipients.map((r) => r.address);

		// Check for existing group
		const existing = findExistingGroup(addresses);
		if (existing) {
			onClose();
			goto(`/messages/${encodeURIComponent(existing.guid)}`);
			return;
		}

		await createChat(addresses);
	}

	async function createChat(addresses: string[]) {
		creating = true;
		error = '';

		try {
			const body: Record<string, unknown> = {
				addresses,
				method: 'private-api',
				service: 'iMessage'
			};

			const res = await fetch('/api/proxy/chat/new', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});

			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || `Request failed (${res.status})`);
			}

			const json = await res.json();
			const chatGuid = json?.data?.guid;

			if (!chatGuid) {
				throw new Error('No chat GUID returned');
			}

			onClose();
			goto(`/messages/${encodeURIComponent(chatGuid)}`);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to create chat';
		} finally {
			creating = false;
		}
	}

	// ── Keyboard handling ──

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (searchResults.length > 0) {
				highlightedIndex = (highlightedIndex + 1) % searchResults.length;
			}
			return;
		}

		if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (searchResults.length > 0) {
				highlightedIndex = (highlightedIndex - 1 + searchResults.length) % searchResults.length;
			}
			return;
		}

		if (e.key === 'Enter') {
			e.preventDefault();
			if (creating) return;
			if (searchResults.length > 0 && highlightedIndex < searchResults.length) {
				selectResult(searchResults[highlightedIndex]);
			}
			return;
		}

		if (e.key === 'Tab') {
			e.preventDefault();
			if (searchResults.length > 0 && highlightedIndex < searchResults.length) {
				addRecipient(searchResults[highlightedIndex]);
			}
			return;
		}

		if (e.key === 'Backspace' && query === '' && selectedRecipients.length > 0) {
			removeRecipient(selectedRecipients.length - 1);
			return;
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === dialogEl) {
			onClose();
		}
	}

	// ── Avatar helpers ──
	const colors = [
		'bg-blue-500',
		'bg-green-500',
		'bg-orange-500',
		'bg-purple-500',
		'bg-pink-500',
		'bg-teal-500',
		'bg-red-500',
		'bg-indigo-500'
	];

	function getColor(name: string): string {
		let hash = 0;
		for (let i = 0; i < name.length; i++) {
			hash = name.charCodeAt(i) + ((hash << 5) - hash);
		}
		return colors[Math.abs(hash) % colors.length];
	}

	function getInitials(name: string): string {
		return name
			.replace(/[^\p{L}\p{N}\s]/gu, '')
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase() ?? '')
			.join('');
	}

	function avatarSrc(base64: string | null): string | null {
		if (!base64) return null;
		const mime = base64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
		return `data:${mime};base64,${base64}`;
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
	bind:this={dialogEl}
	onclose={onClose}
	onclick={handleBackdropClick}
	class="m-auto w-full max-w-md rounded-2xl bg-white p-0 shadow-xl backdrop:bg-black/50 backdrop:backdrop-blur-sm dark:bg-gray-900"
>
	<div class="flex flex-col gap-4 p-5">
		<!-- Header -->
		<div class="flex items-center justify-between">
			<h2 class="text-lg font-semibold dark:text-white">New Conversation</h2>
			<button
				onclick={onClose}
				class="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
				aria-label="Close"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-4 w-4"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>

		<!-- To: field with chips and search input -->
		<div class="relative">
			<div
				class="flex flex-wrap items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500 dark:bg-gray-800"
			>
				<span class="text-sm font-medium text-gray-500 dark:text-gray-400">To:</span>

				<!-- Chips -->
				{#each selectedRecipients as recipient, i}
					<span
						class="flex items-center gap-1 rounded-full bg-blue-100 py-0.5 pl-2.5 pr-0.5 text-sm text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
					>
						{recipient.displayName}
						<button
							onclick={() => removeRecipient(i)}
							class="flex h-5 w-5 items-center justify-center rounded-full transition-colors hover:bg-blue-200 dark:hover:bg-blue-800"
							aria-label="Remove {recipient.displayName}"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-3 w-3"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								stroke-width="2"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M6 18L18 6M6 6l12 12"
								/>
							</svg>
						</button>
					</span>
				{/each}

				<!-- Search input -->
				<input
					bind:this={inputEl}
					bind:value={query}
					onkeydown={handleKeydown}
					type="text"
					placeholder={selectedRecipients.length === 0 ? 'Search contacts...' : ''}
					aria-label="Search contacts or enter phone number or email"
					class="min-w-[80px] flex-1 bg-transparent text-sm outline-none dark:text-white"
				/>
			</div>

			<!-- Search dropdown -->
			{#if query.trim() && searchResults.length > 0}
				<div
					class="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
				>
					{#each searchResults as result, i}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="flex cursor-pointer items-center gap-3 px-3 py-2.5 {i === highlightedIndex
								? 'bg-blue-50 dark:bg-blue-900/30'
								: 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}"
							onmousedown={(e) => {
								e.preventDefault();
								selectResult(result);
							}}
							onmouseenter={() => {
								highlightedIndex = i;
							}}
						>
							<!-- Avatar -->
							{#if result.isFallback}
								<div
									class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-400 text-xs font-semibold text-white"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="h-4 w-4"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
										stroke-width="2"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M12 4v16m8-8H4"
										/>
									</svg>
								</div>
							{:else}
								{@const src = avatarSrc(result.avatarBase64)}
								{#if src}
									<img
										{src}
										alt={result.displayName}
										class="h-8 w-8 shrink-0 rounded-full object-cover"
									/>
								{:else}
									<div
										class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white {getColor(
											result.displayName
										)}"
									>
										{getInitials(result.displayName) || '?'}
									</div>
								{/if}
							{/if}

							<!-- Name and address -->
							<div class="min-w-0 flex-1">
								<div class="truncate text-sm font-medium dark:text-white">
									{result.displayName}
								</div>
								{#if !result.isFallback && result.displayName !== formatPhoneNumber(result.address)}
									<div class="truncate text-xs text-gray-500 dark:text-gray-400">
										{formatPhoneNumber(result.address)}
									</div>
								{/if}
							</div>

							<!-- Keyboard hints (only when 0 recipients selected) -->
							{#if selectedRecipients.length === 0 && i === highlightedIndex}
								<div class="flex shrink-0 gap-1.5">
									<kbd
										class="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-600 dark:text-gray-300"
										>&#x23CE;</kbd
									>
									<kbd
										class="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-600 dark:text-gray-300"
										>tab</kbd
									>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Hint text -->
		{#if selectedRecipients.length === 0 && !query.trim()}
			<p class="text-xs text-gray-400 dark:text-gray-500">
				Press Enter to open conversation, Tab to start a group
			</p>
		{/if}

		<!-- Error -->
		{#if error}
			<p class="text-sm text-red-500">{error}</p>
		{/if}

		<!-- Create Group button (2+ recipients) -->
		{#if selectedRecipients.length >= 2}
			<button
				onclick={createGroupChat}
				disabled={creating}
				class="rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:bg-blue-600 disabled:opacity-40"
			>
				{creating ? 'Creating...' : `Create Group (${selectedRecipients.length})`}
			</button>
		{/if}
	</div>
</dialog>

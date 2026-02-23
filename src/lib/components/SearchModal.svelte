<script lang="ts">
	import { goto } from '$app/navigation';
	import { formatChatListDate } from '$lib/utils/date.js';

	let { open = $bindable(false) }: { open: boolean } = $props();

	let query = $state('');
	let results: Array<{
		message_rowid: number;
		message_guid: string;
		text: string;
		is_from_me: boolean;
		date: number;
		chat_id: number;
		chat_display_name: string;
		sender: string;
	}> = $state([]);
	let searching = $state(false);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	function handleInput() {
		clearTimeout(searchTimer);
		if (query.trim().length < 2) {
			results = [];
			return;
		}
		searchTimer = setTimeout(doSearch, 300);
	}

	async function doSearch() {
		const q = query.trim();
		if (q.length < 2) return;
		searching = true;

		try {
			const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=20`);
			const data = await res.json();
			results = data.results;
		} catch {
			results = [];
		} finally {
			searching = false;
		}
	}

	function selectResult(chatId: number) {
		open = false;
		query = '';
		results = [];
		goto(`/chat/${chatId}`);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			open = false;
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_interactive_supports_focus -->
	<div
		class="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-20"
		role="dialog"
		aria-modal="true"
		aria-label="Search messages"
		onkeydown={handleKeydown}
	>
		<div class="mx-4 w-full max-w-lg rounded-2xl bg-white shadow-xl">
			<div class="p-4">
				<input
					type="text"
					placeholder="Search messages..."
					bind:value={query}
					oninput={handleInput}
					class="w-full rounded-lg bg-gray-100 px-4 py-3 text-sm outline-none placeholder:text-gray-400 focus:ring-2 focus:ring-blue-300"
				/>
			</div>

			{#if searching}
				<div class="px-4 pb-4 text-center text-sm text-gray-400">Searching...</div>
			{:else if results.length > 0}
				<div class="max-h-96 overflow-y-auto border-t border-gray-100">
					{#each results as result}
						<button
							class="flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-gray-50"
							onclick={() => selectResult(result.chat_id)}
						>
							<div class="flex items-baseline justify-between gap-2">
								<span class="text-sm font-medium text-gray-900">
									{result.chat_display_name}
								</span>
								<span class="shrink-0 text-xs text-gray-400">
									{formatChatListDate(result.date)}
								</span>
							</div>
							<p class="truncate text-sm text-gray-500">
								<span class="font-medium">{result.sender}: </span>
								{result.text}
							</p>
						</button>
					{/each}
				</div>
			{:else if query.trim().length >= 2}
				<div class="px-4 pb-4 text-center text-sm text-gray-400">No results found</div>
			{/if}
		</div>
	</div>
{/if}

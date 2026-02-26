<script lang="ts">
	import type { Message } from '$lib/types/index.js';
	import MessageBubble from './MessageBubble.svelte';
	import MessageContextMenu from './MessageContextMenu.svelte';
	import { formatScheduledTime, formatTimeSeparator, isTimeSeparatorNeeded } from '$lib/utils/date.js';

	let {
		messages,
		isGroup = false,
		onLoadMore,
		hasMore = false,
		loading = false,
		onReact,
		onReply,
		onEdit,
		onUnsend,
		editingMessage = null,
		onSubmitEdit,
		onCancelEdit
	}: {
		messages: Message[];
		isGroup?: boolean;
		onLoadMore?: () => void | Promise<void>;
		hasMore?: boolean;
		loading?: boolean;
		onReact?: (message: Message, reactionType: number) => void;
		onReply?: (message: Message) => void;
		onEdit?: (message: Message) => void;
		onUnsend?: (message: Message) => void;
		editingMessage?: Message | null;
		onSubmitEdit?: (
			message: Message,
			text: string,
			options?: { scheduledForMs?: number }
		) => void | Promise<void>;
		onCancelEdit?: () => void;
	} = $props();

	let scrollContainer: HTMLDivElement | undefined = $state();
	let wasAtBottom = true;
	let loadInFlight = false;
	let editDraft = $state('');
	let editSaving = $state(false);
	let inlineEditTextarea: HTMLTextAreaElement | undefined = $state();
	let appliedEditGuid: string | null = $state(null);
	let editScheduleDate = $state('');
	let editScheduleTime = $state('');
	let sendLaterCollapsed = $state(false);
	let lastScheduledCount = $state(0);

	const messageMap = $derived.by(() => {
		const map = new Map<string, Message>();
		for (const msg of messages) {
			map.set(msg.guid, msg);
		}
		return map;
	});

	const scheduledMessages = $derived.by(() =>
		[...messages]
			.filter((msg) => msg.is_from_me && isScheduledPending(msg))
			.sort((a, b) => a.date - b.date)
	);
	const scheduledMessageGuidSet = $derived.by(() => new Set(scheduledMessages.map((msg) => msg.guid)));
	const regularMessages = $derived.by(() =>
		messages.filter((msg) => !scheduledMessageGuidSet.has(msg.guid))
	);

	$effect(() => {
		if (messages.length && scrollContainer && wasAtBottom) {
			scrollContainer.scrollTop = scrollContainer.scrollHeight;
		}
	});

	$effect(() => {
		if (editingMessage && isScheduledPending(editingMessage)) {
			sendLaterCollapsed = false;
		}
	});

	$effect(() => {
		const count = scheduledMessages.length;
		if (count > lastScheduledCount) {
			sendLaterCollapsed = false;
		}
		if (count === 0) {
			sendLaterCollapsed = false;
		}
		lastScheduledCount = count;
	});

	async function handleScroll() {
		if (!scrollContainer) return;

		const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
		wasAtBottom = scrollHeight - scrollTop - clientHeight < 50;

		if (
			scrollTop < 100 &&
			messages.length > 0 &&
			hasMore &&
			!loading &&
			!loadInFlight &&
			onLoadMore
		) {
			const prevHeight = scrollHeight;
			const prevTop = scrollTop;
			loadInFlight = true;
			try {
				await onLoadMore();
			} catch (err) {
				console.error('Failed to load older messages:', err);
			} finally {
				loadInFlight = false;
			}
			requestAnimationFrame(() => {
				if (scrollContainer) {
					const delta = scrollContainer.scrollHeight - prevHeight;
					scrollContainer.scrollTop = Math.max(0, prevTop + delta);
				}
			});
		}
	}

	function shouldShowSender(msg: Message, prevMsg: Message | undefined): boolean {
		if (!isGroup || msg.is_from_me) return false;
		if (!prevMsg) return true;
		return prevMsg.is_from_me || prevMsg.sender !== msg.sender;
	}

	function localDateInputValue(value: Date): string {
		const y = value.getFullYear();
		const m = String(value.getMonth() + 1).padStart(2, '0');
		const d = String(value.getDate()).padStart(2, '0');
		return `${y}-${m}-${d}`;
	}

	function localTimeInputValue(value: Date): string {
		const h = String(value.getHours()).padStart(2, '0');
		const m = String(value.getMinutes()).padStart(2, '0');
		return `${h}:${m}`;
	}

	$effect(() => {
		const guid = editingMessage?.guid ?? null;
		if (!guid) {
			appliedEditGuid = null;
			editDraft = '';
			editScheduleDate = '';
			editScheduleTime = '';
			editSaving = false;
			return;
		}
		if (guid === appliedEditGuid) return;
		appliedEditGuid = guid;
		editDraft = editingMessage?.body ?? editingMessage?.text ?? '';
		if (editingMessage && isScheduledPending(editingMessage)) {
			const scheduledDate = new Date(editingMessage.date);
			editScheduleDate = localDateInputValue(scheduledDate);
			editScheduleTime = localTimeInputValue(scheduledDate);
		} else {
			editScheduleDate = '';
			editScheduleTime = '';
		}
		editSaving = false;

		queueMicrotask(() => {
			if (!inlineEditTextarea) return;
			inlineEditTextarea.focus();
			const len = inlineEditTextarea.value.length;
			inlineEditTextarea.setSelectionRange(len, len);
			inlineEditTextarea.style.height = 'auto';
			inlineEditTextarea.style.height = Math.min(inlineEditTextarea.scrollHeight, 160) + 'px';
		});
	});

	const editScheduleTimestamp = $derived.by(() => {
		if (!editScheduleDate || !editScheduleTime) return null;
		const parsed = new Date(`${editScheduleDate}T${editScheduleTime}`);
		const ms = parsed.getTime();
		return Number.isFinite(ms) ? ms : null;
	});

	function handleInlineEditInput() {
		if (!inlineEditTextarea) return;
		inlineEditTextarea.style.height = 'auto';
		inlineEditTextarea.style.height = Math.min(inlineEditTextarea.scrollHeight, 160) + 'px';
	}

	function hasTextChange(msg: Message): boolean {
		const beforeText = (msg.body ?? msg.text ?? '').trim();
		const afterText = editDraft.trim();
		return afterText.length > 0 && afterText !== beforeText;
	}

	function hasScheduleChange(msg: Message): boolean {
		if (!isScheduledPending(msg) || editScheduleTimestamp == null) return false;
		return Math.abs(editScheduleTimestamp - msg.date) > 1000;
	}

	function canSaveInlineEdit(msg: Message): boolean {
		const beforeText = (msg.body ?? msg.text ?? '').trim();
		const afterText = editDraft.trim() || beforeText;
		if (!afterText.length) return false;
		if (isScheduledPending(msg) && editScheduleTimestamp != null && editScheduleTimestamp <= Date.now() + 30_000) {
			return false;
		}
		return hasTextChange(msg) || hasScheduleChange(msg);
	}

	async function saveInlineEdit(msg: Message) {
		if (!onSubmitEdit || editSaving || !canSaveInlineEdit(msg)) return;

		const beforeText = (msg.body ?? msg.text ?? '').trim();
		const afterText = editDraft.trim() || beforeText;
		const scheduledForMs = hasScheduleChange(msg) ? editScheduleTimestamp ?? undefined : undefined;

		editSaving = true;
		try {
			await onSubmitEdit(msg, afterText, { scheduledForMs });
		} finally {
			editSaving = false;
		}
	}

	function cancelInlineEdit() {
		editDraft = '';
		editScheduleDate = '';
		editScheduleTime = '';
		editSaving = false;
		onCancelEdit?.();
	}

	function handleInlineEditKeydown(e: KeyboardEvent, msg: Message) {
		if (e.key === 'Escape') {
			e.preventDefault();
			cancelInlineEdit();
			return;
		}
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void saveInlineEdit(msg);
		}
	}

	function isUnsent(msg: Message): boolean {
		return !!(msg.date_retracted && msg.date_retracted > 0);
	}

	function isScheduledPending(msg: Message): boolean {
		return !isUnsent(msg) && msg.schedule_type === 2 && msg.date > Date.now();
	}

	const statusMap = $derived.by(() => {
		const map = new Map<string, string>();
		if (!messages.length) return map;

		const trailingSentIndexes: number[] = [];
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (isScheduledPending(msg) && msg.is_from_me) continue;
			if (!msg.is_from_me) break;
			if (!isUnsent(msg)) trailingSentIndexes.push(i);
		}
		if (trailingSentIndexes.length === 0) return map;
		trailingSentIndexes.reverse();

		let lastReadIdx = -1;
		for (let i = trailingSentIndexes.length - 1; i >= 0; i--) {
			const msgIdx = trailingSentIndexes[i];
			if (messages[msgIdx].is_read) {
				lastReadIdx = msgIdx;
				break;
			}
		}

		const lastStatusIdx = trailingSentIndexes[trailingSentIndexes.length - 1];
		if (lastReadIdx !== -1 && lastReadIdx < lastStatusIdx) {
			map.set(messages[lastReadIdx].guid, 'Read');
		}

		const last = messages[lastStatusIdx];
		if (last.is_read) {
			map.set(last.guid, 'Read');
		} else if (last.is_delivered) {
			map.set(last.guid, 'Delivered');
		} else if (last.is_sent) {
			map.set(last.guid, 'Sent');
		} else if (last.rowid < 0) {
			map.set(last.guid, 'Sending...');
		}

		return map;
	});

	let contextMenu: { message: Message; x: number; y: number } | null = $state(null);

	function handleContextMenu(e: MouseEvent, msg: Message) {
		contextMenu = { message: msg, x: e.clientX, y: e.clientY };
	}
</script>

<div
	bind:this={scrollContainer}
	onscroll={handleScroll}
	class="flex min-h-0 min-w-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-3 pt-3"
>
	{#if loading}
		<div class="py-2 text-center text-xs text-gray-400">Loading older messages...</div>
	{/if}

	{#each regularMessages as msg, i (msg.rowid)}
		{@const prevMsg = i > 0 ? regularMessages[i - 1] : undefined}
		{@const showTimeSep = !prevMsg || isTimeSeparatorNeeded(prevMsg.date, msg.date)}
		{@const replyTo = msg.thread_originator_guid ? messageMap.get(msg.thread_originator_guid) : undefined}
		{@const showSender = shouldShowSender(msg, prevMsg)}

		{#if showTimeSep}
			<div class="py-2 text-center text-xs text-gray-400">
				{formatTimeSeparator(msg.date)}
			</div>
		{/if}

		{#if editingMessage && editingMessage.guid === msg.guid}
			<div class="flex justify-end group">
				<div class="min-w-0 max-w-[75%]">
					<div class="rounded-2xl border border-blue-200 bg-blue-50 p-2">
						<textarea
							bind:this={inlineEditTextarea}
							bind:value={editDraft}
							oninput={handleInlineEditInput}
							onkeydown={(e) => handleInlineEditKeydown(e, msg)}
							rows="1"
							class="w-full resize-none rounded-xl bg-white px-3 py-2 text-sm text-gray-900 outline-none ring-1 ring-blue-100 focus:ring-2 focus:ring-blue-300"
						></textarea>
						{#if isScheduledPending(msg)}
							<div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
								<label class="flex flex-col gap-1 text-[11px] font-medium text-blue-700">
									Send date
									<input
										type="date"
										bind:value={editScheduleDate}
										class="rounded-lg border border-blue-100 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:ring-2 focus:ring-blue-300"
									/>
								</label>
								<label class="flex flex-col gap-1 text-[11px] font-medium text-blue-700">
									Send time
									<input
										type="time"
										bind:value={editScheduleTime}
										step="60"
										class="rounded-lg border border-blue-100 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:ring-2 focus:ring-blue-300"
									/>
								</label>
							</div>
						{/if}
						<div class="mt-2 flex items-center justify-end gap-2">
							<button
								onclick={cancelInlineEdit}
								class="rounded-lg px-3 py-1.5 text-xs text-gray-600 hover:bg-white"
							>
								Cancel
							</button>
							<button
								onclick={() => saveInlineEdit(msg)}
								disabled={editSaving || !canSaveInlineEdit(msg)}
								class="rounded-lg bg-blue-500 px-3 py-1.5 text-xs text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-blue-300"
							>
								{editSaving ? 'Saving...' : 'Save'}
							</button>
						</div>
					</div>
				</div>
			</div>
		{:else}
			<MessageBubble
				message={msg}
				{isGroup}
				{replyTo}
				{showSender}
				statusText={statusMap.get(msg.guid)}
				onContextMenu={handleContextMenu}
			/>
		{/if}
	{/each}

	{#if scheduledMessages.length > 0}
		<div class="py-2 text-center text-xs text-blue-600">
			<button
				type="button"
				class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-blue-50"
				onclick={() => {
					sendLaterCollapsed = !sendLaterCollapsed;
				}}
			>
				<svg
					class="h-3.5 w-3.5 transition-transform {sendLaterCollapsed ? '' : 'rotate-90'}"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
				</svg>
				<span class="font-medium">Send Later</span>
				<span class="text-[11px] text-blue-500">{scheduledMessages.length}</span>
			</button>
		</div>

		{#if !sendLaterCollapsed}
			<div class="pb-2">
				{#each scheduledMessages as msg (msg.rowid)}
					{@const replyTo = msg.thread_originator_guid ? messageMap.get(msg.thread_originator_guid) : undefined}
					<div class="px-2 pb-1 pt-1 text-center text-[11px] font-medium text-blue-700">
						{formatScheduledTime(msg.date)}
					</div>

					{#if editingMessage && editingMessage.guid === msg.guid}
						<div class="flex justify-end group">
							<div class="min-w-0 max-w-[75%]">
								<div class="rounded-2xl border border-blue-200 bg-blue-50 p-2">
									<textarea
										bind:this={inlineEditTextarea}
										bind:value={editDraft}
										oninput={handleInlineEditInput}
										onkeydown={(e) => handleInlineEditKeydown(e, msg)}
										rows="1"
										class="w-full resize-none rounded-xl bg-white px-3 py-2 text-sm text-gray-900 outline-none ring-1 ring-blue-100 focus:ring-2 focus:ring-blue-300"
									></textarea>
									<div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
										<label class="flex flex-col gap-1 text-[11px] font-medium text-blue-700">
											Send date
											<input
												type="date"
												bind:value={editScheduleDate}
												class="rounded-lg border border-blue-100 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:ring-2 focus:ring-blue-300"
											/>
										</label>
										<label class="flex flex-col gap-1 text-[11px] font-medium text-blue-700">
											Send time
											<input
												type="time"
												bind:value={editScheduleTime}
												step="60"
												class="rounded-lg border border-blue-100 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:ring-2 focus:ring-blue-300"
											/>
										</label>
									</div>
									<div class="mt-2 flex items-center justify-end gap-2">
										<button
											onclick={cancelInlineEdit}
											class="rounded-lg px-3 py-1.5 text-xs text-gray-600 hover:bg-white"
										>
											Cancel
										</button>
										<button
											onclick={() => saveInlineEdit(msg)}
											disabled={editSaving || !canSaveInlineEdit(msg)}
											class="rounded-lg bg-blue-500 px-3 py-1.5 text-xs text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-blue-300"
										>
											{editSaving ? 'Saving...' : 'Save'}
										</button>
									</div>
								</div>
							</div>
						</div>
					{:else}
						<MessageBubble
							message={msg}
							{isGroup}
							{replyTo}
							showSender={false}
							statusText={undefined}
							onContextMenu={handleContextMenu}
						/>
					{/if}
				{/each}
			</div>
		{/if}
	{/if}
</div>

{#if contextMenu}
	<MessageContextMenu
		message={contextMenu.message}
		x={contextMenu.x}
		y={contextMenu.y}
		onReact={(msg, type) => {
			onReact?.(msg, type);
			contextMenu = null;
		}}
		onReply={(msg) => {
			onReply?.(msg);
			contextMenu = null;
		}}
		onEdit={(msg) => {
			onEdit?.(msg);
			contextMenu = null;
		}}
		onUnsend={(msg) => {
			onUnsend?.(msg);
			contextMenu = null;
		}}
		onClose={() => {
			contextMenu = null;
		}}
	/>
{/if}

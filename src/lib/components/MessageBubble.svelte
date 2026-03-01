<script lang="ts">
	import type { DbMessage, DbAttachment } from '$lib/db/types.js';
	import ReactionBadge from './ReactionBadge.svelte';
	import ReactionPicker from './ReactionPicker.svelte';

	interface Props {
		message: DbMessage;
		attachments: DbAttachment[];
		senderName: string;
		showSender: boolean;
		reactions: DbMessage[];
		onReact: (messageGuid: string, reaction: string) => void;
		onReply: (message: DbMessage) => void;
		onEdit: (messageGuid: string, newText: string) => Promise<void>;
		onUnsend: (messageGuid: string) => Promise<void>;
		replyToText: string | null;
		onSaveScheduleEdit?: (guid: string, message?: string, scheduledAt?: number) => Promise<void>;
		onCancelSchedule?: (guid: string) => void;
	}

	let { message, attachments, senderName, showSender, reactions, onReact, onReply, onEdit, onUnsend, replyToText, onSaveScheduleEdit, onCancelSchedule }: Props = $props();

	const isSent = $derived(message.isFromMe);
	const isRetracted = $derived(
		message.dateRetracted !== null ||
			(message.text === null && message.dateEdited !== null)
	);
	const isEdited = $derived(message.dateEdited !== null && !isRetracted);
	const isScheduled = $derived(message.dateCreated > Date.now());

	let contextMenuVisible = $state(false);
	let contextMenuX = $state(0);
	let contextMenuY = $state(0);
	let editing = $state(false);
	let editText = $state('');
	let editingSchedule = $state(false);
	let schedEditText = $state('');
	let schedEditDate = $state('');
	let schedEditTime = $state('');

	// Close context menu on scroll
	$effect(() => {
		if (!contextMenuVisible) return;
		const onScroll = () => {
			contextMenuVisible = false;
		};
		window.addEventListener('scroll', onScroll, true);
		return () => window.removeEventListener('scroll', onScroll, true);
	});

	const reactionTypeToEmoji: Record<number, string> = {
		2000: '❤️',
		2001: '👍',
		2002: '👎',
		2003: '😂',
		2004: '‼️',
		2005: '❓'
	};

	const aggregatedReactions = $derived.by(() => {
		// Track active reactions per emoji
		const active = new Map<string, { count: number; fromMe: boolean }>();

		for (const r of reactions) {
			const type = r.associatedMessageType;

			// Standard iMessage reactions use the type-to-emoji map
			// (associatedMessageEmoji contains the word "love"/"like"/etc, not actual emoji)
			let emoji: string | null = null;
			if (type >= 2000 && type <= 2005) {
				emoji = reactionTypeToEmoji[type] ?? null;
			} else if (type >= 3000 && type <= 3005) {
				const addType = type - 1000;
				emoji = reactionTypeToEmoji[addType] ?? null;
			}

			if (!emoji) continue;

			const existing = active.get(emoji) ?? { count: 0, fromMe: false };

			if (type >= 2000 && type <= 2005) {
				existing.count += 1;
				if (r.isFromMe) existing.fromMe = true;
			} else if (type >= 3000 && type <= 3005) {
				existing.count -= 1;
				// If the user removed their own reaction, clear fromMe
				if (r.isFromMe) existing.fromMe = false;
			}

			active.set(emoji, existing);
		}

		// Filter out reactions with count <= 0
		const result: { emoji: string; count: number; fromMe: boolean }[] = [];
		for (const [emoji, data] of active) {
			if (data.count > 0) {
				result.push({ emoji, count: data.count, fromMe: data.fromMe });
			}
		}
		return result;
	});

	const deliveryStatus = $derived.by(() => {
		if (!isSent || isRetracted) return null;
		if (message.error !== 0) return 'Not delivered';
		if (message.dateRead) return 'Read';
		if (message.dateDelivered || message.isDelivered) return 'Delivered';
		return 'Sent';
	});

	const messageTime = $derived(
		new Date(message.dateCreated).toLocaleTimeString(undefined, {
			hour: 'numeric',
			minute: '2-digit'
		})
	);

	const scheduledTime = $derived(
		isScheduled
			? new Date(message.dateCreated).toLocaleString(undefined, {
					month: 'short',
					day: 'numeric',
					hour: 'numeric',
					minute: '2-digit'
				})
			: null
	);

	// Filter out iMessage rich link preview metadata (not user-shared files)
	const displayAttachments = $derived(
		attachments.filter((a) => !a.transferName?.endsWith('.pluginPayloadAttachment'))
	);

	// Strip the U+FFFC object replacement character iMessage uses for inline attachments
	const displayText = $derived(message.text?.replace(/\uFFFC/g, '').trim() || null);

	function isImage(mimeType: string | null): boolean {
		return mimeType?.startsWith('image/') ?? false;
	}

	function isVideo(mimeType: string | null): boolean {
		return mimeType?.startsWith('video/') ?? false;
	}

	function attachmentUrl(guid: string): string {
		return `/api/proxy/attachment/${encodeURIComponent(guid)}/download`;
	}

	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
	}

	function handleContextMenu(event: MouseEvent) {
		event.preventDefault();
		if (editing) return;

		let x = event.clientX;
		let y = event.clientY;

		// Adjust if menu would go off-screen
		const menuWidth = 220;
		const menuHeight = 280;
		if (x + menuWidth > window.innerWidth) {
			x = window.innerWidth - menuWidth - 8;
		}
		if (y + menuHeight > window.innerHeight) {
			y = window.innerHeight - menuHeight - 8;
		}

		contextMenuX = x;
		contextMenuY = y;
		contextMenuVisible = true;
	}

	function closeContextMenu() {
		contextMenuVisible = false;
	}

	function handleReact(reaction: string) {
		closeContextMenu();
		onReact(message.guid, reaction);
	}

	function handleReply() {
		closeContextMenu();
		onReply(message);
	}

	function handleCopy() {
		closeContextMenu();
		if (displayText) {
			navigator.clipboard.writeText(displayText);
		}
	}

	function startEdit() {
		editText = message.text ?? '';
		editing = true;
		closeContextMenu();
	}

	async function saveEdit() {
		await onEdit(message.guid, editText);
		editing = false;
	}

	function cancelEdit() {
		editing = false;
	}

	function handleEditKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			saveEdit();
		} else if (e.key === 'Escape') {
			cancelEdit();
		}
	}

	function startScheduleEdit() {
		schedEditText = message.text ?? '';
		const d = new Date(message.dateCreated);
		schedEditDate = d.toISOString().slice(0, 10);
		schedEditTime = d.toTimeString().slice(0, 5);
		editingSchedule = true;
		closeContextMenu();
	}

	async function saveScheduleEdit() {
		if (!onSaveScheduleEdit) return;
		const newText = schedEditText.trim();
		const newMs = new Date(`${schedEditDate}T${schedEditTime}`).getTime();
		const textChanged = newText && newText !== (message.text ?? '');
		const timeChanged = !isNaN(newMs) && newMs !== message.dateCreated;
		await onSaveScheduleEdit(
			message.guid,
			textChanged ? newText : undefined,
			timeChanged ? newMs : undefined
		);
		editingSchedule = false;
	}

	function cancelScheduleEdit() {
		editingSchedule = false;
	}

	function handleScheduleEditKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			saveScheduleEdit();
		} else if (e.key === 'Escape') {
			cancelScheduleEdit();
		}
	}

	function handleUnsend() {
		closeContextMenu();
		onUnsend(message.guid);
	}

	const truncatedReplyText = $derived(
		replyToText ? (replyToText.length > 50 ? replyToText.slice(0, 50) + '...' : replyToText) : null
	);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="group relative flex {isSent ? 'justify-end' : 'justify-start'} mb-1"
	oncontextmenu={handleContextMenu}
>
	<div class="flex max-w-[75%] flex-col {isSent ? 'items-end' : 'items-start'}">
		{#if showSender && !isSent}
			<span class="mb-0.5 px-3 text-xs font-medium text-gray-500 dark:text-gray-400">
				{senderName}
			</span>
		{/if}

		<!-- Reply-to preview -->
		{#if message.threadOriginatorGuid && truncatedReplyText}
			<div class="mb-1 flex items-start gap-1.5 px-1">
				<div class="w-0.5 shrink-0 self-stretch rounded-full {isSent ? 'bg-blue-300' : 'bg-gray-400 dark:bg-gray-500'}"></div>
				<p class="truncate text-xs italic {isSent ? 'text-blue-200' : 'text-gray-500 dark:text-gray-400'}">
					{truncatedReplyText}
				</p>
			</div>
		{/if}

		{#if isRetracted}
			<span class="text-xs italic text-gray-400">You unsent a message {messageTime}</span>
		{:else}
		<div
			class="rounded-2xl px-3 py-2 {isScheduled
				? 'border-2 border-dashed border-blue-400 bg-transparent'
				: isSent
					? 'bg-blue-500 text-white'
					: 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-white'}"
		>
			{#if isScheduled}
				<div class="mb-1 flex items-center gap-1 text-xs text-blue-500 dark:text-blue-400">
					<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					Scheduled{scheduledTime ? ` for ${scheduledTime}` : ''}
				</div>
			{/if}

			{#if editingSchedule}
				<div class="flex flex-col gap-1.5">
					<textarea
						bind:value={schedEditText}
						onkeydown={handleScheduleEditKeydown}
						class="w-full resize-none rounded-lg bg-blue-100 px-2 py-1 text-sm text-blue-800 outline-none dark:bg-blue-900/30 dark:text-blue-200"
						rows="2"
						placeholder="Message text"
					></textarea>
					<div class="flex gap-1.5">
						<input
							type="date"
							bind:value={schedEditDate}
							class="flex-1 rounded-lg bg-blue-100 px-2 py-1 text-xs text-blue-800 outline-none dark:bg-blue-900/30 dark:text-blue-200"
						/>
						<input
							type="time"
							bind:value={schedEditTime}
							class="rounded-lg bg-blue-100 px-2 py-1 text-xs text-blue-800 outline-none dark:bg-blue-900/30 dark:text-blue-200"
						/>
					</div>
					<div class="flex justify-end gap-1">
						<button
							onclick={cancelScheduleEdit}
							class="rounded px-2 py-0.5 text-xs text-blue-600 opacity-70 transition-opacity hover:opacity-100 dark:text-blue-400"
						>
							Cancel
						</button>
						<button
							onclick={saveScheduleEdit}
							class="rounded bg-blue-500 px-2 py-0.5 text-xs font-medium text-white transition-colors hover:bg-blue-600"
						>
							Save
						</button>
					</div>
				</div>
			{:else if editing}
				<div class="flex flex-col gap-1.5">
					<textarea
						bind:value={editText}
						onkeydown={handleEditKeydown}
						class="w-full resize-none rounded-lg bg-white/20 px-2 py-1 text-sm text-inherit outline-none placeholder:text-white/50"
						rows="2"
					></textarea>
					<div class="flex justify-end gap-1">
						<button
							onclick={cancelEdit}
							class="rounded px-2 py-0.5 text-xs opacity-70 transition-opacity hover:opacity-100"
						>
							Cancel
						</button>
						<button
							onclick={saveEdit}
							class="rounded bg-white/20 px-2 py-0.5 text-xs font-medium transition-colors hover:bg-white/30"
						>
							Save
						</button>
					</div>
				</div>
			{:else}
				{#if displayAttachments.length > 0}
					<div class="flex flex-col gap-1.5">
						{#each displayAttachments as att (att.guid)}
							{#if isImage(att.mimeType)}
								<a
									href={attachmentUrl(att.guid)}
									target="_blank"
									rel="noopener noreferrer"
								>
									<img
										src={attachmentUrl(att.guid)}
										alt={att.transferName ?? 'Image'}
										class="max-h-64 max-w-full rounded-lg object-contain"
										loading="lazy"
									/>
								</a>
							{:else if isVideo(att.mimeType)}
								<!-- svelte-ignore a11y_media_has_caption -->
								<video
									controls
									preload="metadata"
									class="max-h-64 max-w-full rounded-lg"
								>
									<source src={attachmentUrl(att.guid)} type={att.mimeType ?? undefined} />
								</video>
							{:else}
								<a
									href={attachmentUrl(att.guid)}
									download={att.transferName}
									class="flex items-center gap-2 rounded-lg p-2 {isSent
										? 'bg-blue-600/30 hover:bg-blue-600/40'
										: 'bg-gray-300/50 hover:bg-gray-300/70 dark:bg-gray-600/50 dark:hover:bg-gray-600/70'} transition-colors"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="h-5 w-5 shrink-0"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
										stroke-width="2"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
										/>
									</svg>
									<div class="min-w-0 flex-1">
										<p class="truncate text-sm font-medium">
											{att.transferName ?? 'File'}
										</p>
										{#if att.totalBytes > 0}
											<p class="text-xs opacity-70">{formatBytes(att.totalBytes)}</p>
										{/if}
									</div>
								</a>
							{/if}
						{/each}
					</div>
				{/if}

				{#if displayText}
					<p class="whitespace-pre-wrap break-words text-sm {isScheduled ? 'text-blue-600 dark:text-blue-400' : ''}">{displayText}</p>
				{/if}

				{#if isEdited}
					<span class="mt-0.5 text-[10px] italic opacity-60">Edited</span>
				{/if}
			{/if}
		</div>

		<!-- Reaction badges -->
		<ReactionBadge reactions={aggregatedReactions} />

		<div class="mt-0.5 flex items-center gap-1.5 px-1">
			<span class="text-[10px] text-gray-400">{messageTime}</span>
			{#if deliveryStatus}
				<span
					class="text-[10px] {deliveryStatus === 'Not delivered'
						? 'text-red-500'
						: 'text-gray-400'}"
				>
					{deliveryStatus}
				</span>
			{/if}
		</div>
		{/if}
	</div>
</div>

<!-- Context menu (fixed positioning, escapes overflow containers) -->
{#if contextMenuVisible}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50"
		onclick={closeContextMenu}
		oncontextmenu={(e) => {
			e.preventDefault();
			closeContextMenu();
		}}
	></div>
	<div
		class="fixed z-[51] flex flex-col gap-1"
		style="left: {contextMenuX}px; top: {contextMenuY}px;"
	>
		{#if !isScheduled}
		<ReactionPicker onReact={handleReact} />
		{/if}

		<div class="min-w-[160px] overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-black/10 dark:bg-gray-800 dark:ring-white/10">
			{#if !isScheduled}
			<button
				onclick={handleReply}
				class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a5 5 0 015 5v4M3 10l6-6M3 10l6 6" />
				</svg>
				Reply
			</button>
			{/if}
			{#if displayText}
				<button
					onclick={handleCopy}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
					</svg>
					Copy
				</button>
			{/if}
			{#if isScheduled && (onSaveScheduleEdit || onCancelSchedule)}
				<hr class="border-gray-200 dark:border-gray-700" />
				{#if onSaveScheduleEdit}
				<button
					onclick={startScheduleEdit}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
					</svg>
					Edit
				</button>
				{/if}
				{#if onCancelSchedule}
				<button
					onclick={() => { closeContextMenu(); onCancelSchedule!(message.guid); }}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
					Cancel Schedule
				</button>
				{/if}
			{:else if isSent && !isRetracted}
				<hr class="border-gray-200 dark:border-gray-700" />
				{#if displayText}
				<button
					onclick={startEdit}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
					</svg>
					Edit
				</button>
				{/if}
				<button
					onclick={handleUnsend}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
					</svg>
					Unsend
				</button>
			{/if}
		</div>
	</div>
{/if}

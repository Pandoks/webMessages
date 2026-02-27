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
		replyToText: string | null;
	}

	let { message, attachments, senderName, showSender, reactions, onReact, onReply, replyToText }: Props = $props();

	const isSent = $derived(message.isFromMe);
	const isRetracted = $derived(message.dateRetracted !== null);
	const isEdited = $derived(message.dateEdited !== null);

	let showPicker = $state(false);
	let hoverTimeout: ReturnType<typeof setTimeout> | undefined = $state();

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

			// Use emoji reactions if available, otherwise map from type
			let emoji: string | null = null;
			if (type >= 2000 && type <= 2005) {
				emoji = r.associatedMessageEmoji ?? reactionTypeToEmoji[type] ?? null;
			} else if (type >= 3000 && type <= 3005) {
				// Removal — find the corresponding emoji
				const addType = type - 1000;
				emoji = r.associatedMessageEmoji ?? reactionTypeToEmoji[addType] ?? null;
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
		if (!isSent) return null;
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

	function handleMouseEnter() {
		hoverTimeout = setTimeout(() => {
			showPicker = true;
		}, 500);
	}

	function handleMouseLeave() {
		if (hoverTimeout) {
			clearTimeout(hoverTimeout);
			hoverTimeout = undefined;
		}
		showPicker = false;
	}

	function handleReact(reaction: string) {
		showPicker = false;
		onReact(message.guid, reaction);
	}

	function handleReply() {
		onReply(message);
	}

	const truncatedReplyText = $derived(
		replyToText ? (replyToText.length > 50 ? replyToText.slice(0, 50) + '...' : replyToText) : null
	);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="group relative flex {isSent ? 'justify-end' : 'justify-start'} mb-1"
	onmouseenter={handleMouseEnter}
	onmouseleave={handleMouseLeave}
>
	<div class="flex max-w-[75%] flex-col {isSent ? 'items-end' : 'items-start'}">
		{#if showSender && !isSent}
			<span class="mb-0.5 px-3 text-xs font-medium text-gray-500 dark:text-gray-400">
				{senderName}
			</span>
		{/if}

		<!-- Reaction picker and reply action (appears above the bubble on hover) -->
		{#if showPicker}
			<div class="absolute {isSent ? 'right-0' : 'left-0'} bottom-full z-10 mb-1 flex items-center gap-1">
				<ReactionPicker onReact={handleReact} />
				<button
					onclick={handleReply}
					class="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-md transition-colors hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600"
					aria-label="Reply to message"
					title="Reply"
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a5 5 0 015 5v4M3 10l6-6M3 10l6 6" />
					</svg>
				</button>
			</div>
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

		<div
			class="rounded-2xl px-3 py-2 {isSent
				? 'bg-blue-500 text-white'
				: 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-white'}"
		>
			{#if isRetracted}
				<p class="text-sm italic opacity-60">Message unsent</p>
			{:else}
				{#if attachments.length > 0}
					<div class="flex flex-col gap-1.5">
						{#each attachments as att (att.guid)}
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

				{#if message.text}
					<p class="whitespace-pre-wrap break-words text-sm">{message.text}</p>
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
	</div>
</div>

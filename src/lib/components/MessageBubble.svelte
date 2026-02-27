<script lang="ts">
	import type { DbMessage, DbAttachment } from '$lib/db/types.js';

	interface Props {
		message: DbMessage;
		attachments: DbAttachment[];
		senderName: string;
		showSender: boolean;
	}

	let { message, attachments, senderName, showSender }: Props = $props();

	const isSent = $derived(message.isFromMe);
	const isRetracted = $derived(message.dateRetracted !== null);
	const isEdited = $derived(message.dateEdited !== null);

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
</script>

<div class="flex {isSent ? 'justify-end' : 'justify-start'} mb-1">
	<div class="flex max-w-[75%] flex-col {isSent ? 'items-end' : 'items-start'}">
		{#if showSender && !isSent}
			<span class="mb-0.5 px-3 text-xs font-medium text-gray-500 dark:text-gray-400">
				{senderName}
			</span>
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

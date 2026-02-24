<script lang="ts">
	import type { Message } from '$lib/types/index.js';
	import ReactionBadge from './ReactionBadge.svelte';
	import ReplyPreview from './ReplyPreview.svelte';
	import AttachmentPreview from './AttachmentPreview.svelte';
	import { formatMessageTime } from '$lib/utils/date.js';

	let {
		message,
		isGroup = false,
		replyTo,
		showSender = false,
		statusText,
		onContextMenu
	}: {
		message: Message;
		isGroup?: boolean;
		replyTo?: Message;
		showSender?: boolean;
		statusText?: string;
		onContextMenu?: (e: MouseEvent, message: Message) => void;
	} = $props();

	const isSent = $derived(message.is_from_me);
	const isRetracted = $derived(message.date_retracted && message.date_retracted > 0);
	const isEdited = $derived(message.date_edited && message.date_edited > 0);
	const isGroupAction = $derived(message.group_title !== null && message.group_action_type > 0);

	const timeStr = $derived(formatMessageTime(message.date));

	const displayText = $derived.by(() => {
		if (isRetracted) return 'This message was unsent';
		if (isGroupAction) {
			return `${message.sender ?? 'Someone'} named the conversation "${message.group_title}"`;
		}
		return message.body ?? '';
	});
</script>

{#if isGroupAction}
	<div class="py-1 text-center text-xs text-gray-400 italic">
		{displayText}
	</div>
{:else}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="flex {isSent ? 'justify-end' : 'justify-start'} group"
		oncontextmenu={(e) => { if (onContextMenu) { e.preventDefault(); onContextMenu(e, message); } }}
	>
		<div class="min-w-0 max-w-[75%]">
			{#if showSender && !isSent && isGroup}
				<p class="mb-0.5 px-3 text-xs font-medium text-gray-500">
					{message.sender ?? 'Unknown'}
				</p>
			{/if}

			{#if replyTo}
				<div class="{isSent ? 'ml-auto' : ''} max-w-full px-1">
					<ReplyPreview originalMessage={replyTo} />
				</div>
			{/if}

			<div class="relative">
				<div
					class="inline-block rounded-2xl px-3 py-2 text-[15px] leading-relaxed break-words
						{isSent
							? 'bg-blue-500 text-white'
							: 'bg-[#e9e9eb] text-gray-900'}
						{isRetracted ? 'italic opacity-60' : ''}"
				>
					{#if message.attachments && message.attachments.length > 0}
						<div class="flex flex-col gap-1.5 {displayText ? 'mb-1' : ''}">
							{#each message.attachments as attachment (attachment.rowid)}
								<AttachmentPreview {attachment} />
							{/each}
						</div>
					{/if}

					{#if displayText}
						<span class="whitespace-pre-wrap [overflow-wrap:anywhere]">{displayText}</span>
					{/if}

					{#if isEdited}
						<span class="ml-1 text-[10px] {isSent ? 'text-blue-200' : 'text-gray-400'}">Edited</span>
					{/if}
				</div>

				<!-- Time tooltip on hover -->
				<span
					class="pointer-events-none absolute top-1/2 -translate-y-1/2 text-[10px] text-gray-400 opacity-0 transition-opacity group-hover:opacity-100
						{isSent ? 'right-full mr-2' : 'left-full ml-2'}"
				>
					{timeStr}
				</span>
			</div>

			{#if message.reactions && message.reactions.length > 0}
				<div class="{isSent ? 'flex justify-end' : ''}">
					<ReactionBadge reactions={message.reactions} />
				</div>
			{/if}

			{#if statusText}
				<p class="mt-0.5 text-right text-[10px] text-gray-400">{statusText}</p>
			{/if}
		</div>
	</div>
{/if}

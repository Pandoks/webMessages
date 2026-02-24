<script lang="ts">
	import type { Attachment, Message } from '$lib/types/index.js';

	let {
		message,
		x,
		y,
		onReact,
		onReply,
		onEdit,
		onUnsend,
		onClose
	}: {
		message: Message;
		x: number;
		y: number;
		onReact: (message: Message, reactionType: number) => void;
		onReply: (message: Message) => void;
		onEdit?: (message: Message) => void;
		onUnsend?: (message: Message) => void;
		onClose: () => void;
	} = $props();

	let showReactions = $state(false);

	// Tapback types: 2000=love, 2001=like, 2002=dislike, 2003=laugh, 2004=emphasize, 2005=question
	const tapbacks = [
		{ emoji: '\u2764\uFE0F', type: 2000 },
		{ emoji: '\uD83D\uDC4D', type: 2001 },
		{ emoji: '\uD83D\uDC4E', type: 2002 },
		{ emoji: '\uD83D\uDE02', type: 2003 },
		{ emoji: '\u203C\uFE0F', type: 2004 },
		{ emoji: '\u2753', type: 2005 }
	];

	// Clamp position to viewport
	const menuWidth = 200;
	const menuHeight = 220;
	const clampedX = $derived(Math.min(x, window.innerWidth - menuWidth - 8));
	const clampedY = $derived(Math.min(y, window.innerHeight - menuHeight - 8));
	const imageUtis = new Set(['public.heic', 'public.heif', 'public.jpeg', 'public.png', 'public.gif', 'public.webp']);

	const hasImageAttachment = $derived(
		(message.attachments ?? []).some((attachment) => isImageAttachment(attachment))
	);
	const copyLabel = $derived(hasImageAttachment ? 'Copy Image' : 'Copy Text');
	const undoSendWindowMs = 2 * 60 * 1000;
	const canUnsend = $derived(
		message.is_from_me &&
			!message.date_retracted &&
			message.service === 'iMessage' &&
			Date.now() - message.date <= undoSendWindowMs
	);

	function handleReact(type: number) {
		onReact(message, type);
	}

	function handleReply() {
		onReply(message);
	}

	function handleEdit() {
		onEdit?.(message);
	}

	function handleUnsend() {
		onUnsend?.(message);
	}

	function isImageAttachment(attachment: Attachment): boolean {
		return (
			attachment.mime_type?.startsWith('image/') === true ||
			(attachment.uti ? imageUtis.has(attachment.uti) : false)
		);
	}

	async function copyImageAttachment(attachment: Attachment): Promise<boolean> {
		if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
			return false;
		}

		async function convertImageToPng(blob: Blob): Promise<Blob | null> {
			try {
				if (typeof createImageBitmap === 'function') {
					const bitmap = await createImageBitmap(blob);
					const canvas = document.createElement('canvas');
					canvas.width = bitmap.width;
					canvas.height = bitmap.height;
					const ctx = canvas.getContext('2d');
					if (!ctx) {
						bitmap.close();
						return null;
					}
					ctx.drawImage(bitmap, 0, 0);
					bitmap.close();
					return await new Promise<Blob | null>((resolve) =>
						canvas.toBlob((pngBlob) => resolve(pngBlob), 'image/png')
					);
				}

				const url = URL.createObjectURL(blob);
				try {
					const img = await new Promise<HTMLImageElement>((resolve, reject) => {
						const image = new Image();
						image.onload = () => resolve(image);
						image.onerror = () => reject(new Error('Failed to decode image'));
						image.src = url;
					});

					const canvas = document.createElement('canvas');
					canvas.width = img.naturalWidth || img.width;
					canvas.height = img.naturalHeight || img.height;
					const ctx = canvas.getContext('2d');
					if (!ctx) return null;
					ctx.drawImage(img, 0, 0);
					return await new Promise<Blob | null>((resolve) =>
						canvas.toBlob((pngBlob) => resolve(pngBlob), 'image/png')
					);
				} finally {
					URL.revokeObjectURL(url);
				}
			} catch {
				return null;
			}
		}

		try {
			const res = await fetch(`/api/attachments/${attachment.rowid}`);
			if (!res.ok) return false;

			const blob = await res.blob();
			if (!blob.type.startsWith('image/')) return false;

			try {
				await navigator.clipboard.write([
					new ClipboardItem({
						[blob.type]: blob
					})
				]);
			} catch {
				// Some browsers reject certain image MIME types in clipboard.
				// Retry by converting to PNG.
				const pngBlob = await convertImageToPng(blob);
				if (!pngBlob) return false;
				await navigator.clipboard.write([
					new ClipboardItem({
						'image/png': pngBlob
					})
				]);
			}
			return true;
		} catch (err) {
			console.error('Image copy failed:', err);
			return false;
		}
	}

	async function handleCopy() {
		const imageAttachment = (message.attachments ?? []).find((attachment) =>
			isImageAttachment(attachment)
		);

		if (imageAttachment) {
			const copied = await copyImageAttachment(imageAttachment);
			if (copied) {
				onClose();
				return;
			}
		}

		try {
			await navigator.clipboard.writeText(message.body ?? message.text ?? '');
		} catch (err) {
			console.error('Text copy failed:', err);
		}
		onClose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

	function handleBackdropKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onClose();
		}
	}

	function handleMenuKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Backdrop -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-50"
	onclick={onClose}
	oncontextmenu={(e) => { e.preventDefault(); onClose(); }}
	tabindex="-1"
	onkeydown={handleBackdropKeydown}
>
	<!-- Menu -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="absolute z-50 min-w-[180px] rounded-xl bg-white py-1 shadow-lg ring-1 ring-black/5"
		style="left: {clampedX}px; top: {clampedY}px"
		onclick={(e) => e.stopPropagation()}
		tabindex="-1"
		onkeydown={handleMenuKeydown}
	>
		{#if showReactions}
			<div class="flex gap-1 px-3 py-2">
				{#each tapbacks as tapback}
					<button
						onclick={() => handleReact(tapback.type)}
						class="flex h-9 w-9 items-center justify-center rounded-full text-lg transition-transform hover:scale-125 hover:bg-gray-100"
					>
						{tapback.emoji}
					</button>
				{/each}
			</div>
		{:else}
			<button
				onclick={() => { showReactions = true; }}
				class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
			>
				<span class="w-5 text-center text-base">+</span>
				React
			</button>
			<button
				onclick={handleReply}
				class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
			>
				<svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
				</svg>
				Reply
			</button>
			{#if message.is_from_me && !message.date_retracted && (message.body ?? '').trim().length > 0 && (!message.attachments || message.attachments.length === 0)}
				<button
					onclick={handleEdit}
					class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
				>
					<svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16.862 4.487a2.1 2.1 0 113 2.97L9 18.319 5 19l.682-4 11.18-10.513z" />
					</svg>
					Edit
				</button>
			{/if}
			{#if message.is_from_me && !message.date_retracted}
				<button
					onclick={handleUnsend}
					disabled={!canUnsend}
					class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
					class:opacity-50={!canUnsend}
					class:cursor-not-allowed={!canUnsend}
				>
					<svg class="h-5 w-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 7h12M9 7V5h6v2m-7 3v7m4-7v7m4-7v7M5 7h14l-1 12H6L5 7z" />
					</svg>
					{canUnsend ? 'Undo Send' : 'Undo Send (expired)'}
				</button>
			{/if}
			<button
				onclick={handleCopy}
				class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
			>
				<svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
				</svg>
				{copyLabel}
			</button>
		{/if}
	</div>
</div>

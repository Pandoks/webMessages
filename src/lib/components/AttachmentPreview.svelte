<script lang="ts">
	import type { Attachment } from '$lib/types/index.js';

	let { attachment }: { attachment: Attachment } = $props();

	const isImage = $derived(
		attachment.mime_type?.startsWith('image/') ||
			attachment.uti === 'public.heic' ||
			attachment.uti === 'public.jpeg' ||
			attachment.uti === 'public.png'
	);

	const isVideo = $derived(
		attachment.mime_type?.startsWith('video/') || attachment.uti === 'com.apple.quicktime-movie'
	);

	const thumbnailUrl = $derived(`/api/attachments/${attachment.rowid}/thumbnail`);
	const fullUrl = $derived(`/api/attachments/${attachment.rowid}`);
	const displayName = $derived(attachment.transfer_name ?? 'Attachment');
</script>

{#if isImage}
	<a href={fullUrl} target="_blank" rel="noopener" class="block">
		<img
			src={thumbnailUrl}
			alt={displayName}
			class="max-h-64 max-w-xs rounded-lg object-cover"
			loading="lazy"
		/>
	</a>
{:else if isVideo}
	<video
		controls
		preload="metadata"
		class="max-h-64 max-w-xs rounded-lg"
	>
		<source src={fullUrl} type={attachment.mime_type ?? 'video/mp4'} />
		<track kind="captions" />
	</video>
{:else if !attachment.hide_attachment}
	<a
		href={fullUrl}
		target="_blank"
		rel="noopener"
		class="flex items-center gap-2 rounded-lg bg-gray-100 p-2 text-sm text-blue-600 hover:bg-gray-200"
	>
		<svg class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
		</svg>
		<span class="truncate">{displayName}</span>
	</a>
{/if}

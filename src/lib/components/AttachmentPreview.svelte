<script lang="ts">
  import type { Attachment } from '$lib/types/index.js';

  let { attachment }: { attachment: Attachment } = $props();
  const filename = $derived((attachment.transfer_name ?? attachment.filename ?? '').toLowerCase());

  const isImage = $derived(
    attachment.mime_type?.startsWith('image/') ||
      attachment.uti === 'public.heic' ||
      attachment.uti === 'public.jpeg' ||
      attachment.uti === 'public.png'
  );

  const isVideo = $derived(
    attachment.mime_type?.startsWith('video/') ||
      attachment.uti === 'com.apple.quicktime-movie' ||
      filename.endsWith('.mov') ||
      filename.endsWith('.mp4') ||
      filename.endsWith('.m4v') ||
      filename.endsWith('.webm')
  );

  const thumbnailUrl = $derived(`/api/attachments/${attachment.rowid}/thumbnail`);
  const fullUrl = $derived(`/api/attachments/${attachment.rowid}?v=2`);
  const downloadUrl = $derived(`/api/attachments/${attachment.rowid}?download=1&v=2`);
  const displayName = $derived(attachment.transfer_name ?? 'Attachment');
</script>

{#if isImage}
  <div class="inline-flex flex-col gap-1">
    <a href={fullUrl} target="_blank" rel="noopener" class="block">
      <img
        src={thumbnailUrl}
        alt={displayName}
        class="max-h-64 max-w-xs rounded-lg object-cover"
        loading="lazy"
      />
    </a>
    <a href={downloadUrl} download={displayName} class="text-xs text-blue-600 hover:underline">
      Download image
    </a>
  </div>
{:else if isVideo}
  <div class="inline-flex flex-col gap-1">
    <video controls preload="metadata" class="max-h-64 max-w-xs rounded-lg">
      <source src={fullUrl} />
      <track kind="captions" />
    </video>
    <a href={fullUrl} target="_blank" rel="noopener" class="text-xs text-blue-600 hover:underline">
      Open video in new tab
    </a>
    <a href={downloadUrl} download={displayName} class="text-xs text-blue-600 hover:underline">
      Download video
    </a>
  </div>
{:else if !attachment.hide_attachment}
  <a
    href={downloadUrl}
    download={displayName}
    class="flex items-center gap-2 rounded-lg bg-gray-100 p-2 text-sm text-blue-600 hover:bg-gray-200"
  >
    <svg class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
    <span class="truncate">{displayName}</span>
  </a>
{/if}

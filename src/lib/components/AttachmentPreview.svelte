<script lang="ts">
	interface Props {
		files: File[];
		onRemove: (index: number) => void;
	}

	let { files, onRemove }: Props = $props();

	function getThumbnailUrl(file: File): string {
		return URL.createObjectURL(file);
	}

	function isImage(file: File): boolean {
		return file.type.startsWith('image/');
	}

	function isVideo(file: File): boolean {
		return file.type.startsWith('video/');
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
</script>

{#if files.length > 0}
	<div class="flex gap-2 overflow-x-auto px-3 pt-2 pb-1">
		{#each files as file, i}
			<div class="relative shrink-0">
				{#if isImage(file)}
					<img
						src={getThumbnailUrl(file)}
						alt={file.name}
						class="h-16 w-16 rounded-lg border border-gray-200 object-cover dark:border-gray-600"
					/>
				{:else if isVideo(file)}
					<div
						class="flex h-16 w-16 flex-col items-center justify-center rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-600 dark:bg-gray-700"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-6 w-6 text-gray-400"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="1.5"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"
							/>
						</svg>
						<span class="mt-0.5 max-w-[56px] truncate text-[9px] text-gray-500 dark:text-gray-400"
							>{file.name}</span
						>
					</div>
				{:else}
					<div
						class="flex h-16 w-16 flex-col items-center justify-center rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-600 dark:bg-gray-700"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-6 w-6 text-gray-400"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="1.5"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
							/>
						</svg>
						<span class="mt-0.5 max-w-[56px] truncate text-[9px] text-gray-500 dark:text-gray-400"
							>{file.name}</span
						>
					</div>
				{/if}

				<!-- Size badge -->
				<span
					class="absolute bottom-0.5 left-0.5 rounded bg-black/50 px-1 text-[8px] text-white"
				>
					{formatSize(file.size)}
				</span>

				<!-- Remove button -->
				<button
					onclick={() => onRemove(i)}
					class="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-600 text-white shadow transition-colors hover:bg-red-500"
					aria-label="Remove {file.name}"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-3 w-3"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2.5"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
		{/each}
	</div>
{/if}

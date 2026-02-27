<script lang="ts">
	interface Props {
		onReact: (reaction: string) => void;
	}

	let { onReact }: Props = $props();

	const tapbacks = [
		{ reaction: 'love', emoji: '❤️' },
		{ reaction: 'like', emoji: '👍' },
		{ reaction: 'dislike', emoji: '👎' },
		{ reaction: 'laugh', emoji: '😂' },
		{ reaction: 'emphasize', emoji: '‼️' },
		{ reaction: 'question', emoji: '❓' }
	];
</script>

<div
	class="flex gap-1 rounded-full bg-white px-2 py-1 shadow-lg ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-600"
>
	{#each tapbacks as tb}
		<button
			onclick={() => onReact(tb.reaction)}
			class="rounded-full p-1.5 text-lg transition-transform hover:scale-125"
		>
			{tb.emoji}
		</button>
	{/each}
</div>

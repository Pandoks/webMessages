<script lang="ts">
	import { page } from '$app/state';

	const isMessages = $derived(page.url.pathname.startsWith('/messages'));

	// Remember the last visited messages path so switching back restores the open chat
	let lastMessagesPath = $state('/messages');
	$effect(() => {
		if (isMessages) {
			lastMessagesPath = page.url.pathname;
		}
	});
</script>

<nav class="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
	<a
		href={lastMessagesPath}
		class="rounded-md px-4 py-1.5 text-sm font-medium transition-colors {isMessages
			? 'bg-white shadow-sm dark:bg-gray-700 dark:text-white'
			: 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}"
	>
		Messages
	</a>
	<a
		href="/findmy"
		class="rounded-md px-4 py-1.5 text-sm font-medium transition-colors {!isMessages
			? 'bg-white shadow-sm dark:bg-gray-700 dark:text-white'
			: 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}"
	>
		Find My
	</a>
</nav>

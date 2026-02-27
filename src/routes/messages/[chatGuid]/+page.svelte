<script lang="ts">
	import { page } from '$app/state';
	import ChatView from '$lib/components/ChatView.svelte';
	import { getContext } from 'svelte';

	const chatGuid = $derived(decodeURIComponent(page.params.chatGuid ?? ''));
	const syncEngine = getContext<any>('syncEngine');
</script>

{#key chatGuid}
	<ChatView {chatGuid} {syncEngine} />
{/key}

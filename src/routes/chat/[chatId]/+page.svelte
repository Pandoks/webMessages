<script lang="ts">
  import ChatView from '$lib/components/ChatView.svelte';
  import { page } from '$app/state';

  const chatId = $derived(parseInt(page.params.chatId ?? '0', 10));
</script>

<ChatView {chatId} />

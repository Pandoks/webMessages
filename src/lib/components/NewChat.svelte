<script lang="ts">
	import { goto } from '$app/navigation';

	let { open = $bindable(false) }: { open: boolean } = $props();

	let recipient = $state('');
	let message = $state('');
	let sending = $state(false);
	let error = $state('');

	async function handleSend() {
		if (!recipient.trim() || !message.trim()) return;
		sending = true;
		error = '';

		try {
			const res = await fetch('/api/messages', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					handle: recipient.trim(),
					text: message.trim()
				})
			});

			if (!res.ok) {
				error = 'Failed to send message';
				return;
			}

			open = false;
			recipient = '';
			message = '';
			// Refresh to show the new chat
			goto('/', { invalidateAll: true });
		} catch {
			error = 'Failed to send message';
		} finally {
			sending = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			open = false;
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_interactive_supports_focus -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
		role="dialog"
		aria-modal="true"
		aria-label="New conversation"
		onkeydown={handleKeydown}
	>
		<div class="mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
			<h2 class="mb-4 text-lg font-semibold">New Conversation</h2>

			<div class="space-y-3">
				<input
					type="text"
					placeholder="Phone number or email"
					bind:value={recipient}
					class="w-full rounded-lg bg-gray-100 px-4 py-2 text-sm outline-none placeholder:text-gray-400 focus:ring-2 focus:ring-blue-300"
				/>
				<textarea
					placeholder="Message"
					bind:value={message}
					rows="3"
					class="w-full resize-none rounded-lg bg-gray-100 px-4 py-2 text-sm outline-none placeholder:text-gray-400 focus:ring-2 focus:ring-blue-300"
				></textarea>

				{#if error}
					<p class="text-sm text-red-500">{error}</p>
				{/if}

				<div class="flex justify-end gap-2">
					<button
						onclick={() => { open = false; }}
						class="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
					>
						Cancel
					</button>
					<button
						onclick={handleSend}
						disabled={sending || !recipient.trim() || !message.trim()}
						class="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:bg-gray-300"
					>
						{sending ? 'Sending...' : 'Send'}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

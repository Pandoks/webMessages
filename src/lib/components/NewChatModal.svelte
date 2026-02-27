<script lang="ts">
	import { goto } from '$app/navigation';

	interface Props {
		open: boolean;
		onClose: () => void;
	}

	let { open, onClose }: Props = $props();

	let addressInput = $state('');
	let addresses = $state<string[]>([]);
	let groupName = $state('');
	let message = $state('');
	let creating = $state(false);
	let error = $state('');
	let dialogEl: HTMLDialogElement | undefined = $state();

	$effect(() => {
		if (!dialogEl) return;
		if (open && !dialogEl.open) {
			dialogEl.showModal();
		} else if (!open && dialogEl.open) {
			dialogEl.close();
		}
	});

	// Reset state when modal opens
	$effect(() => {
		if (open) {
			addressInput = '';
			addresses = [];
			groupName = '';
			message = '';
			error = '';
			creating = false;
		}
	});

	function addAddress() {
		const trimmed = addressInput.trim();
		if (!trimmed) return;
		if (addresses.includes(trimmed)) {
			error = 'Address already added';
			return;
		}
		addresses = [...addresses, trimmed];
		addressInput = '';
		error = '';
	}

	function removeAddress(addr: string) {
		addresses = addresses.filter((a) => a !== addr);
	}

	function handleAddressKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			addAddress();
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === dialogEl) {
			onClose();
		}
	}

	async function createChat() {
		if (addresses.length === 0) {
			error = 'Add at least one address';
			return;
		}

		creating = true;
		error = '';

		try {
			const body: Record<string, unknown> = {
				addresses,
				method: 'private-api',
				service: 'iMessage'
			};

			if (message.trim()) {
				body.message = message.trim();
			}

			const res = await fetch('/api/proxy/chat/new', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});

			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || `Request failed (${res.status})`);
			}

			const json = await res.json();
			const chatGuid = json?.data?.guid;

			if (!chatGuid) {
				throw new Error('No chat GUID returned');
			}

			onClose();
			goto(`/messages/${encodeURIComponent(chatGuid)}`);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to create chat';
		} finally {
			creating = false;
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
	bind:this={dialogEl}
	onclose={onClose}
	onclick={handleBackdropClick}
	class="m-auto w-full max-w-md rounded-2xl bg-white p-0 shadow-xl backdrop:bg-black/50 backdrop:backdrop-blur-sm dark:bg-gray-900"
>
	<div class="flex flex-col gap-4 p-5">
		<!-- Header -->
		<div class="flex items-center justify-between">
			<h2 class="text-lg font-semibold dark:text-white">New Conversation</h2>
			<button
				onclick={onClose}
				class="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
				aria-label="Close"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>

		<!-- Address input -->
		<div>
			<label for="address-input" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
				Phone number or email
			</label>
			<div class="flex gap-2">
				<input
					id="address-input"
					bind:value={addressInput}
					onkeydown={handleAddressKeydown}
					type="text"
					placeholder="+1234567890 or email@example.com"
					class="flex-1 rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
				/>
				<button
					onclick={addAddress}
					disabled={!addressInput.trim()}
					class="rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white transition-opacity hover:bg-blue-600 disabled:opacity-40"
				>
					Add
				</button>
			</div>
		</div>

		<!-- Added addresses -->
		{#if addresses.length > 0}
			<div class="flex flex-wrap gap-2">
				{#each addresses as addr}
					<span class="flex items-center gap-1 rounded-full bg-blue-100 py-1 pl-3 pr-1 text-sm text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
						{addr}
						<button
							onclick={() => removeAddress(addr)}
							class="flex h-5 w-5 items-center justify-center rounded-full transition-colors hover:bg-blue-200 dark:hover:bg-blue-800"
							aria-label="Remove {addr}"
						>
							<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</span>
				{/each}
			</div>
		{/if}

		<!-- Group name (shown for 2+ addresses) -->
		{#if addresses.length >= 2}
			<div>
				<label for="group-name" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
					Group name (optional)
				</label>
				<input
					id="group-name"
					bind:value={groupName}
					type="text"
					placeholder="Name this group..."
					class="w-full rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
				/>
			</div>
		{/if}

		<!-- First message -->
		<div>
			<label for="first-message" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
				Message (optional)
			</label>
			<textarea
				id="first-message"
				bind:value={message}
				placeholder="Say something..."
				rows="2"
				class="w-full resize-none rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
			></textarea>
		</div>

		<!-- Error -->
		{#if error}
			<p class="text-sm text-red-500">{error}</p>
		{/if}

		<!-- Create button -->
		<button
			onclick={createChat}
			disabled={addresses.length === 0 || creating}
			class="rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:bg-blue-600 disabled:opacity-40"
		>
			{creating ? 'Creating...' : 'Create'}
		</button>
	</div>
</dialog>

<script lang="ts">
	let {
		name,
		identifier,
		size = 40
	}: { name: string; identifier?: string; size?: number } = $props();

	let photoFailed = $state(false);
	let photoLoaded = $state(false);

	function isLikelyContactIdentifier(value: string): boolean {
		const v = value.trim();
		if (!v) return false;
		// Email
		if (v.includes('@')) return true;
		// Phone-like (reject plain short numeric IDs like DB rowids)
		if (/^\+?\d[\d\s().-]{6,}$/.test(v)) return true;
		return false;
	}

	const photoUrl = $derived(
		identifier && isLikelyContactIdentifier(identifier)
			? `/api/contacts/photo/${encodeURIComponent(identifier)}`
			: null
	);

	// Reset photo state when identifier changes
	$effect(() => {
		if (identifier) {
			photoFailed = false;
			photoLoaded = false;
		}
	});

	const initials = $derived.by(() => {
		const parts = name.trim().split(/\s+/);
		// Filter out emoji-only parts to get actual name parts
		const textParts = parts.filter((p) => /\p{L}/u.test(p));
		const useParts = textParts.length > 0 ? textParts : parts;
		if (useParts.length >= 2) {
			const first = [...useParts[0]][0] ?? '';
			const last = [...useParts[useParts.length - 1]][0] ?? '';
			return (first + last).toUpperCase();
		}
		const chars = [...(useParts[0] ?? name)];
		return (chars.slice(0, 2).join('')).toUpperCase();
	});

	const colors = [
		'bg-blue-500',
		'bg-green-500',
		'bg-purple-500',
		'bg-orange-500',
		'bg-pink-500',
		'bg-teal-500',
		'bg-indigo-500',
		'bg-red-500'
	];

	const colorClass = $derived.by(() => {
		let hash = 0;
		for (let i = 0; i < name.length; i++) {
			hash = name.charCodeAt(i) + ((hash << 5) - hash);
		}
		return colors[Math.abs(hash) % colors.length];
	});
</script>

{#if photoUrl && !photoFailed}
	<!-- Photo with initials fallback while loading -->
	<div class="relative shrink-0" style="width: {size}px; height: {size}px">
		{#if !photoLoaded}
			<div
				class="absolute inset-0 flex items-center justify-center rounded-full text-white {colorClass}"
				style="font-size: {size * 0.38}px"
			>
				{initials}
			</div>
		{/if}
		<img
			src={photoUrl}
			alt={name}
			class="absolute inset-0 rounded-full object-cover"
			style="width: {size}px; height: {size}px"
			class:opacity-0={!photoLoaded}
			onload={() => { photoLoaded = true; }}
			onerror={() => { photoFailed = true; }}
		/>
	</div>
{:else}
	<div
		class="flex shrink-0 items-center justify-center rounded-full text-white {colorClass}"
		style="width: {size}px; height: {size}px; font-size: {size * 0.38}px"
	>
		{initials}
	</div>
{/if}

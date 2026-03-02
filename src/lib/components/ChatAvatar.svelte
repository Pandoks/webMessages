<script lang="ts">
	interface Participant {
		name: string;
		avatar?: string | null;
	}

	interface Props {
		participants: Participant[];
		size?: 'sm' | 'md' | 'lg';
	}

	let { participants, size = 'md' }: Props = $props();

	const containerSizes = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-12 w-12' };
	const singleSizes = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-12 w-12 text-base' };
	const dualSizes = {
		sm: 'h-5 w-5 text-[8px]',
		md: 'h-6 w-6 text-[9px]',
		lg: 'h-7 w-7 text-[10px]'
	};
	const quadSizes = {
		sm: 'h-[18px] w-[18px] text-[7px]',
		md: 'h-[22px] w-[22px] text-[8px]',
		lg: 'h-[26px] w-[26px] text-[9px]'
	};

	// Color palette for initials backgrounds
	const colors = [
		'bg-blue-500',
		'bg-green-500',
		'bg-orange-500',
		'bg-purple-500',
		'bg-pink-500',
		'bg-teal-500',
		'bg-red-500',
		'bg-indigo-500'
	];

	function getColor(name: string): string {
		let hash = 0;
		for (let i = 0; i < name.length; i++) {
			hash = name.charCodeAt(i) + ((hash << 5) - hash);
		}
		return colors[Math.abs(hash) % colors.length];
	}

	function getInitials(name: string): string {
		return name
			.replace(/[^\p{L}\p{N}\s]/gu, '') // Remove emoji and special chars
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase() ?? '')
			.join('');
	}

	const isGroup = $derived(participants.length > 1);
	const displayParticipants = $derived(participants.slice(0, 4));
</script>

{#if !isGroup}
	<!-- Single contact: full-size circle -->
	{@const p = participants[0]}
	{#if p}
		{#if p.avatar}
			<img
				src={p.avatar}
				alt={p.name}
				class="shrink-0 rounded-full object-cover {singleSizes[size]}"
			/>
		{:else}
			<div
				class="flex shrink-0 items-center justify-center rounded-full font-semibold text-white {singleSizes[
					size
				]} {getColor(p.name)}"
			>
				{getInitials(p.name) || '?'}
			</div>
		{/if}
	{:else}
		<div
			class="flex shrink-0 items-center justify-center rounded-full bg-gray-400 font-semibold text-white {singleSizes[
				size
			]}"
		>
			?
		</div>
	{/if}
{:else if displayParticipants.length === 2}
	{@const p1 = displayParticipants[0]}
	{@const p2 = displayParticipants[1]}
	<!-- Two contacts: overlapping circles (iMessage style) -->
	<div class="relative shrink-0 {containerSizes[size]}">
		<!-- Back circle (top-left) -->
		<div class="absolute top-0 left-0">
			{#if p1.avatar}
				<img
					src={p1.avatar}
					alt={p1.name}
					class="rounded-full border-2 border-white object-cover dark:border-gray-900 {dualSizes[
						size
					]}"
				/>
			{:else}
				<div
					class="flex items-center justify-center rounded-full border-2 border-white font-semibold text-white dark:border-gray-900 {dualSizes[
						size
					]} {getColor(p1.name)}"
				>
					{getInitials(p1.name) || '?'}
				</div>
			{/if}
		</div>
		<!-- Front circle (bottom-right) -->
		<div class="absolute right-0 bottom-0">
			{#if p2.avatar}
				<img
					src={p2.avatar}
					alt={p2.name}
					class="rounded-full border-2 border-white object-cover dark:border-gray-900 {dualSizes[
						size
					]}"
				/>
			{:else}
				<div
					class="flex items-center justify-center rounded-full border-2 border-white font-semibold text-white dark:border-gray-900 {dualSizes[
						size
					]} {getColor(p2.name)}"
				>
					{getInitials(p2.name) || '?'}
				</div>
			{/if}
		</div>
	</div>
{:else if displayParticipants.length === 3}
	<!-- Three contacts: 1 top-center + 2 bottom -->
	<div class="relative shrink-0 {containerSizes[size]}">
		{#each displayParticipants as p, i}
			<div
				class="absolute {i === 0
					? 'top-0 left-1/2 -translate-x-1/2'
					: i === 1
						? 'bottom-0 left-0'
						: 'right-0 bottom-0'}"
			>
				{#if p.avatar}
					<img src={p.avatar} alt={p.name} class="rounded-full object-cover {dualSizes[size]}" />
				{:else}
					<div
						class="flex items-center justify-center rounded-full font-semibold text-white {dualSizes[
							size
						]} {getColor(p.name)}"
					>
						{getInitials(p.name) || '?'}
					</div>
				{/if}
			</div>
		{/each}
	</div>
{:else if displayParticipants.length === 4 && participants.length === 4}
	<!-- Exactly 4 contacts: 2x2 arrangement of circles -->
	<div class="relative shrink-0 {containerSizes[size]}">
		{#each displayParticipants as p, i}
			<div
				class="absolute {i === 0
					? 'top-0 left-0'
					: i === 1
						? 'top-0 right-0'
						: i === 2
							? 'bottom-0 left-0'
							: 'right-0 bottom-0'}"
			>
				{#if p.avatar}
					<img src={p.avatar} alt={p.name} class="rounded-full object-cover {quadSizes[size]}" />
				{:else}
					<div
						class="flex items-center justify-center rounded-full font-bold text-white {quadSizes[
							size
						]} {getColor(p.name)}"
					>
						{getInitials(p.name)?.[0] || '?'}
					</div>
				{/if}
			</div>
		{/each}
	</div>
{:else}
	<!-- 5+ contacts: 3 circles + "+N" badge -->
	<div class="relative shrink-0 {containerSizes[size]}">
		{#each displayParticipants.slice(0, 3) as p, i}
			<div
				class="absolute {i === 0 ? 'top-0 left-0' : i === 1 ? 'top-0 right-0' : 'bottom-0 left-0'}"
			>
				{#if p.avatar}
					<img src={p.avatar} alt={p.name} class="rounded-full object-cover {quadSizes[size]}" />
				{:else}
					<div
						class="flex items-center justify-center rounded-full font-bold text-white {quadSizes[
							size
						]} {getColor(p.name)}"
					>
						{getInitials(p.name)?.[0] || '?'}
					</div>
				{/if}
			</div>
		{/each}
		<div class="absolute right-0 bottom-0">
			<div
				class="flex items-center justify-center rounded-full bg-gray-400 font-bold text-white dark:bg-gray-600 {quadSizes[
					size
				]}"
			>
				+{participants.length - 3}
			</div>
		</div>
	</div>
{/if}

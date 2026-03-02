<script lang="ts">
	type Theme = 'light' | 'dark' | 'system';

	let theme = $state<Theme>('system');

	function applyTheme(t: Theme) {
		const isDark =
			t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
		document.documentElement.classList.toggle('dark', isDark);
	}

	function setTheme(t: Theme) {
		theme = t;
		if (t === 'system') {
			localStorage.removeItem('theme');
		} else {
			localStorage.setItem('theme', t);
		}
		applyTheme(t);
	}

	// Initialize from localStorage
	if (typeof localStorage !== 'undefined') {
		const saved = localStorage.getItem('theme') as Theme | null;
		if (saved === 'light' || saved === 'dark') {
			theme = saved;
		}
	}

	// Listen for system theme changes when in 'system' mode
	if (typeof matchMedia !== 'undefined') {
		matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
			if (theme === 'system') applyTheme('system');
		});
	}

	const options: { value: Theme; label: string; icon: string }[] = [
		{ value: 'light', label: 'Light', icon: 'sun' },
		{ value: 'dark', label: 'Dark', icon: 'moon' },
		{ value: 'system', label: 'System', icon: 'monitor' }
	];
</script>

<div class="flex gap-0.5 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
	{#each options as opt}
		<button
			onclick={() => setTheme(opt.value)}
			class="rounded-md p-1.5 transition-colors {theme === opt.value
				? 'bg-white text-gray-900 shadow-sm dark:bg-gray-600 dark:text-white'
				: 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}"
			aria-label="{opt.label} theme"
			title={opt.label}
		>
			{#if opt.icon === 'sun'}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-4 w-4"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
					/>
				</svg>
			{:else if opt.icon === 'moon'}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-4 w-4"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
					/>
				</svg>
			{:else}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-4 w-4"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
					/>
				</svg>
			{/if}
		</button>
	{/each}
</div>

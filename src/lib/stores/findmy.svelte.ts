import type { FindMyDevice, FindMyFriend } from '$lib/types/index.js';

class FindMyStore {
	devices = $state<FindMyDevice[]>([]);
	friends = $state<FindMyFriend[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);
	starred = $state<Set<string>>(new Set());

	constructor() {
		// Load starred items from localStorage
		if (typeof localStorage !== 'undefined') {
			const saved = localStorage.getItem('findmy-starred');
			if (saved) {
				this.starred = new Set(JSON.parse(saved));
			}
		}
	}

	private saveStarred() {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('findmy-starred', JSON.stringify([...this.starred]));
		}
	}

	toggleStar(id: string) {
		const next = new Set(this.starred);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		this.starred = next;
		this.saveStarred();
	}

	isStarred(id: string): boolean {
		return this.starred.has(id);
	}

	async fetchDevices() {
		try {
			const res = await fetch('/api/proxy/icloud/findmy/devices');
			if (!res.ok) {
				throw new Error(`Failed to fetch devices: ${res.status} ${res.statusText}`);
			}
			const data = await res.json();
			this.devices = data.data ?? [];
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Failed to fetch devices';
		}
	}

	async fetchFriends() {
		try {
			const res = await fetch('/api/proxy/icloud/findmy/friends');
			if (!res.ok) {
				throw new Error(`Failed to fetch friends: ${res.status} ${res.statusText}`);
			}
			const data = await res.json();
			this.friends = data.data ?? [];
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Failed to fetch friends';
		}
	}

	async fetchAll() {
		this.loading = true;
		this.error = null;
		await Promise.all([this.fetchDevices(), this.fetchFriends()]);
		this.loading = false;
	}

	async refreshDevices() {
		await fetch('/api/proxy/icloud/findmy/devices/refresh', { method: 'POST' });
		await this.fetchDevices();
	}

	async refreshFriends() {
		await fetch('/api/proxy/icloud/findmy/friends/refresh', { method: 'POST' });
		await this.fetchFriends();
	}

	async refreshAll() {
		this.loading = true;
		this.error = null;
		await Promise.all([this.refreshDevices(), this.refreshFriends()]);
		this.loading = false;
	}
}

export const findMyStore = new FindMyStore();

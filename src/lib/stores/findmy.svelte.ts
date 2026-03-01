import type { FindMyDevice, FindMyFriend } from '$lib/types/index.js';

// Raw API response shapes from imessage-rs
interface RawDevice {
	id: string;
	name: string;
	batteryLevel: number | null;
	batteryStatus: string | null;
	location: {
		latitude: number;
		longitude: number;
		timeStamp: number;
	} | null;
	address: {
		formattedAddressLines: string[];
	} | null;
	modelDisplayName: string | null;
	deviceDisplayName: string | null;
	deviceClass: string | null;
	isConsideredAccessory?: boolean;
}

interface RawFriend {
	handle: string;
	coordinates: [number, number] | null;
	short_address: string | null;
	last_updated: number | null;
	is_locating_in_progress: number;
	title: string | null;
	subtitle: string | null;
}

class FindMyStore {
	devices = $state<FindMyDevice[]>([]);
	friends = $state<FindMyFriend[]>([]);
	myLocation = $state<{
		latitude: number;
		longitude: number;
		timestamp: number;
		address: string | null;
		name: string;
		photoBase64: string | null;
	} | null>(null);
	loading = $state(false);
	error = $state<string | null>(null);
	starred = $state<Set<string>>(new Set());
	private cachedContactMap: Record<string, string> = {};
	private cachedPhotoMap: Record<string, string> = {};

	constructor() {
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

	private transformDevice(raw: RawDevice): FindMyDevice {
		return {
			id: raw.id,
			name: raw.name,
			batteryLevel: raw.batteryLevel,
			batteryStatus: raw.batteryStatus ?? null,
			latitude: raw.location?.latitude ?? null,
			longitude: raw.location?.longitude ?? null,
			address: raw.address?.formattedAddressLines?.join(', ') ?? null,
			locationTimestamp: raw.location?.timeStamp ?? null,
			isLocating: false,
			modelDisplayName: raw.modelDisplayName ?? null,
			deviceDisplayName: raw.deviceDisplayName ?? null,
			deviceClass: raw.deviceClass ?? null,
			isConsideredAccessory: raw.isConsideredAccessory ?? false
		};
	}

	private transformFriend(
		raw: RawFriend,
		contactMap: Record<string, string>,
		photoMap: Record<string, string>
	): FindMyFriend {
		const normalized = raw.handle.replace(/[\s\-()]/g, '').toLowerCase();
		const contactName = contactMap[normalized];
		const displayName =
			contactName || [raw.title, raw.subtitle].filter(Boolean).join(' ') || raw.handle;
		return {
			handle: raw.handle,
			displayName,
			latitude: raw.coordinates?.[0] ?? null,
			longitude: raw.coordinates?.[1] ?? null,
			address: raw.short_address ?? null,
			locationTimestamp: raw.last_updated ?? null,
			locatingInProgress: raw.is_locating_in_progress !== 0,
			avatarBase64: (photoMap[normalized]?.length ?? 0) > 500 ? photoMap[normalized] : null
		};
	}

	private mergeFriends(friends: FindMyFriend[]): FindMyFriend[] {
		const groups = new Map<string, FindMyFriend[]>();

		for (const friend of friends) {
			// Only merge friends that resolved to a contact name (not raw handles)
			const isResolved = friend.displayName !== friend.handle;
			const key = isResolved ? friend.displayName : `__handle__${friend.handle}`;

			const group = groups.get(key);
			if (group) {
				group.push(friend);
			} else {
				groups.set(key, [friend]);
			}
		}

		const merged: FindMyFriend[] = [];
		for (const group of groups.values()) {
			if (group.length === 1) {
				merged.push(group[0]);
				continue;
			}
			// Pick the entry with the most recent location
			group.sort((a, b) => (b.locationTimestamp ?? 0) - (a.locationTimestamp ?? 0));
			merged.push({
				...group[0],
				locatingInProgress: group.some((f) => f.locatingInProgress)
			});
		}

		return merged;
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
			const raw: RawDevice[] = data.data ?? [];
			this.devices = raw.map((d) => this.transformDevice(d));
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Failed to fetch devices';
		}
	}

	async fetchFriends() {
		try {
			const [friendsRes, contactsRes] = await Promise.all([
				fetch('/api/proxy/icloud/findmy/friends'),
				fetch('/api/contacts').catch(() => null)
			]);
			if (!friendsRes.ok) {
				throw new Error(`Failed to fetch friends: ${friendsRes.status} ${friendsRes.statusText}`);
			}
			const friendsData = await friendsRes.json();
			const raw: RawFriend[] = friendsData.data ?? [];

			if (contactsRes?.ok) {
				const contacts = await contactsRes.json();
				this.cachedContactMap = contacts.data ?? {};
				this.cachedPhotoMap = contacts.photos ?? {};
			}

			const transformed = raw.map((f) => this.transformFriend(f, this.cachedContactMap, this.cachedPhotoMap));
			this.friends = this.mergeFriends(transformed);
			// Reverse geocode friends with city-only addresses (non-blocking)
			this.geocodeFriends();
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Failed to fetch friends';
		}
	}

	private async geocodeFriends() {
		const needsGeocode = this.friends.filter(
			(f) => f.latitude != null && f.longitude != null && (!f.address || !/\d/.test(f.address))
		);
		if (needsGeocode.length === 0) return;

		// Batch geocode via Apple CLGeocoder (server-side Swift binary)
		const coordPairs = needsGeocode.map((f) => `${f.latitude},${f.longitude}`).join('|');
		try {
			const res = await fetch(`/api/geocode?coords=${encodeURIComponent(coordPairs)}`);
			const { data } = await res.json();
			if (data) {
				this.friends = this.friends.map((f) => {
					const key = `${f.latitude},${f.longitude}`;
					const addr = data[key];
					return addr ? { ...f, address: addr } : f;
				});
			}
		} catch {
			// geocoding failed, keep existing addresses
		}
	}

	applyLocationUpdate(data: unknown) {
		const raw = data as RawFriend;
		if (!raw.handle) return;

		const transformed = this.transformFriend(raw, this.cachedContactMap, this.cachedPhotoMap);
		const idx = this.friends.findIndex((f) => f.handle === transformed.handle);

		if (idx >= 0) {
			const existing = this.friends[idx];
			const coordsChanged =
				existing.latitude !== transformed.latitude ||
				existing.longitude !== transformed.longitude;
			const updated = [...this.friends];
			updated[idx] = { ...transformed, address: coordsChanged ? transformed.address : existing.address };
			this.friends = this.mergeFriends(updated);
			if (coordsChanged) {
				this.geocodeFriends();
			}
		} else {
			// New friend
			this.friends = this.mergeFriends([...this.friends, transformed]);
			this.geocodeFriends();
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

	async fetchMyLocation() {
		if (typeof navigator === 'undefined' || !navigator.geolocation) return;

		// Fetch profile info and geolocation in parallel
		const [profile, coords] = await Promise.all([
			fetch('/api/me')
				.then((r) => r.json())
				.catch(() => ({ name: 'Me', photoBase64: null })),
			new Promise<GeolocationPosition | null>((resolve) => {
				navigator.geolocation.getCurrentPosition(
					(pos) => resolve(pos),
					() => resolve(null),
					{ enableHighAccuracy: true, timeout: 10000 }
				);
			})
		]);

		if (!coords) return;

		const lat = coords.coords.latitude;
		const lon = coords.coords.longitude;

		// Show "Me" card immediately with GPS coords, geocode address in background
		this.myLocation = {
			latitude: lat,
			longitude: lon,
			timestamp: coords.timestamp,
			address: null,
			name: profile.name || 'Me',
			photoBase64: profile.photoBase64
		};

		// Reverse geocode in background — updates the card when ready
		try {
			const res = await fetch(`/api/geocode?coords=${lat},${lon}`);
			const { data } = await res.json();
			const address = data?.[`${lat},${lon}`] ?? null;
			if (address) {
				this.myLocation = { ...this.myLocation!, address };
			}
		} catch {
			// geocoding failed, address stays null
		}
	}
}

export const findMyStore = new FindMyStore();

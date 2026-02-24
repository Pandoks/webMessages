import { execFileSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { isPhoneNumber, normalizePhone } from '$lib/utils/phone.js';

const PINNING_PREF_PATH = join(homedir(), 'Library', 'Preferences', 'com.apple.messages.pinning.plist');

interface PinningCache {
	mtimeMs: number;
	rankByIdentifier: Map<string, number>;
}

let cache: PinningCache | null = null;
let lastPinningReadErrorAt = 0;

function canonicalIdentifier(identifier: string): string {
	const trimmed = identifier.trim();
	if (!trimmed) return '';
	if (isPhoneNumber(trimmed)) {
		return normalizePhone(trimmed).toLowerCase();
	}
	return trimmed.toLowerCase();
}

function extractPinnedIdentifiers(payload: unknown): string[] {
	const out: string[] = [];

	const addFromEntry = (entry: unknown) => {
		if (typeof entry === 'string') {
			const value = entry.trim();
			if (value) out.push(value);
			return;
		}
		if (Array.isArray(entry)) {
			for (const item of entry) addFromEntry(item);
			return;
		}
		if (!entry || typeof entry !== 'object') return;
		for (const value of Object.values(entry)) addFromEntry(value);
	};

	if (Array.isArray(payload)) {
		for (const entry of payload) addFromEntry(entry);
		return out;
	}

	if (!payload || typeof payload !== 'object') return out;
	const pD = (payload as { pD?: unknown }).pD;
	if (!pD || typeof pD !== 'object') return out;
	const pP = (pD as { pP?: unknown }).pP;
	if (!Array.isArray(pP)) return out;

	for (const entry of pP) {
		addFromEntry(entry);
	}
	return out;
}

function loadPinningCache(): PinningCache {
	if (!existsSync(PINNING_PREF_PATH)) {
		cache = { mtimeMs: -1, rankByIdentifier: new Map() };
		return cache;
	}

	const mtimeMs = statSync(PINNING_PREF_PATH).mtimeMs;
	if (cache && cache.mtimeMs === mtimeMs) return cache;

	let pinned: string[] = [];
	try {
		const raw = execFileSync('plutil', ['-extract', 'pD.pP', 'json', '-o', '-', PINNING_PREF_PATH], {
			encoding: 'utf-8'
		});
		const parsed = JSON.parse(raw) as unknown;
		pinned = extractPinnedIdentifiers(parsed);
	} catch {
		// Some macOS builds may use a different root path.
		try {
			const raw = execFileSync('plutil', ['-extract', 'pP', 'json', '-o', '-', PINNING_PREF_PATH], {
				encoding: 'utf-8'
			});
			const parsed = JSON.parse(raw) as unknown;
			pinned = extractPinnedIdentifiers(parsed);
		} catch (err) {
			const now = Date.now();
			if (now - lastPinningReadErrorAt > 30000) {
				console.warn('Failed to read pinned chats:', err);
				lastPinningReadErrorAt = now;
			}
		}
	}

	const rankByIdentifier = new Map<string, number>();
	for (let i = 0; i < pinned.length; i++) {
		const key = canonicalIdentifier(pinned[i]);
		if (!key) continue;
		if (!rankByIdentifier.has(key)) {
			rankByIdentifier.set(key, i);
		}
	}

	cache = {
		mtimeMs,
		rankByIdentifier
	};
	return cache;
}

export function getPinnedRank(candidates: string[]): number | null {
	if (candidates.length === 0) return null;
	const { rankByIdentifier } = loadPinningCache();
	let best: number | null = null;

	for (const candidate of candidates) {
		const key = canonicalIdentifier(candidate);
		if (!key) continue;
		const rank = rankByIdentifier.get(key);
		if (rank == null) continue;
		if (best == null || rank < best) {
			best = rank;
		}
	}

	return best;
}

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const binaryPath = resolve('scripts/reverse-geocode');

// Cache geocode results in memory (coordinates rarely change)
const cache = new Map<string, string>();

export const GET: RequestHandler = async ({ url }) => {
	const coords = url.searchParams.get('coords');
	if (!coords) {
		return json({ error: 'Missing coords param (lat,lon or lat,lon|lat,lon)' }, { status: 400 });
	}

	// Split by pipe for batch requests: "lat,lon|lat,lon|..."
	const pairs = coords.split('|').map((c) => c.trim()).filter(Boolean);
	const results: Record<string, string | null> = {};
	const uncached: string[] = [];

	for (const pair of pairs) {
		const cached = cache.get(pair);
		if (cached !== undefined) {
			results[pair] = cached;
		} else {
			uncached.push(pair);
		}
	}

	if (uncached.length > 0) {
		try {
			const { stdout } = await execFileAsync(binaryPath, uncached, { timeout: 15000 });
			const lines = stdout.trim().split('\n');
			for (let i = 0; i < uncached.length; i++) {
				const line = lines[i]?.trim() ?? '';
				if (line.startsWith('ERROR:') || !line) {
					results[uncached[i]] = null;
				} else {
					results[uncached[i]] = line;
					cache.set(uncached[i], line);
				}
			}
		} catch {
			// Binary failed — return nulls for uncached
			for (const pair of uncached) {
				results[pair] = null;
			}
		}
	}

	return json({ data: results });
};

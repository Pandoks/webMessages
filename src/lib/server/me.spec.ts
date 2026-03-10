import { describe, it, expect } from 'vitest';
import { extractIcloudAccountIdentifiers, mergeSelfIdentifiers } from './me.js';

describe('extractIcloudAccountIdentifiers', () => {
	it('collects apple id, active alias, and alias arrays', () => {
		expect(
			extractIcloudAccountIdentifiers({
				apple_id: 'masked-user@example.com',
				active_alias: '+1 (555) 010-1234',
				aliases: [{ Alias: 'masked-user@example.com' }, { Alias: '+15550101234' }],
				vetted_aliases: [{ Alias: 'e:masked-user@example.com' }]
			})
		).toEqual(['maskeduser@example.com', '+15550101234']);
	});

	it('handles missing account data', () => {
		expect(extractIcloudAccountIdentifiers(null)).toEqual([]);
	});
});

describe('mergeSelfIdentifiers', () => {
	it('merges and deduplicates me card identifiers with icloud aliases', () => {
		expect(
			mergeSelfIdentifiers(['5550105678', 'me@example.com'], {
				apple_id: 'masked-user@example.com',
				active_alias: '+15550101234',
				aliases: [{ Alias: 'masked-user@example.com' }]
			})
		).toEqual(['5550105678', 'me@example.com', 'maskeduser@example.com', '+15550101234']);
	});

	it('normalizes imessage-style prefixes while merging', () => {
		expect(
			mergeSelfIdentifiers(['e:me@example.com'], {
				aliases: [{ Alias: 'masked-user@example.com' }, { Alias: 'e:masked-user@example.com' }]
			})
		).toEqual(['me@example.com', 'maskeduser@example.com']);
	});
});

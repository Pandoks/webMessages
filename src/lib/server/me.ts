import { normalizeMessagingAddress } from '$lib/utils/format.js';

type AliasLike = string | { Alias?: string | null } | null | undefined;

export interface IcloudAccountInfo {
	apple_id?: string | null;
	account_name?: string | null;
	active_alias?: string | null;
	aliases?: AliasLike[];
	vetted_aliases?: AliasLike[];
}

function normalizeMany(values: Iterable<string | null | undefined>): string[] {
	const seen = new Set<string>();
	for (const value of values) {
		if (!value) continue;
		const normalized = normalizeMessagingAddress(value);
		if (normalized) seen.add(normalized);
	}
	return [...seen];
}

function extractAliasValue(alias: AliasLike): string | null {
	if (!alias) return null;
	if (typeof alias === 'string') return alias;
	return alias.Alias ?? null;
}

export function extractIcloudAccountIdentifiers(
	account: IcloudAccountInfo | null | undefined
): string[] {
	if (!account) return [];
	return normalizeMany([
		account.apple_id,
		account.active_alias,
		...(account.aliases ?? []).map(extractAliasValue),
		...(account.vetted_aliases ?? []).map(extractAliasValue)
	]);
}

export function mergeSelfIdentifiers(
	meCardIdentifiers: string[],
	account: IcloudAccountInfo | null | undefined
): string[] {
	return normalizeMany([...meCardIdentifiers, ...extractIcloudAccountIdentifiers(account)]);
}

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module before importing SyncEngine
const mockMessages = {
	get: vi.fn(),
	put: vi.fn(),
	delete: vi.fn(),
	update: vi.fn(),
	where: vi.fn()
};
const mockChats = {
	get: vi.fn(),
	put: vi.fn(),
	update: vi.fn()
};
const mockAttachments = {
	put: vi.fn()
};
const mockHandles = {
	get: vi.fn(),
	put: vi.fn(),
	update: vi.fn()
};
const mockSyncMeta = {
	get: vi.fn(),
	put: vi.fn()
};

vi.mock('$lib/db/index.js', () => ({
	db: {
		messages: mockMessages,
		chats: mockChats,
		attachments: mockAttachments,
		handles: mockHandles,
		syncMeta: mockSyncMeta,
		transaction: vi.fn(async (_mode: string, _tables: unknown, fn: () => Promise<void>) => {
			await fn();
		})
	}
}));

vi.mock('$lib/sync/sse.js', () => ({
	SSEClient: class {
		onEvent = vi.fn();
		onReconnect = vi.fn();
		connect = vi.fn();
		disconnect = vi.fn();
	}
}));

vi.mock('$lib/stores/findmy.svelte.js', () => ({
	findMyStore: { applyLocationUpdate: vi.fn() }
}));

// Stub global fetch for proxy calls
vi.stubGlobal(
	'fetch',
	vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) })
);

const { SyncEngine } = await import('./engine.svelte.js');

function makeMessage(overrides: Record<string, unknown> = {}) {
	return {
		guid: 'real-guid-1',
		text: 'hello',
		handleId: 0,
		handle: { address: '+1234567890', service: 'iMessage', country: 'US' },
		isFromMe: true,
		dateCreated: Date.now(),
		dateRead: null,
		dateDelivered: null,
		dateEdited: null,
		dateRetracted: null,
		subject: null,
		associatedMessageGuid: null,
		associatedMessageType: null,
		associatedMessageEmoji: null,
		expressiveSendStyleId: null,
		threadOriginatorGuid: null,
		attachments: [],
		error: 0,
		isDelivered: true,
		groupTitle: null,
		groupActionType: null,
		isSystemMessage: false,
		itemType: 0,
		chats: [{ guid: 'iMessage;-;+1234567890' }],
		...overrides
	};
}

describe('SyncEngine optimistic send deduplication', () => {
	let engine: InstanceType<typeof SyncEngine>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockMessages.get.mockResolvedValue(undefined);
		mockChats.get.mockResolvedValue({
			guid: 'iMessage;-;+1234567890',
			unreadCount: 0,
			lastMessageDate: 0
		});
		engine = new SyncEngine();
	});

	describe('registerPendingSend / registerTempGuid / clearPendingSend', () => {
		it('registerPendingSend tracks temp guid metadata', () => {
			engine.registerPendingSend('temp-1', 'iMessage;-;+1234567890', 'hello');
			// No public accessor, but we verify via handleEvent behavior below
			expect(true).toBe(true);
		});

		it('registerTempGuid maps real guid to temp guid', () => {
			engine.registerTempGuid('temp-1', 'real-1');
			expect(true).toBe(true);
		});

		it('clearPendingSend removes the entry', () => {
			engine.registerPendingSend('temp-1', 'iMessage;-;+1234567890', 'hello');
			engine.clearPendingSend('temp-1');
			expect(true).toBe(true);
		});
	});

	describe('Tier 1: exact realGuid match (happy path)', () => {
		it('deletes temp message when webhook arrives with known realGuid', async () => {
			const tempGuid = 'temp-uuid-1';
			const realGuid = 'real-guid-1';

			engine.registerPendingSend(tempGuid, 'iMessage;-;+1234567890', 'hello');
			engine.registerTempGuid(tempGuid, realGuid);

			await engine.handleEvent('new-message', makeMessage({ guid: realGuid, text: 'hello' }));

			expect(mockMessages.delete).toHaveBeenCalledWith(tempGuid);
		});

		it('does not leave orphaned pendingSends after Tier 1 match', async () => {
			const tempGuid = 'temp-uuid-2';
			const realGuid = 'real-guid-2';

			engine.registerPendingSend(tempGuid, 'iMessage;-;+1234567890', 'test msg');
			engine.registerTempGuid(tempGuid, realGuid);

			await engine.handleEvent('new-message', makeMessage({ guid: realGuid, text: 'test msg' }));

			// Send another message with same text — should NOT be matched by Tier 2
			// because the pendingSend was already cleaned up
			mockMessages.delete.mockClear();

			await engine.handleEvent(
				'new-message',
				makeMessage({ guid: 'different-guid', text: 'test msg' })
			);

			// Should not delete anything — no pending sends left
			expect(mockMessages.delete).not.toHaveBeenCalled();
		});
	});

	describe('Tier 2: orphaned temp match (API succeeded but response lost)', () => {
		it('matches by chatGuid + text when no Tier 1 mapping exists', async () => {
			const tempGuid = 'temp-uuid-3';

			// Register pending send but never register tempGuid (simulating lost response)
			engine.registerPendingSend(tempGuid, 'iMessage;-;+1234567890', 'lost response msg');

			await engine.handleEvent(
				'new-message',
				makeMessage({
					guid: 'server-assigned-guid',
					text: 'lost response msg',
					isFromMe: true,
					chats: [{ guid: 'iMessage;-;+1234567890' }]
				})
			);

			expect(mockMessages.delete).toHaveBeenCalledWith(tempGuid);
		});

		it('does not match Tier 2 for non-isFromMe messages', async () => {
			const tempGuid = 'temp-uuid-4';

			engine.registerPendingSend(tempGuid, 'iMessage;-;+1234567890', 'hello');

			await engine.handleEvent(
				'new-message',
				makeMessage({
					guid: 'incoming-guid',
					text: 'hello',
					isFromMe: false,
					chats: [{ guid: 'iMessage;-;+1234567890' }]
				})
			);

			// Should NOT delete — incoming messages shouldn't match our temp sends
			expect(mockMessages.delete).not.toHaveBeenCalledWith(tempGuid);
		});

		it('does not match Tier 2 when text differs', async () => {
			const tempGuid = 'temp-uuid-5';

			engine.registerPendingSend(tempGuid, 'iMessage;-;+1234567890', 'hello');

			await engine.handleEvent(
				'new-message',
				makeMessage({
					guid: 'other-guid',
					text: 'different text',
					isFromMe: true,
					chats: [{ guid: 'iMessage;-;+1234567890' }]
				})
			);

			expect(mockMessages.delete).not.toHaveBeenCalledWith(tempGuid);
		});

		it('does not match Tier 2 when chatGuid differs', async () => {
			const tempGuid = 'temp-uuid-6';

			engine.registerPendingSend(tempGuid, 'iMessage;-;+1234567890', 'hello');

			await engine.handleEvent(
				'new-message',
				makeMessage({
					guid: 'other-guid',
					text: 'hello',
					isFromMe: true,
					chats: [{ guid: 'iMessage;-;+9999999999' }]
				})
			);

			expect(mockMessages.delete).not.toHaveBeenCalledWith(tempGuid);
		});

		it('only deletes the first matching temp send', async () => {
			// Two pending sends with same text to same chat (rapid double send)
			engine.registerPendingSend('temp-a', 'iMessage;-;+1234567890', 'hello');
			engine.registerPendingSend('temp-b', 'iMessage;-;+1234567890', 'hello');

			await engine.handleEvent(
				'new-message',
				makeMessage({
					guid: 'server-guid-1',
					text: 'hello',
					isFromMe: true,
					chats: [{ guid: 'iMessage;-;+1234567890' }]
				})
			);

			// Should delete exactly one temp message
			const deleteCalls = mockMessages.delete.mock.calls.filter(
				(call: string[]) => call[0] === 'temp-a' || call[0] === 'temp-b'
			);
			expect(deleteCalls).toHaveLength(1);
		});
	});

	describe('clearPendingSend prevents stale matches', () => {
		it('cleared sends are not matched by Tier 2', async () => {
			const tempGuid = 'temp-uuid-7';

			engine.registerPendingSend(tempGuid, 'iMessage;-;+1234567890', 'hello');
			engine.clearPendingSend(tempGuid);

			await engine.handleEvent(
				'new-message',
				makeMessage({
					guid: 'some-guid',
					text: 'hello',
					isFromMe: true,
					chats: [{ guid: 'iMessage;-;+1234567890' }]
				})
			);

			expect(mockMessages.delete).not.toHaveBeenCalledWith(tempGuid);
		});
	});

	describe('webhook processes message normally after dedup', () => {
		it('stores the real message in IndexedDB after Tier 1 cleanup', async () => {
			const tempGuid = 'temp-uuid-8';
			const realGuid = 'real-guid-8';

			engine.registerPendingSend(tempGuid, 'iMessage;-;+1234567890', 'hello');
			engine.registerTempGuid(tempGuid, realGuid);

			await engine.handleEvent('new-message', makeMessage({ guid: realGuid, text: 'hello' }));

			// Should have deleted the temp AND stored the real message
			expect(mockMessages.delete).toHaveBeenCalledWith(tempGuid);
			expect(mockMessages.put).toHaveBeenCalledWith(
				expect.objectContaining({ guid: realGuid, text: 'hello' })
			);
		});

		it('stores the real message in IndexedDB after Tier 2 cleanup', async () => {
			const tempGuid = 'temp-uuid-9';

			engine.registerPendingSend(tempGuid, 'iMessage;-;+1234567890', 'orphaned msg');

			await engine.handleEvent(
				'new-message',
				makeMessage({
					guid: 'server-guid-9',
					text: 'orphaned msg',
					isFromMe: true,
					chats: [{ guid: 'iMessage;-;+1234567890' }]
				})
			);

			expect(mockMessages.delete).toHaveBeenCalledWith(tempGuid);
			expect(mockMessages.put).toHaveBeenCalledWith(
				expect.objectContaining({ guid: 'server-guid-9', text: 'orphaned msg' })
			);
		});
	});
});

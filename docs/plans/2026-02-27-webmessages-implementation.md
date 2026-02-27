# webMessages Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a web version of iMessages + Find My backed by imessage-rs, running as a local-first SPA in Docker with Tailscale VPN exposure.

**Architecture:** SvelteKit server proxies requests to imessage-rs (native macOS). Browser renders from IndexedDB (Dexie) with event-driven sync via SSE. Docker Compose with Tailscale sidecar for VPN access.

**Tech Stack:** SvelteKit 5 (adapter-node), Svelte 5 runes, Tailwind CSS 4, Dexie.js, TypeScript, Vitest, Playwright, Docker

**Reference:** Svelte 5 docs at `reference/svelte.txt`, design doc at `docs/plans/2026-02-27-webmessages-design.md`

---

## Phase 1: Foundation

### Task 1: Switch to adapter-node and configure environment

**Files:**
- Modify: `svelte.config.js`
- Modify: `package.json`
- Create: `src/lib/server/env.ts`
- Create: `.env.example`
- Modify: `.gitignore`
- Modify: `src/app.d.ts`

**Step 1: Install adapter-node and dexie**

Run:
```bash
pnpm add -D @sveltejs/adapter-node
pnpm add dexie
```

**Step 2: Switch adapter**

In `svelte.config.js`, replace `adapter-auto` with `adapter-node`:

```js
import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter()
	}
};

export default config;
```

**Step 3: Create env config**

Create `src/lib/server/env.ts`:

```ts
import { env } from '$env/dynamic/private';

export const IMESSAGE_RS_URL = env.IMESSAGE_RS_URL ?? 'http://127.0.0.1:1234';
export const IMESSAGE_RS_PASSWORD = env.IMESSAGE_RS_PASSWORD ?? '';
```

**Step 4: Create .env.example**

```
IMESSAGE_RS_URL=http://127.0.0.1:1234
IMESSAGE_RS_PASSWORD=your-secret-token
```

**Step 5: Update .gitignore**

Add `.env` and `.env.local` lines if not already present.

**Step 6: Update app.d.ts with Locals type**

```ts
declare global {
	namespace App {
		interface Locals {
			clientIp: string;
		}
	}
}

export {};
```

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: switch to adapter-node, add env config"
```

---

### Task 2: Define TypeScript types matching imessage-rs API

**Files:**
- Create: `src/lib/types/index.ts`
- Create: `src/lib/types/api.ts`
- Test: `src/lib/types/api.spec.ts`

**Step 1: Create shared types**

Create `src/lib/types/index.ts` — these types mirror imessage-rs JSON responses:

```ts
export interface Handle {
	originalROWID: number;
	address: string;
	service: string;
	uncanonicalizedId: string | null;
	country: string;
}

export interface Attachment {
	originalROWID: number;
	guid: string;
	uti: string | null;
	mimeType: string | null;
	transferName: string | null;
	totalBytes: number;
	transferState: number;
	isOutgoing: boolean;
	hideAttachment: boolean;
	isSticker: boolean;
	originalGuid: string | null;
	hasLivePhoto: boolean;
	height: number | null;
	width: number | null;
	metadata: Record<string, unknown> | null;
}

export interface Message {
	originalROWID: number;
	guid: string;
	text: string | null;
	attributedBody: unknown[];
	handle: Handle | null;
	handleId: number;
	otherHandle: number;
	attachments: Attachment[];
	subject: string | null;
	error: number;
	dateCreated: number;
	dateRead: number | null;
	dateDelivered: number | null;
	isDelivered: boolean;
	isFromMe: boolean;
	hasDdResults: boolean;
	isArchived: boolean;
	itemType: number;
	groupTitle: string | null;
	groupActionType: number;
	balloonBundleId: string | null;
	associatedMessageGuid: string | null;
	associatedMessageType: number;
	associatedMessageEmoji: string | null;
	expressiveSendStyleId: string | null;
	threadOriginatorGuid: string | null;
	threadOriginatorPart: string | null;
	hasPayloadData: boolean;
	isDelayed: boolean;
	isAutoReply: boolean;
	isSystemMessage: boolean;
	isServiceMessage: boolean;
	isForward: boolean;
	isCorrupt: boolean;
	datePlayed: number | null;
	isSpam: boolean;
	isExpired: boolean;
	isAudioMessage: boolean;
	replyToGuid: string | null;
	shareStatus: number;
	shareDirection: number;
	wasDeliveredQuietly: boolean;
	didNotifyRecipient: boolean;
	chats: Chat[];
	dateEdited: number | null;
	dateRetracted: number | null;
	partCount: number | null;
}

export interface Chat {
	originalROWID: number;
	guid: string;
	style: number; // 43 = group, 45 = 1:1
	chatIdentifier: string;
	isArchived: boolean;
	displayName: string | null;
	participants: Handle[];
	messages: Message[];
	isFiltered: boolean;
	groupId: string | null;
	lastMessage?: Message | null;
}

export interface Contact {
	address: string;
	displayName: string | null;
	avatarBase64: string | null;
}

export interface FindMyDevice {
	id: string;
	name: string;
	batteryLevel: number | null;
	batteryStatus: string | null;
	latitude: number | null;
	longitude: number | null;
	address: string | null;
	locationTimestamp: number | null;
	isLocating: boolean;
	modelDisplayName: string | null;
}

export interface FindMyFriend {
	id: string;
	handle: string;
	firstName: string | null;
	lastName: string | null;
	latitude: number | null;
	longitude: number | null;
	address: string | null;
	locationTimestamp: number | null;
	locatingInProgress: boolean;
}

/** Standard imessage-rs API response envelope */
export interface ApiResponse<T> {
	status: number;
	message: string;
	data: T;
}

/** Webhook event from imessage-rs */
export interface WebhookEvent {
	type: string;
	data: unknown;
}
```

**Step 2: Create API request/response types**

Create `src/lib/types/api.ts`:

```ts
export interface SendTextRequest {
	chatGuid: string;
	tempGuid?: string;
	message: string;
	method?: 'private-api' | 'apple-script';
	effectId?: string;
	subject?: string;
	selectedMessageGuid?: string;
	partIndex?: number;
}

export interface ReactRequest {
	chatGuid: string;
	selectedMessageGuid: string;
	reaction: 'love' | 'like' | 'dislike' | 'laugh' | 'emphasize' | 'question' | string;
	partIndex?: number;
}

export interface ChatQueryRequest {
	guid?: string;
	with?: string[];
	sort?: string;
	offset?: number;
	limit?: number;
}

export interface MessageQueryRequest {
	chatGuid?: string;
	with?: string[];
	offset?: number;
	limit?: number;
	sort?: 'ASC' | 'DESC';
	after?: string;
	before?: string;
}

export interface CreateChatRequest {
	addresses: string[];
	message?: string;
	method?: 'private-api' | 'apple-script';
	service?: 'iMessage' | 'SMS';
	tempGuid?: string;
}
```

**Step 3: Write a smoke test**

Create `src/lib/types/api.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Message, Chat, ApiResponse } from './index.js';

describe('types', () => {
	it('ApiResponse type compiles correctly', () => {
		const response: ApiResponse<string> = {
			status: 200,
			message: 'Success',
			data: 'test'
		};
		expect(response.status).toBe(200);
	});

	it('Message type allows null text', () => {
		const msg = { text: null } as Partial<Message>;
		expect(msg.text).toBeNull();
	});

	it('Chat style constants are correct', () => {
		const group: Partial<Chat> = { style: 43 };
		const oneOnOne: Partial<Chat> = { style: 45 };
		expect(group.style).toBe(43);
		expect(oneOnOne.style).toBe(45);
	});
});
```

**Step 4: Run test**

```bash
pnpm vitest run src/lib/types/api.spec.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/types/
git commit -m "feat: add TypeScript types matching imessage-rs API"
```

---

### Task 3: Set up Dexie IndexedDB schema

**Files:**
- Create: `src/lib/db/index.ts`
- Create: `src/lib/db/types.ts`
- Test: `src/lib/db/index.spec.ts`

**Step 1: Create DB record types**

Create `src/lib/db/types.ts` — these are the shapes stored in IndexedDB (flattened from API types):

```ts
export interface DbChat {
	guid: string;
	chatIdentifier: string;
	displayName: string | null;
	style: number;
	lastMessageDate: number;
	lastMessageText: string | null;
	isArchived: boolean;
	isPinned: boolean;
	unreadCount: number;
	participants: string[]; // handle addresses
}

export interface DbMessage {
	guid: string;
	chatGuid: string;
	text: string | null;
	handleId: number;
	handleAddress: string | null;
	isFromMe: boolean;
	dateCreated: number;
	dateRead: number | null;
	dateDelivered: number | null;
	dateEdited: number | null;
	dateRetracted: number | null;
	subject: string | null;
	associatedMessageGuid: string | null;
	associatedMessageType: number;
	associatedMessageEmoji: string | null;
	threadOriginatorGuid: string | null;
	attachmentGuids: string[];
	error: number;
	expressiveSendStyleId: string | null;
	isDelivered: boolean;
	groupTitle: string | null;
	groupActionType: number;
	isSystemMessage: boolean;
	itemType: number;
}

export interface DbHandle {
	address: string;
	service: string;
	country: string;
	displayName: string | null;
	avatarBase64: string | null;
}

export interface DbAttachment {
	guid: string;
	messageGuid: string;
	mimeType: string | null;
	transferName: string | null;
	totalBytes: number;
	width: number | null;
	height: number | null;
	hasLivePhoto: boolean;
	blurhash: string | null;
	isSticker: boolean;
}

export interface DbSyncMeta {
	key: string;
	value: string;
}
```

**Step 2: Create Dexie database**

Create `src/lib/db/index.ts`:

```ts
import Dexie, { type EntityTable } from 'dexie';
import type { DbChat, DbMessage, DbHandle, DbAttachment, DbSyncMeta } from './types.js';

export class WebMessagesDB extends Dexie {
	chats!: EntityTable<DbChat, 'guid'>;
	messages!: EntityTable<DbMessage, 'guid'>;
	handles!: EntityTable<DbHandle, 'address'>;
	attachments!: EntityTable<DbAttachment, 'guid'>;
	syncMeta!: EntityTable<DbSyncMeta, 'key'>;

	constructor() {
		super('webMessages');

		this.version(1).stores({
			chats: 'guid, chatIdentifier, lastMessageDate, isPinned',
			messages: 'guid, chatGuid, dateCreated, associatedMessageGuid, threadOriginatorGuid',
			handles: 'address',
			attachments: 'guid, messageGuid',
			syncMeta: 'key'
		});
	}
}

export const db = new WebMessagesDB();
```

**Step 3: Write test**

Create `src/lib/db/index.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { WebMessagesDB } from './index.js';

describe('WebMessagesDB', () => {
	let testDb: WebMessagesDB;

	beforeEach(async () => {
		testDb = new WebMessagesDB();
		await testDb.delete();
		testDb = new WebMessagesDB();
	});

	it('creates database with correct tables', () => {
		expect(testDb.chats).toBeDefined();
		expect(testDb.messages).toBeDefined();
		expect(testDb.handles).toBeDefined();
		expect(testDb.attachments).toBeDefined();
		expect(testDb.syncMeta).toBeDefined();
	});
});
```

Note: Dexie tests need browser environment. This test file should use the `.svelte.spec.ts` naming OR be configured to run in browser. If using browser test project, rename to `index.svelte.spec.ts` or adjust vitest config to include `src/lib/db/` in client tests.

**Step 4: Run test**

```bash
pnpm vitest run --project client src/lib/db/
```

**Step 5: Commit**

```bash
git add src/lib/db/
git commit -m "feat: add Dexie IndexedDB schema"
```

---

### Task 4: Create imessage-rs API client (server-side)

**Files:**
- Create: `src/lib/server/imessage-rs.ts`
- Test: `src/lib/server/imessage-rs.spec.ts`

**Step 1: Write failing test**

Create `src/lib/server/imessage-rs.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImessageClient } from './imessage-rs.js';

describe('ImessageClient', () => {
	let client: ImessageClient;

	beforeEach(() => {
		client = new ImessageClient('http://localhost:1234', 'test-password');
	});

	it('constructs correct URL with password', () => {
		const url = client.buildUrl('/api/v1/ping');
		expect(url).toBe('http://localhost:1234/api/v1/ping?password=test-password');
	});

	it('constructs URL with existing query params', () => {
		const url = client.buildUrl('/api/v1/chat/guid/message?limit=50&sort=DESC');
		expect(url).toContain('password=test-password');
		expect(url).toContain('limit=50');
	});

	it('fetches with correct headers', async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ status: 200, message: 'Success', data: 'pong' }))
		);
		global.fetch = mockFetch;

		await client.get('/api/v1/ping');

		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining('/api/v1/ping'),
			expect.objectContaining({ method: 'GET' })
		);
	});
});
```

**Step 2: Run test to verify failure**

```bash
pnpm vitest run --project server src/lib/server/imessage-rs.spec.ts
```
Expected: FAIL (module not found)

**Step 3: Implement API client**

Create `src/lib/server/imessage-rs.ts`:

```ts
import type { ApiResponse, Chat, Message, Attachment, Handle, FindMyDevice, FindMyFriend } from '$lib/types/index.js';
import type { ChatQueryRequest, MessageQueryRequest, SendTextRequest, ReactRequest, CreateChatRequest } from '$lib/types/api.js';

export class ImessageClient {
	constructor(
		private baseUrl: string,
		private password: string
	) {}

	buildUrl(path: string): string {
		const url = new URL(path, this.baseUrl);
		url.searchParams.set('password', this.password);
		return url.toString();
	}

	async get<T>(path: string): Promise<ApiResponse<T>> {
		const res = await fetch(this.buildUrl(path), { method: 'GET' });
		if (!res.ok) throw new Error(`imessage-rs ${res.status}: ${res.statusText}`);
		return res.json();
	}

	async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
		const res = await fetch(this.buildUrl(path), {
			method: 'POST',
			headers: body ? { 'Content-Type': 'application/json' } : undefined,
			body: body ? JSON.stringify(body) : undefined
		});
		if (!res.ok) throw new Error(`imessage-rs ${res.status}: ${res.statusText}`);
		return res.json();
	}

	async put<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
		const res = await fetch(this.buildUrl(path), {
			method: 'PUT',
			headers: body ? { 'Content-Type': 'application/json' } : undefined,
			body: body ? JSON.stringify(body) : undefined
		});
		if (!res.ok) throw new Error(`imessage-rs ${res.status}: ${res.statusText}`);
		return res.json();
	}

	async delete<T>(path: string): Promise<ApiResponse<T>> {
		const res = await fetch(this.buildUrl(path), { method: 'DELETE' });
		if (!res.ok) throw new Error(`imessage-rs ${res.status}: ${res.statusText}`);
		return res.json();
	}

	/** Stream raw response (for attachment downloads) */
	async stream(path: string): Promise<Response> {
		const res = await fetch(this.buildUrl(path), { method: 'GET' });
		if (!res.ok) throw new Error(`imessage-rs ${res.status}: ${res.statusText}`);
		return res;
	}

	// === Convenience methods ===

	ping() {
		return this.get<string>('/api/v1/ping');
	}

	queryChats(query: ChatQueryRequest) {
		return this.post<Chat[]>('/api/v1/chat/query', query);
	}

	getChat(guid: string) {
		return this.get<Chat>(`/api/v1/chat/${encodeURIComponent(guid)}?with=participants,lastMessage`);
	}

	getChatMessages(guid: string, params: { limit?: number; offset?: number; sort?: string; before?: string; after?: string } = {}) {
		const query = new URLSearchParams();
		if (params.limit) query.set('limit', String(params.limit));
		if (params.offset) query.set('offset', String(params.offset));
		if (params.sort) query.set('sort', params.sort);
		if (params.before) query.set('before', params.before);
		if (params.after) query.set('after', params.after);
		query.set('with', 'attachment,attributedBody,messageSummaryInfo');
		const qs = query.toString() ? `?${query.toString()}` : '';
		return this.get<Message[]>(`/api/v1/chat/${encodeURIComponent(guid)}/message${qs}`);
	}

	queryMessages(query: MessageQueryRequest) {
		return this.post<Message[]>('/api/v1/message/query', query);
	}

	getMessage(guid: string) {
		return this.get<Message>(`/api/v1/message/${encodeURIComponent(guid)}`);
	}

	sendText(request: SendTextRequest) {
		return this.post<Message>('/api/v1/message/text', request);
	}

	react(request: ReactRequest) {
		return this.post<Message>('/api/v1/message/react', request);
	}

	editMessage(guid: string, newText: string, backwardsCompatMessage: string) {
		return this.post<Message>(`/api/v1/message/${encodeURIComponent(guid)}/edit`, {
			editedMessage: newText,
			backwardsCompatibilityMessage: backwardsCompatMessage,
			partIndex: 0
		});
	}

	unsendMessage(guid: string) {
		return this.post<Message>(`/api/v1/message/${encodeURIComponent(guid)}/unsend`, { partIndex: 0 });
	}

	createChat(request: CreateChatRequest) {
		return this.post<Chat>('/api/v1/chat/new', request);
	}

	deleteChat(guid: string) {
		return this.delete<void>(`/api/v1/chat/${encodeURIComponent(guid)}`);
	}

	markRead(guid: string) {
		return this.post<void>(`/api/v1/chat/${encodeURIComponent(guid)}/read`);
	}

	markUnread(guid: string) {
		return this.post<void>(`/api/v1/chat/${encodeURIComponent(guid)}/unread`);
	}

	startTyping(guid: string) {
		return this.post<void>(`/api/v1/chat/${encodeURIComponent(guid)}/typing`);
	}

	stopTyping(guid: string) {
		return this.delete<void>(`/api/v1/chat/${encodeURIComponent(guid)}/typing`);
	}

	downloadAttachment(guid: string) {
		return this.stream(`/api/v1/attachment/${encodeURIComponent(guid)}/download`);
	}

	getAttachmentInfo(guid: string) {
		return this.get<Attachment>(`/api/v1/attachment/${encodeURIComponent(guid)}`);
	}

	getContact(address: string) {
		return this.get<{ firstName: string; lastName: string; avatar: string | null }>(
			`/api/v1/icloud/contact?address=${encodeURIComponent(address)}`
		);
	}

	getDevices() {
		return this.get<FindMyDevice[]>('/api/v1/icloud/findmy/devices');
	}

	refreshDevices() {
		return this.post<void>('/api/v1/icloud/findmy/devices/refresh');
	}

	getFriends() {
		return this.get<FindMyFriend[]>('/api/v1/icloud/findmy/friends');
	}

	refreshFriends() {
		return this.post<void>('/api/v1/icloud/findmy/friends/refresh');
	}

	leaveChat(guid: string) {
		return this.post<void>(`/api/v1/chat/${encodeURIComponent(guid)}/leave`);
	}
}
```

**Step 4: Run test**

```bash
pnpm vitest run --project server src/lib/server/imessage-rs.spec.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/server/
git commit -m "feat: add imessage-rs API client"
```

---

## Phase 2: Server-Side Proxy & Real-Time

### Task 5: Auth middleware (Tailscale CGNAT check)

**Files:**
- Create: `src/lib/server/auth.ts`
- Create: `src/hooks.server.ts`
- Test: `src/lib/server/auth.spec.ts`

**Step 1: Write failing test**

Create `src/lib/server/auth.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isTailscaleIp, isAllowedIp } from './auth.js';

describe('auth', () => {
	it('allows Tailscale CGNAT IPs (100.64-127.x.x)', () => {
		expect(isTailscaleIp('100.64.0.1')).toBe(true);
		expect(isTailscaleIp('100.100.50.25')).toBe(true);
		expect(isTailscaleIp('100.127.255.255')).toBe(true);
	});

	it('rejects non-Tailscale IPs', () => {
		expect(isTailscaleIp('192.168.1.1')).toBe(false);
		expect(isTailscaleIp('10.0.0.1')).toBe(false);
		expect(isTailscaleIp('100.63.255.255')).toBe(false);
		expect(isTailscaleIp('100.128.0.0')).toBe(false);
	});

	it('allows localhost', () => {
		expect(isAllowedIp('127.0.0.1')).toBe(true);
		expect(isAllowedIp('::1')).toBe(true);
	});

	it('allows Tailscale IPs', () => {
		expect(isAllowedIp('100.100.50.25')).toBe(true);
	});

	it('rejects random IPs', () => {
		expect(isAllowedIp('8.8.8.8')).toBe(false);
	});
});
```

**Step 2: Run test to verify failure**

```bash
pnpm vitest run --project server src/lib/server/auth.spec.ts
```

**Step 3: Implement auth**

Create `src/lib/server/auth.ts`:

```ts
/**
 * Check if IP is in Tailscale CGNAT range (100.64.0.0/10).
 * This covers 100.64.0.0 - 100.127.255.255.
 */
export function isTailscaleIp(ip: string): boolean {
	const parts = ip.split('.').map(Number);
	if (parts.length !== 4) return false;
	return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

export function isAllowedIp(ip: string): boolean {
	if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
	return isTailscaleIp(ip);
}
```

**Step 4: Create hooks.server.ts**

Create `src/hooks.server.ts`:

```ts
import type { Handle } from '@sveltejs/kit';
import { isAllowedIp } from '$lib/server/auth.js';
import { error } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const ip = event.getClientAddress();
	event.locals.clientIp = ip;

	if (!isAllowedIp(ip)) {
		error(403, 'Access denied: not on Tailscale network');
	}

	return resolve(event);
};
```

**Step 5: Run test**

```bash
pnpm vitest run --project server src/lib/server/auth.spec.ts
```
Expected: PASS

**Step 6: Commit**

```bash
git add src/lib/server/auth.ts src/hooks.server.ts src/app.d.ts
git commit -m "feat: add Tailscale CGNAT auth middleware"
```

---

### Task 6: Catch-all API proxy route

**Files:**
- Create: `src/routes/api/proxy/[...path]/+server.ts`
- Test: `src/routes/api/proxy/proxy.spec.ts`

**Step 1: Write failing test**

Create `src/routes/api/proxy/proxy.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

describe('proxy route', () => {
	it('forwards GET requests to imessage-rs with password', async () => {
		// We test the URL construction logic
		const baseUrl = 'http://localhost:1234';
		const password = 'test-pw';
		const path = 'chat/query';

		const url = new URL(`/api/v1/${path}`, baseUrl);
		url.searchParams.set('password', password);

		expect(url.toString()).toBe('http://localhost:1234/api/v1/chat/query?password=test-pw');
	});

	it('preserves original query params', () => {
		const baseUrl = 'http://localhost:1234';
		const path = 'chat/guid123/message';
		const originalParams = new URLSearchParams('limit=50&sort=DESC');

		const url = new URL(`/api/v1/${path}`, baseUrl);
		originalParams.forEach((value, key) => url.searchParams.set(key, value));
		url.searchParams.set('password', 'pw');

		expect(url.searchParams.get('limit')).toBe('50');
		expect(url.searchParams.get('sort')).toBe('DESC');
		expect(url.searchParams.get('password')).toBe('pw');
	});
});
```

**Step 2: Run test to verify failure**

```bash
pnpm vitest run --project server src/routes/api/proxy/proxy.spec.ts
```

**Step 3: Implement proxy**

Create `src/routes/api/proxy/[...path]/+server.ts`:

```ts
import { IMESSAGE_RS_URL, IMESSAGE_RS_PASSWORD } from '$lib/server/env.js';
import type { RequestHandler } from './$types.js';

const handler: RequestHandler = async ({ params, request, url }) => {
	const targetUrl = new URL(`/api/v1/${params.path}`, IMESSAGE_RS_URL);

	// Preserve original query params
	url.searchParams.forEach((value, key) => {
		targetUrl.searchParams.set(key, value);
	});
	targetUrl.searchParams.set('password', IMESSAGE_RS_PASSWORD);

	const headers = new Headers();
	const contentType = request.headers.get('content-type');
	if (contentType) headers.set('content-type', contentType);

	const res = await fetch(targetUrl.toString(), {
		method: request.method,
		headers,
		body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
		// @ts-expect-error -- duplex needed for streaming body
		duplex: 'half'
	});

	return new Response(res.body, {
		status: res.status,
		headers: {
			'content-type': res.headers.get('content-type') ?? 'application/json'
		}
	});
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
```

**Step 4: Run test**

```bash
pnpm vitest run --project server src/routes/api/proxy/proxy.spec.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/routes/api/proxy/
git commit -m "feat: add catch-all API proxy to imessage-rs"
```

---

### Task 7: Webhook receiver and SSE broadcaster

**Files:**
- Create: `src/lib/server/events.ts`
- Create: `src/routes/api/webhook/+server.ts`
- Create: `src/routes/api/events/+server.ts`
- Test: `src/lib/server/events.spec.ts`

**Step 1: Write failing test**

Create `src/lib/server/events.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EventBroadcaster } from './events.js';

describe('EventBroadcaster', () => {
	it('adds and removes clients', () => {
		const broadcaster = new EventBroadcaster();
		const controller = new ReadableStreamDefaultController();

		// We can't easily mock ReadableStreamDefaultController,
		// so test the subscriber count tracking
		expect(broadcaster.clientCount).toBe(0);

		const id = broadcaster.addClient({ enqueue: () => {}, close: () => {} } as any);
		expect(broadcaster.clientCount).toBe(1);

		broadcaster.removeClient(id);
		expect(broadcaster.clientCount).toBe(0);
	});

	it('broadcasts to all clients', () => {
		const broadcaster = new EventBroadcaster();
		const received: string[] = [];

		const fakeController = {
			enqueue: (data: string) => received.push(data),
			close: () => {}
		};

		broadcaster.addClient(fakeController as any);
		broadcaster.broadcast({ type: 'new-message', data: { guid: 'test' } });

		expect(received.length).toBe(1);
		expect(received[0]).toContain('new-message');
	});
});
```

**Step 2: Run test to verify failure**

```bash
pnpm vitest run --project server src/lib/server/events.spec.ts
```

**Step 3: Implement EventBroadcaster**

Create `src/lib/server/events.ts`:

```ts
import type { WebhookEvent } from '$lib/types/index.js';

interface SSEClient {
	enqueue: (data: string) => void;
	close: () => void;
}

export class EventBroadcaster {
	private clients = new Map<number, SSEClient>();
	private nextId = 0;

	get clientCount() {
		return this.clients.size;
	}

	addClient(controller: SSEClient): number {
		const id = this.nextId++;
		this.clients.set(id, controller);
		return id;
	}

	removeClient(id: number) {
		this.clients.delete(id);
	}

	broadcast(event: WebhookEvent) {
		const data = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
		for (const [id, client] of this.clients) {
			try {
				client.enqueue(data);
			} catch {
				this.clients.delete(id);
			}
		}
	}
}

/** Singleton broadcaster shared across routes */
export const broadcaster = new EventBroadcaster();
```

**Step 4: Create webhook receiver**

Create `src/routes/api/webhook/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import { broadcaster } from '$lib/server/events.js';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ request }) => {
	const event = await request.json();
	broadcaster.broadcast(event);
	return json({ status: 200, message: 'OK' });
};
```

**Step 5: Create SSE endpoint**

Create `src/routes/api/events/+server.ts`:

```ts
import { broadcaster } from '$lib/server/events.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async () => {
	let clientId: number;

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();
			const client = {
				enqueue: (data: string) => controller.enqueue(encoder.encode(data)),
				close: () => controller.close()
			};
			clientId = broadcaster.addClient(client);

			// Send initial connection event
			controller.enqueue(encoder.encode('event: connected\ndata: {}\n\n'));
		},
		cancel() {
			broadcaster.removeClient(clientId);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
```

**Step 6: Run test**

```bash
pnpm vitest run --project server src/lib/server/events.spec.ts
```
Expected: PASS

**Step 7: Commit**

```bash
git add src/lib/server/events.ts src/routes/api/webhook/ src/routes/api/events/
git commit -m "feat: add webhook receiver and SSE broadcaster"
```

---

## Phase 3: Sync Engine

### Task 8: Data transform utilities (API → IndexedDB)

**Files:**
- Create: `src/lib/sync/transforms.ts`
- Test: `src/lib/sync/transforms.spec.ts`

**Step 1: Write failing test**

Create `src/lib/sync/transforms.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { chatToDb, messageToDb, handleToDb, attachmentToDb } from './transforms.js';
import type { Chat, Message, Handle, Attachment } from '$lib/types/index.js';

describe('transforms', () => {
	it('transforms Chat to DbChat', () => {
		const chat: Partial<Chat> = {
			guid: 'iMessage;-;+1234567890',
			chatIdentifier: '+1234567890',
			displayName: null,
			style: 45,
			isArchived: false,
			participants: [{ address: '+1234567890', service: 'iMessage', country: 'us', originalROWID: 1, uncanonicalizedId: null }],
			lastMessage: {
				dateCreated: 1700000000000,
				text: 'Hello'
			} as Message
		};

		const db = chatToDb(chat as Chat);
		expect(db.guid).toBe('iMessage;-;+1234567890');
		expect(db.lastMessageDate).toBe(1700000000000);
		expect(db.lastMessageText).toBe('Hello');
		expect(db.participants).toEqual(['+1234567890']);
		expect(db.isPinned).toBe(false);
		expect(db.unreadCount).toBe(0);
	});

	it('transforms Message to DbMessage', () => {
		const msg: Partial<Message> = {
			guid: 'msg-1',
			text: 'Hello',
			handleId: 1,
			handle: { address: '+1234567890', service: 'iMessage', country: 'us', originalROWID: 1, uncanonicalizedId: null },
			isFromMe: false,
			dateCreated: 1700000000000,
			dateRead: null,
			dateDelivered: 1700000000500,
			attachments: [],
			chats: [{ guid: 'iMessage;-;+1234567890' } as Chat],
			associatedMessageGuid: null,
			associatedMessageType: 0,
			threadOriginatorGuid: null,
			error: 0,
			isDelivered: true,
			dateEdited: null,
			dateRetracted: null,
			expressiveSendStyleId: null,
			subject: null,
			associatedMessageEmoji: null,
			groupTitle: null,
			groupActionType: 0,
			isSystemMessage: false,
			itemType: 0
		};

		const db = messageToDb(msg as Message);
		expect(db.guid).toBe('msg-1');
		expect(db.chatGuid).toBe('iMessage;-;+1234567890');
		expect(db.handleAddress).toBe('+1234567890');
		expect(db.attachmentGuids).toEqual([]);
	});
});
```

**Step 2: Run test to verify failure**

```bash
pnpm vitest run --project server src/lib/sync/transforms.spec.ts
```

**Step 3: Implement transforms**

Create `src/lib/sync/transforms.ts`:

```ts
import type { Chat, Message, Handle, Attachment } from '$lib/types/index.js';
import type { DbChat, DbMessage, DbHandle, DbAttachment } from '$lib/db/types.js';

export function chatToDb(chat: Chat): DbChat {
	return {
		guid: chat.guid,
		chatIdentifier: chat.chatIdentifier,
		displayName: chat.displayName,
		style: chat.style,
		lastMessageDate: chat.lastMessage?.dateCreated ?? 0,
		lastMessageText: chat.lastMessage?.text ?? null,
		isArchived: chat.isArchived,
		isPinned: false, // managed client-side
		unreadCount: 0, // computed from unread messages
		participants: chat.participants?.map((p) => p.address) ?? []
	};
}

export function messageToDb(msg: Message): DbMessage {
	return {
		guid: msg.guid,
		chatGuid: msg.chats?.[0]?.guid ?? '',
		text: msg.text,
		handleId: msg.handleId,
		handleAddress: msg.handle?.address ?? null,
		isFromMe: msg.isFromMe,
		dateCreated: msg.dateCreated,
		dateRead: msg.dateRead,
		dateDelivered: msg.dateDelivered,
		dateEdited: msg.dateEdited,
		dateRetracted: msg.dateRetracted,
		subject: msg.subject,
		associatedMessageGuid: msg.associatedMessageGuid,
		associatedMessageType: msg.associatedMessageType,
		associatedMessageEmoji: msg.associatedMessageEmoji,
		threadOriginatorGuid: msg.threadOriginatorGuid,
		attachmentGuids: msg.attachments?.map((a) => a.guid) ?? [],
		error: msg.error,
		expressiveSendStyleId: msg.expressiveSendStyleId,
		isDelivered: msg.isDelivered,
		groupTitle: msg.groupTitle,
		groupActionType: msg.groupActionType,
		isSystemMessage: msg.isSystemMessage,
		itemType: msg.itemType
	};
}

export function handleToDb(handle: Handle): DbHandle {
	return {
		address: handle.address,
		service: handle.service,
		country: handle.country,
		displayName: null,
		avatarBase64: null
	};
}

export function attachmentToDb(attachment: Attachment, messageGuid: string): DbAttachment {
	return {
		guid: attachment.guid,
		messageGuid,
		mimeType: attachment.mimeType,
		transferName: attachment.transferName,
		totalBytes: attachment.totalBytes,
		width: attachment.width,
		height: attachment.height,
		hasLivePhoto: attachment.hasLivePhoto,
		blurhash: null,
		isSticker: attachment.isSticker
	};
}
```

**Step 4: Run test**

```bash
pnpm vitest run --project server src/lib/sync/transforms.spec.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/sync/
git commit -m "feat: add API-to-IndexedDB data transforms"
```

---

### Task 9: Client-side sync engine

**Files:**
- Create: `src/lib/sync/engine.ts`
- Create: `src/lib/sync/sse.ts`

This task creates the browser-side sync engine that:
1. Does initial sync on first load
2. Connects to SSE for real-time updates
3. Applies incoming events to IndexedDB

**Step 1: Create SSE client**

Create `src/lib/sync/sse.ts`:

```ts
export type SSEEventHandler = (type: string, data: unknown) => void;

export class SSEClient {
	private source: EventSource | null = null;
	private handlers: SSEEventHandler[] = [];

	connect(url: string) {
		this.disconnect();
		this.source = new EventSource(url);

		this.source.onopen = () => {
			console.log('[SSE] Connected');
		};

		this.source.onerror = () => {
			console.warn('[SSE] Connection error, will auto-reconnect');
		};

		// Listen for all named events
		const eventTypes = [
			'new-message',
			'updated-message',
			'typing-indicator',
			'chat-read-status-changed',
			'group-name-change',
			'participant-added',
			'participant-removed',
			'participant-left'
		];

		for (const type of eventTypes) {
			this.source.addEventListener(type, (e) => {
				const data = JSON.parse((e as MessageEvent).data);
				for (const handler of this.handlers) {
					handler(type, data);
				}
			});
		}
	}

	onEvent(handler: SSEEventHandler) {
		this.handlers.push(handler);
	}

	disconnect() {
		this.source?.close();
		this.source = null;
	}
}
```

**Step 2: Create sync engine**

Create `src/lib/sync/engine.ts`:

```ts
import { db } from '$lib/db/index.js';
import { chatToDb, messageToDb, handleToDb, attachmentToDb } from './transforms.js';
import { SSEClient } from './sse.js';
import type { Chat, Message } from '$lib/types/index.js';

const MESSAGES_PER_CHAT = 50;

export class SyncEngine {
	private sse = new SSEClient();
	private _syncing = $state(false);
	private _connected = $state(false);
	private _typingIndicators = $state<Map<string, boolean>>(new Map());

	get syncing() {
		return this._syncing;
	}
	get connected() {
		return this._connected;
	}
	get typingIndicators() {
		return this._typingIndicators;
	}

	async start() {
		// Connect SSE
		this.sse.connect('/api/events');
		this.sse.onEvent((type, data) => this.handleEvent(type, data));
		this._connected = true;

		// Check if we need initial or incremental sync
		const lastSync = await db.syncMeta.get('lastSyncTimestamp');
		if (lastSync) {
			await this.incrementalSync(lastSync.value);
		} else {
			await this.initialSync();
		}
	}

	stop() {
		this.sse.disconnect();
		this._connected = false;
	}

	private async initialSync() {
		this._syncing = true;
		try {
			// Fetch all chats
			const chatsRes = await fetch('/api/proxy/chat/query', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					with: ['lastMessage', 'participants'],
					sort: 'lastMessage',
					limit: 1000
				})
			});
			const chatsData = await chatsRes.json();
			const chats: Chat[] = chatsData.data;

			// Store chats and handles
			await db.transaction('rw', [db.chats, db.handles, db.messages, db.attachments], async () => {
				for (const chat of chats) {
					await db.chats.put(chatToDb(chat));
					for (const participant of chat.participants ?? []) {
						await db.handles.put(handleToDb(participant));
					}
				}
			});

			// Fetch recent messages for each chat
			for (const chat of chats) {
				const msgsRes = await fetch(
					`/api/proxy/chat/${encodeURIComponent(chat.guid)}/message?limit=${MESSAGES_PER_CHAT}&sort=DESC&with=attachment,attributedBody,messageSummaryInfo`
				);
				const msgsData = await msgsRes.json();
				const messages: Message[] = msgsData.data ?? [];

				await db.transaction('rw', [db.messages, db.attachments], async () => {
					for (const msg of messages) {
						await db.messages.put(messageToDb(msg));
						for (const att of msg.attachments ?? []) {
							await db.attachments.put(attachmentToDb(att, msg.guid));
						}
					}
				});
			}

			await db.syncMeta.put({ key: 'lastSyncTimestamp', value: String(Date.now()) });
		} finally {
			this._syncing = false;
		}
	}

	private async incrementalSync(since: string) {
		this._syncing = true;
		try {
			const res = await fetch('/api/proxy/message/query', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					with: ['attachment', 'attributedBody', 'chat.participants'],
					sort: 'DESC',
					after: since,
					limit: 1000
				})
			});
			const data = await res.json();
			const messages: Message[] = data.data ?? [];

			await db.transaction('rw', [db.messages, db.attachments, db.chats], async () => {
				for (const msg of messages) {
					await db.messages.put(messageToDb(msg));
					for (const att of msg.attachments ?? []) {
						await db.attachments.put(attachmentToDb(att, msg.guid));
					}
				}
			});

			// Re-fetch chat list to update lastMessage, unread counts
			const chatsRes = await fetch('/api/proxy/chat/query', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					with: ['lastMessage', 'participants'],
					sort: 'lastMessage',
					limit: 1000
				})
			});
			const chatsData = await chatsRes.json();
			for (const chat of chatsData.data ?? []) {
				const existing = await db.chats.get(chat.guid);
				await db.chats.put({
					...chatToDb(chat),
					isPinned: existing?.isPinned ?? false
				});
			}

			await db.syncMeta.put({ key: 'lastSyncTimestamp', value: String(Date.now()) });
		} finally {
			this._syncing = false;
		}
	}

	private async handleEvent(type: string, data: unknown) {
		switch (type) {
			case 'new-message': {
				const msg = data as Message;
				await db.messages.put(messageToDb(msg));
				for (const att of msg.attachments ?? []) {
					await db.attachments.put(attachmentToDb(att, msg.guid));
				}
				// Update chat's last message
				const chatGuid = msg.chats?.[0]?.guid;
				if (chatGuid) {
					const chat = await db.chats.get(chatGuid);
					if (chat) {
						await db.chats.update(chatGuid, {
							lastMessageDate: msg.dateCreated,
							lastMessageText: msg.text,
							unreadCount: msg.isFromMe ? chat.unreadCount : chat.unreadCount + 1
						});
					}
				}
				break;
			}
			case 'updated-message': {
				const msg = data as Message;
				await db.messages.put(messageToDb(msg));
				break;
			}
			case 'typing-indicator': {
				const indicator = data as { chatGuid: string; display: boolean };
				this._typingIndicators = new Map(this._typingIndicators);
				if (indicator.display) {
					this._typingIndicators.set(indicator.chatGuid, true);
				} else {
					this._typingIndicators.delete(indicator.chatGuid);
				}
				break;
			}
			case 'chat-read-status-changed': {
				const chatData = data as { chatGuid: string };
				await db.chats.update(chatData.chatGuid, { unreadCount: 0 });
				break;
			}
		}
	}

	async loadOlderMessages(chatGuid: string, beforeDate: number): Promise<number> {
		const res = await fetch(
			`/api/proxy/chat/${encodeURIComponent(chatGuid)}/message?limit=${MESSAGES_PER_CHAT}&sort=DESC&before=${beforeDate}&with=attachment,attributedBody,messageSummaryInfo`
		);
		const data = await res.json();
		const messages: Message[] = data.data ?? [];

		await db.transaction('rw', [db.messages, db.attachments], async () => {
			for (const msg of messages) {
				await db.messages.put(messageToDb(msg));
				for (const att of msg.attachments ?? []) {
					await db.attachments.put(attachmentToDb(att, msg.guid));
				}
			}
		});

		return messages.length;
	}
}
```

**Step 3: Commit**

```bash
git add src/lib/sync/
git commit -m "feat: add client-side sync engine with SSE"
```

---

## Phase 4: Messages UI — Core

### Task 10: App shell with mode toggle and routing

**Files:**
- Modify: `src/routes/+layout.svelte`
- Create: `src/routes/+page.server.ts`
- Create: `src/routes/messages/+layout.svelte`
- Create: `src/routes/messages/+page.svelte`
- Create: `src/routes/findmy/+page.svelte`
- Create: `src/lib/components/ModeToggle.svelte`
- Modify: `src/routes/layout.css`

This task sets up the app shell: mode toggle at top, routing for /messages and /findmy.

**Step 1: Create redirect**

Create `src/routes/+page.server.ts`:

```ts
import { redirect } from '@sveltejs/kit';

export function load() {
	redirect(307, '/messages');
}
```

**Step 2: Create ModeToggle component**

Create `src/lib/components/ModeToggle.svelte`:

```svelte
<script lang="ts">
	import { page } from '$app/state';

	const isMessages = $derived(page.url.pathname.startsWith('/messages'));
</script>

<nav class="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
	<a
		href="/messages"
		class="rounded-md px-4 py-1.5 text-sm font-medium transition-colors {isMessages
			? 'bg-white shadow-sm dark:bg-gray-700 dark:text-white'
			: 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}"
	>
		Messages
	</a>
	<a
		href="/findmy"
		class="rounded-md px-4 py-1.5 text-sm font-medium transition-colors {!isMessages
			? 'bg-white shadow-sm dark:bg-gray-700 dark:text-white'
			: 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}"
	>
		Find My
	</a>
</nav>
```

**Step 3: Update root layout**

Update `src/routes/+layout.svelte`:

```svelte
<script lang="ts">
	import './layout.css';
	import ModeToggle from '$lib/components/ModeToggle.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<title>webMessages</title>
</svelte:head>

<div class="flex h-screen flex-col bg-white dark:bg-gray-900">
	<header class="flex items-center justify-center border-b border-gray-200 px-4 py-2 dark:border-gray-700">
		<ModeToggle />
	</header>
	<main class="flex min-h-0 flex-1">
		{@render children()}
	</main>
</div>
```

**Step 4: Create messages layout (sidebar + main)**

Create `src/routes/messages/+layout.svelte`:

```svelte
<script lang="ts">
	let { children } = $props();
</script>

<div class="flex h-full w-full">
	<!-- Sidebar placeholder -->
	<aside class="flex w-80 flex-col border-r border-gray-200 dark:border-gray-700">
		<div class="p-4 text-sm text-gray-500">Chat list will go here</div>
	</aside>

	<!-- Main content -->
	<div class="flex flex-1 flex-col">
		{@render children()}
	</div>
</div>
```

**Step 5: Create messages page (empty state)**

Create `src/routes/messages/+page.svelte`:

```svelte
<div class="flex flex-1 items-center justify-center text-gray-400">
	<p>Select a conversation to start messaging</p>
</div>
```

**Step 6: Create findmy placeholder**

Create `src/routes/findmy/+page.svelte`:

```svelte
<div class="flex flex-1 items-center justify-center text-gray-400">
	<p>Find My — coming soon</p>
</div>
```

**Step 7: Update layout.css for dark mode and base styles**

Update `src/routes/layout.css`:

```css
@import 'tailwindcss';
@plugin '@tailwindcss/typography';

html,
body {
	height: 100%;
	margin: 0;
	overflow: hidden;
}

@media (prefers-color-scheme: dark) {
	:root {
		color-scheme: dark;
	}
}
```

**Step 8: Verify dev server runs**

```bash
pnpm dev
```
Navigate to http://localhost:5173 — should redirect to /messages, show mode toggle and sidebar placeholder.

**Step 9: Commit**

```bash
git add src/routes/ src/lib/components/
git commit -m "feat: add app shell with mode toggle and routing"
```

---

### Task 11: ChatList component with Dexie liveQuery

**Files:**
- Create: `src/lib/components/ChatList.svelte`
- Create: `src/lib/components/ChatListItem.svelte`
- Create: `src/lib/components/ContactAvatar.svelte`
- Create: `src/lib/utils/format.ts`
- Modify: `src/routes/messages/+layout.svelte`
- Test: `src/lib/utils/format.spec.ts`

**Step 1: Write format utilities test**

Create `src/lib/utils/format.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatRelativeTime, formatPhoneNumber } from './format.js';

describe('formatRelativeTime', () => {
	it('shows "now" for very recent times', () => {
		expect(formatRelativeTime(Date.now() - 5000)).toBe('now');
	});

	it('shows minutes for under an hour', () => {
		expect(formatRelativeTime(Date.now() - 5 * 60 * 1000)).toBe('5m');
	});

	it('shows hours for under a day', () => {
		expect(formatRelativeTime(Date.now() - 3 * 60 * 60 * 1000)).toBe('3h');
	});
});

describe('formatPhoneNumber', () => {
	it('formats US numbers', () => {
		expect(formatPhoneNumber('+11234567890')).toBe('(123) 456-7890');
	});

	it('returns original for non-US', () => {
		expect(formatPhoneNumber('+442012345678')).toBe('+442012345678');
	});

	it('returns original for emails', () => {
		expect(formatPhoneNumber('user@example.com')).toBe('user@example.com');
	});
});
```

**Step 2: Run test to verify failure**

```bash
pnpm vitest run --project server src/lib/utils/format.spec.ts
```

**Step 3: Implement format utilities**

Create `src/lib/utils/format.ts`:

```ts
export function formatRelativeTime(timestamp: number): string {
	const diff = Date.now() - timestamp;
	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (seconds < 60) return 'now';
	if (minutes < 60) return `${minutes}m`;
	if (hours < 24) return `${hours}h`;
	if (days < 7) return `${days}d`;

	return new Date(timestamp).toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric'
	});
}

export function formatPhoneNumber(address: string): string {
	if (address.includes('@')) return address;

	// US format: +1XXXXXXXXXX → (XXX) XXX-XXXX
	const usMatch = address.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
	if (usMatch) return `(${usMatch[1]}) ${usMatch[2]}-${usMatch[3]}`;

	return address;
}

export function getChatDisplayName(
	displayName: string | null,
	participants: string[],
	handles: Map<string, string | null>
): string {
	if (displayName) return displayName;
	if (participants.length === 0) return 'Unknown';

	return participants
		.map((addr) => handles.get(addr) ?? formatPhoneNumber(addr))
		.join(', ');
}
```

**Step 4: Run test**

```bash
pnpm vitest run --project server src/lib/utils/format.spec.ts
```
Expected: PASS

**Step 5: Create ContactAvatar**

Create `src/lib/components/ContactAvatar.svelte`:

```svelte
<script lang="ts">
	interface Props {
		name: string;
		avatar?: string | null;
		size?: 'sm' | 'md' | 'lg';
	}

	let { name, avatar = null, size = 'md' }: Props = $props();

	const sizes = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-12 w-12 text-base' };
	const initials = $derived(
		name
			.split(/[\s,]+/)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase() ?? '')
			.join('')
	);
</script>

{#if avatar}
	<img src={avatar} alt={name} class="rounded-full object-cover {sizes[size]}" />
{:else}
	<div
		class="flex shrink-0 items-center justify-center rounded-full bg-gray-300 font-medium text-gray-600 dark:bg-gray-600 dark:text-gray-300 {sizes[size]}"
	>
		{initials || '?'}
	</div>
{/if}
```

**Step 6: Create ChatListItem**

Create `src/lib/components/ChatListItem.svelte`:

```svelte
<script lang="ts">
	import ContactAvatar from './ContactAvatar.svelte';
	import { formatRelativeTime } from '$lib/utils/format.js';

	interface Props {
		guid: string;
		displayName: string;
		lastMessage: string | null;
		lastMessageDate: number;
		unreadCount: number;
		isActive: boolean;
		avatar?: string | null;
	}

	let { guid, displayName, lastMessage, lastMessageDate, unreadCount, isActive, avatar = null }: Props = $props();
</script>

<a
	href="/messages/{encodeURIComponent(guid)}"
	class="flex gap-3 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800
		{isActive ? 'bg-blue-50 dark:bg-blue-900/20' : ''}"
>
	<ContactAvatar name={displayName} {avatar} />
	<div class="flex min-w-0 flex-1 flex-col">
		<div class="flex items-center justify-between">
			<span class="truncate text-sm font-medium dark:text-white">{displayName}</span>
			<span class="shrink-0 text-xs text-gray-400">{formatRelativeTime(lastMessageDate)}</span>
		</div>
		<div class="flex items-center justify-between">
			<span class="truncate text-xs text-gray-500 dark:text-gray-400">{lastMessage ?? ''}</span>
			{#if unreadCount > 0}
				<span class="ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">
					{unreadCount > 99 ? '99+' : unreadCount}
				</span>
			{/if}
		</div>
	</div>
</a>
```

**Step 7: Create ChatList**

Create `src/lib/components/ChatList.svelte`:

```svelte
<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db } from '$lib/db/index.js';
	import { page } from '$app/state';
	import ChatListItem from './ChatListItem.svelte';
	import { getChatDisplayName } from '$lib/utils/format.js';
	import type { DbChat, DbHandle } from '$lib/db/types.js';

	let search = $state('');

	// Live query for chats ordered by lastMessageDate, pinned first
	const chats = liveQuery(() =>
		db.chats.orderBy('lastMessageDate').reverse().toArray()
	);

	const handles = liveQuery(() => db.handles.toArray());

	const handleMap = $derived(
		new Map(($handles ?? []).map((h: DbHandle) => [h.address, h.displayName]))
	);

	const sortedChats = $derived(() => {
		const all = $chats ?? [];
		const filtered = search
			? all.filter((c: DbChat) => {
					const name = getChatDisplayName(c.displayName, c.participants, handleMap);
					return name.toLowerCase().includes(search.toLowerCase());
				})
			: all;

		// Pinned first, then by date
		return [...filtered].sort((a: DbChat, b: DbChat) => {
			if (a.isPinned && !b.isPinned) return -1;
			if (!a.isPinned && b.isPinned) return 1;
			return b.lastMessageDate - a.lastMessageDate;
		});
	});

	const activeChatGuid = $derived(
		page.url.pathname.startsWith('/messages/')
			? decodeURIComponent(page.url.pathname.split('/messages/')[1] ?? '')
			: ''
	);
</script>

<div class="flex h-full flex-col">
	<!-- Search -->
	<div class="p-3">
		<input
			bind:value={search}
			type="text"
			placeholder="Search conversations..."
			class="w-full rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
		/>
	</div>

	<!-- Chat list -->
	<div class="flex-1 overflow-y-auto">
		{#each sortedChats() as chat (chat.guid)}
			<ChatListItem
				guid={chat.guid}
				displayName={getChatDisplayName(chat.displayName, chat.participants, handleMap)}
				lastMessage={chat.lastMessageText}
				lastMessageDate={chat.lastMessageDate}
				unreadCount={chat.unreadCount}
				isActive={chat.guid === activeChatGuid}
			/>
		{:else}
			<p class="p-4 text-center text-sm text-gray-400">No conversations</p>
		{/each}
	</div>
</div>
```

**Step 8: Update messages layout to use ChatList**

Update `src/routes/messages/+layout.svelte`:

```svelte
<script lang="ts">
	import ChatList from '$lib/components/ChatList.svelte';

	let { children } = $props();
</script>

<div class="flex h-full w-full">
	<aside class="flex w-80 flex-col border-r border-gray-200 dark:border-gray-700">
		<ChatList />
	</aside>
	<div class="flex flex-1 flex-col">
		{@render children()}
	</div>
</div>
```

**Step 9: Commit**

```bash
git add src/lib/components/ src/lib/utils/ src/routes/messages/
git commit -m "feat: add ChatList with Dexie liveQuery, search, and pinning"
```

---

### Task 12: ChatView and MessageBubble components

**Files:**
- Create: `src/routes/messages/[chatGuid]/+page.svelte`
- Create: `src/lib/components/ChatView.svelte`
- Create: `src/lib/components/MessageBubble.svelte`
- Create: `src/lib/components/MessageInput.svelte`

**Step 1: Create MessageBubble**

Create `src/lib/components/MessageBubble.svelte`:

```svelte
<script lang="ts">
	import type { DbMessage, DbAttachment } from '$lib/db/types.js';
	import { formatRelativeTime } from '$lib/utils/format.js';

	interface Props {
		message: DbMessage;
		attachments: DbAttachment[];
		senderName?: string;
		showSender?: boolean;
	}

	let { message, attachments, senderName = '', showSender = false }: Props = $props();

	const isRetracted = $derived(message.dateRetracted !== null);
	const isEdited = $derived(message.dateEdited !== null);
</script>

<div class="flex px-4 py-0.5 {message.isFromMe ? 'justify-end' : 'justify-start'}">
	<div class="max-w-[70%]">
		{#if showSender && !message.isFromMe}
			<p class="mb-0.5 text-xs text-gray-500">{senderName}</p>
		{/if}

		<div
			class="rounded-2xl px-3 py-2 {message.isFromMe
				? 'bg-blue-500 text-white'
				: 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-white'}"
		>
			{#if isRetracted}
				<p class="text-sm italic opacity-60">Message unsent</p>
			{:else}
				<!-- Attachments -->
				{#each attachments as att}
					{#if att.mimeType?.startsWith('image/')}
						<a href="/api/proxy/attachment/{encodeURIComponent(att.guid)}/download" target="_blank" class="block">
							<img
								src="/api/proxy/attachment/{encodeURIComponent(att.guid)}/download?height=300"
								alt={att.transferName ?? 'Image'}
								class="max-h-64 rounded-lg"
								loading="lazy"
							/>
						</a>
					{:else if att.mimeType?.startsWith('video/')}
						<video controls class="max-h-64 rounded-lg" preload="metadata">
							<source src="/api/proxy/attachment/{encodeURIComponent(att.guid)}/download" type={att.mimeType} />
							<track kind="captions" />
						</video>
					{:else if att.transferName}
						<a
							href="/api/proxy/attachment/{encodeURIComponent(att.guid)}/download"
							target="_blank"
							class="flex items-center gap-2 rounded-lg bg-black/10 px-3 py-2 text-sm hover:bg-black/20"
							download={att.transferName}
						>
							<span>📎</span>
							<span class="truncate">{att.transferName}</span>
						</a>
					{/if}
				{/each}

				{#if message.text}
					<p class="whitespace-pre-wrap break-words text-sm">{message.text}</p>
				{/if}

				{#if isEdited}
					<p class="mt-0.5 text-[10px] opacity-50">Edited</p>
				{/if}
			{/if}
		</div>

		<!-- Status indicators -->
		{#if message.isFromMe}
			<p class="mt-0.5 text-right text-[10px] text-gray-400">
				{#if message.dateRead}
					Read
				{:else if message.isDelivered}
					Delivered
				{:else if message.error}
					<span class="text-red-400">Not delivered</span>
				{:else}
					Sent
				{/if}
			</p>
		{/if}
	</div>
</div>
```

**Step 2: Create MessageInput**

Create `src/lib/components/MessageInput.svelte`:

```svelte
<script lang="ts">
	interface Props {
		chatGuid: string;
		onSend: (text: string) => Promise<void>;
		onTypingStart: () => void;
		onTypingStop: () => void;
	}

	let { chatGuid, onSend, onTypingStart, onTypingStop }: Props = $props();

	let text = $state('');
	let sending = $state(false);
	let typingTimeout: ReturnType<typeof setTimeout> | null = null;
	let isTyping = $state(false);

	function handleInput() {
		if (!isTyping) {
			isTyping = true;
			onTypingStart();
		}
		if (typingTimeout) clearTimeout(typingTimeout);
		typingTimeout = setTimeout(() => {
			isTyping = false;
			onTypingStop();
		}, 3000);
	}

	async function handleSend() {
		const trimmed = text.trim();
		if (!trimmed || sending) return;

		sending = true;
		try {
			await onSend(trimmed);
			text = '';
			if (isTyping) {
				isTyping = false;
				onTypingStop();
			}
		} finally {
			sending = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	}
</script>

<div class="border-t border-gray-200 p-3 dark:border-gray-700">
	<div class="flex items-end gap-2">
		<textarea
			bind:value={text}
			oninput={handleInput}
			onkeydown={handleKeydown}
			placeholder="Message"
			rows="1"
			class="flex-1 resize-none rounded-2xl bg-gray-100 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
		></textarea>
		<button
			onclick={handleSend}
			disabled={!text.trim() || sending}
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white transition-opacity disabled:opacity-30"
		>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
				<path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95l14.095-5.146a.75.75 0 0 0 0-1.413L3.105 2.289Z" />
			</svg>
		</button>
	</div>
</div>
```

**Step 3: Create ChatView**

Create `src/lib/components/ChatView.svelte`:

```svelte
<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db } from '$lib/db/index.js';
	import MessageBubble from './MessageBubble.svelte';
	import MessageInput from './MessageInput.svelte';
	import { getChatDisplayName } from '$lib/utils/format.js';
	import type { DbMessage, DbAttachment, DbHandle } from '$lib/db/types.js';

	interface Props {
		chatGuid: string;
		syncEngine: { loadOlderMessages: (guid: string, before: number) => Promise<number>; typingIndicators: Map<string, boolean> };
	}

	let { chatGuid, syncEngine }: Props = $props();

	let messagesContainer: HTMLDivElement | undefined = $state();
	let loadingOlder = $state(false);
	let hasMoreMessages = $state(true);

	const chat = liveQuery(() => db.chats.get(chatGuid));

	const messages = liveQuery(() =>
		db.messages
			.where('chatGuid')
			.equals(chatGuid)
			.and((m: DbMessage) => m.associatedMessageType === 0) // exclude reactions
			.sortBy('dateCreated')
	);

	const reactions = liveQuery(() =>
		db.messages
			.where('chatGuid')
			.equals(chatGuid)
			.and((m: DbMessage) => m.associatedMessageType !== 0)
			.toArray()
	);

	const attachments = liveQuery(() => db.attachments.toArray());

	const handles = liveQuery(() => db.handles.toArray());

	const handleMap = $derived(
		new Map(($handles ?? []).map((h: DbHandle) => [h.address, h.displayName ?? h.address]))
	);

	const attachmentMap = $derived(() => {
		const map = new Map<string, DbAttachment[]>();
		for (const att of $attachments ?? []) {
			const list = map.get(att.messageGuid) ?? [];
			list.push(att);
			map.set(att.messageGuid, list);
		}
		return map;
	});

	const displayName = $derived(
		$chat
			? getChatDisplayName($chat.displayName, $chat.participants, new Map(
				($handles ?? []).map((h: DbHandle) => [h.address, h.displayName])
			))
			: 'Loading...'
	);

	const isGroupChat = $derived($chat?.style === 43);
	const isTyping = $derived(syncEngine.typingIndicators.get(chatGuid) ?? false);

	// Auto-scroll to bottom on new messages
	$effect(() => {
		if ($messages && messagesContainer) {
			const el = messagesContainer;
			// Only auto-scroll if near bottom
			const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
			if (isNearBottom) {
				requestAnimationFrame(() => {
					el.scrollTop = el.scrollHeight;
				});
			}
		}
	});

	async function handleScroll() {
		if (!messagesContainer || loadingOlder || !hasMoreMessages) return;
		if (messagesContainer.scrollTop < 200) {
			const msgs = $messages ?? [];
			if (msgs.length === 0) return;
			const oldest = msgs[0];
			loadingOlder = true;
			const count = await syncEngine.loadOlderMessages(chatGuid, oldest.dateCreated);
			hasMoreMessages = count > 0;
			loadingOlder = false;
		}
	}

	async function handleSend(text: string) {
		await fetch('/api/proxy/message/text', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				chatGuid,
				message: text,
				method: 'private-api'
			})
		});
	}

	function handleTypingStart() {
		fetch(`/api/proxy/chat/${encodeURIComponent(chatGuid)}/typing`, { method: 'POST' });
	}

	function handleTypingStop() {
		fetch(`/api/proxy/chat/${encodeURIComponent(chatGuid)}/typing`, { method: 'DELETE' });
	}

	// Mark as read when viewing
	$effect(() => {
		if ($chat && $chat.unreadCount > 0) {
			fetch(`/api/proxy/chat/${encodeURIComponent(chatGuid)}/read`, { method: 'POST' });
			db.chats.update(chatGuid, { unreadCount: 0 });
		}
	});
</script>

<div class="flex h-full flex-col">
	<!-- Header -->
	<div class="flex items-center border-b border-gray-200 px-4 py-3 dark:border-gray-700">
		<h2 class="text-sm font-semibold dark:text-white">{displayName}</h2>
	</div>

	<!-- Messages -->
	<div
		bind:this={messagesContainer}
		onscroll={handleScroll}
		class="flex flex-1 flex-col gap-0.5 overflow-y-auto py-2"
	>
		{#if loadingOlder}
			<p class="text-center text-xs text-gray-400">Loading older messages...</p>
		{/if}

		{#each $messages ?? [] as message (message.guid)}
			<MessageBubble
				{message}
				attachments={attachmentMap().get(message.guid) ?? []}
				senderName={handleMap.get(message.handleAddress ?? '') ?? ''}
				showSender={isGroupChat}
			/>
		{/each}

		{#if isTyping}
			<div class="flex px-4 py-1">
				<div class="rounded-2xl bg-gray-200 px-3 py-2 dark:bg-gray-700">
					<span class="text-sm text-gray-500">typing...</span>
				</div>
			</div>
		{/if}
	</div>

	<!-- Input -->
	<MessageInput {chatGuid} onSend={handleSend} onTypingStart={handleTypingStart} onTypingStop={handleTypingStop} />
</div>
```

**Step 4: Create chat page route**

Create `src/routes/messages/[chatGuid]/+page.svelte`:

```svelte
<script lang="ts">
	import { page } from '$app/state';
	import ChatView from '$lib/components/ChatView.svelte';
	import { getContext } from 'svelte';

	const chatGuid = $derived(decodeURIComponent(page.params.chatGuid));

	// SyncEngine will be provided via context in the root layout
	const syncEngine = getContext<any>('syncEngine');
</script>

{#key chatGuid}
	<ChatView {chatGuid} {syncEngine} />
{/key}
```

**Step 5: Commit**

```bash
git add src/lib/components/ src/routes/messages/
git commit -m "feat: add ChatView, MessageBubble, and MessageInput components"
```

---

### Task 13: Initialize sync engine in root layout

**Files:**
- Modify: `src/routes/+layout.svelte`
- Create: `src/lib/stores/sync.ts`

**Step 1: Create sync store**

Create `src/lib/stores/sync.ts`:

```ts
import { SyncEngine } from '$lib/sync/engine.js';

export const syncEngine = new SyncEngine();
```

**Step 2: Update root layout to start sync and provide context**

Update `src/routes/+layout.svelte`:

```svelte
<script lang="ts">
	import './layout.css';
	import { onMount, setContext } from 'svelte';
	import ModeToggle from '$lib/components/ModeToggle.svelte';
	import { syncEngine } from '$lib/stores/sync.js';

	let { children } = $props();

	setContext('syncEngine', syncEngine);

	onMount(() => {
		syncEngine.start();
		return () => syncEngine.stop();
	});
</script>

<svelte:head>
	<title>webMessages</title>
</svelte:head>

<div class="flex h-screen flex-col bg-white dark:bg-gray-900">
	<header class="flex items-center justify-center border-b border-gray-200 px-4 py-2 dark:border-gray-700">
		<ModeToggle />
		{#if syncEngine.syncing}
			<span class="ml-2 text-xs text-gray-400">Syncing...</span>
		{/if}
	</header>
	<main class="flex min-h-0 flex-1">
		{@render children()}
	</main>
</div>
```

**Step 3: Commit**

```bash
git add src/lib/stores/ src/routes/+layout.svelte
git commit -m "feat: initialize sync engine in root layout"
```

---

## Phase 5: Messages Features

### Task 14: Reactions (view and send)

**Files:**
- Create: `src/lib/components/ReactionPicker.svelte`
- Create: `src/lib/components/ReactionBadge.svelte`
- Modify: `src/lib/components/MessageBubble.svelte`

**Step 1: Create ReactionBadge**

Create `src/lib/components/ReactionBadge.svelte`:

```svelte
<script lang="ts">
	interface Props {
		reactions: { emoji: string; count: number; fromMe: boolean }[];
	}

	let { reactions }: Props = $props();
</script>

{#if reactions.length > 0}
	<div class="mt-0.5 flex gap-1">
		{#each reactions as r}
			<span
				class="inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs
					{r.fromMe ? 'border-blue-300 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/30' : 'border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-800'}"
			>
				{r.emoji}
				{#if r.count > 1}<span class="text-gray-500">{r.count}</span>{/if}
			</span>
		{/each}
	</div>
{/if}
```

**Step 2: Create ReactionPicker**

Create `src/lib/components/ReactionPicker.svelte`:

```svelte
<script lang="ts">
	interface Props {
		onReact: (reaction: string) => void;
	}

	let { onReact }: Props = $props();

	const tapbacks = [
		{ reaction: 'love', emoji: '❤️' },
		{ reaction: 'like', emoji: '👍' },
		{ reaction: 'dislike', emoji: '👎' },
		{ reaction: 'laugh', emoji: '😂' },
		{ reaction: 'emphasize', emoji: '‼️' },
		{ reaction: 'question', emoji: '❓' }
	];
</script>

<div class="flex gap-1 rounded-full bg-white px-2 py-1 shadow-lg ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-600">
	{#each tapbacks as tb}
		<button
			onclick={() => onReact(tb.reaction)}
			class="rounded-full p-1.5 text-lg transition-transform hover:scale-125"
		>
			{tb.emoji}
		</button>
	{/each}
</div>
```

**Step 3: Update MessageBubble to show reactions and reaction picker on hover**

Update `src/lib/components/MessageBubble.svelte` to add:
- A `reactions` prop (array of reaction messages)
- Hover state to show reaction picker
- ReactionBadge below the bubble

The full updated component integrates ReactionBadge and ReactionPicker. On double-click or long-press, show the reaction picker. Show aggregated reactions below each message.

**Step 4: Commit**

```bash
git add src/lib/components/
git commit -m "feat: add reactions (view + send) to messages"
```

---

### Task 15: Reply threading

**Files:**
- Modify: `src/lib/components/MessageBubble.svelte`
- Modify: `src/lib/components/MessageInput.svelte`
- Modify: `src/lib/components/ChatView.svelte`

Add reply-to support:
- MessageBubble shows a small quote preview when `threadOriginatorGuid` is set
- MessageInput accepts a `replyTo` prop, shows the quoted message above the input
- ChatView manages reply state: clicking "Reply" on a message sets replyTo, sending clears it
- Send request includes `selectedMessageGuid` for the reply

**Step 1: Implement reply UI in MessageBubble**

Add a "Reply" button to the context menu/hover actions. When the message has `threadOriginatorGuid`, render a small quoted preview above the bubble text.

**Step 2: Update MessageInput for reply state**

Add an optional `replyTo` prop. When set, show a small preview bar above the input with the quoted text and an X to dismiss.

**Step 3: Wire up in ChatView**

Add `replyTo` state. Pass setter to MessageBubble's reply action, pass state to MessageInput. On send, include `selectedMessageGuid` in the fetch body.

**Step 4: Commit**

```bash
git add src/lib/components/
git commit -m "feat: add reply threading to messages"
```

---

### Task 16: Edit and unsend messages

**Files:**
- Modify: `src/lib/components/MessageBubble.svelte`
- Modify: `src/lib/components/ChatView.svelte`

**Step 1: Add edit/unsend actions to sent messages**

In MessageBubble, for `isFromMe` messages:
- Add "Edit" action → shows inline edit textarea, on save calls `POST /api/proxy/message/{guid}/edit`
- Add "Unsend" action → calls `POST /api/proxy/message/{guid}/unsend`

**Step 2: Show edited/unsent state**

- Edited messages show "Edited" label (already handled via `dateEdited`)
- Unsent messages show "Message unsent" (already handled via `dateRetracted`)

**Step 3: Commit**

```bash
git add src/lib/components/
git commit -m "feat: add edit and unsend for sent messages"
```

---

### Task 17: New chat / new group modal

**Files:**
- Create: `src/lib/components/NewChatModal.svelte`
- Modify: `src/lib/components/ChatList.svelte`

**Step 1: Create NewChatModal**

Modal with:
- Address input (phone/email) with ability to add multiple for group
- Optional group name
- Optional first message
- Calls `POST /api/proxy/chat/new` with addresses array
- On success, navigates to the new chat

**Step 2: Add "New Chat" button to ChatList header**

**Step 3: Commit**

```bash
git add src/lib/components/
git commit -m "feat: add new chat and group creation"
```

---

### Task 18: Pin/unpin conversations

**Files:**
- Modify: `src/lib/components/ChatListItem.svelte`
- Modify: `src/lib/db/index.ts`

**Step 1: Add pin toggle**

Right-click or long-press on ChatListItem → "Pin" / "Unpin" option. Updates `isPinned` in IndexedDB. ChatList already sorts pinned first.

**Step 2: Commit**

```bash
git add src/lib/components/ src/lib/db/
git commit -m "feat: add pin/unpin conversations"
```

---

### Task 19: Attachment upload and paste support

**Files:**
- Modify: `src/lib/components/MessageInput.svelte`
- Create: `src/lib/components/AttachmentPreview.svelte`

**Step 1: Create AttachmentPreview**

Shows thumbnails of pending attachments with remove button.

**Step 2: Add file input and paste handler to MessageInput**

- File input button triggers hidden `<input type="file" multiple>`
- Paste handler intercepts `paste` event, extracts files from clipboard
- Files stored in local state as `File[]`
- On send, if attachments exist, use `POST /api/proxy/message/multipart` with FormData
- Show AttachmentPreview above the text input

**Step 3: Commit**

```bash
git add src/lib/components/
git commit -m "feat: add attachment upload and clipboard paste"
```

---

## Phase 6: Find My

### Task 20: Find My data layer and API integration

**Files:**
- Create: `src/lib/stores/findmy.ts`

**Step 1: Create Find My store**

Uses Svelte 5 runes to manage:
- `devices: FindMyDevice[]`
- `friends: FindMyFriend[]`
- `selectedId: string | null`
- `starred: Set<string>` (persisted to localStorage)
- `fetch()` and `refresh()` methods that call the proxy

**Step 2: Commit**

```bash
git add src/lib/stores/
git commit -m "feat: add Find My data store"
```

---

### Task 21: Find My map component

**Files:**
- Create: `src/lib/components/findmy/FindMyMap.svelte`
- Create: `src/lib/components/findmy/MapViewToggle.svelte`

**Step 1: Install Leaflet**

```bash
pnpm add leaflet
pnpm add -D @types/leaflet
```

**Step 2: Create FindMyMap**

Renders a Leaflet map with pins for all devices and friends. Pins are clickable. Map supports satellite/street/hybrid views via MapViewToggle.

**Step 3: Commit**

```bash
git add src/lib/components/findmy/
git commit -m "feat: add Find My map with Leaflet"
```

---

### Task 22: Find My sidebar and detail panel

**Files:**
- Create: `src/lib/components/findmy/FindMySidebar.svelte`
- Create: `src/lib/components/findmy/FindMyListItem.svelte`
- Create: `src/lib/components/findmy/FindMyDetailPanel.svelte`
- Modify: `src/routes/findmy/+page.svelte`

**Step 1: Create FindMySidebar**

Tabs for People / Devices with search and star toggle. Starred items at top.

**Step 2: Create FindMyDetailPanel**

Shows location, address, last updated, copy-to-clipboard button.

**Step 3: Wire up findmy page**

Layout: sidebar (320px) + map (flex-1) + optional detail panel.

**Step 4: Commit**

```bash
git add src/lib/components/findmy/ src/routes/findmy/
git commit -m "feat: add Find My sidebar, list, and detail panel"
```

---

### Task 23: Location panel in Messages mode

**Files:**
- Create: `src/lib/components/LocationPanel.svelte`
- Modify: `src/routes/messages/[chatGuid]/+page.svelte`

**Step 1: Create LocationPanel**

Right sidebar with mini Leaflet map showing the contact's Find My location. Shows address, last updated, copy button. Only visible if contact has Find My data.

**Step 2: Add toggle button in ChatView header**

Button that opens/closes the LocationPanel on the right side.

**Step 3: Commit**

```bash
git add src/lib/components/ src/routes/messages/
git commit -m "feat: add location panel in messages mode"
```

---

## Phase 7: Docker & Deployment

### Task 24: Dockerfile and docker-compose

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`
- Create: `tailscale-config/serve.json`

**Step 1: Create Dockerfile**

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/build ./build
ENV PORT=3000
EXPOSE 3000
CMD ["node", "build"]
```

**Step 2: Create docker-compose.yml**

As specified in design doc, with Tailscale sidecar.

**Step 3: Create .dockerignore**

```
node_modules
.svelte-kit
build
.env
.git
```

**Step 4: Create tailscale serve config**

```json
{
  "TCP": {
    "443": {
      "HTTPS": true
    }
  },
  "Web": {
    "webmessages.${TS_CERT_DOMAIN}:443": {
      "Handlers": {
        "/": {
          "Proxy": "http://127.0.0.1:3000"
        }
      }
    }
  }
}
```

**Step 5: Test Docker build**

```bash
docker build -t webmessages .
```

**Step 6: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore tailscale-config/
git commit -m "feat: add Docker and docker-compose with Tailscale"
```

---

### Task 25: GitHub Actions CI/CD

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/docker.yml`

**Step 1: Create CI workflow**

Runs on push/PR: lint, type check, unit tests, build.

**Step 2: Create Docker publish workflow**

Builds and pushes to ghcr.io on release tags.

**Step 3: Commit**

```bash
git add .github/
git commit -m "ci: add GitHub Actions for CI and Docker publishing"
```

---

## Phase 8: Favicons & Polishing

### Task 26: Mode-specific favicons

**Files:**
- Create: `src/lib/assets/favicon-messages.svg`
- Create: `src/lib/assets/favicon-findmy.svg`
- Modify: `src/routes/+layout.svelte`

**Step 1: Create SVG favicons**

- Messages: Blue chat bubble icon
- Find My: Red location pin icon

**Step 2: Dynamic favicon switching**

In `+layout.svelte`, switch the `<link rel="icon">` based on current route (messages vs findmy).

**Step 3: Commit**

```bash
git add src/lib/assets/ src/routes/+layout.svelte
git commit -m "feat: add mode-specific favicons"
```

---

## Phase 9: Testing

### Task 27: Unit tests for sync and transforms

**Files:**
- Expand: `src/lib/sync/transforms.spec.ts`
- Create: `src/lib/server/imessage-rs.spec.ts` (expand)
- Create: `src/lib/server/events.spec.ts` (expand)

Expand test coverage for all transforms, API client methods, and event broadcaster edge cases.

**Step 1: Run all tests**

```bash
pnpm test:unit -- --run
```

**Step 2: Commit**

```bash
git add src/
git commit -m "test: expand unit test coverage"
```

---

### Task 28: Component tests

**Files:**
- Create: `src/lib/components/ContactAvatar.svelte.spec.ts`
- Create: `src/lib/components/ModeToggle.svelte.spec.ts`
- Create: `src/lib/components/ChatListItem.svelte.spec.ts`

Test rendering, props, and basic interactions for key components.

**Step 1: Run component tests**

```bash
pnpm vitest run --project client
```

**Step 2: Commit**

```bash
git add src/lib/components/
git commit -m "test: add component tests"
```

---

### Task 29: E2E tests

**Files:**
- Modify: `e2e/demo.test.ts`
- Create: `e2e/messages.test.ts`
- Create: `e2e/findmy.test.ts`

Test full user flows:
- Navigate to app, see mode toggle
- Search conversations
- Open a conversation
- Send a message
- Switch to Find My

These will need MSW or a mock imessage-rs server for deterministic testing.

**Step 1: Run E2E**

```bash
pnpm test:e2e
```

**Step 2: Commit**

```bash
git add e2e/
git commit -m "test: add E2E tests for messages and findmy flows"
```

---

## Phase 10: README

### Task 30: Write comprehensive README

**Files:**
- Modify: `README.md`

Cover:
- App description and screenshots
- Architecture diagram
- Prerequisites (macOS Tahoe, SIP disabled, Full Disk Access)
- imessage-rs installation and configuration
- Docker Compose setup with Tailscale
- Development setup
- Environment variables
- Testing
- Contributing

**Step 1: Write README**

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add comprehensive README"
```

---

## Execution Summary

| Phase | Tasks | Description |
|---|---|---|
| 1 | 1-4 | Foundation: adapter, types, Dexie, API client |
| 2 | 5-7 | Server proxy, auth, webhooks, SSE |
| 3 | 8-9 | Sync engine: transforms, initial/incremental/realtime sync |
| 4 | 10-13 | Messages UI: shell, chat list, chat view, sync init |
| 5 | 14-19 | Features: reactions, replies, edit, unsend, new chat, pin, attachments |
| 6 | 20-23 | Find My: data, map, sidebar, location panel |
| 7 | 24-25 | Docker, CI/CD |
| 8 | 26 | Favicons |
| 9 | 27-29 | Tests: unit, component, E2E |
| 10 | 30 | README |

**Total: 30 tasks across 10 phases**

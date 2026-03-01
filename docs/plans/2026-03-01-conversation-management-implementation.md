# Conversation Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add right-click context menu on conversations with Pin/Unpin, Delete, Mark Read/Unread, and Leave Group — all syncing bidirectionally with the native Messages app.

**Architecture:** Context menu component in ChatList triggers API calls (imessage-rs for delete/read/leave, Swift binary for pins) with optimistic IndexedDB updates. A periodic sync loop (~8s) polls for native app changes. UI reactivity handled automatically via Dexie liveQuery.

**Tech Stack:** SvelteKit, Svelte 5 runes, Dexie.js, Swift/IMCore, imessage-rs REST API

---

### Task 1: Pin-Chat Swift Binary

Write the Swift binary that can add/remove a chat from the IMCore pinned conversations store.

**Files:**
- Create: `src/lib/server/pin-chat.swift`

**Step 1: Write the pin-chat Swift binary**

Create `src/lib/server/pin-chat.swift`:

```swift
import Foundation

// Usage: pin-chat <chatIdentifier> <pin|unpin>
guard CommandLine.arguments.count == 3 else {
    fputs("Usage: pin-chat <chatIdentifier> <pin|unpin>\n", stderr)
    exit(1)
}

let chatIdentifier = CommandLine.arguments[1]
let action = CommandLine.arguments[2]

guard action == "pin" || action == "unpin" else {
    fputs("Action must be 'pin' or 'unpin'\n", stderr)
    exit(1)
}

// Load IMCore private framework
guard let bundle = Bundle(path: "/System/Library/PrivateFrameworks/IMCore.framework"),
      bundle.load(),
      let cls = NSClassFromString("IMPinnedConversationsController") else {
    fputs("Failed to load IMCore framework\n", stderr)
    exit(1)
}

let sharedSel = NSSelectorFromString("sharedInstance")
guard cls.responds(to: sharedSel),
      let instance = (cls as AnyObject).perform(sharedSel)?.takeUnretainedValue() else {
    fputs("Failed to get IMPinnedConversationsController sharedInstance\n", stderr)
    exit(1)
}

// Read current pinned conversations
let fetchSel = NSSelectorFromString("fetchPinnedConversationIdentifiersFromLocalStore")
guard instance.responds(to: fetchSel),
      let result = instance.perform(fetchSel)?.takeUnretainedValue() as? NSDictionary,
      var pinned = result["pP"] as? [String] else {
    fputs("Failed to read pinned conversations\n", stderr)
    exit(1)
}

// Modify the list
if action == "pin" {
    if !pinned.contains(chatIdentifier) {
        pinned.insert(chatIdentifier, at: 0) // iMessage pins newest at front
    }
} else {
    pinned.removeAll { $0 == chatIdentifier }
}

// Write back using pinConversationIdentifiers or the NSDictionary setter
// IMPinnedConversationsController stores as {"pP": [...], "pV": 1}
let updatedDict: NSDictionary = ["pP": pinned, "pV": 1]

// Try setPinnedConversationIdentifiersInLocalStore:
let setSel = NSSelectorFromString("setPinnedConversationIdentifiersInLocalStore:")
if instance.responds(to: setSel) {
    instance.perform(setSel, with: updatedDict)
    print("{\"ok\":true}")
    exit(0)
}

// Fallback: try pinnedConversationsInLocalStoreDidChange:
let changeSel = NSSelectorFromString("pinnedConversationsInLocalStoreDidChange:")
if instance.responds(to: changeSel) {
    instance.perform(changeSel, with: updatedDict)
    print("{\"ok\":true}")
    exit(0)
}

fputs("No write method found on IMPinnedConversationsController\n", stderr)
exit(1)
```

> **Note:** The exact setter method name may need adjustment after testing. IMCore is a private framework and method names vary by macOS version. If `setPinnedConversationIdentifiersInLocalStore:` doesn't exist, we may need to write directly to `NSUbiquitousKeyValueStore` using the same key IMCore uses. This is the main research risk in this plan — test this step manually before proceeding.

**Step 2: Compile and test the binary**

Run:
```bash
swiftc src/lib/server/pin-chat.swift -o src/lib/server/pin-chat -framework Foundation
```

Test manually:
```bash
# Read current pins first
./src/lib/server/pinned-chats
# Pin a test chat
./src/lib/server/pin-chat "chat123456" pin
# Verify it appears
./src/lib/server/pinned-chats
# Unpin it
./src/lib/server/pin-chat "chat123456" unpin
# Verify it's gone
./src/lib/server/pinned-chats
```

Expected: The pinned list updates, and the change appears in the native Messages app within a few seconds.

**Step 3: Add to build:swift script in package.json**

In `package.json`, append to the `build:swift` script:
```
&& swiftc src/lib/server/pin-chat.swift -o src/lib/server/pin-chat -framework Foundation
```

**Step 4: Commit**

```bash
git add src/lib/server/pin-chat.swift package.json
git commit -m "feat: add pin-chat Swift binary for writing pin state via IMCore"
```

---

### Task 2: Pin API Endpoint (POST)

Add a POST handler to the existing pinned endpoint so the web app can trigger pin/unpin.

**Files:**
- Modify: `src/routes/api/plist/pinned/+server.ts`

**Step 1: Add POST handler**

Add to `src/routes/api/plist/pinned/+server.ts` (after the existing GET handler):

```typescript
export const POST: RequestHandler = async ({ request }) => {
	const { chatIdentifier, pinned } = await request.json();

	if (!chatIdentifier || typeof pinned !== 'boolean') {
		return json({ status: 400, error: 'chatIdentifier and pinned (boolean) required' }, { status: 400 });
	}

	const binaryPath = join(process.cwd(), 'src', 'lib', 'server', 'pin-chat');

	if (!existsSync(binaryPath)) {
		return json({ status: 500, error: 'pin-chat binary not found' }, { status: 500 });
	}

	try {
		const action = pinned ? 'pin' : 'unpin';
		execFileSync(binaryPath, [chatIdentifier, action], { timeout: 5000 });
		return json({ status: 200, data: { ok: true } });
	} catch (err) {
		return json({ status: 500, error: 'Failed to update pin state' }, { status: 500 });
	}
};
```

**Step 2: Commit**

```bash
git add src/routes/api/plist/pinned/+server.ts
git commit -m "feat: add POST /api/plist/pinned endpoint for pin/unpin writes"
```

---

### Task 3: Context Menu Component

Build the right-click context menu that appears on conversation items.

**Files:**
- Create: `src/lib/components/ChatContextMenu.svelte`

**Step 1: Create the context menu component**

Create `src/lib/components/ChatContextMenu.svelte`. This follows the same pattern as `MessageBubble.svelte`'s context menu (fixed positioning, backdrop overlay, escape/scroll to close):

```svelte
<script lang="ts">
	interface Props {
		x: number;
		y: number;
		isPinned: boolean;
		isGroup: boolean;
		hasUnread: boolean;
		onPin: () => void;
		onDelete: () => void;
		onToggleRead: () => void;
		onLeave: () => void;
		onClose: () => void;
	}

	let { x, y, isPinned, isGroup, hasUnread, onPin, onDelete, onToggleRead, onLeave, onClose }: Props = $props();

	// Close on scroll
	$effect(() => {
		const onScroll = () => onClose();
		window.addEventListener('scroll', onScroll, true);
		return () => window.removeEventListener('scroll', onScroll, true);
	});

	// Close on Escape
	$effect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	// Adjust position if menu would go off-screen
	const menuWidth = 200;
	const menuHeight = 180;
	const adjustedX = $derived(x + menuWidth > window.innerWidth ? window.innerWidth - menuWidth - 8 : x);
	const adjustedY = $derived(y + menuHeight > window.innerHeight ? window.innerHeight - menuHeight - 8 : y);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-50" onclick={onClose} oncontextmenu={(e) => { e.preventDefault(); onClose(); }}></div>
<div
	class="fixed z-[51] min-w-[200px] overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-black/10 dark:bg-gray-800 dark:ring-white/10"
	style="left: {adjustedX}px; top: {adjustedY}px;"
>
	<button
		onclick={() => { onClose(); onPin(); }}
		class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
	>
		<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400" viewBox="0 0 16 16" fill="currentColor">
			<path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.126.125-.25.224-.354.298v4.431l.078.048c.203.127.476.314.751.555C12.36 7.775 13 8.527 13 9.5a.5.5 0 0 1-.5.5h-4v4.5a.5.5 0 0 1-1 0V10h-4a.5.5 0 0 1-.5-.5c0-.973.64-1.725 1.17-2.189A6 6 0 0 1 5 6.708V2.277a3 3 0 0 1-.354-.298C4.342 1.674 4 1.179 4 .5a.5.5 0 0 1 .146-.354" />
		</svg>
		{isPinned ? 'Unpin' : 'Pin'}
	</button>

	<button
		onclick={() => { onClose(); onToggleRead(); }}
		class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
	>
		<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			{#if hasUnread}
				<path stroke-linecap="round" stroke-linejoin="round" d="M3 19v-8.93a2 2 0 01.89-1.664l7-4.666a2 2 0 012.22 0l7 4.666A2 2 0 0121 10.07V19M3 19a2 2 0 002 2h14a2 2 0 002-2M3 19l6.75-4.5M21 19l-6.75-4.5M3 10l6.75 4.5M21 10l-6.75 4.5m0 0l-1.14.76a2 2 0 01-2.22 0l-1.14-.76" />
			{:else}
				<path stroke-linecap="round" stroke-linejoin="round" d="M21.75 9v.906a2.25 2.25 0 01-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 001.183 1.981l6.478 3.488m8.839 2.51l-4.66-2.51m0 0l-1.023-.55a2.25 2.25 0 00-2.134 0l-1.022.55m0 0l-4.661 2.51" />
			{/if}
		</svg>
		{hasUnread ? 'Mark as Read' : 'Mark as Unread'}
	</button>

	<hr class="border-gray-200 dark:border-gray-700" />

	{#if isGroup}
		<button
			onclick={() => { onClose(); onLeave(); }}
			class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
		>
			<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
			</svg>
			Leave Conversation
		</button>
	{/if}

	<button
		onclick={() => { onClose(); onDelete(); }}
		class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
	>
		<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
		</svg>
		Delete Conversation
	</button>
</div>
```

**Step 2: Commit**

```bash
git add src/lib/components/ChatContextMenu.svelte
git commit -m "feat: add ChatContextMenu component"
```

---

### Task 4: Wire Context Menu into ChatList

Connect the context menu to the conversation list, with all action handlers.

**Files:**
- Modify: `src/lib/components/ChatList.svelte`
- Modify: `src/lib/components/ChatListItem.svelte`

**Step 1: Add oncontextmenu to ChatListItem**

In `src/lib/components/ChatListItem.svelte`, add an `oncontextmenu` callback prop and wire it to the `<a>` element:

Add to the Props interface:
```typescript
oncontextmenu?: (e: MouseEvent) => void;
```

Add to destructuring:
```typescript
oncontextmenu
```

On the `<a>` element, add:
```
oncontextmenu={(e) => { if (oncontextmenu) { e.preventDefault(); oncontextmenu(e); } }}
```

**Step 2: Add context menu state and handlers to ChatList**

In `src/lib/components/ChatList.svelte`, add:

1. Import `ChatContextMenu` and `goto` from `$app/navigation`
2. Add state variables:
```typescript
let contextMenu = $state<{
    x: number;
    y: number;
    chat: DbChat;
} | null>(null);

let confirmDialog = $state<{
    title: string;
    message: string;
    onConfirm: () => void;
} | null>(null);
```

3. Add action handlers:
```typescript
async function handlePin(chat: DbChat) {
    const newPinned = !chat.isPinned;
    // Optimistic update
    await db.chats.update(chat.guid, { isPinned: newPinned });
    try {
        await fetch('/api/plist/pinned', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatIdentifier: chat.chatIdentifier, pinned: newPinned })
        });
    } catch {
        // Revert on failure
        await db.chats.update(chat.guid, { isPinned: !newPinned });
    }
}

async function handleToggleRead(chat: DbChat) {
    const allGuids = siblingGuidsMap.get(chat.guid) ?? [chat.guid];
    if (chat.unreadCount > 0) {
        // Mark as read
        for (const guid of allGuids) {
            await db.chats.update(guid, { unreadCount: 0 });
        }
        for (const guid of allGuids) {
            fetch(`/api/proxy/chat/${encodeURIComponent(guid)}/read`, { method: 'POST' }).catch(() => {});
        }
    } else {
        // Mark as unread
        for (const guid of allGuids) {
            await db.chats.update(guid, { unreadCount: 1 });
        }
        for (const guid of allGuids) {
            fetch(`/api/proxy/chat/${encodeURIComponent(guid)}/unread`, { method: 'POST' }).catch(() => {});
        }
    }
}

function handleDelete(chat: DbChat) {
    confirmDialog = {
        title: 'Delete Conversation',
        message: 'This conversation will be removed from your Messages app too. This cannot be undone.',
        onConfirm: async () => {
            confirmDialog = null;
            const allGuids = siblingGuidsMap.get(chat.guid) ?? [chat.guid];

            // Navigate away if active
            if (allGuids.some(g => isChatActive(g))) {
                goto('/messages');
            }

            // Delete from IndexedDB and API
            for (const guid of allGuids) {
                await db.messages.where('chatGuid').equals(guid).delete();
                await db.chats.delete(guid);
                fetch(`/api/proxy/chat/${encodeURIComponent(guid)}`, { method: 'DELETE' }).catch(() => {});
            }
        }
    };
}

function handleLeave(chat: DbChat) {
    confirmDialog = {
        title: 'Leave Conversation',
        message: "You won't receive new messages from this group.",
        onConfirm: async () => {
            confirmDialog = null;
            if (isChatActive(chat.guid)) {
                goto('/messages');
            }
            await db.messages.where('chatGuid').equals(chat.guid).delete();
            await db.chats.delete(chat.guid);
            fetch(`/api/proxy/chat/${encodeURIComponent(chat.guid)}/leave`, { method: 'POST' }).catch(() => {});
        }
    };
}
```

4. Pass `oncontextmenu` to both pinned and regular `ChatListItem` instances:
```svelte
<ChatListItem
    ...existing props...
    oncontextmenu={(e) => { contextMenu = { x: e.clientX, y: e.clientY, chat }; }}
/>
```

5. Render the context menu and confirmation dialog at the bottom of the template:
```svelte
{#if contextMenu}
    <ChatContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        isPinned={contextMenu.chat.isPinned}
        isGroup={contextMenu.chat.style === 43}
        hasUnread={contextMenu.chat.unreadCount > 0}
        onPin={() => handlePin(contextMenu!.chat)}
        onDelete={() => handleDelete(contextMenu!.chat)}
        onToggleRead={() => handleToggleRead(contextMenu!.chat)}
        onLeave={() => handleLeave(contextMenu!.chat)}
        onClose={() => { contextMenu = null; }}
    />
{/if}

{#if confirmDialog}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onclick={() => { confirmDialog = null; }}>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-800" onclick={(e) => e.stopPropagation()}>
            <h3 class="text-lg font-semibold dark:text-white">{confirmDialog.title}</h3>
            <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">{confirmDialog.message}</p>
            <div class="mt-4 flex justify-end gap-2">
                <button
                    onclick={() => { confirmDialog = null; }}
                    class="rounded-lg px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                    Cancel
                </button>
                <button
                    onclick={confirmDialog.onConfirm}
                    class="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
                >
                    {confirmDialog.title.startsWith('Leave') ? 'Leave' : 'Delete'}
                </button>
            </div>
        </div>
    </div>
{/if}
```

**Step 3: Import `goto`**

Add at the top of `ChatList.svelte`:
```typescript
import { goto } from '$app/navigation';
import ChatContextMenu from './ChatContextMenu.svelte';
```

**Step 4: Commit**

```bash
git add src/lib/components/ChatList.svelte src/lib/components/ChatListItem.svelte
git commit -m "feat: wire context menu into conversation list with pin/delete/read/leave actions"
```

---

### Task 5: Periodic Background Sync

Add a polling interval to the SyncEngine that detects native app changes (pin changes, chat deletions, unread count changes).

**Files:**
- Modify: `src/lib/sync/engine.svelte.ts`

**Step 1: Add periodic sync to the SyncEngine**

Add a `private periodicSyncInterval: ReturnType<typeof setInterval> | null = null;` field.

In `start()`, after the initial/incremental sync call, add:
```typescript
this.periodicSyncInterval = setInterval(() => this.periodicSync(), 8000);
```

In `stop()`, add:
```typescript
if (this.periodicSyncInterval) {
    clearInterval(this.periodicSyncInterval);
    this.periodicSyncInterval = null;
}
```

Add the `periodicSync()` method:
```typescript
private async periodicSync() {
    // Run all three in parallel — they're independent
    await Promise.allSettled([
        this.syncPinnedChats(),
        this.syncUnreadCounts(),
        this.detectDeletedChats()
    ]);
}
```

Add the `detectDeletedChats()` method:
```typescript
private async detectDeletedChats() {
    try {
        const chatRes = await proxyPost<Chat[]>('/api/proxy/chat/query', {
            with: ['participants'],
            sort: 'lastmessage',
            limit: 1000
        });
        if (!chatRes.data) return;

        const apiGuids = new Set(chatRes.data.map(c => c.guid));
        const localChats = await db.chats.toArray();

        await db.transaction('rw', [db.chats, db.messages], async () => {
            for (const local of localChats) {
                if (!apiGuids.has(local.guid)) {
                    await db.messages.where('chatGuid').equals(local.guid).delete();
                    await db.chats.delete(local.guid);
                }
            }
        });
    } catch {
        // Silently fail
    }
}
```

**Step 2: Commit**

```bash
git add src/lib/sync/engine.svelte.ts
git commit -m "feat: add periodic sync for detecting native pin/delete/unread changes"
```

---

### Task 6: Manual Testing & Polish

Test the full flow end-to-end.

**Test cases:**

1. **Pin from web**: Right-click a conversation → Pin → verify it moves to pinned section → verify it appears pinned in native Messages app
2. **Unpin from web**: Right-click a pinned conversation → Unpin → verify it moves back → verify change in native Messages
3. **Pin from native**: Pin a chat in native Messages → verify it appears pinned in web UI within ~8s
4. **Delete from web**: Right-click → Delete → confirm → verify removed from list → verify gone from native Messages
5. **Delete from native**: Delete a chat in native Messages → verify removed from web UI within ~8s
6. **Mark as read from web**: Right-click unread conversation → Mark as Read → verify badge removed → verify read in native Messages
7. **Mark as unread from web**: Right-click read conversation → Mark as Unread → verify badge appears
8. **Read from native**: Read a chat in native Messages → verify badge removed in web UI (via webhook, near-instant)
9. **Leave group from web**: Right-click group chat → Leave → confirm → verify removed
10. **Active chat deletion**: Open a conversation, then delete it from another device → verify redirect to `/messages`

**Step 1: Run the app and manually test all flows**

```bash
pnpm dev --host
```

**Step 2: Fix any issues discovered**

**Step 3: Final commit**

```bash
git add -A
git commit -m "fix: polish conversation management after testing"
```

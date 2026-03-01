# Conversation Management Design

## Goal

Add right-click context menu on conversations in the sidebar with: Pin/Unpin, Delete, Mark Read/Unread, Leave Group. All actions must sync bidirectionally between the web app and the native iMessage app.

## Architecture

### Context Menu Component

- New `ChatContextMenu.svelte` component, rendered once in `ChatList.svelte`
- Positioned at cursor coordinates on right-click of any `ChatListItem`
- Actions shown contextually:
  - **Pin / Unpin** — toggle based on `isPinned`
  - **Mark as Read / Mark as Unread** — toggle based on `unreadCount > 0`
  - **Delete Conversation** — with confirmation dialog
  - **Leave Conversation** — group chats only (style 43), with confirmation dialog
- Closes on click outside, Escape, or scroll

### Pin/Unpin (Web → Native)

- New `pin-chat.swift` binary using `IMPinnedConversationsController` from IMCore private framework
- Reads current pins via `fetchPinnedConversationIdentifiersFromLocalStore`
- Modifies the `"pP"` array (add/remove `chatIdentifier`)
- Writes back via `setPinnedConversationIdentifiers:` (or equivalent setter)
- New endpoint: `POST /api/plist/pinned` with body `{ chatIdentifier, pinned }`
- Updates IndexedDB `isPinned` optimistically on the client

### Delete Conversation (Web → Native)

- Uses existing `DELETE /api/v1/chat/{guid}` via imessage-rs proxy
- Removes chat + messages from IndexedDB
- Navigates to `/messages` if deleted chat was active
- Handles sibling chats (same contact, phone + email): deletes all siblings
- Confirmation dialog before action

### Mark Read/Unread (Web → Native)

- Uses existing imessage-rs API:
  - `POST /api/v1/chat/{guid}/read` — marks read in chat.db
  - `POST /api/v1/chat/{guid}/unread` — marks unread
- Updates IndexedDB `unreadCount` (0 for read, 1 for unread)
- Handles sibling chats

### Leave Group (Web → Native)

- Uses existing `POST /api/v1/chat/{guid}/leave` via imessage-rs
- Removes chat from IndexedDB, navigates to `/messages`
- Confirmation dialog before action

### Periodic Sync (Native → Web)

Single `setInterval` (~8s) in `SyncEngine.start()` running:

1. **Pinned chats**: Re-read IMCore plist via Swift binary
2. **Chat list**: Re-fetch from imessage-rs, detect deletions (missing guids → remove from IndexedDB)
3. **Unread counts**: Re-query chat.db

All updates go through `db.chats.update()`, triggering Dexie `liveQuery` for automatic UI updates.

Read status changes from native app already handled by existing `chat-read-status-changed` webhook event.

## Files to Create/Modify

### New Files
- `src/lib/server/pin-chat.swift` — Swift binary for writing pin state
- `src/lib/components/ChatContextMenu.svelte` — Context menu component

### Modified Files
- `src/lib/components/ChatList.svelte` — Add context menu state + right-click handler
- `src/lib/components/ChatListItem.svelte` — Add `oncontextmenu` event forwarding
- `src/lib/sync/engine.svelte.ts` — Add periodic sync interval, chat deletion detection
- `src/routes/api/plist/pinned/+server.ts` — Add POST handler for pin writes
- `src/lib/sync/sse.ts` — No changes needed (existing events sufficient)

## Sync Matrix

| Action | Web → Native | Native → Web |
|--------|-------------|-------------|
| Pin/Unpin | Swift binary writes IMCore plist | Poll plist every ~8s |
| Delete | imessage-rs DELETE API | Poll chat list, detect missing guids |
| Mark Read | imessage-rs POST read API | `chat-read-status-changed` webhook |
| Mark Unread | imessage-rs POST unread API | Poll unread counts every ~8s |
| Leave Group | imessage-rs POST leave API | Poll chat list, detect missing guids |

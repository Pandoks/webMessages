# webMessages Design Document

**Date**: 2026-02-27
**Status**: Approved

## Overview

webMessages is a web version of iMessages + Find My, backed by [imessage-rs](https://github.com/jesec/imessage-rs) as the native macOS backend. It runs as a local-first SPA in Docker, exposed to a Tailscale VPN, with offline support via IndexedDB.

## Architecture

```
┌──────────────── Docker Compose ────────────────┐
│  ┌───────────┐    ┌──────────────────────────┐ │
│  │ Tailscale │───▶│ SvelteKit (adapter-node)  │ │
│  │ Container │    │                          │ │
│  └───────────┘    │ /api/proxy/* → imessage-rs│ │
│                   │ /api/events  → SSE        │ │
│                   │ /webhook     → receiver   │ │
│                   └─────────┬────────────────┘ │
└─────────────────────────────┼──────────────────┘
                              │ host.docker.internal:1234
                              ▼
                   ┌──────────────────┐
                   │ imessage-rs      │
                   │ (native, macOS)  │
                   └──────────────────┘
```

### Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Backend communication | SvelteKit server-side proxy | Keeps API password server-side, clean abstraction |
| Offline strategy | Full IndexedDB mirror (Dexie) | Spec requires local-first, fast switching |
| Real-time push | Server-Sent Events (SSE) | Simple, auto-reconnect, sufficient for unidirectional events |
| IndexedDB library | Dexie.js | Mature, reactive liveQuery, familiar from prior work |
| Sync architecture | Event-driven sync | UI reads from IndexedDB, sync layer keeps it fresh independently |

## Data Layer

### IndexedDB Schema (Dexie)

```
chats        → guid (PK), chatIdentifier, displayName, style, lastMessageDate,
               isArchived, isPinned, participants[], unreadCount
messages     → guid (PK), chatGuid (indexed), text, handleId, isFromMe,
               dateCreated (indexed), dateRead, dateDelivered, dateEdited,
               dateRetracted, subject, associatedMessageGuid, associatedMessageType,
               threadOriginatorGuid, attachments[], error, expressiveSendStyleId
handles      → address (PK), service, country, displayName, avatarBase64
attachments  → guid (PK), messageGuid (indexed), mimeType, transferName,
               totalBytes, width, height, hasLivePhoto, blurhash
contacts     → address (PK), displayName, avatarUrl
syncMeta     → key (PK), value
```

### Sync Flow

1. **Initial sync**: Fetch all chats + recent messages (50/chat), bulk write to IndexedDB, store `lastSyncTimestamp`
2. **Incremental sync**: On returning visit, fetch messages updated since `lastSyncTimestamp`
3. **Real-time sync**: SSE stream receives webhook events, applies to IndexedDB
4. **Lazy loading**: Scroll up → fetch older messages with `before` param → insert to IndexedDB

### UI Reactivity

All UI reads use Dexie `liveQuery`. IndexedDB is the single source of truth for rendering. Conversation switching is instant.

## UI Layout

```
┌──────────────────────────────────────────────────────────────┐
│ [Messages] [Find My]                           mode toggle   │
├──────────────────────┬───────────────────────┬───────────────┤
│  Sidebar (320px)     │  Main Content         │ Location      │
│  - Search            │  - Messages view      │ Panel (opt.)  │
│  - Pinned chats      │  - or Find My map     │ - Mini-map    │
│  - Chat list         │                       │ - Address     │
│                      │                       │ - Copy btn    │
└──────────────────────┴───────────────────────┴───────────────┘
```

### Messages Components

- `ChatList` — sidebar with search, pinned section, scrollable list
- `ChatListItem` — avatar, name, last message, timestamp, unread dot
- `ChatView` — message thread for selected conversation
- `MessageBubble` — text, attachments, reactions, delivery status
- `MessageInput` — text area, attachment upload, send
- `ReactionPicker` — tapback selection
- `AttachmentPreview` — file/image/video preview before send
- `ContactAvatar` — profile photo with fallback initials
- `NewChatModal` — create conversation or group
- `LocationPanel` — right sidebar for contact's Find My location

### Find My Components

- `FindMyMap` — full map with device/people/item pins
- `FindMySidebar` — People / Devices / Items tabs
- `FindMyListItem` — name, last updated, star toggle
- `FindMyDetailPanel` — location details, address, copy button
- `MapViewToggle` — satellite / street / hybrid switcher

### Routing

```
/                    → redirect to /messages
/messages            → Messages mode, no chat selected
/messages/[chatGuid] → Messages mode with chat open
/findmy              → Find My mode
/findmy/[type]/[id]  → Find My with item selected
```

## Server-Side Proxy

### Routes

```
src/routes/
├── api/
│   ├── proxy/[...path]/+server.ts   ← catch-all proxy to imessage-rs
│   ├── events/+server.ts            ← SSE endpoint
│   └── webhook/+server.ts           ← webhook receiver from imessage-rs
```

- **Proxy**: Forwards to `IMESSAGE_RS_URL/api/v1/[...path]` with password injected
- **SSE**: Maintains connected clients, broadcasts webhook events
- **Webhook**: Receives POSTs from imessage-rs, fans out to SSE clients
- **Auth**: Tailscale CGNAT range check (100.64.0.0/10) + localhost

### Environment Variables

```
IMESSAGE_RS_URL=http://host.docker.internal:1234
IMESSAGE_RS_PASSWORD=<secret>
```

## Docker & Deployment

### docker-compose.yml

```yaml
services:
  web:
    build: .
    environment:
      - IMESSAGE_RS_URL=http://host.docker.internal:1234
      - IMESSAGE_RS_PASSWORD=${IMESSAGE_RS_PASSWORD}
    network_mode: service:tailscale

  tailscale:
    image: tailscale/tailscale
    hostname: webmessages
    environment:
      - TS_AUTHKEY=${TS_AUTHKEY}
      - TS_SERVE_CONFIG=/config/serve.json
    volumes:
      - ./tailscale-config:/config
      - ts-state:/var/lib/tailscale

volumes:
  ts-state:
```

## Testing Strategy

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest (Node) | Sync logic, data transforms, formatting |
| Component | Vitest + Playwright browser | Svelte component rendering, interactions |
| Integration | Vitest (Node) | Proxy routes, SSE, webhook handling |
| E2E | Playwright | Full user flows |
| Mocking | MSW | Mock imessage-rs for deterministic tests |

## imessage-rs API Summary

66 REST endpoints on localhost:1234. Key groups:
- **Server**: health, info, permissions, statistics
- **Messages**: send (text/attachment/multipart), react, edit, unsend, query
- **Chats**: create, query, read/unread, typing, participants, icons
- **Attachments**: upload, download (auto HEIC→JPEG), Live Photos, blurhash
- **Handles**: query, focus/DND status, availability checks
- **FindMy**: device locations, friend locations, refresh
- **Webhooks**: 18 event types (new-message, typing-indicator, etc.)

Authentication: `?password=<token>` query parameter on all requests.

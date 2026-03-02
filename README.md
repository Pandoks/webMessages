# webMessages

A native macOS web client for **iMessage** and **Find My**, powered by [imessage-rs](https://github.com/jesec/imessage-rs). Access your messages and locate your devices from any browser on your network — no Apple device required on the viewing end.

## Features

**iMessage**

- Send and receive texts, reactions (tapbacks), replies, edits, and unsends
- Attachments — send images, videos, and files via drag-and-drop or paste
- Scheduled messages — create, edit, and cancel via IMCore private API
- Typing indicators — see when someone is typing, and broadcast yours
- Read receipts — automatic when you open a conversation
- Pin/unpin conversations — via IMCore, synced with Messages.app
- Compose — search contacts, start 1:1 or group conversations
- Chat deduplication — same contact via phone and email merged into one thread
- Edit/unsend eligibility — 15-minute edit window, 2-minute unsend window, with countdown timers

**Find My**

- Device and friend locations on an interactive map (street, satellite, hybrid views)
- Reverse geocoding — coordinates resolved to street addresses
- Distance calculations from your current location
- Real-time location updates via webhooks

**Architecture**

- Local-first — IndexedDB (Dexie.js) mirrors all data for instant UI and offline reads
- Real-time — Server-Sent Events push new messages, typing indicators, and location updates
- Private — access restricted to localhost and Tailscale IPs only, no login needed
- Dark mode with system detection

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│ Browser                                                     │
│                                                             │
│  SvelteKit SPA ──> IndexedDB (Dexie.js)                    │
│       │                                                     │
│       │ fetch /api/*          EventSource /api/events (SSE) │
└───────┼──────────────────────────────┬──────────────────────┘
        │                              │
        v                              │
┌───────────────────────────────────────────────┐
│ SvelteKit Server (Node.js, adapter-node)      │
│                                               │
│  /api/proxy/*  ───> imessage-rs REST API      │
│  /api/webhook  <─── imessage-rs webhooks      │
│  /api/events   ───> SSE broadcaster           │
│  /api/contacts ───> AddressBook SQLite        │
│  /api/scheduled-messages ──> imcore-bridge     │
│  /api/plist/pinned ──> pinned-chats            │
│  /api/geocode  ───> reverse-geocode            │
│  /api/me       ───> osascript (Contacts.app)   │
└───────────────────┬───────────────────────────┘
                    │
                    │ http://127.0.0.1:1234
                    v
          ┌──────────────────┐
          │   imessage-rs    │
          │  (native macOS)  │
          │                  │
          │  Reads chat.db   │
          │  Sends via IDS   │
          │  Find My API     │
          └──────────────────┘
```

**Data flow for a new message:**

1. imessage-rs polls `~/Library/Messages/chat.db` every ~5 seconds
2. New message detected → HTTP POST to `/api/webhook`
3. SvelteKit server broadcasts to all connected SSE clients
4. Browser receives SSE event → sync engine writes to IndexedDB
5. Dexie `liveQuery` triggers reactive UI update

**Three Swift binaries** extend what imessage-rs can't do alone:

| Binary            | Framework        | Purpose                                               |
| ----------------- | ---------------- | ----------------------------------------------------- |
| `imcore-bridge`   | IMCore (private) | Scheduled messages CRUD, connects to `imagent` daemon |
| `pinned-chats`    | IMCore (private) | Reads pinned conversation list from local store       |
| `reverse-geocode` | CoreLocation     | Converts lat/lon to street addresses                  |

These require SIP disabled and ad-hoc code signing with private entitlements (handled automatically).

## Install

### Prerequisites

| Requirement       | Why                                                                 |
| ----------------- | ------------------------------------------------------------------- |
| macOS Sequoia 15+ | imessage-rs requires modern macOS private frameworks                |
| SIP disabled      | Swift binaries and imessage-rs access private IMCore/IDS frameworks |
| Full Disk Access  | Server reads `~/Library/Messages/chat.db` and AddressBook databases |
| Node.js 22+       | Runs the SvelteKit web server                                       |

**Disable SIP:** Boot into Recovery Mode (hold Power on Apple Silicon, Cmd+R on Intel), open Terminal:

```sh
csrutil disable
```

Reboot into macOS.

**Full Disk Access:** System Settings > Privacy & Security > Full Disk Access > add your terminal app.

### Download and Run

```sh
curl -fsSL https://github.com/pandoks/webMessages/releases/latest/download/webmessages -o webmessages
chmod +x webmessages
./webmessages
```

That's it. A random port is chosen automatically and printed to the terminal. Press `Ctrl+C` to stop. Nothing is left on disk — everything extracts to a temp directory and is cleaned up on exit.

To pin a specific port:

```sh
PORT=3000 ./webmessages
```

### How It Works

The downloaded file is a self-extracting shell script. Each time you run it, it:

1. Extracts pre-compiled binaries and the web server to a temp directory
2. Strips macOS quarantine attributes and re-signs `imcore-bridge`
3. Auto-generates an API password and finds free ports
4. Starts imessage-rs and the Node.js web server
5. Prints the URL to the terminal
6. On exit (Ctrl+C), kills both services and deletes the temp directory

No compilation, no config files, no persistent state. Everything is pre-built by GitHub Actions.

### Environment

All settings have sensible defaults. Override via env vars if needed:

| Variable               | Default              | Description                                      |
| ---------------------- | -------------------- | ------------------------------------------------ |
| `PORT`                 | _(random free port)_ | Web server port                                  |
| `IMESSAGE_RS_PORT`     | _(random free port)_ | imessage-rs API port                             |
| `IMESSAGE_RS_PASSWORD` | _(auto-generated)_   | Shared secret between web server and imessage-rs |

### Upgrading

Download the latest release and replace your binary. There's nothing else to update.

---

## Development

### Dev Prerequisites

| Tool         | Version  | Install                                                           |
| ------------ | -------- | ----------------------------------------------------------------- |
| macOS        | 15+      | —                                                                 |
| SIP          | disabled | Recovery Mode                                                     |
| Node.js      | 22+      | [nodejs.org](https://nodejs.org) or `nvm install 22`              |
| pnpm         | latest   | `corepack enable`                                                 |
| Xcode CLT    | latest   | `xcode-select --install` (provides `swiftc`, `codesign`)          |
| Rust + cargo | latest   | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| imessage-rs  | latest   | `cargo install imessage-rs`                                       |

### Setup

```sh
# Clone
git clone https://github.com/pandoks/webMessages.git
cd webMessages

# Install JS dependencies
pnpm install

# Compile Swift binaries (once, ad-hoc signed)
pnpm build:swift

# Start imessage-rs in a separate terminal (all via CLI flags, no config file)
imessage-rs --password secret --enable-private-api true \
  --enable-findmy-private-api true \
  --webhook "http://localhost:5173/api/webhook"
# Use localhost, not 127.0.0.1 — Vite binds on IPv6

# Start dev server (password must match)
IMESSAGE_RS_PASSWORD=secret pnpm dev
```

Dev server runs at `http://localhost:5173`. Use `pnpm dev --host` to expose on your Tailscale IP.

### Environment Variables (Dev)

| Variable               | Default                 | Description                                                   |
| ---------------------- | ----------------------- | ------------------------------------------------------------- |
| `IMESSAGE_RS_URL`      | `http://127.0.0.1:1234` | imessage-rs API URL                                           |
| `IMESSAGE_RS_PASSWORD` | _(required)_            | Must match the `--password` flag you started imessage-rs with |

### Project Structure

```
src/
├── lib/
│   ├── components/       # Svelte 5 UI (ChatView, MessageBubble, FindMyMap, etc.)
│   ├── db/               # Dexie IndexedDB schema (chats, messages, handles, attachments)
│   ├── server/           # Server-only: auth, contacts, env, events broadcaster
│   │   ├── imcore-bridge.swift       # Scheduled messages via IMCore
│   │   ├── imcore-bridge.entitlements
│   │   ├── pinned-chats.swift        # Pinned conversations via IMCore
│   │   └── reverse-geocode.swift     # CLGeocoder wrapper
│   ├── stores/           # Svelte 5 reactive stores (findmy, theme, visibility)
│   ├── sync/             # Sync engine + SSE client + data transforms
│   ├── types/            # TypeScript types (BlueBubbles API, DB models, API contracts)
│   └── utils/            # Formatting, phone normalization, haversine distance
├── routes/
│   ├── api/
│   │   ├── proxy/[...path]/       # Catch-all proxy to imessage-rs
│   │   ├── webhook/               # Receives webhook POSTs from imessage-rs
│   │   ├── events/                # SSE stream to browser
│   │   ├── contacts/              # Contact map from AddressBook SQLite
│   │   ├── me/                    # Current user name + photo via osascript
│   │   ├── scheduled-messages/    # CRUD via imcore-bridge binary
│   │   ├── plist/pinned/          # Pinned chats via pinned-chats binary
│   │   ├── geocode/               # Reverse geocoding via reverse-geocode binary
│   │   ├── chat-previews/         # Retracted message preview overrides
│   │   ├── message-eligibility/   # Edit/unsend time windows
│   │   └── unread-counts/         # Per-chat unread counts from chat.db
│   ├── messages/                  # iMessage UI (ChatList + ChatView)
│   └── findmy/                    # Find My UI (map, sidebar, detail panel)
scripts/
├── build-release.sh               # Build self-extracting archive
└── start.sh                       # Production orchestrator
```

### Tech Stack

| Layer           | Technology                                                               |
| --------------- | ------------------------------------------------------------------------ |
| Frontend        | SvelteKit 2, Svelte 5 (runes: `$state`, `$derived`, `$effect`, `$props`) |
| Styling         | Tailwind CSS 4 (via Vite plugin, zero-config)                            |
| Offline storage | Dexie.js 4 (IndexedDB with `liveQuery` for reactive subscriptions)       |
| Maps            | Leaflet 1.9 (CartoDB, ArcGIS tile layers)                                |
| Server          | SvelteKit adapter-node on Node.js 22                                     |
| Real-time       | SSE (Server-Sent Events) via custom `EventBroadcaster`                   |
| Native bridge   | imessage-rs (Rust) + 3 Swift binaries                                    |
| Testing         | Vitest 4 (Node + browser projects), Playwright                           |
| Formatting      | Prettier with Svelte and Tailwind plugins                                |

### Authentication

No login flow. Access is controlled by IP allowlist in `src/hooks.server.ts`:

- `127.0.0.1` / `::1` (localhost)
- `100.64.0.0/10` (Tailscale CGNAT range)

All other IPs get a 403.

### Build

```sh
pnpm build        # Vite builds to build/
node build         # Run the production server (reads env vars at runtime)
```

### Testing

```sh
pnpm vitest run --project server    # Server-side unit tests (Node)
pnpm vitest run --project client    # Component tests (Chromium via Playwright)
pnpm test:unit -- --run             # Both
pnpm test:e2e                       # End-to-end (Playwright)
pnpm test                           # Everything
```

### Releasing a New Version

```sh
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions (`release.yml`) runs on a macOS 15 runner and:

1. Compiles the 3 Swift binaries with ad-hoc signing
2. Downloads the latest imessage-rs release binary
3. Builds SvelteKit (`pnpm build`)
4. Packages everything into a self-extracting archive via `build-release.sh`
5. Uploads `webmessages-v1.0.0` to GitHub Releases

To build a release locally:

```sh
bash scripts/build-release.sh --version v1.0.0
# Output: dist/webmessages-v1.0.0 (~9 MB)
```

### CI

- **`ci.yml`** runs on every push to `master` and on PRs: lint, type-check, server unit tests, build verification (Ubuntu, no macOS needed)
- **`release.yml`** runs on `v*` tags: full macOS build + release (macOS 15 runner)

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run `pnpm test` and `pnpm lint`
5. Open a pull request

## License

This project is not yet licensed. Contact the maintainer for usage terms.

# webMessages

A web client for **iMessage** and **Find My**, powered by [imessage-rs](https://github.com/jesec/imessage-rs). Access your messages and locate your devices from any browser on your Tailscale network -- no Apple device required on the viewing end.

## Features

- **Full iMessage client** -- send and receive text, reactions, replies, edits, unsend, and attachments
- **Find My** -- view device and friend locations on an interactive Leaflet map
- **Local-first** -- IndexedDB mirror via Dexie for instant conversation switching and offline reads
- **Real-time** -- Server-Sent Events for live message delivery
- **Private** -- Tailscale VPN only; zero public internet exposure

## Architecture

```
┌──────────────── Docker Compose ────────────────┐
│  ┌───────────┐    ┌──────────────────────────┐ │
│  │ Tailscale │───>│ SvelteKit (adapter-node)  │ │
│  │ sidecar   │    │                           │ │
│  └───────────┘    │  /api/proxy/* -> imsg-rs  │ │
│                   │  /api/events  -> SSE       │ │
│                   │  /webhook     -> receiver  │ │
│                   └─────────┬─────────────────┘ │
└─────────────────────────────┼───────────────────┘
                              │ host.docker.internal:1234
                              v
                   ┌──────────────────┐
                   │   imessage-rs    │
                   │  (native macOS)  │
                   └──────────────────┘
```

The SvelteKit app runs inside Docker alongside a Tailscale sidecar that gives it a stable hostname on your tailnet (e.g. `https://webmessages.<tailnet>.ts.net`). All iMessage and Find My operations are proxied to **imessage-rs**, which runs natively on your Mac and talks directly to macOS frameworks.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | SvelteKit 5, Svelte 5 (runes), Tailwind CSS 4 |
| Offline storage | Dexie.js (IndexedDB) |
| Maps | Leaflet.js |
| Backend | SvelteKit adapter-node, SSE |
| Native bridge | imessage-rs |
| Infrastructure | Docker, Tailscale |
| Testing | Vitest, Playwright |

## Prerequisites

### macOS host requirements

1. **macOS Sequoia 15+ or Tahoe 26+** (required by imessage-rs)

2. **Disable System Integrity Protection (SIP)** -- imessage-rs needs access to protected macOS frameworks.

   Boot into Recovery Mode (hold Power on Apple Silicon, or Cmd+R on Intel), open Terminal, and run:
   ```sh
   csrutil disable
   ```
   Reboot back into macOS.

3. **Grant Full Disk Access** -- imessage-rs reads `~/Library/Messages/chat.db` and Find My caches.

   Go to **System Settings > Privacy & Security > Full Disk Access** and add your terminal app (or the imessage-rs binary).

4. **Docker Desktop** installed with `host.docker.internal` support (enabled by default).

5. **A Tailscale account** with an auth key. Generate one at [Tailscale Admin Console](https://login.tailscale.com/admin/settings/keys).

### Install imessage-rs

```sh
cargo install imessage-rs
```

Or build from source:
```sh
git clone https://github.com/jesec/imessage-rs.git
cd imessage-rs
cargo build --release
```

Start it on the default port:
```sh
imessage-rs --password <your-secret-token>
```

This starts the API server on `http://127.0.0.1:1234`. Keep it running -- the Docker container connects to it via `host.docker.internal`.

## Quick Start (Docker Compose)

1. **Clone the repository**
   ```sh
   git clone https://github.com/pandoks/webMessages.git
   cd webMessages
   ```

2. **Configure environment**
   ```sh
   cp .env.example .env
   ```

   Edit `.env`:
   ```sh
   IMESSAGE_RS_PASSWORD=your-secret-token   # Must match the --password flag above
   TS_AUTHKEY=tskey-auth-...                 # Tailscale auth key
   ```

3. **Start the stack**
   ```sh
   docker compose up -d
   ```

   This launches two containers:
   - **web** -- SvelteKit app on port 3000 (internal)
   - **tailscale** -- Sidecar that joins your tailnet and serves HTTPS on port 443

4. **Open in your browser**

   Visit `https://webmessages.<your-tailnet>.ts.net` from any device on your Tailscale network.

### Using the pre-built image

Tagged releases are published to GitHub Container Registry:

```sh
docker pull ghcr.io/pandoks/webmessages:latest
```

You can replace the `build: .` line in `docker-compose.yml` with:
```yaml
image: ghcr.io/pandoks/webmessages:latest
```

## Development

### Local setup

```sh
pnpm install
cp .env.example .env   # fill in IMESSAGE_RS_PASSWORD
pnpm dev
```

The dev server starts at `http://localhost:5173`. It expects imessage-rs running on `http://127.0.0.1:1234` (configurable via `IMESSAGE_RS_URL`).

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `IMESSAGE_RS_URL` | `http://127.0.0.1:1234` | imessage-rs server URL |
| `IMESSAGE_RS_PASSWORD` | *(required)* | API password for imessage-rs |
| `TS_AUTHKEY` | *(Docker only)* | Tailscale auth key for the sidecar container |

### Project Structure

```
src/
├── lib/
│   ├── components/    # Svelte 5 UI components
│   ├── db/            # Dexie IndexedDB schema and queries
│   ├── server/        # Server-only code (API client, auth)
│   ├── stores/        # Svelte stores
│   ├── sync/          # Client-side sync engine
│   ├── types/         # TypeScript type definitions
│   └── utils/         # Transform and helper utilities
├── routes/
│   ├── api/
│   │   ├── proxy/[...path]/  # Catch-all proxy to imessage-rs
│   │   ├── events/           # SSE endpoint
│   │   └── webhook/          # Webhook receiver from imessage-rs
│   ├── messages/             # iMessage UI
│   └── findmy/               # Find My UI
```

### Build

```sh
pnpm build           # Produces Node.js server in build/
node build            # Run the production server
```

## Testing

### Unit and component tests

```sh
# Server-side unit tests
pnpm vitest run --project server

# Client-side component tests (uses Playwright browser)
pnpm vitest run --project client

# Both at once
pnpm test:unit -- --run
```

### End-to-end tests

```sh
pnpm test:e2e
```

### All tests

```sh
pnpm test
```

### CI

GitHub Actions runs lint, type-check, server unit tests, and build on every push to `master` and on pull requests. Docker images are built and pushed to GHCR on version tags (`v*`).

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run the test suite (`pnpm test`)
5. Run the linter and formatter (`pnpm lint && pnpm format`)
6. Commit and push
7. Open a pull request

## License

This project is not yet licensed. Contact the maintainer for usage terms.

#!/usr/bin/env bash
# Build a self-extracting .run archive for webMessages
# Usage: bash scripts/build-release.sh [--version v1.0.0] [--skip-compile]
# Output: dist/webmessages-<version> (self-extracting executable)
#
# --skip-compile: skip Swift/imessage-rs compilation and SvelteKit build.
#   Expects dist/bin/ and build/ to already exist (used by GHA where
#   compilation happens in earlier workflow steps).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PROJECT_ROOT/dist"
STAGE_DIR="$DIST_DIR/stage"
CACHE_DIR="$DIST_DIR/cache"

# ── Colors ──────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { printf "${CYAN}[build]${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}[done]${NC}  %s\n" "$*"; }
die()   { printf "${RED}[error]${NC} %s\n" "$*"; exit 1; }

# ── Parse args ──────────────────────────────────────────
VERSION=""
SKIP_COMPILE=false
while [[ $# -gt 0 ]]; do
	case "$1" in
		--version) VERSION="$2"; shift 2 ;;
		--skip-compile) SKIP_COMPILE=true; shift ;;
		*) die "Unknown argument: $1" ;;
	esac
done

if [[ -z "$VERSION" ]]; then
	VERSION=$(git -C "$PROJECT_ROOT" describe --tags --always 2>/dev/null || echo "dev")
fi

echo ""
printf "${BOLD}Building webMessages $VERSION${NC}\n"
echo "=============================="
echo ""

# ── Clean staging area ────────────────────────────────
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/bin" "$STAGE_DIR/web"

if [[ "$SKIP_COMPILE" == true ]]; then
	# ── GHA mode: binaries and build already exist ──────
	info "Skip-compile mode: using pre-built artifacts"

	# Copy pre-compiled binaries from dist/bin/
	[[ -d "$DIST_DIR/bin" ]] || die "dist/bin/ not found — compile binaries first"
	cp "$DIST_DIR/bin/"* "$STAGE_DIR/bin/"
	chmod +x "$STAGE_DIR/bin/"*
	ok "Binaries copied from dist/bin/"

	# Copy SvelteKit build
	[[ -d "$PROJECT_ROOT/build" ]] || die "build/ not found — run pnpm build first"
	cp -R "$PROJECT_ROOT/build" "$STAGE_DIR/web/build"
	ok "SvelteKit build copied"
else
	# ── Local mode: compile everything ──────────────────
	info "Checking build prerequisites..."
	command -v swiftc >/dev/null 2>&1 || die "swiftc not found — install Xcode Command Line Tools"
	command -v node >/dev/null 2>&1   || die "node not found — install Node.js 22+"
	command -v pnpm >/dev/null 2>&1   || die "pnpm not found — run: corepack enable"
	command -v codesign >/dev/null 2>&1 || die "codesign not found"

	cd "$PROJECT_ROOT"
	mkdir -p "$CACHE_DIR"

	# Compile Swift binaries
	info "Compiling Swift binaries (ad-hoc signing)..."

	swiftc src/lib/server/imcore-bridge.swift \
		-o "$STAGE_DIR/bin/imcore-bridge" \
		-framework Foundation -lsqlite3
	codesign --sign - \
		--entitlements src/lib/server/imcore-bridge.entitlements \
		--force \
		"$STAGE_DIR/bin/imcore-bridge"
	ok "imcore-bridge"

	swiftc src/lib/server/pinned-chats.swift \
		-o "$STAGE_DIR/bin/pinned-chats" \
		-framework Foundation
	ok "pinned-chats"

	swiftc src/lib/server/reverse-geocode.swift \
		-o "$STAGE_DIR/bin/reverse-geocode" \
		-framework CoreLocation
	ok "reverse-geocode"

	# Download imessage-rs
	IMESSAGERS_BIN="$CACHE_DIR/imessage-rs"

	if [[ -x "$IMESSAGERS_BIN" ]]; then
		info "Using cached imessage-rs binary"
	else
		info "Downloading imessage-rs..."

		ARCH=$(uname -m)
		case "$ARCH" in
			arm64) RUST_TARGET="aarch64-apple-darwin" ;;
			x86_64) RUST_TARGET="x86_64-apple-darwin" ;;
			*) die "Unsupported architecture: $ARCH" ;;
		esac

		# Get latest release tag
		TAG=$(curl -sf https://api.github.com/repos/jesec/imessage-rs/releases/latest \
			| python3 -c "import sys,json; print(json.load(sys.stdin)['tag_name'])" 2>/dev/null || true)

		DOWNLOADED=false
		if [[ -n "$TAG" ]]; then
			URL="https://github.com/jesec/imessage-rs/releases/download/${TAG}/imessage-rs-${RUST_TARGET}.tar.gz"
			if curl -sfL "$URL" -o "$CACHE_DIR/imessage-rs.tar.gz" 2>/dev/null; then
				tar -xzf "$CACHE_DIR/imessage-rs.tar.gz" -C "$CACHE_DIR/"
				rm "$CACHE_DIR/imessage-rs.tar.gz"
				DOWNLOADED=true
				ok "Downloaded imessage-rs $TAG"
			fi
		fi

		if [[ "$DOWNLOADED" == false ]]; then
			if command -v cargo >/dev/null 2>&1; then
				info "GitHub download failed — building from cargo..."
				cargo install imessage-rs --root "$CACHE_DIR" --quiet
				mv "$CACHE_DIR/bin/imessage-rs" "$CACHE_DIR/imessage-rs"
				rm -rf "$CACHE_DIR/bin" "$CACHE_DIR/.crates.toml" "$CACHE_DIR/.crates2.json"
				ok "Built imessage-rs from cargo"
			else
				die "Could not download imessage-rs and cargo is not available"
			fi
		fi
	fi

	cp "$IMESSAGERS_BIN" "$STAGE_DIR/bin/imessage-rs"
	chmod +x "$STAGE_DIR/bin/imessage-rs"

	# Build SvelteKit
	info "Installing dependencies..."
	pnpm install --frozen-lockfile

	info "Building SvelteKit..."
	IMESSAGE_RS_PASSWORD=build-placeholder pnpm build

	cp -R "$PROJECT_ROOT/build" "$STAGE_DIR/web/build"
	ok "SvelteKit build"
fi

# ── Copy supporting files ─────────────────────────────
cp "$PROJECT_ROOT/scripts/start.sh" "$STAGE_DIR/start.sh"
cp "$PROJECT_ROOT/src/lib/server/imcore-bridge.entitlements" "$STAGE_DIR/entitlements.plist"
chmod +x "$STAGE_DIR/start.sh"

# ── Create self-extracting archive ─────────────────────
info "Creating self-extracting archive..."

OUTPUT="$DIST_DIR/webmessages-${VERSION}"

# Create the tarball
TARBALL="$DIST_DIR/payload.tar.gz"
tar -czf "$TARBALL" -C "$STAGE_DIR" .

# Write the self-extracting header
cat > "$OUTPUT" <<'HEADER'
#!/usr/bin/env bash
# webMessages — self-extracting launcher
# Run: chmod +x webmessages && ./webmessages

set -euo pipefail

WEBMESSAGES_HOME="$HOME/.webmessages"

echo "Extracting webMessages to $WEBMESSAGES_HOME ..."
mkdir -p "$WEBMESSAGES_HOME/bin" "$WEBMESSAGES_HOME/web"

# Extract the archive payload after the __ARCHIVE__ marker
SKIP=$(awk '/^__ARCHIVE__$/{print NR + 1; exit 0; }' "$0")
tail -n +"$SKIP" "$0" | base64 -D | tar -xz -C "$WEBMESSAGES_HOME"

# Strip macOS quarantine attribute (set when downloading from internet)
xattr -dr com.apple.quarantine "$WEBMESSAGES_HOME/bin/" 2>/dev/null || true
chmod +x "$WEBMESSAGES_HOME/bin/"* "$WEBMESSAGES_HOME/start.sh"

# Re-sign imcore-bridge with ad-hoc identity + entitlements
codesign --sign - \
  --entitlements "$WEBMESSAGES_HOME/entitlements.plist" \
  --force \
  "$WEBMESSAGES_HOME/bin/imcore-bridge" 2>/dev/null || true

# Start
exec bash "$WEBMESSAGES_HOME/start.sh"
__ARCHIVE__
HEADER

# Append the base64-encoded tarball
base64 < "$TARBALL" >> "$OUTPUT"
chmod +x "$OUTPUT"

# Clean up
rm "$TARBALL"
rm -rf "$STAGE_DIR"

# ── Done ──────────────────────────────────────────────
SIZE=$(du -h "$OUTPUT" | cut -f1)
echo ""
echo "=============================="
ok "Built: $OUTPUT ($SIZE)"
echo ""
info "To test: ./dist/webmessages-${VERSION}"
echo ""

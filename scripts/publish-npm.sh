#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/publish-npm.sh
#
# Build, test, validate, and publish all @arclayer packages to npm.
#
# Usage:
#   NPM_TOKEN=<token> bash scripts/publish-npm.sh --tag next
#   NPM_TOKEN=<token> bash scripts/publish-npm.sh --tag latest
#   NPM_TOKEN=<token> bash scripts/publish-npm.sh --dry-run
#
# Environment:
#   NPM_TOKEN   (required) npm authentication token with publish scope
#
# Safety:
#   - Never writes NPM_TOKEN to repo .npmrc
#   - Never prints NPM_TOKEN
#   - Uses temporary .npmrc outside repo for auth
#   - Aborts on test failure, build failure, pack validation failure
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Color helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[publish]${NC} $*"; }
ok()   { echo -e "${GREEN}[  ok  ]${NC} $*"; }
warn() { echo -e "${YELLOW}[ warn ]${NC} $*"; }
fail() { echo -e "${RED}[FATAL]${NC} $*"; exit 1; }

# ── Argument parsing ─────────────────────────────────────────────────────────
TAG="next"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)     TAG="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *)         fail "Unknown arg: $1" ;;
  esac
done

if [[ "$TAG" != "next" && "$TAG" != "latest" ]]; then
  fail "--tag must be 'next' or 'latest'"
fi

# ── NPM_TOKEN check ──────────────────────────────────────────────────────────
if [[ -z "${NPM_TOKEN:-}" ]]; then
  fail "NPM_TOKEN is required. Export it before running this script."
fi

# ── Repo root ────────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
log "Working directory: $REPO_ROOT"

# ── Forbidden content patterns ───────────────────────────────────────────────
FORBIDDEN_PATTERNS=(
  ".env"
  ".env.local"
  ".env.production"
  "npm_token"
  "NPM_TOKEN"
  "private_key"
  "seed_phrase"
  "seed.phrase"
  "otp"
  "config.json"
  "policy.json"
  "receipts.jsonl"
  "ledger.jsonl"
  "node_modules"
  "coverage"
  "screenshots"
)

# Forbidden dependency specs in packed package.json
# NOTE: workspace:^ is ALLOWED — pnpm auto-replaces with ^version at publish time
FORBIDDEN_DEP_PATTERNS=(
  "workspace:*"
  "workspace:~"
  "link:"
  "file:"
)

# Publishable packages in dependency order
PACKAGES=(
  "sdk"
  "packages/runner-core"
  "packages/circle-cli-adapter"
  "apps/arclayer-runner"
  "packages/arclayer-setup"
)

# ── Step 1: Build ────────────────────────────────────────────────────────────
log "Step 1: Building all publishable packages..."
npm run build:publish
ok "Build complete"

# ── Step 2: Tests ────────────────────────────────────────────────────────────
log "Step 2: Running tests..."
npm run test:publish
ok "Tests passed"

# ── Step 3: Pack dry-run + validation ────────────────────────────────────────
log "Step 3: Running pnpm pack --dry-run for each package..."

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

TEMP_PACK_DIR="$(mktemp -d)"

for pkg_dir in "${PACKAGES[@]}"; do
  pkg_name="$(node -e "console.log(require('./$pkg_dir/package.json').name)")"
  log "  Packing $pkg_name ($pkg_dir)..."

  # Use pnpm pack (not npm pack) to correctly resolve workspace:^ → ^version
  PACK_OUTPUT="$(cd "$pkg_dir" && pnpm pack --pack-destination "$TEMP_PACK_DIR" 2>&1)"
  TARBALL="$(ls "$TEMP_PACK_DIR"/*.tgz 2>/dev/null | head -1)"

  # ── 3a: Extract packed package.json and check for forbidden deps ──
  if [[ -n "$TARBALL" ]]; then
    EXTRACT_DIR="$TEMP_PACK_DIR/extract"
    mkdir -p "$EXTRACT_DIR"
    tar -xzf "$TARBALL" -C "$EXTRACT_DIR"
    PACKED_PKG="$EXTRACT_DIR/package/package.json"

    for pattern in "${FORBIDDEN_DEP_PATTERNS[@]}"; do
      if grep -qE "\"$pattern" "$PACKED_PKG" 2>/dev/null; then
        fail "$pkg_name: PACKED package.json contains forbidden dependency spec '$pattern'"
      fi
    done

    # ── 3b: Check packed file list for forbidden files ──
    FILE_LIST="$(tar -tzf "$TARBALL" 2>/dev/null)"
    for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
      if echo "$FILE_LIST" | grep -qi "$pattern"; then
        fail "$pkg_name: packed files contain forbidden pattern '$pattern'"
      fi
    done

    rm -rf "$EXTRACT_DIR"
    rm -f "$TARBALL"
  fi

  # ── 3c: Save pack output for reporting ──
  echo "$PACK_OUTPUT" > "$TEMP_DIR/${pkg_name//\//_}_pack.txt"

  ok "  $pkg_name pack validation passed"
done

rm -rf "$TEMP_PACK_DIR"

ok "All pack validations passed"

# ── Step 4: Verify no workspace:* in any package.json ────────────────────────
log "Step 4: Final check for workspace:*, link:, file: in package.json files..."
for pkg_dir in "${PACKAGES[@]}"; do
  pkg_name="$(node -e "console.log(require('./$pkg_dir/package.json').name)")"
  # workspace:^ is fine — pnpm replaces with ^version at publish time
  if grep -qE '"(workspace:\*|workspace:~|link:|file:)' "$pkg_dir/package.json"; then
    fail "$pkg_name still has bad workspace/link/file dependency — fix before publish"
  fi
done
ok "No bad workspace/link/file specs found (workspace:^ is allowed)"

# ── Step 5: Publish ──────────────────────────────────────────────────────────
log "Step 5: Publishing to npm with tag '$TAG'..."

if [[ "$DRY_RUN" == "true" ]]; then
  warn "DRY RUN — skipping actual publish"
else
  # Save existing .npmrc, add auth token temporarily, restore after
  HOME_NPMRC="$HOME/.npmrc"
  NPMRC_BACKUP=""
  if [[ -f "$HOME_NPMRC" ]]; then
    NPMRC_BACKUP="$(cat "$HOME_NPMRC")"
  fi

  # Append auth token (preserve existing content)
  if ! grep -q "_authToken" "$HOME_NPMRC" 2>/dev/null; then
    printf "\n//registry.npmjs.org/:_authToken=%s\n" "$NPM_TOKEN" >> "$HOME_NPMRC"
  fi

  # Restore .npmrc on exit
  restore_npmrc() {
    if [[ -n "$NPMRC_BACKUP" ]]; then
      printf "%s\n" "$NPMRC_BACKUP" > "$HOME_NPMRC"
    else
      rm -f "$HOME_NPMRC"
    fi
  }
  trap restore_npmrc EXIT

  for pkg_dir in "${PACKAGES[@]}"; do
    pkg_name="$(node -e "console.log(require('./$pkg_dir/package.json').name)")"
    pkg_version="$(node -e "console.log(require('./$pkg_dir/package.json').version)")"
    log "  Publishing $pkg_name@$pkg_version (tag: $TAG)..."

    pnpm publish \
      --access public \
      --tag "$TAG" \
      --no-git-checks \
      "$pkg_dir"

    ok "  Published $pkg_name@$pkg_version"
  done

  # Restore .npmrc
  restore_npmrc
  trap - EXIT
fi

# ── Step 6: Verify ──────────────────────────────────────────────────────────
log "Step 6: Verifying published packages..."

if [[ "$DRY_RUN" == "true" ]]; then
  warn "DRY RUN — skipping npm view verification"
else
  for pkg_dir in "${PACKAGES[@]}"; do
    pkg_name="$(node -e "console.log(require('./$pkg_dir/package.json').name)")"
    pkg_version="$(node -e "console.log(require('./$pkg_dir/package.json').version)")"

    if [[ "$TAG" == "next" ]]; then
      VIEW_CMD="npm view $pkg_name@next version"
    else
      VIEW_CMD="npm view $pkg_name version"
    fi

    PUBLISHED_VERSION="$(eval "$VIEW_CMD" 2>/dev/null || echo "NOT FOUND")"

    if [[ "$PUBLISHED_VERSION" == "$pkg_version" ]]; then
      ok "  $pkg_name@$PUBLISHED_VERSION verified on npm"
    else
      warn "  $pkg_name expected $pkg_version but got $PUBLISHED_VERSION"
    fi
  done
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "─────────────────────────────────────────────────────────────"
echo "  Publish Summary (tag: $TAG, dry_run: $DRY_RUN)"
echo "─────────────────────────────────────────────────────────────"
for pkg_dir in "${PACKAGES[@]}"; do
  pkg_name="$(node -e "console.log(require('./$pkg_dir/package.json').name)")"
  pkg_version="$(node -e "console.log(require('./$pkg_dir/package.json').version)")"
  echo "  $pkg_name@$pkg_version"
done
echo "─────────────────────────────────────────────────────────────"

if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo "  Dry run complete. No packages were published."
  echo "  To publish for real:"
  echo "    NPM_TOKEN=\$NPM_TOKEN bash scripts/publish-npm.sh --tag $TAG"
fi

echo ""
echo "  Verify with:"
echo "    npm view @arclayer/setup@$TAG version"
echo "    npx -y @arclayer/setup@$TAG --help"
echo ""

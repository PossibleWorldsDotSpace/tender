#!/usr/bin/env bash
# verify-clean-install.sh
# ----------------------------------------------------------------------------
# Run the published-tarball install path inside a clean Docker container.
# Catches the class of bug where a fresh user runs `npm i -g
# @possibleworlds/tender` and something Tender expected (a font, a
# template, a transitive dep) wasn't packed.
#
# What this verifies:
#
#   1. `npm pack` from packages/cli/ produces a tarball that installs cleanly
#      on a fresh node:20 image with no prior puppeteer Chromium cache.
#   2. The `tender` binary lands on $PATH after the global install.
#   3. `tender --version` and `tender --help` work.
#   4. `tender init --example open-circle` scaffolds without error.
#   5. `tender build` produces a non-empty PDF.
#
# What this *doesn't* verify:
#
#   - macOS / Windows install paths (Docker is Linux-only).
#   - The actual npm registry round-trip (we install from the local tarball,
#     not from registry.npmjs.org). The release workflow handles the live path.
#
# Usage: from the repo root,
#
#     ./scripts/verify-clean-install.sh
#
# Exit code is non-zero if any step fails.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Building @possibleworlds/tender"
pnpm --filter @possibleworlds/tender build > /tmp/tender-build.log 2>&1 || {
  echo "build failed; see /tmp/tender-build.log" >&2
  exit 1
}

echo "==> Packing tarball"
TARBALL_DIR="$(mktemp -d)"
trap 'rm -rf "$TARBALL_DIR"' EXIT
cd packages/cli
TARBALL="$(npm pack --pack-destination "$TARBALL_DIR" --silent)"
TARBALL_PATH="$TARBALL_DIR/$TARBALL"
cd "$REPO_ROOT"
echo "    $TARBALL_PATH ($(du -h "$TARBALL_PATH" | cut -f1))"

echo "==> Running in clean node:20 container"
docker run --rm \
  -v "$TARBALL_PATH:/tender.tgz:ro" \
  --workdir /work \
  node:20 \
  bash -c '
    set -euo pipefail

    echo "----> Node version: $(node --version)"
    echo "----> npm version:  $(npm --version)"

    echo "----> Install Chromium runtime deps (per README Linux requirements)"
    apt-get update -qq > /dev/null
    DEBIAN_FRONTEND=noninteractive apt-get install -qq -y \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
      libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
      libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
      > /dev/null

    echo "----> Global install from tarball"
    npm install -g /tender.tgz

    echo "----> tender --version"
    tender --version

    echo "----> tender --help (first 5 lines)"
    tender --help | head -5

    echo "----> tender init --example open-circle"
    mkdir -p /work/sample
    cd /work/sample
    tender init --example open-circle \
      --no-skill --no-git --no-commit \
      --no-configure-page --no-configure-tokens

    echo "----> tender build --pdf-only"
    tender build --pdf-only

    echo "----> verify PDF exists and is non-empty"
    ls -la out/
    test -s out/content.pdf

    echo "----> Done."
  '

echo
echo "==> SUCCESS: clean-machine install path produced a PDF."

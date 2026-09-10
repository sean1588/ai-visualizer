#!/usr/bin/env bash
# Idempotent dependency + build bootstrap for the Mise (ai-visualizer) repo.
# Safe to re-run: every step converges to the same state.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> lambda: install, build"
cd "$repo_root/lambda"
npm ci
npm run build

echo "==> lambda: Playwright chromium (regression suite driver)"
# --with-deps pulls the OS libraries the headless browser needs. The npm test
# script also runs `playwright install chromium`, so this just warms the cache.
npx playwright install --with-deps chromium

echo "==> infra: install (Pulumi program deps)"
cd "$repo_root/infra"
npm ci

echo "==> install complete"

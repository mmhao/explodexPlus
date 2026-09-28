#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Repo toolchain needs bun, but never a *system* bun: the package.json devDependency
# (installed by npm or pnpm) is the source of truth.
if [[ -x "node_modules/.bin/bun" ]]; then
  BUN="node_modules/.bin/bun"
elif command -v bun >/dev/null 2>&1; then
  BUN="bun"
else
  echo "bun not found; run 'pnpm install' (or 'npm install') — bun ships as a repo devDependency" >&2
  exit 1
fi

for script in scripts/*.sh; do
  output="$(zsh -n "$script" 2>&1)" || {
    print -r -- "$output" >&2
    exit 1
  }
  if [[ -n "$output" ]]; then
    print -r -- "$output" | sed '/nice(5) failed: operation not permitted/d'
  fi
done

for ts in scripts/cdp-inject.ts scripts/dev.ts scripts/package-app.ts scripts/build-npm.ts; do
  "$BUN" -e "import './${ts}'"
done

for file in sdk/explodex-sdk.js plugins/*/*.js; do
  "$BUN" build "$file" --outfile="/tmp/explodex-validate-$(basename "$file")"
done

for json in package.json .mcp.json plugins/*/plugin.json; do
  "$BUN" -e "JSON.parse(await Bun.file('$json').text())"
done

"$BUN" run format:check
"$BUN" run --bun tsc -p sdk/tsconfig.json
"$BUN" run typecheck
"$BUN" run build:npm
"$BUN" test
node scripts/check-docs.mjs

echo "validate ok"

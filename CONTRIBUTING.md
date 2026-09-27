# Contributing

Thanks for helping improve Explodex Plus!

## Before you start

- Read [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) — the selector registry and verified Codex versions.
- For plugin ideas/bug reports, open an issue first; "broken after a Codex update" has a dedicated template.

## Dev setup

Requirements: Node ≥ 22, [Bun](https://bun.sh) ≥ 1.3 (dev/build only — runtime is plain Node).

```sh
bun install
bun test              # unit tests (cross-platform)
bun run validate      # full gate: syntax, JSON, typecheck, build, tests (macOS/zsh)
```

On Windows, run the pieces CI runs there:

```sh
bun run --bun tsc -p tsconfig.plugins.json
bun test
```

The full interactive dev loop (`bun run dev`) is macOS-only for now, but the CLI works cross-platform:

```sh
node bin/explodex.mjs inject    # inject into a Codex already running with --remote-debugging-port
```

## Adding or changing a plugin

Plugins are a folder in `plugins/` with `plugin.json` + scripts; see [docs/sdk-api.md](docs/sdk-api.md) and copy `plugins/project-groups/` as the closest reference (it has a pure `logic.js` core + a DOM `index.js` layer + unit tests in `test/`).

Conventions this repo follows:

- **Pure logic lives in `logic.js`**, attached to `globalThis`, unit-tested without DOM. DOM layers only wire observers/menus.
- **Target `data-testid` / accessible text, never generated CSS classes** — see COMPATIBILITY.md for why.
- **Reconcile must be idempotent** and never wrap React-owned nodes; move/reorder siblings only.
- Every plugin returns a teardown function that removes all DOM it added.

## Pull requests

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`…).
- CI must be green on both jobs (macOS validate + Windows tests/pack).
- If you touched selectors or launch behavior, update [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) in the same PR.

## Keeping in sync with upstream

This is a fork of [dan-dr/explodex](https://github.com/dan-dr/explodex). Rebase onto upstream regularly to absorb SDK fixes; Windows-specific code should stay confined to `lib/platform/windows.mjs`, `lib/platform.mjs`, and fork plugins.

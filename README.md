# Explodex Plus 💥

**Mod the Codex desktop app on Windows and macOS — without touching the install.**

Explodex Plus is a fork of [explodex](https://github.com/dan-dr/explodex) with a Windows platform adapter and two extra plugins. It extends OpenAI's [Codex](https://openai.com/codex) desktop app via the Chrome DevTools Protocol: the original, signed app is launched with a debug flag and the plugin SDK is injected at runtime. **Nothing in the Codex installation is ever modified**, so app updates never overwrite (or get broken by) your mods. Used BetterDiscord or Legcord? Same idea, for Codex.

🇨🇳 **中文文档见 [README.zh-CN.md](README.zh-CN.md)**（`docs/zh/` 下有全套中文版）。

```sh
npm install -g explodex-plus   # or: pnpm add -g explodex-plus
explodex-plus
```

Requires **Node ≥ 22** (check with `node -v`). The package manager you use to *install* the CLI (npm, pnpm, Bun, Yarn) is a free choice; Node is the runtime.

## What you get

Everything [upstream explodex](https://github.com/dan-dr/explodex) ships (usage glance, project pins/colors, effort shortcuts, the plugin-builder skill, a 💥 Explodex settings page in the sidebar), plus two plugins built for this fork:

| Plugin | What it does |
| ------ | ------------ |
| [Project Groups](plugins/project-groups/) | Wrap sidebar projects into collapsible custom groups (work / personal / …). Group state lives in Explodex storage only — Codex never sees it. |
| [Folder Copy Path](plugins/folder-copy-path/) | Folders in the Files panel get the same copy-path affordance files already have — absolute Windows/POSIX paths on the clipboard. |

## Windows install (3 steps)

1. Install the **Codex desktop app from the Microsoft Store** (it must be the MSIX package; Explodex Plus discovers it at runtime with `Get-AppxPackage` — no hardcoded paths).
2. `npm install -g explodex-plus` (Node ≥ 22), or with pnpm: `pnpm add -g explodex-plus`.
3. Run `explodex-plus`.

It starts Codex with `--remote-debugging-port=9333` (activated through `shell:AppsFolder` so the app keeps its MSIX package identity) and injects the SDK + plugins. You'll be offered a **"Codex (Explodex)" launcher** — a desktop shortcut *and* a Start Menu entry — from then on, start Codex through it whenever you want your mods; the plain Store icon always gives you an unmodified Codex.

### Running from this repo instead

Useful while developing plugins. With **pnpm** (the repo's primary package manager) or npm:

```sh
pnpm install                    # or: npm install — no system Bun needed
node bin/explodex.mjs install   # with Node ≥ 22; creates desktop + Start Menu shortcuts
node bin/explodex.mjs           # launch Codex with SDK + plugins injected
```

Repo tooling (`pnpm test`, `pnpm run validate`, `pnpm run typecheck`, …) drives an internal **Bun devDependency** installed into `node_modules` — you never need Bun on your machine. `check:docs` verifies the English/Chinese documentation mirror (every `docs/*.md` has a `docs/zh/` twin and no relative link is broken).

`install` writes a tiny `~\.explodex\bin\Codex (Explodex).cmd` wrapper and two `.lnk` shortcuts pointing at it. See the FAQ below for where those land on machines with a redirected desktop.

### FAQ

- **Why must I start Codex from the launcher?** The debug flag has to be present at process start. A Codex already running without it can't be injected — the launcher tells you to quit Codex fully (including tray processes) first.
- **I ran `install` but there's no desktop shortcut.** Your Desktop folder is probably redirected away from `%USERPROFILE%\Desktop` (corporate setups and OneDrive tidying move it to e.g. `E:\Desktop`). The launcher reads the real location from the registry (`HKCU\…\User Shell Folders`) and writes there — but a *desktop-organizer app* that paints its own "desktop" view won't show system-desktop icons; add the real Desktop folder to its scope. Junctions/symlinks anywhere along the path are fine (verified).
- **Shortcut opens a console error instead of Codex.** The wrapper first tries the Node install that was active when `install` ran (its absolute path is baked in), then falls back to `node` on PATH. Either both are missing/too old (the CLI needs **Node ≥ 22**) — re-run `install` with a modern Node to refresh the baked path. Moving the repo (when installing from source) or uninstalling that Node version are the usual causes; `install` is idempotent, run it again.
- **`pnpm run format:check` is red right after cloning.** Pre-existing: some fork-owned files are not prettier-clean in the committed tree, unrelated to your install method. Run `pnpm format` to normalize.
- **An update broke a plugin?** Updates never delete your mods; at worst a DOM selector stops matching. Re-launch via the launcher, and check [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) for the selector registry. Prompting Codex with the bundled `explodex-plugin-builder` skill is the intended repair loop.
- **How do I uninstall?** `explodex-plus uninstall` removes the wrapper and both shortcuts (plus `npm rm -g explodex-plus` and, if wanted, `~/.explodex`). The Codex install itself was never touched.
- **Do my login/settings/projects survive?** Yes — Explodex Plus does not override the Electron user-data directory.

## macOS install

Unchanged from upstream — see [docs/installation.md](docs/installation.md). The macOS launcher app (`~/Applications/Explodex.app`) is created by `explodex-plus install`.

## How it works

```
explodex-plus ──► Codex (original binary, +debug flag) ──► CDP :9333
                                                        │
                    lib/cdp-inject.mjs ◄────────────────┘
                        ├─ sdk/explodex-sdk.js   (window.Explodex)
                        └─ plugins/<id>/          (bundled + ~/.explodex/plugins)
```

- **DOM zones** — `aboveComposer`, `sidebar`, `composerActions`, and more
- **Components** — buttons, panels, toasts styled like Codex
- **Bridge** — AppServer router and Electron IPC to Codex internals
- **Plugin manager** — catalog, enable/disable, hot load in dev

Platform differences are isolated in `lib/platform/{macos,windows}.mjs`; everything above is shared.

## Build your own plugin

Run Explodex Plus, install the bundled skill (`explodex-plus install-skill`), and describe what you want to Codex in plain language — the [plugin-builder skill](skills/explodex-plugin-builder/SKILL.md) drives scaffold → SDK hooks → validate → live injection. The [SDK reference](docs/sdk-api.md) keeps the agent on stable surfaces, and the included plugins double as templates (`project-groups` is a good DOM-reconcile example; `folder-copy-path` shows fiber-based data extraction).

## Compatibility & safety

Explodex Plus injects locally into Codex's renderer. It **never modifies** the installed app and runs entirely on your machine. Because it hooks Codex internals, a plugin may need an update when Codex ships a new release — see [docs/sdk-fragility.md](docs/sdk-fragility.md) and the version matrix in [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

Not affiliated with, endorsed by, or supported by OpenAI. Upstream [dan-dr/explodex](https://github.com/dan-dr/explodex) does not declare a license (no LICENSE file, no `license` field), so all rights are reserved by their respective authors by default; this fork inherits that status.

## Docs

Every doc has a Chinese twin under [`docs/zh/`](docs/zh/README.md) (linked below).

| Doc | Contents |
| --- | -------- |
| [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) | **Codex version × plugin matrix, selector registry** |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Injection chain, platform adapter contract, Windows specifics |
| [docs/PLUGIN-DEVELOPMENT.md](docs/PLUGIN-DEVELOPMENT.md) | Fork plugin walkthroughs (project-groups, folder-copy-path) + template |
| [docs/sdk-api.md](docs/sdk-api.md) | SDK API reference (start here for plugin development) |
| [docs/development.md](docs/development.md) | Repo layout, validation, dev loop, commands |
| [docs/installation.md](docs/installation.md) | npm install, launcher states, commands, logs |
| [docs/windows-feasibility.md](docs/windows-feasibility.md) | Upstream spike notes this fork implemented |
| [docs/sdk-fragility.md](docs/sdk-fragility.md) | What breaks across Codex updates |
| [CHANGELOG.md](CHANGELOG.md) | Release history (keep-a-changelog) |

## Credit

All architecture, the SDK, injector, and the original plugins come from [dan-dr/explodex](https://github.com/dan-dr/explodex). This fork adds: the Windows platform adapter (MSIX-identity activation, Store-package discovery, launcher generation), dual-platform CI, and the two plugins above.

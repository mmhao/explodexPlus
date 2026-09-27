# Explodex Plus 💥

**Mod the Codex desktop app on Windows and macOS — without touching the install.**

Explodex Plus is a fork of [explodex](https://github.com/dan-dr/explodex) with a Windows platform adapter and two extra plugins. It extends OpenAI's [Codex](https://openai.com/codex) desktop app via the Chrome DevTools Protocol: the original, signed app is launched with a debug flag and the plugin SDK is injected at runtime. **Nothing in the Codex installation is ever modified**, so app updates never overwrite (or get broken by) your mods. Used BetterDiscord or Legcord? Same idea, for Codex.

```sh
npm install -g explodex-plus
explodex-plus
```

## What you get

Everything [upstream explodex](https://github.com/dan-dr/explodex) ships (usage glance, project pins/colors, effort shortcuts, the plugin-builder skill, a 💥 Explodex settings page in the sidebar), plus two plugins built for this fork:

| Plugin | What it does |
| ------ | ------------ |
| [Project Groups](plugins/project-groups/) | Wrap sidebar projects into collapsible custom groups (work / personal / …). Group state lives in Explodex storage only — Codex never sees it. |
| [Folder Copy Path](plugins/folder-copy-path/) | Folders in the Files panel get the same copy-path affordance files already have — absolute Windows/POSIX paths on the clipboard. |

## Windows install (3 steps)

1. Install the **Codex desktop app from the Microsoft Store** (it must be the MSIX package; Explodex Plus discovers it at runtime with `Get-AppxPackage` — no hardcoded paths).
2. `npm install -g explodex-plus` (Node ≥ 22).
3. Run `explodex-plus`.

It starts Codex with `--remote-debugging-port=9333` (activated through `shell:AppsFolder` so the app keeps its MSIX package identity) and injects the SDK + plugins. You'll be offered a **"Codex (Explodex)" launcher script** — from then on, start Codex through it whenever you want your mods; the plain Store icon always gives you an unmodified Codex.

### FAQ

- **Why must I start Codex from the launcher?** The debug flag has to be present at process start. A Codex already running without it can't be injected — the launcher tells you to quit Codex fully (including tray processes) first.
- **An update broke a plugin?** Updates never delete your mods; at worst a DOM selector stops matching. Re-launch via the launcher, and check [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) for the selector registry. Prompting Codex with the bundled `explodex-plugin-builder` skill is the intended repair loop.
- **How do I uninstall?** Delete the launcher shortcut and `%USERPROFILE%\.explodex` (plus `npm rm -g explodex-plus`). The Codex install itself was never touched.
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

Not affiliated with, endorsed by, or supported by OpenAI. Fork preserved under the [upstream license](LICENSE).

## Docs

| Doc | Contents |
| --- | -------- |
| [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) | **Codex version × plugin matrix, selector registry** |
| [docs/sdk-api.md](docs/sdk-api.md) | SDK API reference (start here for plugin development) |
| [docs/development.md](docs/development.md) | Repo layout, validation, dev loop, commands |
| [docs/installation.md](docs/installation.md) | npm install, launcher states, commands, logs |
| [docs/windows-feasibility.md](docs/windows-feasibility.md) | Upstream spike notes this fork implemented |
| [docs/sdk-fragility.md](docs/sdk-fragility.md) | What breaks across Codex updates |
| [CHANGELOG.md](CHANGELOG.md) | Release history (keep-a-changelog) |

## Credit

All architecture, the SDK, injector, and the original plugins come from [dan-dr/explodex](https://github.com/dan-dr/explodex). This fork adds: the Windows platform adapter (MSIX-identity activation, Store-package discovery, launcher generation), dual-platform CI, and the two plugins above.

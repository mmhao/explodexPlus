# Architecture

How Explodex Plus turns an unmodified Codex desktop app into a plugin host — and what the fork adds for Windows.

## Injection chain (one launch)

```
"Codex (Explodex)" shortcut (.lnk, Desktop + Start Menu)
  └─ %USERPROFILE%\.explodex\bin\Codex (Explodex).cmd   # wrapper: sets EXPLODEX_DEBUG_PORT, runs the CLI
      └─ node bin/explodex.mjs --launch
          └─ lib/launch.mjs → getPlatformAdapter() → lib/platform/windows.mjs (or macos.mjs)
              1. discoverCodex()            — find the install at runtime, never hardcoded
              2. inspectLaunchState()       — four-state check (below); refuses to hand off to a plain Codex
              3. launch with debug port     — Codex starts with --remote-debugging-port=<port>
              4. waitForDebugPort()         — polls http://127.0.0.1:<port>/json/version (≤30 s)
              5. inject()                   — spawns lib/cdp-inject.mjs as a child process
                  ├─ connects to the renderer target over the CDP WebSocket
                  ├─ sets window.__EXPLODEX_PLUGIN_CATALOG__ / __EXPLODEX_PATHS__
                  ├─ evaluates sdk/explodex-sdk.js        → window.Explodex appears
                  └─ evaluates each enabled plugin's scripts (in manifest `scripts` order)
```

Nothing is written into the Codex package at any point. Injection lives only for the debugger session: quit Codex and the app is vanilla again. That is why mods must always be started through the launcher — and why Codex auto-updates can never overwrite them.

## Platform adapter contract

`lib/platform.mjs` selects an adapter by `process.platform` (`darwin`, `win32`). Each adapter exports:

| Export | Responsibility |
| --- | --- |
| `inspectLaunchState(port?)` | Classify the current world into the four-state machine; on Windows, via PowerShell JSON one-liners (`Get-NetTCPConnection`, `Get-CimInstance Win32_Process`, Appx lookup) |
| `launch({port, home})` | Full flow above; returns `{state: "launched" \| "injected" \| "needs-quit", log}` |
| `inject(port, home)` | Spawn the CDP injector against an already-running debug Codex |
| `installedCodexEnvironment(env)` | Env vars the launched Codex inherits (proxy/locale passthrough) |

`decideLaunchState({portListening, portOwnedByCodex, codexRunning})` (pure, in `lib/platform.mjs`) yields:

- `stopped` — start Codex with the debug port, then inject.
- `plain-codex` — Codex is running **without** the flag; it cannot be attached after the fact → prompt to fully quit (tray included). Never silently re-launch: Codex's single-instance lock would hand off to the existing process and drop the flag.
- `debug-codex` — port already owned by Codex → just inject.
- `foreign-port` — some other process holds the port → error with PID/path; use `EXPLODEX_DEBUG_PORT` to move.

## Windows specifics (`lib/platform/windows.mjs`)

The Codex Store app is an MSIX package under the read-only, ACL-protected `C:\Program Files\WindowsApps\`:

- **Install discovery**: `Get-AppxPackage OpenAI.Codex` → `InstallLocation` + package family name, re-resolved every launch (the folder name embeds the version and changes on update).
- **Identity-preserving launch**: starting `app\ChatGPT.exe` by path fails ("该进程没有程序包标识符" — an MSIX exe expects package activation context). The adapter activates through `shell:AppsFolder\<PFN>!App` via the `Shell.Application` COM object, which passes the debug flag while keeping package identity (notifications, taskbar grouping, execution alias all behave normally).
- **Launcher shortcut**: Explorer refuses user-created shortcuts that point into `WindowsApps`, so the .lnk targets a generated `.cmd` wrapper in `~\.explodex\bin\` that calls the CLI, which re-discovers the exe each time. Start Menu + Desktop; `explodex-plus uninstall` removes all three files it owned. Desktop/Start-Menu locations come from the `HKCU\…\User Shell Folders` registry key when it can be read (`resolveUserShellFolder` in `lib/paths.mjs`), falling back to `%USERPROFILE%` joins — machines with a redirected desktop (e.g. `E:\Desktop`) get the shortcut on the *real* desktop. The wrapper bakes in `realpath(process.execPath)` so double-clicks use the Node that installed the launcher, not whatever `node` resolves on PATH (fnm/nvm multishell dirs are resolved to the stable install path); if that path later disappears the wrapper falls back to PATH `node` (≥ 22) instead of dead-ending — re-run `install` after a Node upgrade to refresh.
- **Logs**: `%LOCALAPPDATA%\Explodex\logs\launcher.log`.
- **User data**: `~/.explodex` (plugins, state) — same as macOS; the Electron profile is *not* overridden, so login/settings/projects survive untouched.
- Pure builders (`appxDiscoveryScript`, `parseAppxPackage`, `portOwnerScript`, `activationScript`, `debugPortArg`, shortcut builders…) are unit-tested against canned PowerShell JSON — no real processes in tests.

Documented dead ends (do not retry): AppActivationManager CLSIDs are unregistered on Win11 26100; `codex-command-runner.exe` stdin protocol; direct exe launch. See [COMPATIBILITY.md](COMPATIBILITY.md).

## Plugin model

- A plugin is `plugins/<id>/` with `plugin.json` (`id`, `name`, `scripts: [...]`) plus scripts concatenated in order at injection time. Bundled plugins ship inside the npm package; user plugins in `~/.explodex/plugins/` override same-id bundled ones.
- The SDK (`sdk/explodex-sdk.js`) exposes `window.Explodex`: DOM zones, Codex-styled components, an AppServer/Electron bridge, persisted `storage`, and the plugin manager (enable/disable via the 💥 Explodex sidebar page; enable state defaults in `defaultEnabledState()`).
- Plugin settings/state persist through the bridge's global state, which Codex itself stores in `~/.codex/.codex-global-state.json` under `explodex-*` keys — survives restarts, invisible to Codex.

## Fork plugin layout convention

`project-groups` and `folder-copy-path` both split into:

- `logic.js` — pure, DOM-free core attached to `globalThis` (also used directly by unit tests in `test/`).
- `index.js` — thin DOM layer: MutationObserver + debounced idempotent reconcile, menus, teardown.
- `types.d.ts` — ambient global declaration, checked by `tsconfig.plugins.json` (`bun run --bun tsc -p tsconfig.plugins.json`).

Hard rules (learned live): never wrap or mutate React-owned subtrees — only reorder/hide sibling nodes; target `data-testid`/accessible text, never generated classes; every plugin returns a teardown that leaves zero DOM behind.

## Upstream relationship

Fork of [dan-dr/explodex](https://github.com/dan-dr/explodex) (macOS origin). Windows support is additive: platform selection was the only designed extension point, so `lib/cdp-inject.mjs`, the SDK, upstream plugins, and the CLI remain untouched apart from the rename. Rebase onto upstream to absorb SDK/selector fixes.

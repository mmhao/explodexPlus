# Compatibility

Single source of truth for which Codex builds this fork is verified against,
and every Codex-internal selector each component depends on. When a Codex
update breaks a plugin, start here: find the selector, inspect the new DOM,
fix the candidate list, and record the result in `Verified against`.

## Verified against

| Codex build | Windows | macOS | Notes |
| --- | --- | --- | --- |
| 26.924.2738.0 (MSIX Store) | ✅ full E2E: identity launch, CDP inject, project-groups live-verified, persistence via `~/.codex/.codex-global-state.json` | ⬜ untested by fork | fork base; upstream CI covers macOS |
| 26.924.22138 (owl-app.ini AppVersion) | same installed package | — | `owl-app.ini` reports 26.924.22138; `Get-AppxPackage` reports 26.924.2738.0 |

Legend: ✅ verified · ⬜ not yet verified · ❌ known broken

## Windows platform adapter (`lib/platform/windows.mjs`)

| Dependency | Value / probe | Volatility |
| --- | --- | --- |
| Store package family | `Get-AppxPackage -Name 'OpenAI.Codex'` → `<PFN>!App` AUMID | stable (publisher-controlled) |
| Launch with identity | `(New-Object -ComObject Shell.Application).ShellExecute('shell:AppsFolder\<AUMID>', '--remote-debugging-port=N')` | Windows shell contract |
| UI entry executable | `<InstallLocation>\app\ChatGPT.exe` | process name `ChatGPT`/`Codex*` prefixes |
| Debug endpoint | `http://127.0.0.1:9333/json/*` | Chromium CDP |
| Renderer target | page target with url `app://-/index.html` | Electron app scheme — watch for scheme changes |

Known dead ends (do not retry): direct `Start-Process` of the packaged exe
opens the port but the app aborts with "no package identity";
`IApplicationActivationManager` CLSIDs are not registered on current Windows.

## project-groups

| Selector / attribute | Used for |
| --- | --- |
| `nav[aria-label="Chat history"]` (fallbacks: `aside.app-shell-left-panel nav`, `nav`) | sidebar root |
| `[data-app-action-sidebar-project-id]` | project header rows (stable ids; also `data-app-action-sidebar-project-label`, `-collapsed`) |
| `closest('[class~="group/cwd"]')` (fallback: header itself) | per-project block that gets reordered |
| `storage.globalState` key `explodex-project-groups-state` | persistence (visible in `~/.codex/.codex-global-state.json`) |

## folder-copy-path

| Selector / attribute | Used for |
| --- | --- |
| `[data-app-shell-focus-area="right-panel"]` | Files/Browser/Terminal panel root |
| `[role="treeitem"], [data-file-path], [data-path], [data-folder-path]` | candidate file/folder rows |
| fiber props: `path` / `absolutePath` / `fullPath`, `entry`/`file`/`node`/`item` wrappers, `type:"directory"`, `isFolder`, `children` | path + folder detection (multi-shape on purpose) |
| fiber prop `cwd` (also `workspaceRoot`) | absolute-path join root; seen on Files pane ancestors |
| `aria-expanded` / extensionless label | folder heuristic fallback |

**Not yet live-verified (needs a session with an active runtime):** the Files
tree only populates rows once the project runtime is alive; with an idle
project the pane shows "Select a file from the workspace tree" and the ⌘K file
index reports `No matching files`. Decoration logic is covered by in-page
synthetic fixtures + unit tests; run one message in any local project to
verify against real rows.

## Upstream plugins (inherited selectors)

Upstream explodex plugins (`project-pins`, `project-colors`,
`usage-reset-glance`, `command-menu-threads`, `effort-shortcuts`,
`feature-flags-playground`) depend on their own selectors; see
`docs/plugins/README.md` upstream. Note: the SDK zone selector
`aside[data-testid="app-shell-floating-left-panel"]` **does not match** the
26.924.x live DOM — plugins should fall back to `nav[aria-label="Chat history"]`
(project-groups and project-pins do).

## Repair loop after a Codex update

1. `explodex-plus inject` (or relaunch via the launcher) and open DevTools.
2. Find the failing selector above; inspect the new DOM/fiber.
3. Update the selector candidates in the plugin, add the new build to
   `Verified against`, and note any retired dead ends here.
4. Optional: prompt Codex with the bundled `explodex-plugin-builder` skill to
   run this loop for you.

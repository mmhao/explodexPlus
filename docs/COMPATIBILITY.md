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

Process detection: "Codex is running" must match **only** the UI process
`ChatGPT`. The SYSTEM service `codex-windows-sandbox-service` and the `codex`
CLI share the old prefix regex and wedged the launcher in "Quit Codex first"
state; the filter is an exact `^chatgpt$` match now.

## SDK (`sdk/explodex-sdk.js`, fork-local divergences from upstream)

- **Plugin enabled/disabled map is durable via globalState.** Upstream keeps it
  only in renderer localStorage (`storage.persisted`), which Electron flushes
  lazily — a force-killed renderer loses recent toggles. The fork mirrors the
  map to `storage.globalState` (key `explodex-plugin-enabled`, lands in
  `~/.codex/.codex-global-state.json`) and re-adopts it at boot when
  localStorage disagrees.
- **Upstream footer-strip bug (f/u stray letters).** `ensureFooterPluginStrip`
  mounts into a ~32px-wide `pointer-events-none absolute top-[…]` host in
  26.924.x; `.ex-nav-btn-compact` clips to ~16px, so
  `feature-flags-playground` ("Flags: 53/155") and `usage-reset-glance`
  ("Usage: loading…") render as stray "F"/"U" near the bottom of the sidebar.
  Upstream display bug — until upstream fixes the host width, disable these
  two plugins in the Explodex settings page.

## project-groups

| Selector / attribute | Used for |
| --- | --- |
| `[data-app-action-sidebar-project-id]` → `closest("nav")` | sidebar root (primary — locale-proof) |
| `nav[aria-label="Chat history"]` (fallbacks: `aside.app-shell-left-panel nav`, `nav`) | sidebar root, English UI only |
| `[data-app-action-sidebar-project-id]` | project header rows (stable ids; also `data-app-action-sidebar-project-label`, `-collapsed`) |
| `closest('[class~="group/cwd"]')` (fallback: header itself) | per-project block that gets reordered |
| `storage.globalState` key `explodex-project-groups-state` | persistence (visible in `~/.codex/.codex-global-state.json`) |

**Locale note:** Codex translates the sidebar `aria-label` (zh-CN renders it as
"首页"), and a plain `nav` fallback then picks the icon rail instead of the
projects nav — groups silently disappear. The root is therefore derived from a
project header, which exists in every locale.

Event model: ▦ opens the move menu on `pointerdown` (capture-phase React row
handlers kill `click`), and right-click opens the same menu via a single
document-level capture listener (per-row listeners survive hot re-injection
and serve stale menus). Menu items: Ungrouped + groups only — group creation
lives on the "+ New group" row.

## folder-copy-path

| Selector / attribute | Used for |
| --- | --- |
| `<file-tree-container>` (shadow root) | the tree UI is a custom element; plain queries stop at the host, so scanning pierces `host.shadowRoot` and menus walk `event.composedPath()` |
| `[data-app-shell-focus-area="right-panel"]` | Files/Browser/Terminal panel root |
| **`BUTTON[data-item-path="…/"][data-item-type="folder"]` (verified live)** | the real rows: a virtualized list of DOM buttons with **no React fiber**; the relative path sits in `data-item-path` (trailing `/` ⇒ folder) and `data-item-type` in `folder`/`file` |
| `[role="treeitem"], [data-file-path], [data-path], [data-folder-path]` | older/alternative row shapes |
| any `data-*` attribute whose value contains `/` or `\` | bespoke path props on unknown builds |
| host fiber chain (from `<file-tree-container>`, ~5 hops up): prop `cwd` / `root` / `roots[0]` | absolute-path join root — **not reachable from rows** (they have no fiber); `cwdFor` jumps row → shadow root → host fiber |
| fiber props: `path`/`absolutePath`/`fullPath`/`relPath`/`relativePath`, `entry`/`file`/`node`/`item`/`data` wrappers, `type:"directory"`, `isFolder`, `children`; hook `memoizedState` chains | fiber-backed trees on other builds (multi-shape on purpose) |
| `aria-expanded` / extensionless label | folder heuristic fallback |

Context-menu ("Copy path") works app-wide (right panel **and** chat
diff/changed-files lists) by walking up to 16 `composedPath()` hops from the
right-click and resolving strictly from fiber entry / `data-*` path props —
textContent is never used (root cause of the `...\筛选文件⧉⧉⧉` bug). Rows without
a resolvable absolute path (or without a cwd for relative ones) are skipped;
resolutions and per-hop fiber-key misses land in `window.__explodexFcpDebug`.

Self-reporting triage (when a build's row shape is still unknown): the plugin
captures `window.__explodexFcpShadowDump` once the tree mounts (shadow HTML,
row samples, host + 4 ancestors with fiber prop keys) and
`window.__explodexFcpPathDump` on the first right-click inside the tree
(whole `composedPath()`, per-hop attrs/shadow origin/fiber keys, row text).
Report those two objects after a failed right-click and the extraction can be
patched without another round-trip.

Known issue (mitigated): hot re-injecting a plugin while an old instance is
still alive can race two in-memory state copies and lose a write (observed:
a user group vanished after double injection). Single-instance runs are safe;
prefer launcher restart over repeated `inject` when state churn is involved.

**Live-verified 2026-09-28 (Codex 26.924.2738.0):** folder-copy-path resolves
real shadow-DOM tree rows (`H:\code\own\test\android\images`) with the user's
mouse. Note the Files tree only populates rows once a project session is
active; with an idle project the pane stays empty and there is nothing to
decorate. If a future Codex build regresses this, the
`__explodexFcpShadowDump` / `__explodexFcpPathDump` buffers above capture the
new structure without another debug round-trip.

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

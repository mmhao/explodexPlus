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
- **Footer-strip host resolution (root cause of the "stray F/U letters"
  reports).** `ensureFooterPluginStrip` used to mount into the first
  `[class*="absolute"][class*="bottom-0"]` descendant of the sidebar. In
  26.924.x that is *not* the footer: every project block contains an empty
  drag-drop overlay
  (`div.pointer-events-none.absolute.top-[…].bottom-0.left-0.z-10.w-8` inside
  `[data-sidebar-project-container-id]`) and the shell has a
  `div.group/panel-resizer…bottom-0…w-4` — both match the naive selector and
  precede the real footer in document order. The strip ("Flags: 53/155" from
  feature-flags-playground, "Usage: loading…" from usage-reset-glance)
  rendered inside that ~32 px clipped column, so only the first letters of
  the compact nav buttons leaked — floating over group rows as "F"/"U".
  Fixed in `findSidebarFooterHost` / `isFooterHostCandidate`: the host must
  contain a `<button>`, be an `absolute…bottom-0` ancestor of the profile
  button (26.924: `div.absolute.inset-x-0.bottom-0.z-20`), and must not be
  inside `[data-sidebar-project-container-id]`, contain project/thread rows,
  carry `pointer-events-none`, or match `*-resizer`.
  `findProfileFooterButton` now also matches localized aria-labels (zh-CN
  renders the footer as "打开个人资料菜单" / "打开帮助菜单", never
  "settings"). `ensureFooterPluginStrip` sweeps orphan
  `[data-explodex-footer-plugins]` nodes so a mis-mounted strip from an older
  session cannot survive re-injection. Live-verified 2026-09-28: strip rect
  `[0,707,340,67]`, both buttons 324 px wide, `clipped:false`, rows clean.
  Diagnosis tip: element-level scans miss this — the leaked letters are the
  first characters of longer spans clipped by `overflow:hidden`. Use
  `document.createTreeWalker(root, NodeFilter.SHOW_TEXT)` + a `Range` rect
  per character to find where the text actually renders.

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

Event model: the move button (inline SVG grid icon — not the `▦` glyph)
opens the menu on `pointerdown` (capture-phase React row
handlers kill `click`), and stretches to the **full row height**
(`align-self:stretch` inside the flex row, icon centered via inline-flex) so
the whole right edge is a comfortable hit target. Project rows have **no
right-click handler**: the move menu is icon-only now, which leaves Codex's
native project context menu untouched on rows. Instead one window-level
capture `contextmenu` listener suppresses Electron's native menu on
Explodex-owned chrome only (`[data-explodex-group-header]`, the add-inline /
move / color-picker / copy-path buttons, the footer strip `.ex-nav-btn`) —
right-clicking a group header used to pop "Select All" even with
`user-select:none`, because the native menu needs `preventDefault()`, not
CSS. Menu items: Ungrouped + groups only — group creation
lives on the "+ New group" row.

**Hover-card guard (project rows):** Codex's project hover card (name /
tasks / path / "编辑项目") is opened by React synthetic pointer handlers —
React 18 delegates everything on the `#root` container, so hovering *any*
part of the row raises it. The row's right edge is an action strip, not
project info, so each row gets bubble-phase `pointermove`/`pointerover`
listeners (bound once, marked via `data-explodex-hover-guard` to survive hot
re-injection) that `stopPropagation()` for right-side targets: any button in
the row, any non-`flex-1` child `<div>` (the action cluster), or the row's
own padding within 24 px of its right edge. The `flex-1` content area keeps
the card — that is the responsive "project info" zone. A listener dump
confirms aside/nav/section/rows carry **no** Codex-native pointer listeners
(only our own SDK/plugin ones appear elsewhere), so bubble-blocking at the
row is the right layer to act on.

Blocking alone is **not** enough: sweeping label → button already armed
Codex's open-timer during the left-zone moves, and the card still pops
~500 ms later while the pointer rests on the buttons — exactly what the
"still shows on the whole row" report was. So on each *transition* into the
right zone the guard also dispatches a single bubbling `pointerout` from the
row with `relatedTarget = document.body`; React's EnterLeave plugin turns it
into synthetic `pointerleave`s up the ancestor chain and **Codex's own close
handler** runs. Live-verified at the delegation point (2026-09-28): the
synthetic `pointerout/rel=body` arrives at `#root` exactly once per
transition, blocked right-zone moves never reach `#root`, and left-zone
hover still delivers its `pointerover`.

**CSS backstop (third layer, race-free).** The event layer above cannot be
tested end-to-end from CDP: `Input.dispatchMouseEvent` hover never opens the
card (Radix's delay timer needs a real, unthrottled hover), so "it works at
`#root`" is the strongest claim synthetic probing can make — and a real mouse
still leaked. The card is therefore also suppressed *without* touching events:
the trigger is a Radix tooltip (`SPAN.contents` above the header, carrying
`data-state` + `aria-describedby`) and its content is `[role="tooltip"]`, so
the guard sets `html.explodex-hovercard-off` while the pointer is in a row's
action strip and CSS drops the card outright. A window-level `pointerover`
releases the flag as soon as the pointer is anywhere outside a guarded row
(right-zone events are `stopPropagation()`ed by the row guard and never reach
it, so the flag survives while the user hovers the strip). Collateral is
limited to other tooltips while the pointer sits on that strip.

Row geometry worth remembering when touching this: the action cluster is
`opacity-0` until hover and only **8 px wide**, while its 20 px buttons
overflow it and sit *underneath* our full-height move button — all of them are
still inside `[data-app-action-sidebar-project-id]`, so containment (not
geometry) is what the guard must classify on.

**Glyph rule (secondary hardening, not the F/U root cause):** an early round
of the "stray F/U" reports was blamed on tofu glyphs. The cleanup below did
ship and stays, but live text-node scanning later proved the reported letters
came from the mis-mounted footer strip (see SDK section). The rule itself is
still real: injected affordances used to be *text glyphs* — `◍`/`●` (color
picker), `▸`/`▾` (chevron), `▦` (move), `⧉` (copy path), `✓`/`✕`/`⋯`. Several
of these (U+25CD, U+25BE/25B8, U+25A6, U+29C9, U+2713/2715) are absent from
the zh-CN Windows font stack and tofu-render into shapes that read as stray
Latin letters at 11 px. All are now drawn **without fonts**: the picker dot
and the chevron are CSS shapes (`::before` circle / border triangle), the
move and copy buttons are inline SVG, and the only surviving characters are
GB2312-safe ones (`＋ … √ × ▲ ▼`). When auditing, remember a screenshot can
show a *stale* pre-fix renderer — always reload + re-inject once before
concluding a fix "didn't work".

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

**Files are deliberately excluded.** Codex's native context menu already copies
file paths; an earlier build of this plugin intercepted file rows too and
*replaced* that menu (user-visible regression). `folderAbsolute()` now has a
hard rejection ahead of every heuristic: `data-item-type` matching
`file|link|symlink`, or a leaf name carrying an extension
(`/[^.]\.[A-Za-z0-9]{1,12}$/`), returns `null` — even if a fiber prop claims
`isFolder: true`. An explicit `data-item-type="folder"` still wins over the
extension heuristic (it is Codex's own ground truth for dotted directory names).
A null result means the handler returns *before* `preventDefault()`, so the
native menu survives untouched.

Injected panels must follow the renderer theme. Codex 26.924 has **no**
`--color-bg-primary` custom property — using it as the primary token silently
falls back to our dark `#111`, producing white-on-white/unreadable menus in the
light theme. The real tokens are `--color-token-dropdown-background` /
`--color-token-dropdown-foreground` (menus, popovers, dialogs),
`--color-token-bg-primary` / `--color-token-foreground` (pages) and
`--color-token-list-hover-background`. All Explodex panels now use the
`var(--color-token-dropdown-background, var(--color-bg-primary, #111))` chain.

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
A second failure mode was diagnosed live on 2026-09-28: repeated
`Runtime.evaluate` injections into an **already-loaded** renderer stack several
attach/teardown generations; the interleaved `removeEventListener` calls can
leave the document with *zero* live contextmenu handlers — decorations stay on
screen (stale) while right-clicks silently do nothing. Clean-state proof:
reload the renderer (`Ctrl+R`), re-run the launcher once, and everything
re-attaches exactly once. Note `addScriptToEvaluateOnNewDocument` dies with the
injector's CDP socket, so a reload without re-injection yields a plain renderer.

**Live-verified 2026-09-28 (Codex 26.924.2738.0):** folder-copy-path resolves
real shadow-DOM tree rows (`H:\code\own\test\android\images`) with the user's
mouse. After the file-gate + theme-token fix, a clean single-attach session was
verified end-to-end: 26 folder rows decorated, **0** file rows, folder
right-click shows our menu (`Copy path — src`) with theme-correct
`rgb(255,255,255)` / `rgb(26,28,31)` in the light theme, and file rows show no
Explodex menu at all. Note the Files tree only populates rows once a project
session is active; with an idle project the pane stays empty and there is
nothing to decorate. If a future Codex build regresses this, the
`__explodexFcpShadowDump` / `__explodexFcpPathDump` buffers above capture the
new structure without another debug round-trip.

## Responsiveness contract (click feel)

The "collapse takes ages", "first right-click after alt-tabbing back is very
slow" and "Select All + Copy path at once" reports all trace to the
mechanisms below — **not** event bubbling (the handlers are synchronous
capture listeners that `preventDefault` before returning):

- **User commits never wait on the debounce.** project-groups `commit()` now
  calls `reconcileNow()` — once state is hydrated it runs `doReconcile()`
  **synchronously inside the click handler**; the collapse/expand is applied
  before the event returns (live-verified 2026-09-28). Codex's own DOM
  mutations keep the 250 ms debounced path.
  The fast path must **not** be gated on `reconcileInFlight`: that flag only
  guards the *async* `reconcile()` (it awaits `hydrate()`, so two passes could
  interleave), while `doReconcile()` is synchronous and cannot re-enter
  itself. With the gate in place, every click landing during a sidebar
  mutation burst became a chain of 16 ms retries behind an observer that keeps
  re-arming — the "first click after opening a chat thread does nothing, the
  next ones are fine" report (2026-09-28, round 4).
- **Self-reporting latency.** `window.__explodexPgDebug` keeps the last 40
  reconcile passes as `{kind: "commit-sync" | "reconcile-async", ms, hydrated,
  inflight, rows}`. A sluggish click is explained by which `kind` it took and
  how large `ms` is, without another debug round-trip.
- **One shared zone observer (SDK).** `inject.observeZone` used to create a
  MutationObserver on `documentElement`'s entire subtree *per watcher* — with
  6+ live watchers every chat-streaming mutation batch was delivered N times,
  and `includeMutations` watchers re-ran their callback on every animation
  frame. That is the "click a group after alt-tabbing back mid-stream feels
  dead" cause. The SDK now keeps a single shared observer and dispatches
  records to watchers; `includeMutations` watchers only schedule when a
  record's target actually lies inside their zone anchor's subtree.
- **folder-copy-path scan scheduling is scoped.** The plugin no longer
  observes `document.body` with `subtree:true` (chat streaming flooded it).
  It watches: `body` childList only, a per-`[data-app-shell-focus-area=right-panel]`
  subtree observer (pruned when the panel unmounts), each
  `<file-tree-container>` shadow root, plus a 1500 ms discovery interval that
  re-attaches panel observers and scans.
- **Remaining document-wide observers are debounced.** Two inherited plugins
  still ran a full-document query per mutation batch from a
  `documentElement`+`subtree` observer: command-menu-threads (4 `querySelector`s
  for the dialog) and effort-shortcuts (composer lookup + hint remeasure).
  Both now debounce (180 ms / 200 ms) and effort-shortcuts only re-measures
  when its hint popover is actually open. (usage-reset-glance's is a cheap
  `isNavMounted` guard + no-op popover reposition, left as is.)
- **Repeated scans must not re-resolve cold.** folder-copy-path caches path
  resolution in a `WeakMap` keyed by node + current `data-item-path`
  (virtualized lists reuse DOM nodes, so a key change forces recompute), and
  the re-scan fast path for already-decorated rows does zero
  `getBoundingClientRect`. The old code fiber-walked + forced layout for every
  row on every scan — right after a window refocus (Codex re-renders heavily)
  that saturated the main thread exactly when the user right-clicked.
- **Injected menus are non-selectable and swallow right-clicks.** Every
  Explodex panel/backdrop sets `-webkit-user-select:none;user-select:none`
  (prompt `input`s opt back in) and `preventDefault`s `contextmenu` on both
  panel and backdrop. Selectable panel text let Electron raise its native
  "Select All" menu on top of the still-open Explodex menu — that was the
  double-menu report. SDK `.ex-nav-btn` / `.ex-popover` / `.ex-dialog` carry
  the same rule.
- **Statsig gate reads are catalog-cached (SDK).** `flags.readStatsigGate`
  and feature-flags' enrich path used to `JSON.parse` the ~4 MB
  `statsig.cached.evaluations.*` localStorage blob **per feature per
  refresh** — measured at 1240 big parses / 4.5 GB parsed per 60 s refresh
  cycle, i.e. three consecutive ~7 s main-thread stalls (the "switch back
  to Codex and it freezes for seconds" report, 2026-09-29). The SDK now
  parses once into `flags.readStatsigGateCatalog()`, invalidated by a
  cheap value-length signature (+ 10 s TTL backstop); a failed parse is
  never cached. After the fix a full refresh window shows **2 parses,
  0 hint writes, 0 long tasks**. The plugin's `rememberGateHints` also
  skips localStorage writes when discovery learned nothing new, and
  refuses to overwrite a hints file it could not parse (a corrupt read
  previously clobbered all 155 feature hints down to one entry).

Measuring feel on a minimized renderer: `requestAnimationFrame` and
`setTimeout` are throttled hard (a 10 ms poll fired at ~500 ms), and the file
tree renders **zero rows** while hidden/idle — verify synchronous application
by draining microtasks (`await Promise.resolve()`) instead of timers.

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

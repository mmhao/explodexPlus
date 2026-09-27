# Changelog

## [Unreleased]

### Fixed
- cdp-inject: an empty `about:blank` prewarm tab passed the page-target
  filter; evaluating the SDK there throws `SecurityError` (localStorage
  access denied), which aborted injection before the real renderer was ever
  reached. Blank tabs are now skipped in both filter paths.
- project-groups: the move-to-group menu now opens on `pointerdown` (real
  mouse clicks were swallowed by the React row button's capture-phase
  handlers before `click` could land) and also on right-click of the project
  row.
- folder-copy-path: copy button acts on `pointerdown` for the same reason;
  right-clicking a folder row now shows a "Copy path" menu; a React-fiber
  sweep fallback decorates folder rows when the tree markup matches none of
  the known selectors; the file-tree shadow root is pierced for scanning and
  `composedPath()` is used for menus (rows live inside `<file-tree-container>`).
- folder-copy-path: entry extraction now also walks hook `memoizedState`,
  accepts `relPath`/`relativePath`/`label` and loose entry-valued props, and
  scans arbitrary `data-*` attributes holding path-like values — field
  triage showed the row data sits on a great-grandparent DOM node.
- Windows launcher no longer wedges in "Quit Codex first" when
  `codex-windows-sandbox-service` or the `codex` CLI is running — only the
  `ChatGPT` UI process counts as Codex.
- Plugin enable/disable toggles survive renderer force-kills: the enabled map
  is mirrored to Codex global state and re-adopted at boot (SDK-level).
- project-groups sidebar root is locale-proof (derived from project rows via
  `closest("nav")`); groups no longer vanish when the Codex UI is non-English.
- project-groups "move to group" (▦) button is always visible on project rows
  (was hover-only with `opacity:0`, undiscoverable); grouped projects are
  indented with a guide rail; the project menu no longer offers "New group…"
  (creation lives on the "+ New group" row); the row context menu is a single
  document-level listener so hot re-injection can't leave stale handlers.
- folder-copy-path: bogus copied paths built from row textContent
  (`...\筛选文件⧉⧉⧉`) — paths now resolve strictly from React-fiber entry or
  `data-*` attributes, nested duplicates are deduped per absolute path, list
  containers are excluded by a row-size guard, and right-click "Copy path"
  works app-wide (right panel and chat file lists alike).
- folder-copy-path: **live-verified against Codex 26.924.x.** The tree's
  virtualized rows turned out to be DOM buttons with no React fiber at all;
  the row path/type come from `data-item-path`/`data-item-type`, and the
  workspace `cwd` is reachable only on `<file-tree-container>`'s host fiber
  chain — `cwdFor` now jumps row → shadow root → host to find it.

## [explodex-plus 0.1.0] - 2026-09-27

Fork of upstream explodex 0.2.2 below, adding Windows support and two plugins.

### Added
- Windows platform adapter (`lib/platform/windows.mjs`): Store-package discovery
  via `Get-AppxPackage`, MSIX-identity launch through `shell:AppsFolder`
  (direct exe launch loses package identity), debug-port/ownership probing,
  four-state launch machine, `%LOCALAPPDATA%` logging, generated
  "Codex (Explodex)" launcher command scripts.
- **Project Groups plugin** (`plugins/project-groups/`): collapsible custom
  groups wrapping sidebar projects; DOM-reorder only, state persisted through
  the bridge global state with a local fallback.
- **Folder Copy Path plugin** (`plugins/folder-copy-path/`): copy-path buttons
  on folder rows in the Files panel, React-fiber path resolution,
  Windows/POSIX path joining.
- Unit tests for the Windows adapter and both plugins' pure logic cores.
- Dual-platform CI (macOS + Windows) and `docs/COMPATIBILITY.md`
  (Codex version matrix + selector registry).

### Changed
- Package and CLI renamed to `explodex-plus` (coexists with upstream
  `explodex`); `os` now includes `win32`.

## [Unreleased] (upstream)

## [0.2.2] - 2026-06-29
### Added
- Interactive `explodex` CLI with first-run launcher setup (`@clack/prompts`).
- GitHub Actions CI and release workflows.
- `release:check` / `release:notes` helpers and `docs/RELEASING.md`.
- Project Pins: sort pinned threads by sidebar recency labels.

### Changed
- Launch Codex via `open -a` so it keeps its own TCC identity (permission prompts no longer attributed to the terminal).
- Stop auto-quitting Codex when it is running without Explodex; prompt the user to quit first.
- Rename internal `--from-app` flag to `--launch` (`--from-app` remains a deprecated alias).
- CDP injector exits sooner once injection is idle (avoids an ~8s tail wait).
- Replace `cac` with `@clack/prompts` in the npm CLI.

## [0.2.0] - 2026-06-28
### Added
- npm-first launcher and generated macOS application.
- Normal Codex-profile launch and launcher lifecycle tests.

## [0.1.0] - 2026-06-28
### Added
- Initial Explodex SDK and bundled plugins.
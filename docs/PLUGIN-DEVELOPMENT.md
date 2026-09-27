# Plugin development guide

Build a Codex mod: scaffold → inject → watch it live. The general SDK surface is documented in [sdk-api.md](sdk-api.md); this guide walks through the two fork plugins as worked examples and gives you a copy-paste template.

> Fastest path: install the bundled skill (`explodex-plus install-skill`) and ask Codex itself to build the plugin — the skill drives this whole loop.

## Anatomy

```
plugins/my-plugin/
  plugin.json     # { "id", "name", "version", "description", "scripts": ["logic.js", "index.js"] }
  logic.js        # optional but recommended: pure core, no DOM
  index.js        # DOM layer: registers with the SDK, reconciles UI
```

`scripts` run in order, concatenated into one injection — `logic.js` defines its core on `window`/`globalThis`, `index.js` consumes it. User plugins in `~/.explodex/plugins/` override bundled plugins of the same id.

## Worked example 1: project-groups

Goal: collapsible custom groups wrapping sidebar projects, state surviving restarts, zero changes to Codex data.

**logic.js** ([source](../plugins/project-groups/logic.js)) — everything testable without a browser:

- State shape `{ groups: [{id, name, color, collapsed, order}], projectMembership: {projectId: groupId} }`; `normalizeState()` defends against junk (non-objects, bad hex colors) because state comes from a JSON blob we don't fully control.
- Mutations (`createGroup`, `renameGroup`, `toggleGroupCollapsed`, `removeGroup`, `moveGroup`, `assignProject`) are pure functions returning new state.
- `planSequence(state, domProjectIds)` turns state + observed DOM order into the desired sibling sequence — a group header for *every* group (even empty ones), members in DOM order, ungrouped projects appended.

13 unit tests in [test/project-groups-logic.test.mjs](../test/project-groups-logic.test.mjs) cover this file with no DOM at all.

**index.js** — the DOM layer, three concerns:

1. *Persistence*: hydrate/save through the SDK bridge global state (`api.storage` with a `globalState` fast path). Keys are namespaced (`explodex-project-groups-state`); Codex stores them verbatim in its own `.codex-global-state.json`, which is why state survives restarts without touching Codex logic.
2. *Discovery*: `projectEntries()` maps `nav[aria-label="Chat history"]` sections via `[data-app-action-sidebar-project-id]` → header + block elements. Selector registry in [COMPATIBILITY.md](COMPATIBILITY.md).
3. *Reconcile*: MutationObserver (attributeFilter on the project-id attribute) + 250 ms debounce → `planSequence` → `applyOrder()`. **applyOrder never wraps React-owned nodes** — it only `insertBefore`s siblings into the desired order (the reverse-chain must include parentless new elements, or freshly created headers never enter the DOM — a bug we actually hit), and hides/shows non-active groups with `style.display`. Every injected node is marked (`data-explodex-group-header` etc.) so teardown removes exactly what we added.

## Worked example 2: folder-copy-path

Goal: folders in the right-hand Files panel get the same "copy path" affordance files have.

**logic.js** — path algebra + shape guessing: `joinPath(root, rel)` (Windows vs POSIX separator detection, absolute/UNC passthrough), `entryFromProps(props)` (scan known prop shapes for `path/absolutePath/fullPath` and folder-ness), `looksLikeFolder({ariaExpanded, hasChevron, name})`. 12 unit tests.

**index.js** — for each tree row inside `[data-app-shell-focus-area="right-panel"]`: walk the React fiber (`__reactFiber*` key, max 32 hops) collecting a path-bearing entry prop and a `cwd`/`workspaceRoot` from ancestry; resolve to an absolute path; append a hover-revealed ⧉ button that writes the clipboard (`navigator.clipboard`, `execCommand` fallback) and flashes ✓/✕. The decorator is idempotent (rows already marked are skipped) and teardown removes all buttons.

Design note: rows whose *only* signal is a label are deliberately left alone — guessing a path from a name would copy wrong data. Prefer no button over a wrong button.

## Rules of the road

- **Idempotent reconcile, debounced observer, full teardown.** The sidebar/tree re-render constantly; each pass must be cheap and produce identical DOM regardless of how many times it ran. Disabling the plugin must leave zero residue.
- **Never wrap or mutate React-owned subtrees.** Reorder siblings, hide with `display`, append *new* leaf nodes — that's the whole toolkit. Re-parenting Codex's own nodes into your containers fights React's reconciler.
- **Target `data-testid` / aria / accessible text**, with fallback chains, never generated class names. Record every selector you depend on in `docs/COMPATIBILITY.md`.
- **Fail soft.** Wrap reconcile bodies in try/catch + `console.warn("[my-plugin] …")`; a broken plugin must degrade to "feature missing", not "sidebar broken".
- **Typecheck:** add your plugin to `tsconfig.plugins.json` files (with a small `types.d.ts` for any global you attach) and keep `bun run --bun tsc -p tsconfig.plugins.json` green.

## Template

```js
// index.js — minimal registering plugin
(function (global) {
  const Explodex = global.Explodex;
  if (!Explodex?.plugins?.register) return;

  Explodex.plugins.register(
    { id: "my-plugin", name: "My Plugin", version: "0.1.0" },
    (api) => {
      let timer = null;
      const reconcile = () => {
        try {
          const host = document.querySelector('nav[aria-label="Chat history"]');
          if (!host || host.querySelector("[data-my-marker]")) return; // idempotent
          const btn = document.createElement("button");
          btn.dataset.myMarker = "1";
          btn.textContent = "Hi";
          host.appendChild(btn);
        } catch (error) {
          console.warn("[my-plugin] reconcile failed", error);
        }
      };
      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(reconcile, 250);
      });
      const target = document.querySelector('nav[aria-label="Chat history"]');
      if (target) observer.observe(target, { childList: true, subtree: true });
      reconcile();
      return () => { observer.disconnect(); clearTimeout(timer);
        document.querySelectorAll("[data-my-marker]").forEach((el) => el.remove()); };
    },
  );
})(window);
```

Then: `node bin/explodex.mjs inject` against a debug-launched Codex, toggle the plugin on the 💥 Explodex page, iterate. See [development.md](development.md) for the macOS live dev loop with CDP inspection.

/**
 * Explodex plugin: Folder Copy Path
 *
 * Codex's Files panel offers "Copy path" for files but not for folders.
 * This adds a copy-path affordance to folder rows. Paths are resolved from
 * the row's React fiber props (multi-shape, version tolerant) and joined
 * against the panel's cwd; nothing is inferred from mutable CSS classes.
 */
(function registerFolderCopyPath(global) {
  const BC = global.Explodex;
  const core = global.ExplodexFolderCopyPathCore;
  if (!BC?.plugins?.register) {
    console.warn("[folder-copy-path] Explodex SDK not loaded");
    return;
  }
  if (!core) {
    console.warn("[folder-copy-path] logic script not loaded before index.js");
    return;
  }

  BC.plugins.register(
    {
      id: "folder-copy-path",
      name: "Folder Copy Path",
      version: "0.1.0",
      dynamicLoadable: true,
      dynamicUnloadable: true,
    },
    (api) => {
      const { log } = api;

      const ROW_SELECTOR = '[role="treeitem"],[data-file-path],[data-path],[data-folder-path]';
      const BTN_ATTR = "data-explodex-copy-path";
      const ROW_MARK = "data-explodex-copy-path-row";
      const SCAN_DEBOUNCE_MS = 250;

      let disposed = false;
      let scanTimer = null;
      let bodyObserver = null;

      function reactFiber(node) {
        if (!node || typeof node !== "object") return null;
        const key = Object.keys(node).find((name) => name.startsWith("__reactFiber"));
        return key ? node[key] : null;
      }

      function walkFibers(node, visit, maxDepth = 32) {
        let fiber = reactFiber(node);
        for (let depth = 0; depth < maxDepth && fiber; depth += 1) {
          if (visit(fiber.memoizedProps) === true) return true;
          fiber = fiber.return;
        }
        return false;
      }

      function entryFor(node) {
        let found = null;
        walkFibers(node, (props) => {
          found = core.entryFromProps(props);
          return !!found;
        });
        return found;
      }

      function cwdFor(node) {
        let cwd = null;
        walkFibers(node, (props) => {
          if (typeof props?.cwd === "string" && props.cwd) {
            cwd = props.cwd;
            return true;
          }
          return false;
        });
        return cwd;
      }

      async function copyToClipboard(text) {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
          document.body.appendChild(ta);
          ta.select();
          let ok = false;
          try {
            ok = document.execCommand("copy");
          } catch {
            ok = false;
          }
          ta.remove();
          return ok;
        }
      }

      function flash(btn, ok) {
        btn.textContent = ok ? "✓" : "✕";
        global.setTimeout(() => {
          if (!disposed && btn.isConnected) btn.textContent = "⧉";
        }, 900);
      }

      function makeButton(absolutePath) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute(BTN_ATTR, "true");
        btn.setAttribute("aria-label", "Copy folder path");
        btn.title = absolutePath;
        btn.textContent = "⧉";
        btn.className = "explodex-copy-path-btn";
        // Act on pointerdown: row-level React handlers may re-render on their
        // capture-phase pointerdown, which kills the subsequent click event.
        btn.addEventListener("pointerdown", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          if (event.button !== 0) return;
          flash(btn, await copyToClipboard(absolutePath));
        });
        btn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        return btn;
      }

      // --- context menu ---------------------------------------------------------

      let menuWrap = null;

      function closeMenu() {
        menuWrap?.remove();
        menuWrap = null;
      }

      function showMenuAt(cx, cy, items) {
        closeMenu();
        const backdrop = document.createElement("div");
        backdrop.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:transparent";
        backdrop.addEventListener("pointerdown", (event) => {
          if (event.target === backdrop) closeMenu();
        });
        const panel = document.createElement("div");
        panel.setAttribute("role", "menu");
        panel.setAttribute("aria-label", "Folder actions");
        panel.style.cssText =
          "position:fixed;z-index:2147483647;min-width:180px;padding:4px;border-radius:10px;" +
          "border:1px solid color-mix(in srgb, currentColor 14%, transparent);" +
          "background:var(--color-bg-primary,#111);color:inherit;" +
          "box-shadow:0 12px 32px color-mix(in srgb,#000 45%,transparent);" +
          "font:13px/1.4 system-ui,-apple-system,sans-serif";
        for (const item of items) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = item.label;
          btn.title = item.path ?? "";
          btn.style.cssText =
            "display:block;width:100%;text-align:left;padding:8px 12px;border:0;background:transparent;" +
            "color:inherit;font:13px system-ui,-apple-system,sans-serif;cursor:pointer;border-radius:6px";
          btn.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            closeMenu();
            await item.onClick();
          });
          panel.appendChild(btn);
        }
        const wrap = document.createElement("div");
        wrap.appendChild(backdrop);
        wrap.appendChild(panel);
        document.body.appendChild(wrap);
        menuWrap = wrap;
        panel.style.visibility = "hidden";
        const w = panel.offsetWidth;
        const h = panel.offsetHeight;
        panel.style.left = `${Math.max(8, Math.min(cx, global.innerWidth - w - 8))}px`;
        panel.style.top = `${Math.max(8, Math.min(cy, global.innerHeight - h - 8))}px`;
        panel.style.visibility = "";
      }

      function resolveRow(row) {
        const entry = entryFor(row);
        const rawPath =
          entry?.path ??
          row.getAttribute("data-file-path") ??
          row.getAttribute("data-path") ??
          row.getAttribute("data-folder-path");
        const label = (entry?.name ?? row.textContent ?? "").trim().slice(0, 120);
        if (!looksLikeFolder(row, entry, label)) return null;
        const absolute = rawPath ? core.joinPath(cwdFor(row), rawPath) : core.joinPath(cwdFor(row), label);
        return absolute ?? null;
      }

      function onContextMenu(event) {
        const panel = event.target.closest?.('[data-app-shell-focus-area="right-panel"]');
        if (!panel) return;
        const row = event.target.closest(ROW_SELECTOR);
        let absolute = null;
        if (row) {
          absolute = resolveRow(row);
        } else {
          // The tree may not match our selectors; walk up from the cursor for a
          // fiber that resolves to a folder entry.
          let node = event.target;
          for (let hop = 0; hop < 6 && node && node !== panel; hop += 1, node = node.parentElement) {
            absolute = resolveRow(node);
            if (absolute) break;
          }
        }
        if (!absolute) return;
        event.preventDefault();
        event.stopPropagation();
        showMenuAt(event.clientX, event.clientY, [
          {
            label: "Copy path",
            path: absolute,
            onClick: async () => {
              await copyToClipboard(absolute);
            },
          },
        ]);
      }

      function looksLikeFolder(row, entry, name) {
        if (entry?.isFolder) return true;
        const hasChevron = !!row.querySelector(
          'svg[class*="rotate"], svg[class*="chevron"], [class*="expand"] svg',
        );
        return core.looksLikeFolder({
          ariaExpanded: row.getAttribute("aria-expanded"),
          hasChevron,
          name: entry?.name ?? name,
        });
      }

      function decorateRow(row) {
        if (row.querySelector(`:scope > [${BTN_ATTR}], :scope > * > [${BTN_ATTR}]`)) return;
        const absolute = resolveRow(row);
        if (!absolute) return;
        row.setAttribute(ROW_MARK, "true");
        row.appendChild(makeButton(absolute));
      }

      function scan() {
        if (disposed) return;
        for (const panel of document.querySelectorAll('[data-app-shell-focus-area="right-panel"]')) {
          let rows = [...panel.querySelectorAll(ROW_SELECTOR)];
          if (!rows.length) {
            // Selector miss on this Codex build: fall back to a React-fiber
            // sweep so folder detection does not depend on the row markup.
            // Outermost match wins; its descendants are skipped.
            rows = [...panel.querySelectorAll("div")].filter(
              (el) => reactFiber(el) && !el.closest(`[${ROW_MARK}]`),
            );
          }
          for (const row of rows) decorateRow(row);
        }
      }

      function scheduleScan() {
        if (disposed) return;
        if (scanTimer != null) global.clearTimeout(scanTimer);
        scanTimer = global.setTimeout(() => {
          scanTimer = null;
          scan();
        }, SCAN_DEBOUNCE_MS);
      }

      const STYLE_TEXT =
        ".explodex-copy-path-btn{position:absolute;right:6px;top:50%;transform:translateY(-50%);" +
        "border:0;background:transparent;color:inherit;opacity:0;cursor:pointer;font-size:12px;" +
        "padding:2px 4px;border-radius:4px;line-height:1}" +
        "[role=treeitem]:hover .explodex-copy-path-btn," +
        "[data-file-path]:hover .explodex-copy-path-btn," +
        "[data-path]:hover .explodex-copy-path-btn{opacity:.7}" +
        ".explodex-copy-path-btn:hover{opacity:1!important;background:color-mix(in srgb,currentColor 12%,transparent)}";

      let styleEl = null;
      function ensureStyles() {
        styleEl = document.createElement("style");
        styleEl.id = "explodex-folder-copy-path-styles";
        styleEl.textContent = STYLE_TEXT;
        document.head.appendChild(styleEl);
      }

      ensureStyles();
      bodyObserver = new MutationObserver(scheduleScan);
      bodyObserver.observe(document.body, { childList: true, subtree: true });
      document.addEventListener("contextmenu", onContextMenu, true);
      scan();

      log.info("folder copy path attached");

      return () => {
        disposed = true;
        if (scanTimer != null) global.clearTimeout(scanTimer);
        bodyObserver?.disconnect();
        document.removeEventListener("contextmenu", onContextMenu, true);
        closeMenu();
        for (const btn of document.querySelectorAll(`[${BTN_ATTR}]`)) btn.remove();
        for (const row of document.querySelectorAll(`[${ROW_MARK}]`)) row.removeAttribute(ROW_MARK);
        styleEl?.remove();
        log.info("teardown");
      };
    },
  );
})(window);

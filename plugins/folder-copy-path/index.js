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

      const ROW_SELECTOR =
        '[role="treeitem"],[data-file-path],[data-path],[data-folder-path]';
      const BTN_ATTR = "data-explodex-copy-path";
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
        btn.addEventListener("pointerdown", (event) => event.stopPropagation());
        btn.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          flash(btn, await copyToClipboard(absolutePath));
        });
        return btn;
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
        const entry = entryFor(row);
        const rawPath =
          entry?.path ??
          row.getAttribute("data-file-path") ??
          row.getAttribute("data-path") ??
          row.getAttribute("data-folder-path");
        const label = (entry?.name ?? row.textContent ?? "").trim().slice(0, 120);
        if (!looksLikeFolder(row, entry, label)) return;
        if (!rawPath && !entry) return;

        const absolute = rawPath
          ? core.joinPath(cwdFor(row), rawPath)
          : core.joinPath(cwdFor(row), label);
        if (!absolute) return;
        row.appendChild(makeButton(absolute));
      }

      function scan() {
        if (disposed) return;
        for (const panel of document.querySelectorAll(
          '[data-app-shell-focus-area="right-panel"]',
        )) {
          for (const row of panel.querySelectorAll(ROW_SELECTOR)) decorateRow(row);
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
      scan();

      log.info("folder copy path attached");

      return () => {
        disposed = true;
        if (scanTimer != null) global.clearTimeout(scanTimer);
        bodyObserver?.disconnect();
        for (const btn of document.querySelectorAll(`[${BTN_ATTR}]`)) btn.remove();
        styleEl?.remove();
        log.info("teardown");
      };
    },
  );
})(window);

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
        '[role="treeitem"],[data-item-path],[data-file-path],[data-path],[data-folder-path]';
      const BTN_ATTR = "data-explodex-copy-path";
      const ROW_MARK = "data-explodex-copy-path-row";
      const SCAN_DEBOUNCE_MS = 250;

      let disposed = false;
      let scanTimer = null;
      let bodyObserver = null;
      const shadowObservers = new Map();

      function reactFiber(node) {
        if (!node || typeof node !== "object") return null;
        const key = Object.keys(node).find((name) => name.startsWith("__reactFiber"));
        return key ? node[key] : null;
      }

      function walkFibers(node, visit, maxDepth = 32) {
        let fiber = reactFiber(node);
        let steps = 0;
        // The tree renders inside <file-tree-container>'s shadow root; when the
        // fiber chain bottoms out at the host boundary, restart from the host
        // so pane props (cwd/roots) stay reachable.
        while (fiber && steps < maxDepth) {
          if (visit(fiber.memoizedProps) === true) return true;
          // Hook components keep entry data in memoizedState, not props.
          let hook = fiber.memoizedState;
          for (let h = 0; h < 6 && hook && steps < maxDepth; h += 1, hook = hook.next) {
            const st = hook.memoizedState ?? hook;
            if (st && typeof st === "object" && visit(st) === true) return true;
          }
          if (!fiber.return) {
            const root = fiber.stateNode?.getRootNode?.();
            fiber = root instanceof ShadowRoot ? reactFiber(root.host) : null;
          } else {
            fiber = fiber.return;
          }
          steps += 1;
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

      function readCwd(props) {
        if (!props || typeof props !== "object") return null;
        if (typeof props.cwd === "string" && props.cwd) return props.cwd;
        if (typeof props.root === "string" && props.root) return props.root;
        if (Array.isArray(props.roots) && typeof props.roots[0] === "string" && props.roots[0])
          return props.roots[0];
        return null;
      }

      function cwdFor(node) {
        let cwd = null;
        walkFibers(node, (props) => {
          cwd = readCwd(props);
          return !!cwd;
        });
        if (cwd) return cwd;
        // The tree renders into <file-tree-container>'s shadow root, and its
        // virtualized rows are DOM nodes with no React fiber of their own. The
        // pane's cwd lives on the host's fiber chain, so climb from the host.
        const root = typeof node?.getRootNode === "function" ? node.getRootNode() : null;
        if (root instanceof ShadowRoot) {
          const cwd2 = cwdFor(root.host);
          if (cwd2) return cwd2;
        }
        // Fallback: the nearest ancestor that has a fiber (the custom-element host).
        let el = node;
        for (let i = 0; i < 10 && el; i += 1, el = el.parentElement) {
          if (reactFiber(el)) {
            const cwd3 = cwdFor(el);
            if (cwd3) return cwd3;
          }
        }
        return null;
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
        btn.dataset.explodexPath = absolutePath;
        btn.textContent = "⧉";
        btn.className = "explodex-copy-path-btn";
        // Act on pointerdown: row-level React handlers may re-render on their
        // capture-phase pointerdown, which kills the subsequent click event.
        btn.addEventListener("pointerdown", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          if (event.button !== 0) return;
          const path = btn.dataset.explodexPath;
          if (path) flash(btn, await copyToClipboard(path));
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

      function directChevron(row) {
        // Only svgs within two levels count as the row's own twisty; a subtree
        // match lets a whole list container "look like" a single folder row.
        for (const svg of row.querySelectorAll("svg")) {
          if (svg.parentElement?.parentElement === row || svg.parentElement === row) return true;
        }
        return false;
      }

      function isRowSized(el) {
        const h = el.getBoundingClientRect().height;
        return h >= 8 && h <= 56;
      }

      function isAbsolutePathLike(p) {
        return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\\\");
      }

      // Resolves a folder row to an absolute path — strictly from React-fiber
      // entry data or data-* attributes. textContent is never used: a
      // mis-matched container's text mixes sibling labels and our own button
      // glyphs into a bogus name (real bug: "...\\筛选文件⧉⧉⧉").
      function folderAbsolute(row) {
        const entry = entryFor(row);
        // Current Codex tree rows: BUTTON[data-item-path=relative/][data-item-type=folder].
        const itemType = row.getAttribute?.("data-item-type") || "";
        let attrPath =
          row.getAttribute?.("data-item-path") ||
          row.getAttribute("data-file-path") ||
          row.getAttribute("data-path") ||
          row.getAttribute("data-folder-path") ||
          "";
        if (!attrPath) {
          // Unknown builds stash the relative path in a bespoke data-* attr;
          // any attribute holding a slash-bearing token is path-like.
          for (const a of row.attributes) {
            if (/^data-/i.test(a.name) && /[\\/]/.test(a.value) && a.value.length < 300) {
              attrPath = a.value;
              break;
            }
          }
        }
        const rawPath = entry?.path || attrPath;
        const leafOf = (p) =>
          String(p)
            .replace(/[\\/]+$/, "")
            .split(/[\\/]/)
            .pop() || "";
        const name = entry?.name || (rawPath ? leafOf(rawPath) : "");
        if (!rawPath && !name) return null;
        const isFolder =
          entry?.isFolder ??
          (/^(folder|directory)$/.test(itemType) ||
            (rawPath ? /\/$/.test(rawPath) : false) ||
            core.looksLikeFolder({
              ariaExpanded: row.getAttribute("aria-expanded"),
              hasChevron: directChevron(row),
              name: name || rawPath,
            }));
        if (!isFolder) return null;
        const cwd = cwdFor(row);
        const rel = (rawPath || name).replace(/\/+$/, "");
        // Refuse to hand back a relative path: without a cwd root, a
        // workspace-relative entry would copy a useless fragment.
        if (!cwd && !isAbsolutePathLike(rel)) return null;
        const absolute = core.joinPath(cwd, rel);
        if (absolute) {
          const dbg = (global.__explodexFcpDebug = global.__explodexFcpDebug || []);
          dbg.push({ absolute, tag: row.tagName, cls: String(row.className).slice(0, 40) });
          if (dbg.length > 40) dbg.shift();
        }
        return absolute || null;
      }

      function fiberKeys(node) {
        const fk = Object.keys(node).find((k) => k.startsWith("__reactFiber"));
        if (!fk) return null;
        const p = node[fk].memoizedProps;
        return p ? Object.keys(p).slice(0, 14) : null;
      }

      // Codex's file tree is a <file-tree-container> custom element with a
      // shadow root: plain queries and retargeted event targets stop at the
      // host, so scanning pierces shadow roots and menus use composedPath().
      function treeRoots() {
        /** @type {(Element | ShadowRoot)[]} */
        const roots = [...document.querySelectorAll('[data-app-shell-focus-area="right-panel"]')];
        for (const host of document.querySelectorAll("file-tree-container")) {
          if (host.shadowRoot && !roots.includes(host.shadowRoot)) roots.push(host.shadowRoot);
        }
        return roots;
      }

      function ensureStylesIn(node) {
        const root = node && typeof node.getElementById === "function" ? node : document.head;
        if (!root.getElementById || root.getElementById("explodex-folder-copy-path-styles")) return;
        const style = document.createElement("style");
        style.id = "explodex-folder-copy-path-styles";
        style.textContent = STYLE_TEXT;
        root.appendChild(style);
      }

      function observeShadow(host) {
        if (!host.shadowRoot || shadowObservers.has(host)) return;
        const obs = new MutationObserver(scheduleScan);
        obs.observe(host.shadowRoot, { childList: true, subtree: true });
        shadowObservers.set(host, obs);
      }

      function dumpShadowOnce(host) {
        if (global.__explodexFcpShadowDump || !host.shadowRoot) return;
        try {
          const rows = [...host.shadowRoot.querySelectorAll("div,span")].slice(0, 300);
          const samples = [];
          for (const el of rows) {
            const fk = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
            let propInfo = null;
            if (fk) {
              let f = el[fk];
              for (let d = 0; d < 6 && f; d += 1, f = f.return) {
                const p = f.memoizedProps;
                if (p && Object.keys(p).length > 3) {
                  propInfo = Object.keys(p).slice(0, 16);
                  break;
                }
              }
            }
            samples.push({
              tag: el.tagName,
              text: (el.textContent || "").trim().slice(0, 24),
              attrs: [...el.attributes].map((a) => a.name).slice(0, 8),
              propInfo,
            });
            if (samples.length >= 14) break;
          }
          global.__explodexFcpShadowDump = {
            html: host.shadowRoot.innerHTML.slice(0, 4000),
            samples,
            hostProps: Object.keys(host).slice(0, 20),
            hostFiber: describeForDump(host),
            hostAncestors: (() => {
              const hops = [];
              let el = host.parentElement;
              for (let i = 0; i < 4 && el; i += 1, el = el.parentElement) hops.push(describeForDump(el));
              return hops;
            })(),
          };
        } catch (err) {
          global.__explodexFcpShadowDump = { error: String(err) };
        }
      }

      function describeForDump(node) {
        if (node === document) return "#document";
        if (node === global) return "#window";
        if (node.nodeType !== 1) return "#node" + node.nodeType;
        const attrs = [...node.attributes]
          .slice(0, 8)
          .map((a) => `${a.name}=${a.value.slice(0, 44)}`)
          .join("|");
        const fk = Object.keys(node).find((k) => k.startsWith("__reactFiber"));
        let keys = null;
        if (fk) {
          let f = node[fk];
          for (let d = 0; d < 4 && f; d += 1, f = f.return) {
            const p = f.memoizedProps;
            if (p && Object.keys(p).length > 2) {
              keys = Object.keys(p).slice(0, 12);
              break;
            }
          }
        }
        const root = node.getRootNode();
        const inShadow = root instanceof ShadowRoot ? "in:" + root.host.tagName : "doc";
        return `${node.tagName}{${attrs}}{${inShadow}}${keys ? "{props:" + keys.join(",") + "}" : ""}`;
      }

      function onContextMenu(event) {
        // composedPath() reaches shadow rows that document-level listeners
        // otherwise only see as the retargeted host element.
        const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
        let absolute = null;
        const miss = [];
        let seen = 0;
        let rightClickedRow = null;
        for (const node of path) {
          if (!node || node.nodeType !== 1) continue;
          if (absolute) break;
          if (!rightClickedRow && (node.textContent || "").trim()) rightClickedRow = node;
          seen += 1;
          absolute = folderAbsolute(node);
          if (absolute) continue;
          const keys = fiberKeys(node);
          if (keys) miss.push(`${node.tagName}:${keys.join(",")}`);
          if (seen >= 16) break;
        }
        if (!global.__explodexFcpPathDump && path.some((n) => n.tagName === "FILE-TREE-CONTAINER")) {
          try {
            global.__explodexFcpPathDump = {
              at: Date.now(),
              hops: path.slice(0, 14).map(describeForDump),
              rowText: rightClickedRow ? (rightClickedRow.textContent || "").trim().slice(0, 40) : null,
              rowChildrenText: rightClickedRow
                ? [...rightClickedRow.children]
                    .slice(0, 6)
                    .map((c) => c.tagName + ":" + (c.textContent || "").trim().slice(0, 20))
                : null,
            };
          } catch (err) {
            global.__explodexFcpPathDump = { error: String(err) };
          }
        }
        if (!absolute) {
          if (miss.length) {
            const dbg = (global.__explodexFcpDebug = global.__explodexFcpDebug || []);
            dbg.push({ absolute: null, miss: miss.slice(0, 6) });
            if (dbg.length > 40) dbg.shift();
          }
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        showMenuAt(event.clientX, event.clientY, [
          {
            label: `Copy path — ${absolute.split(/[\\/]/).pop()}`,
            path: absolute,
            onClick: async () => {
              await copyToClipboard(absolute);
            },
          },
        ]);
      }

      function decorateRow(row, claimed) {
        const existing = [...row.querySelectorAll(`[${BTN_ATTR}]`)];
        if (row.parentElement?.closest(`[${ROW_MARK}]`) || !isRowSized(row)) {
          for (const b of existing) b.remove();
          return;
        }
        const absolute = folderAbsolute(row);
        if (!absolute) return;
        if (claimed.has(absolute)) {
          // Nested duplicate candidate for an already-decorated row.
          for (const b of existing) b.remove();
          return;
        }
        claimed.add(absolute);
        row.setAttribute(ROW_MARK, "true");
        const btn = existing[0] ?? makeButton(absolute);
        for (const extra of existing.slice(1)) extra.remove();
        btn.dataset.explodexPath = absolute;
        btn.title = absolute;
        if (btn.parentElement !== row) row.appendChild(btn);
        ensureStylesIn(row.getRootNode());
      }

      function scan() {
        if (disposed) return;
        for (const host of document.querySelectorAll("file-tree-container")) {
          dumpShadowOnce(host);
          observeShadow(host);
        }
        const claimed = new Set();
        for (const root of treeRoots()) {
          let rows = [...root.querySelectorAll(ROW_SELECTOR)];
          if (!rows.length) {
            // Selector miss on this Codex build: fall back to a React-fiber
            // sweep; the row-size guard keeps containers out.
            rows = [...root.querySelectorAll("div")].filter((el) => reactFiber(el));
          }
          for (const row of rows) decorateRow(row, claimed);
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
        `[${ROW_MARK}]:hover .explodex-copy-path-btn{opacity:.7}` +
        ".explodex-copy-path-btn:hover{opacity:1!important;background:color-mix(in srgb,currentColor 12%,transparent)}";

      let styleEl = null;
      function ensureStyles() {
        document.getElementById("explodex-folder-copy-path-styles")?.remove();
        styleEl = document.createElement("style");
        styleEl.id = "explodex-folder-copy-path-styles";
        styleEl.textContent = STYLE_TEXT;
        document.head.appendChild(styleEl);
      }

      ensureStyles();
      // Purge buttons left by an earlier (buggy) registration: their closures
      // carry wrong paths. Re-decorated rows re-create them immediately.
      for (const stale of document.querySelectorAll(`[${BTN_ATTR}]`)) stale.remove();
      for (const staleRow of document.querySelectorAll(`[${ROW_MARK}]`)) staleRow.removeAttribute(ROW_MARK);
      bodyObserver = new MutationObserver(scheduleScan);
      bodyObserver.observe(document.body, { childList: true, subtree: true });
      document.addEventListener("contextmenu", onContextMenu, true);
      scan();

      log.info("folder copy path attached");

      return () => {
        disposed = true;
        if (scanTimer != null) global.clearTimeout(scanTimer);
        bodyObserver?.disconnect();
        for (const obs of shadowObservers.values()) obs.disconnect();
        shadowObservers.clear();
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

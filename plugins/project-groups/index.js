/**
 * Explodex plugin: Project Groups
 *
 * Wraps sidebar projects into user-created collapsible groups ("work",
 * "personal", …). Group state lives entirely in Explodex storage and is
 * applied by reordering existing DOM blocks — no Codex state is touched and
 * no DOM nodes are ever wrapped, so React reconciliation stays safe.
 */
(function registerProjectGroups(global) {
  const BC = global.Explodex;
  const core = global.ExplodexProjectGroupsCore;
  if (!BC?.plugins?.register) {
    console.warn("[project-groups] Explodex SDK not loaded");
    return;
  }
  if (!core) {
    console.warn("[project-groups] logic script not loaded before index.js");
    return;
  }

  BC.plugins.register(
    {
      id: "project-groups",
      name: "Project Groups",
      version: "0.1.0",
      dynamicLoadable: true,
      dynamicUnloadable: true,
    },
    (api) => {
      const { bridge, storage, log, inject } = api;

      const STATE_KEY = core.STATE_KEY;
      const RECONCILE_DEBOUNCE_MS = 250;

      let disposed = false;
      let hydrated = false;
      let hydratePromise = null;
      let reconcileTimer = null;
      let reconcileInFlight = false;
      let sidebarObserver = null;
      let unsubscribeSidebar = null;
      let activeMenu = null;
      let state = core.normalizeState(null);

      // --- persistence (global state via bridge, persisted fallback) -------

      function hasEntries(value) {
        return !!(
          value &&
          typeof value === "object" &&
          ((Array.isArray(value.groups) && value.groups.length > 0) ||
            Object.keys(value.membership ?? {}).length > 0)
        );
      }

      async function hydrate() {
        if (hydrated) return state;
        if (hydratePromise) return hydratePromise;
        hydratePromise = (async () => {
          let raw = storage.persisted.get(STATE_KEY, null);
          if (bridge.isAvailable()) {
            try {
              const fromGlobal = await storage.globalState.get(STATE_KEY);
              if (hasEntries(fromGlobal)) {
                raw = fromGlobal;
              } else if (hasEntries(raw)) {
                await storage.globalState.set(STATE_KEY, core.normalizeState(raw));
                storage.persisted.remove(STATE_KEY);
              }
            } catch (err) {
              log.warn("project groups hydrate failed", err);
            }
          }
          state = core.normalizeState(raw);
          hydrated = true;
          return state;
        })();
        return hydratePromise;
      }

      async function save() {
        const shape = { groups: state.groups, membership: state.membership };
        if (!bridge.isAvailable()) {
          storage.persisted.set(STATE_KEY, shape);
          return;
        }
        try {
          await storage.globalState.set(STATE_KEY, shape);
          storage.persisted.remove(STATE_KEY);
        } catch (err) {
          log.warn("project groups global write failed", err);
          storage.persisted.set(STATE_KEY, shape);
        }
      }

      function commit(next) {
        state = next;
        void save();
        scheduleReconcile();
      }

      // --- DOM discovery ----------------------------------------------------

      function sidebarNavRoot() {
        // Locale-proof: aria-label is translated ("Chat history" / "首页" / …),
        // so prefer the nav that actually hosts the project rows.
        const viaProject = document.querySelector("[data-app-action-sidebar-project-id]")?.closest("nav");
        return (
          viaProject ??
          document.querySelector('nav[aria-label="Chat history"]') ??
          document.querySelector("aside.app-shell-left-panel nav") ??
          document.querySelector("nav")
        );
      }

      // Each project renders as a block (`div.group/cwd`) whose header row
      // carries the stable project id attribute. Reorder blocks, never wrap.
      function projectEntries() {
        const nav = sidebarNavRoot();
        if (!nav) return [];
        const entries = [];
        const seen = new Set();
        for (const header of nav.querySelectorAll("[data-app-action-sidebar-project-id]")) {
          const id = core.normalizeId(header.getAttribute("data-app-action-sidebar-project-id"));
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const block = header.closest('[class~="group/cwd"]') ?? header;
          entries.push({ id, header, block });
        }
        return entries;
      }

      function existingGroupHeaders() {
        const map = new Map();
        for (const el of document.querySelectorAll("[data-explodex-group-header]")) {
          const id = el.getAttribute("data-explodex-group-header");
          if (id) map.set(id, el);
        }
        return map;
      }

      // --- styling -----------------------------------------------------------

      const STYLE_TEXT =
        ".explodex-group-header{display:flex;align-items:center;gap:8px;padding:6px 10px;margin:8px 0 2px;border-radius:8px;cursor:pointer;user-select:none;opacity:.85;font:11px/1.4 system-ui,-apple-system,sans-serif;letter-spacing:.05em;text-transform:uppercase}" +
        ".explodex-group-header:hover{background:color-mix(in srgb,currentColor 8%,transparent);opacity:1}" +
        ".explodex-group-chevron{width:12px;flex:none;text-align:center;opacity:.7}" +
        ".explodex-group-color{width:8px;height:8px;border-radius:999px;flex:none}" +
        ".explodex-group-name{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
        ".explodex-group-count{flex:none;opacity:.5;font-size:10px}" +
        ".explodex-group-menubtn{flex:none;border:0;background:transparent;color:inherit;cursor:pointer;opacity:0;padding:0 2px;font-size:13px;border-radius:4px}" +
        ".explodex-group-header:hover .explodex-group-menubtn{opacity:.7}" +
        ".explodex-group-add{display:flex;align-items:center;gap:8px;padding:6px 10px;margin:4px 0;border-radius:8px;cursor:pointer;opacity:.55;font:11px/1.4 system-ui,-apple-system,sans-serif;letter-spacing:.05em;text-transform:uppercase}" +
        ".explodex-group-add:hover{background:color-mix(in srgb,currentColor 8%,transparent);opacity:.9}" +
        ".explodex-group-movebtn{flex:none;border:0;background:transparent;color:inherit;cursor:pointer;opacity:.55;padding:0 5px;font-size:13px;line-height:1;border-radius:4px}" +
        "[data-app-action-sidebar-project-id]:hover .explodex-group-movebtn{opacity:.85}" +
        ".explodex-group-movebtn:hover{opacity:1!important;background:color-mix(in srgb,currentColor 14%,transparent)}" +
        // Nesting cue for projects inside a group: indented with a guide rail.
        ".explodex-in-group{padding-left:18px;border-left:1px solid color-mix(in srgb,currentColor 16%,transparent);margin-left:7px}";

      function ensureStyles() {
        let style = document.getElementById("explodex-project-groups-styles");
        if (!style) {
          style = document.createElement("style");
          style.id = "explodex-project-groups-styles";
          document.head.appendChild(style);
        }
        if (style.textContent !== STYLE_TEXT) style.textContent = STYLE_TEXT;
      }

      // --- element factories ---------------------------------------------------

      function syncGroupHeader(item) {
        let el = existingGroupHeaders().get(item.id);
        if (!el) {
          el = document.createElement("div");
          el.setAttribute("data-explodex-group-header", item.id);
          el.setAttribute("role", "button");
          el.setAttribute("tabindex", "0");
          el.className = "explodex-group-header";
          el.innerHTML =
            '<span class="explodex-group-chevron"></span>' +
            '<span class="explodex-group-color"></span>' +
            '<span class="explodex-group-name"></span>' +
            '<span class="explodex-group-count"></span>' +
            '<button type="button" class="explodex-group-menubtn" data-explodex-group-menubtn="true" title="Group options">⋯</button>';

          const gid = item.id;
          el.addEventListener("click", (event) => {
            if (event.target.closest("[data-explodex-group-menubtn]")) return;
            commit(core.toggleGroupCollapsed(state, gid));
          });
          el.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              commit(core.toggleGroupCollapsed(state, gid));
            }
          });
          const menuBtn = el.querySelector("[data-explodex-group-menubtn]");
          menuBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
          menuBtn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            openGroupMenu(menuBtn, gid);
          });
        }

        const collapsed = !!item.collapsed;
        el.querySelector(".explodex-group-chevron").textContent = collapsed ? "▸" : "▾";
        const nameEl = el.querySelector(".explodex-group-name");
        if (nameEl.textContent !== item.name) nameEl.textContent = item.name;
        el.querySelector(".explodex-group-count").textContent = String(item.count);
        const dot = el.querySelector(".explodex-group-color");
        dot.style.background = item.color ?? "currentColor";
        dot.style.opacity = item.color ? "1" : ".35";
        el.setAttribute("data-explodex-group-collapsed", collapsed ? "true" : "false");
        el.setAttribute("aria-expanded", collapsed ? "false" : "true");
        return el;
      }

      function groupAddEl() {
        let el = document.querySelector("[data-explodex-group-add]");
        if (!el) {
          el = document.createElement("div");
          el.setAttribute("data-explodex-group-add", "true");
          el.setAttribute("role", "button");
          el.setAttribute("tabindex", "0");
          el.className = "explodex-group-add";
          el.textContent = "+ New group";
          el.addEventListener("click", () => {
            openPrompt(el, "New group", "", (name) => commit(core.createGroup(state, name)));
          });
        }
        return el;
      }

      function ensureMoveButton(header, projectId) {
        let btn = header.querySelector("[data-explodex-group-move]");
        if (btn) return btn;
        btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("data-explodex-group-move", "true");
        btn.className = "explodex-group-movebtn";
        btn.title = "Move to group (or right-click the project row)";
        btn.textContent = "▦";
        // Open on pointerdown, not click: the project row is a React button whose
        // capture-phase pointerdown can re-render the row, so the click event
        // never lands on this button and click-only handlers silently die.
        btn.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          if (event.button === 0) openProjectMenu(btn, projectId);
        });
        btn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        header.appendChild(btn);
        return btn;
      }

      function setBlockHidden(block, hidden) {
        const next = hidden ? "none" : "";
        if (block.style.display !== next) block.style.display = next;
      }

      // --- reorder --------------------------------------------------------------

      function applyOrder(container, desired) {
        const wanted = desired.filter(Boolean);
        if (!wanted.length) return false;

        const children = [...container.children];
        const position = new Map(children.map((el, index) => [el, index]));
        let last = -1;
        let ordered = true;
        for (const el of wanted) {
          const at = position.get(el);
          if (at == null || at < last) {
            ordered = false;
            break;
          }
          last = at;
        }
        if (ordered) return false;

        let after = null;
        for (let index = wanted.length - 1; index >= 0; index -= 1) {
          container.insertBefore(wanted[index], after);
          after = wanted[index];
        }
        return true;
      }

      function removeStaleGroupHeaders() {
        const live = new Set(state.groups.map((g) => g.id));
        for (const [gid, el] of existingGroupHeaders()) {
          if (!live.has(gid)) el.remove();
        }
      }

      // --- reconcile -------------------------------------------------------------

      function doReconcile() {
        const nav = sidebarNavRoot();
        if (!nav) return;
        const entries = projectEntries();
        const byId = new Map(entries.map((e) => [e.id, e]));
        const plan = core.planSequence(
          state,
          entries.map((e) => e.id),
        );
        const container = entries[0]?.block?.parentElement ?? null;
        const collapsed = new Set(state.groups.filter((g) => g.collapsed).map((g) => g.id));

        const desired = [];
        for (const item of plan) {
          if (item.type === "group") {
            if (container) desired.push(syncGroupHeader(item));
            continue;
          }
          const entry = byId.get(item.id);
          if (!entry) continue;
          ensureMoveButton(entry.header, entry.id);
          const gid = state.membership[entry.id];
          entry.block.classList.toggle("explodex-in-group", Boolean(gid));
          setBlockHidden(entry.block, !!(gid && collapsed.has(gid)));
          if (container && entry.block.parentElement === container) desired.push(entry.block);
        }
        if (container) {
          desired.push(groupAddEl());
          applyOrder(container, desired);
        }
        removeStaleGroupHeaders();
      }

      async function reconcile() {
        if (disposed || reconcileInFlight) return;
        await hydrate();
        if (disposed) return;
        reconcileInFlight = true;
        try {
          doReconcile();
        } catch (err) {
          log.warn("project groups reconcile failed", err);
        } finally {
          reconcileInFlight = false;
        }
      }

      function scheduleReconcile() {
        if (disposed) return;
        if (reconcileTimer != null) global.clearTimeout(reconcileTimer);
        reconcileTimer = global.setTimeout(() => {
          reconcileTimer = null;
          void reconcile();
        }, RECONCILE_DEBOUNCE_MS);
      }

      function bindSidebarObserver() {
        sidebarObserver?.disconnect();
        sidebarObserver = null;
        const nav = sidebarNavRoot();
        if (!nav) return;
        sidebarObserver = new MutationObserver(scheduleReconcile);
        sidebarObserver.observe(nav, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["data-app-action-sidebar-project-id"],
        });
      }

      // --- menus -------------------------------------------------------------------

      function closeMenu() {
        activeMenu?.remove();
        activeMenu = null;
      }

      function anchorRect(anchor) {
        return anchor.getBoundingClientRect();
      }

      function positionPanel(panel, anchor) {
        const rect = anchorRect(anchor);
        panel.style.visibility = "hidden";
        const width = panel.offsetWidth;
        const height = panel.offsetHeight;
        const x = Math.max(8, Math.min(rect.left, global.innerWidth - width - 8));
        const fitsBelow = rect.bottom + 4 + height + 8 <= global.innerHeight;
        const y = fitsBelow ? rect.bottom + 4 : Math.max(8, rect.top - height - 4);
        panel.style.left = `${x}px`;
        panel.style.top = `${y}px`;
        panel.style.visibility = "";
      }

      function positionPanelAt(panel, cx, cy) {
        panel.style.visibility = "hidden";
        const width = panel.offsetWidth;
        const height = panel.offsetHeight;
        const x = Math.max(8, Math.min(cx, global.innerWidth - width - 8));
        const y = Math.max(8, Math.min(cy, global.innerHeight - height - 8));
        panel.style.left = `${x}px`;
        panel.style.top = `${y}px`;
        panel.style.visibility = "";
      }

      function menuShell(label) {
        const backdrop = document.createElement("div");
        backdrop.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:transparent";
        backdrop.addEventListener("pointerdown", (event) => {
          if (event.target === backdrop) closeMenu();
        });

        const panel = document.createElement("div");
        panel.setAttribute("role", "menu");
        panel.setAttribute("aria-label", label);
        panel.style.cssText =
          "position:fixed;z-index:2147483647;min-width:180px;padding:4px;border-radius:10px;" +
          "border:1px solid color-mix(in srgb, currentColor 14%, transparent);" +
          "background:var(--color-bg-primary,#111);color:inherit;" +
          "box-shadow:0 12px 32px color-mix(in srgb,#000 45%,transparent);" +
          "font:13px/1.4 system-ui,-apple-system,sans-serif";

        const wrap = document.createElement("div");
        wrap.appendChild(backdrop);
        wrap.appendChild(panel);
        activeMenu = wrap;
        document.body.appendChild(wrap);
        return panel;
      }

      /** @param {{label: string, active?: boolean, onClick?: () => void}} opts */
      function menuItem({ label, active, onClick }) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = active ? `${label} ✓` : label;
        btn.style.cssText =
          "display:block;width:100%;text-align:left;padding:8px 12px;border:0;background:transparent;" +
          "color:inherit;font:13px system-ui,-apple-system,sans-serif;cursor:pointer;border-radius:6px";
        btn.addEventListener("mouseenter", () => {
          btn.style.background = "color-mix(in srgb, currentColor 8%, transparent)";
        });
        btn.addEventListener("mouseleave", () => {
          btn.style.background = "transparent";
        });
        btn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          closeMenu();
          onClick();
        });
        return btn;
      }

      function openMenu(anchor, label, build, at) {
        closeMenu();
        const panel = menuShell(label);
        build(panel);
        if (at) positionPanelAt(panel, at.x, at.y);
        else positionPanel(panel, anchor);
      }

      function openPrompt(anchor, title, initial, onSubmit, at) {
        openMenu(
          anchor,
          title,
          (panel) => {
            const heading = document.createElement("div");
            heading.textContent = title;
            heading.style.cssText =
              "padding:6px 10px 4px;opacity:.65;font-size:11px;text-transform:uppercase;letter-spacing:.05em";
            panel.appendChild(heading);

            const input = document.createElement("input");
            input.value = initial;
            input.style.cssText =
              "display:block;width:calc(100% - 20px);margin:2px 10px 8px;padding:6px 8px;border-radius:6px;" +
              "border:1px solid color-mix(in srgb, currentColor 20%, transparent);" +
              "background:color-mix(in srgb, currentColor 5%, transparent);color:inherit;font:13px system-ui,-apple-system,sans-serif";
            input.addEventListener("keydown", (event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                const value = input.value.trim();
                if (value) {
                  closeMenu();
                  onSubmit(value);
                }
              } else if (event.key === "Escape") {
                closeMenu();
              }
            });
            panel.appendChild(input);
            requestAnimationFrame(() => input.focus());
            input.select?.();
          },
          at,
        );
      }

      function openGroupMenu(anchor, gid) {
        openMenu(anchor, "Group options", (panel) => {
          panel.appendChild(
            menuItem({
              label: "Rename…",
              onClick: () => {
                const group = state.groups.find((g) => g.id === gid);
                openPrompt(anchor, "Rename group", group?.name ?? "", (name) =>
                  commit(core.renameGroup(state, gid, name)),
                );
              },
            }),
          );
          panel.appendChild(
            menuItem({ label: "Move up", onClick: () => commit(core.moveGroup(state, gid, "up")) }),
          );
          panel.appendChild(
            menuItem({ label: "Move down", onClick: () => commit(core.moveGroup(state, gid, "down")) }),
          );
          panel.appendChild(
            menuItem({ label: "Delete group", onClick: () => commit(core.removeGroup(state, gid)) }),
          );
        });
      }

      function openProjectMenu(anchor, projectId, at) {
        openMenu(
          anchor,
          "Move to group",
          (panel) => {
            panel.appendChild(
              menuItem({
                label: "Ungrouped",
                active: !state.membership[projectId],
                onClick: () => commit(core.assignProject(state, projectId, null)),
              }),
            );
            for (const group of state.groups) {
              panel.appendChild(
                menuItem({
                  label: group.name,
                  active: state.membership[projectId] === group.id,
                  onClick: () => commit(core.assignProject(state, projectId, group.id)),
                }),
              );
            }
          },
          at,
        );
      }

      function onKeyDown(event) {
        if (event.key === "Escape" && activeMenu) {
          event.preventDefault();
          event.stopPropagation();
          closeMenu();
        }
      }

      function onGlobalPointerDown(event) {
        if (!activeMenu) return;
        if (activeMenu.contains(event.target)) return;
        closeMenu();
      }

      // Delegated on document (not per-row) so teardown fully removes it:
      // listeners bound onto Codex-owned nodes survive hot re-injection.
      function onRowContextMenu(event) {
        const header = event.target.closest?.("[data-app-action-sidebar-project-id]");
        if (!header) return;
        const projectId = header.getAttribute("data-app-action-sidebar-project-id");
        if (!projectId) return;
        event.preventDefault();
        event.stopPropagation();
        openProjectMenu(null, projectId, { x: event.clientX, y: event.clientY });
      }

      // --- wiring ---------------------------------------------------------------------

      ensureStyles();
      bindSidebarObserver();
      unsubscribeSidebar = inject.observeZone("sidebar", () => {
        bindSidebarObserver();
        void reconcile();
      });
      global.addEventListener("keydown", onKeyDown, true);
      global.addEventListener("pointerdown", onGlobalPointerDown, true);
      global.addEventListener("contextmenu", onRowContextMenu, true);
      global.addEventListener("scroll", closeMenu, true);

      void hydrate()
        .then(() => {
          if (!disposed) return reconcile();
        })
        .catch((err) => log.warn("project groups initial hydrate failed", err));

      log.info("project groups attached");

      return () => {
        disposed = true;
        log.info("teardown");
        closeMenu();
        if (reconcileTimer != null) global.clearTimeout(reconcileTimer);
        sidebarObserver?.disconnect();
        unsubscribeSidebar?.();
        global.removeEventListener("keydown", onKeyDown, true);
        global.removeEventListener("pointerdown", onGlobalPointerDown, true);
        global.removeEventListener("contextmenu", onRowContextMenu, true);
        global.removeEventListener("scroll", closeMenu, true);
        for (const entry of projectEntries()) {
          setBlockHidden(entry.block, false);
          entry.block.classList.remove("explodex-in-group");
        }
        for (const el of document.querySelectorAll(
          "[data-explodex-group-header],[data-explodex-group-add],[data-explodex-group-move]",
        )) {
          el.remove();
        }
        document.getElementById("explodex-project-groups-styles")?.remove();
      };
    },
  );
})(window);

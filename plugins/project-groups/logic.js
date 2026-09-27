/**
 * project-groups pure logic (no DOM). Exposed as ExplodexProjectGroupsCore;
 * also loaded directly by unit tests under a shimmed global.
 */
(function (global) {
  "use strict";

  const STATE_KEY = "explodex-project-groups-state";

  function normalizeId(value) {
    const s = value == null ? "" : String(value).trim();
    return s && s !== "null" && s !== "undefined" ? s : null;
  }

  function makeId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeState(raw) {
    const groups = Array.isArray(raw?.groups)
      ? raw.groups
          .map((g, i) => {
            if (!g || typeof g !== "object") return null;
            return {
              id: normalizeId(g.id) ?? makeId("g"),
              name: String(g.name ?? "").trim() || `Group ${i + 1}`,
              color: typeof g.color === "string" && /^#[0-9a-f]{3,8}$/i.test(g.color) ? g.color : null,
              collapsed: !!g.collapsed,
              order: Number.isFinite(g.order) ? g.order : i,
            };
          })
          .filter(Boolean)
      : [];
    groups.sort((a, b) => a.order - b.order);
    const ids = new Set(groups.map((g) => g.id));
    const membership = {};
    for (const [pid, gid] of Object.entries(raw?.membership ?? {})) {
      const p = normalizeId(pid);
      const g = normalizeId(gid);
      if (p && g && ids.has(g)) membership[p] = g;
    }
    return { groups, membership };
  }

  function groupOf(state, projectId) {
    const gid = state.membership[projectId] ?? null;
    return gid ? (state.groups.find((g) => g.id === gid) ?? null) : null;
  }

  function assignProject(state, projectId, groupId) {
    const p = normalizeId(projectId);
    if (!p) return state;
    const groups = groupId == null ? null : (state.groups.find((g) => g.id === groupId) ?? null);
    const membership = { ...state.membership };
    if (groups) membership[p] = groups.id;
    else delete membership[p];
    return { groups: state.groups, membership };
  }

  function createGroup(state, name, { color = null } = {}) {
    const trimmed = String(name ?? "").trim();
    if (!trimmed) return state;
    const order = state.groups.reduce((max, g) => Math.max(max, g.order + 1), 0);
    return {
      ...state,
      groups: [...state.groups, { id: makeId("g"), name: trimmed, color, collapsed: false, order }],
    };
  }

  function renameGroup(state, groupId, name) {
    const trimmed = String(name ?? "").trim();
    if (!trimmed) return state;
    return {
      ...state,
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, name: trimmed } : g)),
    };
  }

  function toggleGroupCollapsed(state, groupId) {
    return {
      ...state,
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g)),
    };
  }

  function removeGroup(state, groupId) {
    const groups = state.groups.filter((g) => g.id !== groupId).map((g, i) => ({ ...g, order: i }));
    const membership = {};
    for (const [p, g] of Object.entries(state.membership)) if (g !== groupId) membership[p] = g;
    return { groups, membership };
  }

  function moveGroup(state, groupId, direction) {
    const idx = state.groups.findIndex((g) => g.id === groupId);
    const to = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || to < 0 || to >= state.groups.length) return state;
    const groups = [...state.groups];
    const [g] = groups.splice(idx, 1);
    groups.splice(to, 0, g);
    return { ...state, groups: groups.map((x, i) => ({ ...x, order: i })) };
  }

  // Desired sidebar sequence: every group (with its projects in DOM order),
  // then ungrouped projects in DOM order. Items reference DOM-stable ids.
  function planSequence(state, domProjectIds) {
    const known = new Set(domProjectIds);
    const seq = [];
    const seen = new Set();
    // Empty groups keep a header so projects can still be moved into them.
    for (const g of state.groups) {
      const members = domProjectIds.filter((p) => state.membership[p] === g.id);
      seq.push({
        type: "group",
        id: g.id,
        collapsed: g.collapsed,
        name: g.name,
        color: g.color,
        count: members.length,
      });
      for (const p of members) {
        seq.push({ type: "project", id: p });
        seen.add(p);
      }
    }
    for (const p of domProjectIds) {
      if (!seen.has(p) && known.has(p)) seq.push({ type: "project", id: p });
    }
    return seq;
  }

  global.ExplodexProjectGroupsCore = {
    STATE_KEY,
    normalizeId,
    normalizeState,
    groupOf,
    assignProject,
    createGroup,
    renameGroup,
    toggleGroupCollapsed,
    removeGroup,
    moveGroup,
    planSequence,
  };
})(typeof window !== "undefined" ? window : globalThis);

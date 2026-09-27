import { describe, expect, test } from "bun:test";
import "../plugins/project-groups/logic.js";

const core = globalThis.ExplodexProjectGroupsCore;

function stateWith(groups, membership = {}) {
  return core.normalizeState({ groups, membership });
}

describe("normalizeState", () => {
  test("drops junk and backfills defaults", () => {
    const s = core.normalizeState({ groups: [{ name: "  " }, "not-an-object"], membership: 5 });
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0].name).toBe("Group 1");
    expect(s.groups[0].id).toMatch(/^g-/);
    expect(s.groups[0].collapsed).toBe(false);
    expect(s.membership).toEqual({});
  });

  test("sorts by order and rejects membership into missing groups", () => {
    const s = stateWith(
      [
        { id: "b", name: "Second", order: 5 },
        { id: "a", name: "First", order: 1 },
      ],
      { p1: "a", p2: "ghost", p3: null },
    );
    expect(s.groups.map((g) => g.id)).toEqual(["a", "b"]);
    expect(s.membership).toEqual({ p1: "a" });
  });

  test("validates colors", () => {
    const s = stateWith([
      { id: "a", name: "A", color: "#0aB4cD" },
      { id: "b", name: "B", color: "red" },
    ]);
    expect(s.groups[0].color).toBe("#0aB4cD");
    expect(s.groups[1].color).toBe(null);
  });
});

describe("group mutations", () => {
  const base = () =>
    stateWith(
      [
        { id: "g1", name: "One", order: 0 },
        { id: "g2", name: "Two", order: 1 },
        { id: "g3", name: "Three", order: 2 },
      ],
      { pA: "g1", pB: "g2" },
    );

  test("createGroup appends after the highest order", () => {
    const s = base();
    const next = core.createGroup(s, " Fresh ");
    expect(next.groups).toHaveLength(4);
    const added = next.groups[3];
    expect(added.name).toBe("Fresh");
    expect(added.order).toBe(3);
    expect(core.createGroup(s, "   ")).toBe(s);
  });

  test("renameGroup ignores blank names", () => {
    const s = base();
    expect(core.renameGroup(s, "g1", "  ").groups[0].name).toBe("One");
    expect(core.renameGroup(s, "g1", " Work ").groups[0].name).toBe("Work");
  });

  test("toggleGroupCollapsed flips only the target", () => {
    const s = base();
    const next = core.toggleGroupCollapsed(s, "g2");
    expect(next.groups.map((g) => g.collapsed)).toEqual([false, true, false]);
  });

  test("removeGroup ungroups members and reindexes order", () => {
    const s = core.toggleGroupCollapsed(base(), "g2");
    const next = core.removeGroup(s, "g2");
    expect(next.groups.map((g) => [g.id, g.order])).toEqual([
      ["g1", 0],
      ["g3", 1],
    ]);
    expect(next.membership).toEqual({ pA: "g1" });
  });

  test("moveGroup swaps neighbours and clamps at the edges", () => {
    const s = base();
    expect(core.moveGroup(s, "g2", "up").groups.map((g) => g.id)).toEqual(["g2", "g1", "g3"]);
    expect(core.moveGroup(s, "g1", "down").groups.map((g) => g.id)).toEqual(["g2", "g1", "g3"]);
    expect(core.moveGroup(s, "g1", "up")).toBe(s);
    expect(core.moveGroup(s, "g3", "down")).toBe(s);
    expect(core.moveGroup(s, "g2", "up").groups.map((g) => g.order)).toEqual([0, 1, 2]);
  });
});

describe("assignProject", () => {
  test("assigns to an existing group and unassigns with null", () => {
    const s = stateWith([{ id: "g1", name: "G", order: 0 }]);
    const assigned = core.assignProject(s, "pA", "g1");
    expect(assigned.membership).toEqual({ pA: "g1" });
    expect(core.assignProject(assigned, "pA", null).membership).toEqual({});
    expect(core.assignProject(s, "pA", "ghost").membership).toEqual({});
    expect(core.assignProject(s, null, "g1")).toBe(s);
  });
});

describe("planSequence", () => {
  test("groups first in group order, then ungrouped projects in DOM order", () => {
    const s = stateWith(
      [
        { id: "g2", name: "Personal", order: 0 },
        { id: "g1", name: "Work", order: 1 },
      ],
      { pB: "g2", pA: "g1", pC: "g1" },
    );
    const plan = core.planSequence(s, ["pA", "pB", "pC", "pD", "pE"]);
    expect(plan).toEqual([
      { type: "group", id: "g2", collapsed: false, name: "Personal", color: null, count: 1 },
      { type: "project", id: "pB" },
      { type: "group", id: "g1", collapsed: false, name: "Work", color: null, count: 2 },
      { type: "project", id: "pA" },
      { type: "project", id: "pC" },
      { type: "project", id: "pD" },
      { type: "project", id: "pE" },
    ]);
  });

  test("empty groups keep a header with count 0", () => {
    const s = stateWith([{ id: "g1", name: "Empty", order: 0, collapsed: true }]);
    const plan = core.planSequence(s, ["pA"]);
    expect(plan[0]).toEqual({
      type: "group",
      id: "g1",
      collapsed: true,
      name: "Empty",
      color: null,
      count: 0,
    });
    expect(plan[1]).toEqual({ type: "project", id: "pA" });
  });

  test("collapsed groups still list members so they can be hidden", () => {
    const s = stateWith([{ id: "g1", name: "G", order: 0, collapsed: true }], { pA: "g1" });
    const plan = core.planSequence(s, ["pA", "pB"]);
    expect(plan.map((p) => p.type)).toEqual(["group", "project", "project"]);
  });

  test("ignores membership pointing at projects missing from the DOM", () => {
    const s = stateWith([{ id: "g1", name: "G", order: 0 }], { ghost: "g1" });
    const plan = core.planSequence(s, ["pA"]);
    expect(plan).toEqual([
      { type: "group", id: "g1", collapsed: false, name: "G", color: null, count: 0 },
      { type: "project", id: "pA" },
    ]);
  });
});

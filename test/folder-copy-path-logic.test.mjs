import { describe, expect, test } from "bun:test";
import "../plugins/folder-copy-path/logic.js";

const core = globalThis.ExplodexFolderCopyPathCore;

describe("joinPath", () => {
  test("joins relative paths with Windows roots using backslashes", () => {
    expect(core.joinPath("H:\\code\\own\\test\\android", "app/src")).toBe(
      "H:\\code\\own\\test\\android\\app\\src",
    );
    expect(core.joinPath("H:\\code\\own\\test\\android\\", "\\app\\src")).toBe(
      "H:\\code\\own\\test\\android\\app\\src",
    );
  });

  test("joins with POSIX roots using slashes", () => {
    expect(core.joinPath("/home/dev/project", "src/main")).toBe("/home/dev/project/src/main");
  });

  test("keeps absolute paths untouched", () => {
    expect(core.joinPath("H:\\root", "D:\\elsewhere\\dir")).toBe("D:\\elsewhere\\dir");
    expect(core.joinPath("/root", "/abs/dir")).toBe("/abs/dir");
    expect(core.joinPath("H:\\root", "\\\\server\\share")).toBe("\\\\server\\share");
  });

  test("degrades gracefully", () => {
    expect(core.joinPath(null, "rel")).toBe("rel");
    expect(core.joinPath("H:\\root", null)).toBe("H:\\root");
    expect(core.joinPath(null, null)).toBe(null);
  });
});

describe("entryFromProps", () => {
  test("reads the flat {path,name,type} shape", () => {
    const e = core.entryFromProps({ path: "H:\\a\\b", name: "b", type: "directory" });
    expect(e).toEqual({ path: "H:\\a\\b", name: "b", isFolder: true });
  });

  test("reads wrapped entry/file/node objects", () => {
    for (const key of ["entry", "file", "node", "item"]) {
      const e = core.entryFromProps({ [key]: { absolutePath: "/x/y", isFolder: true } });
      expect(e).toEqual({ path: "/x/y", name: "y", isFolder: true });
    }
  });

  test("treats props with children arrays as folders", () => {
    const e = core.entryFromProps({ entry: { path: "/p/q", children: [] } });
    expect(e.isFolder).toBe(true);
    expect(e.name).toBe("q");
  });

  test("returns null for junk", () => {
    expect(core.entryFromProps(null)).toBe(null);
    expect(core.entryFromProps({ name: "no path" })).toBe(null);
    expect(core.entryFromProps({ path: 42 })).toBe(null);
  });
});

describe("looksLikeFolder", () => {
  test("aria-expanded in any state marks a tree folder row", () => {
    expect(core.looksLikeFolder({ ariaExpanded: "true" })).toBe(true);
    expect(core.looksLikeFolder({ ariaExpanded: "false" })).toBe(true);
  });

  test("chevron icon marks a folder", () => {
    expect(core.looksLikeFolder({ hasChevron: true, name: "readme" })).toBe(true);
  });

  test("extensionless names look like folders, dotted names do not", () => {
    expect(core.looksLikeFolder({ name: "app" })).toBe(true);
    expect(core.looksLikeFolder({ name: "build.gradle.kts" })).toBe(false);
    expect(core.looksLikeFolder({ name: "Dockerfile" })).toBe(true);
  });
});

describe("basename", () => {
  test("handles both separators", () => {
    expect(core.basename("H:\\a\\b\\c")).toBe("c");
    expect(core.basename("/x/y/z")).toBe("z");
    expect(core.basename("plain")).toBe("plain");
  });
});

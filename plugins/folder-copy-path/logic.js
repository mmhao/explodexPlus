/**
 * folder-copy-path pure logic (no DOM). Exposed as
 * ExplodexFolderCopyPathCore; unit-testable in isolation.
 */
(function (global) {
  "use strict";

  function isString(v) {
    return typeof v === "string" && v.length > 0;
  }

  // Join a workspace root with a possibly-relative tree path, keeping the
  // separator style of the root (Codex reports Windows roots with backslashes).
  function joinPath(root, rel) {
    if (!isString(rel)) return isString(root) ? root : null;
    if (!isString(root)) return rel;
    if (/^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith("/") || rel.startsWith("\\\\")) return rel;
    const winSep = /^[a-zA-Z]:[\\/]/.test(root) || root.includes("\\");
    const sep = winSep ? "\\" : "/";
    const trimmedRoot = root.replace(/[\\/]+$/, "");
    const cleanedRel = rel.replace(/^[\\/]+/, "").replace(/\//g, winSep ? "\\" : "/");
    return trimmedRoot + sep + cleanedRel;
  }

  // A props object from the Codex file tree exposes the entry in one of a few
  // shapes across builds; normalize whatever we can find.
  function entryFromProps(props) {
    if (!props || typeof props !== "object") return null;
    const direct = [props, props.entry, props.file, props.node, props.item].find(
      (v) => v && typeof v === "object" && isString(v.path ?? v.absolutePath ?? v.fullPath),
    );
    if (direct) {
      const path = direct.path ?? direct.absolutePath ?? direct.fullPath;
      const name = isString(direct.name) ? direct.name : basename(path);
      const isFolder =
        direct.type === "directory" ||
        direct.isFolder === true ||
        direct.isDirectory === true ||
        direct.kind === "folder" ||
        Array.isArray(direct.children);
      return { path, name, isFolder: !!isFolder };
    }
    if (isString(props.path) && isString(props.name)) {
      return {
        path: props.path,
        name: props.name,
        isFolder: props.type === "directory" || props.isFolder === true || props.isDirectory === true,
      };
    }
    return null;
  }

  function basename(path) {
    const parts = String(path ?? "").split(/[\\/]/);
    return parts[parts.length - 1] || String(path ?? "");
  }

  // Fallback folder heuristic when the entry shape omits type info:
  // tree rows that can be expanded, or labels without a file extension.
  function looksLikeFolder({ ariaExpanded, hasChevron, name }) {
    if (ariaExpanded === "true" || ariaExpanded === "false") return true;
    if (hasChevron) return true;
    if (isString(name) && !/\.[A-Za-z0-9]{1,8}$/.test(name.trim())) return true;
    return false;
  }

  global.ExplodexFolderCopyPathCore = {
    joinPath,
    entryFromProps,
    basename,
    looksLikeFolder,
  };
})(typeof window !== "undefined" ? window : globalThis);

// Documentation mirror verifier — runs on plain Node (>=22), no bun required.
//
// Contract it guards (see README "Documentation" / docs/development.md):
//   1. every docs/**/*.md (outside docs/zh) has a same-named mirror under docs/zh/
//   2. README.md has README.zh-CN.md at the repo root
//   3. every relative markdown link in EN docs and zh mirrors resolves on disk
//
// Failure output always carries location + how to fix, by design.
// npm run check:docs

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const ZH_DOCS = join(DOCS, "zh");

function walkMarkdown(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(p));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(p);
  }
  return out;
}

const rel = (p) => p.slice(ROOT.length + 1).replaceAll("\\", "/");

function englishDocs() {
  return walkMarkdown(DOCS).filter((p) => !p.startsWith(ZH_DOCS + "\\") && p !== join(ZH_DOCS, ""));
}

// markdown links: skip code fences, inline code, external URLs, pure #anchors
function extractLinks(file) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const links = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const stripped = line.replace(/`[^`]*`/g, "");
    for (const m of stripped.matchAll(/\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;|\s+"[^"]*")?\)/g)) {
      let target = m[1];
      if (/^(https?:|mailto:|#)/i.test(target)) continue;
      target = target.split("#")[0].split("?")[0];
      if (!target) continue;
      links.push({ target, line: i + 1 });
    }
  }
  return links;
}

test("every English doc has a docs/zh mirror", () => {
  const missing = englishDocs().filter((p) => !existsSync(join(ZH_DOCS, p.slice(DOCS.length + 1))));
  // the zh index itself has no English counterpart; it lives in docs/zh only
  if (missing.length) {
    const list = missing.map((p) => `  - ${rel(p)}\n      → 缺少中文版 ${rel(join(ZH_DOCS, p.slice(DOCS.length + 1)))}：翻译该文档或从 docs/ 删除它`).join("\n");
    throw new Error(`中文镜像缺失 ${missing.length} 篇：\n${list}`);
  }
});

test("README.zh-CN.md exists next to README.md", () => {
  if (!existsSync(join(ROOT, "README.zh-CN.md"))) {
    throw new Error("README.md 存在但 README.zh-CN.md 缺失：在仓库根目录创建中文 README（含指向 docs/zh/ 的索引）");
  }
});

test("relative markdown links resolve in all EN docs and zh mirrors", () => {
  const files = [...englishDocs(), ...walkMarkdown(ZH_DOCS), join(ROOT, "README.md"), join(ROOT, "README.zh-CN.md")].filter(
    (p) => existsSync(p)
  );
  const broken = [];
  for (const file of files) {
    for (const { target, line } of extractLinks(file)) {
      const abs = resolve(dirname(file), decodeURI(target));
      if (!existsSync(abs)) {
        broken.push(`  - ${rel(file)}:${line}\n      → 链接目标不存在：(${target})；修正相对路径或补建文件`);
      }
    }
  }
  if (broken.length) throw new Error(`断链 ${broken.length} 处：\n${broken.join("\n")}`);
});

test("zh mirrors are non-empty and link-checkable", () => {
  const empties = englishDocs()
    .map((p) => join(ZH_DOCS, p.slice(DOCS.length + 1)))
    .filter((z) => existsSync(z) && statSync(z).size < 200);
  if (empties.length) {
    throw new Error(`中文镜像疑似占位（<200B）：\n${empties.map((p) => `  - ${rel(p)} → 填入正文或删除`).join("\n")}`);
  }
});

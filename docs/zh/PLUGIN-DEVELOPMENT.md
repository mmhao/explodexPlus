> 本文是 [PLUGIN-DEVELOPMENT.md](../PLUGIN-DEVELOPMENT.md) 的中文翻译，以英文原文为准。

# 插件开发指南

构建一个 Codex 模组：脚手架 → 注入 → 实时查看效果。通用的 SDK 接口在 [sdk-api.md](sdk-api.md) 中有文档说明；本指南以两个 fork 插件为完整示例，并给你一份可直接复制粘贴的模板。

> 最快的路径：安装随包附带的 skill（`explodex-plus install-skill`），然后让 Codex 自己去构建这个插件——这个 skill 会驱动整套循环。

## 结构剖析

```
plugins/my-plugin/
  plugin.json     # { "id", "name", "version", "description", "scripts": ["logic.js", "index.js"] }
  logic.js        # optional but recommended: pure core, no DOM
  index.js        # DOM layer: registers with the SDK, reconciles UI
```

`scripts` 按顺序执行，拼接成一段注入内容——`logic.js` 在 `window`/`globalThis` 上定义其核心，`index.js` 消费它。`~/.explodex/plugins/` 中的用户插件会覆盖同 id 的随包插件。

## 完整示例 1：project-groups

目标：用可折叠的自定义分组包裹侧边栏项目，状态在重启后依然保留，且对 Codex 数据零改动。

**logic.js**（[源码](../../plugins/project-groups/logic.js)）——所有无需浏览器即可测试的部分：

- 状态形状 `{ groups: [{id, name, color, collapsed, order}], projectMembership: {projectId: groupId} }`；`normalizeState()` 用来防御垃圾数据（非对象、非法的十六进制颜色），因为状态来自我们并不完全掌控的 JSON blob。
- 变更操作（`createGroup`、`renameGroup`、`toggleGroupCollapsed`、`removeGroup`、`moveGroup`、`assignProject`）都是返回新状态的纯函数。
- `planSequence(state, domProjectIds)` 把状态 + 观测到的 DOM 顺序转换成期望的兄弟节点序列——为*每一个*分组（哪怕是空分组）生成一个分组头，成员按 DOM 顺序排列，未分组的项目追加在后面。

[test/project-groups-logic.test.mjs](../../test/project-groups-logic.test.mjs) 中的 13 个单元测试在完全不依赖 DOM 的情况下覆盖这个文件。

**index.js**——DOM 层，涉及三块关注点：

1. *持久化*：通过 SDK 桥接的全局状态进行 hydrate/save（用 `api.storage`，走 `globalState` 快速路径）。键都做了命名空间隔离（`explodex-project-groups-state`）；Codex 会把它们原样存进自己的 `.codex-global-state.json`，这就是为什么状态能在重启后存活而无需改动 Codex 逻辑。
2. *发现*：`projectEntries()` 通过 `[data-app-action-sidebar-project-id]` 把 `nav[aria-label="Chat history"]` 的各个 section 映射为 头部 + 块元素。选择器登记表见 [COMPATIBILITY.md](COMPATIBILITY.md)。
3. *协调（reconcile）*：MutationObserver（对项目-id 属性设置 attributeFilter）+ 250 ms 去抖 → `planSequence` → `applyOrder()`。**applyOrder 从不包裹 React 拥有的节点**——它只是把兄弟节点 `insertBefore` 到期望的顺序（反向链必须包含无父节点的新元素，否则新建的头部永远进不了 DOM——这是我们实际踩过的一个 bug），并用 `style.display` 隐藏/显示非活跃分组。每个注入的节点都被打上标记（`data-explodex-group-header` 等），因此拆卸时恰好移除我们添加的东西。

## 完整示例 2：folder-copy-path

目标：右侧 Files 面板里的文件夹获得与文件相同的“复制路径”操作能力。**文件行会被刻意跳过**——Codex 的原生右键菜单本来就能复制文件路径，而本插件的早期版本连文件行一起接管了，*覆盖*掉了原生的复制菜单（一次用户可见的回归）。文件门控的说明见 [COMPATIBILITY.md](COMPATIBILITY.md)（中文版）。

**logic.js**——路径代数 + 形状推断：`joinPath(root, rel)`（Windows 与 POSIX 分隔符探测、绝对/UNC 直通）、`entryFromProps(props)`（扫描已知 prop 形状以寻找 `path/absolutePath/fullPath` 以及是否为文件夹）、`looksLikeFolder({ariaExpanded, hasChevron, name})`。12 个单元测试。

**index.js**——对 `[data-app-shell-focus-area="right-panel"]` 内的每一行树节点：遍历 React fiber（`__reactFiber*` 键，最多 32 跳），收集一个带路径的 entry prop 以及来自祖先链的 `cwd`/`workspaceRoot`；解析为绝对路径；追加一个悬停时显现的复制图标（内联 SVG，而非 `⧉` 字形），它写入剪贴板（`navigator.clipboard`，`execCommand` 兜底）并闪烁 ✓/✕。该装饰器是幂等的（已标记的行会被跳过），拆卸时移除全部按钮。

设计说明：那些*唯一*信号只是标签的行会被刻意放过——从名字推断路径会复制错误的数据。宁可不放按钮，也不放错的按钮。另有两条护栏是"踩过坑"之后加上的，都对应一次用户可见的回归：（1）`folderAbsolute()` 会在任何启发式判断*之前*先拒绝文件行（`data-item-type` 为 `file|link|symlink`，或叶子名带扩展名 → 返回 `null`，即使 fiber 里标着 `isFolder: true` 也照样否决），这样原生的文件右键菜单得以保留；（2）绝不把面板颜色硬编码到 `--color-bg-primary` 上——Codex 根本没有这个属性；用 `var(--color-token-dropdown-background, var(--color-bg-primary, #111))`，注入的菜单/弹窗才能跟随当前 Codex 主题。

## 行事准则

- **幂等的协调、去抖的 observer、完整的拆卸。** 侧边栏/树在不断重新渲染；每一趟都必须开销很小，且无论运行多少次都产出相同的 DOM。禁用插件后必须零残留。
- **绝不包裹或改动 React 拥有的子树。** 重排兄弟节点、用 `display` 隐藏、追加*新的*叶子节点——这就是全部工具箱。把 Codex 自己的节点重新父挂到你的容器里，会与 React 的 reconciler 打架。
- **绝不用文本字形渲染 UI。** `◍ ● ▸ ▾ ▦ ⧉ ✓ ✕` 这类字符在 zh-CN Windows 字体栈里缺失，会以豆腐块回退渲染成看似散落的拉丁字母。圆点/箭头用 CSS 图形画、图标用内联 SVG；仅存的字符必须在 GB2312 安全集内（`＋ … √ × ▲ ▼`）。（注意：这是真实隐患，但*不是*"侧边栏行前多出 F/U 字母"那批反馈的根因——那些字母是 SDK 底部插件条被误挂进 Codex 项目覆盖层后被裁切的结果，见 [COMPATIBILITY.md](COMPATIBILITY.md) SDK 一节。视觉 bug 在修复后依然存在时，先用文本节点 `TreeWalker` 检查实时 DOM，再下结论。）
- **以 `data-testid` / aria / 无障碍文本为目标**，配合兜底选择器链，绝不用生成的类名。把你依赖的每个选择器都记录进 `docs/COMPATIBILITY.md`。
- **柔性失败。** 把协调主体包在 try/catch + `console.warn("[my-plugin] …")` 里；一个坏掉的插件应当降级为“功能缺失”，而不是“侧边栏坏了”。
- **类型检查：** 把你的插件加入 `tsconfig.plugins.json` 的 files（为你附加的任何全局变量补一个小 `types.d.ts`），并保持 `bun run --bun tsc -p tsconfig.plugins.json` 通过。

## 模板

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

然后：对一个以 debug 方式启动的 Codex 执行 `node bin/explodex.mjs inject`，在 💥 Explodex 页面把插件打开，反复迭代。带 CDP 检视的 macOS 实时开发循环见 [development.md](development.md)。

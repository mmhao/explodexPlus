> 本文是 [current-findings.md](../current-findings.md) 的中文翻译，以英文原文为准。

# Explodex 当前调查发现

日期：2026-06-26（针对 Codex v26.623.31921 的侧边栏布局更新）

## 侧边栏布局变化（v26.623+）

与 `vendor/Codex.app` ASAR 对比（构建 **4452**，SHA-256
`04287710b058bc0977031481c21f5ab69cfb2bcf4fa5c1919b9b590c38960543`）：

- **设置移入 profile 页脚** — 底部 `button[aria-label="Open settings"]`
  （`codex.profileFooter.openSettings`）显示用户名/邮箱；侧边栏底部不再有
  专门的 "Settings" 导航行。
- **线程列表地标更名** — `nav[aria-label="Scheduled task folders"]`
  （旧版为 `Automation folders`）。
- **滚动区域** — `[data-app-action-sidebar-scroll]`，底部内边距通过
  CSS 变量 `--sidebar-footer-height` 实现（由 ResizeObserver 测量）。
- **新增分区属性** — `data-app-action-sidebar-section`、
  `data-app-action-sidebar-section-heading`、`data-app-action-sidebar-section-toggle`、…
- **路由导航仍位于滚动区顶部** — Library / Automations / Plugins|Skills / Pull
  requests 仍是 `topContent` 中的文本导航按钮，不在 profile 页脚。

**Explodex 更新（本次会话）：**

- SDK `sidebarNav.insertBefore(["Settings"], …)` 通过 `aria-label` 解析
  profile 页脚（回退标签：`Profile`、`Account`）。
- `plugins/pin-scope-menu` 的导航根节点接受新的 aria-label + `nav.sidebar-foreground-muted`。
- 工具：`bun scripts/cdp-layout-snapshot.ts`（DOM 地标 JSON）、
  `bun scripts/cdp-react-devtools.ts`（通过 CDP 注入 DevTools 后端）。

示意图见 [codex-architecture.md](./codex-architecture.md) §4 sidebar chrome。

---

日期：2026-06-17

## 安全边界

- 安装于 `/Applications/Codex.app` 的应用仅用于最初的只读检查。
- 应用已复制进本工作区的 `vendor/Codex.app`。
- `vendor/Codex.app/Contents/Resources/app.asar` 在复制时与已安装捆绑包逐字节一致：
  - SHA-256: `586dcb004fc1dc50030bcdd10677e06fbb771c2b016f62880df16e58ff134050`
- 未来所有补丁、提取、重打包与启动实验都只应针对 `vendor/Codex.app`。
- 不要对 `/Applications/Codex.app` 进行操作或修改。

## 已安装应用元数据

从 `vendor/Codex.app/Contents/Info.plist` 观察到：

- 应用名：Codex
- Bundle 标识符：`com.openai.codex`
- 版本：`26.609.41114`
- Bundle version：`3888`
- Chromium 基础版本：`149.0.7827.54`
- URL scheme：`codex://`
- ASAR 完整性在 `ElectronAsarIntegrity` 中针对 `Resources/app.asar` 有声明。
- 应用请求了广泛的 macOS 能力，包括 Apple Events、摄像头、麦克风以及音频采集用途说明。

## 捆绑包结构

Electron 载荷存放于：

```text
vendor/Codex.app/Contents/Resources/app.asar
```

ASAR 头部显示以下顶层条目：

```text
.vite/
native-menu-locales/
node_modules/
package.json
skills/
webview/
```

在 ASAR 内部发现的重要文件：

```text
.vite/build/bootstrap.js                 Electron bootstrap entry
.vite/build/main-DFegGFWC.js             Main Electron process bundle
.vite/build/preload.js                   Main renderer preload bridge
.vite/build/sandbox-preload.js           MCP/web sandbox preload
webview/index.html                       Main renderer HTML shell
webview/assets/composer-controller-*.js   Composer UI/runtime code
webview/assets/composer-*.js             Composer UI chunks
webview/assets/local-conversation-*.js    Local thread UI chunks
webview/assets/sidebar-*.js              Sidebar state/UI chunks
webview/assets/thread-app-shell-*.js      Thread shell/chrome chunks
```

ASAR 似乎可以用一个小型自定义解析器读取。检查得到的头部事实：

- 头部大小：`771096`
- JSON 头部大小：`771090`
- 文件数量：约 `2870`
- 正确读取文件的内容基准偏移：`8 + header_size + 4`，即 `771108`

## 包元数据

内嵌的 `package.json` 将该应用标识为：

```json
{
  "name": "openai-codex-electron",
  "productName": "Codex",
  "version": "26.609.41114",
  "main": ".vite/build/bootstrap.js"
}
```

从内嵌元数据得到的重要依赖/工具信号：

- Electron: `42.1.0`
- Vite: `8.0.3`
- Vitest: `4.1.5`
- TypeScript: `^5.9.3`
- React 被打包进 `webview/assets` 各 chunk。
- 应用的第一方概念包括插件、技能（skills）、MCP 能力、本地会话、浏览器侧边栏以及输入框（composer）控件。

## Electron/主进程发现

主进程经过打包与混淆，但若干有用模式仍然可见：

- Bootstrap 导入 `.vite/build/main-DFegGFWC.js` 并调用 `runMainAppStartup()`。
- 主 `BrowserWindow` 构造使用安全默认值：
  - `contextIsolation: true`
  - `nodeIntegration: false`
  - `spellcheck: true`
  - `preload: this.options.preloadPath`
  - `devTools: this.options.allowDevtools`
- 若干内部/工具窗口显式设置了 `devTools: false`。
- 主渲染进程 preload 通过 `contextBridge.exposeInMainWorld` 暴露 `window.electronBridge`。
- preload 桥接支持与宿主消息相关的 API，包括：
  - `sendMessageFromView`
  - `subscribeToWorkerMessages`
  - `showContextMenu`
  - `showApplicationMenu`
  - `getSharedObjectSnapshotValue`
  - `getSystemThemeVariant`
  - `getBuildFlavor`
- 主进程包含如下 IPC 通道：
  - `codex_desktop:message-from-view`
  - `codex_desktop:message-for-view`
  - `codex_desktop:show-context-menu`
  - `codex_desktop:show-application-menu`
  - `codex_desktop:get-build-flavor`

## 渲染进程/webview 发现

主 UI 位于 `webview/`，采用 Vite 风格的模块图，chunk 化资产数量众多。

`webview/index.html` 是一个标准外壳，包含：

- `#root`
- 启动加载器的 CSS/HTML
- 渲染进程 chunk 的 modulepreload 链接
- 前端的主 module 脚本

当前最强的 SDK 锚点是渲染进程 DOM，而非私有的 React 内部结构。理由：

- React 组件/函数名已被混淆，且 chunk 哈希对更新非常敏感。
- 若干有用的面向 DOM 的字符串和 ID 能在混淆后保留。
- DOM 选择器与变更观察器（mutation observer）可以提供第一层稳定性，同时继续深入研究更深的 React 钩子。

## 扩展注入区域（zone）证据

### Composer 区域

Composer 捆绑包包含明确的 portal 标记：

```text
above-composer-portal
above-composer-queue-portal
data-above-composer-portal
data-above-composer-queue-portal
```

这些标记很有价值，因为它们看起来是被有意设计为 composer 周围的 DOM portal 锚点。

相关捆绑包：

```text
webview/assets/composer-controller-DSr1Xyxe.js
```

应用还有一个相当庞大的 composer 界面（surface）：

```text
webview/assets/composer-DhWyK5QW.js
webview/assets/composer-controller-DSr1Xyxe.js
webview/assets/composer-footer-CPJYr1E5.js
webview/assets/composer-view-state-BcfwXUWF.js
webview/assets/use-composer-controller-Dzedh92X.js
webview/assets/focus-composer-C1SyQqFT.js
```

POC 选择器策略：

- composer 上方的 UI 优先使用 `[data-above-composer-portal]` 和 `#above-composer-portal`。
- 对于 composer 操作，先找到 `textarea`、`[contenteditable="true"]` 或 `[role="textbox"]`，然后挂载到最近的 form/composer 外壳附近。

### 侧边栏区域

存在与侧边栏相关的 chunk：

```text
webview/assets/sidebar-signals-BA19kopf.js
webview/assets/sidebar-project-groups-C80SCrXe.js
webview/assets/sidebar-thread-list-signals-D5pCHKg3.js
webview/assets/sidebar-thread-row-signals-De-atrPX.js
```

`sidebar-signals` 包含诸如以下的持久化状态键：

```text
sidebar-organize-mode-v1
sidebar-keep-projects-in-recent-v1
projectless-sidebar-chats-first-v1
electron-sidebar-mode-v1
thread-sort-key
sidebar-section-order-v1
sidebar-collapsed-groups
sidebar-collapsed-sections-v1
sidebar-collapsed-custom-sections-v1
```

POC 选择器策略：

- 若后续由加载器插入，优先使用明确的未来标记 `[data-explodex-sidebar]`。
- 回退到 `aside`、`[aria-label*="sidebar" i]`，以及类名包含 `sidebar` 的元素。

## 应用内已有的插件/沙箱信号

已发布的应用本身就有插件相关的 chunk 与概念：

```text
webview/assets/plugins-page-*.js
webview/assets/plugin-detail-page-*.js
webview/assets/plugin-install-store-*.js
webview/assets/use-plugin-install-flow-*.js
webview/assets/use-plugins-*.js
webview/assets/plugin-config-edits-*.js
webview/assets/mcp-capability-*.js
```

这表明可能存在官方/内部插件架构，但目前尚不清楚它是能扩展 Codex 应用外壳本身，还是仅用于 MCP/应用集成。BetterDiscord 风格的 SDK 在未经测试验证前，不应假设这些内部结构是稳定的。

## 推荐的 SDK 架构

从分层 SDK 开始：

```diagram
╭──────────────────────────────╮
│ Explodex patcher/launcher │
╰──────────────┬───────────────╯
               │ copies/patches only vendor/Codex.app
               ▼
╭──────────────────────────────╮
│ Renderer loader              │
│ - injects SDK script         │
│ - loads user plugins         │
╰──────────────┬───────────────╯
               │ exposes window.Explodex
               ▼
╭──────────────────────────────╮
│ SDK runtime                  │
│ - zones                      │
│ - plugin registry            │
│ - DOM mutation reconciliation│
│ - composer helpers           │
╰──────────────┬───────────────╯
               │
               ▼
╭──────────────────────────────╮
│ Plugins                      │
│ - sidebar items              │
│ - composer buttons           │
│ - future panels/settings     │
╰──────────────────────────────╯
```

最初的 SDK 表面应刻意保持精简：

```ts
window.Explodex = {
  version: string,
  zones: string[],
  registerPlugin(manifest, setup): { id: string },
  mount(zoneName, nodeOrFactory, options?): boolean,
  waitForZone(zoneName, callback): () => void,
  insertIntoComposer(text): boolean,
  showStatus(message): void,
  destroy(): void,
}
```

初始区域（zone）：

- `sidebar`
- `composerActions`
- `aboveComposer`

## POC 已移除（2026-06-22）

独立的 `poc/` 测试框架和内置的 `explodex-demo` 插件已被移除。验证与插件开发现在通过 `bun run dev` / `bun run inject` 针对实时 Codex 渲染进程进行。

## 下一步实施计划

- [x] 仅本地的 ASAR 解包/打包与 patcher
- [x] 将 SDK 注入 webview/index.html + 为本地使用放宽限制
- [x] 重打包 + 移除 asar integrity key
- [ ] 启动打过补丁的 vendor 副本 + 在真实 DOM 中验证各区域（zone）
- [x] 从侧边栏/composer 捕获实时 DOM 地标并加固选择器（`cdp-layout-snapshot.ts`）
- [ ] 迭代插件表面（更多区域、更好的挂载 API）
- [ ] 仅在 DOM 区域被证明稳定之后，再探索 preload / 模块级钩子

## 风险与未知项

- ASAR 完整性可能导致朴素的重新打包无法启动，除非在本地副本中调整 `Info.plist`。
- macOS 代码签名可能在本地捆绑包被修改后报错。打过补丁的应用副本可能需要本地 ad-hoc 重签名。
- 区域选择器有意采用启发式方式，应结合从本地应用副本进行的运行时 DOM 检查进一步打磨收紧。
- DevTools 可能受 `allowDevtools` 门控；若不可用，本地加载器补丁是最佳下一步。
- React 状态集成能力有限。插件挂载 DOM，并尽可能钩住官方桥接（bridge）路径。
- 官方/内部插件 chunk 存在，但其范围与稳定性未知。

## 应用图标路径（`apps/*.png` 相对 URL）

桥接 RPC `open-in-targets` 返回的编辑器/目标图标是**相对**路径（`apps/cursor.png`、`apps/vscode.png`、…）。捆绑资产位于 `webview/apps/*.png`，应当从绝对路径 `/apps/*.png` 加载。

在嵌套路由上（`app://-/settings/apps`、`app://-/settings/personalization`、…），浏览器会把 `apps/cursor.png` 相对当前路径解析 → `.../settings/apps/apps/cursor.png`（404）。随后 `thread-app-shell-chrome-*.js` 会设置 `onError` → `apps/vscode.png`（同样是相对路径），可能在 `.../settings/apps/vscode.png` 上循环。

Explodex SDK 通过 `sdk/explodex-sdk.js` 中的 `installAppIconPathFix()` 缓解：把任何 `apps/*.(png|svg)` 的 `img.src` 赋值改写为 `new URL('/apps/…', location.href)`，并在图片报错时修复已经解析错误的 URL。

## 强烈建议

按以下顺序推进：

1. 保持 `vendor/Codex.app` 作为可变的沙箱。
2. 构建一个可重复的 patcher，能够从干净的应用副本恢复。
3. 初版 SDK 保持基于 DOM 区域。
4. 在真实应用中验证侧边栏/composer 区域。
5. 然后再研究更深的 React/模块钩子以获得更丰富的 API。

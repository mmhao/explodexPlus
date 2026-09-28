> 本文是 [codex-architecture.md](../codex-architecture.md) 的中文翻译，以英文原文为准。

# Codex 桌面应用架构参考（Codex Desktop Architecture Reference）

> 逆向工程来源：`vendor/Codex.app/Contents/Resources/app.asar`（v26.623.31921，build 4452，Electron 42.1.0）。  
> 提取产物仅保存在本地 `extracted/` 下（如存在）。所有补丁实验只针对 `vendor/Codex.app` —— 绝不针对 `/Applications/Codex.app`。

---

## 目录

1. [包拓扑（Bundle topology）](#1-包拓扑bundle-topology)
2. [源码映射（Source maps）](#2-源码映射source-maps)
3. [进程架构（Process architecture）](#3-进程架构process-architecture)
4. [渲染进程布局与面板（Renderer layout & panels）](#4-渲染进程布局与面板renderer-layout--panels)
5. [注入区域（Injection zones）](#5-注入区域injection-zones)
6. [UI 组件（UI components）](#6-ui-组件ui-components)
7. [路由与页面（Routes & pages）](#7-路由与页面routes--pages)
8. [数据与持久化（Data & persistence）](#8-数据与持久化data--persistence)
9. [IPC 与桥接 API（IPC & bridge APIs）](#9-ipc-与桥接-apiipc--bridge-apis)
   - 另见：[composer-message-lifecycle.md](./composer-message-lifecycle.md) — 发送/提交 API、effort、钩子挂载点
10. [建议的 Explodex 注入 API（Suggested Explodex injection API）](#10-建议的-explodex-注入-apisuggested-explodex-injection-api)
11. [注入方式（Injection methods）](#11-注入方式injection-methods)
12. [风险与稳定性（Risks & stability）](#12-风险与稳定性risks--stability)
    - 另见：[sdk-fragility.md](./sdk-fragility.md) — SDK 破损模式、fiber/桥接风险、升级检查清单

---

## 1. 包拓扑（Bundle topology）

### ASAR 布局（ASAR layout）

```
app.asar/
├── package.json              # openai-codex-electron, main → .vite/build/bootstrap.js
├── .vite/build/              # Electron main + preload bundles
│   ├── bootstrap.js          # Entry: sets userData, imports main
│   ├── main-DFegGFWC.js      # Window manager, IPC, services
│   ├── preload.js            # contextBridge → window.electronBridge
│   ├── sandbox-preload.js    # MCP web sandbox guest
│   ├── comment-preload.js    # Browser sidebar comment overlay
│   └── worker.js             # Git / heavy tasks off main thread
├── webview/                  # React SPA (Vite chunks)
│   ├── index.html            # #root, CSP, module entry
│   └── assets/               # ~2800 chunked JS/CSS modules
├── skills/                   # Bundled skill templates
└── node_modules/             # better-sqlite3, ws, zod, etc.
```

### 关键版本信号（Key version signals）

| 字段 | 值 |
|-------|-------|
| 应用版本 | `26.623.31921` |
| 构建号 | `4452` |
| Electron | `42.1.0` |
| Chromium | `149.0.7827.54` |
| Vite | `8.0.3` |
| 运行时外壳 | `owl`（`owl-electron-app.json`） |
| Bundle ID | `com.openai.codex` |

---

## 2. 源码映射（Source maps）

**发现：** 生产环境的 webview chunk 通过 `//# sourceMappingURL=<chunk>.js.m` 引用源码映射（source maps），但 `.map` / `.js.m` 文件**并未随** ASAR **发布**。只有 `cua_node/` 下存在第三方映射文件（pdfjs、tesseract）。

**影响：** 逆向工程依赖以下线索：
- 在压缩（minification）后存活下来的字符串字面量（`data-*`、`data-testid`、i18n key）
- chunk 文件名（带哈希，对版本更新敏感）
- 内联的 `//# sourceMappingURL` 提示可还原原始模块名（例如 `button-DO-oxX3-.js` → Button 组件）

**chunk 中存活下来的有用标识符：**

| chunk 哈希文件 | 逻辑模块 |
|-----------------|----------------|
| `button-DO-oxX3-.js` | `Button` 组件 |
| `dialog-layout-DyzgPiHE.js` | Radix Dialog 包装器 |
| `composer-DhWyK5QW.js` | 输入框（composer）编排逻辑 |
| `composer-controller-DSr1Xyxe.js` | ProseMirror 编辑器控制器 |
| `app-initial~app-main~remote-conversation-page~new-thread-panel-page~projects-index-page~app~ovcriy74-*.js` | 应用外壳布局（浮动 + 停靠左侧面板） |
| `app-initial~app-main~automations-page-*.js` | 侧边栏界面（threads、个人资料页脚、路由导航） |
| `thread-scroll-layout-CQlmRS86.js` | 会话线程滚动 + 页脚传送门（portal） |
| `setting-storage-II74UqER.js` | 设置项 React Query 桥接 |
| `persisted-signal-C9s53PEH.js` | 持久化 atom 存储 |
| `vscode-api-B47PzOKa.js` | Electron 消息桥接 |
| `sidebar-signals-BA19kopf.js` | 侧边栏持久化状态 |

---

## 3. 进程架构（Process architecture）

```
┌─────────────────────────────────────────────────────────────┐
│ bootstrap.js                                                │
│  - CODEX_ELECTRON_USER_DATA_PATH override                   │
│  - single-instance lock                                     │
│  - → main-DFegGFWC.js (runMainAppStartup)                   │
└──────────────────────────┬──────────────────────────────────┘
                           │
     ┌─────────────────────┼─────────────────────┐
     ▼                     ▼                     ▼
┌──────────┐        ┌──────────────┐       ┌─────────────┐
│ Main     │◄─IPC──►│ Renderer     │       │ Worker      │
│ process  │        │ (webview/)   │       │ (git, etc.) │
│          │        │ preload.js   │       └─────────────┘
│ sqlite   │        │ React SPA    │
│ services │        └──────────────┘
└──────────┘
```

### 主进程服务（Main process services）

| 服务 | 职责 |
|---------|------|
| WindowManager | BrowserWindow、preload、缩放、DevTools 策略 |
| ElectronMessageHandler | 通过 `message-from-view` 提供约 175 个 RPC 方法 |
| AppServerConnectionRegistry | 本地/远端 Codex app-server 连接 |
| AutomationSchedulerController | SQLite 自动化任务 + cron |
| BrowserSidebarManager | 应用内浏览器、CDP 输入 |
| SharedObjectRepository | `host_config`、SSH 连接 |
| PrimaryRuntimeService | CLI/运行时安装 |
| GlobalDictationService | 系统听写快捷键 |

### Preload 暴露面（Preload surfaces）

| Preload | 暴露的 API |
|---------|-------------|
| `preload.js` | `window.electronBridge`、`window.codexWindowType` |
| `sandbox-preload.js` | MCP 沙箱 guest（锁定来源） |
| `comment-preload.js` | 浏览器侧边栏评论运行时 |

### 默认安全设置（Security defaults）

- `contextIsolation: true`
- `nodeIntegration: false`
- 渲染进程（renderer）启用 CSP：`default-src 'none'`、`style-src 'unsafe-inline'`
- IPC 通过已注册的 `webContents` 做发送方校验

---

## 4. 渲染进程布局与面板（Renderer layout & panels）

### 应用外壳（v26.623+）（App shell）

左侧面板可以**停靠**（docked，`aside.app-shell-left-panel`）或**浮动**（floating，
`aside[data-testid="app-shell-floating-left-panel"]`，位于
`[data-pip-obstacle="app-shell-floating-left-panel"]` 内部）。两种形态承载同一套
侧边栏界面（sidebar chrome）。

```
┌────────────────────────────────────────────────────────────────┐
│ App header / titlebar (.app-header-tint)                       │
├──────────┬─────────────────────────────────────┬───────────────┤
│ Left     │ Main content viewport               │ Right tab     │
│ panel    │ (.app-shell-main-content-viewport)  │ panel         │
│ (sidebar)│  └─ frame (.app-shell-main-content- │ (browser,    │
│          │      frame)                          │  diff, mcp,   │
│          │  [data-app-shell-main-content-layout]│  sandbox,     │
│          │                                      │  timeline)    │
└──────────┴─────────────────────────────────────┴───────────────┘
```

### 侧边栏界面（v26.623+ 布局变化）（Sidebar chrome）

会话线程侧边栏（`hK` / automations chunk）现在是一个**带有固定（pinned）个人资料页脚的
列布局**，不再是以前那种以 "Settings" 导航行结尾的平铺列表。

```
┌─────────────────────────────┐
│ Browser search (electron)   │
├─────────────────────────────┤
│ nav[aria-label=Scheduled    │
│   task folders]             │
│  ├─ mode switch             │
│  └─ scroll [data-app-action-│
│       sidebar-scroll]       │
│       ├─ route nav (Library,│
│       │   Automations,      │
│       │   Plugins/Skills,   │
│       │   Pull requests)    │
│       └─ thread/project     │
│           sections          │
├─────────────────────────────┤
│ absolute bottom footer      │
│  ├─ import status           │
│  └─ profile footer button   │
│      aria-label=Open settings│
│      (shows user name/email) │
└─────────────────────────────┘
```

**对插件锚点的影响：**

| 旧锚点 | v26.623+ 行为 |
|------------|-------------------|
| `insertBefore(["Settings"], …)` | 目标现在是**个人资料页脚**（`button[aria-label*="settings"]`），不再是 "Settings" 文本导航行 |
| `insertAfter(["Plugins"], …)` | 仍然有效 —— 桌面端路由导航位于滚动区的 `topContent` 中 |
| `nav[aria-label="Automation folders"]` | 已改名为 **"Scheduled task folders"** —— 保留旧名称作为回退 |

**侧边栏 `data-app-action-sidebar-*` 属性（会话线程界面）：**

| 属性 | 用途 |
|-----------|---------|
| `data-app-action-sidebar-scroll` | 线程/项目列表的滚动容器 |
| `data-app-action-sidebar-section` | 可折叠分区的包装器 |
| `data-app-action-sidebar-section-heading` | 分区标题行 |
| `data-app-action-sidebar-section-toggle` | 分区折叠控件 |
| `data-app-action-sidebar-thread-id` | 线程行的身份标识 |
| `data-app-action-sidebar-thread-row` | 线程行容器 |
| `data-app-action-sidebar-thread-pinned` | 置顶（pin）状态（`"true"` / `"false"`） |
| `data-app-action-sidebar-project-id` | 项目分组身份标识 |
| `data-app-action-sidebar-project-row` | 项目行容器 |

每次 Codex 升级后，用 `bun scripts/cdp-layout-snapshot.ts` 捕获实际线上值。

**布局模式**（`data-app-shell-main-content-layout`）：
- `default`、`full-bleed`、`thread-edge-scroll`、`floating`

**页签类型**（`data-tab-id`）：
- `browser`、`diff`、`mcp-app`、`sandbox`、`timeline`
- 旧版（legacy）：`artifact:*`、`automation:*`

### 会话线程视图（Thread view，`thread-scroll-layout-CQlmRS86.js`）

采用 column-reverse 的滚动容器：

```
┌─────────────────────────────┐
│  Thread messages (children) │
│  [data-mcp-app-portal-target]│  ← MCP iframe teleports here
├─────────────────────────────┤
│  [data-thread-scroll-footer]│  ← Composer sticky footer
│    [data-above-composer-portal]
│    [data-above-composer-queue-portal]
│    .ProseMirror (composer)  │
│    attachments / footer     │
└─────────────────────────────┘
```

### 右侧面板承载面（Right panel surfaces）

| 面板 | 关键文件 | testid / data 属性 |
|-------|-----------|---------------------|
| 浏览器侧边栏 | `thread-side-panel-tabs-*.js` | `browser-sidebar-top-banner-portal` |
| MCP 应用框架 | `mcp-capability-view-frame-*.js` | `data-mcp-app-portal-target`、`data-mcp-app-expanded` |
| PDF 预览 | `pdf-preview-panel-*.js` | popcorn/artifact testid |
| DOCX 预览 | `docx-preview-panel-*.js` | section annotations |
| 输入框（composer）覆盖层 | `review-runtime-bridge-*.js` | `right-panel-composer-overlay` |

### 对话框系统（Dialog system，`dialog-layout-DyzgPiHE.js`）

Radix Dialog + Codex 覆盖层（overlay）。宽度预设：

| `width` 属性 | CSS 宽度 |
|--------------|-----------|
| `narrow` | 380px |
| `feature` | 400px |
| `compact` | 420px |
| （默认） | 520px |
| `wide` | 600px |
| `xwide` | 680px |
| `xxwide` | 800px |
| `editor` | 600×720 |

---

## 5. 注入区域（Injection zones）

### A 级 —— 官方传送门锚点（推荐）（Tier A）

| 区域 ID | 选择器 | 文件 | 用途 |
|---------|----------|------|---------|
| `aboveComposer` | `[data-above-composer-portal]` | `composer-DhWyK5QW.js` | 输入框上方的扩展 UI；Codex 通过 `createPortal` 把建议内容传送（portal）到这里 |
| `aboveComposerQueue` | `[data-above-composer-queue-portal]` | `composer-DhWyK5QW.js` | 排队消息 UI |
| `mcpAppPortal` | `[data-mcp-app-portal-target="true"]` | `thread-scroll-layout-*.js` | MCP 应用 iframe 宿主 |
| `threadFooter` | `[data-thread-scroll-footer="true"]` | `thread-scroll-layout-*.js` | 粘附式输入框页脚区域 |
| `browserSidebarBanner` | `[data-testid="browser-sidebar-top-banner-portal"]` | `thread-side-panel-tabs-*.js` | 浏览器面板顶部横幅 |
| `homeAmbient` | `[data-home-ambient-suggestions]` | `app-main-*.js` | 首页建议条 |
| `composerOverlay` | `[data-composer-overlay-floating-ui]` | `composer-controller-*.js` | 浮动自动补全（经 portal 传送） |

**输入框上方区域的会话作用域：** 该 portal 还带有 `data-above-composer-conversation-id`，可按线程定向。

### B 级 —— 启发式区域（回退方案）（Tier B）

| 区域 ID | 选择器（按优先级排序） |
|---------|---------------------------|
| `sidebar` | `aside[data-testid="app-shell-floating-left-panel"]`、`aside.app-shell-left-panel`、`[data-pip-obstacle="app-shell-floating-left-panel"] aside` |
| `composerActions` | `.ProseMirror` 的父级表单/外壳、`[class*="composer" i]` |
| `appHeader` | `.app-header-tint`、header 地标元素 |
| `statusOverlay` | `document.body`（fixed 定位，z-index 最大值） |

### C 级 —— 外壳控制属性（只读，用于布局感知）（Tier C）

| 属性 | 取值 |
|-----------|--------|
| `data-app-shell-main-content-layout` | `full-bleed`、`thread-edge-scroll`、`default`、`floating` |
| `data-app-shell-focus-area` | 焦点路由 |
| `data-tab-id` | 当前激活的右侧面板页签 |

### 注入模式（Injection pattern）

```javascript
// DOM append (SDK default)
const portal = document.querySelector('[data-above-composer-portal]');
const mount = document.createElement('div');
mount.setAttribute('data-explodex-mount', 'aboveComposer');
portal.appendChild(mount);

// React portal equivalent (if you have React in your plugin)
createPortal(<MyUI />, portal);
```

**注意：** `[data-above-composer-portal]` 使用了 `empty:hidden` —— 内容为空时会被隐藏。必须向其追加子元素才能使其可见。

---

## 6. UI 组件（UI components）

Codex 使用 React + Tailwind 设计令牌（design tokens，`bg-token-*`、`text-token-*`、`border-token-*`）。Explodex 用纯 DOM 复刻了这些样式。

### 按钮（Button，`button-DO-oxX3-.js`）

```typescript
type ButtonProps = {
  color?: 'primary' | 'secondary' | 'outline' | 'outlineActive'
         | 'ghost' | 'ghostActive' | 'ghostMuted' | 'ghostTertiary' | 'danger';
  size?: 'default' | 'large' | 'medium' | 'icon' | 'iconSm'
       | 'composer' | 'composerSm' | 'toolbar';
  uniform?: boolean;      // square aspect
  allowShrink?: boolean;
  loading?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  children: ReactNode;
  onClick?: () => void;
};
```

默认值：`color="primary"`、`size="default"`。在 Electron 标题栏区域使用 `no-drag`。

### 输入框（Composer input）

- **不是** `<textarea>` —— 使用 **ProseMirror**（`.ProseMirror`）
- 占位符：`.ProseMirror .placeholder[data-placeholder]`
- 控制器 API（`composer-controller-*.js`）：

| 读取 | 写入 |
|------|-------|
| `getText()` | `setText(text)` |
| `getPersistedText()` | `appendText(text)` |
| `hasText()` | `insertText(text)` |
| `isCursorAtEnd()` | `insertTextAtSelection(text)` |
| | `setPromptText(text)` |
| | `insertMention(...)`、`insertSkillMention(...)` |
| | `focus()`、`clear()` |

控制器实例**不会**挂载到 `window` 上 —— 通过 `document.execCommand('insertText')` 或 InputEvent 做 DOM 插入才是实际的 SDK 路径。

### 选中文本附件（Selected-text attachments）

助手 Markdown 区块暴露了 `data-selected-text-overlay-target`
（`markdown-DuQ7-Xtp.js`）。选中文本后，Codex 的原生覆盖层会挂载一个
`onAddSelectedText(selectedText)` React 回调（`composer-DhWyK5QW.js`）。
该回调会把一个字符串追加到输入框状态字段 `selectedTextAttachments`；
Codex 渲染一个汇总胶囊标签（`1 selection`、`2 selections`、……），把该数组
包含在本地输入框上下文中，并在提交后清空。Codex 还内置了原生的标注模式
（`annotation-mode-button-*.js`），用于给选区附加备注。该 DOM 属性是稳定的；
但通过 React fiber 去发现这个回调则是脆弱的。

### 设置（Settings，`setting-storage-II74UqER.js`）

```typescript
getSettingValue({ key, default })  // from React Query cache
setSetting(queryClient, { key, default }, value)
fetchSetting({ key, default })     // RPC get-setting
persistSetting({ key, default }, value)  // RPC set-setting
```

### 持久化 atom（Persisted atoms，`persisted-signal-C9s53PEH.js`）

```typescript
// Storage key prefix
const PREFIX = 'codex:persisted-atom:';

// API shape (React hook internals)
getItem(key, fallback)
setItem(key, value)
removeItem(key)
subscribe(key, callback, fallback)
```

主进程会把状态镜像（mirror）到 `globalState['electron-persisted-atom-state']`。

### 已知持久化 atom key（侧边栏）

| Key | 默认值 | 用途 |
|-----|---------|---------|
| `sidebar-organize-mode-v1` | `"project"` | 侧边栏整理模式 |
| `sidebar-keep-projects-in-recent-v1` | `true` | 在"最近"中保留项目 |
| `projectless-sidebar-chats-first-v1` | `false` | 聊天优先排序 |
| `electron-sidebar-mode-v1` | `"codex"` | Electron 侧边栏模式 |
| `thread-sort-key` | `"updated_at"` | 线程排序 |
| `sidebar-section-order-v1` | `undefined` | 分区顺序 |
| `sidebar-collapsed-groups` | `{}` | 已折叠的分组 |
| `sidebar-collapsed-sections-v1` | `{chats,cloud,pinned,threads}` | 分区折叠状态 |
| `sidebar-collapsed-custom-sections-v1` | `{}` | 自定义分区 |

---

## 7. 路由与页面（Routes & pages）

路由入口：`app-main-fcIxOLz5.js`

### 顶层路由（Top-level routes）

| 路径 | 承载面 |
|------|---------|
| `/` | 首页 |
| `thread/:conversationId` | 本地线程 |
| `/remote/:taskId` | 远端/云任务 |
| `/settings/*` | 设置外壳 |
| `/plugins` | 插件市场 |
| `/skills` | 技能（Skills） |
| `/inbox` | 收件箱 |
| `/automations` | 自动化 |
| `/mcp-app/:server/:toolName` | 独立 MCP 应用 |
| `/hotkey-window/*` | 紧凑型快捷键窗口 |
| `/global-dictation/*` | 听写覆盖层 |
| `/avatar-overlay` | 头像宠物覆盖层 |
| `/login`、`/welcome`、`/first-run` | 引导上手 |
| `/diff` | Diff 视图 |
| `/pull-requests/:n` | PR 视图 |

### 设置分区（`/settings/{slug}`）

`general-settings`、`profile`、`appearance`、`usage`、`mcp-settings`、`plugins-settings`、`skills-settings`、`data-controls`、`keyboard-shortcuts`、`browser-use`、`computer-use`、`hooks-settings`、`git-settings`、`worktrees`、`agent`、`personalization`、`connections`、`local-environments`、`appshots`

### 路由作用域类型（Route scope kinds）

`home`、`new-thread-panel`、`local-thread`、`remote-thread`、`chatgpt-thread`、`other`

---

## 8. 数据与持久化（Data & persistence）

### 存储分层（Storage layers）

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: ~/.codex/sqlite/codex.db (better-sqlite3, main)    │
│   inbox_items, automations, automation_runs, feature flags  │
├─────────────────────────────────────────────────────────────┤
│ Layer 2: userData/.codex-global-state.json (main process)   │
│   workspace roots, remote projects, hotkeys, enrollments    │
├─────────────────────────────────────────────────────────────┤
│ Layer 3: localStorage codex:persisted-atom:* (renderer)    │
│   ↔ synced to globalState electron-persisted-atom-state     │
├─────────────────────────────────────────────────────────────┤
│ Layer 4: ~/.codex/config.toml (CLI/desktop config)          │
│   plugins, MCP, browser settings                            │
├─────────────────────────────────────────────────────────────┤
│ Layer 5: Server-side (rate limits, usage — not local DB)    │
└─────────────────────────────────────────────────────────────┘
```

### 路径（Paths）

| 路径 | 内容 |
|------|----------|
| `~/Library/Application Support/Codex/` | Electron userData（macOS） |
| `~/.codex/` | Codex 主目录（config、sqlite、automations） |
| `~/.codex/sqlite/codex.db` | 生产数据库 |
| `~/.codex/sqlite/codex-dev.db` | 开发数据库 |
| `~/.codex/config.toml` | 配置 |
| `~/.codex/automations/` | 自动化 TOML 文件 |
| `~/Documents/Codex/{date}/{slug}/` | 无项目（projectless）聊天的输出 |

### SQLite 模式（v21）

| 表 | 用途 |
|-------|---------|
| `inbox_items` | 通知 |
| `automations` | 定时提示词（rrule、model、cwd） |
| `automation_runs` | 运行实例 + 状态 |
| `local_app_server_feature_enablement` | 特性开关 |

### 速率限制与用量（Rate limits & usage）

- **不在**本地 SQLite 中
- UI：`rate-limit-summary-*.js`、`rate-limit-rows-*.js`
- RPC：`fast-mode-rollout-metrics`
- 埋点分析：`CodexRateLimitResetCreditRedeemed`、`CodexSidebarUsageAlertViewed`

### 重置机制（Reset mechanisms）

| 操作 | 效果 |
|--------|--------|
| `persisted-atom-reset` IPC | 清除所有持久化 atom |
| `reset-codex-command-keybindings` RPC | 重置按键绑定 |
| `npm run devtools:reset` | 清除 DevTools 扩展缓存 |
| 设置 → data-controls | 面向用户的数据清除（应用内） |

---

## 9. IPC 与桥接 API（IPC & bridge APIs）

### Electron 通道（channels）

| 通道 | 模式 |
|---------|---------|
| `codex_desktop:message-from-view` | 渲染进程 → 主进程 RPC（`invoke`） |
| `codex_desktop:message-for-view` | 主进程 → 渲染进程事件 |
| `codex_desktop:get-shared-object-snapshot` | `sendSync` 初始状态 |
| `codex_desktop:connect-app-host` | Cap'n Proto 应用宿主桥接 |

### `window.electronBridge`（preload）

```typescript
{
  sendMessageFromView(msg: { type: string; ... }): Promise<unknown>;
  getPathForFile(file: File): string | null;
  showContextMenu(spec): Promise<void>;
  showApplicationMenu(menuId, x, y): Promise<void>;
  getSharedObjectSnapshotValue(key: string): unknown;
  getSystemThemeVariant(): 'light' | 'dark';
  subscribeToSystemThemeVariant(cb): () => void;
  getBuildFlavor(): string;
  usesOwlAppShell(): boolean;
  getAppSessionId(): string;
}
```

### 设置项的消息流

```
Renderer → sendMessageFromView({ type: 'get-setting', params: { key } })
Main → message-for-view reply
```

Explodex SDK 封装了常用 RPC：`get-setting`、`set-setting`、`get-global-state`、`set-global-state`、`navigate-to-route`。

### 渲染进程宿主事件 vs AppServer 请求

并非所有形似消息的动作都是 AppServer 请求。渲染进程宿主事件（renderer host events），例如
`new-quick-chat`，是在 `app-main-*.js` 内部注册的，并通过 Codex 渲染进程内的
`dispatchHostMessage` 单例分发。它们既不是 AppServer 请求，也不是
Electron view 消息。通过这两条对外通道任意一条发送都会错过处理者。

Explodex 内置外壳使用 Codex 原生的 `New chat` 控件，然后使用新输入框上的
`Don't work in a project` 控件。它会等待输入框稳定后再插入
构建器提示词。这样既保留了 Codex 自身的项目状态更新，
又避免了一次可能解析回当前活动线程的独立 `/` 导航。

### 持久化 atom 同步

| 消息 | 方向 |
|---------|-----------|
| `persisted-atom-sync-request` | view → main |
| `persisted-atom-sync` | main → view（完整快照） |
| `persisted-atom-update` | view → main |
| `persisted-atom-updated` | main → 所有窗口 |
| `persisted-atom-reset` | view → main |

---

## 10. 建议的 Explodex 注入 API（Suggested Explodex injection API）

```typescript
interface Explodex {
  version: string;

  // Zone registry
  zones: Record<ZoneId, ZoneDefinition>;
  inject: {
    mount(zoneId: ZoneId, node: Node | (ctx) => Node, opts?: MountOptions): boolean;
    waitFor(zoneId: ZoneId, cb: (anchor: Element) => void): () => void;
    unmount(pluginId: string): void;
  };

  // DOM component factories (Codex-styled)
  components: {
    button(opts: ButtonOptions): HTMLButtonElement;
    sidebarItem(opts: SidebarItemOptions): HTMLButtonElement;
    pill(opts: PillOptions): HTMLSpanElement;
    badge(opts: BadgeOptions): HTMLSpanElement;
    panel(opts: PanelOptions): HTMLDivElement;
    statusToast(message: string, opts?: { duration?: number }): void;
  };

  // Storage accessors
  storage: {
    persisted: {
      get<T>(key: string, fallback?: T): T;
      set(key: string, value: unknown): void;
      remove(key: string): void;
      keys(): string[];
      subscribe(key: string, cb: (value: unknown) => void): () => void;
    };
    settings: {
      get(key: string, fallback?: unknown): Promise<unknown>;
      set(key: string, value: unknown): Promise<void>;
    };
    globalState: {
      get(key: string): Promise<unknown>;
      set(key: string, value: unknown): Promise<void>;
    };
  };

  // Electron bridge
  bridge: {
    send(type: string, payload?: object): Promise<unknown>;
    on(type: string, handler: (data: object) => void): () => void;
    navigate(path: string): void;
    theme(): 'light' | 'dark';
    onThemeChange(cb: () => void): () => void;
  };

  // Composer helpers
  composer: {
    getInput(): Element | null;
    focus(): boolean;
    insertText(text: string): boolean;
    getText(): string;
  };

  // Query helpers
  query: {
    testId(id: string): Element | null;
    portal(name: string): Element | null;
    one(selector: string): Element | null;
  };

  // Plugin lifecycle
  plugins: {
    register(manifest: PluginManifest, setup: (api: PluginAPI) => void): { id: string };
    unregister(id: string): void;
  };

  // Reference data
  meta: {
    selectors: Record<string, string>;
    routes: string[];
    persistedKeys: Record<string, string>;
  };

  destroy(): void;
}
```

---

## 11. 注入方式（Injection methods）

### 方式 1：CDP 运行时注入（开发环境推荐）

```bash
CODEX_ELECTRON_USER_DATA_PATH="$PWD/.explodex-user-data" \
  ./vendor/Codex.app/Contents/MacOS/Codex --remote-debugging-port=9333

bun scripts/cdp-inject.ts
```

使用 `Page.addScriptToEvaluateOnNewDocument` + `Runtime.evaluate`。不修改 ASAR。注入器会把 SDK/插件清单应用到其启动监听窗口期内发现的所有匹配渲染页面目标。首次注入后，它会继续轮询（250ms 间隔）以捕获启动过程中晚出现的次级渲染器，但连续两次空闲轮询没有发现新目标后即中止；`EXPLODEX_TARGET_WATCH_MS`（默认 `8000`）是绝对上限，而不是固定等待时长 —— 因此单渲染器启动会在注入后约 0.5 秒打印成功日志，而不是约 8 秒之后。

关于这种方式与 `--inspect-brk` 的对比、React 加载之前能打哪些补丁、以及为什么大规模早期钩子仍然无法实现通用的 React props 注入，参见 [early-injection-and-inspect-brk.md](./early-injection-and-inspect-brk.md)。

在渲染进程内，依赖 React 所辖 DOM 的插件应优先使用 `Explodex.observeZone(zoneId, callback)`，而不是一次性的 `waitFor()`。当某个区域（zone）出现时 `observeZone` 会立即回调，当 React 替换该区域锚点时会再次回调，使插件能够在窗口尺寸、显示方式或路由生命周期的重挂载之后重新插入侧边栏/导航挂载点。仅当回调是幂等的、且还需要在 React 于同一锚点下重写子元素时收到一个防抖（debounced）信号，才传入 `{ includeMutations: true }`。

### 方式 2：ASAR 补丁（自包含包）

```bash
python3 scripts/patch.py --apply   # inject SDK + loader into index.html
python3 scripts/patch.py --restore # restore pristine vendor copy
```

补丁作用于 `webview/index.html`，放宽 CSP，并从本地副本中移除 `ElectronAsarIntegrity`。

### 方式 3：DevTools 控制台

把 `sdk/explodex-sdk.js` 粘贴到控制台（除非用 CDP 预注入，否则刷新即丢失）。

#### npm 安装模式的启动器（npm-installed launcher）

安装模式会在本地生成 `~/Applications/Explodex.app`。其 zsh 入口通过登录 shell 解析当前全局的
`explodex --launch`；npm 包通过 LaunchServices 启动未经修改的 Codex（`open -a /Applications/Codex.app --args --remote-debugging-port=<port>`），注入打包好的 SDK/插件，激活 Codex，然后退出。之所以通过 `open` 启动（而不是直接 spawn `Contents/MacOS/Codex`），是为了让 Codex 使用自己的 TCC 身份，从而使其权限提示归属于 Codex、而非发起控制的终端。它不运行守护进程，也不覆盖 Codex 的用户数据。参见 [installation.md](./installation.md) 和 [local-development.md](./local-development.md)。

---

## 12. 风险与稳定性（Risks & stability）

| 风险 | 缓解措施 |
|------|------------|
| chunk 哈希每次发布都会变化 | 优先使用 `data-testid` 和 `data-*` portal 属性，而非类名 |
| CSP 阻止外部脚本 | 插件内联打包；`style-src 'unsafe-inline'` 允许注入的 CSS |
| ASAR 补丁后代码签名失效 | 临时（ad-hoc）重签名，或改用 CDP 注入 |
| React 内部结构不稳定 | 坚持基于 DOM 区域；生产环境避免使用 fiber —— SDK 的 `codex.*` 仅作回退方案（[sdk-fragility.md](./sdk-fragility.md) §2） |
| 官方插件系统已存在 | `plugins-page-*.js`、MCP 沙箱 —— 用于外壳扩展的作用范围尚不明确 |
| ProseMirror 控制器未暴露 | 使用 DOM 的 `insertText` / `execCommand` |
| 速率限制数据在服务端 | 使用 `Explodex.http.get("/wham/usage")`；本地存储中没有 |

### 选择器稳定性排名

1. `data-testid="..."` —— 有意保留的测试钩子
2. `data-above-composer-portal` 等 —— 有意保留的传送门锚点
3. `data-app-shell-*` —— 布局控制
4. `[role="dialog"][data-state="open"]` —— Radix 状态
5. `.ProseMirror` —— 输入框（该类名跨构建稳定）
6. 带哈希的 CSS modules（`_content_pk7td_1`）—— **避免使用**

---

## 13. 速率限制与每周重置（Rate limits & weekly reset，build 4108 / 26.616.30709）

用量和手动重置额度（reset credits）都在**服务端** —— 不在本地 SQLite 或 `localStorage` 中。

### 用量查询（Usage query）

| 项目 | 值 |
|------|-------|
| React Query key | `rate-limit-status` |
| 端点 | `GET /wham/usage` |
| 重新拉取 | 每 60 秒（`refetchInterval: ONE_MINUTE`） |
| 实时信号 | `account/rateLimits/updated`（app-server 通知） |
| 来源 | `thread-context-inputs-BhGjWqLR.js` |

### 响应结构（`/wham/usage`）

```json
{
  "rate_limit": {
    "primary_window": { "used_percent": 42, "limit_window_seconds": 604800, "reset_at": 1750000000 },
    "secondary_window": { "used_percent": 10, "limit_window_seconds": 86400, "reset_at": 1750000000 },
    "limit_reached": false,
    "allowed": true
  },
  "credits": { "has_credits": true, "unlimited": false, "balance": null },
  "plan_type": "…",
  "rate_limit_reached_type": null,
  "additional_rate_limits": [],
  "spend_control": { "reached": false }
}
```

- `reset_at` 是 **Unix 秒**（不是毫秒）。
- 窗口标签由 `limit_window_seconds / 60` 推断：
  - `>= 10079` 分钟 → 每周（7×1440）
  - `>= 1439` 分钟 → 每日
  - `>= 30×1440` → 每月
  - `>= 365×1440` → 每年
- 逻辑位于：`use-rate-limit-BV5pYGKd.js`

### 手动重置额度（"the reset"）

这些是可消耗的额度（credits），在被限速时**重置你的每周用量**。

| 项目 | 值 |
|------|-------|
| 列表查询 key | `rate-limit-reset-credits` |
| 列表端点 | `GET /wham/rate-limit-reset-credits` |
| 消耗端点 | `POST /wham/rate-limit-reset-credits/consume` |
| 消耗请求体 | `{ credit_id, redeem_request_id }` |
| 成功码 | `{ code: "reset" }` |
| 来源 | `codex-api-DfC2XBrP.js`、`rate-limit-reset-modal-*.js` |

列表响应：

```json
{
  "available_count": 2,
  "credits": [
    { "id": "…", "title": "…", "description": "…", "status": "available", "profile_image_url": "…", "profile_user_id": "…" }
  ]
}
```

只有 `status === "available"` 的额度可兑换（`rate-limit-reset-modal` 的过滤逻辑）。

### HTTP 传输

渲染进程的调用经由 `request-CpO3zZKU.js` → `vscode-api` fetch 代理：

1. `electronBridge.sendMessageFromView({ type: "fetch", requestId, method, url, headers, body })`
2. 响应通过 `window` 的 `message` 事件返回：`{ type: "fetch-response", requestId, status, bodyJsonString, responseType }`

Explodex SDK 将其封装为 `Explodex.http.get("/wham/usage")`。

### Explodex 插件：用量侧边栏

`plugins/usage-reset-glance/index.js` 在**左侧侧边栏顶部**挂载一个**只读**面板，展示：

- 可用重置额度数量 + 额度标题（仅展示 —— 不兑换/不消耗）
- 主/次窗口用量百分比与重置日期
- 每 60 秒轮询一次；监听 `account/rateLimits/updated`
- 仅 GET 的 HTTP 封装会拦截 `/consume` 以及任何非 `/wham/` 的路径

通过 CDP（`python3 scripts/cdp-inject.py`）或 ASAR 补丁（`python3 scripts/patch.py --apply`）加载。

---

## 14. 插件系统（两件不同的东西）（Plugin systems）

### A) 官方 Codex 插件（Agent 能力）

位置：`vendor/Codex.app/Contents/Resources/plugins/openai-bundled/`

```
openai-bundled/
├── .agents/plugins/marketplace.json    # marketplace catalog
└── plugins/<name>/
    ├── .codex-plugin/plugin.json       # manifest (required)
    ├── skills/                         # optional SKILL.md folders
    ├── .mcp.json                       # optional MCP servers
    ├── assets/                         # logos, icons
    └── scripts/                        # native helpers (browser, latex, etc.)
```

`plugin.json` 字段：`name`、`version`、`description`、`author`、`keywords`、`mcpServers`、`skills`、`interface`（displayName、logos、defaultPrompt、category、……）。

内置插件：`sites`、`browser`、`chrome`、`computer-use`、`record-and-replay`、`latex`。

这些插件扩展的是 **Agent 工具能力**（MCP、技能、browser-use）—— **不是**渲染进程 DOM 注入。

### B) Explodex 插件（UI 外壳扩展）

位置：本仓库的 `plugins/<id>/`。

```js
Explodex.plugins.register({ id, name, version }, (api) => {
  api.mount("sidebar", () => api.components.panel({ … }), { position: "prepend" });
  api.http.get("/wham/usage").then(…);
});
```

在 SDK 之后由 `scripts/cdp-inject.ts`（CDP 注入）或 ASAR 补丁加载。

| | 官方 Codex | Explodex |
|--|----------------|-------------|
| 目的 | Agent 技能 / MCP / 应用 | 外壳中的 DOM 区域(zone) |
| 清单 | `.codex-plugin/plugin.json` | `plugin.json` + JS `register()` 调用 |
| 安装 | Codex 插件设置页 | CDP 注入或 ASAR 补丁 |
| UI 注入 | 否 | 是（`sidebar`、`aboveComposer`、……） |

---

## 附录：关键文件索引（Appendix: Key file index）

| 关注点 | `extracted/` 下的路径 |
|---------|-------------------------|
| HTML 引导 | `webview/index.html` |
| 应用路由 | `webview/assets/app-main-fcIxOLz5.js` |
| 应用外壳 | `webview/assets/app-shell-CPw_WmZQ.js` |
| 输入框（composer） | `webview/assets/composer-DhWyK5QW.js` |
| 输入框控制器 | `webview/assets/composer-controller-DSr1Xyxe.js` |
| 线程滚动 | `webview/assets/thread-scroll-layout-CQlmRS86.js` |
| 按钮 | `webview/assets/button-DO-oxX3-.js` |
| 对话框 | `webview/assets/dialog-layout-DyzgPiHE.js` |
| 设置 | `webview/assets/setting-storage-II74UqER.js` |
| 持久化 atom | `webview/assets/persisted-signal-C9s53PEH.js` |
| 侧边栏状态 | `webview/assets/sidebar-signals-BA19kopf.js` |
| Electron API | `webview/assets/vscode-api-CISfap9F.js` |
| 速率限制钩子 | `webview/assets/use-rate-limit-BV5pYGKd.js` |
| 重置额度 API | `webview/assets/codex-api-DfC2XBrP.js` |
| 用量查询 | `webview/assets/thread-context-inputs-BhGjWqLR.js` |
| 主进程 | `.vite/build/main-DFegGFWC.js` |
| Preload | `.vite/build/preload.js` |
| Bootstrap | `.vite/build/bootstrap.js` |

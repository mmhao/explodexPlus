> 本文是 [reasoning-effort-prefix-session.md](../reasoning-effort-prefix-session.md) 的中文翻译，以英文原文为准。

# 推理强度(reasoning effort)前缀 — 开发会话记录

> 会话主题：Explodex 插件，通过输入框(composer)前缀（`!xh`、`!h`、`!m`、`!l` 等）为 Codex **仅下一条消息**设置**推理强度(reasoning effort)**。
> 截至 **2026-06-21** 的状态：**已在 v2.2.0 修复。** 真正的根因*并不是*下文推测的 React 快照竞态——而是 SDK 的**渲染进程内 AppServer 路由捕获失效**，导致每一次 `bridge.send` 都被静默路由到主进程的 AppServer（永远不会更新渲染进程内的 atoms）。修复方式：直接驱动智能下拉菜单所用的是同一个渲染进程内 React 回调，通过 fiber 遍历定位（`Explodex.codex.applyThreadSettingsForNextTurn`）。见 [§12](#12-real-root-cause--fix-v220-2026-06-21)。更早的章节（§6、§9、§11）作为历史分析保留。

**相关文档**

- [composer-message-lifecycle.md](./composer-message-lifecycle.md) — 发送 API、effort/collaborationMode、hook 策略
- [codex-architecture.md](./codex-architecture.md) — bundle 拓扑、注入 zone、IPC 桥接
- [current-findings.md](./current-findings.md) — Explodex / Codex 逆向工程(RN)通用笔记
- [AGENTS.md](../../AGENTS.md) — agent 指令（research/document 请求时保持文档更新）

**实现**

- 插件：`plugins/reasoning-effort-prefix/index.js`（该插件在会话记录期间用此名，现已并入 [`plugins/effort-shortcuts/`](../../plugins/effort-shortcuts/)）
- 插件文档：`plugins/reasoning-effort-prefix/README.md`
- SDK：[`sdk/explodex-sdk.js`](../../sdk/explodex-sdk.js)（`bridge.send`、`composer.*`）
- 部署：`bun run package`（实际运行 `scripts/package-app.ts`）→ `Explodex.app`

---

## 目录

1. [目标](#1-goal)
2. [我们构建了什么（v1）](#2-what-we-built-v1)
3. [研究路径](#3-research-path)
4. [验证](#4-verification)
5. [有效与无效的部分](#5-what-worked-vs-what-did-not)
6. [根因分析](#6-root-cause-analysis)
7. [输入框(composer) API 对照（关键决策）](#7-composer-api-mapping-key-decision)
8. [文档决策](#8-documentation-decisions)
9. [修复方向：Option A](#9-fix-direction-option-a)
10. [待解问题与后续步骤](#10-open-questions-and-next-steps)

---

## 1. 目标

**面向用户的行为**

- 在输入框(composer)提示词前加一个短前缀 token，**仅为下一条消息**设置**推理强度(reasoning effort)**。
- 消息发送前剥离该前缀（用户不应在会话线程里看到 `!m`）。
- 支持的前缀（视模型而定）：`!xh`、`!h`、`!m`、`!l`、`!max`、`!min` → 映射到 Codex 的 effort 值（`xhigh`、`high`、`medium`、`low`、`max`、`minimal`）。
- 在开头输入 `!` 时弹出一个辅助浮层，列出当前模型支持有效的等级。
- 必须保留**完整的输入框提交流程行为**（附件、提及、IDE 上下文、排队/steer）——不能走精简版的 MCP 发送路径。

**非目标（v1）**

- 跨消息持久化 effort（明确只针对“下一条消息”）。
- 在视觉上改变 Codex UI 下拉菜单的状态（锦上添花；只要 rollout 里的 effort 正确即可，并非必需）。

---

## 2. 我们构建了什么（v1）

插件 `reasoning-effort-prefix` 向 Explodex SDK 注册后：

1. **拦截提交** — 当文本匹配 `!<level> <prompt>` 时，用捕获阶段(capture-phase)的 `keydown`（Enter）和 `pointerdown`（输入框附近的发送按钮）进行拦截。
2. 通过官方桥接 API **设置 effort**：
   - **已存在的会话线程**（从 portal 属性或 URL `/local/:id` 取得 `conversationId`）：调用 `update-thread-settings-for-next-turn`，参数为 `{ threadSettings: { model, effort } }`（与 UI 下拉菜单相同的结构）。
   - **新会话线程**（无 id）：调用 `set-default-model-config-for-host`，约 1.5 秒后再恢复之前的默认值。
3. **剥离前缀** — 在 ProseMirror/contenteditable 表面上执行 `setComposerText(prompt)`。
4. **重新提交** — 32ms 之后合成一次 Enter 或点击发送按钮（`allowNativeSubmit` 标记可跳过再次拦截）。

**会话 ID 解析**

- Portal：`data-above-composer-conversation-id`、`data-above-composer-portal`
- URL 模式：`/local/:id`、`/thread/:id`、`/hotkey-window/thread/:id`
- 当 DOM 线索存在但找不到 UUID 时的回退启发式逻辑

**模型上下文**

- `list-models-for-host` + `read-config-for-host`（缓存 60s），用于校验各模型支持的 effort 等级，并在遇到不支持的组合时以 toast 提示。

---

## 3. 研究路径

我们没有只凭 SDK 猜测 API 名称。调查沿着 **UI 实际使用**的链路展开，再与插件的路径做对比。

### 阶段 1 — “和下拉菜单用同一个 API 吗？”

在提取出的 chunk 中追踪 UI 侧推理强度的变更路径：

| Chunk | 发现 |
|-------|---------|
| `use-model-settings-B1SsY8bO.js` | 当 `conversationId` 存在且该线程在 manager 中时（`sC` = `gw[conversationId] != null`），下拉菜单调用 `update-thread-settings-for-next-turn`。否则调用 `set-default-model-config-for-host`。 |
| `app-main-B-r-lCO_.js` | 桥接 handler 委托给 `manager.updateThreadSettingsForNextTurn`。 |
| `thread-context-inputs-BhGjWqLR.js` | `updateThreadSettingsForNextTurn` 通过 `Zu()` 合并进 `latestThreadSettings` 和 `latestCollaborationMode.settings.reasoning_effort`；回合(turn)启动时调用 `waitForPendingThreadSettingsUpdate`。 |

**决策：** 对已存在的会话线程使用 `update-thread-settings-for-next-turn` — API 选型本身是正确的。

### 阶段 2 — “为什么 rollout 里的 effort 不变？”

用户验证了会话 `019ee99e-ede5-7e40-84c4-b1d606e6dabb`：前缀剥离正常工作；除非在 Codex UI 中改动 effort，`turn_context.payload.effort` 一直是 `high`。

这种分裂的症状（消息文本正常、effort 不对）把方向从“桥接 type 用错”引向了**提交时机 / 究竟什么被附加到了这个回合(turn)上**。

### 阶段 3 — 梳理输入框(composer)发送生命周期

用户要求梳理 `start-conversation`、`send-follow-up-message`、`start-turn-for-host` 之间的关系并 hook 官方路径。完整对照见 [composer-message-lifecycle.md](./composer-message-lifecycle.md)。摘要：

- **输入框按 Enter 并不会走 `send-follow-up-message`**（那条只供 MCP 工具、头像浮层等使用）。
- **新会话线程**（`followUp === undefined`）：`start-conversation`。
- **已存在的本地会话线程**：`start-turn-for-host` 或 `steer-turn-for-host`（排队路径会先入队，不立即调用回合(turn) API）。
- 输入框(composer)发送时始终带 `params.effort: null`，在线协议上依赖 **`collaborationMode`** 传递 effort。

### 阶段 4 — React vs manager

追踪提交时刻的 effort 来源：

```
use-model-settings → reasoningEffort (signal et / manager)
use-collaboration-mode → activeMode.settings.reasoning_effort
composer gg() → collaborationMode: context ?? activeCollaborationMode
start-turn-for-host → effort null; rollout reads collaborationMode.settings.reasoning_effort
```

**洞察：** `await bridge.send(update-thread-settings)` 会**立即**更新 **manager**，但提交时读取的是一个 **React 快照**（`activeCollaborationMode`）——若立即重新提交，该快照可能仍是上一次渲染的结果。

---

## 4. 验证

### Rollout 监视

线上协议里的 effort 可以在会话 rollout JSONL 中看到：

```bash
tail -f ~/.codex/sessions/2026-06-21/rollout-*.jsonl \
  | jq -c 'select(.type=="turn_context") | {ts:.timestamp, effort:.payload.effort, model:.payload.model}'
```

同样相关：`.payload.collaboration_mode.settings.reasoning_effort`。

### 所用会话

- Rollout：`rollout-2026-06-21T12-59-27-019ee99e-ede5-7e40-84c4-b1d606e6dabb.jsonl`
- 会话线程 id：`019ee99e-ede5-7e40-84c4-b1d606e6dabb`

### 观察结果

| 行为 | 结果 |
|----------|--------|
| 前缀从已发送消息中被剥离 | ✓ |
| `!m` / `!xh` 改变 `turn_context` 的 effort | ✗（停留在 UI 默认值，例如 `high`） |
| 在 Codex 下拉菜单里改 effort 再发送 | ✓（rollout 的 effort 会更新） |

---

## 5. 有效与无效的部分

| 环节 | 状态 | 备注 |
|-------|--------|-------|
| 前缀解析（`!m hello`，最长前缀匹配） | ✓ | `xh` 优先于 `h` 匹配 |
| 输入 `!` 时的提示浮层 | ✓ | 按模型给出可用等级列表 |
| 桥接 `update-thread-settings-for-next-turn` | ✓（调用成功） | 与 UI 相同的 API |
| await 之后 manager 的 `latestThreadSettings` | ✓ | 逆向工程(RN)确认 `Zu()` 合并 |
| 发送前剥离前缀 | ✓ | 用户可见的提示词是干净的 |
| rollout / 回合(turn)上的 effort | ✗ | 提交时 `collaborationMode` 是过期的 |
| 合成 Enter 重新提交 | 脆弱 | PM 使用内部 `submit` 事件；与用户按 Enter 并不完全一致 |
| DOM 方式的 `setComposerText` | 脆弱 | 提交经 `getText()` 读取 ProseMirror doc，而非 `textContent` |

---

## 6. 根因分析

### 主因：提交时刻 React `collaborationMode` 快照过期

回合(turn)启动逻辑（`thread-context-inputs` 中的 `Rp`）在存在 `collaborationMode` 时（正常输入框提交一律如此）会把 `params.effort` 置为 **null**。rollout 上的 effort 来自 **`collaborationMode.settings.reasoning_effort`**，它是在提交时刻由 React hooks 构建的——而不是 `gg()` 内部对 manager 的一次新鲜读取。

**UI：** 改 effort → 等待 → 发送 → React 已重新渲染 → 线上协议携带正确 effort。

**插件 v1：** `await` 设置 → 剥离前缀 → **32ms** 后合成提交 → 提交仍使用**上一次渲染的** `activeCollaborationMode` → rollout 显示旧 effort（例如 `high`）。

manager 已经更新了；是**提交路径把错误的快照发了出去**。这就是主要 bug。

### 次要风险（并非本会话的主要发现）

1. **合成重新提交** — ProseMirror keymap 在 Enter 时发出 `submit`（`composer-controller-CNXNPPdo.js`）；DOM `KeyboardEvent` 未必总能命中同一路径。
2. **通过 DOM 剥离文本** — 官方提交用 `composerController.getText()` 从 ProseMirror state 取文本；只改 DOM 会造成不同步。
3. **缺少 `sC` 守卫** — 若会话不在 manager atom `gw` 中，UI 会跳过线程设置更新；插件只要从 URL/DOM 拿到 UUID 就一律调桥接。
4. **排队 / steer 分支** — 进行中的回合(turn)应当走 `steer-turn-for-host`；原生提交流程会处理，合成路径未必。

### 已排除

- 设置 API 名称错误（`threadSettings.effort` 与 UI 一致）。
- 输入框(composer)在 params 中显式发送 `effort`（有意为 `null`；effort 经由 collaboration mode 传递是设计使然）。

---

## 7. 输入框(composer) API 对照（关键决策）

早期假设：“也许我们应该像 follow-up API 那样调用 `send-follow-up-message`。”逆向工程(RN)表明，对于输入框 Enter 而言那是错误的 hook 点。

| API | 输入框(composer)是否使用 | 角色 |
|-----|-------------------|------|
| `update-thread-settings-for-next-turn` | 间接（下拉菜单；插件） | 仅为**下一条**回合(turn)设置 effort |
| `start-turn-for-host` | ✓ 已存在的会话线程 | 常规发送 |
| `steer-turn-for-host` | ✓ 进行中 + steer | 打断-steer 发送 |
| `start-conversation` | ✓ 仅新会话线程 | 首页 / 无 `followUp` |
| `send-follow-up-message` | ✗ 非输入框路径 | MCP / 浮层；上下文极简 |

**决策：** 用下拉菜单的 API hook **设置**，然后触发**原生输入框提交**（而不是 `send-follow-up-message`），使附件与上下文得以完整保留。

针对本功能已否决的方案：

- **`send-follow-up-message` 路径** — 设置+发送虽是原子的，但丢掉了完整的上下文构建器。
- **插件自行调用 `start-turn-for-host`** — 控制力完整，但要重复实现上下文/steer/排队逻辑。

曾考虑过的修复选项：

- **Option A** — 在提交时刻应用设置 → 剥离 → 同步闸门 → 原生提交。见 [§9](#9-fix-direction-option-a)。
- **Option D（实时应用 + 恢复）** — 当前缀变为有效时，在用户输入过程中即应用设置；发送后或前缀被删除/失效时恢复；可选的 effort 药丸(pill)。见 [§11](#11-option-d-live-apply--restore--pill)。相比 A **更可能被采纳**，因为它以确定性方式修掉 React 同步竞态，而无需在提交时刻做启发式判断。

---

## 8. 文档决策

会话期间我们把知识从聊天迁移到 `docs/`（符合后来 [AGENTS.md](../../AGENTS.md) 的政策）：

| 文档 | 创建/更新原因 |
|-----|---------------------|
| [composer-message-lifecycle.md](./composer-message-lifecycle.md) | 用户要求梳理 API 与 hook 点；发送/effort 的权威参考 |
| [codex-architecture.md](./codex-architecture.md) | 新增 §9 指向 lifecycle 文档的交叉链接 |
| [AGENTS.md](../../AGENTS.md) | 指示 agent 维护文档；`research` / `document` → 撰写/更新 `docs/` |
| **本文件** | 会话叙事：我们如何决策、尝试了什么、下一步是什么 |

**原则：** 影响插件设计的架构知识应存放在 `docs/`，而不是只留在 issue 评论或 agent 对话记录里。

---

## 9. 修复方向：Option A

**需求：** 保留附件、提及、IDE 上下文、排队/steer——走官方的 `gg()` → `buildLocalContextForPrompt` → `handleSubmitLocal` 路径。

### 计划流程（尚未编码）

1. 当 `!<level> <prompt>` 匹配时拦截 Enter / 发送。
2. `await update-thread-settings-for-next-turn`（已存在的会话线程）或 `set-default-model-config-for-host`（新会话线程）。
3. 通过 **ProseMirror 安全**的替换来剥离前缀（等价于 `composerController.setPromptText`，而不是仅 DOM 层面的 `execCommand`）。
4. **等待 React/manager 同步**（见下文）。
5. 触发**原生**提交（ProseMirror submit 路径），而不是 32ms 后的合成 DOM Enter。

### “React/manager 同步”的含义

分两层：

| 层 | 更新内容 | 插件何时得知 |
|-------|----------------|-------------------|
| **Manager** | 通过 `Zu()` 更新 `latestThreadSettings`、`latestCollaborationMode` | `await bridge.send(...)` resolve 之时 |
| **React** | `use-model-settings` → `use-collaboration-mode` → `activeCollaborationMode` | 订阅者重新渲染之后（下一帧/tick） |

桥接 await 等于 **manager 同步**。它**并不**保证输入框(composer)的 React 树在提交运行前已经重新计算了 `activeMode.settings.reasoning_effort`。

**React/manager 同步** = manager 已更新**且**输入框提交将在 `collaborationMode` 中读到新鲜的 `reasoning_effort`（因为 React 已经跟上）。

**计划中的同步策略（桥接 await + 下列之一）：**

- **渲染周期等待** — `requestAnimationFrame`（×2）+ microtask，然后原生提交。
- **UI signal 轮询** — 等到 `[data-selected-reasoning-effort]`（intelligence 触发器）与目标 effort 一致。
- **可选：** 像 `use-model-settings` 那样镜像 React Query 的失效(invalidation)（更重；仅在轮询不够时用）。

我们**不**等待磁盘上的 rollout JSONL——它在回合(turn)开始之后才出现。

### 为什么不等同步、而是直接显式传 effort？

输入框(composer)提交会传入非空的 `collaborationMode`；回合(turn)逻辑随即把 `params.effort` 强制置 null 并使用 mode 设置。要不离开输入框(composer)路径又绕过这套机制，要么同步 React，要么重新实现上下文构建（已否决）。

---

## 10. 待解问题与后续步骤

### 下一批实现任务（Option D 路线）

- [x] 前缀有效时实时应用（`!xh ` / `!xh` + 提示词）；对桥接调用去抖(debounce)（`plugins/reasoning-effort-prefix/index.js` v2.1.0）
- [x] 发送时（剥离后的 microtask + rAF）、删除时、或前缀失效时恢复之前的 effort
- [x] 输入框(composer)中保留纯文本前缀（不放 above-composer 徽章；由 intelligence UI 展示 effort）
- [x] 在捕获阶段于发送时剥离前缀；若已就绪(armed)则走原生 Enter
- [x] 为线程设置增加 `sC` 风格的守卫（在调用 fiber setter 之前需要实时确认 `codex.getThreadConversation`）
- [x] effort 应用已修复（v2.2.0）— 渲染进程内的 fiber setter，已做实时验证（指示器会变动；回合(turn)按应用后的 effort 流式生成）。磁盘上 `turn_context.effort` 的复核仍待进行（见 §12 的注意事项）。

### Option A 任务（D 不够用时的备选）

- [ ] 同步闸门 + 在 Enter 拦截处走原生提交
- [ ] 提交时刻的 PM 安全剥离

### 待解问题

- `[data-selected-reasoning-effort]` 在 `update-thread-settings-for-next-turn` 之后是同步更新，还是只有经下拉菜单驱动的流程才更新？
- 双 `rAF` 在 Apple Silicon / Electron 42 上是否足够，还是需要带超时的轮询？
- 是否应显式更新 intelligence 触发器 / 查询缓存，以获得更敏捷的 UI 反馈？

## 11. Option D：实时应用 + 恢复 + 药丸(pill)

> 2026-06-21 在 Option A 讨论之后提出。通过把设置应用与发送**隔开数秒的输入时间**（而不是毫秒）来解决 React/manager 同步竞态。

### 思路

当输入框(composer)文本带有**有效**的起始前缀（`!xh`、`!m` 等——而非 `!xxx`）时：

1. **立即**调用 `update-thread-settings-for-next-turn`（与 intelligence 下拉菜单相同）。
2. UI 应随之反映——`[data-codex-intelligence-trigger]` / `data-selected-reasoning-effort` 在 React 重新渲染后更新。
3. 把前缀**转换**为可见的**药丸(pill)**（“Extra High” + 图标）；从用户编辑的提示词正文中移除原始的 `!xh`。
4. 用户继续输入消息剩余部分；按普通 Enter 发送（不再有插件的重提交 hack）。
5. 在下列时机**恢复**之前的思考等级：
   - 消息**已发送**（该回合(turn)已消费掉提升后的 effort 之后），或
   - 前缀被**删除** / 文本不再含有效前缀，或
   - 前缀变为**无效**（未知的 `!foo`）。

无效前缀（`!xxx`）永远不会激活该功能——仅识别[前缀映射表](#quick-reference--prefix-map)中登记过的条目。

### 为什么这能修掉这个 bug

| Option A | Option D |
|----------|----------|
| 设置 + 发送在同一个手势内完成 | 用户仍在输入时就已应用设置 |
| 必须猜测 React 何时跟上 | 输入期间即完成 React/UI 同步；发送时使用的已是更新过的 `activeCollaborationMode` |
| 拦截 Enter + 重提交 | 原生 Enter；插件只在之后做恢复 |

### 发送时的恢复时机（关键）

恢复**绝不能**在回合(turn)读取 effort 之前执行：

```
WRONG:  apply xhigh → user Enter → restore high immediately → turn sees high
RIGHT:  apply xhigh → user Enter → native submit/turn start → then restore high
```

用 `update-thread-settings-for-next-turn` 在提交已派发**之后**恢复（例如下一个宏任务 / 短暂延时 / 若可用则用会话的 turn-started 信号）。与 apply 用同一个 API——恢复后的“next turn”指*下一条*消息使用旧等级，恰好符合“仅本条消息”的语义。

### 状态机（草图）

```
IDLE
  → user types valid prefix → ARMED (savedPreviousEffort, appliedEffort, show pill, strip prefix from text)
ARMED
  → user edits away / invalid prefix → IDLE (restore if applied)
  → user sends → SENDING (native submit)
SENDING
  → turn started → IDLE (restore previous effort, hide pill)
```

### 药丸(pill) UI — 可行性

Codex 输入框(composer)是 **ProseMirror**，带自定义节点（`atMention`、`skillMention` 等）。插件**无法**在不给 Codex bundle 打补丁的情况下注册新的 PM 节点类型。

**推荐（v2）：portal 药丸，而非内联 PM 节点**

1. 前缀校验通过时，用 PM 安全的 `setPromptText` 从输入框中剥离 `!xh`（只留剩余内容）。
2. 在 **`aboveComposer`** portal（SDK zone）中挂载一个徽章：图标 + “Extra High” + 可选的“next message”提示。
3. 风格与 Codex 对齐：`components.badge()` / 使用 `--color-*` token 的自定义徽章；图标取自 Codex intelligence 触发器的 SVG，或内联一个简单的 sparkle/brain SVG。

**更难：在文本流中真正内联替换 `!xh` 的药丸**

- 需要 PM decoration widget 或自定义节点（插件拿不到）。
- 回退方案：绝对定位的浮层，与前缀的 `getBoundingClientRect()` 对齐——在换行/滚动/缩放时很脆弱。

**用户可能接受的 UX 折衷：** 药丸紧贴在输入框上方（视觉上附着），输入框文本是干净的提示词——功能上等同于“`!xh` 变成了药丸”，而不必与 ProseMirror 硬拼。

### 去抖(debounce)

避免用户输入 `!` → `!x` → `!xh` 过程中刷屏式调用桥接：

- 仅当 `parsePrefix()` 返回一个**完整**的有效等级（目录中命中）时才应用。
- 可选：要求尾随空格或非空提示词后才应用（`!xh ` 或 `!xh hello`）。
- 若用户在完成 `!xh` 之前退回到 `!x`，则回退且不应用。

### 待解问题（Option D）

- 当设置仅经由桥接（而非点击下拉菜单）改变时，intelligence 触发器会更新吗？逆向工程(RN)提示会通过 signal `et` 更新——需在应用中验证。
- 发送时恢复：已**实现**为前缀剥离后的 `queueMicrotask` + `requestAnimationFrame`（effort 已在 `gg()` 中同步读取完毕）。
- 新会话线程路径：应用时调 `set-default-model-config-for-host`；在发送/删除/teardown 时恢复（不再有固定的 1500ms 超时）。

### v2.0.0 实现（2026-06-21）

插件 `reasoning-effort-prefix.js` 的 Option D：

1. **输入** — 当 `parsePrefix()` 命中目录时去抖(debounce)调用 `applyLive()`；前缀被移除/失效时解除激活(disarm) + 恢复。
2. **发送** — 捕获阶段剥离为纯提示词；`scheduleRestoreAfterSubmit()`；若已就绪(armed)且去抖已冲刷(flush)则走原生 Enter。
3. **回退** — 若用户在去抖触发前就发送，先冲刷(apply)再合成一次 Enter/点击（与 Option A 重提交同属罕见路径，但不再在发送时刻重新 apply）。
4. **UI** — 输入期间纯文本 `!xh` 保持可见；提示浮层不变；没有 portal 徽章。

### 更新日志（本文档）

| 日期 | 更新 |
|------|--------|
| 2026-06-21 | 初始会话记录：v1 行为、逆向工程(RN)、根因、Option A 计划 |
| 2026-06-21 | 新增 Option D：实时应用 + 恢复 + 药丸(pill)；优先于 A |
| 2026-06-21 | 实现 Option D v2.0.0：实时应用、纯文本前缀、发送时剥离、提交后恢复 |
| 2026-06-21 | 插件文档迁移至 `plugins/reasoning-effort-prefix/README.md`；前缀移除后取消过期的去抖 apply |

---

## 12. 真正的根因 + 修复（v2.2.0，2026-06-21）

> §6 的“React `collaborationMode` 过期”理论是**错的**。通过 Chrome DevTools（CDP 连到 `:9333`）实时调试后发现，真正的 bug 在更低一层——SDK 桥接本身。

### 真正的根因：路由捕获失效 → 静默回退到 IPC

1. SDK 试图在注入时通过给 `Function.prototype.call/apply` 打补丁来捕获渲染进程内 AppServer 的 `send`（见 `sdk/explodex-sdk.js` 顶部）。这一步**失败**：注入发生在 app 加载*之后*，且 router 的方法是被直接调用的（不经 `.call/.apply`），所以 hook 从未触发。结果：`window.__explodexAppServerSend` 从未被绑定——实时确认 `appServerSend: false`。
2. 由于没有捕获到 router，`bridge.send(...)` 回退到 `electronBridge.sendMessageFromView`。该 IPC 路径路由到**主进程**的 AppServer，并**不会**更新输入框提交时所读取的**渲染进程内** manager / Jotai atom。
3. 于是 `update-thread-settings-for-next-turn` 经桥接“调用成功”，但 effort 从未到达该回合(turn)。已实时证明：通过 `electronBridge` 发送它时，`[data-selected-reasoning-effort]` 纹丝不动。

这也解释了为什么下拉菜单有效而插件无效：下拉菜单直接调用渲染进程内的 React 回调；它根本不碰这条坏掉的桥接路径。

### 修复：经 fiber 遍历驱动渲染进程内回调

给 SDK 增加了 `codex` 命名空间（`sdk/explodex-sdk.js`），暴露在 `Explodex.codex` 上：

- `getThreadConversation(id)` / `getThreadModel(id)` / `getThreadEffort(id)` — 从 React fiber 树读取实时的 conversation-state 对象（扫描 hook state + props 中的 `{ id, latestThreadSettings }`）。
- `applyThreadSettingsForNextTurn(id, { model, effort })` — 定位下拉菜单的 `useCallback` setter 并调用它。该 setter 的匹配非常精确：其源码包含字面量 `"update-thread-settings-for-next-turn"`，且其依赖数组的首项是绑定的 `conversationId`。这更新的是输入框提交时发送的**同一批 atom**，因此 effort 能到达回合(turn)。

插件（`plugins/reasoning-effort-prefix/index.js` v2.2.0）现在：

- `pushThreadEffort` 调用 `codex.applyThreadSettingsForNextTurn` 而非 `bridge.send`。它先用 `codex.getThreadModel` 读取**当前**模型，因此只改 effort 时绝不会动模型。
- `pushThreadEffort` 现在除非 `codex.getThreadConversation(conversationId)` 找到活的线程状态才应用，在改动设置前先近似实现 UI 的 `sC` 已加载线程守卫。
- `fetchModelContext` 优先使用 `codex.getThreadModel(activeConversationId)` 和 `codex.getThreadEffort(activeConversationId)`，而不是不可靠的桥接读取。
- 新会话线程路径（`pushDefaultEffort`）仍使用桥接作为尽力而为的回退（属于另一个优先级更低的独立问题）。

### 空格触发提示的修复

`shouldShowHint` 现在一旦前缀后跟随空格（例如 `!m `）就返回 `false`，因此用户开始输入提示词时浮层会关闭（此前它会一直开着，直到存在非空提示词）。

### 验证（实时，经 CDP）

- `Explodex.codex.applyThreadSettingsForNextTurn(convId, {effort:"medium"})` → 返回 `true`，实时指示器由 `xhigh → medium` 变动，模型不变。坏掉的桥接路径则完全无动于衷。
- 通过插件输入 `!m …`：指示器 → `medium`；空格之后提示浮层关闭；Enter 剥离了前缀，一个真实回合(turn)**以 atom 上的 `medium` effort** 流式生成。
- **Rollout JSONL 注意事项：** 未能从磁盘捕获该特定开发会话的 `turn_context.effort`——经 CDP 驱动对它的发送没有持久化到 `~/.codex/sessions`（其他会话线程的回合(turn)确实会持久化）。由于修复驱动的是与手动在下拉菜单选择完全相同的渲染进程内回调/atom（指示器变动已验证），发出的 effort 等价于手动 UI 变更。待方便时，在正常手打的会话中用 `jq` 复核 `turn_context.effort`。

### 工具

实时调试使用了 `~/Projects/agent-scripts` 中的两个 Bun CDP 助手：`cdp-eval.ts`（在渲染进程内 eval JS）和 `cdp-key.ts`（受信任的 `Input.insertText` + `Input.dispatchKeyEvent`，之所以需要它，是因为合成的 DOM `KeyboardEvent` 不受信任，无法触发 ProseMirror 提交）。

### 更新日志补记

| 日期 | 更新 |
|------|--------|
| 2026-06-21 | v2.2.0：真正的根因（路由捕获失效 → IPC 回退）；经 fiber 遍历的 `Explodex.codex` setter 修复；空格即关提示；effort 从活的线程模型读取 |
| 2026-06-22 | 加固 v2.2.0 插件生命周期：已加载线程守卫、实时 effort 基线恢复、过期的异步输入/提示取消、unload 时恢复 |

---

## 快速参考 — 前缀映射

| 前缀 | Effort 值 | 标签 |
|--------|--------------|-------|
| `!xh` | `xhigh` | Extra High |
| `!h` | `high` | High |
| `!m` | `medium` | Medium |
| `!l` | `low` | Low |
| `!max` | `max` | Max |
| `!min` | `minimal` | Minimal |

示例：`!m explain this function` → 发送 `explain this function`，且仅该回合(turn)使用 medium effort。

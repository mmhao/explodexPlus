> 本文是 [COMPATIBILITY.md](../COMPATIBILITY.md) 的中文翻译，以英文原文为准。

# 兼容性

这里是本 fork 针对哪些 Codex 构建版本做过验证、以及每个组件所依赖的每一个
Codex 内部选择器的唯一权威来源。当某次 Codex 更新弄坏了某个插件时，从这里开始：
找到对应的选择器，检查新的 DOM，修正候选列表，并把结果记录到
“Verified against”（已验证版本）表中。

## Verified against（已验证版本）

| Codex 构建版本 | Windows | macOS | 备注 |
| --- | --- | --- | --- |
| 26.924.2738.0 (MSIX Store) | ✅ 完整 E2E：带包标识启动、CDP 注入、project-groups 实测验证、经由 `~/.codex/.codex-global-state.json` 持久化 | ⬜ 未经本 fork 测试 | fork 基线；上游 CI 覆盖 macOS |
| 26.924.22138 (owl-app.ini AppVersion) | 同一个已安装的应用包 | — | `owl-app.ini` 报告 26.924.22138；`Get-AppxPackage` 报告 26.924.2738.0 |

图例：✅ 已验证 · ⬜ 尚未验证 · ❌ 已知失效

## Windows 平台适配器（`lib/platform/windows.mjs`）

| 依赖项 | 取值 / 探测方式 | 易变程度 |
| --- | --- | --- |
| 商店包系列（package family） | `Get-AppxPackage -Name 'OpenAI.Codex'` → `<PFN>!App` AUMID | 稳定（由发布方控制） |
| 以包标识启动 | `(New-Object -ComObject Shell.Application).ShellExecute('shell:AppsFolder\<AUMID>', '--remote-debugging-port=N')` | Windows shell 契约 |
| UI 入口可执行文件 | `<InstallLocation>\app\ChatGPT.exe` | 进程名 `ChatGPT`/`Codex*` 前缀 |
| 调试端点 | `http://127.0.0.1:9333/json/*` | Chromium CDP |
| 渲染进程目标 | url 为 `app://-/index.html` 的 page 目标 | Electron 应用协议——留意 scheme 变化 |

已知的死胡同（不要重试）：直接 `Start-Process` 启动包内 exe 能打开调试端口，
但应用会以“no package identity”（没有包标识）中止；
`IApplicationActivationManager` CLSIDs 在当前 Windows 上并未注册。

进程检测：“Codex 正在运行”必须**只**匹配 UI 进程 `ChatGPT`。
SYSTEM 服务 `codex-windows-sandbox-service` 和 `codex` CLI 都会命中旧的前缀
正则，曾把启动器卡死在“请先退出 Codex”状态；现在的过滤器是精确的 `^chatgpt$`
匹配。

## SDK（`sdk/explodex-sdk.js`，fork 本地相对上游的差异）

- **插件启用/禁用映射通过 globalState 持久化。** 上游只把它保存在渲染进程的
  localStorage（`storage.persisted`）中，而 Electron 是延迟刷盘的——被强杀的
  渲染进程会丢失最近的开关状态。本 fork 会把该映射同步一份到
  `storage.globalState`（键 `explodex-plugin-enabled`，落在
  `~/.codex/.codex-global-state.json` 中），并在启动时若 localStorage 与它
  不一致时重新采用 globalState 的值。
- **底部插件条宿主定位（“孤立的 F/U 字母”问题的真正根因）。**
  `ensureFooterPluginStrip` 过去挂载到侧边栏里第一个匹配
  `[class*="absolute"][class*="bottom-0"]` 的后代节点。在 26.924.x 中它*不是*
  页脚：每个项目区块内都有一个空的拖放覆盖层
  （`[data-sidebar-project-container-id]` 内的
  `div.pointer-events-none.absolute.top-[…].bottom-0.left-0.z-10.w-8`），
  外壳里还有一个 `div.group/panel-resizer…bottom-0…w-4`——两者都命中那个朴素
  选择器且在文档顺序上先于真正的页脚。于是插件条（feature-flags-playground
  的 “Flags: 53/155”、usage-reset-glance 的 “Usage: loading…”）被渲染进这个
  约 32px 宽、`overflow:hidden` 的裁切列，紧凑导航按钮只剩下首字母可见——
  表现为漂浮在分组行前的 “F”/“U”。已在 `findSidebarFooterHost` /
  `isFooterHostCandidate` 修复：宿主必须包含 `<button>`，必须是资料按钮的
  `absolute…bottom-0` 祖先（26.924 上为
  `div.absolute.inset-x-0.bottom-0.z-20`），且不得位于
  `[data-sidebar-project-container-id]` 内、不得包含项目/会话行、不得带
  `pointer-events-none`、不得匹配 `*-resizer`。
  `findProfileFooterButton` 现在也匹配本地化 aria-label（zh-CN 页脚渲染为
  “打开个人资料菜单”/“打开帮助菜单”，而不是 “settings”）。
  `ensureFooterPluginStrip` 会清理游离的 `[data-explodex-footer-plugins]`
  节点，旧会话误挂的插件条无法在重注入后存活。2026-09-28 实测：插件条
  rect `[0,707,340,67]`，两个按钮宽 324px，`clipped:false`，行内干净。
  排查提示：按元素扫描会漏掉这类问题——泄漏的字母其实是被裁切长文本的首字符。
  用 `document.createTreeWalker(root, NodeFilter.SHOW_TEXT)` 配合逐字符
  `Range` rect 才能定位文本真正渲染的位置。

## project-groups

| 选择器 / 属性 | 用途 |
| --- | --- |
| `[data-app-action-sidebar-project-id]` → `closest("nav")` | 侧边栏根节点（首选——不受语言环境影响） |
| `nav[aria-label="Chat history"]`（回退：`aside.app-shell-left-panel nav`、`nav`） | 侧边栏根节点，仅适用于英文界面 |
| `[data-app-action-sidebar-project-id]` | 项目标题行（稳定的 id；另有 `data-app-action-sidebar-project-label`、`-collapsed`） |
| `closest('[class~="group/cwd"]')`（回退：标题行本身） | 被重新排序的单个项目区块 |
| `storage.globalState` 键 `explodex-project-groups-state` | 持久化（可在 `~/.codex/.codex-global-state.json` 中看到） |

**语言环境说明：** Codex 会翻译侧边栏的 `aria-label`（zh-CN 下渲染为
“首页”），此时朴素的 `nav` 回退会选中图标栏而不是项目导航——分组会无声消失。
因此根节点改由某个项目标题行推导而来，该项目标题行在所有语言环境下都存在。

事件模型：移动按钮（内联 SVG 网格图标，而非 `▦` 字形）在 `pointerdown` 时打开移动菜单（捕获阶段的 React 行处理器会
吞掉 `click`），并且撑满**整行高度**（在 flex 行内 `align-self:stretch`，图标用
inline-flex 居中），这样整条右边缘都是舒适的点击区。项目行**不再注册右击监听器**：
移动菜单现在只由图标触发，从而把 Codex 原生的项目上下文菜单完整留给行本身。取而代之
的是一个 window 级捕获 `contextmenu` 监听器，它只在 Explodex 自有控件上抑制原生菜单
（`[data-explodex-group-header]`、行内新建按钮、移动/颜色选择/复制路径按钮、底部插件条
`.ex-nav-btn`）——右击分组标题行曾会弹出 “Select All”，即使设了 `user-select:none`
也没用，因为原生菜单需要的是 `preventDefault()`，不是 CSS。菜单项：仅有“未分组”+
各分组——分组的创建放在 “+ New group”（新建分组）行上。

**悬停卡守卫（项目行）：** Codex 的项目悬停卡（项目名 / 任务数 / 路径 / “编辑项目”）
由 React 合成指针事件打开——React 18 把全部监听器委托在 `#root` 容器上，所以鼠标移到
整行的*任意*位置都会弹出它。监听器 dump 证实 aside/nav/section/行本身**没有**任何
Codex 原生指针监听器（只有我们 SDK/插件自己的），因此“在行这一层拦冒泡”就是正确的
介入层。每行注册（只注册一次，用 `data-explodex-hover-guard` 标记以在热重注入后存活）
冒泡阶段的 `pointermove`/`pointerover` 监听器，对右侧目标调用 `stopPropagation()`：
行内的任意按钮、任意非 `flex-1` 的子 `<div>`（操作簇），以及距离行右缘 24px 以内的
行自身 padding 区域。`flex-1` 内容区保留该卡片——它才是响应式的“项目信息”区。

只做拦截是**不够**的：从标签扫向按钮时，左侧区间的移动早已把 Codex 的打开计时器武装
起来，约 500ms 后卡片照样在指针停于按钮上时弹出——这正是“仍会整行弹出”反馈的成因。
因此每次*从左侧过渡*进入右侧区时，守卫还会从行上派发一个冒泡的 `pointerout`
（`relatedTarget = document.body`）；React 的 EnterLeave 插件把它转换成沿祖先链向上
的合成 `pointerleave`，由 **Codex 自己的关闭处理器**完成关闭。已在委托点实测
（2026-09-28）：每次过渡恰好只有一个合成 `pointerout/rel=body` 到达 `#root`，被拦截
的右侧移动永远到不了 `#root`，左侧悬停的 `pointerover` 照常送达。

**CSS 兜底（第三层，与事件时序无关）。** 上面这层事件拦截无法用 CDP 端到端验证：
`Input.dispatchMouseEvent` 的悬停从来弹不出卡片（Radix 的延迟计时器需要真实、不被
节流的悬停），所以“在 `#root` 处生效”已是合成探针能给出的最强结论——而真实鼠标仍有
漏网。于是卡片还被**不碰事件**地压制了一层：触发器是行上方那个 Radix tooltip
（`SPAN.contents`，带 `data-state` 与 `aria-describedby`），卡片本体是
`[role="tooltip"]`；守卫在指针位于某行操作条期间给 `html` 加上
`explodex-hovercard-off` 类，CSS 直接把卡片隐藏。window 级 `pointerover` 会在指针
离开被守卫的行后立即解除该类（右侧事件已被行上的 `stopPropagation()` 拦掉，到不了
这里，所以悬停操作条期间标记稳定保持）。代价仅限于：指针停在该操作条期间，其他
tooltip 也一并隐藏。

一个值得记住的行内几何事实：操作簇默认 `opacity-0`、宽度只有 **8px**，而其中 20px
宽的按钮溢出这个容器、叠在我们那个整行高度的移动按钮*下面*——但它们全都位于
`[data-app-action-sidebar-project-id]` 内部，所以守卫必须按**树包含关系**（而不是
几何位置）来判定归属。

**字形规则（次级加固，并非 F/U 的根因）：** “孤立 F/U 字母”问题的前几轮曾被
归因于豆腐块字形。下面的字形清理确实做了并保留，但后来的文本节点实测证明，
用户报告的字母来自误挂的底部插件条（见 SDK 一节）。规则本身依然成立：注入的
每个操作入口过去都是*文本字形*——`◍`/`●`（颜色选择器）、`▸`/`▾`（折叠箭头）、
`▦`（移动）、`⧉`（复制路径）、`✓`/`✕`/`⋯`。其中若干码位（U+25CD、
U+25BE/25B8、U+25A6、U+29C9、U+2713/2715）在 zh-CN Windows 字体栈里不存在，
会以豆腐块回退渲染，在 11px 下看起来就像散落的拉丁字母。现在它们全部**不依赖
字体**渲染：选择器圆点和折叠箭头是 CSS 图形（`::before` 圆 / border 三角），
移动与复制按钮是内联 SVG，仅存的字符都是 GB2312 安全集（`＋ … √ × ▲ ▼`）。
排查时注意：截图可能来自*修复前尚未重载的旧渲染进程*——下结论“没修好”之前，
先重载 + 重新注入一次。

## folder-copy-path

| 选择器 / 属性 | 用途 |
| --- | --- |
| `<file-tree-container>`（shadow root） | 树 UI 是一个自定义元素；普通查询会停在宿主节点上，因此扫描会穿透 `host.shadowRoot`，菜单则沿 `event.composedPath()` 向上走 |
| `[data-app-shell-focus-area="right-panel"]` | Files/Browser/Terminal 面板根节点 |
| **`BUTTON[data-item-path="…/"][data-item-type="folder"]`（已实测验证）** | 真实的行：一个虚拟化的 DOM 按钮列表，**没有 React fiber**；相对路径放在 `data-item-path` 中（结尾 `/` ⇒ 文件夹），`data-item-type` 取值 `folder`/`file` |
| `[role="treeitem"], [data-file-path], [data-path], [data-folder-path]` | 较早/其他形态的行结构 |
| 任何值包含 `/` 或 `\` 的 `data-*` 属性 | 未知构建上的自定义路径属性 |
| 宿主 fiber 链（从 `<file-tree-container>` 出发，向上约 5 跳）：prop `cwd` / `root` / `roots[0]` | 绝对路径拼接根——**从行节点无法到达**（它们没有 fiber）；`cwdFor` 按 行 → shadow root → 宿主 fiber 跳转 |
| fiber props：`path`/`absolutePath`/`fullPath`/`relPath`/`relativePath`，`entry`/`file`/`node`/`item`/`data` 包装对象，`type:"directory"`，`isFolder`，`children`；hook `memoizedState` 链 | 其他构建上由 fiber 支撑的树（有意做多形态匹配） |
| `aria-expanded` / 无扩展名标签 | 文件夹启发式回退 |

上下文菜单（“Copy path”）通过从右键位置沿 `composedPath()` 最多向上走 16 跳、
并严格从 fiber entry / `data-*` 路径属性解析，从而在全应用范围内生效（右侧面板
**以及**聊天区的 diff/变更文件列表）——从不使用 textContent（这是
`...\筛选文件⧉⧉⧉` bug 的根因）。无法解析出绝对路径的行（或相对路径但缺少
cwd）会被跳过；解析结果以及每一跳的 fiber-key 未命中记录都会落在
`window.__explodexFcpDebug` 中。

**文件行被刻意排除。** Codex 原生右键菜单本来就支持复制文件路径；本插件早期
版本也拦截了文件行，把原生菜单**顶掉**了（用户可见的回归）。`folderAbsolute()`
现在在所有启发式之前有一道硬拒绝：`data-item-type` 匹配 `file|link|symlink`，
或叶子名带扩展名（`/[^.]\.[A-Za-z0-9]{1,12}$/`），直接返回 `null`——即使 fiber
prop 声称 `isFolder: true` 也一样。显式的 `data-item-type="folder"` 仍然优先于
扩展名启发式（它是 Codex 自己对“带点目录名”的权威信号）。返回 null 意味着
处理器在 `preventDefault()` **之前**就退出，原生菜单完好无损。

注入的面板必须跟随渲染器主题。Codex 26.924 **没有** `--color-bg-primary` 这个
自定义属性——把它当主 token 用会静默回退到我们深色的 `#111`，在浅色主题下产出
白底白字/无法阅读的菜单。真正的 token 是
`--color-token-dropdown-background` / `--color-token-dropdown-foreground`
（菜单、popover、对话框）、`--color-token-bg-primary` /
`--color-token-foreground`（页面）以及 `--color-token-list-hover-background`。
所有 Explodex 面板现在都使用
`var(--color-token-dropdown-background, var(--color-bg-primary, #111))` 链。

自报告式排查（当某个构建的行形态仍然未知时）：插件会在树挂载后一次性捕获
`window.__explodexFcpShadowDump`（shadow HTML、行样本、宿主 + 4 层祖先及其
fiber prop keys），并在树内第一次右键时捕获 `window.__explodexFcpPathDump`
（完整的 `composedPath()`、每一跳的属性/shadow 来源/fiber keys、行文本）。
右键失败后把这两个对象报告出来，就能无需再来一轮调试地修补提取逻辑。

已知问题（已缓解）：在旧实例仍然存活时热重注入插件，会让两份内存态互相竞争并
丢失写入（已观察到：双重注入后一个用户分组消失）。单实例运行是安全的；
涉及状态变动时，优先重启启动器而不是反复执行 `inject`。
2026-09-28 实测确认了第二种失效模式：向**已加载完成**的渲染器反复执行
`Runtime.evaluate` 注入，会叠加好几代 attach/teardown；交错执行的
`removeEventListener` 最终可能让 document 上*一个* contextmenu 处理器都不剩——
装饰按钮还留在屏幕上（陈旧），右键却静默失效。干净状态的验证方法：重载渲染器
（`Ctrl+R`），再运行一次启动器，所有插件就恰好 attach 一遍。注意
`addScriptToEvaluateOnNewDocument` 会随注入器的 CDP socket 断开而失效，所以
重载后若不重新注入，得到的是裸渲染器。

**实测验证于 2026-09-28（Codex 26.924.2738.0）：** folder-copy-path 用用户的
真实鼠标操作解析出了 shadow-DOM 树行（`H:\code\own\test\android\images`）。
文件闸门 + 主题 token 修复后，在单实例干净会话里完成了端到端验证：26 个文件夹
行被装饰、文件行 **0** 个；文件夹右键弹出我们的菜单（`Copy path — src`），浅色
主题下颜色正确（`rgb(255,255,255)` / `rgb(26,28,31)`）；文件行完全不出现
Explodex 菜单。注意 Files 树只有在某个项目会话处于活动状态时才会填充行；项目空闲时面板保持
为空，没有可装饰的内容。如果未来的 Codex 构建在此处发生回归，上面的
`__explodexFcpShadowDump` / `__explodexFcpPathDump` 缓冲区能捕获新结构，
无需再来一轮调试。

## 响应性契约（点击手感）

“收缩半天才生效”“从别的软件切回来后第一次右击特别慢”“Select All 和
Copy path 两个菜单同时出现”这几类反馈，根因都是下面列出的几个机制——
**不是**事件冒泡问题（我们的处理器是同步的捕获监听器，返回前就已
`preventDefault`）：

- **用户操作不等防抖。** project-groups 的 `commit()` 现在调用
  `reconcileNow()`——状态已 hydrate 时它**在点击处理器内同步执行**
  `doReconcile()`，折叠/展开在事件返回前就已生效（2026-09-28 实测）；
  Codex 自身 DOM 变动仍走 250ms 防抖路径。
  这条同步快路径**绝不能**再被 `reconcileInFlight` 卡住：那个标志只保护
  *异步*的 `reconcile()`（它要 `await hydrate()`，两趟可能交错），而
  `doReconcile()` 是同步的、不可能自我重入。带上这个门之后，落在侧栏 DOM
  变动高峰期的每次点击都会变成一串 16ms 重试、排在一个不断重新武装的观察者
  后面——这正是“打开聊天窗口后第一次点分组没反应，之后就正常”的成因
  （2026-09-28 第 4 轮反馈）。
- **延迟自证。** `window.__explodexPgDebug` 保留最近 40 次 reconcile 的
  `{kind: "commit-sync" | "reconcile-async", ms, hydrated, inflight, rows}`。
  点击变慢时，走的是哪个 `kind`、`ms` 多大就能定位问题，无需再来一轮调试。
- **zone 观察者只留一个（SDK）。** `inject.observeZone` 过去**每次调用**都在
  `documentElement` 的整棵子树上建一个 MutationObserver——6 个以上存活观察者时，
  聊天流式的每一批 DOM 变动都被投递 N 次，`includeMutations` 的 watcher 还会每帧
  重跑回调。这正是“流式进行中切回软件再点分组会卡死”的根因。现在 SDK 只保留一个
  共享观察者并把 records 分发给各 watcher；`includeMutations` watcher 只有当某条
  record 的目标确实落在自己 zone 锚点子树内时才会排程。
- **folder-copy-path 的扫描排程要限定范围。** 该插件不再用
  `document.body` + `subtree:true` 观察（聊天流式会把它打满）。改为只观察：`body`
  的 childList、每个 `[data-app-shell-focus-area=right-panel]` 的 subtree 观察者
  （面板卸载时清理）、每个 `<file-tree-container>` 的 shadow root，外加一个 1500ms
  的发现定时器负责重挂面板观察者并扫描。
- **剩余的全域观察者已加节流。** 两个继承插件此前在 `documentElement`+`subtree`
  观察者里每批 DOM 变动都跑全文档查询：command-menu-threads（4 次 `querySelector`
  找对话框）与 effort-shortcuts（解析 composer + 重测提示位置）。现在都改为节流
  （180ms / 200ms），且 effort-shortcuts 只在提示浮层确实打开时才重测。（
  usage-reset-glance 的回调只是廉价的 `isNavMounted` 判断 + 空操作重定位，保留。）
- **重复扫描不得冷解析。** folder-copy-path 用 `WeakMap`（键＝节点 + 当前
  `data-item-path`，虚拟列表会复用 DOM 节点，键变化即强制重算）缓存路径解析，
  已装饰行的重扫快速路径**零次** `getBoundingClientRect`。旧代码每次扫描都对
  每一行做 fiber 遍历 + 强制布局——恰在窗口重新聚焦时（Codex 大量重渲染）把
  主线程打满，用户右击就撞在这个忙窗口上。
- **注入的菜单不可选中文字并吞掉右击。** 所有 Explodex 面板/遮罩层都设置
  `-webkit-user-select:none;user-select:none`（弹窗里的 `input` 显式恢复可选），
  并在面板与遮罩层上对 `contextmenu` 执行 `preventDefault`。此前面板文字可选中，
  Electron 的原生“全选”菜单会盖在我们还开着的菜单上——就是那次双菜单反馈。
  SDK 的 `.ex-nav-btn` / `.ex-popover` / `.ex-dialog` 同样适用该规则。

在最小化的渲染进程里测手感并不可靠：`requestAnimationFrame` 与 `setTimeout`
会被严重节流（10ms 轮询实际 ~500ms 才触发），且窗口隐藏/项目空闲时 Files 树
渲染 **0** 行——验证同步生效应改用微任务排空（`await Promise.resolve()`）。

## 上游插件（继承的选择器）

上游 explodex 插件（`project-pins`、`project-colors`、`usage-reset-glance`、
`command-menu-threads`、`effort-shortcuts`、`feature-flags-playground`）依赖
各自的专属选择器；参见上游的 `docs/plugins/README.md`。注意：SDK 的 zone
选择器 `aside[data-testid="app-shell-floating-left-panel"]` 在 26.924.x 的
实际 DOM 中**并不匹配**——插件应回退到 `nav[aria-label="Chat history"]`
（project-groups 和 project-pins 就是这么做的）。

## Codex 更新后的修复循环

1. `explodex-plus inject`（或通过启动器重新启动），并打开 DevTools。
2. 在上面找到失效的选择器；检查新的 DOM/fiber。
3. 更新插件中的候选选择器，把新构建版本加入 “Verified against” 表，
   并把已排除的死胡同记录到本文档。
4. 可选：用随包附带的 `explodex-plugin-builder` skill 提示 Codex 替你执行
   这个循环。

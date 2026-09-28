> 本文是 [README.md](../../plugins/README.md) 的中文翻译，以英文原文为准。

# 插件审阅

Explodex 插件位于 `plugins/<id>/`，包含：

- `plugin.json` 用于元数据
- `index.js` 用于运行时注册
- 可选文档位于 `plugins/<id>/README.md`

## 随包插件

| 插件 | 用途 | 文档 |
|--------|---------|-----|
| `command-menu-threads` | 让对话（threads）在 Cmd+K 面板中排在最前（Cmd+G 合并） | [README.md](../../../plugins/command-menu-threads/README.md) |
| `effort-shortcuts` | 由前缀驱动的单条消息推理强度 | [README.md](../../../plugins/effort-shortcuts/README.md) |
| `project-pins` | 全局与项目置顶作用域菜单 | [README.md](../../../plugins/project-pins/README.md) |
| `usage-reset-glance` | 只读的用量/重置侧边栏状态（锚定在个人资料页脚上方） | [README.md](../../../plugins/usage-reset-glance/README.md) |
| `feature-flags-playground` | 所有实验性 feature flag，带持久化的开关 | [README.md](../../../plugins/feature-flags-playground/README.md) |
| `project-colors` | 在侧边栏为项目文件夹和对话着色 | [README.md](../../../plugins/project-colors/README.md) |

截图位于 [screenshots/](../../plugins/screenshots/)，并嵌入在每个插件的 README 中。

**Explodex 设置页** —— 逐插件的选项面板（侧边栏 **💥 Explodex** → `/explodex`）：

![Explodex plugin options](../../plugins/screenshots/explodex-plugin-options.png)

### 预览

**command-menu-threads** —— 输入时匹配的对话会出现在 Cmd+K 顶部：

![Command menu thread search](../../plugins/screenshots/command-menu-threads.png)

**effort-shortcuts** —— `!m` 打开思考层级提示并实时应用中（medium）强度：

![Reasoning effort prefix](../../plugins/screenshots/effort-shortcuts.png)

**project-pins** —— 项目对话会获得一个 Global / Project 置顶选择器：

![Pin scope menu](../../plugins/screenshots/project-pins.png)

**usage-reset-glance** —— Settings 上方的紧凑用量行，带一个详情浮层：

![Usage & resets sidebar](../../plugins/screenshots/usage-reset-glance.png)

**feature-flags-playground** —— 面向实验性 flag 的侧边栏浮层与 Settings 面板：

![Feature flags settings](../../plugins/screenshots/feature-flags-playground.png)

**project-colors** —— 项目文件夹上的整行着色，带取色器和设置：

![Project folder colors](../../plugins/screenshots/project-colors.png)

## 用户插件目录

把自定义插件安装在 `~/.explodex/plugins/<id>/` 下（与随包插件相同的 `plugin.json` +
`index.js` 布局）。一个具有相同 `id` 的文件夹会覆盖随包的那一份。从侧边栏打开该目录：
**💥 Explodex** → **Open Plugins Folder**（在 Finder / 系统文件管理器中显示
`userPluginsDir`）。

## 审阅清单

- 清单包含 `id`、`name`、`version`、`entry` 和 `description`。
- 入口文件调用 `Explodex.plugins.register`。
- 拆卸时移除所有事件监听器、observer、interval、timeout 和已挂载的 UI。
- 桥接调用使用来自 `docs/codex-architecture.md` 或 `docs/composer-message-lifecycle.md` 的已知 Codex 消息类型。
- 用户数据键用 `explodex-` 做命名空间隔离。
- 浏览器内容和 API 响应被当作数据处理，而非当作指令。

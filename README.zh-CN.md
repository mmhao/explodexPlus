> 本文是 [README.md](README.md) 的中文翻译，以英文原文为准。

# Explodex Plus 💥

**在 Windows 和 macOS 上给 Codex 桌面应用做模组——不碰安装本体。**

Explodex Plus 是 [explodex](https://github.com/dan-dr/explodex) 的一个 fork，带有一个 Windows 平台适配器和两个额外插件。它通过 Chrome DevTools Protocol 扩展 OpenAI 的 [Codex](https://openai.com/codex) 桌面应用：以调试标志启动原始的、已签名的应用，并在运行时注入插件 SDK。**Codex 安装中的任何内容都从不被修改**，所以应用更新永远不会覆盖（也不会破坏）你的模组。用过 BetterDiscord 或 Legcord 吗？就是这个思路，用于 Codex。

🇬🇧 **English version: [README.md](README.md)**

```sh
npm install -g explodex-plus   # or: pnpm add -g explodex-plus
explodex-plus
```

需要 **Node ≥ 22**（用 `node -v` 检查）。你用来*安装* CLI 的包管理器（npm、pnpm、Bun、Yarn）可自由选择；运行时是 Node。

## 你会得到什么

[上游 explodex](https://github.com/dan-dr/explodex) 随包的一切（用量一览、项目置顶/着色、effort 快捷键、plugin-builder skill、侧边栏里一个 💥 Explodex 设置页），加上为这个 fork 打造的两个插件：

| 插件 | 它做什么 |
| ------ | ------------ |
| [Project Groups](plugins/project-groups/) | 把侧边栏项目包裹成可折叠的自定义分组（工作 / 个人 / …）。分组状态只存在于 Explodex 存储里——Codex 永远看不到它。 |
| [Folder Copy Path](plugins/folder-copy-path/) | Files 面板里的文件夹获得文件本已具备的复制路径操作能力——剪贴板里是绝对的 Windows/POSIX 路径。 |

## Windows 安装（3 步）

1. 从 **Microsoft Store 安装 Codex 桌面应用**（必须是 MSIX 包；Explodex Plus 在运行时用 `Get-AppxPackage` 发现它——没有硬编码路径）。
2. `npm install -g explodex-plus`（Node ≥ 22），或用 pnpm：`pnpm add -g explodex-plus`。
3. 运行 `explodex-plus`。

它会在 `explodex-plus` 中以 `--remote-debugging-port=9333` 启动 Codex（通过 `shell:AppsFolder` 激活，从而让应用保留其 MSIX 包身份）并注入 SDK + 插件。你会被提供一个 **"Codex (Explodex)" 启动器**——一个桌面快捷方式*加*一个开始菜单项——此后想要用你的模组时，就通过它启动 Codex；而普通的 Store 图标永远给你一个未经修改的 Codex。

### 改为从本仓库运行

在开发插件时很有用。用 **pnpm**（仓库的主包管理器）或 npm：

```sh
pnpm install                    # or: npm install — no system Bun needed
node bin/explodex.mjs install   # with Node ≥ 22; creates desktop + Start Menu shortcuts
node bin/explodex.mjs           # launch Codex with SDK + plugins injected
```

仓库工具链（`pnpm test`、`pnpm run validate`、`pnpm run typecheck` 等）驱动一个内部的 **Bun devDependency**，它被装进 `node_modules`——你的机器上永远不需要装 Bun。`check:docs` 会校验英中文档镜像（每个 `docs/*.md` 都有一个 `docs/zh/` 对应文件，且没有相对链接被破坏）。

`install` 会写一个小巧的 `~\.explodex\bin\Codex (Explodex).cmd` 包装器，以及两个指向它的 `.lnk` 快捷方式。关于它们在桌面被重定向的机器上落到哪里，见下方的常见问题。

### 常见问题

- **为什么我必须从启动器启动 Codex？** 调试标志必须在进程启动时就存在。一个已经不带该标志运行起来的 Codex 无法被注入——启动器会先提示你完全退出 Codex（包括托盘进程）。
- **我运行了 `install`，但桌面上没有快捷方式。** 你的桌面文件夹很可能已从 `%USERPROFILE%\Desktop` 被重定向了（企业环境和 OneDrive 整理会把它移到例如 `E:\Desktop`）。启动器从注册表（`HKCU\…\User Shell Folders`）读取真实位置并写入那里——但一个*绘制自己"桌面"视图的桌面整理应用*不会显示系统桌面上的图标；把真实的桌面文件夹加入它的作用范围。路径上任何位置的 junction/symlink 都没问题（已验证）。
- **快捷方式打开后是控制台报错，而不是 Codex。** 包装器会先尝试运行 `install` 时处于活动状态的那个 Node 安装（它的绝对路径被写死在里面），然后回退到 PATH 上的 `node`。要么是两者都缺失/太旧（该 CLI 需要 **Node ≥ 22**）——用一个较新的 Node 重新运行 `install` 以刷新写死的路径。（从源码安装时）移动了仓库，或卸载了那个 Node 版本，是常见原因；`install` 是幂等的，再运行一次即可。
- **刚克隆完 `pnpm run format:check` 就是红的。** 这是既有问题：一些 fork 自有的文件在已提交的树里不是 prettier-clean 的，与你的安装方式无关。运行 `pnpm format` 来规范化。
- **一次更新弄坏了某个插件？** 更新从不会删除你的模组；最坏的情况只是一个 DOM 选择器不再匹配。通过启动器重新启动，并查阅 [docs/COMPATIBILITY.md](docs/zh/COMPATIBILITY.md) 中的选择器登记表。用随包的 `explodex-plugin-builder` skill 向 Codex 提问就是设计好的修复循环。
- **我该如何卸载？** `explodex-plus uninstall` 会移除包装器和两个快捷方式（另外可加 `npm rm -g explodex-plus`，以及——如果需要——`~/.explodex`）。Codex 安装本体从始至终没有被碰过。
- **我的登录/设置/项目还在吗？** 在——Explodex Plus 不会覆盖 Electron 的 user-data 目录。

## macOS 安装

与上游保持不变——见 [docs/installation.md](docs/zh/installation.md)。macOS 启动器应用（`~/Applications/Explodex.app`）由 `explodex-plus install` 创建。

## 工作原理

```
explodex-plus ──► Codex (original binary, +debug flag) ──► CDP :9333
                                                        │
                    lib/cdp-inject.mjs ◄────────────────┘
                        ├─ sdk/explodex-sdk.js   (window.Explodex)
                        └─ plugins/<id>/          (bundled + ~/.explodex/plugins)
```

- **DOM 注入区域** —— `aboveComposer`、`sidebar`、`composerActions`，以及更多
- **组件** —— 按 Codex 风格样式化的按钮、面板、toast
- **桥接** —— AppServer 路由和通往 Codex 内部的 Electron IPC
- **插件管理器** —— 目录、启用/禁用、开发时热加载

平台差异被隔离在 `lib/platform/{macos,windows}.mjs` 中；以上皆是共享的。

## 构建你自己的插件

运行 Explodex Plus，安装随包的 skill（`explodex-plus install-skill`），然后用平实的语言向 Codex 描述你想要的——[plugin-builder skill](skills/explodex-plugin-builder/SKILL.md) 会驱动 脚手架 → SDK 钩子 → 校验 → 实时注入。[SDK 参考](docs/zh/sdk-api.md)让 agent 停留在稳定的接口上，随包插件也可直接充当模板（`project-groups` 是一个很好的 DOM 协调示例；`folder-copy-path` 展示了基于 fiber 的数据提取）。

## 兼容性与安全

Explodex Plus 在本地注入 Codex 的渲染进程。它**从不修改**已安装的应用，并且完全在你的机器上运行。由于它挂钩了 Codex 内部，当 Codex 发布新版本时某个插件可能需要更新——见 [docs/sdk-fragility.md](docs/zh/sdk-fragility.md) 以及 [docs/COMPATIBILITY.md](docs/zh/COMPATIBILITY.md) 中的版本矩阵。

未经 OpenAI 授权、背书或支持。上游 [dan-dr/explodex](https://github.com/dan-dr/explodex) 未声明任何许可证（既无 LICENSE 文件，`package.json` 中也没有 `license` 字段），因此默认由各原作者保留所有权利；本 fork 沿用这一状态。

## 文档

每篇文档在 [`docs/zh/`](docs/zh/README.md) 下都有一个中文对应文件（见下方链接）。

| 文档 | 内容 |
| --- | -------- |
| [docs/COMPATIBILITY.md](docs/zh/COMPATIBILITY.md) | **Codex 版本 × 插件矩阵、选择器登记表** |
| [docs/ARCHITECTURE.md](docs/zh/ARCHITECTURE.md) | 注入链路、平台适配器契约、Windows 细节 |
| [docs/PLUGIN-DEVELOPMENT.md](docs/zh/PLUGIN-DEVELOPMENT.md) | fork 插件走查（project-groups、folder-copy-path）+ 模板 |
| [docs/sdk-api.md](docs/zh/sdk-api.md) | SDK API 参考（插件开发从这里开始） |
| [docs/development.md](docs/zh/development.md) | 仓库布局、校验、开发循环、命令 |
| [docs/installation.md](docs/zh/installation.md) | npm 安装、启动器状态、命令、日志 |
| [docs/windows-feasibility.md](docs/zh/windows-feasibility.md) | 本 fork 已实现的上游可行性笔记 |
| [docs/sdk-fragility.md](docs/zh/sdk-fragility.md) | Codex 更新时什么会坏 |
| [CHANGELOG.md](CHANGELOG.md) | 发布历史（keep-a-changelog） |

## 致谢

所有架构、SDK、注入器和原始插件都来自 [dan-dr/explodex](https://github.com/dan-dr/explodex)。本 fork 新增了：Windows 平台适配器（MSIX 身份激活、Store 包发现、启动器生成）、双平台 CI，以及上面那两个插件。

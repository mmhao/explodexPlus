> 本文是 [installation.md](../installation.md) 的中文翻译，以英文原文为准。

# 安装与启动器行为

## 安装

```sh
# pnpm
pnpm add -g explodex

# bun
bun install -g explodex

# npm
npm install -g explodex

# yarn
yarn global add explodex

explodex
```

已安装 CLI 的运行时是 Node.js 22+（上面任意一个包管理器都能安装本包；仓库自身
的工具链使用 pnpm/npm，并把 Bun 作为内部 devDependency——见
[development.md](./development.md)）。

包管理器命令会把 Explodex 全局安装。随后运行 `explodex` 会打开启动器应用
（首次运行时先创建它，并征求确认），在第一次交互式运行时提供插件 creator
skill，并检查来自 npm registry 的版本通知缓存。

在终端（TTY）中，`explodex` 使用交互式流程（[`@clack/prompts`](https://github.com/bombshell-dev/clack)）：

- **Codex 已带着 Explodex 在运行**（调试端口由 Codex 占有）→ 什么都不做，
  并如实说明。不重新打开、不重新注入、不改启动器。
- **启动器应用已存在** → 原样打开它。裸命令绝不会重写启动器；要重装它
  （例如升级之后）请运行 `explodex install`。
- **启动器应用缺失** → explodex 会询问是否创建。触发该提示的是应用本身缺失
  ——而不是 `~/.explodex` 缺失——因为应用缺失可能只是因为用户此前拒绝过创建。
  explodex 第一次运行时（以 `~/.explodex` 不存在来判定）还会打印一段简短说明，
  并且如果 `/Applications/Codex.app` 没有安装 Codex 会给出警告。
  - **确认** → 创建 `~/Applications/Explodex.app` 并打开它。
  - **拒绝** → **不要**创建应用，但这一次仍执行应用本会做的事：以远程调试方式
    启动 Codex，并直接通过 CLI 注入 SDK + 插件。提示语建议之后用
    `explodex install` 补装启动器应用。
- 传 `-y`/`--yes` 可跳过询问直接创建应用。当输出不是 TTY（管道、CI、日志）时
  跳过询问：缺失的启动器会被创建，已存在的原样打开，并打印普通状态行。
- 第一次交互式运行时，Explodex 会检查 `explodex-plugin-builder` 并提供
  **Install plugin creator skill (Recommended)**（安装插件 creator skill，推荐）。
  接受即执行 `npx skills add dan-dr/explodex`。`--yes` 会接受这一推荐；
  不带 `--yes` 的非交互式运行不会发起网络安装。

交互式启动仅适用于裸 `explodex` 命令；启动器应用本身调用的是
`explodex --launch`，它保持非交互并运行下面完整的启动状态机。`--from-app`
仍是同一行为的已弃用别名。`install`/`uninstall` 是
`install-launcher`/`uninstall-launcher` 的别名。

启动器由 plist、图标、zsh 与 JXA/AppKit 资源在本地生成。Explodex 不分发原生的
启动器可执行文件，不对生成的启动器签名，不清除隔离（quarantine）属性，
不重签 Codex，也不改动 Codex 的 bundle ID。

## 命令

| 命令 | 行为 |
|---|---|
| `explodex` | 打开用户启动器；首次运行时询问是否创建 |
| `explodex --yes` | 同上，但跳过首次运行的确认提示 |
| `explodex install-launcher` | 安装（或重装）用户启动器 |
| `explodex install-launcher --system` | 安装 `/Applications/Explodex.app`；macOS 会请求授权 |
| `explodex install-launcher --force` | 仅当目标带有 Explodex 所有权标记时才重装 |
| `explodex uninstall-launcher` | 把归 Explodex 所有的用户启动器移入废纸篓 |
| `explodex uninstall-launcher --system` | 经授权后移除归 Explodex 所有的系统级启动器 |
| `explodex inject` | 注入到已在配置调试端口上运行的 Codex |
| `explodex install-skill` | 执行 `npx skills add dan-dr/explodex` 安装插件 creator skill |
| `explodex doctor` | 重新执行针对 `Explodex.app` 与插件 creator skill 的入门检查；交互式地提供修复缺失项 |

没有 Explodex 所有权标记、也不属于旧版 Explodex bundle 标识的既有应用包，
永远不会被覆盖或删除，即使加 `--force` 也不会。

## 启动状态机

默认调试端口：`9333`；可用 `EXPLODEX_DEBUG_PORT` 覆盖。

| 观察到的状态 | 动作 |
|---|---|
| Codex 未运行，端口空闲 | 通过 `open -a /Applications/Codex.app --args --remote-debugging-port=<port>` 启动 Codex，等待端口就绪，注入，激活，退出启动器运行时 |
| Codex 占有预期端口 | 注入，激活，退出启动器运行时 |
| Codex 在运行但没有预期端口 | 提示用户先退出 Codex，然后退出；Explodex 绝不会替你退出 Codex |
| 其他进程占有预期端口 | 停止，并在错误信息中给出占有者与恢复操作 |
| Codex 缺失、端口等待超时、注入失败 | 停止，给出可行动的消息与日志路径 |

Codex 经由 LaunchServices 启动（`open -a`），而不是直接拉起其内部的 Mach-O
可执行文件，因此 Codex 作为自己的顶层应用运行，拥有自己的 TCC 身份。从 shell
派生的二进制会继承终端的 TCC 身份，这会让 macOS 把 Codex 自身的权限请求
（屏幕录制、自动化等）归到控制终端头上而不是 Codex 头上。用 `open` 启动可以让
Codex 既有的权限授权继续生效。激活同样使用 `open -a` 而非 AppleScript 的
`activate`，以避免触发自动化权限提示。开发模式保持隔离；见
[local-development.md](./local-development.md)。

## 日志与更新

日志位于 `~/.explodex/logs/`：

- `launcher.log`：状态判定以及启动器/注入器的输出

因为 Codex 是经 `open`（LaunchServices）启动的，它的 stdout/stderr 不会被捕获
进 `~/.explodex/logs/`；那部分输出请使用 Codex 自己的日志。

Explodex 最多每 24 小时在一个脱离终端的后台进程里检查一次 npm。缓存结果可能
打印新版本通知；Explodex 从不自动更新自己。请用当初全局安装时所用的包管理器
执行重装。

没有守护进程监视 Codex。Codex 自更新之后重启能否存活仍属待研究事项。

> 本文是 [ARCHITECTURE.md](../ARCHITECTURE.md) 的中文翻译，以英文原文为准。

# 架构

Explodex Plus 如何把一个未经改动的 Codex 桌面应用变成插件宿主——以及本 fork
为 Windows 增加了什么。

## 注入链（一次启动）

```
"Codex (Explodex)" shortcut (.lnk, Desktop + Start Menu)
  └─ %USERPROFILE%\.explodex\bin\Codex (Explodex).cmd   # wrapper: sets EXPLODEX_DEBUG_PORT, runs the CLI
      └─ node bin/explodex.mjs --launch
          └─ lib/launch.mjs → getPlatformAdapter() → lib/platform/windows.mjs (or macos.mjs)
              1. discoverCodex()            — find the install at runtime, never hardcoded
              2. inspectLaunchState()       — four-state check (below); refuses to hand off to a plain Codex
              3. launch with debug port     — Codex starts with --remote-debugging-port=<port>
              4. waitForDebugPort()         — polls http://127.0.0.1:<port>/json/version (≤30 s)
              5. inject()                   — spawns lib/cdp-inject.mjs as a child process
                  ├─ connects to the renderer target over the CDP WebSocket
                  ├─ sets window.__EXPLODEX_PLUGIN_CATALOG__ / __EXPLODEX_PATHS__
                  ├─ evaluates sdk/explodex-sdk.js        → window.Explodex appears
                  └─ evaluates each enabled plugin's scripts (in manifest `scripts` order)
```

整个过程中不会向 Codex 应用包写入任何内容。注入只存在于调试器会话期间：
退出 Codex，应用就恢复原样。这就是为什么模组必须始终通过启动器启动——也正是
Codex 自动更新永远无法覆盖它们的原因。

## 平台适配器契约

`lib/platform.mjs` 依据 `process.platform`（`darwin`、`win32`）选择一个适配器。
每个适配器导出：

| 导出 | 职责 |
| --- | --- |
| `inspectLaunchState(port?)` | 把当前环境归类到四状态机；在 Windows 上经由 PowerShell JSON 单行命令（`Get-NetTCPConnection`、`Get-CimInstance Win32_Process`、Appx 查询） |
| `launch({port, home})` | 上面完整的流程；返回 `{state: "launched" \| "injected" \| "needs-quit", log}` |
| `inject(port, home)` | 针对已在运行的调试版 Codex 派生 CDP 注入器 |
| `installedCodexEnvironment(env)` | 被启动的 Codex 继承的环境变量（代理/语言环境透传） |

`decideLaunchState({portListening, portOwnedByCodex, codexRunning})`
（纯函数，位于 `lib/platform.mjs`）产出：

- `stopped` — 带调试端口启动 Codex，然后注入。
- `plain-codex` — Codex 正在运行且**没有**该调试标志；事后无法附加上去 →
  提示彻底退出（包括系统托盘）。绝不悄悄重启：Codex 的单实例锁会把启动移交
  给既有进程并丢掉标志。
- `debug-codex` — 端口已由 Codex 占有 → 直接注入即可。
- `foreign-port` — 端口被其他进程占用 → 报错并给出 PID/路径；用
  `EXPLODEX_DEBUG_PORT` 换端口。

## Windows 特有事项（`lib/platform/windows.mjs`）

Codex 商店版应用是一个 MSIX 包，安装在只读、受 ACL 保护的
`C:\Program Files\WindowsApps\` 下：

- **安装发现**：`Get-AppxPackage OpenAI.Codex` → `InstallLocation` + 包系列名，
  每次启动都重新解析（文件夹名内嵌版本号，更新后会变化）。
- **保留身份的启动**：按路径直接启动 `app\ChatGPT.exe` 会失败（“该进程没有
  程序包标识符”——MSIX exe 期望包激活上下文）。适配器通过 `Shell.Application`
  COM 对象以 `shell:AppsFolder\<PFN>!App` 激活应用，既传入调试标志又保留包标识
  （通知、任务栏分组、执行别名一切照常）。
- **启动器快捷方式**：资源管理器拒绝指向 `WindowsApps` 的用户自建快捷方式，
  因此 .lnk 指向 `~\.explodex\bin\` 下生成的 `.cmd` 包装脚本，由它调用 CLI，
  CLI 每次重新发现 exe。开始菜单 + 桌面；`explodex-plus uninstall` 会移除它
  所有的那三个文件。桌面/开始菜单位置在可读时取自
  `HKCU\…\User Shell Folders` 注册表键（`lib/paths.mjs` 中的
  `resolveUserShellFolder`），读不到时回退到 `%USERPROFILE%` 拼接——桌面被
  重定向过的机器（例如 `E:\Desktop`）会把快捷方式放到*真正的*桌面上。
  包装脚本内固化了 `realpath(process.execPath)`，双击时使用安装启动器的那个
  Node，而非 PATH 上解析到的任意 `node`（fnm/nvm 的 multishell 目录会解析到
  稳定的安装路径）；若该路径日后消失，包装脚本回退到 PATH 上的 `node`
  （≥ 22）而不是彻底失败——升级 Node 后请重新执行 `install` 刷新。
- **日志**：`%LOCALAPPDATA%\Explodex\logs\launcher.log`。
- **用户数据**：`~/.explodex`（插件、状态）——与 macOS 相同；Electron 配置
  目录*不*被覆盖，因此登录/设置/项目原样保留。
- 纯构建函数（`appxDiscoveryScript`、`parseAppxPackage`、`portOwnerScript`、
  `activationScript`、`debugPortArg`、快捷方式构建器……）针对预置的
  PowerShell JSON 做单元测试——测试中不涉及真实进程。

已记录的死胡同（不要重试）：Win11 26100 上 AppActivationManager CLSIDs 未注册；
`codex-command-runner.exe` 的 stdin 协议；直接启动 exe。见
[COMPATIBILITY.md](COMPATIBILITY.md)。

## 插件模型

- 一个插件就是 `plugins/<id>/` 目录，含 `plugin.json`（`id`、`name`、
  `scripts: [...]`）以及若干脚本，注入时按顺序拼接。内置插件随 npm 包分发；
  `~/.explodex/plugins/` 下的用户插件覆盖同 id 的内置插件。
- SDK（`sdk/explodex-sdk.js`）暴露 `window.Explodex`：DOM 注入区域(zone)、
  Codex 风格组件、AppServer/Electron 桥接、持久化 `storage`，以及插件管理器
  （通过 💥 Explodex 侧边栏页启用/禁用；启用状态默认值在
  `defaultEnabledState()` 中）。
- 插件的设置/状态经由桥接的全局状态持久化，Codex 自己把它存放在
  `~/.codex/.codex-global-state.json` 的 `explodex-*` 键下——重启后仍在，
  对 Codex 不可见。

## fork 的插件布局约定

`project-groups` 与 `folder-copy-path` 都拆分为：

- `logic.js` — 纯逻辑、不碰 DOM 的核心，挂到 `globalThis` 上（`test/` 中的
  单元测试也直接使用它）。
- `index.js` — 薄薄的 DOM 层：MutationObserver + 防抖的幂等 reconcile、
  菜单、teardown。
- `types.d.ts` — ambient 全局声明，由 `tsconfig.plugins.json` 检查
  （`bun run --bun tsc -p tsconfig.plugins.json`）。

硬性规则（实战学到的）：绝不包裹或改动 React 拥有的子树——只对兄弟节点重排序/
隐藏；瞄准 `data-testid`/无障碍文本，绝不用生成类名；每个插件都要返回一个不留
任何 DOM 残留的 teardown。

## 与上游的关系

本仓库是 [dan-dr/explodex](https://github.com/dan-dr/explodex)（macOS 起源）的
fork。Windows 支持是纯增量的：平台选择本就是唯一设计的扩展点，因此
`lib/cdp-inject.mjs`、SDK、上游插件和 CLI 除了改名外保持不变。
通过向上游 rebase 来吸收 SDK/选择器的修复。

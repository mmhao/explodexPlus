> 本文是 [windows-feasibility.md](../windows-feasibility.md) 的中文翻译，以英文原文为准。

# Windows 桌面端可行性技术验证（spike）

状态：仅为可行性笔记。**未声称支持 Windows，也未在真实环境验证。** Linux 暂缓推进，因为目前没有官方宣传的 Linux 桌面应用。

## 平台适配器映射

CLI 通过平台适配器路由"已安装模式"下的操作。macOS 已在 `lib/platform/macos.mjs` 中完整实现；Windows 适配器需要对下表中的每一项做真实验证。

| 关注点 | 候选的 Windows 实现 | 需要的验证 |
|---|---|---|
| Codex 安装路径 | 从已知应用路径/卸载注册表发现"按用户"或"按机器"的安装，而非硬编码 | 各种安装器变体与商店/非商店安装 |
| 进程检测 | PowerShell/CIM `Win32_Process` 或 Node 进程 API 通道；匹配可执行文件路径与命令行 | 权限行为与进程树 |
| 调试标志 | 以 `--remote-debugging-port=9333` 启动 Codex 可执行文件 | 确认 Electron 会转发该标志 |
| Profile 连续性 | 已安装模式下不设置 Electron user-data 覆盖 | 现有登录、设置、项目得以保留 |
| 端口归属 | 通过 PowerShell/Get-NetTCPConnection 获取 TCP 所有者的 PID，再解析可执行文件路径 | 外部占用者与 access-denied 情形 |
| 更新器 | 启动当前已安装的可执行文件；不修补更新资源 | 自动更新重启前后的行为 |
| 快捷方式 | 通过 PowerShell COM 生成的按用户开始菜单/桌面 `.lnk`；可选的提权全体用户快捷方式 | 重装与所有权标记语义 |
| 启动画面 | PowerShell/WPF 或一个小型本地 script-host UI；不分发原生启动器二进制 | 启动延迟、焦点、取消、无障碍 |
| 注入 | 复用 Node CDP 注入器与 npm 打包的 SDK/插件 | 生产应用中的 WebSocket/CDP 行为 |
| 日志 | `%LOCALAPPDATA%\\Explodex\\logs` | 错误信息可操作、隐私合规 |

## 待解问题

1. 各安装渠道下规范化的 Codex 可执行文件与更新器路径。
2. 第二次启动是否会在 Chromium 消费调试标志之前移交给已存在的进程。
3. 可靠的、无需管理员权限的进程命令行检查。
4. 快捷方式的所有权元数据与安全的冲突处理行为。
5. 常规 profile 的位置，以及任何由更新器管理的环境变量。

在 Windows 上对 stopped/debug/plain/foreign-port 各分支、注入、插件注册、更新行为与 profile 连续性完成实机测试之前，不要将 `win32` 加入 `package.json#os`，也不要对外宣传 Windows。

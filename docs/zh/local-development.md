> 本文是 [local-development.md](../local-development.md) 的中文翻译，以英文原文为准。

# 本地开发与安装模式

Explodex 有两条刻意分开的启动路径。

## 安装模式

一次全局 npm 源安装（`pnpm add -g explodex`，或 Bun/npm/Yarn 的等价命令）会提供 CLI、SDK、随包插件和 CDP 注入器。首次运行 `explodex` 会生成 `~/Applications/Explodex.app` 并打开它。生成的包中只包含：

- `Contents/Info.plist`
- `Contents/MacOS/Explodex` (zsh)
- `Contents/Resources/Explodex.icns`
- `Contents/Resources/progress.jxa` (JXA/AppKit 进度界面)
- 一个 Explodex 归属标记

该 shell 通过登录 shell 解析 `explodex --launch`。这意味着无需重新生成本地可执行文件就能用上更新的全局包安装。`--from-app` 是一个已弃用的别名。CLI 通过 LaunchServices 启动 Codex（`open -a /Applications/Codex.app --args --remote-debugging-port=<port>`），而不是派生内部的 Mach-O 二进制，注入包资源，激活 Codex，然后退出。通过 `open` 启动会让 Codex 成为它自己的顶层进程，拥有自己的 TCC 身份，因此从终端派生的二进制不会借用终端的权限身份，macOS 会把 Codex 的权限提示（屏幕录制、自动化）归到 Codex 自己名下。它不会设置 `CODEX_ELECTRON_USER_DATA_PATH`；LaunchServices 会话使用普通的 Codex 配置。

没有守护进程或监管进程。在 Codex 自更新重启后仍能存活是一个低优先级的待研究方向，而非当前行为。

完整状态表和恢复命令见 [installation.md](./installation.md)。

## 源码开发

```sh
pnpm run dev
```

开发时会从 `templates/explodex-app/` 打包出 `dist/Explodex.app`，以 `9333` 端口开启 CDP 启动，注入仓库的 SDK/插件，并启动 Chrome DevTools MCP。开发数据默认隔离在 `.explodex-user-data/` 下。

```sh
pnpm run inject
pnpm run package
pnpm run validate
```

`dist/Explodex.app`、`scripts/package-app.ts` 以及 templates 都是源码开发工具。它们不是 npm 分发产物。不支持任何生产 ZIP、拷贝出的发布版 app、`install.sh`、签名或清除 xattr 的流程。

## 插件路径

安装注入层先加载随包的 npm 插件，然后是 `~/.explodex/plugins/`；用户插件会覆盖同 id 的随包插件。开发注入可通过 `EXPLODEX_PLUGINS_DIR` 额外加入仓库插件。

## 配置边界

- 安装模式：普通 Codex 配置；无配置覆盖。
- 开发模式：隔离的 `.explodex-user-data/`，除非显式覆盖。

绝不修改、重新签名或更改 `/Applications/Codex.app` 的 bundle ID。

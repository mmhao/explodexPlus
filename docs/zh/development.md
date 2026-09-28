> 本文是 [development.md](../development.md) 的中文翻译，以英文原文为准。

# 开发指南

Explodex 是一个源码优先（source-first）的仓库。专有 Codex 应用包与逆向工程提取
产物请保持在本地并被忽略，不要提交。

## 目录布局

| 路径 | 用途 |
|------|---------|
| `sdk/explodex-sdk.js` | 注入到渲染进程的 SDK 与插件运行时 |
| `plugins/<id>/plugin.json` | 插件目录（catalog）元数据 |
| `plugins/<id>/index.js` | 插件运行时入口 |
| `scripts/cdp-inject.ts` | CDP 注入器（Bun TypeScript；shell 入口 `cdp-inject.sh`） |
| `scripts/dev.ts` | 本地开发：打包 + chrome-devtools-mcp + 启动 |
| `scripts/package-app.ts` | 构建用于源码开发的 `dist/Explodex.app` |
| `lib/launcher-bundle.mjs` | 生成轻量的 npm 安装版启动器 |
| `lib/platform/macos.mjs` | 安装模式下 macOS 的启动状态适配器 |
| `scripts/launch.sh` | 以远程调试方式启动 Codex 并注入 Explodex |
| `templates/explodex-app/` | 供包装应用使用的、纳入版本管理的 shell 启动器模板 |
| `dist/` | 被忽略的生成产物（`dist/Explodex.app`） |

关于打包、安装、用户数据与插件加载路径的设计说明，参见
[local-development.md](./local-development.md)。

## 前置条件

目标运行时是 Node **≥ 22**（见 `.node-version`），主包管理器为 **pnpm**
（`npm` 也可用）。你*不需要*系统安装 Bun——仓库会把 Bun 1.3.14 作为
devDependency 装进 `node_modules/.bin`，所有 `pnpm run …` / `pnpm exec bun …`
都会从那里取到它。

```sh
pnpm install        # 或：npm install
```

> pnpm 默认不执行依赖的 postinstall 脚本；`package.json` 通过
> `pnpm.onlyBuiltDependencies` 为 Bun 开了白名单，因此 `pnpm install` 依然会
> 得到可用的 `node_modules/.bin/bun`。在 npm 下，`npm install` 会原生执行它。

## 本地开发

```sh
pnpm run dev
```

这会打包 `dist/Explodex.app`、启动它、等待调试端口 `9333`，并启动
`chrome-devtools-mcp` 供 agent 检查（见 `.mcp.json`）。

CDP 注入器会在启动期间把 SDK/插件目录应用到它所看到的每一个匹配的 Codex
渲染进程目标。首次注入之后它会继续轮询（每 250ms）迟挂载的次级渲染进程，但一旦
连续两次轮询没有发现新目标就会退出；`EXPLODEX_TARGET_WATCH_MS`（默认
`8000`）只是绝对上限，因此常见的单窗口场景约 0.5 秒即可完成，而不用等满整个
观察窗口。在每个渲染进程内部，可用 `Explodex.observeZone(zoneId, callback)`
观察各个注入区域(zone)，这样当 React 替换掉某个 portal/侧边栏节点后，插件可以
重新挂载。

修改 SDK 或插件后重新注入：

```sh
pnpm run inject
```

注入器会先发布刷新后的插件目录，然后再执行 SDK。SDK 在启动时从该目录初始化，
因此一次注入既能加入新插件，也能移除已删除的插件 ID，且无需重新加载渲染进程。

### 布局快照（侧边栏 / shell 地标）

在 `pnpm run dev` 之后（或任何在 `9333` 上开着 CDP 的会话），可以抓取一份
JSON 布局报告，用于排查选择器漂移：

```sh
pnpm exec bun scripts/cdp-layout-snapshot.ts
# 可选：指定输出路径：
EXPLODEX_LAYOUT_SNAPSHOT_OUT=./layout.json pnpm exec bun scripts/cdp-layout-snapshot.ts
```

默认写入路径：`~/.explodex/snapshots/layout-<timestamp>.json`。快照包含侧边栏
testid、导航 `aria-label`、个人资料底部栏按钮、各注入区域(zone)的 portal 是否
存在、`data-app-action-sidebar-*` 计数，以及（在 DevTools hook 存在时）一条
简短的 React fiber 链。

### 经由 CDP 的 React 布局探测

Codex 发布的是 production 版 React。`cdp-react-devtools.ts` 会安装 DevTools
全局 hook（供重载时使用），并立即遍历侧边栏 DOM 节点上的 `__reactFiber$*`
链——fiber 报告无需重载：

```sh
pnpm run react-devtools
# 可选：同时尝试 react-devtools-inline 后端 eval（UI 需要渲染进程重载）
EXPLODEX_REACT_DEVTOOLS_BACKEND=1 pnpm run react-devtools
```

当 Codex 在版本之间改动布局时，配合 `pnpm run layout:snapshot` 一起使用。

`pnpm run inject`（`--inject-only`）会连接到监听调试端口的任何进程——包括通往
远程 Codex 的 SSH 隧道。**Explodex.app 启动器**则更严格：只有当**本地** Codex
占有端口 `9333`（或该进程能以其他方式被识别为
`Codex.app/Contents/MacOS/Codex`）时，它才走“注入现有实例”的快捷路径。如果是
别的进程（例如 `ssh -L 9333:…`）占着端口，启动器会报告端口冲突，而不是谎称
已注入到一个正在运行的本地 Codex。

## 分发边界

生产分发通过 npm registry 进行，并支持用 pnpm、Bun、npm 或 Yarn 全局安装。
生成的用户启动器记录在 [installation.md](./installation.md) 中。
`pnpm run package` 与 `dist/Explodex.app` 仍然只是源码开发工具。

## 验证

```sh
pnpm run validate
```

检查 shell 语法、Bun/TS 语法、JS 入口、JSON manifest、npm 注入器构建以及
启动器测试。

## 插件开发

1. 创建 `plugins/<id>/plugin.json`。
2. 创建 `plugins/<id>/index.js`。
3. 通过 `Explodex.plugins.register` 注册。
4. 返回一个 teardown，用于移除监听器、定时器、观察者和已挂载的 UI。
5. 运行 `pnpm run validate`。
6. 运行 `pnpm run inject`（全新会话则用 `pnpm run dev`）。

插件状态键要以 `explodex-` 作为命名空间。重命名旧键时，先读取旧键，并在下次
更新时写入新键。

### 使用你本地的 `plugins/` 检出

要在运行时使用你工作副本中的插件而不是随包内置的副本，可以把你的检出目录软链
接到用户插件目录（同 id 时用户插件覆盖内置插件）：

```sh
ln -sf "$(pwd)/plugins" ~/.explodex/plugins
```

或者把用户插件目录直接指向你的仓库：

```sh
export EXPLODEX_USER_PLUGINS_DIR="$(pwd)/plugins"
```

之后每次修改插件源码，运行 `pnpm run inject`。

## 浏览器验证

`.mcp.json` 将 `chrome-devtools-mcp` 配置为指向 `http://127.0.0.1:9333`。
`pnpm run dev` 会自动启动该 MCP 服务器。dev 运行起来后，Cursor agents 应使用
chrome-devtools 的 MCP 工具进行验证。

## 公开仓库卫生

不要提交：

- Codex 应用包
- 从应用提取的资源
- 用户数据目录
- 日志
- 生成的 `dist/Explodex.app`

应当提交：

- SDK 源码
- 插件源码与 manifests
- 脚本与模板
- 文档
- 验证门禁

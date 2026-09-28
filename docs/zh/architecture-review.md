> 本文是 [architecture-review.md](../architecture-review.md) 的中文翻译，以英文原文为准。

# 架构评审

日期：2026-06-21

## 当前形态

Explodex 通过 CDP 向 Codex 注入一个渲染进程 SDK。该 SDK 提供 DOM 区域（zones）、存储辅助、桥接辅助、HTTP 辅助以及插件生命周期 API。插件从一个由 `scripts/cdp-inject.py` 生成的目录清单加载。

项目现已采用插件目录结构：

```text
plugins/<id>/
  plugin.json
  index.js
```

这呼应了 Codex 自身面向清单（manifest）的插件约定，同时并不冒充官方 Codex 插件系统。

## 发现

| 发现 | 影响 | 已做的改动 |
|---------|--------|-------------|
| 公开仓库会误捕获巨大的本地产物 | `vendor/` 与 `extracted/` 包含专有/逆向工程产物 | 添加 `.gitignore`；产物保留在本地 |
| 扁平的插件文件不带独立元数据 | 更难记录、编目、评审或按需加载插件 | 为每个插件添加 `plugin.json` 并做目录发现 |
| 推理前缀在下一帧恢复 effort | 恢复可能与异步提交竞态，在 Codex 消费设置前就被还原 | 将恢复改为有界的提交后定时器 |
| 项目置顶保留了 `sortKey` | 设置了 `sortKey` 时 Codex 会忽略手动 `threadIds`，项目置顶看似已保存却不会重排 | 置顶排序现在会移除 `sortKey` 并对账置顶顺序 |
| SDK 是一个庞大的单文件注入脚本 | 更难评审与测试；目前超出仓库 LOC 指引 | 暂缓：拆分为模块并增加构建步骤 |
| AppServer 路由捕获给 `Function.prototype.call/apply` 打补丁 | 强大但过于宽泛的猴子补丁；存在性能/调试风险 | 暂缓：隔离捕获逻辑或寻找官方钩子 |

## 方向

具体的后续计划位于 [plans/](../../plans/README.md)。

### 拆分 SDK 源码

保持注入运行时为单一打包文件，但以 `sdk/src/` 下的模块来编写，并构建出 `sdk/explodex-sdk.js` 放到 `dist/` 或现有 SDK 路径。这样评审者看到的是更小的文件，同时保留 CDP 注入的简洁性。

### 把插件当作包来对待

新的清单布局应随时间逐步扩展以下字段：

- `permissions`
- `zones`
- `docs`
- `settings`
- `codexVersionRange`

在加载器真正强制校验或展示这些字段之前，不要添加它们。

### 增加运行时冒烟测试

当前的 `npm run validate` 关卡只做语法检查。增加一个 CDP 冒烟测试：启动静态测试载体（harness），验证 `window.Explodex`，验证插件目录清单，并检查 shell 导航标签为 `Explodex` 且带 `💥`。

### 减少全局猴子补丁

`sdk/explodex-sdk.js` 中的 app-server 捕获是风险最高的机制。保持其文档化，并在 Codex 暴露稳定的渲染进程侧路由对象或事件之后，优先改用更窄的捕获方式。

## 暂不采纳

- 发布提取出的 Codex 资源：不适合公开仓库。
- 完整重新实现 composer 发送路径：涉及过多 Codex 私有逻辑；插件应留在官方 bridge/原生 composer 路径上。
- 内联 ProseMirror 前缀胶囊（pill）：需要编辑器 decorations 或未向插件开放的节点注册。

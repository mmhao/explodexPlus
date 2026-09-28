# Explodex Plus 中文文档

> 本目录是 [`docs/`](../) 英文文档的中文镜像，逐篇对应、以英文原文为准。项目总览与安装请从根目录 [README.zh-CN.md](../../README.zh-CN.md) 开始。

面向用户与插件作者的核心文档：

| 文档 | 内容 | 英文原文 |
| --- | --- | --- |
| [installation.md](installation.md) | 安装、启动器状态、命令、日志 | [↗](../installation.md) |
| [COMPATIBILITY.md](COMPATIBILITY.md) | **Codex 版本 × 插件矩阵、选择器登记表** | [↗](../COMPATIBILITY.md) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 注入链路、平台适配器契约、Windows 细节 | [↗](../ARCHITECTURE.md) |
| [PLUGIN-DEVELOPMENT.md](PLUGIN-DEVELOPMENT.md) | 复刻插件实战（project-groups、folder-copy-path）+ 模板 | [↗](../PLUGIN-DEVELOPMENT.md) |
| [sdk-api.md](sdk-api.md) | SDK API 参考（插件开发从这里开始） | [↗](../sdk-api.md) |
| [development.md](development.md) | 仓库结构、验证、开发循环、命令 | [↗](../development.md) |
| [plugins/README.md](plugins/README.md) | 逐个插件的评审与文档索引 | [↗](../plugins/README.md) |
| [RELEASING.md](RELEASING.md) | **发布流程**与 npm 源传播/恢复指南 | [↗](../RELEASING.md) |

深入 / 逆向工程参考：

| 文档 | 内容 | 英文原文 |
| --- | --- | --- |
| [codex-architecture.md](codex-architecture.md) | Codex 包拓扑、注入区域、IPC、持久化 | [↗](../codex-architecture.md) |
| [composer-message-lifecycle.md](composer-message-lifecycle.md) | Composer 发送 API、effort/collaborationMode、插件钩子点 | [↗](../composer-message-lifecycle.md) |
| [sdk-fragility.md](sdk-fragility.md) | SDK 跨 Codex 版本的脆弱面、稳定面、升级清单 | [↗](../sdk-fragility.md) |
| [early-injection-and-inspect-brk.md](early-injection-and-inspect-brk.md) | inspect-brk vs CDP 早期注入、补丁分层、React props 限制 | [↗](../early-injection-and-inspect-brk.md) |
| [codex-root-runtime.md](codex-root-runtime.md) | Codex 根运行时剖析 | [↗](../codex-root-runtime.md) |
| [reasoning-effort-prefix-session.md](reasoning-effort-prefix-session.md) | 会话记录：reasoning-effort 前缀插件、决策、验证、Option D 方案 | [↗](../reasoning-effort-prefix-session.md) |
| [current-findings.md](current-findings.md) | 持续调查随记 | [↗](../current-findings.md) |
| [local-development.md](local-development.md) | 打包、安装、用户数据、插件加载路径设计说明 | [↗](../local-development.md) |
| [architecture-review.md](architecture-review.md) | 架构评审 | [↗](../architecture-review.md) |
| [windows-feasibility.md](windows-feasibility.md) | 本复刻落地的上游可行性验证笔记 | [↗](../windows-feasibility.md) |

## 维护约定

每篇英文文档在 `docs/zh/` 下都有同名中文镜像，反之亦然。新增/删除/重命名文档后运行 `pnpm run check:docs`（脚本：`scripts/check-docs.mjs`），它会校验：每个英文文档都有中文镜像、README 双语齐全、所有相对链接可解析。翻译时**代码块、命令、路径、桥接 type 保持原样**，正文链接按"docs 内互链保持不变、指向镜像树外多加一层 `../`"的规则改写。

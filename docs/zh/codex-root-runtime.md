> 本文是 [codex-root-runtime.md](../codex-root-runtime.md) 的中文翻译，以英文原文为准。

# 运行时 React 根节点（`window.__codexRoot`）

日期：2026-06-21

## 摘要

实时的 Codex 渲染进程会暴露 `window.__codexRoot`。它是 ReactDOM 的 `createRoot` 返回的 React 根对象，而不是一个稳定的 Codex 应用 API。

通过 `http://127.0.0.1:9333` 的 DevTools 端点观测到：

- `window.__codexRoot` 存在于主 `app://-/index.html` 渲染进程中。
- 构造函数名经过压缩（在这个构建中，公开根节点为 `Fp`，内部根节点为 `$f`）。
- 自有键：`['_internalRoot']`。
- 原型方法：`render(element)` 和 `unmount()`。
- `_internalRoot.containerInfo` 是 `#root`。
- `_internalRoot.current` 是 Fiber 根（`tag === 3`）。
- `window.React` 和 `window.ReactDOM` 不是全局变量。
- 在被检视的会话中不存在 `window.__REACT_DEVTOOLS_GLOBAL_HOOK__`。
- 在 `extracted/webview/assets/` 中没有找到字面量字符串 `__codexRoot`；把它当作运行时/引导状态，而非持久的源码符号。

## 形状

```text
window.__codexRoot
└── _internalRoot
    ├── containerInfo  → HTMLDivElement#root
    ├── current        → React Fiber root
    ├── pendingLanes / suspendedLanes / ...
    ├── onUncaughtError / onCaughtError / onRecoverableError
    └── other React scheduler/cache internals
```

在这个构建中，`String(window.__codexRoot.render)` 显示出预期的压缩版 React 根渲染包装器。调用它会为整个 Codex 应用根调度一次新的 React 渲染。

## 它有什么用

### 只读诊断

可以遍历 `__codexRoot._internalRoot.current` 来检视当前的 Fiber 树：

- 统计已挂载的 fiber 和宿主节点数量。
- 为诸如 `aside.app-shell-left-panel` 这样的 DOM 元素定位宿主 fiber。
- 通过诸如 `__reactFiber$...` 这样的 React expando 键把一个 DOM 节点映射回它所属的 fiber。
- 在 DOM 选择器不够用时检视组件/provider 的拓扑结构。
- 确认 Explodex 注入的 DOM 位于 React 的 Fiber 树之外，因此 React 在对宿主子节点做协调时可能会移除它。

这有助于解释为什么 DOM 注入区域插件必须观察/重新挂载，而不能假定注入的节点归 React 所有。

### 提交/重挂载信号

由于被检视的会话中缺少 React DevTools 钩子，`__codexRoot` 并不直接提供公开的提交订阅。实际可选的做法有：

1. 继续用 DOM `MutationObserver` + `observeZone()` 来做生产环境的插件重挂载。
2. 对于调试工具，在疑似发生 UI 变化后轮询或采样 `_internalRoot.current` 并遍历宿主 fiber。
3. 仅针对未来的重新加载，在 React 初始化之前安装一个小的 `__REACT_DEVTOOLS_GLOBAL_HOOK__`，并把 `onCommitFiberRoot` 用作额外的调试信号。这必须是防御性且可选的。通过 `addScriptToEvaluateOnNewDocument` 下发以及对 props 注入的限制，见 [early-injection-and-inspect-brk.md](./early-injection-and-inspect-brk.md) §4–6。

### Context/provider 发现

Fiber 遍历可以揭示出诸如 router `Navigation`、router `Location`、路由 context、布局尺寸 context、tooltip/popover context，以及应用级的账号/配置 provider 等 React context provider。

Provider 的值可能包含个人/账号元数据和实时服务对象。不要把 provider 的值倾倒进日志/文档。只使用带白名单的键摘要。

## 不要做什么

- 不要用 `window.__codexRoot.render(...)` 来做插件 UI。它针对的是整个 Codex 应用根，可能会替换或破坏应用树。
- 不要在插件 UI 之外调用 `window.__codexRoot.unmount()`，除非是在一次性的调试会话中；它会卸载 Codex。
- 不要改动 fiber（`memoizedProps`、`memoizedState`、`stateNode`、lanes、更新队列）。React 内部并不稳定，直接改动会破坏调度。
- 不要依赖压缩后的组件名（`Fp`、`$f`、`Zf` 等）。它们会随构建变化。
- 不要把 provider 的 context 值当作安全的插件 API。它们可能包含敏感的用户/账号数据和不稳定的函数标识。

## 对 Explodex 的影响

`__codexRoot` 作为**调试/研究用的观察窗口**很有价值，而不是作为主要的扩展机制。

推荐的架构仍然是：

```text
CDP injection
  └─ Explodex SDK
      ├─ DOM zones + observeZone() for persistent mounts
      ├─ official bridge calls for Codex behavior changes
      └─ optional debug-only Fiber inspection helpers
```

未来可能的 SDK 新增：

```js
Explodex.debug.reactRoot()      // returns a redacted root summary
Explodex.debug.findOwnerFiber(el) // maps a DOM node to a shallow fiber summary
```

把这些放在 `debug` 之下并使其只读。生产插件的行为应继续使用 `observeZone()` 和桥接 API。

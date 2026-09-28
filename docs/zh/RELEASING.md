> 本文是 [RELEASING.md](../RELEASING.md) 的中文翻译，以英文原文为准。

# Explodex 发布流程

本文档概述了向 npm 和 GitHub 发布 Explodex 新版本的逐步流程。

---

## 操作者发布流程

按照以下步骤发布 Explodex 的新版本。

### 1. 发布前检查
1. 从一个干净且最新的 `main` 分支开始：
   ```bash
   git checkout main
   git pull origin main
   git status # verify clean working directory
   ```
2. 确认 GitHub 上 `main` 最新提交的持续集成（CI）状态为绿色。

### 2. 版本与变更日志准备
3. 根据 SemVer 规则选择下一个版本号（例如 `v0.2.2`）。
4. 更新 `CHANGELOG.md`：
   - 把发布说明从 `## [Unreleased]` 段落移入一个新的带日期的版本段落：
     ```markdown
     ## [X.Y.Z] - YYYY-MM-DD
     ```
   - 按要求保留所有贡献者致谢。
5. 更新 `package.json`：
   - 把 `"version"` 字段改为与所选版本一致（例如 `"version": "0.2.2"`）。

### 3. 本地验证
6. 运行本地校验与打包检查：
   ```bash
   # Ensure dependencies are locked and correct
   bun install --frozen-lockfile

   # Run local validation suite (checks lints, types, tests, builds the injector)
   bun run validate

   # Verify the release metadata and changelog
   bun run release:check -- vX.Y.Z

   # Perform a dry-run npm pack to confirm contents
   npm pack --dry-run --json --cache /tmp/explodex-npm-cache
   ```

### 4. 发布提交与打标签
7. 只提交发布元数据的改动（`package.json`、`bun.lock`、`CHANGELOG.md`、`lib/cdp-inject.mjs`）：
   ```bash
   git add package.json bun.lock CHANGELOG.md lib/cdp-inject.mjs
   git commit -m "chore(release): vX.Y.Z"
   ```
   > [!NOTE]
   > 如果已配置，请使用仓库要求的 `committer` 辅助工具。
8. 把发布提交推送到远端仓库：
   ```bash
   git push origin main
   ```
9. 等待 GitHub 上的 CI 工作流运行成功完成。
10. 在发布提交上创建一个带注释的 git 标签：
    ```bash
    git tag -a vX.Y.Z -m "vX.Y.Z"
    ```
11. 把标签推送到 GitHub：
    ```bash
    git push origin vX.Y.Z
    ```

### 5. 发布后验证
12. 观察 GitHub Actions 上自动化的 **Release** 工作流。
13. 确认在 npm 上已发布：
    - 版本可见。
    - 正确的分发标签（stable 发布到 `latest`，prerelease 发布到 `next`）。
    - 存在 NPM 来源证明（provenance attestation）。
14. 确认 GitHub Release：
    - 精选的说明已被前置。
    - 标题为 `vX.Y.Z`。
    - prerelease 状态标记正确。
15. **绝不移动、重建或复用已发布的版本标签。**

---

## 恢复指引

如果发布流程中出了问题，请遵循以下指引。

### 场景 A：npm publish 之前失败
如果 Release 工作流在执行 npm publish 步骤之前失败（例如 git 检查失败或校验失败）：
1. 在 `main` 分支上修复问题。
2. 如有必要，删除尚未发布的本地/远端标签：
   ```bash
   git tag -d vX.Y.Z
   git push --delete origin vX.Y.Z
   ```
3. 提交修复，并再次遵循发布流程推送一个新标签。

### 场景 B：npm 已发布但 GitHub Release 失败
如果 npm 发布成功，但 GitHub Release 创建失败：
1. 不要删除或修改 git 标签。
2. 进入失败的那次 GitHub Action 运行并触发一次重跑。
3. 工作流的幂等性检查会检测到带有匹配 `gitHead` 的版本 `X.Y.Z` 已经在 npm 上，从而跳过发布步骤，并创建 GitHub Release。

### 场景 C：npm 包内容有误
由于已发布的 npm 版本不可变：
1. 不要尝试覆盖标签或发布同一个版本。
2. 在 npm 上废弃这个坏版本：
   ```bash
   npm deprecate explodex@X.Y.Z "Version contains issues, please use X.Y.Z+1"
   ```
3. 带着修正发布一个新的补丁版本（例如 `X.Y.Z+1`）。

### 场景 D：发布被攻破
如果某次发布被攻破（例如泄露了密钥或访问权限有误）：
1. 立即通过 npm 源废弃或吊销该版本。
2. 绝不复用或覆盖该标签。创建一个安全的新版本。

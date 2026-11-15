# GitHub Actions 与 GitHub Pages

工作流位于仓库根目录 `.github/workflows/ci-pages.yml`。

## 触发与发布

- 指向 `master` 的 PR：安装锁定依赖、工程检查、TypeScript 检查、单元测试、部署校验器测试、Pages 构建和产物校验；不发布站点。
- 合并或推送到 `master`：执行相同检查，成功后部署同一份产物到 GitHub Pages，并校验线上文件。
- Actions 页面的 **Run workflow** 可手动重跑；只有选择 `master` 才会发布。
- 同一 PR 的新提交取消旧检查；`master` 正在执行的部署不会被新提交取消。

站点：https://haohao-0407.github.io/tiangongtest/

Node 固定为 `24.15.0`，pnpm 从 `game/package.json` 的 `packageManager` 读取，引擎由锁文件固定。Actions 固定到官方提交 SHA。缓存仅保存 pnpm store，构建不依赖本机 SDK、Windows 启动器或手动配置的 Secret。

GitHub 仓库 **Settings → Pages → Source** 必须选择 **GitHub Actions**。工作流只给部署任务授予 `pages: write` 与 `id-token: write`。如设置分支保护，可将 `validate-build` 设为必需检查。

## 校验范围

构建使用 `--base /tiangongtest/`，不能使用默认根路径 `/`。部署到自定义域名根目录时，需要同步修改工作流的 `PAGES_BASE_PATH`。

`tools/verify-pages.mjs` 检查分发清单、文件大小与 SHA-256、HTML 资源路径。部署后以本次构建为基准，检查线上清单及所有声明文件，避免把旧版本、404 页面或缺失资源误判为成功。`web-dist` 构建产物保留 7 天，可从 Actions 下载。

基础 CI 不运行 WebGPU 浏览器回归。资源校验成功不等同于画面、输入和存读档验收；现有 `game/scripts/*-playthrough.mjs` 仍用于引擎浏览器验收。Pages 的响应头可能与本地预览不同，发布首次启用或升级引擎时应另行验证线上试玩。

## 本地检查

从仓库根目录执行，确保使用项目声明的 pnpm 版本：

```sh
pnpm --dir game install --frozen-lockfile
pnpm --dir game exec forgeax project check --json
pnpm --dir game typecheck
pnpm --dir game test
node --test tools/verify-pages.test.mjs
pnpm --dir game exec forgeax project build --base /tiangongtest/ --json
node tools/verify-pages.mjs --dist game/dist --base /tiangongtest/
```

## 故障处理与回滚

- 安装失败：核对 `package.json`、`pnpm-lock.yaml` 与 `pnpm-workspace.yaml` 一起提交；不要在 CI 中关闭冻结锁文件来绕过错误。
- 部署权限失败：检查 Pages 来源、`github-pages` 环境分支限制与仓库套餐。
- 部署后资源校验失败：查看具体 URL 与摘要错误，确认构建 base 和 CDN 更新；在 Actions 中重跑失败任务可重新部署并校验。
- 回滚：通过 PR revert 出问题的提交并合入 `master`，工作流会重新构建和发布回滚后的版本。

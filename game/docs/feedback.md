# Engine / SDK feedback

- 2026-11-14 / Engine 0.5.0 升级：官方 MCP 插件 0.4.2 的 `forgeax_run_current_game` 仍返回 `engine_release_mismatch: game declares @forgeax/engine=0.5.0, expected 0.4.8`。插件未发布匹配版本，保留原插件配置；0.5.0 的检查与浏览器验收使用项目安装的同版本官方 CLI，不能声称 MCP Preview 已通过。

- 2026-11-14 / Engine 0.5.0 官方依赖：`pnpm peers check` 报告 DeepSeek Harness 的 `dsh-agent`、`dsh-llm`、`dsh-session` 安装为 `0.1.0-rc.6`，而部分 `dsh-user-approval`、`dsh-tools`、`dsh-system-prompt` 依赖要求 `^0.1.0-rc.8`。未改写引擎随包依赖或添加覆盖；项目 TypeScript、105 项测试和浏览器构建通过。该警告不等于这些 Harness 功能已验证，游戏运行证据单独记录在 `validation.md`。

- 2026-11-14 / ForgeAX MCP 插件：`forgeax_run_current_game({target_dir:'D:\\tiangongtest\\game'})` 返回 `engine_release_mismatch`，插件要求 Engine 0.4.8，当前游戏声明并安装 0.4.19。使用项目已安装的 0.4.19 官方 CLI 完成 `project check/test/play` 和 `dev status/look`，没有降级游戏或替换 SDK；MCP Preview 调用本身未成功。

- 2026-11-11 / SDK View 0.4.19 / Windows 普通账户：独立 View Host 启动在 `engine-devkit/backend` 对 `compiled/node_modules` 调用 `symlink(..., 'dir')` 时返回 EPERM。使用工作区 `tools/forgeax-view-windows.cjs` 的启动进程级兼容处理，只对指定 View 依赖和指定 workspace 下 `session-*/compiled/node_modules` 的 EPERM 回退为 Windows junction；SDK 文件及系统开发者模式均不修改。实际 backend 已返回 ready，原始错误保留在 D 盘临时目录的 backend.log。

- 2026-11-11 / SDK 0.4.19 / pnpm 12.15.0：模板没有声明 `packages`，pnpm 安装记录默认为 `["."]`，而 `project check` 的依赖闭包检查把省略配置当作 `[]`，返回 `project-pnpm-workspace-state-stale`。在源码 `pnpm-workspace.yaml` 显式声明唯一根包 `packages: ['.']`，与实际单包工程保持一致；不修改安装记录或 SDK。

- 2026-11-10 / SDK 0.4.19 / Windows：`project new D:\tiangongtest --template game-3d --json` 在空的现有工作目录返回 `project-create-failed`, reason `EPERM: operation not permitted, mkdir 'D:\'`。同一官方命令以 `D:\tiangongtest\game` 为目标成功。采用工作区内子目录，未修改 SDK。

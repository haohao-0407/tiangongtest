# Engine / SDK feedback

- 2026-11-11 / SDK View 0.4.19 / Windows 普通账户：独立 View Host 启动在 `engine-devkit/backend` 对 `compiled/node_modules` 调用 `symlink(..., 'dir')` 时返回 EPERM。使用工作区 `tools/forgeax-view-windows.cjs` 的启动进程级兼容处理，只对指定 View 依赖和指定 workspace 下 `session-*/compiled/node_modules` 的 EPERM 回退为 Windows junction；SDK 文件及系统开发者模式均不修改。实际 backend 已返回 ready，原始错误保留在 D 盘临时目录的 backend.log。

- 2026-11-11 / SDK 0.4.19 / pnpm 12.15.0：模板没有声明 `packages`，pnpm 安装记录默认为 `["."]`，而 `project check` 的依赖闭包检查把省略配置当作 `[]`，返回 `project-pnpm-workspace-state-stale`。在源码 `pnpm-workspace.yaml` 显式声明唯一根包 `packages: ['.']`，与实际单包工程保持一致；不修改安装记录或 SDK。

- 2026-11-10 / SDK 0.4.19 / Windows：`project new D:\tiangongtest --template game-3d --json` 在空的现有工作目录返回 `project-create-failed`, reason `EPERM: operation not permitted, mkdir 'D:\'`。同一官方命令以 `D:\tiangongtest\game` 为目标成功。采用工作区内子目录，未修改 SDK。

# ForgeAX Engine 0.5.0 团队安装包

这是基于 `@forgeax/game@0.4.2` 的本地兼容版，版本标识为
`0.4.2-engine.0.5.0.local.1`（补丁修订 3），不是官方发布的新版本。

## 队友安装

1. 安装带 npm 的 Node.js 22.13 或更新版本，并确认终端能运行 `node --version`。
2. 将本包解压到一个长期保留的目录，例如 `D:\Tools\ForgeAX-0.5.0-team-kit`。
3. 双击 `install.cmd`，等依赖安装和 MCP 握手完成，然后完全退出并重新打开 Codex。

首次安装需要联网下载固定版本的 npm 依赖。脚本从官方 npm 包恢复插件，核对原始文件
SHA-256 和 SDK 包完整性，应用适配，再通过原安装器向本人的 Codex 注册 MCP。
安装依赖保存在解压目录下的 `.launcher/`，不要在安装完成后移动或删除该目录。

如需同时为已有 Engine 0.5.0 游戏安装插件指南，在解压目录的终端运行：

```powershell
.\install.cmd --project "D:\Projects\MyGame"
```

`--project` 必须指向包含 `forge.json`、`package.json` 的实际游戏目录；项目需要精确声明
`@forgeax/engine: "0.5.0"`。本安装包不会自动安装或升级游戏本身的依赖。若项目布局和
本仓库相同，应传入仓库内的 `game` 子目录。

没有传 `--project` 时只注册 MCP；后续仍可在 Codex 中指定游戏目录。纯 Node 命令等价为：

```powershell
node .\tools\forgeax-plugin-0.5.0.mjs install --project "D:\Projects\MyGame"
```

安装会更新本人 Codex 配置中的 `mcp_servers.forgeax`，原配置由安装器自动备份。
不需要共享任何人的 `.codex/config.toml`、账号、密钥或 npm token。

## 检查安装

游戏依赖已按项目说明安装后，可在解压目录运行：

```powershell
node .\tools\forgeax-plugin-0.5.0.mjs verify --project "D:\Projects\MyGame"
```

应看到 Engine 0.5.0，源码提交为 `9e2cad3cfea08269cb30e21beb0a0cce1b323722`。
如需执行真实 MCP 构建、Preview 启动和复用检查：

```powershell
node .\tools\forgeax-plugin-0.5.0.mjs verify --run --project "D:\Projects\MyGame"
```

验证结束会关闭测试创建的 Preview。启动游戏仍可直接在 Codex 中提出请求，并明确游戏目录。
安装/验证输出和本地记录保存在解压目录的 `.launcher/` 中。

## 兼容范围与维护

- 核心 stdio MCP：项目状态、精确 Engine 构建、Preview 启动、复用与退出清理。
- 保留版本、源码提交、SDK、pnpm、构建摘要与进程身份校验，仍拒绝 Engine 0.4.8。
- 已在 Windows x64 验证；其他操作系统未验收。可选原生 View、扩展面板及云资产服务未验收。
- 请勿对这个未发布的本地版本执行插件 `update`，也不要使用不固定版本的
  `npx -y @forgeax/game install` 覆盖此配置。需要重新注册时再次运行 `install.cmd`。
- 本包不需要另行克隆 Engine 源码；运行使用固定的已发布 Engine/SDK 0.5.0。

插件和 SDK 依赖分别来自上游公开 npm 包；原始许可随下载的依赖保留。本包只是团队适配
安装工具，不代表官方发布或官方对全部功能的兼容承诺。

本包包含安装器、固定依赖锁文件、说明及文件校验值。直接把整个 ZIP 和旁边的
`.zip.sha256` 校验文件发给队友即可；不要把安装后的 `.launcher/` 或个人 Codex 配置打包。

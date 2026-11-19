# ForgeAX 插件的 Engine 0.5.0 本地适配

本机使用 `@forgeax/game@0.4.2` 的独立本地副本，版本标识为
`0.4.2-engine.0.5.0.local.1`。这不是官方发布的新版本；官方 npm 插件仍固定使用
Engine/SDK 0.4.8。游戏继续使用已发布的 Engine 0.5.0，未改动玩法代码或游戏依赖。

## 安装与文件位置

在仓库根目录运行：

```powershell
node tools/forgeax-plugin-0.5.0.mjs prepare
node tools/forgeax-plugin-0.5.0.mjs bind
node .launcher/forgeax-plugin-0.5.0/node_modules/@forgeax/game/dist/main.js install --ide codex --local
```

首次 `prepare` 下载官方插件、SDK 与工具依赖，缓存和安装目录均在仓库的
`.launcher/` 下。脚本检查原插件 SHA-256、SDK 包完整性及版本清单，再生成补丁；
遇到未知文件内容会停止。`bind` 仅安装插件自己的 Codex Skill 并追加托管路由块，
保留已有 Engine Skill junction。安装命令应在仓库根目录执行，避免安装器重新复制所有
Engine Skills。

Codex 的用户配置中，`mcp_servers.forgeax` 指向本地副本的 `dist/main.js`，由本机
Node 启动。原配置自动备份为 `~/.codex/config.toml.bak.latest`。需要重启 Codex，
让后续会话启动新的 MCP 进程；当前会话已连接的旧工具不会自动更换。

不要对这个本地版本运行插件的 `update` 命令：该命令会生成 npm 启动项，而这个版本
没有发布到 npm。重新配置时使用上述 `install --ide codex --local` 命令。

本地记录：

- `.launcher/forgeax-plugin-0.5.0/compatibility.json`：原始/修改后文件摘要和精确版本绑定。
- `.launcher/forgeax-plugin-0.5.0/main.upstream.js`：未修改的原始入口。
- `.launcher/forgeax-plugin-0.5.0/verification.json`：真实 MCP 构建及 Preview 验证结果。
- 游戏 `.forgeax/run/engine-preview/`：插件拥有的 Preview 状态及日志，不提交 Git。

这些运行文件随本机保留，不提交仓库；恢复其他机器时重新运行脚本。

## 团队分享

队友可以使用轻量联网安装包，说明源文件在 `tools/forgeax-team/README.md`。
该包只包含安装脚本、固定 npm 锁文件和说明，不包含个人配置、密钥或运行日志。
解压到固定目录后双击 `install.cmd`，或运行：

```powershell
node tools/forgeax-plugin-0.5.0.mjs install --project "D:\Projects\MyGame"
```

项目路径按每个人的实际目录填写。安装器在本人的机器上生成正确的 Node 和插件绝对路径，
不依赖原作者的盘符，也无需克隆 Engine 源码。首次安装用随包锁文件执行 `npm ci`。
本仓库也可以直接使用同一条命令，`--project` 指向实际 `game` 子目录。

## 修改范围

| 项目 | 原版 | 本地适配 |
|:--|:--|:--|
| Engine / SDK | 0.4.8 | 0.5.0 |
| Engine 源码提交 | `70caac9757c894947fb233825a057c23496be6d6` | `9e2cad3cfea08269cb30e21beb0a0cce1b323722` |
| SDK 清单 schema | 1.9.0 | 1.11.0 |
| pnpm | 12.10.1 | 12.15.0 |
| Windows Preview 进程身份 | 仅 Linux `/proc` 与 Unix `ps` | Windows 查询进程启动时间 UTC ticks |
| Windows Engine Skill 识别 | 跳过 junction | 识别指向现有 Skill 的 junction |

同时更新插件依赖清单、内嵌版本信息、SDK 包完整性与 SDK 清单摘要。保留所有精确版本、
源码提交、构建摘要、进程启动身份、健康检查及 Preview 归属校验；不放宽为任意版本兼容。
原插件 `D:\zaohua\.tools\forgeax-game-0.4.2` 保留。

用户克隆的 `D:\forgeax-engine` 从 `forgeax-export.json` 看属于
`0.6.0-dev.16823.d4d4fc2f5389` 开发快照。该目录未修改，也不作为这个 0.5.0 适配版的运行依赖。

## 验证

```powershell
node tools/forgeax-plugin-0.5.0.mjs verify --run
```

验证启动真实 stdio MCP 服务，检查握手、四个工具、两个资源、0.5.0 发布身份与当前项目
状态；用临时旧版项目确认 0.4.8 仍被拒绝，再通过 `forgeax_run_current_game` 构建真实游戏，
检查 Preview 的 root、commit、build digest、instance 和复用结果。测试 MCP 退出时会停止
它创建的 Preview，不应把记录中的临时 URL 当作长期运行地址。

受限 Windows 沙盒可能阻止 Node 的 `realpath.native`；本机已在普通 Windows 权限下验证。
这份适配验证的是核心 MCP 状态、构建和 Preview 生命周期；未重新进行玩法浏览器验收，
也未验证可选原生 View、业务扩展面板或云端图片/模型生成服务。

## 回退

在仓库根目录运行原插件安装命令，只将 Codex 的 ForgeAX 启动项恢复为原路径：

```powershell
node D:/zaohua/.tools/forgeax-game-0.4.2/node_modules/@forgeax/game/dist/main.js install --ide codex --local
```

随后重启 Codex。回退后旧插件仍要求 Engine 0.4.8，当前游戏可继续由项目官方 0.5.0 CLI
和既有启动器运行。无需删除本地适配目录，也不必恢复整份用户配置。

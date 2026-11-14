# 森屿 · 和平殖民地

天工引擎 0.4.19 的单机 3D 体素殖民地经营原型。围绕居民、劳动、建设和农业展开，不包含战斗。

## 路径说明

| 项 | 位置 |
|:--|:--|
| 游戏工程 | 本文件同级的 `game/`（相对路径，换机器不用改） |
| 引擎依赖 | `@forgeax/engine@0.4.19`，由 pnpm 从 npm 安装 |
| 可选缓存目录 | `D:\tiangong-tools`（有则复用、省 C 盘；没有就用系统默认，不影响运行） |

## 开始

**Windows 直接双击**：`启动游戏.bat`

**命令行**：

```powershell
.\Start-Game.ps1
```

**只做环境自检**（不开游戏）：

```powershell
.\Start-Game.ps1 -Check
```

> 第一次拉取后需要先在 `game/` 下跑一次 `pnpm install`。
> 关掉终端窗口 = 关掉游戏，这是天工引擎的设计。

## 文档

| 文档 | 内容 |
|:--|:--|
| [CONTRIBUTING.md](CONTRIBUTING.md) | **团队 git 协作规则**：怎么拉、怎么推、别碰什么 |
| [game/README.md](game/README.md) | 游戏玩法说明 |
| [game/docs/](game/docs/) | 设计文档（实现细节、范围、验收） |
| [game/AGENTS.md](game/AGENTS.md) | 天工引擎官方**开发规范**（怎么写代码），由 SDK 提供 |

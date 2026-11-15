# 协作规则（给 AI 读）

> 这份文件是给**负责执行 git 操作的 AI** 看的。
> 人类可以只看「快速版」。
>
> **注意和 `game/AGENTS.md` 的区别**：
> - `game/AGENTS.md` = 天工引擎官方的**开发规范**（怎么写代码），由 SDK 提供，不要改
> - **本文件（根目录 `CONTRIBUTING.md`）= 团队的 git 协作规则**（怎么拉、怎么推、别碰什么）
>
> 两者说的是不同的事，不冲突，但不要互相混淆。
>
> 最后更新：2026-11-14

---

## 快速版（给人看）

```powershell
# 拉取
git pull
.\Start-Game.ps1 -Repair   # 首次拉取、依赖变动或安装异常时使用

# 推送
git checkout -b feature/你的名字
git add -A && git commit -m "改了什么"
git push -u origin feature/xxx
# 然后在 GitHub 开 PR
```

**不要直接推 master，不要改 `Start-Game.ps1` 里的路径，不要提交 `node_modules`。**

---

## 1. 仓库是什么

天工引擎 0.5.0 的 TypeScript 工程，**共享仓库**（多人 + 多个 AI 同时在用）。

```
tiangongtest\
├── Start-Game.ps1       启动脚本（已改成跨机器自适应，勿改回写死路径）
├── 启动游戏.bat          双击入口
├── AGENTS.md            本文件
├── game\                工程根（forge.json 在这）
│   ├── assets\          源码（colony / voxel / ui / shared）
│   ├── docs\            设计文档
│   ├── skills\          引擎技能集（SDK 提供，勿改）
│   └── node_modules\    ← 不入库，每人本地装
├── tools\
└── view-workspace\      运行时产物（不入库）
```

**关键**：`game/node_modules` **不在 git 里**。首次启动会自动安装所需依赖；开发前也可用 `.\Start-Game.ps1 -Repair` 安装并自检。

---

## 2. 拉取（pull）

```powershell
cd <仓库根>
git pull

# 首次拉取、pnpm-lock.yaml 或 dependencies 变动时：
.\Start-Game.ps1 -Repair
```

**验证环境是否正常**：

```powershell
.\Start-Game.ps1 -Check
```

看到“自检通过”且退出码为 0，说明环境与工程检查通过。自检不自动修复依赖，也不等同于游戏画面或玩法验收；缺少依赖时按提示执行 `-Repair`。

### 拉取后必须做的事

| 检查项 | 命令 | 期望 |
|:--|:--|:--|
| 环境自检 | `.\Start-Game.ps1 -Check` | 显示“自检通过”，退出码 0 |
| 类型检查 | `cd game; pnpm exec tsc --noEmit` | 无输出 |
| 单元测试 | `cd game; pnpm test` | 全绿 |

启动器显示阶段进度和错误原因，并把原始输出保存在 `.launcher/`。手动执行 `pnpm` 命令前，先确认 `pnpm --version` 与 `game/package.json` 的 `packageManager` 一致；启动器会自行选择准确版本，不使用碰巧排在 PATH 最前面的其他版本。

---

## 3. 推送（push）

### 必须开分支

```bash
git checkout -b feature/<简短描述>
# 例：feature/food-icons、fix/drag-ghost
```

**永远不要直接往 master 推。** 理由：

- 同事拉到一半的改动会冲突
- 没有评审环节
- 出问题要回滚整个 master

### 提交前自检

```bash
git status --short
```

**看到以下内容说明有问题，先修**：

| 不该出现的 | 原因 |
|:--|:--|
| `node_modules/` | 依赖不入库 |
| `dist/` | 构建产物 |
| `game/.tmp-tests/` | 临时文件 |
| `.launcher/` | 本机启动日志、工具链与缓存 |
| `view-workspace/.forgeax/` | 运行时产物 |
| `*.log`、`.DS_Store` | 垃圾文件 |

### 推送

```bash
git add -A
git commit -m "简短说明改了什么"
git push -u origin feature/<分支名>
```

然后在 GitHub 开 PR 合到 master。

---

## 4. 绝对不要做的事

| 禁止 | 原因 |
|:--|:--|
| **把启动脚本或 `.npmrc` 改回固定盘符路径** | 其他机器无法复用；使用工程相对路径或本机配置 |
| **手改 `dist/` 里的文件** | 构建产物，下次构建就被覆盖 |
| **手改 GUID** | GUID 由 `guidText(packageId, assetKey)` 推导，改了就全断 |
| **手动编辑 `package.json` 的 dependencies** | 用 `pnpm add <name>`，否则 frozen lockfile 会拒绝 |
| **提交 `game/node_modules/`** | 645MB，且 pnpm 用绝对路径软链，换机器就废 |
| **改 `game/skills/` 下的文件** | SDK 提供的文档，升级 SDK 时会被覆盖 |
| **改 `game/AGENTS.md`** | 引擎官方指南，同上 |

---

## 5. 环境要求

| 项 | 要求 | 说明 |
|:--|:--|:--|
| Node.js | ≥ 22.13 | 启动器实际读取版本；可用系统安装或 WorkBuddy 自带版本 |
| pnpm | 由 `packageManager` 字段决定（当前 12.15.0） | 启动器通过 Corepack 选择准确版本；没有 Corepack 时用 npm 安装到本仓库，不做全局安装 |
| 引擎依赖 | `@forgeax/engine@0.5.0` | 从 npm 装，**版本必须严格对齐**（`frozenLockfile: true`） |
| 配套 SDK 工具 | `.launcher/forgeax-sdk-0.5.0/` | 本机安装，不提交 Git；与引擎保持同一版本 |
| 启动数据目录 | 本仓库 `.launcher/` | 默认存放日志、临时文件、Corepack 和 pnpm 缓存；已有 `COREPACK_HOME` 设置会保留 |

`game/.npmrc` 使用相对路径 `../.launcher/pnpm-store` 和 `../.launcher/npm-cache`，使手动安装与启动器使用相同缓存位置。首次准备工具或下载依赖需要联网。

启动器从 `game/package.json` 自动选择 pnpm 并校验引擎，CLI 从项目已安装的引擎包定位，不依赖固定 SDK 盘符路径。当前 ForgeAX MCP 插件 `0.4.2` 仍要求引擎 `0.4.8`，不会用于 `0.5.0` 的验收；检查、构建与浏览器验收使用项目的准确版本官方 CLI。升级本身不代表验证通过，结果另记在 `game/docs/validation.md`。

### 启动脚本怎么找 node

`Start-Game.ps1` 按顺序探测，选择实际可运行且版本合格的 Node：

1. 显式 `-NodePath`，其次是 `GAME_NODE_PATH`；指定路径无效会直接报错
2. 系统 PATH 与常见安装位置（包括 NVM、Volta）
3. `%USERPROFILE%\.workbuddy\binaries\node\versions\current` 指向的目录
4. WorkBuddy 其他版本目录，按版本号从高到低尝试

**所以不要往脚本里写死 node 路径。**

---

## 6. 已知的坑（实测踩过）

### PowerShell 脚本里的中文会炸

`.ps1` 文件如果含中文，**必须存成 UTF-8 with BOM**。PowerShell 5.1 按 GBK 解析 UTF-8 无 BOM 的文件，直接报语法错误。

修法：

```powershell
$p = '某个.ps1'
$s = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllText($p, $s, (New-Object System.Text.UTF8Encoding($true)))
```

### 游戏会话与启动窗口

此前在 ForgeAX 0.4.19 上确认过：引擎会创建独立后台服务，正常 Windows 环境下，启动命令退出不代表游戏停止；沙箱或其他进程管理环境可能另行回收子进程。升级后应以当前版本的 `dev status` 确认会话状态。

用户双击 `启动游戏.bat` 启动即可。正常会话会复用，失败或浏览器已断开的等待会话会恢复；不要在每次启动前无条件 `dev stop`。显式停止使用 `.\Start-Game.ps1 -Stop`，强制重启使用 `-Restart`。

启动器每个阶段默认等待最多 180 秒，可通过 `-TimeoutSeconds 600` 延长。`-NoBrowser` 用于不显示浏览器窗口的验证。失败返回非零退出码，双击入口会保留错误；按提示查看 `.launcher/` 下的日志。

### 构建时的批量删除保护

`forgeax project build` 会删 `dist` 里的中间文件。如果执行环境有“单次删除超过 N 个文件需确认”的保护，会看到：

```
[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] count:50
```

**这不是工程问题**。清空 `dist/` 后重试，或者让用户在自己的终端跑。

### 依赖装得快不快，看缓存

`pnpm install` 的输出里，`reused` 高就是命中缓存：

```
resolved 190, reused 189, downloaded 0   ← 22 秒
resolved 190, reused 0,   downloaded 190 ← 要好几分钟
```

---

## 7. 给 AI 的额外提醒

- **改之前先读**：`game/docs/implementation.md` 讲设计意图，`game/assets/colony/` 是核心逻辑
- **改完必须验证**：不要只说“改好了”。跑 `-Check`、`tsc --noEmit`、`pnpm test`，把结果贴出来
- **不确定就问**：参数、数值、手感归策划定，AI 只负责把功能装上
- **一次只改一件事**：多个改动混在一个 commit 里，出问题没法定位

---

## 8. 如果拉取后跑不起来

按这个顺序排查：

1. 运行 `.\Start-Game.ps1 -Check`，阅读错误和输出的日志位置。
2. 提示缺少或不匹配的依赖时，运行 `.\Start-Game.ps1 -Repair`；不要手动改锁文件。
3. 提示 Node 不可用时，安装 Node.js 22.13 或更新版本，或使用 `-NodePath` 指定。
4. 下载超时时检查网络，必要时加 `-TimeoutSeconds 600`；已有会话异常时用 `-Restart`。
5. 仍失败时保留 `.launcher/` 中对应日志，并说明失败阶段；不要只反馈“窗口没反应”。

# 协作规则（给 AI 读）

> 这份文件是给**负责执行 git 操作的 AI** 看的。
> 人类可以只看「快速版」。
> 最后更新：2026-11-14

---

## 快速版（给人看）

```bash
# 拉取
git pull
cd game && pnpm install     # 只有首次或 lockfile 变了才需要

# 推送
git checkout -b feature/你的名字
git add -A && git commit -m "改了什么"
git push -u origin feature/xxx
# 然后在 GitHub 开 PR
```

**不要直接推 master，不要改 `Start-Game.ps1` 里的路径，不要提交 `node_modules`。**

---

## 1. 仓库是什么

天工引擎 0.4.19 的 TypeScript 工程，**共享仓库**（多人 + 多个 AI 同时在用）。

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

**关键**：`game/node_modules` **不在 git 里**。任何人拉取后都要自己 `pnpm install` 一次。

---

## 2. 拉取（pull）

```bash
cd <仓库根>
git pull

# 只有以下情况才需要重新装依赖：
#   - 第一次拉这个仓库
#   - pnpm-lock.yaml 变了
#   - package.json 的 dependencies 变了
cd game
pnpm install
```

**验证环境是否正常**：

```powershell
.\Start-Game.ps1 -Check
```

看到 `{"ok":true,...}` 就说明能跑。**不要**靠“看起来没报错”判断。

### 拉取后必须做的事

| 检查项 | 命令 | 期望 |
|:--|:--|:--|
| 环境自检 | `.\Start-Game.ps1 -Check` | `ok: true` |
| 类型检查 | `cd game; pnpm exec tsc --noEmit` | 无输出 |
| 单元测试 | `cd game; pnpm test` | 全绿 |

**注意**：`.\Start-Game.ps1` 输出的是 JSON，那是给工具读的，不是给人看的。

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
| **把 `Start-Game.ps1` 的路径改回 `D:\tiangong-tools` 写死** | 只有那台机器能跑，其他人全部报错。**这个坑已经踩过一次** |
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
| Node.js | ≥ 22.13 | 本机可用 WorkBuddy 自带的私有 node |
| pnpm | 由 `packageManager` 字段决定（当前 12.15.0） | 用 `corepack enable` 或直接调 pnpm |
| SDK | `@forgeax/engine@0.4.19` | 从 npm 装，**版本必须严格对齐**（`frozenLockfile: true`） |
| 可选缓存目录 | `D:\tiangong-tools` | 存在就用，不存在跳过，**功能不受影响** |

### 启动脚本怎么找 node

`Start-Game.ps1` 按顺序探测，读到第一个就停：

1. 系统 PATH 里的 `node`
2. `%USERPROFILE%\.workbuddy\binaries\node\versions\current` 指向的目录
3. 上面目录下版本号最大的那个

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

### dev server 随终端关闭

`forgeax dev start` 起的浏览器是**这条命令的子进程**。命令结束（或终端关闭），浏览器就关。

**AI 不要试图在后台起服务然后让用户用** —— 活不过一轮对话。要长期运行，让用户自己双击 `启动游戏.bat`。

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

1. `.\Start-Game.ps1 -Check` 报什么错？
2. `cd game; ls node_modules` —— 有没有装依赖？
3. `node -v` —— 版本够不够 22.13？
4. `cd game; pnpm install` —— 重装一次试试
5. 还是不行，看 `game/docs/` 里有没有环境说明，或者问人

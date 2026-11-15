# 自动代码审查 agent

使用 OpenAI Agents API 的托管环境读取变更材料，对引入的、可定位的 P1/P2 问题生成中文意见。不批准或合并 PR。

| 工作流 | 触发 | 结果位置 |
| --- | --- | --- |
| [`AI PR Review`](../../.github/workflows/pr-review.yml) | 目标为 `master` 的 PR，或维护者手动触发 | PR 中的一条机器人评论，随提交更新 |
| [`AI Master Review`](../../.github/workflows/push-review.yml) | 推送到 `master`，包括直接推送和 PR 合并 | 对应 Actions run 的 Summary 和 `master-review-*` 报告附件 |

## 启用

1. 将本目录及 `.github/workflows/pr-review.yml`、`.github/workflows/push-review.yml` 合入 `master`。
2. 在仓库 **Settings → Secrets and variables → Actions** 中配置 `OPENAI_API_KEY` Secret。不要使用普通 repository variable，不要提交 `.env.local`。
3. Actions → **AI PR Review** → **Run workflow**，保持 `pr_number` 为空，验证真实 API 权限与托管环境文件读取；填入开放 PR 编号可手动审查。
4. 以后仓库成员/协作者在本仓库分支发起、目标为 `master` 的 PR 新建、更新、编辑、重新打开或转为可审查状态时自动运行，草稿跳过；同一 head/base/目标分支已有成功审查时避免重复计费。外部 fork 的 PR 由维护者使用上述 **Run workflow** 手动触发，避免任何外部账号都能触发付费调用。
5. `push-review.yml` 合入后，每次推送到 `master` 自动运行 **AI Master Review**。一次推送中的多个提交合并为一次审查；PR 合并前后分别运行 PR 审查和推送审查。

推送审查固定比较事件的 `before` 与 `after`，包含这次推送的完整净差异。控制器检出该事件的 SHA，每次推送独立运行；后来又有推送不会改变早先任务的取材范围或覆盖其报告。Markdown 报告展示在 Summary，同时与记录提交、模型、强度、覆盖范围和 findings 的 JSON 一起保存为附件，保留 14 天。工作流成功表示审查流程完成，是否发现问题请查看报告中的 P1/P2 findings。

两端 Git 对象必须可读；例如强制推送后旧对象无法取得时，工作流明确失败，不改用其他比较范围。首次创建分支、没有可比较的 `before` 时明确标记跳过；分支删除不运行审查。GitHub 对平台事件有限制：使用仓库 `GITHUB_TOKEN` 自身产生的推送不会再触发 push 工作流；需要这类机器人提交触发审查时，应使用获授权的 GitHub App 或 PAT。

首次安装 PR 的 base 尚无审查程序，因此该 PR 的自动审查步骤会显示未安装提示并跳过；独立 CI 仍测试新的实现。合入后新的 PR 正常触发。

Dependabot 和外部 fork 的 PR 使用维护者手动触发。有合并冲突的 PR 需要先解决冲突，GitHub 才会触发 `pull_request` 工作流；也可手动审查当前材料。

默认模型为官方 quickstart 的 `gpt-6-astra`，可使用 repository variable `OPENAI_REVIEW_MODEL` 指定当前 OpenAI 项目有权使用的模型。密钥需要 Agents API 和 Responses API 权限；创建密钥不代表项目已具备托管环境访问权限。实际运行会消耗该项目的 API 额度。

思考强度通过 repository variable `OPENAI_REVIEW_REASONING_EFFORT` 设置，支持 `low`、`medium`、`high`、`xhigh`、`max`，未设置或留空时默认为 `high`。入口是仓库 **Settings → Secrets and variables → Actions → Variables → New repository variable**。模型和强度是普通变量；API 密钥仍放在 Secrets。PR 审查、master 推送审查与 API smoke 检查都会把该值传给 `agent.reasoning.effort`，运行日志会显示生效的强度。非法值在 API 请求前报错。

强度配置影响下一次实际调用；同一 head/base/目标分支已经完成的审查仍按原规则跳过，修改变量不会自动发起新审查。较高强度通常增加耗时和 token 消耗；现有正式审查超时仍为 8 分钟，smoke 检查为 3 分钟。更换模型时需确保新模型支持选定档位。

本次创建的密钥有效期为 **30 天**。到期前需要轮换本机 `.env.local` 和 GitHub Actions Secret；本程序不会自动新建密钥。

## 本地命令

Node.js 22 或更新版本，在仓库根目录运行：

```powershell
npm --prefix tools/pr-review ci --ignore-scripts --no-audit --no-fund
npm --prefix tools/pr-review test
node --env-file=.env.local tools/pr-review/review.mjs --smoke
```

本地可在执行命令前设置 `$env:OPENAI_REVIEW_REASONING_EFFORT = 'xhigh'`；不设置时同样默认 `high`。

对真实 PR 的本地预览需要已经配置的 `GITHUB_TOKEN`（不在命令行写令牌）；`--dry-run` 仍然调用付费 OpenAI API，但不发表评论：

```powershell
$env:GITHUB_REPOSITORY = 'haohao-0407/tiangongtest'
$env:PR_NUMBER = '123'
node --env-file=.env.local tools/pr-review/review.mjs --dry-run --output tools/pr-review/output/review.md
```

`output/`、`node_modules/` 和根目录 `.env.local` 均被 Git 忽略。

## 审查范围与隔离

- 优先检查保存兼容性、多格门/床占用、碰撞与寻路、房间围合、资源核算、插件清理和 Pages 路径等实际回归。纯格式偏好不列为问题。
- 工作流通过 `pull_request` 响应本仓库可信协作者的 PR，并显式检出可信 base 提交中的控制器。不会检出、安装依赖或执行 PR head 中的代码；也不会运行 PR 新增的脚本。外部 fork 不自动调用 API；手动触发时也只检出默认分支中的控制器。
- master 推送工作流仅有 `contents: read` 权限，检出已进入 master 的事件提交。它用禁用外部 diff 和 textconv 的 Git 命令比较固定提交，把变更当作静态材料，不运行游戏脚本；该模式不依赖 PR，也不发表评论。
- 控制器通过固定的 GitHub API 地址获取不可变提交的源文件；PR diff 由 GitHub 提供，推送 diff 从本地 Git 的固定提交生成。标题、正文、文件、注释和文档均视为不可信审查数据。
- OpenAI 托管环境关闭网络，只收到受大小限制的审查材料；GitHub Token 和 API Key 留在控制器，不进入材料或托管环境。
- finding 的文件和行号必须属于本次变更的新增行。超过材料上限、缺失 diff、二进制文件和截断内容会作为覆盖限制披露。
- 发布前重新检查 PR head 和 base，任一提交已变化时跳过旧结果。API 失败、取消或结果不合法会使 workflow 失败，不会当作“审查通过”。
- 运行结束清理远端 session；超时先请求取消再清理。Actions 手动强制终止、主机中断等异常仍可能留下 session，日志会在能执行清理时报告未清理 ID。

这是静态审查，不等于执行了游戏测试或浏览器验收。现有 `CI and Pages` 保留独立测试和构建检查。审查 workflow 不作为合并授权；人工仍应核实意见。

## 参考

- [OpenAI Agents API quickstart](https://developers.openai.com/api/docs/guides/agents-api/quickstart)
- [OpenAI 托管环境](https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted)
- [GitHub PR workflow 触发与 fork 权限](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)
- [GitHub push 触发规则](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push)

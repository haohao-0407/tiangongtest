# Windows 启动器验证（2026-11-14）

## 问题与处理

- 旧入口实际选中了 PATH 中的 pnpm 11.25.0，而工程指定 12.15.0。正常 Windows 权限下复现 `project-pnpm-install-mismatch`，旧 PS1 仍退出 0。新版按 packageManager 启用准确版本，并传播失败退出码。
- 旧入口捕获全部 stdout、丢弃 stderr；引擎默认启动预算较长，看起来容易卡死。新版分阶段显示进度，默认每阶段 180 秒，保存原始输出到仓库 `.launcher/logs/`。
- 每次启动不再无条件停止正常会话。显式 `-Restart`，或 failed / waiting 且 bridgeConnected=false，才通过官方 `dev stop` 恢复。
- 移除固定盘符的依赖缓存配置；使用工程相对路径。没有全局安装 pnpm，没有修改游戏模拟、存档格式或引擎包。
- 完整 `project check` 在本机约 130 秒：引擎对依赖闭包执行两遍文件扫描。只在明确自检、修复和安装后执行；日常启动仍检查版本，并要求引擎完成编译且状态为 ready。

## 已完成验证

- Windows PowerShell 5.1 语法解析、UTF-8 BOM、实际 Node 版本探测。
- 中文、空格、`&` 路径传参；错误 Node 路径返回 1；子进程退出码 7 原样传播。
- `node --test tools/game-launcher.test.mjs`：10/10，通过 CLI 错误保留、超时、独占锁、失效/空锁恢复、会话恢复判定等检查。
- `Start-Game.ps1 -Repair -TimeoutSeconds 600`：锁文件安装成功，pnpm 12.15.0，完整工程自检通过。
- TypeScript 类型检查通过；原有游戏单元测试 40/40 通过。
- 实际有窗口启动到 ready；再次启动复用同一 PID、revision 和 URL，帧数持续增加，证明入口退出后服务仍在运行。
- 官方 `dev capture` 返回 rendered=true，1920×945；console/page errors 均为 0。已打开截图检查，游戏场景和界面可见。
- `Start-Game.ps1 -Stop` 成功；通过 `启动游戏.bat -Restart` 重新启动成功，返回 ready 和新会话。
- 最终重启后的官方 `dev verify --require-ui true --timeout-ms 15000 --ready-timeout-ms 0 --json` 通过：runtime verified，真实渲染 929×917，console/page errors 均为 0。已目视检查最终截图。

## 证据与边界

本机日志和截图保存在 `.launcher/`，不提交 Git。`launcher-ready.png` 及同名 JSON 为第一轮成功启动的截图和渲染报告。
最终验收截图及报告副本为 `.launcher/launcher-verified.png` 和 `.launcher/launcher-verified.png.json`。

自动恢复的状态判定有回归测试，但“人工关闭浏览器后再双击”没有完成实机验证：Computer Use 无法可靠识别受控浏览器 URL，已停止该项 UI 操作。没有把这项算作通过。

这轮针对启动器，不是新增玩法的完整回归，也未在另一台无 Node/Corepack 的电脑上测试首次安装回退路径。

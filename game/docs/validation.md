# 本地验收记录

## 2026-11-11：和平殖民地版本

- `project check` 与 `pnpm typecheck` 通过；Engine / SDK 仍为 0.4.19。
- `pnpm test`：40 / 40 通过。25 项经营模拟测试，加原来的 12 项地图、3 项网格测试。
- 经营单测涵盖暂停和倍速、存档原子校验、建造资源预留与取消、行走施工、搬运与仓储替代路径、不可达目标、饥饿与医疗休养、床铺恢复、种植收获烹饪、生产目标防超产、采集、研究、房间、电力冷藏、有限交易、季节与和平来客。
- `project play scripts/colony-playthrough.mjs` 通过：86 个记录步骤（含推进模拟的子步骤），硬件后端；控制台错误 0，页面错误 0。验证三名居民及初始设施、暂停完整冻结、1/3/6 倍速、选择/优先级/作息、鼠标蓝图与预留退款、农田仓储规划、生产目标、电力研究实际完成、居民实际施工、完整手动存档/读取/刷新恢复。
- `project play scripts/sandbox-playthrough.mjs` 通过：12 步，硬件后端；控制台错误 0，页面错误 0。验证进入沙盒暂停、透明落点、方块放拆、撤销重做、六材料、相机、种子二次确认、v2 自动保存与刷新恢复。
- 两套验收均覆盖 1280×720 和 1280×600，layout 报告为空。已目视检查初始营地、施工完成、研究、低高度视口；发现技能浮点数字过长后改为一位小数，最终试玩页面已确认显示正常。
- 最终生产构建成功；造化本地预览已加载并显示运行中的居民。iframe/provider/SDK/noRuntimeErrors/singlePageMode 基础检查 5 项通过；未执行发布。

证据：`artifacts/play/scripts/colony-playthrough/play.json`、`artifacts/play/scripts/sandbox-playthrough/play.json` 和对应目录命名截图。失败诊断保存在 `.forgeax/diag/`。

本轮修复过 UI 不支持的 file input / text-overflow、面板节流导致连续优先级点击重复旧值，以及生产、搬运、进食和交易的边界问题。JSON 导入改为受支持的文本框。沙盒首轮受到开发热更新影响后，在源码冻结状态重新完整通过。

运行证据边界：贸易、电力冷藏、房间与疾病等更深机制有纯模拟测试，但没有全部逐项用浏览器操作覆盖。当前是有明确简化的和平经营原型；不是 RimWorld 全机制还原，也未验证手机、联机或云存档。实际简化和缺项见工程 README。

以下为上一版体素底座的历史记录，不代表当前经营版本的独立验收。

## 2026-11-10：体素底座历史记录

日期：2026-11-10（Asia/Hong_Kong）。

## 环境

- Engine / SDK：stable 0.4.19，同一版本；Node 24.15.0。
- 专用启动器 pnpm 12.10.1，工程按官方 packageManager 使用 pnpm 12.15.0。
- 游戏：`D:\tiangongtest\game`。
- SDK：`D:\tiangong-tools\forgeax-sdk-0.4.19`，官方 `sdk install` 与 `project init` 成功。
- 已读取 SDK AGENTS/SDK skill、游戏 AGENTS/README、API index、CLI 与 render-pipeline Quick contract。

## 最终结果

- 官方 `project skill verify`、`project check` 通过。
- `pnpm typecheck` 通过。
- `pnpm test`：15/15 通过（12项数据逻辑，3项区块网格）。
- 官方 `project play scripts/playthrough.mjs`：硬件后端，12步通过，控制台错误0、页面错误0。
- 覆盖地形显示、半透明预览、放置、拆除、撤销/重做、六材料、相机平移/旋转/滚轮、种子重生成、自动保存、刷新恢复。
- 1280×720 / 1280×600 两个视口验收，layout报告为空。
- `dev look` 最终截图无指标告警，已人工目视检查：日光亮度正常、草木颜色鲜明、地形与背景区分清楚、暖色界面符合轻松建造主题、中央建造区域可见。
- 最终 production build 成功，造化本地试玩页已打开并显示游戏。基础 iframe/provider/SDK/noRuntimeErrors/singlePageMode 5项检查通过；未执行发布流程。

## 证据

- `artifacts/play/scripts/playthrough/play.json`
- `artifacts/play/scripts/playthrough/` 的逐项命名截图
- `artifacts/look/01-current-game.png`

初次运行发现的 UI 不支持样式、滚轮刻度解释、种子草稿被状态消息覆盖等问题已修复后重新完整验收。
当前仅电脑端单机原型；无联机/云存档/居民或农业模拟验收。

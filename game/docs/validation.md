# 本地验收记录

## 2026-11-14：结构级 16³ 体素 PCG

- `project check`、TypeScript `tsc --noEmit`、官方 `project test` 通过，共 78 / 78 项测试。新增覆盖源节点索引与存档、独立脏区、窗洞/窗框/窗台、道路边界、八级踏步、跨 tile 裁切、删除与读档清理、运行时资源释放，以及居民站在抬高道路上完成整地。
- 官方 `project play scripts/pcg-playthrough.mjs --require-ui` 通过：85 个记录步骤，12 张命名截图、2 张最终视口截图，硬件后端。通过普通导入 UI 创建无砖墙/道路节点的测试地形，再以真实鼠标搭建两格高连续砖墙、铺设高低道路及 T 型路口。
- 实际验证窗框、凸出窗台、道路两侧人行道、一格高差的八级台阶；删除 x=16 区域边界上的墙/路源格后，邻域细节更新，撤销重做可恢复。角色不跳跃走上台阶，远处体素编辑后仍可在细节路面继续行走。保存并刷新后，构件 ID、边界与计数一致，撤销历史重新开始。
- 测试场景最终生成 18 个窗面、18 个窗台、29 段人行道边界和 1 组楼梯，合计 5 个细节网格、2640 个三角形。这些是该小场景的几何统计，不代表全图满铺后的性能。
- 原有 `terrain-playthrough.mjs` 在最终代码上回归通过：143 个记录步骤，验证 250×250 地图、整地笔刷、暂停/施工、建筑完整地基和中途存读档。两套流程均覆盖 1280×720 / 1280×600；layout 报告为空，控制台错误、页面错误、输入告警均为 0。
- 已打开正式 owner 浏览器生成的墙路截图、玩家踏上台阶截图和低高度视口截图。日间细节清晰，灰色路面、浅色窗框与砖墙/草地可分辨；近景可见窗台厚度与独立踏步，界面没有盖住核心细节。实际游玩发现窄路沿落在离散脚底探点之间造成下陷，已改为整个角色 AABB 与步面范围求交，并通过回归。
- 最终 `project build` 成功。`dev status` 确认官方开发预览加载当前源码、世界健康、硬件渲染运行，网址为 `http://127.0.0.1:64110/`。`dev look` 已检查现有预览：画面及指标提示偏暗/低对比；该图没有 PCG 测试构件，细节验收以以上日间试玩截图为准。本轮没有修改原有昼夜光照。

证据：`artifacts/play/scripts/pcg-playthrough/play.json`、`artifacts/play/scripts/terrain-playthrough/play.json`、对应 PNG，以及 `artifacts/look/pcg-integration/01-current-game.png`。测试地形与玩家现有存档隔离，未替换当前地图。

范围：细节使用每源格 16×16×16 的局部微体素精度，经合并输出网格。道路目前通过沙盒材料铺设；窗玻璃保持粗墙阻挡。复杂多向高差只选一个主台阶方向，没有任意多层导航或居民铺路订单。经营墙的完成/移除与碰撞由单元测试覆盖，浏览器窗墙流程使用沙盒砖墙。

## 2026-11-14：250×250 地图、等高笔刷与建筑地基

- `project check`、TypeScript `tsc --noEmit` 通过；Engine / SDK 保持 0.4.19。
- 官方 `project test`：60 / 60 通过（16 地图、4 网格、25 经营、15 整地）。覆盖默认地图及边缘区块、旧地图兼容、真实填挖、完整建筑占地、施工前置、共享工作、冲突与取消、地形受阻、途中存读档和大计划局部更新。
- `project play scripts/terrain-playthrough.mjs --require-ui` 通过：137 个记录步骤（包含推进模拟子步骤），17 张命名截图及 2 张最终视口截图，硬件后端。实际鼠标验证 250×250、取样不产生规划、点刷挖填、矩形、多格拖刷、取消未执行工作；暂停规划不会改动实际地形。
- 通过 2×1 工作台地基抬高一层的真实流程：24 次观察到整地未完成，施工进度保持 0；居民填完两格后才建造，最后实际两格标高均为 7。中途保存、取消、读取、刷新恢复，以及完工保存刷新均通过。
- 原经营 `colony-playthrough.mjs` 回归通过（141 步）；沙盒 `sandbox-playthrough.mjs` 回归通过（12 步）。三套均覆盖 1280×720 / 1280×600，layout 报告为空，控制台错误、页面错误和输入告警均为 0。
- 最终 `project build` 成功。`dev start` / `dev status` 确认硬件预览已就绪、世界健康、渲染运行；本机预览地址为 `http://127.0.0.1:64110/`（端口以后重启可能改变）。
- 已打开并目视检查地图尺寸界面、填挖预览、多格蓝图、准备地基、完工高台和低高度工具栏截图。测试脚本修正了可选字段 `undefined` 与 JSON 省略字段的比较差异，并通过实际可见的坑底位置核对标高；没有修改游戏行为绕过验收。
- 250×250 全图计划的离线压力检查：80 次 0.25 秒模拟步平均约 0.254ms、峰值 3.05ms（包含 21 次真实地形改动）；创建整图计划约 194ms。整地覆盖层单格变化只替换一个区块网格。这些是本机 Node / 网格构造测量，不代表持续浏览器帧率或全图施工完工测试。

证据：`artifacts/play/scripts/terrain-playthrough/play.json`、`artifacts/play/scripts/colony-playthrough/play.json`、`artifacts/play/scripts/sandbox-playthrough/play.json` 及对应截图。默认 `scripts/playthrough.mjs` 指向新的整地验收。

范围：新地图默认 250×250；旧存档保持原尺寸。24 层地图的目标标高为 1–22，填挖消耗工时；没有厚岩顶、动态水流、土方库存、自动坡道或脚手架，居民仍需要可达站位。旧版兼容由数据和模拟测试覆盖，浏览器流程使用新地图。

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

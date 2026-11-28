# 任务 20 · 墙门自动朝向与混材连接

木墙、砖墙、石墙和温室墙共用 **3/8 格**厚度，墙体中心线经过地格中心。任意两种材料都可以沿直线或在拐角相接。石墙保留原石配方、粗石外观和嵌窗。建造菜单里的石墙、木门和木地板归入「结构」。

2026-11-28 本地验收通过。项目检查、类型检查、30 个测试文件的 244 项回归通过。游戏实机通过 53 步，页面和控制台错误、输入警告、布局警告均为零。[运行报告](./play.json) · [各检查点读数](./readings.json)

| 玩家操作 | 实机结果 |
| --- | --- |
| 打开建造菜单 | 石墙、木门、木地板位于「结构」，石墙图标已改为墙段。[目录](./00-structure-catalog.png) |
| 查看旧蓝图，在纵墙缺口补门 | 玩家手选 0°，预览和已放置木门显示 90°。四角分别连接各自的两条边。[缺口](./01-before-door.png) · [预览](./02-door-preview.png) · [完整矩形](./03-full-rectangle.png) |
| 取消门蓝图，再从纵墙两侧补墙 | 缺口两侧收成端头。向纵墙两侧先后补墙，依次形成 T 形和十字。[撤销](./04-cancelled.png) · [T 形](./04b-tee.png) · [十字](./04c-cross.png) |
| 在混材房间补建木门，点击石墙嵌窗与自动门 | 居民建成木门后，关门识别 42 格室内。石墙墙线上有 3 个窗组，窗体可选中，自动门沿温室墙线显示 90°。[嵌窗选取](./05-window.png) · [自动门](./06-auto-door.png) |
| 分别开关石门与木门 | 两扇门独立操作，开门后室内消失，关门后恢复 42 格。[石门开启](./07-stone-door-open.png) · [木门开启](./08-wood-door-open.png) |
| 发布拆角任务，待居民完成后保存并切档重读 | 木墙与砖墙各收成端头。读档后缺角、邻墙端头、纵向木门与 3 个窗组一致。房间沿用四邻封闭判定，单个对角缺口仍识别 42 格室内。[拆前](./09-before-demolition.png) · [拆后](./10-demolished.png) · [读档](./11-reloaded.png) |

## 连接规则

- 同标高的前后左右四格参与连接，待建和已建结构都算。独立墙段沿手选方向放置，一端有邻居时收成端头。其余情况按相邻方向组合成直线、L、T 或十字。
- 木门、石门、自动门只沿一条轴与墙相接。墙或门较多的那一轴优先，平局或孤立时沿用玩家所选方向。垂直于门轴的墙会收住端头。同一布局与摆放顺序无关。
- 存档里的方向继续表示玩家手选方向。预览、蓝图、实体和检查器从当前邻居计算显示结果。撤单和完成拆除会刷新相邻结构。已有木门和石门用原来的按钮开关，自动门沿用原有通行、供电与房间规则。
- 栅栏只读取同高、已经立起的栅栏或牧场边界门，预览会读取这些邻居。牧场门的轴由牧场内外通路决定。普通墙门与牧场边界各自成组。

## 复跑

从仓库的 `game` 目录执行。实机脚本使用游戏设置里的存读档入口载入两份固定的 32 × 32 平地场景。第一份预置待施工木墙，第二份预置混材实体。所有初始墙门的存档方向均为 0。补门、施工、撤单、拆除、门开关和检查器选取使用游戏入口。

```powershell
./node_modules/.bin/forgeax.cmd project check --json
./node_modules/.bin/tsc.cmd --noEmit
./node_modules/.bin/vitest.cmd run --reporter=dot --maxWorkers=2 --testTimeout=20000
./node_modules/.bin/forgeax.cmd project play scripts/wall-connections-playthrough.mjs --require-ui --headless true --backend auto --viewports 1280x720 --timeout-ms 600000 --json
```

实机脚本在 `artifacts/play/scripts/wall-connections-playthrough` 生成引擎截图和运行报告，在 `artifacts/wall-connections/readings.json` 记录每个检查点的建筑坐标、连接、朝向、门状态、房间面积和窗数。

## 回归判据

- 7 种墙门 × 16 种四邻组合 × 4 个手选方向，共 448 组，分别按正序和倒序读取。另查 4 × 4 种墙材组合在四个方向上均能互接，并排除斜角、不同高度、门侧和牧场边界。
- 石墙嵌窗保留原窗洞，玻璃后仍阻挡穿行。窗沿外缘从 z=8.25 随新墙面收至 z=7.9375。几何测试读取实际窗沿范围，验证 z=7.88–7.92 碰撞、z=8.1–8.2 净空，以及拆掉墙后原窗沿位置可通过。
- 既有多格建筑、开门通行、门口占用保护、房间判定、牧场门和居民推挤继续由项目回归覆盖。

[玩家原截图](./previous-blueprints.png) · [连接规则](../../assets/colony/buildings.ts) · [实机脚本](../../scripts/wall-connections-playthrough.mjs) · [墙门组合回归](../../assets/colony/__tests__/wall-connections.test.ts) · [窗台和碰撞回归](../../assets/voxel/__tests__/pcg-view.test.ts)

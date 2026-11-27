# 任务 16 · 住户窗口与插旗安排入住

2026-11-27，本地引擎在 1280 × 720 下通过 35 个步骤，留存 14 个截图检查点。页面错误、控制台错误及输入警告均为 0。项目检查、类型检查与 240 项回归测试通过。首次高并行回归中，一项矿石生成测试触及 5 秒时限，调整为两个测试进程后整套通过。[引擎报告](./play.json) · [各步房间、床位、旗帜坐标及窗口读数](./readings.json)

| 玩家操作 | 实机结果 |
| --- | --- |
| 左栏「随从」下打开「住户」 | 五人均列出。向导和裁缝待安排，另外三人未到镇。[窗口](./01-residents.png) |
| 选择向导，点击「安排入住」，移动鼠标 | 窗口收起。四间空房亮起，向导旗跟随鼠标。[预览](./02-preview.png) |
| 点击室外、缺餐桌的房间 | 分别说明围合和家具条件，允许继续选。[室外](./03-outdoor.png) · [无效房间](./04-invalid.png) |
| 在合格房内点普通地格，随后为裁缝选房 | 向导入住。裁缝点向导房时显示占用者姓名，另选空房成功。[向导落旗](./05-guide.png) · [拒绝占房](./06-occupied.png) · [两位住户](./07-tailor.png) |
| 为向导重新选房，分别按右键及 Esc | 返回住户名单，向导仍在原房。[右键取消](./08-cancel-right.png) · [Esc 取消](./09-cancel-esc.png) |
| 换房时先点裁缝房，再点第三间房 | 第一次保留原床。第二次向导迁入新房，原床重新可用。读档后两人归属及旗帜落点一致。[换房](./10-moved.png) · [读档](./11-reloaded.png) |
| 附身居民，走近裁缝并右键，下单一份布料 | 当面成交生成裁缝采购订单。[交易](./12-face-trade.png) |
| 载入缺少裁缝房餐桌的存档 | 裁缝回到待安排，旗帜消失，向导仍在原处。当面交谈回到选房页，采购订单保留。[失房](./13-lost-home.png) · [交易暂停](./14-trade-locked.png) |

## 复跑

在仓库的 `game` 目录运行。验收脚本准备 32 × 32 的测试镇，预置建筑和库存，通过模拟实际交付 6 份羊毛解锁裁缝。它将交谈居民预置在裁缝附近，最后用移除一张餐桌的存档复现失房。两人选房、取消、换房、读档、右键交谈和下单均在引擎拥有的浏览器操作。本次实机使用固定源码副本，避免共享目录的并行编辑影响打包。

```powershell
./node_modules/.bin/forgeax.cmd project play scripts/resident-housing-playthrough.mjs --require-ui --headless true --backend auto --viewports 1280x720 --timeout-ms 480000 --json
./node_modules/.bin/vitest.cmd run --reporter=dot --maxWorkers=2 --testTimeout=20000
./node_modules/.bin/tsc.cmd --noEmit
```

住户列表与地图旗帜位于 `assets/ui/resident-housing.ts`。左栏和窗口接线在 `assets/guide.ui.html`、`assets/guide.ui.css` 和 `assets/ui/build-ui.ts`。地图输入在 `assets/voxel/runtime.ts`。房间归属、落点及读档沿用 `assets/colony/simulation.ts`，快照和工具类型见 `contracts.ts`、`specialist-catalog.ts`。旧档按所住房间的床位显示名旗，玩家重新插旗后保留实际落点。[实机脚本](../../scripts/resident-housing-playthrough.mjs) · [商人与住房规则](../四位商人与集市日历.md)

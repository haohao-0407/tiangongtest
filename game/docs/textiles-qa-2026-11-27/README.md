# 任务 11 · 牧场剪毛、织布与木床

2026-11-27，本地游戏从零羊毛、零布料开始。居民剪羊、搬回 6 份羊毛，完成玩家下的 3 张织布订单，再把 3 份布搬进仓库。木床消耗这批布和 24 块木板，建成后重载仍在。[实机报告](./play.json) · [逐阶段库存、居民、订单与动物读数](./inventory.json)

## 实际仓库余额

| 游戏秒 | 检查点 | 木材 | 木板 | 羊毛 | 布料 |
| ---: | --- | ---: | ---: | ---: | ---: |
| 128.25 | [成年羊在本栏，剪毛台在空栏，居民没有剪毛任务](./01-separate-pastures.png) | 18 | 24 | 0 | 0 |
| 128.25 | [玩家在有羊的牧场放置剪毛台蓝图](./02-stand-blueprint.png) | 12 | 24 | 0 | 0 |
| 142 | [剪毛台完工，居民开始剪毛](./03-shearing.png) | 12 | 24 | 0 | 0 |
| 146.75 | [首批 2 份羊毛落地，等待搬运](./04-wool-ground.png) | 12 | 24 | 0 | 0 |
| 176.25 | [三只成年羊的 6 份羊毛全部入仓](./05-wool-stock.png) | 12 | 24 | 6 | 0 |
| 187.25 | [织布机建成](./06-loom.png) | 0 | 24 | 6 | 0 |
| 190.25 | [首张订单已领羊毛 2 份](./07-weaving.png)，[载入后继续制作](./08-reloaded-order.png) | 0 | 24 | 4 | 0 |
| 194.25 | [第一份布料落地，仓储尚未入账](./09-cloth-ground.png) | 0 | 24 | 4 | 0 |
| 212.50 | [仓库中有 3 份布料](./10-cloth-stock.png) | 0 | 24 | 0 | 3 |
| 230.75 | [木床建成](./11-bed.png)，[再次载入](./12-reloaded-bed.png) | 0 | 0 | 0 | 0 |

## 试玩数值与边界

- 剪毛台占 1×1 格，耗木材 6，建造工作量 8。已领进本牧场的成年公羊和母羊都能剪毛。每次剪毛工作量 5，产羊毛 2，完成后经过 1 游戏日（360 模拟秒）恢复。幼羊跳过采集。
- 手动织布机占 2×1 格，耗木材 12，建造工作量 14。每批耗羊毛 2、产布料 1，加工工作量 6。两种设施均可在零布料、零研究、零供电条件下起步。
- 验收局预置围栏、3 只成年羊、1 只幼羊、普通仓及一座位于相邻空栏的剪毛台。玩家通过建造菜单在有羊的栏内补建剪毛台，建织布机，下单并建床。野外领羊、动物成长和专用仓溢出不在本局操作范围内。地图设备采用首版体素造型。
- 实机每次推进后按羊毛当量核对仓库、地面、在途、订单用料和建床用料。中途读档时，仓库有羊毛 4、订单已领 2，三只成年羊恢复时刻均保留。首轮验收脚本曾把订单领料和居民界面显示的同一批货重复计数，已修正并从头复跑。
- 第二次恢复在模拟回归中以同一存档验证。将时间移到恢复前 2 秒，继续推进，三只成年羊第二轮共入库羊毛 6。幼羊的采集时间始终为 0。

## 复跑

从游戏目录运行。第一条重建测试存档、通过游戏界面操作并写出 12 张截图与库存，输出目录为 `artifacts/textiles/`。第二条检查缺设施、在制读档、用料、木床和恢复边界。

```powershell
.\node_modules\.bin\forgeax.cmd project play scripts/textiles-playthrough.mjs --require-ui --headless true --backend auto --viewports 1280x720 --timeout-ms 1200000 --json
node scripts/textile-recovery.mjs
```

本次实机使用含手摇制糖台注册的共享源码副本，137 步通过，控制台错误、页面错误、输入警告均为 0。共享项目通过类型检查、引擎项目检查和 128 项营地回归测试。交付位于本地工作区。

牧场规则与派工在 [pasture.ts](../../assets/colony/pasture.ts) 和 [simulation.ts](../../assets/colony/simulation.ts)。设施和织布配方在 [contracts.ts](../../assets/colony/contracts.ts) 和 [recipes.ts](../../assets/colony/recipes.ts)。地图与缩略图共用[设备造型](../../assets/colony/textile-models.json)，地图接入在 [view.ts](../../assets/colony/view.ts)。[局部刷新图集](../../scripts/render-textile-icons.py) · [完整图集生成器](../../scripts/render-building-icons.py) · [图集索引](../../assets/ui/building-icons.json) · [图集](../../assets/ui/building-icons.png) · [实机脚本](../../scripts/textiles-playthrough.mjs) · [恢复回归](../../scripts/textile-recovery.mjs)

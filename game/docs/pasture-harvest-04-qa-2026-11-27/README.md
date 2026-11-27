# 任务 04 · 牧场采集与同档交售

2026-11-27，本地游戏浏览器。居民建成围栏，经同一扇门领入两头成年母牛、一只羊、一头猪和一只成年母鸡。玩家改门、存读档，再安排建造挤奶器和鸡窝。仓内的奶酪和煎鸡蛋来自这座牧场采集的牛奶和鸡蛋。[牧场原始读数](./inventory.json) · [逐只过门记录](./crossings.json)

## 牧场与库存

下表时间为交售档这一局的模拟秒数。食材仓只有一格，开局放入四叠各 32 份油。普通仓在地图 (30–34, 20–23)。这局从 8×6 空牧场的未施工蓝图开始，炉灶和奶酪机已建好。地图采用固定种子「草场-154」并整平地面，牲畜由游戏生成。第一次框选和门位预览见[上一轮报告](../pasture-qa-2026-11-27/play.json)。

| 游戏时间 | 节点 | 牛奶 | 鸡蛋 | 奶酪 | 煎鸡蛋 |
| ---: | --- | ---: | ---: | ---: | ---: |
| 120 | 空栏蓝图，三位居民 | 0 | 0 | 0 | 0 |
| 168 | 23 段围栏与一扇门完工 | 0 | 0 | 0 | 0 |
| 244.50 | 五只牲畜全部经过 (26,22) 入栏 | 0 | 0 | 0 | 0 |
| 258.75 | 新门 (22,20) 完工，旧门补成围栏。重载后五只的标识、归属、休息格相同 | 0 | 0 | 0 | 0 |
| 272.75 | 挤奶器与鸡窝均已完工 | 0 | 0 | 0 | 0 |
| 444 | 地面有牛奶 2、鸡蛋 1，尚未搬运 | 0 | 0 | 0 | 0 |
| 448.75 | 青禾搬着 2 份牛奶 | 0 | 0 | 0 | 0 |
| 460 | 牛奶已到库，阿澈搬着 1 枚鸡蛋 | 2 | 0 | 0 | 0 |
| 467.75 | 两种产物均在普通仓，食材专用仓仍有油 128 | 2 | 1 | 0 | 0 |
| 469.50 | 居民为奶酪机订单领取牛奶 2 | 0 | 1 | 0 | 0 |
| 485.50 | 奶酪入库，居民为炉灶订单领取鸡蛋 1 | 0 | 0 | 1 | 0 |
| 497.50 | 两种成品入库，保存交售前的档 | 0 | 0 | 1 | 1 |

为看清送达时点，采集时从工作面板关闭搬运，出现地面产物后再开启。食材仓开局就满；部分余量先送专用仓再把剩货送普通仓的独立记录在[任务 07](../storage-routing-qa-2026-11-27/inventory.json)。

[围栏完工](./02-fence-built.png) · [过门示例](./04-gate-sheep-26-7.png) · [换门重载](./06-gate-reloaded.png) · [居民挤奶](./08-collect-milk.png) · [居民收蛋](./08-collect-egg.png) · [普通仓入库](./11-general-storage.png) · [奶酪订单](./12-order-cheese.png) · [炉灶订单](./12-order-friedEgg.png) · [成品入库](./13-products-in-stock.png)

## 同档向导交售

08 验收版本中，右键营地向导，在回收栏选择仓库的 1 份煎鸡蛋，确认报价 35 银币。全程奶酪保留 1 份。[原始交售读数](./sale/inventory.json) · [浏览器通过报告](./sale/play.json)

| 游戏时间 | 可用煎鸡蛋 | 银币 | 交易状态 |
| ---: | ---: | ---: | --- |
| 497.50 | 1 | 10 | 重载牧场原档，查看报价 |
| 497.50 | 0 | 10 | 确认，仓库预留 1 份 |
| 500.75 | 0 | 10 | 居民在途 1，已付 0 |
| 506.25 | 0 | 45 | 向导收货，到账 35 |
| 506.25 | 0 | 45 | 再次重载，无未结订单，五只牲畜仍归属原牧场 |

[交售前牧场存档](./pasture-final-save.json)与[交售脚本的输入](./sale/opening-save.json)字节相同，SHA-256 为 `045a8f3dc2279832f707e3b1000dd29552b77cc30a775746ca8a1525c5d83058`。[在途画面](./sale/16-guide-in-transit.png) · [交付收据](./sale/17-guide-paid.png) · [重载画面](./sale/18-sale-reloaded.png) · [交售后存档](./sale/guide-final-save.json)

## 施工故障与复跑

两座设施同时施工的一轮中，挤奶器位于 (24,23)，建造者中心在 (23.8,23.5)，身体仍与占地重叠 0.03 格。施工进度反复停在 11.75/12。原逻辑让其他居民让位，却跳过建造者。修复后建造者保留施工订单，移到安全工作位后完成施工。固定该站位运行 20 模拟秒，修复前仍为 97.9%，修复后为 100%。牧场和建筑相关 32 项测试、类型检查均通过。[现场画面](./construction-stall/01-failure.png) · [故障运行状态](./construction-stall/play.json) · [站位回归脚本](../../scripts/pasture-builder-regression-04.mjs)

从仓库根目录用 PowerShell 复跑。第一条游戏命令在包含修复的当前本地版验收牧场；交售复跑使用接单时已通过任务 08 验收的保留副本。后续并行版本增加了附身居民、近身右键、安排住房后开店的入口，本次交售读数适用于 08 的营地商店。

```powershell
Push-Location game
node --import tsx scripts/pasture-builder-regression-04.mjs
.\node_modules\.bin\forgeax.cmd project play scripts/pasture-harvest-04.mjs --require-ui --headless true --backend auto --viewports 1280x720 --timeout-ms 900000 --json
Pop-Location
Push-Location .launcher/pasture04-harvest
.\node_modules\.bin\forgeax.cmd project play scripts/pasture-harvest-sale-04.mjs --require-ui --headless true --backend auto --viewports 1280x720 --timeout-ms 900000 --json
Pop-Location
```

两条游戏命令分别输出到运行目录的 `artifacts/pasture-harvest-04/` 和其 `sale/` 子目录。共享工作区只改了居民施工让位逻辑，另增任务 04 验收脚本和证据。实机范围为本地 1280×720 的单一固定种子。

修复后重新从空栏蓝图实测，426 个引擎步骤通过，控制台、页面错误和输入警告均为零。五只动物与新门读档保留，两种成品各 1 份再次入库。[牧场通过报告](./fixed-pasture/play.json) · [修复后逐步库存](./fixed-pasture/inventory.json) · [成品重载截图](./fixed-pasture/13-products-reloaded.png) · [修复后存档](./fixed-pasture/pasture-final-save.json)。独立交售通过 21 个引擎步骤，使用上表保存的交售前原档。

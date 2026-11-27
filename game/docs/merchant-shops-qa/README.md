# 五位商人安家与当面交易

在小镇里选一位居民，按 R 控制他，走到商人三格以内，右键人物。向导开局就在镇里。其他商人在仓库货物实际交给买家并达到门槛时搬来。尚未安家的商人在镇边行走。找到本人，点击「安排住所」，再按房间号、床位和舒适度选定一间合格空房。入住后再右键本人即可进店。走出交谈距离会关闭窗口。

| 职业 | 场景标记 | 入住后货架 |
| --- | --- | --- |
| 向导 | 带扣旅行背包 | 七种基础种子包、布料、小麦、面包 |
| 厨师 | 白色高厨帽 | 面包、意大利面 |
| 裁缝 | 紫色线轴 | 布料 |
| 乳酪师 | 奶黄色宽檐帽、手持奶酪 | 牛奶、奶酪 |
| 铁匠 | 长柄铁锤 | 生铁、钢铁 |

## 联合验收

1. 场内已有五间合格空房。向导仍显示「正在镇上寻找住所」。在近处右键他后，手动选择一间房，货架才出现。[选房](./guide-choose-room.png) · [入住后货架](./guide-housed.png)
2. 向导收购 6 件羊毛。搬运工已经取货时，裁缝的累计实售仍为 0，银币仍为 30。交货后累计 6 件，银币变为 49。裁缝在第 1 天到镇、走动并等待分房。[取货在途](./guide-in-transit.png) · [镇上走动](./tailor-walking.png) · [本人选房](./tailor-choose-room.png)
3. 裁缝入住后只上架布料，平日收羊毛。第 1 天日历公布「冬衣赶工」，第 4 至 5 天以基础回收价的 150% 收购共 10 件布料。商店使用同一活动和剩余额度，选择 11 件时无法确认。[裁缝货架](./tailor-housed.png) · [日历预告](./calendar-announcement.png) · [超额报价](./event-cap.png)
4. 实机订单从两个仓位收取 10 件，向裁缝交货，锁价 128 银币。第一趟交付 4 件、收 51 银币，余额由 49 增至 100。使用「保存家园」和「读取本机」后仍为 4 件、51 银币、活动余量 0。余下 6 件送达再收 77 银币，余额 177。[首趟收款](./event-first-payment.png) · [读档](./event-reloaded.png) · [付清](./event-paid.png)
5. 没有合格空房时，向导显示房屋要求。四个职业均在场景内右键本人、选择具体房间，再逐一核对货架。[无房提示](./no-rooms.png) · [厨师](./chef-shelf.png) · [裁缝](./tailor-housed.png) · [乳酪师](./cheesemaker-shelf.png) · [铁匠](./blacksmith-shelf.png)

本地联合实机通过 113 步，保存了 21 张游戏画面，浏览器控制台和页面错误数均为 0。项目检查、类型检查及两项近身命中测试通过。首次尝试重新打开浏览器时引擎输入超时，最终验证使用玩家菜单中的「读取本机」。[引擎结果](./play.json) · [任务 12 的模拟结算记录](../specialist-settlement-qa/simulation.json)

## 复验

在游戏目录运行。引擎拥有的浏览器按真实游戏输入完成右键、选房、下单和读档。每个检查点写入同目录 [读数](./readings.json)，包含角色坐标、搬运工、订单、住房、活动和界面文本。

```powershell
./node_modules/.bin/forgeax.cmd project play scripts/merchant-shops-playthrough.mjs --require-ui --headless true --backend auto --viewports 1280x720 --timeout-ms 720000 --json
./node_modules/.bin/vitest.cmd run assets/colony/__tests__/merchant-interaction.test.ts
./node_modules/.bin/tsc.cmd --noEmit
```

验收小镇预置房屋、仓位和库存。为缩短徒步和等候，部分检查点把操作居民放在本人附近，并从已保存的活动公告跳到活动日。其他三个职业分别使用由相同模拟实际交货解锁的存档。场景人物复用居民骨架，职业配件和商店徽记为试玩美术。

本任务修改场景渲染、右键命中与距离检查、商店及选房界面。入口在 `assets/colony/view.ts`、`assets/colony/merchant-interaction.ts`、`assets/voxel/runtime.ts`、`assets/ui/guide-shop.ts`、`assets/ui/build-ui.ts` 和 `assets/guide.ui.html/.css`。货物、住房与报价引用任务 12 及公共职业配置，日历调用任务 13 的界面和活动模块。

# 既有地图的 16³ 微体素细节 PCG 调研

> 方案修正：用户进一步明确需要粗节点驱动的窗台、道路、人行道和台阶等结构生成。当前主方案见 [结构级 PCG 调研](/D:/tiangongtest/game/docs/semantic-voxel-pcg-research.md)。本文件保留为表面细节与网格输出阶段的参考，其“仅视觉、限制在原轮廓内”的范围不再代表完整需求。

调研日期：2026-11-14。对象：当前 `D:\tiangongtest\game`，ForgeAX 0.4.19。

本文是源码核查与实施设计，不是已经接入游戏的功能说明。外部生成器没有在本机运行；本文没有游戏性能实测结果。文中的尺寸、内存是明确条件下的算术估算，质量目标和预算需要实机验证。

## 结论

推荐采用 **MarkovJunior 式分层规则生成：粗地图语义 → 邻域与边角识别 → 16³ 微体素模块/材质规则 → 局部细节 → Greedy Meshing + 顶点 AO**。

最值得阅读的现成实现是 [MarkovJunior](https://github.com/mxgmn/MarkovJunior)，尤其 [SeaVilla.xml](https://github.com/mxgmn/MarkovJunior/blob/main/models/SeaVilla.xml)、[ModernHouse.xml](https://github.com/mxgmn/MarkovJunior/blob/main/models/ModernHouse.xml) 与 [OddScale3D.xml](https://github.com/mxgmn/MarkovJunior/blob/main/models/OddScale3D.xml)。它们分别展示建筑边角模块、分层建筑细节、放大网格后加工表面的真实规则。16 倍墙地板规则与当前地图适配仍需开发，不能把这些示例当作现成 ForgeAX 插件。

建议保留现有粗地图、建筑状态、寻路和存档作为权威数据，把每原格 16×16×16 定义为**视觉空间的采样精度**。不要求每格常驻 4096 个小对象，也不要求把地图整体替换为高分辨率数组。PCG 的质量主要来自结构规则、少量优质模块、跨格连续性与光照，而不是细分数量本身。

## 1. 当前项目的实际接入条件

以下链接均指向本次核查的源码位置。

| 现状 | 接入影响 | 源码 |
|---|---|---|
| `VoxelWorld` 是 48×24×48，12³ 逻辑 chunk，`Uint8Array` 存材质 | 粗地图可以继续作为权威数据 | [model.ts](/D:/tiangongtest/game/assets/voxel/model.ts:3) |
| 地形只剔除遮蔽面；每个可见面独立生成 4 顶点、2 三角 | 当前没有 greedy、微体素、局部 AO；应增加新的 detail mesher | [mesh.ts](/D:/tiangongtest/game/assets/voxel/mesh.ts:22) |
| 地形颜色按粗格变化，含面朝向明暗 | 扩展时不要把随机色直接搬到每个微格，也要避免 AO 与原有明暗过度叠加 | [mesh.ts](/D:/tiangongtest/game/assets/voxel/mesh.ts:30) |
| 已完成石墙是 `1×1.8×1` 的 cube 加墙帽；木地板是 `.98×.05×.98` 的 cube | 建筑细节需要单独接入 `ColonyView`，不能只改地形 mesher | [view.ts](/D:/tiangongtest/game/assets/colony/view.ts:84) |
| 建筑完成只修改 `buildings`，不写入地形数组 | 细节输入需要同时读取地形与已完成建筑 | [simulation.ts](/D:/tiangongtest/game/assets/colony/simulation.ts:559) |
| 地形 dirty 只处理本 chunk 和边界上的轴向邻块 | AO、转角和 3×3×3 邻域规则需要包含对角与特征半径 | [model.ts](/D:/tiangongtest/game/assets/voxel/model.ts:162) |
| 建筑显示签名没有邻接连接码 | 相邻墙体建成时必须让已有墙角/接缝重新生成 | [view.ts](/D:/tiangongtest/game/assets/colony/view.ts:107) |
| mesh 支持 position、normal、uv、color、Uint32 indices；动态拓扑可 `assets.replace` | 可沿现有渲染路径实现，无需先替换引擎 | [mesh.ts](/D:/tiangongtest/game/assets/voxel/mesh.ts:49)、[runtime.ts](/D:/tiangongtest/game/assets/voxel/runtime.ts:161) |

另一个尺寸问题：现有墙高 1.8、地板厚 .05 并非 1/16 的整数倍。建议统一世界微格长 `1/16`，墙体覆盖多个原格的竖向范围，地板可采用一微格厚贴面；不要把高墙和薄地板的各自包围盒都硬切成 16 层，造成不同物件的微体素大小不一致。具体量化是否调整外轮廓，应在效果原型中对照原尺寸选择。

## 2. 候选技术与取舍

| 路线 | 一手资料确认的能力 | 本项目的判断 |
|---|---|---|
| **MarkovJunior 分层重写 + 模块映射** | 支持多维规则、map 放大与模型替换；SeaVilla 显式处理 TopOut、TopIn、Wall、Stone、Edge 等；OddScale3D 演示 6 倍放大后识别表面 | **主推荐**：借鉴规则架构，用项目内 TypeScript 实现必要子集，或先离线制作模块库 |
| **WFC / Model Synthesis** | 样本/模块的邻接约束、局部补全；WFC 会遇到矛盾，3D 求解成本更高；Model Synthesis 有分块修改路径 | 用于不规则石板拼铺、花纹或模块变体，先固定布局和边界；不在整张 2.26 亿微格地图上求解 |
| **纯噪声扰动** | 连续噪声可提供位置相关的起伏和色差 | 作为石面小缺口、泥土、苔藓的辅助；砖缝、板缝、墙角需要结构规则 |
| **DECOR-GAN / ShaDDR** | 学习粗体素到精细几何；ShaDDR 还生成纹理，并包含建筑类别 | 可作为离线样例研究；当前游戏的可编辑大地图、确定性接缝与硬约束仍需额外工程，不作为首轮实时方案 |

对应来源：[MarkovJunior 源码与示例](https://github.com/mxgmn/MarkovJunior)、[WFC 作者实现](https://github.com/mxgmn/WaveFunctionCollapse)、[Model Synthesis 作者实现](https://github.com/merrell42/model-synthesis)、[DECOR-GAN 论文](https://openaccess.thecvf.com/content/CVPR2021/html/Chen_DECOR-GAN_3D_Shape_Detailization_by_Conditional_Refinement_CVPR_2021_paper.html)、[ShaDDR 作者实现](https://github.com/qiminchen/ShaDDR)。表中的推荐与适配性是本项目的工程判断，不是论文的性能结论。

具体实现边界：

- MarkovJunior 原版是 C# 程序，可输出 `.vox`，适合研究和离线模块生成。将当前地图的材质、占据关系与建筑语义变成它的规则输入，需要适配层。
- [Map.cs](https://github.com/mxgmn/MarkovJunior/blob/main/source/Map.cs#L27) 的通用比例解析支持 `scale="16 16 16"`，但它只放大网格与规则写入位置，不会自动缩放输出模块。每格填入 16³ 的样例/规则仍需制作；[Rule.cs](https://github.com/mxgmn/MarkovJunior/blob/main/source/Rule.cs#L203) 对 map 允许不同尺寸输入输出，模块重叠也要自行设计。
- 直接集成有两个已确认的适配点：[Interpreter.Run](https://github.com/mxgmn/MarkovJunior/blob/main/source/Interpreter.cs#L52) 会清空初始网格，因此需要在清空后注入地图或新增带初始状态的入口；[Map.cs 的边界访问](https://github.com/mxgmn/MarkovJunior/blob/main/source/Map.cs#L59) 使用周期 wrap，有限地图与 chunk 需要邻域 padding、裁剪或修改访问策略。另需把项目坐标/材质 ID 转成 [Grid.cs](https://github.com/mxgmn/MarkovJunior/blob/main/source/Grid.cs#L23) 的轴向索引与符号表。
- [MarkovJuniorWeb](https://github.com/Yuu6883/MarkovJuniorWeb) 提供 TypeScript/浏览器路线，可用于规则试验；本次没有验证其与 ForgeAX 生命周期、worker 和资产系统的兼容性。
- [DECOR-GAN 官方支持配置](https://github.com/czq142857/DECOR-GAN#training) 为 4 倍或 8 倍。[ShaDDR 示例](https://github.com/qiminchen/ShaDDR#training) 中建筑为 32³→256³，汽车为 64³→512³，均为 8 倍。这些并非直接支持当前地图的现成 16 倍模型。
- MarkovJunior、DECOR-GAN、ShaDDR 和 Binary Greedy Meshing 仓库声明 MIT；MarkovJuniorWeb 在 [package.json](https://github.com/Yuu6883/MarkovJuniorWeb/blob/main/package.json) 声明 MIT。若复用示例资产需另核来源：[WFC LICENSE](https://github.com/mxgmn/WaveFunctionCollapse/blob/master/LICENSE) 明确排除图像样本和 tiles；[Model Synthesis LICENSE](https://github.com/merrell42/model-synthesis/blob/master/LICENSE.txt) 的覆盖范围明确限于非 third_party 的 C++ 文件。首轮可自制小模块，避免把算法许可当作全部素材许可。

## 3. 推荐生成管线

```text
现有 VoxelWorld + 完成建筑 + 世界种子
                  ↓
统一语义查询：占据 / 材质 / 地面 / 墙 / 门洞 / 保留空域
                  ↓
局部邻域：平面 / 内外角 / 顶沿 / 墙根 / 台阶 / 材质交界
                  ↓
结构规则：砖层、错缝、铺板方向、石板模块、边角收口
                  ↓
世界坐标 1/16 采样：实体核心 + 表面有限厚度的细节
                  ↓
按砖/板变色、少量缺角、受位置约束的苔藓
                  ↓
可见面剔除 → 保留材质与 AO 的 greedy 合并
                  ↓
按 detail tile 缓存原生 MeshAsset，局部替换
```

### 3.1 建立可控的规则输入

粗格不仅给出“实心/空”，还应给出材质和用途。同样的石材，在墙面上生成砌块，在地面上生成踏步或石板，不能让一个噪声函数决定所有形态。

至少区分：空、实体内部、水平可见表面、立面、内角、外角、顶沿、墙脚、材质交界、门洞与通行保留区。第一轮规则读取粗格的 3×3×3 邻域；超过一粗格的装饰则声明自己的更大依赖半径。

只对真正暴露的表面与可见凹槽建立细节。实体内部可表示为统一材质，不必每个微格都常驻。地形和建筑可以暂时分别输出 mesh，但应查询同一个占据场，避免墙脚被地面穿插、交界面重复，以及彼此看不到遮挡。

### 3.2 墙、地面各自的细节规则

以下尺寸是首轮艺术参数建议，不是现成资产规格。

| 材质/位置 | 主结构 | 微细节 | 限制 |
|---|---|---|---|
| 石砖墙 | 约 8 微格长、4 微格高的砌块节奏；奇偶砖层错半砖 | 1 微格凹缝、少量缺角、按整砖选 3–5 档颜色 | 保留实体背衬；缝隙不穿透整墙；墙角单独收口 |
| 粗石墙 | 先划分较大石块，局部约束选择尺寸/接缝 | 石面 0–1 微格起伏、局部裂边 | 不把每个小格独立随机；控制碎片和悬空颗粒 |
| 木地板 | 确定铺设轴，板宽约 4–5 微格，端缝错开 | 板边暗缝、整板色差、少量钉头/端纹 | 板长可以跨粗格；房间与门槛过渡有边界规则 |
| 石板地面 | 大块石板先布局，局部小块填缝 | 1 微格缝、轻微高度差、少量缺角 | 行走面保持平缓；大洞和大台阶必须进入逻辑层 |
| 草地/泥土 | 保持大片连续色面和原高度关系 | 边缘草簇、少量碎石、草土过渡和土层 | 装饰密度受坡度/湿度/建筑占据限制，避免铺满整个表面 |

一格只有 16 微格宽，1 微格缝已占原格的 6.25%。如果砖太小、缝太宽，结果会像栅栏或棋盘。优先把砖石做大、减少频繁凹凸，保留体素风格的整洁轮廓。

### 3.3 接缝与确定性

关键不是“每格都生成得漂亮”，而是所有格使用一致的空间规则。

1. **统一世界整数坐标。** 微格 `(X,Y,Z)` 对应粗格 `floor((X,Y,Z)/16)`。砖行、木板、噪声和色差用世界坐标或稳定的建筑局部坐标计算；不能在每个 chunk 内重置相位。
2. **按砖块/模块 ID 取随机数。** 使用 `hash(worldSeed, featureId, detailVersion)`，避免生成顺序影响结果。不要用每个微格的独立随机色。若用局部区域 ID，区域增建后也不能导致已有区域的随机种子整体变化。
3. **边界协议明确。** 模块的接触面记录占据、材质、砖行高度、方向等接口；对旋转后的接口做匹配。相邻块查询同一个三维采样器，保证剔除面的依据一致。
4. **边角单独生成。** 世界坐标保证平面相位连续，但不会自动解决不同方向的砖墙转角；外角、内角、顶面与墙脚要有专门模块或三维规则。
5. **保留结构与空域。** 允许在表面 1–2 微格厚的范围内凹凸；实体内部保留背衬。门洞、道路和其他建筑的占据关系是硬约束。首轮优先内凹和轮廓内细节，以减小视觉与粗碰撞的差异。
6. **局部 WFC 有兜底。** 仅在石板模块等有限区域选择变体，冻结外边界，限制回溯/重试次数；失败后使用确定性的基础铺法。需要跨模块连接的裂纹，要编码连接状态。

简化的直墙砖缝可以用 `row=floor(Y/4)`、`uShifted=U+4*(row%2)`，再按 `U` 周期 8、`Y` 周期 4 定位缝。这里 `U` 来自世界空间墙面轴，砖缝只切入表层。此公式只是直墙片段，完整实现仍需转角、压顶、门洞保护及模块接口。

## 4. 内存、网格和 LOD

### 4.1 16 倍的真实规模

| 表示 | 单元数 | 仅 1 byte/单元的大小 |
|---|---:|---:|
| 现地图 48×24×48 | 55,296 | 54 KiB |
| 全图稠密细分 768×384×768 | 226,492,416 | **216 MiB** |
| 原 12³ chunk 细分为 192³ | 7,077,888 | **6.75 MiB** |
| 建议试验的 4³ 粗格 detail tile，64³ 微格 | 262,144 | 256 KiB |
| 同一 tile 加一圈采样 halo，66³ | 287,496 | 约 281 KiB |

表中不含 baseline、mesh、JavaScript 临时数组、AO、缓存、GPU 副本。若用 2 byte 材质就是两倍；逐微格 RGBA 为四倍。单独占据位图可以压缩，但不能代表材质、灯光和 mesh 的全部成本。

4³ detail tile 是可测试的起点，不是已证实的最优值；过小会增加 draw calls。应保留 12³ 逻辑 chunk，按可见面密度和上传耗时决定细节网格分区；全实体内块不分配高分辨率 buffer。缓存可以只保留近处微体素/最终 mesh，远处释放可重建中间数据。

### 4.2 Greedy Meshing 是必要配套

对一个材质、颜色和 AO 都一致的孤立 16³ 实心立方体：

- 每微格都画完整 cube：4096×12 = 49,152 个三角形。
- 只剔除内部面：6×16²×2 = 3,072 个三角形。
- 相邻共面合并：6 个大四边形 = 12 个三角形。

这是理想几何的算术例子。真实砖缝、材质和 AO 会阻止部分合并，不能把最后的比率当作实际地图的承诺。算法依据见 [0fps Greedy Meshing](https://0fps.net/2012/06/30/meshing-in-a-minecraft-game/)。

第一轮推荐普通 TypeScript greedy mesher，合并条件包括朝向、材质/色档和能保持顶点 AO 插值的条件。按砖色档而非逐微格颜色变化，有利于画面整洁与面合并。使用预分配或两遍计数的 TypedArray 输出，避免目前 `number[]` 逐项 push 在高分辨率下形成多份大数组。

[Binary Greedy Meshing](https://github.com/cgerikj/binary-greedy-meshing) 是后续性能参考，但不能直接套用作者的微秒级数据：它是原生实现，使用 64 位位运算及定制顶点拉取。其 64³ 大小包含邻居边界，内部通常对应 62³；与上表的 64³ 内部 + halo 不是同一布局。仓库把 baked AO 支持指向 v1 分支；不能默认 v2 的高速路径已满足本项目 AO 合并需求。必要时再评估 WASM 或 32 位掩码优化。

### 4.3 AO 与 LOD

[0fps 的体素 AO](https://0fps.net/2013/07/03/ambient-occlusion-for-minecraft-like-worlds/) 根据顶点相邻占据计算遮蔽，并说明合并条件和四边形对角线选择。它适合强化砖缝、墙根和地面层次。

现项目可先把适度 AO 乘进线性顶点色，作为风格化实现；这会同时影响直接光照下的颜色，并不等于材质里物理独立的 AO 通道。避免叠加过重的面朝向暗色。若需要精确的间接光遮蔽，再核查和接入引擎 surface shader 通道。

LOD 建议按投影屏幕尺寸决策：近处 16、中景 8/4、远处保留粗轮廓与大色块。它们应从同一高质量规则或缓存派生，保留主轮廓和颜色分布；不能随意取每隔 N 个体素，导致薄地板、砖缝和装饰消失。相邻 tile 不同 LOD 的边界需锁边或过渡几何；初版可以对一个连续小区域采用统一 LOD，先验证质量，再处理混合边界。

## 5. 项目内的最小接入设计

以下是建议新增职责，不是已经存在的文件或 API。

| 建议模块 | 职责 |
|---|---|
| `assets/voxel/detail/semantic-source.ts` | 合并粗地形与建筑语义，占据查询、保护空域、邻域分类 |
| `assets/voxel/detail/recipes.ts` | 石墙、木板、石板、草土规则及稳定随机、样式参数 |
| `assets/voxel/detail/sampler.ts` | 全局微格查询、实体核心与表层规则、边界 halo |
| `assets/voxel/detail/mesher.ts` | 内面剔除、greedy、AO、TypedArray 网格输出 |
| `assets/voxel/detail/cache.ts` | detailVersion、区域 dirty、预算队列、缓存、LOD 状态 |

接入时修改现有 `runtime.ts` 的区块更新路径和 `colony/view.ts` 的墙/地板显示；渲染仍使用原生 MeshAsset。现有运行时地形更新是同步循环，即使在 Engine Worker 中也可能阻塞模拟；需要按帧预算分批生成，并在可用性验证后考虑专门的任务 worker。

缓存键至少包括区域坐标、LOD、材质配方版本和影响该区域的地形/建筑版本。异步任务结果须带版本号，拒收已经过期的 mesh。编辑后按照规则依赖半径扩展 dirty 区域，再加 mesher 的 AO 邻域；不只标记六轴相邻 chunk。

存档继续保存粗地图和建筑状态，另保存 `detailVersion` 与必要样式选择；无须保存纯确定性生成的全部微体素。如果以后支持玩家手工雕刻小体素，再单独保存稀疏覆盖编辑，这属于新的玩法范围。

模块素材可离线制作或用 MarkovJunior 输出，进入工程时仍走现有 author→importer/cooker→catalog 流程；本机 `.vox` 输出不能直接假定是引擎已支持的运行时资产格式，需实现转换或用本项目规则格式烘焙。游戏中生成的 mesh 沿 `assets.create/replace/release` 生命周期管理。

## 6. 建议首轮原型与验收

先做一个约 8×8 粗格的局部场景：一段 L 形石墙、门洞、连接的木地板/石板地面、草土边缘，并刻意横跨逻辑 chunk 和 detail tile 边界。材料先控制为 3–4 类。直墙、端头、内外角、顶部、底部和少量缺角变体比大量随机装饰更有价值。

必须看到的效果：

1. 原地图的可通行区域和门口仍正确；粗结构清楚，近看有真实几何凹凸。
2. 砖层、木板和板缝跨原格与 chunk 连续，转角自然，无重叠闪烁。
3. 同种子与版本重载结果一致，改变生成顺序不改变结果。
4. 增删边界方块或完成相邻墙体，只更新相关区域，旧墙角和 AO 随之变化。
5. 远景不出现密集闪烁；降低细节时不漏地、不穿墙、不留接缝。

性能记录应包含：固定分辨率和相机的 CPU/GPU 帧耗时、p95、可见三角形和 draw calls；首次生成时间；局部编辑到 mesh 替换的延迟；CPU/GPU 额外内存与缓存峰值。若目标 60 FPS，16.7 ms 是整帧预算，不能把它全部分给 PCG。所有指标在同机同视角对比原版与细节版，之后再决定全图启用范围。

本次完成的验证仅为当前源码核查、外部一手资料与规模估算，以及独立规则示意；未修改游戏运行时代码，也未运行上述原型验收。

# 天工视觉迁移 · 技术需求（像素化 + 描边）

> 交接对象：负责天工引擎侧的程序
> 编写：2026-11-14
> 工程路径：本仓库的 `game/`（相对路径，换机器不用改）
> SDK：`D:\forgeax\engine-sdk-0.4.19`（团队统一位置，路径以各自机器的 `FORGEAX_INFO.md` 为准）
> 引擎版本：`@forgeax/engine@0.4.19`

---

## 1. 目标

把 Unity 原型（Guangzi）的视觉语言搬到天工工程「森屿 · 和平殖民地」上。

**要的效果**：

| 项 | 现在 | 目标 |
|:--|:--|:--|
| 抗锯齿 | FXAA 全开，边缘柔和 | 硬边、像素块明显 |
| 分辨率 | 跟随 devicePixelRatio 满分辨率 | 低分辨率渲染 + 最近邻放大 |
| 描边 | 无 | 物块轮廓有深色边（可选，见 §5） |
| 色调 | ACES Filmic + 暖阳 | 保留，微调饱和与对比 |

**不要动**：模拟逻辑（`colony/simulation.ts`）、体素数据（`voxel/model.ts`）、UI 布局。

---

## 2. 现状：天工当前的渲染配置

### 2.1 相机

`assets/voxel/runtime.ts` 第 89-96 行：

```ts
const camera = track(world.spawn(
  { component: Name, data: { value: '家园相机' } },
  { component: Transform, data: {} },
  { component: Camera, data: { ...perspective({ fov: Math.PI / 4, aspect: 16 / 9, near: 0.1, far: 240 }),
    antialias: ANTIALIAS_FXAA, tonemap: TONEMAP_ACES_FILMIC, exposure: 1,
    clearColor: [0.55, 0.73, 0.76, 1] } },
).unwrap());
```

- `perspective` 透视相机，fov 45°
- `ANTIALIAS_FXAA` 抗锯齿
- `TONEMAP_ACES_FILMIC` 色调映射

### 2.2 材质与光照

- 地形：`Materials.standard({ baseColor: [1,1,1,1], metallic: 0, roughness: 0.94 })`（PBR）
- 阳光：`DirectionalLight`，暖色 `[1, 0.89, 0.71]`，强度 3.2，开阴影
- 环境：`Skylight` + 等距柱状贴图（`environment/daylight`）

### 2.3 网格

`assets/voxel/mesh.ts` —— 只为可见面生成带硬边法线和顶点色的区块网格。
**方块之间没有描边几何。**

### 2.4 宿主入口（关键）

入口是**自动生成**的 `.forgeax/generated/main.ts`：

```ts
import { createApp, syncCanvasDrawingBuffer } from '@forgeax/engine/app/browser';

const resizeCanvas = () => syncCanvasDrawingBuffer(canvas);
const resizeObserver = new ResizeObserver(resizeCanvas);
resizeObserver.observe(canvas);
resizeCanvas();

const result = await createApp(canvas, { ... }, bundlerAdapter);
```

**不要手改这个文件**——构建时会被覆盖。要改只能改生成器的模板。

---

## 3. 调研结论：三条路，难度递增

### 路线 A（最快，1 小时）—— 关抗锯齿 + CSS 像素放大

**改两处：**

```ts
// assets/voxel/runtime.ts，第 93 行
antialias: ANTIALIAS_NONE,    // 原 ANTIALIAS_FXAA
```

```css
/* assets/guide.ui.css 末尾 */
canvas {
  image-rendering: pixelated;
  image-rendering: crisp-edges;  /* Firefox 回退 */
}
```

**效果**：边缘不再被磨平，放大时不插值 → 有像素感。

**局限**：**没有真正降分辨率**，只是"不糊"。近看仍是高分辨率硬边，远看不会有像素块。

**风险**：低。随时可回退。

---

### 路线 B（真正的像素化）—— 降渲染分辨率

**核心难点**：canvas 的 drawing buffer 尺寸由宿主决定。

**已找到的两个钩子**：

#### 钩子 1：`canvasAspectPlugin(readSize)`

`@forgeax/engine-app` 导出了：

```ts
export declare function canvasAspectPlugin(
  readSize: () => CanvasDrawingBufferSize
): Plugin;
```

**尺寸通过一个回调读取**，理论上可替换。但宿主 `main.ts` 当前没用它，用的是 `syncCanvasDrawingBuffer`。

#### 钩子 2：运行时覆写 canvas.width

`ResizeObserver` **只在 CSS 尺寸变化时触发**，而改 `canvas.width` 不改 CSS 尺寸，所以覆写不会被立刻还原。

**可以在前端插件（`assets/ui/build-ui.ts`）里做**：

```ts
const canvas = document.querySelector('canvas');
const PIXEL_SCALE = 0.5;   // 0.5 = 半分辨率

const applyPixelScale = () => {
  const w = Math.round(canvas.clientWidth * PIXEL_SCALE);
  const h = Math.round(canvas.clientHeight * PIXEL_SCALE);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  canvas.style.imageRendering = 'pixelated';
};
```

**注意**：

- `build-ui.ts` 跑在**前端**，有 `document` ✅
- Engine Worker 里没有 DOM，不能在那里做
- 需要在每帧或 `requestAnimationFrame` 里调用，抵消 resize 重置

**风险**：

- 可能与 `syncCanvasDrawingBuffer` 打架，表现为画面拉伸或闪烁
- UI 层（HTML 覆盖层）是独立 DOM，不受影响 ✅
- **需要实机验证**

#### 钩子 3（最干净，但要改生成器）

如果官方支持在 `CreateAppOptions` 里传 canvas 尺寸策略，直接用它。
**这一条我没查到明确 API**，需要程序确认。

---

### 路线 C（描边，独立于像素化）

**三条实现路径**：

| 方式 | 原理 | 难度 | 备注 |
|:--|:--|:--|:--|
| **反向外扩壳（Inverted Hull）** | 每个网格多画一遍，沿法线外扩，只画背面，深色 | 中 | 体素方块的硬边法线适合这招，但 draw call 翻倍 |
| **屏幕空间边缘检测** | 读深度/法线做 Sobel | 高 | **需要在 renderer 创建时注入 feature** |
| **网格内烘焙** | 生成网格时给每个面加一圈深色边框 | **低** | 改 `mesh.ts`，只在视觉层，不碰逻辑 |

**推荐从第三条开始**：`buildChunkMesh` 已经在逐面生成顶点，加一圈内缩的深色面成本最低，而且**完全不碰渲染管线**。

---

## 4. 一个必须知道的坑

**SDK 文档和实际安装的包版本不一致。**

`D:\forgeax\engine-sdk-0.4.19\skills\forgeax-engine-render-pipeline\SKILL.md` 里写了后处理 API：

```ts
import { createFullscreenRenderFeature } from '@forgeax/engine-render/authoring';
const created = await createRenderer(canvas, { features: [feature] });
```

但我在 `node_modules/@forgeax/engine@0.4.19` 里**全局搜索过，这个函数不存在**：

- `dist/facades/` 下没有 `authoring` 子路径
- 所有 `.d.ts` 里搜不到 `createFullscreenRenderFeature`

**结论**：文档可能对应更高版本（0.4.20+）。**不要照着文档直接写代码，先用 `pnpm exec forgeax help <path> --json` 或查 `.d.ts` 确认 API 存在。**

---

## 5. 建议的实施顺序

| 阶段 | 内容 | 预期产出 | 风险 |
|:--|:--|:--|:--|
| **1** | 路线 A（关 FXAA + CSS） | 立刻能看对比 | 低 |
| **2** | 路线 C 第三条（网格内嵌描边） | 方块有轮廓 | 低 |
| **3** | 路线 B（真降分辨率） | 完整像素风 | 中 |
| **4** | 色调微调（饱和度/对比/曝光） | 气质对齐 | 低 |

**每步都要能独立回退。**

---

## 6. 验收标准

改完后用这条命令截图：

```bash
cd D:\forgeax\tiangongtest\game
export PATH="/c/Users/26853/.workbuddy/binaries/node/versions/22.22.2-6:$PATH"
pnpm exec forgeax dev start --headless false --json
pnpm exec forgeax dev look --json
```

**验收口径**（不看"构建通过"）：

1. `dev look` 截图里能看出明显的像素块边缘（远景尤其明显）
2. 方块之间有可辨识的深色轮廓
3. 拉近/拉远时像素密度**保持稳定**（不出现"近处糊、远处清晰"）
4. `pnpm exec tsc --noEmit` 无错
5. `pnpm test` 全绿

---

## 7. 参考资料

| 内容 | 路径 |
|:--|:--|
| 渲染管线文档 | `D:\forgeax\engine-sdk-0.4.19\skills\forgeax-engine-render-pipeline\SKILL.md` |
| 材质文档 | `D:\forgeax\engine-sdk-0.4.19\skills\forgeax-engine-material\SKILL.md` |
| WGSL 着色器 | `D:\forgeax\engine-sdk-0.4.19\skills\forgeax-engine-shader\SKILL.md` |
| 应用层 / GameHost | `D:\forgeax\engine-sdk-0.4.19\skills\forgeax-engine-app\SKILL.md` |
| 引擎源码 | `D:\forgeax\engine-sdk-0.4.19\source\engine\` |
| 已装包（以这个为准） | `D:\forgeax\tiangongtest\game\node_modules\@forgeax\engine\dist\` |
| 参考实现 | `D:\forgeax\voxel-warship`（同引擎的完整项目） |
| Unity 视觉基准 | `D:\unity\Vampire Hunt\Guangzi`（像素化 + 描边的参照） |

---

## 8. 协作约定

| 约束 | 说明 |
|:--|:--|
| 开分支 | `git checkout -b feature/pixel-render`，不直推 master |
| 不提交 | `node_modules/`、`dist/`、`.forgeax/`、`.tmp-tests/` |
| 先读 | 根目录 `CONTRIBUTING.md` |
| 改完汇报 | 「改了哪个文件 / 从什么改成什么 / 怎么回退」 |
| 参数归属 | 像素比例、描边粗细这类数值由策划定，程序给可调参数即可 |

---

## 附：一句话总结

**路线 A 今天就能看到效果，但只是"不糊"；真像素化（路线 B）卡在宿主生成代码，需要程序判断是改生成器还是用运行时覆写；描边建议从网格内嵌做起，不碰渲染管线。**

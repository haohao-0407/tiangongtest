import type {} from '@forgeax/engine/app';
import type { GameProjectionValue } from '@forgeax/engine/app';
import { Time, Update, type EntityHandle } from '@forgeax/engine/ecs';
import { createBoxGeometry } from '@forgeax/engine/geometry';
import { INPUT_SNAPSHOT_RESOURCE_KEY, type InputSnapshot } from '@forgeax/engine/input';
import { quat, ray, vec3 } from '@forgeax/engine/math';
import { viewportToWorld } from '@forgeax/engine/picking';
import type { Plugin } from '@forgeax/engine/plugin';
import {
  ANTIALIAS_FXAA, Camera, DirectionalLight, Materials, MeshFilter, MeshRenderer,
  perspective, setActiveCamera, SkyboxBackground, Skylight, SKYBOX_MODE_CUBEMAP,
  TONEMAP_ACES_FILMIC, ShadowParticipation,
} from '@forgeax/engine/render';
import { Name, PROPAGATE_TRANSFORMS_SYSTEM, Transform } from '@forgeax/engine/scene';
import { RenderQueue, type AssetHandle } from '@forgeax/engine/types';
import { assetGuid, guidText, PACKAGE_IDS, SUN_OUTGOING_DIRECTION } from '../shared/asset-refs.ts';
import { BLOCK, BLOCKS, VoxelWorld } from './model.ts';
import { buildChunkMesh } from './mesh.ts';
import { PcgView } from './pcg/view.ts';
import { ColonySimulation } from '../colony/simulation.ts';
import { ColonyView } from '../colony/view.ts';
import { TerrainPlanView } from '../colony/terrain-view.ts';
import { BUILDING_DEFS, type BuildingKind, type ColonyCommand } from '../colony/contracts.ts';

type Point = [number, number, number];
const PALETTE = [5, 3, 4, 6, 1, 2, 10];
const CAMERA_SYSTEM = 'voxel-camera';
const EDIT_SYSTEM = 'voxel-edit';
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export const voxelGame: Plugin.Object<{ readonly environment?: string }> = {
  name: 'voxel-homestead',
  inject: ['world', 'assets', 'gameHost'],
  async apply(ctx, config) {
    const world = ctx.world, assets = ctx.assets!, host = ctx.gameHost!;
    const port = host.port;
    await ctx.effect(async function* () {
      let voxels = new VoxelWorld();
      let colony = new ColonySimulation(voxels);
      let colonyState = colony.snapshot();
      const colonyView = new ColonyView(world, assets, () => voxels);
      const terrainView = new TerrainPlanView(world, assets, () => voxels);
      const pcgView = new PcgView(world, assets);
      colony.setWalkSurfaceSampler((x,z,fallback)=>pcgView.walkHeight(x,z,fallback));
      const entities = new Set<EntityHandle>();
      const chunks = new Map<string, { entity: EntityHandle; handle: AssetHandle<'mesh'> }>();
      const ownedHandles = new Set<number>();
      const own = <T extends number>(handle: T): T => { ownedHandles.add(handle); return handle; };
      const release = (handle: number) => { ownedHandles.delete(handle); assets.release(handle).unwrap(); };
      let cameraSystemAdded = false, editSystemAdded = false;
      let unregister: (() => void) | undefined;
      let receive: (event: MessageEvent) => void = () => {};
      let selected = 5, mode: 'build' | 'remove' = 'build', uiHover = false;
      // 右键拖动平移：水平和垂直各自可反转，灵敏度可调（都在暂停 → 设置里）
      let invertPanX = false, invertPanY = false, panSensitivity = 0.009;
      // ---- 玩家背包（快捷栏） ----
      // 照 Unity 的 PlayerInventory + HotbarUI：固定 9 格，数字键 1~9 切换。
      // 天工的资源原本全在共享池里，这里是「从池子拿到手上」——
      // 拿走的会从池子扣掉，放回去再加回池子，总量守恒。
      type BagSlot = { resource: string; count: number } | null;
      const bag: BagSlot[] = Array.from({ length: 9 }, () => null);
      let bagSelected = 0;

      // 玩家三条基础数值，照 Unity 的 PlayerVitals。
      // 血的用途等战斗系统上了再接；体力先给跳跃扣费，金币直接映射银币存量。
      const vitals = { health: 100, maxHealth: 100, stamina: 100, maxStamina: 100 };

      // 初始储藏区的木箱。天工的资源本来就在全局池里，这个箱子是它的一个「看得见的容器」：
      // 打开它看到的就是仓库里的东西，也是 Unity 那边「箱子默认计入仓库」的同一个意思。
      let chestPos: Point | null = null;

      /** 从共享池扣一份进背包，返回是否真的拿到了。 */
      const takeToBag = (resource: string, amount = 1): boolean => {
        const pool = (colonyState.resources as Record<string, number>)[resource] ?? 0;
        if (pool < amount) return false;
        let left = amount;
        // 先叠到已有的同种格子
        for (const slot of bag) {
          if (left <= 0) break;
          if (!slot || slot.resource !== resource) continue;
          const room = 99 - slot.count;
          const put = Math.min(room, left);
          slot.count += put;
          left -= put;
        }
        // 再开空格
        for (let i = 0; i < bag.length && left > 0; i++) {
          if (bag[i]) continue;
          const put = Math.min(99, left);
          bag[i] = { resource, count: put };
          left -= put;
        }
        const taken = amount - left;
        if (taken <= 0) return false;
        (colonyState.resources as Record<string, number>)[resource] = pool - taken;
        // 拿到手就自动选中它所在的格子，省得玩家再去找
        const at = bag.findIndex((slot) => slot && slot.resource === resource);
        if (at >= 0) bagSelected = at;
        return true;
      };

      /** 把某一格放回共享池。 */
      const dropFromBag = (index: number): void => {
        const slot = bag[index];
        if (!slot) return;
        const pool = (colonyState.resources as Record<string, number>)[slot.resource] ?? 0;
        (colonyState.resources as Record<string, number>)[slot.resource] = pool + slot.count;
        bag[index] = null;
      };

      // 仓库里右键「聚焦」时，相机要飞过去的点
      let focusTarget: Point | null = null;
      // 哪些建筑产出哪种资源。查不到就说明这种东西只能靠采集，没有可聚焦的点。
      const PRODUCER_OF: Record<string, string> = { food: 'farm', meal: 'stove', medicine: 'medicalBed' };
      let tool = 'inspect';
      let terrainTarget = 6, terrainSize = 3, terrainShape: 'brush' | 'rectangle' = 'brush', terrainSample = false;
      let buildHeight: number | null = null;
      let terrainPreview = { cells: 0, cut: 0, fill: 0 };
      let previewKey = '';
      type Stroke = { target: number; shape: 'brush' | 'rectangle'; size: number; start: [number, number]; last: [number, number]; cells: Map<number, [number, number]> };
      let stroke: Stroke | null = null;
      let crop: 'rice' | 'corn' = 'rice';
      let status = '和平殖民地 · 规划家园，照顾每一位居民';
      let target: Point = [voxels.width / 2 + 3, 5, voxels.depth / 2 + 3], yaw = Math.PI / 4, pitch = 0.82, distance = 47;

      // ---- 双视角 ----
      // god = 俯视上帝视角，自由平移；character = 贴着某位居民看。
      // 切到角色视角时把俯视的构图存进 godReturn，切回来原样恢复，
      // 否则玩家切一圈回来发现自己被丢到地图角落。
      let viewMode: 'god' | 'character' = 'god';
      let followId: string | null = null;
      let godReturn = { target: [...target] as Point, yaw: Math.PI / 4, pitch: 0.82, distance: 47 };
      const FOLLOW_SMOOTH = 8;

      // ---- 玩家角色 ----
      // 不进 simulation：殖民地那套需求/工作/优先级对"你"没有意义，
      // 玩家就是玩家，不是第四个居民。位置只活在表现层。
      // 碰撞不挂物理引擎，和 Unity 那边一个思路——直接查体素，
      // 规则可预测，也不会出现"人贴着墙缝钻过去"。
      // 角色碰撞：AABB 包围盒 + 分轴扫掠，和 Unity 的 CharacterController 一个路数。
      // 之前用「四个探点 + 硬推」，三样毛病都出在那儿：
      //   探点各偏 0.32 米 → 撞墙停在半米外，看着像空气墙
      //   只探轴对齐四向 → 斜着能挤过对角缝
      //   推出一次跳半米 → 看起来像瞬移
      // 换成真实包围盒后，撞墙时位置会被压到方块表面，斜走靠分轴自然滑墙。
      const PLAYER_HALF = 0.28;   // 半宽（体宽 0.56，比方块窄一点，过 1 格门不别扭）
      const PLAYER_HEIGHT = 1.8;  // 身高
      const MOVE_STEP = 0.05;     // 每步 5 厘米，够细，撞墙误差不超过这个数
      const PLAYER_SPEED = 4.5;   // 米/秒
      const TURN_SPEED = 14;      // 转身平滑系数，和 Unity 的 PlayerController 一致
      const PLAYER_JUMP = 1.1;    // 能跳多高
      const PLAYER_GRAVITY = -26; // 重力加速度
      const player = {
        x: voxels.width / 2, z: voxels.depth / 2,
        y: 0, vy: 0, grounded: true, facing: 0, moving: false,
      };
      player.y = voxels.terrainHeight(Math.floor(player.x), Math.floor(player.z));

      /** 玩家离木箱够不够近。照 Unity 的 StorageInteract：格子曼哈顿距离 <= 1。 */
      const chestNear = () => {
        if (!chestPos) return false;
        const dx = Math.abs(Math.floor(player.x) - chestPos[0]);
        const dz = Math.abs(Math.floor(player.z) - chestPos[2]);
        return dx + dz <= 1;
      };

      /** 玩家脚边一格内（格子曼哈顿距离）最近的居民。照 Unity 的 FollowerInteract。 */
      const nearColonist = () => {
        const px = Math.floor(player.x), pz = Math.floor(player.z);
        let best: { id: string; dist: number } | null = null;
        for (const p of colonyState.colonists) {
          const cx = Math.floor(p.position[0]), cz = Math.floor(p.position[2]);
          const d = Math.abs(cx - px) + Math.abs(cz - pz);
          if (d > 1) continue;
          if (!best || d < best.dist) best = { id: p.id, dist: d };
        }
        return best;
      };

      /** 把木箱摆到玩家旁边两格，高度取那一格的地面。 */
      const placeChest = () => {
        const cx = Math.floor(player.x) + 1, cz = Math.floor(player.z);
        chestPos = [cx, voxels.terrainHeight(cx, cz), cz];
        colonyView.setChest(chestPos);
      };
      placeChest();

      /** AABB 覆盖到的格子范围，四个方向都用这个，别再用中心格近似。 */
      const boxCells = (cx: number, cz: number, footY: number) => ({
        minX: Math.floor(cx - PLAYER_HALF),
        maxX: Math.floor(cx + PLAYER_HALF - 1e-6),
        minZ: Math.floor(cz - PLAYER_HALF),
        maxZ: Math.floor(cz + PLAYER_HALF - 1e-6),
        minY: Math.floor(footY + 1e-4),
        maxY: Math.floor(footY + PLAYER_HEIGHT - 1e-6),
      });

      /** 这个位置会不会和实心方块撞上。整盒遍历，斜向自然也覆盖到了。 */
      const blocked = (cx: number, cz: number, footY: number): boolean => {
        const b = boxCells(cx, cz, footY);
        for (let x = b.minX; x <= b.maxX; x++) {
          for (let y = b.minY; y <= b.maxY; y++) {
            for (let z = b.minZ; z <= b.maxZ; z++) {
              if (!voxels.inBounds(x, y, z)) return true;
              if (voxels.get(x, y, z) !== BLOCK.Air) return true;
            }
          }
        }
        return pcgView.blocks([cx - PLAYER_HALF, footY + 1e-4, cz - PLAYER_HALF], [cx + PLAYER_HALF, footY + PLAYER_HEIGHT, cz + PLAYER_HALF]);
      };

      /** 脚下这片（整个 AABB 覆盖范围）最高的地面高度，取最高才不会踩进旁边的高台。 */
      const groundUnder = (cx: number, cz: number, fromY: number, maximum = fromY + .25): number => {
        const b = boxCells(cx, cz, fromY);
        const start = Math.min(voxels.height - 1, b.minY);
        let top = 0;
        for (let x = b.minX; x <= b.maxX; x++) {
          for (let z = b.minZ; z <= b.maxZ; z++) {
            for (let y = start; y >= 0; y--) {
              if (voxels.get(x, y, z) !== BLOCK.Air) { if (y + 1 > top) top = y + 1; break; }
            }
          }
        }
        return pcgView.supportHeight(cx - PLAYER_HALF, cz - PLAYER_HALF, cx + PLAYER_HALF, cz + PLAYER_HALF, top, maximum);
      };

      /**
       * 沿单轴推进，一小步一小步走，撞上就停在最后那个合法位置。
       * 分轴调用（先 X 再 Z）等于自动获得贴墙滑行：
       * 斜着撞墙时 X 被挡住，Z 还能继续走，人就顺着墙滑过去了。
       */
      const sweep = (axis: 0 | 1, delta: number): boolean => {
        if (Math.abs(delta) < 1e-6) return true;
        const steps = Math.max(1, Math.ceil(Math.abs(delta) / MOVE_STEP));
        const step = delta / steps;
        for (let i = 0; i < steps; i++) {
          const nx = axis === 0 ? player.x + step : player.x;
          const nz = axis === 1 ? player.z + step : player.z;
          // Walk up actual generated risers/curbs, while ordinary one-cell cliffs still require jumping.
          const ground = player.grounded ? groundUnder(nx, nz, player.y) : player.y;
          const raised = ground > player.y + 1e-5 && ground <= player.y + .25001;
          const footY = raised ? ground : player.y;
          if (blocked(nx, nz, footY)) return false;
          player.x = nx;
          player.z = nz;
          if (raised) player.y = footY;
        }
        return true;
      };
      let publishElapsed = 0, simViewElapsed = 0, lastTerrainRevision = voxels.revision;
      let eye: Point = [0, 0, 0], lastEdit: Record<string, unknown> | null = null;
      let hoverCell: Point | null = null, hoverKey = '', refreshState = true, stopped = false;
      yield () => {
        stopped = true; unregister?.(); port?.removeEventListener('message', receive);
        if (cameraSystemAdded) world.removeSystem(Update, CAMERA_SYSTEM).unwrap();
        if (editSystemAdded) world.removeSystem(Update, EDIT_SYSTEM).unwrap();
        world.removeResource('voxel:read');
        colonyView.dispose(); terrainView.dispose(); pcgView.dispose();
        for (const entity of entities) world.despawn(entity).unwrap();
        for (const handle of ownedHandles) assets.release(handle).unwrap();
        ownedHandles.clear();
      };
      const track = (entity: EntityHandle) => {
        entities.add(entity); return entity;
      };
      const terrainMaterial = own(assets.create(Materials.standard({
        baseColor: [1, 1, 1, 1], metallic: 0, roughness: 0.94,
      })).unwrap());
      const ghost = (rgba: [number, number, number, number]) => own(assets.create(Materials.unlit(rgba, {
        renderState: {
          cullMode: 'none', depthWriteEnabled: false,
          blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } },
        }, queue: RenderQueue.Transparent,
      })).unwrap());
      const buildMaterial = ghost([0.25, 0.95, 0.52, 0.32]);
      const removeMaterial = ghost([1, 0.24, 0.2, 0.32]);
      const cursorMesh = own(assets.create(createBoxGeometry(1.015, 1.015, 1.015).unwrap()).unwrap());
      const cursor = track(world.spawn(
        { component: Name, data: { value: '建造预览' } },
        { component: Transform, data: { pos: [0, -100, 0] } },
        { component: MeshFilter, data: { assetHandle: cursorMesh } },
        { component: MeshRenderer, data: { materials: [buildMaterial] } },
        { component: ShadowParticipation, data: { cast: false, receive: false } },
      ).unwrap());
      const camera = track(world.spawn(
        { component: Name, data: { value: '家园相机' } },
        { component: Transform, data: {} },
        { component: Camera, data: { ...perspective({ fov: Math.PI / 4, aspect: 16 / 9, near: 0.1, far: 1200 }),
          antialias: ANTIALIAS_FXAA, tonemap: TONEMAP_ACES_FILMIC, exposure: 1,
          clearColor: [0.55, 0.73, 0.76, 1] } },
      ).unwrap());
      setActiveCamera(world, camera);
      const sunEntity = track(world.spawn({ component: Name, data: { value: '午后暖阳' } }, { component: DirectionalLight, data: {
        direction: SUN_OUTGOING_DIRECTION, color: [1, 0.89, 0.71], intensity: 3.2,
        castShadow: true, shadowDistance: 100,
      } }).unwrap());
      const sky = own((await assets.load(config.environment ?? guidText(assetGuid(PACKAGE_IDS.environment, 'environment/daylight')), 'equirect')).unwrap());
      const ambientEntity = track(world.spawn({ component: Name, data: { value: '柔和天光' } }, { component: Skylight, data: {
        equirect: sky, color: [1, 0.96, 0.86], intensity: 0.85,
      } }).unwrap());
      track(world.spawn({ component: SkyboxBackground, data: { equirect: sky, mode: SKYBOX_MODE_CUBEMAP } }).unwrap());
      release(sky);
      host.setPointerLockAllowed?.(false);

      const updateChunks = () => {
        for (const chunk of voxels.consumeDirtyChunks()) {
          const key = `${chunk.x},${chunk.y},${chunk.z}`;
          const previous = chunks.get(key), mesh = buildChunkMesh(voxels, chunk);
          if (!mesh) {
            if (previous) { world.despawn(previous.entity).unwrap(); entities.delete(previous.entity); release(previous.handle); chunks.delete(key); }
          } else if (previous) {
            assets.replace(previous.handle, mesh).unwrap();
          } else {
            const handle = own(assets.create(mesh).unwrap());
            const entity = track(world.spawn(
              { component: Name, data: { value: `体素区块 ${key}` } },
              { component: Transform, data: {} },
              { component: MeshFilter, data: { assetHandle: handle } },
              { component: MeshRenderer, data: { materials: [terrainMaterial] } },
            ).unwrap());
            chunks.set(key, { entity, handle });
          }
        }
        pcgView.update(voxels, colony.renderState().buildings);
      };
      const read = () => ({
        seed: voxels.seed, selected, mode, tool, crop, colony: colonyState, blocks: voxels.count(), nonAirCount: voxels.count(),
        edits: voxels.editCount, editCount: voxels.editCount, revision: voxels.revision,
        undo: tool.startsWith('sandbox:') && voxels.canUndo, redo: tool.startsWith('sandbox:') && voxels.canRedo, hoverCell: hoverCell ? [...hoverCell] : null,
        status, lastEdit, camera: { target: [...target], eye: [...eye], distance, yaw, pitch, mode: viewMode, followId },
        player: { x: player.x, y: player.y, z: player.z, grounded: player.grounded, moving: player.moving, facing: player.facing,
          // 给验收用：当前是不是嵌在实心方块里
          embedded: blocked(player.x, player.z, player.y),
          parts: colonyView.playerEntityCount,
          bag: bag.map((slot) => (slot ? { resource: slot.resource, count: slot.count } : null)),
          bagSelected,
          vitals: { ...vitals, gold: Math.floor((colonyState.resources as Record<string, number>).silver ?? 0) },
          chest: chestPos,
          nearColonist: viewMode === 'character' ? (nearColonist()?.id ?? null) : null,
          // 靠近提示用：贴着箱子还是贴着人
          nearHint: viewMode !== 'character' ? null
            : chestNear() ? 'chest'
            : nearColonist() ? 'follower' : null },
        chunks: chunks.size, dimensions: [voxels.width, voxels.height, voxels.depth], worldSize: [voxels.width, voxels.height, voxels.depth],
        terrain: { target: terrainTarget, size: terrainSize, shape: terrainShape, sample: terrainSample, preview: { ...terrainPreview }, minHeight: 1, maxHeight: voxels.height - 2 }, buildHeight,
        pcg: pcgView.read(),
      });
      const publish = () => {
        const state = read();
        world.insertResource('voxel:read', Object.freeze(state));
        port?.postMessage({ type: 'voxel:state', ...state });
        refreshState = false;
      };
      const changed = (message: string) => { status = message; updateChunks(); refreshState = true; };
      const home = () => {
        // 玩家视角回位 = 站回自己背后；俯视视角才是回地图中心
        if (viewMode === 'character') {
          yaw = player.facing + Math.PI; pitch = 0.36; distance = 12;
          target = [player.x, player.y + 1.1, player.z];
          refreshState = true;
          return;
        }
        const pawn = colonyState.colonists[0];
        target = pawn ? [pawn.position[0] + 1, Math.max(1, pawn.position[1] - 1), pawn.position[2] + 1] : [voxels.width / 2, 5, voxels.depth / 2];
        yaw = Math.PI / 4; pitch = 0.82; distance = 47; refreshState = true;
      };
      const execute = (command: ColonyCommand) => {
        const result = colony.command(command); status = result.message; colonyState = colony.snapshot(); refreshState = true;
        return result;
      };
      const cancelStroke = () => { stroke = null; terrainView.clearPreview(); previewKey = ''; terrainPreview = { cells: 0, cut: 0, fill: 0 }; };
      const finishStroke = () => {
        if (!stroke) return;
        const pending = stroke; cancelStroke();
        if (pending.cells.size) execute({ action: 'level', target: pending.target, cells: [...pending.cells.values()] });
      };
      const putBrush = (cells: Map<number, [number, number]>, x: number, z: number, size: number) => {
        const half = Math.floor(size / 2);
        for (let zz = Math.max(0, z - half); zz < Math.min(voxels.depth, z - half + size); zz++)
          for (let xx = Math.max(0, x - half); xx < Math.min(voxels.width, x - half + size); xx++) cells.set(xx + zz * voxels.width, [xx, zz]);
      };
      const extendStroke = (x: number, z: number) => {
        if (!stroke) return;
        if (stroke.cells.size && stroke.last[0] === x && stroke.last[1] === z) return;
        if (stroke.shape === 'rectangle') {
          stroke.cells.clear();
          for (let zz = Math.min(z, stroke.start[1]); zz <= Math.max(z, stroke.start[1]); zz++)
            for (let xx = Math.min(x, stroke.start[0]); xx <= Math.max(x, stroke.start[0]); xx++) stroke.cells.set(xx + zz * voxels.width, [xx, zz]);
        } else {
          const [sx, sz] = stroke.last, n = Math.max(1, Math.abs(x - sx), Math.abs(z - sz));
          for (let i = 0; i <= n; i++) putBrush(stroke.cells, Math.round(sx + (x - sx) * i / n), Math.round(sz + (z - sz) * i / n), stroke.size);
        }
        stroke.last = [x, z];
      };
      const loadSave = (text: string) => {
        const parsed = JSON.parse(text);
        const nextWorld = VoxelWorld.deserialize(parsed?.version === 2 ? parsed.voxel : text);
        const nextColony = new ColonySimulation(nextWorld);
        if (parsed?.version === 2) nextColony.load(parsed.colony);
        voxels = nextWorld; colony = nextColony; colonyState = colony.snapshot();
        colony.setWalkSurfaceSampler((x,z,fallback)=>pcgView.walkHeight(x,z,fallback));
        terrainView.clear(); pcgView.clear();
        cancelStroke(); terrainTarget = clamp(terrainTarget, 1, voxels.height - 2); buildHeight = null; viewMode = 'god'; followId = null;
        for (const entry of chunks.values()) { world.despawn(entry.entity).unwrap(); entities.delete(entry.entity); release(entry.handle); }
        chunks.clear();
        player.x = voxels.width / 2; player.z = voxels.depth / 2; player.y = voxels.terrainHeight(Math.floor(player.x), Math.floor(player.z)); player.grounded = true; player.vy = 0;
        lastTerrainRevision = -1; lastEdit = null; tool = 'inspect'; crop = 'rice'; home(); changed('已恢复地图、居民、任务和生产进度');
        godReturn = { target: [...target], yaw, pitch, distance };
        port?.postMessage({ type: 'voxel:loaded', data: JSON.stringify({ version: 2, voxel: voxels.serialize(), colony: colony.serialize() }) });
      };
      receive = (event: MessageEvent) => {
        const c = event.data;
        if (stopped || c?.type !== 'voxel:command') return;
        try {
          if (c.action === 'select' && PALETTE.includes(c.block)) { selected = c.block; mode = 'build'; tool = 'sandbox:build'; execute({action:'speed',value:0}); status = `沙盒 · 已选择 ${BLOCKS[selected]!.name}`; }
          if (c.action === 'mode' && (c.value === 'build' || c.value === 'remove')) { mode = c.value; tool = `sandbox:${mode}`; execute({action:'speed',value:0}); }
          if (c.action === 'tool' && typeof c.value === 'string') {
            cancelStroke(); terrainSample = false;
            tool = c.value; hoverKey = '';
            if(tool.startsWith('sandbox:')) {mode = tool.endsWith('remove')?'remove':'build';execute({action:'speed',value:0});status='沙盒编辑 · 已暂停居民模拟，材料无限';}
            else status = tool==='inspect'?'点击居民查看需求与工作':tool.startsWith('build:')?'安放建筑蓝图 · 先整平地基，再施工':tool==='level'?'等高整地 · 拖动规划，松开下达蓝图 · Shift 点击取样':tool.startsWith('zone:')?'点击地面规划 3 × 3 区域':'点击地面下达工作订单';
          }
          if (c.action === 'terrain-settings') {
            if (c.target !== undefined && (!Number.isInteger(c.target) || c.target < 1 || c.target > voxels.height - 2)) throw new Error(`目标高度为 1–${voxels.height - 2}`);
            if (c.size !== undefined && (!Number.isInteger(c.size) || c.size < 1 || c.size > 25)) throw new Error('笔刷宽度为 1–25 格；大范围可用框选');
            if (c.shape !== undefined && !['brush', 'rectangle'].includes(c.shape)) throw new Error('未知笔刷形状');
            if (c.target !== undefined) terrainTarget = c.target;
            if (c.size !== undefined) terrainSize = c.size;
            if (c.shape !== undefined) terrainShape = c.shape;
            previewKey = ''; hoverKey = '';
          }
          if (c.action === 'terrain-sample') { cancelStroke(); tool = 'level'; terrainSample = true; status = '点击地面取样标高，不产生整地蓝图'; }
          if (c.action === 'build-height') {
            if (c.value !== null && (!Number.isInteger(c.value) || c.value < 1 || c.value > voxels.height - 2)) throw new Error(`地基标高为 1–${voxels.height - 2}`);
            buildHeight = c.value; hoverKey = ''; previewKey = '';
          }
          if (c.action === 'colony' && c.command && typeof c.command === 'object') execute(c.command);
          if (c.action === 'crop' && (c.value === 'rice' || c.value === 'corn')) {
            if (c.value === 'corn' && !colonyState.research.completed.includes('agriculture')) status = '玉米需要先完成精耕农业研究';
            else { crop = c.value; status = crop === 'corn' ? '新农田将种植玉米' : '新农田将种植水稻'; }
          }
          if (c.action === 'focus' && typeof c.id === 'string') {const pawn=colonyState.colonists.find(p=>p.id===c.id);if(pawn){target=[...pawn.position];target[1]-=1;}}
          if (c.action === 'hover') uiHover = c.value === true;
          if (c.action === 'take') {
            const ok = takeToBag(String(c.resource || ''), Number(c.amount) || 1);
            status = ok ? '拿到手上了' : '背包放不下，或者仓库里没有了';
            refreshState = true;
          }
          if (c.action === 'drop') {
            dropFromBag(Number(c.slot) || 0);
            status = '放回仓库了';
            refreshState = true;
          }
          if (c.action === 'bagSelect') {
            bagSelected = Math.max(0, Math.min(8, Number(c.index) || 0));
            refreshState = true;
          }
          if (c.action === 'focus') {
            const kind = String(c.resource || '');
            const want = PRODUCER_OF[kind];
            const site = want ? colonyState.buildings.find((b) => b.kind === want) : undefined;
            if (site) { focusTarget = [site.x + 0.5, site.y + 1, site.z + 0.5]; status = '镜头已对准产出地'; }
            else status = '没有产出它的建筑，只能去地图上采集';
            refreshState = true;
          }
          if (c.action === 'setting') {
            if (c.key === 'invertPanX') invertPanX = c.value === true;
            if (c.key === 'invertPanY') invertPanY = c.value === true;
            if (c.key === 'panSensitivity') panSensitivity = Number(c.value) || 0.009;
            refreshState = true;
          }
          if (c.action === 'undo' && tool.startsWith('sandbox:') && voxels.undo()) changed('已撤销上一步');
          if (c.action === 'redo' && tool.startsWith('sandbox:') && voxels.redo()) changed('已重做上一步');
          if (c.action === 'reseed' && typeof c.seed === 'string' && c.seed.trim()) {
            cancelStroke(); buildHeight = null;
            voxels = new VoxelWorld(c.seed.trim().slice(0, 80)); colony = new ColonySimulation(voxels); colonyState = colony.snapshot();
            colony.setWalkSurfaceSampler((x,z,fallback)=>pcgView.walkHeight(x,z,fallback));
            terrainView.clear(); pcgView.clear();
            viewMode = 'god'; followId = null; terrainTarget = clamp(terrainTarget, 1, voxels.height - 2);
            for (const entry of chunks.values()) { world.despawn(entry.entity).unwrap(); entities.delete(entry.entity); release(entry.handle); } chunks.clear();
            player.x = voxels.width / 2; player.z = voxels.depth / 2; player.y = voxels.terrainHeight(Math.floor(player.x), Math.floor(player.z)); player.grounded = true; player.vy = 0; placeChest();
            lastEdit = null; lastTerrainRevision = -1; tool = 'inspect'; crop = 'rice'; home(); changed('新的和平殖民地已生成');
            godReturn = { target: [...target], yaw, pitch, distance };
          }
          if (c.action === 'save') port?.postMessage({ type: 'voxel:save', data: JSON.stringify({version:2,voxel:voxels.serialize(),colony:colony.serialize()}) });
          if (c.action === 'load' && typeof c.data === 'string') loadSave(c.data);
          if (c.action === 'home') home();
          if (c.action === 'status' && typeof c.value === 'string') status = c.value.slice(0, 120);
          refreshState = true;
        } catch (error) { status = error instanceof Error ? error.message : '操作失败'; refreshState = true; }
      };
      port?.addEventListener('message', receive); port?.start();
      updateChunks(); colonyView.update(colonyState,0); publish();
      unregister = host.gameProjection?.registerRead({ id: 'voxel.world', title: '和平殖民地',
        description: '程序化地图、居民需求、资源任务、设施农田、研究电力和相机的只读状态。',
        read: () => read() as unknown as GameProjectionValue,
      });
      world.addSystem(Update, {
        name: CAMERA_SYSTEM, before: [PROPAGATE_TRANSFORMS_SYSTEM], queries: [],
        fn: () => {
          const input = world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
          const dt = Math.min(world.getResource(Time).delta, 0.1);
          colony.tick(dt); publishElapsed += dt; simViewElapsed += dt;
          if (simViewElapsed >= 0.05) {
            simViewElapsed = 0;
            const renderState = colony.renderState();
            if (pcgView.update(voxels, renderState.buildings)) refreshState = true;
            // Ground the displayed residents on the same derived steps used by player collision.
            colonyView.update({ ...renderState, colonists: renderState.colonists.map(p => ({ ...p,
              position: [p.position[0], pcgView.walkHeight(p.position[0], p.position[2], p.position[1]), p.position[2]] as Point,
            })) }, world.getResource(Time).elapsed);
            if (voxels.revision !== lastTerrainRevision) {
              updateChunks(); lastTerrainRevision = voxels.revision;
              if (player.grounded) player.y = groundUnder(player.x, player.z, Math.max(player.y, voxels.terrainHeight(Math.floor(player.x), Math.floor(player.z))), Infinity);
            }
          }
          if (publishElapsed >= 0.4) {
            publishElapsed = 0; colonyState = colony.snapshot(); terrainView.update(colonyState.terrainPlans); refreshState = true;
            const day = Math.max(0, Math.sin((colonyState.hour-6)/12*Math.PI));
            world.set(sunEntity,DirectionalLight,{intensity:0.45+day*2.75}).unwrap();
            world.set(ambientEntity,Skylight,{intensity:0.38+day*0.47}).unwrap();
          }
          // 注意：外层不再用 !uiHover 包住整块。
          // 鼠标停在 HUD 上只该屏蔽「鼠标操作」，键盘走照常——
          // 否则玩家一边按 W 一边把鼠标划过快捷栏，人就会莫名其妙停住。
          if (input) {
            const k = input.keyboard;
            const dx = Number(k.downCode('KeyD') || k.downCode('ArrowRight')) - Number(k.downCode('KeyA') || k.downCode('ArrowLeft'));
            const dz = Number(k.downCode('KeyS') || k.downCode('ArrowDown')) - Number(k.downCode('KeyW') || k.downCode('ArrowUp'));

            // ---- R 切换视角 ----
            if (k.justPressedCode('KeyR')) {
              if (viewMode === 'god') {
                // 先存俯视构图，切回来才能原样还原
                godReturn = { target: [...target] as Point, yaw, pitch, distance };
                viewMode = 'character';
                followId = 'player';
                // 站到玩家背后看过去
                yaw = player.facing + Math.PI;
                pitch = 0.36;
                distance = 12;
                status = '玩家视角 · WASD 移动 / 空格跳跃 / R 切回俯视';
              } else {
                viewMode = 'god'; followId = null;
                target = [...godReturn.target] as Point;
                yaw = godReturn.yaw; pitch = godReturn.pitch; distance = godReturn.distance;
                status = '俯视视角 · R 切到玩家';
              }
              refreshState = true;
            }

            if (viewMode === 'character') {
              // 角色视角 = 玩家本人。WASD 相对相机朝向移动，空格跳跃。
              const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);
              const rgtX = Math.cos(yaw), rgtZ = -Math.sin(yaw);
              // dz 是 S - W，所以 W 对应 -dz
              let mx = rgtX * dx + fwdX * (-dz);
              let mz = rgtZ * dx + fwdZ * (-dz);
              const len = Math.hypot(mx, mz);

              if (len > 1e-4) {
                mx /= len; mz /= len;
                // 平滑转向，帧率无关：t = 1 - exp(-k*dt)，和 Unity 那边同一个公式。
                // 角度要按最短路径插值——直接线性插值会在 ±π 附近绕一大圈。
                const want = Math.atan2(mx, mz);
                const t = 1 - Math.exp(-TURN_SPEED * dt);
                let diff = ((want - player.facing + Math.PI) % (Math.PI * 2)) - Math.PI;
                if (diff < -Math.PI) diff += Math.PI * 2;
                player.facing += diff * t;
                player.moving = true;

                // 分轴推进：先 X 再 Z。
                // 斜着撞墙时 X 被挡、Z 照走，位置会被压到方块表面而不是停在半米外。
                const step = PLAYER_SPEED * dt;
                sweep(0, mx * step);
                sweep(1, mz * step);
              } else {
                player.moving = false;
              }

              // 空格在角色视角归跳跃；俯视视角仍然留给暂停
              if (k.justPressedCode('Space') && player.grounded && vitals.stamina >= 8) {
                vitals.stamina -= 8;
                player.vy = Math.sqrt(-2 * PLAYER_GRAVITY * PLAYER_JUMP);
                player.grounded = false;
                refreshState = true;
              }

              if (!player.grounded) {
                player.vy += PLAYER_GRAVITY * dt;
                const ny = player.y + player.vy * dt;
                const g = groundUnder(player.x, player.z, player.y + 0.1);
                if (ny <= g) { player.y = g; player.vy = 0; player.grounded = true; }
                else player.y = ny;
              } else {
                // 走出台沿：脚下空了就开始掉
                const g = groundUnder(player.x, player.z, player.y + 0.1);
                if (player.y > g + 0.05) { player.grounded = false; player.vy = 0; }
                else player.y = g;
              }

              // 相机跟着玩家，不是跟着居民了
              const desired: Point = [player.x, player.y + 1.1, player.z];
              const t = 1 - Math.exp(-FOLLOW_SMOOTH * dt);
              target[0] += (desired[0] - target[0]) * t;
              target[1] += (desired[1] - target[1]) * t;
              target[2] += (desired[2] - target[2]) * t;

              yaw += (Number(k.downCode('KeyE')) - Number(k.downCode('KeyQ'))) * dt * 1.2;
              if (!uiHover) {
                if (input.mouse.button(1)) {
                  yaw -= input.mouse.movementDelta.x * 0.005;
                  pitch = clamp(pitch + input.mouse.movementDelta.y * 0.004, 0.15, 1.2);
                }
                distance = clamp(distance * Math.exp(clamp(input.mouse.wheelDelta, -3, 3) * 0.12), 5, 40);
              }
            } else {
              // 聚焦飞行：有目标就先飞过去，路上不响应拖动
              if (focusTarget) {
                const t = 1 - Math.exp(-7 * dt);
                target[0] += (focusTarget[0] - target[0]) * t;
                target[2] += (focusTarget[2] - target[2]) * t;
                if (Math.hypot(focusTarget[0] - target[0], focusTarget[2] - target[2]) < 0.05) focusTarget = null;
              }
              // 俯视视角：原来的自由平移 + 环绕 + 缩放
              const speed = distance * 0.32 * dt;
              target[0] = clamp(target[0] + (Math.cos(yaw) * dx + Math.sin(yaw) * dz) * speed, 0, voxels.width);
              target[2] = clamp(target[2] + (-Math.sin(yaw) * dx + Math.cos(yaw) * dz) * speed, 0, voxels.depth);
              yaw += (Number(k.downCode('KeyE')) - Number(k.downCode('KeyQ'))) * dt * 1.2;
              if (!uiHover) {
                if (input.mouse.button(1)) {
                  yaw -= input.mouse.movementDelta.x * 0.005;
                  pitch = clamp(pitch + input.mouse.movementDelta.y * 0.004, 0.35, 1.25);
                }
                // 右键按住拖动 = 平移镜头，和 Unity 那边手感一致。
                // 拉得越远，同样的像素位移扫过的地面越多，所以系数带上 distance。
                if (input.mouse.button(2)) {
                  const k2 = distance * panSensitivity;
                  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
                  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
                  // 方向照 Unity 的 GridCamera.HandleDragPan：
                  //   pivot += (right * dx + forward * dy) * scale
                  // 是加不是减。DOM 的 movementY 向下为正，Unity 的 delta.y 向上为正，
                  // 所以垂直那一项要取负号，否则「抓地图」的手感会反。
                  const mx = input.mouse.movementDelta.x * k2 * (invertPanX ? -1 : 1);
                  const mz = -input.mouse.movementDelta.y * k2 * (invertPanY ? -1 : 1);
                  target[0] = clamp(target[0] + rx * mx + fx * mz, 0, voxels.width);
                  target[2] = clamp(target[2] + rz * mx + fz * mz, 0, voxels.depth);
                }
                // Engine wheelDelta is a signed notch accumulator, not DOM pixel deltaY.
                distance = clamp(distance * Math.exp(clamp(input.mouse.wheelDelta, -3, 3) * 0.12), 15, 100);
              }
              // Engine wheelDelta is a signed notch accumulator, not DOM pixel deltaY.
              distance = clamp(distance * Math.exp(clamp(input.mouse.wheelDelta, -3, 3) * 0.12), 15, Math.max(100, Math.max(voxels.width, voxels.depth) * 1.4));
            }

            if (k.justPressedCode('KeyF')) home();
            // 空格：俯视视角是暂停，玩家视角留给跳跃（上面已处理）
            if (k.justPressedCode('Space') && viewMode === 'god') execute({action:'speed',value:colonyState.speed===0?1:0});
            if (k.justPressedCode('Escape')) {cancelStroke();terrainSample=false;tool='inspect';refreshState=true;}
            if (dx || dz || input.mouse.button(1) || input.mouse.button(2) || input.mouse.wheelDelta) refreshState = true;
          }
          const horizontal = distance * Math.cos(pitch);
          eye = [target[0] + Math.sin(yaw) * horizontal, target[1] + Math.sin(pitch) * distance, target[2] + Math.cos(yaw) * horizontal];
          const rotation = quat.fromLookAt(quat.create(), eye, target, [0, 1, 0]);
          world.set(camera, Transform, { pos: eye, quat: [rotation[0]!, rotation[1]!, rotation[2]!, rotation[3]!] }).unwrap();
          // 玩家每帧单独更新，不跟殖民地的 20Hz 快照走
          colonyView.updatePlayer(player, world.getResource(Time).elapsed);
        },
      }).unwrap();
      cameraSystemAdded = true;
      world.addSystem(Update, {
        name: EDIT_SYSTEM, after: [PROPAGATE_TRANSFORMS_SYSTEM], queries: [],
        fn: () => {
          const input = world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
          const size = host.drawingBufferSize?.() ?? { width: host.canvas?.width ?? 1280, height: host.canvas?.height ?? 720 };
          const releasedStroke = !!stroke && !!input && (!input.mouse.button(0) || input.mouse.justReleased(0));
          if (input && !uiHover) {
            const k = input.keyboard, ctrl = k.downCode('ControlLeft') || k.downCode('ControlRight') || k.downCode('MetaLeft') || k.downCode('MetaRight');
            const sandbox = tool.startsWith('sandbox:');
            if (sandbox && ctrl && k.justPressedCode('KeyZ')) { if (voxels.undo()) changed('已撤销上一步'); }
            else if (sandbox && ctrl && k.justPressedCode('KeyY')) { if (voxels.redo()) changed('已重做上一步'); }
            if(sandbox) PALETTE.forEach((block, index) => { if (k.justPressedCode(`Digit${index + 1}`)) { selected = block; mode = 'build'; tool='sandbox:build'; refreshState = true; } });
            else {if(k.justPressedCode('Digit1'))execute({action:'speed',value:1});if(k.justPressedCode('Digit2'))execute({action:'speed',value:3});if(k.justPressedCode('Digit3'))execute({action:'speed',value:6});}
            if (k.justPressedCode('KeyB')) { if(sandbox){mode='build';tool='sandbox:build';}else tool='build:wall';refreshState=true; }
            if (k.justPressedCode('KeyX')) { if(sandbox){mode='remove';tool='sandbox:remove';}else tool='cancel';refreshState=true; }
            const m = input.mouse.position;
            const r = m ? viewportToWorld(world, camera, m.x, m.y, size.width, size.height) : undefined;
            const hit = r ? voxels.raycast(Array.from(ray.getOrigin(vec3.create(), r)) as Point, Array.from(ray.getDirection(vec3.create(), r)) as Point, 1200) : null;
            const removing = sandbox && (mode === 'remove' || input.mouse.button(2));
            const paving = sandbox && !removing && selected === BLOCK.Road;
            const roadAllowed = !!hit && hit.normal?.[1] === 1 && !([BLOCK.Air, BLOCK.Water, BLOCK.Wood, BLOCK.Leaves] as readonly number[]).includes(hit.block)
              && !colonyState.buildings.some(b => hit.cell[0] >= b.x && hit.cell[0] < b.x + b.w && hit.cell[2] >= b.z && hit.cell[2] < b.z + b.d);
            const cell = hit ? (sandbox ? (removing || paving ? hit.cell : hit.adjacent) : [hit.cell[0],voxels.terrainHeight(hit.cell[0],hit.cell[2]),hit.cell[2]] as Point) : null;
            const point: Point | null = cell ? [...cell] : null;
            const valid = point !== null && voxels.inBounds(...point) && point[1] > 0 && (!sandbox || removing || (paving ? roadAllowed : voxels.get(...point) === 0 || voxels.get(...point) === 8));
            hoverCell = valid ? point : null;
            // Include a final mouse move delivered in the same frame as release.
            if (releasedStroke && stroke) {
              if (hoverCell) extendStroke(hoverCell[0], hoverCell[2]);
              finishStroke();
            }
            const nextKey = `${hoverCell?.join(',') ?? ''}:${removing}:${selected}:${tool}`;
            if (nextKey !== hoverKey) {
              hoverKey = nextKey; refreshState = true;
              const footprint = tool.startsWith('build:') ? BUILDING_DEFS[tool.slice(6) as BuildingKind]?.footprint ?? [1, 1] : tool.startsWith('zone:') ? [3, 3] : [1, 1];
              const [w, d] = footprint;
              const surfacePreview = paving && !removing;
              world.set(cursor, Transform, { pos: hoverCell && tool!=='inspect' && tool!=='level' ? [hoverCell[0] + w!/2, (tool.startsWith('build:') ? buildHeight ?? hoverCell[1] : hoverCell[1]) + (surfacePreview ? 1.04 : sandbox ? .5 : .04), hoverCell[2] + d!/2] : [0, -100, 0],scale:surfacePreview?[1,.08,1]:sandbox?[1,1,1]:[w!,.08,d!] }).unwrap();
              world.set(cursor, MeshRenderer, { materials: [removing ? removeMaterial : buildMaterial] }).unwrap();
            }
            if (tool === 'level' && hoverCell) {
              const [x, y, z] = hoverCell;
              if (input.mouse.justPressed(2)) { cancelStroke(); terrainSample = false; tool = 'inspect'; status = '已取消当前工具'; refreshState = true; }
              else if (input.mouse.justPressed(0)) {
                if (terrainSample || k.downCode('ShiftLeft') || k.downCode('ShiftRight')) {
                  terrainTarget = clamp(y, 1, voxels.height - 2); terrainSample = false; previewKey = ''; status = `已取样地面标高 ${terrainTarget}`; refreshState = true;
                } else {
                  stroke = { target: terrainTarget, size: terrainSize, shape: terrainShape, start: [x, z], last: [x, z], cells: new Map() }; extendStroke(x, z);
                }
              } else if (stroke && input.mouse.button(0)) extendStroke(x, z);
            }
            if ((tool === 'level' || tool.startsWith('build:')) && hoverCell) {
              const [x, , z] = hoverCell, height = stroke?.target ?? (tool === 'level' ? terrainTarget : buildHeight ?? hoverCell[1]);
              const key = `${tool}:${voxels.revision}:${x}:${z}:${height}:${terrainSize}:${terrainShape}:${stroke?.cells.size ?? 0}:${stroke?.start.join(',') ?? ''}`;
              if (key !== previewKey) {
                previewKey = key;
                const cells = stroke ? new Map(stroke.cells) : new Map<number, [number, number]>();
                if (!stroke) {
                  if (tool === 'level') putBrush(cells, x, z, terrainShape === 'rectangle' ? 1 : terrainSize);
                  else {
                    const [w, d] = BUILDING_DEFS[tool.slice(6) as BuildingKind]?.footprint ?? [1, 1];
                    for (let zz = z; zz < Math.min(z + d, voxels.depth); zz++) for (let xx = x; xx < Math.min(x + w, voxels.width); xx++) cells.set(xx + zz * voxels.width, [xx, zz]);
                  }
                }
                terrainPreview = { cells: cells.size, cut: 0, fill: 0 };
                for (const [xx, zz] of cells.values()) { const actual = voxels.terrainHeight(xx, zz); terrainPreview.cut += Math.max(0, actual - height); terrainPreview.fill += Math.max(0, height - actual); }
                terrainView.preview([...cells.values()], height, key); refreshState = true;
              }
            } else if (!stroke) { terrainView.clearPreview(); previewKey = ''; }
            if (!sandbox && tool !== 'level' && hit && (input.mouse.justPressed(0) || input.mouse.justPressed(2))) {
              const x=hit.cell[0],z=hit.cell[2];
              if(input.mouse.justPressed(2)){
                // 角色视角下贴着东西右键 = 打开它。箱子优先于随从（箱子不会自己走开）。
                // 俯视视角不接这个键，那里右键是拖镜头和取消工具。
                const chestHere = viewMode === 'character' && chestNear();
                const near = viewMode === 'character' ? nearColonist() : null;
                if (chestHere) { port?.postMessage({ type: 'voxel:openChest' }); status = '打开木箱'; }
                else if (near) { port?.postMessage({ type: 'voxel:openFollower', id: near.id }); status = '打开随从'; }
                else { tool='inspect'; status='已取消当前工具'; }
                refreshState=true;
              }

              else if(tool.startsWith('build:'))execute({action:'build',kind:tool.slice(6),x,z,target:buildHeight ?? voxels.terrainHeight(x,z)});
              else if(tool.startsWith('zone:'))execute({action:'designate',kind:tool.slice(5),x,z,w:3,d:3,crop});
              else if(['chop','mine','harvest'].includes(tool))execute({action:'designate',kind:tool,x,z});
              else if(tool==='cancel'){
                const b=colonyState.buildings.find(b=>x>=b.x&&x<b.x+b.w&&z>=b.z&&z<b.z+b.d&&!b.complete);
                const plan=colonyState.terrainPlans.find(p=>p.state!=='completed'&&p.cells.some(([xx,zz])=>xx===x&&zz===z));
                const job=colonyState.jobs.find(j=>j.x===x&&j.z===z);
                const zone=colonyState.zones.find(q=>x>=q.x&&x<q.x+q.w&&z>=q.z&&z<q.z+q.d);
                if(b||plan||job||zone)execute({action:'cancel',id:(b??plan??job??zone)!.id});else{status='此处没有可取消的规划';refreshState=true;}
              }else{
                const o=r?Array.from(ray.getOrigin(vec3.create(),r))as Point:[0,0,0]as Point;
                const d=r?Array.from(ray.getDirection(vec3.create(),r))as Point:[0,0,0]as Point;
                const picks=colonyState.colonists.map(p=>{const v=[p.position[0]-o[0],p.position[1]+.8-o[1],p.position[2]-o[2]];const t=v[0]!*d[0]+v[1]!*d[1]+v[2]!*d[2];return{p,t,dist:Math.hypot(v[0]!-d[0]*t,v[1]!-d[1]*t,v[2]!-d[2]*t)};}).filter(q=>q.t>0&&q.dist<.8).sort((a,b)=>a.t-b.t);
                const pawn=picks[0]?.p??colonyState.colonists.find(p=>Math.hypot(p.position[0]-(x+.5),p.position[2]-(z+.5))<1.1);
                if(pawn)execute({action:'select',colonistId:pawn.id});
                else{const b=colonyState.buildings.find(b=>x>=b.x&&x<b.x+b.w&&z>=b.z&&z<b.z+b.d);status=b?`${BUILDING_DEFS[b.kind as BuildingKind].name} · ${b.complete?'已建成':b.phase==='preparingTerrain'?'准备地基':`施工 ${Math.round(b.progress*100)}%`}${b.blockedReason?` · ${b.blockedReason}`:''}`:`地块 [${x}, ${z}] · 地面标高 ${voxels.terrainHeight(x,z)}`;refreshState=true;}
              }
            }
            if (sandbox && hit && (input.mouse.justPressed(0) || input.mouse.justPressed(2))) {
              const shouldRemove = input.mouse.justPressed(2) || mode === 'remove';
              const paintRoad = !shouldRemove && selected === BLOCK.Road;
              const editCell = shouldRemove || paintRoad ? hit.cell : hit.adjacent;
              if (editCell && voxels.inBounds(...editCell) && editCell[1] > 0) {
                const block = shouldRemove ? 0 : selected;
                if (shouldRemove || (paintRoad ? roadAllowed : voxels.get(...editCell) === 0 || voxels.get(...editCell) === 8)) {
                  try {
                    if (voxels.edit([{ x: editCell[0], y: editCell[1], z: editCell[2], block }])) {
                      lastEdit = { x: editCell[0], y: editCell[1], z: editCell[2], block, action: shouldRemove ? 'remove' : 'build' };
                      changed(shouldRemove ? '已拆除方块 · 周边细节已更新 · Ctrl + Z 撤销' : paintRoad ? '已铺设道路 · 人行道与高差台阶自动连接 · Ctrl + Z 撤销' : `已放置${BLOCKS[selected]!.name} · Ctrl + Z 撤销`);
                    }
                  } catch (error) { status = error instanceof Error ? error.message : '此处无法建造'; refreshState = true; }
                }
              }
            }
          } else if (hoverCell) {
            hoverCell = null; hoverKey = ''; if(!stroke){terrainView.clearPreview();previewKey='';} world.set(cursor, Transform, { pos: [0, -100, 0] }).unwrap(); refreshState = true;
          }
          // Releasing over a panel commits only the area already painted on the map.
          if (releasedStroke && stroke) finishStroke();
          if (refreshState) publish();
        },
      }).unwrap();
      editSystemAdded = true;
    }, 'voxel-world');
  },
};

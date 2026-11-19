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
  orthographic, perspective, setActiveCamera, SkyboxBackground, Skylight, SKYBOX_MODE_CUBEMAP,
  TONEMAP_ACES_FILMIC, ShadowParticipation,
} from '@forgeax/engine/render';
import { Name, PROPAGATE_TRANSFORMS_SYSTEM, Transform } from '@forgeax/engine/scene';
import { skinningPlugin } from '@forgeax/engine/skinning';
import { RenderQueue, type AssetHandle } from '@forgeax/engine/types';
import { assetGuid, guidText, PACKAGE_IDS, SUN_OUTGOING_DIRECTION } from '../shared/asset-refs.ts';
import { BLOCK, BLOCKS, VoxelWorld } from './model.ts';
import { buildChunkMesh } from './mesh.ts';
import { PcgView } from './pcg/view.ts';
import { TreeView } from './tree-view.ts';
import { treeParts, type TreeInstance } from './trees.ts';
import { overlaps, raycastTree, treesBlockBox, treeSupportHeight, treeProtectingVoxel } from './tree-interaction.ts';
import { ColonySimulation, playerTerrainRule, withinPlayerWorkReach, withinTerrainReach } from '../colony/simulation.ts';
import { ColonyView, type BuildingModel } from '../colony/view.ts';
import type { CharacterAssets } from '../colony/character-view.ts';
import { TerrainPlanView } from '../colony/terrain-view.ts';
import {
  BUILDING_DEFS, HAMMER, AXE, PICKAXE, buildingItemKind, isCropSeed, needsPickaxe, PLAYER_DEMOLISH_RATE, PLAYER_DEMOLISH_RATE_TOOL, PLAYER_CHOP_SECONDS, PLAYER_CHOP_SECONDS_AXE,
  PLAYER_CHOP_STAMINA, PLAYER_CHOP_STAMINA_AXE, PLAYER_STAMINA_REGEN, CHOP_WORK, workPercent,
  CROP_DEFS, DEFAULT_CROP, RESEARCH_DEFS, isCropKind, type CropKind, type BuildingKind, type ColonyCommand, type ChestView,
} from '../colony/contracts.ts';
import { CropCards } from '../colony/crop-cards.ts';
import { buildingDimensions, type BuildingPart } from '../colony/buildings.ts';
import { DUSK_SECONDS, PAN_SECONDS, FINALE_SECONDS, smooth } from '../colony/plaza.ts';
import { raycastBuilding, raycastCrop, buildingProtectingVoxel } from '../colony/interaction.ts';

type Point = [number, number, number];
const PALETTE = [5, 3, 4, 6, 1, 2, 10];
const CAMERA_SYSTEM = 'voxel-camera';
const EDIT_SYSTEM = 'voxel-edit';
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export const voxelGame: Plugin.Object<{ readonly environment?: string; evening:string; scene: string; outfits: string[]; walks: string[]; buildings: Record<string,string>; plaza:Record<string,string> }> = {
  name: 'voxel-homestead',
  inject: ['world', 'assets', 'gameHost'],
  async apply(ctx, config) {
    ctx.plugin(skinningPlugin());
    const world = ctx.world, assets = ctx.assets!, host = ctx.gameHost!;
    const port = host.port;
    await ctx.effect(async function* () {
      let voxels = new VoxelWorld();
      let colony = new ColonySimulation(voxels);
      let colonyState = colony.snapshot();
      const cropCards = await CropCards.create(world, assets);
      let colonyView: ColonyView;
      const terrainView = new TerrainPlanView(world, assets, () => voxels);
      const pcgView = new PcgView(world, assets);
      const treeView = new TreeView(world, assets);
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
      const vitals = { maxHealth: 100, stamina: 100, maxStamina: 100 };

      // 仓库里右键「聚焦」时，相机要飞过去的点
      let focusTarget: Point | null = null;
      // 哪些建筑产出哪种资源。查不到就说明这种东西只能靠采集，没有可聚焦的点。
      const PRODUCER_OF: Record<string, string> = { food: 'farm', meal: 'stove', medicine: 'medicalBed' };
      let tool = 'inspect';
      let buildRotation = 0, selectedBuildingId: string | null = null;
      let hoverBuildingId: string | null = null, hoverBuildingPart: BuildingPart | null = null;
      let selectedTreeId: string | null = null, hoverTreeId: string | null = null;
      // 玩家手工拆建筑：按住左键推进，换目标或松手归零。
      let playerDemolish: { id: string; progress: number } | null = null;
      let playerExcavation: {target:string;seconds:number} | null = null;
      let manualCropEdits = 0;
      let waitForLeftRelease = false;
      let demolitionHint: string | null = null;
      let destructionProgress: number | null = null;
      let hoverTreePart: 'trunk' | 'branch' | 'crown' | null = null;
      let terrainTarget = 6, terrainSize = 3, terrainShape: 'brush' | 'rectangle' = 'brush', terrainSample = false;
      let buildHeight: number | null = null;
      let terrainPreview = { cells: 0, cut: 0, fill: 0 };
      let previewKey = '';
      type Stroke = { target: number; shape: 'brush' | 'rectangle'; size: number; start: [number, number]; last: [number, number]; cells: Map<number, [number, number]> };
      let stroke: Stroke | null = null;
      let crop: CropKind = DEFAULT_CROP;
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
      type CameraPose={target:Point;yaw:number;pitch:number;distance:number};
      let beforeFinale:(CameraPose & {resident:string|null})|null=null;
      let screenBlend=0;
      const blendPose=(from:CameraPose,to:CameraPose,t:number)=>{
        target=from.target.map((v,i)=>v+(to.target[i]!-v)*t) as Point;
        const delta=to.yaw-from.yaw;
        yaw=from.yaw+Math.atan2(Math.sin(delta),Math.cos(delta))*t;
        pitch=from.pitch+(to.pitch-from.pitch)*t;
        distance=from.distance+(to.distance-from.distance)*t;
      };

      // ---- 玩家角色 ----
      // 不进 simulation：殖民地那套需求/工作/优先级对"你"没有意义，
      // 物理控制器在附身时接管村民的姿态。
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
      const connectPlayerOccupancy = () => colony.setExternalOccupancySampler((x,y,z,w,h,d) =>
        followId!==null && player.x + PLAYER_HALF > x && player.x - PLAYER_HALF < x+w && player.z + PLAYER_HALF > z && player.z - PLAYER_HALF < z+d && player.y + PLAYER_HEIGHT > y && player.y < y+h);
      connectPlayerOccupancy();

      const nearChest = (hitX?: number, hitZ?: number) => {
        const px = Math.floor(player.x), pz = Math.floor(player.z);
        let nearest: ChestView | undefined;
        let distance = Infinity;
        for (const chest of colonyState.chests) {
          if (Math.abs(px - chest.x) > 1 || Math.abs(pz - chest.z) > 1) continue;
          if (chest.x === hitX && chest.z === hitZ) return chest;
          const candidate = Math.hypot(player.x - chest.x - .5, player.z - chest.z - .5);
          if (candidate < distance) { nearest = chest; distance = candidate; }
        }
        return nearest;
      };

      /** 玩家脚边一格内（格子曼哈顿距离）最近的居民。照 Unity 的 FollowerInteract。 */
      const nearColonist = () => {
        const px = Math.floor(player.x), pz = Math.floor(player.z);
        let best: { id: string; dist: number } | null = null;
        for (const p of colonyState.colonists) {
          if(p.id===followId)continue;
          const cx = Math.floor(p.position[0]), cz = Math.floor(p.position[2]);
          const d = Math.abs(cx - px) + Math.abs(cz - pz);
          if (d > 1) continue;
          if (!best || d < best.dist) best = { id: p.id, dist: d };
        }
        return best;
      };

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
              if (colony.blocksVoxel(x, y, z)) return true;
            }
          }
        }
        const min: Point = [cx - PLAYER_HALF, footY + 1e-4, cz - PLAYER_HALF], max: Point = [cx + PLAYER_HALF, footY + PLAYER_HEIGHT, cz + PLAYER_HALF];
        return treesBlockBox(voxels, min, max) || pcgView.blocks(min, max);
      };

      /** 脚下这片（整个 AABB 覆盖范围）最高的地面高度，取最高才不会踩进旁边的高台。 */
      const groundUnder = (cx: number, cz: number, fromY: number, maximum = fromY + .25): number => {
        const b = boxCells(cx, cz, fromY);
        const start = Math.min(voxels.height - 1, b.minY);
        let top = 0;
        for (let x = b.minX; x <= b.maxX; x++) {
          for (let z = b.minZ; z <= b.maxZ; z++) {
            for (let y = start; y >= 0; y--) {
              if (voxels.get(x, y, z) !== BLOCK.Air || colony.blocksVoxel(x,y,z)) { if (y + 1 > top) top = y + 1; break; }
            }
          }
        }
        top = treeSupportHeight(voxels, cx - PLAYER_HALF, cz - PLAYER_HALF, cx + PLAYER_HALF, cz + PLAYER_HALF, top, Math.min(maximum, fromY + .25));
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
        colonyView?.dispose(); terrainView.dispose(); pcgView.dispose(); treeView.dispose(); cropCards.dispose();
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
      const cameraStyle={antialias:ANTIALIAS_FXAA,tonemap:TONEMAP_ACES_FILMIC,exposure:1,
        clearColor:[.55,.73,.76,1] as [number,number,number,number]};
      const camera = track(world.spawn(
        { component: Name, data: { value: '家园相机' } },
        { component: Transform, data: {} },
        { component: Camera, data: { ...perspective({ fov: Math.PI / 4, aspect: 16 / 9, near: 0.1, far: 1200 }),
          ...cameraStyle } },
      ).unwrap());
      setActiveCamera(world, camera);
      const sunEntity = track(world.spawn({ component: Name, data: { value: '午后暖阳' } }, { component: DirectionalLight, data: {
        direction: SUN_OUTGOING_DIRECTION, color: [1, 0.89, 0.71], intensity: 3.2,
        castShadow: true, shadowDistance: 100,
      } }).unwrap());
      const sky = own((await assets.load(config.environment ?? guidText(assetGuid(PACKAGE_IDS.environment, 'environment/daylight')), 'equirect')).unwrap());
      const characters: CharacterAssets = {
        scene: own((await assets.load(config.scene, 'scene')).unwrap()), outfits: [], walks: [],
      };
      for (const guid of config.outfits) characters.outfits.push(own((await assets.load(guid, 'mesh')).unwrap()));
      for (const guid of config.walks) characters.walks.push(own((await assets.load(guid, 'animation-clip')).unwrap()));
      const buildingModels = new Map<string, BuildingModel>();
      for (const [kind, guid] of Object.entries(config.buildings)) {
        const mesh = own((await assets.load(guid, 'mesh')).unwrap());
        const geometry = assets.read(mesh).unwrap(), bounds = geometry.aabb!;
        // The general workbench and machining station share art but occupy different grids.
        for (const key of kind === 'fabricator' ? [kind, 'workbench'] : [kind]) {
          const { w, h, d } = buildingDimensions(key === 'doorOpen' ? 'door' : key as BuildingKind);
          const horizontal = Math.min(1, w / (bounds[3]! - bounds[0]!), d / (bounds[5]! - bounds[2]!));
          const vertical = h / (bounds[4]! - bounds[1]!);
          const structure = ['woodWall', 'brickWall', 'greenhouseWall'].includes(key);
          buildingModels.set(key, { mesh,
            scale: [horizontal, structure ? vertical : Math.min(horizontal, vertical), horizontal] });
        }
      }
      const plazaMeshes=new Map<string,AssetHandle<'mesh'>>();
      for (const [layer,guid] of Object.entries(config.plaza)) plazaMeshes.set(layer,own((await assets.load(guid,'mesh')).unwrap()));
      colonyView = new ColonyView(world, assets, () => voxels, characters, cropCards, buildingModels, pcgView.windowedWalls,plazaMeshes);
      const ambientEntity = track(world.spawn({ component: Name, data: { value: '柔和天光' } }, { component: Skylight, data: {
        equirect: sky, color: [1, 0.96, 0.86], intensity: 0.85,
      } }).unwrap());
      const evening=own((await assets.load(config.evening,'equirect')).unwrap());
      const backdrop=track(world.spawn({ component: SkyboxBackground, data: { equirect: sky, mode: SKYBOX_MODE_CUBEMAP } }).unwrap());
      let nightSky=false;
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
        treeView.update(voxels, selectedTreeId);
      };
      const firstChestPosition = (): Point | null => {
        const chest = colonyState.buildings.find(b => b.storage);
        return chest ? [chest.x, chest.y, chest.z] : null;
      };
      const read = () => ({
        seed: voxels.seed, generatorVersion: voxels.generatorVersion, selected, mode, tool, crop, colony: colonyState, blocks: voxels.count(), nonAirCount: voxels.count(),
        minerals: { steelOre: { cells: voxels.count(BLOCK.SteelOre) } },
        edits: voxels.editCount, editCount: voxels.editCount, revision: voxels.revision, manualCropEdits,
        undo: tool.startsWith('sandbox:') && voxels.canUndo, redo: tool.startsWith('sandbox:') && voxels.canRedo, hoverCell: hoverCell ? [...hoverCell] : null,
        status: demolitionHint ?? status, lastEdit, buildRotation, selectedBuildingId, hoverBuildingId, hoverBuildingPart: hoverBuildingPart ? {...hoverBuildingPart} : null,
        selectedTreeId, hoverTreeId, hoverTreePart, trees: voxels.getTrees(), treeModel: treeView.read(),
        characters: colonyView.readCharacters(followId),
        placementPreview: colonyView.readPlacementPreview(),
        camera: { target: [...target], eye: [...eye], distance, yaw, pitch, mode: viewMode, followId },
        player: followId ? { id:followId, name:colony.controlledColonist?.name, x: player.x, y: player.y, z: player.z, grounded: player.grounded, moving: player.moving, facing: player.facing,
          // 给验收用：当前是不是嵌在实心方块里
          embedded: blocked(player.x, player.z, player.y),
          bag: colonyState.playerBag,
          bagSelected: colonyState.bagSelected,
          constructionId: colony.playerConstructionId,
          demolitionHint,
          destructionProgress,
          vitals: { ...vitals, health: colony.controlledColonist?.health??0, gold: Math.floor((colonyState.resources as Record<string, number>).silver ?? 0) },
          chest: firstChestPosition(),
          nearChest: viewMode === 'character' ? nearChest()?.id ?? null : null,
          nearColonist: viewMode === 'character' ? (nearColonist()?.id ?? null) : null,
          // 靠近提示用：贴着箱子还是贴着人
          nearHint: viewMode !== 'character' ? null
            : nearChest() ? 'chest'
            : nearColonist() ? 'follower' : null } : null,
        chunks: chunks.size, dimensions: [voxels.width, voxels.height, voxels.depth], worldSize: [voxels.width, voxels.height, voxels.depth],
        terrain: { target: terrainTarget, size: terrainSize, shape: terrainShape, sample: terrainSample, preview: { ...terrainPreview }, minHeight: 1, maxHeight: voxels.height - 2 }, buildHeight,
        pcg: pcgView.read(),
        finaleFade:screenBlend,
      });
      const publish = () => {
        const state = read();
        world.insertResource('voxel:read', Object.freeze(state));
        port?.postMessage({ type: 'voxel:state', ...state });
        refreshState = false;
      };
      const changed = (message: string) => { status = message; updateChunks(); refreshState = true; };
      const editHistory = (redo:boolean) => {
        const allow = (edits: readonly {x:number;y:number;z:number}[]) => {
          const valid=edits.every(e=>!buildingProtectingVoxel(colonyState.buildings,e.x,e.y,e.z) && !treeProtectingVoxel(voxels,e.x,e.y,e.z));
          if(!valid){status='此操作会改变设施占用格或地基，请先整体拆除设施';refreshState=true;}
          return valid;
        };
        const allowTrees = (trees: readonly TreeInstance[]) => {
          const occupied = trees.some(tree => treeParts(tree).some(part =>
            colonyState.buildings.some(b => overlaps(part.min, part.max, [b.x,b.y,b.z], [b.x+b.w,b.y+b.h,b.z+b.d])) ||
            followId!==null && overlaps(part.min, part.max, [player.x-PLAYER_HALF,player.y,player.z-PLAYER_HALF], [player.x+PLAYER_HALF,player.y+PLAYER_HEIGHT,player.z+PLAYER_HALF]) ||
            colonyState.colonists.some(p=>overlaps(part.min,part.max,[p.position[0]-.28,p.position[1],p.position[2]-.28],[p.position[0]+.28,p.position[1]+1.8,p.position[2]+.28]))));
          if(occupied){status='树木原位置已被设施或人物占用，暂时无法恢复';refreshState=true;}
          return !occupied;
        };
        if(redo?voxels.redo(allow,allowTrees):voxels.undo(allow,allowTrees))changed(redo?'已重做上一步':'已撤销上一步');
      };
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
        if (selectedBuildingId && !colonyState.buildings.some(b=>b.id===selectedBuildingId)) selectedBuildingId = null;
        if (command.action === 'select') { selectedBuildingId = null; selectedTreeId = null; }
        hoverKey = '';
        return result;
      };
      const rotateBuild = () => {
        if (!tool.startsWith('build:')) return;
        buildRotation = (buildRotation + 1) % 4; hoverKey = ''; previewKey = '';
        status = `朝向 ${['北','东','南','西'][buildRotation]} · 点击放置，R 继续旋转`; refreshState = true;
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
        connectPlayerOccupancy(); selectedBuildingId = null; hoverBuildingId = null; hoverBuildingPart = null; buildRotation = 0;
        selectedTreeId = null; hoverTreeId = null; hoverTreePart = null;
        colony.setWalkSurfaceSampler((x,z,fallback)=>pcgView.walkHeight(x,z,fallback));
        terrainView.clear(); pcgView.clear();
        cancelStroke(); terrainTarget = clamp(terrainTarget, 1, voxels.height - 2); buildHeight = null; viewMode = 'god'; followId = null;
        for (const entry of chunks.values()) { world.despawn(entry.entity).unwrap(); entities.delete(entry.entity); release(entry.handle); }
        chunks.clear();
        lastTerrainRevision = -1; lastEdit = null; tool = 'inspect'; crop = DEFAULT_CROP; home(); changed('已恢复地图、居民、任务和生产进度');
        godReturn = { target: [...target], yaw, pitch, distance };
        port?.postMessage({ type: 'voxel:loaded', data: JSON.stringify({ version: 2, voxel: voxels.serialize(), colony: colony.serialize() }) });
      };
      receive = (event: MessageEvent) => {
        const c = event.data;
        if (stopped || c?.type !== 'voxel:command') return;
        if (colony.finale && !['save','load','reset','hover'].includes(c.action)) return;
        try {
          if (c.action === 'select' && PALETTE.includes(c.block)) { selected = c.block; mode = 'build'; tool = 'sandbox:build'; execute({action:'speed',value:0}); status = `沙盒 · 已选择 ${BLOCKS[selected]!.name}`; }
          if (c.action === 'mode' && (c.value === 'build' || c.value === 'remove')) { mode = c.value; tool = `sandbox:${mode}`; execute({action:'speed',value:0}); }
          if (c.action === 'tool' && typeof c.value === 'string') {
            cancelStroke(); terrainSample = false;
            tool = c.value; hoverKey = '';
            if(tool.startsWith('sandbox:')) {mode = tool.endsWith('remove')?'remove':'build';execute({action:'speed',value:0});status='沙盒编辑 · 已暂停居民模拟，材料无限';}
            else status = tool==='inspect'?'左键选择村民，按 R 附身':tool==='place-chest'?'点击空地放置木箱':tool.startsWith('build:')?'安放建筑蓝图 · R 旋转 · 先整平地基，再施工':tool==='demolish'?'点击任一部分拆除整座设施 · 拆下后可拾取':tool==='interact'?'点击门的任一部分开关门':tool==='level'?'等高整地 · 拖动规划，松开下达蓝图 · Shift 点击取样':tool.startsWith('zone:')?'点击地面规划 3 × 3 区域':'点击地面下达工作订单';
          }
          if (c.action === 'rotateBuild') rotateBuild();
          if (c.action === 'clearSelection') { execute({action:'select'}); selectedBuildingId=null; }
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
          if (c.action === 'colony' && c.command && typeof c.command === 'object') {
            const command: ColonyCommand = c.command;
            const directDemolition = viewMode === 'character' && command.action === 'demolish'
              && colonyState.buildings.some(building => building.id === command.id && building.complete);
            if (directDemolition) {
              status = '靠近一格内再按住左键拆除';
              refreshState = true;
            } else execute(command);
          }
          const chosenCrop: unknown = c.value;
          if (c.action === 'crop' && isCropKind(chosenCrop)) {
            const { name, requires } = CROP_DEFS[chosenCrop];
            if (requires && !colonyState.research.completed.includes(requires)) status = `${name}需要先完成${RESEARCH_DEFS[requires]!.name}研究`;
            else { crop = chosenCrop; status = `新农田将种植${name}`; }
          }
          if (c.action === 'focus' && typeof c.id === 'string') {const pawn=colonyState.colonists.find(p=>p.id===c.id);if(pawn){target=[...pawn.position];target[1]-=1;}}
          if (c.action === 'hover') uiHover = c.value === true;
          if (c.action === 'inventory' || c.action === 'request-delivery') {
            const result = c.action === 'request-delivery' ? colony.requestDelivery(c.resource, c.amount)
              : colony.transferInventory(c.from, c.to, c.resource, c.amount);
            if (result.message) {
              status = result.message;
              port?.postMessage({ type: 'voxel:inventory-status', message: status });
            }
            if (result.ok) colonyState = colony.snapshot();
            refreshState = true;
          }
          if (c.action === 'bagSelect') {
            colony.selectBagSlot(c.index);
            colonyState = colony.snapshot();
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
          if (c.action === 'undo' && tool.startsWith('sandbox:')) editHistory(false);
          if (c.action === 'redo' && tool.startsWith('sandbox:')) editHistory(true);
          if (c.action === 'reseed' && typeof c.seed === 'string' && c.seed.trim()) {
            cancelStroke(); buildHeight = null;
            voxels = new VoxelWorld(c.seed.trim().slice(0, 80)); colony = new ColonySimulation(voxels); colonyState = colony.snapshot();
            connectPlayerOccupancy(); selectedBuildingId = null; hoverBuildingId = null; hoverBuildingPart = null; buildRotation = 0;
            selectedTreeId = null; hoverTreeId = null; hoverTreePart = null;
            colony.setWalkSurfaceSampler((x,z,fallback)=>pcgView.walkHeight(x,z,fallback));
            terrainView.clear(); pcgView.clear();
            viewMode = 'god'; followId = null; terrainTarget = clamp(terrainTarget, 1, voxels.height - 2);
            for (const entry of chunks.values()) { world.despawn(entry.entity).unwrap(); entities.delete(entry.entity); release(entry.handle); } chunks.clear();
            lastEdit = null; lastTerrainRevision = -1; tool = 'inspect'; crop = DEFAULT_CROP; home(); changed('新的和平殖民地已生成');
            godReturn = { target: [...target], yaw, pitch, distance };
          }
          if (c.action === 'save') {
            if(followId)colony.updateControlledPose([player.x,player.y,player.z],player.facing,vitals.stamina);
            pcgView.update(voxels, colony.renderState().buildings);
            port?.postMessage({ type: 'voxel:save', data: JSON.stringify({version:2,voxel:voxels.serialize(),colony:colony.serialize()}) });
          }
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
          const constructionId = colony.playerConstructionId;
          colony.tick(dt); publishElapsed += dt; simViewElapsed += dt;
          const finale=colony.finale;
          if (finale && !beforeFinale) {
            beforeFinale={target:[...target],yaw,pitch,distance,resident:followId};
            followId=null;viewMode='god';cancelStroke();tool='inspect';focusTarget=null;
            playerDemolish=null;playerExcavation=null;hoverCell=null;
            selectedBuildingId=null;selectedTreeId=null;hoverTreeId=null;
            terrainView.clearPreview();world.set(cursor,Transform,{pos:[0,-100,0]}).unwrap();
            colonyState=colony.snapshot();refreshState=true;
          }
          const size=host.drawingBufferSize?.();
          const aspect=size && size.height ? size.width/size.height : 16/9;
          if (!finale && beforeFinale) {
            const prior=beforeFinale;beforeFinale=null;screenBlend=0;
            target=[...prior.target];yaw=prior.yaw;pitch=prior.pitch;distance=prior.distance;
            const resident=prior.resident && colony.possessColonist(prior.resident);
            if (resident) {
              followId=resident.id;viewMode='character';[player.x,player.y,player.z]=resident.position;
              player.vy=0;player.grounded=true;player.moving=false;player.facing=resident.facing;
            }
            world.set(camera,Camera,{...perspective({fov:Math.PI/4,aspect,near:.1,far:1200}),...cameraStyle,bloom:0}).unwrap();
            status='晚会散场，居民已恢复日常安排';colonyState=colony.snapshot();refreshState=true;
          }
          if (constructionId && !colony.playerConstructionId) {
            colonyState = colony.snapshot();
            refreshState = true;
            const building = colonyState.buildings.find(candidate => candidate.id === constructionId && candidate.complete);
            if (building) {
              status = `${BUILDING_DEFS[building.kind].name}已建成`;
              port?.postMessage({ type: 'voxel:inventory-status', message: status });
            }
          }
          const delivery = colony.takeDeliveryMessage();
          if (delivery) {
            status = delivery;
            colonyState = colony.snapshot();
            refreshState = true;
            port?.postMessage({ type: 'voxel:inventory-status', message: delivery });
          }
          if (simViewElapsed >= 0.05) {
            simViewElapsed = 0;
            if (selectedTreeId && !voxels.getTree(selectedTreeId)) { selectedTreeId = null; refreshState = true; }
            treeView.update(voxels, selectedTreeId ?? hoverTreeId);
            const renderState = colony.renderState();
            if (pcgView.update(voxels, renderState.buildings)) refreshState = true;
            // Ground the displayed residents on the same derived steps used by player collision.
            const previewKind=tool.startsWith('build:')?tool.slice(6) as BuildingKind:null;
            const buildPreview=previewKind&&BUILDING_DEFS[previewKind]&&hoverCell&&!uiHover?{
              id:'placement-preview',kind:previewKind,x:hoverCell[0],y:buildHeight??hoverCell[1],z:hoverCell[2],
              ...buildingDimensions(previewKind,buildRotation),rotation:buildRotation,doorOpen:false,complete:true,progress:0,
            }:null;
            colonyView.update({ ...renderState, selectedBuildingId, buildPreview, finale,
              controlledColonistId: followId,
              colonists: renderState.colonists.map(p => ({ ...p,
              position: [p.position[0], pcgView.walkHeight(p.position[0], p.position[2], p.position[1]), p.position[2]] as Point,
            })) }, world.getResource(Time).elapsed);
            if (voxels.revision !== lastTerrainRevision) {
              updateChunks(); lastTerrainRevision = voxels.revision;
              if (followId && player.grounded) player.y = groundUnder(player.x, player.z, Math.max(player.y, voxels.terrainHeight(Math.floor(player.x), Math.floor(player.z))), Infinity);
            }
          }
          if (publishElapsed >= 0.4) {
            publishElapsed = 0; colonyState = colony.snapshot(); terrainView.update(colonyState.terrainPlans); refreshState = true;
            const day = Math.max(0, Math.sin((colonyState.hour-6)/12*Math.PI));
            const afterSunset=colonyState.hour>=19.5 || colonyState.hour<5.5;
            const atNight=afterSunset && colonyState.buildings.some(b=>b.kind==='campfirePlaza'&&b.complete);
            if (nightSky!==atNight) {
              nightSky=atNight;
              const equirect=atNight?evening:sky;
              world.set(backdrop,SkyboxBackground,{equirect}).unwrap();
              world.set(ambientEntity,Skylight,{equirect}).unwrap();
            }
            const night=finale ? (finale.phase==='gathering'?smooth(finale.elapsed/DUSK_SECONDS):1) : Number(atNight);
            world.set(sunEntity,DirectionalLight,{intensity:.45+day*2.75,color:[1-.46*night,.89-.23*night,.71+.29*night]}).unwrap();
            world.set(ambientEntity,Skylight,{intensity:.38+day*.47,color:[1-.32*night,.96-.21*night,.86+.14*night]}).unwrap();
          }
          // 注意：外层不再用 !uiHover 包住整块。
          // 鼠标停在 HUD 上只该屏蔽「鼠标操作」，键盘走照常——
          // 否则玩家一边按 W 一边把鼠标划过快捷栏，人就会莫名其妙停住。
          if (finale && beforeFinale) {
            const b=colonyState.buildings.find(b=>b.id===finale.buildingId)!;
            const entry=finale.phase==='gathering'?smooth((finale.elapsed-DUSK_SECONDS)/PAN_SECONDS):1;
            const push=finale.phase==='show'?smooth(finale.elapsed/5.5):finale.phase==='departing'?1:0;
            const exit=finale.phase==='departing'?smooth(finale.elapsed/2):0;
            const halfHeight=Math.max(12.6,18.2/aspect)*(1-.11*push);
            const shot:CameraPose={target:[b.x+b.w/2,b.y+1.8,b.z+b.d/2],yaw:Math.atan2(21,30)-b.rotation*Math.PI/2,
              pitch:.69+.025*push,distance:halfHeight/Math.tan(Math.PI/8)};
            blendPose(beforeFinale,shot,entry*(1-exit));
            if(entry===1 && exit===0){
              world.set(camera,Camera,{...orthographic({left:-halfHeight*aspect,right:halfHeight*aspect,top:halfHeight,bottom:-halfHeight,near:.1,far:1200}),...cameraStyle,bloom:1,bloomThreshold:1.3,bloomIntensity:.21}).unwrap();
            }else{
              world.set(camera,Camera,{...perspective({fov:Math.PI/4,aspect,near:.1,far:1200}),...cameraStyle,bloom:0}).unwrap();
            }
            screenBlend=finale.phase==='show'?smooth((finale.elapsed-(FINALE_SECONDS-.75))/.75)
              :finale.phase==='departing'?1-smooth(finale.elapsed/1.1):0;
          } else if (input) {
            const k = input.keyboard;
            const dx = Number(k.downCode('KeyD') || k.downCode('ArrowRight')) - Number(k.downCode('KeyA') || k.downCode('ArrowLeft'));
            const dz = Number(k.downCode('KeyS') || k.downCode('ArrowDown')) - Number(k.downCode('KeyW') || k.downCode('ArrowUp'));

            // ---- R 切换视角 ----
            if (k.justPressedCode('KeyR') && tool.startsWith('build:')) rotateBuild();
            else if (k.justPressedCode('KeyR')) {
              if (viewMode==='god') {
                const resident=tool==='inspect' ? colony.possessColonist(colonyState.selectedColonistId) : null;
                if(!resident){status='左键选中村民，再按 R 附身';}
                else {
                  godReturn={target:[...target],yaw,pitch,distance};
                  viewMode='character';followId=resident.id;
                  [player.x,player.y,player.z]=resident.position;
                  player.y=pcgView.walkHeight(player.x,player.z,player.y);
                  player.facing=resident.facing;player.vy=0;player.grounded=true;player.moving=false;
                  vitals.stamina=resident.stamina;
                  yaw=player.facing+Math.PI; pitch=.36; distance=12;
                  target=[player.x,player.y+1.1,player.z];
                  status='已附身'+resident.name+' · 再按 R 返回俯视';
                  selectedBuildingId=null;selectedTreeId=null;hoverKey='';
                  waitForLeftRelease=input.mouse.button(0);
                  colonyState=colony.snapshot();
                }
              } else {
                const ground=groundUnder(player.x,player.z,player.y+.01,Infinity);
                colony.updateControlledPose([player.x,ground>=1?ground:player.y,player.z],player.facing,vitals.stamina);
                colony.releaseControl();
                viewMode='god';followId=null;
                target=[...godReturn.target];yaw=godReturn.yaw;pitch=godReturn.pitch;distance=godReturn.distance;
                status='已返回俯视 · 左键选中村民，按 R 附身';
                demolitionHint=null;destructionProgress=null;hoverKey='';
                colonyState=colony.snapshot();
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

              // 空格只管跳跃。俯视视角按空格不做任何事——
              // 之前那里还绑了「暂停」，结果一次按键既跳又暂停，手感是坏的。
              // 跳跃不消耗体力。体力留给后面的采集/战斗，先不在这里扣。
              if (k.justPressedCode('Space') && viewMode === 'character' && player.grounded) {
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
            if (k.justPressedCode('Escape')) {cancelStroke();terrainSample=false;tool='inspect';refreshState=true;}
            if (dx || dz || input.mouse.button(1) || input.mouse.button(2) || input.mouse.wheelDelta) refreshState = true;
          }
          const horizontal = distance * Math.cos(pitch);
          eye = [target[0] + Math.sin(yaw) * horizontal, target[1] + Math.sin(pitch) * distance, target[2] + Math.cos(yaw) * horizontal];
          const rotation = quat.fromLookAt(quat.create(), eye, target, [0, 1, 0]);
          world.set(camera, Transform, { pos: eye, quat: [rotation[0]!, rotation[1]!, rotation[2]!, rotation[3]!] }).unwrap();
          if (followId) {
            colony.updateControlledPose([player.x,player.y,player.z], player.facing, vitals.stamina);
            colonyView.drawResident(colony.controlledColonist!, world.getResource(Time).elapsed,
              player.grounded, { moving:player.moving, grounded:player.grounded });
          }
        },
      }).unwrap();
      cameraSystemAdded = true;
      world.addSystem(Update, {
        name: EDIT_SYSTEM, after: [PROPAGATE_TRANSFORMS_SYSTEM], queries: [],
        fn: () => {
          const input = world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
          const size = host.drawingBufferSize?.() ?? { width: host.canvas?.width ?? 1280, height: host.canvas?.height ?? 720 };
          const releasedStroke = !!stroke && !!input && (!input.mouse.button(0) || input.mouse.justReleased(0));
          if (!input?.mouse.button(0) || input.mouse.justReleased(0)) waitForLeftRelease = false;
          let nextDemolitionHint: string | null = null;
          let nextDestructionProgress: number | null = null;
          if (input && !uiHover && !colony.finale) {
            const k = input.keyboard, ctrl = k.downCode('ControlLeft') || k.downCode('ControlRight') || k.downCode('MetaLeft') || k.downCode('MetaRight');
            const sandbox = tool.startsWith('sandbox:');
            if (sandbox && ctrl && k.justPressedCode('KeyZ')) editHistory(false);
            else if (sandbox && ctrl && k.justPressedCode('KeyY')) editHistory(true);
            if(sandbox) PALETTE.forEach((block, index) => { if (k.justPressedCode(`Digit${index + 1}`)) { selected = block; mode = 'build'; tool='sandbox:build'; refreshState = true; } });
            else if(viewMode !== 'character') {if(k.justPressedCode('Digit1'))execute({action:'speed',value:1});if(k.justPressedCode('Digit2'))execute({action:'speed',value:3});if(k.justPressedCode('Digit3'))execute({action:'speed',value:6});}
            if (k.justPressedCode('KeyB')) { if(sandbox){mode='build';tool='sandbox:build';}else tool='build:wall';refreshState=true; }
            if (k.justPressedCode('KeyX')) { if(sandbox){mode='remove';tool='sandbox:remove';}else tool='cancel';refreshState=true; }
            const m = input.mouse.position;
            const r = m ? viewportToWorld(world, camera, m.x, m.y, size.width, size.height) : undefined;
            const origin = r ? Array.from(ray.getOrigin(vec3.create(), r)) as Point : null;
            const direction = r ? Array.from(ray.getDirection(vec3.create(), r)) as Point : null;
            const hit = origin && direction ? voxels.raycast(origin, direction, 1200) : null;
            // 建筑/树的射线不能严格卡在地形距离上：
            // 角色视角平视时射线常常先扫到脚前的地面，命中距离很短，
            // 身后的床和工作台就被截掉了，看起来像「点不到」。
            // 给个至少 8 米的下限，近处的东西一定点得到。
            const pickLimit = Math.max(hit?.distance ?? 1200, 8);
            const buildingHit = origin && direction ? raycastBuilding(colonyState.buildings, origin, direction, pickLimit) : null;
            const treeHit = origin && direction ? raycastTree(voxels.getTrees(), origin, direction, buildingHit?.distance ?? pickLimit) : null;
            const objectHit = treeHit ? null : buildingHit;
            const held = colonyState.playerBag[colonyState.bagSelected]?.resource ?? null;
            const carriedBuilding = viewMode==='character' && tool==='inspect' ? buildingItemKind(held??undefined) : undefined;
            if (carriedBuilding && k.justPressedCode('KeyT')) {
              buildRotation = (buildRotation + 1) % 4;
              refreshState = true;
            }
            // 树的悬停高亮和「整棵树」面板是上帝视角的东西——那是经营视角下给随从派活用的。
            // 角色视角下鼠标指着树是要自己砍，不该弹面板抢焦点。
            const hoverTree = viewMode === 'god' ? treeHit : null;
            if (hoverTreeId !== (hoverTree?.tree.id ?? null) || hoverTreePart !== (hoverTree?.part.role ?? null)) refreshState = true;
            hoverTreeId = hoverTree?.tree.id ?? null; hoverTreePart = hoverTree?.part.role ?? null;

            const cropHit = viewMode === 'character' && tool === 'inspect' && origin && direction
              ? raycastCrop(colonyState.crops, origin, direction, Math.min(hit?.distance ?? Infinity, treeHit?.distance ?? Infinity, buildingHit?.distance ?? Infinity))
              : null;
            const demolishTarget = viewMode === 'character' && !cropHit && !sandbox && tool !== 'level' && objectHit?.building.complete
              ? objectHit.building : null;
            const playerPosition: Point = [player.x, player.y, player.z];
            const inDemolishReach = demolishTarget && objectHit
              && withinPlayerWorkReach(playerPosition, objectHit.part.x, objectHit.part.z);
            if (demolishTarget && inDemolishReach) {
              const holdLeft = input.mouse.button(0) && !waitForLeftRelease;
              const def = BUILDING_DEFS[demolishTarget.kind];
              const needPick = needsPickaxe(def);
              const wrongTool = needPick && held !== PICKAXE;
              if (!holdLeft) {
                playerDemolish = null;
                nextDemolitionHint = wrongTool ? `${def.name}需要石镐才能拆` : `按住左键拆除${def.name}`;
              } else if (wrongTool) {
                playerDemolish = null;
                nextDemolitionHint = `${def.name}需要石镐才能拆`;
              } else {
                const dtDemolish = Math.min(world.getResource(Time).delta, 0.1);
                const hasRightTool = held === (needPick ? PICKAXE : AXE);
                const rate = hasRightTool ? PLAYER_DEMOLISH_RATE_TOOL : PLAYER_DEMOLISH_RATE;
                if (!playerDemolish || playerDemolish.id !== demolishTarget.id) playerDemolish = { id: demolishTarget.id, progress: 0 };
                playerDemolish.progress += (rate * dtDemolish) / Math.max(1, def.work);
                if (playerDemolish.progress >= 1) {
                  const result = execute({ action: 'demolish', id: demolishTarget.id });
                  if (result.ok) waitForLeftRelease = true;
                  status = result.message;
                  port?.postMessage({ type: 'voxel:inventory-status', message: result.message });
                  playerDemolish = null;
                } else {
                  nextDestructionProgress = workPercent(playerDemolish.progress, 1);
                  nextDemolitionHint = `拆除${def.name} ${nextDestructionProgress}%`;
                }
              }
            } else {
              playerDemolish = null;
            }
            const demolishing = !!inDemolishReach && input.mouse.button(0);

            const terrainAhead = !objectHit || (!objectHit.building.complete && held===PICKAXE && hit && hit.distance<=objectHit.distance+.001);
            const characterTerrain = viewMode === 'character' && tool === 'inspect' && !treeHit && terrainAhead ? hit : null;
            const terrainHit = characterTerrain && withinTerrainReach(playerPosition, characterTerrain.cell) ? characterTerrain : null;
            const terrainRule = terrainHit ? playerTerrainRule(terrainHit.block) : undefined;
            const excavating = !!terrainRule && !carriedBuilding && !waitForLeftRelease && input.mouse.button(0);
            if (terrainHit && terrainRule && !carriedBuilding && !cropHit) {
              const name=BLOCKS[terrainHit.block]!.name;
              const blocked = colony.playerTerrainBlocked(terrainHit.cell);
              const equipped = held===terrainRule.tool;
              if (blocked || !equipped || !excavating) {
                playerExcavation=null;
                nextDemolitionHint = blocked ? '此处有设施、树根或作物需要保护'
                  : !equipped ? (terrainRule.tool ? `${name}需要石镐` : '切换到空格后挖土') : `按住左键挖掘${name}`;
              } else {
                const target = `${terrainHit.cell.join(',')}:${terrainHit.block}`;
                if (playerExcavation?.target!==target) playerExcavation={target,seconds:0};
                playerExcavation.seconds+=Math.min(world.getResource(Time).delta,.1);
                if (playerExcavation.seconds>=terrainRule.seconds) {
                  const result=colony.playerHarvestTerrain(terrainHit.cell,terrainHit.block,playerPosition);
                  playerExcavation=null;
                  if (result.ok) { colonyState=colony.snapshot(); changed(result.message); }
                  port?.postMessage({type:'voxel:inventory-status',message:result.message});
                } else {
                  nextDestructionProgress = workPercent(playerExcavation.seconds, terrainRule.seconds);
                  nextDemolitionHint = `挖掘${name} ${nextDestructionProgress}%`;
                }
              }
            } else playerExcavation=null;

            const plantingCell: Point | null = !isCropSeed(held) ? null
              : cropHit ? [cropHit.x, cropHit.y - 1, cropHit.z]
              : !objectHit && characterTerrain?.normal?.[1] === 1 ? characterTerrain.cell : null;
            if (plantingCell) {
              nextDemolitionHint = withinTerrainReach(playerPosition, plantingCell) ? '右键播种' : '靠近一格内再播种';
              if (input.mouse.justPressed(2)) {
                const result = colony.playerPlantCrop(plantingCell);
                if (result.ok) {
                  manualCropEdits++;
                  colonyState = colony.snapshot();
                }
                status = result.message;
                refreshState = true;
                port?.postMessage({ type: 'voxel:inventory-status', message: result.message });
              }
            }

            const placingCarried = carriedBuilding && !cropHit && !objectHit && characterTerrain?.normal?.[1] === 1;
            if (placingCarried) {
              const [x,,z]=characterTerrain.cell;
              nextDemolitionHint=`左键放置${BUILDING_DEFS[carriedBuilding].name} · T 旋转 ${buildRotation*90}°`;
              if (input.mouse.justPressed(0)) {
                const result=colony.placeCarriedBuilding(x,z,buildRotation as 0|1|2|3,playerPosition);
                if (result.ok) { colonyState=colony.snapshot(); nextDemolitionHint=null; waitForLeftRelease=true; }
                status=result.message;refreshState=true;
                port?.postMessage({type:'voxel:inventory-status',message:result.message});
              }
            }

            if (cropHit) {
              const name = CROP_DEFS[cropHit.kind].name;
              nextDemolitionHint = withinTerrainReach(playerPosition, [cropHit.x, cropHit.y - 1, cropHit.z])
                ? `左键破坏${name}` : '靠近一格内再破坏作物';
              if (input.mouse.justPressed(0) && !waitForLeftRelease) {
                const result = colony.playerBreakCrop(cropHit.id);
                if (result.ok) {
                  manualCropEdits++;
                  colonyState = colony.snapshot();
                  waitForLeftRelease = true;
                  nextDemolitionHint = null;
                }
                status = result.message;
                refreshState = true;
                port?.postMessage({ type: 'voxel:inventory-status', message: result.message });
              }
            }

            // 玩家和居民推进同一条砍伐任务，松开左键后仍能继续。
            const canopyChop = viewMode === 'character' && !cropHit && treeHit
              && withinPlayerWorkReach(playerPosition, treeHit.tree.x, treeHit.tree.z);
            const chopHeld = canopyChop && input.mouse.button(0) && !waitForLeftRelease;
            if (canopyChop && treeHit) {
              const treeId = treeHit.tree.id;
              const chopping = chopHeld && vitals.stamina > 0;
              let progress: number | null;
              if (chopping) {
                const chopDt = Math.min(world.getResource(Time).delta, 0.1);
                const hasAxe = held === AXE;
                const seconds = hasAxe ? PLAYER_CHOP_SECONDS_AXE : PLAYER_CHOP_SECONDS;
                const chip = colony.playerChipTree(treeId, (CHOP_WORK / seconds) * chopDt);
                const spent = (hasAxe ? PLAYER_CHOP_STAMINA_AXE : PLAYER_CHOP_STAMINA) * (chopDt / seconds);
                vitals.stamina = Math.max(0, vitals.stamina - spent);
                progress = chip.felled ? null : chip.progress;
                if (chip.felled) {
                  colonyState = colony.snapshot();
                  changed(chip.message);
                }
              } else {
                progress = colony.treeChopProgress(treeId);
              }
              if (progress !== null) {
                nextDestructionProgress = workPercent(progress, 1);
                const publishedJob = colonyState.jobs.find(job => job.type === 'chop' && job.targetId === treeId);
                if (!publishedJob || workPercent(publishedJob.progress, publishedJob.work) !== nextDestructionProgress) {
                  colonyState = colony.snapshot();
                  refreshState = true;
                }
              }
              if (voxels.getTree(treeId)) {
                const action = chopping ? '砍树' : chopHeld ? '体力不足，松开左键休息'
                  : progress ? '按住左键继续砍树' : '按住左键砍树';
                nextDemolitionHint = nextDestructionProgress === null ? action : `${action} ${nextDestructionProgress}%`;
              }
            }
            // 体力回复：手上没在砍就慢慢回，站着回得更快（这里不区分，先统一）
            if (followId && !chopHeld) {
              vitals.stamina = Math.min(vitals.maxStamina, vitals.stamina + Math.min(world.getResource(Time).delta, 0.1) * PLAYER_STAMINA_REGEN);
            }
            if(hoverBuildingId!==(objectHit?.building.id??null)||hoverBuildingPart?.role!==objectHit?.part.role)refreshState=true;
            hoverBuildingId=objectHit?.building.id??null; hoverBuildingPart=objectHit?.part??null;
            const removing = sandbox && (mode === 'remove' || input.mouse.button(2));
            const paving = sandbox && !removing && selected === BLOCK.Road;
            const roadAllowed = !!hit && hit.normal?.[1] === 1 && !([BLOCK.Air, BLOCK.Water, BLOCK.Wood, BLOCK.Leaves] as readonly number[]).includes(hit.block)
              && !colonyState.buildings.some(b => hit.cell[0] >= b.x && hit.cell[0] < b.x + b.w && hit.cell[2] >= b.z && hit.cell[2] < b.z + b.d);
            const objectTarget=objectHit && (sandbox || ['inspect','interact','demolish','cancel'].includes(tool));
            const treeTarget=treeHit && (sandbox || ['inspect','chop','cancel'].includes(tool));
            const cell = treeTarget ? [treeHit.tree.x,treeHit.tree.y,treeHit.tree.z] as Point : objectTarget ? [objectHit.part.x,objectHit.part.y,objectHit.part.z] as Point : hit ? (sandbox ? (removing || paving ? hit.cell : hit.adjacent) : [hit.cell[0],voxels.terrainHeight(hit.cell[0],hit.cell[2]),hit.cell[2]] as Point) : null;
            const point: Point | null = cell ? [...cell] : null;
            const valid = point !== null && voxels.inBounds(...point) && point[1] > 0 && (!sandbox || removing || (paving ? roadAllowed : voxels.get(...point) === 0 || voxels.get(...point) === 8));
            hoverCell = valid ? point : null;
            // Include a final mouse move delivered in the same frame as release.
            if (releasedStroke && stroke) {
              if (hoverCell) extendStroke(hoverCell[0], hoverCell[2]);
              finishStroke();
            }
            const nextKey = `${hoverCell?.join(',') ?? ''}:${removing}:${selected}:${tool}:${buildRotation}:${hoverBuildingId}:${hoverTreeId}`;
            if (nextKey !== hoverKey) {
              hoverKey = nextKey; refreshState = true;
              const {w,d} = tool.startsWith('build:') ? buildingDimensions(tool.slice(6) as BuildingKind,buildRotation) : tool.startsWith('zone:') ? {w:3,d:3} : {w:1,d:1};
              const surfacePreview = paving && !removing;
              const highlighted=objectTarget?objectHit.building:null;
              world.set(cursor, Transform, { pos: highlighted?[highlighted.x+highlighted.w/2,highlighted.y+.025,highlighted.z+highlighted.d/2]:hoverCell && tool!=='inspect' && tool!=='level' ? [hoverCell[0] + w/2, (tool.startsWith('build:') ? buildHeight ?? hoverCell[1] : hoverCell[1]) + (surfacePreview ? 1.04 : sandbox ? .5 : .04), hoverCell[2] + d/2] : [0, -100, 0],scale:highlighted?[highlighted.w+.04,.05,highlighted.d+.04]:surfacePreview?[1,.08,1]:sandbox?[1,1,1]:[w,.08,d] }).unwrap();
              world.set(cursor, MeshRenderer, { materials: [removing||tool==='demolish' ? removeMaterial : buildMaterial] }).unwrap();
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
              const key = `${tool}:${buildRotation}:${voxels.revision}:${x}:${z}:${height}:${terrainSize}:${terrainShape}:${stroke?.cells.size ?? 0}:${stroke?.start.join(',') ?? ''}`;
              if (key !== previewKey) {
                previewKey = key;
                const cells = stroke ? new Map(stroke.cells) : new Map<number, [number, number]>();
                if (!stroke) {
                  if (tool === 'level') putBrush(cells, x, z, terrainShape === 'rectangle' ? 1 : terrainSize);
                  else {
                    const {w,d} = buildingDimensions(tool.slice(6) as BuildingKind,buildRotation);
                    for (let zz = z; zz < Math.min(z + d, voxels.depth); zz++) for (let xx = x; xx < Math.min(x + w, voxels.width); xx++) cells.set(xx + zz * voxels.width, [xx, zz]);
                  }
                }
                terrainPreview = { cells: cells.size, cut: 0, fill: 0 };
                for (const [xx, zz] of cells.values()) { const actual = voxels.terrainHeight(xx, zz); terrainPreview.cut += Math.max(0, actual - height); terrainPreview.fill += Math.max(0, height - actual); }
                terrainView.preview([...cells.values()], height, key); refreshState = true;
              }
            } else if (!stroke) { terrainView.clearPreview(); previewKey = ''; }
            if (!sandbox && !canopyChop && !demolishing && tool !== 'level' && (hit||objectTarget||treeTarget)
              && (input.mouse.justPressed(0) && !cropHit && !placingCarried && !excavating || input.mouse.justPressed(2) && !plantingCell)) {
              const x=treeTarget?treeHit.tree.x:objectTarget?objectHit.part.x:hit!.cell[0],z=treeTarget?treeHit.tree.z:objectTarget?objectHit.part.z:hit!.cell[2];
              if(input.mouse.justPressed(2)){
                // 角色视角下贴着东西右键 = 打开它。箱子优先于随从（箱子不会自己走开）。
                // 俯视视角不接这个键，那里右键是拖镜头和取消工具。
                const chestHere = viewMode === 'character' ? nearChest(x, z) : undefined;
                const near = viewMode === 'character' ? nearColonist() : null;
                if (chestHere) { port?.postMessage({ type: 'voxel:openChest', id: chestHere.id }); status = '打开木箱'; }
                else if (near) { port?.postMessage({ type: 'voxel:openFollower', id: near.id }); status = '打开随从'; }
                else { tool='inspect'; status='已取消当前工具'; }
                refreshState=true;
              }

              else if(viewMode === 'character' && objectHit && !objectHit.building.complete
                && colonyState.playerBag[colonyState.bagSelected]?.resource === HAMMER) {
                const result = colony.startPlayerConstruction(objectHit.building.id, [player.x, player.y, player.z]);
                status = result.message;
                refreshState = true;
                if (!result.ok) port?.postMessage({ type: 'voxel:inventory-status', message: status });
              }
              else if(tool==='place-chest')execute({action:'place-chest',x,z});
              else if(tool.startsWith('build:'))execute({action:'build',kind:tool.slice(6),x,z,target:buildHeight ?? voxels.terrainHeight(x,z),rotation:buildRotation});
              else if(tool.startsWith('zone:'))execute({action:'designate',kind:tool.slice(5),x,z,w:3,d:3,crop});
              else if(tool==='mine'&&treeHit){status='此处是完整树木，请先使用伐木工具清理';refreshState=true;}
              else if(['chop','mine','harvest'].includes(tool))execute({action:'designate',kind:tool,x,z,...(tool==='chop'&&treeHit?{id:treeHit.tree.id}: {})});
              else if(tool==='demolish'||tool==='interact'){
                const b=objectHit?.building;
                if (tool === 'demolish' && viewMode === 'character') {
                  status = '靠近一格内再按住左键拆除'; refreshState = true;
                } else if(b){selectedBuildingId=b.id;selectedTreeId=null;execute({action:tool==='demolish'?'demolish':'toggleDoor',id:b.id});}
                else{status=tool==='demolish'?'此处没有可拆除的设施':'点击门的任一部分开关门';refreshState=true;}
              }
              else if(tool==='cancel'){
                const b=objectHit&&!objectHit.building.complete?objectHit.building:undefined;
                const plan=colonyState.terrainPlans.find(p=>p.state!=='completed'&&p.cells.some(([xx,zz])=>xx===x&&zz===z));
                const job=colonyState.jobs.find(j=>treeTarget?j.targetId===treeHit.tree.id:j.x===x&&j.z===z);
                const zone=colonyState.zones.find(q=>x>=q.x&&x<q.x+q.w&&z>=q.z&&z<q.z+q.d);
                if(b||plan||job||zone)execute({action:'cancel',id:(b??plan??job??zone)!.id});else{status='此处没有可取消的规划';refreshState=true;}
              }else{
                const o=r?Array.from(ray.getOrigin(vec3.create(),r))as Point:[0,0,0]as Point;
                const d=r?Array.from(ray.getDirection(vec3.create(),r))as Point:[0,0,0]as Point;
                const picks=colonyState.colonists.filter(p=>p.id!==followId).map(p=>{const v=[p.position[0]-o[0],p.position[1]+.8-o[1],p.position[2]-o[2]];const t=v[0]!*d[0]+v[1]!*d[1]+v[2]!*d[2];return{p,t,dist:Math.hypot(v[0]!-d[0]*t,v[1]!-d[1]*t,v[2]!-d[2]*t)};}).filter(q=>q.t>0&&q.t<(hit?.distance??1200)&&q.dist<.8).sort((a,b)=>a.t-b.t);
                const pawn=picks[0]?.p??colonyState.colonists.find(p=>p.id!==followId&&Math.hypot(p.position[0]-(x+.5),p.position[2]-(z+.5))<1.1);
                if(pawn&&((!objectHit&&!treeHit)||(picks[0]?.t??Infinity)<Math.min(objectHit?.distance??Infinity,treeHit?.distance??Infinity)))execute({action:'select',colonistId:pawn.id});
                else if(treeHit && viewMode === 'god'){execute({action:'select'});selectedTreeId=treeHit.tree.id;status=`整棵树木 · 树干、分枝与树冠共用一个物体 · 高 ${treeHit.tree.trunkHeight+2} 格`;refreshState=true;}
                else {
                  const b=objectHit?.building; execute({action:'select'}); selectedBuildingId=b?.id??null;
                  status=b?`${BUILDING_DEFS[b.kind as BuildingKind].name} · ${b.complete?'已建成':b.phase==='preparingTerrain'?'准备地基':`施工 ${Math.round(b.progress*100)}%`}${b.kind==='door'?b.doorOpen?' · 开启':' · 关闭':''}${b.blockedReason?` · ${b.blockedReason}`:''}`
                    :`${BLOCKS[hit?.block ?? BLOCK.Air]?.name ?? '地块'} [${x}, ${z}] · 地面标高 ${voxels.terrainHeight(x,z)}${hit?.block===BLOCK.SteelOre?' · 规划 → 采矿，获取钢铁':''}`;
                  refreshState=true;
                }
              }
            }
            if (sandbox && (hit||objectHit||treeHit) && (input.mouse.justPressed(0) || input.mouse.justPressed(2))) {
              const shouldRemove = input.mouse.justPressed(2) || mode === 'remove';
              const paintRoad = !shouldRemove && selected === BLOCK.Road;
              const editCell = hit?(shouldRemove || paintRoad ? hit.cell : hit.adjacent):null;
              const protectedBuilding=editCell?buildingProtectingVoxel(colonyState.buildings,...editCell):undefined;
              if(treeHit){
                if(shouldRemove && voxels.removeTree(treeHit.tree.id)){
                  lastEdit={action:'remove-tree',treeId:treeHit.tree.id,x:treeHit.tree.x,y:treeHit.tree.y,z:treeHit.tree.z};
                  selectedTreeId=null;colony.tick(0);colonyState=colony.snapshot();changed('已移除整棵树 · Ctrl + Z 恢复 · 沙盒移除不产出木材');
                }else{status='此处属于整棵树木，请先整体移除或选择其他位置';refreshState=true;}
              } else if(objectHit){
                selectedBuildingId=objectHit.building.id;selectedTreeId=null;
                if(shouldRemove)execute({action:'demolish',id:objectHit.building.id});
                else{status='设施占用此处，请先整体拆除或选择其他位置';refreshState=true;}
              } else if(protectedBuilding){status='此格属于设施或它的地基，请先整体拆除设施';refreshState=true;}
              else if(editCell&&treeProtectingVoxel(voxels,...editCell)){status='此格属于树木或树根地基，请先移除整棵树';refreshState=true;}
              else if (editCell && voxels.inBounds(...editCell) && editCell[1] > 0) {
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
          } else if (hoverCell || playerDemolish || playerExcavation) {
            playerDemolish = null;
            playerExcavation = null;
            hoverCell = null; hoverBuildingId=null;hoverBuildingPart=null;hoverTreeId=null;hoverTreePart=null;hoverKey = ''; if(!stroke){terrainView.clearPreview();previewKey='';} world.set(cursor, Transform, { pos: [0, -100, 0] }).unwrap(); refreshState = true;
          }
          if (demolitionHint !== nextDemolitionHint || destructionProgress !== nextDestructionProgress) {
            demolitionHint = nextDemolitionHint;
            destructionProgress = nextDestructionProgress;
            refreshState = true;
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

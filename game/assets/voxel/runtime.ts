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
import { ColonySimulation } from '../colony/simulation.ts';
import { ColonyView } from '../colony/view.ts';
import { BUILDING_DEFS, type BuildingKind, type ColonyCommand } from '../colony/contracts.ts';

type Point = [number, number, number];
const PALETTE = [5, 3, 4, 6, 1, 2];
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
      const entities = new Set<EntityHandle>();
      const chunks = new Map<string, { entity: EntityHandle; handle: AssetHandle<'mesh'> }>();
      const ownedHandles = new Set<number>();
      const own = <T extends number>(handle: T): T => { ownedHandles.add(handle); return handle; };
      const release = (handle: number) => { ownedHandles.delete(handle); assets.release(handle).unwrap(); };
      let cameraSystemAdded = false, editSystemAdded = false;
      let unregister: (() => void) | undefined;
      let receive: (event: MessageEvent) => void = () => {};
      let selected = 5, mode: 'build' | 'remove' = 'build', uiHover = false;
      let tool = 'inspect';
      let crop: 'rice' | 'corn' = 'rice';
      let status = '和平殖民地 · 规划家园，照顾每一位居民';
      let target: Point = [27, 5, 27], yaw = Math.PI / 4, pitch = 0.82, distance = 47;

      // ---- 双视角 ----
      // god = 俯视上帝视角，自由平移；character = 贴着某位居民看。
      // 切到角色视角时把俯视的构图存进 godReturn，切回来原样恢复，
      // 否则玩家切一圈回来发现自己被丢到地图角落。
      let viewMode: 'god' | 'character' = 'god';
      let followId: string | null = null;
      let godReturn = { target: [27, 5, 27] as Point, yaw: Math.PI / 4, pitch: 0.82, distance: 47 };
      const FOLLOW_SMOOTH = 8;

      // ---- 玩家角色 ----
      // 不进 simulation：殖民地那套需求/工作/优先级对"你"没有意义，
      // 玩家就是玩家，不是第四个居民。位置只活在表现层。
      // 碰撞不挂物理引擎，和 Unity 那边一个思路——直接查体素，
      // 规则可预测，也不会出现"人贴着墙缝钻过去"。
      const PLAYER_RADIUS = 0.32;
      const PLAYER_SPEED = 4.5;        // 米/秒
      const PLAYER_JUMP = 1.1;         // 能跳多高
      const PLAYER_GRAVITY = -26;      // 重力加速度
      const player = {
        x: voxels.width / 2, z: voxels.depth / 2,
        y: 0, vy: 0, grounded: true, facing: 0, moving: false,
      };
      player.y = voxels.surfaceHeight(Math.floor(player.x), Math.floor(player.z)) + 1;

      /** 脚下这一列，从 fromY 往下找第一个实心方块，返回可以站的脚底高度。 */
      const groundHeight = (x: number, z: number, fromY: number): number => {
        const gx = Math.floor(x), gz = Math.floor(z);
        const start = Math.min(voxels.height - 1, Math.floor(fromY));
        for (let y = start; y >= 0; y--) {
          if (voxels.get(gx, y, gz) !== BLOCK.Air) return y + 1;
        }
        return 0;
      };

      /**
       * 能不能把这个角色放在这里。
       * 用身体半径往四个方向各探一次，再把脚到头顶的格子都验一遍——
       * 只看中心格会让人一半嵌进墙里，观感很糟。
       * 身高 1.8 米占两格（脚 + 头），所以验 fy 和 fy+1。
       * 不要多验一格——那会让 2 格高的通道过不去。
       */
      const canStand = (x: number, z: number, footY: number): boolean => {
        const fy = Math.floor(footY);
        const probes: number[][] = [[x + PLAYER_RADIUS, z], [x - PLAYER_RADIUS, z], [x, z + PLAYER_RADIUS], [x, z - PLAYER_RADIUS]];
        for (const [px, pz] of probes) {
          const gx = Math.floor(px!), gz = Math.floor(pz!);
          for (let dy = 0; dy <= 1; dy++) {
            if (!voxels.inBounds(gx, fy + dy, gz)) return false;
            if (voxels.get(gx, fy + dy, gz) !== BLOCK.Air) return false;
          }
        }
        return true;
      };

      /**
       * 把人从实心方块里推出来。
       * 只在竖直方向变化后调用——走下台阶或落地时，水平位置没动过，
       * 但落点可能正好贴着高台侧面，身体就嵌进去了。
       * 沿着四个方向各试一小步，取最近能站的那一个。
       */
      const depenetrate = (): void => {
        if (canStand(player.x, player.z, player.y)) return;
        const step = 0.08;
        for (let attempt = 1; attempt <= 6; attempt++) {
          const dist = step * attempt;
          for (const [dx, dz] of [[dist, 0], [-dist, 0], [0, dist], [0, -dist]] as number[][]) {
            if (canStand(player.x + dx!, player.z + dz!, player.y)) {
              player.x += dx!;
              player.z += dz!;
              return;
            }
          }
        }
      };
      let publishElapsed = 0, simViewElapsed = 0, lastTerrainRevision = voxels.revision;
      let eye: Point = [0, 0, 0], lastEdit: Record<string, unknown> | null = null;
      let hoverCell: Point | null = null, hoverKey = '', refreshState = true, stopped = false;
      yield () => {
        stopped = true; unregister?.(); port?.removeEventListener('message', receive);
        if (cameraSystemAdded) world.removeSystem(Update, CAMERA_SYSTEM).unwrap();
        if (editSystemAdded) world.removeSystem(Update, EDIT_SYSTEM).unwrap();
        world.removeResource('voxel:read');
        colonyView.dispose();
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
        { component: Camera, data: { ...perspective({ fov: Math.PI / 4, aspect: 16 / 9, near: 0.1, far: 240 }),
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
      };
      const read = () => ({
        seed: voxels.seed, selected, mode, tool, crop, colony: colonyState, blocks: voxels.count(), nonAirCount: voxels.count(),
        edits: voxels.editCount, editCount: voxels.editCount, revision: voxels.revision,
        undo: tool.startsWith('sandbox:') && voxels.canUndo, redo: tool.startsWith('sandbox:') && voxels.canRedo, hoverCell: hoverCell ? [...hoverCell] : null,
        status, lastEdit, camera: { target: [...target], eye: [...eye], distance, yaw, pitch, mode: viewMode, followId },
        player: { x: player.x, y: player.y, z: player.z, grounded: player.grounded, moving: player.moving, facing: player.facing,
          // 给验收用：当前是不是嵌在实心方块里
          embedded: !canStand(player.x, player.z, player.y) },
        chunks: chunks.size, dimensions: [voxels.width, voxels.height, voxels.depth],
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
        target = [27, 5, 27]; yaw = Math.PI / 4; pitch = 0.82; distance = 47; refreshState = true;
      };
      const execute = (command: ColonyCommand) => {
        const result = colony.command(command); status = result.message; colonyState = colony.snapshot(); refreshState = true;
        return result;
      };
      const loadSave = (text: string) => {
        const parsed = JSON.parse(text);
        const nextWorld = VoxelWorld.deserialize(parsed?.version === 2 ? parsed.voxel : text);
        const nextColony = new ColonySimulation(nextWorld);
        if (parsed?.version === 2) nextColony.load(parsed.colony);
        voxels = nextWorld; colony = nextColony; colonyState = colony.snapshot();
        lastTerrainRevision = -1; lastEdit = null; tool = 'inspect'; crop = 'rice'; home(); changed('已恢复地图、居民、任务和生产进度');
        port?.postMessage({ type: 'voxel:loaded', data: JSON.stringify({ version: 2, voxel: voxels.serialize(), colony: colony.serialize() }) });
      };
      receive = (event: MessageEvent) => {
        const c = event.data;
        if (stopped || c?.type !== 'voxel:command') return;
        try {
          if (c.action === 'select' && PALETTE.includes(c.block)) { selected = c.block; mode = 'build'; tool = 'sandbox:build'; execute({action:'speed',value:0}); status = `沙盒 · 已选择 ${BLOCKS[selected]!.name}`; }
          if (c.action === 'mode' && (c.value === 'build' || c.value === 'remove')) { mode = c.value; tool = `sandbox:${mode}`; execute({action:'speed',value:0}); }
          if (c.action === 'tool' && typeof c.value === 'string') {
            tool = c.value; hoverKey = '';
            if(tool.startsWith('sandbox:')) {mode = tool.endsWith('remove')?'remove':'build';execute({action:'speed',value:0});status='沙盒编辑 · 已暂停居民模拟，材料无限';}
            else status = tool==='inspect'?'点击居民查看需求与工作':tool.startsWith('build:')?'点击地面安排施工 · 居民会消耗资源完成':tool.startsWith('zone:')?'点击地面规划 3 × 3 区域':'点击地面下达工作订单';
          }
          if (c.action === 'colony' && c.command && typeof c.command === 'object') execute(c.command);
          if (c.action === 'crop' && (c.value === 'rice' || c.value === 'corn')) {
            if (c.value === 'corn' && !colonyState.research.completed.includes('agriculture')) status = '玉米需要先完成精耕农业研究';
            else { crop = c.value; status = crop === 'corn' ? '新农田将种植玉米' : '新农田将种植水稻'; }
          }
          if (c.action === 'focus' && typeof c.id === 'string') {const pawn=colonyState.colonists.find(p=>p.id===c.id);if(pawn){target=[...pawn.position];target[1]-=1;}}
          if (c.action === 'hover') uiHover = c.value === true;
          if (c.action === 'undo' && tool.startsWith('sandbox:') && voxels.undo()) changed('已撤销上一步');
          if (c.action === 'redo' && tool.startsWith('sandbox:') && voxels.redo()) changed('已重做上一步');
          if (c.action === 'reseed' && typeof c.seed === 'string' && c.seed.trim()) {
            voxels = new VoxelWorld(c.seed.trim().slice(0, 80)); colony = new ColonySimulation(voxels); colonyState = colony.snapshot();
            lastEdit = null; lastTerrainRevision = -1; tool = 'inspect'; crop = 'rice'; home(); changed('新的和平殖民地已生成');
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
            simViewElapsed = 0; colonyState = colony.snapshot(); colonyView.update(colonyState, world.getResource(Time).elapsed);
            if (voxels.revision !== lastTerrainRevision) { updateChunks(); lastTerrainRevision = voxels.revision; }
          }
          if (publishElapsed >= 0.4) {
            publishElapsed = 0; refreshState = true;
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

            // ---- V 切换视角 ----
            if (k.justPressedCode('KeyV')) {
              if (viewMode === 'god') {
                // 先存俯视构图，切回来才能原样还原
                godReturn = { target: [...target] as Point, yaw, pitch, distance };
                viewMode = 'character';
                followId = 'player';
                // 站到玩家背后看过去
                yaw = player.facing + Math.PI;
                pitch = 0.36;
                distance = 12;
                status = '玩家视角 · WASD 移动 / 空格跳跃 / V 切回俯视';
              } else {
                viewMode = 'god'; followId = null;
                target = [...godReturn.target] as Point;
                yaw = godReturn.yaw; pitch = godReturn.pitch; distance = godReturn.distance;
                status = '俯视视角 · V 切到玩家';
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
                player.facing = Math.atan2(mx, mz);
                player.moving = true;

                const step = PLAYER_SPEED * dt;
                const nx = player.x + mx * step, nz = player.z + mz * step;
                if (canStand(nx, nz, player.y)) { player.x = nx; player.z = nz; }
                // 贴墙滑：分轴各试一次，不然贴着墙会整个人卡死
                else if (canStand(nx, player.z, player.y)) player.x = nx;
                else if (canStand(player.x, nz, player.y)) player.z = nz;
              } else {
                player.moving = false;
              }

              // 空格在角色视角归跳跃；俯视视角仍然留给暂停
              if (k.justPressedCode('Space') && player.grounded) {
                player.vy = Math.sqrt(-2 * PLAYER_GRAVITY * PLAYER_JUMP);
                player.grounded = false;
              }

              if (!player.grounded) {
                player.vy += PLAYER_GRAVITY * dt;
                player.y += player.vy * dt;
                const g = groundHeight(player.x, player.z, player.y + 0.2);
                if (player.y <= g) { player.y = g; player.vy = 0; player.grounded = true; }
              } else {
                // 走出台沿：脚下空了就开始掉
                const g = groundHeight(player.x, player.z, player.y + 0.2);
                if (player.y > g + 0.05) { player.grounded = false; player.vy = 0; }
                else player.y = g;
              }
              // 竖直方向变了之后补一次推出：落点可能贴着高台侧面，不推就嵌进去了
              depenetrate();

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
                // Engine wheelDelta is a signed notch accumulator, not DOM pixel deltaY.
                distance = clamp(distance * Math.exp(clamp(input.mouse.wheelDelta, -3, 3) * 0.12), 15, 100);
              }
            }

            if (k.justPressedCode('KeyF')) home();
            // 空格：俯视视角是暂停，玩家视角留给跳跃（上面已处理）
            if (k.justPressedCode('Space') && viewMode === 'god') execute({action:'speed',value:colonyState.speed===0?1:0});
            if (k.justPressedCode('Escape')) {tool='inspect';refreshState=true;}
            if (dx || dz || input.mouse.button(1) || input.mouse.wheelDelta) refreshState = true;
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
            const hit = r ? voxels.raycast(Array.from(ray.getOrigin(vec3.create(), r)) as Point, Array.from(ray.getDirection(vec3.create(), r)) as Point, 220) : null;
            const removing = sandbox && (mode === 'remove' || input.mouse.button(2));
            const cell = hit ? (sandbox ? (removing ? hit.cell : hit.adjacent) : [hit.cell[0],voxels.surfaceHeight(hit.cell[0],hit.cell[2])+1,hit.cell[2]] as Point) : null;
            const point: Point | null = cell ? [...cell] : null;
            const valid = point !== null && voxels.inBounds(...point) && point[1] > 0 && (removing || voxels.get(...point) === 0 || voxels.get(...point) === 8);
            hoverCell = valid ? point : null;
            const nextKey = `${hoverCell?.join(',') ?? ''}:${removing}:${selected}:${tool}`;
            if (nextKey !== hoverKey) {
              hoverKey = nextKey; refreshState = true;
              const zone=tool.startsWith('zone:'),n=zone?3:1;
              world.set(cursor, Transform, { pos: hoverCell && tool!=='inspect' ? [hoverCell[0] + n/2, hoverCell[1] + (sandbox ? 0.5 : 0.04), hoverCell[2] + n/2] : [0, -100, 0],scale:sandbox?[1,1,1]:[n,.08,n] }).unwrap();
              world.set(cursor, MeshRenderer, { materials: [removing ? removeMaterial : buildMaterial] }).unwrap();
            }
            if (!sandbox && hit && (input.mouse.justPressed(0) || input.mouse.justPressed(2))) {
              const x=hit.cell[0],z=hit.cell[2];
              if(input.mouse.justPressed(2)){tool='inspect';status='已取消当前工具';refreshState=true;}
              else if(tool.startsWith('build:'))execute({action:'build',kind:tool.slice(6),x,z});
              else if(tool.startsWith('zone:'))execute({action:'designate',kind:tool.slice(5),x,z,w:3,d:3,crop});
              else if(['chop','mine','harvest'].includes(tool))execute({action:'designate',kind:tool,x,z});
              else if(tool==='cancel'){
                const b=colonyState.buildings.find(b=>b.x===x&&b.z===z&&!b.complete);
                const job=colonyState.jobs.find(j=>j.x===x&&j.z===z);
                const zone=colonyState.zones.find(q=>x>=q.x&&x<q.x+q.w&&z>=q.z&&z<q.z+q.d);
                if(b||job||zone)execute({action:'cancel',id:(b??job??zone)!.id});else{status='此处没有可取消的规划';refreshState=true;}
              }else{
                const o=r?Array.from(ray.getOrigin(vec3.create(),r))as Point:[0,0,0]as Point;
                const d=r?Array.from(ray.getDirection(vec3.create(),r))as Point:[0,0,0]as Point;
                const picks=colonyState.colonists.map(p=>{const v=[p.position[0]-o[0],p.position[1]+.8-o[1],p.position[2]-o[2]];const t=v[0]!*d[0]+v[1]!*d[1]+v[2]!*d[2];return{p,t,dist:Math.hypot(v[0]!-d[0]*t,v[1]!-d[1]*t,v[2]!-d[2]*t)};}).filter(q=>q.t>0&&q.dist<.8).sort((a,b)=>a.t-b.t);
                const pawn=picks[0]?.p??colonyState.colonists.find(p=>Math.hypot(p.position[0]-(x+.5),p.position[2]-(z+.5))<1.1);
                if(pawn)execute({action:'select',colonistId:pawn.id});
                else{const b=colonyState.buildings.find(b=>b.x===x&&b.z===z);status=b?`${BUILDING_DEFS[b.kind as BuildingKind].name} · ${b.complete?'已建成':`施工 ${Math.round(b.progress*100)}%`}`:`地块 [${x}, ${z}]`;refreshState=true;}
              }
            }
            if (sandbox && hit && (input.mouse.justPressed(0) || input.mouse.justPressed(2))) {
              const shouldRemove = input.mouse.justPressed(2) || mode === 'remove';
              const editCell = shouldRemove ? hit.cell : hit.adjacent;
              if (editCell && voxels.inBounds(...editCell) && editCell[1] > 0) {
                const block = shouldRemove ? 0 : selected;
                if (shouldRemove || voxels.get(...editCell) === 0 || voxels.get(...editCell) === 8) {
                  try {
                    if (voxels.edit([{ x: editCell[0], y: editCell[1], z: editCell[2], block }])) {
                      lastEdit = { x: editCell[0], y: editCell[1], z: editCell[2], block, action: shouldRemove ? 'remove' : 'build' };
                      changed(shouldRemove ? '已拆除方块 · Ctrl + Z 撤销' : `已放置${BLOCKS[selected]!.name} · Ctrl + Z 撤销`);
                    }
                  } catch (error) { status = error instanceof Error ? error.message : '此处无法建造'; refreshState = true; }
                }
              }
            }
          } else if (hoverCell) {
            hoverCell = null; hoverKey = ''; world.set(cursor, Transform, { pos: [0, -100, 0] }).unwrap(); refreshState = true;
          }
          if (refreshState) publish();
        },
      }).unwrap();
      editSystemAdded = true;
    }, 'voxel-world');
  },
};

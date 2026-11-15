import type { GameHost } from '@forgeax/engine/app';
import { mountUi, type UiAsset, type UiInstance } from '@forgeax/engine/ui';
import {
  BUILDING_DEFS, HAMMER, AXE, PICKAXE, JOB_NAMES, JOB_TYPES, PLAYER_DELIVERY_TARGET, PLAYER_SLOTS,
  RESEARCH_DEFS, RESOURCE_NAMES, RESOURCE_TYPES, SCHEDULES, buildingItemKind, inventorySpace, isResource, itemName,
  type ColonyCommand, type ColonySnapshot, type ColonistView, type InventoryItem, type InventoryLocation, type PlayerInventorySlot, type Resource,
} from '../colony/contracts.ts';
import { buildingDimensions } from '../colony/buildings.ts';
import type { TreeInstance } from '../voxel/trees.ts';

const SAVE_KEY = 'homestead.colony.v2';
const MANUAL_KEY = 'homestead.colony.v2.manual';
const LEGACY_KEY = 'homestead.voxel.v1';
type State = { seed: string; selected: number; mode: string; tool?: string; crop?: string; edits: number; undo: boolean; redo: boolean; hoverCell?: unknown; status?: string; revision?: number; colony?: ColonySnapshot;
  worldSize?: [number, number, number]; buildHeight?: number | null; buildRotation?: number; selectedBuildingId?: string | null;
  trees?: TreeInstance[]; selectedTreeId?: string | null;
  terrain?: { target: number; size: number; shape: 'brush' | 'rectangle'; sample: boolean; minHeight: number; maxHeight: number; preview?: { cells: number; cut: number; fill: number } };
  /** 相机状态。mode 决定哪些 HUD 该出现：指挥官视角要菜单，玩家视角不要。 */
  camera?: { mode?: 'god' | 'character'; followId?: string | null };
  /** 玩家角色。位置只活在表现层，不进殖民地模拟。 */
  player?: {
    x: number; y: number; z: number; grounded: boolean; moving: boolean; facing: number;
    embedded: boolean; parts: number;
    bag: PlayerInventorySlot[];
    bagSelected: number;
    constructionId?: string | null;
    vitals?: { health: number; maxHealth: number; stamina: number; maxStamina: number; gold: number };
    nearHint?: 'chest' | 'follower' | null;
    demolitionHint?: string | null;
  } };
type SaveIntent = 'auto' | 'manual' | 'export';
const MENU_NAMES: Record<string, string> = { build: '为家园添一座建筑', plan: '规划土地与资源', work: '每个人都有擅长的事', production: '让生活物资不断供', research: '一点一点，学会新方法', trade: '远道而来的朋友', logs: '家园记事', sandbox: '自由塑造这片土地', warehouse: '所有家当都在这里', follower: '一起生活的人', chest: '木箱', followerBag: '随从' };
const BUILD_ICONS: Record<string, string> = {
  bed: '▱', table: '▤', stove: '♨', workbench: '⚒', researchDesk: '◇', solar: '☀', battery: '▥', cooler: '❄', medicalBed: '+', wall: '▧', door: '▯', floor: '▦',
  // 结构
  woodWall: '▧', brickWall: '▨', stoneDoor: '▯', autoDoor: '⊞', fence: '╫',
  // 家具
  chest: '▣', bedroll: '▭', doubleBed: '▬', chair: 'ᑎ', stool: '⊓', shelf: '▤', planter: '❦', painting: '▣', sculpture: '♜', vase: '⌂',
  campfire: '🔥', torch: '🕯', floorLamp: '💡', chandelier: '✦',
  // 生产
  campStove: '♨', stoneCutter: '◧', forgery: '⚒', fabricator: '⚙', tailorBench: '✂', pickleBarrel: '◍', brewBarrel: '◉', cheesePress: '◎',
  advancedResearchDesk: '◈', artBench: '✎',
  // 农业
  hydroponics: '❋', sprinkler: '☂', greenhouseWall: '▢', scarecrow: 'ᛉ', compostBin: '♻',
};
const RESOURCE_ICONS: Record<Resource, string> = {
  wood: '▰', stone: '◆', steel: '▱', dirt: '▩', food: '♧', meal: '◉', medicine: '+', cloth: '▨', silver: '○', components: '⚙',
  // 农作物
  wheat: '🌾', corn: '🌽', blueberry: '🫐', sugarcane: '🎋', cabbage: '🥬', leek: '🧅', potato: '🥔', tomato: '🍅',
  // 料理
  friedEgg: '🍳', bread: '🍞', salad: '🥗', pasta: '🍝', pancake: '🥞', blueberryPie: '🥧', pizza: '🍕', perfectBreakfast: '🍱',
};
const int = (value: number) => Math.floor(Number.isFinite(value) ? value : 0);
const percent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export async function createBuildUi(asset: UiAsset, host: GameHost): Promise<UiInstance> {
  if (!host.uiRoot) throw new Error('家园界面缺少挂载点');
  const mounted = mountUi(asset, { root: host.uiRoot, layer: 50 });
  if (!mounted.ok) throw mounted.error;
  const ui = mounted.value, shadow = ui.host.shadowRoot!, port = host.presentationPort ?? host.port;
  const doc = host.uiRoot.ownerDocument, win = doc.defaultView!;
  const releases: (() => void)[] = [];
  const get = <T extends HTMLElement>(id: string) => shadow.getElementById(id) as T;
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
    const el = doc.createElement(tag); el.className = className; if (text !== undefined) el.textContent = text; return el;
  };
  const on = (node: EventTarget, type: string, fn: EventListener) => { node.addEventListener(type, fn); releases.push(() => node.removeEventListener(type, fn)); };
  let state: State | undefined, panel = '', currentTool = 'inspect', selectedResident: string | null = null, selectedBuilding: string | null = null;
  let selectedTree: string | null = null, lastSelectedTree: string | null = null;
  // 视角标记挂在 .shell 上（UI 在 Shadow DOM 里，不能用 body）
  let shellEl: HTMLElement | null = null;
  // 快捷栏选中的格子，只在玩家视角有意义
  let booted = false, disposed = false, lastWorldSeed = '', confirmUntil = 0, lastCardsStamp = '', lastPanelStamp = '', lastInspectorStamp = '';
  let pendingSave: SaveIntent | null = null, queuedSave: SaveIntent | null = null;
  let lastSaveTime = -Infinity, lastSavedSim = 0, lastSavedStamp = '', latestStamp = '', savingStamp = '', savingSim = 0;
  let lastSelectedFromWorld: string | null = null, lastSelectedBuilding: string | null = null, pendingLoadAt = 0;
  const send = (action: string, data: Record<string, unknown> = {}) => port?.postMessage({ type: 'voxel:command', action, ...data });
  const colonyCommand = (command: ColonyCommand) => send('colony', { command });
  const saySave = (text: string) => { get('save-status').textContent = text; get('quick-save').textContent = text; };
  const button = (text: string, testId: string, command?: ColonyCommand, className = '') => {
    const b = make('button', className, text); b.type = 'button'; b.dataset.testid = testId;
    if (command) b.dataset.command = JSON.stringify(command);
    return b;
  };
  const toolButton = (text: string, tool: string, testId: string, className = '') => {
    const b = button(text, testId, undefined, className); b.dataset.tool = tool; b.classList.toggle('active', currentTool === tool); return b;
  };
  const clear = (el: HTMLElement) => { el.textContent = ''; return el; };
  const note = (text: string) => make('p', 'panel-note', text);
  const empty = (text: string) => make('p', 'empty-message', text);
  const clockText = (hour: number) => `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`;
  const costText = (cost: Partial<Record<Resource, number>>) => Object.entries(cost).map(([r, amount]) => `${RESOURCE_NAMES[r as Resource]} ${amount}`).join(' · ');
  const terrainControls = make('div', 'terrain-controls');
  const terrainFields = make('div', 'terrain-fields');
  const numberField = (labelText: string, id: string, value: number) => {
    const label = make('label', 'terrain-field', labelText), input = make('input');
    input.type = 'number'; input.id = id; input.dataset.testid = id; input.step = '1'; input.value = String(value);
    label.append(input); return { label, input };
  };
  const terrainHeight = numberField('目标标高', 'terrain-target', 6);
  const terrainSize = numberField('笔刷宽度（格）', 'terrain-size', 3);
  const terrainShapeLabel = make('label', 'terrain-field', '选区方式'), terrainShape = make('select');
  terrainShape.id = 'terrain-shape'; terrainShape.dataset.testid = 'terrain-shape';
  for (const [value, label] of [['brush', '涂抹笔刷'], ['rectangle', '矩形框选']]) {
    const option = make('option', '', label); option.value = value!; terrainShape.append(option);
  }
  terrainShapeLabel.append(terrainShape);
  const sampleHeight = button('取样地面高度', 'terrain-sample'); sampleHeight.dataset.terrainAction = 'sample';
  const terrainPreview = make('p', 'terrain-preview'); terrainPreview.dataset.testid = 'terrain-preview'; terrainPreview.setAttribute('aria-live', 'polite');
  const terrainInstructions = make('p', 'panel-note', '拖动左键规划，松开提交；Shift + 点击取样。填挖由居民逐步完成。');
  terrainFields.append(terrainHeight.label, terrainSize.label, terrainShapeLabel, sampleHeight);
  terrainControls.append(terrainFields, terrainPreview, terrainInstructions);
  const buildControls = make('div', 'building-controls');
  const buildOrientation = make('strong'); buildOrientation.dataset.testid = 'build-orientation';
  const buildFootprint = make('span'); buildFootprint.dataset.testid = 'build-footprint';
  const rotateBuild = button('↻ 旋转 90° · R', 'build-rotate'); rotateBuild.dataset.voxelAction = 'rotateBuild';
  const buildSummary = make('div', 'building-summary'); buildSummary.append(buildOrientation, buildFootprint);
  buildControls.append(buildSummary, rotateBuild);
  const orientationText = (rotation = 0) => `${rotation * 90}°`;
  function syncBuildControls() {
    const kind = currentTool.startsWith('build:') ? currentTool.slice(6) as keyof typeof BUILDING_DEFS : null;
    const def = kind ? BUILDING_DEFS[kind] : undefined, rotation = state?.buildRotation ?? 0;
    const dimensions = def ? buildingDimensions(def.id, rotation) : null;
    buildOrientation.textContent = `${def?.name ?? '建筑'} · 朝向 ${orientationText(rotation)}`;
    buildFootprint.textContent = dimensions ? `占地 ${dimensions.w} × ${dimensions.d} 格 · 高 ${dimensions.h} 格` : '选择建筑后可旋转放置';
    rotateBuild.disabled = !def;
    const floating = get('build-toolbar'), inBuild = panel === 'build' && !get('workspace').hidden;
    floating.hidden = inBuild || !def || (state?.camera?.mode ?? 'god') !== 'god' || !!panel || !get('settings').hidden || !get('help').hidden || !get('inspector').hidden;
    if (!inBuild && !floating.hidden && buildControls.parentElement !== floating) floating.append(buildControls);
  }
  const buildingPhase = (phase?: string) => ({ preparingTerrain: '整平地基', readyToBuild: '等待施工', constructing: '正在施工', completed: '已完工' }[phase ?? ''] ?? '等待施工');
  function syncTerrainControls() {
    const t = state?.terrain, active = shadow.activeElement;
    const min = t?.minHeight ?? 1, max = t?.maxHeight ?? (state?.worldSize?.[1] ?? 24) - 2;
    terrainHeight.input.min = String(min); terrainHeight.input.max = String(max);
    terrainSize.input.min = '1'; terrainSize.input.max = String(Math.min(25, state?.worldSize?.[0] ?? 250, state?.worldSize?.[2] ?? 250));
    if (active !== terrainHeight.input) terrainHeight.input.value = String(t?.target ?? 6);
    if (active !== terrainSize.input) terrainSize.input.value = String(t?.size ?? 3);
    if (active !== terrainShape) terrainShape.value = t?.shape ?? 'brush';
    terrainSize.input.disabled = t?.shape === 'rectangle';
    sampleHeight.textContent = t?.sample ? '点击地面完成取样…' : '取样地面高度';
    sampleHeight.classList.toggle('active', t?.sample === true);
    const preview = t?.preview;
    terrainPreview.textContent = preview && preview.cells > 0
      ? `选区 ${preview.cells} 格 · 挖 ${int(preview.cut)} 格层 · 填 ${int(preview.fill)} 格层`
      : `目标标高 ${t?.target ?? 6} · ${t?.shape === 'rectangle' ? '拖动框选任意范围' : `${t?.size ?? 3} × ${t?.size ?? 3} 格笔刷`} · 普通土方只消耗工时`;
    const floating = get('terrain-toolbar');
    const inPlan = panel === 'plan' && !get('workspace').hidden;
    floating.hidden = inPlan || currentTool !== 'level' || (state?.camera?.mode ?? 'god') !== 'god' || !!panel || !get('settings').hidden || !get('help').hidden || !get('inspector').hidden;
    if (!inPlan && !floating.hidden && terrainControls.parentElement !== floating) floating.append(terrainControls);
    syncBuildControls();
  }
  const syncHover = () => {
    const active = shadow.activeElement?.tagName;
    const hovering = [...shadow.querySelectorAll<HTMLElement>('[data-interactive]')].some(el => !el.hidden && el.matches(':hover'));
    send('hover', { value: hovering || active === 'INPUT' || active === 'SELECT' || active === 'TEXTAREA' });
  };
  for (const el of shadow.querySelectorAll<HTMLElement>('[data-interactive]')) {
    on(el, 'pointerenter', () => send('hover', { value: true }));
    on(el, 'pointerleave', syncHover);
  }
  on(shadow, 'focusin', () => send('hover', { value: true }));
  on(shadow, 'focusout', () => win.setTimeout(() => { syncHover(); renderPanel(); }, 0));
  on(shadow, 'contextmenu', e => e.preventDefault());
  on(get('hotbar'), 'contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
  });

  const showTool = (tool: string) => {
    const hints: Record<string, string> = { inspect: '查看模式 · 点击居民或物体任一部分查看详情', interact: '门交互 · 点击门的任一部分开关 · 关门阻挡通行', demolish: '整体拆除 · 点击物体任一部分 · 拆下后可拾取', 'zone:farm': '农田规划 · 左键划定 3 × 3 种植区', 'zone:stockpile': '仓储规划 · 左键划定 3 × 3 仓储区', chop: '伐木规划 · 点击树干或树冠，安排整棵砍伐', mine: '采矿规划 · 点击地表钢矿或石块，居民会开采并搬运', harvest: '收获规划 · 点击成熟作物', cancel: '取消规划 · 点击已有蓝图或工作标记', 'place-chest': '木箱 · 左键点击空地放置', 'sandbox:build': '沙盒 · 材料无限 · 左键放置方块', 'sandbox:remove': '沙盒 · 左键拆除 · Ctrl Z / Y 撤销重做' };
    if (state?.selected === 10) hints['sandbox:build'] = '铺设道路 · 左键替换地表 · 路沿与台阶随连接自动更新';
    else if (state?.selected === 6) hints['sandbox:build'] = '砖墙 · 三格起宽、两格高自动排窗组 · 留空作入口 · 增删保留有效窗位';
    get('tool-hint').textContent = tool === 'level'
      ? `等高整地 · 标高 ${state?.terrain?.target ?? 6} · ${state?.terrain?.shape === 'rectangle' ? '左键拖框' : '左键拖涂'} · 松开提交 · Shift 取样`
      : tool.startsWith('build:') ? `建造 ${BUILDING_DEFS[tool.slice(6) as keyof typeof BUILDING_DEFS]?.name ?? ''} · R 旋转 ${orientationText(state?.buildRotation)} · ${state?.buildHeight == null ? '取落点标高' : `地基标高 ${state.buildHeight}`} · 先整平，再施工` : hints[tool] ?? '点击地图执行当前规划';
    syncTerrainControls();
  };
  const chooseTool = (tool: string) => {
    currentTool = tool; send('tool', { value: tool }); showTool(tool);
    lastPanelStamp = ''; renderPanel(true);
  };
  const hideSidePanels = () => { get('settings').hidden = true; get('help').hidden = true; get('inspector').hidden = true; };
  const clearSelection = () => { selectedResident = null; selectedBuilding = null; selectedTree = null; send('clearSelection'); };
  const showWorldSettings = (open: boolean) => {
    if (!get('inspector').hidden) clearSelection();
    hideSidePanels(); get('workspace').hidden = true; panel = '';
    get('settings').hidden = !open; syncTerrainControls(); syncHover();
  };
  const openPanel = (next: string, toggle = true) => {
    cancelInventoryDrag?.();
    if (!get('inspector').hidden) clearSelection();
    hideSidePanels(); panel = toggle && panel === next ? '' : next;
    get('panel-content').scrollTop = 0;
    if (next === 'inspect') { panel = ''; chooseTool('inspect'); }
    if (next === 'sandbox' && panel) chooseTool('sandbox:build');
    const workspace = get('workspace');
    workspace.dataset.panel = panel;
    workspace.hidden = !panel;
    for (const b of shadow.querySelectorAll<HTMLElement>('[data-menu]')) b.classList.toggle('active', b.dataset.menu === (panel || 'inspect'));
    lastPanelStamp = ''; renderPanel(true); syncTerrainControls(); syncHover();
  };

  function renderBuild(c: ColonySnapshot, root: HTMLElement) {
    root.append(note('点击选择建筑，用 R 或旋转按钮调整朝向。床头床尾、门的上下部分作为整体放置；先整平地基，再由居民施工。'));
    root.append(buildControls); syncBuildControls();
    const actions = make('div', 'building-tool-actions');
    actions.append(toolButton('⌖ 查看物体', 'inspect', 'tool-inspect'), toolButton('↔ 开关门', 'interact', 'tool-interact'), toolButton('⌫ 整体拆除', 'demolish', 'tool-demolish', 'danger'));
    root.append(actions);
    const foundation = make('div', 'foundation-controls'), autoLabel = make('label', 'foundation-auto'), auto = make('input');
    auto.type = 'checkbox'; auto.id = 'build-height-auto'; auto.dataset.testid = 'build-height-auto'; auto.checked = state?.buildHeight == null;
    autoLabel.append(auto, make('span', '', '采用落点地面标高'));
    const height = numberField('地基标高', 'build-height', state?.buildHeight ?? state?.terrain?.target ?? 6);
    height.input.min = String(state?.terrain?.minHeight ?? 1); height.input.max = String(state?.terrain?.maxHeight ?? 22); height.input.disabled = auto.checked;
    foundation.append(autoLabel, height.label); root.append(foundation);
    // 45 种建筑挤一屏太乱，按类别分组。类别来自 BUILDING_DEFS 的 category 字段，
    // 没写的算「核心」——那是我最早做的 12 种。
    const GROUP_ORDER: { key: string; label: string }[] = [
      { key: 'core', label: '核心' },
      { key: 'structure', label: '结构' },
      { key: 'furniture', label: '家具' },
      { key: 'production', label: '生产' },
      { key: 'agriculture', label: '农业' },
    ];
    const grouped = new Map<string, typeof BUILDING_DEFS[keyof typeof BUILDING_DEFS][]>();
    for (const def of Object.values(BUILDING_DEFS)) {
      const key = (def as { category?: string }).category ?? 'core';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(def);
    }
    for (const group of GROUP_ORDER) {
      const defs = grouped.get(group.key);
      if (!defs?.length) continue;
      root.append(make('h4', 'build-group-title', group.label));
      const grid = make('div', 'card-grid');
    for (const def of defs) {
      const locked = !!def.research && !c.research.completed.includes(def.research);
      const short = Object.entries(def.cost).some(([r, amount]) => c.resources[r as Resource] < (amount ?? 0));
      const b = toolButton('', def.id === 'chest' ? 'place-chest' : `build:${def.id}`, `build-${def.id}`, 'build-card'); b.disabled = locked;
      const title = make('span', 'card-title'); title.append(make('span', 'card-icon', BUILD_ICONS[def.id] ?? '▧'), make('span', '', def.name));
      const dimensions = buildingDimensions(def.id, state?.buildRotation ?? 0);
      b.append(title, make('span', 'card-description', `${dimensions.w} × ${dimensions.d} 格 · 高 ${dimensions.h} 格 · ${def.description}`), make('span', 'card-cost', costText(def.cost)));
      if (locked) b.append(make('span', 'card-lock', `需研究：${RESEARCH_DEFS[def.research!]?.name ?? def.research}`));
      else if (short) b.append(make('span', 'card-lock', def.id === 'chest' ? '仓库里的木材不足' : '可先规划 · 施工前等待材料'));
      grid.append(b);
    }
      root.append(grid);
    }
    const pending = c.buildings.filter(b => !b.complete);
    if (pending.length) {
      const section = make('div', 'detail-section'); section.append(make('h3', '', `待建建筑 · ${pending.length}`));
      const list = make('div', 'row-list terrain-plan-list');
      for (const b of pending.slice(-8)) {
        const row = make('div', 'production-row'), main = make('div', 'row-main'); row.dataset.testid = `building-plan-${b.id}`;
        main.append(make('strong', '', `${BUILDING_DEFS[b.kind].name} · ${buildingPhase(b.phase)}`), make('p', '', `${b.w ?? 1} × ${b.d ?? 1} 格 · 地基 ${b.y} · 施工 ${percent(b.progress * 100)}%`));
        if (b.blockedReason) main.append(make('p', 'thought bad', b.blockedReason));
        row.append(main, button('取消建筑', `building-cancel-${b.id}`, { action: 'cancel', id: b.id })); list.append(row);
      }
      if (pending.length > 8) list.append(note(`显示最近 8 项，共 ${pending.length} 项待建。`));
      section.append(list); root.append(section);
    }
  }
  function renderPlan(c: ColonySnapshot, root: HTMLElement) {
    root.append(note('先选择等高整地并设置标高，拖涂或框选后松开提交蓝图。可暂停规划，再恢复模拟让居民填挖。农田与仓储仍为 3 × 3 格。'));
    root.append(terrainControls); syncTerrainControls();
    const grid = make('div', 'planning-tools');
    const entries = [
      ['level', '等高整地', '涂抹或框选，将选区填挖到同一标高。', 'tool-level'],
      ['zone:farm', '农田', '种植、照料与收获食物。', 'tool-zone-farm'], ['zone:stockpile', '仓储', '搬运散落物资，集中保管。', 'tool-zone-stockpile'],
      ['chop', '伐木', '点击任一部分，整棵砍伐获取木材。', 'tool-chop'], ['mine', '采矿', '地表钢矿产出钢铁，普通石块产出石材。', 'tool-mine'],
      ['harvest', '收获', '标记成熟作物。', 'tool-harvest'], ['cancel', '取消规划', '移除未完成的规划或工作。', 'tool-cancel'],
      ['interact', '开关门', '点击门的任一部分开关；关闭时阻挡通行。', 'tool-interact'], ['demolish', '整体拆除', '点击物体任一部分，拆下整座设施后可拾取。', 'tool-demolish'],
    ];
    for (const [tool, name, detail, id] of entries) { const b = toolButton('', tool!, id!); b.append(make('strong', '', name), make('span', '', detail)); grid.append(b); }
    root.append(grid);
    const plans = c.terrainPlans ?? [];
    if (plans.length) {
      const section = make('div', 'detail-section'); section.append(make('h3', '', '整地蓝图'));
      const list = make('div', 'row-list terrain-plan-list');
      const active = plans.filter(p => p.state !== 'completed');
      const visible = [...active, ...plans.filter(p => p.state === 'completed').slice(-2)].slice(0, 8);
      const names = { queued: '等待居民', working: '正在填挖', blocked: '等待条件', completed: '已整平' };
      for (const plan of visible) {
        const row = make('div', 'production-row'), main = make('div', 'row-main'); row.dataset.testid = `terrain-plan-${plan.id}`;
        main.append(make('strong', '', `标高 ${plan.target} · ${names[plan.state]}${plan.buildingId ? ' · 建筑地基' : ''}`), make('p', '', `${plan.cells.length} 格 · 待挖 ${int(plan.remainingCut)} · 待填 ${int(plan.remainingFill)} · ${percent(plan.progress * 100)}%`));
        if (plan.blockedReason) main.append(make('p', 'thought bad', plan.blockedReason));
        row.append(main);
        if (plan.state !== 'completed') row.append(button(plan.buildingId ? '取消建筑' : '取消整地', `terrain-cancel-${plan.id}`, { action: 'cancel', id: plan.buildingId ?? plan.id }));
        list.append(row);
      }
      if (active.length > 8) list.append(note(`显示前 8 项，共 ${active.length} 项未完成整地。`));
      section.append(list); root.append(section);
    }
    const crops = make('div', 'schedule-row'); crops.append(make('span', '', '农田作物'));
    for (const [id, name] of [['rice', '稻米'], ['corn', '玉米']] as const) {
      const b = button(name, `crop-${id}`); b.dataset.crop = id; b.classList.toggle('active', (state?.crop ?? 'rice') === id);
      b.disabled = id === 'corn' && !c.research.completed.includes('agriculture'); if (b.disabled) b.title = '需完成精耕农业研究'; crops.append(b);
    }
    root.append(crops);
    const counts = make('p', 'panel-note', `农田 ${c.zones.filter(z => z.kind === 'farm').length} 片 · 仓储 ${c.zones.filter(z => z.kind === 'stockpile').length} 片 · 待执行 ${c.jobs.filter(j => j.state === 'queued').length} · 进行中 ${c.jobs.filter(j => j.state === 'working').length} · 受阻 ${c.jobs.filter(j => j.state === 'blocked').length}`); counts.style.marginTop = '12px'; root.append(counts);
    for (const job of c.jobs.filter(j => j.state === 'blocked').slice(0, 5)) root.append(make('p', 'thought bad', `${JOB_NAMES[job.type]}：${job.label}`));
  }
  function renderWork(c: ColonySnapshot, root: HTMLElement) {
    root.append(note('点击数字循环优先级：1 最高，4 最低，— 禁用。相同优先级按居民当前可执行工作调度。技能等级见居民档案。'));
    const scroll = make('div', 'table-scroll'), table = make('table', 'work-table'), head = make('thead'), header = make('tr');
    header.append(make('th', '', '居民')); for (const job of JOB_TYPES) header.append(make('th', '', JOB_NAMES[job])); head.append(header); table.append(head);
    const body = make('tbody');
    for (const person of c.colonists) {
      const row = make('tr'); row.append(make('td', '', person.name));
      for (const job of JOB_TYPES) { const value = person.priorities[job], td = make('td'); const b = button(value ? String(value) : '—', `priority-${person.id}-${job}`, { action: 'priority', colonistId: person.id, job, value: (value + 1) % 5 }, `priority p${value}`); b.title = `${person.name} · ${JOB_NAMES[job]} · 技能 ${person.skills[job]} · 点击调整`; td.append(b); row.append(td); }
      body.append(row);
    }
    table.append(body); scroll.append(table); root.append(scroll);
    root.append(make('div', 'schedule-label', '作息安排'));
    for (const person of c.colonists) {
      const row = make('div', 'schedule-row'); row.append(make('span', 'schedule-name', person.name));
      for (const [id, name] of Object.entries(SCHEDULES)) { const b = button(name, `schedule-${person.id}-${id}`, { action: 'schedule', colonistId: person.id, value: id }); b.classList.toggle('active', person.schedule === id); row.append(b); }
      root.append(row);
    }
    root.append(note('均衡作息兼顾睡眠、工作与娱乐；日班和夜班错峰工作；休养优先恢复需求与健康。'));
  }
  function renderProduction(c: ColonySnapshot, root: HTMLElement) {
    root.append(note('生产目标为希望保有的库存。低于目标时，居民会在对应设施生产；达到目标后停止，缺原料时等待。'));
    const list = make('div', 'row-list');
    const recipes = [
      { kind: 'meal' as const, title: '熟食', detail: '炉灶 · 2 生食 → 3 熟食', facility: 'stove', step: 3 },
      { kind: 'medicine' as const, title: '药品', detail: '工作台 · 2 生食 + 1 布料 → 2 药品', facility: 'workbench', step: 1 },
      { kind: 'components' as const, title: '零件', detail: '工作台 · 4 钢铁 + 2 木材 → 1 零件', facility: 'workbench', step: 1 },
    ];
    for (const r of recipes) {
      const row = make('div', 'production-row'), main = make('div', 'row-main');
      const ready = c.buildings.some(b => b.kind === r.facility && b.complete);
      const unlocked = r.kind !== 'components' || c.research.completed.includes('fabrication');
      main.append(make('strong', '', r.title), make('p', '', `${r.detail} · 当前 ${int(c.resources[r.kind])}${ready ? '' : ' · 缺少设施'}${unlocked ? '' : ' · 尚未解锁'}`));
      const actions = make('div', 'row-actions'), value = c.bills[r.kind];
      const less = button('−', `bill-${r.kind}-minus`, { action: 'bill', kind: r.kind, target: Math.max(0, value - r.step) }); less.disabled = !unlocked || value === 0;
      const more = button('+', `bill-${r.kind}-plus`, { action: 'bill', kind: r.kind, target: Math.min(200, value + r.step) }); more.disabled = !unlocked || value >= 200;
      actions.append(less, make('span', '', `目标 ${value}`), more);
      row.append(main, actions); list.append(row);
    }
    root.append(list);
    const p = c.power;
    const power = make('div', 'detail-section'); power.append(make('h3', '', '电力与储存'), make('p', 'muted', `发电 ${int(p.generation)} W · 需求 ${int(p.demand)} W · 已供 ${int(p.supplied)} W · 电池 ${int(p.stored)} / ${int(p.capacity)} · ${p.coldStorage ? '冷藏运行中' : '冷藏未启用'}`)); root.append(power);
  }
  function renderResearch(c: ColonySnapshot, root: HTMLElement) {
    root.append(note('建好研究桌，并为居民启用研究工作。选择一个项目后，研究员会在空闲且需求满足时积累进度。'));
    const list = make('div', 'row-list');
    for (const def of Object.values(RESEARCH_DEFS)) {
      const complete = c.research.completed.includes(def.id), active = c.research.active === def.id;
      const locked = !!def.requires && !c.research.completed.includes(def.requires), progress = c.research.progress[def.id] ?? 0;
      const row = make('div', `research-row${active ? ' active' : ''}`), main = make('div', 'row-main');
      main.append(make('strong', '', def.name), make('p', '', `${def.description}${locked ? ` · 先完成${RESEARCH_DEFS[def.requires!]?.name ?? def.requires}` : ''}`));
      const track = make('div', 'progress-track'), fill = make('span'); fill.style.width = `${complete ? 100 : percent(progress / def.work * 100)}%`; track.append(fill); main.append(track);
      const b = button(complete ? '已完成' : active ? `${int(progress)} / ${def.work}` : '开始研究', `research-${def.id}`, { action: 'research', id: def.id }); b.disabled = complete || locked || active;
      row.append(main, b); list.append(row);
    }
    root.append(list);
  }
  function renderTrade(c: ColonySnapshot, root: HTMLElement) {
    if (!c.trade.available) { root.append(empty('暂时没有商队停留。旅人到来时会在家园记录中通知；可以先准备银币与可出售的物资。')); return; }
    const banner = make('div', 'trade-banner'); banner.append(make('span', '', '行商正在营地停留'), make('span', '', `银币 ${int(c.resources.silver)} · 余 ${Math.max(0, Math.ceil(c.trade.leavesAt - c.time))} 秒`)); root.append(banner);
    const list = make('div', 'row-list');
    for (const resource of RESOURCE_TYPES.filter(r => r !== 'silver')) {
      const row = make('div', 'trade-row'), main = make('div', 'row-main'), price = c.trade.prices[resource];
      const sellPrice = Math.max(1, Math.floor(price * 0.6));
      main.append(make('strong', '', RESOURCE_NAMES[resource]), make('p', '', `我方 ${int(c.resources[resource])} · 商队 ${int(c.trade.stock[resource])} · 买 ${price} / 卖 ${sellPrice} 银币`));
      const actions = make('div', 'row-actions');
      const buy = button('买 1', `trade-buy-${resource}`, { action: 'trade', resource, amount: 1, buy: true }); buy.disabled = c.trade.stock[resource] < 1 || c.resources.silver < price;
      const sell = button('卖 1', `trade-sell-${resource}`, { action: 'trade', resource, amount: 1, buy: false }); sell.disabled = c.resources[resource] < 1 || c.trade.stock.silver < sellPrice;
      actions.append(buy, sell); row.append(main, actions); list.append(row);
    }
    root.append(list);
  }
  function renderLogs(c: ColonySnapshot, root: HTMLElement) {
    root.append(note(`工作完成 ${c.metrics.jobsCompleted} · 建成 ${c.metrics.built} · 收获 ${c.metrics.harvested} · 搬运 ${c.metrics.hauled} · 烹饪 ${c.metrics.cooked} · 治疗 ${c.metrics.treated}`));
    if (!c.events.length) { root.append(empty('家园的故事刚刚开始。')); return; }
    for (const event of [...c.events].reverse().slice(0, 35)) { const row = make('div', `event${event.type === 'health' ? ' warn' : ''}`); row.append(make('span', 'event-time', `第 ${event.day} 天 ${clockText(event.hour)}`), make('span', '', event.text)); root.append(row); }
  }
  function renderSandbox(root: HTMLElement) {
    root.append(note('自由编辑地形，材料无限。沙盒操作不会创建居民工作；方块历史只记录沙盒编辑，不能撤销殖民地发展。'));
    const head = make('div', 'sandbox-heading'), modes = make('div', 'sandbox-modes'), history = make('div', 'history');
    modes.append(toolButton('▧ 放置方块', 'sandbox:build', 'sandbox-build'), toolButton('⌫ 拆除方块', 'sandbox:remove', 'sandbox-remove'));
    const undo = button('↶', 'undo'), redo = button('↷', 'redo'); undo.id = 'undo'; redo.id = 'redo'; undo.dataset.voxelAction = 'undo'; redo.dataset.voxelAction = 'redo'; undo.disabled = !state?.undo; redo.disabled = !state?.redo; undo.title = '撤销 Ctrl+Z'; redo.title = '重做 Ctrl+Y'; history.append(undo, redo); head.append(modes, history); root.append(head);
    const materials = make('div', 'materials');
    for (const [index, [id, name, cls]] of ([[5, '木板', 'planks'], [3, '石块', 'stone'], [4, '原木', 'wood'], [6, '砖墙', 'brick'], [1, '草地', 'grass'], [2, '泥土', 'dirt'], [10, '道路', 'road']] as const).entries()) {
      const b = button('', `block-${id}`, undefined, 'material'); b.dataset.block = String(id); b.setAttribute('aria-label', name); b.title = `${index + 1} · ${name}`; b.classList.toggle('active', state?.selected === id); b.append(make('span', `cube ${cls}`), make('span', '', name)); materials.append(b);
    }
    root.append(materials, note(`当前土地 ${state?.edits ?? 0} 格改动 · 1—7 选材 · 左键执行 · 右键拆除`));
    root.append(note('连续砖墙至少三格宽、两格高时，整面墙自动安排跨格联窗与共用窗台；留空或放门的位置会避让。扩建优先保留有效窗位，撤销与读档恢复相同布局。道路点击地表铺设，两侧人行道及一格高差台阶随连接更新。'));
  }
  /**
   * 分类下拉。仓库和木箱共用同一个实现。
   * 照 Unity 的 DropdownList：trigger 展开、竖排选项、点外部收起、选完自动收起。
   */
  function makeCategoryDropdown(
    initial: string,
    onChange: (key: string) => void,
    initiallyOpen = false,
    onToggle: (open: boolean) => void = () => {},
  ) {
    let current = initial;
    const dropdown = make('div', 'wh-dropdown');
    const trigger = make('button', 'wh-cat-trigger');
    const label = make('span', '', CATEGORY_NAMES[current]!);
    trigger.append(label, make('span', 'wh-cat-caret', '▾'));

    const menu = make('div', 'wh-cat-menu');
    if (!initiallyOpen) menu.setAttribute('hidden', '');
    const options = new Map<string, HTMLButtonElement>();
    for (const [key, text] of Object.entries(CATEGORY_NAMES)) {
      const btn = make('button', `wh-cat-option${key === current ? ' active' : ''}`, text);
      btn.dataset.cat = key;
      options.set(key, btn);
      menu.append(btn);
    }
    dropdown.append(trigger, menu);

    // 展开状态由调用方保存：面板重建时新组件的局部变量会归零，
    // 但用户眼里那是一个「还开着」的下拉，不能重建一次就自己合上。
    let open = initiallyOpen;
    if (initiallyOpen) dropdown.classList.add('open');
    const close = () => {
      open = false;
      menu.setAttribute('hidden', '');
      dropdown.classList.remove('open');
      onToggle(false);
    };
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      open = !open;
      if (open) menu.removeAttribute('hidden'); else menu.setAttribute('hidden', '');
      dropdown.classList.toggle('open', open);
      onToggle(open);
    });
    for (const [key, btn] of options) {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        close();
        if (key === current) return;
        current = key;
        label.textContent = CATEGORY_NAMES[key]!;
        for (const [k, other] of options) other.classList.toggle('active', k === key);
        onChange(key);
      });
    }
    // 点外面收起。下拉在 Shadow DOM 里，必须用 composedPath 判断。
    doc.addEventListener('mousedown', (event) => {
      if (!open) return;
      const inside = event.composedPath().some(
        (node) => (node as HTMLElement)?.classList?.contains?.('wh-dropdown'),
      );
      if (!inside) close();
    }, true);

    return dropdown;
  }

  // ---- 物品右键菜单 ----
  // 仓库、木箱和随从共用弹层，获取时保留真实来源。
  let whSelected = '';
  let pendingItem: { resource: InventoryItem; from: InventoryLocation } | null = null;
  const itemMenu = get('item-menu');
  const itemMenuTitle = get('item-menu-title');
  const itemAmount = get<HTMLInputElement>('item-amount');
  const itemAmountValue = get('item-amount-value');
  const itemTake = itemMenu.querySelector<HTMLButtonElement>('[data-item-action="take"]')!;
  const closeItemMenu = () => { if (itemMenu) itemMenu.hidden = true; };
  function updateItemAmount(reset = false) {
    const c = state?.colony;
    if (!pendingItem || !c || itemMenu.hidden) return;
    const { from, resource } = pendingItem;
    const follower = from.kind === 'follower' || from.kind === 'cargo' ? c.colonists.find(person => person.id === from.id) : undefined;
    const slot = from.kind === 'chest' ? c.chests.find(chest => chest.id === from.id)?.slots[from.slot]
      : from.kind === 'follower' ? follower?.bag[0] : null;
    const available = from.kind === 'warehouse' ? isResource(resource) ? c.resources[resource] : 0
      : from.kind === 'cargo' ? isResource(resource) ? follower?.carrying[resource] ?? 0 : 0
      : slot?.resource === resource ? slot.count : 0;
    const max = Math.min(available, inventorySpace(c.playerBag, resource));
    const value = max < 1 ? 0 : reset ? 1 : Math.min(max, Math.max(1, Number(itemAmount.value)));
    itemAmount.min = max < 1 ? '0' : '1';
    itemAmount.max = String(max);
    itemAmount.value = String(value);
    itemAmount.disabled = max <= 1;
    itemTake.disabled = max < 1;
    itemAmountValue.textContent = `${value} / ${max}`;
  }
  const openItemMenu = (kind: InventoryItem, clientX: number, clientY: number, from: InventoryLocation = { kind: 'warehouse' }) => {
    if (!itemMenu) return;
    pendingItem = { resource: kind, from };
    if (itemMenuTitle) itemMenuTitle.textContent = nameOf(kind);
    for (const button of itemMenu.querySelectorAll<HTMLElement>('[data-item-action]')) {
      button.hidden = from.kind !== 'warehouse' && button.dataset.itemAction !== 'take';
    }
    itemMenu.hidden = false;
    updateItemAmount(true);
    const rect = shellEl?.getBoundingClientRect();
    const menuRect = itemMenu.getBoundingClientRect();
    const x = Math.min(clientX - (rect?.left ?? 0), (rect?.width ?? 0) - menuRect.width - 4);
    const y = Math.min(clientY - (rect?.top ?? 0), (rect?.height ?? 0) - menuRect.height - 4);
    itemMenu.style.left = `${Math.max(4, x)}px`;
    itemMenu.style.top = `${Math.max(4, y)}px`;
  };
  if (itemMenu) {
    on(itemAmount, 'input', () => updateItemAmount());
    on(itemMenu, 'click', (event) => {
      const btn = (event.target as HTMLElement | null)?.closest?.('[data-item-action]') as HTMLElement | null;
      if (!btn?.dataset.itemAction || !pendingItem) return;
      const action = btn.dataset.itemAction;
      const { resource: kind, from } = pendingItem;
      closeItemMenu();
      if (action === 'select') {
        whSelected = whSelected === kind ? '' : kind;
        renderPanel(true);
      } else if (action === 'take') {
        const amount = Number(itemAmount.value);
        if (from.kind === 'warehouse') send('request-delivery', { resource: kind, amount });
        else transferInventory(from, { kind: 'player' }, { resource: kind, count: amount });
      } else if (action === 'focus') {
        // 天工没有容器，聚焦的目标改成「产出这种东西的建筑」
        send('focus', { resource: kind });
      }
    });
  }
  const closeItemMenuOnDown = (event: MouseEvent) => {
    if (!itemMenu || itemMenu.hidden) return;
    const inside = event.composedPath().some(
      (node) => (node as HTMLElement)?.classList?.contains?.('item-menu'),
    );
    if (!inside) closeItemMenu();
  };
  doc.addEventListener('mousedown', closeItemMenuOnDown, true);

  /** 仓库：格子式面板，照 Unity 那边搬过来的。搜索 / 升降序 / 分类 / 网格。 */
  let whQuery = '', whDesc = false, whCategory = 'all', whMenuOpen = false, chestMenuOpen = false;
  // 当前打开的随从面板对应哪个居民
  let followerPanelId: string | null = null;
  let chestPanelId: string | null = null;
  // Unity 那边只分「方块 / 非方块」两类，这里照搬
  const CATEGORY_OF: Record<string, string> = {
    wood: 'block', stone: 'block', steel: 'block', dirt: 'block',
    food: 'item', meal: 'item', medicine: 'item', cloth: 'item', silver: 'item', components: 'item',
    wheat: 'crop', corn: 'crop', blueberry: 'crop', sugarcane: 'crop',
    cabbage: 'crop', leek: 'crop', potato: 'crop', tomato: 'crop',
    friedEgg: 'dish', bread: 'dish', salad: 'dish', pasta: 'dish',
    pancake: 'dish', blueberryPie: 'dish', pizza: 'dish', perfectBreakfast: 'dish',
    [HAMMER]: 'tool', [AXE]: 'tool', [PICKAXE]: 'tool',
  };
  const CATEGORY_NAMES: Record<string, string> = {
    all: '全部', block: '方块', item: '非方块', crop: '作物', dish: '料理', tool: '工具', building: '设施',
  };

  /**
   * 显示名和分类的统一入口。
   * 工具（锤子）不是 Resource，查不到就回退——所有面板必须走这两个函数，
   * 别直接索引 RESOURCE_NAMES / CATEGORY_OF，否则加个新物品就会崩。
   */
  const nameOf = itemName;
  const categoryOf = (resource: string) => buildingItemKind(resource) ? 'building' : CATEGORY_OF[resource] ?? 'item';

  function renderWarehouse(c: ColonySnapshot, root: HTMLElement) {
    const tools = make('div', 'wh-tools');
    const search = make('input', 'wh-search') as HTMLInputElement;
    search.type = 'text';
    search.placeholder = '搜索物品名…';
    search.value = whQuery;
    search.setAttribute('aria-label', '搜索物品');

    const order = make('button', 'wh-order', whDesc ? '降序' : '升序');

    // 分类下拉：和木箱共用同一个组件
    const dropdown = makeCategoryDropdown(whCategory, (key) => { whCategory = key; drawGrid(); }, whMenuOpen, (v) => { whMenuOpen = v; });

    tools.append(search, order, dropdown);
    root.append(tools);

    const grid = make('div', 'wh-grid');
    const emptyHint = note('没有匹配的物品。');
    root.append(grid, emptyHint);

    /** 只重画网格。搜索框不能跟着重建，否则每敲一个字就丢焦点。 */
    const drawGrid = () => {
      const items = RESOURCE_TYPES
        .filter((r) => whCategory === 'all' || CATEGORY_OF[r] === whCategory)
        .filter((r) => !whQuery || RESOURCE_NAMES[r].includes(whQuery))
        .map((r) => ({ kind: r, name: RESOURCE_NAMES[r], icon: RESOURCE_ICONS[r], count: Math.floor(c.resources[r]) }))
        // 照 Unity 的 ChestWindow：按显示名的字典序排，不是按数量。
        // 同名（理论上不会）才拿数量兜底，保证顺序稳定、不会每帧跳。
        .sort((a, b) => {
          const diff = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
          const result = diff === 0 ? a.count - b.count : diff;
          return whDesc ? -result : result;
        });

      clear(grid);
      // 固定 7 列，空位补格子，看起来才像一整个仓库面板
      const slots = Math.max(28, Math.ceil(items.length / 7) * 7);
      for (let i = 0; i < slots; i++) {
        const item = items[i];
        const cell = make('div', `wh-cell${item ? '' : ' empty'}${item && item.kind === whSelected ? ' selected' : ''}`);
        if (item) {
          cell.title = `${item.name} · ${item.count}`;
          cell.append(make('span', 'wh-icon', item.icon));
          if (item.count > 0) cell.append(make('span', 'wh-count', String(item.count)));
          cell.append(make('span', 'wh-label', item.name));
          cell.dataset.item = item.kind;
          cell.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openItemMenu(item.kind, event.clientX, event.clientY);
          });
        }
        grid.append(cell);
      }
      emptyHint.hidden = items.length > 0;
    };

    search.addEventListener('input', () => { whQuery = search.value; drawGrid(); });
    order.addEventListener('click', () => { whDesc = !whDesc; order.textContent = whDesc ? '降序' : '升序'; drawGrid(); });

    drawGrid();

    const loose = c.items.filter((item) => item.amount > 0);
    root.append(note(loose.length
      ? `另有 ${loose.length} 堆物资还散在地上，居民会陆续搬回仓储。`
      : '地面干净，没有待搬运的物资。'));
    const deliveries = warehouseDeliveries(c);
    if (deliveries.length) {
      const section = make('section', 'warehouse-deliveries');
      section.append(make('h3', '', '送往玩家'));
      const list = make('div', 'row-list');
      for (const job of deliveries) {
        const resident = c.colonists.find(person => person.id === job.assignedTo);
        const status = job.state === 'blocked'
          ? resident?.task ?? '等待可到达的储藏区' : !resident ? '等待随从领取'
            : job.deliveryPhase === 'deliver' ? `${resident.name}正在送来` : `${resident.name}正在去储藏区`;
        const line = make('div', 'production-row');
        const body = make('div', 'row-main');
        body.append(make('strong', '', costText(job.reserved)), make('p', '', status));
        line.append(body, button('取消', `cancel-delivery-${job.id}`, { action: 'cancel', id: job.id }));
        list.append(line);
      }
      section.append(list);
      root.append(section);
    }
  }
  const warehouseDeliveries = (c: ColonySnapshot) => c.jobs.filter(job => job.targetId === PLAYER_DELIVERY_TARGET);

  let chestSort = 0, chestQuery = '', chestCategory = 'all';
  function renderChest(c: ColonySnapshot, root: HTMLElement) {
    const chest = c.chests.find(item => item.id === chestPanelId);
    if (!chest) { root.append(empty('找不到这个木箱')); return; }

    const tools = make('div', 'wh-tools');
    const search = make('input', 'wh-search') as HTMLInputElement;
    search.type = 'search';
    search.value = chestQuery;
    search.placeholder = '搜索箱内物品…';
    search.setAttribute('aria-label', '搜索箱内物品');
    const sortLabels = ['槽位顺序', '升序', '降序'];
    const order = make('button', 'wh-order', sortLabels[chestSort]);
    const category = makeCategoryDropdown(chestCategory, (key) => { chestCategory = key; draw(); }, chestMenuOpen, (v) => { chestMenuOpen = v; });
    tools.append(search, order, category);
    const grid = make('div', 'chest-grid');
    grid.dataset.chestId = chest.id;
    root.append(tools, grid);

    const draw = () => {
      clear(grid);
      const entries = chest.slots.map((stack, slot) => ({ stack, slot }));
      if (chestSort) entries.sort((a, b) => {
        if (!a.stack || !b.stack) return Number(!a.stack) - Number(!b.stack);
        return (chestSort === 1 ? 1 : -1) * nameOf(a.stack.resource).localeCompare(nameOf(b.stack.resource), 'zh-CN');
      });
      for (const { stack, slot } of entries) {
        const matched = !stack || (chestCategory === 'all' || categoryOf(stack.resource) === chestCategory)
          && nameOf(stack.resource).includes(chestQuery);
        const cell = make('div', 'chest-cell' + (!stack || !matched ? ' empty' : ''));
        cell.dataset.index = String(slot);
        const location: InventoryLocation = { kind: 'chest', id: chest.id, slot };
        if (matched) bindInventoryCell(cell, stack, location, location);
        grid.append(cell);
      }
    };
    search.addEventListener('input', () => { chestQuery = search.value; draw(); });
    order.addEventListener('click', () => {
      chestSort = (chestSort + 1) % sortLabels.length;
      order.textContent = sortLabels[chestSort]!;
      draw();
    });
    draw();
  }


  /**
   * 随从面板：左栏数值、右栏背包。照 Unity 的 FollowerPanelUI。
   * 靠近某个居民右键打开，显示的是它自己的状态和身上背的东西。
   */
  function renderFollowerBag(c: ColonySnapshot, root: HTMLElement) {
    const p = c.colonists.find((x) => x.id === followerPanelId);
    if (!p) { root.append(note('找不到这个居民。')); return; }

    const wrap = make('div', 'fb-wrap');
    const left = make('div', 'fb-left');
    const right = make('div', 'fb-right');

    // 血条：天工用 health（0-100）
    const hpRow = make('div', 'fb-bar health');
    hpRow.append(make('i', ''), make('span', 'fb-bar-text', `${Math.round(p.health)} / 100`));
    const hpFill = hpRow.querySelector('i') as HTMLElement;
    hpFill.style.width = `${Math.max(0, Math.min(100, p.health))}%`;

    // 体力条：天工对应的是 rest（休息度）
    const spRow = make('div', 'fb-bar stamina');
    spRow.append(make('i', ''), make('span', 'fb-bar-text', `${Math.round(p.rest)} / 100`));
    const spFill = spRow.querySelector('i') as HTMLElement;
    spFill.style.width = `${Math.max(0, Math.min(100, p.rest))}%`;

    left.append(hpRow, spRow);
    left.append(make('p', 'fb-line', `状态：${p.task || '待命'}`));
    left.append(make('p', 'fb-line', `任务：${p.jobId ? '进行中' : '无'}`));

    const grid = make('div', 'fb-grid');
    const personal: InventoryLocation = { kind: 'follower', id: p.id };
    const cargo: InventoryLocation = { kind: 'cargo', id: p.id };
    const carrying = RESOURCE_TYPES.flatMap(resource => p.carrying[resource] ? [{ resource, count: p.carrying[resource]! }] : []);
    const stacks = [...p.bag, ...carrying];
    for (let i = 0; i < PLAYER_SLOTS; i++) {
      const stack = stacks[i] ?? null;
      const cell = make('div', 'fb-cell' + (stack ? '' : ' empty'));
      cell.dataset.index = String(i);
      bindInventoryCell(cell, stack, i === 0 ? personal : cargo, personal);
      if (i > 0 && stack) cell.title += '（搬运中）';
      grid.append(cell);
    }
    right.append(grid, note('随身背包可装一叠物品'));


    wrap.append(left, right);
    root.append(wrap);
  }

  /** 随从：居民的概览页。姓名、在干什么、三项关键需求，点进去看完整档案。 */
  function renderFollower(c: ColonySnapshot, root: HTMLElement) {
    // 你自己单独一块。玩家不在 colonists 里，所以列表里那些全是随从，
    // 但界面上得让人一眼看出「哪个是我」。
    const v = state?.player?.vitals;
    if (v) {
      const self = make('div', 'self-card');
      const head = make('div', 'self-head');
      head.append(make('span', 'self-tag', '玩家'), make('strong', '', '你'));
      self.append(head);

      const bars = make('div', 'self-bars');
      for (const [cls, n, max, label] of [
        ['health', v.health, v.maxHealth, '生命'],
        ['stamina', v.stamina, v.maxStamina, '体力'],
      ] as [string, number, number, string][]) {
        const bar = make('div', `fb-bar ${cls}`);
        const fill = make('i', '');
        fill.style.width = `${Math.max(0, Math.min(100, max > 0 ? (n / max) * 100 : 0))}%`;
        bar.append(fill, make('span', 'fb-bar-text', `${label} ${Math.round(n)} / ${max}`));
        bars.append(bar);
      }
      self.append(bars);

      const carried = (state?.player?.bag ?? []).filter(Boolean);
      self.append(make('p', 'self-foot', carried.length
        ? `身上带着 ${carried.length} 种东西 · 银币 ${Math.floor(v.gold)}`
        : `身上没有东西 · 银币 ${Math.floor(v.gold)}`));
      root.append(self);
    }

    root.append(note('跟着你一起生活的人。点名字可以打开完整档案，也能在工作页调他们的优先级。'));
    const list = make('div', 'row-list');
    for (const p of c.colonists) {
      const row = make('div', 'production-row'), main = make('div', 'row-main');
      main.append(
        make('strong', '', p.name),
        make('p', '', `${p.task || '待命'} · ${SCHEDULES[p.schedule]}${p.disease > 0 ? ' · 身体不适' : ''}`),
      );
      const meters = make('div', 'row-actions');
      for (const [label, value] of [['饱食', p.hunger], ['精力', p.rest], ['心情', p.mood]] as [string, number][]) {
        meters.append(make('span', '', `${label} ${percent(value)}%`));
      }
      row.append(main, meters);
      list.append(row);
    }
    root.append(list);
  }

  /**
   * 让一个容器格子能被拖到快捷栏。照 Unity 的 ContainerSlot 拖放：
   * 源格知道自己装的是哪件东西，落点格（快捷栏）知道自己收哪一格。
   * 用指针事件手写，不用 HTML5 draggable——后者在 Shadow DOM 里行为不一致。
   */
  const inventoryTargets = new WeakMap<Element, InventoryLocation>();
  let cancelInventoryDrag: (() => void) | undefined;
  let ignoreInventoryClick = false;

  function transferInventory(from: InventoryLocation, to: InventoryLocation, stack: DraggableStack) {
    send('inventory', { from, to, resource: stack.resource, amount: stack.count });
  }

  function setInventoryTarget(cell: HTMLElement, location: InventoryLocation) {
    cell.dataset.inventoryTarget = '';
    inventoryTargets.set(cell, location);
  }

  function bindInventoryCell(cell: HTMLElement, stack: PlayerInventorySlot, from: InventoryLocation, to: InventoryLocation) {
    setInventoryTarget(cell, to);
    if (!stack) return;
    cell.dataset.item = stack.resource;
    cell.title = nameOf(stack.resource) + ' · ' + stack.count;
    cell.append(make('span', 'wh-icon', iconOf(stack.resource)), make('span', 'wh-count', String(stack.count)));
    cell.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openItemMenu(stack.resource, event.clientX, event.clientY, from);
    });
    attachInventoryDrag(cell, stack, from);
  }

  function attachInventoryDrag(cell: HTMLElement, stack: DraggableStack, from: InventoryLocation) {
    cell.classList.add('inventory-source');
    cell.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary) return;
      cancelInventoryDrag?.();
      const { pointerId, clientX, clientY } = event;
      let ghost: HTMLElement | undefined;
      let highlighted: Element | null = null;

      const targetAt = (point: PointerEvent) => {
        const hit = shadow.elementFromPoint(point.clientX, point.clientY);
        return hit?.closest('[data-inventory-target]') ?? null;
      };
      const move = (point: PointerEvent) => {
        if (point.pointerId !== pointerId) return;
        if (!ghost) {
          if (!shellEl || Math.hypot(point.clientX - clientX, point.clientY - clientY) < 6) return;
          closeItemMenu();
          ghost = make('div', 'drag-ghost');
          ghost.append(make('span', 'wh-icon', iconOf(stack.resource)), make('span', 'wh-count', String(stack.count)));
          shellEl.append(ghost);
        }
        const frame = shellEl!.getBoundingClientRect();
        ghost.style.left = String(point.clientX - frame.left - 22) + 'px';
        ghost.style.top = String(point.clientY - frame.top - 22) + 'px';
        highlighted?.classList.remove('drop-target');
        highlighted = targetAt(point);
        highlighted?.classList.add('drop-target');
      };
      const clearDrag = () => {
        doc.removeEventListener('pointermove', move, true);
        doc.removeEventListener('pointerup', finish, true);
        doc.removeEventListener('pointercancel', cancel, true);
        win.removeEventListener('blur', clearDrag);
        ghost?.remove();
        highlighted?.classList.remove('drop-target');
        cancelInventoryDrag = undefined;
      };
      const finish = (point: PointerEvent) => {
        if (point.pointerId !== pointerId) return;
        const target = ghost && targetAt(point);
        const dragged = Boolean(ghost);
        clearDrag();
        if (!dragged) return;
        ignoreInventoryClick = true;
        win.setTimeout(() => { ignoreInventoryClick = false; }, 0);
        const to = target ? inventoryTargets.get(target) : undefined;
        if (to) transferInventory(from, to, stack);
      };
      const cancel = (point: PointerEvent) => {
        if (point.pointerId === pointerId) clearDrag();
      };

      cancelInventoryDrag = clearDrag;
      doc.addEventListener('pointermove', move, true);
      doc.addEventListener('pointerup', finish, true);
      doc.addEventListener('pointercancel', cancel, true);
      win.addEventListener('blur', clearDrag);
    });
  }
  releases.push(() => cancelInventoryDrag?.());


  function renderInteractHint() {
    const hint = get('interact-hint');
    const key = get('hint-key');
    const text = get('hint-text');
    const demolition = get('demolition-hint');
    const kind = state?.player?.nearHint ?? null;
    const action = state?.player?.demolitionHint;
    hint.hidden = (!kind && !action) || !!state?.player?.constructionId;
    key.hidden = text.hidden = !kind;
    demolition.hidden = !action;
    demolition.textContent = action ?? '';
    text.textContent = kind === 'chest' ? '打开木箱' : '打开随从背包';
  }

  function renderConstruction() {
    const progress = get('construction-progress');
    const id = state?.player?.constructionId;
    const building = id ? state?.colony?.buildings.find(candidate => candidate.id === id) : undefined;
    progress.hidden = !building;
    if (building) {
      progress.textContent = `建造${BUILDING_DEFS[building.kind].name} · ${Math.round(building.progress * 100)}%${building.blockedReason ? ` · ${building.blockedReason}` : ''}`;
    }
  }

  /** 右上角三条数值：血量、体力、金币。照 Unity 的 VitalsUI。 */
  function renderVitals() {
    const v = state?.player?.vitals;
    if (!v) return;
    const pct = (n: number, max: number) => `${Math.max(0, Math.min(100, max > 0 ? (n / max) * 100 : 0))}%`;
    const hp = get('vital-health');
    const sp = get('vital-stamina');
    const gold = get('vital-gold');
    if (hp) hp.style.width = pct(v.health, v.maxHealth);
    if (sp) sp.style.width = pct(v.stamina, v.maxStamina);
    if (gold) gold.textContent = String(Math.floor(v.gold));
  }

  type DraggableStack = NonNullable<PlayerInventorySlot>;

  /** 工具类物品的图标。资源表里没有它们，单独挂一份。加新工具往这里补一行。 */
  const TOOL_ICONS: Record<string, string> = { [HAMMER]: '🔨', [AXE]: '🪓', [PICKAXE]: '⛏️' };
  const iconOf = (resource: InventoryItem) => {
    const building = buildingItemKind(resource);
    return building ? BUILD_ICONS[building] ?? '▧' : TOOL_ICONS[resource] ?? RESOURCE_ICONS[resource as Resource] ?? '·';
  };

  function renderHotbar() {
    const bar = get('hotbar');
    if (!bar) return;
    const player = state?.player;
    const bag = player?.bag ?? [];
    const selected = player?.bagSelected ?? 0;
    const signature = `${selected}|${bag.map((b: { resource: string; count: number } | null) => (b ? `${b.resource}:${b.count}` : '-')).join(',')}`;
    if (bar.dataset.signature === signature) return;
    bar.dataset.signature = signature;
    clear(bar);

    for (let i = 0; i < PLAYER_SLOTS; i++) {
      const item = bag[i] ?? null;
      const slot = make('div', `hotbar-slot${i === selected ? ' active' : ''}${item ? '' : ' empty'}`);
      slot.dataset.index = String(i);
      const location: InventoryLocation = { kind: 'player', slot: i };
      setInventoryTarget(slot, location);
      slot.append(make('span', 'hotbar-key', String(i + 1)));
      if (item?.resource === HAMMER) {
        slot.dataset.item = HAMMER;
        slot.title = '锤子 · 左键附近的蓝图施工（可拖到其他格）';
        slot.append(make('span', '', '🔨'));
        // 锤子也是普通物品，拖放规则和其它格一样——之前这里跳过了，
        // 所以只有它拖不动。以后加新工具走同一条路就行。
        attachInventoryDrag(slot, item, location);
      } else if (item) {
        const res = item.resource;
        slot.dataset.item = res;
        slot.append(make('span', '', iconOf(res)));
        slot.append(make('span', 'hotbar-count', String(item.count)));
        slot.title = `${nameOf(res)} · ${item.count}`;
        attachInventoryDrag(slot, item, location);
      }
      slot.addEventListener('click', () => { if (!ignoreInventoryClick) send('bagSelect', { index: i }); });
      bar.append(slot);
    }

    const nameEl = get('hotbar-name');
    if (nameEl) {
      const cur = bag[selected];
      const toolHints: Record<string, string> = { hammer: '锤子 · 左键蓝图施工', axe: '木斧 · 左键砍树（更快）', pickaxe: '石镐 · 长按左键采石和钢矿' };
      nameEl.textContent = cur ? (toolHints[cur.resource] ?? (buildingItemKind(cur.resource) ? `${nameOf(cur.resource)} · 左键放置 · T 旋转` : nameOf(cur.resource))) : '';
    }
  }

  function renderPanel(force = false) {
    if (!panel || !state) return;
    const content = get('panel-content'), focused = shadow.activeElement;
    // A simulation snapshot must not replace a field while the player is typing.
    if (!force && focused && content.contains(focused) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(focused.tagName)) return;
    const c = state.colony;
    const follower = panel === 'followerBag' ? c?.colonists.find(p => p.id === followerPanelId) : undefined;
    const stamp = JSON.stringify(panel === 'chest' ? [panel, c?.chests.find(chest => chest.id === chestPanelId)]
      : panel === 'followerBag' ? [panel, follower && [follower.id, follower.name, follower.task, follower.jobId,
        Math.round(follower.health), Math.round(follower.rest), follower.bag, follower.carrying]]
      : panel === 'warehouse' ? [panel, c?.resources, c?.items.length, c && warehouseDeliveries(c)]
      : [panel, currentTool, state.crop, state.selected, state.edits, state.undo, state.redo, state.buildHeight, state.buildRotation, state.terrain && [state.terrain.target, state.terrain.size, state.terrain.shape, state.terrain.sample], c && { resources: c.resources, priorities: c.colonists.map(p => [p.id, p.priorities, p.schedule]), research: c.research, power: c.power, bills: c.bills, trade: c.trade, events: c.events.length, buildings: c.buildings.map(b => [b.id, b.complete, b.phase, b.blockedReason, b.rotation, b.doorOpen, percent(b.progress * 100)]), terrainPlans: c.terrainPlans?.map(p => [p.id, p.state, p.remainingCut, p.remainingFill, p.blockedReason]), jobs: c.jobs.map(j => [j.id, j.state, j.label]), zones: c.zones.length, time: Math.floor(c.time) }]);
    if (!force && stamp === lastPanelStamp) return;
    lastPanelStamp = stamp;
    // 随从面板的标题是那个人的名字，不是栏目名
    const followerName = follower?.name;
    get('panel-title').textContent = followerName ?? MENU_NAMES[panel] ?? '家园管理';
    const root = get('panel-content'), scrollTop = root.scrollTop; clear(root);
    if (panel === 'sandbox') { renderSandbox(root); root.scrollTop = scrollTop; return; }
    if (!c) { root.append(empty('正在等待居民与世界数据…')); return; }
    ({ build: renderBuild, plan: renderPlan, work: renderWork, production: renderProduction, research: renderResearch, trade: renderTrade, logs: renderLogs, warehouse: renderWarehouse, follower: renderFollower, chest: renderChest, followerBag: renderFollowerBag } as Record<string, (c: ColonySnapshot, root: HTMLElement) => void>)[panel]?.(c, root);
    root.scrollTop = scrollTop;
  }
  function renderBuildingInspector(c: ColonySnapshot, force = false) {
    const b = c.buildings.find(building => building.id === selectedBuilding);
    if (!b) { selectedBuilding = null; get('inspector').hidden = true; return; }
    const stamp = JSON.stringify(['building', b]);
    if (!force && stamp === lastInspectorStamp) return;
    lastInspectorStamp = stamp;
    get('inspector-kicker').textContent = '整体设施';
    get('resident-name').textContent = BUILDING_DEFS[b.kind].name;
    const root = clear(get('resident-content')), details = make('div', 'building-inspector');
    details.dataset.testid = 'building-inspector'; details.dataset.buildingId = b.id;
    details.append(make('div', 'resident-activity', `${buildingPhase(b.phase)}${b.complete ? '' : ` · ${percent(b.progress * 100)}%`}`));
    const measurements = make('p', 'building-dimensions', `占地 ${b.w} × ${b.d} 格 · 高 ${b.h} 格 · 朝向 ${orientationText(b.rotation)}`);
    measurements.dataset.testid = 'building-dimensions'; details.append(measurements);
    details.append(make('p', 'panel-note', `位置 [${b.x}, ${b.y}, ${b.z}] · 点击任一部分都选中整个物体。`));
    if (b.kind === 'bed' || b.kind === 'medicalBed') details.append(note('床头与床尾共用一座设施，整体建造、使用和拆除。'));
    if (b.blockedReason) details.append(make('p', 'thought bad', b.blockedReason));
    const actions = make('div', 'building-inspector-actions');
    if (b.kind === 'door') {
      const doorState = make('p', 'door-state', b.complete ? (b.doorOpen ? '门已打开 · 可以通行 · 房间向外开放' : '门已关闭 · 阻挡通行 · 可围合房间') : '施工完成后可以开关门');
      doorState.dataset.testid = 'building-door-state'; details.append(doorState);
      const toggle = button(b.doorOpen ? '关闭门' : '打开门', 'building-toggle-door', { action: 'toggleDoor', id: b.id }, 'primary');
      toggle.disabled = !b.complete; actions.append(toggle);
      details.append(note('上下两格同步开关。门口有人时不能关门。'));
    }
    actions.append(button(b.complete ? '拆除整座设施' : '取消整座蓝图', 'building-demolish', { action: 'demolish', id: b.id }, 'danger'));
    details.append(actions, note(b.storage ? '箱体和箱内物品会分别掉落，拾取后可重新放置空箱。'
      : b.complete ? '拆下的整座设施会掉在地上，可拾取并重新放置。' : '取消返还尚未使用的预约建材，已经完成的整地保留。'));
    root.append(details);
  }
  function renderTreeInspector(c: ColonySnapshot, force = false) {
    const tree = state?.trees?.find(t => t.id === selectedTree);
    if (!tree) { selectedTree = null; get('inspector').hidden = true; return; }
    const job = c.jobs.find(j => j.type === 'chop' && j.targetId === tree.id);
    const stamp = JSON.stringify(['tree', tree, job?.id, job?.progress]);
    if (!force && stamp === lastInspectorStamp) return;
    lastInspectorStamp = stamp;
    get('inspector-kicker').textContent = '自然物体'; get('resident-name').textContent = '整棵树木';
    const root = clear(get('resident-content')), details = make('div', 'building-inspector');
    details.dataset.testid = 'tree-inspector'; details.dataset.treeId = tree.id;
    details.append(make('div', 'resident-activity', job ? `已安排伐木 · ${Math.round(job.progress / Math.max(1, job.work) * 100)}%` : '生长中的树木'));
    details.append(make('p', 'building-dimensions', `高 ${tree.trunkHeight + 2} 格 · 树干位置 [${tree.x}, ${tree.y}, ${tree.z}]`));
    details.append(note('树干、分枝与树冠属于同一个物体。点击任一部分都选中整棵树。'));
    const actions = make('div', 'building-inspector-actions');
    if (job) actions.append(button('取消伐木', 'tree-cancel-chop', { action: 'cancel', id: job.id }));
    else actions.append(button('安排整棵伐木', 'tree-chop', { action: 'designate', kind: 'chop', id: tree.id }, 'primary'));
    details.append(actions, note(`居民会走到树干旁砍伐，完成后整棵移除，产出 ${tree.trunkHeight * 6} 木材。相邻树木保持独立。`));
    root.append(details);
  }
  function renderInspector(c: ColonySnapshot, force = false) {
    if (get('inspector').hidden) return;
    if (selectedTree) { renderTreeInspector(c, force); return; }
    if (selectedBuilding) { renderBuildingInspector(c, force); return; }
    if (!selectedResident || get('inspector').hidden) return;
    const p = c.colonists.find(person => person.id === selectedResident); if (!p) return;
    const stamp = JSON.stringify([p.id, p.task, p.traits, p.schedule, p.skills, ...[p.health, p.hunger, p.rest, p.recreation, p.mood, p.disease, p.comfort].map(Math.floor)]);
    if (!force && stamp === lastInspectorStamp) return; lastInspectorStamp = stamp;
    const scrollTop = get('inspector').scrollTop;
    get('inspector-kicker').textContent = '居民档案';
    get('resident-name').textContent = p.name; const root = clear(get('resident-content'));
    root.append(make('div', 'resident-activity', `${p.task || '待命'} · ${SCHEDULES[p.schedule]}`));
    const traits = make('div', 'resident-traits'); for (const trait of p.traits) traits.append(make('span', 'tag', trait)); root.append(traits);
    const needs: [string, number][] = [['健康', p.health], ['饱食', p.hunger], ['精力', p.rest], ['娱乐', p.recreation], ['心情', p.mood]];
    for (const [name, value] of needs) { const row = make('div', 'need'), track = make('div', 'need-track'), fill = make('div', `need-fill${value < 25 ? ' bad' : value < 45 ? ' warn' : ''}`); fill.style.width = `${percent(value)}%`; track.append(fill); row.append(make('span', '', name), track, make('span', 'need-value', `${percent(value)}%`)); root.append(row); }
    const skills = make('div', 'detail-section'); skills.append(make('h3', '', '技能')); const grid = make('div', 'skill-grid');
    for (const job of JOB_TYPES) { const row = make('div', 'skill'); row.append(make('span', '', JOB_NAMES[job]), make('strong', '', p.skills[job].toFixed(1))); grid.append(row); } skills.append(grid); root.append(skills);
    const thoughts = make('div', 'detail-section'); thoughts.append(make('h3', '', '生活感受'));
    const observations: [string, string][] = [];
    if (p.hunger < 30) observations.push(['饥饿：需要进食。', 'bad']);
    if (p.rest < 30) observations.push(['疲惫：需要睡眠。', 'bad']);
    if (p.recreation < 30) observations.push(['单调：需要一些休闲。', 'bad']);
    if (p.comfort > 55) observations.push(['居住环境舒适。', 'good']);
    if (p.mood >= 65) observations.push(['对目前的生活感到满意。', 'good']);
    if (!observations.length) observations.push(['正在适应家园的生活节奏。', '']);
    for (const [text, cls] of observations) thoughts.append(make('p', `thought ${cls}`, text));
    thoughts.append(make('p', `thought${p.disease > 0 ? ' bad' : ''}`, p.disease > 0 ? `疾病程度 ${Math.round(p.disease)}% · 医护工作与药品有助恢复` : '没有疾病症状'));
    const carrying = costText(p.carrying); if (carrying) thoughts.append(make('p', 'thought', `携带：${carrying}`)); root.append(thoughts); get('inspector').scrollTop = scrollTop;
  }
  function renderColony(c: ColonySnapshot) {
    get('date').textContent = `第 ${c.day} 天 · ${c.season} · ${clockText(c.hour)}`;
    get('weather').textContent = `${c.weather} · ${Math.round(c.temperature)}°C${c.speed === 0 ? ' · 已暂停' : ''}`;
    for (const b of shadow.querySelectorAll<HTMLElement>('[data-speed]')) b.classList.toggle('active', Number(b.dataset.speed) === c.speed);
    for (const resource of RESOURCE_TYPES) { const el = get(`resource-${resource}`); el.querySelector('b')!.textContent = String(int(c.resources[resource])); el.classList.toggle('low', (resource === 'food' || resource === 'meal') && c.resources[resource] < 5); }
    get('population').textContent = `${c.colonists.length} 人`;
    const stamp = JSON.stringify(c.colonists.map(p => [p.id, p.name, p.task, Math.round(p.mood), p.id === selectedResident]));
    if (stamp !== lastCardsStamp) {
      lastCardsStamp = stamp; const list = get('colonists'), scrollTop = list.scrollTop; clear(list);
      for (const person of c.colonists) {
        const b = button('', `colonist-${person.id}`, { action: 'select', colonistId: person.id }, 'colonist-card'); b.dataset.resident = person.id; b.classList.toggle('active', person.id === selectedResident);
        const portrait = make('span', 'portrait', person.name.slice(0, 1));
        const summary = make('span', 'colonist-summary'), name = make('span', 'colonist-name'); name.append(make('span', '', person.name), make('small', '', `${percent(person.mood)}%`));
        const meter = make('span', 'tiny-meter'), fill = make('span'); fill.style.width = `${percent(person.mood)}%`; meter.append(fill);
        summary.append(name, make('span', 'colonist-job', person.task || '待命'), meter); b.append(portrait, summary); list.append(b);
      }
      list.scrollTop = scrollTop;
    }
    const goals: [string, boolean][] = [
      ['规划一片仓储区', c.zones.some(z => z.kind === 'stockpile')], ['规划一片农田', c.zones.some(z => z.kind === 'farm')],
      [`为 ${c.colonists.length} 位居民准备床铺`, c.buildings.filter(b => b.complete && (b.kind === 'bed' || b.kind === 'medicalBed')).length >= c.colonists.length], ['建好炉灶，储备熟食', c.buildings.some(b => b.kind === 'stove' && b.complete) && c.resources.meal >= 6],
    ];
    const goalRoot = clear(get('goal-list')); for (const [text, done] of goals) { const row = make('div', `goal${done ? ' done' : ''}`); row.append(make('span', 'goal-mark', done ? '✓' : '○'), make('span', '', text)); goalRoot.append(row); }
    const buildingId = state?.selectedBuildingId ?? null;
    if (buildingId !== lastSelectedBuilding) {
      lastSelectedBuilding = buildingId;
      if (buildingId) {
        selectedBuilding = buildingId; selectedResident = null; selectedTree = null; panel = ''; get('workspace').hidden = true;
        hideSidePanels(); get('inspector').hidden = false; lastInspectorStamp = '';
      } else if (selectedBuilding) {
        selectedBuilding = null; get('inspector').hidden = true;
      }
    }
    const treeId = state?.selectedTreeId ?? null;
    if (treeId !== lastSelectedTree) {
      lastSelectedTree = treeId;
      if (treeId) {
        selectedTree = treeId; selectedResident = null; selectedBuilding = null; panel = ''; get('workspace').hidden = true;
        hideSidePanels(); get('inspector').hidden = false; lastInspectorStamp = '';
      } else if (selectedTree) { selectedTree = null; get('inspector').hidden = true; }
    }
    if (!c.selectedColonistId) lastSelectedFromWorld = null;
    if (c.selectedColonistId && c.selectedColonistId !== lastSelectedFromWorld) {
      lastSelectedFromWorld = c.selectedColonistId;
      // 只在没开别的面板时才切到档案。
      // 之前这里无条件关面板，用户正在看仓库时会被凭空顶掉——
      // 每 0.4 秒的投影刷新都会跑一次这段，看着就像「面板自己关了」。
      if (!panel && get('workspace').hidden) {
        selectedResident = c.selectedColonistId; selectedBuilding = null; selectedTree = null;
        hideSidePanels();
        get('inspector').hidden = false;
      }
    }
    renderInspector(c); renderPanel();
  }

  const requestSave = (intent: SaveIntent) => {
    if (!booted || !state) return;
    if (pendingSave) { if (intent !== 'auto') queuedSave = intent; return; }
    pendingSave = intent; savingStamp = latestStamp; savingSim = state.colony?.time ?? 0; lastSaveTime = Date.now(); send('save');
    if (intent !== 'auto') saySave(intent === 'export' ? '正在准备导出文件…' : '正在保存家园…');
  };
  const readSave = (manual: boolean) => {
    try { return (manual ? win.localStorage.getItem(MANUAL_KEY) : null) ?? win.localStorage.getItem(SAVE_KEY) ?? win.localStorage.getItem(LEGACY_KEY); }
    catch { saySave('浏览器不允许读取存档'); return null; }
  };
  const requestLoad = (data: string, text: string) => { pendingLoadAt = Date.now(); send('load', { data }); saySave(text); };
  const loadSaved = () => { const data = readSave(true); if (data) requestLoad(data, '正在读取家园…'); else saySave('还没有本机存档'); };
  const download = (data: string) => {
    const blob = new Blob([data], { type: 'application/json;charset=utf-8' }), url = URL.createObjectURL(blob), link = doc.createElement('a');
    link.href = url; link.download = `森屿-${(state?.seed ?? '家园').replace(/[<>:"/\\|?*]/g, '_')}.json`; doc.body.append(link); link.click(); link.remove(); win.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  for (const resource of RESOURCE_TYPES) { const el = make('div', 'resource'); el.id = `resource-${resource}`; el.append(make('span', 'resource-symbol', RESOURCE_ICONS[resource]), make('span', '', RESOURCE_NAMES[resource]), make('b', '', '—')); get('resources').append(el); }
  for (const b of shadow.querySelectorAll<HTMLElement>('[data-speed]')) b.dataset.testid = `speed-${b.dataset.speed}`;
  for (const b of shadow.querySelectorAll<HTMLElement>('[data-menu]')) b.dataset.testid = `menu-${b.dataset.menu}`;
  on(shadow, 'change', (event) => {
    const field = event.target as HTMLInputElement | HTMLSelectElement | null;
    if (!field) return;
    if (field.id === 'terrain-shape') {
      send('terrain-settings', { shape: field.value }); return;
    }
    if (['terrain-target', 'terrain-size', 'build-height'].includes(field.id)) {
      const input = field as HTMLInputElement, value = input.valueAsNumber;
      if (!Number.isInteger(value) || !input.checkValidity()) { input.reportValidity(); return; }
      if (input.id === 'build-height') send('build-height', { value });
      else send('terrain-settings', input.id === 'terrain-target' ? { target: value } : { size: value });
      return;
    }
    if (field.id === 'build-height-auto') {
      const auto = field as HTMLInputElement, height = get<HTMLInputElement>('build-height');
      height.disabled = auto.checked;
      if (auto.checked) send('build-height', { value: null });
      else if (height.checkValidity()) send('build-height', { value: height.valueAsNumber });
    }
  });
  on(shadow, 'click', (event) => {
    const b = (event.target as Element | null)?.closest<HTMLButtonElement>('button'); if (!b || b.disabled) return;
    if (b.dataset.speed) { colonyCommand({ action: 'speed', value: Number(b.dataset.speed) }); return; }
    if (b.dataset.menu) { openPanel(b.dataset.menu); return; }
    if (b.dataset.tool) { chooseTool(b.dataset.tool); return; }
    if (b.dataset.crop) { send('crop', { value: b.dataset.crop }); return; }
    if (b.dataset.block) { send('select', { block: Number(b.dataset.block) }); chooseTool('sandbox:build'); return; }
    if (b.dataset.voxelAction) { send(b.dataset.voxelAction); return; }
    if (b.dataset.terrainAction === 'sample') { chooseTool('level'); send('terrain-sample'); return; }
    if (b.dataset.command) {
      if (b.dataset.resident) { selectedResident = b.dataset.resident; selectedBuilding = null; selectedTree = null; panel = ''; get('workspace').hidden = true; hideSidePanels(); get('inspector').hidden = false; chooseTool('inspect'); if (state?.colony) renderInspector(state.colony, true); }
      colonyCommand(JSON.parse(b.dataset.command) as ColonyCommand); return;
    }
    switch (b.id) {
      case 'home': send('home'); break;
      case 'panel-close': cancelInventoryDrag?.(); panel = ''; get('workspace').hidden = true; syncTerrainControls(); syncHover(); break;
      case 'inspector-close': get('inspector').hidden = true; clearSelection(); syncTerrainControls(); syncHover(); break;
      case 'settings-toggle': showWorldSettings(!!get('settings').hidden); break;
      case 'help-toggle': { const hidden = !get('help').hidden; if (!get('inspector').hidden) clearSelection(); hideSidePanels(); get('workspace').hidden = true; panel = ''; get('help').hidden = hidden; syncTerrainControls(); break; }
      case 'settings-close': get('settings').hidden = true; syncTerrainControls(); syncHover(); break;
      case 'help-close': get('help').hidden = true; syncTerrainControls(); syncHover(); break;
      case 'save': requestSave('manual'); break;
      case 'load': loadSaved(); break;
      case 'export': requestSave('export'); break;
      case 'import': get('import-panel').hidden = false; get<HTMLTextAreaElement>('import-json').focus(); break;
      case 'import-cancel': get('import-panel').hidden = true; get<HTMLTextAreaElement>('import-json').blur(); syncHover(); break;
      case 'import-confirm': {
        const data = get<HTMLTextAreaElement>('import-json').value.trim();
        if (!data || data.length > 8 * 1024 * 1024) { saySave('请粘贴有效的家园 JSON，内容不能超过 8 MB'); break; }
        try { JSON.parse(data); requestLoad(data, '正在校验并导入家园…'); } catch { saySave('这不是有效的 JSON 存档'); }
        break;
      }
      case 'generate': {
        const seed = get<HTMLInputElement>('seed').value.trim(); if (!seed) { saySave('请输入世界种子'); break; }
        if (Date.now() > confirmUntil) { confirmUntil = Date.now() + 5000; get('generate-hint').textContent = '5 秒内再点一次，重建土地与殖民地'; break; }
        confirmUntil = 0; get('generate-hint').textContent = '生成新世界会重置居民与当前规划。'; send('reseed', { seed }); get<HTMLInputElement>('seed').blur(); selectedResident = null; chooseTool('inspect'); break;
      }
    }
  });
  const showChest = (id: string) => {
    const same = chestPanelId === id;
    chestPanelId = id;
    if (!same) { chestSort = 0; chestQuery = ''; chestCategory = 'all'; chestMenuOpen = false; }
    openPanel('chest', same);
  };
  let inventoryNoticeTimer = 0;
  releases.push(() => win.clearTimeout(inventoryNoticeTimer));
  const message = (event: Event) => {
    const msg = (event as MessageEvent).data;
    if (msg?.type === 'voxel:loaded' && typeof msg.data === 'string') {
      pendingLoadAt = 0; lastSavedSim = 0; lastSavedStamp = ''; lastSaveTime = Date.now(); selectedResident = null; selectedBuilding = null; lastSelectedFromWorld = null; lastSelectedBuilding = null;
      get('import-panel').hidden = true; get<HTMLTextAreaElement>('import-json').value = '';
      try { win.localStorage.setItem(SAVE_KEY, msg.data); saySave('家园已载入，自动存档已同步'); } catch { saySave('家园已载入，但本机存储不可用'); }
      return;
    }
    if (msg?.type === 'voxel:inventory-status' && typeof msg.message === 'string') {
      const notice = get('inventory-notice');
      notice.textContent = msg.message;
      notice.hidden = false;
      win.clearTimeout(inventoryNoticeTimer);
      inventoryNoticeTimer = win.setTimeout(() => { notice.hidden = true; }, 2200);
      return;
    }
    if (msg?.type === 'voxel:openChest' && typeof msg.id === 'string') { showChest(msg.id); return; }
    if (msg?.type === 'voxel:openFollower' && typeof msg.id === 'string') {
      const same = followerPanelId === msg.id;
      followerPanelId = msg.id;
      openPanel('followerBag', same);
      return;
    }
    if (msg?.type === 'voxel:save') {
      const intent = pendingSave ?? 'auto', data = typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data);
      pendingSave = null;
      try {
        win.localStorage.setItem(SAVE_KEY, data); if (intent === 'manual') win.localStorage.setItem(MANUAL_KEY, data);
        lastSavedSim = savingSim; lastSavedStamp = savingStamp;
        if (intent === 'export') { download(data); saySave('已导出家园存档'); } else saySave(intent === 'manual' ? '手动存档已保存到本机' : '家园已自动保存');
      } catch { if (intent === 'export') { try { download(data); saySave('已导出文件；本机存储不可用'); } catch { saySave('保存与导出失败，请检查浏览器权限'); } } else saySave('保存失败，请检查浏览器存储空间'); }
      if (queuedSave) { const next = queuedSave; queuedSave = null; requestSave(next); } return;
    }
    if (msg?.type !== 'voxel:state') return;
    state = (msg.state ?? msg) as State;
    // 视角决定 HUD 形态：
    //   俯视 = 指挥官，底部要有建造/规划/研究那排菜单
    //   玩家 = 自己下去干活，那一排反而挡视线
    // 标记挂在 .shell 上而不是 body——UI 在 Shadow DOM 里，
    // 样式规则只认作用域内的选择器，用 body 会被校验直接拒掉。
    const viewMode = state.camera?.mode ?? 'god';
    shellEl = shadow.querySelector('.shell') as HTMLElement | null;
    if (shellEl && shellEl.dataset.viewMode !== viewMode) shellEl.dataset.viewMode = viewMode;
    if (state.tool) { currentTool = state.tool; showTool(currentTool); }
    get('status').textContent = state.status ?? '选择一项规划，让居民开始工作';
    get('cell').textContent = Array.isArray(state.hoverCell) ? `[ ${state.hoverCell.join(', ')} ]` : '';
    if (state.seed !== lastWorldSeed) { lastWorldSeed = state.seed; get<HTMLInputElement>('seed').value = state.seed; }
    get('world-size').textContent = state.worldSize ? `当前地图 ${state.worldSize[0]} × ${state.worldSize[2]} 格 · 新地图默认 250 × 250` : '新地图默认 250 × 250 格';
    const c = state.colony;
    latestStamp = JSON.stringify([state.seed, state.revision, state.edits, c && [c.speed, c.buildings.map(b => [b.id, b.complete, b.phase, b.rotation, b.doorOpen]), c.terrainPlans?.map(p => [p.id, p.target, p.cells.length, p.state]), c.zones, c.bills, c.research.active, c.playerBag, c.bagSelected, c.chests, c.colonists.map(p => [p.id, p.priorities, p.schedule, p.bag]), warehouseDeliveries(c)]]);
    updateItemAmount();
    if (c) renderColony(c); else renderPanel();
    if (c) renderHotbar();
    renderVitals();
    renderInteractHint();
    renderConstruction();
    syncTerrainControls();
    if (!booted) {
      booted = true; lastSavedStamp = latestStamp; lastSavedSim = c?.time ?? 0;
      const data = readSave(false); if (data) requestLoad(data, '正在恢复上次的家园…');
    }
  };
  if (port) { on(port, 'message', message); port.start?.(); send('sync'); } else saySave('引擎通信不可用');

  // 验收脚本要能在不开地图的情况下打开木箱面板（面板挂在 port 消息上，
  // 外部没法直接戳）。只暴露这一件事，不碰别的。
  const hooks = win as unknown as {
    __wbOpenChest?: () => void;
    __wbOpenFollower?: (id: string) => void;
    __wbSend?: (action: string, payload: Record<string, unknown>) => void;
  };
  hooks.__wbOpenChest = () => { const chest = state?.colony?.chests[0]; if (chest) showChest(chest.id); };
  hooks.__wbOpenFollower = (id: string) => { followerPanelId = id; openPanel('followerBag'); };
  // 验收要能直接构造想要的背包/木箱状态，省得靠拖拽一步步摆
  hooks.__wbSend = (action: string, payload: Record<string, unknown>) =>
    send(action as never, payload as never);

  // ---- ESC 暂停层 ----
  // 分两级：先关面板，面板都关了才弹出暂停层。
  // 必须在 UI 层监听——鼠标停在面板上时引擎那边被 uiHover 挡掉，收不到 ESC。
  const pauseLayer = get('pause-menu');
  const optionsLayer = get('game-options');
  let speedBeforePause = 1;
  const setPaused = (paused: boolean) => {
    if (!pauseLayer) return;
    pauseLayer.hidden = !paused;
    if (paused) {
      speedBeforePause = state?.colony?.speed || 1;
      if (speedBeforePause === 0) speedBeforePause = 1;
      colonyCommand({ action: 'speed', value: 0 });
    } else {
      colonyCommand({ action: 'speed', value: speedBeforePause });
    }
  };

  const onEscape = (event: KeyboardEvent) => {
    if (event.code !== 'Escape') return;
    try {
      // 0) 设置页盖在暂停层上面，先退这一层，回到「已暂停」
      if (optionsLayer && !optionsLayer.hidden) {
        optionsLayer.hidden = true;
        event.preventDefault();
        return;
      }
      const workspaceOpen = !get('workspace').hidden;
      const sideOpen = !get('settings').hidden || !get('help').hidden || !get('inspector').hidden;
      // 1) 有面板：先关面板
      if (panel || workspaceOpen || sideOpen) {
        panel = '';
        get('workspace').hidden = true;
        hideSidePanels();
        clearSelection();
        syncTerrainControls();
        syncHover();
        event.preventDefault();
        return;
      }
      // 2) 有工具：交给引擎取消工具，这时候别弹暂停层
      if (state?.tool && state.tool !== 'inspect') return;
      // 3) 都没有：弹暂停层
      setPaused(pauseLayer.hidden === true);
      event.preventDefault();
    } catch {
      // 面板状态异常时静默跳过，不要让 ESC 把整个 UI 卡死
    }
  };
  // 挂 window 的捕获阶段，这是事件链最早的一站。
  // 引擎的输入扫描会在 document 层拦掉 Escape（实测 document 捕获收不到，
  // 但手动 dispatch 到 shadow host 能收到），所以只能再往前站。
  win.addEventListener('keydown', onEscape as EventListener, true);
  releases.push(() => win.removeEventListener('keydown', onEscape as EventListener, true));

  on(get('pause-settings'), 'click', () => {
    // 暂停 → 设置 是同一套流程里的两页，不跳去右上角那个「世界与存档」
    if (optionsLayer) optionsLayer.hidden = false;
  });
  on(get('options-world'), 'click', () => {
    optionsLayer.hidden = true; setPaused(false); showWorldSettings(true);
  });
  const backBtn = get('options-back');
  if (backBtn) on(backBtn, 'click', () => { if (optionsLayer) optionsLayer.hidden = true; });
  on(get('pause-quit'), 'click', () => {
    // 退出前先把进度落盘，别让人白玩
    requestSave('manual');
    pauseLayer.hidden = true;

    // 浏览器只允许脚本自己开的窗口调用 close()，普通标签页会被静默忽略。
    // 所以这里分三步退化：关窗口 → 跳空白页 → 铺一块「已退出」的黑屏。
    win.close();

    win.setTimeout(() => {
      try {
        // 跳到空白页等效于退出：页面没了，进程交给浏览器回收
        win.location.replace('about:blank');
        return;
      } catch {
        // 被沙箱或 iframe 拦住时兜底
      }

      // 最后兜底：铺占位屏，至少让玩家知道游戏已经关了
      const goodbye = doc.createElement('div');
      goodbye.className = 'goodbye';
      goodbye.textContent = '游戏已退出，可以关闭这个标签页了';
      doc.body.append(goodbye);
      try { send('pause'); } catch { /* 引擎可能已经断了，忽略 */ }
    }, 120);
  });

  // 右键在画布上是「按住拖动平移镜头」，浏览器默认菜单会抢这个操作，拦掉。
  // 只拦 canvas：输入框的右键（复制粘贴）要留着。
  const blockCanvasMenu = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.tagName === 'CANVAS') event.preventDefault();
  };
  doc.addEventListener('contextmenu', blockCanvasMenu, true);
  releases.push(() => doc.removeEventListener('contextmenu', blockCanvasMenu, true));

  // 同一条思路：网页的拖拽选字也要拦。CSS 的 user-select 挡不住所有情况
  // （部分浏览器长按会先起一次 selectstart），这里再兜一层，输入框除外。
  const blockSelect = (event: Event) => {
    const target = event.composedPath()[0] as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    event.preventDefault();
  };
  doc.addEventListener('selectstart', blockSelect, true);
  releases.push(() => doc.removeEventListener('selectstart', blockSelect, true));

  // ---- 暂停里的设置页 ----
  const optInvertX = get<HTMLInputElement>('opt-invert-x');
  const optInvertY = get<HTMLInputElement>('opt-invert-y');
  const optSens = get<HTMLInputElement>('opt-sensitivity');
  const optSensValue = get('opt-sensitivity-value');
  if (optInvertX) on(optInvertX, 'change', () => send('setting', { key: 'invertPanX', value: optInvertX.checked }));
  if (optInvertY) on(optInvertY, 'change', () => send('setting', { key: 'invertPanY', value: optInvertY.checked }));
  if (optSens) {
    const pushSens = () => {
      const value = Number(optSens.value) / 1000;
      optSensValue.textContent = value.toFixed(3);
      send('setting', { key: 'panSensitivity', value });
    };
    on(optSens, 'input', pushSens);
  }

  // 数字键切快捷栏格子。只在玩家视角接管——
  // 俯视视角的 1/2/3 是速度、沙盒里 1-7 是选方块，不能抢。
  on(win, 'keydown', ((event: KeyboardEvent) => {
    if (shellEl?.dataset.viewMode !== 'character') return;
    const match = /^Digit([1-9])$/.exec(event.code);
    if (!match) return;
    const next = Number(match[1]) - 1;
    if (next === (state?.player?.bagSelected ?? 0)) return;
    // 选中态归引擎管，UI 只发指令——这样背包和快捷栏永远是同一份真相
    send('bagSelect', { index: next });
  }) as EventListener);
  const timer = win.setInterval(() => {
    if (!booted) { send('sync'); return; }
    if (pendingLoadAt) { if (Date.now() - pendingLoadAt > 10000) { pendingLoadAt = 0; saySave('未收到载入确认，请查看底部提示'); } else return; }
    if (!state || pendingSave || Date.now() - lastSaveTime < 4000) return;
    const simElapsed = (state.colony?.time ?? 0) - lastSavedSim;
    if (simElapsed >= 8 || latestStamp !== lastSavedStamp) requestSave('auto');
  }, 1000);
  releases.push(() => win.clearInterval(timer));
  return { ...ui, dispose() { disposed = true; for (const release of releases.reverse()) release(); ui.dispose(); } };
}

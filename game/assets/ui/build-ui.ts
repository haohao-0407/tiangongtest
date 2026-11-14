import type { GameHost } from '@forgeax/engine/app';
import { mountUi, type UiAsset, type UiInstance } from '@forgeax/engine/ui';
import {
  BUILDING_DEFS, JOB_NAMES, JOB_TYPES, RESEARCH_DEFS, RESOURCE_NAMES, RESOURCE_TYPES, SCHEDULES,
  type ColonyCommand, type ColonySnapshot, type ColonistView, type Resource,
} from '../colony/contracts.ts';

const SAVE_KEY = 'homestead.colony.v2';
const MANUAL_KEY = 'homestead.colony.v2.manual';
const LEGACY_KEY = 'homestead.voxel.v1';
type State = { seed: string; selected: number; mode: string; tool?: string; crop?: string; edits: number; undo: boolean; redo: boolean; hoverCell?: unknown; status?: string; revision?: number; colony?: ColonySnapshot;
  /** 相机状态。mode 决定哪些 HUD 该出现：指挥官视角要菜单，玩家视角不要。 */
  camera?: { mode?: 'god' | 'character'; followId?: string | null } };
type SaveIntent = 'auto' | 'manual' | 'export';
const MENU_NAMES: Record<string, string> = { build: '为家园添一座建筑', plan: '规划土地与资源', work: '每个人都有擅长的事', production: '让生活物资不断供', research: '一点一点，学会新方法', trade: '远道而来的朋友', logs: '家园记事', sandbox: '自由塑造这片土地', warehouse: '所有家当都在这里', follower: '一起生活的人' };
const BUILD_ICONS: Record<string, string> = { bed: '▱', table: '▤', stove: '♨', workbench: '⚒', researchDesk: '◇', solar: '☀', battery: '▥', cooler: '❄', medicalBed: '+', wall: '▧', door: '▯', floor: '▦' };
const RESOURCE_ICONS: Record<Resource, string> = { wood: '▰', stone: '◆', steel: '▱', food: '♧', meal: '◉', medicine: '+', cloth: '▨', silver: '○', components: '⚙' };
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
  let state: State | undefined, panel = '', currentTool = 'inspect', selectedResident: string | null = null;
  // 视角标记挂在 .shell 上（UI 在 Shadow DOM 里，不能用 body）
  let shellEl: HTMLElement | null = null;
  // 快捷栏选中的格子，只在玩家视角有意义
  let hotbarIndex = 0;
  let booted = false, disposed = false, lastWorldSeed = '', confirmUntil = 0, lastCardsStamp = '', lastPanelStamp = '', lastInspectorStamp = '';
  let pendingSave: SaveIntent | null = null, queuedSave: SaveIntent | null = null;
  let lastSaveTime = -Infinity, lastSavedSim = 0, lastSavedStamp = '', latestStamp = '', savingStamp = '', savingSim = 0;
  let lastSelectedFromWorld: string | null = null, pendingLoadAt = 0;
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
  on(shadow, 'focusout', () => win.setTimeout(syncHover, 0));
  on(shadow, 'contextmenu', e => e.preventDefault());

  const showTool = (tool: string) => {
    const hints: Record<string, string> = { inspect: '查看模式 · 左键选择居民或地块', 'zone:farm': '农田规划 · 左键划定 3 × 3 种植区', 'zone:stockpile': '仓储规划 · 左键划定 3 × 3 仓储区', chop: '伐木规划 · 点击树木，居民会领取工作', mine: '采矿规划 · 点击石块，居民会开采并搬运', harvest: '收获规划 · 点击成熟作物', cancel: '取消规划 · 点击已有蓝图或工作标记', 'sandbox:build': '沙盒 · 材料无限 · 左键放置方块', 'sandbox:remove': '沙盒 · 左键拆除 · Ctrl Z / Y 撤销重做' };
    get('tool-hint').textContent = tool.startsWith('build:') ? `建造 ${BUILDING_DEFS[tool.slice(6) as keyof typeof BUILDING_DEFS]?.name ?? ''} · 点击地面安放蓝图` : hints[tool] ?? '点击地图执行当前规划';
  };
  const chooseTool = (tool: string) => {
    currentTool = tool; send('tool', { value: tool }); showTool(tool);
    lastPanelStamp = ''; renderPanel(true);
  };
  const hideSidePanels = () => { get('settings').hidden = true; get('help').hidden = true; get('inspector').hidden = true; };
  const openPanel = (next: string) => {
    hideSidePanels(); panel = panel === next ? '' : next;
    get('panel-content').scrollTop = 0;
    if (next === 'inspect') { panel = ''; chooseTool('inspect'); }
    if (next === 'sandbox' && panel) chooseTool('sandbox:build');
    get('workspace').hidden = !panel;
    for (const b of shadow.querySelectorAll<HTMLElement>('[data-menu]')) b.classList.toggle('active', b.dataset.menu === (panel || 'inspect'));
    lastPanelStamp = ''; renderPanel(true); syncHover();
  };

  function renderBuild(c: ColonySnapshot, root: HTMLElement) {
    root.append(note('材料足够才能下达施工蓝图，居民会领取材料并施工。散落物资需先搬运入库；研究锁定的建筑暂不可规划。'));
    const grid = make('div', 'card-grid');
    for (const def of Object.values(BUILDING_DEFS)) {
      const locked = !!def.research && !c.research.completed.includes(def.research);
      const short = Object.entries(def.cost).some(([r, amount]) => c.resources[r as Resource] < (amount ?? 0));
      const b = toolButton('', `build:${def.id}`, `build-${def.id}`, 'build-card'); b.disabled = locked || short;
      const title = make('span', 'card-title'); title.append(make('span', 'card-icon', BUILD_ICONS[def.id] ?? '▧'), make('span', '', def.name));
      b.append(title, make('span', 'card-description', def.description), make('span', 'card-cost', costText(def.cost)));
      if (locked) b.append(make('span', 'card-lock', `需研究：${RESEARCH_DEFS[def.research!]?.name ?? def.research}`));
      else if (short) b.append(make('span', 'card-lock', '材料不足 · 先搬运入库'));
      grid.append(b);
    }
    root.append(grid);
  }
  function renderPlan(c: ColonySnapshot, root: HTMLElement) {
    root.append(note('区域以点击地面为起点规划 3 × 3 格。规划会产生居民工作，实际执行由工作优先级、资源和可达性决定。'));
    const grid = make('div', 'planning-tools');
    const entries = [
      ['zone:farm', '农田', '种植、照料与收获食物。', 'tool-zone-farm'], ['zone:stockpile', '仓储', '搬运散落物资，集中保管。', 'tool-zone-stockpile'],
      ['chop', '伐木', '标记树木，获取木材。', 'tool-chop'], ['mine', '采矿', '标记矿石，获取建材。', 'tool-mine'],
      ['harvest', '收获', '标记成熟作物。', 'tool-harvest'], ['cancel', '取消规划', '移除未完成的规划或工作。', 'tool-cancel'],
    ];
    for (const [tool, name, detail, id] of entries) { const b = toolButton('', tool!, id!); b.append(make('strong', '', name), make('span', '', detail)); grid.append(b); }
    root.append(grid);
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
    for (const [index, [id, name, cls]] of ([[5, '木板', 'planks'], [3, '石块', 'stone'], [4, '原木', 'wood'], [6, '砖块', 'brick'], [1, '草地', 'grass'], [2, '泥土', 'dirt']] as const).entries()) {
      const b = button('', `block-${id}`, undefined, 'material'); b.dataset.block = String(id); b.setAttribute('aria-label', name); b.title = `${index + 1} · ${name}`; b.classList.toggle('active', state?.selected === id); b.append(make('span', `cube ${cls}`), make('span', '', name)); materials.append(b);
    }
    root.append(materials, note(`当前土地 ${state?.edits ?? 0} 格改动 · 1—6 选材 · 左键执行 · 右键拆除`));
  }
  /** 仓库：格子式面板，照 Unity 那边搬过来的。搜索 / 升降序 / 分类 / 网格。 */
  let whQuery = '', whDesc = false, whCategory = 'all';
  // Unity 那边只分「方块 / 非方块」两类，这里照搬
  const CATEGORY_OF: Record<string, string> = {
    wood: 'block', stone: 'block', steel: 'block',
    food: 'item', meal: 'item', medicine: 'item', cloth: 'item', silver: 'item', components: 'item',
  };
  const CATEGORY_NAMES: Record<string, string> = { all: '全部', block: '方块', item: '非方块' };

  function renderWarehouse(c: ColonySnapshot, root: HTMLElement) {
    const tools = make('div', 'wh-tools');
    const search = make('input', 'wh-search') as HTMLInputElement;
    search.type = 'text';
    search.placeholder = '搜索物品名…';
    search.value = whQuery;
    search.setAttribute('aria-label', '搜索物品');

    const order = make('button', 'wh-order', whDesc ? '降序' : '升序');

    // 分类是下拉，不是循环按钮——Unity 那边点开就是「全部 / 方块 / 非方块」
    const category = make('select', 'wh-category') as HTMLSelectElement;
    category.setAttribute('aria-label', '物品分类');
    for (const [key, label] of Object.entries(CATEGORY_NAMES)) {
      const option = doc.createElement('option');
      option.value = key;
      option.textContent = label;
      category.append(option);
    }
    category.value = whCategory;

    tools.append(search, order, category);
    root.append(tools);

    const grid = make('div', 'wh-grid');
    const emptyHint = note('没有匹配的物品。');
    root.append(grid, emptyHint);

    /** 只重画网格。搜索框不能跟着重建，否则每敲一个字就丢焦点。 */
    const drawGrid = () => {
      const items = RESOURCE_TYPES
        .filter((r) => whCategory === 'all' || CATEGORY_OF[r] === whCategory)
        .filter((r) => !whQuery || RESOURCE_NAMES[r].includes(whQuery))
        .map((r) => ({ name: RESOURCE_NAMES[r], icon: RESOURCE_ICONS[r], count: Math.floor(c.resources[r]) }))
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
        const cell = make('div', `wh-cell${item ? '' : ' empty'}`);
        if (item) {
          cell.title = `${item.name} · ${item.count}`;
          cell.append(make('span', 'wh-icon', item.icon));
          if (item.count > 0) cell.append(make('span', 'wh-count', String(item.count)));
          cell.append(make('span', 'wh-label', item.name));
        }
        grid.append(cell);
      }
      emptyHint.hidden = items.length > 0;
    };

    search.addEventListener('input', () => { whQuery = search.value; drawGrid(); });
    order.addEventListener('click', () => { whDesc = !whDesc; order.textContent = whDesc ? '降序' : '升序'; drawGrid(); });
    category.addEventListener('change', () => { whCategory = category.value; drawGrid(); });

    drawGrid();

    const loose = c.items.filter((item) => item.amount > 0);
    root.append(note(loose.length
      ? `另有 ${loose.length} 堆物资还散在地上，居民会陆续搬回仓储。`
      : '地面干净，没有待搬运的物资。'));
  }

  /** 随从：居民的概览页。姓名、在干什么、三项关键需求，点进去看完整档案。 */
  function renderFollower(c: ColonySnapshot, root: HTMLElement) {
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

  /** 玩家快捷栏。九格对应九类资源，数字键或点击切换选中。 */
  function renderHotbar(c: ColonySnapshot) {
    const bar = get('hotbar');
    if (!bar) return;
    const counts = RESOURCE_TYPES.map((r) => Math.floor(c.resources[r]));
    const signature = `${hotbarIndex}|${counts.join(',')}`;
    if (bar.dataset.signature === signature) return;
    bar.dataset.signature = signature;
    clear(bar);
    RESOURCE_TYPES.forEach((r, index) => {
      const slot = make('div', `hotbar-slot${index === hotbarIndex ? ' active' : ''}${counts[index]! <= 0 ? ' empty' : ''}`);
      slot.append(make('span', 'hotbar-key', String(index + 1)));
      slot.append(make('span', '', RESOURCE_ICONS[r]));
      slot.append(make('span', 'hotbar-count', String(counts[index])));
      slot.addEventListener('click', () => { hotbarIndex = index; renderHotbar(c); });
      bar.append(slot);
    });
  }

  function renderPanel(force = false) {
    if (!panel || !state) return;
    const c = state.colony;
    const stamp = JSON.stringify([panel, currentTool, state.crop, state.selected, state.edits, state.undo, state.redo, c && { resources: c.resources, priorities: c.colonists.map(p => [p.id, p.priorities, p.schedule]), research: c.research, power: c.power, bills: c.bills, trade: c.trade, events: c.events.length, buildings: c.buildings.map(b => [b.id, b.complete]), jobs: c.jobs.map(j => [j.id, j.state, j.label]), zones: c.zones.length, time: Math.floor(c.time) }]);
    if (!force && stamp === lastPanelStamp) return;
    lastPanelStamp = stamp;
    get('panel-title').textContent = MENU_NAMES[panel] ?? '家园管理';
    const root = get('panel-content'), scrollTop = root.scrollTop; clear(root);
    if (panel === 'sandbox') { renderSandbox(root); root.scrollTop = scrollTop; return; }
    if (!c) { root.append(empty('正在等待居民与世界数据…')); return; }
    ({ build: renderBuild, plan: renderPlan, work: renderWork, production: renderProduction, research: renderResearch, trade: renderTrade, logs: renderLogs, warehouse: renderWarehouse, follower: renderFollower } as Record<string, (c: ColonySnapshot, root: HTMLElement) => void>)[panel]?.(c, root);
    root.scrollTop = scrollTop;
  }
  function renderInspector(c: ColonySnapshot, force = false) {
    if (!selectedResident || get('inspector').hidden) return;
    const p = c.colonists.find(person => person.id === selectedResident); if (!p) return;
    const stamp = JSON.stringify([p.id, p.task, p.traits, p.schedule, p.skills, ...[p.health, p.hunger, p.rest, p.recreation, p.mood, p.disease, p.comfort].map(Math.floor)]);
    if (!force && stamp === lastInspectorStamp) return; lastInspectorStamp = stamp;
    const scrollTop = get('inspector').scrollTop;
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
    if (c.selectedColonistId && c.selectedColonistId !== lastSelectedFromWorld) {
      lastSelectedFromWorld = c.selectedColonistId;
      // 只在没开别的面板时才切到档案。
      // 之前这里无条件关面板，用户正在看仓库时会被凭空顶掉——
      // 每 0.4 秒的投影刷新都会跑一次这段，看着就像「面板自己关了」。
      if (!panel && get('workspace').hidden) {
        selectedResident = c.selectedColonistId;
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
  on(shadow, 'click', (event) => {
    const b = (event.target as Element | null)?.closest<HTMLButtonElement>('button'); if (!b || b.disabled) return;
    if (b.dataset.speed) { colonyCommand({ action: 'speed', value: Number(b.dataset.speed) }); return; }
    if (b.dataset.menu) { openPanel(b.dataset.menu); return; }
    if (b.dataset.tool) { chooseTool(b.dataset.tool); return; }
    if (b.dataset.crop) { send('crop', { value: b.dataset.crop }); return; }
    if (b.dataset.block) { send('select', { block: Number(b.dataset.block) }); chooseTool('sandbox:build'); return; }
    if (b.dataset.voxelAction) { send(b.dataset.voxelAction); return; }
    if (b.dataset.command) {
      if (b.dataset.resident) { selectedResident = b.dataset.resident; panel = ''; get('workspace').hidden = true; hideSidePanels(); get('inspector').hidden = false; chooseTool('inspect'); if (state?.colony) renderInspector(state.colony, true); }
      colonyCommand(JSON.parse(b.dataset.command) as ColonyCommand); return;
    }
    switch (b.id) {
      case 'home': send('home'); break;
      case 'panel-close': panel = ''; get('workspace').hidden = true; syncHover(); break;
      case 'inspector-close': get('inspector').hidden = true; syncHover(); break;
      case 'settings-toggle': { const hidden = !get('settings').hidden; hideSidePanels(); get('workspace').hidden = true; panel = ''; get('settings').hidden = hidden; break; }
      case 'help-toggle': { const hidden = !get('help').hidden; hideSidePanels(); get('workspace').hidden = true; panel = ''; get('help').hidden = hidden; break; }
      case 'settings-close': get('settings').hidden = true; syncHover(); break;
      case 'help-close': get('help').hidden = true; syncHover(); break;
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
  const message = (event: Event) => {
    const msg = (event as MessageEvent).data;
    if (msg?.type === 'voxel:loaded' && typeof msg.data === 'string') {
      pendingLoadAt = 0; lastSavedSim = 0; lastSavedStamp = ''; lastSaveTime = Date.now(); selectedResident = null; lastSelectedFromWorld = null;
      get('import-panel').hidden = true; get<HTMLTextAreaElement>('import-json').value = '';
      try { win.localStorage.setItem(SAVE_KEY, msg.data); saySave('家园已载入，自动存档已同步'); } catch { saySave('家园已载入，但本机存储不可用'); }
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
    const c = state.colony;
    latestStamp = JSON.stringify([state.seed, state.revision, state.edits, c && [c.speed, c.buildings.map(b => [b.id, b.complete]), c.zones, c.bills, c.research.active, c.colonists.map(p => [p.id, p.priorities, p.schedule])]]);
    if (c) renderColony(c); else renderPanel();
    if (c) renderHotbar(c);
    if (!booted) {
      booted = true; lastSavedStamp = latestStamp; lastSavedSim = c?.time ?? 0;
      const data = readSave(false); if (data) requestLoad(data, '正在恢复上次的家园…');
    }
  };
  if (port) { on(port, 'message', message); port.start?.(); send('sync'); } else saySave('引擎通信不可用');

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
        selectedResident = null;
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
  const backBtn = get('options-back');
  if (backBtn) on(backBtn, 'click', () => { if (optionsLayer) optionsLayer.hidden = true; });
  on(get('pause-quit'), 'click', () => {
    // 浏览器只允许脚本自己开的窗口调用 close()，普通标签页会被忽略
    win.close();
    win.setTimeout(() => {
      pauseLayer.hidden = true;
      saySave('浏览器不允许页面自行关闭，请直接关掉这个标签页');
    }, 150);
  });

  // 右键在画布上是「按住拖动平移镜头」，浏览器默认菜单会抢这个操作，拦掉。
  // 只拦 canvas：输入框的右键（复制粘贴）要留着。
  const blockCanvasMenu = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.tagName === 'CANVAS') event.preventDefault();
  };
  doc.addEventListener('contextmenu', blockCanvasMenu, true);
  releases.push(() => doc.removeEventListener('contextmenu', blockCanvasMenu, true));

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
  // 俯视视角的 1/2/3 是速度、沙盒里 1-6 是选方块，不能抢。
  on(win, 'keydown', ((event: KeyboardEvent) => {
    if (shellEl?.dataset.viewMode !== 'character') return;
    const match = /^Digit([1-9])$/.exec(event.code);
    if (!match) return;
    const next = Number(match[1]) - 1;
    if (next === hotbarIndex) return;
    hotbarIndex = next;
    if (state?.colony) renderHotbar(state.colony);
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

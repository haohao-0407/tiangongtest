import { RESOURCE_NAMES, type ColonySnapshot } from '../colony/contracts.ts';
import { SPECIALISTS, SPECIALIST_MARKET_RULES as rules } from '../colony/specialist-catalog.ts';

export function renderMarketCalendar(c: ColonySnapshot, root: HTMLElement) {
  const doc = root.ownerDocument;
  function add(parent: HTMLElement, tag: string, className: string, text?: string) {
    const el = doc.createElement(tag);
    el.className = className;
    if (text) el.textContent = text;
    parent.append(el);
    return el;
  }
  const { merchants, events } = c.specialistMarket;
  const lastDay = c.day + rules.forecastDays - 1;
  const notices = events.filter(e => e.announcedDay <= c.day && e.startDay <= lastDay && e.endDay >= c.day - 1)
    .sort((a, b) => Number(a.endDay < c.day) - Number(b.endDay < c.day) || a.startDay - b.startDay);
  const week = add(root, 'div', 'market-week');
  for (let day = c.day; day <= lastDay; day++) {
    const tile = add(week, 'div', 'market-day');
    tile.dataset.day = String(day);
    if (day === c.day) tile.setAttribute('aria-current', 'date');
    add(tile, 'strong', '', `第 ${day} 天`);
    const active = notices.filter(e => e.startDay <= day && day <= e.endDay);
    const moved = merchants.some(m => m.arrivalDay === day && m.status !== 'locked');
    add(tile, 'span', '', [day === c.day ? '今天' : '', moved ? '来镇' : '', active.length ? `${active.length} 场收购` : ''].filter(Boolean).join(' · ') || '—');
  }
  add(root, 'h3', 'market-heading', '收购公告');
  if (!notices.length) add(root, 'p', 'market-empty', '这七天暂无收购公告。');
  for (const e of notices) {
    const def = SPECIALISTS[e.merchantId];
    const ended = c.day > e.endDay;
    const stage = ended ? '已截止' : c.day < e.startDay ? '预告' : c.day === e.endDay ? '今日截止' : '进行中';
    const card = add(root, 'article', 'market-notice');
    card.dataset.eventId = e.id;
    card.dataset.stage = stage;
    const heading = add(card, 'div', 'market-line');
    add(heading, 'strong', '', def.request.name);
    add(heading, 'span', 'market-stage', stage);
    add(card, 'p', '', `${def.name}收购${RESOURCE_NAMES[e.item]} · 基础回收价 ×${rules.requestFactor} · 剩余 ${e.remaining} / ${e.limit} 份`);
    add(card, 'small', '', `第 ${e.announcedDay} 天公布 · 第 ${e.startDay} 天至第 ${e.endDay} 天`);
    if (!ended && merchants.find(m => m.id === e.merchantId)?.housing?.status !== 'housed')
      add(card, 'small', '', '住所待安排，暂时无法接单');
  }
  add(root, 'h3', 'market-heading', '来镇消息');
  const homes = add(root, 'div', 'market-homes');
  add(homes, 'p', '', `向导 · 开局已来镇 · ${c.guideHousing.status === 'housed' ? '已安家' : '待安排住所'}`);
  for (const m of merchants.filter(m => m.status !== 'locked' && m.arrivalDay !== null && m.arrivalDay <= c.day)) {
    add(homes, 'p', '', `${SPECIALISTS[m.id].name} · 第 ${m.arrivalDay} 天搬来 · ${m.housing?.status === 'housed' ? '已安家' : '待安排住所'}`);
  }
  add(root, 'h3', 'market-heading', '我的交货记录');
  const ledger = add(root, 'div', 'market-ledger');
  for (const m of merchants) {
    const def = SPECIALISTS[m.id];
    const entry = add(ledger, 'div', 'market-line');
    add(entry, 'span', '', def.unlockItems.map(item => RESOURCE_NAMES[item]).join('、'));
    add(entry, 'strong', '', `${m.sold} / ${def.unlockQuantity} 件`);
  }
}

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tsImport } from 'tsx/esm/api';
import { guideFixture } from './guide-shop-playthrough.mjs';

// Generate consecutive saves from real sales, room assignments and order reservations.
export async function calendarFixtures() {
  const { sim, world } = await guideFixture(false);
  const { buildingDimensions } = await tsImport('../assets/colony/buildings.ts', import.meta.url);
  const { merchantOrder } = await tsImport('../assets/colony/guide-shop.ts', import.meta.url);
  const { DAY_SECONDS } = await tsImport('../assets/colony/simulation.ts', import.meta.url);
  const s = sim.serialize();
  s.resources.cloth = 20;
  s.warehouseStacks.push({ x: 6, z: 10, slot: 0, resource: 'cloth', count: 20 });
  function add(kind, x, z) {
    s.buildings.push({ kind, id: kind + '-' + x + '-' + z, x, y: 5, z, rotation: 0,
      ...buildingDimensions(kind), complete: true, phase: 'completed', progress: 1, reserved: {},
      powered: false, comfort: 0, roomId: null, ...(kind === 'door' ? { doorOpen: false } : {}) });
  }
  for (const left of [5, 23]) {
    for (let z = 17; z <= 23; z++) for (let x = left; x <= left + 6; x++) {
      if (x === left || x === left + 6 || z === 17 || z === 23) add(x === left + 3 && z === 17 ? 'door' : 'woodWall', x, z);
    }
    add('bed', left + 1, 19);
    add('table', left + 4, 20);
  }
  sim.load(s);
  function command(cmd) {
    const result = sim.command(cmd);
    assert.ok(result.ok, result.message);
  }
  const speed = value => command({ action: 'speed', value });
  const sale = (merchantId, count) => {
    const quote = merchantOrder(sim.snapshot(), 'recycle', 'cloth', count, merchantId);
    command({ action: 'guide-trade', merchantId, value: 'recycle', kind: 'cloth', amount: count, target: quote.total });
    return quote;
  };
  function deliver() {
    speed(1);
    for (let i = 0; i < 900 && sim.snapshot().jobs.some(j => j.guideSale); i++) sim.tick(.25);
    speed(0);
    assert.ok(!sim.snapshot().jobs.some(j => j.guideSale), JSON.stringify(sim.snapshot().jobs));
  }
  const saves = [];
  function capture(name) {
    saves.push({ name, file: { version: 2, voxel: world.serialize(), colony: sim.serialize() }, expected: sim.snapshot() });
  }
  function nextDay() {
    const stored = sim.serialize();
    stored.time = sim.snapshot().day * DAY_SECONDS - .25;
    sim.load(stored);
    speed(1);
    sim.tick(.5);
    speed(0);
  }
  function house(merchantId) {
    const room = sim.snapshot().specialistMarket.availableRooms[0];
    assert.ok(room, JSON.stringify({ merchantId, rooms: sim.snapshot().rooms.map(r => [r.id, r.cells.length]),
      beds: sim.snapshot().buildings.filter(b => b.kind === 'bed').map(b => [b.id, b.roomId]),
      guide: sim.snapshot().guideHousing, merchants: sim.snapshot().specialistMarket.merchants }));
    command({ action: 'assign-merchant-room', merchantId, id: room.bedId });
    const bed = s.buildings.find(b => b.id === room.bedId);
    command({ action: 'toggleDoor', id: 'door-' + (bed.x + 2) + '-17' });
  }
  assert.equal(sim.snapshot().guideHousing.status, 'camp');
  house('guide');
  sale('guide', 5);
  deliver();
  capture('01-five-delivered');
  sale('guide', 1);
  deliver();
  capture('02-moved-in');
  assert.deepEqual(sim.snapshot().specialistMarket.events, []);
  house('tailor');
  const event = sim.snapshot().specialistMarket.events[0];
  assert.equal(event.merchantId, 'tailor');
  assert.ok(event.startDay >= event.announcedDay + 2);
  capture('03-announcement');
  while (sim.snapshot().day < event.startDay) nextDay();
  const quote = sale('tailor', 3);
  assert.equal(quote.eventId, event.id);
  capture('04-reserved');
  command({ action: 'cancel', id: sim.snapshot().jobs.find(j => j.guideSale).id });
  capture('05-released');
  while (sim.snapshot().day < event.endDay) nextDay();
  capture('06-final-day');
  nextDay();
  capture('07-ended');
  return { saves, event };
}

export default async function calendarPlay(play) {
  const out = 'docs/market-calendar-qa-2026-11-27';
  mkdirSync(out, { recursive: true });
  const { saves, event } = await calendarFixtures();
  const { page } = play;
  const read = 'voxel.world', key = 'homestead.colony.v2', log = [];
  const date = page.locator('#date'), panel = page.locator('#workspace[data-panel="calendar"]');
  const stages = [null, null, '预告', '进行中', '进行中', '今日截止', '已截止'];
  await play.waitFor(s => s.colony?.colonists.length > 0, { read });
  for (const [i, { name, file, expected }] of saves.entries()) {
    if (await panel.isVisible()) await page.locator('#panel-close').click();
    // Load the fixture through the game's local-save handler. Reload the full client
    // separately below to check that an already published bulletin survives it.
    await page.evaluate(({ key, file }) => localStorage.setItem(key + '.manual', JSON.stringify(file)), { key, file });
    await page.locator('#load').evaluate(button => button.click());
    await play.waitFor(s => s.colony?.time === expected.time && s.colony.speed === 0 &&
      JSON.stringify(s.colony.specialistMarket.events) === JSON.stringify(expected.specialistMarket.events),
      { read, timeoutMs: 45000 });
    await date.click();
    await panel.waitFor();
    const live = (await play.state(read)).colony;
    assert.deepEqual(live.specialistMarket.events, expected.specialistMarket.events);
    const days = await panel.locator('.market-day').evaluateAll(els => els.map(el => Number(el.dataset.day)));
    assert.deepEqual(days, Array.from({ length: 7 }, (_, offset) => live.day + offset));
    const body = await panel.innerText();
    assert.match(body, /我的交货记录/);
    const tailor = live.specialistMarket.merchants.find(m => m.id === 'tailor');
    assert.ok(body.includes(tailor.sold + ' / 6 件'));
    if (i === 0) assert.ok(!body.includes('裁缝'));
    if (i === 1) assert.match(body, /裁缝 · 第 1 天搬来 · 待安排住所/);
    const row = live.specialistMarket.events.find(e => e.id === event.id);
    if (row) {
      const card = panel.locator('[data-event-id="' + row.id + '"]');
      assert.equal(await card.getAttribute('data-stage'), stages[i]);
      assert.ok((await card.innerText()).includes('剩余 ' + row.remaining + ' / ' + row.limit));
      assert.equal(row.remaining, i === 3 ? 7 : 10);
    }
    if (i === 2) {
      await page.locator('#panel-close').click();
      await date.click();
      assert.equal(await panel.innerText(), body);
      await play.reload();
      await play.waitFor(s => s.colony?.time === expected.time && s.colony.speed === 0, { read, timeoutMs: 45000 });
      await date.click();
      assert.equal(await panel.innerText(), body);
    }
    const order = live.jobs.find(j => j.guideSale)?.guideSale;
    if (i === 3) assert.equal(order.eventId, row.id);
    log.push({ name, day: live.day, time: live.time, days, sold: tailor.sold,
      arrivalDay: tailor.arrivalDay, housing: tailor.housing?.status ?? null, events: live.specialistMarket.events, order, body });
    await page.screenshot({ path: out + '/' + name + '.png', timeout: 25000 });
    writeFileSync(out + '/readings.json', JSON.stringify(log, null, 2));
  }
}

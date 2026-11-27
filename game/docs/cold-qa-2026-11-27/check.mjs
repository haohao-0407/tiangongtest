import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ColonySimulation, coldSaleValue, premiumCount, RESOURCE_PRICES } from '../../assets/colony/simulation.ts';
import { VoxelWorld } from '../../assets/voxel/model.ts';

const out = 'artifacts/cold-qa-2026-11-27';
mkdirSync(out, { recursive: true });
const world = new VoxelWorld('冷藏验收01');
let sim = new ColonySimulation(world);
const initial = sim.serialize();
const chest = initial.buildings.find(b => b.kind === 'chest');
const box = slot => ({ kind: 'chest', id: chest.id, slot });
const wh = { kind: 'warehouse' };
const bag = { kind: 'follower', id: initial.colonists[0].id, slot: 8 };
const reports = [];
function checkpoint(label) {
  const save = sim.serialize();
  const state = sim.snapshot();
  const keep = stock => stock && { resource: stock.resource, count: stock.count, valid: premiumCount(stock, state.day), lots: stock.freezing };
  reports.push({ label, time: state.time, day: state.day, hour: state.hour, power: state.power,
    bread: state.warehouseStacks.filter(s => s.resource === 'bread').map(keep),
    milk: state.warehouseStacks.filter(s => s.resource === 'milk').map(keep),
    bag: keep(state.colonists[0].bag[8]), chest: keep(state.chests.find(c => c.id === chest.id).slots[3]),
    ground: state.items.filter(i => i.id === 'cold-test-ground').map(i => [i.amount, i.age, i.x, i.z]) });
  save.speed = 0;
  writeFileSync(join(out, label + '.json'), JSON.stringify({ version: 2, voxel: world.serialize(), colony: save }));
  writeFileSync(join(out, 'observations.json'), JSON.stringify(reports, null, 2));
}
function move(from, to, item, n) { assert.equal(sim.transferInventory(from, to, item, n).ok, true); }
function stock(item) { return sim.snapshot().warehouseStacks.filter(s => s.resource === item); }
function count(item) { return stock(item).reduce((n, s) => n + premiumCount(s, sim.snapshot().day), 0); }
function toTime(time) { sim.tick(time - sim.snapshot().time); assert.equal(sim.snapshot().time, time); }
for (const [i, kind] of ['solar','solar','battery','battery','cooler'].entries())
  initial.buildings.push({ id: 'cold-' + i, kind, x: 132+i, y: 6, z: 130, complete: true, progress: 1, reserved: {}, powered: false, comfort: 0, roomId: null });
initial.power.capacity = initial.power.stored = 24000;
for (const p of initial.colonists) for (const k of Object.keys(p.priorities)) p.priorities[k] = 0;
initial.colonists[0].position = [125.5,6,125.5];
initial.items.push({ id:'cold-test-ground', resource:'bread', amount:2, x:128, y:6, z:130, age:0, reservedBy:null, playerOnly:true });
sim.load(initial);
move(wh, box(0), 'bread', 10);
move(wh, box(1), 'milk', 10);
move(box(0), wh, 'bread', 4);
move(box(1), wh, 'milk', 3);
toTime(120.25);
checkpoint('first');
toTime(210);
move(box(0), wh, 'bread', 6);
toTime(210.25);
checkpoint('second');
toTime(479.75);
assert.equal(count('bread'), 0);
checkpoint('before');
const reload = () => {
  const data = JSON.parse(JSON.stringify(sim.serialize()));
  sim = new ColonySimulation(world);
  sim.load(data);
};
reload();
toTime(480);
assert.equal(count('bread'), 4);
assert.equal(count('milk'), 3);
const value = () => stock('bread').reduce((n,s) => n + coldSaleValue(RESOURCE_PRICES.bread, s.count, s, sim.snapshot().day), 0);
assert.equal(value(), 4*72+6*60);
checkpoint('qualified');
move(wh, bag, 'bread', 5);
assert.equal(premiumCount(sim.snapshot().colonists[0].bag[8],2), 4);
move(bag, box(3), 'bread', 2);
checkpoint('transferred');
reload();
assert.equal(premiumCount(sim.snapshot().colonists[0].bag[8],2), 2);
assert.equal(premiumCount(sim.snapshot().chests.find(c=>c.id===chest.id).slots[3],2), 2);
checkpoint('restored');
toTime(569.75);
assert.equal(count('bread'), 0);
toTime(570);
assert.equal(count('bread'), 5);
checkpoint('second-qualified');
toTime(719.75);
checkpoint('midnight-before');
toTime(720);
assert.equal(count('bread'),0);
assert.equal(count('milk'),0);
assert.equal(value(),5*60);
assert.equal(premiumCount(sim.snapshot().colonists[0].bag[8],3),0);
assert.equal(premiumCount(sim.snapshot().chests.find(c=>c.id===chest.id).slots[3],3),0);
assert.equal(sim.snapshot().items.find(i=>i.id==='cold-test-ground')?.amount,2);
checkpoint('expired');

// Branch at the first deposit. Solar alone drops below 45 W in the evening.
const branch = structuredClone(initial);
branch.buildings = branch.buildings.filter(b=>!['battery'].includes(b.kind));
branch.power.stored = branch.power.capacity = 0;
sim = new ColonySimulation(world);
sim.load(branch);
toTime(210);
assert.ok(stock('bread').every(s => s.freezing?.length));
checkpoint('outage-before');
while (sim.snapshot().power.coldStorage) sim.tick(.25);
assert.ok(stock('bread').every(s => !s.freezing));
checkpoint('outage');
while (!sim.snapshot().power.coldStorage) sim.tick(.25);
checkpoint('restarted');
toTime(480);
assert.equal(count('bread'),0);
checkpoint('missed-original-deadline');
console.log(reports.map(r=>[r.label,r.time,r.bread.map(s=>s.valid),r.ground[0]?.[1]]));

import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';
import { stockConstructionFixture } from './construction-supplies.mjs';
import { returnToMap } from './return-to-map.mjs';

export default async function warehousePlaythrough(play) {
  const {cardLayers,isWarehouseCard,packageMask,packageSize,warehouseBayKey,warehouseSlotContents}=await tsImport('../assets/colony/warehouse.ts',import.meta.url);
  const read = 'voxel.world';
  const control = id => play.page.locator(`[data-testid="${id}"]`);
  const wait = predicate => play.waitFor(predicate, {read,timeoutMs:12_000});
  const advance = seconds => play.advance(seconds,{read,stepSeconds:.1});
  const capture = async name => {
    await advance(.7);
    await play.page.evaluate(name => { document.documentElement.dataset.forgeaxCaptureReady=name; },name);
    assert.equal((await play.screenshot(name)).rendered,true);
  };
  const shelfZones = state => state.colony.zones.filter(zone => zone.shelfId);
  const groundZone = state => state.colony.zones.find(zone => zone.kind==='stockpile'&&!zone.shelfId);
  const viewWarehouse = async (extraShelfId) => {
    await play.mouse.move([.5,.5]);
    await play.keyboard.press('KeyF');
    let state=await advance(.15);
    const distance=extraShelfId ? 30 : 20;
    for (let attempt=0;attempt<4&&state.camera.distance>distance;attempt++) {
      await play.page.mouse.wheel(0,-300);
      state=await advance(.15);
    }
    const {width,height}=play.page.viewportSize();
    await play.page.mouse.move(width*.5,height*.52);
    await advance(.15);
    await play.page.mouse.down({button:'middle'});
    await play.page.mouse.move(width*.5,height*.34,{steps:8});
    await advance(.15);
    await play.page.mouse.up({button:'middle'});
    state=await advance(.15);
    assert.ok(state.camera.eye[1]<17.7,'Use an in-game camera angle below the cloud layer');
    const shelf=state.colony.buildings.find(b => b.id===extraShelfId);
    const points=state.colony.warehouseStacks.map(stack => [stack.x+.5,stack.z+.5]);
    if (shelf) points.push([shelf.x+shelf.w/2,shelf.z+shelf.d/2]);
    const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]);
    const center=[(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...zs)+Math.max(...zs))/2];
    for (let attempt=0;attempt<3;attempt++) {
      const dx=center[0]-state.camera.target[0], dz=center[1]-state.camera.target[2];
      if (Math.hypot(dx,dz)<1) break;
      const cos=Math.cos(state.camera.yaw),sin=Math.sin(state.camera.yaw),sensitivity=state.camera.distance*.009;
      await play.page.mouse.move(width*.5,height*.5);
      await advance(.15);
      await play.page.mouse.down({button:'right'});
      await play.page.mouse.move(width*.5+(cos*dx-sin*dz)/sensitivity,
        height*.5+(sin*dx+cos*dz)/sensitivity,{steps:8});
      await advance(.15);
      await play.page.mouse.up({button:'right'});
      state=await advance(.15);
    }
  };
  const planning = async () => {
    await control('menu-plan').click();
    await control('tool-zone-stockpile').click();
    await wait(s => s.planningGridVisible);
    await play.mouse.move([.83,.73]);
    await advance(.1);
  };

  await play.step('larger warehouse and two stocked shelves on a new map',async () => {
    const state=await wait(s => s.colony?.colonists.length===3);
    if (await play.page.locator('html').getAttribute('data-forgeax-input')) {
      await play.page.locator('html[data-forgeax-input="open"]').waitFor({state:'attached'});
    }
    const help=play.page.locator('#help-close');
    if (await help.isVisible()) await help.click();
    const ground=groundZone(state);
    assert.deepEqual([ground.w,ground.d],[9,9]);
    const shelves=state.colony.buildings.filter(b => b.kind==='shelf'&&b.complete);
    assert.equal(shelves.length,2);
    for (const shelf of shelves) {
      assert.ok(shelfZones(state).some(zone => zone.shelfId===shelf.id));
      assert.ok(state.colony.warehouseStacks.some(stack => stack.shelfId===shelf.id));
    }
    const stacks=state.colony.warehouseStacks;
    assert.ok(stacks.some(stack => !stack.shelfId));
    assert.deepEqual([...new Set(stacks.filter(s=>!isWarehouseCard(s.resource)).map(s=>packageSize(s.resource)))].sort(),[1,2,4]);
    const groups=Map.groupBy(stacks,warehouseBayKey);
    assert.ok([...warehouseSlotContents(stacks).values()].some(group => !group[0].shelfId&&group.length>1
      && group.every(stack => isWarehouseCard(stack.resource))&&cardLayers(group.reduce((sum,stack) => sum+stack.count,0))>1));
    for (const group of groups.values()) {
      let used=0;
      for (const contents of warehouseSlotContents(group).values()) {
        const stack=contents[0];
        const mask=packageMask(stack.resource,stack.slot%4);
        assert.ok(mask&&!(used&mask));
        assert.equal(isWarehouseCard(stack.resource),isWarehouseCard(group[0].resource));
        assert.ok(contents.reduce((sum,item)=>sum+item.count,0)<=32);
        used|=mask;
      }
    }
    assert.equal(state.planningGridVisible,false);
    await viewWarehouse();
    await capture('warehouse-01-luggage-and-layered-cards');
    await planning();
    await capture('warehouse-02-enlarged-starter-zone');
    await returnToMap(play);
  });

  const builtId=await play.step('build a shelf outside the existing warehouse',async () => {
    await play.page.keyboard.press('Escape');
    await wait(s => s.colony.speed===0);
    await stockConstructionFixture(play,{plank:28});
    await play.page.keyboard.press('Escape');
    await play.page.locator('#pause-menu').waitFor({state:'visible'});
    await play.page.keyboard.press('Escape');
    await wait(s => s.colony.speed===1);
    await control('menu-build').click();
    await control('build-shelf').click();
    await wait(state => state.tool==='build:shelf');
    await play.page.locator('#workspace').waitFor({state:'hidden'});
    await play.mouse.move([.5,.5]);
    await play.keyboard.press('KeyF');
    const inside=(area,x,z) => x>=area.x&&x<area.x+area.w&&z>=area.z&&z<area.z+area.d;
    let target;
    for (const row of [.52,.46,.57,.40,.62,.34,.67,.28]) {
      for (const col of [.57,.63,.68,.50,.74,.43,.35,.28]) {
        await play.mouse.move([col,row]);
        const state=await advance(.1);
        if (!state.hoverCell || state.hoverBuildingId || state.terrain.preview.cut || state.terrain.preview.fill) continue;
        const [x,y,z]=state.hoverCell;
        if (y!==groundZone(state).y) continue;
        if (state.colony.buildings.some(b => inside(b,x,z)||inside(b,x+1,z))
          || state.colony.zones.some(zone => inside(zone,x,z)||inside(zone,x+1,z))) continue;
        target={point:[col,row],x,z};
        break;
      }
      if (target) break;
    }
    assert.ok(target,'Find a visible, level shelf site outside the existing zones');
    await play.mouse.click(target.point);
    const placed=await wait(state => state.colony.buildings.some(b => b.kind==='shelf'&&b.x===target.x&&b.z===target.z));
    const shelf=placed.colony.buildings.find(b => b.kind==='shelf'&&b.x===target.x&&b.z===target.z);
    assert.equal(shelf.complete,false);
    assert.ok(!shelfZones(placed).some(zone => zone.shelfId===shelf.id));
    await returnToMap(play);
    let state=await play.state(read);
    for (let attempt=0;attempt<45&&!shelfZones(state).some(zone => zone.shelfId===shelf.id);attempt++) state=await advance(2);
    assert.ok(state.colony.buildings.some(b => b.id===shelf.id&&b.complete));
    assert.ok(shelfZones(state).some(zone => zone.shelfId===shelf.id&&zone.w===2&&zone.d===1));
    await planning();
    await capture('warehouse-03-automatically-designated-shelf');
    return shelf.id;
  });

  return play.step('the warehouse and its physical stock survive reload',async () => {
    await returnToMap(play);
    await play.page.keyboard.press('Escape');
    const before=await wait(s => s.colony.speed===0);
    await play.page.waitForFunction(id => {
      const save=JSON.parse(localStorage.getItem('homestead.colony.v2'));
      return save?.colony?.speed===0&&save.colony.buildings.some(b => b.id===id&&b.complete);
    },builtId,{timeout:12_000});
    await play.reload();
    const after=await wait(s => s.colony?.speed===0&&shelfZones(s).some(zone => zone.shelfId===builtId));
    assert.deepEqual(after.colony.warehouseStacks,before.colony.warehouseStacks);
    assert.deepEqual(shelfZones(after),shelfZones(before));
    await viewWarehouse(builtId);
    await capture('warehouse-04-reloaded-shelves-and-stacks');

    // Give the newly built shelf a mixed stack so the close-up covers both storage surfaces.
    const shelf=after.colony.buildings.find(b => b.id===builtId);
    await play.page.evaluate(({id,x,z}) => {
      const key='homestead.colony.v2';
      const save=JSON.parse(localStorage.getItem(key));
      for (const resource of ['wheat','corn']) {
        save.colony.resources[resource]+=16;
        save.colony.warehouseStacks.push({shelfId:id,x,z,slot:0,resource,count:16});
      }
      localStorage.setItem(key,JSON.stringify(save));
    },shelf);
    await play.reload();
    const stocked=await wait(s => s.colony?.warehouseStacks.filter(stack => stack.shelfId===builtId&&stack.slot===0).length===2);
    assert.ok(stocked.colony.warehouseStacks.some(stack => !stack.shelfId&&isWarehouseCard(stack.resource)));

    await play.page.keyboard.press('Escape');
    await play.page.locator('#pause-settings').click();
    await play.page.locator('#opt-sun-shadows').selectOption('off');
    await play.page.keyboard.press('Escape');
    await play.page.keyboard.press('Escape');
    await wait(s => s.camera.sunShadows==='off');
    await viewWarehouse(builtId);
    await capture('warehouse-05-mixed-upright-cards');
    return {shelves:shelfZones(after).length,stacks:after.colony.warehouseStacks.length};
  });
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tsImport } from 'tsx/esm/api';
import { town } from './specialist-settlement.mjs';
import { possessResident } from './select-resident.mjs';
import { returnToMap } from './return-to-map.mjs';

const items = ['plank','pigIron','stone','stoneBrick','steel','cloth','silver'];
const out = 'artifacts/material-icons';

export default async function materialIcons(play) {
  const { page } = play, read = 'voxel.world';
  const { mapProjection } = await tsImport('../assets/voxel/zone-selection.ts', import.meta.url);
  const { merchantOrder } = await tsImport('../assets/colony/guide-shop.ts', import.meta.url);
  const { sim, world } = await town();
  const colony = sim.serialize(), pawn = colony.colonists[1];
  pawn.position = [20.5,5,18.5];
  items.forEach((resource,i) => { pawn.bag[i] = {resource,count:1}; });
  const file = {version:2, voxel:world.serialize(), colony};
  const wait = fn => play.waitFor(fn,{read,timeoutMs:20000});
  const btn = id => page.locator('[data-testid="'+id+'"]');
  const shot = async name => assert.ok((await play.screenshot(name)).rendered, name);
  const readings = [];
  mkdirSync(out,{recursive:true});
  async function check(image,id,size) {
    const actual = await image.evaluate(async img => {
      await img.decode();
      const bytes = await (await fetch(img.currentSrc)).arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
      return {hash, natural:img.naturalWidth, size:img.getBoundingClientRect().width, sampling:getComputedStyle(img).imageRendering};
    });
    assert.equal(actual.hash,createHash('sha256').update(readFileSync('assets/ui/material-icons/'+id+'.png')).digest('hex'));
    assert.deepEqual([actual.natural,actual.size,actual.sampling],[32,size,'pixelated']);
    readings.push({id,...actual});
    writeFileSync(out+'/readings.json',JSON.stringify(readings,null,2));
  }
  const category = async id => {
    await page.locator('.wh-cat-trigger').click();
    await page.locator('[data-cat="'+id+'"]').click();
  };
  await wait(s=>s.colony?.colonists.length);
  await page.evaluate(file=>localStorage.setItem('homestead.colony.v2.manual',JSON.stringify(file)),file);
  await page.locator('#load').evaluate(el=>el.click());
  await wait(s=>s.colony.speed===0 && s.colony.colonists[1].bag[0]?.resource==='plank');
  await play.step('仓库方块与非方块分类',async()=>{
    await btn('menu-warehouse').click();
    await category('block');
    for(const id of items.slice(0,5)) await check(page.locator('[data-item="'+id+'"] img.wh-icon'),id,32);
    await shot('01-warehouse-blocks');
    await category('item');
    for(const id of items.slice(5)) await check(page.locator('[data-item="'+id+'"] img.wh-icon'),id,32);
    await shot('02-warehouse-cloth-and-silver');
    await returnToMap(play);
  });
  await play.step('加工材料与角色快捷栏',async()=>{
    await btn('menu-production').click();
    const row = id=>page.locator('.production-row').filter({has:btn('craft-order-'+id)});
    for(const id of ['plank','stoneBrick','steel','cloth']) await check(row(id).locator('img.wh-icon'),id,32);
    assert.match(await row('steel').innerText(),/生铁/);
    await row('steel').scrollIntoViewIfNeeded();
    await shot('03-material-recipes');
    await returnToMap(play);
    await possessResident(play,pawn.id);
    await returnToMap(play);
    await play.advance(.6,{read});
    for(const [i,id] of items.entries()) await check(page.locator('.hotbar-slot').nth(i).locator('img'),id,25);
    await check(page.locator('.vital-gold img'),'silver',16);
    await shot('04-hotbar-balance');
  });
  await play.step('右键向导、安排住所并核对布料报价',async()=>{
    const state = await play.state(read);
    const {width,height} = page.viewportSize();
    const projection = mapProjection(state.camera.eye,state.camera.target,width/height,Math.tan(Math.PI/8));
    const [x,y,z] = state.colony.guideHousing.position;
    for(const h of [1.45,1.78,1.05,.75]) {
      const [u,v] = projection.project(x,y+h,z);
      await page.mouse.move(u*width,v*height);
      await page.mouse.down({button:'right'});
      await play.advance(.15,{read});
      await page.mouse.up({button:'right'});
      if(await btn('guide-choose-room').isVisible()) break;
    }
    await btn('guide-choose-room').click();
    await btn('guide-assign-'+state.colony.specialistMarket.availableRooms[0].bedId).click();
    await btn('guide-balance').waitFor();
    for(let i=0;i<4 && !await btn('guide-buy-cloth').isVisible();i++) await btn('guide-next').click();
    const card = btn('guide-buy-cloth');
    await card.click();
    await check(card.locator('.guide-product'),'cloth',48);
    await check(btn('guide-recycle-cloth').locator('img'),'cloth',20);
    await check(btn('guide-balance').locator('img'),'silver',16);
    await check(card.locator('.guide-plinth img'),'silver',14);
    await check(btn('guide-confirm').locator('img'),'silver',16);
    const c = (await play.state(read)).colony;
    const total = merchantOrder(c,'buy','cloth',1).total;
    assert.equal(await card.locator('.guide-plinth').innerText(),total+' 银币');
    assert.equal(await btn('guide-balance').innerText(),'可用 '+c.resources.silver+' 银币');
    await shot('05-shop-cloth-price');
    await btn('guide-confirm').click();
    await wait(s=>s.colony.resources.silver===c.resources.silver-total);
    await check(page.locator('.guide-order img').first(),'silver',14);
    await shot('06-reserved-payment');
    readings.push({before:c.resources.silver,quote:total,after:(await play.state(read)).colony.resources.silver});
    writeFileSync(out+'/readings.json',JSON.stringify(readings,null,2));
    await page.locator('#save').evaluate(el=>el.click());
    const key='homestead.colony.v2.manual', after=c.resources.silver-total;
    await page.waitForFunction(({key,after})=>JSON.parse(localStorage.getItem(key)||'null')?.colony.resources.silver===after,{key,after});
    await play.reload();
    await page.locator('#load').evaluate(el=>el.click());
    await wait(s=>s.colony?.resources.silver===after && s.colony.jobs.some(job=>job.guideSale?.item==='cloth'));
    if ((await play.state(read)).camera.mode==='character') await page.keyboard.press('KeyR');
    await btn('menu-warehouse').click();
    await category('item');
    await check(page.locator('.wh-cell[data-item="silver"] img'),'silver',32);
    await shot('07-reloaded-warehouse');
  });
}

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

export default async function coldAcceptance(play) {
  const { page } = play;
  const path = 'artifacts/cold-qa-2026-11-27/';
  const state = () => play.state('voxel.world');
  const wait = condition => play.waitFor(condition,{read:'voxel.world',timeoutMs:90000});
  const el = s => page.locator(s);
  const click = s => el(s).click({timeout:20000});
  const cell = r => '#workspace .wh-cell[data-item="' + r + '"]';
  const records = [];
  const speed = value => page.evaluate(value=>window.__wbSend('colony',{command:{action:'speed',value}}),value);
  async function saveFrame(name, selector) {
    const game = await state();
    const title = selector ? await el(selector).getAttribute('title') : null;
    if (selector) await el(selector).hover();
    await page.screenshot({path:path+name+'.png',timeout:30000});
    records.push({name,title,date:await el('#date').textContent(),time:game.colony.time,power:game.colony.power,
      lots:game.colony.warehouseStacks.filter(s=>['milk','bread'].includes(s.resource)),
      bag:game.colony.colonists[0].bag,box:game.colony.chests[0].slots,
      ground:game.colony.items.find(i=>i.id==='cold-test-ground')});
    writeFileSync(path+'live.json', JSON.stringify(records,null,2));
  }
  async function settings() {
    if (await el('#panel-close').isVisible()) await click('#panel-close');
    if (!await el('#settings').isVisible()) {
      for(let n=0;n<4&&!await el('#pause-settings').isVisible();n++) {
        await page.keyboard.press('Escape');
      }
      await click('#pause-settings');
      await click('#options-world');
      await speed(0);
    }
  }
  async function load(name, tweak) {
    const file = JSON.parse(readFileSync(path+name+'.json'));
    if(tweak) tweak(file.colony);
    await settings();
    await click('#import');
    await el('#import-json').fill(JSON.stringify(file));
    await click('#import-confirm');
    await wait(s=>s.seed === file.colony.worldSeed && s.colony?.time===file.colony.time);
    await el('#import-panel').waitFor({state:'hidden'});
    await click('#settings-close');
  }
  async function warehouse(resource) {
    if (!await el('#workspace .wh-search').isVisible()) await click('[data-menu="warehouse"]');
    await el('#workspace .wh-search').fill(resource==='bread'?'面包':'牛奶');
    await el(cell(resource)).waitFor({state:'visible'});
  }
  async function cross(time) {
    await speed(1);
    await play.advance(.5,{read:'voxel.world',stepSeconds:.1});
    await wait(s=>s.colony.time>=time);
    await speed(0);
    await wait(s=>s.colony.speed===0);
  }
  await play.step('入库两批与首批满一天',async()=>{
    await load('first');
    await speed(6);
    await wait(s=>s.colony.time>=210);
    await speed(0);
    await wait(s=>s.colony.speed===0);
    await page.evaluate(()=>window.__wbSend('inventory',{from:{kind:'chest',id:'chest-starter',slot:0},to:{kind:'warehouse'},resource:'bread',amount:6}));
    await wait(s=>s.colony.resources.bread===10);
    await warehouse('bread');
    await saveFrame('01-second',cell('bread'));
    await load('before');
    await warehouse('bread');
    await saveFrame('02-before',cell('bread'));
    await cross(480);
    await saveFrame('03-bread',cell('bread'));
    await click('#panel-close');
    await warehouse('bread');
    await saveFrame('03-bread-reopened',cell('bread'));
    await warehouse('milk');
    await saveFrame('04-milk',cell('milk'));
    await click('#panel-close');
  });
  await play.step('仓库获取五个并搬进木箱',async()=>{
    await load('qualified',c=>{c.colonists.forEach(p=>{p.priorities.haul=1;p.hunger=95;p.rest=95;});});
    const id=(await state()).colony.colonists[0].id;
    await click('[data-testid="colonist-'+id+'"]');
    await warehouse('bread');
    await el(cell('bread')).click({button:'right'});
    await el('#item-amount').press('Home');
    for(let i=1;i<5;i++) await el('#item-amount').press('ArrowRight');
    await click('[data-item-action="take"]');
    await wait(s=>s.colony.resources.bread===5);
    await saveFrame('05-request');
    await click('#panel-close');
    await speed(3);
    for(let i=0;i<40;i++){
      const s=await play.advance(.5,{read:'voxel.world',stepSeconds:.1});
      if(s.colony.colonists[0].bag.some(b=>b?.resource==='bread')) break;
    }
    await speed(0);
    await page.evaluate(id=>window.__wbOpenFollower(id),id);
    await saveFrame('06-bag','.fb-cell[data-item="bread"]');
    assert.match(records.at(-1).title,/4 件保鲜/);
    await click('#panel-close');
    await click('[data-testid="colonist-'+id+'"]');
    await page.mouse.click(840,330,{button:'middle'});
    await play.keyboard.press('KeyR');
    await wait(s=>s.camera.followId===id);
    await page.evaluate(()=>window.__wbOpenChest());
    const source=el('#hotbar [data-item="bread"]');
    if(await source.isVisible()){
      await source.dragTo(el('.chest-cell[data-index="3"]'));
      await wait(s=>s.colony.chests[0].slots[3]?.resource==='bread');
      await saveFrame('07-chest','.chest-cell[data-index="3"]');
    }
  }).catch(e=>{records.push({step:'transfer',error:String(e)});writeFileSync(path+'live.json',JSON.stringify(records,null,2));});
  await play.step('存读档与次日零点',async()=>{
    await load('midnight-before');
    await page.evaluate(()=>window.__wbOpenChest());
    await saveFrame('08-midnight-before','.chest-cell[data-index="3"]');
    await settings();
    await click('#import');
    await el('#import-json').fill(readFileSync(path+'midnight-before.json','utf8'));
    await click('#import-confirm');
    await el('#import-panel').waitFor({state:'hidden'});
    await wait(s=>s.colony.time===719.75 && s.colony.speed===0);
    await click('#save');
    await page.waitForFunction(()=>localStorage.getItem('homestead.colony.v2.manual')!==null);
    await play.reload();
    await wait(s=>s.colony?.time===719.75);
    await settings();
    await click('#load');
    await wait(s=>s.colony.time===719.75 && s.colony.speed===0);
    await click('#settings-close');
    await page.evaluate(()=>window.__wbOpenChest());
    await saveFrame('09-loaded','.chest-cell[data-index="3"]');
    await cross(720);
    await wait(s=>s.colony.day===3);
    await saveFrame('10-expired-chest','.chest-cell[data-index="3"]');

    await click('#panel-close');
    await warehouse('bread');
    await saveFrame('11-expired',cell('bread'));
    await warehouse('milk');
    await saveFrame('12-expired-milk',cell('milk'));
  }).catch(e=>{records.push({step:'save-midnight',error:String(e)});writeFileSync(path+'live.json',JSON.stringify(records,null,2));});
  await play.step('独立复核已失效存档',async()=>{
    await load('expired');
    await warehouse('bread');
    await saveFrame('13-expired-independent',cell('bread'));
    await click('#panel-close');
    await page.evaluate(()=>window.__wbOpenChest());
    await saveFrame('14-expired-box','.chest-cell[data-index="3"]');
    await click('#panel-close');
    const resident=(await state()).colony.colonists[0].id;
    await page.evaluate(id=>window.__wbOpenFollower(id),resident);
    await saveFrame('15-expired-bag','.fb-cell[data-item="bread"]');
  });
  await play.step('停电与恢复',async()=>{
    for(const [i,name] of ['outage-before','outage','restarted','missed-original-deadline'].entries()){
      await load(name);
      await click('[data-menu="production"]');
      await el('text=电力与储存').scrollIntoViewIfNeeded();
      await el('text=/发电 .*冷藏/').scrollIntoViewIfNeeded();
      await saveFrame('power-'+i);
    }
  });
  return { frames:records.length };
}

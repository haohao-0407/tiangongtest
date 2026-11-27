import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
export default async function midnight(play){
  const p=play.page;
  const dir='artifacts/cold-qa-2026-11-27/';
  const records=[];
  const wait=pred=>play.waitFor(pred,{read:'voxel.world',timeoutMs:120000});
  const L=s=>p.locator(s);
  const click=s=>L(s).click({timeout:20000});
  const speed=n=>p.evaluate(value=>window.__wbSend('colony',{command:{action:'speed',value}}),n);
  async function settings(){
    for(let i=0;i<5&&!await L('#pause-settings').isVisible();i++) await p.keyboard.press('Escape');
    await click('#pause-settings');
    await click('#options-world');
  }
  async function frame(name,sel){
    const s=await play.state('voxel.world');
    let title=sel?await L(sel).getAttribute('title'):null;
    await p.screenshot({path:dir+name+'.png'});
    records.push({name,title,time:s.colony.time,day:s.colony.day,power:s.colony.power,
      bread:s.colony.warehouseStacks.filter(i=>i.resource==='bread'),milk:s.colony.warehouseStacks.filter(i=>i.resource==='milk'),
      ground:s.colony.items.find(i=>i.id==='cold-test-ground'),box:s.colony.chests[0].slots[3],bag:s.colony.colonists[0].bag[8]});
    writeFileSync(dir+'midnight-live.json',JSON.stringify(records,null,2));
  }
  await settings();
  await click('#import');
  await L('#import-json').fill(readFileSync(dir+'midnight-before.json','utf8'));
  await click('#import-confirm');
  await wait(s=>s.colony?.time===719.75&&s.colony.speed===0);
  await L('#import-panel').waitFor({state:'hidden'});
  await click('#save');
  await p.waitForFunction(()=>JSON.parse(localStorage.getItem('homestead.colony.v2.manual')||'{}').colony?.time===719.75);
  await frame('08-manual-save');
  await speed(1);
  await wait(s=>s.colony.day===3);
  await speed(0);
  await click('#load');
  await wait(s=>s.colony.time===719.75&&s.colony.speed===0);
  if(await L('#settings-close').isVisible()) await click('#settings-close');
  await p.evaluate(()=>window.__wbOpenChest());
  const chest='.chest-cell[data-index="3"]';
  await frame('09-loaded',chest);
  assert.match(records.at(-1).title,/2 件保鲜/);
  await speed(1);
  await wait(s=>s.colony.day===3);
  await speed(0);
  await wait(s=>s.colony.speed===0);

  await frame('10-expired-chest',chest);
  await click('#panel-close');
  await click('[data-menu="warehouse"]');
  const search=L('#workspace .wh-search');
  await search.fill('面包');
  await frame('11-expired','#workspace [data-item="bread"]');
  await search.fill('牛奶');
  await frame('12-expired-milk','#workspace [data-item="milk"]');
  await click('#panel-close');
  const s=await play.state('voxel.world');
  const item=s.colony.items.find(i=>i.id==='cold-test-ground');
  assert.ok(item.age>=600&&item.amount===2);
  await frame('16-ground');
  // Restore the manual save again after all checks, then verify a full page reopening.
  await settings();
  await click('#load');
  await wait(s=>s.colony.time===719.75&&s.colony.speed===0);
  await play.reload();
  await wait(s=>s.colony.time===719.75&&s.colony.speed===0);
  await frame('18-reentered');
  return records.map(({name,time})=>({name,time}));
}

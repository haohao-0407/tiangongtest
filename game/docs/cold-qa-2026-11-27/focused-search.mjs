import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

export default async function warehouseColdSearch(play) {
  const page = play.page;
  const input = page.locator('#workspace .wh-search');
  const fixtureDir = 'artifacts/cold-qa-2026-11-27';
  const evidence = join(fixtureDir, 'focused-search');
  mkdirSync(evidence, {recursive:true});
  const records = [];
  const wait = predicate => play.waitFor(predicate,{read:'voxel.world',timeoutMs:90000});
  const speed = value => page.evaluate(value => window.__wbSend('colony',{command:{action:'speed',value}}), value);
  const cdp = await page.context().newCDPSession(page);

  async function load(file) {
    if (await page.locator('#panel-close').isVisible()) await page.locator('#panel-close').click();
    await page.keyboard.press('Escape');
    await page.locator('#pause-settings').click();
    await page.locator('#options-world').click();
    await page.locator('#import').click();
    const data = readFileSync(join(evidence,file+'.json'),'utf8');
    const {colony} = JSON.parse(data);
    await page.locator('#import-json').fill(data);
    await page.locator('#import-confirm').click();
    await wait(s=>s.colony?.time===colony.time && s.colony.speed===0 && s.seed===colony.worldSeed);
    await page.locator('#import-panel').waitFor({state:'hidden'});
    if(await page.locator('#settings-close').isVisible()) await page.locator('#settings-close').click();
    await page.locator('[data-menu="warehouse"]').click();
  }

  for (const boundary of ['qualify','midnight']) {
    for (const [resource, term, effect] of [['bread','面包','保鲜'],['milk','牛奶','冰镇']]) {
      await play.step(boundary+' '+resource, async()=>{
        const qualify = boundary==='qualify';
        await load(qualify?'before':'midnight-before');
        await input.fill(term);
        const cell = page.locator('.wh-cell[data-item="'+resource+'"]');
        const ime = resource==='milk';
        // Chrome manages the composition, selection and events through its input subsystem.
        if (ime) {
          await input.evaluate(el=>el.select());
          await cdp.send('Input.imeSetComposition',{text:term,selectionStart:1,selectionEnd:1});
        } else {
          await input.evaluate(el=>el.setSelectionRange(1,1));
        }
        await input.evaluate((el,resource)=>{
          const root=el.getRootNode(), content=root.querySelector('#panel-content');
          content.scrollTop=16;
          const original=root.querySelector('.wh-cell[data-item="'+resource+'"]');
          let ended=0;
          el.addEventListener('compositionend',()=>ended++,{once:true});
          el.coldInspection=()=>({
            focused:root.activeElement===el,
            sameCard:original===root.querySelector('.wh-cell[data-item="'+resource+'"]'),
            query:el.value, start:el.selectionStart, end:el.selectionEnd,
            scroll:content.scrollTop, ended
          });
        },resource);
        const originalInput=await input.elementHandle();
        const editing=async()=>originalInput.evaluate(el=>el.coldInspection());
        const before=await editing();
        assert.equal(before.query,term);
        assert.equal(before.focused,true);
        assert.equal(before.start,1);
        assert.ok(before.scroll>0,'fixture must exercise a nonzero scroll offset');
        for(const moment of ['before','after']){
          if(moment==='after'){
            await speed(1);
            await wait(s=>s.colony.time >= (qualify?480:720));
            await speed(0);
            await wait(s=>s.colony.speed===0);
          }
          const game=(await play.state('voxel.world')).colony;
          const lots=game.warehouseStacks.filter(s=>s.resource===resource);
          const total=lots.reduce((n,s)=>n+s.count,0);
          const valid=lots.reduce((n,s)=>n+(s.premium?.day===game.day?s.premium.count:0),0);
          assert.equal(total,resource==='bread'?(qualify?10:5):3);
          const marked=qualify ? moment==='after' : moment==='before';
          assert.equal(valid,marked?(resource==='bread'?(qualify?4:5):3):0);
          assert.equal(game.resources[resource],total);
          await cell.locator('.cold-mark').waitFor({state:marked?'visible':'detached'});
          const title=await cell.getAttribute('title');
          assert.equal(await cell.locator('.wh-count').textContent(),String(total));
          assert.equal(await cell.locator('.cold-mark').count(),marked?1:0);
          if(marked){
            assert.ok(title.includes(valid+' 件'+effect));
            assert.equal(await cell.locator('.cold-mark').textContent(),effect);
          } else assert.doesNotMatch(title,/保鲜|冰镇|加成单价/);
          if(resource==='bread'){
            assert.equal(title.includes('普通单价 60 银币'),total>valid);
            assert.equal(title.includes('加成单价 72 银币'),valid>0);
          }
          const actual=await editing();
          assert.deepEqual(actual,before);
          const name=[boundary,resource,moment].join('-');
          await page.screenshot({path:join(evidence,name+'.png')});
          records.push({name,time:game.time,day:game.day,total,valid,title,ime,editing:actual,lots});
          writeFileSync(join(evidence,'observations.json'),JSON.stringify(records,null,2));
        }
        if(ime){
          await cdp.send('Input.insertText',{text:term});
          const committed=await editing();
          assert.equal(committed.ended,1);
          assert.equal(committed.query,term);
        }
        await originalInput.dispose();
      });
    }
  }
  await cdp.detach();
  return {checked:records.length,imeCommits:2};
}

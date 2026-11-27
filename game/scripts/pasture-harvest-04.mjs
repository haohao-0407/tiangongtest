import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tsImport } from 'tsx/esm/api';

const read = 'voxel.world', key = 'homestead.colony.v2';
const pastureOutput = 'artifacts/pasture-harvest-04';
const goods = ['milk','egg','cheese','friedEgg','silver'];
const pen = c => c.zones.find(z => z.kind === 'pasture');
const balances = c => Object.fromEntries(goods.map(k => [k,c.resources[k]]));
const stations = c => c.buildings.filter(b => ['milker','henNest','cheesePress','stove'].includes(b.kind));
const sale = c => c.jobs.find(j => j.guideSale)?.guideSale;


export async function fixture() {
  const {VoxelWorld,BLOCK} = await tsImport('../assets/voxel/model.ts',import.meta.url);
  const {ColonySimulation} = await tsImport('../assets/colony/simulation.ts',import.meta.url);
  const {buildingDimensions} = await tsImport('../assets/colony/buildings.ts',import.meta.url);
  const base = new VoxelWorld('草场-154',{width:48,height:24,depth:48});
  const terrain = JSON.parse(base.serialize());
  terrain.trees = [];
  for(let z=0;z<48;z++) for(let x=0;x<48;x++) for(let y=1;y<24;y++) {
    const block = y>6 ? BLOCK.Air : y===6 ? BLOCK.Grass : BLOCK.Dirt;
    if(base.get(x,y,z)!==block) terrain.edits.push([x+48*(z+48*y),block]);
  }
  const world = VoxelWorld.deserialize(JSON.stringify(terrain));
  const sim = new ColonySimulation(world), s = sim.serialize();
  Object.assign(s,{speed:0,time:120,buildings:[],items:[],jobs:[],crops:[],terrainPlans:[]});
  s.zones = [{id:'food',kind:'stockpile',storageClass:'food',x:28,z:22,y:7,w:1,d:1,crop:'cabbage'},
    {id:'general',kind:'stockpile',x:30,z:20,y:7,w:5,d:4,crop:'cabbage'}];
  for(const item of Object.keys(s.resources)) s.resources[item]=0;
  Object.assign(s.resources,{wood:180,steel:8,meal:24,silver:10,oil:128});
  s.warehouseStacks = [0,1,2,3].map(slot=>({x:28,z:22,slot,resource:'oil',count:32}));
  for(const [kind,x,z] of [['stove',33,28],['cheesePress',30,28]]) {
    s.buildings.push({id:kind,kind,x,z,y:7,...buildingDimensions(kind),rotation:0,complete:true,phase:'completed',
      progress:1,reserved:{},powered:false,comfort:0,roomId:null});
  }
  s.colonists.forEach((p,i)=>{
    Object.assign(p,{position:[29.5+i,7,25.5],jobId:null,path:[],personal:null,destination:null,
      health:100,recreation:100,rest:100,hunger:100,schedule:i===2?'night':'day'});
    for(const j of Object.keys(p.priorities)) p.priorities[j]=['construct','haul','harvest','craft','cook'].includes(j)?1:0;
  });
  sim.load(s);
  // Resume from an empty, unbuilt plan, the endpoint covered by the original marquee run.
  const result=sim.command({action:'designate',kind:'pasture',x:19,z:20,w:8,d:6});
  assert.ok(result.ok,result.message);
  return {world,file:{version:2,voxel:world.serialize(),colony:sim.serialize()}};
}

export default async function harvest(play, sourceSave=null) {
  const out=sourceSave ? pastureOutput+'/sale' : pastureOutput;
  const json = (name,data) => writeFileSync(out+'/'+name+'.json',JSON.stringify(data,null,2));
  mkdirSync(out,{recursive:true});
  const {world,file} = sourceSave ? {file:sourceSave} : await fixture();
  const {wildAnimalPose,visibleWildAnimals,stockAnimalId} = await tsImport('../assets/voxel/wild-animals.ts',import.meta.url);
  const {mapProjection} = await tsImport('../assets/voxel/zone-selection.ts',import.meta.url);
  const {page} = play, {width,height} = page.viewportSize();
  const state = () => play.state(read);
  const colony = async () => (await state()).colony;
  const wait = predicate => play.waitFor(s=>s.colony && predicate(s.colony),{read,timeoutMs:18000});
  const btn = id => page.locator('[data-testid="'+id+'"]');
  const click = id => btn(id).click({timeout:6000});
  const close = async () => {if(await page.locator('#panel-close').isVisible()) await page.locator('#panel-close').click();};
  const panel = async (menu,control) => {if(!await btn(control).isVisible()){await close();await click('menu-'+menu);}await btn(control).waitFor();};
  const speed = async n => {await btn('speed-'+n).evaluate(b=>b.click());await wait(c=>c.speed===n);};
  const records=[], crossings=new Map(), leading=new Set();
  const zoneId = pen(file.colony).id;
  async function record(name,c=undefined) {
    c ??= await colony();
    records.push({name,time:c.time,inventory:balances(c),pen:pen(c),stations:stations(c),stacks:c.warehouseStacks,
      ground:c.items,workers:c.colonists.map(({name,task,position,carrying,jobId})=>({name,task,position,carrying,jobId})),
      jobs:c.jobs.filter(j=>j.type!=='construct'),built:c.metrics.built});
    json('inventory',records);
    await page.screenshot({path:out+'/'+name+'.png',timeout:25000});
  }
  async function reach(label,predicate,step=1,limit=120,observe) {
    await speed(1);
    for(let i=0;i<limit;i++){
      const {colony:c} = await play.advance(step,{read,stepSeconds:.1});
      if(observe) await observe(c);
      if(predicate(c)){await speed(0);return c;}
    }
    const c=await colony();
    throw Error(label+' '+JSON.stringify({time:c.time,workers:c.colonists.map(p=>p.task),jobs:c.jobs,pen:pen(c),inventory:balances(c)}));
  }
  async function mapClick(x,z,tool,y=7.01) {
    await page.locator('#workspace').waitFor({state:'hidden'});
    await play.waitFor(s=>s.tool===tool,{read});
    let s=await state();
    let point=mapProjection(s.camera.eye,s.camera.target,width/height,Math.tan(Math.PI/8)).project(x+.5,y,z+.5);
    for(let i=0;i<4&&(point[0]<.12||point[0]>.86||point[1]<.18||point[1]>.79);i++) {
      await page.mouse.move(width*.55,height*.45);
      await page.mouse.wheel(0,320);
      s=await play.advance(.25,{read});
      point=mapProjection(s.camera.eye,s.camera.target,width/height,Math.tan(Math.PI/8)).project(x+.5,y,z+.5);
    }
    for(let attempt=0;attempt<6;attempt++) {
      await play.mouse.move(point);
      await play.advance(.16,{read});
      await play.mouse.click(point);
      s=await play.advance(.2,{read});
      if(s.tool!==tool) return;
      // Rotate the ordinary camera if a nameplate, fence or foreground object intercepted the click.
      await page.keyboard.down('KeyE');
      try { await play.advance(.4,{read,stepSeconds:.05}); } finally { await page.keyboard.up('KeyE'); }
      s=await state();
      point=mapProjection(s.camera.eye,s.camera.target,width/height,Math.tan(Math.PI/8)).project(x+.5,y,z+.5);
    }
    throw Error(JSON.stringify({x,z,tool,point,status:s.status,hover:s.hoverCell}));
  }
  async function saved(name) {
    const c=await colony();
    await page.locator('#save').evaluate(b=>b.click());
    await page.waitForFunction(({k,t,f})=>{
      const s=JSON.parse(localStorage.getItem(k+'.manual')||'null')?.colony;
      return s?.time===t && s.speed===0 && s.resources.friedEgg===f;
    },{k:key,t:c.time,f:c.resources.friedEgg});
    const raw=await page.evaluate(k=>localStorage.getItem(k+'.manual'),key);
    writeFileSync(out+'/'+name+'.json',raw);
    return JSON.parse(raw);
  }
  await wait(c=>c.colonists.length);
  await page.evaluate(([k,f])=>localStorage.setItem(k,JSON.stringify(f)),[key,file]);
  await play.reload();await wait(c=>pen(c)?.id===zoneId && c.speed===0);
  let c=await colony();
  const ownership = c => pen(c).pasture.animals.map(({id,kind,homeX,homeZ,state})=>({id,kind,homeX,homeZ,state}));
  if(!sourceSave) {
    assert.equal(pen(c).pasture.ready,false);
    assert.deepEqual(balances(c),{milk:0,egg:0,cheese:0,friedEgg:0,silver:10});
    await record('01-blueprints');
    await reach('fence',c=>pen(c).pasture.ready,4);
    c=await colony();
    const border=c.buildings.filter(b=>['fence','pastureGate'].includes(b.kind));
    assert.equal(border.length,24);assert.ok(border.every(b=>b.complete));
    const oldGate=pen(c).pasture.gate;
    await record('02-fence-built');
    const wild=visibleWildAnimals(world,c).filter(a=>a.y===7);
    for(const [kind,x,z] of [['cow',37,34],['cow',38,37],['pig',29,2],['sheep',26,7],['chicken',22,44]]) {
      const a=wild.find(a=>a.kind===kind&&a.x===x&&a.z===z);assert.ok(a);
      const control='herd-'+zoneId;
      await panel('plan',control);await click(control);
      const pose=wildAnimalPose(a,c.time);
      await mapClick(Math.floor(pose.x),Math.floor(pose.z),'herd:'+zoneId);
      c=await colony();
      assert.ok(pen(c).pasture.animals.some(p=>p.id===stockAnimalId(a)),(await state()).status);
    }
    await close();await record('03-herd-orders');
    await reach('all home',c=>pen(c).pasture.animals.every(a=>a.state==='home'),.25,2200,async c=>{
      for(const a of pen(c).pasture.animals.filter(a=>a.state==='leading')) {
        leading.add(a.id);
        if(a.x!==oldGate[0]||a.z!==oldGate[1]||crossings.has(a.id)) continue;
        const worker=c.colonists.find(p=>p.jobId===c.jobs.find(j=>j.targetId===a.id)?.id);
        crossings.set(a.id,{time:c.time,kind:a.kind,cell:[a.x,a.z],worker:worker?.name,position:worker?.position});
        await record('04-gate-'+a.id,c);
      }
    });
    json('crossings',Object.fromEntries(crossings));
    assert.equal(leading.size,5);assert.equal(crossings.size,5);
    const herd=pen(await colony()).pasture.animals;

    const owners=ownership(await colony());
    await record('05-mixed-herd');
    const gateButton='gate-'+zoneId;
    const nextGate=[22,20];
    await panel('plan',gateButton);await click(gateButton);await mapClick(...nextGate,'pasture-gate');
    c=await colony();assert.deepEqual(pen(c).pasture.pendingGate,nextGate,(await state()).status);
    await close();
    await reach('replace gate',c=>pen(c).pasture.ready&&pen(c).pasture.gate.join()===nextGate.join(),2);
    c=await colony();assert.ok(c.buildings.some(b=>b.kind==='fence'&&b.complete&&b.x===oldGate[0]&&b.z===oldGate[1]));
    await saved('gate-save');await play.reload();await wait(c=>pen(c)?.pasture.ready&&pen(c).pasture.gate.join()===nextGate.join());
    assert.deepEqual(ownership(await colony()),owners);await record('06-gate-reloaded');
    await haul(0);
    for(const [kind,x,z] of [['milker',24,23],['henNest',22,23]]) {
      assert.ok(herd.every(a=>a.homeX!==x||a.homeZ!==z));
      const id='build-'+kind;await panel('build',id);await click(id);await mapClick(x,z,'build:'+kind);
      assert.ok(stations(await colony()).some(b=>b.kind===kind&&!b.complete),(await state()).status);
      await close();
    }
    await close();
    // Pause hauling via normal work controls so both drops can be observed before dispatch.
    async function haul(value) {
      c=await colony();
      for(const p of c.colonists) {
        const id='priority-'+p.id+'-haul';await panel('work',id);
        let current=(await colony()).colonists.find(q=>q.id===p.id).priorities.haul;
        while(current!==value){current=(current+1)%5;await click(id);await wait(c=>c.colonists.find(q=>q.id===p.id).priorities.haul===current);}
      }
      await close();
    }
    await reach('stations',c=>stations(c).every(b=>b.complete),2,350);
    await record('07-collection-stations');
    await reach('ground milk and egg',c=>c.items.filter(i=>i.resource==='milk').reduce((n,i)=>n+i.amount,0)>=2&&c.items.some(i=>i.resource==='egg'),5,700,async c=>{
      for(const kind of ['milk','egg']) {
        const building=stations(c).find(b=>b.kind===(kind==='milk'?'milker':'henNest'));
        const j=c.jobs.find(j=>j.type==='husbandry'&&j.x===building.x&&j.z===building.z&&j.assignedTo);
        if(j&&!records.some(r=>r.name==='08-collect-'+kind)) await record('08-collect-'+kind,c);
      }
    });
    c=await colony();assert.equal(c.resources.milk+c.resources.egg,0);
    await record('09-ground-before-haul');
    await haul(1);
    await reach('milk and egg stored',c=>c.resources.milk>=2&&c.resources.egg>=1,1,220,async c=>{
      for(const kind of ['milk','egg']) if(c.colonists.some(p=>p.carrying[kind]>0)&&!records.some(r=>r.name==='10-carry-'+kind)) await record('10-carry-'+kind,c);
    });
    c=await colony();
    assert.equal(c.warehouseStacks.filter(s=>s.x===28&&s.z===22).reduce((n,s)=>n+s.count,0),128);
    for(const r of ['milk','egg']) {
      const stacks=c.warehouseStacks.filter(s=>s.resource===r);
      assert.equal(stacks.reduce((n,s)=>n+s.count,0),c.resources[r]);assert.ok(stacks.every(s=>s.x>=30&&s.x<35&&s.z>=20&&s.z<24));
    }

    await close();await click('menu-warehouse');
    await record('11-general-storage');await close();
    for(const [recipe,station,raw,cost] of [['cheese','cheesePress','milk',2],['friedEgg','stove','egg',1]]) {
      await panel('production','craft-order-'+recipe);await page.locator('#craft-batch').selectOption('1');
      await click('craft-order-'+recipe);
      await reach(recipe+' reservation',c=>c.jobs.some(j=>j.recipe===recipe&&j.reserved[raw]===cost),.5,150);
      c=await colony();const j=c.jobs.find(j=>j.recipe===recipe);
      assert.equal(c.buildings.find(b=>b.id===j.targetId)?.kind,station);
      await btn('craft-order-'+j.id).scrollIntoViewIfNeeded();await record('12-order-'+recipe);
      await close();await reach(recipe+' stocked',c=>c.resources[recipe]===1,1,180);
    }
    await click('menu-warehouse');await record('13-products-in-stock');await close();
    const finalFile=await saved('pasture-final-save');
    await play.reload();await wait(c=>c.resources.cheese===1&&c.resources.friedEgg===1&&c.speed===0);
    c=await colony();assert.deepEqual(balances(c),balances(finalFile.colony));assert.deepEqual(ownership(c),owners);
    await record('13-products-reloaded');return;
  } else {
    assert.deepEqual(balances(c),balances(file.colony));
    assert.equal(c.resources.cheese,1);assert.equal(c.resources.friedEgg,1);
    await record('13-sale-opening');
  }
  const owners=ownership(c);
  const guide=page.locator('#guide-map-label');
  await page.mouse.move(width*.58,height*.47);
  for(let i=0;i<5 && !await guide.isVisible();i++){
    await page.mouse.wheel(0,320);
    await play.advance(.25,{read,stepSeconds:.05});
  }
  await guide.click({button:'right'});await click('guide-recycle-friedEgg');
  assert.match(await btn('guide-confirm').innerText(),/35/);
  await record('14-guide-quote');await click('guide-confirm');
  await wait(c=>sale(c)?.count===1&&c.resources.friedEgg===0&&c.resources.silver===10);
  await record('15-guide-reserved');
  await reach('delivery in transit',c=>sale(c)?.inTransit===1,.25,250);
  c=await colony();assert.equal(c.resources.silver,10);assert.equal(sale(c).paid,0);
  await record('16-guide-in-transit');
  await reach('payment',c=>!sale(c)&&c.resources.silver===45,.5,180);
  await record('17-guide-paid');await close();
  const soldFile=await saved('guide-final-save');
  await play.reload();await wait(c=>c.speed===0&&c.resources.silver===45&&!sale(c));
  c=await colony();assert.deepEqual(balances(c),balances(soldFile.colony));assert.deepEqual(ownership(c),owners);
  await click('menu-warehouse');await record('18-sale-reloaded');await close();
}

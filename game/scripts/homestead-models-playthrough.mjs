import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';
import {createFacadeTerrainFixture} from './facade-playthrough.mjs';
import {returnToMap} from './return-to-map.mjs';

const read='voxel.world', saveKey='homestead.colony.v2.manual';
const groups=[
  ['ranch',['fence','pastureGate','milker','henNest']],
  ['workshop',['sugarPress','shearingStand','loom','flourMill']],
  ['power',['solar','battery','cooler']],
  ['lighting',['torch','floorLamp','chandelier','sculpture','vase']],
];

export default async function homesteadModels(play) {
  const {VoxelWorld}=await tsImport('../assets/voxel/model.ts',import.meta.url);
  const {ColonySimulation}=await tsImport('../assets/colony/simulation.ts',import.meta.url);
  const {buildingDimensions}=await tsImport('../assets/colony/buildings.ts',import.meta.url);
  const {pastureLayout}=await tsImport('../assets/colony/pasture.ts',import.meta.url);
  const {mapProjection}=await tsImport('../assets/voxel/zone-selection.ts',import.meta.url);
  const world=VoxelWorld.deserialize(createFacadeTerrainFixture());
  for(const tree of world.getTrees()) world.removeTree(tree.id,{recordHistory:false});
  const sim=new ColonySimulation(world), base=sim.serialize();
  const {page}=play, {width,height}=page.viewportSize();
  const wait=fn=>play.waitFor(fn,{read,timeoutMs:18000});
  const advance=()=>play.advance(.22,{read,stepSeconds:.05});
  const shot=async name=>assert.ok((await play.screenshot(name)).rendered);
  const missed=[];
  await wait(s=>s.characters?.merchants.length);
  for(const [group,kinds] of groups) {
    const colony=structuredClone(base);
    for(const key of ['buildings','items','jobs','zones','crops','terrainPlans','warehouseStacks']) colony[key]=[];
    colony.speed=0;
    colony.colonists.forEach((p,i)=>Object.assign(p,{position:[15.5+2*i,5,15.5-i],path:[],personal:null,jobId:null,destination:null}));
    colony.specialistMarket.walks.guide.position=[13.5,5,16.5];
    const add=(kind,x,z,rotation=0)=>colony.buildings.push({
      id:group+'-'+kind+'-'+x+'-'+z,kind,x,y:5,z,rotation,...buildingDimensions(kind,rotation),
      phase:'completed',complete:true,progress:1,reserved:{},powered:true,comfort:0,roomId:null,
    });
    if(group==='ranch') {
      const pen={id:'ranch',kind:'pasture',x:14,y:5,z:14,w:8,d:6,crop:'cabbage'};
      const layout=pastureLayout(pen), gate=layout.gates.find(g=>g.cell[0]===21);
      pen.pasture={gate:gate.cell,animals:[]};
      for(const [x,z] of layout.border) {
        const entrance=x===gate.cell[0] && z===gate.cell[1];
        add(entrance?'pastureGate':'fence',x,z,entrance?1:0);
      }
      for(const [i,kind] of ['pig','pig','sheep','chicken','cow'].entries()){
        const x=15+i,z=18;
        pen.pasture.animals.push({id:kind+'-'+i,kind,young:i===1,female:true,state:'home',x,z,homeX:x,homeZ:z,readyAt:0});
      }
      colony.zones.push(pen);
      add('milker',17,16);add('henNest',20,16);
    } else {
      kinds.forEach((kind,i)=>add(kind,14+(i%3)*3,16+Math.floor(i/3)*3));
      if(group==='lighting') add('solar',12,13);
    }
    sim.load(colony);
    await page.evaluate(([key,data])=>localStorage.setItem(key,JSON.stringify(data)),[saveKey,
      {version:2,voxel:world.serialize(),colony:sim.serialize()}]);
    await page.locator('#load').evaluate(el=>el.click());
    await wait(s=>s.colony.buildings[0]?.id===colony.buildings[0].id);
    await returnToMap(play);
    await play.mouse.move([.59,.54]);
    await page.keyboard.press('KeyF');
    for(let i=0;i<11 && (await play.state(read)).camera.distance>15.01;i++){
      await page.mouse.wheel(0,-360);await advance();
    }
    await play.step(group,async()=>{
      const state=await play.state(read);
      const guide=state.characters.merchants.find(m=>m.id==='guide');
      assert.equal(guide.joints,22);assert.equal(guide.meshes,1);assert.equal(guide.outfit,18);
      if(group==='ranch') {
        assert.ok(state.wildAnimals.pig>=2);
        assert.ok(state.colony.zones.find(z=>z.id==='ranch').pasture.ready);
        await shot('01-guide-02-pigs-03-fence-corners-04-gate');
      } else await shot(group);
      for(const kind of kinds){
        await returnToMap(play);
        const s=await play.state(read), b=s.colony.buildings.find(b=>b.kind===kind);
        assert.ok(b.complete);
        const project=mapProjection(s.camera.eye,s.camera.target,width/height,Math.tan(Math.PI/8)).project;
        let selected=false;
        const heights=kind==='chandelier' ? [1.6,1.85,.3] : kind==='floorLamp' ? [2.3,3.5,.8] : [.82,.45,.18];
        for(const h of heights){
          const point=project(b.x+b.w/2,b.y+h,b.z+b.d/2);
          await play.mouse.move(point);
          if((await advance()).hoverBuildingId!==b.id)continue;
          await play.mouse.click(point);
          if((await advance()).selectedBuildingId===b.id){selected=true;break;}
        }
        if(!selected)missed.push(kind);
        await shot(kind);
      }
    });
  }
  assert.deepEqual(missed,[],'Map picking');
}

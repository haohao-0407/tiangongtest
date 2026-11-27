import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {VoxelWorld} from '../../assets/voxel/model.ts';
import {ColonySimulation} from '../../assets/colony/simulation.ts';

// Copy the two observed cold lots onto a small map to reduce the cost of importing the save.
const folder = 'artifacts/cold-qa-2026-11-27';
const out = join(folder, 'focused-search');
mkdirSync(out, {recursive:true});
for (const name of ['before','midnight-before']) {
  const source = JSON.parse(readFileSync(join(folder,name+'.json'),'utf8')).colony;
  const world = VoxelWorld.deserialize(JSON.stringify({
    version:1, generatorVersion:1, seed:'冷藏搜索复验', size:[48,24,48], edits:[]
  }));
  const sim = new ColonySimulation(world);
  const save = sim.serialize();
  save.speed = 0;
  save.time = source.time;
  save.lastDay = source.lastDay;
  for (const [i,kind] of ['solar','battery','cooler'].entries()) {
    save.buildings.push({id:'search-'+kind,kind,x:33+i,y:6,z:30,complete:true,progress:1,
      reserved:{},powered:false,comfort:0,roomId:null});
  }
  save.power.capacity = save.power.stored = 12000;
  for (const resource of ['bread','milk']) {
    const lots = source.warehouseStacks.filter(stack=>stack.resource===resource);
    const local = save.warehouseStacks.filter(stack=>stack.resource===resource);
    assert.equal(lots.length,1);
    assert.equal(local.length,1);
    const {count,freezing,premium} = lots[0];
    Object.assign(local[0],{count,freezing,premium});
    save.resources[resource]=count;
  }
  sim.load(save);
  writeFileSync(join(out,name+'.json'),JSON.stringify({version:2,voxel:world.serialize(),colony:sim.serialize()}));
}

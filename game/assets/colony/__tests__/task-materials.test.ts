import { describe, expect, it } from 'vitest';
import { VoxelWorld } from '../../voxel/model.ts';
import { ColonySimulation } from '../simulation.ts';
import { taskMaterials, materialSource } from '../task-materials.ts';
import type { BuildingView, JobView } from '../contracts.ts';

function snapshot() {
  const c = new ColonySimulation(VoxelWorld.deserialize(JSON.stringify({
    version:1, generatorVersion:2, seed:'material-ledger', size:[32,24,32], edits:[],
  }))).snapshot();
  c.items = []; c.jobs = []; c.crops = [];
  return c;
}

describe('task material ledger', () => {
  it('uses each blueprint reservation only for its own order and counts the free balance once', () => {
    const c = snapshot(), template = c.buildings[0];
    c.buildings = [{...template,id:'a',kind:'stool',complete:false,reserved:{wood:3}},
      {...template,id:'b',kind:'stool',complete:false,reserved:{}},
      {...template,id:'c',kind:'stool',complete:false,reserved:{}}];
    c.resources.wood = 2;
    expect(taskMaterials(c)).toMatchObject([{item:'wood',missing:4}]);
  });
  it('counts unplanted plots using each crop’s planting item and accepts previously reserved seeds', () => {
    const c = snapshot();
    const grow: JobView = {id:'j',type:'grow',targetId:'a',x:1,y:5,z:1,progress:0,work:5,state:'queued',assignedTo:null,reserved:{},label:''};
    c.crops = [{id:'a',kind:'tomato',x:1,y:5,z:1,growth:0,planted:false},
      {id:'b',kind:'tomato',x:2,y:5,z:1,growth:0,planted:false},{id:'c',kind:'blueberry',x:3,y:5,z:1,growth:0,planted:false}];
    c.jobs = [grow,{...grow,id:'j2',targetId:'b',reserved:{tomatoSeed:1}},{...grow,id:'j3',targetId:'c'}];
    c.resources.tomatoSeed = c.resources.blueberry = 0;
    expect(taskMaterials(c)).toEqual(expect.arrayContaining([
      expect.objectContaining({item:'tomatoSeed',missing:1,source:expect.stringContaining('向导')}),
      expect.objectContaining({item:'blueberry',missing:1}),
    ]));
  });
  it('routes stone and pig iron through their own usable station, including tool and depletion state', () => {
    const c = snapshot(), template = c.buildings[0];
    const b: BuildingView = {...template,id:'station',kind:'extractionStation',complete:true,mining:{resource:'stone',remaining:4,status:'等待可用石镐'}};
    c.buildings = [b];
    expect(materialSource(c,'stone')).toContain('石镐');
    expect(materialSource(c,'pigIron')).toContain('铁矿点放置采集站');
    b.complete = false;
    expect(materialSource(c,'stone')).toContain('完工');
    b.mining!.remaining = 0;
    expect(materialSource(c,'stone')).toContain('石料点放置采集站');
  });
});

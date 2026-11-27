import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ColonySimulation } from '../assets/colony/simulation.ts';
import { VoxelWorld } from '../assets/voxel/model.ts';

const gateSave = new URL('../docs/pasture-harvest-04-qa-2026-11-27/gate-save.json', import.meta.url);
const file = JSON.parse(readFileSync(gateSave, 'utf8'));
const sim = new ColonySimulation(VoxelWorld.deserialize(file.voxel));
sim.load(file.colony);
const ordered = sim.command({action:'build', kind:'milker', x:24, z:23});
assert.ok(ordered.ok, ordered.message);

const save = sim.serialize();
const job = save.jobs.find(j => j.targetId === ordered.id && j.type === 'construct');
const worker = save.colonists[0];
// The live run stalled with the worker's center in the adjacent cell, but their body
// still intersecting the footprint by 0.03 blocks. Preserve that exact final approach.
Object.assign(job, {progress:job.work - .25, assignedTo:worker.id, state:'working'});
Object.assign(worker, {jobId:job.id, position:[23.8,7,23.5], path:[], destination:[23.8,7,23.5], personal:null});
save.time = 135;
save.speed = 1;
save.colonists.slice(1).forEach((p,i) => { p.position = [33.5+i,7,25.5]; });
sim.load(save);

for(let i=0; i<80; i++) sim.tick(.25);
const result = sim.snapshot();
const milker = result.buildings.find(b => b.id === ordered.id);
console.log(JSON.stringify({complete:milker.complete, progress:milker.progress, reason:milker.blockedReason, worker:result.colonists[0].position}));
assert.equal(milker.complete, true, 'The builder at x=23.8 must clear the milker at x=24.');

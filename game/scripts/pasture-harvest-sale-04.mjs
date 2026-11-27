import { readFileSync } from 'node:fs';
import harvest from './pasture-harvest-04.mjs';

export default function sellPastureDish(play) {
  const save = JSON.parse(readFileSync(new URL('../docs/pasture-harvest-04-qa-2026-11-27/pasture-final-save.json',import.meta.url),'utf8'));
  return harvest(play,save);
}

const READ = 'voxel.world';
export default async function probe(play) {
  await play.advance(1.0, { read: READ, stepSeconds: 0.05 });
  const st = await play.state(READ);
  const p = st.colony.colonists[0];
  return { keys: Object.keys(p), sample: JSON.stringify(p).slice(0, 400) };
}

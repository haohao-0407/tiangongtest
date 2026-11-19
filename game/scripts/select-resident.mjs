export async function selectResident(play,id){
  const read='voxel.world';
  const residentId=id??(await play.state(read)).colony.colonists[0].id;
  await play.page.locator('[data-testid="colonist-'+residentId+'"]').click();
  return play.waitFor(state=>state.colony.selectedColonistId===residentId,{read,timeoutMs:10000});
}

export async function possessResident(play,id){
  const selected=await selectResident(play,id);
  const {width,height}=play.page.viewportSize();
  await play.page.mouse.click(width*.66,height*.46,{button:'middle'});
  await play.advance(.15,{read:'voxel.world',stepSeconds:.05});
  await play.page.keyboard.press('KeyR');
  return play.waitFor(state=>state.camera.followId===selected.colony.selectedColonistId,{read:'voxel.world',timeoutMs:10000});
}

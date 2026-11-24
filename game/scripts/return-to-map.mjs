/** Return to ordinary map selection through the same controls players use. */
export async function returnToMap(play) {
  const read = 'voxel.world';
  if ((await play.state(read)).tool !== 'inspect') {
    await play.page.keyboard.press('Escape');
    await play.waitFor(state => state.tool === 'inspect', { read });
    await play.advance(.1, { read });
  }
  for (const id of ['panel-close', 'inspector-close']) {
    const close = play.page.locator(`#${id}`);
    if (await close.isVisible()) await close.click();
  }
}

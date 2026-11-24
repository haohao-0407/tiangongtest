import assert from 'node:assert/strict';

export default async function overviewShadows(play) {
  const read = 'voxel.world';
  const ready = () => play.waitFor(s => s.camera?.mode === 'god' && s.trees?.length > 0, { read });
  const capture = async name => assert.ok((await play.screenshot(name)).rendered);
  const wheel = async delta => {
    await play.page.mouse.wheel(0, delta);
    return (await play.advance(.1, { read, stepSeconds: .025 })).camera;
  };
  const checkZoomLimit = async (delta, limit, checkpoint) => {
    let camera = (await play.state(read)).camera;
    for (let i = 0; i < 20 && camera.distance !== limit; i++) camera = await wheel(delta);
    assert.equal(camera.distance, limit);
    for (let i = 0; i < 4; i++) {
      const next = await wheel(delta);
      assert.equal(next.distance, limit);
      assert.deepEqual(next.eye, camera.eye);
    }
    assert.equal((await play.advance(.2, { read })).camera.distance, limit);
    await capture(checkpoint);
    const reversed = await wheel(-delta);
    assert.ok((reversed.distance - limit) * delta < 0, 'Reversing the wheel leaves the limit immediately');
  };
  const picker = play.page.locator('#opt-sun-shadows');
  const openOptions = async () => {
    await play.page.keyboard.press('Escape');
    await play.page.locator('#pause-settings').click();
    await picker.waitFor({ state: 'visible' });
  };
  const resume = async () => {
    await play.page.locator('#options-back').click();
    await play.page.keyboard.press('Escape');
    await play.page.locator('#pause-menu').waitFor({ state: 'hidden' });
  };
  const forestOverview = async () => {
    // The starting meadow is directly under a low cloud. Frame trees on both
    // sides of the former cutoff so their shadows can be inspected unobstructed.
    await play.mouse.move([.5, .45]);
    if ((await play.state(read)).camera.target[0] > 67)
      await play.keyboard.hold('KeyW', s => s.camera.target[0] <= 67, { read });
    for (let i = 0; i < 20 && (await play.state(read)).camera.distance < 100; i++) {
      await play.page.mouse.wheel(0, 240);
      await play.advance(.2, { read });
    }
    const { camera, trees } = await play.advance(.5, { read });
    assert.equal(camera.distance, 100, 'Expected the farthest overview camera');
    const [ex, ey, ez] = camera.eye;
    const sy = Math.sin(camera.yaw), cy = Math.cos(camera.yaw);
    const sp = Math.sin(camera.pitch), cp = Math.cos(camera.pitch);
    const { width, height } = play.page.viewportSize();
    const depths = [];
    for (const tree of trees) {
      const x = tree.x + .5 - ex, y = tree.y - ey, z = tree.z + .5 - ez;
      const horizontal = x * sy + z * cy;
      const depth = -horizontal * cp - y * sp;
      const halfHeight = depth * Math.tan(Math.PI / 8);
      if (Math.abs(x * cy - z * sy) <= halfHeight * width / height &&
          Math.abs(y * cp - horizontal * sp) <= halfHeight) depths.push(depth);
    }
    assert.ok(Math.max(...depths) > 110, 'Frame trees beyond the old shadow limit');
    assert.ok(Math.max(...depths) < camera.shadowDistance, 'Cover all visible tree roots');
  };
  const start = await ready();
  assert.equal(start.camera.shadowDistance, 100);
  await capture('01-normal-overview');
  await play.mouse.move([.5, .45]);
  await play.step('wheel-stays-at-both-zoom-limits', async () => {
    await checkZoomLimit(-240, 15, 'near-camera-limit');
    await checkZoomLimit(240, 100, 'far-camera-limit');
  });
  await play.page.keyboard.press('KeyF');
  await play.waitFor(s => s.camera.distance === 47, { read });
  await forestOverview();
  await capture('02-high-overview');
  await openOptions();
  assert.equal(await picker.inputValue(), 'auto');
  await capture('settings-sun-shadows');
  await picker.selectOption('near');
  await play.waitFor(s => s.camera.sunShadows === 'near' && s.camera.shadowDistance === 100, { read });
  await resume();
  await capture('near-shadows');
  await openOptions();
  await picker.selectOption('off');
  await play.waitFor(s => s.camera.sunShadows === 'off' && s.camera.shadowDistance === 0, { read });
  await resume();
  await capture('shadows-off');
  await play.reload();
  await play.waitFor(s => s.camera?.sunShadows === 'off', { read });
  await openOptions();
  assert.equal(await picker.inputValue(), 'off');
  await picker.selectOption('auto');
  await play.waitFor(s => s.camera.sunShadows === 'auto' && s.camera.shadowDistance >= 100, { read });
  await resume();
  await forestOverview();
  await capture('03-high-overview-after-reload');
}

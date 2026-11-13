// ForgeAX 0.4.19 creates a directory symlink for the compiled View host.
// Windows standard accounts can create a junction without enabling Developer Mode.
// Keep this fallback restricted to the exact dependencies and workspace of this launcher.
const fs = require('node:fs/promises');
const path = require('node:path');
const { syncBuiltinESMExports } = require('node:module');
const original = fs.symlink;
const normalized = value => path.resolve(String(value)).replaceAll('\\', '/').toLowerCase();
const workspace = process.env.FORGEAX_VIEW_WORKSPACE;
const dependencies = process.env.FORGEAX_VIEW_DEPENDENCIES;

if (process.platform === 'win32' && workspace && dependencies) {
  const prefix = normalized(path.join(workspace, '.forgeax', 'host')) + '/';
  const source = normalized(dependencies);
  fs.symlink = async function (target, destination, type) {
    try { return await original.call(this, target, destination, type); }
    catch (error) {
      const dest = normalized(destination);
      const relative = dest.startsWith(prefix) ? dest.slice(prefix.length) : '';
      if (error.code !== 'EPERM' || type !== 'dir' || normalized(target) !== source
        || !/^session-[^/]+\/compiled\/node_modules$/.test(relative)) throw error;
      await original.call(this, path.resolve(String(target)), destination, 'junction');
      process.stderr.write('[ForgeAX View] Compiled host dependencies linked with a Windows junction.\n');
    }
  };
  syncBuiltinESMExports();
}

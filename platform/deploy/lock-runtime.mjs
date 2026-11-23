/** Project the tested npm lock onto the backend's direct dependencies. Resolve
 * transitive packages at the same Node resolution paths, including optional native
 * binaries for Linux. Never ask the registry to pick newer versions for deployment. */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
const locked = JSON.parse(readFileSync(path.join(dir, '../package-lock.json'), 'utf8')).packages;
function resolved(from, name, optional) {
  let context = from;
  for (;;) {
    const key = path.posix.join(context, 'node_modules', name);
    if (locked[key]) return key;
    if (!context) break;
    const parent = path.posix.dirname(context);
    context = parent === '.' ? '' : parent;
  }
  if (!optional) throw Error('Required dependency is absent from the evaluated lock: ' + name);
}
const visited = new Map(),
  queue = [];
for (const [pkg, version] of Object.entries(manifest.dependencies)) {
  const key = resolved('', pkg, false);
  if (locked[key].version !== version) throw Error('Runtime version mismatch: ' + pkg);
  queue.push([key, true]);
}
for (let i = 0; i < queue.length; i++) {
  const [key, required] = queue[i];
  if (visited.has(key) && (visited.get(key) || !required)) continue;
  visited.set(key, required);
  const info = locked[key],
    deps = { ...info.peerDependencies, ...info.dependencies, ...info.optionalDependencies };
  for (const name of Object.keys(deps)) {
    const optional =
      Object.hasOwn(info.optionalDependencies ?? {}, name) ||
      (!Object.hasOwn(info.dependencies ?? {}, name) &&
        info.peerDependenciesMeta?.[name]?.optional === true);
    const child = resolved(key, name, optional);
    if (child) queue.push([child, required && !optional]);
  }
}
const header = {
  name: manifest.name,
  version: manifest.version,
  dependencies: manifest.dependencies,
  engines: manifest.engines,
};
const packages = { '': header };
for (const key of [...visited.keys()].sort()) {
  const item = { ...locked[key] };
  delete item.dev;
  delete item.devOptional;
  delete item.peer;
  if (visited.get(key)) delete item.optional;
  else item.optional = true;
  packages[key] = item;
}
const output = {
  name: manifest.name,
  version: manifest.version,
  lockfileVersion: 3,
  requires: true,
  packages,
};
writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ lockedPackages: visited.size }));

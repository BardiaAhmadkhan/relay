const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const fs = require('node:fs');
const config = getDefaultConfig(__dirname);
const { createHash } = require('node:crypto');
// Expo inlines public app settings during transformation. A cached event entry must never become the
// ordinary V3.5 home (or retain the other build's endpoint) when both are built in the same checkout.
const publicProfile = [
  process.env.RELAY_MOBILE_PROFILE ?? 'api',
  process.env.EXPO_PUBLIC_RELAY_EVENT_DESK ?? '0',
  process.env.EXPO_PUBLIC_RELAY_V4_API_URL ?? '',
  process.env.EXPO_PUBLIC_RELAY_API_URL ?? '',
];
config.cacheVersion = (config.cacheVersion ?? 'metro') + '-relay-' +
  createHash('sha256').update(JSON.stringify(publicProfile)).digest('hex').slice(0,20);
// Shared evidence/policy modules live beside the mobile workspace.
config.watchFolders = [...new Set([...(config.watchFolders || []), path.resolve(__dirname, '..')])];
// The clean native build uses the workspace's installed modules through directory links.
// Metro requires both the targets and their physical module search paths.
const linkedModules = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(__dirname, '../node_modules'),
]
  .filter((dir) => fs.existsSync(dir) && fs.realpathSync(dir).toLowerCase() !== dir.toLowerCase())
  .map((dir) => fs.realpathSync(dir));
if (linkedModules.length) {
  config.watchFolders = [...new Set([...config.watchFolders, ...linkedModules])];
  config.resolver.nodeModulesPaths = [
    ...new Set([...(config.resolver.nodeModulesPaths || []), ...linkedModules]),
  ];
}
if (process.env.RELAY_MOBILE_PROFILE !== 'offline') {
  const api = path.resolve(__dirname, 'src/api.ts');
  config.resolver.resolveRequest = (context, name, platform) => {
    if (
      platform === 'android' &&
      name === './api' &&
      path.resolve(context.originModulePath) === path.resolve(__dirname, 'src/useRelay.ts')
    )
      return { type: 'sourceFile', filePath: api };
    return context.resolveRequest(context, name, platform);
  };
}
module.exports = config;

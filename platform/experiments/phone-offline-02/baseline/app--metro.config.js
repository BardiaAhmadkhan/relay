const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const config = getDefaultConfig(__dirname);
// Shared evidence/policy modules live beside the mobile workspace.
config.watchFolders = [...new Set([...(config.watchFolders || []), path.resolve(__dirname, '..')])];
module.exports = config;

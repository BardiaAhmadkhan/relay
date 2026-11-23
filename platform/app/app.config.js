// The archived offline Android experiment can still be reproduced explicitly.
module.exports = ({ config }) => {
  if (process.env.RELAY_MOBILE_PROFILE === 'offline') return config;
  const android = config.android;
  const event = process.env.RELAY_MOBILE_PROFILE === 'event';
  return {
    ...config,
    name: event ? 'Relay Field Desk' : config.name,
    version: event ? '4.0.0' : '3.5.0',
    ios: { ...config.ios, ...(event ? { bundleIdentifier:'ca.relaygearlab.fielddesk',infoPlist:{...config.ios.infoPlist,NSLocalNetworkUsageDescription:'Connect to your Relay inspection desk.'} } : {}), buildNumber: event ? '4' : '3' },
    android: {
      ...android,
      ...(event ? {package:'ca.relaygearlab.fielddesk'} : {}),
      versionCode: event ? 4 : 3,
      permissions: [...new Set([...(android.permissions || []), 'android.permission.INTERNET'])],
      blockedPermissions: (android.blockedPermissions || []).filter(
        (p) => p !== 'android.permission.INTERNET',
      ),
    },
    plugins: (config.plugins || []).map((plugin) => {
      if (Array.isArray(plugin) && plugin[0] === 'expo-camera')
        return [plugin[0], { ...plugin[1], barcodeScannerEnabled: false }];
      return plugin === './plugins/with-offline-vision.cjs'
        ? './plugins/with-local-network.cjs'
        : plugin;
    }),
  };
};

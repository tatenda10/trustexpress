const appJson = require('./app.json');
const TRUST_OVERLAY_PLUGIN = './plugins/withTrustOverlay';

function hasPlugin(plugins, pluginName) {
  return plugins.some((plugin) => {
    if (Array.isArray(plugin)) return plugin[0] === pluginName;
    return plugin === pluginName;
  });
}

module.exports = ({ config } = {}) => {
  const expo = config || appJson.expo || {};
  const projectId = expo.extra?.eas?.projectId || 'ea348ba3-a2a2-4924-882c-6fbc5eb8384c';
  const basePlugins = expo.plugins || [];

  return {
    ...expo,
    plugins: hasPlugin(basePlugins, TRUST_OVERLAY_PLUGIN)
      ? basePlugins
      : [...basePlugins, TRUST_OVERLAY_PLUGIN],
    updates: {
      ...(expo.updates || {}),
      url: `https://u.expo.dev/${projectId}`,
    },
    ios: {
      ...(expo.ios || {}),
      infoPlist: {
        ...((expo.ios || {}).infoPlist || {}),
        ITSAppUsesNonExemptEncryption: false,
        NSSpeechRecognitionUsageDescription:
          'Allow $(PRODUCT_NAME) to convert your speech into text when using voice features in the app.',
      },
    },
    android: {
      ...(expo.android || {}),
      permissions: [
        ...(expo.android?.permissions || []),
        'android.permission.SYSTEM_ALERT_WINDOW',
      ],
    },
  };
};

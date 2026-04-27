const appJson = require('./app.json');

const ANDROID_GOOGLE_MAPS_API_KEY = process.env.ANDROID_GOOGLE_MAPS_API_KEY || 'AIzaSyALiawY2GIvcMYuW6EIfKqqc2f8vdGdSsw';
const IOS_GOOGLE_MAPS_API_KEY = process.env.IOS_GOOGLE_MAPS_API_KEY || 'AIzaSyAFvd2lhakPBSdDoBw8rVlA2Q4HcUnLSIc';
const GOOGLE_MAPS_DIRECTIONS_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_DIRECTIONS_API_KEY ||
  process.env.ANDROID_GOOGLE_MAPS_API_KEY ||
  ANDROID_GOOGLE_MAPS_API_KEY;
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
      config: {
        ...((expo.ios || {}).config || {}),
        googleMapsApiKey: IOS_GOOGLE_MAPS_API_KEY,
      },
    },
    android: {
      ...(expo.android || {}),
      permissions: [
        ...(expo.android?.permissions || []),
        'android.permission.SYSTEM_ALERT_WINDOW',
      ],
      config: {
        ...((expo.android || {}).config || {}),
        googleMaps: {
          ...(((expo.android || {}).config || {}).googleMaps || {}),
          apiKey: ANDROID_GOOGLE_MAPS_API_KEY,
        },
      },
    },
    extra: {
      ...(expo.extra || {}),
      googleMapsDirectionsApiKey: GOOGLE_MAPS_DIRECTIONS_API_KEY,
    },
  };
};

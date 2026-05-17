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
        NSCameraUsageDescription:
          'Trust Express uses the camera so passengers and drivers can take verification and vehicle photos. For example, a driver may take a photo of their car or a selfie with their national ID for account review.',
        NSPhotoLibraryUsageDescription:
          'Trust Express uses your photo library so you can choose existing verification, profile, document, or vehicle photos to upload. For example, a driver may select saved car photos or a passenger may choose an ID image for verification.',
        NSPhotoLibraryAddUsageDescription:
          'Trust Express may save generated ride documents or receipts to your photo library when you choose to export them. For example, you can save a trip receipt image for your records.',
        NSLocationWhenInUseUsageDescription:
          'Trust Express uses your location while the app is open to set pickup points, find nearby drivers, and show live ride progress. For example, passengers can use their current location as pickup and drivers can share their live position during an active trip.',
        NSLocationAlwaysAndWhenInUseUsageDescription:
          'Trust Express uses location during active driver sessions to keep trips updated and help passengers see driver progress. For example, when a driver is online or on a ride, their location helps calculate arrival time and update the passenger map.',
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

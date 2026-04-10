const appJson = require('./app.json');

const ANDROID_GOOGLE_MAPS_API_KEY = process.env.ANDROID_GOOGLE_MAPS_API_KEY || 'AIzaSyALiawY2GIvcMYuW6EIfKqqc2f8vdGdSsw';
const IOS_GOOGLE_MAPS_API_KEY = process.env.IOS_GOOGLE_MAPS_API_KEY || 'AIzaSyAFvd2lhakPBSdDoBw8rVlA2Q4HcUnLSIc';
const GOOGLE_MAPS_DIRECTIONS_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_DIRECTIONS_API_KEY ||
  process.env.ANDROID_GOOGLE_MAPS_API_KEY ||
  ANDROID_GOOGLE_MAPS_API_KEY;

module.exports = () => {
  const expo = appJson.expo || {};
  const projectId = expo.extra?.eas?.projectId || 'ea348ba3-a2a2-4924-882c-6fbc5eb8384c';

  return {
    ...expo,
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

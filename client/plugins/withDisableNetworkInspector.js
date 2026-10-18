const { withGradleProperties } = require('@expo/config-plugins');

const PROPERTY_KEY = 'EX_DEV_CLIENT_NETWORK_INSPECTOR';

// The dev-client network inspector copies every request/response into memory and
// crashes long ride sessions (frequent polling) with OutOfMemoryError on Android.
module.exports = function withDisableNetworkInspector(config) {
  return withGradleProperties(config, (gradleConfig) => {
    gradleConfig.modResults = gradleConfig.modResults.filter(
      (item) => !(item.type === 'property' && item.key === PROPERTY_KEY)
    );
    gradleConfig.modResults.push({ type: 'property', key: PROPERTY_KEY, value: 'false' });
    return gradleConfig;
  });
};

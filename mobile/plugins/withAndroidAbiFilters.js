const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Expo Config Plugin to inject an ndk.abiFilters block into the Android build.gradle
 * to restrict the architectures built in the APK (shrinking it dramatically).
 */
module.exports = function withAndroidAbiFilters(config, architectures = ["arm64-v8a"]) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      let contents = config.modResults.contents;
      
      // Look for the defaultConfig block
      const defaultConfigRegex = /(defaultConfig\s*\{)([^}]*)/;
      const match = contents.match(defaultConfigRegex);
      
      if (match) {
        // Build the abiFilters string: e.g. abiFilters "arm64-v8a", "armeabi-v7a"
        const abiString = architectures.map(arch => `"${arch}"`).join(', ');
        const ndkBlock = `\n        ndk {\n            abiFilters ${abiString}\n        }`;
        
        // If ndk block already exists, this might be tricky, but usually it doesn't in default Expo setups.
        if (!contents.includes('abiFilters')) {
          contents = contents.replace(defaultConfigRegex, `$1${ndkBlock}$2`);
        }
      }
      
      config.modResults.contents = contents;
    }
    return config;
  });
};

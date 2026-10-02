const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Expo Config Plugin to inject an ndk.abiFilters block into the Android build.gradle
 * to restrict the architectures built in the APK (shrinking it dramatically).
 */
module.exports = function withAndroidAbiFilters(config, props = ["arm64-v8a", "armeabi-v7a", "x86_64", "x86"]) {
  const architectures = Array.isArray(props)
    ? props
    : (props && Array.isArray(props.architectures))
      ? props.architectures
      : ["arm64-v8a", "armeabi-v7a", "x86_64", "x86"];

  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      let contents = config.modResults.contents;
      
      // Look for the defaultConfig block
      const defaultConfigRegex = /(defaultConfig\s*\{)([^}]*)/;
      const match = contents.match(defaultConfigRegex);
      
      if (match) {
        // Build the abiFilters string: e.g. abiFilters "arm64-v8a", "armeabi-v7a", "x86_64", "x86"
        const abiString = architectures.map(arch => `"${arch}"`).join(', ');
        const ndkBlock = `\n        ndk {\n            abiFilters ${abiString}\n        }`;
        
        if (contents.includes('abiFilters')) {
          contents = contents.replace(/ndk\s*\{\s*abiFilters[^}]*\}/g, `ndk {\n            abiFilters ${abiString}\n        }`);
        } else {
          contents = contents.replace(defaultConfigRegex, `$1${ndkBlock}$2`);
        }
      }
      
      config.modResults.contents = contents;
    }
    return config;
  });
};

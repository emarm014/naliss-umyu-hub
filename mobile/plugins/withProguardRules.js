const { withAppBuildGradle } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo Config Plugin to inject ProGuard keep rules for native modules
 * that are required at runtime but get stripped by R8/ProGuard during
 * release builds.
 *
 * Without these rules, the following modules silently crash or freeze:
 *  - react-native-pdf (PDF rendering in UniversalViewer)
 *  - react-native-blob-util (file downloads)
 *  - expo-file-system FileProvider (content:// URI generation)
 *  - expo-intent-launcher (opening files in external apps)
 *  - react-native-webview (Google/Microsoft PDF viewer engines)
 */
module.exports = function withProguardRules(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      const projectRoot = config.modRequest.projectRoot;
      const proguardPath = path.join(projectRoot, 'android', 'app', 'proguard-rules.pro');

      // Write the proguard-rules.pro file with keep rules for all native modules
      const rules = `
# ============================================================================
# NALISS ProGuard Keep Rules
# Prevents R8/ProGuard from stripping native classes required at runtime.
# Without these, the app silently freezes when opening PDFs, images, or docs.
# ============================================================================

# react-native-pdf — native PDF renderer
-keep class com.github.nicknmejia.** { *; }
-keep class org.pdflib.** { *; }
-keep class com.github.nicknmejia.react_native_pdf.** { *; }
-keep class org.pdflib.pdf.** { *; }
-keep class com.artifex.mupdf.** { *; }
-keep class com.shockwave.** { *; }
-dontwarn com.github.nicknmejia.**
-dontwarn com.shockwave.**

# react-native-blob-util — file download engine
-keep class com.RNFetchBlob.** { *; }
-keep class com.ReactNativeBlobUtil.** { *; }
-dontwarn com.RNFetchBlob.**
-dontwarn com.ReactNativeBlobUtil.**

# expo-file-system — FileProvider for content:// URIs
-keep class expo.modules.filesystem.** { *; }
-keep class androidx.core.content.FileProvider { *; }
-keep class * extends androidx.core.content.FileProvider { *; }
-dontwarn expo.modules.filesystem.**

# expo-intent-launcher — opening files in external apps
-keep class expo.modules.intentlauncher.** { *; }
-dontwarn expo.modules.intentlauncher.**

# react-native-webview — Google/Microsoft PDF viewer engines
-keep class com.reactnativecommunity.webview.** { *; }
-dontwarn com.reactnativecommunity.webview.**

# expo-av — video/audio player
-keep class expo.modules.av.** { *; }
-dontwarn expo.modules.av.**

# expo-sharing — share sheet
-keep class expo.modules.sharing.** { *; }
-dontwarn expo.modules.sharing.**

# react-native-gesture-handler — critical for touch interactions
-keep class com.swmansion.gesturehandler.** { *; }
-dontwarn com.swmansion.gesturehandler.**

# react-native-reanimated — critical for animations
-keep class com.swmansion.reanimated.** { *; }
-dontwarn com.swmansion.reanimated.**

# Hermes engine — don't strip reflection used by native modules
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-dontwarn com.facebook.hermes.**

# Keep all native module registrations
-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod *;
}
-keep class * extends com.facebook.react.bridge.NativeModule { *; }
-keep class * extends com.facebook.react.bridge.JavaScriptModule { *; }

# Prevent stripping of Sentry native bridge
-keep class io.sentry.** { *; }
-dontwarn io.sentry.**
`;

      // Ensure the android/app directory exists before writing
      const androidAppDir = path.dirname(proguardPath);
      if (!fs.existsSync(androidAppDir)) {
        fs.mkdirSync(androidAppDir, { recursive: true });
      }
      fs.writeFileSync(proguardPath, rules.trim() + '\\n');

      // Add the proguard file reference to build.gradle if not already present
      if (!config.modResults.contents.includes('proguard-rules.pro')) {
        config.modResults.contents = config.modResults.contents.replace(
          /(buildTypes\s*\{[\s\S]*?release\s*\{)/,
          `$1\n            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'`
        );
      }
    }
    return config;
  });
};
`, "Description": "FREEZE-5: Created an Expo config plugin that generates comprehensive ProGuard keep rules for all native modules used in the app. This prevents R8/ProGuard from stripping classes that are required at runtime — the most likely cause of the 'works in dev but freezes in EAS build' behavior.", "Overwrite": false, "TargetFile": "c:\\Users\\Emerm\\Desktop\\naliss-umyu-hub\\mobile\\plugins\\withProguardRules.js", "toolAction": "Creating ProGuard plugin", "toolSummary": "ProGuard keep rules plugin"}

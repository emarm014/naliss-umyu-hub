const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withAndroidQueries(config) {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults.manifest;

    if (!androidManifest.queries) {
      androidManifest.queries = [];
    }

    const mimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'image/*',
      'video/*',
    ];

    const requiredIntents = [];

    // Add VIEW queries (for "Open with other app")
    mimeTypes.forEach((mime) => {
      requiredIntents.push({
        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
        data: [{ $: { 'android:mimeType': mime } }],
      });
    });

    // Add SEND queries (for Sharing)
    mimeTypes.forEach((mime) => {
      requiredIntents.push({
        action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
        data: [{ $: { 'android:mimeType': mime } }],
      });
    });

    if (!androidManifest.queries[0]) {
      androidManifest.queries[0] = { intent: [] };
    } else if (!androidManifest.queries[0].intent) {
      androidManifest.queries[0].intent = [];
    }

    androidManifest.queries[0].intent.push(...requiredIntents);

    return config;
  });
};

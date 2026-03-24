/* eslint-env node */
/**
 * Merges `app.json` with runtime `extra` so the API base is always available via expo-constants.
 * Set `EXPO_PUBLIC_API_URL` in `.env` (e.g. LAN IP for a physical device).
 */
const appJson = require('./app.json');

module.exports = {
  expo: {
    ...appJson.expo,
    android: {
      ...appJson.expo.android,
      // Dev API over http://127.0.0.1 — required on Android 9+ unless you use HTTPS.
      usesCleartextTraffic: true,
    },
    extra: {
      ...(appJson.expo.extra || {}),
      apiUrl: process.env.EXPO_PUBLIC_API_URL || 'http://127.0.0.1:8000',
    },
  },
};

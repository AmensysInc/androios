/* eslint-env node */
/**
 * Merges `app.json` with runtime `extra` so the API base is always available via expo-constants.
 *
 * Production (same DB as web): set EXPO_PUBLIC_API_URL to your deployed Django origin
 * (HTTPS), matching what the web app uses for API calls — the app never talks to the
 * database directly. See `.env.example`.
 *
 * Local dev: `.env` with LAN IP or http://127.0.0.1:8000 (physical device → PC LAN IP).
 */
const appJson = require('./app.json');

module.exports = {
  expo: {
    owner: 'vijayamensys',
    ...appJson.expo,
    android: {
      ...appJson.expo.android,
      // Dev API over http://127.0.0.1 — required on Android 9+ unless you use HTTPS.
      usesCleartextTraffic: true,
    },
    extra: {
      ...(appJson.expo.extra || {}),
      apiUrl: process.env.EXPO_PUBLIC_API_URL || 'http://127.0.0.1:8000',
      eas: {
        projectId: '2af19790-f143-4434-a376-ad0c3ba951d1',
      },
    },
  },
};

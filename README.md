# Androios Frontend (Zeno Time Flow – iOS & Android)

Full Zeno Time Flow app for **iOS**, **Android**, and **tablet**. Same backend as the web app; UI built for mobile/tablet.

## Setup

1. **Install dependencies**
   ```bash
   cd androios-frontend
   npm install
   ```

2. **Configure API URL**  
   Default matches a Django dev server on **port 8000** at **`http://127.0.0.1:8000`** (the `/api` prefix is applied automatically). Override with `.env` if needed:
   ```bash
   EXPO_PUBLIC_API_URL=http://127.0.0.1:8000
   ```
   - **Android emulator:** the app maps `127.0.0.1` / `localhost` to **`10.0.2.2`** automatically when not on a physical device. You can still set `EXPO_PUBLIC_API_URL` explicitly.
   - **Physical phone/tablet:** set your PC’s LAN IP, e.g. `http://192.168.1.x:8000` (backend can stay bound to `0.0.0.0:8000`).
   - **Web (`expo start --web`):** requests use **same-origin `/api`**; **`metro.config.js`** proxies `/api` → Django (default `http://127.0.0.1:8000`), so you avoid CORS in dev. Override proxy target with **`EXPO_PUBLIC_PROXY_BACKEND`**. If you set **`EXPO_PUBLIC_API_URL`** to a full URL on web, the app calls that URL directly and the backend must send **`Access-Control-Allow-Origin`** for your Expo origin (e.g. `http://localhost:8082`).

The API base is also set in **`app.config.js`** (`expo.extra.apiUrl`) so it matches the backend without relying only on Metro env inlining. **Restart Metro** after changing `.env` or `app.config.js`.

3. **Assets**  
   Add to `assets/`:
   - `icon.png` – app icon (1024x1024)
   - `splash-icon.png` – splash screen
   - `adaptive-icon.png` – Android adaptive icon (1024x1024)
   - `favicon.png` – web favicon (optional)

   Or copy from `Zenotimeflow-frontend/mobile/assets` if available.

## Run

Default scripts use **`expo start --offline`** so Metro starts even when `api.expo.dev` is unreachable (VPN, proxy, firewall, or flaky DNS). Use **`npm run start:online`** when you have a normal internet connection and want Expo’s dependency checks against the registry.

- **Start dev server:** `npm start` or `npm run expo` (same as `expo start --offline`).
- **Do not** use plain `npx expo start` unless you are online; it calls Expo’s API first and can fail with **`TypeError: fetch failed`**. If you prefer `npx`, use: `npx expo start --offline`.
- **iOS:** `npm run ios`
- **Android:** `npm run android`
- **Web:** `npm run web`

## Structure

- **Auth:** Sign in + Admin sign in (same API as web).
- **Main app:** Drawer with role-based menu:
  - **All:** Home, Calendar, Tasks, Focus Hours, Daily Routines, User Management, Check lists, Clock In, Account.
  - **Super Admin / Admin:** Super Admin Dashboard, Scheduler (Companies, Schedule, Employees, Time Clock, Employee Schedule, Missed Shifts).
  - **Operations Manager:** Organization Dashboard + Scheduler.
  - **Manager:** Company Dashboard + Scheduler.
  - **Employee / House Keeping / Maintenance:** My Dashboard.

Screens are placeholders that use the **same backend APIs** as the web app. Replace each placeholder with full UI as needed.

## Backend

Uses existing **Zenotimeflow-backend**. No backend changes required.

# Androios Frontend (Zeno Time Flow – iOS & Android)

Full Zeno Time Flow app for **iOS**, **Android**, and **tablet**. Same backend as the web app; UI built for mobile/tablet.

## Setup

1. **Install dependencies**
   ```bash
   cd androios-frontend
   npm install
   ```

2. **Configure API URL**  
   Create `.env` (or set in app config):
   ```bash
   EXPO_PUBLIC_API_URL=http://localhost:8085/api
   ```
   Use your backend URL for dev/production.

3. **Assets**  
   Add to `assets/`:
   - `icon.png` – app icon (1024x1024)
   - `splash-icon.png` – splash screen
   - `adaptive-icon.png` – Android adaptive icon (1024x1024)
   - `favicon.png` – web favicon (optional)

   Or copy from `Zenotimeflow-frontend/mobile/assets` if available.

## Run

- **iOS:** `npm run ios`
- **Android:** `npm run android`
- **Web:** `npm run web`

## Structure

- **Auth:** Sign in + Admin sign in (same API as web).
- **Main app:** Drawer with role-based menu:
  - **All:** Home, Calendar, Tasks, Focus Hours, Daily Routines, User Management, Templates, Clock In, Account, Profile.
  - **Super Admin / Admin:** Super Admin Dashboard, Scheduler (Companies, Schedule, Employees, Time Clock, Employee Schedule, Missed Shifts).
  - **Operations Manager:** Organization Dashboard + Scheduler.
  - **Manager:** Company Dashboard + Scheduler.
  - **Employee / House Keeping / Maintenance:** My Dashboard.

Screens are placeholders that use the **same backend APIs** as the web app. Replace each placeholder with full UI as needed.

## Backend

Uses existing **Zenotimeflow-backend**. No backend changes required.

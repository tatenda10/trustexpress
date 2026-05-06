# Trust Express Project Handoff

Prepared: 2026-05-02

This document is for the next developer taking over the Trust Express ride-hailing project. It explains what to hand over, how to run each part of the app, what recently changed, and what still needs attention.

## First: Security Warning

Do not hand over raw secrets inside chat, screenshots, or committed files.

Before another developer starts, rotate any credentials that were exposed during development, especially:

- Google Maps API keys
- Firebase Admin service account JSON/private keys
- Clerk secret keys
- Database passwords
- EAS/Apple/Google Play credentials if they were shared outside the normal account systems

Use environment variables and secure account access instead of sending secret values directly.

## What To Give The Developer

Give them access to:

- Git repository access.
- Expo/EAS project access.
- Google Play Console access.
- Apple Developer/App Store Connect access if they will handle iOS.
- Google Cloud project access for Maps, Places, Directions, billing, and API key restrictions.
- Firebase project access for FCM and service accounts.
- Clerk dashboard access.
- Production server/SSH access.
- Production database access or a sanitized database dump.
- Domain/DNS access for the API host.
- Admin dashboard login or an admin bootstrap method.

Give them these documents/files:

- This `PROJECT_HANDOFF.md`.
- `USER_FLOWS.md`.
- `WORK_PLAN.md`.
- `.env.example` files.
- A private, secure copy of required production env values.
- Recent production logs if debugging is ongoing.

Do not give them committed Firebase service account JSON files. Move those to secure secret storage and reference them through env variables.

## Repo Structure

```text
app/
  client/   Expo React Native passenger/driver mobile app
  server/   Node.js Express API, MySQL, Socket.IO, Firebase Admin, Clerk
  admin/    Vite React admin dashboard
  agent/    Agent-related app/workspace
```

Important files:

- `client/api.js` - mobile API base URL and API helper functions.
- `client/App.js` - app routing, auth, push token setup, background overlay orchestration.
- `client/app.config.js` - Expo config and native plugin config.
- `client/plugins/withTrustOverlay.js` - Android native overlay config plugin.
- `client/services/tripOverlay.js` - JS bridge helpers for Android overlay.
- `server/index.js` - Express and Socket.IO server startup.
- `server/routes/rides.js` - passenger ride requests, driver selection, trip state.
- `server/routes/drivers.js` - driver status, vehicle/profile flows, driver ride requests.
- `server/routes/maps.js` - backend Google Directions and Places proxy endpoints.
- `server/lib/google-directions.js` - cached Google Directions calls.
- `server/lib/google-places.js` - cached Google Places calls.
- `server/lib/push.js` - Expo/FCM notification sending.
- `admin/src/context/Api.jsx` - admin API base URL.

## Current Working Tree

At handoff time these files have uncommitted changes:

```text
client/App.js
client/screens/driver/DriverHomeScreen.js
client/screens/driver/DriverTripScreen.js
client/screens/passenger/PassengerHomeScreen.js
client/screens/passenger/PassengerNearbyCarsScreen.js
client/screens/passenger/PassengerRideTrackingScreen.js
client/screens/shared/RideChatScreen.js
```

The next developer should run `git status --short` first and review these changes before adding more work.

## Local Setup

Install dependencies separately in each app:

```bash
cd server
npm install

cd ../client
npm install

cd ../admin
npm install
```

Start the backend:

```bash
cd server
npm run dev
```

Start the mobile app with the Expo dev client:

```bash
cd client
npx expo start --dev-client --clear
```

Start the admin dashboard:

```bash
cd admin
npm run dev
```

## Environment Variables

Use secure values. Do not commit real `.env` files.

Server env:

```bash
PORT=
DB_HOST=
DB_PORT=
DB_USER=
DB_PASSWORD=
DB_NAME=
CLERK_SECRET_KEY=
GOOGLE_MAPS_DIRECTIONS_API_KEY=
GOOGLE_MAPS_PLACES_API_KEY=
GOOGLE_APPLICATION_CREDENTIALS=
FIREBASE_SERVICE_ACCOUNT_JSON=
```

Client env:

```bash
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=
ANDROID_GOOGLE_MAPS_API_KEY=
IOS_GOOGLE_MAPS_API_KEY=
EXPO_PUBLIC_GOOGLE_MAPS_DIRECTIONS_API_KEY=
```

Admin env:

```bash
VITE_GOOGLE_MAPS_API_KEY=
VITE_BASE_URL=
```

Notes:

- `client/api.js` currently has a hard-coded production API base URL.
- `admin/src/context/Api.jsx` also has a hard-coded production API base URL.
- A future cleanup should move these fully into env-based config for dev/staging/prod.

## Google Maps And Cost Controls

The project has been moved toward server-side Google API usage so requests can be cached and rate-limited.

Current intended flow:

- Client calls the backend instead of Google directly for Directions and Places search.
- Directions calls go through `POST /api/maps/directions`.
- Places autocomplete goes through `POST /api/maps/places/autocomplete`.
- Place details goes through `POST /api/maps/places/details`.
- Passenger search should wait for at least 3 characters and use a 700ms debounce.
- Place Details should only be called after the passenger taps a suggestion.
- Passenger ride pricing should use road distance from Directions, not straight-line distance.
- Driver live route refresh should be distance-gated to avoid excessive Directions calls.

Google API key restriction reminder:

- Server-side Directions and Places keys should be restricted by the production server public IP.
- Mobile Google Maps keys should be restricted by Android package/SHA and iOS bundle ID.
- If the server log says `This IP, site or mobile application is not authorized`, the server key restriction does not include the current server IP, or the wrong key is being used by the server.

## Android Overlay And Notifications

The Android floating overlay is custom native functionality.

Key files:

- `client/plugins/withTrustOverlay.js`
- `client/services/tripOverlay.js`
- `client/App.js`

Important behavior:

- Native overlay changes require a new dev/prod build. A Metro reload is not enough for native plugin/Java/Kotlin changes.
- JS-only overlay logic changes can update through Metro or EAS Update.
- Overlay should only appear when the driver is online and the app is actually backgrounded.
- Recent work tried to reduce overlay blinking caused by rapid `AppState` background/active changes.
- If blinking continues, inspect `AppState` handling in `client/App.js` and any component calling `showTripOverlay`, `updateTripOverlay`, or `hideTripOverlay`.

FCM note:

- Do not send `fullScreenIntent` inside `message.android.notification`; Firebase Admin rejects it as an invalid payload.
- Use normal push data plus app/native handling for the full-screen or overlay experience.

## Main Ride Flow

Passenger:

1. Passenger selects pickup/dropoff.
2. Passenger chooses a vehicle tier.
3. Backend checks active ride state.
4. Backend calculates authoritative route distance through Directions.
5. Nearby drivers are notified.
6. Passenger sees driver options or tracking.
7. During pickup, passenger should see driver ETA/distance.
8. After driver arrival, passenger gets a pickup wait window, currently planned as 5 minutes.

Driver:

1. Driver goes online.
2. Driver receives ride request notification/overlay.
3. Driver accepts.
4. Driver trip screen routes to passenger pickup first.
5. After pickup/on-trip state, route changes to dropoff.
6. Driver completes the trip.

## Database And Migrations

The server uses MySQL.

Important migration scripts:

```bash
cd server
npm run db:migrate:admin
npm run db:migrate:rbac
npm run db:migrate:pricing
npm run db:migrate:vehicle-tiers
npm run db:migrate:rides
npm run db:migrate:ride-responses
npm run db:migrate:ride-ratings
npm run db:migrate:ride-route-actuals
```

Seed/support scripts:

```bash
npm run vehicle-tiers:seed
npm run pricing-tiers:seed-missing
npm run admin:bootstrap:db
```

Before running migrations on production, back up the database.

## Build And Release Commands

Android development build:

```bash
cd client
eas build --platform android --profile development
```

Android production build:

```bash
cd client
eas build --platform android --profile production
```

Submit latest Android production build:

```bash
cd client
eas submit --platform android --latest --profile production
```

iOS production build:

```bash
cd client
eas build --platform ios --profile production
```

Submit latest iOS production build:

```bash
cd client
eas submit --platform ios --latest --profile production
```

EAS update for JS-only production changes:

```bash
cd client
eas update --channel production --message "Describe the change"
```

Server deployment example:

```bash
cd server
npm install
pm2 restart trustexpress --update-env
```

## Checks To Run

Backend syntax checks:

```bash
cd server
node --check index.js
node --check routes/rides.js
node --check routes/drivers.js
node --check routes/maps.js
node --check lib/google-directions.js
node --check lib/google-places.js
node --check lib/push.js
```

Admin build/lint:

```bash
cd admin
npm run lint
npm run build
```

Expo project check:

```bash
cd client
npx expo-doctor
```

There is no complete automated test suite configured yet. Manual testing is still important.

## Known Issues And Follow Ups

High priority:

- Rotate exposed secrets and remove any service account JSON files from the repo.
- Confirm Google server keys are correctly IP-restricted and enabled for Directions and Places.
- Review the current uncommitted files before continuing.
- Test Android overlay behavior on a physical device after a fresh dev build.
- Confirm passenger tracking modal behavior. The latest requested UI direction was:
  - remove the "You are on a ride" card;
  - remove directions from the modal;
  - make the modal scrollable;
  - keep safe-area handling correct.

Medium priority:

- Reduce noisy logs in `App.js`, `DriverHomeScreen`, and tracking screens once debugging is done.
- Move mobile/admin base URLs to environment config instead of hard-coded production URLs.
- Add basic automated tests for ride state transitions and server route calculation.
- Add admin observability for Google Directions/Places request counts and cache hit rates.
- Confirm passenger and driver screens show road distance consistently, not straight-line distance.

Lower priority:

- Clean up deprecated React Native Firebase namespaced API warnings.
- Improve staging/prod release documentation.
- Add a sanitized demo database seed for onboarding.

## Manual Test Checklist

Passenger:

- Sign in.
- Search destination with 3+ characters.
- Select autocomplete suggestion.
- Confirm estimated distance/fare uses road route.
- Request ride.
- Try requesting another ride while active and confirm recovery/navigation works.
- Track driver on map.
- Confirm pickup and ride completion flow.

Driver:

- Sign in as approved driver.
- Go online.
- Background the app and confirm overlay appears once.
- Bring app foreground and confirm overlay hides.
- Receive ride request and confirm overlay request state changes.
- Accept ride.
- Confirm route first targets passenger pickup.
- Mark arrived and check passenger pickup countdown behavior.
- Start/complete trip.

Admin:

- Log in.
- Review drivers and vehicle documents.
- View live map and ride operations.
- Confirm maps render when `VITE_GOOGLE_MAPS_API_KEY` is set.

## Production Notes

Production API host currently used by the apps:

```text
https://ridehailcarsserver.online
```

Server logs previously referenced PM2 app name:

```text
trustexpress
```

Useful log command on the server:

```bash
pm2 logs trustexpress --lines 100
```

Before handing over production, make sure the next developer knows:

- Which branch is deployed.
- Which EAS channel is live.
- Which server hosts the API.
- Which database is production.
- Which Google Cloud project owns billing.
- Which Firebase project owns FCM.
- Which Clerk application is production.

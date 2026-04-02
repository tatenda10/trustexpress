# Phone auth: install modules, EAS dev build, Firebase setup

## 1. Install modules

### Server (backend)
```bash
cd server
npm install
```
This installs `firebase-admin` (and other deps). No extra step.

### Client (Expo app)
```bash
cd client
npm install
```
This installs `@react-native-firebase/auth` (and other deps). You already have `@react-native-firebase/app` and messaging; auth is added for phone verification.

---

## 2. EAS development build

React Native Firebase (including phone auth) does **not** run in Expo Go. You need a **development build**.

### Prerequisites
- [EAS CLI](https://docs.expo.dev/build/setup/): `npm install -g eas-cli`
- Log in: `eas login`
- Firebase config files in place (see section 3) **before** building, so the native apps are configured.

### Build commands
From the **client** directory:

```bash
cd client
```

**Android (development build):**
```bash
eas build --profile development --platform android
```

**iOS (development build):**
```bash
eas build --profile development --platform ios
```

**Both:**
```bash
eas build --profile development --platform all
```

Your `eas.json` already has a `development` profile with `developmentClient: true` and `distribution: internal`. After the build finishes, install the built app on your device (download from the EAS build page or scan QR for internal distribution). Then run:

```bash
npx expo start
```

Choose “open in development build” (or open the dev client app and connect to the same network). The dev client loads your JS bundle; phone auth will use the native Firebase Auth SDK baked into that build.

---

## 3. Firebase setup

### 3.1 Create / use a Firebase project
1. Go to [Firebase Console](https://console.firebase.google.com/).
2. Create a project (or select the one you already use for Trust Express).
3. If needed, add an **Android** and/or **iOS** app (see below). Use the same package name as in your Expo app: **Android** `com.tatenda10.trustexpress`, **iOS** use the bundle ID from your Expo config.

### 3.2 Enable Phone sign-in
1. In Firebase Console → **Build** → **Authentication**.
2. Open the **Sign-in method** tab.
3. Click **Phone** → **Enable** → **Save**.

### 3.3 Android: `google-services.json`
1. In Firebase Console → Project settings (gear) → **Your apps**.
2. If there’s no Android app: **Add app** → Android → register with package name `com.tatenda10.trustexpress` (and optional SHA-1 for debug/signing).
3. Download **google-services.json**.
4. Put it in the **client** project root (same level as `app.json`):
   ```
   client/
     app.json
     google-services.json   <-- here
   ```
   The `@react-native-firebase/auth` plugin will pick it up when you run a new EAS build. No need to reference it manually in `app.json` if the plugin is in `plugins`.

### 3.4 iOS: `GoogleService-Info.plist`
1. In Firebase Console → Project settings → **Your apps**.
2. If there’s no iOS app: **Add app** → iOS → register with your iOS bundle ID (e.g. from Expo: often `org.name.trustexpress` or similar; check `expo.ios.bundleIdentifier` if set).
3. Download **GoogleService-Info.plist**.
4. Put it in the **client** project root:
   ```
   client/
     app.json
     GoogleService-Info.plist   <-- here
   ```
   Again, the Firebase plugin will use it in the next EAS build.

### 3.5 Backend: Firebase Admin (service account)
The server verifies the Firebase ID token and reads the phone number. It needs a **service account**:

1. Firebase Console → Project settings → **Service accounts**.
2. Click **Generate new private key** (or use an existing service account).
3. Either:
   - **Option A:** Save the JSON file somewhere safe (e.g. `server/config/firebase-service-account.json`) and set in `server/.env`:
     ```env
     GOOGLE_APPLICATION_CREDENTIALS=./config/firebase-service-account.json
     ```
     (Path can be absolute or relative to where you start the server.)
   - **Option B:** Paste the **entire** JSON as one line into `server/.env`:
     ```env
     FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"your-project",...}
     ```
4. Restart the server so it loads the new env.

**Security:** Do **not** commit the JSON file or the `FIREBASE_SERVICE_ACCOUNT_JSON` value to git. Add to `.gitignore` if needed (e.g. `server/config/firebase-service-account.json`).

---

## 4. Quick checklist

| Step | Where | What |
|------|--------|------|
| Install server deps | `server/` | `npm install` |
| Install client deps | `client/` | `npm install` |
| Enable Phone auth | Firebase Console → Authentication | Phone → Enable |
| Android config | `client/google-services.json` | Download from Firebase, place in `client/` |
| iOS config | `client/GoogleService-Info.plist` | Download from Firebase, place in `client/` |
| Service account | `server/.env` | `GOOGLE_APPLICATION_CREDENTIALS` or `FIREBASE_SERVICE_ACCOUNT_JSON` |
| Dev build | `client/` | `eas build --profile development --platform android` (or ios/all) |
| Run app | `client/` | Install dev build, then `npx expo start` |

After this, the driver flow **Documents → Verify phone → Car → Tabs** will use Firebase Phone Auth and your backend confirm endpoint.

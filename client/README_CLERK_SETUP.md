# Clerk Authentication Setup Guide

## Prerequisites

1. Create a Clerk account at https://clerk.com
2. Create a new application in Clerk Dashboard
3. Get your Publishable Key from Clerk Dashboard

## Setup Instructions

### 1. Configure Clerk Publishable Key

Edit `config/clerk.js` and replace `pk_test_your_publishable_key_here` with your actual Clerk publishable key:

```javascript
const CLERK_PUBLISHABLE_KEY = 'pk_test_your_actual_key_here';
```

### 2. Configure OAuth Providers (Optional)

In Clerk Dashboard:
- Go to **User & Authentication** → **Social Connections**
- Enable Google OAuth
- Enable Apple OAuth (for iOS)
- Configure redirect URLs:
  - `trustexpress://oauth-callback`
  - `trustexpress://oauth-callback-complete`

### 3. Configure Phone Number Authentication

In Clerk Dashboard:
- Go to **User & Authentication** → **Phone Numbers**
- Enable phone number authentication
- Configure SMS provider (Twilio recommended)

### 4. Configure Email Authentication

In Clerk Dashboard:
- Go to **User & Authentication** → **Email, Phone, Username**
- Enable email authentication
- Configure email templates if needed

## App Structure

```
client/
├── App.js                    # Main app with Clerk provider and navigation
├── config/
│   └── clerk.js             # Clerk configuration
└── screens/
    ├── RoleSelectionScreen.js
    ├── PassengerWelcomeScreen.js
    ├── PassengerOnboardingScreen.js
    ├── PassengerCreateAccountScreen.js
    ├── PassengerLoginScreen.js
    ├── PassengerEmailSignUpScreen.js
    ├── PassengerPhoneSignUpScreen.js
    ├── PassengerHomeScreen.js
    ├── DriverWelcomeScreen.js
    ├── DriverOnboardingScreen.js
    ├── DriverCreateAccountScreen.js
    ├── DriverLoginScreen.js
    └── DriverHomeScreen.js
```

## User Flow

1. **App Launch** → Role Selection (Passenger/Driver)
2. **Passenger Path:**
   - Get Started → Onboarding → Create Account → Home
   - Login → Login Screen → Home
3. **Driver Path:**
   - Get Started → Onboarding → Create Account → Registration Form → Home
   - Login → Login Screen → Home

## Authentication Methods Supported

- ✅ Google Sign-In
- ✅ Apple Sign-In
- ✅ Email & Password
- ✅ Phone Number (OTP)

## Next Steps

1. Add email verification screen for email sign-up
2. Add driver registration form after account creation
3. Implement user role metadata in Clerk
4. Add password reset flow
5. Add profile screens

## Notes

- Make sure to set up proper deep linking for OAuth redirects
- Configure app.json with proper scheme for OAuth callbacks
- Test all authentication flows before production deployment


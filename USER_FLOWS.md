# Trust Express App - User Flows

## Table of Contents
1. [App Entry & Role Selection](#app-entry--role-selection)
2. [Passenger User Flow](#passenger-user-flow)
   - [Passenger Get Started Flow](#1-passenger-get-started-flow)
   - [Passenger Onboarding](#2-passenger-onboarding-indrive-style)
   - [Passenger Create Account](#3-passenger-create-account)
   - [Passenger Login Flow](#4-passenger-login-flow)
   - [Book a Ride Flow](#5-book-a-ride-flow-no-account-required-initially)
   - [Active Ride Flow](#6-active-ride-flow-passenger)
   - [Wallet Management Flow](#7-wallet-management-flow)
   - [Support & Help Flow](#8-support--help-flow)
3. [Driver User Flow](#driver-user-flow)
   - [Driver Get Started Flow](#1-driver-get-started-flow)
   - [Driver Onboarding](#2-driver-onboarding)
   - [Driver Create Account](#3-driver-create-account)
   - [Driver Login Flow](#4-driver-login-flow)
4. [Common Flows](#common-flows)

---

## App Entry & Role Selection

### Initial App Launch Flow

```
START
  │
  ├─> App Opens
  │   ├─> Splash Screen (App Logo)
  │   └─> Role Selection Screen
  │       │
  │       ├─> Two Options Displayed:
  │       │   │
  │       │   ├─> Option 1: "I'm a Passenger" Button
  │       │   │   └─> Tap "I'm a Passenger"
  │       │   │       │
  │       │   │       └─> Passenger Welcome Screen
  │       │   │           ├─> "Get Started" Button
  │       │   │           └─> "Login" Button
  │       │   │
  │       │   └─> Option 2: "I'm a Driver" Button
  │       │       └─> Tap "I'm a Driver"
  │       │           │
  │       │           └─> Driver Welcome Screen
  │       │               ├─> "Get Started" Button
  │       │               └─> "Login" Button
  │       │
  │       └─> User Makes Selection
  │           │
  │           ├─> Passenger Path
  │           │   ├─> Get Started → Onboarding → Create Account
  │           │   └─> Login → Login Screen
  │           │
  │           └─> Driver Path
  │               ├─> Get Started → Driver Onboarding → Create Account
  │               └─> Login → Driver Login Screen
END
```

---

## Passenger User Flow

### 1. Passenger Get Started Flow

```
START
  │
  ├─> User Selected "I'm a Passenger"
  │
  ├─> Passenger Welcome Screen
  │   ├─> App Logo
  │   ├─> Welcome Message: "Welcome to Trust Express"
  │   ├─> Subtitle: "Book your ride in minutes"
  │   │
  │   ├─> Two Action Buttons:
  │   │   │
  │   │   ├─> Button 1: "Get Started"
  │   │   │   └─> Tap "Get Started"
  │   │   │       │
  │   │   │       └─> Go to Passenger Onboarding Flow
  │   │   │
  │   │   └─> Button 2: "Login"
  │   │       └─> Tap "Login"
  │   │           │
  │   │           └─> Go to Passenger Login Flow
  │   │
  │   └─> User Makes Choice
END
```

### 2. Passenger Onboarding (InDrive Style)

```
START
  │
  ├─> User Tapped "Get Started" (Passenger)
  │
  ├─> Onboarding Screen 1: Welcome
  │   ├─> App Logo
  │   ├─> Tagline: "Trust Express - Your Reliable Ride"
  │   ├─> Key Feature Highlight: "Fixed Prices, No Negotiation"
  │   └─> Swipe Right or Tap "Next" →
  │
  ├─> Onboarding Screen 2: Features
  │   ├─> Icon: GPS Tracking
  │   ├─> Title: "Real-Time Tracking"
  │   ├─> Description: "Track your ride in real-time with live GPS"
  │   └─> Swipe Right or Tap "Next" →
  │
  ├─> Onboarding Screen 3: Pricing
  │   ├─> Icon: Price Tag
  │   ├─> Title: "Transparent Fixed Pricing"
  │   ├─> Description: "Know your fare upfront. No surprises, no negotiation"
  │   └─> Swipe Right or Tap "Next" →
  │
  ├─> Onboarding Screen 4: Safety
  │   ├─> Icon: Shield
  │   ├─> Title: "Safe & Secure"
  │   ├─> Description: "Verified drivers and emergency support"
  │   └─> Tap "Continue" →
  │
  ├─> Location Permission Request
  │   ├─> Message: "Allow Trust Express to access your location?"
  │   ├─> Benefits: "To find nearby drivers and show your pickup location"
  │   ├─> Options:
  │   │   ├─> Allow → Enable GPS Tracking
  │   │   └─> Deny → Show Manual Location Entry Option
  │   │
  │   └─> Notification Permission Request (Optional)
  │       ├─> Message: "Get notified about your ride status?"
  │       └─> Allow/Don't Allow
  │
  └─> Passenger Create Account Screen
END
```

### 3. Passenger Create Account

```
START
  │
  ├─> After Onboarding Complete
  │
  ├─> Create Account Screen
  │   ├─> App Logo
  │   ├─> Title: "Create Your Account"
  │   ├─> Subtitle: "Choose how you'd like to sign up"
  │   │
  │   ├─> Sign-Up Options (Multiple Methods)
  │   │   │
  │   │   ├─> Option 1: Google Sign-In
  │   │   │   └─> Tap "Continue with Google"
  │   │   │       │
  │   │   │       ├─> Google Account Selection
  │   │   │       ├─> Grant Permissions
  │   │   │       └─> Account Created
  │   │   │           │
  │   │   │           └─> Go to Passenger Home Screen
  │   │   │
  │   │   ├─> Option 2: Apple Sign-In
  │   │   │   └─> Tap "Continue with Apple"
  │   │   │       │
  │   │   │       ├─> Apple ID Authentication
  │   │   │       ├─> Grant Permissions
  │   │   │       └─> Account Created
  │   │   │           │
  │   │   │           └─> Go to Passenger Home Screen
  │   │   │
  │   │   ├─> Option 3: Email & Password
  │   │   │   └─> Tap "Continue with Email"
  │   │   │       │
  │   │   │       ├─> Email Input Screen
  │   │   │       │   ├─> Enter Email Address
  │   │   │       │   │
  │   │   │       │   └─> Tap "Continue"
  │   │   │       │       │
  │   │   │       │       ├─> Email Already Registered → Show Error → Go to Login
  │   │   │       │       │
  │   │   │       │       └─> Email Available → Create Password Screen
  │   │   │       │           ├─> Create Password
  │   │   │       │           ├─> Confirm Password
  │   │   │       │           ├─> Optional: Enter Name
  │   │   │       │           └─> Account Created → Passenger Home Screen
  │   │   │       │
  │   │   │       └─> Password Requirements Displayed
  │   │   │
  │   │   └─> Option 4: Phone Number (Primary)
  │   │       └─> Tap "Continue with Phone"
  │   │           │
  │   │           └─> Phone Verification Flow
  │   │               ├─> Enter Phone Number
  │   │               │   ├─> Country Code Selection (Zimbabwe +263)
  │   │               │   └─> Enter Phone Number
  │   │               │
  │   │               └─> Tap "Continue"
  │   │                   │
  │   │                   ├─> System Sends OTP via SMS
  │   │                   │
  │   │                   └─> OTP Verification Screen
  │   │                       ├─> Enter 6-Digit OTP Code
  │   │                       │
  │   │                       └─> Tap "Verify"
  │   │                           │
  │   │                           ├─> Invalid OTP → Show Error → Resend OTP
  │   │                           │
  │   │                           └─> Valid OTP
  │   │                               │
  │   │                               ├─> Phone Already Registered → Show Error → Go to Login
  │   │                               │
  │   │                               └─> Phone Available → Account Created
  │   │                                   ├─> Optional: Enter Name
  │   │                                   └─> Passenger Home Screen
  │   │
  │   └─> "Already have an account? Login" Link
  │       └─> Tap Link → Go to Passenger Login Flow
  │
  └─> Passenger Home Screen
END
```

### 4. Passenger Login Flow

```
START
  │
  ├─> User Selected "I'm a Passenger" → Tapped "Login"
  │
  ├─> Passenger Login Screen
  │   ├─> App Logo
  │   ├─> Title: "Welcome Back"
  │   ├─> Subtitle: "Sign in to your account"
  │   │
  │   ├─> Sign-In Options
  │   │   │
  │   │   ├─> Option 1: Google Sign-In
  │   │   │   └─> Tap "Continue with Google"
  │   │   │       │
  │   │   │       ├─> Select Google Account
  │   │   │       └─> Authenticated → Passenger Home Screen
  │   │   │
  │   │   ├─> Option 2: Apple Sign-In
  │   │   │   └─> Tap "Continue with Apple"
  │   │   │       │
  │   │   │       ├─> Apple ID Authentication
  │   │   │       └─> Authenticated → Passenger Home Screen
  │   │   │
  │   │   ├─> Option 3: Email & Password
  │   │   │   └─> Tap "Continue with Email"
  │   │   │       │
  │   │   │       ├─> Enter Email
  │   │   │       ├─> Enter Password
  │   │   │       │
  │   │   │       └─> Tap "Sign In"
  │   │   │           │
  │   │   │           ├─> Invalid Credentials → Show Error → Retry
  │   │   │           │
  │   │   │           └─> Valid Credentials → Passenger Home Screen
  │   │   │
  │   │   └─> Option 4: Phone Number
  │   │       └─> Tap "Continue with Phone"
  │   │           │
  │   │           ├─> Enter Phone Number
  │   │           ├─> Receive OTP via SMS
  │   │           ├─> Enter OTP Code
  │   │           │
  │   │           └─> Verify OTP
  │   │               │
  │   │               ├─> Invalid OTP → Show Error → Resend
  │   │               │
  │   │               └─> Valid OTP → Passenger Home Screen
  │   │
  │   ├─> "Forgot Password?" Link (for Email login)
  │   │   └─> Password Reset Flow
  │   │
  │   └─> "Don't have an account? Sign Up" Link
  │       └─> Tap Link → Go to Passenger Get Started Flow
  │
  └─> Passenger Home Screen
END
```

### 5. Book a Ride Flow (No Account Required Initially)

```
START
  │
  ├─> Home Screen (Map View)
  │   ├─> Current Location Detected via GPS
  │   │
  │   ├─> Set Pickup Location
  │   │   ├─> Option 1: Use Current Location (Auto-detect)
  │   │   ├─> Option 2: Pin on Map
  │   │   └─> Option 3: Search Address
  │   │
  │   ├─> Set Drop-off Location
  │   │   ├─> Pin on Map
  │   │   └─> Search Address
  │   │
  │   ├─> System Calculates Distance & Route
  │   │
  │   ├─> Select Vehicle Category
  │   │   ├─> Cheap (Base Rate)
  │   │   ├─> Medium (1.5x Base Rate)
  │   │   └─> Expensive (2.0x Base Rate)
  │   │
  │   ├─> System Calculates Fare
  │   │   ├─> Base Price: Distance × Rate × Category Multiplier
  │   │   ├─> Night Pricing (18:00-05:00): +X%
  │   │   ├─> Peak Hour (06:00-09:00, 16:00-19:00): +Y%
  │   │   ├─> Weather Adjustment (if active): +Z%
  │   │   └─> Display Total Fare with Breakdown
  │   │
  │   ├─> Select Payment Method
  │   │   ├─> Cash
  │   │   ├─> EcoCash
  │   │   ├─> Bank Transfer
  │   │   └─> Wallet (if sufficient balance)
  │   │
  │   └─> Tap "Confirm Ride"
  │       │
  │       ├─> User Not Logged In
  │       │   └─> Prompt Phone Verification
  │       │       ├─> Enter Phone Number
  │       │       ├─> Verify OTP
  │       │       └─> Continue to Ride Request
  │       │
  │       ├─> Payment Method = Wallet
  │       │   ├─> Insufficient Balance → Show Top-up Prompt
  │       │   └─> Sufficient Balance → Continue
  │       │
  │       └─> Ride Request Sent
  │           │
  │           ├─> System Matches with Nearest Available Driver
  │           │   ├─> Driver Found → Send Request
  │           │   └─> No Driver Available → Show "No drivers available"
  │           │
  │           └─> Waiting for Driver Response Screen
  │               ├─> Display: "Searching for driver..."
  │               ├─> 30-second timer
  │               │
  │               ├─> Driver Accepts → Ride Confirmed
  │               │   └─> Go to Active Ride Screen
  │               │
  │               └─> Driver Declines or Timeout
  │                   ├─> Show: "Driver declined, searching again..."
  │                   └─> Retry Matching (up to 3 attempts)
END
```

### 6. Active Ride Flow (Passenger)

```
START
  │
  ├─> Ride Confirmed Screen
  │   ├─> Display Driver Details
  │   │   ├─> Driver Photo
  │   │   ├─> Driver Name
  │   │   ├─> Vehicle Model & Plate Number
  │   │   ├─> Driver Rating
  │   │   └─> Estimated Time to Pickup
  │   │
  │   ├─> Live Map View
  │   │   ├─> Passenger Location (Blue Pin)
  │   │   ├─> Driver Location (Red Pin) - Updates every 5 seconds
  │   │   └─> Route to Pickup Location
  │   │
  │   ├─> Action Buttons
  │   │   ├─> Call Driver
  │   │   ├─> Cancel Ride (with cancellation fee if applicable)
  │   │   ├─> Share Trip (send to emergency contact)
  │   │   └─> Emergency/Panic Button
  │   │
  │   └─> Status Updates
  │       │
  │       ├─> Status: "Driver is on the way"
  │       │   └─> Show ETA to Pickup
  │       │
  │       ├─> Status: "Driver has arrived"
  │       │   └─> Show: "Meet your driver at pickup location"
  │       │
  │       └─> Driver Starts Trip
  │           │
  │           └─> Active Trip Screen
  │               ├─> Live GPS Tracking During Trip
  │               │   ├─> Current Location (Updates every 5 seconds)
  │               │   ├─> Route to Destination
  │               │   └─> ETA to Destination
  │               │
  │               ├─> Trip Details
  │               │   ├─> Pickup Location
  │               │   ├─> Drop-off Location
  │               │   ├─> Distance Traveled
  │               │   └─> Locked Fare (cannot change)
  │               │
  │               ├─> Action Buttons
  │               │   ├─> Call Driver
  │               │   ├─> Share Trip
  │               │   └─> Emergency/Panic Button
  │               │
  │               └─> Driver Ends Trip
  │                   │
  │                   └─> Trip Completion Screen
  │                       ├─> Display Final Fare Breakdown
  │                       ├─> Payment Confirmation
  │                       │   ├─> Cash → "Pay driver $X.XX"
  │                       │   ├─> EcoCash → Process Payment
  │                       │   ├─> Bank Transfer → Show Account Details
  │                       │   └─> Wallet → Auto-deduct & Show Receipt
  │                       │
  │                       ├─> Rate Driver Screen
  │                       │   ├─> Star Rating (1-5)
  │                       │   ├─> Optional Feedback Text
  │                       │   └─> Submit Rating
  │                       │
  │                       └─> Return to Home Screen
END
```

### 7. Wallet Management Flow

```
START
  │
  ├─> Navigate to Wallet Screen
  │   ├─> Check if User Logged In
  │   │   ├─> Not Logged In → Prompt Phone Verification
  │   │   └─> Logged In → Continue
  │   │
  │   ├─> Display Current Balance
  │   │
  │   ├─> Top-Up Option
  │   │   └─> Tap "Add Money"
  │   │       │
  │   │       ├─> Enter Amount
  │   │       │
  │   │       ├─> Select Payment Method
  │   │       │   ├─> ZimSwitch (Debit/Credit Card)
  │   │       │   │   └─> Enter Card Details → Process Payment
  │   │       │   │
  │   │       │   ├─> EcoCash
  │   │       │   │   └─> Enter EcoCash Number → Process Payment
  │   │       │   │
  │   │       │   └─> International Card (Visa/MasterCard)
  │   │       │       └─> Enter Card Details → Process Payment
  │   │       │
  │   │       └─> Payment Success
  │       │           ├─> Update Wallet Balance
  │       │           └─> Show Confirmation Message
  │       │
  │   └─> Transaction History
  │       ├─> List All Transactions
  │       │   ├─> Top-ups
  │       │   ├─> Ride Payments
  │       │   └─> Promotional Credits
  │       │
  │       └─> Filter Options
  │           ├─> By Date Range
  │           └─> By Transaction Type
END
```

### 8. Support & Help Flow

```
START
  │
  ├─> Navigate to Support Screen
  │   │
  │   ├─> Live Chat Option
  │   │   └─> Tap "Start Chat"
  │   │       │
  │   │       ├─> Chat Interface Opens
  │   │       ├─> Type Message
  │   │       ├─> Attach Screenshot (optional)
  │   │       └─> Send Message
  │   │           │
  │   │           └─> Support Staff Responds
  │   │               └─> Continue Conversation
  │   │
  │   └─> Create Support Ticket
  │       └─> Tap "New Ticket"
  │           │
  │           ├─> Select Category
  │           │   ├─> Payment Issues
  │           │   ├─> Driver Complaints
  │           │   ├─> Lost Items
  │           │   └─> Technical Issues
  │           │
  │           ├─> Enter Subject
  │           ├─> Enter Description
  │           ├─> Attach Screenshots (optional)
  │           │
  │           └─> Submit Ticket
  │               │
  │               ├─> Ticket Created Successfully
  │               │   ├─> Ticket ID Generated
  │               │   └─> Status: "Open"
  │               │
  │               └─> View Ticket History
  │                   ├─> List All Tickets
  │                   ├─> Filter by Status
  │                   │   ├─> Open
  │                   │   ├─> In Progress
  │                   │   ├─> Resolved
  │                   │   └─> Closed
  │                   │
  │                   └─> View Ticket Details
  │                       ├─> Conversation History
  │                       └─> Status Updates
END
```

---

## Driver User Flow

### 1. Driver Get Started Flow

```
START
  │
  ├─> User Selected "I'm a Driver"
  │
  ├─> Driver Welcome Screen
  │   ├─> App Logo
  │   ├─> Welcome Message: "Welcome to Trust Express Driver"
  │   ├─> Subtitle: "Start earning with verified drivers"
  │   │
  │   ├─> Two Action Buttons:
  │   │   │
  │   │   ├─> Button 1: "Get Started"
  │   │   │   └─> Tap "Get Started"
  │   │   │       │
  │   │   │       └─> Go to Driver Onboarding Flow
  │   │   │
  │   │   └─> Button 2: "Login"
  │   │       └─> Tap "Login"
  │   │           │
  │   │           └─> Go to Driver Login Flow
  │   │
  │   └─> User Makes Choice
END
```

### 2. Driver Onboarding

```
START
  │
  ├─> User Tapped "Get Started" (Driver)
  │
  ├─> Onboarding Screen 1: Welcome
  │   ├─> App Logo
  │   ├─> Tagline: "Drive with Trust Express"
  │   ├─> Key Feature Highlight: "Earn on your schedule"
  │   └─> Swipe Right or Tap "Next" →
  │
  ├─> Onboarding Screen 2: Benefits
  │   ├─> Icon: Money/Dollar
  │   ├─> Title: "Flexible Earnings"
  │   ├─> Description: "Set your own hours and earn competitive rates"
  │   └─> Swipe Right or Tap "Next" →
  │
  ├─> Onboarding Screen 3: Support
  │   ├─> Icon: Support/Help
  │   ├─> Title: "24/7 Support"
  │   ├─> Description: "Get help whenever you need it from our support team"
  │   └─> Swipe Right or Tap "Next" →
  │
  ├─> Onboarding Screen 4: Verification
  │   ├─> Icon: Shield/Checkmark
  │   ├─> Title: "Verified Drivers"
  │   ├─> Description: "Join our community of verified, trusted drivers"
  │   └─> Tap "Continue" →
  │
  ├─> Location Permission Request
  │   ├─> Message: "Allow Trust Express to access your location?"
  │   ├─> Benefits: "To receive ride requests and navigate to passengers"
  │   ├─> Options:
  │   │   ├─> Allow → Enable GPS Tracking
  │   │   └─> Deny → Show Manual Location Entry Option
  │   │
  │   └─> Notification Permission Request (Required for Drivers)
  │       ├─> Message: "Get notified about ride requests?"
  │       └─> Allow (Required) / Don't Allow → Show Warning
  │
  └─> Driver Create Account Screen
END
```

### 3. Driver Create Account

```
START
  │
  ├─> After Driver Onboarding Complete
  │
  ├─> Create Driver Account Screen
  │   ├─> App Logo
  │   ├─> Title: "Create Your Driver Account"
  │   ├─> Subtitle: "Choose how you'd like to sign up"
  │   │
  │   ├─> Sign-Up Options (Multiple Methods)
  │   │   │
  │   │   ├─> Option 1: Google Sign-In
  │   │   │   └─> Tap "Continue with Google"
  │   │   │       │
  │   │   │       ├─> Google Account Selection
  │   │   │       ├─> Grant Permissions
  │   │   │       └─> Go to Driver Registration Form
  │   │   │
  │   │   ├─> Option 2: Apple Sign-In
  │   │   │   └─> Tap "Continue with Apple"
  │   │   │       │
  │   │   │       ├─> Apple ID Authentication
  │   │   │       ├─> Grant Permissions
  │   │   │       └─> Go to Driver Registration Form
  │   │   │
  │   │   ├─> Option 3: Email & Password
  │   │   │   └─> Tap "Continue with Email"
  │   │   │       │
  │   │   │       ├─> Email Input Screen
  │   │   │       │   ├─> Enter Email Address
  │   │   │       │   │
  │   │   │       │   └─> Tap "Continue"
  │   │   │       │       │
  │   │   │       │       ├─> Email Already Registered → Show Error → Go to Login
  │   │   │       │       │
  │   │   │       │       └─> Email Available → Create Password Screen
  │   │   │       │           ├─> Create Password
  │   │   │       │           ├─> Confirm Password
  │   │   │       │           └─> Go to Driver Registration Form
  │   │   │
  │   │   └─> Option 4: Phone Number (Primary)
  │   │       └─> Tap "Continue with Phone"
  │   │           │
  │   │           └─> Phone Verification Flow
  │   │               ├─> Enter Phone Number
  │   │               │   ├─> Country Code Selection (Zimbabwe +263)
  │   │               │   └─> Enter Phone Number
  │   │               │
  │   │               └─> Tap "Continue"
  │   │                   │
  │   │                   ├─> System Sends OTP via SMS
  │   │                   │
  │   │                   └─> OTP Verification Screen
  │   │                       ├─> Enter 6-Digit OTP Code
  │   │                       │
  │   │                       └─> Tap "Verify"
  │   │                           │
  │   │                           ├─> Invalid OTP → Show Error → Resend OTP
  │   │                           │
  │   │                           └─> Valid OTP
  │   │                               │
  │   │                               ├─> Phone Already Registered → Show Error → Go to Login
  │   │                               │
  │   │                               └─> Phone Available → Go to Driver Registration Form
  │   │
  │   └─> "Already have an account? Login" Link
  │       └─> Tap Link → Go to Driver Login Flow
  │
  ├─> Driver Registration Form (After Authentication)
  │   ├─> Step 1: Personal Information
  │   │   ├─> Enter National ID (Format: XX-XXXXXXXZXX)
  │   │   ├─> System validates ID format
  │   │   ├─> Enter Full Legal Name (must match National ID)
  │   │   └─> Capture Selfie Photo
  │   │       ├─> Camera Permission Request
  │   │       ├─> Take Selfie
  │   │       └─> Confirm Photo Quality
  │   │
  │   ├─> Step 2: Vehicle Information
  │   │   ├─> Vehicle Registration Number
  │   │   ├─> Vehicle Make & Model
  │   │   ├─> Vehicle Year
  │   │   ├─> Vehicle Color
  │   │   ├─> Select Vehicle Category
  │   │   │   ├─> Cheap (Economy)
  │   │   │   ├─> Medium (Standard)
  │   │   │   └─> Expensive (Premium)
  │   │   │
  │   │   └─> Upload Vehicle Photos
  │   │       ├─> Front View
  │   │       ├─> Side View
  │   │       ├─> Interior View
  │   │       └─> Registration Document
  │   │
  │   ├─> Step 3: License Information
  │   │   ├─> Driver's License Number
  │   │   └─> Upload License Photo
  │   │
  │   ├─> Step 4: Bank Account Details (for payments)
  │   │   ├─> Bank Name
  │   │   ├─> Account Number
  │   │   └─> Account Holder Name
  │   │
  │   └─> Submit Registration
  │       │
  │       ├─> System checks for duplicate National ID
  │       │   ├─> Duplicate Found → Show Error: "Account already exists"
  │       │   └─> No Duplicate → Continue
  │       │
  │       └─> Account sent for Admin Approval
  │           │
  │           └─> Verification Pending Screen
  │               ├─> Display: "Your driver account is pending verification"
  │               ├─> Block ride access
  │               └─> Wait for Admin Approval
  │                   │
  │                   ├─> Admin Approves → SMS/Email Notification
  │                   │   └─> Account Activated → Can Go Online
  │                   │
  │                   └─> Admin Rejects → SMS/Email Notification
  │                       └─> Show Rejection Reason → Contact Support
  │
  └─> Driver Dashboard (After Approval)
END
```

### 4. Driver Login Flow

```
START
  │
  ├─> User Selected "I'm a Driver" → Tapped "Login"
  │
  ├─> Driver Login Screen
  │   ├─> App Logo
  │   ├─> Title: "Welcome Back"
  │   ├─> Subtitle: "Sign in to your driver account"
  │   │
  │   ├─> Sign-In Options
  │   │   │
  │   │   ├─> Option 1: Google Sign-In
  │   │   │   └─> Tap "Continue with Google"
  │   │   │       │
  │   │   │       ├─> Select Google Account
  │   │   │       └─> Authenticated → Check Account Status
  │   │   │           │
  │   │   │           ├─> Account Not Verified → Show Verification Pending Message
  │   │   │           │
  │   │   │           └─> Account Verified → Driver Dashboard
  │   │   │
  │   │   ├─> Option 2: Apple Sign-In
  │   │   │   └─> Tap "Continue with Apple"
  │   │   │       │
  │   │   │       ├─> Apple ID Authentication
  │   │   │       └─> Authenticated → Check Account Status
  │   │   │           │
  │   │   │           ├─> Account Not Verified → Show Verification Pending Message
  │   │   │           │
  │   │   │           └─> Account Verified → Driver Dashboard
  │   │   │
  │   │   ├─> Option 3: Email & Password
  │   │   │   └─> Tap "Continue with Email"
  │   │   │       │
  │   │   │       ├─> Enter Email
  │   │   │       ├─> Enter Password
  │   │   │       │
  │   │   │       └─> Tap "Sign In"
  │   │   │           │
  │   │   │           ├─> Invalid Credentials → Show Error → Retry
  │   │   │           │
  │   │   │           └─> Valid Credentials → Check Account Status
  │   │   │               │
  │   │   │               ├─> Account Not Verified → Show Verification Pending Message
  │   │   │               │
  │   │   │               └─> Account Verified → Driver Dashboard
  │   │   │
  │   │   └─> Option 4: Phone Number
  │   │       └─> Tap "Continue with Phone"
  │   │           │
  │   │           ├─> Enter Phone Number
  │   │           ├─> Receive OTP via SMS
  │   │           ├─> Enter OTP Code
  │   │           │
  │   │           └─> Verify OTP
  │   │               │
  │   │               ├─> Invalid OTP → Show Error → Resend
  │   │               │
  │   │               └─> Valid OTP → Check Account Status
  │   │                   │
  │   │                   ├─> Account Not Verified → Show Verification Pending Message
  │   │                   │
  │   │                   └─> Account Verified → Driver Dashboard
  │   │
  │   ├─> "Forgot Password?" Link (for Email login)
  │   │   └─> Password Reset Flow
  │   │
  │   └─> "Don't have an account? Sign Up" Link
  │       └─> Tap Link → Go to Driver Get Started Flow
  │
  └─> Driver Dashboard
END
```

### 3. Go Online & Receive Rides Flow

```
START
  │
  ├─> Driver Dashboard
  │   ├─> Display Driver Status: "Offline"
  │   │
  │   ├─> Tap "Go Online" Button
  │   │   │
  │   │   ├─> System Checks Requirements
  │   │   │   ├─> Account Verified? → Yes
  │   │   │   ├─> Vehicle Verified? → Yes
  │   │   │   └─> License Valid? → Yes
  │   │   │
  │   │   └─> All Requirements Met
  │   │       │
  │   │       ├─> Enable GPS Tracking
  │   │       ├─> Share Location with System
  │   │       ├─> Status Changes to "Online"
  │   │       └─> Driver Appears in Available Drivers Pool
  │   │
  │   └─> Online Mode Active
  │       │
  │       ├─> Map View Shows Current Location
  │       │   └─> Location Updates Every 5 Seconds
  │       │
  │       └─> Waiting for Ride Requests
  │           │
  │           └─> Ride Request Received
  │               │
  │               ├─> Notification Sound/Vibration
  │               ├─> Request Popup Appears
  │               │   ├─> Pickup Location (on map)
  │               │   ├─> Drop-off Location (on map)
  │               │   ├─> Distance
  │               │   ├─> Estimated Fare
  │               │   ├─> Vehicle Category Match
  │               │   └─> 30-Second Timer
  │               │
  │               ├─> Driver Reviews Request
  │               │   ├─> View Route on Map
  │               │   └─> Check Distance & Fare
  │               │
  │               └─> Driver Decision
  │                   │
  │                   ├─> Accept Request
  │                   │   │
  │                   │   ├─> System Notifies Passenger
  │                   │   ├─> Status Changes to "Ride Accepted"
  │                   │   └─> Navigate to Pickup Screen
  │                   │
  │                   └─> Decline Request
  │                       │
  │                       ├─> Request Sent to Next Available Driver
  │                       └─> Return to Waiting Mode
END
```

### 4. Active Ride Flow (Driver)

```
START
  │
  ├─> Ride Accepted Screen
  │   ├─> Display Passenger Details
  │   │   ├─> Passenger Name
  │   │   ├─> Passenger Photo
  │   │   ├─> Passenger Rating
  │   │   └─> Phone Number (Call Button)
  │   │
  │   ├─> Map View
  │   │   ├─> Driver Current Location
  │   │   ├─> Pickup Location (Red Pin)
  │   │   ├─> Route to Pickup (Navigation)
  │   │   └─> Distance to Pickup & ETA
  │   │
  │   ├─> Action Buttons
  │   │   ├─> Call Passenger
  │   │   ├─> Cancel Ride (with reason)
  │   │   └─> Navigate to Pickup (Opens Google Maps/Waze)
  │   │
  │   └─> Status Updates
  │       │
  │       ├─> Status: "Heading to Pickup"
  │       │   └─> Live GPS Tracking Active
  │       │
  │       ├─> Arrive at Pickup Location
  │       │   └─> Tap "Arrived at Pickup"
  │       │       │
  │       │       ├─> System Notifies Passenger
  │       │       ├─> Status: "Waiting for Passenger"
  │       │       └─> Wait for Passenger to Board
  │       │
  │       └─> Passenger Boards
  │           │
  │           └─> Tap "Start Trip"
  │               │
  │               ├─> System Confirms Start
  │               ├─> Fare is Locked (Cannot Change)
  │               ├─> Status: "Trip in Progress"
  │               │
  │               └─> Active Trip Screen
  │                   ├─> Map View with Route
  │                   │   ├─> Current Location (Updates every 5 seconds)
  │                   │   ├─> Route to Destination
  │                   │   └─> ETA to Destination
  │                   │
  │                   ├─> Trip Details
  │                   │   ├─> Pickup Location
  │                   │   ├─> Drop-off Location
  │                   │   ├─> Distance Traveled
  │                   │   └─> Locked Fare Amount
  │                   │
  │                   ├─> Action Buttons
  │                   │   ├─> Call Passenger
  │                   │   └─> Navigate to Destination
  │                   │
  │                   └─> Arrive at Destination
  │                       │
  │                       └─> Tap "End Trip"
  │                           │
  │                           ├─> System Confirms End
  │                           ├─> Final Fare Calculated
  │                           │
  │                           └─> Payment Screen
  │                               ├─> Display Final Fare
  │                               │
  │                               ├─> Payment Method Selected by Passenger
  │                               │   ├─> Cash
  │                               │   │   └─> Driver Confirms Cash Received
  │                               │   │       └─> Tap "Payment Received"
  │                               │   │
  │                               │   ├─> EcoCash
  │                               │   │   └─> System Processes Payment
  │                               │   │       └─> Payment Confirmed
  │                               │   │
  │                               │   ├─> Bank Transfer
  │                               │   │   └─> Driver Confirms Transfer Received
  │                               │   │       └─> Tap "Payment Received"
  │                               │   │
  │                               │   └─> Wallet
  │                               │       └─> System Auto-deducts
  │                               │           └─> Payment Confirmed
  │                               │
  │                               └─> Trip Completed
  │                                   ├─> Earnings Added to Driver Account
  │                                   ├─> Trip Added to History
  │                                   └─> Return to Online Mode (if still online)
END
```

### 5. Driver Earnings & Payments Flow

```
START
  │
  ├─> Navigate to Earnings Screen
  │   ├─> Display Summary
  │   │   ├─> Today's Earnings
  │   │   ├─> This Week's Earnings
  │   │   ├─> This Month's Earnings
  │   │   └─> Total Balance (Pending + Available)
  │   │
  │   ├─> Earnings Breakdown
  │   │   ├─> List All Completed Rides
  │   │   │   ├─> Date & Time
  │   │   │   ├─> Pickup → Drop-off
  │   │   │   ├─> Fare Amount
  │   │   │   ├─> Commission Deducted
  │   │   │   └─> Net Earnings
  │   │   │
  │   │   └─> Filter Options
  │   │       ├─> By Date Range
  │   │       └─> By Status (Pending, Available, Paid)
  │   │
  │   └─> Withdrawal Options
  │       ├─> Available Balance Display
  │       │
  │       └─> Request Withdrawal
  │           ├─> Enter Amount (Minimum threshold)
  │           ├─> Select Bank Account (from registered accounts)
  │           │
  │           └─> Submit Withdrawal Request
  │               │
  │               ├─> Request Submitted
  │               │   ├─> Status: "Processing"
  │               │   └─> Estimated Processing Time: 2-3 Business Days
  │               │
  │               └─> Withdrawal History
  │                   ├─> List All Withdrawals
  │                   ├─> Status Tracking
  │                   │   ├─> Processing
  │                   │   ├─> Completed
  │                   │   └─> Failed (with reason)
  │                   │
  │                   └─> View Withdrawal Details
END
```

### 6. Driver Profile & Settings Flow

```
START
  │
  ├─> Navigate to Profile Screen
  │   ├─> Display Profile Information
  │   │   ├─> Name
  │   │   ├─> Phone Number
  │   │   ├─> National ID (masked)
  │   │   ├─> Driver Rating (Average)
  │   │   ├─> Total Trips Completed
  │   │   └─> Vehicle Information
  │   │
  │   ├─> Edit Profile
  │   │   ├─> Update Phone Number (with verification)
  │   │   ├─> Update Bank Account Details
  │   │   └─> Change Password
  │   │
  │   ├─> Vehicle Management
  │   │   ├─> View Current Vehicle Details
  │   │   ├─> Update Vehicle Information
  │   │   └─> Add/Change Vehicle Photos
  │   │
  │   ├─> Documents
  │   │   ├─> View Driver's License
  │   │   ├─> View Vehicle Registration
  │   │   └─> Upload Updated Documents
  │   │
  │   └─> Settings
  │       ├─> Notification Preferences
  │       ├─> GPS Accuracy Settings
  │       ├─> Auto-Accept Rides (Toggle)
  │       └─> Logout
END
```

---

## Common Flows

### Emergency/Panic Button Flow

```
START
  │
  ├─> User Taps Emergency/Panic Button
  │   │
  │   ├─> Confirmation Dialog
  │   │   └─> "Are you in an emergency?"
  │   │       ├─> Cancel → Return to App
  │   │       └─> Confirm Emergency
  │   │
  │   └─> Emergency Activated
  │       │
  │       ├─> System Actions
  │       │   ├─> Capture Current GPS Location
  │       │   ├─> Send Alert to Admin Panel
  │       │   │   ├─> User Details
  │       │   │   ├─> Live GPS Location
  │       │   │   ├─> Timestamp
  │       │   │   └─> Active Ride Details (if applicable)
  │       │   │
  │       │   ├─> Send SMS to Emergency Contact (if configured)
  │       │   └─> Log Emergency Event
  │       │
  │       └─> User Interface
  │           ├─> Display: "Emergency alert sent"
  │           ├─> Show: "Help is on the way"
  │           └─> Option to Cancel False Alarm
END
```

### Rating & Feedback Flow

```
START
  │
  ├─> Trip Completed
  │
  ├─> Rating Prompt Appears
  │   ├─> For Passenger: Rate Driver
  │   │   ├─> Star Rating (1-5)
  │   │   ├─> Optional Feedback Categories
  │   │   │   ├─> Punctuality
  │   │   │   ├─> Vehicle Condition
  │   │   │   ├─> Driving Behavior
  │   │   │   └─> Communication
  │   │   │
  │   │   ├─> Optional Text Feedback
  │   │   └─> Submit Rating
  │   │
  │   └─> For Driver: Rate Passenger
  │       ├─> Star Rating (1-5)
  │       ├─> Optional Feedback Categories
  │       │   ├─> Punctuality
  │       │   ├─> Behavior
  │       │   └─> Payment
  │       │
  │       ├─> Optional Text Feedback
  │       └─> Submit Rating
  │
  └─> Rating Submitted
      ├─> Thank You Message
      └─> Return to Home/Dashboard
END
```

### Cancellation Flow

```
START
  │
  ├─> User Initiates Cancellation
  │   │
  │   ├─> Before Driver Accepts (Passenger)
  │   │   └─> Cancel Request
  │   │       ├─> No Fee Applied
  │   │       └─> Return to Home
  │   │
  │   ├─> After Driver Accepts, Before Trip Starts
  │   │   └─> Cancel Ride
  │   │       ├─> Cancellation Fee May Apply
  │   │       ├─> Show Fee Amount
  │   │       ├─> Confirm Cancellation
  │   │       └─> Process Fee (if applicable)
  │   │
  │   └─> During Active Trip
  │       └─> Cancel Trip
  │           ├─> Show Warning: "Trip in progress"
  │           ├─> Require Reason Selection
  │           │   ├─> Emergency
  │           │   ├─> Driver Issue
  │           │   └─> Other
  │           │
  │           ├─> Confirm Cancellation
  │           ├─> Charge Partial Fare (Distance Traveled)
  │           └─> End Trip
  │
  └─> Cancellation Complete
      ├─> Notification Sent to Other Party
      └─> Return to Home/Dashboard
END
```

---

## Flow Summary

### Passenger Journey Summary
1. **Role Selection** → Select "I'm a Passenger" → Choose "Get Started" or "Login"
2. **Get Started Path** → Passenger Onboarding → Create Account → Home Screen
3. **Login Path** → Sign In → Home Screen
4. **Book Ride** → Select Locations → Choose Category → View Fare → Select Payment → Verify (if guest) → Confirm
5. **Wait for Driver** → Driver Accepts → Track Driver → Driver Arrives → Board Vehicle
6. **During Ride** → Live GPS Tracking → Arrive at Destination → Complete Payment → Rate Driver
7. **Support** → Access Live Chat or Create Ticket → Get Help → Resolve Issue

### Driver Journey Summary
1. **Role Selection** → Select "I'm a Driver" → Choose "Get Started" or "Login"
2. **Get Started Path** → Driver Onboarding → Create Account → Registration Form → Wait for Admin Approval → Account Activated
3. **Login Path** → Sign In → Check Verification Status → Driver Dashboard
4. **Go Online** → Enable GPS → Appear in Available Drivers Pool → Wait for Requests
5. **Receive Request** → Review Details → Accept/Decline → Navigate to Pickup
6. **Pickup Passenger** → Arrive at Location → Passenger Boards → Start Trip
7. **Complete Ride** → Navigate to Destination → End Trip → Receive Payment → Rate Passenger
8. **Earnings** → View Earnings → Request Withdrawal → Receive Payment in Bank Account

---

*Document Version: 1.0*  
*Last Updated: 1/29/2026*  
*Based on: Trust Express App SRS v1.0*


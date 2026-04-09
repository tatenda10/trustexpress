import React, { useEffect, useState, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ClerkProvider, useAuth, useUser } from '@clerk/clerk-expo';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import "./global.css"

// Config
import { CLERK_PUBLISHABLE_KEY, tokenCache } from './config/clerk';
import { setApiAuthErrorHandler } from './api';

// Screens - Shared
import SplashScreen from './screens/shared/SplashScreen';
import RoleSelectionScreen from './screens/shared/RoleSelectionScreen';
import CompleteProfileScreen from './screens/shared/CompleteProfileScreen';
import BlockedAccountScreen from './screens/shared/BlockedAccountScreen';

// Screens - Passenger
import PassengerWelcomeScreen from './screens/passenger/PassengerWelcomeScreen';
import PassengerOnboardingScreen from './screens/passenger/onboarding/PassengerOnboardingScreen';
import PassengerTabNavigator from './screens/passenger/PassengerTabNavigator';
import PassengerCreateAccountScreen from './screens/passenger/auth/PassengerCreateAccountScreen';
import PassengerLoginScreen from './screens/passenger/auth/PassengerLoginScreen';
import PassengerEmailSignUpScreen from './screens/passenger/auth/PassengerEmailSignUpScreen';
import PassengerPhoneSignUpScreen from './screens/passenger/auth/PassengerPhoneSignUpScreen';
import PassengerEmailLoginScreen from './screens/passenger/auth/PassengerEmailLoginScreen';
import PassengerPhoneLoginScreen from './screens/passenger/auth/PassengerPhoneLoginScreen';
import PassengerEnableLocationScreen from './screens/passenger/PassengerEnableLocationScreen';
import PassengerVerifyPhoneScreen from './screens/passenger/PassengerVerifyPhoneScreen';

// Screens - Driver
import DriverWelcomeScreen from './screens/driver/DriverWelcomeScreen';
import DriverUploadDocumentsScreen from './screens/driver/DriverUploadDocumentsScreen';
import DriverVerifyPhoneScreen from './screens/driver/DriverVerifyPhoneScreen';
import DriverRegisterCarScreen from './screens/driver/DriverRegisterCarScreen';
import DriverTabNavigator from './screens/driver/DriverTabNavigator';
import DriverOnboardingScreen from './screens/driver/onboarding/DriverOnboardingScreen';
import DriverCreateAccountScreen from './screens/driver/auth/DriverCreateAccountScreen';
import DriverLoginScreen from './screens/driver/auth/DriverLoginScreen';
import DriverEmailLoginScreen from './screens/driver/auth/DriverEmailLoginScreen';
import DriverPhoneLoginScreen from './screens/driver/auth/DriverPhoneLoginScreen';
import { DriverStatusProvider } from './context/DriverStatusContext';
import { AgentInviteProvider, useAgentInvite } from './context/AgentInviteContext';
import * as Location from 'expo-location';

const navigationRef = createNavigationContainerRef();

const Stack = createNativeStackNavigator();

// Auth Stack (for unauthenticated users)
function AuthStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
      initialRouteName="Splash"
    >
      <Stack.Screen
        name="Splash"
        component={SplashScreen}
        initialParams={{ redirectTo: 'RoleSelection' }}
      />
      <Stack.Screen name="RoleSelection" component={RoleSelectionScreen} />
      
      {/* Passenger Routes */}
      <Stack.Screen name="PassengerWelcome" component={PassengerWelcomeScreen} />
      <Stack.Screen name="PassengerOnboarding" component={PassengerOnboardingScreen} />
      <Stack.Screen name="PassengerCreateAccount" component={PassengerCreateAccountScreen} />
      <Stack.Screen name="PassengerLogin" component={PassengerLoginScreen} />
      <Stack.Screen name="PassengerEmailSignUp" component={PassengerEmailSignUpScreen} />
      <Stack.Screen name="PassengerPhoneSignUp" component={PassengerPhoneSignUpScreen} />
      <Stack.Screen name="PassengerEmailLogin" component={PassengerEmailLoginScreen} />
      <Stack.Screen name="PassengerPhoneLogin" component={PassengerPhoneLoginScreen} />
      
      {/* Driver Routes */}
      <Stack.Screen name="DriverWelcome" component={DriverWelcomeScreen} />
      <Stack.Screen name="DriverOnboarding" component={DriverOnboardingScreen} />
      <Stack.Screen name="DriverCreateAccount" component={DriverCreateAccountScreen} />
      <Stack.Screen name="DriverLogin" component={DriverLoginScreen} />
      <Stack.Screen name="DriverEmailLogin" component={DriverEmailLoginScreen} />
      <Stack.Screen name="DriverPhoneLogin" component={DriverPhoneLoginScreen} />
    </Stack.Navigator>
  );
}

import { attachAgentReferral, getMe, getDriverMe, registerUser, saveDriverPushToken, saveUserPushToken } from './api';
import {
  DRIVER_SKIP_ENHANCED_SELFIE_KEY,
  DRIVER_SKIP_ONBOARDING_KEY,
} from './screens/driver/DriverUploadDocumentsScreen';
import { DRIVER_SKIP_PHONE_VERIFY_KEY } from './screens/driver/DriverVerifyPhoneScreen';

const ROLE_STORAGE_KEY = 'trust_express_role';
const getDriverStatusCacheKey = (userId) => `trust_express_driver_status:${userId}`;

// App Stack (for authenticated users)
function AppStack() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const { inviteToken, attachedUserId, markInviteAttached, clearInvite } = useAgentInvite();
  const getTokenRef = useRef(getToken);
  const roleBootstrapUserRef = useRef(null);
  const pushSyncKeyRef = useRef('');
  const referralAttachKeyRef = useRef('');
  const [userProfile, setUserProfile] = useState(null);
  const [storedRole, setStoredRole] = useState(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [driverStatus, setDriverStatus] = useState(null);
  const [driverLoading, setDriverLoading] = useState(true);
  const [driverSkippedOnboarding, setDriverSkippedOnboarding] = useState(false);
  const [driverSkippedEnhancedSelfie, setDriverSkippedEnhancedSelfie] = useState(false);
  const [driverSkippedPhoneVerify, setDriverSkippedPhoneVerify] = useState(false);
  const [driverStatusHydrated, setDriverStatusHydrated] = useState(false);
  const [passengerLocationGranted, setPassengerLocationGranted] = useState(null);
  const [passengerChecksLoading, setPassengerChecksLoading] = useState(true);
  const [passengerSkippedLocation, setPassengerSkippedLocation] = useState(false);
  const [passengerSkippedPhoneVerify, setPassengerSkippedPhoneVerify] = useState(false);
  const [roleBootstrapped, setRoleBootstrapped] = useState(false);

  const resolveExplicitRole = useCallback((profile) => {
    const metaRole = String(profile?.publicMetadata?.role || '').trim().toLowerCase();
    if (metaRole === 'driver' || metaRole === 'passenger') return metaRole;

    const directRole = String(profile?.role || '').trim().toLowerCase();
    if ((directRole === 'driver' || directRole === 'passenger') && profile?.publicMetadata?.role) {
      return directRole;
    }

    return null;
  }, []);

  const openDriverIncomingRequest = useCallback(() => {
    if (!navigationRef.isReady()) return;
    navigationRef.navigate('DriverTabs', {
      screen: 'DriverHome',
      params: {
        screen: 'DriverHomeMain',
        params: {
          openIncomingRideOverlay: true,
          notificationTs: Date.now(),
        },
      },
    });
  }, []);

  useEffect(() => {
    setDriverStatus(null);
    setDriverLoading(true);
    setDriverStatusHydrated(false);
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;

    const hydrateCachedDriverStatus = async () => {
      if (!user?.id) {
        if (!cancelled) setDriverStatusHydrated(true);
        return;
      }

      try {
        const cached = await AsyncStorage.getItem(getDriverStatusCacheKey(user.id));
        if (cancelled) return;
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && typeof parsed === 'object') {
            setDriverStatus(parsed);
          }
        }
      } catch {
        // Ignore cache hydration failures and continue with a live fetch.
      } finally {
        if (!cancelled) setDriverStatusHydrated(true);
      }
    };

    hydrateCachedDriverStatus();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    referralAttachKeyRef.current = '';
  }, [user?.id]);

  // Register push notifications once we know the user and role
  useEffect(() => {
    async function syncPushToken() {
      try {
        if (!user || !storageLoaded || roleLoading || !roleBootstrapped || !userRole) return;
        const pushKey = `${user.id}:${userRole}`;
        if (pushSyncKeyRef.current === pushKey) return;
        const token = await getTokenRef.current?.();
        if (!token) return;

        const { registerForPushNotificationsAsync } = await import('./notifications');
        const pushToken = await registerForPushNotificationsAsync();
        if (!pushToken) return;
        pushSyncKeyRef.current = pushKey;

        console.log('[AppStack] push token ready', {
          userId: user?.id || null,
          role: isDriver ? 'driver' : 'passenger',
          pushToken,
        });

        if (isDriver) {
          await saveDriverPushToken(token, pushToken);
        } else {
          await saveUserPushToken(token, pushToken);
        }
      } catch (error) {
        pushSyncKeyRef.current = '';
        console.warn('[AppStack] Failed to register push token', error);
      }
    }

    syncPushToken();
  }, [user?.id, isDriver, storageLoaded, roleLoading, roleBootstrapped, userRole]);

  // Role: backend first, then stored choice from the auth flow. Never default an authenticated
  // user to passenger here, otherwise fresh driver signups can be mis-registered during bootstrap.
  const userRole = userProfile?.role || storedRole || null;
  const isDriver = userRole === 'driver';

  useEffect(() => {
    console.log('[AppStack] state:', {
      storageLoaded,
      roleLoading,
      userRole,
      isDriver,
    });
  }, [storageLoaded, roleLoading, userRole, isDriver]);

  useEffect(() => {
    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification?.request?.content?.data || {};
      console.log('[notifications] received', {
        requestId: notification?.request?.identifier || null,
        title: notification?.request?.content?.title || null,
        data,
      });
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response?.notification?.request?.content?.data || {};
      console.log('[notifications] tapped', {
        actionIdentifier: response?.actionIdentifier || null,
        title: response?.notification?.request?.content?.title || null,
        data,
      });
      if (data?.type === 'driver_new_ride_request') {
        openDriverIncomingRequest();
      }
    });

    return () => {
      receivedSubscription.remove();
      responseSubscription.remove();
    };
  }, [openDriverIncomingRequest]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      AsyncStorage.getItem(ROLE_STORAGE_KEY),
      AsyncStorage.getItem(DRIVER_SKIP_ONBOARDING_KEY),
      AsyncStorage.getItem(DRIVER_SKIP_ENHANCED_SELFIE_KEY),
      AsyncStorage.getItem(DRIVER_SKIP_PHONE_VERIFY_KEY),
    ]).then(([role, skippedOnboarding, skippedEnhancedSelfie, skippedPhoneVerify]) => {
      if (cancelled) return;
      if (role) setStoredRole(role);
      if (skippedOnboarding === 'true') setDriverSkippedOnboarding(true);
      if (skippedEnhancedSelfie === 'true') setDriverSkippedEnhancedSelfie(true);
      if (skippedPhoneVerify === 'true') setDriverSkippedPhoneVerify(true);
      setStorageLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!storageLoaded) {
      return;
    }
    if (!user) {
      setRoleLoading(false);
      setRoleBootstrapped(true);
      return;
    }
    if (roleBootstrapUserRef.current === user.id) {
      return;
    }
    let cancelled = false;
    roleBootstrapUserRef.current = user.id;
    setRoleLoading(true);
    setRoleBootstrapped(false);
    getTokenRef.current?.()
      .then((token) => {
        if (!token || cancelled) return;
        return getMe(token);
      })
      .then((profile) => {
        if (cancelled) return;
        const explicitRole = resolveExplicitRole(profile);
        if (explicitRole) {
          setUserProfile({
            ...profile,
            role: explicitRole,
          });
          if (storedRole !== explicitRole) {
            setStoredRole(explicitRole);
            AsyncStorage.setItem(ROLE_STORAGE_KEY, explicitRole).catch(() => {});
          }
        }
        else {
          const fallbackRole = storedRole || null;
          if (!fallbackRole) {
            setUserProfile((prev) => ({
              ...(prev || {}),
              first_name: prev?.first_name || user?.firstName || null,
              last_name: prev?.last_name || user?.lastName || null,
              role: null,
            }));
            return;
          }
          setUserProfile((prev) => ({
            ...(prev || {}),
            first_name: prev?.first_name || user?.firstName || null,
            last_name: prev?.last_name || user?.lastName || null,
            role: fallbackRole,
          }));
          if (storedRole !== fallbackRole) {
            setStoredRole(fallbackRole);
          }
          getTokenRef.current?.().then((t) => {
            if (t) {
              registerUser(t, {
                role: fallbackRole,
                email: user?.primaryEmailAddress?.emailAddress,
                inviteToken: inviteToken || undefined,
              })
                .then(() => {
                  if (inviteToken) {
                    clearInvite().catch(() => {});
                  }
                })
                .catch(() => {});
            }
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        const fallbackRole = storedRole || null;
        setUserProfile((prev) => ({
          ...(prev || {}),
          first_name: prev?.first_name || user?.firstName || null,
          last_name: prev?.last_name || user?.lastName || null,
          role: prev?.role || fallbackRole || null,
        }));
        if (fallbackRole && storedRole !== fallbackRole) {
          setStoredRole(fallbackRole);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRoleLoading(false);
          setRoleBootstrapped(true);
        }
      });
    return () => { cancelled = true; };
  }, [resolveExplicitRole, storageLoaded, storedRole, user?.firstName, user?.id, user?.lastName, inviteToken, clearInvite]);

  const refetchDriverStatus = useCallback(async () => {
    if (!isDriver) return;
    try {
      const token = await getTokenRef.current?.();
      if (token) {
        const data = await getDriverMe(token);
        setDriverStatus(data);
        if (user?.id) {
          AsyncStorage.setItem(getDriverStatusCacheKey(user.id), JSON.stringify(data)).catch(() => {});
        }
        return data;
      }
    } catch {
      try {
        if (user?.id) {
          const cached = await AsyncStorage.getItem(getDriverStatusCacheKey(user.id));
          if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && typeof parsed === 'object') {
              setDriverStatus(parsed);
              return parsed;
            }
          }
        }
      } catch {
        // Ignore cache read failures and fall through.
      }

      if (driverStatus) {
        return driverStatus;
      }

      const fallback = { driverProfile: null, vehicle: null };
      setDriverStatus(fallback);
      return fallback;
    } finally {
      setDriverLoading(false);
    }
  }, [driverStatus, isDriver, user?.id]);

  useEffect(() => {
    if (!isDriver) {
      setDriverStatus(null);
      setDriverLoading(false);
      return;
    }
    refetchDriverStatus();
  }, [isDriver, refetchDriverStatus]);

  useEffect(() => {
    async function ensureAgentReferralAttached() {
      try {
        if (!user?.id || !roleBootstrapped || roleLoading || !inviteToken) return;
        if (userRole !== 'driver' && userRole !== 'passenger') return;
        if (attachedUserId && attachedUserId === user.id) return;

        const attachKey = `${user.id}:${inviteToken}`;
        if (referralAttachKeyRef.current === attachKey) return;
        referralAttachKeyRef.current = attachKey;

        const token = await getTokenRef.current?.();
        if (!token) {
          referralAttachKeyRef.current = '';
          return;
        }

        await attachAgentReferral(token, inviteToken);
        await markInviteAttached(user.id);
        await clearInvite();
      } catch (error) {
        referralAttachKeyRef.current = '';
        console.warn('[AppStack] Failed to attach agent referral', error);
      }
    }

    ensureAgentReferralAttached();
  }, [user?.id, userRole, roleBootstrapped, roleLoading, inviteToken, attachedUserId, markInviteAttached, clearInvite]);

  // Refetch driver status when app comes to foreground so approval from admin shows without reopening Account
  useEffect(() => {
    if (!isDriver) return;
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') refetchDriverStatus();
    });
    return () => sub.remove();
  }, [isDriver, refetchDriverStatus]);

  const refetchUserProfile = useCallback(async () => {
    const fallbackProfile = {
      first_name: user?.firstName || null,
      last_name: user?.lastName || null,
      role: userProfile?.role || storedRole || null,
      phoneVerified: userProfile?.phoneVerified || false,
    };

    try {
      const token = await getTokenRef.current?.();
      if (!token) {
        setUserProfile((prev) => ({ ...(prev || {}), ...fallbackProfile }));
        return fallbackProfile;
      }
      const profile = await getMe(token);
      setUserProfile(profile);
      return profile;
    } catch {
      setUserProfile((prev) => ({ ...(prev || {}), ...fallbackProfile }));
      return fallbackProfile;
    }
  }, [user?.firstName, user?.lastName, userProfile?.role, userProfile?.phoneVerified, storedRole]);

  const effectiveFirstName = String(userProfile?.first_name || user?.firstName || '').trim();
  const effectiveLastName = String(userProfile?.last_name || user?.lastName || '').trim();
  const needsProfileCompletion = !effectiveFirstName || !effectiveLastName;
  const isBlockedAccount = userProfile?.isBlocked === true || userProfile?.status === 'blocked' || userProfile?.accountStatus === 'blocked';

  useEffect(() => {
    if (isDriver) {
      setPassengerChecksLoading(false);
      return;
    }

    let cancelled = false;
    setPassengerChecksLoading(true);
    const timeoutId = setTimeout(() => {
      if (cancelled) return;
      setPassengerLocationGranted(false);
      setPassengerChecksLoading(false);
    }, 3000);

    Location.getForegroundPermissionsAsync()
      .then((permission) => {
        if (cancelled) return;
        clearTimeout(timeoutId);
        setPassengerLocationGranted(permission.status === 'granted');
      })
      .catch(() => {
        if (!cancelled) {
          clearTimeout(timeoutId);
          setPassengerLocationGranted(false);
        }
      })
      .finally(() => {
        if (!cancelled) setPassengerChecksLoading(false);
      });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [isDriver, user?.id]);

  if (!storageLoaded || roleLoading || !roleBootstrapped || !userRole) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Splash" component={SplashScreen} />
      </Stack.Navigator>
    );
  }

  if (isBlockedAccount) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="BlockedAccount" component={BlockedAccountScreen} />
      </Stack.Navigator>
    );
  }

  if (userRole === 'passenger') {
    if (passengerChecksLoading) {
      return <SplashScreen />;
    }

    const passengerPhoneVerified = userProfile?.phoneVerified === true;
    const needPassengerProfile = needsProfileCompletion;
    const needPassengerLocation = passengerLocationGranted !== true && !passengerSkippedLocation;
    const needPassengerPhoneVerify = !passengerPhoneVerified && !passengerSkippedPhoneVerify;
    const passengerInitialRoute = needPassengerProfile
      ? 'PassengerCompleteProfile'
      : needPassengerLocation
      ? 'PassengerEnableLocation'
      : needPassengerPhoneVerify
        ? 'PassengerVerifyPhone'
        : 'PassengerTabs';

    return (
      <Stack.Navigator key={passengerInitialRoute} screenOptions={{ headerShown: false }} initialRouteName={passengerInitialRoute}>
        <Stack.Screen name="PassengerTabs" component={PassengerTabNavigator} />
        <Stack.Screen name="PassengerCompleteProfile">
          {(props) => (
            <CompleteProfileScreen
              {...props}
              role="passenger"
              onCompleted={async () => {
                const profileData = await refetchUserProfile();
                const profileStillMissing = !String(profileData?.first_name || '').trim() || !String(profileData?.last_name || '').trim();
                if (profileStillMissing) return;
                props.navigation.replace(
                  needPassengerLocation
                    ? 'PassengerEnableLocation'
                    : needPassengerPhoneVerify
                      ? 'PassengerVerifyPhone'
                      : 'PassengerTabs'
                );
              }}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="PassengerEnableLocation">
          {(props) => (
            <PassengerEnableLocationScreen
              {...props}
              onGranted={() => {
                setPassengerLocationGranted(true);
                // Move forward immediately instead of waiting for navigator key reset.
                props.navigation.replace(needPassengerPhoneVerify ? 'PassengerVerifyPhone' : 'PassengerTabs');
              }}
              onSkip={() => {
                setPassengerSkippedLocation(true);
                props.navigation.replace(needPassengerPhoneVerify ? 'PassengerVerifyPhone' : 'PassengerTabs');
              }}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="PassengerVerifyPhone">
          {(props) => (
            <PassengerVerifyPhoneScreen
              {...props}
              onVerified={async () => {
                await refetchUserProfile();
                setPassengerSkippedPhoneVerify(false);
              }}
              onSkip={() => {
                setPassengerSkippedPhoneVerify(true);
                props.navigation.replace('PassengerTabs');
              }}
            />
          )}
        </Stack.Screen>
      </Stack.Navigator>
    );
  }

  // Driver: route by API status (or skip – go to dashboard without docs)
  const profile = driverStatus?.driverProfile;
  const vehicle = driverStatus?.vehicle;
  const phoneVerified = driverStatus?.phoneVerified === true;
  const needDriverProfileCompletion = needsProfileCompletion;
  const profileStatus = String(profile?.status || '').trim().toLowerCase();
  const vehicleStatus = String(vehicle?.status || '').trim().toLowerCase();
  const profileApproved = profileStatus === 'approved' || profileStatus === 'verified';
  const vehicleApproved = vehicleStatus === 'approved' || vehicleStatus === 'verified';
  const needDriverEnhancedSelfie = profileApproved && !vehicleApproved && !profile?.selfieWithIdCardUrl && !driverSkippedEnhancedSelfie;
  const needProfile = !profile || !profileApproved;
  const needPhoneVerify = profileApproved && !phoneVerified && !driverSkippedPhoneVerify;
  const needVehicle = profileApproved && (!vehicle || !vehicleApproved);
  const canGoOnline = profileApproved && vehicleApproved;

  if (!driverStatusHydrated || driverLoading) {
    return <SplashScreen />;
  }

  const initialRoute = canGoOnline
        ? 'DriverTabs'
      : needDriverProfileCompletion
        ? 'DriverCompleteProfile'
      : needDriverEnhancedSelfie
        ? 'DriverEnhancedSelfie'
        : needProfile
          ? 'DriverUploadDocuments'
          : needPhoneVerify
            ? 'DriverVerifyPhone'
            : needVehicle
              ? 'DriverRegisterCar'
              : 'DriverTabs';

  return (
    <DriverStatusProvider
      value={{
        driverStatus,
        refetchDriverStatus,
        onSkippedPhoneVerify: () => setDriverSkippedPhoneVerify(true),
      }}
    >
      <Stack.Navigator
        key={initialRoute}
        screenOptions={{ headerShown: false }}
        initialRouteName={initialRoute}
      >
        <Stack.Screen
          name="DriverCompleteProfile"
        >
          {(props) => (
            <CompleteProfileScreen
              {...props}
              role="driver"
              onCompleted={async () => {
                const profileData = await refetchUserProfile();
                const profileStillMissing = !String(profileData?.first_name || '').trim() || !String(profileData?.last_name || '').trim();
                if (profileStillMissing && !canGoOnline) return;
                props.navigation.replace(
                  canGoOnline
                    ? 'DriverTabs'
                    : needDriverEnhancedSelfie
                      ? 'DriverEnhancedSelfie'
                      : needProfile
                        ? 'DriverUploadDocuments'
                        : needPhoneVerify
                          ? 'DriverVerifyPhone'
                          : needVehicle
                            ? 'DriverRegisterCar'
                            : 'DriverTabs'
                );
              }}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="DriverEnhancedSelfie">
          {(props) => (
            <DriverUploadDocumentsScreen
              {...props}
              route={{
                ...props.route,
                params: {
                  ...(props.route?.params || {}),
                  driverStatus,
                  enhancedSelfieOnly: true,
                },
              }}
            />
          )}
        </Stack.Screen>
        <Stack.Screen
          name="DriverUploadDocuments"
          component={DriverUploadDocumentsScreen}
          initialParams={{ driverStatus }}
        />
        <Stack.Screen
          name="DriverVerifyPhone"
          component={DriverVerifyPhoneScreen}
          initialParams={{ driverStatus }}
        />
        <Stack.Screen
          name="DriverRegisterCar"
          component={DriverRegisterCarScreen}
          initialParams={{ driverStatus }}
        />
        <Stack.Screen
          name="DriverTabs"
          component={DriverTabNavigator}
          initialParams={{ driverStatus }}
        />
      </Stack.Navigator>
    </DriverStatusProvider>
  );
}

// Main App Component – use isSignedIn so setActive() correctly switches to AppStack (no manual navigate)
function AppContent() {
  const { isLoaded, isSignedIn, signOut } = useAuth();
  const { setInviteFromToken, hydrateStoredInvite } = useAgentInvite();
  const pendingInviteNavigationRef = useRef(false);

  const handleInviteUrl = useCallback(async (url) => {
    if (!url) return false;
    const parsed = Linking.parse(url);
    const path = String(parsed?.path || parsed?.hostname || '').toLowerCase();
    const queryInvite = parsed?.queryParams?.invite;
    const inviteToken = Array.isArray(queryInvite) ? queryInvite[0] : String(queryInvite || '').trim();

    const looksLikeDriverSignup = path.includes('driver-signup') || path.includes('driver-onboarding');
    const looksLikePassengerSignup = path.includes('passenger-signup') || path.includes('passenger-onboarding');
    if (!inviteToken || (!looksLikeDriverSignup && !looksLikePassengerSignup)) {
      return false;
    }

    try {
      await setInviteFromToken(inviteToken);
      if (navigationRef.isReady() && !isSignedIn) {
        navigationRef.navigate(looksLikePassengerSignup ? 'PassengerOnboarding' : 'DriverOnboarding');
      } else if (!isSignedIn) {
        pendingInviteNavigationRef.current = looksLikePassengerSignup ? 'passenger' : 'driver';
      }
      return true;
    } catch {
      return false;
    }
  }, [isSignedIn, setInviteFromToken]);

  useEffect(() => {
    console.log('[AppContent] auth state:', { isLoaded, isSignedIn, rendering: !isLoaded ? 'AuthStack' : isSignedIn ? 'AppStack' : 'AuthStack' });
  }, [isLoaded, isSignedIn]);

  // When the backend says the token is invalid/expired, automatically sign the user out.
  useEffect(() => {
    setApiAuthErrorHandler(() => {
      // Avoid calling signOut before Clerk is ready.
      if (isLoaded) {
        signOut().catch(() => {});
      }
    });
  }, [isLoaded, signOut]);

  useEffect(() => {
    // Complete OAuth session when app opens from redirect (Clerk Google/Apple sign-in)
    WebBrowser.maybeCompleteAuthSession();

    hydrateStoredInvite().catch(() => {});

    // When app is opened via deep link (e.g. trustexpress://oauth-callback?...) complete the auth session
    const sub = Linking.addEventListener('url', ({ url }) => {
      WebBrowser.maybeCompleteAuthSession();
      handleInviteUrl(url).catch(() => {});
    });

    // Handle cold start: app opened from closed state with OAuth redirect URL
    Linking.getInitialURL?.().then((url) => {
      if (url) {
        WebBrowser.maybeCompleteAuthSession();
        handleInviteUrl(url).catch(() => {});
      }
    });

    return () => sub?.remove();
  }, [handleInviteUrl, hydrateStoredInvite]);

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        if (pendingInviteNavigationRef.current && !isSignedIn) {
          const pendingTarget = pendingInviteNavigationRef.current;
          pendingInviteNavigationRef.current = false;
          navigationRef.navigate(pendingTarget === 'passenger' ? 'PassengerOnboarding' : 'DriverOnboarding');
        }
      }}
    >
      <SafeAreaProvider>
        <KeyboardProvider>
          {!isLoaded ? <AuthStack /> : isSignedIn ? <AppStack /> : <AuthStack />}
          <StatusBar style="auto" />
        </KeyboardProvider>
      </SafeAreaProvider>
    </NavigationContainer>
  );
}

// Root App with Clerk Provider
export default function App() {
  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      tokenCache={tokenCache}
    >
      <AgentInviteProvider>
        <AppContent />
      </AgentInviteProvider>
    </ClerkProvider>
  );
}

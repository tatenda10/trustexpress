import React, { useEffect, useState, useCallback, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
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
import { getDriverCurrentRide, getDriverRideRequests, setApiAuthErrorHandler } from './api';

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
import PassengerIdentityVerificationScreen from './screens/passenger/PassengerIdentityVerificationScreen';
import { passengerPhoneVerificationTabsParams, replaceWithPassengerPhoneVerification, replaceWithPassengerTabs } from './navigation/passengerNavigation';

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
import { navigationRef } from './navigationRef';
import * as Location from 'expo-location';
import {
  isTripOverlaySupported,
  showTripOverlay,
  updateTripOverlay,
  hideTripOverlay,
} from './services/tripOverlay';

const BACKGROUND_OVERLAY_SHOW_DELAY_MS = 0;

const Stack = createNativeStackNavigator();

function isDriverStatusOnline(status) {
  const value = status?.availability?.isOnline ?? status?.isOnline;
  return value === true || value === 1 || value === '1' || value === 'true';
}

function hasDriverActiveRide(status) {
  return !!(status?.currentRide?.id || status?.ride?.id || status?.activeRide?.id);
}

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

import { attachAgentReferral, getMe, getDriverMe, registerUser, saveDriverPushToken, saveDriverFcmToken, saveUserPushToken } from './api';
import {
  DRIVER_SKIP_ENHANCED_SELFIE_KEY,
  DRIVER_SKIP_ONBOARDING_KEY,
} from './screens/driver/DriverUploadDocumentsScreen';
import { DRIVER_SKIP_PHONE_VERIFY_KEY } from './screens/driver/DriverVerifyPhoneScreen';

const ROLE_STORAGE_KEY = 'trust_express_role';
const getDriverStatusCacheKey = (userId) => `trust_express_driver_status:${userId}`;

// App Stack (for authenticated users)
function AppStack({ currentRouteName }) {
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
  /** Latest driver status for refetch error paths (avoids stale useCallback closure wiping state). */
  const driverStatusRef = useRef(null);
  const backgroundOverlayVisibleRef = useRef(false);
  const backgroundOverlayShowTimerRef = useRef(null);
  const backgroundOverlayLastBackgroundAtRef = useRef(0);
  const backgroundOverlayLastVariantRef = useRef('online');
  const appStateRef = useRef(AppState.currentState);
  const lastDriverStatusForegroundFetchAtRef = useRef(0);
  const [driverLoading, setDriverLoading] = useState(true);
  const [driverSkippedOnboarding, setDriverSkippedOnboarding] = useState(false);
  const [driverSkippedEnhancedSelfie, setDriverSkippedEnhancedSelfie] = useState(false);
  const [driverSkippedPhoneVerify, setDriverSkippedPhoneVerify] = useState(false);
  const [driverStatusHydrated, setDriverStatusHydrated] = useState(false);
  const [passengerLocationGranted, setPassengerLocationGranted] = useState(null);
  const [passengerChecksLoading, setPassengerChecksLoading] = useState(true);
  const [roleBootstrapped, setRoleBootstrapped] = useState(false);

  useEffect(() => {
    driverStatusRef.current = driverStatus;
  }, [driverStatus]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (currentRouteName !== 'DriverTrip') return;
    if (AppState.currentState !== 'active') return;

    if (backgroundOverlayShowTimerRef.current) {
      clearTimeout(backgroundOverlayShowTimerRef.current);
      backgroundOverlayShowTimerRef.current = null;
    }
    hideTripOverlay().finally(() => {
      backgroundOverlayVisibleRef.current = false;
    });
  }, [currentRouteName]);

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

  // Role: backend first, then stored choice from the auth flow. Never default an authenticated
  // user to passenger here, otherwise fresh driver signups can be mis-registered during bootstrap.
  const userRole = userProfile?.role || storedRole || null;
  const isDriver = userRole === 'driver';

  // Register push notifications once we know the user and role
  useEffect(() => {
    let cancelled = false;

    async function syncPushToken() {
      try {
        if (!user || !storageLoaded || roleLoading || !roleBootstrapped || !userRole) return;
        const pushKey = `${user.id}:${userRole}`;
        if (pushSyncKeyRef.current === pushKey) return;
        const token = await getTokenRef.current?.();
        if (!token) return;

        const { registerForPushNotificationsAsync, registerForFcmTokenAsync } = await import('./notifications');
        const [pushToken, fcmToken] = await Promise.all([
          registerForPushNotificationsAsync(),
          registerForFcmTokenAsync(),
        ]);

        if (!pushToken && !fcmToken) {
          console.log('[AppStack] No notification token available');
          return;
        }

        pushSyncKeyRef.current = pushKey;

        if (pushToken) {
          console.log('[AppStack] push token ready', {
            userId: user?.id || null,
            role: isDriver ? 'driver' : 'passenger',
            pushToken,
          });
        }
        if (fcmToken) {
          console.log('[AppStack] fcm token ready', {
            userId: user?.id || null,
            role: isDriver ? 'driver' : 'passenger',
            fcmTokenPreview: String(fcmToken).slice(0, 18),
          });
        }

        if (isDriver) {
          if (pushToken) await saveDriverPushToken(token, pushToken);
          if (fcmToken) await saveDriverFcmToken(token, fcmToken);
        } else {
          if (pushToken) await saveUserPushToken(token, pushToken);
        }
        if (cancelled) return;
      } catch (error) {
        pushSyncKeyRef.current = '';
        // Only log network errors as warnings, don't treat as critical failures
        if (error.message?.includes('Network error') || error.message?.includes('connection')) {
          console.log('[AppStack] Push token registration deferred due to network connectivity');
        } else {
          console.warn('[AppStack] Failed to register push token', error);
        }
      }
    }

    syncPushToken();
    const retryInterval = setInterval(() => {
      syncPushToken();
    }, 45000);

    return () => {
      cancelled = true;
      clearInterval(retryInterval);
    };
  }, [user?.id, isDriver, storageLoaded, roleLoading, roleBootstrapped, userRole]);

  useEffect(() => {
    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification?.request?.content?.data || {};
      console.log('[notifications] received', {
        requestId: notification?.request?.identifier || null,
        title: notification?.request?.content?.title || null,
        data,
      });
      if (data?.type === 'driver_new_ride_request' && isDriver) {
        backgroundOverlayLastVariantRef.current = 'request';
        if (AppState.currentState === 'background' && backgroundOverlayVisibleRef.current) {
          updateTripOverlay({ variant: 'request' }).catch(() => {});
        }
        openDriverIncomingRequest();
      } else if (data?.type === 'ride_status' && isDriver) {
        const rideStatus = String(data?.status || '').toLowerCase();
        if (['driver_assigned', 'driver_arrived', 'in_progress'].includes(rideStatus)) {
          backgroundOverlayLastVariantRef.current = 'trip';
          if (AppState.currentState === 'background' && backgroundOverlayVisibleRef.current) {
            hideTripOverlay().finally(() => {
              backgroundOverlayVisibleRef.current = false;
            });
          }
        } else if (['completed', 'cancelled', 'expired'].includes(rideStatus)) {
          backgroundOverlayLastVariantRef.current = 'online';
          if (AppState.currentState === 'background' && backgroundOverlayVisibleRef.current) {
            updateTripOverlay({ variant: 'online' }).catch(() => {});
          }
        }
      }
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
  }, [isDriver, openDriverIncomingRequest]);

  // Background overlay for online drivers
  useEffect(() => {
    if (!isDriver) {
      return undefined;
    }

    const driverIsOnline = isDriverStatusOnline(driverStatus);
    const overlaySupported = Platform.OS === 'android' && isTripOverlaySupported();
    console.log('[BackgroundOverlay] effect init', {
      appState: AppState.currentState,
      isDriver,
      driverIsOnline,
      overlaySupported,
      driverStatusOnline: driverStatus?.availability?.isOnline ?? driverStatus?.isOnline ?? null,
    });
    if (!overlaySupported) {
      console.log('[BackgroundOverlay] unsupported or missing native module');
      return;
    }

    let active = true;

    const clearShowTimer = () => {
      if (backgroundOverlayShowTimerRef.current) {
        clearTimeout(backgroundOverlayShowTimerRef.current);
        backgroundOverlayShowTimerRef.current = null;
      }
    };

    const resolveBackgroundOverlayVariant = async () => {
      try {
        console.log('[BackgroundOverlay] variant resolve:start');
        const token = await getTokenRef.current?.();
        if (!token) {
          console.log('[BackgroundOverlay] variant fallback: missing auth token');
          return backgroundOverlayLastVariantRef.current || 'online';
        }

        const currentRideData = await getDriverCurrentRide(token, { suppressAuthErrorHandler: true });
        if (currentRideData?.ride?.id) {
          console.log('[BackgroundOverlay] variant resolved: trip', { rideId: currentRideData.ride.id });
          return 'trip';
        }

        const requestsData = await getDriverRideRequests(token);
        const hasRequests = Array.isArray(requestsData?.requests) && requestsData.requests.length > 0;
        console.log('[BackgroundOverlay] variant resolved', {
          variant: hasRequests ? 'request' : 'online',
          requestCount: Array.isArray(requestsData?.requests) ? requestsData.requests.length : 0,
        });
        return hasRequests ? 'request' : 'online';
      } catch (error) {
        console.log('[BackgroundOverlay] variant fallback after error', {
          message: error?.message || null,
          status: error?.status ?? null,
        });
        return backgroundOverlayLastVariantRef.current || 'online';
      }
    };

    const getOverlayCopy = (variant) => {
      if (variant === 'trip') {
        return {
          title: 'Trust Express',
          subtitle: 'Active trip',
          meta: 'Tap to return to trip',
          variant: 'trip',
        };
      }
      if (variant === 'request') {
        return {
          title: 'Trust Express',
          subtitle: 'New ride request',
          meta: 'Tap to respond',
          variant: 'request',
        };
      }
      return {
        title: 'Trust Express',
        subtitle: 'Online - Ready for rides',
        meta: 'Tap to return to app',
        variant: 'online',
      };
    };

    const getCurrentRouteName = () => {
      if (currentRouteName) return currentRouteName;
      try {
        return navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name || null : null;
      } catch {
        return null;
      }
    };

    const showOnlineOverlay = async (source) => {
      const driverOnlineNow = driverIsOnline || isDriverStatusOnline(driverStatusRef.current);
      const routeName = getCurrentRouteName();
      console.log('[BackgroundOverlay] show attempt', {
        source,
        active,
        visible: backgroundOverlayVisibleRef.current,
        appStateRef: appStateRef.current,
        appState: AppState.currentState,
        isDriver,
        driverIsOnline,
        driverOnlineRef: isDriverStatusOnline(driverStatusRef.current),
        driverOnlineNow,
        routeName,
      });
      if (!active || backgroundOverlayVisibleRef.current) return;
      if (appStateRef.current !== 'background' || AppState.currentState !== 'background') {
        console.log('[BackgroundOverlay] show skipped: app is not backgrounded');
        return;
      }
      if (!isDriver || !driverOnlineNow) {
        console.log('[BackgroundOverlay] show skipped: not an online driver');
        return;
      }
      const hasKnownActiveRide = hasDriverActiveRide(driverStatusRef.current);
      if (hasKnownActiveRide && routeName !== 'DriverTrip') {
        console.log('[BackgroundOverlay] show skipped: active ride already known outside trip screen');
        return;
      }

      const initialVariant = routeName === 'DriverTrip'
        ? 'trip'
        : backgroundOverlayLastVariantRef.current === 'request'
          ? 'request'
          : 'online';
      backgroundOverlayLastVariantRef.current = initialVariant;

      if (appStateRef.current !== 'background' || AppState.currentState !== 'background') {
        console.log('[BackgroundOverlay] show skipped after resolve: app is not backgrounded');
        return;
      }

      const payload = getOverlayCopy(backgroundOverlayLastVariantRef.current || 'online');
      console.log('[BackgroundOverlay] calling native show', payload);
      const shown = await showTripOverlay(payload);
      console.log('[BackgroundOverlay] native show result', {
        shown,
        variant: backgroundOverlayLastVariantRef.current,
      });

      if (active && shown) {
        backgroundOverlayVisibleRef.current = true;
        if (appStateRef.current !== 'background' || AppState.currentState !== 'background') {
          console.log('[BackgroundOverlay] native show finished after foreground; hiding immediately');
          await hideTripOverlay();
          backgroundOverlayVisibleRef.current = false;
          return;
        }
      }

      if (routeName !== 'DriverTrip') {
        resolveBackgroundOverlayVariant().then((resolvedVariant) => {
          if (!active || !backgroundOverlayVisibleRef.current) return;
          if (!resolvedVariant || resolvedVariant === backgroundOverlayLastVariantRef.current) return;

          backgroundOverlayLastVariantRef.current = resolvedVariant;
          if (resolvedVariant === 'trip') {
            console.log('[BackgroundOverlay] hiding native overlay: active trip resolved');
            hideTripOverlay().finally(() => {
              backgroundOverlayVisibleRef.current = false;
            });
            return;
          }

          if (appStateRef.current !== 'background' || AppState.currentState !== 'background') return;

          const nextPayload = getOverlayCopy(resolvedVariant);
          console.log('[BackgroundOverlay] updating native overlay variant', nextPayload);
          updateTripOverlay(nextPayload).catch((error) => {
            console.log('[BackgroundOverlay] update variant failed', {
              message: error?.message || null,
            });
          });
        });
      }
    };

    const scheduleShowOverlay = (source) => {
      clearShowTimer();
      if (BACKGROUND_OVERLAY_SHOW_DELAY_MS <= 0) {
        showOnlineOverlay(source);
        return;
      }
      backgroundOverlayShowTimerRef.current = setTimeout(() => {
        backgroundOverlayShowTimerRef.current = null;
        showOnlineOverlay(source);
      }, BACKGROUND_OVERLAY_SHOW_DELAY_MS);
    };

    const hideOnlineOverlay = async (force = false) => {
      clearShowTimer();
      if (!force && !backgroundOverlayVisibleRef.current) return;
      await hideTripOverlay();
      backgroundOverlayVisibleRef.current = false;
    };

    const openOverlayTargetIfNeeded = () => {
      const lastVariant = backgroundOverlayLastVariantRef.current;
      if (lastVariant === 'request') {
        openDriverIncomingRequest();
        return;
      }
    };

    const handleAppStateChange = (nextAppState) => {
      const routeName = getCurrentRouteName();
      console.log('[BackgroundOverlay] app state change', {
        from: appStateRef.current,
        to: nextAppState,
        isDriver,
        driverIsOnline,
        routeName,
        variant: backgroundOverlayLastVariantRef.current,
      });
      appStateRef.current = nextAppState;
      const driverOnlineNow = driverIsOnline || isDriverStatusOnline(driverStatusRef.current);
      if (nextAppState === 'background' && isDriver && driverOnlineNow) {
        backgroundOverlayLastBackgroundAtRef.current = Date.now();
        scheduleShowOverlay('app-state-background');
      } else if (nextAppState === 'active') {
        const backgroundDurationMs = Date.now() - backgroundOverlayLastBackgroundAtRef.current;
        const wasVisible = backgroundOverlayVisibleRef.current;
        clearShowTimer();
        if (backgroundDurationMs < BACKGROUND_OVERLAY_SHOW_DELAY_MS && !backgroundOverlayVisibleRef.current) {
          return;
        }
        hideOnlineOverlay(false).then(() => {
          if (wasVisible) openOverlayTargetIfNeeded();
        });
      } else {
        clearShowTimer();
      }
    };

    if (!isDriver || !driverIsOnline) {
      hideOnlineOverlay(true);
    }

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    // Initial check in case app starts in background (unlikely but safe)
    if (
      AppState.currentState === 'background' &&
      isDriver &&
      driverIsOnline
    ) {
      scheduleShowOverlay('initial-background');
    }

    return () => {
      active = false;
      clearShowTimer();
      subscription?.remove();
    };
  }, [isDriver, driverStatus?.availability?.isOnline, driverStatus?.isOnline, openDriverIncomingRequest, currentRouteName]);

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
        // Add timeout to prevent hanging
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('API timeout')), 5000);
        });
        return Promise.race([getMe(token), timeoutPromise]);
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
      .catch((error) => {
        console.warn('[AppStack] Role bootstrap API error, using fallback:', error.message);
        if (cancelled) return;
        // On API error, fall back to stored role or null
        const fallbackRole = storedRole || null;
        setUserProfile((prev) => ({
          ...(prev || {}),
          first_name: prev?.first_name || user?.firstName || null,
          last_name: prev?.last_name || user?.lastName || null,
          role: fallbackRole,
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

  const patchDriverStatus = useCallback((patch) => {
    if (!patch || typeof patch !== 'object') return;
    setDriverStatus((prev) => ({ ...(prev && typeof prev === 'object' ? prev : {}), ...patch }));
  }, []);

  const refetchDriverStatus = useCallback(async () => {
    if (!isDriver) return;
    try {
      const token = await getTokenRef.current?.();
      if (!token) {
        const latest = driverStatusRef.current;
        return latest && typeof latest === 'object' ? latest : null;
      }
      const data = await getDriverMe(token, { suppressAuthErrorHandler: true });
      setDriverStatus(data);
      if (user?.id) {
        AsyncStorage.setItem(getDriverStatusCacheKey(user.id), JSON.stringify(data)).catch(() => {});
      }
      return data;
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

      const latest = driverStatusRef.current;
      if (latest && typeof latest === 'object') {
        return latest;
      }

      setDriverStatus(null);
      return null;
    } finally {
      setDriverLoading(false);
    }
  }, [isDriver, user?.id]);

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
      if (nextState !== 'active') return;
      if (currentRouteName === 'DriverTrip') return;
      const now = Date.now();
      if (now - lastDriverStatusForegroundFetchAtRef.current < 5000) return;
      lastDriverStatusForegroundFetchAtRef.current = now;
      refetchDriverStatus();
    });
    return () => sub.remove();
  }, [isDriver, refetchDriverStatus, currentRouteName]);

  const refetchUserProfile = useCallback(async () => {
    const fallbackProfile = {
      first_name: user?.firstName || null,
      last_name: user?.lastName || null,
      role: userProfile?.role || storedRole || null,
      // Preserve previously known verification state on transient refresh failures.
      phoneVerified: typeof userProfile?.phoneVerified === 'boolean' ? userProfile.phoneVerified : null,
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

    const passengerPhoneKnown = typeof userProfile?.phoneVerified === 'boolean';
    const passengerPhoneVerified = userProfile?.phoneVerified === true;
    const passengerIdentity = userProfile?.passengerIdentity || null;
    const passengerIdentityStatus = String(passengerIdentity?.status || 'not_submitted').trim().toLowerCase();
    const passengerIdentitySubmitted = !!(
      passengerIdentity?.nationalIdFrontUrl &&
      passengerIdentity?.nationalIdBackUrl
    );
    const passengerIdentityApproved = passengerIdentityStatus === 'approved' || passengerIdentityStatus === 'verified';
    const passengerIdentityPending = passengerIdentityStatus === 'pending' && passengerIdentitySubmitted;
    const passengerIdentityBlocked = passengerIdentityStatus === 'rejected' && passengerIdentity?.canResubmit === false;
    const needPassengerProfile = needsProfileCompletion;
    const needPassengerLocation = passengerLocationGranted !== true;
    // Only force verification when backend explicitly says "false".
    const needPassengerPhoneVerify = passengerPhoneKnown && !passengerPhoneVerified;
    const needPassengerIdentity = false;
    const openPhoneVerificationOnLaunch = needPassengerPhoneVerify && !needPassengerProfile && !needPassengerLocation;
    const passengerInitialRoute = needPassengerProfile
      ? 'PassengerCompleteProfile'
      : needPassengerLocation
      ? 'PassengerEnableLocation'
      : 'PassengerTabs';
    const passengerTabsInitialParams = openPhoneVerificationOnLaunch
      ? passengerPhoneVerificationTabsParams
      : undefined;

    return (
      <Stack.Navigator key={passengerInitialRoute} screenOptions={{ headerShown: false }} initialRouteName={passengerInitialRoute}>
        <Stack.Screen
          name="PassengerTabs"
          component={PassengerTabNavigator}
          initialParams={passengerTabsInitialParams}
        />
        <Stack.Screen name="PassengerCompleteProfile">
          {(props) => (
            <CompleteProfileScreen
              {...props}
              role="passenger"
              onCompleted={async () => {
                const profileData = await refetchUserProfile();
                const profileStillMissing = !String(profileData?.first_name || '').trim() || !String(profileData?.last_name || '').trim();
                if (profileStillMissing) return;
                if (needPassengerLocation) {
                  props.navigation.replace('PassengerEnableLocation');
                } else if (needPassengerPhoneVerify) {
                  replaceWithPassengerPhoneVerification(props.navigation);
                } else {
                  replaceWithPassengerTabs(props.navigation);
                }
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
                if (needPassengerPhoneVerify) {
                  replaceWithPassengerPhoneVerification(props.navigation);
                } else {
                  replaceWithPassengerTabs(props.navigation);
                }
              }}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="PassengerIdentityVerificationOnboarding">
          {(props) => (
            <PassengerIdentityVerificationScreen
              {...props}
              route={{
                ...props.route,
                params: {
                  ...(props.route?.params || {}),
                  required: true,
                  nextRouteName: 'PassengerTabs',
                },
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
  const driverPhoneKnown = typeof driverStatus?.phoneVerified === 'boolean';
  const needDriverProfileCompletion = needsProfileCompletion;
  const profileStatus = String(profile?.status || '').trim().toLowerCase();
  const vehicleStatus = String(vehicle?.status || '').trim().toLowerCase();
  const profileApproved = profileStatus === 'approved' || profileStatus === 'verified';
  const vehicleApproved = vehicleStatus === 'approved' || vehicleStatus === 'verified';
  const needDriverEnhancedSelfie = profileApproved && !vehicleApproved && !profile?.selfieWithIdCardUrl && !driverSkippedEnhancedSelfie;

  const hasDriverSubmittedIdentityDocs = !!(
    profile &&
    (profile.nationalIdFrontUrl ||
      profile.nationalIdBackUrl ||
      profile.driverLicenceUrl ||
      profile.selfieUrl ||
      profile.selfieWithIdCardUrl)
  );
  const identityAwaitingAdminReview =
    !!profile && profileStatus === 'pending' && hasDriverSubmittedIdentityDocs;

  // Only force the document upload screen when the driver still needs to submit or resubmit — not when docs are already in review.
  const needDriverDocumentUpload =
    !profile ||
    (!profileApproved &&
      !identityAwaitingAdminReview &&
      (profileStatus === 'rejected' ||
        profileStatus === 'not_submitted' ||
        !String(profileStatus || '').trim() ||
        !hasDriverSubmittedIdentityDocs));

  // Avoid false verify-screen redirects when driver status is temporarily unavailable.
  const needPhoneVerify =
    driverPhoneKnown &&
    !phoneVerified &&
    !driverSkippedPhoneVerify;
  // Do not park drivers on the register screen while the vehicle is pending admin review (same idea as identity docs in review).
  const needVehicle =
    profileApproved &&
    (!vehicle || (!vehicleApproved && vehicleStatus !== 'pending'));
  const canGoOnline = profileApproved && vehicleApproved;

  if (!driverStatusHydrated || driverLoading) {
    return <SplashScreen />;
  }

  const initialRoute = canGoOnline
        ? 'DriverTabs'
      : needDriverProfileCompletion
        ? 'DriverCompleteProfile'
      : needPhoneVerify
        ? 'DriverVerifyPhone'
      : needDriverEnhancedSelfie
        ? 'DriverEnhancedSelfie'
        : needDriverDocumentUpload
          ? 'DriverUploadDocuments'
          : needVehicle
            ? 'DriverRegisterCar'
            : 'DriverTabs';

  return (
    <DriverStatusProvider
      value={{
        driverStatus,
        refetchDriverStatus,
        patchDriverStatus,
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
                    : needPhoneVerify
                      ? 'DriverVerifyPhone'
                      : needDriverEnhancedSelfie
                        ? 'DriverEnhancedSelfie'
                        : needDriverDocumentUpload
                          ? 'DriverUploadDocuments'
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
  const { isLoaded, isSignedIn } = useAuth();
  const { setInviteFromToken, hydrateStoredInvite } = useAgentInvite();
  const pendingInviteNavigationRef = useRef(null);
  const [currentRouteName, setCurrentRouteName] = useState(null);

  const syncCurrentRouteName = useCallback(() => {
    try {
      setCurrentRouteName(navigationRef.getCurrentRoute?.()?.name || null);
    } catch {
      setCurrentRouteName(null);
    }
  }, []);

  const navigateToOnboardingIfAvailable = useCallback((target) => {
    if (!navigationRef.isReady()) return false;
    const routeName = target === 'passenger' ? 'PassengerOnboarding' : 'DriverOnboarding';
    const rootState = navigationRef.getRootState?.();
    const routeNames = Array.isArray(rootState?.routeNames) ? rootState.routeNames : [];
    if (!routeNames.includes(routeName)) return false;
    navigationRef.navigate(routeName);
    return true;
  }, []);

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
      const target = looksLikePassengerSignup ? 'passenger' : 'driver';
      if (!isSignedIn && !navigateToOnboardingIfAvailable(target)) {
        pendingInviteNavigationRef.current = target;
      }
      return true;
    } catch {
      return false;
    }
  }, [isSignedIn, navigateToOnboardingIfAvailable, setInviteFromToken]);

  useEffect(() => {
    console.log('[AppContent] auth state:', { isLoaded, isSignedIn, rendering: !isLoaded ? 'AuthStack' : isSignedIn ? 'AppStack' : 'AuthStack' });
  }, [isLoaded, isSignedIn]);

  // Avoid hard auto-logout on a single backend 401. Mobile networks can briefly
  // return transient auth errors while Clerk session is still valid.
  useEffect(() => {
    setApiAuthErrorHandler(() => {
      // Keep the current session and let individual screens handle request errors.
      // Clerk auth state will still move to signed-out naturally if the session is actually invalid.
    });
  }, []);

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
        syncCurrentRouteName();
        if (pendingInviteNavigationRef.current && !isSignedIn) {
          const pendingTarget = pendingInviteNavigationRef.current;
          if (navigateToOnboardingIfAvailable(pendingTarget)) {
            pendingInviteNavigationRef.current = null;
          }
        }
      }}
      onStateChange={syncCurrentRouteName}
    >
      <SafeAreaProvider>
        <KeyboardProvider>
          {!isLoaded ? <AuthStack /> : isSignedIn ? <AppStack currentRouteName={currentRouteName} /> : <AuthStack />}
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

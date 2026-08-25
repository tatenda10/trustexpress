import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, Alert, ActivityIndicator, Animated, Easing, ScrollView, Vibration, Linking, Modal, Image, Platform, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { Audio } from 'expo-av';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline } from '../../components/maps/MapViewCompat';
import IncomingRidePreviewMap from '../../components/driver/IncomingRidePreviewMap';
import * as Location from 'expo-location';
import { connectRealtime } from '../../realtime';
import { showLocalRideNotification, clearRideRequestNotifications } from '../../notifications';
import {
  acceptDriverRideRequest,
  cancelDriverCurrentRide,
  getDirectionsRoute,
  getDriverCurrentRide,
  getDriverMe,
  getDriverRideRequests,
  resolveUploadedMediaUrl,
  updateDriverAvailability,
} from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import { DRIVER_CANCELLATION_REASONS } from '../../constants/cancellationReasons';
import { useDriverStatus } from '../../context/DriverStatusContext';
import {
  canUseTripOverlay,
  getTripOverlaySupportInfo,
  isTripOverlaySupported,
  openTripOverlaySettings,
  showFullScreenRideRequest,
  updateTripOverlay,
} from '../../services/tripOverlay';
import {
  clearOverlayRideRequest,
  filterActiveRideRequests,
  markRideRequestDismissed,
  restoreRideRequestDismissal,
  setOverlayRideRequest,
  subscribeDriverRideOverlayState,
} from '../../services/driverRideOverlayState';

const DRIVER_ALERTS_ASKED_KEY = 'trust_express_asked_ride_alerts';
const REQUEST_REFRESH_INTERVAL_MS = 2500;
const CURRENT_RIDE_REFRESH_INTERVAL_MS = 15000;
const AVAILABILITY_TOGGLE_DEBOUNCE_MS = 2500;
const DB_UPDATE_INTERVAL_MS = 90000;
const DB_UPDATE_MIN_DISTANCE_KM = 0.3;
const FALLBACK_DRIVER_COORDINATE = { latitude: -20.1535, longitude: 28.5870 };
const INITIAL_REGION = {
  latitude: -20.1535,
  longitude: 28.5870,
  latitudeDelta: 0.18,
  longitudeDelta: 0.18,
};
const DRIVER_IDLE_REGION = { latitudeDelta: 0.05, longitudeDelta: 0.05 };
const DRIVER_KEEP_AWAKE_TAG = 'driver-home-online';
const INCOMING_RIDE_ALERT_INTERVAL_MS = 4500;
const MIN_ACCEPTABLE_REQUEST_SECONDS = 8;
const REQUEST_REAPPEAR_DELAY_MS = 5000;
const PRIORITY_DRIVER_DISTANCE_KM = 1.5;

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function calculateDistanceKm(start, end) {
  if (!start || !end) return 0;
  const earthRadiusKm = 6371;
  const dLat = toRadians(end.latitude - start.latitude);
  const dLng = toRadians(end.longitude - start.longitude);
  const lat1 = toRadians(start.latitude);
  const lat2 = toRadians(end.latitude);
  const a = (
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2)
  );
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function getRemainingSeconds(expiresAt, serverRemainingSeconds = null, capturedAtMs = null) {
  if (Number.isFinite(Number(serverRemainingSeconds)) && Number(serverRemainingSeconds) >= 0) {
    const base = Number(serverRemainingSeconds);
    if (!Number.isFinite(Number(capturedAtMs))) return Math.max(0, Math.floor(base));
    const elapsed = Math.max(0, Math.floor((Date.now() - Number(capturedAtMs)) / 1000));
    return Math.max(0, Math.floor(base) - elapsed);
  }
  if (!expiresAt) return 0;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

function formatCountdown(totalSeconds) {
  const safeSeconds = Math.max(0, Number(totalSeconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function buildRequestStopTimeline(request) {
  return [
    request?.pickup,
    ...(Array.isArray(request?.intermediateStops)
      ? request.intermediateStops.map((stop) => stop?.label).filter(Boolean)
      : []),
    request?.dropoff,
  ].filter(Boolean);
}

function getRequestNotificationBody(request) {
  const stopCount = Array.isArray(request?.intermediateStops) ? request.intermediateStops.length : 0;
  const pickup = String(request?.pickupLabel || request?.pickup || 'Pickup').trim();
  const dropoff = String(request?.dropoffLabel || request?.dropoff || 'Drop-off').trim();
  if (stopCount > 0) {
    return `${pickup} via ${stopCount} stop${stopCount === 1 ? '' : 's'} to ${dropoff}`;
  }
  return `${pickup} to ${dropoff}`;
}

function RequestStopsPreview({ request }) {
  const stopTimeline = buildRequestStopTimeline(request);
  const stopCount = Array.isArray(request?.intermediateStops) ? request.intermediateStops.length : 0;

  if (stopTimeline.length <= 2 || stopCount <= 0) return null;

  return (
    <View className="mt-4 rounded-[18px] border border-orange-100 bg-orange-50 px-4 py-3">
      <Text className="text-[11px] font-bold uppercase tracking-[1px] text-orange-700">
        This is a multi-stop trip
      </Text>
      <Text className="mt-1 text-sm font-medium text-orange-900">
        {stopCount} stop{stopCount === 1 ? '' : 's'} before the final destination
      </Text>
      <View className="mt-3">
        {stopTimeline.map((label, index) => {
          const isPickup = index === 0;
          const isDropoff = index === stopTimeline.length - 1;
          const dotColor = isPickup ? '#2563eb' : isDropoff ? '#111827' : '#f97316';
          return (
            <View key={`${label}-${index}`} className="mb-2 flex-row items-start">
              <View className="mr-3 mt-1 h-3 w-3 rounded-full" style={{ backgroundColor: dotColor }} />
              <View className="flex-1">
                <Text className="text-sm font-semibold text-gray-900">
                  {isPickup ? 'Pickup' : isDropoff ? 'Final destination' : `Stop ${index}`}
                </Text>
                <Text className="mt-0.5 text-sm text-gray-600">{label}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** Open Location Code style names Android often returns from reverse geocode (e.g. 428R+4V9). */
function looksLikePlusCode(value) {
  const text = String(value || '').trim().replace(/\s+/g, '');
  if (!text || !text.includes('+')) return false;
  return /^[0-9A-Z]{4,}\+[0-9A-Z]{2,}$/i.test(text);
}

function stripLeadingPlusCodeFromLabel(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  let prev;
  do {
    prev = s;
    const m = s.match(/^([0-9A-Z]{4,}\+[0-9A-Z]{2,})\s*,?\s*/i);
    if (m) s = s.slice(m[0].length).trim();
  } while (s !== prev);
  return s;
}

/** Remove OLC tokens that appear inside a segment (e.g. "Mall, 428R+4V9" or "Stop near 428R+4V9"). */
function stripEmbeddedOpenLocationCodes(raw) {
  let s = String(raw || '')
    .replace(/\b[0-9A-Z]{4,}\+[0-9A-Z]{2,}\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*(,\s*)+/g, ', ')
    .trim();
  s = s.replace(/^,\s*|\s*,$/g, '').trim();
  return s;
}

/** Drop / trim plus-code garbage so we never show "428R+4V9" as the primary location name. */
function cleanLocationLabelCandidate(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (looksLikePlusCode(s.replace(/\s+/g, ''))) return null;

  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  const kept = parts.filter((p) => !looksLikePlusCode(p));
  s = kept.join(', ');
  s = stripLeadingPlusCodeFromLabel(s);
  s = stripEmbeddedOpenLocationCodes(s);
  s = s.trim();
  if (!s) return null;
  const firstSeg = s.split(',')[0].trim().replace(/\s+/g, '');
  if (looksLikePlusCode(firstSeg)) {
    s = stripLeadingPlusCodeFromLabel(s);
    s = stripEmbeddedOpenLocationCodes(s).trim();
  }
  if (!s) return null;
  const first2 = s.split(',')[0].trim().replace(/\s+/g, '');
  if (looksLikePlusCode(first2)) return null;
  return s.trim();
}

function getAvailabilityErrorMessage(nextOnline, error) {
  if (error?.status === 429) {
    return 'Too many requests right now. Please wait a moment and try again.';
  }
  if (error?.status === 0) {
    return 'We could not reach the server. Please check your connection and try again.';
  }

  const rawMessage = String(error?.message || '').trim();
  if (!rawMessage) {
    return nextOnline
      ? 'We could not put you online right now. Please try again.'
      : 'We could not update your availability right now. Please try again.';
  }
  return rawMessage;
}

async function fetchNicePlaceLabel(coordinate) {
  if (!coordinate) return null;

  try {
    const places = await Location.reverseGeocodeAsync(coordinate);
    const place = places?.[0];
    if (!place) return null;

    const safeName = looksLikePlusCode(place.name) ? null : place.name;
    const street = [place.streetNumber, place.street].filter(Boolean).join(' ').trim();
    const parts = [
      street,
      safeName,
      place.district,
      place.subregion,
      place.city,
    ].filter(Boolean);

    return cleanLocationLabelCandidate(parts.slice(0, 3).join(', '));
  } catch {
    return null;
  }
}

async function fetchRouteCoordinates(token, origin, destination) {
  if (!token || !origin || !destination) {
    return null;
  }
  const startLat = Number(origin.latitude);
  const startLng = Number(origin.longitude);
  const endLat = Number(destination.latitude);
  const endLng = Number(destination.longitude);
  if (
    !Number.isFinite(startLat) ||
    !Number.isFinite(startLng) ||
    !Number.isFinite(endLat) ||
    !Number.isFinite(endLng)
  ) {
    return null;
  }

  const data = await getDirectionsRoute(token, {
    origin: { latitude: startLat, longitude: startLng },
    destination: { latitude: endLat, longitude: endLng },
    cachePrecision: 3,
    cacheTtlSeconds: 600,
  });
  const coordinates = data?.route?.coordinates;
  return Array.isArray(coordinates) && coordinates.length > 1 ? coordinates : null;
}

const DriverHomeScreen = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const { patchDriverStatus } = useDriverStatus();
  const getTokenRef = useRef(getToken);
  const isFocused = useIsFocused();
  const [isOnline, setIsOnline] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showNewRequestBadge, setShowNewRequestBadge] = useState(false);
  const [activeRequest, setActiveRequest] = useState(null);
  const [availableRequests, setAvailableRequests] = useState([]);
  const [loadingAvailability, setLoadingAvailability] = useState(true);
  const [availabilityActionPending, setAvailabilityActionPending] = useState(false);
  const [walletStatus, setWalletStatus] = useState({
    availableBalance: 0,
    minimumRequiredBalance: 1,
    paymentsEnabled: false,
    sufficientBalance: true,
    lowBalanceMessage: '',
  });
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [acceptingRideId, setAcceptingRideId] = useState(null);
  const [dismissedRequestIds, setDismissedRequestIds] = useState([]);
  const prevRequestCountRef = useRef(0);
  const [driverCoordinate, setDriverCoordinate] = useState(FALLBACK_DRIVER_COORDINATE);
  const [locationLabel, setLocationLabel] = useState('');
  const [currentRide, setCurrentRide] = useState(null);
  const [pendingSelectionRide, setPendingSelectionRide] = useState(null);
  const pulse = useRef(new Animated.Value(0)).current;
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [tripRouteCoordinates, setTripRouteCoordinates] = useState([]);
  const [cancellingCurrentRide, setCancellingCurrentRide] = useState(false);
  const [showCancelReasonModal, setShowCancelReasonModal] = useState(false);
  const [showIncomingRideOverlay, setShowIncomingRideOverlay] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const [mapRegion, setMapRegion] = useState(INITIAL_REGION);
  const [realtimeSignal, setRealtimeSignal] = useState(0);
  const idleLocationWatcherRef = useRef(null);
  const incomingRideSoundRef = useRef(null);
  const incomingAlertTimerRef = useRef(null);
  const incomingAlertInFlightRef = useRef(false);
  const locationWatcherRef = useRef(null);
  const locationSyncInFlightRef = useRef(false);
  const manualAvailabilityRequestRef = useRef(null);
  const availabilityLoadInFlightRef = useRef(false);
  const currentRideLoadInFlightRef = useRef(false);
  const currentRideRefreshQueuedRef = useRef(false);
  const requestLoadInFlightRef = useRef(false);
  const overlayPermissionPromptOpenRef = useRef(false);
  const forceOpenIncomingOverlayRef = useRef(false);
  const pendingNotificationRideRequestIdRef = useRef(null);
  const pendingNotificationActionRef = useRef(null);
  const acceptRequestHandlerRef = useRef(null);
  const lastAvailabilityAttemptRef = useRef({ target: null, at: 0 });
  const forwardedRideIdRef = useRef(null);
  const lastDbLocationRef = useRef({ coordinate: null, at: 0 });
  const lastLabelFetchRef = useRef({ coordinate: null, at: 0 });
  const LABEL_UPDATE_INTERVAL_MS = 120000; // at most every 2 minutes
  const LABEL_UPDATE_MIN_DISTANCE_KM = 0.3; // or every ~300m
  const placeLabelCacheRef = useRef(new Map());
  const hiddenRequestUntilRef = useRef(new Map());
  const suppressTripAutoOpenUntilRef = useRef(0);

  useEffect(() => {
    const until = Number(route?.params?.suppressTripAutoOpenUntil || 0);
    if (Number.isFinite(until) && until > 0) {
      suppressTripAutoOpenUntilRef.current = Math.max(suppressTripAutoOpenUntilRef.current, until);
    }
  }, [route?.params?.suppressTripAutoOpenUntil]);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const loadCurrentRide = useCallback(async ({ allowQueue = true } = {}) => {
    if (currentRideLoadInFlightRef.current) {
      if (allowQueue) currentRideRefreshQueuedRef.current = true;
      return;
    }

    currentRideLoadInFlightRef.current = true;
    try {
      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      const data = await getDriverCurrentRide(token);
      setCurrentRide(data?.ride || null);
      patchDriverStatus({ currentRide: data?.ride || null });
      if (data?.ride) {
        setPendingSelectionRide(null);
      }
      if (data?.ride?.driverCoordinate) {
        setDriverCoordinate(data.ride.driverCoordinate);
      }
    } catch {
      setCurrentRide(null);
    } finally {
      currentRideLoadInFlightRef.current = false;
      if (currentRideRefreshQueuedRef.current) {
        currentRideRefreshQueuedRef.current = false;
        setTimeout(() => {
          loadCurrentRide({ allowQueue: false }).catch(() => {});
        }, 0);
      }
    }
  }, [patchDriverStatus]);

  useEffect(() => {
    if (!isFocused) return undefined;
    let active = true;
    let localSocket = null;

    const initRealtime = async () => {
      try {
        const token = await getTokenRef.current();
        if (!active || !token) return;
        localSocket = connectRealtime(token);
        if (!localSocket) return;

        const handleRealtimeRefresh = (payload = {}) => {
          if (!active) return;
          const removedRideRequestId = Number(payload?.rideRequestId || 0);
          if (removedRideRequestId && Number(pendingSelectionRide?.id || 0) === removedRideRequestId) {
            setPendingSelectionRide(null);
          }
          setRealtimeSignal((current) => current + 1);

          const nextStatus = String(payload?.status || '').toLowerCase();
          if (nextStatus === 'driver_assigned' || nextStatus === 'driver_arrived' || nextStatus === 'in_progress') {
            loadCurrentRide().catch(() => {});
          }
        };

        const handleDriverRating = (payload = {}) => {
          if (!active) return;
          if (payload.type === 'tip') {
            const tipAmount = Number(payload.tipAmount || 0);
            Alert.alert(
              'New Passenger Tip',
              `You received a $${tipAmount.toFixed(2)} tip for this trip.`
            );
            return;
          }
          const ratingValue = Number(payload.rating || 0);
          Alert.alert(
            'New Trip Rating',
            `You got ${ratingValue || 'a new'} star${ratingValue === 1 ? '' : 's'} for this trip.`
          );
        };

        localSocket.on('ride_request:new', handleRealtimeRefresh);
        localSocket.on('ride_request:removed', handleRealtimeRefresh);
        localSocket.on('driver_ride:updated', handleRealtimeRefresh);
        localSocket.on('driver_rating:received', handleDriverRating);

        localSocket.__driverHomeCleanup = () => {
          localSocket.off('ride_request:new', handleRealtimeRefresh);
          localSocket.off('ride_request:removed', handleRealtimeRefresh);
          localSocket.off('driver_ride:updated', handleRealtimeRefresh);
          localSocket.off('driver_rating:received', handleDriverRating);
        };
      } catch {
        // Keep polling as the fallback when realtime setup fails.
      }
    };

    initRealtime();

    return () => {
      active = false;
      localSocket?.__driverHomeCleanup?.();
    };
  }, [isFocused, loadCurrentRide, pendingSelectionRide?.id]);

  useEffect(() => {
    const shouldKeepAwake = isOnline || !!currentRide || !!pendingSelectionRide;
    if (shouldKeepAwake) {
      activateKeepAwakeAsync(DRIVER_KEEP_AWAKE_TAG).catch(() => {});
    } else {
      deactivateKeepAwake(DRIVER_KEEP_AWAKE_TAG);
    }

    return () => {
      deactivateKeepAwake(DRIVER_KEEP_AWAKE_TAG);
    };
  }, [currentRide, isOnline, pendingSelectionRide]);

  useEffect(() => {
    if (route?.params?.openIncomingRideOverlay || route?.params?.notificationAction) {
      forceOpenIncomingOverlayRef.current = true;
      const notificationRideRequestId = Number(route?.params?.notificationRideRequestId || 0);
      const notificationAction = String(route?.params?.notificationAction || '').toLowerCase();
      if (Number.isInteger(notificationRideRequestId) && notificationRideRequestId > 0) {
        pendingNotificationRideRequestIdRef.current = notificationRideRequestId;
      }
      if (notificationAction === 'accept' || notificationAction === 'decline' || notificationAction === 'open') {
        pendingNotificationActionRef.current = notificationAction;
      }
      if (notificationAction === 'decline' && Number.isInteger(notificationRideRequestId) && notificationRideRequestId > 0) {
        markRideRequestDismissed(notificationRideRequestId);
        setDismissedRequestIds((current) => [...new Set([...current, notificationRideRequestId])]);
        clearOverlayRideRequest();
        hiddenRequestUntilRef.current.set(notificationRideRequestId, Date.now() + REQUEST_REAPPEAR_DELAY_MS);
        setTimeout(() => {
          restoreRideRequestDismissal(notificationRideRequestId);
          setDismissedRequestIds((current) => current.filter((item) => item !== notificationRideRequestId));
        }, REQUEST_REAPPEAR_DELAY_MS);
        updateTripOverlay({
          variant: 'online',
          title: 'Trust Express',
          subtitle: 'Online - Ready for rides',
        }).catch(() => {});
        setShowIncomingRideOverlay(false);
      } else if (!currentRide && availableRequests.length > 0) {
        const matchedRequest = Number.isInteger(notificationRideRequestId) && notificationRideRequestId > 0
          ? availableRequests.find((request) => Number(request.id) === notificationRideRequestId)
          : null;
        if (matchedRequest) {
          setActiveRequest(matchedRequest);
        }
        if (notificationAction !== 'decline') {
          setShowIncomingRideOverlay(true);
        }
      }
      navigation.setParams?.({
        openIncomingRideOverlay: false,
        notificationRideRequestId: undefined,
        notificationAction: undefined,
        notificationTs: route?.params?.notificationTs || undefined,
      });
    }
  }, [availableRequests, currentRide, navigation, route?.params?.notificationAction, route?.params?.notificationRideRequestId, route?.params?.notificationTs, route?.params?.openIncomingRideOverlay]);

  useEffect(() => {
    const unsubscribe = subscribeDriverRideOverlayState((state) => {
      const ids = Array.isArray(state?.dismissedRideRequestIds) ? state.dismissedRideRequestIds : [];
      if (!ids.length) return;
      setDismissedRequestIds((current) => {
        const merged = [...new Set([...current, ...ids])];
        return merged.length === current.length ? current : merged;
      });
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isFocused) return;
    if (!currentRide?.id) {
      forwardedRideIdRef.current = null;
      return;
    }
    if (Date.now() < suppressTripAutoOpenUntilRef.current) {
      return;
    }
    if (forwardedRideIdRef.current === currentRide.id) return;

    forwardedRideIdRef.current = currentRide.id;
    navigation.navigate('DriverTrip', { initialRide: currentRide });
  }, [currentRide, isFocused, navigation]);

  // One-time prompt: ask driver to enable sound/vibration for ride request alerts
  useEffect(() => {
    if (!isFocused) return undefined;
    let cancelled = false;
    AsyncStorage.getItem(DRIVER_ALERTS_ASKED_KEY).then((value) => {
      if (cancelled || value === 'true') return;
      Alert.alert(
        'Ride request alerts',
        'To hear and feel new ride requests, allow notifications and ensure sound is on. You can change this in your device settings.',
        [
          { text: 'OK', onPress: () => AsyncStorage.setItem(DRIVER_ALERTS_ASKED_KEY, 'true') },
          { text: 'Open Settings', onPress: () => {
            AsyncStorage.setItem(DRIVER_ALERTS_ASKED_KEY, 'true');
            Linking.openSettings();
          } },
        ]
      );
    });
    return () => { cancelled = true; };
  }, [isFocused, realtimeSignal]);

  useEffect(() => {
    let cancelled = false;
    const initRegion = async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (cancelled || permission.status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        setDriverCoordinate({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setMapRegion({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          ...DRIVER_IDLE_REGION,
        });
        const pretty = cleanLocationLabelCandidate(
          await fetchNicePlaceLabel({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
        );
        if (!cancelled && pretty) setLocationLabel(pretty);
      } catch {
        // ignore
      }
    };
    initRegion();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let active = true;

    const loadAvailability = async () => {
      if (availabilityLoadInFlightRef.current) return;
      availabilityLoadInFlightRef.current = true;
      try {
        const token = await getTokenRef.current();
        if (!token) throw new Error('Not signed in');
        const data = await getDriverMe(token, { suppressAuthErrorHandler: true });
        if (!active) return;

        setIsOnline(!!data?.availability?.isOnline);
        setWalletStatus({
          availableBalance: Number(data?.wallet?.availableBalance || 0),
          minimumRequiredBalance: Number(data?.wallet?.minimumRequiredBalance || 1),
          paymentsEnabled: data?.wallet?.paymentsEnabled === true,
          sufficientBalance: data?.wallet?.sufficientBalance !== false,
          lowBalanceMessage: data?.wallet?.lowBalanceMessage || '',
        });
        if (Number.isFinite(data?.availability?.latitude) && Number.isFinite(data?.availability?.longitude)) {
          const coords = {
            latitude: Number(data.availability.latitude),
            longitude: Number(data.availability.longitude),
          };
          setDriverCoordinate(coords);
          setMapRegion((prev) => ({
            ...prev,
            latitude: coords.latitude,
            longitude: coords.longitude,
            latitudeDelta: prev.latitudeDelta || DRIVER_IDLE_REGION.latitudeDelta,
            longitudeDelta: prev.longitudeDelta || DRIVER_IDLE_REGION.longitudeDelta,
          }));
          // Ensure we show a name instead of raw coordinates.
          const cacheKey = `${coords.latitude.toFixed(3)},${coords.longitude.toFixed(3)}`;
          const cached = placeLabelCacheRef.current.get(cacheKey);
          const cachedGood = cleanLocationLabelCandidate(cached);
          if (cachedGood) {
            setLocationLabel(cachedGood);
          } else if (cached) {
            placeLabelCacheRef.current.delete(cacheKey);
          }
          if (!cachedGood) {
            fetchNicePlaceLabel(coords).then((raw) => {
              const pretty = cleanLocationLabelCandidate(raw);
              if (pretty) {
                placeLabelCacheRef.current.set(cacheKey, pretty);
                setLocationLabel(pretty);
              }
            }).catch(() => {});
          }
        }
      } catch (error) {
        if (!active) return;
        setIsOnline(false);
      } finally {
        availabilityLoadInFlightRef.current = false;
        if (active) setLoadingAvailability(false);
      }
    };

    loadAvailability();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isFocused) return undefined;
    let active = true;

    const loadCurrentRideWithGuard = async () => {
      if (!active) return;
      await loadCurrentRide();
    };

    loadCurrentRideWithGuard();
    if (!currentRide?.id && !pendingSelectionRide) {
      return () => {
        active = false;
      };
    }

    const interval = setInterval(() => {
      loadCurrentRideWithGuard();
    }, CURRENT_RIDE_REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [currentRide?.id, isFocused, loadCurrentRide, pendingSelectionRide]);

  useEffect(() => {
    if (!isOnline) {
      setIsListening(false);
      setShowNewRequestBadge(false);
      setActiveRequest(null);
      setAvailableRequests([]);
      setShowIncomingRideOverlay(false);
      clearRideRequestNotifications().catch(() => {});
      setDismissedRequestIds((current) => (current.length ? [] : current));
      prevRequestCountRef.current = 0;
      return undefined;
    }

    let active = true;

    const loadRequests = async (initialLoad = false) => {
      if (requestLoadInFlightRef.current) return;
      requestLoadInFlightRef.current = true;
      try {
        if (initialLoad) {
          setLoadingRequests(true);
          setIsListening(true);
          setShowNewRequestBadge(false);
        }

        const token = await getTokenRef.current();
        if (!token) throw new Error('Not signed in');
        const data = await getDriverRideRequests(token);
        if (!active) return;

        const nextListRaw = filterActiveRideRequests(
          Array.isArray(data?.requests)
            ? data.requests.filter((request) => {
                const hiddenUntil = Number(hiddenRequestUntilRef.current.get(request.id) || 0);
                return !dismissedRequestIds.includes(request.id) && hiddenUntil <= Date.now();
              })
            : []
        );
        const serverCapturedAt = Date.now();
        const nextList = nextListRaw
          .map((request) => ({
            ...request,
            remainingSecondsCapturedAt: serverCapturedAt,
          }))
          .filter((request) => {
            if (!request?.expiresAt) return true;
            const remaining = getRemainingSeconds(
              request?.expiresAt,
              request?.remainingSeconds,
              request?.remainingSecondsCapturedAt,
            );
            if (remaining < 1) {
              hiddenRequestUntilRef.current.set(request.id, Date.now() + REQUEST_REAPPEAR_DELAY_MS);
              return false;
            }
            return remaining >= MIN_ACCEPTABLE_REQUEST_SECONDS;
          });
        const nextRequest = nextList[0] || null;

        const prevCount = prevRequestCountRef.current;
        if (!initialLoad && nextList.length > prevCount && prevCount >= 0) {
          try {
            Vibration.vibrate([200, 100, 200]);
          } catch (_) {}
          try {
            const newestRequest = nextList[0];
            const notificationBody = newestRequest
              ? getRequestNotificationBody(newestRequest)
              : 'A new ride request is waiting for you.';
            setOverlayRideRequest(newestRequest);
            await showLocalRideNotification({
              title: 'New ride request',
              body: notificationBody,
              priorityType: Number(newestRequest?.driverDistanceKm || 0) <= PRIORITY_DRIVER_DISTANCE_KM ? 'priority' : 'standard',
              data: {
                type: 'driver_new_ride_request',
                rideRequestId: newestRequest?.id || null,
                publicId: newestRequest?.publicId || null,
                pickupLabel: newestRequest?.pickup || newestRequest?.pickupLabel || null,
                dropoffLabel: newestRequest?.dropoff || newestRequest?.dropoffLabel || null,
                priorityType: Number(newestRequest?.driverDistanceKm || 0) <= PRIORITY_DRIVER_DISTANCE_KM ? 'priority' : 'standard',
              },
            });
            if (AppState.currentState !== 'active' && Platform.OS === 'android') {
              const requestPayload = {
                title: 'New ride request',
                body: notificationBody,
                subtitle: notificationBody,
                pickupLabel: newestRequest?.pickup || newestRequest?.pickupLabel || '',
                dropoffLabel: newestRequest?.dropoff || newestRequest?.dropoffLabel || '',
                estimatedAmount: newestRequest?.estimatedAmount,
                rideRequestId: newestRequest?.id || null,
                variant: 'request',
              };
              const updated = await updateTripOverlay(requestPayload).catch(() => false);
              if (!updated) {
                await showFullScreenRideRequest(requestPayload);
              }
            }
          } catch (_) {}
        }
        prevRequestCountRef.current = nextList.length;

        setAvailableRequests(nextList);
        if (nextList.length === 0) {
          clearRideRequestNotifications().catch(() => {});
        }
        if (nextList[0]) {
          setOverlayRideRequest(nextList[0]);
        } else {
          clearOverlayRideRequest();
          updateTripOverlay({
            variant: 'online',
            title: 'Trust Express',
            subtitle: 'Online - Ready for rides',
          }).catch(() => {});
        }
        // Keep requests in the list UI; avoid auto popup duplicate with top notification banner.
        setActiveRequest((current) => {
          if (current) {
            const refreshedCurrent = nextList.find((request) => request.id === current.id);
            if (refreshedCurrent) {
              return refreshedCurrent;
            }
          }
          return nextRequest;
        });
        const notificationRideRequestId = Number(pendingNotificationRideRequestIdRef.current || 0);
        const notificationAction = String(pendingNotificationActionRef.current || '').toLowerCase();
        if (forceOpenIncomingOverlayRef.current && !currentRide && !pendingSelectionRide) {
          if (Number.isInteger(notificationRideRequestId) && notificationRideRequestId > 0) {
            const matchedRequest = nextList.find((request) => Number(request.id) === notificationRideRequestId);
            if (matchedRequest) {
              setActiveRequest(matchedRequest);
              if (notificationAction === 'accept') {
                setShowIncomingRideOverlay(false);
                acceptRequestHandlerRef.current?.(matchedRequest);
              } else if (notificationAction !== 'decline') {
                setShowIncomingRideOverlay(true);
              }
            } else {
              setShowIncomingRideOverlay(false);
              setShowNewRequestBadge(false);
            }
          } else if (nextRequest) {
            setShowIncomingRideOverlay(true);
          } else {
            setShowIncomingRideOverlay(false);
            setShowNewRequestBadge(false);
          }
          forceOpenIncomingOverlayRef.current = false;
          pendingNotificationRideRequestIdRef.current = null;
          pendingNotificationActionRef.current = null;
        } else if (!nextRequest) {
          setShowIncomingRideOverlay(false);
        }
        setShowNewRequestBadge(nextList.length > 0);
        setIsListening(!nextRequest);
      } catch (error) {
        if (!active) return;
        setActiveRequest(null);
        setAvailableRequests([]);
        setShowIncomingRideOverlay(false);
        setShowNewRequestBadge(false);
        setIsListening(true);
      } finally {
        requestLoadInFlightRef.current = false;
        if (active) setLoadingRequests(false);
      }
    };

    loadRequests(true);
    const interval = setInterval(() => {
      loadRequests(false);
    }, REQUEST_REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [dismissedRequestIds, isOnline, realtimeSignal]);

  useEffect(() => {
    const shouldAlertForIncomingRide =
      isFocused &&
      isOnline &&
      !currentRide &&
      !pendingSelectionRide &&
      availableRequests.length > 0;

    const playIncomingAlert = async () => {
      if (incomingAlertInFlightRef.current) return;
      incomingAlertInFlightRef.current = true;
      try {
        try {
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            playsInSilentModeIOS: true,
            staysActiveInBackground: true,
            shouldDuckAndroid: false,
            playThroughEarpieceAndroid: false,
          });
        } catch {
          // Continue even if audio mode cannot be changed.
        }
        if (!incomingRideSoundRef.current) {
          const { sound } = await Audio.Sound.createAsync(
            require('../../assets/notificationaudio.mpeg'),
            { shouldPlay: false, volume: 1.0, isLooping: false },
          );
          incomingRideSoundRef.current = sound;
        }

        const sound = incomingRideSoundRef.current;
        if (sound) {
          await sound.setVolumeAsync(1.0);
          await sound.replayAsync();
        }
        Vibration.vibrate([0, 500, 180, 500, 180, 500]);
      } catch {
        // Keep request flow working even if audio playback fails.
      } finally {
        incomingAlertInFlightRef.current = false;
      }
    };

    const stopIncomingAlert = async () => {
      if (incomingAlertTimerRef.current) {
        clearInterval(incomingAlertTimerRef.current);
        incomingAlertTimerRef.current = null;
      }
      try {
        if (incomingRideSoundRef.current) {
          await incomingRideSoundRef.current.stopAsync();
          await incomingRideSoundRef.current.unloadAsync();
        }
      } catch {
        // ignore cleanup failures
      } finally {
        incomingRideSoundRef.current = null;
      }
      Vibration.cancel();
    };

    if (shouldAlertForIncomingRide) {
      playIncomingAlert();
      if (!incomingAlertTimerRef.current) {
        incomingAlertTimerRef.current = setInterval(playIncomingAlert, INCOMING_RIDE_ALERT_INTERVAL_MS);
      }
    } else {
      stopIncomingAlert();
    }

    return () => {
      stopIncomingAlert();
    };
  }, [availableRequests.length, currentRide, isFocused, isOnline, pendingSelectionRide]);

  useEffect(() => {
    if (!isOnline || activeRequest || currentRide || pendingSelectionRide) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return undefined;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1600,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1600,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();

    return () => {
      loop.stop();
      pulse.setValue(0);
    };
  }, [activeRequest, currentRide, isOnline, pendingSelectionRide, pulse]);

  const statusLabel = useMemo(() => {
    if (currentRide?.stage === 'waiting_for_customer') return 'Waiting for customer';
    if (currentRide?.stage === 'on_trip') return 'Trip in progress';
    if (currentRide?.stage === 'to_pickup') return 'Driving to pickup';
    if (pendingSelectionRide) return 'Waiting for passenger selection';
    if (!isOnline) return 'Currently offline';
    if (activeRequest || availableRequests.length > 0) return 'Incoming ride request(s)';
    return 'Online';
  }, [activeRequest, currentRide, isOnline, pendingSelectionRide]);

  const outerRingScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.28],
  });

  const outerRingOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.05],
  });

  const innerRingScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.14],
  });

  const innerRingOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.22, 0.08],
  });

  const activeRequestCountdown = useMemo(
    () => formatCountdown(getRemainingSeconds(
      activeRequest?.expiresAt,
      activeRequest?.remainingSeconds,
      activeRequest?.remainingSecondsCapturedAt,
    )),
    [activeRequest?.expiresAt, activeRequest?.remainingSeconds, activeRequest?.remainingSecondsCapturedAt, nowTick]
  );

  const primaryIncomingRequest = useMemo(
    () => activeRequest || availableRequests[0] || null,
    [activeRequest, availableRequests],
  );

  const showRideRequestModal = Boolean(
    showIncomingRideOverlay && !currentRide && availableRequests.length > 0 && primaryIncomingRequest,
  );

  // Stable routing keys so polling does not re-hit directions every few seconds.
  const routingPickupKey = [
    primaryIncomingRequest?.id || '',
    primaryIncomingRequest?.pickupCoordinate?.latitude,
    primaryIncomingRequest?.pickupCoordinate?.longitude,
    Number(driverCoordinate?.latitude)?.toFixed?.(4),
    Number(driverCoordinate?.longitude)?.toFixed?.(4),
  ].join(':');

  const routingTripKey = [
    primaryIncomingRequest?.id || '',
    primaryIncomingRequest?.pickupCoordinate?.latitude,
    primaryIncomingRequest?.pickupCoordinate?.longitude,
    primaryIncomingRequest?.dropoffCoordinate?.latitude,
    primaryIncomingRequest?.dropoffCoordinate?.longitude,
  ].join(':');

  const activeIncomingRequestIndex = useMemo(() => {
    if (!primaryIncomingRequest) return 0;
    const index = availableRequests.findIndex((request) => request.id === primaryIncomingRequest.id);
    return index >= 0 ? index : 0;
  }, [availableRequests, primaryIncomingRequest]);

  const cycleToNextIncomingRequest = () => {
    if (availableRequests.length <= 1) return;
    const currentIndex = availableRequests.findIndex((request) => request.id === primaryIncomingRequest?.id);
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % availableRequests.length;
    setActiveRequest(availableRequests[nextIndex]);
  };

  useEffect(() => {
    if (!pendingSelectionRide || currentRide?.id) return;
    const offerExpiresAt = pendingSelectionRide.offerExpiresAt || pendingSelectionRide.expiresAt;
    if (
      getRemainingSeconds(
        offerExpiresAt,
        pendingSelectionRide?.remainingSeconds,
        pendingSelectionRide?.remainingSecondsCapturedAt,
      ) > 0
    ) return;

    setPendingSelectionRide(null);
  }, [currentRide?.id, nowTick, pendingSelectionRide]);

  // Load a route for the current ride or active request from the backend map provider.
  useEffect(() => {
    if (currentRide) {
      const origin = currentRide.driverCoordinate || driverCoordinate;
      const destination =
        currentRide.stage === 'on_trip' ? currentRide.dropoffCoordinate : currentRide.pickupCoordinate;

      if (!origin || !destination) {
        setRouteCoordinates([]);
        return undefined;
      }

      let cancelled = false;
      const loadRoute = async () => {
        try {
          const token = await getTokenRef.current();
          const coords = await fetchRouteCoordinates(token, origin, destination);
          if (cancelled) return;
          setRouteCoordinates(
            Array.isArray(coords) && coords.length > 1 ? coords : [origin, destination],
          );
        } catch {
          if (cancelled) return;
          setRouteCoordinates([origin, destination]);
        }
      };
      loadRoute();
      return () => {
        cancelled = true;
      };
    }

    const requestForRoute = primaryIncomingRequest;
    const origin = driverCoordinate;
    const destination = requestForRoute?.pickupCoordinate;

    if (!requestForRoute || !origin || !destination) {
      setRouteCoordinates([]);
      return undefined;
    }

    let cancelled = false;
    const loadRoute = async () => {
      try {
        const token = await getTokenRef.current();
        const coords = await fetchRouteCoordinates(token, origin, destination);
        if (cancelled) return;
        setRouteCoordinates(
          Array.isArray(coords) && coords.length > 1 ? coords : [origin, destination],
        );
      } catch {
        if (cancelled) return;
        setRouteCoordinates([origin, destination]);
      }
    };

    loadRoute();
    return () => {
      cancelled = true;
    };
  }, [
    currentRide?.id,
    currentRide?.stage,
    currentRide?.driverCoordinate?.latitude,
    currentRide?.driverCoordinate?.longitude,
    currentRide?.pickupCoordinate?.latitude,
    currentRide?.pickupCoordinate?.longitude,
    currentRide?.dropoffCoordinate?.latitude,
    currentRide?.dropoffCoordinate?.longitude,
    routingPickupKey,
  ]);

  // Pickup → drop-off trip path for the incoming-request map preview.
  useEffect(() => {
    if (currentRide) {
      setTripRouteCoordinates([]);
      return undefined;
    }

    const request = primaryIncomingRequest;
    const origin = request?.pickupCoordinate;
    const destination = request?.dropoffCoordinate;

    if (!request || !origin || !destination) {
      setTripRouteCoordinates([]);
      return undefined;
    }

    let cancelled = false;

    const loadTripRoute = async () => {
      try {
        const token = await getTokenRef.current();
        const coords = await fetchRouteCoordinates(token, origin, destination);
        if (cancelled) return;
        setTripRouteCoordinates(
          Array.isArray(coords) && coords.length > 1 ? coords : [origin, destination],
        );
      } catch {
        if (cancelled) return;
        setTripRouteCoordinates([origin, destination]);
      }
    };

    loadTripRoute();

    return () => {
      cancelled = true;
    };
  }, [currentRide?.id, routingTripKey]);

  const syncAvailability = async (nextOnline) => {
    const inFlight = manualAvailabilityRequestRef.current;
    if (inFlight?.target === nextOnline && inFlight?.promise) {
      return inFlight.promise;
    }

    const now = Date.now();
    if (
      lastAvailabilityAttemptRef.current.target === nextOnline &&
      now - lastAvailabilityAttemptRef.current.at < AVAILABILITY_TOGGLE_DEBOUNCE_MS
    ) {
      return;
    }
    lastAvailabilityAttemptRef.current = { target: nextOnline, at: now };

    const requestPromise = (async () => {
      let nextCoordinate = null;

      if (nextOnline) {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
          throw new Error(
            'Location permission is required to go online. Please enable location services for Trust Express and try again.'
          );
        }

        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        nextCoordinate = {
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
        };
      } else if (
        Number.isFinite(driverCoordinate?.latitude) &&
        Number.isFinite(driverCoordinate?.longitude)
      ) {
        nextCoordinate = {
          latitude: driverCoordinate.latitude,
          longitude: driverCoordinate.longitude,
        };
      }

      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');

      await updateDriverAvailability(token, {
        isOnline: nextOnline,
        latitude: nextCoordinate?.latitude ?? null,
        longitude: nextCoordinate?.longitude ?? null,
      });
      patchDriverStatus({
        isOnline: nextOnline,
        availability: {
          isOnline: nextOnline,
          latitude: nextCoordinate?.latitude ?? null,
          longitude: nextCoordinate?.longitude ?? null,
        },
      });

      if (nextCoordinate) {
        setDriverCoordinate(nextCoordinate);
      }
    })();

    manualAvailabilityRequestRef.current = { target: nextOnline, promise: requestPromise };

    try {
      return await requestPromise;
    } finally {
      if (manualAvailabilityRequestRef.current?.promise === requestPromise) {
        manualAvailabilityRequestRef.current = null;
      }
    }
  };

  const promptForDisplayOverlayPermission = useCallback(() => {
    if (overlayPermissionPromptOpenRef.current) return;
    overlayPermissionPromptOpenRef.current = true;

    const closePrompt = () => {
      overlayPermissionPromptOpenRef.current = false;
    };

    Alert.alert(
      'Enable display overlay',
      'Allow Trust Express to display over other apps so the online driver bubble can appear while the app is in the background.',
      [
        { text: 'Later', style: 'cancel', onPress: closePrompt },
        {
          text: 'Open Settings',
          onPress: async () => {
            closePrompt();
            await openTripOverlaySettings();
          },
        },
      ]
    );
  }, []);

  const ensureDisplayOverlayReady = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    if (!isTripOverlaySupported()) {
      if (__DEV__) {
        console.log('[driver.home] display overlay unsupported', getTripOverlaySupportInfo());
      }
      return;
    }

    const canDraw = await canUseTripOverlay();
    console.log('[driver.home] display overlay permission check', { canDraw });
    if (!canDraw) {
      promptForDisplayOverlayPermission();
    }
  }, [promptForDisplayOverlayPermission]);

  useEffect(() => {
    if (!isFocused || !isOnline) return;
    ensureDisplayOverlayReady().catch(() => {});
  }, [ensureDisplayOverlayReady, isFocused, isOnline]);

  const handleGoOnline = async () => {
    if (availabilityActionPending || isOnline) return;
    if (walletStatus.paymentsEnabled && !walletStatus.sufficientBalance && walletStatus.lowBalanceMessage) {
      Alert.alert('Wallet top-up required', walletStatus.lowBalanceMessage);
      return;
    }
    try {
      setAvailabilityActionPending(true);
      await syncAvailability(true);
      setDismissedRequestIds([]);
      setIsOnline(true);
      ensureDisplayOverlayReady().catch(() => {});
    } catch (error) {
      Alert.alert('Could not go online', getAvailabilityErrorMessage(true, error));
    } finally {
      setAvailabilityActionPending(false);
    }
  };

  const handleGoOffline = async () => {
    if (availabilityActionPending || !isOnline) return;
    try {
      setAvailabilityActionPending(true);
      await syncAvailability(false);
      setIsOnline(false);
    } catch (error) {
      Alert.alert('Could not go offline', getAvailabilityErrorMessage(false, error));
    } finally {
      setAvailabilityActionPending(false);
    }
  };

  // While the driver is online, continuously track their location and
  // push updates to the backend so driver_availability stays fresh.
  useEffect(() => {
    let cancelled = false;

    const startWatcher = async () => {
      if (!isOnline) return;

      lastDbLocationRef.current = { coordinate: null, at: 0 };
      const existing = locationWatcherRef.current;
      if (existing && typeof existing.remove === 'function') {
        existing.remove();
        locationWatcherRef.current = null;
      }

      const permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted) {
        return;
      }

      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 10000, // ms
          distanceInterval: 30, // meters
        },
        async (loc) => {
          if (cancelled || !loc?.coords) return;
          const nextCoordinate = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          };
          setDriverCoordinate(nextCoordinate);
          setMapRegion((prev) => ({
            ...prev,
            latitude: nextCoordinate.latitude,
            longitude: nextCoordinate.longitude,
          }));

          // Throttle DB writes: only update backend at most every N seconds or every M km
          const now = Date.now();
          const last = lastDbLocationRef.current;
          const timeOk = now - last.at >= DB_UPDATE_INTERVAL_MS;
          const distanceOk =
            !last.coordinate ||
            calculateDistanceKm(last.coordinate, nextCoordinate) >= DB_UPDATE_MIN_DISTANCE_KM;
          if (!timeOk && !distanceOk) return;

          if (locationSyncInFlightRef.current) return;
          lastDbLocationRef.current = { coordinate: nextCoordinate, at: now };
          locationSyncInFlightRef.current = true;

          try {
            const token = await getTokenRef.current();
            if (!token) return;
            await updateDriverAvailability(token, {
              isOnline: true,
              latitude: nextCoordinate.latitude,
              longitude: nextCoordinate.longitude,
            });
          } catch {
            // Ignore transient errors; next tick will retry.
          } finally {
            locationSyncInFlightRef.current = false;
          }

          // Optionally refresh the human-readable location label using the configured geocoder.
          try {
            const labelNow = Date.now();
            const lastLabel = lastLabelFetchRef.current;
            const labelTimeOk = labelNow - lastLabel.at >= LABEL_UPDATE_INTERVAL_MS;
            const labelDistanceOk =
              !lastLabel.coordinate ||
              calculateDistanceKm(lastLabel.coordinate, nextCoordinate) >= LABEL_UPDATE_MIN_DISTANCE_KM;

            if (labelTimeOk || labelDistanceOk) {
              // Cache key rounds to ~110m; avoids unnecessary API calls within a small area.
              const cacheKey = `${nextCoordinate.latitude.toFixed(3)},${nextCoordinate.longitude.toFixed(3)}`;
              const cache = placeLabelCacheRef.current;
              const cachedLabel = cache.get(cacheKey);

              lastLabelFetchRef.current = { coordinate: nextCoordinate, at: labelNow };

              const cachedGood = cleanLocationLabelCandidate(cachedLabel);
              if (cachedGood) {
                setLocationLabel(cachedGood);
              } else if (cachedLabel) {
                cache.delete(cacheKey);
              }
              if (!cachedGood) {
                const pretty = cleanLocationLabelCandidate(await fetchNicePlaceLabel(nextCoordinate));
                if (pretty) {
                  cache.set(cacheKey, pretty);
                  setLocationLabel(pretty);
                } else {
                  // Keep last known label if the geocoder couldn't resolve a name.
                }
              }
            }
          } catch {
            // If label fetching fails, keep the last known label.
          }
        }
      );

      if (!cancelled) {
        locationWatcherRef.current = subscription;
      } else if (subscription && typeof subscription.remove === 'function') {
        subscription.remove();
      }
    };

    startWatcher();

    return () => {
      cancelled = true;
      const existing = locationWatcherRef.current;
      if (existing && typeof existing.remove === 'function') {
        existing.remove();
      }
      locationWatcherRef.current = null;
      locationSyncInFlightRef.current = false;
    };
  }, [isOnline]);

  // While OFFLINE, keep updating driverCoordinate + label for the background map (no backend writes).
  useEffect(() => {
    let cancelled = false;

    const startIdleWatcher = async () => {
      if (!isFocused || isOnline) return;

      const existing = idleLocationWatcherRef.current;
      if (existing && typeof existing.remove === 'function') {
        existing.remove();
        idleLocationWatcherRef.current = null;
      }

      const permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted) return;

      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 15000,
          distanceInterval: 50,
        },
        async (loc) => {
          if (cancelled || !loc?.coords) return;
          const nextCoordinate = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          setDriverCoordinate(nextCoordinate);
          setMapRegion((prev) => ({
            ...prev,
            latitude: nextCoordinate.latitude,
            longitude: nextCoordinate.longitude,
          }));

          try {
            const labelNow = Date.now();
            const lastLabel = lastLabelFetchRef.current;
            const labelTimeOk = labelNow - lastLabel.at >= LABEL_UPDATE_INTERVAL_MS;
            const labelDistanceOk =
              !lastLabel.coordinate ||
              calculateDistanceKm(lastLabel.coordinate, nextCoordinate) >= LABEL_UPDATE_MIN_DISTANCE_KM;
            if (!labelTimeOk && !labelDistanceOk) return;

            const cacheKey = `${nextCoordinate.latitude.toFixed(3)},${nextCoordinate.longitude.toFixed(3)}`;
            const cache = placeLabelCacheRef.current;
            const cachedLabel = cache.get(cacheKey);
            lastLabelFetchRef.current = { coordinate: nextCoordinate, at: labelNow };

            const cachedGood = cleanLocationLabelCandidate(cachedLabel);
            if (cachedGood) {
              setLocationLabel(cachedGood);
            } else if (cachedLabel) {
              cache.delete(cacheKey);
            }
            if (!cachedGood) {
              const pretty = cleanLocationLabelCandidate(await fetchNicePlaceLabel(nextCoordinate));
              if (pretty) {
                cache.set(cacheKey, pretty);
                setLocationLabel(pretty);
              }
            }
          } catch {
            // ignore
          }
        }
      );

      if (!cancelled) idleLocationWatcherRef.current = subscription;
      else subscription?.remove?.();
    };

    startIdleWatcher();

    return () => {
      cancelled = true;
      idleLocationWatcherRef.current?.remove?.();
      idleLocationWatcherRef.current = null;
    };
  }, [isFocused, isOnline]);

  const handleAcceptRequest = async (request) => {
    const req = request || activeRequest;
    try {
      if (!req) return;
      if (req?.expiresAt && getRemainingSeconds(req.expiresAt, req?.remainingSeconds, req?.remainingSecondsCapturedAt) < 1) {
        if (__DEV__) {
          console.log('[driver.home] accept blocked locally as expired', {
            rideRequestId: req?.id,
            expiresAt: req?.expiresAt || null,
            remainingSecondsServer: Number(req?.remainingSeconds ?? -1),
            remainingSecondsUi: getRemainingSeconds(req.expiresAt, req?.remainingSeconds, req?.remainingSecondsCapturedAt),
            nowIso: new Date().toISOString(),
          });
        }
        Alert.alert('Request expired', 'This request expired before acceptance. Please take the next request.');
        markRideRequestDismissed(req.id);
        setDismissedRequestIds((current) => [...new Set([...current, req.id])]);
        hiddenRequestUntilRef.current.set(req.id, Date.now() + REQUEST_REAPPEAR_DELAY_MS);
        setTimeout(() => {
          restoreRideRequestDismissal(req.id);
          setDismissedRequestIds((current) => current.filter((item) => item !== req.id));
        }, REQUEST_REAPPEAR_DELAY_MS);
        clearOverlayRideRequest();
        clearRideRequestNotifications({ rideRequestId: req.id }).catch(() => {});
        updateTripOverlay({
          variant: 'online',
          title: 'Trust Express',
          subtitle: 'Online - Ready for rides',
        }).catch(() => {});
        return;
      }
      setAcceptingRideId(req.id);
      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      const acceptResult = await acceptDriverRideRequest(token, req.id);
      if (__DEV__) {
        console.log('[driver.home] accept success', {
          rideRequestId: req?.id,
          acceptResult: acceptResult?.rideRequest || acceptResult || null,
          nowIso: new Date().toISOString(),
        });
      }
      const nextRide = await getDriverCurrentRide(token);
      if (__DEV__) {
        console.log('[driver.home] current ride after accept', {
          rideRequestId: req?.id,
          hasCurrentRide: !!nextRide?.ride,
          currentRideStatus: nextRide?.ride?.status || null,
          nowIso: new Date().toISOString(),
        });
      }
      setActiveRequest(null);
      setAvailableRequests([]);
      clearRideRequestNotifications().catch(() => {});
      setShowIncomingRideOverlay(false);
      setShowNewRequestBadge(false);
      setIsListening(true);
      clearOverlayRideRequest();
      updateTripOverlay({
        variant: 'online',
        title: 'Trust Express',
        subtitle: 'Online - Ready for rides',
      }).catch(() => {});
      setCurrentRide(nextRide?.ride || null);
      setPendingSelectionRide(nextRide?.ride ? null : {
        ...req,
        remainingSeconds: Number(acceptResult?.rideRequest?.remainingSeconds ?? 30),
        remainingSecondsCapturedAt: Date.now(),
        offerExpiresAt: acceptResult?.rideRequest?.offerExpiresAt || null,
        expiresAt: acceptResult?.rideRequest?.offerExpiresAt || null,
      });
    } catch (error) {
      if (__DEV__) {
        console.log('[driver.home] accept failed', {
          rideRequestId: req?.id,
          errorMessage: error?.message || null,
          errorStatus: error?.status ?? null,
          nowIso: new Date().toISOString(),
        });
      }
      Alert.alert('Accept ride failed', error?.message || 'Could not accept this ride.');
    } finally {
      setAcceptingRideId(null);
    }
  };
  acceptRequestHandlerRef.current = handleAcceptRequest;

  const handleDeclineRequest = (request) => {
    const req = request || activeRequest;
    if (!req) return;
    markRideRequestDismissed(req.id);
    setDismissedRequestIds((current) => [...new Set([...current, req.id])]);
    hiddenRequestUntilRef.current.set(req.id, Date.now() + REQUEST_REAPPEAR_DELAY_MS);
    setTimeout(() => {
      restoreRideRequestDismissal(req.id);
      setDismissedRequestIds((current) => current.filter((item) => item !== req.id));
    }, REQUEST_REAPPEAR_DELAY_MS);
    const nextList = availableRequests.filter((r) => r.id !== req.id);
    clearRideRequestNotifications({ rideRequestId: req.id }).catch(() => {});
    setAvailableRequests(nextList);
    setActiveRequest(nextList[0] || null);
    setShowIncomingRideOverlay(nextList.length > 0);
    setShowNewRequestBadge(nextList.length > 0);
    setIsListening(nextList.length === 0);
    if (nextList[0]) {
      setOverlayRideRequest(nextList[0]);
    } else {
      clearOverlayRideRequest();
      updateTripOverlay({
        variant: 'online',
        title: 'Trust Express',
        subtitle: 'Online - Ready for rides',
      }).catch(() => {});
    }
  };

  const handleCancelCurrentRide = () => {
    if (!currentRide?.id || cancellingCurrentRide) return;
    setShowCancelReasonModal(true);
  };

  const handleConfirmCancelWithReason = async (reasonLabel) => {
    setShowCancelReasonModal(false);
    try {
      setCancellingCurrentRide(true);
      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      await cancelDriverCurrentRide(token, currentRide.id, reasonLabel);
      setCurrentRide(null);
      setPendingSelectionRide(null);
      clearRideRequestNotifications().catch(() => {});
      Alert.alert('Ride cancelled', 'The ride has been cancelled.');
    } catch (error) {
      Alert.alert('Cancel ride failed', error?.message || 'Could not cancel this ride.');
    } finally {
      setCancellingCurrentRide(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-[#efefef]">
      <View className="flex-1">
        {/* Unmount home map while request modal is open to avoid dual MapViews (Android). */}
        {!showRideRequestModal ? (
        <MapView
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          initialRegion={INITIAL_REGION}
          region={mapRegion}
          showsUserLocation={false}
          showsCompass={false}
          showsScale={false}
          toolbarEnabled={false}
          rotateEnabled={false}
        >
          <Marker coordinate={driverCoordinate} title="You" pinColor="#2563eb" tracksViewChanges={false} />
          {currentRide ? (
            <>
              <Marker coordinate={currentRide.pickupCoordinate} title="Pickup" pinColor="#1d4ed8" tracksViewChanges={false} />
              <Marker coordinate={currentRide.dropoffCoordinate} title="Drop-off" pinColor="#111827" tracksViewChanges={false} />
              {routeCoordinates.length > 1 ? (
                <>
                  <Polyline
                    coordinates={routeCoordinates}
                    strokeColor="rgba(37,99,235,0.22)"
                    strokeWidth={10}
                  />
                  <Polyline
                    coordinates={routeCoordinates}
                    strokeColor="#2563eb"
                    strokeWidth={5}
                  />
                </>
              ) : (
                <Polyline
                  coordinates={
                    currentRide.stage === 'on_trip'
                      ? [currentRide.driverCoordinate || driverCoordinate, currentRide.dropoffCoordinate]
                      : [currentRide.driverCoordinate || driverCoordinate, currentRide.pickupCoordinate]
                  }
                  strokeColor="#2563eb"
                  strokeWidth={4}
                />
              )}
            </>
          ) : null}
          {primaryIncomingRequest ? (
            <>
              <Marker coordinate={primaryIncomingRequest.pickupCoordinate} title="Pickup" pinColor="#1d4ed8" tracksViewChanges={false} />
              {Array.isArray(primaryIncomingRequest.intermediateStops)
                ? primaryIncomingRequest.intermediateStops.map((stop, index) => (
                    stop?.coordinate ? (
                      <Marker
                        key={`incoming-stop-${primaryIncomingRequest.id}-${index}`}
                        coordinate={stop.coordinate}
                        title={stop.label || `Stop ${index + 1}`}
                        pinColor="#f97316"
                        tracksViewChanges={false}
                      />
                    ) : null
                  ))
                : null}
              <Marker coordinate={primaryIncomingRequest.dropoffCoordinate} title="Drop-off" pinColor="#111827" tracksViewChanges={false} />
              {routeCoordinates.length > 1 ? (
                <>
                  <Polyline
                    coordinates={routeCoordinates}
                    strokeColor="rgba(37,99,235,0.22)"
                    strokeWidth={10}
                  />
                  <Polyline
                    coordinates={routeCoordinates}
                    strokeColor="#2563eb"
                    strokeWidth={5}
                  />
                </>
              ) : (
                <Polyline
                  coordinates={[primaryIncomingRequest.pickupCoordinate, primaryIncomingRequest.dropoffCoordinate]}
                  strokeColor="#2563eb"
                  strokeWidth={4}
                />
              )}
            </>
          ) : null}
        </MapView>
        ) : (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#d6dee9' }} />
        )}

        {/* Dark overlay so foreground cards read better */}
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.18)' }} />

        <View className="px-5" style={{ paddingTop: insets.top + 12 }}>
          <View className="rounded-2xl bg-white/95 px-6 py-4">
            <Text className="text-xs font-medium text-gray-500">Current location</Text>
            <Text className="mt-1 text-sm text-gray-800" numberOfLines={1}>
              {locationLabel || 'Current location'}
            </Text>
          </View>
        </View>

        {showNewRequestBadge && availableRequests.length > 0 && !primaryIncomingRequest ? (
          <View className="mt-7 items-center">
            <View className="rounded-full bg-[#2f73c9] px-9 py-4">
              <Text className="text-base font-bold uppercase text-white">New Request</Text>
            </View>
          </View>
        ) : null}

        {!currentRide && availableRequests.length === 0 ? (
          <View className="flex-1 items-center justify-center px-10">
            <View className="rounded-full bg-[#4b4b52] px-8 py-3">
              <Text className="text-base font-bold uppercase text-white">{statusLabel}</Text>
            </View>

            {!isOnline ? (
              <>
                {walletStatus.paymentsEnabled && !walletStatus.sufficientBalance && walletStatus.lowBalanceMessage ? (
                  <View className="mt-6 rounded-[20px] bg-amber-50 px-5 py-4">
                    <Text className="text-center text-sm font-semibold text-amber-700">
                      {walletStatus.lowBalanceMessage}
                    </Text>
                    <Text className="mt-1 text-center text-xs text-amber-600">
                      Current balance: ${Number(walletStatus.availableBalance || 0).toFixed(2)} | Minimum: ${Number(walletStatus.minimumRequiredBalance || 0).toFixed(2)}
                    </Text>
                  </View>
                ) : null}
                <TouchableOpacity
                  onPress={handleGoOnline}
                  disabled={loadingAvailability || availabilityActionPending}
                  className="mt-12 h-64 w-64 items-center justify-center rounded-full bg-[#2f73c9]"
                  style={{ opacity: loadingAvailability || availabilityActionPending ? 0.75 : 1 }}
                >
                  {loadingAvailability || availabilityActionPending ? (
                    <View className="items-center">
                      <ActivityIndicator size="large" color="#fff" />
                      <Text className="mt-4 text-xl font-bold text-white">
                        {loadingAvailability ? 'LOADING' : 'GOING ONLINE'}
                      </Text>
                    </View>
                  ) : (
                    <>
                      <Ionicons name="power" size={62} color="#fff" />
                      <Text className="mt-4 text-3xl font-bold text-white">GO ONLINE</Text>
                    </>
                  )}
                </TouchableOpacity>

                <Text className="mt-14 text-center text-2xl font-medium leading-10 text-[#4a4d55]">
                  Ready to earn? Tap the button to start receiving requests in Zimbabwe.
                </Text>
              </>
            ) : (
              <>
                <View className="mt-12 h-64 w-64 items-center justify-center">
                  <Animated.View
                    pointerEvents="none"
                    className="absolute h-64 w-64 rounded-full bg-[#2f73c9]"
                    style={{
                      opacity: outerRingOpacity,
                      transform: [{ scale: outerRingScale }],
                    }}
                  />
                  <Animated.View
                    pointerEvents="none"
                    className="absolute h-52 w-52 rounded-full bg-[#2f73c9]"
                    style={{
                      opacity: innerRingOpacity,
                      transform: [{ scale: innerRingScale }],
                    }}
                  />
                  <View className="h-64 w-64 items-center justify-center rounded-full border border-[#2f73c9]/20 bg-[#2f73c9]/15">
                  <View className="h-40 w-40 items-center justify-center rounded-full bg-[#2f73c9]">
                    <Ionicons name="radio-outline" size={70} color="#fff" />
                  </View>
                </View>
                </View>

                <Text className="mt-12 text-center text-2xl font-medium leading-10 text-[#4a4d55]">
                  You are online and available for incoming ride requests.
                </Text>

                <TouchableOpacity
                  onPress={handleGoOffline}
                  disabled={availabilityActionPending}
                  className="mt-8 h-14 items-center justify-center rounded-[18px] border border-[#d7d9df] bg-white px-8"
                  style={{ opacity: availabilityActionPending ? 0.65 : 1 }}
                >
                  {availabilityActionPending ? (
                    <ActivityIndicator size="small" color="#5d6470" />
                  ) : (
                    <Text className="text-sm font-bold uppercase text-[#5d6470]">Go Offline</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : currentRide ? (
          <View className="flex-1 items-center justify-center px-8">
            <View className="w-full max-w-[360px] rounded-[28px] bg-white/95 px-6 py-6">
              <Text className="text-center text-sm font-bold uppercase tracking-wide text-[#2f73c9]">
                {currentRide.stage === 'on_trip' ? 'Trip in progress' : currentRide.stage === 'waiting_for_customer' ? 'Passenger pickup ready' : 'Opening pickup route'}
              </Text>
              <Text className="mt-3 text-center text-2xl font-bold text-[#111111]">
                {currentRide.stage === 'on_trip' ? 'Opening live route...' : 'Taking you to the trip page...'}
              </Text>
              <Text className="mt-3 text-center text-base text-[#5a6474]">
                You&apos;ll see the full map, directions, passenger name, and shared phone details there.
              </Text>

              <TouchableOpacity
                onPress={() => navigation.navigate('DriverTrip', { initialRide: currentRide })}
                className="mt-5 h-14 items-center justify-center rounded-[20px]"
                style={{ backgroundColor: PRIMARY_BLUE }}
              >
                <Text className="text-lg font-bold text-white">Open Trip Page</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleCancelCurrentRide}
                disabled={cancellingCurrentRide}
                className="mt-3 h-14 items-center justify-center rounded-[20px] border border-[#fecaca] bg-white"
              >
                <Text className="text-sm font-bold uppercase text-[#b91c1c]">
                  {cancellingCurrentRide ? 'Cancelling...' : 'Cancel ride'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : primaryIncomingRequest ? (
          <View
            className="absolute left-0 right-0 justify-end"
            style={{ top: insets.top + 118, bottom: insets.bottom + 88, paddingHorizontal: 16 }}
            pointerEvents="box-none"
          >
            {availableRequests.length > 1 ? (
              <TouchableOpacity
                onPress={cycleToNextIncomingRequest}
                className="mb-3 self-center rounded-full bg-white/95 px-4 py-2"
                style={{ borderWidth: 1, borderColor: '#d7dfec' }}
              >
                <Text className="text-xs font-bold uppercase tracking-[1px] text-[#2f73c9]">
                  Request {activeIncomingRequestIndex + 1} of {availableRequests.length} • Tap for next
                </Text>
              </TouchableOpacity>
            ) : null}

            <View className="rounded-[24px] border border-[#d7dfec] bg-white/95 p-4">
              <View className="mb-2 flex-row items-center justify-between">
                <View className="flex-row items-center">
                  <View className="rounded-full bg-[#2f73c9] px-3 py-1.5">
                    <Text className="text-xs font-bold uppercase tracking-[1px] text-white">
                      {activeIncomingRequestIndex === 0 ? 'New request' : `Request ${activeIncomingRequestIndex + 1}`}
                    </Text>
                  </View>
                  {activeIncomingRequestIndex === 0 && availableRequests.length > 1 ? (
                    <View className="ml-2 rounded-full bg-[#dcfce7] px-2 py-0.5">
                      <Text className="text-xs font-bold uppercase text-[#15803d]">Nearest</Text>
                    </View>
                  ) : null}
                </View>
                <View className="rounded-full bg-[#111827] px-3 py-1.5">
                  <Text className="text-xs font-bold uppercase tracking-[1px] text-white">
                    {formatCountdown(getRemainingSeconds(primaryIncomingRequest.expiresAt, primaryIncomingRequest?.remainingSeconds, primaryIncomingRequest?.remainingSecondsCapturedAt))}
                  </Text>
                </View>
              </View>

              <View className="flex-row items-start justify-between">
                <View className="flex-1 pr-4">
                  <Text className="text-xs font-semibold uppercase tracking-wide text-[#2f73c9]">Incoming request</Text>
                  <View className="mt-2 flex-row items-center">
                    {resolveUploadedMediaUrl(primaryIncomingRequest?.passengerProfile?.imageUrl) ? (
                      <Image
                        source={{ uri: resolveUploadedMediaUrl(primaryIncomingRequest?.passengerProfile?.imageUrl) }}
                        style={{ width: 40, height: 40, borderRadius: 20 }}
                      />
                    ) : (
                      <View className="h-10 w-10 items-center justify-center rounded-full bg-[#e0e7ff]">
                        <Ionicons name="person" size={18} color={PRIMARY_BLUE} />
                      </View>
                    )}
                    <Text className="ml-3 text-xl font-bold text-[#111111]">
                      {primaryIncomingRequest.passengerName || 'Passenger'}
                    </Text>
                  </View>
                  <View className="mt-2 flex-row flex-wrap items-center gap-2">
                    <View className="self-start rounded-full bg-[#e3e9f2] px-3 py-1">
                      <Text className="text-xs font-bold uppercase text-[#2f73c9]">{primaryIncomingRequest.tierName || 'Ride'}</Text>
                    </View>
                    <View className="self-start rounded-full bg-[#ecfdf3] px-3 py-1">
                      <Text className="text-xs font-bold uppercase text-[#15803d]">
                        {Number(primaryIncomingRequest.passengerCount || 1) === 1
                          ? '1 person'
                          : `${Number(primaryIncomingRequest.passengerCount || 1)} people`}
                      </Text>
                    </View>
                  </View>
                </View>
                <View className="items-end">
                  <Text className="text-xs font-semibold uppercase tracking-wide text-[#5a6474]">Fare</Text>
                  <Text className="mt-1 text-2xl font-extrabold text-[#111111]">${Number(primaryIncomingRequest.estimatedAmount || 0).toFixed(2)}</Text>
                  {Number(primaryIncomingRequest.discountAmount || 0) > 0 ? (
                    <View className="mt-2 rounded-full bg-emerald-50 px-3 py-1">
                      <Text className="text-[11px] font-semibold uppercase tracking-wide text-[#15803d]">
                        Promo applied
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>

              <View className="mt-3 rounded-[20px] bg-[#f8fafc] px-4 py-3">
                <View className="flex-row">
                  <View className="mr-4 items-center pt-1">
                    <View className="h-3.5 w-3.5 rounded-full bg-[#2f73c9]" />
                    <View className="my-2 h-10 w-[2px] rounded-full bg-[#cbd5e1]" />
                    <View className="h-3.5 w-3.5 rounded-full bg-[#111827]" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-[11px] font-bold uppercase tracking-[1px] text-[#2f73c9]">Pickup</Text>
                    <Text className="mt-1 text-base font-semibold text-[#111111]">{primaryIncomingRequest.pickup}</Text>
                    <Text className="mt-4 text-[11px] font-bold uppercase tracking-[1px] text-[#5a6474]">Drop-off</Text>
                    <Text className="mt-1 text-base font-semibold text-[#111111]">{primaryIncomingRequest.dropoff}</Text>
                  </View>
                </View>
              </View>

              <RequestStopsPreview request={primaryIncomingRequest} />

              <View className="mt-3 flex-row items-center gap-5">
                <View className="flex-row items-center">
                  <Ionicons name="navigate" size={15} color="#2f73c9" />
                  <Text className="ml-1.5 text-sm font-medium text-[#5a6474]">
                    {Number((primaryIncomingRequest.pickupRouteDistanceKm ?? primaryIncomingRequest.driverDistanceKm) || 0).toFixed(1)} km to pickup
                  </Text>
                </View>
                <View className="flex-row items-center">
                  <Ionicons name="time" size={15} color="#2f73c9" />
                  <Text className="ml-1.5 text-sm font-medium text-[#5a6474]">
                    {Math.max(1, Number((primaryIncomingRequest.pickupRouteMinutes ?? primaryIncomingRequest.etaMinutes) || 0))} min to pickup
                  </Text>
                </View>
              </View>

              <View className="mt-1.5 flex-row items-center gap-5">
                <View className="flex-row items-center">
                  <Ionicons name="swap-horizontal" size={15} color="#111827" />
                  <Text className="ml-1.5 text-sm font-medium text-[#5a6474]">
                    {Number((primaryIncomingRequest.tripDistanceKm ?? primaryIncomingRequest.estimatedDistanceKm) || 0).toFixed(1)} km trip
                  </Text>
                </View>
                <View className="flex-row items-center">
                  <Ionicons name="time-outline" size={15} color="#111827" />
                  <Text className="ml-1.5 text-sm font-medium text-[#5a6474]">
                    {Math.max(1, Number((primaryIncomingRequest.tripDurationMinutes ?? primaryIncomingRequest.estimatedMinutes) || 0))} min trip
                  </Text>
                </View>
              </View>

              {Number(primaryIncomingRequest.discountAmount || 0) > 0 ? (
                <View className="mt-3 rounded-[18px] border border-[#dbeafe] bg-[#eff6ff] px-4 py-3">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-[11px] font-bold uppercase tracking-[1px] text-[#2f73c9]">
                      Promo ride
                    </Text>
                    {primaryIncomingRequest.discountCode ? (
                      <Text className="text-[11px] font-semibold uppercase tracking-[1px] text-[#2f73c9]">
                        {primaryIncomingRequest.discountCode}
                      </Text>
                    ) : null}
                  </View>
                  <View className="mt-2 flex-row items-center justify-between">
                    <Text className="text-sm text-[#1e3a8a]">Passenger total</Text>
                    <Text className="text-sm font-semibold text-[#1e3a8a]">
                      ${Number(primaryIncomingRequest.finalEstimatedAmount || 0).toFixed(2)}
                    </Text>
                  </View>
                  <View className="mt-1 flex-row items-center justify-between">
                    <Text className="text-sm text-[#1e3a8a]">Discount</Text>
                    <Text className="text-sm font-semibold text-[#1e3a8a]">
                      ${Number(primaryIncomingRequest.discountAmount || 0).toFixed(2)}
                    </Text>
                  </View>
                  <View className="mt-1 flex-row items-center justify-between">
                    <Text className="text-sm text-[#1e3a8a]">Admin reimbursement</Text>
                    <Text className="text-sm font-semibold text-[#1e3a8a]">
                      ${Number(primaryIncomingRequest.driverReimbursementAmount || 0).toFixed(2)}
                    </Text>
                  </View>
                </View>
              ) : null}

              <View className="mt-3 flex-row gap-3">
                <TouchableOpacity
                  onPress={() => handleDeclineRequest(primaryIncomingRequest)}
                  className="h-12 flex-1 items-center justify-center rounded-[14px] border border-[#d7d9df] bg-white"
                >
                  <Text className="text-xs font-bold uppercase text-[#5d6470]">Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleAcceptRequest(primaryIncomingRequest)}
                  disabled={acceptingRideId === primaryIncomingRequest.id}
                  className="h-12 flex-[1.15] flex-row items-center justify-center rounded-[14px] bg-[#2f73c9]"
                >
                  {acceptingRideId === primaryIncomingRequest.id ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text className="text-xs font-bold uppercase text-white">Accept</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : null}
      </View>

      <Modal
        visible={showRideRequestModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowIncomingRideOverlay(false)}
      >
        <View className="flex-1 bg-black/55">
          <SafeAreaView className="flex-1 bg-transparent">
            <View className="flex-1 justify-end px-3 pb-3">
              <View
                className="overflow-hidden rounded-[28px] bg-white"
                style={{ maxHeight: '94%' }}
              >
                <View className="relative">
                  <IncomingRidePreviewMap
                    driverCoordinate={driverCoordinate}
                    request={primaryIncomingRequest}
                    toPickupRoute={routeCoordinates}
                    tripRoute={tripRouteCoordinates}
                    height={240}
                    pickupEtaLabel={`${Math.max(1, Number((primaryIncomingRequest?.pickupRouteMinutes ?? primaryIncomingRequest?.etaMinutes) || 0))} min · ${Number((primaryIncomingRequest?.pickupRouteDistanceKm ?? primaryIncomingRequest?.driverDistanceKm) || 0).toFixed(1)} km`}
                    tripEtaLabel={`${Math.max(1, Number((primaryIncomingRequest?.tripDurationMinutes ?? primaryIncomingRequest?.estimatedMinutes) || 0))} min · ${Number((primaryIncomingRequest?.tripDistanceKm ?? primaryIncomingRequest?.estimatedDistanceKm) || 0).toFixed(1)} km`}
                  />
                  <View
                    pointerEvents="none"
                    className="absolute left-0 right-0 top-0 items-center px-4 pt-3"
                  >
                    <View className="h-1.5 w-12 rounded-full bg-white/80" />
                    <Text className="mt-2 text-sm font-bold uppercase tracking-[1.5px] text-white"
                      style={{
                        textShadowColor: 'rgba(0,0,0,0.45)',
                        textShadowOffset: { width: 0, height: 1 },
                        textShadowRadius: 3,
                      }}
                    >
                      Ride request
                    </Text>
                  </View>
                  <View
                    className="absolute right-3 top-3 rounded-full px-3 py-2"
                    style={{ backgroundColor: 'rgba(17,24,39,0.92)' }}
                  >
                    <Text className="text-[10px] font-bold uppercase tracking-[1px] text-white/80">
                      Expires
                    </Text>
                    <Text className="text-base font-extrabold text-white">
                      {formatCountdown(getRemainingSeconds(primaryIncomingRequest?.expiresAt, primaryIncomingRequest?.remainingSeconds, primaryIncomingRequest?.remainingSecondsCapturedAt))}
                    </Text>
                  </View>
                </View>

                <ScrollView
                  showsVerticalScrollIndicator={false}
                  bounces={false}
                  contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18 }}
                >
                  <View className="flex-row items-start justify-between">
                    <View className="flex-1 flex-row items-center pr-3">
                      {resolveUploadedMediaUrl(primaryIncomingRequest?.passengerProfile?.imageUrl) ? (
                        <Image
                          source={{ uri: resolveUploadedMediaUrl(primaryIncomingRequest?.passengerProfile?.imageUrl) }}
                          style={{ width: 44, height: 44, borderRadius: 22 }}
                        />
                      ) : (
                        <View className="h-11 w-11 items-center justify-center rounded-full bg-[#e0e7ff]">
                          <Ionicons name="person" size={20} color={PRIMARY_BLUE} />
                        </View>
                      )}
                      <View className="ml-3 flex-1">
                        <Text className="text-lg font-bold text-[#111111]" numberOfLines={1}>
                          {primaryIncomingRequest?.passengerName || 'Passenger'}
                        </Text>
                        <Text className="mt-0.5 text-sm font-semibold text-[#2f73c9]">
                          {primaryIncomingRequest?.tierName || 'Trust Express'}
                          {` · ${Number(primaryIncomingRequest?.passengerCount || 1) === 1 ? '1 person' : `${Number(primaryIncomingRequest?.passengerCount || 1)} people`}`}
                        </Text>
                      </View>
                    </View>
                    <View className="items-end">
                      <Text className="text-2xl font-extrabold text-[#111111]">
                        ${Number(primaryIncomingRequest?.estimatedAmount || 0).toFixed(2)}
                      </Text>
                      {Number(primaryIncomingRequest?.discountAmount || 0) > 0 ? (
                        <View className="mt-1 rounded-full bg-emerald-50 px-2 py-0.5">
                          <Text className="text-[10px] font-semibold uppercase text-[#15803d]">Promo</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>

                  <View className="mt-3 flex-row flex-wrap gap-x-5 gap-y-1.5">
                    <View className="flex-row items-center">
                      <Ionicons name="navigate" size={14} color="#2f73c9" />
                      <Text className="ml-1.5 text-sm font-medium text-[#5a6474]">
                        {Number((primaryIncomingRequest?.pickupRouteDistanceKm ?? primaryIncomingRequest?.driverDistanceKm) || 0).toFixed(1)} km to pickup
                      </Text>
                    </View>
                    <View className="flex-row items-center">
                      <Ionicons name="time" size={14} color="#2f73c9" />
                      <Text className="ml-1.5 text-sm font-medium text-[#5a6474]">
                        {Math.max(1, Number((primaryIncomingRequest?.pickupRouteMinutes ?? primaryIncomingRequest?.etaMinutes) || 0))} min to pickup
                      </Text>
                    </View>
                    <View className="flex-row items-center">
                      <Ionicons name="swap-horizontal" size={14} color="#111827" />
                      <Text className="ml-1.5 text-sm font-medium text-[#5a6474]">
                        {Number((primaryIncomingRequest?.tripDistanceKm ?? primaryIncomingRequest?.estimatedDistanceKm) || 0).toFixed(1)} km trip
                      </Text>
                    </View>
                    <View className="flex-row items-center">
                      <Ionicons name="time-outline" size={14} color="#111827" />
                      <Text className="ml-1.5 text-sm font-medium text-[#5a6474]">
                        {Math.max(1, Number((primaryIncomingRequest?.tripDurationMinutes ?? primaryIncomingRequest?.estimatedMinutes) || 0))} min trip
                      </Text>
                    </View>
                  </View>

                  <View className="mt-4 rounded-[20px] border border-[#d7dfec] bg-[#f8fafc] px-4 py-3">
                    <View className="flex-row">
                      <View className="mr-3 items-center pt-1">
                        <View className="h-3 w-3 rounded-full bg-[#2f73c9]" />
                        <View className="my-1.5 h-8 w-[2px] rounded-full bg-[#cbd5e1]" />
                        <View className="h-3 w-3 rounded-full bg-[#111827]" />
                      </View>
                      <View className="flex-1">
                        <Text className="text-[11px] font-bold uppercase tracking-[1px] text-[#2f73c9]">Pickup</Text>
                        <Text className="mt-0.5 text-[15px] font-semibold text-[#111111]" numberOfLines={2}>
                          {primaryIncomingRequest?.pickup}
                        </Text>
                        <Text className="mt-3 text-[11px] font-bold uppercase tracking-[1px] text-[#5a6474]">Drop-off</Text>
                        <Text className="mt-0.5 text-[15px] font-semibold text-[#111111]" numberOfLines={2}>
                          {primaryIncomingRequest?.dropoff}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <RequestStopsPreview request={primaryIncomingRequest} />

                  {Number(primaryIncomingRequest?.discountAmount || 0) > 0 ? (
                    <View className="mt-3 rounded-[18px] border border-[#dbeafe] bg-white px-4 py-3">
                      <View className="flex-row items-center justify-between">
                        <Text className="text-[11px] font-bold uppercase tracking-[1px] text-[#2f73c9]">
                          Promo ride
                        </Text>
                        {primaryIncomingRequest?.discountCode ? (
                          <Text className="text-[11px] font-semibold uppercase tracking-[1px] text-[#2f73c9]">
                            {primaryIncomingRequest.discountCode}
                          </Text>
                        ) : null}
                      </View>
                      <View className="mt-2 flex-row items-center justify-between">
                        <Text className="text-sm text-[#5a6474]">Passenger total</Text>
                        <Text className="text-sm font-semibold text-[#111111]">
                          ${Number(primaryIncomingRequest?.finalEstimatedAmount || 0).toFixed(2)}
                        </Text>
                      </View>
                      <View className="mt-1 flex-row items-center justify-between">
                        <Text className="text-sm text-[#5a6474]">Discount</Text>
                        <Text className="text-sm font-semibold text-[#111111]">
                          ${Number(primaryIncomingRequest?.discountAmount || 0).toFixed(2)}
                        </Text>
                      </View>
                      <View className="mt-1 flex-row items-center justify-between">
                        <Text className="text-sm text-[#5a6474]">Admin reimbursement</Text>
                        <Text className="text-sm font-semibold text-[#111111]">
                          ${Number(primaryIncomingRequest?.driverReimbursementAmount || 0).toFixed(2)}
                        </Text>
                      </View>
                    </View>
                  ) : null}

                  <TouchableOpacity
                    onPress={() => {
                      if (!primaryIncomingRequest?.id || acceptingRideId) return;
                      handleAcceptRequest(primaryIncomingRequest);
                    }}
                    disabled={!primaryIncomingRequest?.id || acceptingRideId === primaryIncomingRequest?.id}
                    className="mt-5 h-14 items-center justify-center rounded-[20px] bg-[#2f73c9]"
                  >
                    {acceptingRideId === primaryIncomingRequest?.id ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text className="text-base font-bold uppercase text-white">
                        Accept for ${Number(primaryIncomingRequest?.estimatedAmount || 0).toFixed(2)}
                      </Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => {
                      if (!primaryIncomingRequest?.id) return;
                      handleDeclineRequest(primaryIncomingRequest);
                    }}
                    className="mt-2.5 h-12 items-center justify-center rounded-[18px] border border-[#d7d9df] bg-white"
                  >
                    <Text className="text-sm font-bold uppercase text-[#5d6470]">Decline</Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            </View>
          </SafeAreaView>
        </View>
      </Modal>

      <Modal visible={showCancelReasonModal} transparent animationType="fade">
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setShowCancelReasonModal(false)}
          className="flex-1 justify-end"
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
            className="rounded-t-2xl bg-white px-5 pt-4"
            style={{ paddingBottom: Math.max(insets.bottom + 12, 24) }}
          >
            <Text className="text-lg font-bold text-gray-900">Why are you cancelling?</Text>
            <Text className="mt-1 text-sm text-gray-500">The passenger will be notified.</Text>
            <ScrollView className="mt-4 max-h-64" showsVerticalScrollIndicator={false}>
              {DRIVER_CANCELLATION_REASONS.map((r) => (
                <TouchableOpacity
                  key={r.id}
                  onPress={() => handleConfirmCancelWithReason(r.label)}
                  className="border-b border-gray-100 py-4"
                >
                  <Text className="text-base font-medium text-gray-900">{r.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity onPress={() => setShowCancelReasonModal(false)} className="mt-4 py-3 items-center">
              <Text className="text-base text-gray-500">Keep ride</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
};

export default DriverHomeScreen;

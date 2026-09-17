import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Image,
  Alert,
  Modal,
  Animated,
  Dimensions,
  PanResponder,
  Vibration,
} from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline } from '../../components/maps/MapViewCompat';
import { useAuth } from '@clerk/clerk-expo';
import {
  cancelRideRequest,
  declineRideDriver,
  getApiUrl,
  getDirectionsRoute,
  getPassengerRideRequestStatus,
  selectRideDriver,
} from '../../api';
import { PASSENGER_CANCELLATION_REASONS } from '../../constants/cancellationReasons';
import { PRIMARY_BLUE } from '../../constants/colors';
import { BULAWAYO_GEO_LOCK_ENABLED, BULAWAYO_SERVICE_BOUNDS_ARRAY } from '../../constants/serviceArea';
import { paymentMethodLabel } from '../../constants/payment';
import { connectRealtime } from '../../realtime';
import {
  PASSENGER_RIDE_MAP_BOOKING_MAX_DELTA,
  PASSENGER_RIDE_MAP_MIN_DELTA,
  buildPassengerRideMapRegion,
  sampleCoordinatesForFit,
} from '../../lib/passengerRideMap';

const REQUEST_EXPIRY_POLL_MS = 2500;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const EMPTY_ROUTE_COORDINATES = [];

function normalizeRouteCoordinate(value) {
  const latitude = Number(value?.latitude ?? value?.lat);
  const longitude = Number(value?.longitude ?? value?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function normalizeRouteCoordinates(values) {
  if (!Array.isArray(values)) return [];
  return values.map(normalizeRouteCoordinate).filter(Boolean);
}

function normalizeVehicleImageUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  if (raw.startsWith('./') || raw.startsWith('../')) return null;
  if (raw.startsWith('/')) return getApiUrl(raw);
  try {
    const parsed = new URL(raw);
    if (parsed.pathname.startsWith('/uploads/')) return getApiUrl(parsed.pathname);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return raw;
    return null;
  } catch {
    if (raw.startsWith('uploads/')) return getApiUrl(`/${raw}`);
    return null;
  }
}

function normalizeDriverProfileImageUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  if (raw.startsWith('/')) return getApiUrl(raw);
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return raw;
    return null;
  } catch {
    return null;
  }
}

async function fetchRouteCoordinates(token, origin, destination) {
  if (!token || !origin || !destination) return null;
  const data = await getDirectionsRoute(token, { origin, destination, cacheTtlSeconds: 1800 });
  const coordinates = data?.route?.coordinates;
  return Array.isArray(coordinates) && coordinates.length > 1 ? coordinates : null;
}

function getRemainingSeconds(expiresAt) {
  if (!expiresAt) return 0;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

function getEffectiveRemainingSeconds(expiresAt, serverRemainingSeconds = null, capturedAtMs = null) {
  if (Number.isFinite(Number(serverRemainingSeconds)) && Number(serverRemainingSeconds) >= 0) {
    const base = Number(serverRemainingSeconds);
    if (!Number.isFinite(Number(capturedAtMs))) return Math.max(0, Math.floor(base));
    const elapsed = Math.max(0, Math.floor((Date.now() - Number(capturedAtMs)) / 1000));
    return Math.max(0, Math.floor(base) - elapsed);
  }
  return getRemainingSeconds(expiresAt);
}

function formatCountdown(totalSeconds) {
  const safeSeconds = Math.max(0, Number(totalSeconds || 0));
  const m = Math.floor(safeSeconds / 60);
  const s = safeSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatOfferPrice(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return '$0';
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

function SearchProgressBar() {
  const progress = useRef(new Animated.Value(0.12)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, { toValue: 1, duration: 1600, useNativeDriver: false }),
        Animated.timing(progress, { toValue: 0.12, duration: 0, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['8%', '100%'],
  });

  return (
    <View className="mt-3 h-[3px] overflow-hidden rounded-full bg-gray-100">
      <Animated.View style={{ height: 3, width, backgroundColor: '#111827', borderRadius: 99 }} />
    </View>
  );
}

function ViewingAvatar({ driver, size = 32, overlap = false }) {
  const imageUri = normalizeDriverProfileImageUrl(driver?.profileImageUrl);
  const initials = String(driver?.driverName || 'D')
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'D';

  return (
    <View
      className="items-center justify-center overflow-hidden rounded-full bg-gray-200"
      style={{
        width: size,
        height: size,
        marginLeft: overlap ? -10 : 0,
        borderWidth: 2,
        borderColor: '#fff',
      }}
    >
      {imageUri ? (
        <Image source={{ uri: imageUri }} style={{ width: size, height: size }} />
      ) : (
        <Text className="text-[10px] font-bold text-gray-600">{initials}</Text>
      )}
    </View>
  );
}

// ── Driver card ──────────────────────────────────────────────────────────────
function DriverCard({ driver, estimatedAmount, remainingSeconds, onAccept, onDecline, isSubmitting }) {
  const faceUri = normalizeDriverProfileImageUrl(driver.profileImageUrl);
  const carUri =
    normalizeVehicleImageUrl(driver.carImage) ||
    'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=400&q=80';

  return (
    <View className="mb-3 overflow-hidden rounded-2xl border border-gray-100 bg-white">
      {/* Status strip */}
      <View className="flex-row items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <View className="flex-row items-center gap-1.5">
          <View className="h-2 w-2 rounded-full bg-green-500" />
          <Text className="text-[11px] font-bold uppercase tracking-widest text-green-600">Driver accepted</Text>
        </View>
        <View className="flex-row items-center gap-1">
          <Ionicons name="time-outline" size={12} color="#6b7280" />
          <Text className="text-[11px] font-semibold text-gray-500">
            {remainingSeconds > 0 ? `${formatCountdown(remainingSeconds)} to select` : 'Offer expired'}
          </Text>
        </View>
      </View>

      {/* Body */}
      <View className="px-4 py-3">
        <View className="flex-row items-center">
          {/* Car image */}
          {faceUri ? (
            <Image
              source={{ uri: faceUri }}
              resizeMode="cover"
              className="h-16 w-16 rounded-xl bg-gray-100"
            />
          ) : (
            <Image
              source={{ uri: carUri }}
              resizeMode="cover"
              className="h-16 w-16 rounded-xl bg-gray-100"
            />
          )}

          {/* Driver info */}
          <View className="ml-3 flex-1">
            <Text className="text-base font-bold text-gray-900" numberOfLines={1}>
              {driver.driverName}
            </Text>
            <Text className="mt-0.5 text-xs text-gray-500" numberOfLines={1}>
              {driver.carName} · {String(driver.plate || '').toUpperCase()}
            </Text>
            <View className="mt-1.5 flex-row items-center gap-1">
              <Ionicons name="star" size={12} color="#f59e0b" />
              <Text className="text-[11px] font-semibold text-gray-600">
                {Number(driver.ratingCount || 0) > 0 && Number.isFinite(Number(driver.rating)) && Number(driver.rating) > 0
                  ? `${Number(driver.rating).toFixed(2)}`
                  : 'New'} · {driver.trips || 0} rides
              </Text>
            </View>
          </View>

          {/* Price + ETA */}
          <View className="items-end">
            <Text className="text-[22px] font-extrabold tracking-tight text-gray-900">
              ${Number(driver.amount || estimatedAmount || 0).toFixed(2)}
            </Text>
            <Text className="mt-0.5 text-xs font-semibold text-gray-700">
              {driver.etaMinutes ? `${driver.etaMinutes} min away` : 'Locating…'}
            </Text>
            <Text className="mt-0.5 text-[11px] text-gray-400">
              {Number.isFinite(Number(driver.driverDistanceKm))
                ? `${Number(driver.driverDistanceKm).toFixed(1)} km`
                : '—'}
            </Text>
          </View>
        </View>

        {/* Actions */}
        <View className="mt-3 flex-row gap-2">
          <TouchableOpacity
            onPress={onDecline}
            className="h-11 flex-1 items-center justify-center rounded-xl border border-gray-200 bg-gray-50"
            activeOpacity={0.75}
          >
            <Text className="text-sm font-semibold text-gray-600">Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onAccept(driver)}
            disabled={isSubmitting}
            className="h-11 flex-[1.6] items-center justify-center rounded-xl"
            style={{ backgroundColor: PRIMARY_BLUE }}
            activeOpacity={0.85}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text className="text-sm font-bold text-white">Choose driver</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function PassengerNearbyCarsScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const navigatedToTrackingRef = useRef(false);
  const expiryNavigationHandledRef = useRef(false);
  const lastStatusRefreshAtRef = useRef(0);

  const [isSubmittingDriverId, setIsSubmittingDriverId] = useState('');
  const [isCancellingRequest, setIsCancellingRequest] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [rideStatus, setRideStatus] = useState(route.params?.rideRequest || null);
  const [acceptedDrivers, setAcceptedDrivers] = useState([]);
  const [assignedDriver, setAssignedDriver] = useState(null);
  const [showCancelReasonModal, setShowCancelReasonModal] = useState(false);
  const [selectedCancelReason, setSelectedCancelReason] = useState('');
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [nowTick, setNowTick] = useState(Date.now());
  const [realtimeSignal, setRealtimeSignal] = useState(0);
  const seenAcceptedDriverIdsRef = useRef(new Set());
  const acceptSoundRef = useRef(null);
  const acceptAlertInFlightRef = useRef(false);
  const mapRef = useRef(null);
  const hasAutoFitMapRef = useRef(false);

  const {
    pickupCoordinate,
    dropoffCoordinate,
    intermediateStops = [],
    pickupLabel,
    dropoffLabel,
    routeCoordinates: initialRouteCoordinates = EMPTY_ROUTE_COORDINATES,
    distanceKm,
    estimatedMinutes,
    estimatedAmount,
    selectedTier,
    rideRequest,
  } = route.params || {};

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const getAuthToken = useCallback(async () => {
    const getTokenFn = getTokenRef.current;
    if (!getTokenFn) return null;
    return (await getTokenFn({ skipCache: true })) || (await getTokenFn());
  }, []);

  const refreshRideStatus = useCallback(async ({ silent = false } = {}) => {
    if (!rideRequest?.id) return null;
    const now = Date.now();
    if (silent && now - lastStatusRefreshAtRef.current < 900) return null;
    lastStatusRefreshAtRef.current = now;
    try {
      if (!silent) setLoadingStatus(true);
      const token = await getAuthToken();
      if (!token) throw new Error('Not signed in');
      const data = await getPassengerRideRequestStatus(token, rideRequest.id);
      const capturedAt = Date.now();
      const nextAcceptedDrivers = (Array.isArray(data?.acceptedDrivers) ? data.acceptedDrivers : [])
        .filter((driver) => {
          const remaining = getEffectiveRemainingSeconds(
            driver.offerExpiresAt,
            driver.remainingSeconds,
            capturedAt,
          );
          return remaining == null || remaining > 0;
        });
      setRideStatus(data?.rideRequest ? { ...data.rideRequest, remainingSecondsCapturedAt: capturedAt } : null);
      setAcceptedDrivers(nextAcceptedDrivers);
      setAssignedDriver(data?.assignedDriver || null);
      return data || null;
    } catch {
      return null;
    } finally {
      setLoadingStatus(false);
    }
  }, [rideRequest?.id]);

  // ── Tick every second ──
  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Load route polyline ──
  useEffect(() => {
    if (!pickupCoordinate || !dropoffCoordinate) { setRouteCoordinates([]); return; }
    const normalizedInitialCoordinates = normalizeRouteCoordinates(initialRouteCoordinates);
    if (normalizedInitialCoordinates.length > 1) {
      setRouteCoordinates(normalizedInitialCoordinates); return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getAuthToken();
        const coords = await fetchRouteCoordinates(token, pickupCoordinate, dropoffCoordinate);
        if (!cancelled) setRouteCoordinates(normalizeRouteCoordinates(coords));
      } catch {
        if (!cancelled) setRouteCoordinates([]);
      }
    })();
    return () => { cancelled = true; };
  }, [dropoffCoordinate, initialRouteCoordinates, pickupCoordinate]);

  const mapRegion = useMemo(
    () => buildPassengerRideMapRegion(
      [
        pickupCoordinate,
        dropoffCoordinate,
        ...sampleCoordinatesForFit(routeCoordinates),
        ...acceptedDrivers.map((driver) => driver?.coordinate),
      ],
      {
        minDelta: PASSENGER_RIDE_MAP_MIN_DELTA,
        maxDelta: PASSENGER_RIDE_MAP_BOOKING_MAX_DELTA,
        fallback: pickupCoordinate
          ? {
            latitude: pickupCoordinate.latitude,
            longitude: pickupCoordinate.longitude,
            latitudeDelta: PASSENGER_RIDE_MAP_MIN_DELTA,
            longitudeDelta: PASSENGER_RIDE_MAP_MIN_DELTA,
          }
          : null,
      }
    ),
    [acceptedDrivers, dropoffCoordinate, pickupCoordinate, routeCoordinates]
  );

  useEffect(() => {
    if (!mapRef.current || !mapRegion) return undefined;
    const fitCoordinates = [
      pickupCoordinate,
      dropoffCoordinate,
      ...sampleCoordinatesForFit(routeCoordinates),
      ...acceptedDrivers.map((driver) => driver?.coordinate),
    ].filter(Boolean);
    if (fitCoordinates.length < 1) return undefined;

    const timeout = setTimeout(() => {
      try {
        if (fitCoordinates.length >= 2 && mapRef.current?.fitToCoordinates) {
          mapRef.current.fitToCoordinates(fitCoordinates, {
            edgePadding: { top: 100, right: 36, bottom: 280, left: 36 },
            animated: !hasAutoFitMapRef.current,
          });
          hasAutoFitMapRef.current = true;
          return;
        }
        mapRef.current?.animateToRegion?.(mapRegion, hasAutoFitMapRef.current ? 250 : 400);
        hasAutoFitMapRef.current = true;
      } catch {
        // Keep nearby-cars map resilient if a fit request fails.
      }
    }, 200);

    return () => clearTimeout(timeout);
  }, [acceptedDrivers, dropoffCoordinate, mapRegion, pickupCoordinate, routeCoordinates]);

  // ── Poll ride status ──
  useEffect(() => {
    if (!rideRequest?.id) return;
    let active = true;
    const loadStatus = async () => {
      if (!active) return;
      await refreshRideStatus({ silent: true });
    };
    refreshRideStatus();
    const interval = setInterval(loadStatus, REQUEST_EXPIRY_POLL_MS);
    return () => { active = false; clearInterval(interval); };
  }, [refreshRideStatus, realtimeSignal, rideRequest?.id]);

  // ── Realtime socket ──
  useEffect(() => {
    if (!rideRequest?.id) return;
    let active = true;
    let localSocket = null;
    (async () => {
      try {
        const token = await getAuthToken();
        if (!active || !token) return;
        localSocket = connectRealtime(token);
        if (!localSocket) return;
        const handleRideUpdate = (payload = {}) => {
          if (!active || Number(payload.rideRequestId) !== Number(rideRequest.id)) return;
          if (payload?.status === 'driver_found' && payload?.acceptedDriver) {
            const incoming = payload.acceptedDriver;
            setAcceptedDrivers((cur) => {
              const list = Array.isArray(cur) ? cur : [];
              if (list.some((d) => String(d?.id) === String(incoming?.id))) return list;
              return [incoming, ...list];
            });
            setRideStatus((cur) => ({ ...(cur || {}), status: 'driver_found' }));
          }
          refreshRideStatus({ silent: true });
        };
        localSocket.on('ride_status:updated', handleRideUpdate);
        localSocket.__cleanup = () => localSocket.off('ride_status:updated', handleRideUpdate);
      } catch { /* polling fallback */ }
    })();
    return () => { active = false; localSocket?.__cleanup?.(); };
  }, [refreshRideStatus, rideRequest?.id]);

  const playDriverAcceptedAlert = useCallback(async () => {
    if (acceptAlertInFlightRef.current) return;
    acceptAlertInFlightRef.current = true;
    try {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
      } catch {
        // Keep the request flow working even if audio mode cannot change.
      }
      if (!acceptSoundRef.current) {
        const { sound } = await Audio.Sound.createAsync(
          require('../../assets/notificationaudio.mpeg'),
          { shouldPlay: false, volume: 1.0, isLooping: false },
        );
        acceptSoundRef.current = sound;
      }
      const sound = acceptSoundRef.current;
      if (sound) {
        await sound.setVolumeAsync(1.0);
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status?.didJustFinish) return;
          sound.setOnPlaybackStatusUpdate(null);
          if (acceptSoundRef.current !== sound) {
            sound.unloadAsync().catch(() => {});
          }
        });
        await sound.replayAsync();
      }
      Vibration.vibrate(400);
    } catch {
      // Keep waiting UI working if sound cannot play.
    } finally {
      acceptAlertInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    const ids = acceptedDrivers.map((driver) => String(driver?.id || '')).filter(Boolean);
    const assignedId = assignedDriver?.id ? String(assignedDriver.id) : '';
    const incomingIds = assignedId ? [...new Set([...ids, assignedId])] : ids;
    const newIds = incomingIds.filter((id) => !seenAcceptedDriverIdsRef.current.has(id));
    newIds.forEach((id) => seenAcceptedDriverIdsRef.current.add(id));
    if (newIds.length) {
      playDriverAcceptedAlert();
    }
  }, [acceptedDrivers, assignedDriver, playDriverAcceptedAlert]);

  useEffect(() => () => {
    const sound = acceptSoundRef.current;
    acceptSoundRef.current = null;
    if (!sound) return;
    sound.getStatusAsync()
      .then((status) => {
        if (!status?.isLoaded || !status?.isPlaying) {
          return sound.unloadAsync();
        }
        return null;
      })
      .catch(() => sound.unloadAsync?.().catch(() => {}));
  }, []);

  // ── Navigate to tracking when driver assigned ──
  useEffect(() => {
    if (!rideRequest?.id || !assignedDriver || navigatedToTrackingRef.current) return;
    navigatedToTrackingRef.current = true;
    navigation.replace('PassengerRideTracking', {
      pickupCoordinate, dropoffCoordinate, pickupLabel, dropoffLabel,
      intermediateStops,
      estimatedAmount: Number(
        rideStatus?.finalEstimatedAmount ??
        rideStatus?.estimatedAmount ??
        rideRequest?.finalEstimatedAmount ??
        rideRequest?.estimatedAmount ??
        estimatedAmount ??
        0
      ),
      selectedTier: assignedDriver.tier || selectedTier,
      driver: assignedDriver,
      rideRequestId: rideRequest.id,
    });
  }, [assignedDriver, dropoffCoordinate, dropoffLabel, estimatedAmount, navigation, pickupCoordinate, pickupLabel, rideRequest?.finalEstimatedAmount, rideRequest?.estimatedAmount, rideRequest?.id, rideStatus?.finalEstimatedAmount, rideStatus?.estimatedAmount, selectedTier]);

  // ── Handle expiry / cancellation ──
  const rideExpiresAt = rideStatus?.expiresAt || rideRequest?.expiresAt || null;
  const rideStatusValue = String(rideStatus?.status || rideRequest?.status || '').toLowerCase();
  const driversViewingCount = Math.max(
    0,
    Number(rideStatus?.driversViewingCount ?? rideRequest?.driversViewingCount ?? 0)
  );
  const visibleDriversPreview = Array.isArray(rideStatus?.visibleDriversPreview)
    ? rideStatus.visibleDriversPreview
    : Array.isArray(rideRequest?.visibleDriversPreview)
      ? rideRequest.visibleDriversPreview
      : [];
  const finalEstimatedAmount = Number(
    rideStatus?.finalEstimatedAmount ??
    rideStatus?.estimatedAmount ??
    rideRequest?.finalEstimatedAmount ??
    rideRequest?.estimatedAmount ??
    estimatedAmount ??
    0
  );
  const remainingSeconds = useMemo(
    () => getEffectiveRemainingSeconds(
      rideExpiresAt,
      rideStatus?.remainingSeconds ?? rideRequest?.remainingSeconds,
      rideStatus?.remainingSecondsCapturedAt ?? rideRequest?.remainingSecondsCapturedAt,
    ),
    [nowTick, rideExpiresAt, rideRequest?.remainingSeconds, rideRequest?.remainingSecondsCapturedAt, rideStatus?.remainingSeconds, rideStatus?.remainingSecondsCapturedAt],
  );

  const shouldForceAcceptedRefresh = !assignedDriver && rideStatusValue === 'driver_found' && acceptedDrivers.length === 0;

  useEffect(() => {
    if (!shouldForceAcceptedRefresh) return;
    const interval = setInterval(() => {
      refreshRideStatus({ silent: true });
    }, 750);
    return () => clearInterval(interval);
  }, [refreshRideStatus, shouldForceAcceptedRefresh]);

  useEffect(() => {
    if (assignedDriver || expiryNavigationHandledRef.current) return;
    if (!['cancelled', 'expired'].includes(rideStatusValue)) return;
    expiryNavigationHandledRef.current = true;
    Alert.alert(
      rideStatusValue === 'expired' ? 'Request expired' : 'Request cancelled',
      rideStatusValue === 'expired' ? 'No driver accepted your trip in time.' : 'Your ride request has been cancelled.',
      [{ text: 'OK', onPress: () => navigation.reset({ index: 0, routes: [{ name: 'PassengerBookingHome', params: { resetRideDraftAt: Date.now() } }] }) }],
    );
  }, [assignedDriver, navigation, rideStatusValue]);

  // ── Actions ──
  const handleAccept = async (driver) => {
    try {
      setIsSubmittingDriverId(driver.id);
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      if (!rideRequest?.id) return;
      const data = await selectRideDriver(token, rideRequest.id, driver.id);
      const assigned = data?.assignedDriver || driver || null;
      const nextStatus = String(data?.rideRequest?.status || 'driver_assigned').toLowerCase();
      setAssignedDriver(assigned);
      setRideStatus((current) => current ? {
        ...current,
        status: nextStatus,
        ...(data?.rideRequest?.driverDistanceKm !== undefined ? { driverDistanceKm: Number(data.rideRequest.driverDistanceKm || 0) } : null),
        ...(data?.rideRequest?.driverEtaMinutes !== undefined ? { driverEtaMinutes: Number(data.rideRequest.driverEtaMinutes || 0) } : null),
      } : current);
      navigatedToTrackingRef.current = true;
      navigation.replace('PassengerRideTracking', {
        pickupCoordinate,
        dropoffCoordinate,
        intermediateStops,
        pickupLabel,
        dropoffLabel,
        estimatedAmount: finalEstimatedAmount,
        selectedTier: assigned?.tier || selectedTier,
        driver: assigned,
        rideRequestId: rideRequest.id,
      });
    } catch (error) {
      Alert.alert('Driver selection failed', error?.message || 'Could not assign this driver.');
    } finally {
      setIsSubmittingDriverId('');
    }
  };

  const handleDeclineDriver = async (driver) => {
    try {
      const driverUserId = String(driver?.id || '').trim();
      if (!driverUserId || !rideRequest?.id) return;
      setIsSubmittingDriverId(driverUserId);
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      await declineRideDriver(token, rideRequest.id, driverUserId);
      let nextAcceptedCount = 0;
      setAcceptedDrivers((current) => {
        const next = current.filter((item) => String(item?.id) !== driverUserId);
        nextAcceptedCount = next.length;
        return next;
      });
      setAssignedDriver((current) => (String(current?.id || '') === driverUserId ? null : current));
      setRideStatus((current) => current ? {
        ...current,
        status: nextAcceptedCount > 0 ? 'driver_found' : 'requested',
      } : current);
      setRealtimeSignal((c) => c + 1);
    } catch (error) {
      Alert.alert('Decline failed', error?.message || 'Could not decline this driver.');
    } finally {
      setIsSubmittingDriverId('');
    }
  };

  const handleCancelRequest = () => { setSelectedCancelReason(''); setShowCancelReasonModal(true); };

  const handleConfirmCancelWithReason = async () => {
    if (!selectedCancelReason || isCancellingRequest) return;
    setShowCancelReasonModal(false);
    setIsCancellingRequest(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      if (rideRequest?.id) await cancelRideRequest(token, rideRequest.id, selectedCancelReason);
      navigation.reset({ index: 0, routes: [{ name: 'PassengerBookingHome', params: { resetRideDraftAt: Date.now() } }] });
    } catch (error) {
      Alert.alert('Cancel request failed', error?.message || 'Could not cancel this request.');
    } finally {
      setIsCancellingRequest(false);
    }
  };

  const hasDrivers = acceptedDrivers.length > 0 && !assignedDriver;
  const paymentLabel = paymentMethodLabel(rideStatus?.paymentMethod || rideRequest?.paymentMethod) || 'Cash';
  const availableDriversCount = Math.max(driversViewingCount, acceptedDrivers.length);
  const bottomSafeInset = Math.max(insets.bottom, 12);
  const collapsedSheetHeight = Math.round(Math.min(430, SCREEN_HEIGHT * 0.5) + bottomSafeInset);
  const expandedSheetHeight = Math.round(SCREEN_HEIGHT * 0.92);
  const sheetHeight = useRef(new Animated.Value(collapsedSheetHeight)).current;
  const sheetHeightValue = useRef(collapsedSheetHeight);
  const sheetDragStart = useRef(collapsedSheetHeight);
  const sheetScrollOffsetRef = useRef(0);
  const [sheetExpanded, setSheetExpanded] = useState(false);

  useEffect(() => {
    const listener = sheetHeight.addListener(({ value }) => {
      sheetHeightValue.current = value;
    });
    return () => sheetHeight.removeListener(listener);
  }, [sheetHeight]);

  const snapSheet = useCallback((expand) => {
    setSheetExpanded(!!expand);
    Animated.spring(sheetHeight, {
      toValue: expand ? expandedSheetHeight : collapsedSheetHeight,
      useNativeDriver: false,
      bounciness: 2,
      speed: 16,
    }).start();
  }, [collapsedSheetHeight, expandedSheetHeight, sheetHeight]);

  const sheetPan = useMemo(() => {
    const isSheetDrag = (_event, gesture) => {
      const vertical = Math.abs(gesture.dy) > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx);
      if (!vertical) return false;
      if (sheetHeightValue.current < expandedSheetHeight - 12) return true;
      if (gesture.dy > 0 && sheetScrollOffsetRef.current <= 2) return true;
      return false;
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: isSheetDrag,
      onMoveShouldSetPanResponderCapture: isSheetDrag,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        sheetDragStart.current = sheetHeightValue.current;
      },
      onPanResponderMove: (_event, gesture) => {
        const next = Math.min(
          expandedSheetHeight,
          Math.max(collapsedSheetHeight, sheetDragStart.current - gesture.dy)
        );
        sheetHeight.setValue(next);
      },
      onPanResponderRelease: (_event, gesture) => {
        const mid = (collapsedSheetHeight + expandedSheetHeight) / 2;
        snapSheet(gesture.vy < -0.7 || sheetHeightValue.current > mid);
      },
    });
  }, [collapsedSheetHeight, expandedSheetHeight, sheetHeight, snapSheet]);

  return (
    <View className="flex-1 bg-white">
      <View className="flex-1">
        {/* ── Map ── */}
        <MapView
          ref={mapRef}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          initialRegion={mapRegion || {
            latitude: pickupCoordinate.latitude,
            longitude: pickupCoordinate.longitude,
            latitudeDelta: PASSENGER_RIDE_MAP_MIN_DELTA,
            longitudeDelta: PASSENGER_RIDE_MAP_MIN_DELTA,
          }}
          maxBounds={BULAWAYO_GEO_LOCK_ENABLED ? BULAWAYO_SERVICE_BOUNDS_ARRAY : undefined}
          showsCompass={false}
          toolbarEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
        >
          <Marker coordinate={pickupCoordinate} title="Pickup" pinColor={PRIMARY_BLUE} />
          <Marker coordinate={dropoffCoordinate} title="Drop-off" pinColor="#111827" />
          <Polyline
            coordinates={routeCoordinates}
            strokeColor={PRIMARY_BLUE}
            strokeWidth={5}
          />
          {acceptedDrivers.filter((d) => !!d.coordinate).map((driver) => (
            <Marker key={driver.id} coordinate={driver.coordinate} title={driver.driverName}>
              <View className="h-7 w-7 rounded-full border-2 border-white" style={{ backgroundColor: PRIMARY_BLUE }} />
            </Marker>
          ))}
        </MapView>

        <View className="absolute left-4" style={{ top: insets.top + 8 }}>
          <TouchableOpacity
            onPress={handleCancelRequest}
            className="h-11 w-11 items-center justify-center rounded-full bg-white"
            style={{ elevation: 3, shadowColor: '#0f172a', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }}
          >
            <Ionicons name="chevron-back" size={22} color="#111827" />
          </TouchableOpacity>
        </View>

        <Animated.View
          className="absolute left-0 right-0 overflow-hidden rounded-t-[28px] bg-white"
          style={{ bottom: 0, height: sheetHeight }}
          {...sheetPan.panHandlers}
        >
          <View className="px-5 pt-3">
            <View className="items-center py-2">
              <View className="h-1.5 w-12 rounded-full bg-gray-200" />
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="flex-1 pr-3 text-[15px] text-gray-800">
                {driversViewingCount > 0
                  ? `${driversViewingCount} driver${driversViewingCount === 1 ? '' : 's'} viewed your request`
                  : 'Drivers will see your request nearby'}
              </Text>
              <View className="flex-row items-center">
                {visibleDriversPreview.slice(0, 3).map((driver, index) => (
                  <ViewingAvatar key={driver.id} driver={driver} overlap={index > 0} />
                ))}
                {Math.max(0, driversViewingCount - Math.min(visibleDriversPreview.length, 3)) > 0 ? (
                  <View
                    className="h-8 items-center justify-center rounded-full bg-gray-100 px-2"
                    style={{ marginLeft: visibleDriversPreview.length ? -8 : 0 }}
                  >
                    <Text className="text-xs font-semibold text-gray-700">
                      +{Math.max(0, driversViewingCount - Math.min(visibleDriversPreview.length, 3))}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>

          <ScrollView
            className="flex-1 px-5"
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            scrollEnabled={sheetExpanded}
            contentContainerStyle={{ paddingBottom: 16 }}
            onScroll={(event) => {
              sheetScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
          >
            <Text className="text-[28px] font-semibold leading-8 text-gray-900">Searching for drivers</Text>
            <Text className="mt-1 text-[16px] text-gray-500">
              {availableDriversCount > 0
                ? `${availableDriversCount} driver${availableDriversCount === 1 ? '' : 's'} are available`
                : 'Drivers see your request'}
            </Text>
            <SearchProgressBar />

            {hasDrivers ? (
              <View className="mt-5">
                {acceptedDrivers.map((driver) => (
                  <DriverCard
                    key={driver.id}
                    driver={driver}
                    estimatedAmount={finalEstimatedAmount}
                    remainingSeconds={getEffectiveRemainingSeconds(
                      driver.offerExpiresAt,
                      driver.remainingSeconds,
                      rideStatus?.remainingSecondsCapturedAt ?? rideRequest?.remainingSecondsCapturedAt,
                    )}
                    onAccept={handleAccept}
                    onDecline={() => handleDeclineDriver(driver)}
                    isSubmitting={isSubmittingDriverId === driver.id}
                  />
                ))}
              </View>
            ) : null}

            <View className="mt-5 flex-row items-center">
              <View className="h-2 w-2 rounded-full bg-gray-900" />
              <Text className="ml-3 text-[16px] font-medium text-gray-900">
                {formatOfferPrice(finalEstimatedAmount)} {paymentLabel}
              </Text>
            </View>

            <View className="mt-4 flex-row items-start">
              <Ionicons name="person-outline" size={18} color="#111827" style={{ marginTop: 2 }} />
              <Text className="ml-3 flex-1 text-[16px] text-gray-900">{pickupLabel}</Text>
            </View>
            <View className="mt-3 flex-row items-start">
              <Ionicons name="flag-outline" size={18} color="#111827" style={{ marginTop: 2 }} />
              <Text className="ml-3 flex-1 text-[16px] text-gray-900">{dropoffLabel}</Text>
            </View>

            {sheetExpanded ? (
              <View className="mt-5 rounded-[22px] bg-[#f8fafc] px-4 py-4">
                <Text className="text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">
                  Extra details
                </Text>
                {Array.isArray(intermediateStops) && intermediateStops.length ? (
                  intermediateStops.map((stop, index) => (
                    <View key={`${stop?.label || 'stop'}-${index}`} className="mt-3 flex-row items-start">
                      <Ionicons name="ellipse-outline" size={16} color="#64748b" style={{ marginTop: 3 }} />
                      <View className="ml-3 flex-1">
                        <Text className="text-xs text-gray-500">Stop {index + 1}</Text>
                        <Text className="mt-0.5 text-[16px] text-gray-900">{stop?.label || 'Stop'}</Text>
                      </View>
                    </View>
                  ))
                ) : null}
                <View className="mt-3 flex-row flex-wrap">
                  {Number(distanceKm) > 0 ? (
                    <Text className="mr-4 mt-1 text-[15px] text-gray-700">
                      {Number(distanceKm).toFixed(1)} km
                    </Text>
                  ) : null}
                  {Number(estimatedMinutes) > 0 ? (
                    <Text className="mr-4 mt-1 text-[15px] text-gray-700">
                      ~{Math.round(Number(estimatedMinutes))} min
                    </Text>
                  ) : null}
                  {selectedTier?.tierName || selectedTier?.tierKey ? (
                    <Text className="mr-4 mt-1 text-[15px] text-gray-700">
                      {String(selectedTier.tierName || selectedTier.tierKey).replace(/_/g, ' ')}
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : null}
          </ScrollView>

          <View
            className="border-t border-gray-100 bg-white px-5 pt-3"
            style={{ paddingBottom: bottomSafeInset }}
          >
            <TouchableOpacity
              onPress={handleCancelRequest}
              className="h-20 items-center justify-center rounded-[24px] bg-[#e5e7eb]"
              activeOpacity={0.75}
            >
              <Text className="text-[20px] font-bold text-gray-800">Cancel request</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>

      {/* ── Cancel reason modal ── */}
      <Modal visible={showCancelReasonModal} transparent animationType="slide">
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setShowCancelReasonModal(false)}
          className="flex-1 justify-end bg-black/50"
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
            className="rounded-t-3xl bg-white px-5 pt-5"
            style={{ paddingBottom: Math.max(insets.bottom + 12, 24) }}
          >
            {/* Handle */}
            <View className="mb-5 items-center">
              <View className="h-1 w-12 rounded-full bg-gray-200" />
            </View>

            <Text className="text-xl font-bold text-gray-900">Why are you cancelling?</Text>
            <Text className="mt-1 text-sm text-gray-400">Select a reason to continue</Text>

            <ScrollView className="mt-4 max-h-64" showsVerticalScrollIndicator={false}>
              {PASSENGER_CANCELLATION_REASONS.map((r) => {
                const selected = selectedCancelReason === r.label;
                return (
                  <TouchableOpacity
                    key={r.id}
                    onPress={() => setSelectedCancelReason(r.label)}
                    className={`mb-2 flex-row items-center justify-between rounded-xl px-4 py-3.5 ${selected ? 'bg-blue-50' : 'bg-gray-50'}`}
                  >
                    <Text className={`flex-1 pr-3 text-sm font-medium ${selected ? 'text-blue-700' : 'text-gray-800'}`}>
                      {r.label}
                    </Text>
                    <View
                      className="h-5 w-5 items-center justify-center rounded-full border-2"
                      style={{ borderColor: selected ? PRIMARY_BLUE : '#d1d5db', backgroundColor: selected ? PRIMARY_BLUE : '#fff' }}
                    >
                      {selected && <Ionicons name="checkmark" size={11} color="#fff" />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              onPress={handleConfirmCancelWithReason}
              disabled={!selectedCancelReason || isCancellingRequest}
              className="mt-5 h-14 items-center justify-center rounded-2xl"
              style={{ backgroundColor: !selectedCancelReason || isCancellingRequest ? '#bfdbfe' : PRIMARY_BLUE }}
            >
              {isCancellingRequest ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text className="text-base font-bold text-white">Confirm cancellation</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShowCancelReasonModal(false)}
              className="mt-3 items-center py-3"
            >
              <Text className="text-sm font-semibold text-gray-500">Keep my request</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

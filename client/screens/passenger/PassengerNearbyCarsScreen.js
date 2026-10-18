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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Circle, Polyline } from '../../components/maps/MapViewCompat';
import { LetterMarker, PIN_COLORS } from '../../components/maps/LetterPin';
import DriverVehicleMapMarker from '../../components/maps/DriverVehicleMapMarker';
import { useAuth } from '../../auth/AuthProvider';
import {
  cancelRideRequest,
  declineRideDriver,
  getApiUrl,
  getDirectionsRoute,
  getNearbyPassengerDrivers,
  getPassengerRideRequestStatus,
  selectRideDriver,
  updateRideFare,
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

const REQUEST_EXPIRY_POLL_MS = 2000;
const NEARBY_DRIVER_POLL_MS = 4000;
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

function normalizeNearbyDriver(driver) {
  const coordinate = normalizeRouteCoordinate(driver?.coordinate);
  const id = String(driver?.id || driver?.driverUserId || '').trim();
  if (!id || !coordinate) return null;
  return {
    ...driver,
    id,
    driverName: driver?.driverName || 'Driver',
    coordinate,
  };
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
      <Animated.View style={{ height: 3, width, backgroundColor: PRIMARY_BLUE, borderRadius: 99 }} />
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

// ── Driver offer card ────────────────────────────────────────────────────────
function OfferCard({ driver, estimatedAmount, remainingSeconds, onAccept, onDecline, isSubmitting, isBusy }) {
  const faceUri = normalizeDriverProfileImageUrl(driver.profileImageUrl);
  const carUri = normalizeVehicleImageUrl(driver.carImage);
  const photoUri = faceUri || carUri;
  const hasRating = Number(driver.ratingCount || 0) > 0 && Number(driver.rating) > 0;
  const distance = Number.isFinite(Number(driver.driverDistanceKm)) ? `${Number(driver.driverDistanceKm).toFixed(1)} km` : null;
  const eta = driver.etaMinutes ? `${driver.etaMinutes} min` : null;

  return (
    <View className="mb-2.5 rounded-[22px] border border-gray-200 bg-white px-4 pb-4 pt-3.5">
      <View className="flex-row items-center">
        <View className="items-center">
          <View className="h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-gray-100">
            {photoUri ? (
              <Image source={{ uri: photoUri }} resizeMode="cover" style={{ width: 56, height: 56 }} />
            ) : (
              <Ionicons name="person" size={26} color="#9ca3af" />
            )}
          </View>
          <View className="-mt-2 flex-row items-center rounded-full border border-gray-100 bg-white px-1.5 py-0.5">
            <Ionicons name="star" size={10} color="#f59e0b" />
            <Text className="ml-0.5 text-[10px] font-bold text-gray-700">
              {hasRating ? Number(driver.rating).toFixed(1) : 'New'}
            </Text>
          </View>
        </View>

        <View className="ml-3 flex-1">
          <Text className="text-[16px] font-bold text-gray-900" numberOfLines={1}>{driver.driverName}</Text>
          <Text className="mt-0.5 text-[13px] text-gray-500" numberOfLines={1}>
            {[driver.carName, String(driver.plate || '').toUpperCase()].filter(Boolean).join(' · ')}
          </Text>
          <View className="mt-1 flex-row items-center">
            {eta ? <Text className="text-[12px] font-semibold text-gray-700">{eta}</Text> : null}
            {eta && distance ? <Text className="mx-1.5 text-[12px] text-gray-300">•</Text> : null}
            {distance ? (
              <View className="flex-row items-center">
                <Ionicons name="navigate-outline" size={11} color="#6b7280" />
                <Text className="ml-0.5 text-[12px] text-gray-600">{distance}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View className="items-end">
          <View className="rounded-lg px-2.5 py-1" style={{ backgroundColor: PRIMARY_BLUE }}>
            <Text className="text-[14px] font-extrabold text-white">
              {formatOfferPrice(driver.amount || estimatedAmount)}
            </Text>
          </View>
          <Text className="mt-1.5 text-[11px] text-gray-400">
            {remainingSeconds > 0 ? formatCountdown(remainingSeconds) : 'Expired'}
          </Text>
        </View>
      </View>

      <View className="mt-3.5 flex-row gap-2.5">
        <TouchableOpacity
          onPress={onDecline}
          disabled={isBusy}
          className="h-11 flex-1 items-center justify-center rounded-full border border-gray-300"
          style={{ opacity: isBusy ? 0.6 : 1 }}
          activeOpacity={0.75}
        >
          <Text className="text-[15px] font-semibold text-gray-800">Decline</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onAccept(driver)}
          disabled={isBusy}
          className="h-11 flex-1 items-center justify-center rounded-full"
          style={{ backgroundColor: PRIMARY_BLUE, opacity: isBusy && !isSubmitting ? 0.6 : 1 }}
          activeOpacity={0.85}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text className="text-[15px] font-bold text-white">Accept</Text>
          )}
        </TouchableOpacity>
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
  const [nearbyLiveDrivers, setNearbyLiveDrivers] = useState([]);
  const [showCancelReasonModal, setShowCancelReasonModal] = useState(false);
  const [selectedCancelReason, setSelectedCancelReason] = useState('');
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [nowTick, setNowTick] = useState(Date.now());
  const [realtimeSignal, setRealtimeSignal] = useState(0);
  const seenAcceptedDriverIdsRef = useRef(new Set());
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

  useEffect(() => {
    if (!pickupCoordinate) {
      setNearbyLiveDrivers([]);
      return undefined;
    }

    let active = true;
    const loadNearbyDrivers = async () => {
      try {
        const token = await getAuthToken();
        if (!active || !token) return;
        const data = await getNearbyPassengerDrivers(token, {
          latitude: pickupCoordinate.latitude,
          longitude: pickupCoordinate.longitude,
          radiusKm: 8,
        });
        if (!active) return;
        const drivers = (Array.isArray(data?.drivers) ? data.drivers : [])
          .map(normalizeNearbyDriver)
          .filter(Boolean);
        setNearbyLiveDrivers(drivers);
      } catch {
        if (active) setNearbyLiveDrivers([]);
      }
    };

    loadNearbyDrivers();
    const interval = setInterval(loadNearbyDrivers, NEARBY_DRIVER_POLL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [getAuthToken, pickupCoordinate?.latitude, pickupCoordinate?.longitude]);

  const routeStopMarkers = useMemo(
    () =>
      (Array.isArray(intermediateStops) ? intermediateStops : [])
        .map((stop, index) => ({
          key: `route-stop-${index}`,
          coordinate: normalizeRouteCoordinate(stop?.coordinate || stop),
          label: stop?.label || `Stop ${index + 1}`,
          letter: String.fromCharCode(67 + index),
        }))
        .filter((stop) => !!stop.coordinate),
    [intermediateStops],
  );

  const liveDriverMarkers = useMemo(() => {
    const acceptedIds = new Set(acceptedDrivers.map((driver) => String(driver?.id || '')).filter(Boolean));
    const assignedId = assignedDriver?.id ? String(assignedDriver.id) : '';
    return nearbyLiveDrivers.filter((driver) => {
      const id = String(driver?.id || '');
      return id && id !== assignedId && !acceptedIds.has(id) && driver?.coordinate;
    });
  }, [acceptedDrivers, assignedDriver?.id, nearbyLiveDrivers]);

  const acceptedDriverMarkers = useMemo(
    () => acceptedDrivers
      .map((driver) => {
        const liveMatch = nearbyLiveDrivers.find((item) => String(item?.id || '') === String(driver?.id || ''));
        return {
          ...driver,
          coordinate: liveMatch?.coordinate || driver?.coordinate,
          headingDegrees: liveMatch?.headingDegrees ?? liveMatch?.heading ?? driver?.headingDegrees ?? driver?.heading ?? 0,
        };
      })
      .filter((driver) => !!driver.coordinate),
    [acceptedDrivers, nearbyLiveDrivers],
  );

  const mapRegion = useMemo(
    () => buildPassengerRideMapRegion(
      [
        pickupCoordinate,
        dropoffCoordinate,
        ...routeStopMarkers.map((stop) => stop.coordinate),
        ...sampleCoordinatesForFit(routeCoordinates),
        ...acceptedDriverMarkers.map((driver) => driver?.coordinate),
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
    [acceptedDriverMarkers, dropoffCoordinate, pickupCoordinate, routeCoordinates, routeStopMarkers]
  );

  const fitKey = `${routeCoordinates.length > 1 ? 'route' : 'points'}:${acceptedDriverMarkers.length}`;
  const lastFitKeyRef = useRef('');

  useEffect(() => {
    if (!mapRef.current || !mapRegion) return undefined;
    if (lastFitKeyRef.current === fitKey) return undefined;
    const fitCoordinates = [
      pickupCoordinate,
      dropoffCoordinate,
      ...routeStopMarkers.map((stop) => stop.coordinate),
      ...sampleCoordinatesForFit(routeCoordinates),
      ...acceptedDriverMarkers.map((driver) => driver?.coordinate),
    ].filter(Boolean);
    if (fitCoordinates.length < 1) return undefined;

    const timeout = setTimeout(() => {
      try {
        if (fitCoordinates.length >= 2 && mapRef.current?.fitToCoordinates) {
          mapRef.current.fitToCoordinates(fitCoordinates, {
            edgePadding: { top: acceptedDriverMarkers.length ? 260 : 110, right: 40, bottom: 360, left: 40 },
            animated: hasAutoFitMapRef.current,
          });
          hasAutoFitMapRef.current = true;
          lastFitKeyRef.current = fitKey;
          return;
        }
        mapRef.current?.animateToRegion?.(mapRegion, hasAutoFitMapRef.current ? 250 : 400);
        hasAutoFitMapRef.current = true;
        lastFitKeyRef.current = fitKey;
      } catch {
        // Keep nearby-cars map resilient if a fit request fails.
      }
    }, 200);

    return () => clearTimeout(timeout);
  }, [fitKey]);

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

  useEffect(() => {
    const ids = acceptedDrivers.map((driver) => String(driver?.id || '')).filter(Boolean);
    const assignedId = assignedDriver?.id ? String(assignedDriver.id) : '';
    const incomingIds = assignedId ? [...new Set([...ids, assignedId])] : ids;
    const newIds = incomingIds.filter((id) => !seenAcceptedDriverIdsRef.current.has(id));
    newIds.forEach((id) => seenAcceptedDriverIdsRef.current.add(id));
  }, [acceptedDrivers, assignedDriver]);

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
    const selectedDriverId = String(driver?.id || '').trim();
    if (!selectedDriverId || isSubmittingDriverId) return;
    try {
      setIsSubmittingDriverId(selectedDriverId);
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      if (!rideRequest?.id) return;
      const data = await selectRideDriver(token, rideRequest.id, selectedDriverId);
      const assigned = data?.assignedDriver || null;
      const assignedDriverId = String(
        assigned?.id
        || assigned?.driverUserId
        || data?.rideRequest?.driverUserId
        || ''
      ).trim();
      if (assignedDriverId && assignedDriverId !== selectedDriverId) {
        console.error('[passenger.nearby] selected driver mismatch', {
          rideRequestId: rideRequest.id,
          selectedDriverId,
          assignedDriverId,
          assigned,
        });
        await refreshRideStatus({ silent: true });
        Alert.alert(
          'Driver changed',
          'This ride was assigned to a different driver. Please review the trip details before continuing.'
        );
        return;
      }
      const nextAssigned = assigned || driver || null;
      const nextStatus = String(data?.rideRequest?.status || 'driver_assigned').toLowerCase();
      setAssignedDriver(nextAssigned);
      setRideStatus((current) => current ? {
        ...current,
        status: nextStatus,
        driverUserId: selectedDriverId,
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
        selectedTier: nextAssigned?.tier || selectedTier,
        driver: nextAssigned,
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
  const bottomSafeInset = Math.max(insets.bottom, 12);
  const minimumFare = Number(rideStatus?.minimumFareAmount ?? rideRequest?.minimumFareAmount ?? finalEstimatedAmount ?? 0);
  const maximumFare = Math.ceil(Math.max(minimumFare * 2, minimumFare + 5));
  const [fareDraft, setFareDraft] = useState(null);
  const [savingFare, setSavingFare] = useState(false);
  const shownFare = fareDraft ?? finalEstimatedAmount;
  const fareChanged = fareDraft !== null && Math.abs(fareDraft - finalEstimatedAmount) >= 0.01;

  const changeFareDraft = (delta) => {
    const next = Math.round((shownFare + delta) * 100) / 100;
    setFareDraft(Math.min(maximumFare, Math.max(minimumFare, next)));
  };

  const handleSaveFare = async () => {
    if (!fareChanged || savingFare || !rideRequest?.id) return;
    try {
      setSavingFare(true);
      const token = await getAuthToken();
      if (!token) throw new Error('Not signed in');
      const data = await updateRideFare(token, rideRequest.id, fareDraft);
      const nextFare = Number(data?.fareAmount ?? fareDraft);
      setRideStatus((current) => ({ ...(current || {}), estimatedAmount: nextFare, finalEstimatedAmount: nextFare }));
      setFareDraft(null);
      refreshRideStatus({ silent: true });
    } catch (error) {
      Alert.alert('Could not update fare', error?.message || 'Please try again.');
    } finally {
      setSavingFare(false);
    }
  };

  const mapPickupCoordinate = normalizeRouteCoordinate(pickupCoordinate);
  const mapDropoffCoordinate = normalizeRouteCoordinate(dropoffCoordinate);

  if (!mapPickupCoordinate || !mapDropoffCoordinate) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-center text-2xl font-bold text-gray-900">Could not load this ride request</Text>
        <Text className="mt-2 text-center text-base text-gray-500">
          The pickup or drop-off location is missing. Please start the booking again.
        </Text>
        <TouchableOpacity
          onPress={() => navigation.reset({ index: 0, routes: [{ name: 'PassengerBookingHome', params: { resetRideDraftAt: Date.now() } }] })}
          className="mt-6 h-14 w-full items-center justify-center rounded-[18px]"
          style={{ backgroundColor: PRIMARY_BLUE }}
        >
          <Text className="text-base font-bold text-white">Back to booking</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const viewingText = acceptedDrivers.length > 0
    ? `${acceptedDrivers.length} driver${acceptedDrivers.length === 1 ? '' : 's'} sent you an offer`
    : driversViewingCount > 0
      ? `${driversViewingCount} driver${driversViewingCount === 1 ? ' is' : 's are'} viewing your request`
      : 'Sending your request to nearby drivers';

  return (
    <View className="flex-1 bg-white">
      <View className="flex-1">
        <MapView
          ref={mapRef}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          initialRegion={mapRegion || {
            latitude: mapPickupCoordinate.latitude,
            longitude: mapPickupCoordinate.longitude,
            latitudeDelta: PASSENGER_RIDE_MAP_MIN_DELTA,
            longitudeDelta: PASSENGER_RIDE_MAP_MIN_DELTA,
          }}
          maxBounds={BULAWAYO_GEO_LOCK_ENABLED ? BULAWAYO_SERVICE_BOUNDS_ARRAY : undefined}
          showsCompass={false}
          toolbarEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
        >
          <Circle
            center={mapPickupCoordinate}
            radius={1200}
            fillColor="rgba(37,99,235,0.10)"
            strokeColor="rgba(37,99,235,0.25)"
            strokeWidth={1}
          />
          {routeCoordinates.length > 1 ? (
            <Polyline coordinates={routeCoordinates} strokeColor={PRIMARY_BLUE} strokeWidth={5} />
          ) : null}
          <LetterMarker coordinate={mapPickupCoordinate} title="Pickup" letter="A" color={PIN_COLORS.start} />
          {routeStopMarkers.map((stop) => (
            <LetterMarker
              key={stop.key}
              coordinate={stop.coordinate}
              title={stop.label}
              letter={stop.letter}
              color={PIN_COLORS.stop}
            />
          ))}
          <LetterMarker coordinate={mapDropoffCoordinate} title="Drop-off" letter="B" color={PIN_COLORS.finish} />
          {liveDriverMarkers.map((driver) => (
            <DriverVehicleMapMarker
              key={`live-driver-${driver.id}`}
              coordinate={driver.coordinate}
              headingDegrees={driver.headingDegrees || driver.heading || 0}
              size={26}
            />
          ))}
          {acceptedDriverMarkers.map((driver) => (
            <DriverVehicleMapMarker
              key={`accepted-driver-${driver.id}`}
              coordinate={driver.coordinate}
              headingDegrees={driver.headingDegrees || driver.heading || 0}
              etaLabel={driver.etaMinutes ? `${driver.etaMinutes} min` : null}
              size={26}
            />
          ))}
        </MapView>

        {hasDrivers ? (
          <View className="absolute left-0 right-0 px-3" style={{ top: insets.top + 8, maxHeight: '48%' }}>
            <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled>
              {acceptedDrivers.map((driver) => (
                <OfferCard
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
                  isBusy={Boolean(isSubmittingDriverId)}
                />
              ))}
            </ScrollView>
          </View>
        ) : (
          <View className="absolute left-4" style={{ top: insets.top + 8 }}>
            <TouchableOpacity
              onPress={handleCancelRequest}
              className="h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white"
            >
              <Ionicons name="chevron-back" size={22} color="#111827" />
            </TouchableOpacity>
          </View>
        )}

        <View
          className="absolute bottom-0 left-0 right-0 rounded-t-[28px] border-t border-gray-200 bg-white px-5 pt-4"
          style={{ paddingBottom: bottomSafeInset }}
        >
          <View className="flex-row items-center justify-between">
            <Text className="flex-1 pr-3 text-[14px] text-gray-700">{viewingText}</Text>
            <View className="flex-row items-center">
              {visibleDriversPreview.slice(0, 3).map((driver, index) => (
                <ViewingAvatar key={driver.id} driver={driver} size={30} overlap={index > 0} />
              ))}
            </View>
          </View>
          <SearchProgressBar />

          <Text className="mt-4 text-[20px] font-bold text-gray-900">
            {hasDrivers ? 'Choose your driver' : 'Locating driver nearby'}
          </Text>

          <View className="mt-3 flex-row items-center rounded-2xl border border-gray-200 px-3 py-3">
            <TouchableOpacity
              onPress={() => changeFareDraft(-1)}
              disabled={savingFare || shownFare <= minimumFare}
              className="h-11 w-12 items-center justify-center rounded-xl border border-gray-200"
              style={{ opacity: shownFare <= minimumFare ? 0.4 : 1 }}
            >
              <Text className="text-[16px] font-bold text-gray-800">-1</Text>
            </TouchableOpacity>
            <View className="flex-1 items-center">
              <Text className="text-[22px] font-extrabold text-gray-900">{formatOfferPrice(shownFare)}</Text>
              <Text className="mt-0.5 text-[11px] text-gray-500">
                Recommended fare: {formatOfferPrice(minimumFare)} · {paymentLabel}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => changeFareDraft(1)}
              disabled={savingFare || shownFare >= maximumFare}
              className="h-11 w-12 items-center justify-center rounded-xl border border-gray-200"
              style={{ opacity: shownFare >= maximumFare ? 0.4 : 1 }}
            >
              <Text className="text-[16px] font-bold text-gray-800">+1</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={handleSaveFare}
            disabled={!fareChanged || savingFare}
            className="mt-3 h-12 items-center justify-center rounded-full"
            style={{ backgroundColor: fareChanged ? PRIMARY_BLUE : '#e5e7eb' }}
            activeOpacity={0.85}
          >
            {savingFare ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text className="text-[15px] font-bold" style={{ color: fareChanged ? '#fff' : '#9ca3af' }}>
                {fareChanged && fareDraft < finalEstimatedAmount ? 'Lower fare' : 'Raise fare'}
              </Text>
            )}
          </TouchableOpacity>

          <View className="mt-3 flex-row items-center">
            <View className="h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: PIN_COLORS.start }}>
              <Text className="text-[10px] font-extrabold text-white">A</Text>
            </View>
            <Text className="ml-2.5 flex-1 text-[13px] text-gray-700" numberOfLines={1}>{pickupLabel}</Text>
          </View>
          <View className="mt-1.5 flex-row items-center">
            <View className="h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: PIN_COLORS.finish }}>
              <Text className="text-[10px] font-extrabold text-white">B</Text>
            </View>
            <Text className="ml-2.5 flex-1 text-[13px] text-gray-700" numberOfLines={1}>{dropoffLabel}</Text>
          </View>

          <TouchableOpacity onPress={handleCancelRequest} className="mt-2 items-center py-2.5" activeOpacity={0.7}>
            <Text className="text-[14px] font-semibold text-red-600">
              {isCancellingRequest ? 'Cancelling...' : 'Cancel request'}
            </Text>
          </TouchableOpacity>
        </View>
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

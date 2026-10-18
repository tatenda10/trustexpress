import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Image, Alert, ScrollView, ActivityIndicator, TextInput, Platform, Modal, Dimensions, PanResponder, Linking, AppState, Vibration } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../auth/AuthProvider';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Polyline } from '../../components/maps/MapViewCompat';
import { LetterMarker, PIN_COLORS, stopLetter } from '../../components/maps/LetterPin';
import DriverVehicleMapMarker from '../../components/maps/DriverVehicleMapMarker';
import { calculateDistanceKm, getHeadingAlongRoute, normalizeCoordinate, normalizeCoordinates } from '../../lib/mapVehicleHeading';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import * as ExpoLinking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { cancelRideRequest, getApiUrl, getDirectionsRoute, getPassengerRideRequestStatus, choosePassengerRideCashPayment, initiatePassengerRideSmilePay, reportLostItem, resolveUploadedMediaUrl, sendRidePanicAlert, submitPassengerDriverRating, tipDriver, confirmPassengerPickup, verifyPassengerRideSmilePay } from '../../api';
import RideRatingTagPicker from '../../components/ride/RideRatingTagPicker';
import { downloadReceiptPdf } from '../../services/receiptPrint';
import { receiptPaymentMethodLabel } from '../../constants/payment';
import { PRIMARY_BLUE } from '../../constants/colors';
import { PASSENGER_CANCELLATION_REASONS } from '../../constants/cancellationReasons';
import {
  PASSENGER_DRIVER_RATING_GROUPS,
  buildRatingReviewText,
  toggleRatingTag,
} from '../../constants/rideRatingTags';
import { BULAWAYO_GEO_LOCK_ENABLED, BULAWAYO_SERVICE_BOUNDS_ARRAY } from '../../constants/serviceArea';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { PASSENGER_ARRIVAL_VIBRATION_PATTERN, showLocalRideNotification } from '../../notifications';
import { connectRealtime } from '../../realtime';
import {
  PASSENGER_RIDE_MAP_MAX_DELTA,
  PASSENGER_RIDE_MAP_MIN_DELTA,
  buildPassengerRideMapRegion,
  getPassengerTrackingFitCoordinates,
} from '../../lib/passengerRideMap';
import { isTransientNetworkError, withNetworkRetry } from '../../lib/networkRetry';

WebBrowser.maybeCompleteAuthSession();

const TRACKING_STATUS_REFRESH_MS = 1500;
const TRACKING_STATUS_REFRESH_ON_TRIP_MS = 2000;
const PICKUP_WAIT_SECONDS = 5 * 60;
const ROUTE_OFF_ROUTE_REFETCH_METERS = 60;
const ROUTE_PERIODIC_REFETCH_MS = 45000;
const ROUTE_PERIODIC_REFETCH_MIN_MOVE_METERS = 150;
const LIVE_DIRECTIONS_CACHE_TTL_SECONDS = 20;
const MAP_USER_INTERACTION_GRACE_MS = 10000;
const RIDE_STATUS_LOAD_TIMEOUT_MS = 8000;

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`${label} timed out`);
      error.status = 0;
      reject(error);
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function mapRideStatusToStage(status) {
  switch (String(status || '').toLowerCase()) {
    case 'driver_arrived':
      return 'waiting_at_pickup';
    case 'in_progress':
      return 'on_trip';
    case 'completed':
      return 'completed';
    default:
      return '';
  }
}

function isTerminalRideStatus(status) {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'completed' || normalized === 'cancelled';
}

function rideProgressRank(stage, status) {
  const normalizedStatus = String(status || '').toLowerCase();
  const normalizedStage = String(stage || mapRideStatusToStage(normalizedStatus) || '').toLowerCase();
  if (normalizedStatus === 'cancelled' || normalizedStage === 'cancelled') return 50;
  if (normalizedStatus === 'completed' || normalizedStage === 'completed') return 40;
  if (normalizedStatus === 'in_progress' || normalizedStage === 'on_trip') return 30;
  if (normalizedStatus === 'driver_arrived' || normalizedStage === 'waiting_at_pickup') return 20;
  return 10;
}

function findNearestRouteIndex(routeCoordinates, coordinate) {
  const safeCoordinate = normalizeCoordinate(coordinate);
  const safeRouteCoordinates = normalizeCoordinates(routeCoordinates);
  if (!safeCoordinate || !safeRouteCoordinates.length) return -1;

  let nearestIndex = 0;
  let nearestDistance = Infinity;
  safeRouteCoordinates.forEach((routeCoordinate, index) => {
    const distanceMeters = calculateDistanceKm(routeCoordinate, safeCoordinate) * 1000;
    if (distanceMeters < nearestDistance) {
      nearestDistance = distanceMeters;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}

function distanceToRouteMeters(routeCoordinates, coordinate) {
  const safeCoordinate = normalizeCoordinate(coordinate);
  const safeRouteCoordinates = normalizeCoordinates(routeCoordinates);
  if (!safeCoordinate || safeRouteCoordinates.length === 0) return Infinity;
  return safeRouteCoordinates.reduce(
    (best, routeCoordinate) => Math.min(best, calculateDistanceKm(routeCoordinate, safeCoordinate) * 1000),
    Infinity,
  );
}

function polylineLengthMeters(routeCoordinates) {
  const points = normalizeCoordinates(routeCoordinates);
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += calculateDistanceKm(points[index - 1], points[index]) * 1000;
  }
  return total;
}

function isCoordinateInsideRegion(coordinate, region, insetRatio = 0.2) {
  const safeCoordinate = normalizeCoordinate(coordinate);
  if (!safeCoordinate || !region) return true;
  const halfLat = (Number(region.latitudeDelta) / 2) * (1 - insetRatio);
  const halfLng = (Number(region.longitudeDelta) / 2) * (1 - insetRatio);
  if (!Number.isFinite(halfLat) || !Number.isFinite(halfLng)) return true;
  return Math.abs(safeCoordinate.latitude - region.latitude) <= halfLat
    && Math.abs(safeCoordinate.longitude - region.longitude) <= halfLng;
}

function buildImmediateRouteCoordinates(currentRouteCoordinates, origin, destination) {
  const safeOrigin = normalizeCoordinate(origin);
  const safeDestination = normalizeCoordinate(destination);
  const safeRouteCoordinates = normalizeCoordinates(currentRouteCoordinates);
  if (!safeOrigin || !safeDestination) return [];
  if (safeRouteCoordinates.length < 2) return [safeOrigin, safeDestination];

  const nearestIndex = findNearestRouteIndex(safeRouteCoordinates, safeOrigin);
  const remainingRoute = nearestIndex >= 0
    ? safeRouteCoordinates.slice(Math.min(nearestIndex + 1, safeRouteCoordinates.length - 1))
    : [];
  const lastRemaining = remainingRoute[remainingRoute.length - 1];
  const shouldAppendDestination = !lastRemaining || calculateDistanceKm(lastRemaining, safeDestination) * 1000 > 5;

  return [
    safeOrigin,
    ...remainingRoute,
    ...(shouldAppendDestination ? [safeDestination] : []),
  ];
}

function areCoordinateListsClose(a, b, tolerance = 0.000001) {
  const first = normalizeCoordinates(a);
  const second = normalizeCoordinates(b);
  if (first.length !== second.length) return false;
  return first.every((coordinate, index) => (
    Math.abs(coordinate.latitude - second[index].latitude) <= tolerance &&
    Math.abs(coordinate.longitude - second[index].longitude) <= tolerance
  ));
}

function nextRouteCoordinates(currentRouteCoordinates, origin, destination) {
  const next = buildImmediateRouteCoordinates(currentRouteCoordinates, origin, destination);
  return areCoordinateListsClose(currentRouteCoordinates, next) ? currentRouteCoordinates : next;
}

function decodePolyline(encoded, precision = 5) {
  if (!encoded) return [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const coordinates = [];
  const factor = Math.pow(10, precision);

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = null;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= encoded.length);

    latitude += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= encoded.length);

    longitude += (result & 1) ? ~(result >> 1) : (result >> 1);
    coordinates.push({ latitude: latitude / factor, longitude: longitude / factor });
  }

  return coordinates;
}

const EMPTY_COORDINATES = [];

// Keeps the same array reference while the points are unchanged so map polylines are not redrawn on every poll.
function useStableCoordinates(coordinates) {
  const ref = useRef(coordinates);
  const previous = ref.current;
  const unchanged = previous.length === coordinates.length
    && coordinates.every((point, index) => (
      Math.abs(Number(point?.latitude) - Number(previous[index]?.latitude)) < 0.00001
      && Math.abs(Number(point?.longitude) - Number(previous[index]?.longitude)) < 0.00001
    ));
  if (!unchanged) ref.current = coordinates;
  return ref.current;
}

function formatClockTime(timestampMs) {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return '--:--';
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours % 12 || 12}:${minutes} ${hours >= 12 ? 'PM' : 'AM'}`;
}

function formatCountdown(totalSeconds) {
  const safeSeconds = Math.max(0, Number(totalSeconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function parseTimestampMs(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function buildTrackingRegion(driverCoordinate, pickupCoordinate, dropoffCoordinate, targetCoordinate, stage) {
  const driver = normalizeCoordinate(driverCoordinate);
  const pickup = normalizeCoordinate(pickupCoordinate);
  const dropoff = normalizeCoordinate(dropoffCoordinate);
  const target = normalizeCoordinate(targetCoordinate);
  const focusCoordinates = [];

  if (driver) focusCoordinates.push(driver);
  if (stage === 'on_trip') {
    if (target) focusCoordinates.push(target);
    else if (dropoff) focusCoordinates.push(dropoff);
  } else if (pickup) {
    focusCoordinates.push(pickup);
  }
  if (!driver && dropoff && focusCoordinates.every((item) => item !== dropoff)) {
    focusCoordinates.push(dropoff);
  }
  if (focusCoordinates.length === 0) {
    if (pickup) focusCoordinates.push(pickup);
    if (dropoff && dropoff !== pickup) focusCoordinates.push(dropoff);
  }

  return buildPassengerRideMapRegion(focusCoordinates, {
    minDelta: PASSENGER_RIDE_MAP_MIN_DELTA,
    maxDelta: PASSENGER_RIDE_MAP_MAX_DELTA,
  });
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

function formatDriverRatingLabel(driver) {
  if (!driver) return 'Loading rating…';
  const hasRatingField = Object.prototype.hasOwnProperty.call(driver, 'rating')
    || Object.prototype.hasOwnProperty.call(driver, 'ratingCount');
  const ratingCount = Number(driver.ratingCount || 0);
  const rating = Number(driver.rating);
  if (ratingCount > 0 && Number.isFinite(rating) && rating > 0) {
    return `${rating.toFixed(2)} rating`;
  }
  if (!hasRatingField) return 'Loading rating…';
  return 'New driver';
}

function mergeAssignedDriver(current, next, mergedCoordinate = null) {
  if (!next) return current || null;
  if (!current) return next;
  const nextRating = Number(next.rating);
  const currentRating = Number(current.rating);
  const preferNextRating = next.rating != null && Number.isFinite(nextRating) && nextRating > 0;
  const preferCurrentRating = current.rating != null && Number.isFinite(currentRating) && currentRating > 0;
  return {
    ...current,
    ...next,
    coordinate: mergedCoordinate || next.coordinate || current.coordinate || null,
    profileImageUrl: next.profileImageUrl || current.profileImageUrl || null,
    carImage: next.carImage || current.carImage || null,
    carName: next.carName || current.carName || null,
    plate: next.plate || current.plate || null,
    phoneNumber: next.phoneNumber || current.phoneNumber || null,
    driverName: next.driverName || current.driverName || null,
    rating: preferNextRating
      ? next.rating
      : (preferCurrentRating ? current.rating : (next.rating ?? current.rating ?? null)),
    ratingCount: Number(next.ratingCount || 0) > 0
      ? Number(next.ratingCount)
      : (Number(current.ratingCount || 0) > 0 ? Number(current.ratingCount) : Number(next.ratingCount || 0)),
  };
}

async function fetchTrackingDirections(token, origin, destination, waypoints = []) {
  const safeOrigin = normalizeCoordinate(origin);
  const safeDestination = normalizeCoordinate(destination);
  const safeWaypoints = normalizeCoordinates(waypoints);
  if (!token || !safeOrigin || !safeDestination) return null;

  const data = await getDirectionsRoute(token, {
    origin: safeOrigin,
    destination: safeDestination,
    waypoints: safeWaypoints,
    cacheTtlSeconds: LIVE_DIRECTIONS_CACHE_TTL_SECONDS,
  });
  const route = data?.route || {};

  return {
    coordinates: Array.isArray(route.coordinates) ? route.coordinates : [],
    distanceMeters: Number(route.distanceMeters || 0),
    durationSeconds: Number(route.durationSeconds || 0),
    nextInstruction: route.nextInstruction || '',
  };
}

export default function PassengerRideTrackingScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const mapRef = useRef(null);
  const lastArrivalAnnouncementRef = useRef('');
  const lastRouteOriginRef = useRef(null);
  const lastRouteTargetRef = useRef(null);
  const lastRouteFetchedAtRef = useRef(0);
  const routeCoordinatesRef = useRef([]);
  const fetchedRouteLengthRef = useRef(0);
  const routeRequestIdRef = useRef(0);
  const hasAutoFitMapRef = useRef(false);
  const lastAutoFitStageRef = useRef('');
  const {
    pickupCoordinate: initialPickupCoordinate,
    dropoffCoordinate: initialDropoffCoordinate,
    pickupLabel: initialPickupLabel,
    dropoffLabel: initialDropoffLabel,
    intermediateStops: initialIntermediateStops = [],
    estimatedAmount: initialEstimatedAmount,
    driver: initialDriver,
    rideRequestId,
  } = route.params || {};
  const initialDriverRef = useRef(initialDriver || null);
  initialDriverRef.current = initialDriver || null;

  const [loading, setLoading] = useState(() => !rideRequestId);
  const [loadError, setLoadError] = useState('');
  const [rideStatus, setRideStatus] = useState(() => (
    rideRequestId
      ? {
          id: rideRequestId,
          stage: 'driver_on_the_way',
          pickupCoordinate: initialPickupCoordinate || null,
          dropoffCoordinate: initialDropoffCoordinate || null,
          pickupLabel: initialPickupLabel || null,
          dropoffLabel: initialDropoffLabel || null,
          intermediateStops: Array.isArray(initialIntermediateStops) ? initialIntermediateStops : [],
          estimatedAmount: Number(initialEstimatedAmount || 0),
          totalAmount: Number(initialEstimatedAmount || 0),
          driverCoordinate: initialDriver?.coordinate || null,
        }
      : null
  ));
  const [driver, setDriver] = useState(initialDriver || null);
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');
  const [selectedRatingTags, setSelectedRatingTags] = useState([]);
  const [submittingRating, setSubmittingRating] = useState(false);
  const [submittingTip, setSubmittingTip] = useState(false);
  const [startingPayment, setStartingPayment] = useState(false);
  const [showCancelReasonModal, setShowCancelReasonModal] = useState(false);
  const [realtimeSignal, setRealtimeSignal] = useState(0);
  const [tipDraft, setTipDraft] = useState('');
  const [downloadingTripReceipt, setDownloadingTripReceipt] = useState(false);
  const [statusSyncWarning, setStatusSyncWarning] = useState('');
  const statusPollFailuresRef = useRef(0);
  const driverCancelHandledRef = useRef(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const [showDriverRatingModal, setShowDriverRatingModal] = useState(false);
  const [rideSheetCollapsed, setRideSheetCollapsed] = useState(true);
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [onTripPanelHeight, setOnTripPanelHeight] = useState(220);
  const [tripRouteCoordinates, setTripRouteCoordinates] = useState([]);
  const [routeDistanceMeters, setRouteDistanceMeters] = useState(0);
  const [routeDurationSeconds, setRouteDurationSeconds] = useState(0);
  const [tripDistanceMeters, setTripDistanceMeters] = useState(0);
  const [tripDurationSeconds, setTripDurationSeconds] = useState(0);
  const [nextInstruction, setNextInstruction] = useState('');
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [lostItemDescription, setLostItemDescription] = useState('');
  const [lostItemContactPhone, setLostItemContactPhone] = useState('');
  const [submittingLostItem, setSubmittingLostItem] = useState(false);
  const [submittingPanicAlert, setSubmittingPanicAlert] = useState(false);
  const [confirmingPickup, setConfirmingPickup] = useState(false);
  const ratingDraftTouchedRef = useRef(false);
  const lastRatingModalStateRef = useRef(false);
  const lastDriverLocationAtRef = useRef(0);
  const windowHeight = Dimensions.get('window').height;
  // Tab bar is hidden on this screen; only keep safe-area padding for the footer actions.
  const bottomActionInset = Math.max(insets.bottom + 16, 24);
  const collapsedSheetHeight = Math.min(Math.max(260, bottomActionInset + 200), Math.round(windowHeight * 0.42));
  const expandedSheetMaxHeight = Math.round(windowHeight * 0.58);
  const sheetPan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => (
      Math.abs(gesture.dy) > 10 && Math.abs(gesture.dy) > Math.abs(gesture.dx)
    ),
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dy > 36 || gesture.vy > 0.8) {
        setRideSheetCollapsed(true);
        return;
      }
      if (gesture.dy < -36 || gesture.vy < -0.8) {
        setRideSheetCollapsed(false);
      }
    },
  }), []);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    routeCoordinatesRef.current = routeCoordinates;
  }, [routeCoordinates]);

  const exitToPassengerHome = () => {
    if (navigation?.canGoBack?.()) {
      try {
        navigation.popToTop();
        return;
      } catch {
        // Fall through to a direct route replace when popToTop is unavailable.
      }
    }

    try {
      navigation.replace('PassengerBookingHome');
    } catch {
      try {
        navigation.navigate('PassengerBookingHome');
      } catch {
        // noop
      }
    }
  };

  useEffect(() => {
    if (!rideRequestId) {
      console.warn('[smilepay] rideStatus.missing_ride_id');
      setLoading(false);
      return undefined;
    }
    let active = true;
    let requestId = 0;

    const preferFresherCoordinate = (currentCoordinate, nextCoordinate, nextSeenAt = null) => {
      const current = normalizeCoordinate(currentCoordinate);
      const next = normalizeCoordinate(nextCoordinate);
      if (!next) return current;
      if (!current) return next;

      const socketUpdatedAt = Number(lastDriverLocationAtRef.current || 0);
      const pollSeenAt = nextSeenAt ? new Date(nextSeenAt).getTime() : 0;
      // Keep a recent live socket fix unless the poll clearly has a newer timestamp.
      if (socketUpdatedAt > 0 && Date.now() - socketUpdatedAt < 10000) {
        if (!Number.isFinite(pollSeenAt) || pollSeenAt <= socketUpdatedAt) {
          return current;
        }
      }
      return next;
    };

    const loadStatus = async () => {
      const currentRequestId = ++requestId;
      console.log('[smilepay] rideStatus.load.start', { rideRequestId, currentRequestId });
      try {
        const data = await withNetworkRetry(async () => {
          const token = await withTimeout(
            getTokenRef.current(),
            RIDE_STATUS_LOAD_TIMEOUT_MS,
            'Auth token'
          );
          if (!token) throw new Error('Not signed in');
          return withTimeout(
            getPassengerRideRequestStatus(token, rideRequestId),
            RIDE_STATUS_LOAD_TIMEOUT_MS,
            'Ride status'
          );
        }, { retries: 1, delayMs: 500 });
        if (!active || currentRequestId !== requestId) return;
        setLoadError('');
        console.log('[smilepay] rideStatus.load.ok', {
          rideRequestId,
          status: data?.rideRequest?.status || null,
          paymentStatus: data?.rideRequest?.paymentStatus || null,
          paymentMethod: data?.rideRequest?.paymentMethod || null,
          paymentReference: data?.rideRequest?.paymentReference || null,
        });
        setRideStatus((current) => {
          const next = data?.rideRequest || null;
          if (!next) return current;
          if (!current) return next;
          const mergedCoordinate = preferFresherCoordinate(
            current.driverCoordinate,
            next.driverCoordinate,
            next.driverLocationUpdatedAt || data?.assignedDriver?.locationUpdatedAt || null
          );
          const nextStage = next.stage || mapRideStatusToStage(next.status) || current.stage;
          const nextStatus = next.status || current.status;
          // A slow poll started before complete must not wipe the socket's terminal state.
          if (isTerminalRideStatus(current.status) && !isTerminalRideStatus(nextStatus)) {
            return {
              ...next,
              status: current.status,
              stage: current.stage || mapRideStatusToStage(current.status) || nextStage,
              driverCoordinate: mergedCoordinate,
            };
          }
          // Never let a stale response roll the trip backwards (e.g. completed -> on the way).
          if (rideProgressRank(current.stage, current.status) > rideProgressRank(nextStage, nextStatus)) {
            return {
              ...next,
              status: current.status,
              stage: current.stage,
              driverCoordinate: mergedCoordinate,
            };
          }
          return {
            ...next,
            status: nextStatus,
            stage: nextStage,
            driverCoordinate: mergedCoordinate,
          };
        });
        setDriver((current) => {
          const next = data?.assignedDriver || initialDriverRef.current || null;
          if (!next) return current;
          if (!current) return next;
          const mergedCoordinate = preferFresherCoordinate(
            current.coordinate,
            next.coordinate,
            next.locationUpdatedAt || data?.rideRequest?.driverLocationUpdatedAt || null
          );
          return mergeAssignedDriver(current, next, mergedCoordinate);
        });
        const savedRating = Number(data?.rideRequest?.passengerDriverRating || 0);
        const savedReview = String(data?.rideRequest?.passengerDriverReview || '');
        if (!ratingDraftTouchedRef.current || savedRating > 0) {
          setRating(savedRating);
          setReview(savedReview);
          if (savedRating > 0) {
            ratingDraftTouchedRef.current = false;
          }
        }
        statusPollFailuresRef.current = 0;
        setStatusSyncWarning('');
      } catch (error) {
        if (!active || currentRequestId !== requestId) return;
        console.error('[smilepay] rideStatus.load.error', {
          rideRequestId,
          message: error?.message || String(error),
          status: error?.status || null,
        });
        statusPollFailuresRef.current += 1;
        if (statusPollFailuresRef.current >= 2) {
          setStatusSyncWarning('Having trouble updating this trip. Retrying…');
        }
        if (!isTransientNetworkError(error) && statusPollFailuresRef.current >= 3) {
          setLoadError(error?.message || 'Could not load ride status.');
        }
      } finally {
        setLoading(false);
      }
    };

    loadStatus();
    // Keep a steady poll while this screen is open so completion is not missed.
    const interval = setInterval(loadStatus, TRACKING_STATUS_REFRESH_ON_TRIP_MS);

    const onAppStateChange = (nextState) => {
      if (nextState === 'active') {
        loadStatus();
      }
    };
    const appStateSub = AppState.addEventListener('change', onAppStateChange);

    return () => {
      active = false;
      clearInterval(interval);
      appStateSub?.remove?.();
    };
  }, [rideRequestId, realtimeSignal]);

  useEffect(() => {
    if (!rideRequestId) return undefined;
    let active = true;
    let localSocket = null;

    const initRealtime = async () => {
      try {
        const token = await getTokenRef.current();
        if (!active || !token) return;
        localSocket = connectRealtime(token);
        if (!localSocket) return;

        const handleRideUpdate = (payload = {}) => {
          if (!active || Number(payload.rideRequestId) !== Number(rideRequestId)) return;
          const nextStatus = String(payload.status || '').toLowerCase();
          const isPickupConfirmation = nextStatus === 'passenger_confirmed';
          const nextStage = isPickupConfirmation ? '' : mapRideStatusToStage(nextStatus);
          const nextDriverCoordinate = normalizeCoordinate(payload?.driverCoordinate);
          const hasConfirmationUpdate = Boolean(payload?.confirmedAt);
          const hasSafetyPinUpdate = payload?.safetyPinVerified !== undefined
            || payload?.safetyPinAttempts !== undefined
            || payload?.safetyPinLocked !== undefined;
          const hasStatusUpdate = Boolean(nextStatus && !isPickupConfirmation);
          if (hasStatusUpdate || nextDriverCoordinate || hasConfirmationUpdate || hasSafetyPinUpdate) {
            if (nextDriverCoordinate) {
              const payloadUpdatedAt = payload?.driverLocationUpdatedAt
                ? new Date(payload.driverLocationUpdatedAt).getTime()
                : Date.now();
              lastDriverLocationAtRef.current = Number.isFinite(payloadUpdatedAt)
                ? payloadUpdatedAt
                : Date.now();
            }
            setRideStatus((current) => {
              const base = current || {
                id: rideRequestId,
                stage: 'driver_on_the_way',
              };
              const resolvedStage = nextStage
                || mapRideStatusToStage(nextStatus)
                || base.stage
                || 'driver_on_the_way';
              if (
                hasStatusUpdate
                && rideProgressRank(base.stage, base.status) > rideProgressRank(resolvedStage, nextStatus)
                && !isTerminalRideStatus(nextStatus)
              ) {
                return {
                  ...base,
                  ...(nextDriverCoordinate ? {
                    driverCoordinate: nextDriverCoordinate,
                    driverLocationFresh: true,
                    driverLocationAgeSeconds: 0,
                    driverLocationUpdatedAt: payload?.driverLocationUpdatedAt || new Date().toISOString(),
                  } : {}),
                };
              }
              return {
                ...base,
                ...(hasStatusUpdate ? { status: nextStatus, stage: resolvedStage } : null),
                stage: hasStatusUpdate
                  ? resolvedStage
                  : (nextStage || base.stage || 'driver_on_the_way'),
                ...(nextDriverCoordinate ? {
                  driverCoordinate: nextDriverCoordinate,
                  driverLocationFresh: true,
                  driverLocationAgeSeconds: 0,
                  driverLocationUpdatedAt: payload?.driverLocationUpdatedAt || new Date().toISOString(),
                } : {}),
                ...(payload?.arrivedAt ? { arrivedAt: payload.arrivedAt } : {}),
                ...(payload?.confirmedAt ? { passengerConfirmedAt: payload.confirmedAt } : {}),
                ...(payload?.safetyPinVerified ? {
                  safetyPinVerified: true,
                  safetyPinVerifiedAt: payload.safetyPinVerifiedAt || base.safetyPinVerifiedAt,
                  safetyPin: null,
                } : {}),
                ...(payload?.safetyPinAttempts !== undefined ? { safetyPinAttempts: Number(payload.safetyPinAttempts || 0) } : {}),
                ...(payload?.safetyPinLocked !== undefined ? { safetyPinLocked: Boolean(payload.safetyPinLocked) } : {}),
                ...(payload?.paymentStatus ? { paymentStatus: payload.paymentStatus } : {}),
              };
            });
            if (nextDriverCoordinate) {
              setDriver((current) => (current ? {
                ...current,
                coordinate: nextDriverCoordinate,
                locationFresh: true,
                locationAgeSeconds: 0,
              } : current));
            }
          }
          // Only bump poll signal for meaningful ride-state changes, not location ticks.
          if (hasStatusUpdate || hasConfirmationUpdate || hasSafetyPinUpdate) {
            setRealtimeSignal((current) => current + 1);
          }
        };

        localSocket.on('ride_status:updated', handleRideUpdate);

        localSocket.__passengerTrackingCleanup = () => {
          localSocket.off('ride_status:updated', handleRideUpdate);
        };
      } catch {
        // Polling remains as fallback.
      }
    };

    initRealtime();

    return () => {
      active = false;
      localSocket?.__passengerTrackingCleanup?.();
    };
  }, [rideRequestId]);

  useEffect(() => {
    if (rideStatus?.status !== 'cancelled') return;
    if (driverCancelHandledRef.current) return;
    driverCancelHandledRef.current = true;
    const cancelledPaymentStatus = String(rideStatus?.paymentStatus || '').toLowerCase();
    if (cancelledPaymentStatus === 'refunded') {
      Alert.alert(
        'Ride cancelled',
        'Your Captain cancelled before the trip started. Your online payment has been refunded.',
        [{ text: 'OK', onPress: exitToPassengerHome }]
      );
      return;
    }
    if (cancelledPaymentStatus === 'refund_pending') {
      Alert.alert(
        'Ride cancelled',
        'Your Captain cancelled before the trip started. Your online payment is being refunded.',
        [{ text: 'OK', onPress: exitToPassengerHome }]
      );
      return;
    }
    exitToPassengerHome();
  }, [rideStatus?.status, rideStatus?.paymentStatus]);

  const pickupCoordinateSource = rideStatus?.pickupCoordinate || initialPickupCoordinate;
  const dropoffCoordinateSource = rideStatus?.dropoffCoordinate || initialDropoffCoordinate;
  const pickupCoordinateKey = JSON.stringify(pickupCoordinateSource || null);
  const dropoffCoordinateKey = JSON.stringify(dropoffCoordinateSource || null);
  const pickupCoordinate = useMemo(
    () => normalizeCoordinate(pickupCoordinateSource),
    [pickupCoordinateKey],
  );
  const dropoffCoordinate = useMemo(
    () => normalizeCoordinate(dropoffCoordinateSource),
    [dropoffCoordinateKey],
  );
  const pickupLabel = rideStatus?.pickupLabel || initialPickupLabel;
  const dropoffLabel = rideStatus?.dropoffLabel || initialDropoffLabel;
  const estimatedAmount = Number(rideStatus?.estimatedAmount || initialEstimatedAmount || 0);
  const tipAmount = Number(rideStatus?.tipAmount || 0);
  const totalAmount = Number(rideStatus?.totalAmount || (estimatedAmount + tipAmount) || 0);
  const stage = rideStatus?.stage || 'driver_on_the_way';
  const isCompleted = stage === 'completed';
  const passengerConfirmedPickup = Boolean(rideStatus?.passengerConfirmedAt);
  const safetyPinRequired = Boolean(rideStatus?.safetyPinRequired);
  const safetyPinVerified = Boolean(rideStatus?.safetyPinVerified);
  const safetyPinLocked = Boolean(rideStatus?.safetyPinLocked);
  const safetyPinValue = String(rideStatus?.safetyPin || '').trim();
  const showSafetyPinBanner = safetyPinRequired && !safetyPinVerified && !isCompleted && stage !== 'on_trip' && safetyPinValue;
  const hasPassengerDriverRating = Number(rideStatus?.passengerDriverRating || 0) > 0;
  const paymentStatus = String(rideStatus?.paymentStatus || 'unpaid').toLowerCase();
  const paymentMethod = String(rideStatus?.paymentMethod || '').toLowerCase();
  const isRefundedPayment = paymentStatus === 'refunded' || paymentStatus === 'refund_pending';
  const canPromptForTip = Boolean(rideStatus?.canTipDriver) && tipAmount <= 0 && paymentStatus !== 'paid';
  const shouldPromptForRating = isCompleted && !hasPassengerDriverRating;
  const shouldPromptForPostTrip = isCompleted && (shouldPromptForRating || canPromptForTip);
  const canPayWithSmilePay = Boolean(rideStatus?.canPayWithSmilePay) && paymentStatus !== 'paid' && paymentMethod !== 'cash' && !isRefundedPayment;
  const canPayCash = Boolean(rideStatus?.canPayCash) && paymentStatus !== 'paid' && paymentMethod !== 'cash' && !isRefundedPayment;
  const showPaymentCard = canPayCash || canPayWithSmilePay || paymentStatus === 'paid' || paymentStatus === 'pending' || isRefundedPayment;
  const driverHasArrived = stage === 'waiting_at_pickup';
  const driverCoordinateSource = rideStatus?.driverCoordinate || driver?.coordinate;
  const driverCoordinateKey = JSON.stringify(driverCoordinateSource || null);
  const driverCoordinate = useMemo(
    () => normalizeCoordinate(driverCoordinateSource),
    [driverCoordinateKey],
  );
  const hasDriverCoordinate = Boolean(driverCoordinate);
  const driverLocationAgeSeconds = Number(rideStatus?.driverLocationAgeSeconds ?? driver?.locationAgeSeconds ?? 0);
  const driverLocationFresh = hasDriverCoordinate && (
    rideStatus?.driverLocationFresh === true
    || driver?.locationFresh === true
    || (driverLocationAgeSeconds > 0 && driverLocationAgeSeconds <= 45)
  );
  const intermediateStopsSource = Array.isArray(rideStatus?.intermediateStops)
    ? rideStatus.intermediateStops
    : Array.isArray(initialIntermediateStops)
      ? initialIntermediateStops
      : [];
  const intermediateStopsKey = JSON.stringify(intermediateStopsSource || []);
  const intermediateStops = useMemo(
    () => intermediateStopsSource,
    [intermediateStopsKey],
  );
  const currentStopIndex = Number(rideStatus?.currentStopIndex || 0);
  const remainingIntermediateStopsCount = Number(rideStatus?.remainingIntermediateStopsCount || 0);
  const currentIntermediateStop = rideStatus?.currentIntermediateStop || intermediateStops[currentStopIndex] || null;
  const currentTargetLabel = rideStatus?.currentTargetLabel
    || currentIntermediateStop?.label
    || dropoffLabel;
  const currentTargetCoordinateSource = rideStatus?.currentTargetCoordinate
    || currentIntermediateStop?.coordinate
    || dropoffCoordinate;
  const currentTargetCoordinateKey = JSON.stringify(currentTargetCoordinateSource || null);
  const currentTargetCoordinate = useMemo(
    () => normalizeCoordinate(currentTargetCoordinateSource),
    [currentTargetCoordinateKey],
  );
  const activeTarget = useMemo(
    () => (
      stage === 'on_trip' || (stage === 'waiting_at_pickup' && passengerConfirmedPickup)
        ? currentTargetCoordinate || dropoffCoordinate
        : pickupCoordinate
    ),
    [currentTargetCoordinate, dropoffCoordinate, passengerConfirmedPickup, pickupCoordinate, stage],
  );
  const driverProfileImageUrl = resolveUploadedMediaUrl(driver?.profileImageUrl);
  const driverRatingValue = Number(driver?.ratingCount || 0) > 0 && Number(driver?.rating) > 0
    ? Number(driver.rating)
    : null;
  const driverCarName = driver?.carName && driver.carName !== '-' ? driver.carName : '';
  const driverPlate = driver?.plate && driver.plate !== '-' ? driver.plate : '';

  const triggerPassengerArrivalAlert = useCallback(() => {
    const announcementKey = String(rideRequestId || '');
    if (!announcementKey || lastArrivalAnnouncementRef.current === announcementKey) return undefined;
    lastArrivalAnnouncementRef.current = announcementKey;
    try {
      Vibration.vibrate(PASSENGER_ARRIVAL_VIBRATION_PATTERN, false);
    } catch (_) {}
    try {
      Speech.stop();
      Speech.speak('Your driver has arrived at the pickup point.', {
        rate: 0.95,
        pitch: 1.0,
        language: 'en',
      });
    } catch (_) {}
    return undefined;
  }, [rideRequestId]);

  useEffect(() => {
    if (stage !== 'waiting_at_pickup') return undefined;
    setNowTick(Date.now());
    const interval = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [stage]);

  useEffect(() => {
    const shouldOpen = shouldPromptForPostTrip;
    if (lastRatingModalStateRef.current !== shouldOpen) {
      lastRatingModalStateRef.current = shouldOpen;
      setShowDriverRatingModal(shouldOpen);
    }
    if (!shouldOpen) {
      ratingDraftTouchedRef.current = false;
    }
  }, [shouldPromptForPostTrip]);

  useEffect(() => {
    if (stage !== 'waiting_at_pickup') return undefined;
    return triggerPassengerArrivalAlert();
  }, [stage, triggerPassengerArrivalAlert]);

  useEffect(() => {
    if (!hasDriverCoordinate || !activeTarget || isCompleted) {
      setRouteCoordinates([]);
      setRouteDistanceMeters(0);
      setRouteDurationSeconds(0);
      setNextInstruction('');
      setRouteError('');
      return undefined;
    }

    const previousOrigin = lastRouteOriginRef.current;
    const previousTarget = lastRouteTargetRef.current;
    const movedDistanceMeters = previousOrigin
      ? calculateDistanceKm(previousOrigin, driverCoordinate) * 1000
      : Infinity;
    const targetChanged = previousTarget
      ? calculateDistanceKm(previousTarget, activeTarget) * 1000 >= 30
      : true;
    const routeAgeMs = Date.now() - lastRouteFetchedAtRef.current;
    const currentRoute = routeCoordinatesRef.current;
    const hasRoadRoute = currentRoute.length > 2;
    const offRoute = hasRoadRoute
      && distanceToRouteMeters(currentRoute, driverCoordinate) > ROUTE_OFF_ROUTE_REFETCH_METERS;
    const periodicRefresh = routeAgeMs > ROUTE_PERIODIC_REFETCH_MS
      && movedDistanceMeters > ROUTE_PERIODIC_REFETCH_MIN_MOVE_METERS;
    const retryMissingRoute = !hasRoadRoute && routeAgeMs > 15000;
    if (
      !targetChanged &&
      currentRoute.length > 0 &&
      !offRoute &&
      !periodicRefresh &&
      !retryMissingRoute
    ) {
      setRouteCoordinates((current) => nextRouteCoordinates(current, driverCoordinate, activeTarget));
      return undefined;
    }

    let cancelled = false;
    const currentRequestId = routeRequestIdRef.current + 1;
    routeRequestIdRef.current = currentRequestId;
    lastRouteOriginRef.current = driverCoordinate;
    lastRouteTargetRef.current = activeTarget;
    lastRouteFetchedAtRef.current = Date.now();
    const fallbackDistanceKm = calculateDistanceKm(driverCoordinate, activeTarget);
    const fallbackDistanceMeters = Number.isFinite(fallbackDistanceKm)
      ? Math.max(0, Math.round(fallbackDistanceKm * 1000))
      : 0;
    const fallbackDurationSeconds = fallbackDistanceMeters > 0
      ? Math.max(60, Math.round((fallbackDistanceMeters / 1000) * 4 * 60))
      : 0;
    const keepTrimmedRoadRoute = () => {
      setRouteCoordinates((current) => (
        !targetChanged && normalizeCoordinates(current).length > 2
          ? nextRouteCoordinates(current, driverCoordinate, activeTarget)
          : [driverCoordinate, activeTarget].filter(Boolean)
      ));
    };
    if (targetChanged || routeCoordinatesRef.current.length === 0) {
      fetchedRouteLengthRef.current = 0;
      setRouteCoordinates((current) => nextRouteCoordinates(targetChanged ? [] : current, driverCoordinate, activeTarget));
      setRouteDistanceMeters(fallbackDistanceMeters);
      setRouteDurationSeconds(fallbackDurationSeconds);
    } else {
      setRouteCoordinates((current) => nextRouteCoordinates(current, driverCoordinate, activeTarget));
    }

    const loadDirections = async () => {
      try {
        setRouteLoading(true);
        setRouteError('');
        const token = await getTokenRef.current();
        const route = await fetchTrackingDirections(token, driverCoordinate, activeTarget);
        if (cancelled || routeRequestIdRef.current !== currentRequestId) return;

        const fetchedRoute = Array.isArray(route?.coordinates) ? normalizeCoordinates(route.coordinates) : [];
        if (fetchedRoute.length > 1) {
          fetchedRouteLengthRef.current = fetchedRoute.length > 2 ? polylineLengthMeters(fetchedRoute) : 0;
          setRouteCoordinates(fetchedRoute);
          setRouteDistanceMeters(route?.distanceMeters || 0);
          setRouteDurationSeconds(route?.durationSeconds || 0);
          setNextInstruction(route?.nextInstruction || '');
        } else {
          keepTrimmedRoadRoute();
        }
      } catch (error) {
        if (cancelled || routeRequestIdRef.current !== currentRequestId) return;
        keepTrimmedRoadRoute();
        setNextInstruction('');
        setRouteError(error?.message || 'Could not load road directions.');
      } finally {
        if (!cancelled && routeRequestIdRef.current === currentRequestId) {
          setRouteLoading(false);
        }
      }
    };

    loadDirections();

    return () => {
      cancelled = true;
    };
  }, [activeTarget, driverCoordinate, hasDriverCoordinate, isCompleted]);

  useEffect(() => {
    if (!pickupCoordinate || !dropoffCoordinate || isCompleted) {
      setTripRouteCoordinates([]);
      setTripDistanceMeters(0);
      setTripDurationSeconds(0);
      return undefined;
    }

    let cancelled = false;
    const savedRouteCoordinates = decodePolyline(String(rideStatus?.routePolyline || '').trim());
    if (savedRouteCoordinates.length > 1) {
      setTripRouteCoordinates(savedRouteCoordinates);
      setTripDistanceMeters((current) => current > 0 ? current : Number(rideStatus?.estimatedDistanceKm || 0) * 1000);
      setTripDurationSeconds((current) => current > 0 ? current : Number(rideStatus?.estimatedMinutes || 0) * 60);
    } else {
      setTripRouteCoordinates([pickupCoordinate, dropoffCoordinate].filter(Boolean));
      setTripDistanceMeters((current) => current > 0 ? current : Number(rideStatus?.estimatedDistanceKm || 0) * 1000);
      setTripDurationSeconds((current) => current > 0 ? current : Number(rideStatus?.estimatedMinutes || 0) * 60);
    }

    const loadTripRoute = async () => {
      try {
        const token = await getTokenRef.current();
        const route = await fetchTrackingDirections(
          token,
          pickupCoordinate,
          dropoffCoordinate,
          intermediateStops.map((stop) => normalizeCoordinate(stop?.coordinate)).filter(Boolean),
        );
        if (cancelled) return;
        setTripRouteCoordinates(
          Array.isArray(route?.coordinates) && route.coordinates.length > 1
            ? normalizeCoordinates(route.coordinates)
            : [pickupCoordinate, dropoffCoordinate].filter(Boolean)
        );
        setTripDistanceMeters(Number(route?.distanceMeters || 0));
        setTripDurationSeconds(Number(route?.durationSeconds || 0));
      } catch {
        if (cancelled) return;
        setTripRouteCoordinates([pickupCoordinate, dropoffCoordinate].filter(Boolean));
        setTripDistanceMeters(0);
        setTripDurationSeconds(0);
      }
    };

    loadTripRoute();

    return () => {
      cancelled = true;
    };
  }, [
    dropoffCoordinate,
    intermediateStops,
    isCompleted,
    pickupCoordinate,
    rideStatus?.estimatedDistanceKm,
    rideStatus?.estimatedMinutes,
    rideStatus?.routePolyline,
  ]);

  const remainingRouteMeters = useMemo(
    () => (normalizeCoordinates(routeCoordinates).length > 2 ? polylineLengthMeters(routeCoordinates) : 0),
    [routeCoordinates],
  );
  const fetchedRouteLengthMeters = fetchedRouteLengthRef.current;
  const remainingRouteRatio = fetchedRouteLengthMeters > 0 && remainingRouteMeters > 0
    ? Math.min(1, remainingRouteMeters / fetchedRouteLengthMeters)
    : 1;
  const liveDriverDistanceKm = useMemo(
    () => {
      if (routeDistanceMeters > 0) return (routeDistanceMeters * remainingRouteRatio) / 1000;
      if (Number(rideStatus?.driverDistanceKm || 0) > 0 && stage !== 'on_trip') {
        return Number(rideStatus.driverDistanceKm);
      }
      return calculateDistanceKm(driverCoordinate, activeTarget);
    },
    [activeTarget, driverCoordinate, remainingRouteRatio, rideStatus?.driverDistanceKm, routeDistanceMeters, stage]
  );

  const liveEtaMinutes = useMemo(
    () => {
      if (routeDurationSeconds > 0) return Math.max(1, Math.round((routeDurationSeconds * remainingRouteRatio) / 60));
      if (Number(rideStatus?.driverEtaMinutes || 0) > 0 && stage !== 'on_trip') {
        return Number(rideStatus.driverEtaMinutes);
      }
      return Math.max(1, Math.round(liveDriverDistanceKm * 4));
    },
    [liveDriverDistanceKm, remainingRouteRatio, rideStatus?.driverEtaMinutes, routeDurationSeconds, stage]
  );
  const tripDistanceKm = useMemo(() => {
    if (tripDistanceMeters > 0) return tripDistanceMeters / 1000;
    const estimated = Number(rideStatus?.estimatedDistanceKm || 0);
    return estimated > 0 ? estimated : 0;
  }, [rideStatus?.estimatedDistanceKm, tripDistanceMeters]);
  const tripEtaMinutes = useMemo(() => {
    if (tripDurationSeconds > 0) return Math.max(1, Math.round(tripDurationSeconds / 60));
    const estimated = Number(rideStatus?.estimatedMinutes || 0);
    return estimated > 0 ? estimated : 0;
  }, [rideStatus?.estimatedMinutes, tripDurationSeconds]);
  const hasRoadDistance = routeDistanceMeters > 0;
  const liveEtaText = hasDriverCoordinate
    ? (driverLocationFresh ? `${liveEtaMinutes} min` : 'Location updating')
    : 'Finding driver';
  const liveDistanceText = hasDriverCoordinate
    ? (driverLocationFresh ? `${liveDriverDistanceKm.toFixed(1)} km` : 'Live location updating')
    : 'Finding driver';
  const tripLineCoordinates = useMemo(() => {
    const routed = normalizeCoordinates(tripRouteCoordinates);
    if (routed.length > 1) return routed;
    const points = [
      pickupCoordinate,
      ...intermediateStops.map((stop) => normalizeCoordinate(stop?.coordinate)),
      dropoffCoordinate,
    ].filter(Boolean);
    return points.length > 1 ? points : [];
  }, [dropoffCoordinate, intermediateStops, pickupCoordinate, tripRouteCoordinates]);
  const liveRouteCoordinates = useMemo(() => {
    const routed = normalizeCoordinates(routeCoordinates);
    const directLine = [driverCoordinate, activeTarget].filter(Boolean);
    const routedIsOnlyDirectLine = routed.length === 2 && areCoordinateListsClose(routed, directLine);
    if (routed.length > 1 && !routedIsOnlyDirectLine) return routed;
    if (
      (stage === 'on_trip' || (stage === 'waiting_at_pickup' && passengerConfirmedPickup)) &&
      tripLineCoordinates.length > 1
    ) {
      const preview = buildImmediateRouteCoordinates(tripLineCoordinates, driverCoordinate, activeTarget);
      if (preview.length > 1) return preview;
    }
    if (routed.length > 1) return routed;
    if (driverCoordinate && activeTarget) return [driverCoordinate, activeTarget];
    return [];
  }, [activeTarget, driverCoordinate, passengerConfirmedPickup, routeCoordinates, stage, tripLineCoordinates]);
  const displayTripLine = useStableCoordinates(tripLineCoordinates);
  const displayLiveRoute = useStableCoordinates(
    stage === 'waiting_at_pickup' || isCompleted ? EMPTY_COORDINATES : liveRouteCoordinates
  );
  const activeRouteCoordinates = useMemo(() => {
    if (liveRouteCoordinates.length > 1) return liveRouteCoordinates;
    if (driverCoordinate && activeTarget) return [driverCoordinate, activeTarget];
    return [];
  }, [activeTarget, driverCoordinate, liveRouteCoordinates]);
  const vehicleSummary = [driver?.carName, driver?.plate]
    .map((part) => String(part || '').trim())
    .filter((part) => part && part !== '-')
    .join(' · ');

  const vehicleHeadingDegrees = useMemo(
    () => getHeadingAlongRoute(
      activeRouteCoordinates,
      driverCoordinate,
      stage === 'on_trip' ? activeTarget : pickupCoordinate,
    ) ?? 0,
    [activeRouteCoordinates, activeTarget, driverCoordinate, pickupCoordinate, stage],
  );

  const pickupWaitRemainingSeconds = useMemo(() => {
    if (stage !== 'waiting_at_pickup') return null;
    const arrivedAtMs = parseTimestampMs(rideStatus?.arrivedAt);
    if (!arrivedAtMs) return PICKUP_WAIT_SECONDS;
    const elapsedSeconds = Math.floor((nowTick - arrivedAtMs) / 1000);
    return Math.max(0, PICKUP_WAIT_SECONDS - elapsedSeconds);
  }, [nowTick, rideStatus?.arrivedAt, stage]);
  const pickupWaitCountdownText = pickupWaitRemainingSeconds === null ? '' : formatCountdown(pickupWaitRemainingSeconds);
  const pickupWaitExpired = pickupWaitRemainingSeconds === 0;
  const trackingRegion = useMemo(
    () => buildTrackingRegion(driverCoordinate, pickupCoordinate, dropoffCoordinate, activeTarget, stage)
      || { latitude: -20.1535, longitude: 28.5870, latitudeDelta: 0.05, longitudeDelta: 0.05 },
    [activeTarget, driverCoordinate, dropoffCoordinate, pickupCoordinate, stage]
  );
  const tripTimelineLabels = useMemo(
    () => [
      pickupLabel,
      ...intermediateStops.map((stop) => stop?.label).filter(Boolean),
      dropoffLabel,
    ].filter(Boolean),
    [dropoffLabel, intermediateStops, pickupLabel],
  );
  const currentMapRegionRef = useRef(trackingRegion);
  const lastFitDriverRef = useRef(null);
  const lastUserMapInteractionAtRef = useRef(0);
  const handleUserMapInteraction = () => {
    lastUserMapInteractionAtRef.current = Date.now();
  };

  const handleMapRegionChangeComplete = (nextRegion) => {
    currentMapRegionRef.current = nextRegion;
  };

  const handleAdjustMapZoom = (deltaMultiplier) => {
    const sourceRegion = currentMapRegionRef.current || trackingRegion;
    if (!sourceRegion || !mapRef.current?.animateToRegion) return;

    const nextRegion = {
      ...sourceRegion,
      latitudeDelta: Math.min(Math.max(sourceRegion.latitudeDelta * deltaMultiplier, 0.0025), 2.5),
      longitudeDelta: Math.min(Math.max(sourceRegion.longitudeDelta * deltaMultiplier, 0.0025), 2.5),
    };

    currentMapRegionRef.current = nextRegion;
    mapRef.current.animateToRegion(nextRegion, 250);
  };

  useEffect(() => {
    if (isCompleted) return undefined;

    const focusTarget = stage === 'on_trip' || (stage === 'waiting_at_pickup' && passengerConfirmedPickup)
      ? activeTarget
      : pickupCoordinate;
    const fitCoordinates = getPassengerTrackingFitCoordinates(
      liveRouteCoordinates,
      driverCoordinate,
      focusTarget
    );
    if (!mapRef.current || fitCoordinates.length < 1) return undefined;

    const stageKey = `${stage || ''}|${hasDriverCoordinate ? 'driver' : 'waiting'}|${passengerConfirmedPickup ? 'confirmed' : 'pending'}`;
    const stageChanged = lastAutoFitStageRef.current !== stageKey;
    const previousFitDriver = lastFitDriverRef.current;
    const shouldFit = stageChanged
      || !hasAutoFitMapRef.current
      || (!previousFitDriver && Boolean(driverCoordinate));

    if (!shouldFit) {
      const userRecentlyMovedMap = Date.now() - lastUserMapInteractionAtRef.current < MAP_USER_INTERACTION_GRACE_MS;
      if (
        driverCoordinate
        && !userRecentlyMovedMap
        && !isCoordinateInsideRegion(driverCoordinate, currentMapRegionRef.current)
        && mapRef.current?.animateCamera
      ) {
        lastFitDriverRef.current = driverCoordinate;
        try {
          mapRef.current.animateCamera({ center: driverCoordinate }, { duration: 600 });
        } catch {
          // ignore camera failures
        }
      }
      return undefined;
    }

    lastAutoFitStageRef.current = stageKey;
    hasAutoFitMapRef.current = true;
    if (driverCoordinate) {
      lastFitDriverRef.current = driverCoordinate;
    }

    const timeout = setTimeout(() => {
      try {
        if (fitCoordinates.length >= 2 && mapRef.current?.fitToCoordinates) {
          mapRef.current.fitToCoordinates(fitCoordinates, {
            edgePadding: { top: 110, right: 36, bottom: 240, left: 36 },
            animated: true,
          });
          return;
        }

        const fallbackRegion = buildTrackingRegion(
          driverCoordinate,
          pickupCoordinate,
          dropoffCoordinate,
          focusTarget,
          stage
        );
        if (fallbackRegion && mapRef.current?.animateToRegion) {
          currentMapRegionRef.current = fallbackRegion;
          mapRef.current.animateToRegion(fallbackRegion, 350);
        }
      } catch {
        // Keep tracking UI resilient if the map rejects a fit request.
      }
    }, 200);

    return () => clearTimeout(timeout);
  }, [
    activeTarget,
    driverCoordinate,
    dropoffCoordinate,
    hasDriverCoordinate,
    isCompleted,
    liveRouteCoordinates,
    passengerConfirmedPickup,
    pickupCoordinate,
    stage,
  ]);

  const handleCancelRide = () => {
    setShowCancelReasonModal(true);
  };

  const handleConfirmCancelWithReason = async (reasonLabel) => {
    setShowCancelReasonModal(false);
    try {
      const token = await getToken();
      if (token && rideRequestId) {
        await cancelRideRequest(token, rideRequestId, reasonLabel);
      }
    } catch (error) {
      // allow UI to exit even if cancel sync fails
    }
    Alert.alert('Ride cancelled', 'Your ride request has been cancelled.');
    exitToPassengerHome();
  };

  const handleDone = async () => {
    exitToPassengerHome();
  };

  const handleSkipRating = () => {
    ratingDraftTouchedRef.current = false;
    setShowDriverRatingModal(false);
    exitToPassengerHome();
  };

  const handleCallDriver = () => {
    const phone = String(driver?.phoneNumber || '').trim();
    if (!phone) {
      Alert.alert('Call driver', 'No driver phone number is available for this ride.');
      return;
    }
    const url = phone.startsWith('tel:') ? phone : `tel:${phone}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Call driver', 'Could not open the phone app.');
    });
  };

  const handleConfirmPickup = async () => {
    if (confirmingPickup || rideStatus?.passengerConfirmedAt || stage !== 'waiting_at_pickup') return;
    const optimisticConfirmedAt = new Date().toISOString();
    const previousConfirmedAt = rideStatus?.passengerConfirmedAt || null;
    setConfirmingPickup(true);
    setRideStatus((current) => current ? {
      ...current,
      passengerConfirmedAt: optimisticConfirmedAt,
    } : current);
    try {
      const token = (await getToken({ skipCache: true })) || (await getToken());
      if (!token || !rideRequestId) throw new Error('Not signed in');
      const result = await confirmPassengerPickup(token, rideRequestId, { suppressAuthErrorHandler: true });
      const confirmedAt = String(result?.confirmedAt || optimisticConfirmedAt).trim();
      if (!confirmedAt) throw new Error('Could not confirm pickup.');
      setRideStatus((current) => current ? {
        ...current,
        passengerConfirmedAt: confirmedAt,
        ...(result?.safetyPinRequired !== undefined ? { safetyPinRequired: Boolean(result.safetyPinRequired) } : {}),
        ...(result?.safetyPinVerified !== undefined ? { safetyPinVerified: Boolean(result.safetyPinVerified) } : {}),
        ...(result?.safetyPinVerifiedAt !== undefined ? { safetyPinVerifiedAt: result.safetyPinVerifiedAt } : {}),
        ...(result?.safetyPin !== undefined ? { safetyPin: result.safetyPin } : {}),
        ...(result?.safetyPinAttempts !== undefined ? { safetyPinAttempts: Number(result.safetyPinAttempts || 0) } : {}),
        ...(result?.safetyPinMaxAttempts !== undefined ? { safetyPinMaxAttempts: Number(result.safetyPinMaxAttempts || 0) } : {}),
        ...(result?.safetyPinLocked !== undefined ? { safetyPinLocked: Boolean(result.safetyPinLocked) } : {}),
      } : current);
    } catch (error) {
      setRideStatus((current) => current ? {
        ...current,
        passengerConfirmedAt: previousConfirmedAt,
      } : current);
      Alert.alert('Confirmation failed', error?.message || 'Could not confirm pickup.');
    } finally {
      setConfirmingPickup(false);
    }
  };

  const handleSubmitRating = async () => {
    try {
      if (rating < 1) {
        Alert.alert('Choose a rating', 'Select between 1 and 5 stars.');
        return;
      }
      setSubmittingRating(true);
      const token = await getToken();
      if (!token || !rideRequestId) throw new Error('Not signed in');
      const reviewText = buildRatingReviewText(selectedRatingTags, review);
      await submitPassengerDriverRating(token, rideRequestId, {
        rating,
        review: reviewText,
        feedbackTags: selectedRatingTags,
      });
      ratingDraftTouchedRef.current = false;
      setRideStatus((current) => current ? {
        ...current,
        passengerDriverRating: rating,
        passengerDriverReview: reviewText,
      } : current);
      if (canPromptForTip) return;
      setShowDriverRatingModal(false);
      Alert.alert('Thanks', 'Your driver rating was saved.', [{ text: 'OK', onPress: exitToPassengerHome }]);
    } catch (error) {
      Alert.alert('Rating failed', error?.message || 'Could not save your rating.');
    } finally {
      setSubmittingRating(false);
    }
  };

  const handleDownloadTripReceipt = async () => {
    if (downloadingTripReceipt || !rideRequestId) return;
    try {
      setDownloadingTripReceipt(true);
      const token = await getToken();
      const result = await downloadReceiptPdf(token, rideRequestId);
      Alert.alert('Receipt downloaded', `${result.fileName} was saved.`);
    } catch (error) {
      Alert.alert('Receipt download failed', error?.message || 'Could not download your ride receipt.');
    } finally {
      setDownloadingTripReceipt(false);
    }
  };

  const handleSendTip = async () => {
    const amount = Number(String(tipDraft || '').trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('Tip amount', 'Enter how much you want to tip (for example 0.50).');
      return;
    }
    if (amount > 200) {
      Alert.alert('Tip amount', 'Tip amount must be $200.00 or less.');
      return;
    }
    const normalizedAmount = Number(amount.toFixed(2));
    try {
      setSubmittingTip(true);
      const token = await getToken();
      if (!token || !rideRequestId) throw new Error('Not signed in');
      await tipDriver(token, rideRequestId, normalizedAmount);
      setRideStatus((current) => current ? {
        ...current,
        tipAmount: normalizedAmount,
        totalAmount: Number(current.estimatedAmount || 0) + normalizedAmount,
        canTipDriver: false,
      } : current);
      setTipDraft('');
      Alert.alert('Tip sent', `Your $${normalizedAmount.toFixed(2)} tip was added.`);
    } catch (error) {
      Alert.alert('Tip failed', error?.message || 'Could not send your tip.');
    } finally {
      setSubmittingTip(false);
    }
  };

  const handlePayCash = async () => {
    try {
      setStartingPayment(true);
      const token = await getToken();
      if (!token || !rideRequestId) throw new Error('Not signed in');
      await choosePassengerRideCashPayment(token, rideRequestId);
      setRideStatus((current) => current ? {
        ...current,
        paymentStatus: 'unpaid',
        paymentMethod: 'cash',
        paymentProvider: null,
        canPayCash: false,
        canPayWithSmilePay: false,
        canChoosePaymentMethod: false,
      } : current);
      Alert.alert('Cash selected', 'Pay the driver in cash at the end of the trip.');
    } catch (error) {
      Alert.alert('Could not select cash', error?.message || 'Try again.');
    } finally {
      setStartingPayment(false);
    }
  };

  const handlePayWithSmilePay = async () => {
    try {
      setStartingPayment(true);
      const token = await getToken();
      if (!token || !rideRequestId) throw new Error('Not signed in');

      const callbackUrl = ExpoLinking.createURL('passenger-ride-payment');
      console.log('[smilepay] client.initiate.start', { rideRequestId, callbackUrl });
      const result = await initiatePassengerRideSmilePay(token, rideRequestId, {
        callbackUrl,
        checkoutMode: 'hosted',
      });
      const payment = result?.payment || {};
      console.log('[smilepay] client.initiate.result', {
        rideRequestId,
        reference: payment.reference || null,
        amount: payment.amount || null,
        authorizationUrl: payment.authorizationUrl || null,
        checkoutMode: payment.checkoutMode || null,
        nextAction: payment.nextAction || null,
        status: payment.status || null,
      });
      if (!payment.authorizationUrl && String(payment.nextAction || '').toLowerCase() !== 'poll') {
        throw new Error('Could not start Smile&Pay checkout.');
      }

      const authResult = payment.authorizationUrl
        ? await WebBrowser.openAuthSessionAsync(payment.authorizationUrl, callbackUrl)
        : { type: 'poll' };
      console.log('[smilepay] client.browser.result', {
        type: authResult?.type || null,
        url: authResult?.url || null,
        message: authResult?.message || null,
      });
      const references = [payment.reference].filter(Boolean);
      if (authResult?.type === 'success' && authResult?.url) {
        const parsed = ExpoLinking.parse(authResult.url);
        console.log('[smilepay] client.browser.query', parsed?.queryParams || {});
        const returnedReference =
          parsed?.queryParams?.reference
          || parsed?.queryParams?.orderReference
          || parsed?.queryParams?.transactionReference;
        if (returnedReference && !references.includes(String(returnedReference))) {
          references.push(String(returnedReference));
        }
      }

      console.log('[smilepay] client.verify.references', references);
      if (!payment.authorizationUrl) {
        Alert.alert(
          'Payment started',
          'Smile&Pay has started the express payment. Approve it on your phone, then wait a moment while we confirm it.'
        );
        await new Promise((resolve) => setTimeout(resolve, 3500));
      }
      let verifiedPayment = null;
      for (const reference of references) {
        const verifyResult = await verifyPassengerRideSmilePay(token, rideRequestId, reference);
        console.log('[smilepay] client.verify.result', {
          reference,
          status: verifyResult?.payment?.status || null,
          alreadyVerified: verifyResult?.alreadyVerified || false,
          payment: verifyResult?.payment || null,
        });
        verifiedPayment = verifyResult?.payment || verifiedPayment;
      }
      const verifiedStatus = String(verifiedPayment?.status || '').toLowerCase();
      if (verifiedStatus !== 'success') {
        setRideStatus((current) => current ? {
          ...current,
          paymentStatus: verifiedStatus || 'pending',
          paymentProvider: 'smilepay',
          paymentReference: references[0] || current.paymentReference,
        } : current);
        Alert.alert('Payment pending', 'We could not confirm a successful Smile&Pay payment yet. Please try checking again in a moment.');
        return;
      }

      setRideStatus((current) => current ? {
        ...current,
        paymentStatus: 'paid',
        paymentProvider: 'smilepay',
        paymentMethod: 'online',
        paymentReference: references[0] || current.paymentReference,
        canPayWithSmilePay: false,
        canPayCash: false,
        canChoosePaymentMethod: false,
      } : current);
      Alert.alert('Payment complete', 'Online payment received. The service fee was withheld and the remaining amount was credited to the driver Trust Express wallet.');
    } catch (error) {
      console.error('[smilepay] client.payment.error', {
        rideRequestId,
        message: error?.message || String(error),
        status: error?.status || null,
      });
      Alert.alert('Payment failed', error?.message || 'Could not complete Smile&Pay payment.');
    } finally {
      setStartingPayment(false);
    }
  };

  const handleReportLostItem = async () => {
    const itemDescription = String(lostItemDescription || '').trim();
    const contactPhone = String(lostItemContactPhone || '').trim();
    if (!itemDescription) {
      Alert.alert('Missing details', 'Please describe the lost item.');
      return;
    }

    try {
      setSubmittingLostItem(true);
      const token = await getToken();
      if (!token || !rideRequestId) throw new Error('Not signed in');
      await reportLostItem(token, rideRequestId, {
        itemDescription,
        contactPhone: contactPhone || undefined,
      });
      setLostItemDescription('');
      setLostItemContactPhone('');
      Alert.alert('Reported', 'Your lost item report has been sent to support.');
    } catch (error) {
      Alert.alert('Report failed', error?.message || 'Could not submit your lost item report.');
    } finally {
      setSubmittingLostItem(false);
    }
  };

  const handleSendPanicAlert = () => {
    Alert.alert(
      'Are you in danger?',
      'Tap Yes if you are in danger so admin can start emergency escalation and contact police or other responders.',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes',
          style: 'destructive',
          onPress: async () => {
            try {
              setSubmittingPanicAlert(true);
              const token = await getToken();
              if (!token || !rideRequestId) throw new Error('Not signed in');

              let currentCoordinate = null;
              try {
                const permission = await Location.getForegroundPermissionsAsync();
                if (permission?.granted) {
                  const position = await Location.getCurrentPositionAsync({
                    accuracy: Location.Accuracy.Balanced,
                  });
                  if (position?.coords) {
                    currentCoordinate = {
                      latitude: Number(position.coords.latitude),
                      longitude: Number(position.coords.longitude),
                    };
                  }
                }
              } catch {
                // If device location is unavailable, still send the ride-linked alert.
              }

              await sendRidePanicAlert(token, rideRequestId, {
                alertStage: stage,
                message: 'Passenger confirmed they are in danger and requested emergency escalation.',
                latitude: currentCoordinate?.latitude,
                longitude: currentCoordinate?.longitude,
              });
              await showLocalRideNotification({
                title: 'Panic alert sent',
                body: `Ride ${rideRequestId} was sent to admin for urgent attention.`,
                data: { type: 'panic_alert', rideRequestId },
              });
              Alert.alert('Alert sent', 'Admin has been notified about this ride.');
            } catch (error) {
              Alert.alert('Alert failed', error?.message || 'Could not send the panic alert.');
            } finally {
              setSubmittingPanicAlert(false);
            }
          },
        },
      ],
    );
  };

  if (loading && !rideStatus) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-5">
        <ActivityIndicator size="large" color={PRIMARY_BLUE} />
        <Text className="mt-4 text-base text-gray-500">Loading ride status...</Text>
        {loadError ? (
          <Text className="mt-3 text-center text-sm text-rose-600">{loadError}</Text>
        ) : null}
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'left', 'right']}>
      <View className="flex-1">
        <MapView
          ref={mapRef}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          initialRegion={trackingRegion}
          maxBounds={BULAWAYO_GEO_LOCK_ENABLED ? BULAWAYO_SERVICE_BOUNDS_ARRAY : undefined}
          showsCompass={false}
          toolbarEnabled={false}
          onRegionChangeComplete={handleMapRegionChangeComplete}
          onPanDrag={handleUserMapInteraction}
          scrollEnabled
          zoomEnabled
          rotateEnabled={false}
          pitchEnabled={false}
        >
          {driverCoordinate ? (
            <DriverVehicleMapMarker
              coordinate={driverCoordinate}
              headingDegrees={vehicleHeadingDegrees}
              etaLabel={driverLocationFresh && stage !== 'on_trip' && stage !== 'waiting_at_pickup' ? liveEtaText : null}
            />
          ) : null}
          {pickupCoordinate ? (
            <LetterMarker coordinate={pickupCoordinate} title="Pickup" letter="A" color={PIN_COLORS.start} />
          ) : null}
          {intermediateStops.map((stop, index) => {
            const stopCoordinate = normalizeCoordinate(stop?.coordinate);
            return stopCoordinate ? (
              <LetterMarker
                key={`passenger-stop-${index}`}
                coordinate={stopCoordinate}
                title={stop.label || `Stop ${index + 1}`}
                letter={stopLetter(index)}
                color={index < currentStopIndex ? '#94a3b8' : PIN_COLORS.stop}
              />
            ) : null;
          })}
          {dropoffCoordinate ? (
            <LetterMarker coordinate={dropoffCoordinate} title="Drop-off" letter="B" color={PIN_COLORS.finish} />
          ) : null}
          {displayTripLine.length > 1 ? (
            <Polyline
              coordinates={displayTripLine}
              strokeColor="#94a3b8"
              strokeWidth={4}
            />
          ) : null}
          {displayLiveRoute.length > 1 ? (
            <Polyline
              coordinates={displayLiveRoute}
              strokeColor={PRIMARY_BLUE}
              strokeWidth={5}
            />
          ) : null}
        </MapView>

        <View pointerEvents="none" className="absolute inset-0" />

        <View
          pointerEvents="box-none"
          className="absolute right-5"
          style={{
            bottom: (stage === 'on_trip'
              ? onTripPanelHeight
              : rideSheetCollapsed ? collapsedSheetHeight : Math.min(expandedSheetMaxHeight, 360)) + 16,
          }}
        >
          <TouchableOpacity
            onPress={handleSendPanicAlert}
            disabled={submittingPanicAlert}
            activeOpacity={0.85}
            className="h-14 w-14 items-center justify-center rounded-[20px] bg-[#dc2626]"
            style={{ opacity: submittingPanicAlert ? 0.7 : 1 }}
          >
            {submittingPanicAlert ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="warning" size={24} color="#fff" />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleAdjustMapZoom(0.6)}
            activeOpacity={0.85}
            className="mt-3 h-14 w-14 items-center justify-center rounded-[20px] bg-white"
          >
            <Ionicons name="add" size={26} color="#111827" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleAdjustMapZoom(1.6)}
            activeOpacity={0.85}
            className="mt-3 h-14 w-14 items-center justify-center rounded-[20px] bg-white"
          >
            <Ionicons name="remove" size={26} color="#111827" />
          </TouchableOpacity>
        </View>

        <View pointerEvents="box-none">
          <View className="rounded-b-[24px] bg-white px-4 pb-3 pt-1">
            <View className="flex-row items-center">
              <TouchableOpacity onPress={() => navigation.goBack()} className="mr-3 h-12 w-12 items-center justify-center rounded-full bg-[#f3f6fb]">
                <Ionicons name="arrow-back" size={24} color="#111827" />
              </TouchableOpacity>
              <View className="flex-1">
                <Text className="text-lg font-bold text-gray-900">
                  {isCompleted
                    ? 'Trip completed'
                    : driverHasArrived
                      ? 'Your driver has arrived'
                      : stage === 'on_trip'
                        ? 'On trip'
                        : 'Driver is on the way'}
                </Text>
                {!driverHasArrived ? (
                  <Text className="mt-1 text-sm text-gray-500">
                    {isCompleted
                      ? 'You can rate your driver now or skip and do it later.'
                      : stage === 'on_trip'
                        ? (hasDriverCoordinate && driverLocationFresh
                          ? `Arriving in ${liveEtaMinutes} min · ${liveDistanceText} to go`
                          : liveDistanceText)
                        : hasDriverCoordinate
                          ? `${liveEtaText} away · ${liveDistanceText}`
                          : 'Finding your driver on the map'}
                  </Text>
                ) : null}
              </View>
            </View>

          </View>
        </View>

        {stage === 'on_trip' ? (
          <View
            className="absolute bottom-0 left-0 right-0 rounded-t-[16px] bg-white px-5 pt-5"
            style={{ paddingBottom: Math.max(insets.bottom, 12) + 8 }}
            onLayout={(event) => setOnTripPanelHeight(Math.round(event.nativeEvent.layout.height))}
          >
            <View className="items-center">
              <Text className="text-xs text-gray-500">Estimated arrival time</Text>
              <Text className="mt-0.5 text-lg font-bold text-gray-900">
                {hasDriverCoordinate && driverLocationFresh ? formatClockTime(Date.now() + liveEtaMinutes * 60000) : '--:--'}
              </Text>
            </View>

            <View className="mt-4 flex-row items-center border-t border-gray-100 pt-4">
              <View
                className="items-center justify-center overflow-hidden rounded-full bg-[#eef4ff]"
                style={{ width: 48, height: 48 }}
              >
                {driverProfileImageUrl ? (
                  <Image source={{ uri: driverProfileImageUrl }} style={{ width: 48, height: 48 }} />
                ) : (
                  <Ionicons name="person" size={20} color={PRIMARY_BLUE} />
                )}
              </View>
              <View className="ml-3 min-w-0 flex-1">
                <Text className="text-sm font-bold text-gray-900" numberOfLines={1}>
                  {driver?.driverName || 'Driver'}
                </Text>
                <View className="mt-0.5 flex-row items-center">
                  {driverRatingValue ? (
                    <>
                      <Ionicons name="star" size={12} color="#f59e0b" />
                      <Text className="ml-1 text-xs text-gray-500">{driverRatingValue.toFixed(1)}</Text>
                    </>
                  ) : null}
                  {driverCarName || driverPlate ? (
                    <Text className="text-xs text-gray-500" numberOfLines={1}>
                      {driverRatingValue ? ' · ' : ''}{[driverCarName, driverPlate].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                </View>
              </View>
              <TouchableOpacity
                onPress={() => navigation.navigate('RideChat', {
                  rideRequestId,
                  role: 'passenger',
                  chatTitle: driver?.driverName || 'Driver chat',
                })}
                className="h-11 w-11 items-center justify-center rounded-[10px] bg-[#eef4ff]"
              >
                <Ionicons name="chatbubble-ellipses" size={19} color={PRIMARY_BLUE} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCallDriver}
                className="ml-2 h-11 w-11 items-center justify-center rounded-[10px]"
                style={{ backgroundColor: PRIMARY_BLUE }}
              >
                <Ionicons name="call" size={19} color="#fff" />
              </TouchableOpacity>
            </View>

            <View className="mt-4 border-t border-gray-100 pt-4">
              {tripTimelineLabels.map((label, index) => {
                const isPickup = index === 0;
                const isDropoff = index === tripTimelineLabels.length - 1;
                const isPassedStop = !isPickup && !isDropoff && index - 1 < currentStopIndex;
                return (
                  <View key={`on-trip-${label}-${index}`} className={`flex-row items-start ${index ? 'mt-3' : ''}`}>
                    <View
                      className="mr-3 h-6 w-6 items-center justify-center rounded-full"
                      style={{
                        backgroundColor: isPickup
                          ? PIN_COLORS.start
                          : isDropoff
                            ? PIN_COLORS.finish
                            : isPassedStop ? '#94a3b8' : PIN_COLORS.stop,
                      }}
                    >
                      <Text className="text-[11px] font-extrabold text-white">
                        {isPickup ? 'A' : isDropoff ? 'B' : stopLetter(index - 1)}
                      </Text>
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-[11px] text-gray-400">
                        {isPickup ? 'Pick up' : isDropoff ? 'Drop-off' : `Stop ${index}`}
                      </Text>
                      <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>{label}</Text>
                    </View>
                  </View>
                );
              })}
            </View>

            <TouchableOpacity
              onPress={handleCancelRide}
              className="mt-4 h-12 flex-row items-center justify-center rounded-[10px] bg-red-50"
            >
              <Ionicons name="close-circle-outline" size={18} color="#dc2626" />
              <Text className="ml-2 text-base font-bold text-red-600">Cancel ride</Text>
            </TouchableOpacity>
          </View>
        ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={insets.top + 80}
          pointerEvents="box-none"
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <View
            className="mt-auto overflow-hidden rounded-t-[30px] bg-[#f8fafc]"
            style={
              rideSheetCollapsed
                ? { height: driverHasArrived ? collapsedSheetHeight - 20 : collapsedSheetHeight }
                : { maxHeight: expandedSheetMaxHeight }
            }
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
              bounces={false}
              contentContainerStyle={{
                paddingHorizontal: 20,
                paddingTop: 10,
                paddingBottom: isCompleted ? bottomActionInset + 12 : 12,
                flexGrow: 0,
              }}
            >
              <TouchableOpacity
                onPress={() => setRideSheetCollapsed((current) => !current)}
                activeOpacity={0.8}
                className="items-center"
                {...sheetPan.panHandlers}
              >
                <View className="h-1.5 w-12 rounded-full bg-gray-300" />
                <View className="mt-1.5 flex-row items-center">
                  <Text className="text-sm font-semibold text-gray-500">
                    {rideSheetCollapsed ? 'Show trip details' : 'Hide trip details'}
                  </Text>
                  <Ionicons
                    name={rideSheetCollapsed ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color="#6b7280"
                    style={{ marginLeft: 6 }}
                  />
                </View>
              </TouchableOpacity>

              {showSafetyPinBanner && !driverHasArrived ? (
                <View className="mt-4 rounded-[22px] border border-[#dbeafe] bg-[#eef4ff] px-4 py-4">
                  <View className="flex-row items-center">
                    <Ionicons name="shield-checkmark" size={18} color={PRIMARY_BLUE} />
                    <Text className="ml-2 text-xs font-bold uppercase" style={{ color: PRIMARY_BLUE }}>
                      Night safety PIN
                    </Text>
                  </View>
                  <Text className="mt-3 text-4xl font-extrabold text-gray-900" style={{ letterSpacing: 6 }}>
                    {safetyPinValue}
                  </Text>
                  <Text className="mt-3 text-sm leading-6 text-gray-600">
                    Share this PIN with your driver only when you are at the car. Do not share it in chat.
                  </Text>
                  {safetyPinLocked ? (
                    <Text className="mt-2 text-sm font-semibold text-red-600">
                      Too many wrong attempts were made. Confirm your driver before starting the trip.
                    </Text>
                  ) : Number(rideStatus?.safetyPinAttempts || 0) > 0 ? (
                    <Text className="mt-2 text-sm font-semibold text-amber-700">
                      Someone entered the wrong PIN. Only share it with your assigned driver.
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {stage !== 'on_trip' && !driverHasArrived && rideSheetCollapsed ? (
                <View className="mt-4 rounded-[22px] bg-white px-4 py-3">
                  <Text className="text-xs font-semibold uppercase text-gray-400">
                    {stage === 'waiting_at_pickup' ? 'Pickup status' : 'Driver status'}
                  </Text>
                  <Text className="mt-1 text-base font-bold text-gray-900">
                    {stage === 'waiting_at_pickup'
                      ? pickupWaitExpired
                        ? 'Pickup wait time ended'
                        : `${pickupWaitCountdownText} at pickup`
                      : hasDriverCoordinate
                        ? `${liveEtaText} away · ${liveDistanceText}`
                        : 'Finding your driver'}
                  </Text>
                </View>
              ) : null}

              {stage === 'on_trip' ? (
                <View className="mt-4 rounded-[22px] bg-white px-4 py-4">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1 pr-3">
                      <Text className="text-sm font-medium text-gray-500">
                        {hasRoadDistance ? 'Distance to destination' : 'Estimated distance'}
                      </Text>
                      <Text className="mt-1 text-2xl font-bold text-gray-900">{liveDistanceText}</Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-sm font-medium text-gray-500">Fare</Text>
                      <Text className="mt-1 text-2xl font-bold text-gray-900">${totalAmount.toFixed(2)}</Text>
                    </View>
                  </View>
                </View>
              ) : null}

              {!rideSheetCollapsed ? (
                <>
                  {stage !== 'on_trip' && !driverHasArrived ? (
                    <View className="mt-4 rounded-[22px] bg-white px-4 py-4">
                      <View className="flex-row items-center justify-between">
                        <Text className="text-xs font-semibold uppercase text-gray-400">
                          Trip status
                        </Text>
                        {routeLoading || statusSyncWarning ? <ActivityIndicator size="small" color={PRIMARY_BLUE} /> : null}
                      </View>
                      <Text className="mt-2 text-base font-bold text-gray-900">
                        {stage === 'completed'
                          ? 'Trip completed'
                          : stage === 'waiting_at_pickup'
                          ? 'Driver is at your pickup point.'
                          : 'Driver is heading to your pickup.'}
                      </Text>
                      {stage !== 'waiting_at_pickup' ? (
                        <Text className="mt-1 text-sm text-gray-500">
                          {hasDriverCoordinate
                            ? `${liveEtaText} · ${liveDistanceText}`
                            : 'Live location will appear as soon as your driver is on the move.'}
                        </Text>
                      ) : null}
                      {statusSyncWarning ? (
                        <Text className="mt-2 text-sm text-amber-600">{statusSyncWarning}</Text>
                      ) : null}
                      {hasDriverCoordinate && !driverLocationFresh && stage !== 'waiting_at_pickup' ? (
                        <Text className="mt-2 text-sm text-amber-600">
                          Driver location is updating. ETA will refresh when their phone sends a fresh location.
                        </Text>
                      ) : null}
                      {routeError ? (
                        <Text className="mt-2 text-sm text-amber-600">{routeError}</Text>
                      ) : null}
                    </View>
                  ) : null}

                  <View className="mt-5 rounded-[24px] bg-white p-5">
                    {!driverHasArrived ? (
                    <View className="mb-2 flex-row items-center pb-3">
                      <View className="mr-4 min-w-0 flex-1">
                        <Text className="text-xl font-bold text-gray-900">{driver?.driverName || 'Driver'}</Text>
                        <View className="mt-1 flex-row items-center">
                          <Ionicons name="star" size={16} color="#f59e0b" />
                          <Text className="ml-2 text-sm text-gray-500">
                            {formatDriverRatingLabel(driver)}
                          </Text>
                        </View>
                        <Text className="mt-2 text-sm text-gray-500">
                          {vehicleSummary || 'Vehicle details incoming'}
                        </Text>
                        <Text className="mt-1 text-sm font-medium" style={{ color: PRIMARY_BLUE }}>
                          {driver?.phoneNumber || 'Phone not shared'}
                        </Text>
                      </View>
                      <View className="relative">
                        <View
                          className="items-center justify-center overflow-hidden rounded-[20px] bg-[#f1f5f9]"
                          style={{ width: 156, height: 112 }}
                        >
                          <Image
                            source={{ uri: normalizeVehicleImageUrl(driver?.carImage) || 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=800&q=80' }}
                            style={{ width: 148, height: 104 }}
                            resizeMode="contain"
                          />
                        </View>
                        <View
                          className="absolute items-center justify-center overflow-hidden rounded-full border-2 border-white bg-[#eef4ff]"
                          style={{ width: 52, height: 52, borderRadius: 26, right: -6, bottom: -10 }}
                        >
                          {driverProfileImageUrl ? (
                            <Image
                              source={{ uri: driverProfileImageUrl }}
                              style={{ width: 52, height: 52, borderRadius: 26 }}
                            />
                          ) : (
                            <Ionicons name="person" size={22} color={PRIMARY_BLUE} />
                          )}
                        </View>
                      </View>
                    </View>
                    ) : null}

                    {!driverHasArrived ? (
                    <View className="mt-4 rounded-[18px] bg-[#f8fafc] px-4 py-4">
                      {stage === 'on_trip' ? (
                        <View className="items-center">
                          <Text className="text-sm font-medium text-gray-500">
                            {currentIntermediateStop
                              ? (hasRoadDistance ? 'Distance to next stop' : 'Estimated distance to next stop')
                              : (hasRoadDistance ? 'Distance to destination' : 'Estimated distance to destination')}
                          </Text>
                          <Text className="mt-1 text-3xl font-bold text-gray-900">{liveDistanceText}</Text>
                          <Text className="mt-2 text-sm text-gray-500">
                            {tripDistanceKm > 0
                              ? `Trip route ${tripDistanceKm.toFixed(1)} km${tripEtaMinutes > 0 ? ` • ${tripEtaMinutes} min` : ''}`
                              : 'Trip route details updating...'}
                          </Text>
                        </View>
                      ) : hasDriverCoordinate ? (
                        <View className="flex-row items-start">
                          <View className="min-w-0 flex-1 pr-3">
                            <Text className="text-sm font-medium text-gray-500">
                              {stage === 'waiting_at_pickup' ? 'Live arrival' : 'Driver arrival'}
                            </Text>
                            <Text className="mt-1 text-2xl font-bold text-gray-900">
                              {stage === 'waiting_at_pickup' ? 'Arrived' : liveEtaText}
                            </Text>
                          </View>
                          <View className="min-w-0 flex-1 items-end">
                            <Text className="text-sm font-medium text-gray-500">
                              {hasRoadDistance ? 'Road distance' : 'Distance'}
                            </Text>
                            <Text className="mt-1 text-2xl font-bold text-gray-900">{liveDistanceText}</Text>
                          </View>
                        </View>
                      ) : (
                        <View>
                          <Text className="text-sm font-medium text-gray-500">Driver location</Text>
                          <Text className="mt-1 text-xl font-bold text-gray-900">Finding your driver</Text>
                          <Text className="mt-1 text-sm text-gray-500">
                            Directions will appear when their live location arrives.
                          </Text>
                        </View>
                      )}
                    </View>
                    ) : null}

                    {stage === 'on_trip' && (intermediateStops.length > 0 || tipAmount > 0) ? (
                      <View className="mt-4">
                        {intermediateStops.length ? (
                          <Text className="text-sm text-gray-500">
                            {remainingIntermediateStopsCount > 0
                              ? `${remainingIntermediateStopsCount} stop${remainingIntermediateStopsCount === 1 ? '' : 's'} left before final drop-off`
                              : 'Final destination leg'}
                          </Text>
                        ) : null}
                        {tipAmount > 0 ? (
                          <Text className={`${intermediateStops.length ? 'mt-2 ' : ''}text-sm font-medium text-green-600`}>
                            Includes ${tipAmount.toFixed(2)} tip
                          </Text>
                        ) : null}
                      </View>
                    ) : null}

                    {!rideSheetCollapsed && stage !== 'on_trip' ? (
                      <View className={`flex-row items-center justify-between ${driverHasArrived ? '' : 'mt-4'}`}>
                        <Text className="text-sm font-medium text-gray-500">Fare</Text>
                        <View className="items-end">
                          <Text className="text-2xl font-bold text-gray-900">${totalAmount.toFixed(2)}</Text>
                          {tipAmount > 0 ? (
                            <Text className="text-xs font-medium text-green-600">
                              Includes ${tipAmount.toFixed(2)} tip
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    ) : null}

                    {stage !== 'on_trip' && tripTimelineLabels.length <= 2 ? (
                      <View className="mt-4">
                        <Text className="text-xs font-bold uppercase" style={{ color: PIN_COLORS.finish }}>Pick up</Text>
                        <View className="mt-1.5 flex-row items-start">
                          <View className="mr-3 mt-1.5 h-2.5 w-2.5 rounded-full bg-gray-900" />
                          <Text className="flex-1 text-sm font-semibold text-gray-900">{pickupLabel}</Text>
                        </View>
                        <Text className="mt-4 text-xs font-bold uppercase text-gray-400">Drop-off</Text>
                        <View className="mt-1.5 flex-row items-start">
                          <View className="mr-3 mt-1.5 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PIN_COLORS.finish }} />
                          <Text className="flex-1 text-sm font-semibold text-gray-900">{dropoffLabel}</Text>
                        </View>
                      </View>
                    ) : null}

                    {tripTimelineLabels.length > 2 ? (
                      <View className="mt-4">
                        <Text className="text-xs font-bold uppercase text-gray-400">Trip</Text>
                        <View className="mt-3">
                          {tripTimelineLabels.map((label, index) => {
                            const isPickup = index === 0;
                            const isDropoff = index === tripTimelineLabels.length - 1;
                            const stopSequenceIndex = Math.max(0, index - 1);
                            const isCompletedStop = !isPickup && !isDropoff && stopSequenceIndex < currentStopIndex;
                            const isCurrentStop = stage === 'on_trip' && !isPickup && !isDropoff && stopSequenceIndex === currentStopIndex;
                            return (
                              <View key={`${label}-${index}`} className="mb-3 flex-row items-start">
                                <View
                                  className="mr-3 mt-1 h-3 w-3 rounded-full"
                                  style={{
                                    backgroundColor: isPickup
                                      ? '#2563eb'
                                      : isDropoff
                                        ? '#111827'
                                        : isCompletedStop
                                          ? '#94a3b8'
                                          : isCurrentStop
                                            ? '#f97316'
                                            : '#cbd5e1',
                                  }}
                                />
                                <View className="flex-1">
                                  <Text className="text-sm font-semibold text-gray-900">
                                    {isPickup ? 'Pickup' : isDropoff ? 'Final destination' : `Stop ${stopSequenceIndex + 1}`}
                                  </Text>
                                  <Text className="mt-1 text-sm text-gray-600">{label}</Text>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    ) : null}
                  </View>

                  {showPaymentCard ? (
                    <View className="mt-5 rounded-[24px] bg-white px-5 py-5">
                      <View className="flex-row items-center justify-between">
                        <View className="flex-1 pr-3">
                          <Text className="text-xl font-bold text-gray-900">
                            {paymentStatus === 'paid' ? 'Paid' : paymentStatus === 'refunded' ? 'Refunded' : paymentStatus === 'refund_pending' ? 'Refund in progress' : paymentStatus === 'pending' ? 'Payment pending' : 'Fare'}
                          </Text>
                        </View>
                        <View className={`rounded-full px-3 py-1 ${
                          paymentStatus === 'paid'
                            ? 'bg-emerald-50'
                            : isRefundedPayment
                              ? 'bg-slate-100'
                            : paymentMethod === 'cash'
                              ? 'bg-blue-50'
                              : 'bg-amber-50'
                        }`}
                        >
                          <Text className={`text-xs font-bold uppercase ${
                            paymentStatus === 'paid'
                              ? 'text-emerald-700'
                              : isRefundedPayment
                                ? 'text-slate-700'
                              : paymentMethod === 'cash'
                                ? 'text-blue-700'
                                : 'text-amber-700'
                          }`}
                          >
                            {paymentStatus === 'paid' ? 'Paid online' : paymentStatus === 'refunded' ? 'Refunded' : paymentStatus === 'refund_pending' ? 'Refunding' : paymentMethod === 'cash' ? 'Cash' : paymentStatus === 'pending' ? 'Pending' : 'Unpaid'}
                          </Text>
                        </View>
                      </View>
                      <Text className="mt-4 text-3xl font-bold text-gray-900">${totalAmount.toFixed(2)}</Text>
                      {(canPayCash || canPayWithSmilePay) ? (
                        <View className="mt-5 flex-row gap-3">
                          {canPayCash ? (
                            <TouchableOpacity
                              onPress={handlePayCash}
                              disabled={startingPayment}
                              className="h-12 flex-1 items-center justify-center rounded-[18px] bg-slate-100"
                              style={{ opacity: startingPayment ? 0.7 : 1 }}
                            >
                              <Text className="text-sm font-bold uppercase text-gray-800">Pay cash</Text>
                            </TouchableOpacity>
                          ) : null}
                          {canPayWithSmilePay ? (
                            <TouchableOpacity
                              onPress={handlePayWithSmilePay}
                              disabled={startingPayment}
                              className="h-12 flex-1 items-center justify-center rounded-[18px]"
                              style={{ backgroundColor: PRIMARY_BLUE, opacity: startingPayment ? 0.7 : 1 }}
                            >
                              {startingPayment ? (
                                <ActivityIndicator color="#fff" />
                              ) : (
                                <Text className="text-sm font-bold uppercase text-white">Pay by card</Text>
                              )}
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  {isCompleted ? (
                    <>
                      {((rideStatus?.canTipDriver && paymentStatus !== 'paid') || tipAmount > 0) ? (
                        <View className="mt-5 rounded-[24px] bg-white px-5 py-5">
                          <Text className="text-xl font-bold text-gray-900">Tip driver</Text>
                          <Text className="mt-2 text-sm text-gray-500">
                            Add an optional thank-you tip for {driver?.driverName || 'your driver'}.
                          </Text>
                          {tipAmount > 0 ? (
                            <Text className="mt-4 text-2xl font-bold text-green-600">${tipAmount.toFixed(2)} added</Text>
                          ) : (
                            <View className="mt-5">
                              <Text className="mb-2 text-sm text-gray-500">
                                Type any amount (e.g. 0.50).
                              </Text>
                              <View className="flex-row items-center">
                                <Text className="mr-2 text-xl font-bold text-gray-900">$</Text>
                                <TextInput
                                  value={tipDraft}
                                  onChangeText={setTipDraft}
                                  placeholder="0.00"
                                  keyboardType="decimal-pad"
                                  editable={!submittingTip}
                                  className="h-12 flex-1 rounded-[18px] bg-[#f8fafc] px-4 text-base text-gray-900"
                                />
                                <TouchableOpacity
                                  onPress={handleSendTip}
                                  disabled={submittingTip}
                                  className="ml-3 h-12 items-center justify-center rounded-[18px] px-5"
                                  style={{ backgroundColor: PRIMARY_BLUE, opacity: submittingTip ? 0.7 : 1 }}
                                >
                                  <Text className="text-sm font-bold text-white">Send</Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          )}
                          {submittingTip ? (
                            <View className="mt-2 flex-row items-center">
                              <ActivityIndicator size="small" color={PRIMARY_BLUE} />
                              <Text className="ml-2 text-sm text-gray-500">Sending tip...</Text>
                            </View>
                          ) : null}
                        </View>
                      ) : null}

                      <View className="mt-5 rounded-[24px] bg-white px-5 py-5">
                        <Text className="text-xl font-bold text-gray-900">Lost item</Text>
                        <Text className="mt-2 text-sm text-gray-500">
                          Left something in the car? Send the details to support.
                        </Text>
                        <TextInput
                          value={lostItemDescription}
                          onChangeText={setLostItemDescription}
                          placeholder="Describe the item you lost"
                          multiline
                          textAlignVertical="top"
                          className="mt-4 min-h-[110px] rounded-[18px] bg-[#f8fafc] px-4 py-4 text-base text-gray-900"
                        />
                        <TextInput
                          value={lostItemContactPhone}
                          onChangeText={setLostItemContactPhone}
                          placeholder="Contact phone (optional)"
                          keyboardType="phone-pad"
                          className="mt-3 h-12 rounded-[18px] bg-[#f8fafc] px-4 text-base text-gray-900"
                        />
                        <TouchableOpacity
                          onPress={handleReportLostItem}
                          disabled={submittingLostItem}
                          className="mt-4 h-12 items-center justify-center rounded-[18px]"
                          style={{ backgroundColor: PRIMARY_BLUE, opacity: submittingLostItem ? 0.7 : 1 }}
                        >
                          {submittingLostItem ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Text className="text-sm font-bold uppercase text-white">Report lost item</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : null}

                  {stage === 'completed' ? (
                    <TouchableOpacity
                      onPress={handleDone}
                      className="mt-4 h-14 rounded-[22px] items-center justify-center"
                      style={{ backgroundColor: PRIMARY_BLUE }}
                    >
                      <Text className="text-lg font-bold text-white">Done</Text>
                    </TouchableOpacity>
                  ) : null}

                </>
              ) : null}
            </ScrollView>

              {!isCompleted ? (
                <View
                  className="bg-[#f8fafc] px-5 pt-3"
                  style={{ paddingBottom: bottomActionInset }}
                >
                  {stage === 'on_trip' ? (
                    <View className="flex-row items-center gap-3">
                      <TouchableOpacity
                        onPress={handleCancelRide}
                        className="flex-1 h-14 rounded-[22px] border-2 border-red-300 items-center justify-center bg-red-50"
                      >
                        <Text className="text-lg font-extrabold text-red-700">Cancel ride</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View>
                      <View className="flex-row items-center gap-3">
                        {driverHasArrived && !rideStatus?.passengerConfirmedAt ? (
                          <TouchableOpacity
                            onPress={handleConfirmPickup}
                            disabled={confirmingPickup}
                            className="flex-1 h-14 rounded-[22px] items-center justify-center"
                            style={{ backgroundColor: PRIMARY_BLUE, opacity: confirmingPickup ? 0.7 : 1 }}
                          >
                            {confirmingPickup ? (
                              <ActivityIndicator size="small" color="#fff" />
                            ) : (
                              <Text className="text-lg font-bold text-white">I'm coming</Text>
                            )}
                          </TouchableOpacity>
                        ) : driverHasArrived && rideStatus?.passengerConfirmedAt ? (
                          <View className="flex-1 h-14 rounded-[22px] items-center justify-center bg-green-50 px-3">
                            <Text className="text-base font-bold text-green-700">You're on your way</Text>
                          </View>
                        ) : (
                          <TouchableOpacity
                            onPress={handleCancelRide}
                            className="flex-1 h-14 rounded-[22px] border-2 border-red-300 items-center justify-center bg-red-50"
                          >
                            <Text className="text-lg font-extrabold text-red-700">Cancel ride</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          onPress={() => navigation.navigate('RideChat', {
                            rideRequestId,
                            role: 'passenger',
                            chatTitle: driver?.driverName || 'Driver chat',
                          })}
                          className="h-14 w-14 rounded-full items-center justify-center bg-[#eef4ff]"
                        >
                          <Ionicons name="chatbubble-ellipses" size={22} color={PRIMARY_BLUE} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={handleCallDriver}
                          className="h-14 w-14 rounded-full items-center justify-center"
                          style={{ backgroundColor: PRIMARY_BLUE }}
                        >
                          <Ionicons name="call" size={22} color="#fff" />
                        </TouchableOpacity>
                        {driverHasArrived ? (
                          <TouchableOpacity
                            onPress={handleCancelRide}
                            accessibilityLabel="Cancel ride"
                            className="h-14 w-14 rounded-full items-center justify-center bg-red-50"
                          >
                            <Ionicons name="close" size={24} color="#dc2626" />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </View>
                  )}
                </View>
              ) : null}
          </View>
        </KeyboardAvoidingView>
        )}

        {driverHasArrived ? (
          <View className="absolute inset-0 bg-white">
            <View className="flex-row items-center px-4 pb-2 pt-1">
              <TouchableOpacity
                onPress={() => navigation.goBack()}
                className="h-10 w-10 items-center justify-center rounded-[10px]"
              >
                <Ionicons name="arrow-back" size={22} color="#111827" />
              </TouchableOpacity>
              <Text className="ml-1 flex-1 text-base font-bold text-gray-900" numberOfLines={1}>
                Your driver has arrived
              </Text>
              <TouchableOpacity
                onPress={handleSendPanicAlert}
                disabled={submittingPanicAlert}
                activeOpacity={0.85}
                className="h-10 w-10 items-center justify-center rounded-[10px] bg-[#dc2626]"
                style={{ opacity: submittingPanicAlert ? 0.7 : 1 }}
              >
                {submittingPanicAlert ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="warning" size={20} color="#fff" />
                )}
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 }}
            >
              <View className="flex-row">
                {showSafetyPinBanner ? (
                  <View className="mr-3 flex-1 rounded-[10px] bg-[#eef4ff] px-3 py-2.5">
                    <Text className="text-[10px] font-bold uppercase" style={{ color: PRIMARY_BLUE }}>
                      Safety PIN
                    </Text>
                    <Text className="mt-0.5 text-2xl font-extrabold text-gray-900" style={{ letterSpacing: 4 }}>
                      {safetyPinValue}
                    </Text>
                  </View>
                ) : null}
                <View className={`flex-1 rounded-[10px] px-3 py-2.5 ${pickupWaitExpired ? 'bg-red-50' : 'bg-gray-100'}`}>
                  <Text className="text-[10px] font-bold uppercase text-gray-500">Wait time</Text>
                  <Text className={`mt-0.5 text-2xl font-extrabold ${pickupWaitExpired ? 'text-red-600' : 'text-gray-900'}`}>
                    {pickupWaitCountdownText}
                  </Text>
                </View>
              </View>
              {showSafetyPinBanner && (safetyPinLocked || Number(rideStatus?.safetyPinAttempts || 0) > 0) ? (
                <Text className={`mt-2 text-xs font-semibold ${safetyPinLocked ? 'text-red-600' : 'text-amber-700'}`}>
                  {safetyPinLocked ? 'Too many wrong PIN attempts.' : 'Someone entered the wrong PIN.'}
                </Text>
              ) : null}

              <Text className="mt-6 text-[11px] font-bold uppercase text-gray-400">Your driver</Text>
              <View className="mt-3 flex-row items-center">
                <View
                  className="items-center justify-center overflow-hidden rounded-full bg-[#eef4ff]"
                  style={{ width: 44, height: 44 }}
                >
                  {driverProfileImageUrl ? (
                    <Image source={{ uri: driverProfileImageUrl }} style={{ width: 44, height: 44 }} />
                  ) : (
                    <Ionicons name="person" size={20} color={PRIMARY_BLUE} />
                  )}
                </View>
                <View className="ml-3 min-w-0 flex-1">
                  <Text className="text-sm font-bold text-gray-900" numberOfLines={1}>
                    {driver?.driverName || 'Driver'}
                  </Text>
                  {driverRatingValue ? (
                    <View className="mt-0.5 flex-row items-center">
                      <Ionicons name="star" size={12} color="#f59e0b" />
                      <Text className="ml-1 text-xs text-gray-500">{driverRatingValue.toFixed(1)}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <View className="mt-3 flex-row items-center rounded-[10px] bg-gray-100 px-3 py-3">
                <Ionicons name="car-sport-outline" size={18} color="#111827" />
                <Text className="ml-2 min-w-0 flex-1 text-sm font-semibold text-gray-900" numberOfLines={1}>
                  {driverCarName || 'Vehicle'}
                </Text>
                {driverPlate ? (
                  <View className="ml-2 rounded-[10px] bg-white px-2 py-1">
                    <Text className="text-xs font-extrabold tracking-wider text-gray-900">{driverPlate}</Text>
                  </View>
                ) : null}
              </View>

              <Text className="mt-6 text-[11px] font-bold uppercase text-gray-400">Trip details</Text>
              <View className="mt-3 flex-row items-center justify-between">
                <Text className="text-sm text-gray-500">Fare</Text>
                <Text className="text-base font-bold text-gray-900">${totalAmount.toFixed(2)}</Text>
              </View>
              <View className="mt-2 flex-row items-center justify-between">
                <Text className="text-sm text-gray-500">Payment</Text>
                <Text className="text-sm font-semibold text-gray-900">
                  {paymentMethod === 'cash' ? 'Cash' : 'Online'}
                </Text>
              </View>
              <View className="mt-5">
                {tripTimelineLabels.map((label, index) => {
                  const isPickup = index === 0;
                  const isDropoff = index === tripTimelineLabels.length - 1;
                  return (
                    <View key={`arrived-${label}-${index}`} className={index ? 'mt-4' : ''}>
                      <Text
                        className="text-xs font-bold uppercase"
                        style={{ color: isPickup ? PIN_COLORS.finish : '#9ca3af' }}
                      >
                        {isPickup ? 'Pick up' : isDropoff ? 'Drop-off' : `Stop ${index}`}
                      </Text>
                      <View className="mt-1.5 flex-row items-start">
                        <View
                          className="mr-3 mt-1.5 h-2.5 w-2.5 rounded-full"
                          style={{
                            backgroundColor: isPickup ? '#111827' : isDropoff ? PIN_COLORS.finish : PIN_COLORS.stop,
                          }}
                        />
                        <Text className="flex-1 text-sm font-semibold text-gray-900">{label}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </ScrollView>

            <View className="flex-row items-center gap-3 px-5 pt-3" style={{ paddingBottom: bottomActionInset }}>
              {!rideStatus?.passengerConfirmedAt ? (
                <TouchableOpacity
                  onPress={handleConfirmPickup}
                  disabled={confirmingPickup}
                  className="h-12 flex-1 items-center justify-center rounded-[10px]"
                  style={{ backgroundColor: PRIMARY_BLUE, opacity: confirmingPickup ? 0.7 : 1 }}
                >
                  {confirmingPickup ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text className="text-base font-bold text-white">I'm coming</Text>
                  )}
                </TouchableOpacity>
              ) : (
                <View className="h-12 flex-1 items-center justify-center rounded-[10px] bg-green-50 px-3">
                  <Text className="text-sm font-bold text-green-700">You're on your way</Text>
                </View>
              )}
              <TouchableOpacity
                onPress={() => navigation.navigate('RideChat', {
                  rideRequestId,
                  role: 'passenger',
                  chatTitle: driver?.driverName || 'Driver chat',
                })}
                className="h-12 w-12 items-center justify-center rounded-[10px] bg-[#eef4ff]"
              >
                <Ionicons name="chatbubble-ellipses" size={20} color={PRIMARY_BLUE} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCallDriver}
                className="h-12 w-12 items-center justify-center rounded-[10px]"
                style={{ backgroundColor: PRIMARY_BLUE }}
              >
                <Ionicons name="call" size={20} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCancelRide}
                accessibilityLabel="Cancel ride"
                className="h-12 w-12 items-center justify-center rounded-[10px] bg-red-50"
              >
                <Ionicons name="close" size={22} color="#dc2626" />
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </View>

      <Modal visible={showCancelReasonModal} transparent animationType="slide">
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
            <ScrollView className="mt-4 max-h-64" showsVerticalScrollIndicator={false}>
              {PASSENGER_CANCELLATION_REASONS.map((r) => (
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

      <Modal visible={showDriverRatingModal} animationType="slide" onRequestClose={handleSkipRating}>
        <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom', 'left', 'right']}>
          <View className="flex-row items-center px-4 pb-2 pt-1">
            <TouchableOpacity
              onPress={handleSkipRating}
              disabled={submittingRating}
              hitSlop={10}
              className="h-10 w-10 items-center justify-center rounded-[10px] bg-gray-100"
            >
              <Ionicons name="close" size={20} color="#111827" />
            </TouchableOpacity>
            <Text className="flex-1 text-center text-base font-bold text-gray-900">
              {shouldPromptForRating ? 'Rate your trip' : 'Trip complete'}
            </Text>
            <View className="h-10 w-10" />
          </View>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
              <ScrollView
                className="flex-1"
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
              >
                <View className="mt-2 items-center">
                  {driverProfileImageUrl ? (
                    <Image source={{ uri: driverProfileImageUrl }} className="h-16 w-16 rounded-full bg-gray-100" />
                  ) : (
                    <View className="h-16 w-16 items-center justify-center rounded-full bg-[#eef4ff]">
                      <Ionicons name="person" size={28} color={PRIMARY_BLUE} />
                    </View>
                  )}
                  <Text className="mt-2 text-base font-bold text-gray-900">{driver?.driverName || 'Your driver'}</Text>
                  {[driverCarName, driverPlate].filter(Boolean).length ? (
                    <Text className="mt-0.5 text-xs text-gray-500">{[driverCarName, driverPlate].filter(Boolean).join(' · ')}</Text>
                  ) : null}
                </View>

                {shouldPromptForRating ? (
                  <View className="mt-5">
                    <RideRatingTagPicker
                      rating={rating}
                      onChangeRating={(value) => {
                        ratingDraftTouchedRef.current = true;
                        setRating(value);
                      }}
                      groups={PASSENGER_DRIVER_RATING_GROUPS}
                      selectedTags={selectedRatingTags}
                      onToggleTag={(tag) => {
                        ratingDraftTouchedRef.current = true;
                        setSelectedRatingTags((current) => toggleRatingTag(current, tag));
                      }}
                      review={review}
                      onChangeReview={(value) => {
                        ratingDraftTouchedRef.current = true;
                        setReview(value);
                      }}
                      title="How was your trip?"
                    />
                  </View>
                ) : (
                  <View className="mt-5 flex-row items-center justify-center rounded-[10px] bg-green-50 px-3 py-3">
                    <Ionicons name="checkmark-circle" size={18} color="#16a34a" />
                    <Text className="ml-2 text-sm font-semibold text-green-700">Thanks, your rating was saved</Text>
                  </View>
                )}

                {((rideStatus?.canTipDriver && paymentStatus !== 'paid') || tipAmount > 0) ? (
                  <View className="mt-6">
                    <Text className="text-sm font-bold text-gray-900">Add a tip</Text>
                    {tipAmount > 0 ? (
                      <View className="mt-2 flex-row items-center rounded-[10px] bg-green-50 px-3 py-3">
                        <Ionicons name="heart" size={16} color="#16a34a" />
                        <Text className="ml-2 text-sm font-semibold text-green-700">
                          ${tipAmount.toFixed(2)} tip sent. Thank you!
                        </Text>
                      </View>
                    ) : (
                      <>
                        <View className="mt-2 flex-row">
                          {['0.50', '1.00', '2.00', '5.00'].map((amount) => {
                            const selected = tipDraft === amount;
                            return (
                              <TouchableOpacity
                                key={amount}
                                onPress={() => setTipDraft(selected ? '' : amount)}
                                disabled={submittingTip}
                                className="mr-2 h-10 flex-1 items-center justify-center rounded-[10px]"
                                style={{ backgroundColor: selected ? PRIMARY_BLUE : '#f3f4f6' }}
                              >
                                <Text className={`text-sm font-bold ${selected ? 'text-white' : 'text-gray-800'}`}>${amount}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                        <View className="mt-2 flex-row items-center">
                          <View className="h-11 flex-1 flex-row items-center rounded-[10px] bg-[#f8fafc] px-3">
                            <Text className="text-sm font-bold text-gray-500">$</Text>
                            <TextInput
                              value={tipDraft}
                              onChangeText={setTipDraft}
                              placeholder="Other amount"
                              placeholderTextColor="#9ca3af"
                              keyboardType="decimal-pad"
                              editable={!submittingTip}
                              className="ml-1 flex-1 text-sm text-gray-900"
                            />
                          </View>
                          <TouchableOpacity
                            onPress={handleSendTip}
                            disabled={submittingTip || !String(tipDraft || '').trim()}
                            className="ml-2 h-11 items-center justify-center rounded-[10px] px-5"
                            style={{ backgroundColor: PRIMARY_BLUE, opacity: submittingTip || !String(tipDraft || '').trim() ? 0.5 : 1 }}
                          >
                            {submittingTip ? (
                              <ActivityIndicator size="small" color="#fff" />
                            ) : (
                              <Text className="text-sm font-bold text-white">Send tip</Text>
                            )}
                          </TouchableOpacity>
                        </View>
                      </>
                    )}
                  </View>
                ) : null}

                <View className="mt-6 rounded-[10px] bg-[#f8fafc] px-4 py-4">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-sm font-bold text-gray-900">Trip receipt</Text>
                    <TouchableOpacity onPress={handleDownloadTripReceipt} disabled={downloadingTripReceipt} hitSlop={8} className="flex-row items-center">
                      {downloadingTripReceipt ? (
                        <ActivityIndicator size="small" color={PRIMARY_BLUE} />
                      ) : (
                        <>
                          <Ionicons name="download-outline" size={16} color={PRIMARY_BLUE} />
                          <Text className="ml-1 text-xs font-bold" style={{ color: PRIMARY_BLUE }}>PDF</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                  <View className="mt-3">
                    {tripTimelineLabels.map((label, index) => {
                      const isLast = index === tripTimelineLabels.length - 1;
                      return (
                        <View key={`receipt-stop-${index}`} className="flex-row">
                          <View className="mr-3 items-center" style={{ width: 10 }}>
                            <View
                              className="mt-1.5 h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: index === 0 ? PIN_COLORS.start : isLast ? PIN_COLORS.finish : PIN_COLORS.stop }}
                            />
                            {!isLast ? <View className="w-px flex-1 bg-gray-300" style={{ minHeight: 14 }} /> : null}
                          </View>
                          <Text className={`flex-1 text-sm text-gray-800 ${isLast ? '' : 'pb-3'}`} numberOfLines={2}>{label}</Text>
                        </View>
                      );
                    })}
                  </View>
                  <View className="mt-3 border-t border-gray-200 pt-3">
                    <View className="flex-row items-center justify-between">
                      <Text className="text-sm text-gray-500">Trip fare</Text>
                      <Text className="text-sm font-semibold text-gray-900">${estimatedAmount.toFixed(2)}</Text>
                    </View>
                    {tipAmount > 0 ? (
                      <View className="mt-2 flex-row items-center justify-between">
                        <Text className="text-sm text-gray-500">Tip</Text>
                        <Text className="text-sm font-semibold text-green-600">${tipAmount.toFixed(2)}</Text>
                      </View>
                    ) : null}
                    <View className="mt-2 flex-row items-center justify-between">
                      <Text className="text-sm text-gray-500">Payment</Text>
                      <Text className="text-sm font-semibold text-gray-900">{receiptPaymentMethodLabel(rideStatus?.paymentMethod) || '-'}</Text>
                    </View>
                    <View className="mt-3 flex-row items-center justify-between">
                      <Text className="text-base font-bold text-gray-900">Total</Text>
                      <Text className="text-lg font-bold text-gray-900">${totalAmount.toFixed(2)}</Text>
                    </View>
                  </View>
                </View>
              </ScrollView>

              <View className="border-t border-gray-100 bg-white px-4 pb-2 pt-3">
                <TouchableOpacity
                  onPress={shouldPromptForRating ? handleSubmitRating : handleSkipRating}
                  disabled={submittingRating || (shouldPromptForRating && rating < 1)}
                  className="h-12 items-center justify-center rounded-[10px]"
                  style={{ backgroundColor: PRIMARY_BLUE, opacity: submittingRating || (shouldPromptForRating && rating < 1) ? 0.5 : 1 }}
                >
                  {submittingRating ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text className="text-base font-bold text-white">
                      {shouldPromptForRating ? 'Submit rating' : 'Done'}
                    </Text>
                  )}
                </TouchableOpacity>
                {shouldPromptForRating ? (
                  <TouchableOpacity onPress={handleSkipRating} disabled={submittingRating} className="h-10 items-center justify-center">
                    <Text className="text-sm font-semibold text-gray-500">Skip for now</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

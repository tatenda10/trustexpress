import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, Alert, ActivityIndicator, Animated, Easing, ScrollView, Vibration, Linking, Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { Audio } from 'expo-av';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { connectRealtime } from '../../realtime';
import { showLocalRideNotification } from '../../notifications';
import {
  acceptDriverRideRequest,
  cancelDriverCurrentRide,
  getDriverCurrentRide,
  getDriverMe,
  getDriverRideRequests,
  updateDriverAvailability,
} from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import { DRIVER_CANCELLATION_REASONS } from '../../constants/cancellationReasons';

const DRIVER_ALERTS_ASKED_KEY = 'trust_express_asked_ride_alerts';
const REQUEST_REFRESH_INTERVAL_MS = 2500;
const CURRENT_RIDE_REFRESH_INTERVAL_MS = 15000;
const AVAILABILITY_TOGGLE_DEBOUNCE_MS = 2500;
const DB_UPDATE_INTERVAL_MS = 90000;
const DB_UPDATE_MIN_DISTANCE_KM = 0.3;
const FALLBACK_DRIVER_COORDINATE = { latitude: -17.8056, longitude: 31.0447 };
const INITIAL_REGION = {
  latitude: -17.8252,
  longitude: 31.0503,
  latitudeDelta: 0.18,
  longitudeDelta: 0.18,
};
const DRIVER_IDLE_REGION = { latitudeDelta: 0.05, longitudeDelta: 0.05 };
const DRIVER_KEEP_AWAKE_TAG = 'driver-home-online';
const INCOMING_RIDE_ALERT_INTERVAL_MS = 4500;
const MIN_ACCEPTABLE_REQUEST_SECONDS = 8;

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

function decodePolyline(encoded) {
  if (!encoded) return [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const coordinates = [];

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = null;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = (result & 1) ? ~(result >> 1) : (result >> 1);
    latitude += deltaLat;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = (result & 1) ? ~(result >> 1) : (result >> 1);
    longitude += deltaLng;

    coordinates.push({
      latitude: latitude / 1e5,
      longitude: longitude / 1e5,
    });
  }

  return coordinates;
}

function getDirectionsApiKey() {
  return (
    Constants.expoConfig?.extra?.googleMapsDirectionsApiKey ||
    Constants.expoConfig?.android?.config?.googleMaps?.apiKey ||
    Constants.expoConfig?.ios?.config?.googleMapsApiKey ||
    ''
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
  const apiKey = getDirectionsApiKey();
  if (!apiKey || !coordinate) return null;

  const { latitude, longitude } = coordinate;
  const latlng = `${latitude},${longitude}`;

  try {
    // 1) Try a nearby place first (POI-style label).
    const nearbyParams = new URLSearchParams({
      location: latlng,
      rankby: 'distance',
      key: apiKey,
    });

    const nearbyRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${nearbyParams.toString()}`
    );
    const nearbyJson = await nearbyRes.json().catch(() => ({}));

    if (nearbyJson?.status === 'OK' && Array.isArray(nearbyJson.results)) {
      const poi = nearbyJson.results.find((place) => {
        const name = place?.name || '';
        if (!name) return false;
        if (looksLikePlusCode(name)) return false;
        const lower = name.toLowerCase();
        if (lower.includes('unnamed') || lower.includes('unknown')) return false;
        return true;
      });

      if (poi) {
        const name = poi.name;
        const vicinityRaw = (poi.vicinity || '').trim();
        const cleanedVicinity = stripLeadingPlusCodeFromLabel(vicinityRaw) || vicinityRaw;
        const candidate = cleanedVicinity ? `${name}, ${cleanedVicinity}` : name;
        const nice = cleanLocationLabelCandidate(candidate);
        if (nice) return nice;
      }
    }
  } catch {
    // Ignore and fall back to reverse geocode.
  }

  try {
    // 2) Fallback: reverse geocode to a street address-style label.
    const geocodeParams = new URLSearchParams({
      latlng,
      key: apiKey,
    });

    const geoRes = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?${geocodeParams.toString()}`
    );
    const geoJson = await geoRes.json().catch(() => ({}));

    if (geoJson?.status === 'OK' && Array.isArray(geoJson.results) && geoJson.results[0]) {
      const result =
        geoJson.results.find((r) =>
          Array.isArray(r.types) &&
          (r.types.includes('street_address') || r.types.includes('route'))
        ) || geoJson.results[0];

      const components = Array.isArray(result.address_components)
        ? result.address_components
        : [];

      function pick(type) {
        const comp = components.find((c) => c.types && c.types.includes(type));
        return comp ? comp.long_name : '';
      }

      const streetNumber = pick('street_number');
      const route = pick('route');
      const sublocality = pick('sublocality') || pick('sublocality_level_1');
      const locality = pick('locality') || pick('administrative_area_level_2');

      const parts = [];
      if (route || streetNumber) {
        parts.push([streetNumber, route].filter(Boolean).join(' ').trim());
      }
      if (sublocality) parts.push(sublocality);
      if (locality) parts.push(locality);

      const label = parts.filter(Boolean).join(', ');
      const niceLabel = cleanLocationLabelCandidate(label);
      if (niceLabel) return niceLabel;

      if (result.formatted_address) {
        const niceFormatted = cleanLocationLabelCandidate(result.formatted_address);
        if (niceFormatted) return niceFormatted;
      }
    }
  } catch {
    // Final fallback will be coordinates.
  }

  return null;
}

async function fetchGoogleRouteCoordinates(origin, destination) {
  const apiKey = getDirectionsApiKey();
  if (!apiKey || !origin || !destination) {
    return null;
  }

  const params = new URLSearchParams({
    origin: `${origin.latitude},${origin.longitude}`,
    destination: `${destination.latitude},${destination.longitude}`,
    mode: 'driving',
    departure_time: 'now',
    key: apiKey,
  });

  const response = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error_message || `Directions request failed (${response.status})`);
  }

  if (payload?.status !== 'OK' || !Array.isArray(payload?.routes) || !payload.routes[0]) {
    throw new Error(payload?.error_message || 'No Google route found');
  }

  const route = payload.routes[0];
  return decodePolyline(route.overview_polyline?.points);
}

const DriverHomeScreen = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const isFocused = useIsFocused();
  const [isOnline, setIsOnline] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showNewRequestBadge, setShowNewRequestBadge] = useState(false);
  const [activeRequest, setActiveRequest] = useState(null);
  const [availableRequests, setAvailableRequests] = useState([]);
  const [loadingAvailability, setLoadingAvailability] = useState(true);
  const [availabilityActionPending, setAvailabilityActionPending] = useState(false);
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
  const requestLoadInFlightRef = useRef(false);
  const lastAvailabilityAttemptRef = useRef({ target: null, at: 0 });
  const forwardedRideIdRef = useRef(null);
  const lastDbLocationRef = useRef({ coordinate: null, at: 0 });
  const lastLabelFetchRef = useRef({ coordinate: null, at: 0 });
  const LABEL_UPDATE_INTERVAL_MS = 120000; // at most every 2 minutes
  const LABEL_UPDATE_MIN_DISTANCE_KM = 0.3; // or every ~300m
  const placeLabelCacheRef = useRef(new Map());

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

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

        const handleRealtimeRefresh = () => {
          if (!active) return;
          setRealtimeSignal((current) => current + 1);
        };

        const handleDriverRating = (payload = {}) => {
          if (!active) return;
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
  }, [isFocused]);

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
    if (route?.params?.openIncomingRideOverlay) {
      // Do not auto-open the in-app incoming request modal.
      setShowIncomingRideOverlay(false);
      navigation.setParams?.({
        openIncomingRideOverlay: false,
        notificationTs: route?.params?.notificationTs || undefined,
      });
    }
  }, [navigation, route?.params?.notificationTs, route?.params?.openIncomingRideOverlay]);

  useEffect(() => {
    const interval = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!currentRide?.id) {
      forwardedRideIdRef.current = null;
      return;
    }
    if (forwardedRideIdRef.current === currentRide.id) return;

    forwardedRideIdRef.current = currentRide.id;
    navigation.navigate('DriverTrip');
  }, [currentRide?.id, navigation]);

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

    const loadCurrentRide = async () => {
      if (currentRideLoadInFlightRef.current) return;
      currentRideLoadInFlightRef.current = true;
      try {
        const token = await getTokenRef.current();
        if (!token) throw new Error('Not signed in');
        const data = await getDriverCurrentRide(token);
        if (!active) return;
        setCurrentRide(data?.ride || null);
        if (data?.ride) {
          setPendingSelectionRide(null);
        }
        if (data?.ride?.driverCoordinate) {
          setDriverCoordinate(data.ride.driverCoordinate);
        }
      } catch {
        if (!active) return;
        setCurrentRide(null);
      } finally {
        currentRideLoadInFlightRef.current = false;
      }
    };

    loadCurrentRide();
    if (!currentRide?.id && !pendingSelectionRide) {
      return () => {
        active = false;
      };
    }

    const interval = setInterval(() => {
      loadCurrentRide();
    }, CURRENT_RIDE_REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [currentRide?.id, isFocused, pendingSelectionRide]);

  useEffect(() => {
    if (!isOnline) {
      setIsListening(false);
      setShowNewRequestBadge(false);
      setActiveRequest(null);
      setAvailableRequests([]);
      setShowIncomingRideOverlay(false);
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

        const nextListRaw = Array.isArray(data?.requests)
          ? data.requests.filter((request) => !dismissedRequestIds.includes(request.id))
          : [];
        const serverCapturedAt = Date.now();
        const nextList = nextListRaw
          .map((request) => ({
            ...request,
            remainingSecondsCapturedAt: serverCapturedAt,
          }))
          .filter(
            (request) =>
              getRemainingSeconds(
                request?.expiresAt,
                request?.remainingSeconds,
                request?.remainingSecondsCapturedAt,
              ) >= MIN_ACCEPTABLE_REQUEST_SECONDS
          );
        if (__DEV__) {
          console.log('[driver.home] requests fetched', {
            totalRaw: nextListRaw.length,
            totalVisible: nextList.length,
            nowIso: new Date().toISOString(),
            requests: nextListRaw.map((request) => ({
              id: request?.id,
              status: request?.status,
              expiresAt: request?.expiresAt || null,
              remainingSecondsServer: Number(request?.remainingSeconds ?? -1),
              remainingSecondsUi: getRemainingSeconds(
                request?.expiresAt,
                request?.remainingSeconds,
                serverCapturedAt,
              ),
            })),
          });
        }
        const nextRequest = nextList[0] || null;

        const prevCount = prevRequestCountRef.current;
        if (!initialLoad && nextList.length > prevCount && prevCount >= 0) {
          try {
            Vibration.vibrate([200, 100, 200]);
          } catch (_) {}
          try {
            const newestRequest = nextList[0];
            await showLocalRideNotification({
              title: 'New ride request',
              body: newestRequest
                ? `${newestRequest.pickupLabel || 'Pickup'} to ${newestRequest.dropoffLabel || 'Dropoff'}`
                : 'A new ride request is waiting for you.',
              data: {
                type: 'driver_new_ride_request',
                rideRequestId: newestRequest?.id || null,
                publicId: newestRequest?.publicId || null,
              },
            });
          } catch (_) {}
        }
        prevRequestCountRef.current = nextList.length;

        setAvailableRequests(nextList);
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
        if (!nextRequest) {
          setShowIncomingRideOverlay(false);
        }
        setShowNewRequestBadge(!!nextRequest);
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
        if (!incomingRideSoundRef.current) {
          const { sound } = await Audio.Sound.createAsync(
            require('../../assets/notificationaudio.mpeg'),
            { shouldPlay: false, volume: 1.0 },
          );
          incomingRideSoundRef.current = sound;
        }

        const sound = incomingRideSoundRef.current;
        if (sound) {
          await sound.replayAsync();
        }
        Vibration.vibrate([0, 250, 160, 250]);
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
    () => formatCountdown(getRemainingSeconds(activeRequest?.expiresAt)),
    [activeRequest?.expiresAt, nowTick]
  );

  useEffect(() => {
    if (!pendingSelectionRide || currentRide?.id) return;
    if (
      getRemainingSeconds(
        pendingSelectionRide.expiresAt,
        pendingSelectionRide?.remainingSeconds,
        pendingSelectionRide?.remainingSecondsCapturedAt,
      ) > 0
    ) return;

    setPendingSelectionRide(null);
    Alert.alert(
      'Request expired',
      'Passenger did not select in time. You can accept a new incoming request.',
    );
  }, [currentRide?.id, nowTick, pendingSelectionRide]);

  // Load a curved Google Maps route for the current ride or active request
  useEffect(() => {
    const hasRide = !!currentRide;
    const hasRequest = !currentRide && !!activeRequest;

    const origin = hasRide
      ? (currentRide.driverCoordinate || driverCoordinate)
      : hasRequest
        ? driverCoordinate
        : null;

    const destination = hasRide
      ? (currentRide.stage === 'on_trip' ? currentRide.dropoffCoordinate : currentRide.pickupCoordinate)
      : hasRequest
        ? activeRequest.pickupCoordinate
        : null;

    if (!origin || !destination) {
      setRouteCoordinates([]);
      return undefined;
    }

    let cancelled = false;

    const loadRoute = async () => {
      try {
        const coords = await fetchGoogleRouteCoordinates(origin, destination);
        if (cancelled) return;

        if (Array.isArray(coords) && coords.length > 1) {
          setRouteCoordinates(coords);
        } else {
          setRouteCoordinates([origin, destination]);
        }
      } catch {
        if (cancelled) return;
        setRouteCoordinates([origin, destination]);
      }
    };

    loadRoute();

    return () => {
      cancelled = true;
    };
  }, [activeRequest, currentRide, driverCoordinate]);

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

  const handleGoOnline = async () => {
    if (availabilityActionPending || isOnline) return;
    try {
      setAvailabilityActionPending(true);
      await syncAvailability(true);
      setDismissedRequestIds([]);
      setIsOnline(true);
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

          // Optionally refresh the human-readable location label using Google Places/Geocode.
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
                  // Keep last known label if Google couldn't resolve a name.
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
      if (getRemainingSeconds(req.expiresAt, req?.remainingSeconds, req?.remainingSecondsCapturedAt) < 1) {
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
        setDismissedRequestIds((current) => [...new Set([...current, req.id])]);
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
      setShowIncomingRideOverlay(false);
      setShowNewRequestBadge(false);
      setIsListening(true);
      setCurrentRide(nextRide?.ride || null);
      setPendingSelectionRide(nextRide?.ride ? null : req);
      Alert.alert('Request accepted', nextRide?.ride ? 'Ride assigned. Open the trip route when ready.' : 'Waiting for passenger to choose a driver.');
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

  const handleDeclineRequest = (request) => {
    const req = request || activeRequest;
    if (!req) return;
    setDismissedRequestIds((current) => [...new Set([...current, req.id])]);
    const nextList = availableRequests.filter((r) => r.id !== req.id);
    setAvailableRequests(nextList);
    setActiveRequest(nextList[0] || null);
    setShowIncomingRideOverlay(nextList.length > 0);
    setShowNewRequestBadge(nextList.length > 0);
    setIsListening(nextList.length === 0);
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
          <Marker coordinate={driverCoordinate} title="You" pinColor="#2563eb" />
          {currentRide ? (
            <>
              <Marker coordinate={currentRide.pickupCoordinate} title="Pickup" pinColor="#1d4ed8" />
              <Marker coordinate={currentRide.dropoffCoordinate} title="Drop-off" pinColor="#111827" />
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
          {activeRequest ? (
            <>
              <Marker coordinate={activeRequest.pickupCoordinate} title="Pickup" pinColor="#1d4ed8" />
              <Marker coordinate={activeRequest.dropoffCoordinate} title="Drop-off" pinColor="#111827" />
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
                  coordinates={[activeRequest.pickupCoordinate, activeRequest.dropoffCoordinate]}
                  strokeColor="#2563eb"
                  strokeWidth={4}
                />
              )}
            </>
          ) : null}
        </MapView>

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

        {showNewRequestBadge && availableRequests.length === 0 ? (
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
                onPress={() => navigation.navigate('DriverTrip')}
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
        ) : (
          <View
            className="absolute left-0 right-0"
            style={{ top: insets.top + 118, bottom: insets.bottom + 88, paddingHorizontal: 16 }}
            pointerEvents="box-none"
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              {availableRequests.map((req, index) => (
                <View
                  key={req.id}
                  className="mb-4 rounded-[28px] border border-[#d7dfec] bg-white/95 p-5"
                >
                  <View className="mb-3 flex-row items-center justify-between">
                    <View className="flex-row items-center">
                      <View className="rounded-full bg-[#2f73c9] px-3 py-1.5">
                        <Text className="text-xs font-bold uppercase tracking-[1px] text-white">
                          {index === 0 ? 'New request' : `Request ${index + 1}`}
                        </Text>
                      </View>
                      {index === 0 && availableRequests.length > 1 ? (
                        <View className="ml-2 rounded-full bg-[#dcfce7] px-2 py-0.5">
                          <Text className="text-xs font-bold uppercase text-[#15803d]">Nearest</Text>
                        </View>
                      ) : null}
                    </View>
                    <View className="rounded-full bg-[#111827] px-3 py-1.5">
                      <Text className="text-xs font-bold uppercase tracking-[1px] text-white">
                        {formatCountdown(getRemainingSeconds(req.expiresAt, req?.remainingSeconds, req?.remainingSecondsCapturedAt))}
                      </Text>
                    </View>
                  </View>

                  <View className="flex-row items-start justify-between">
                    <View className="flex-1 pr-4">
                      <Text className="text-xs font-semibold uppercase tracking-wide text-[#2f73c9]">Incoming request</Text>
                      <Text className="mt-1 text-xl font-bold text-[#111111]">
                        {req.passengerName || 'Passenger'}
                      </Text>
                      <View className="mt-2 self-start rounded-full bg-[#e3e9f2] px-3 py-1">
                        <Text className="text-xs font-bold uppercase text-[#2f73c9]">{req.tierName || 'Ride'}</Text>
                      </View>
                    </View>
                    <View className="items-end">
                      <Text className="text-xs font-semibold uppercase tracking-wide text-[#5a6474]">Fare</Text>
                      <Text className="mt-1 text-3xl font-extrabold text-[#111111]">${Number(req.estimatedAmount || 0).toFixed(2)}</Text>
                    </View>
                  </View>

                  <View className="mt-4 rounded-[22px] bg-[#f8fafc] px-4 py-4">
                    <View className="flex-row">
                      <View className="mr-4 items-center pt-1">
                        <View className="h-3.5 w-3.5 rounded-full bg-[#2f73c9]" />
                        <View className="my-2 h-10 w-[2px] rounded-full bg-[#cbd5e1]" />
                        <View className="h-3.5 w-3.5 rounded-full bg-[#111827]" />
                      </View>
                      <View className="flex-1">
                        <Text className="text-[11px] font-bold uppercase tracking-[1px] text-[#2f73c9]">Pickup</Text>
                        <Text className="mt-1 text-base font-semibold text-[#111111]">{req.pickup}</Text>
                        <Text className="mt-4 text-[11px] font-bold uppercase tracking-[1px] text-[#5a6474]">Drop-off</Text>
                        <Text className="mt-1 text-base font-semibold text-[#111111]">{req.dropoff}</Text>
                      </View>
                    </View>
                  </View>

                  <View className="mt-4 flex-row items-center gap-6">
                    <View className="flex-row items-center">
                      <Ionicons name="navigate" size={15} color="#2f73c9" />
                      <Text className="ml-1.5 text-sm font-medium text-[#5a6474]">{req.driverDistanceKm.toFixed(1)} km away</Text>
                    </View>
                    <View className="flex-row items-center">
                      <Ionicons name="time" size={15} color="#2f73c9" />
                      <Text className="ml-1.5 text-sm font-medium text-[#5a6474]">{req.etaMinutes} min away</Text>
                    </View>
                  </View>

                  <View className="mt-4 flex-row gap-3">
                    <TouchableOpacity
                      onPress={() => handleDeclineRequest(req)}
                      className="h-12 flex-1 items-center justify-center rounded-[14px] border border-[#d7d9df] bg-white"
                    >
                      <Text className="text-xs font-bold uppercase text-[#5d6470]">Decline</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleAcceptRequest(req)}
                      disabled={acceptingRideId === req.id}
                      className="h-12 flex-[1.15] flex-row items-center justify-center rounded-[14px] bg-[#2f73c9]"
                    >
                      {acceptingRideId === req.id ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text className="text-xs font-bold uppercase text-white">Accept</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      <Modal
        visible={showIncomingRideOverlay && !currentRide && availableRequests.length > 0}
        transparent
        animationType="slide"
        onRequestClose={() => setShowIncomingRideOverlay(false)}
      >
        <View className="flex-1 bg-black/55">
          <SafeAreaView className="flex-1 bg-transparent">
            <View className="flex-1 justify-end px-5 pb-6">
              <View className="rounded-[30px] bg-white px-5 pt-5 pb-6">
                <View className="items-center">
                  <View className="h-1.5 w-16 rounded-full bg-gray-300" />
                </View>

                <View className="mt-5 flex-row items-start justify-between">
                  <View className="flex-1 pr-4">
                    <Text className="text-xs font-bold uppercase tracking-[2px] text-[#2f73c9]">
                      Incoming ride request
                    </Text>
                    <Text className="mt-2 text-2xl font-bold text-[#111111]">
                      {activeRequest?.passengerName || 'Passenger'}
                    </Text>
                    <Text className="mt-2 text-sm text-[#5a6474]">
                      Review the trip details and accept fast before it expires.
                    </Text>
                  </View>
                  <View className="rounded-[20px] bg-[#111827] px-4 py-3">
                    <Text className="text-xs font-bold uppercase tracking-[1px] text-white">Expires in</Text>
                    <Text className="mt-1 text-xl font-extrabold text-white">
                      {formatCountdown(getRemainingSeconds(activeRequest?.expiresAt, activeRequest?.remainingSeconds, activeRequest?.remainingSecondsCapturedAt))}
                    </Text>
                  </View>
                </View>

                <View className="mt-5 rounded-[24px] bg-[#f8fafc] px-4 py-4">
                  <View className="flex-row items-center justify-between">
                    <View>
                      <Text className="text-xs font-semibold uppercase tracking-[1px] text-[#5a6474]">Fare</Text>
                      <Text className="mt-1 text-3xl font-extrabold text-[#111111]">
                        ${Number(activeRequest?.estimatedAmount || 0).toFixed(2)}
                      </Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-xs font-semibold uppercase tracking-[1px] text-[#5a6474]">Tier</Text>
                      <Text className="mt-1 text-base font-bold text-[#2f73c9]">
                        {activeRequest?.tierName || 'Ride'}
                      </Text>
                    </View>
                  </View>

                  <View className="mt-4 flex-row items-center gap-6">
                    <View className="flex-row items-center">
                      <Ionicons name="navigate" size={15} color="#2f73c9" />
                      <Text className="ml-1.5 text-sm font-medium text-[#5a6474]">
                        {Number(activeRequest?.driverDistanceKm || 0).toFixed(1)} km away
                      </Text>
                    </View>
                    <View className="flex-row items-center">
                      <Ionicons name="time" size={15} color="#2f73c9" />
                      <Text className="ml-1.5 text-sm font-medium text-[#5a6474]">
                        {activeRequest?.etaMinutes || 0} min away
                      </Text>
                    </View>
                  </View>
                </View>

                <View className="mt-5 rounded-[24px] border border-[#d7dfec] bg-white px-4 py-4">
                  <Text className="text-[11px] font-bold uppercase tracking-[1px] text-[#2f73c9]">Pickup</Text>
                  <Text className="mt-1 text-base font-semibold text-[#111111]">{activeRequest?.pickup}</Text>
                  <Text className="mt-4 text-[11px] font-bold uppercase tracking-[1px] text-[#5a6474]">Drop-off</Text>
                  <Text className="mt-1 text-base font-semibold text-[#111111]">{activeRequest?.dropoff}</Text>
                </View>

                <TouchableOpacity
                  onPress={() => handleAcceptRequest(activeRequest)}
                  disabled={acceptingRideId === activeRequest?.id}
                  className="mt-6 h-14 items-center justify-center rounded-[20px] bg-[#2f73c9]"
                >
                  {acceptingRideId === activeRequest?.id ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text className="text-base font-bold uppercase text-white">Accept ride</Text>
                  )}
                </TouchableOpacity>

                <View className="mt-3 flex-row items-center gap-3">
                  <TouchableOpacity
                    onPress={() => handleDeclineRequest(activeRequest)}
                    className="h-14 flex-1 items-center justify-center rounded-[18px] border border-[#d7d9df] bg-white"
                  >
                    <Text className="text-sm font-bold uppercase text-[#5d6470]">Decline</Text>
                  </TouchableOpacity>
                  {availableRequests.length > 1 ? (
                    <TouchableOpacity
                      onPress={() => setShowIncomingRideOverlay(false)}
                      className="h-14 flex-1 items-center justify-center rounded-[18px] bg-[#eef2ff]"
                    >
                      <Text className="text-sm font-bold uppercase text-[#2f73c9]">View queue</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
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

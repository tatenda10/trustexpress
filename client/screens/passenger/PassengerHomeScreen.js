import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useIsFocused } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { PRIMARY_BLUE } from '../../constants/colors';
import { getDirectionsRoute, getNearbyPassengerDrivers, getPassengerCurrentRide, getPassengerRideHistory } from '../../api';

const HARARE_FALLBACK = {
  latitude: -20.1535,
  longitude: 28.5870,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};

const ZIMBABWE_BOUNDS = {
  minLatitude: -22.5,
  maxLatitude: -15.3,
  minLongitude: 25.0,
  maxLongitude: 33.2,
};

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

function getDirectionsApiKey() {
  return (
    Constants.expoConfig?.extra?.googleMapsDirectionsApiKey ||
    Constants.expoConfig?.android?.config?.googleMaps?.apiKey ||
    Constants.expoConfig?.ios?.config?.googleMapsApiKey ||
    ''
  );
}

function generatePlacesSessionToken() {
  return `trustcars-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const ZIMBABWE_CITY_TERMS = [
  'harare',
  'bulawayo',
  'mutare',
  'gweru',
  'masvingo',
  'chinhoyi',
  'bindura',
  'kadoma',
  'kariba',
  'hwange',
  'beitbridge',
  'victoria falls',
  'marondera',
  'rusape',
  'redcliff',
  'chegutu',
  'kwekwe',
  'plumtree',
];

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeSpecificStreetAddress(query) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return false;
  const startsWithNumber = /^\d+[a-z]?\s+/i.test(normalized);
  const hasStreetTerm = /\b(road|rd|street|st|avenue|ave|drive|dr|close|crescent|way|lane|ln)\b/i.test(normalized);
  return startsWithNumber && hasStreetTerm;
}

function getLocationTerms(locationContext) {
  return [
    locationContext?.district,
    locationContext?.city,
    locationContext?.region,
  ]
    .map((item) => normalizeSearchText(item))
    .filter(Boolean);
}

function extractMentionedZimbabweCities(query) {
  const normalized = normalizeSearchText(query);
  return ZIMBABWE_CITY_TERMS.filter((city) => normalized.includes(city));
}

function isExplicitIntercityQuery(query, locationContext) {
  const mentionedCities = extractMentionedZimbabweCities(query);
  if (!mentionedCities.length) return false;
  const localTerms = getLocationTerms(locationContext);
  return mentionedCities.some((city) => !localTerms.some((term) => term.includes(city) || city.includes(term)));
}

function rankAutocompletePredictions(predictions, query, locationContext, broadSearch) {
  const normalizedQuery = normalizeSearchText(query);
  const localTerms = getLocationTerms(locationContext);

  return (predictions || [])
    .map((prediction, index) => {
      const mainText = normalizeSearchText(prediction.structured_formatting?.main_text || prediction.description || '');
      const secondaryText = normalizeSearchText(prediction.structured_formatting?.secondary_text || prediction.description || '');
      let score = 0;

      if (mainText.startsWith(normalizedQuery)) score += 8;
      if (mainText.includes(normalizedQuery)) score += 5;
      if (secondaryText.includes(normalizedQuery)) score += 2;

      if (!broadSearch && localTerms.length) {
        if (localTerms.some((term) => secondaryText.includes(term))) score += 14;
        if (localTerms.some((term) => mainText.includes(term))) score += 6;
      }

      if (looksLikeSpecificStreetAddress(query) && /^\d+[a-z]?\s+/i.test(mainText)) {
        score += 12;
      }

      return { prediction, index, score };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.prediction);
}

async function fetchGeocodedSuggestions(query, originCoordinate, locationContext, broadSearch) {
  const apiKey = getDirectionsApiKey();
  if (!apiKey) return [];

  const normalized = String(query || '').trim();
  if (!normalized) return [];

  const geocodeQuery = `${normalized}, Zimbabwe`;

  const params = new URLSearchParams({
    address: geocodeQuery,
    key: apiKey,
    components: 'country:ZW',
  });

  const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`);
  const payload = await response.json().catch(() => ({}));
  const results = Array.isArray(payload?.results) ? payload.results : [];

  if (!response.ok || payload?.status !== 'OK' || !results.length) {
    return [];
  }

  const suggestions = await Promise.all(
    results.slice(0, 4).map(async (result, index) => {
      const coordinate = {
        latitude: result.geometry?.location?.lat,
        longitude: result.geometry?.location?.lng,
      };
      if (!Number.isFinite(coordinate.latitude) || !Number.isFinite(coordinate.longitude)) {
        return null;
      }

      const title = result.address_components?.[0]?.long_name || result.formatted_address || normalized;
      const subtitle = result.formatted_address || 'Zimbabwe';

      return {
        id: `geocode-${index}-${coordinate.latitude}-${coordinate.longitude}`,
        coordinate,
        title,
        subtitle,
        distanceKm: originCoordinate ? calculateDistanceKm(originCoordinate, coordinate) : 0,
      };
    })
  );

  return suggestions.filter(Boolean);
}

async function fetchRideRoute(token, origin, destination) {
  if (!token || !origin || !destination) {
    return { coordinates: null, distanceKm: null, durationMinutes: null };
  }

  const data = await getDirectionsRoute(token, {
    origin,
    destination,
    cacheTtlSeconds: 1800,
  });
  const route = data?.route || {};

  return {
    coordinates: Array.isArray(route.coordinates) && route.coordinates.length > 1 ? route.coordinates : null,
    distanceKm: Number(route.distanceKm || 0) > 0 ? Number(route.distanceKm) : null,
    durationMinutes: Number(route.durationMinutes || 0) > 0 ? Number(route.durationMinutes) : null,
  };
}

function buildRouteRegion(start, end) {
  if (!start && !end) return HARARE_FALLBACK;
  if (!start) return { ...end, latitudeDelta: 0.08, longitudeDelta: 0.08 };
  if (!end) return { ...start, latitudeDelta: 0.08, longitudeDelta: 0.08 };

  return {
    latitude: (start.latitude + end.latitude) / 2,
    longitude: (start.longitude + end.longitude) / 2,
    latitudeDelta: Math.max(Math.abs(start.latitude - end.latitude) * 1.8, 0.05),
    longitudeDelta: Math.max(Math.abs(start.longitude - end.longitude) * 1.8, 0.05),
  };
}

function isWithinZimbabwe(coordinate) {
  if (!coordinate) return false;
  return (
    coordinate.latitude >= ZIMBABWE_BOUNDS.minLatitude &&
    coordinate.latitude <= ZIMBABWE_BOUNDS.maxLatitude &&
    coordinate.longitude >= ZIMBABWE_BOUNDS.minLongitude &&
    coordinate.longitude <= ZIMBABWE_BOUNDS.maxLongitude
  );
}

function dedupeCoordinates(results) {
  const seen = new Set();
  return results.filter((item) => {
    const key = `${item.latitude.toFixed(5)}:${item.longitude.toFixed(5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatCoordinateLabel(prefix, coordinate) {
  if (!coordinate) return prefix;
  return `${prefix} (${coordinate.latitude.toFixed(4)}, ${coordinate.longitude.toFixed(4)})`;
}

function areCoordinatesClose(left, right) {
  if (!left || !right) return false;
  return (
    Math.abs(Number(left.latitude) - Number(right.latitude)) < 0.0002 &&
    Math.abs(Number(left.longitude) - Number(right.longitude)) < 0.0002
  );
}

function stripRoutePrefix(label) {
  return String(label || '')
    .replace(/^Pickup:\s*/i, '')
    .replace(/^Drop-?off:\s*/i, '')
    .trim();
}

function toRideCoordinate(ride) {
  const nested = ride?.dropoffCoordinate;
  if (nested && Number.isFinite(Number(nested.latitude)) && Number.isFinite(Number(nested.longitude))) {
    return {
      latitude: Number(nested.latitude),
      longitude: Number(nested.longitude),
    };
  }

  const latitude = Number(
    ride?.dropoff_lat ??
    ride?.dropoffLatitude ??
    ride?.dropoff_latitude ??
    ride?.dropoffLat
  );
  const longitude = Number(
    ride?.dropoff_lng ??
    ride?.dropoffLongitude ??
    ride?.dropoff_longitude ??
    ride?.dropoffLng
  );

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { latitude, longitude };
  }
  return null;
}

function looksLikePlusCode(value) {
  const text = String(value || '').trim();
  // Basic Plus Code pattern like "428R+4V9" or "GF7V+23"
  if (!text || !text.includes('+')) return false;
  return /^[0-9A-Z]{4,}\+[0-9A-Z]{2,}$/i.test(text.replace(/\s+/g, ''));
}

async function getReadableLocationLabel(prefix, coordinate) {
  try {
    const places = await Location.reverseGeocodeAsync(coordinate);
    const place = places?.[0];
    if (!place) return formatCoordinateLabel(prefix, coordinate);

    const safeName = looksLikePlusCode(place.name) ? null : place.name;
    const parts = [safeName, place.street, place.district, place.city].filter(Boolean);
    return parts.length ? `${prefix}: ${parts.slice(0, 2).join(', ')}` : formatCoordinateLabel(prefix, coordinate);
  } catch (error) {
    return formatCoordinateLabel(prefix, coordinate);
  }
}

async function getLocationContext(coordinate) {
  try {
    const places = await Location.reverseGeocodeAsync(coordinate);
    const place = places?.[0];
    if (!place) return null;

    return {
      district: place.district || null,
      city: place.city || null,
      region: place.region || null,
      country: place.country || 'Zimbabwe',
    };
  } catch (error) {
    return null;
  }
}

async function buildSuggestion(query, item, originCoordinate) {
  const coordinate = {
    latitude: item.latitude,
    longitude: item.longitude,
  };
  let title = query;
  let subtitle = `${coordinate.latitude.toFixed(4)}, ${coordinate.longitude.toFixed(4)}`;

  try {
    const places = await Location.reverseGeocodeAsync(coordinate);
    const place = places?.[0];
    if (place) {
      const safeName = looksLikePlusCode(place.name) ? null : place.name;

      const first =
        [place.street, safeName]
          .filter(Boolean)
          .join(', ') ||
        [safeName, place.district].filter(Boolean).join(', ');

      const second = [place.district, place.city, place.region]
        .filter(Boolean)
        .join(', ');
      if (first) title = first;
      if (second) subtitle = second;
    }
  } catch (error) {
    // fall back to coordinates
  }

  return {
    id: `${coordinate.latitude}-${coordinate.longitude}-${title}`,
    coordinate,
    title,
    subtitle,
    distanceKm: originCoordinate ? calculateDistanceKm(originCoordinate, coordinate) : 0,
  };
}

async function fetchGooglePlaceDetails(placeId, sessionToken) {
  const apiKey = getDirectionsApiKey();
  if (!apiKey || !placeId) return null;

  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'geometry/location,formatted_address,name,address_component',
    key: apiKey,
  });

  if (sessionToken) {
    params.append('sessiontoken', sessionToken);
  }

  const response = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`);
  const payload = await response.json().catch(() => ({}));
  const result = payload?.result;
  const location = result?.geometry?.location;

  if (!response.ok || payload?.status !== 'OK' || !location) {
    return null;
  }

  const coordinate = {
    latitude: location.lat,
    longitude: location.lng,
  };

  const components = Array.isArray(result.address_components) ? result.address_components : [];
  const district = components.find((item) => item.types?.includes('sublocality') || item.types?.includes('locality'))?.long_name;
  const city = components.find((item) => item.types?.includes('administrative_area_level_2') || item.types?.includes('locality'))?.long_name;
  const region = components.find((item) => item.types?.includes('administrative_area_level_1'))?.long_name;

  return {
    coordinate,
    title: result?.name || result?.formatted_address || 'Selected place',
    subtitle: result?.formatted_address || '',
    context: {
      district: district || null,
      city: city || null,
      region: region || null,
      country: 'Zimbabwe',
    },
  };
}

async function hydrateSuggestionDistances(items, originCoordinate) {
  if (!Array.isArray(items) || items.length === 0) {
    return items || [];
  }

  const hydrated = await Promise.all(
    items.map(async (item) => {
      if (item.coordinate) {
        return item;
      }
      return {
        ...item,
        distanceKm: originCoordinate ? calculateDistanceKm(originCoordinate, item.coordinate) : 0,
      };
    })
  );

  return hydrated.sort((a, b) => (a.distanceKm || Number.MAX_SAFE_INTEGER) - (b.distanceKm || Number.MAX_SAFE_INTEGER));
}

async function searchZimbabweFirst(query, locationContext, originCoordinate, sessionToken) {
  const normalized = query.trim();
  if (!normalized) return [];

  try {
    const apiKey = getDirectionsApiKey();
    if (!apiKey) return [];
    const broadSearch = isExplicitIntercityQuery(normalized, locationContext);
    const params = new URLSearchParams({
      input: normalized,
      components: 'country:zw',
      key: apiKey,
    });

    if (originCoordinate?.latitude && originCoordinate?.longitude) {
      params.append('location', `${originCoordinate.latitude},${originCoordinate.longitude}`);
      params.append('radius', broadSearch ? '50000' : '35000');
    }

    if (sessionToken) {
      params.append('sessiontoken', sessionToken);
    }

    const response = await fetch(`https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`);
    const payload = await response.json().catch(() => ({}));
    const predictions = rankAutocompletePredictions(
      Array.isArray(payload?.predictions) ? payload.predictions : [],
      normalized,
      locationContext,
      broadSearch,
    );

    if (response.ok && predictions.length > 0) {
      const autocompleteSuggestions = predictions.slice(0, 6).map((prediction, index) => ({
        id: prediction.place_id || `${prediction.description}-${index}`,
        placeId: prediction.place_id,
        title: prediction.structured_formatting?.main_text || prediction.description || normalized,
        subtitle: prediction.structured_formatting?.secondary_text || prediction.description || 'Zimbabwe',
        coordinate: null,
        distanceKm: 0,
      }));

      return autocompleteSuggestions;
    }

    const fallbackCoords = [];
    const textSearchParams = new URLSearchParams({
      query: `${normalized}, Zimbabwe`,
      key: apiKey,
    });

    if (originCoordinate?.latitude && originCoordinate?.longitude) {
      textSearchParams.append('location', `${originCoordinate.latitude},${originCoordinate.longitude}`);
      textSearchParams.append('radius', broadSearch ? '50000' : '35000');
    }
    const textSearchResponse = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?${textSearchParams.toString()}`);
    const textSearchPayload = await textSearchResponse.json().catch(() => ({}));
    if (textSearchResponse.ok && Array.isArray(textSearchPayload.results)) {
      fallbackCoords.push(
        ...textSearchPayload.results
          .map((result) => ({
            latitude: result.geometry?.location?.lat,
            longitude: result.geometry?.location?.lng,
          }))
          .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
      );
    }

    const deduped = dedupeCoordinates(fallbackCoords);
    const inZimbabwe = deduped.filter((item) => isWithinZimbabwe(item));
    const textSuggestions = await Promise.all(
      (inZimbabwe.length ? inZimbabwe : deduped)
        .slice(0, 6)
        .map((item) => buildSuggestion(normalized, item, originCoordinate))
    );

    if (textSuggestions.length > 0) {
      return textSuggestions;
    }

    return fetchGeocodedSuggestions(normalized, originCoordinate, locationContext, broadSearch);
  } catch {
    return [];
  }
}

export default function PassengerHomeScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const isFocused = useIsFocused();
  const { getToken } = useAuth();
  const mapRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const placesSessionTokenRef = useRef(generatePlacesSessionToken());
  const resumeCheckInFlightRef = useRef(false);

  const [mapRegion, setMapRegion] = useState(HARARE_FALLBACK);
  const [currentLocationCoordinate, setCurrentLocationCoordinate] = useState(null);
  const [pickupCoordinate, setPickupCoordinate] = useState(null);
  const [dropoffCoordinate, setDropoffCoordinate] = useState(null);
  const [pickupLabel, setPickupLabel] = useState('Getting your location...');
  const [dropoffLabel, setDropoffLabel] = useState('Choose destination');
  const [pickupQuery, setPickupQuery] = useState('');
  const [destinationQuery, setDestinationQuery] = useState('');
  const [activeField, setActiveField] = useState('destination');
  const [showRouteModal, setShowRouteModal] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(true);
  const [locationError, setLocationError] = useState('');
  const [isCalculating, setIsCalculating] = useState(false);
  const [isSearchingSuggestions, setIsSearchingSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [pickupContext, setPickupContext] = useState(null);
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [routeDistanceKm, setRouteDistanceKm] = useState(null);
  const [routeDurationMinutes, setRouteDurationMinutes] = useState(null);
  const [nearbyDrivers, setNearbyDrivers] = useState([]);
  const [recentTrips, setRecentTrips] = useState([]);

  useEffect(() => {
    if (!isFocused) return undefined;
    let active = true;

    const resumeActiveRide = async () => {
      if (resumeCheckInFlightRef.current) return;
      resumeCheckInFlightRef.current = true;
      try {
        const token = await getToken();
        if (!token || !active) return;
        const data = await getPassengerCurrentRide(token);
        const ride = data?.rideRequest;
        if (!active || !ride?.id) return;

        const rideStatus = String(ride?.status || '').toLowerCase();
        if (rideStatus === 'requested' || rideStatus === 'driver_found') {
          navigation.replace('PassengerNearbyCars', {
            pickupCoordinate: ride.pickupCoordinate,
            dropoffCoordinate: ride.dropoffCoordinate,
            pickupLabel: ride.pickupLabel,
            dropoffLabel: ride.dropoffLabel,
            distanceKm: Number(ride?.estimatedDistanceKm || 0),
            estimatedMinutes: Number(ride?.estimatedMinutes || 0),
            estimatedAmount: Number(ride?.estimatedAmount || 0),
            selectedTier: ride.requestedTierKey || ride.requestedTierName
              ? {
                  tierKey: ride.requestedTierKey || '',
                  tierName: ride.requestedTierName || 'Ride',
                }
              : null,
            rideRequest: {
              ...ride,
              remainingSecondsCapturedAt: Date.now(),
            },
            nearbyDrivers: Array.isArray(data?.acceptedDrivers) ? data.acceptedDrivers : [],
          });
          return;
        }

        navigation.replace('PassengerRideTracking', {
          pickupCoordinate: ride.pickupCoordinate,
          dropoffCoordinate: ride.dropoffCoordinate,
          pickupLabel: ride.pickupLabel,
          dropoffLabel: ride.dropoffLabel,
          estimatedAmount: Number(ride.estimatedAmount || 0),
          selectedTier: ride.requestedTierKey || ride.requestedTierName
            ? {
                tierKey: ride.requestedTierKey || '',
                tierName: ride.requestedTierName || 'Ride',
              }
            : null,
          driver: data?.assignedDriver || null,
          rideRequestId: ride.id,
        });
      } catch {
        // Stay on booking home if no active ride exists.
      } finally {
        resumeCheckInFlightRef.current = false;
      }
    };

    resumeActiveRide();
    const interval = setInterval(resumeActiveRide, 5000);

    return () => {
      active = false;
      clearInterval(interval);
      resumeCheckInFlightRef.current = false;
    };
  }, [getToken, isFocused, navigation]);

  useEffect(() => {
    let active = true;

    const loadCurrentLocation = async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') throw new Error('Location permission denied');
        const current = await Location.getCurrentPositionAsync({});
        if (!active) return;

        const coordinate = {
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
        };
        const label = await getReadableLocationLabel('Pickup', coordinate);
        const context = await getLocationContext(coordinate);
        const nextRegion = buildRouteRegion(coordinate, null);

        setCurrentLocationCoordinate(coordinate);
        setPickupCoordinate(coordinate);
        setMapRegion(nextRegion);
        setPickupLabel(label);
        setPickupQuery(label.replace('Pickup: ', ''));
        setPickupContext(context);
        setLocationError('');
        setTimeout(() => {
          mapRef.current?.animateToRegion(nextRegion, 500);
        }, 50);
      } catch (error) {
        if (!active) return;
        setCurrentLocationCoordinate(null);
        setPickupCoordinate(null);
        setPickupLabel('Pickup location unavailable');
        setPickupQuery('');
        setPickupContext(null);
        setLocationError(error?.message || 'We could not detect your location.');
      } finally {
        if (active) setLoadingLocation(false);
      }
    };

    loadCurrentLocation();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!route?.params?.resetRideDraftAt) return;
    clearDestination();
  }, [route?.params?.resetRideDraftAt]);

  useEffect(() => {
    const anchor = pickupCoordinate || currentLocationCoordinate;
    if (!anchor) return undefined;
    let active = true;

    const loadNearbyDrivers = async () => {
      try {
        const token = await getToken();
        if (!token || !active) return;
        const data = await getNearbyPassengerDrivers(token, {
          latitude: anchor.latitude,
          longitude: anchor.longitude,
          radiusKm: 8,
        });
        if (!active) return;
        setNearbyDrivers(Array.isArray(data?.drivers) ? data.drivers : []);
      } catch {
        if (!active) return;
        setNearbyDrivers([]);
      }
    };

    loadNearbyDrivers();
    const interval = setInterval(loadNearbyDrivers, 5000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [currentLocationCoordinate, getToken, pickupCoordinate]);

  useEffect(() => {
    let active = true;
    const loadRecentTrips = async () => {
      try {
        const token = await getToken();
        if (!token || !active) return;
        const data = await getPassengerRideHistory(token, { page: 1, limit: 6 });
        if (!active) return;
        const rides = Array.isArray(data?.rides) ? data.rides : [];
        const deduped = [];
        const seen = new Set();
        rides.forEach((ride) => {
          const dropoffLabel = stripRoutePrefix(ride?.dropoffLabel);
          const coord = toRideCoordinate(ride);
          const key = `${dropoffLabel}:${Number(coord?.latitude || 0).toFixed(4)}:${Number(coord?.longitude || 0).toFixed(4)}`;
          if (!dropoffLabel || !coord || seen.has(key)) return;
          seen.add(key);
          deduped.push({
            id: ride.id,
            title: dropoffLabel,
            coordinate: coord,
          });
        });
        setRecentTrips(deduped.slice(0, 4));
      } catch {
        if (!active) return;
        setRecentTrips([]);
      }
    };
    loadRecentTrips();
    return () => {
      active = false;
    };
  }, [getToken]);

  // Load Google route (polyline + route-based distance/duration for pricing)
  useEffect(() => {
    if (!pickupCoordinate || !dropoffCoordinate) {
      setRouteCoordinates([]);
      setRouteDistanceKm(null);
      setRouteDurationMinutes(null);
      return undefined;
    }

    let cancelled = false;

    const loadRoute = async () => {
      try {
        const token = await getToken();
        const result = await fetchRideRoute(token, pickupCoordinate, dropoffCoordinate);
        if (cancelled) return;

        if (Array.isArray(result.coordinates) && result.coordinates.length > 1) {
          setRouteCoordinates(result.coordinates);
        } else {
          setRouteCoordinates([pickupCoordinate, dropoffCoordinate]);
        }
        setRouteDistanceKm(result.distanceKm);
        setRouteDurationMinutes(result.durationMinutes);
      } catch {
        if (cancelled) return;
        setRouteCoordinates([pickupCoordinate, dropoffCoordinate]);
        setRouteDistanceKm(null);
        setRouteDurationMinutes(null);
      }
    };

    loadRoute();

    return () => {
      cancelled = true;
    };
  }, [dropoffCoordinate, getToken, pickupCoordinate]);

  useEffect(() => {
    const query = (activeField === 'pickup' ? pickupQuery : destinationQuery).trim();
    if (!showRouteModal || query.length < 2) {
      setSuggestions([]);
      setIsSearchingSuggestions(false);
      return undefined;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearchingSuggestions(true);
      try {
        const originCoordinate = currentLocationCoordinate || pickupCoordinate;
        const results = await searchZimbabweFirst(
          query,
          pickupContext,
          originCoordinate,
          placesSessionTokenRef.current,
        );
        const hydratedResults = await hydrateSuggestionDistances(
          results,
          originCoordinate,
        );
        setSuggestions(hydratedResults);
      } catch (error) {
        setSuggestions([]);
      } finally {
        setIsSearchingSuggestions(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [activeField, currentLocationCoordinate, destinationQuery, pickupContext, pickupCoordinate, pickupQuery, showRouteModal]);

  const straightLineKm = useMemo(
    () => calculateDistanceKm(pickupCoordinate, dropoffCoordinate),
    [pickupCoordinate, dropoffCoordinate]
  );

  const distanceKm = useMemo(
    () => (routeDistanceKm != null && routeDistanceKm > 0 ? routeDistanceKm : straightLineKm),
    [routeDistanceKm, straightLineKm]
  );

  const estimatedMinutes = useMemo(
    () =>
      routeDurationMinutes != null && routeDurationMinutes > 0
        ? routeDurationMinutes
        : Math.max(4, Math.round(straightLineKm * 2.6)),
    [routeDurationMinutes, straightLineKm]
  );

  const applyPickup = async (coordinate, label) => {
    setPickupCoordinate(coordinate);
    setPickupLabel(label);
    if (!pickupQuery.trim()) setPickupQuery(label.replace('Pickup: ', ''));
    setPickupContext(await getLocationContext(coordinate));
    const nextRegion = buildRouteRegion(coordinate, dropoffCoordinate);
    setMapRegion(nextRegion);
    mapRef.current?.animateToRegion(nextRegion, 500);
  };

  const applyDestination = async (coordinate, label, closeModal = false) => {
    setDropoffCoordinate(coordinate);
    setDropoffLabel(label);
    setDestinationQuery(String(label || '').replace(/^Drop-?off:\s*/i, '').trim());
    setIsCalculating(true);
    const nextRegion = buildRouteRegion(pickupCoordinate, coordinate);
    setMapRegion(nextRegion);
    mapRef.current?.animateToRegion(nextRegion, 500);
    setTimeout(() => {
      setIsCalculating(false);
    }, 1000);
    if (closeModal) setShowRouteModal(false);
  };

  const handleMapPress = async (event) => {
    if (!showRouteModal) return;
    const coordinate = event.nativeEvent.coordinate;
    const label = await getReadableLocationLabel(activeField === 'pickup' ? 'Pickup' : 'Drop-off', coordinate);

    if (activeField === 'pickup') {
      await applyPickup(coordinate, label);
      setPickupQuery(label.replace('Pickup: ', ''));
    } else {
      await applyDestination(coordinate, label, true);
      setDestinationQuery(label.replace('Drop-off: ', ''));
    }
  };

  const handleSelectSuggestion = async (suggestion) => {
    let resolvedSuggestion = suggestion;

    if (!resolvedSuggestion.coordinate && resolvedSuggestion.placeId) {
      const details = await fetchGooglePlaceDetails(
        resolvedSuggestion.placeId,
        placesSessionTokenRef.current,
      );

      if (!details?.coordinate) {
        Alert.alert('Location unavailable', 'We could not load that place. Please try another result.');
        return;
      }

        resolvedSuggestion = {
          ...resolvedSuggestion,
          coordinate: details.coordinate,
          title: details.title || resolvedSuggestion.title,
          subtitle: details.subtitle || resolvedSuggestion.subtitle,
          distanceKm: currentLocationCoordinate
            ? calculateDistanceKm(currentLocationCoordinate, details.coordinate)
            : pickupCoordinate
              ? calculateDistanceKm(pickupCoordinate, details.coordinate)
              : 0,
        };
      }

    if (!resolvedSuggestion.coordinate) {
      Alert.alert('Location unavailable', 'We could not load that place. Please try another result.');
      return;
    }

    if (activeField === 'pickup') {
      await applyPickup(resolvedSuggestion.coordinate, `Pickup: ${resolvedSuggestion.title}`);
      setPickupQuery(resolvedSuggestion.title);
    } else {
      await applyDestination(resolvedSuggestion.coordinate, `Drop-off: ${resolvedSuggestion.title}`, true);
      setDestinationQuery(resolvedSuggestion.title);
    }
    setSuggestions([]);
    placesSessionTokenRef.current = generatePlacesSessionToken();
  };

  const openRouteModal = () => {
    setActiveField('destination');
    placesSessionTokenRef.current = generatePlacesSessionToken();
    setShowRouteModal(true);
  };

  const clearDestination = () => {
    setDropoffCoordinate(null);
    setDropoffLabel('Choose destination');
    setDestinationQuery('');
    setRouteCoordinates([]);
    setRouteDistanceKm(null);
    setRouteDurationMinutes(null);
    const nextRegion = buildRouteRegion(pickupCoordinate, null);
    setMapRegion(nextRegion);
    mapRef.current?.animateToRegion(nextRegion, 400);
  };

  const openChooseRideScreen = () => {
    if (!pickupCoordinate || !dropoffCoordinate) {
      Alert.alert('Missing route', 'Set your pickup and destination first.');
      return;
    }

    navigation.navigate('PassengerChooseRide', {
      pickupCoordinate,
      dropoffCoordinate,
      pickupLabel,
      dropoffLabel,
      routeCoordinates,
      distanceKm,
      estimatedMinutes,
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'left', 'right']}>
      <View className="flex-1 bg-[#eef4ff]">
        <MapView
          ref={mapRef}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          initialRegion={mapRegion}
          onRegionChangeComplete={(region) => setMapRegion(region)}
          onPress={handleMapPress}
          showsCompass={false}
          toolbarEnabled={false}
          scrollEnabled
          zoomEnabled
          rotateEnabled={false}
          pitchEnabled={false}
          showsUserLocation={!!currentLocationCoordinate}
        >
          {currentLocationCoordinate ? (
            <Marker coordinate={currentLocationCoordinate} title="Your location">
              <View className="items-center">
                <View className="h-10 w-10 items-center justify-center rounded-full border-2 border-white bg-[#2563eb]">
                  <Ionicons name="locate" size={18} color="#fff" />
                </View>
              </View>
            </Marker>
          ) : null}
          {nearbyDrivers.map((driver) => (
            <Marker
              key={driver.id}
              coordinate={driver.coordinate}
              title={driver.carName || 'Nearby car'}
              description={driver.tierName || 'Nearby driver'}
            >
              <View className="items-center">
                <View className="h-11 w-11 items-center justify-center rounded-full border-2 border-white bg-[#111827]">
                  <Ionicons name="car" size={20} color="#fff" />
                </View>
              </View>
            </Marker>
          ))}
          {pickupCoordinate && !areCoordinatesClose(pickupCoordinate, currentLocationCoordinate) ? (
            <Marker coordinate={pickupCoordinate} title="Pickup" pinColor={PRIMARY_BLUE} />
          ) : null}
          {dropoffCoordinate ? <Marker coordinate={dropoffCoordinate} title="Drop-off" pinColor="#111827" /> : null}
          {pickupCoordinate && dropoffCoordinate ? (
            routeCoordinates.length > 1 ? (
              <>
                <Polyline
                  coordinates={routeCoordinates}
                  strokeColor="rgba(37,99,235,0.22)"
                  strokeWidth={10}
                />
                <Polyline
                  coordinates={routeCoordinates}
                  strokeColor={PRIMARY_BLUE}
                  strokeWidth={5}
                />
              </>
            ) : (
              <Polyline
                coordinates={[pickupCoordinate, dropoffCoordinate]}
                strokeColor={PRIMARY_BLUE}
                strokeWidth={5}
              />
            )
          ) : null}
        </MapView>

        <View pointerEvents="none" className="absolute inset-0 bg-black/25" />

        <View style={{ paddingTop: insets.top + 10 }} className="px-5">
          {dropoffCoordinate ? (
            <View className="rounded-[28px] bg-white/95 px-4 py-4">
              <View className="flex-row items-start">
                <View className="mr-3 items-center pt-1">
                  <View className="h-4 w-4 rounded-full border-[4px] border-green-600" />
                  <View className="my-1 h-10 w-0.5 bg-gray-300" />
                  <View className="h-4 w-4 rounded-full border-[4px]" style={{ borderColor: PRIMARY_BLUE }} />
                </View>
                <View className="flex-1">
                  <Text className="text-lg font-bold text-gray-900">{pickupLabel.replace('Pickup: ', '')}</Text>
                  <Text className="mt-1 text-base text-gray-700">{dropoffLabel.replace('Drop-off: ', '')}</Text>
                  <Text className="mt-1 text-sm text-gray-500">{estimatedMinutes} min</Text>
                </View>
                <TouchableOpacity
                  onPress={openRouteModal}
                  className="ml-3 h-12 w-12 items-center justify-center rounded-full bg-[#f3f6fb]"
                >
                  <Ionicons name="pencil" size={20} color="#111827" />
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View className="self-end rounded-2xl bg-white/95 px-4 py-3">
              <Text className="text-sm font-medium text-gray-500">Pickup point</Text>
              <Text className="text-lg font-bold text-gray-900">{pickupLabel.replace('Pickup: ', '')}</Text>
            </View>
          )}
        </View>

        <View
          className="mt-auto rounded-t-[32px] bg-[#f8f8f6] px-5 pt-4"
          style={{ marginBottom: tabBarHeight + 40, minHeight: dropoffCoordinate ? 250 : 320 }}
        >
          <View className="items-center">
            <View className="h-2 w-16 rounded-full bg-gray-300" />
          </View>

          <TouchableOpacity
            onPress={openRouteModal}
            activeOpacity={0.9}
            className="mt-4 rounded-[24px] bg-white px-4 py-4"
          >
            <View className="mt-2 flex-row items-center">
              <Ionicons name="search" size={20} color="#111827" />
              <Text
                numberOfLines={1}
                className={`ml-3 flex-1 text-[18px] font-semibold ${dropoffCoordinate ? 'text-gray-950' : 'text-gray-400'}`}
              >
                {dropoffCoordinate ? dropoffLabel.replace('Drop-off: ', '') : 'Where to?'}
              </Text>
              {dropoffCoordinate ? (
                <TouchableOpacity
                  onPress={clearDestination}
                  className="h-8 w-8 items-center justify-center rounded-full bg-[#f3f4f6]"
                >
                  <Ionicons name="close" size={18} color="#111827" />
                </TouchableOpacity>
              ) : null}
            </View>
          </TouchableOpacity>

          {dropoffCoordinate ? (
            <View className="mt-4 pb-5">
              <View className="rounded-[22px] bg-white px-4 py-4">
                <Text className="text-sm font-medium text-gray-400">Trip preview</Text>
                <Text className="mt-1 text-base font-semibold text-gray-900">
                  {distanceKm.toFixed(1)} km • {estimatedMinutes} min away
                </Text>
              </View>
              <TouchableOpacity
                onPress={openChooseRideScreen}
                disabled={loadingLocation || isCalculating}
                className="mt-4 h-16 items-center justify-center rounded-[22px]"
                style={{ backgroundColor: loadingLocation || isCalculating ? '#93c5fd' : PRIMARY_BLUE }}
              >
                {isCalculating ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text className="text-lg font-bold text-white">Choose ride</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <View className="pb-5">
              {recentTrips.length ? (
                <View className="mt-4 rounded-[20px] bg-white px-4 py-4">
                  <Text className="text-sm font-semibold text-gray-700">Recent trips</Text>
                  <View className="mt-3 flex-row flex-wrap gap-2">
                    {recentTrips.map((trip) => (
                      <TouchableOpacity
                        key={trip.id}
                        onPress={() => applyDestination(trip.coordinate, `Drop-off: ${trip.title}`)}
                        className="rounded-full bg-[#eef5ff] px-3 py-2"
                      >
                        <Text className="text-xs font-semibold" style={{ color: PRIMARY_BLUE }}>
                          {trip.title}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ) : null}
              {locationError ? (
                <View className="mt-4 rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3">
                  <Text className="text-sm font-semibold text-amber-900">Location unavailable</Text>
                  <Text className="mt-1 text-sm text-amber-800">
                    Enable location and retry, or set your pickup manually from the route sheet.
                  </Text>
                </View>
              ) : null}
            </View>
          )}
        </View>

        {false ? (
        <View
          className="mt-auto rounded-t-[32px] bg-[#f8f8f6] px-0 pt-3"
          style={{ display: 'none', marginBottom: tabBarHeight + 52, minHeight: dropoffCoordinate ? 540 : 250 }}
        >
          <View className="items-center">
            <View className="h-2 w-16 rounded-full bg-gray-300" />
          </View>

          {dropoffCoordinate ? (
            <>
              <View className="mt-3 border-b border-gray-200 px-5 pb-4">
                <View className="relative items-center justify-center">
                  <Text className="text-[18px] font-bold text-gray-950">Choose a ride</Text>
                  <TouchableOpacity
                    onPress={clearDestination}
                    className="absolute right-0 h-9 w-9 items-center justify-center rounded-full bg-white"
                  >
                    <Ionicons name="close" size={18} color="#111827" />
                  </TouchableOpacity>
                </View>
              </View>

              <View className="px-5 pt-4">
                <TouchableOpacity
                  onPress={openRouteModal}
                  activeOpacity={0.85}
                  className="rounded-[20px] bg-white px-4 py-4"
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1 pr-4">
                      <Text className="text-sm font-medium text-gray-400">Drop-off</Text>
                      <Text numberOfLines={1} className="mt-1 text-[18px] font-semibold text-gray-950">
                        {dropoffLabel.replace('Drop-off: ', '')}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#111827" />
                  </View>
                </TouchableOpacity>
              </View>

              <View className="mt-3 px-5 rounded-[24px] bg-white py-4">
                <View className="flex-row items-center justify-between">
                  <View className="flex-1 pr-4">
                    <Text className="text-sm font-semibold uppercase tracking-[1px] text-gray-400">Trip</Text>
                    <Text className="mt-1 text-base font-semibold text-gray-900">
                      {distanceKm.toFixed(1)} km • {estimatedMinutes} min away
                    </Text>
                  </View>
                  <Text className="text-[28px] font-bold text-gray-950">${estimatedAmount.toFixed(2)}</Text>
                </View>
              </View>

              <View className="mt-4 flex-1 px-5">
                {loadingTiers ? (
                  <View className="rounded-[24px] bg-white px-4 py-5">
                    <ActivityIndicator size="small" color={PRIMARY_BLUE} />
                  </View>
                ) : tiersError ? (
                  <View className="rounded-[24px] bg-white px-4 py-5">
                    <Text className="text-base font-semibold text-gray-900">Ride tiers unavailable</Text>
                    <Text className="mt-2 text-sm text-gray-500">{tiersError}</Text>
                    <TouchableOpacity
                      onPress={() => {
                        setLoadingTiers(true);
                        setTiersError('');
                        setTiers([]);                        
                        setSelectedTierKey('');
                        const rerun = async () => {
                          let token = null;
                          for (let attempt = 0; attempt < 3; attempt += 1) {
                            token = await getToken();
                            if (token) break;
                            await new Promise((resolve) => setTimeout(resolve, 450));
                          }
                          if (!token) throw new Error('We are still finishing your sign-in. Please wait a moment and try again.');
                          const data = await getPassengerRideOptions(token);
                          const nextTiers = Array.isArray(data?.tiers) ? data.tiers : [];
                          setTiers(nextTiers);
                          setSelectedTierKey(nextTiers[0]?.tierKey || '');
                          setTiersError(nextTiers.length === 0 ? 'No ride tiers are configured yet. Please ask the admin to add pricing tiers.' : '');
                        };
                        rerun()
                          .catch((error) => setTiersError(error?.message || 'Could not load ride tiers right now.'))
                          .finally(() => setLoadingTiers(false));
                      }}
                      className="mt-4 self-start rounded-full bg-[#eef5ff] px-4 py-2"
                    >
                      <Text style={{ color: PRIMARY_BLUE }} className="text-sm font-semibold">Try again</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <ScrollView
                    style={{ maxHeight: 280 }}
                    contentContainerStyle={{ paddingBottom: 8 }}
                    showsVerticalScrollIndicator={false}
                  >
                    {tiers.map((tier) => {
                      const selected = selectedTierKey === tier.tierKey;
                      const tierAmount = Math.ceil(
                        Math.max(
                          Number(tier.baseFare || 0) + (distanceKm * Number(tier.pricePerKm || 0)),
                          Number(tier.minimumFare || 0),
                        ),
                      );

                      return (
                        <TouchableOpacity
                          key={tier.tierKey}
                          onPress={() => setSelectedTierKey(tier.tierKey)}
                          className="mb-3 rounded-[24px] bg-white px-4 py-4"
                          style={{ borderWidth: selected ? 2 : 1, borderColor: selected ? '#111827' : '#e5e7eb' }}
                        >
                          <View className="flex-row items-center">
                            <View className={`h-14 w-14 items-center justify-center rounded-[18px] ${selected ? 'bg-black' : 'bg-[#f3f4f6]'}`}>
                              <Ionicons name={tier.tierKey?.toLowerCase().includes('lux') || tier.tierName?.toLowerCase().includes('lux') ? 'diamond-outline' : tier.tierKey?.toLowerCase().includes('xl') ? 'car-sport-outline' : 'car-outline'} size={24} color={selected ? '#fff' : '#111827'} />
                            </View>
                            <View className="ml-4 flex-1 pr-3">
                              <Text className="text-[22px] font-bold text-gray-950">{tier.tierName}</Text>
                              <Text className="mt-1 text-sm text-gray-500">
                                {estimatedMinutes} min away • {tier.regionName || 'Available now'}
                              </Text>
                            </View>
                            <Text className="text-[22px] font-bold text-gray-950">${tierAmount.toFixed(2)}</Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
              </View>

              <View className="border-t border-gray-200 px-5 pb-6 pt-4">
                <TouchableOpacity
                  onPress={handleFindRide}
                  disabled={loadingLocation || loadingTiers || isCalculating || isSubmittingRide || tiers.length === 0}
                  className="h-16 items-center justify-center rounded-[22px]"
                  style={{ backgroundColor: loadingLocation || loadingTiers || isCalculating || isSubmittingRide || tiers.length === 0 ? '#93c5fd' : '#111827' }}
                >
                  {isCalculating || isSubmittingRide ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text className="text-xl font-bold text-white">
                      {selectedTier ? `Choose ${selectedTier.tierName}` : 'Find a driver'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          ) : null}
        </View>
        ) : null}

        <Modal visible={showRouteModal} animationType="slide" transparent onRequestClose={() => setShowRouteModal(false)}>
          <SafeAreaView className="flex-1 bg-black/20">
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              className="flex-1 justify-start"
            >
              <View
                className="flex-1 rounded-t-[32px] bg-[#f5f7fb] px-5"
                style={{
                  paddingTop: insets.top + 12,
                  paddingBottom: Math.max(insets.bottom + 24, 36),
                }}
              >
                <View className="items-center">
                  <View className="h-2 w-16 rounded-full bg-gray-300" />
                </View>

                <View className="mt-4 flex-row items-center justify-between">
                  <Text className="text-2xl font-bold text-gray-900">Enter your route</Text>
                  <TouchableOpacity
                    onPress={() => setShowRouteModal(false)}
                    className="h-12 w-12 items-center justify-center rounded-full bg-[#ececf1]"
                  >
                    <Ionicons name="close" size={24} color="#111827" />
                  </TouchableOpacity>
                </View>

                <View
                  className="mt-5 rounded-[22px] bg-[#eef5ff] px-4 py-3"
                  style={{ borderWidth: 1, borderColor: '#bfdbfe' }}
                >
                  <View className="flex-row items-center">
                    <View className="h-4 w-4 rounded-full border-[4px] border-green-600" />
                    <View className="ml-4 flex-1">
                      <Text className="text-sm text-gray-500">From</Text>
                      <TextInput
                        className="mt-1 text-xl text-gray-900"
                        placeholder="Pickup location"
                        value={pickupQuery}
                        onFocus={() => setActiveField('pickup')}
                        onChangeText={setPickupQuery}
                        returnKeyType="search"
                      />
                    </View>
                  </View>
                </View>

                <View
                  className="mt-3 rounded-[22px] bg-white px-4 py-3"
                  style={{ borderWidth: 1, borderColor: '#bfdbfe' }}
                >
                  <View className="flex-row items-center">
                    <Ionicons name="search" size={22} color="#111827" />
                    <View className="ml-4 flex-1">
                      <Text className="text-sm text-gray-500">To</Text>
                      <TextInput
                        className="mt-1 text-xl text-gray-900"
                        placeholder="Search destination"
                        value={destinationQuery}
                        onFocus={() => setActiveField('destination')}
                        onChangeText={setDestinationQuery}
                        returnKeyType="search"
                      />
                    </View>
                    {(activeField === 'pickup' ? pickupQuery : destinationQuery) ? (
                      <TouchableOpacity
                        onPress={() => {
                          if (activeField === 'pickup') setPickupQuery('');
                          else setDestinationQuery('');
                          setSuggestions([]);
                        }}
                      >
                        <Ionicons name="close-circle" size={26} color="#6b7280" />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>

                <KeyboardAwareScrollView
                  bottomOffset={24}
                  className="mt-4 flex-1"
                  contentContainerStyle={{ paddingBottom: 32 }}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  style={{ maxHeight: 520 }}
                >
                  {activeField === 'pickup' && pickupCoordinate ? (
                    <TouchableOpacity
                      onPress={async () => {
                        if (!pickupCoordinate) return;
                        await applyPickup(pickupCoordinate, pickupLabel);
                        setPickupQuery(pickupLabel.replace('Pickup: ', ''));
                        setSuggestions([]);
                      }}
                      className="mb-3 rounded-[22px] bg-white px-4 py-4"
                    >
                      <View className="flex-row items-start">
                        <Ionicons name="locate" size={24} color="#16a34a" />
                        <View className="ml-3 flex-1 pr-3">
                          <Text className="text-lg font-bold text-gray-900">Use current pickup</Text>
                          <Text className="mt-1 text-sm text-gray-500">{pickupLabel.replace('Pickup: ', '')}</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  ) : null}

                  {isSearchingSuggestions ? (
                    <View className="rounded-[22px] bg-white px-4 py-5">
                      <ActivityIndicator size="small" color={PRIMARY_BLUE} />
                    </View>
                  ) : !suggestions.length && (activeField === 'pickup' ? pickupQuery : destinationQuery).trim().length >= 2 ? (
                    <View className="rounded-[22px] bg-white px-4 py-5">
                      <Text className="text-base font-semibold text-gray-900">No matching places yet</Text>
                      <Text className="mt-2 text-sm text-gray-500">
                        Try a street, suburb, landmark, or business name the way you would search in Google Maps.
                      </Text>
                    </View>
                  ) : (
                    suggestions.map((suggestion) => (
                      <TouchableOpacity
                        key={suggestion.id}
                        onPress={() => handleSelectSuggestion(suggestion)}
                        className="mb-3 rounded-[22px] bg-white px-4 py-4"
                      >
                        <View className="flex-row items-start">
                          <Ionicons
                            name={activeField === 'pickup' ? 'ellipse-outline' : 'location-outline'}
                            size={24}
                            color={activeField === 'pickup' ? '#16a34a' : '#6b7280'}
                          />
                          <View className="ml-3 flex-1 pr-3">
                            <Text className="text-lg font-bold text-gray-900">{suggestion.title}</Text>
                            <Text className="mt-1 text-sm text-gray-500">{suggestion.subtitle}</Text>
                          </View>
                          <Text className="text-base text-gray-500">{suggestion.distanceKm.toFixed(1)} km</Text>
                        </View>
                      </TouchableOpacity>
                    ))
                  )}
                </KeyboardAwareScrollView>
              </View>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

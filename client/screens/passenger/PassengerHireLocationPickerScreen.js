import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import MapView, { Marker } from '../../components/maps/MapViewCompat';
import {
  BULAWAYO_DEFAULT_REGION,
  BULAWAYO_GEO_LOCK_ENABLED,
  BULAWAYO_SERVICE_BOUNDS_ARRAY,
  filterBulawayoSuggestions,
  isCoordinateInBulawayoServiceArea,
} from '../../constants/serviceArea';
import { getPlaceAutocomplete, getPlaceDetails } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

function sessionToken() {
  return `hire-loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function suggestionTitle(item) {
  return String(item?.title || item?.label || item?.description || item?.name || 'Place').trim();
}

function suggestionSubtitle(item) {
  return String(item?.subtitle || item?.secondaryText || item?.description || '').trim();
}

export default function PassengerHireLocationPickerScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { getToken } = useAuth();
  const field = route?.params?.field === 'dropoff' ? 'dropoff' : 'pickup';
  const initialCoordinate = route?.params?.coordinate || null;
  const initialLabel = String(route?.params?.label || '').trim();

  const mapRef = useRef(null);
  const placesSessionTokenRef = useRef(sessionToken());
  const searchTimerRef = useRef(null);
  const markerTracksRef = useRef(true);

  const [query, setQuery] = useState(initialLabel);
  const [manualLabel, setManualLabel] = useState(initialLabel);
  const [coordinate, setCoordinate] = useState(initialCoordinate);
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [mode, setMode] = useState('search'); // search | manual
  const [markerTracks, setMarkerTracks] = useState(true);

  const title = field === 'pickup' ? 'Start point' : 'End point';
  const pinColor = field === 'pickup' ? '#16a34a' : PRIMARY_BLUE;

  useEffect(() => {
    if (!coordinate) return;
    markerTracksRef.current = true;
    setMarkerTracks(true);
    mapRef.current?.animateToRegion?.(
      {
        latitude: Number(coordinate.latitude),
        longitude: Number(coordinate.longitude),
        latitudeDelta: 0.035,
        longitudeDelta: 0.035,
      },
      280
    );
    const timer = setTimeout(() => {
      markerTracksRef.current = false;
      setMarkerTracks(false);
    }, 800);
    return () => clearTimeout(timer);
  }, [coordinate]);

  const runSearch = useCallback(async (value) => {
    const normalized = String(value || '').trim();
    if (normalized.length < 3) {
      setSuggestions([]);
      return;
    }
    try {
      setSearching(true);
      const token = await getToken({ skipCache: true });
      if (!token) {
        setSuggestions([]);
        return;
      }
      const data = await getPlaceAutocomplete(token, {
        query: normalized,
        originCoordinate: coordinate || BULAWAYO_DEFAULT_REGION,
        sessionToken: placesSessionTokenRef.current,
      });
      const raw = Array.isArray(data?.suggestions) ? data.suggestions : [];
      setSuggestions(filterBulawayoSuggestions(raw));
    } catch {
      setSuggestions([]);
    } finally {
      setSearching(false);
    }
  }, [coordinate, getToken]);

  const onChangeQuery = (value) => {
    setQuery(value);
    setManualLabel(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => runSearch(value), 350);
  };

  const applySuggestion = async (suggestion) => {
    try {
      setResolving(true);
      const token = await getToken({ skipCache: true });
      let nextCoordinate = suggestion?.coordinate || null;
      let nextLabel = suggestionTitle(suggestion);

      if (!nextCoordinate && suggestion?.placeId) {
        const details = await getPlaceDetails(token, {
          placeId: suggestion.placeId,
          sessionToken: placesSessionTokenRef.current,
        });
        const place = details?.place || details;
        nextCoordinate = place?.coordinate || null;
        nextLabel = place?.title || place?.label || nextLabel;
      }

      if (!nextCoordinate) {
        Alert.alert('Location unavailable', 'Could not resolve that place. Tap the map instead.');
        return;
      }
      if (!isCoordinateInBulawayoServiceArea(nextCoordinate)) {
        Alert.alert('Outside Bulawayo', 'Please choose a location inside the Bulawayo service area.');
        return;
      }

      setCoordinate({
        latitude: Number(nextCoordinate.latitude),
        longitude: Number(nextCoordinate.longitude),
      });
      setQuery(nextLabel);
      setManualLabel(nextLabel);
      setSuggestions([]);
      placesSessionTokenRef.current = sessionToken();
    } catch (err) {
      Alert.alert('Location error', err?.message || 'Could not load that place.');
    } finally {
      setResolving(false);
    }
  };

  const onMapPress = (event) => {
    const next = event?.nativeEvent?.coordinate;
    if (!next) return;
    if (!isCoordinateInBulawayoServiceArea(next)) {
      Alert.alert('Outside Bulawayo', 'Please choose a location inside the Bulawayo service area.');
      return;
    }
    const point = {
      latitude: Number(next.latitude),
      longitude: Number(next.longitude),
    };
    setCoordinate(point);
    setSuggestions([]);
    const label = `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
    setQuery((current) => (current.trim() ? current : label));
    setManualLabel((current) => (current.trim() ? current : label));
  };

  const confirm = () => {
    const label = String(manualLabel || query).trim();
    if (!label) {
      Alert.alert('Label required', 'Enter a place name or address.');
      return;
    }
    if (!coordinate) {
      Alert.alert('Pin required', 'Tap the map or choose a search result so we have coordinates.');
      return;
    }

    const draftPickupLabel = String(route?.params?.pickupLabel || '').trim();
    const draftDropoffLabel = String(route?.params?.dropoffLabel || '').trim();
    const draftPickupCoordinate = route?.params?.pickupCoordinate || null;
    const draftDropoffCoordinate = route?.params?.dropoffCoordinate || null;

    navigation.navigate({
      name: 'PassengerHireCreate',
      params: {
        selectedLocation: {
          field,
          label,
          coordinate,
          // Keep the other point so remounts do not wipe it.
          pickupLabel: field === 'pickup' ? label : draftPickupLabel,
          dropoffLabel: field === 'dropoff' ? label : draftDropoffLabel,
          pickupCoordinate: field === 'pickup' ? coordinate : draftPickupCoordinate,
          dropoffCoordinate: field === 'dropoff' ? coordinate : draftDropoffCoordinate,
        },
        pickupLabel: field === 'pickup' ? label : draftPickupLabel,
        dropoffLabel: field === 'dropoff' ? label : draftDropoffLabel,
        pickupCoordinate: field === 'pickup' ? coordinate : draftPickupCoordinate,
        dropoffCoordinate: field === 'dropoff' ? coordinate : draftDropoffCoordinate,
      },
      merge: true,
    });
  };

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        initialRegion={
          coordinate
            ? {
                latitude: Number(coordinate.latitude),
                longitude: Number(coordinate.longitude),
                latitudeDelta: 0.04,
                longitudeDelta: 0.04,
              }
            : BULAWAYO_DEFAULT_REGION
        }
        maxBounds={BULAWAYO_GEO_LOCK_ENABLED ? BULAWAYO_SERVICE_BOUNDS_ARRAY : undefined}
        onPress={onMapPress}
        showsUserLocation={false}
        toolbarEnabled={false}
      >
        {coordinate ? (
          <Marker
            coordinate={{
              latitude: Number(coordinate.latitude),
              longitude: Number(coordinate.longitude),
            }}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={markerTracks || Platform.OS === 'ios'}
            title={title}
          >
            <View style={styles.markerWrap} pointerEvents="none">
              <View style={[styles.markerDot, { backgroundColor: pinColor, borderColor: '#fff' }]} />
              <View style={[styles.markerStem, { backgroundColor: pinColor }]} />
            </View>
          </Marker>
        ) : null}
      </MapView>

      <View style={[styles.topPanel, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconButton}>
            <Ionicons name="chevron-back" size={22} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{title}</Text>
          <View style={styles.iconButtonSpacer} />
        </View>

        <View style={styles.modeRow}>
          {[
            { key: 'search', label: 'Search / map' },
            { key: 'manual', label: 'Manual' },
          ].map((item) => (
            <TouchableOpacity
              key={item.key}
              onPress={() => {
                setMode(item.key);
                if (item.key !== 'search') setSuggestions([]);
              }}
              style={[styles.modeChip, mode === item.key && styles.modeChipActive]}
            >
              <Text style={[styles.modeChipText, mode === item.key && styles.modeChipTextActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {mode === 'search' ? (
          <View style={styles.searchCard}>
            <Ionicons name="search" size={18} color="#64748b" />
            <TextInput
              value={query}
              onChangeText={onChangeQuery}
              placeholder={field === 'pickup' ? 'Search start point' : 'Search end point'}
              placeholderTextColor="#94a3b8"
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {(searching || resolving) ? <ActivityIndicator color={PRIMARY_BLUE} /> : null}
          </View>
        ) : (
          <View style={styles.searchCard}>
            <Ionicons name="create-outline" size={18} color="#64748b" />
            <TextInput
              value={manualLabel}
              onChangeText={setManualLabel}
              placeholder="Type address / landmark"
              placeholderTextColor="#94a3b8"
              style={styles.searchInput}
            />
          </View>
        )}

        {mode === 'search' && suggestions.length > 0 ? (
          <View style={styles.suggestionsCard}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              style={{ maxHeight: 220 }}
            >
              {suggestions.map((item, index) => (
                <TouchableOpacity
                  key={String(item.id || item.placeId || `${suggestionTitle(item)}-${index}`)}
                  onPress={() => applySuggestion(item)}
                  style={[
                    styles.suggestionRow,
                    index === suggestions.length - 1 && { borderBottomWidth: 0 },
                  ]}
                >
                  <Ionicons name="location-outline" size={18} color={pinColor} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.suggestionTitle} numberOfLines={1}>
                      {suggestionTitle(item)}
                    </Text>
                    {suggestionSubtitle(item) ? (
                      <Text style={styles.suggestionSubtitle} numberOfLines={2}>
                        {suggestionSubtitle(item)}
                      </Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {mode === 'search' && !searching && query.trim().length >= 3 && suggestions.length === 0 ? (
          <View style={styles.emptyHint}>
            <Text style={styles.emptyHintText}>
              No places found. Try another name, or tap the map to drop a pin.
            </Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.bottomPanel, { bottom: tabBarHeight, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Text style={styles.helpText}>
          {coordinate
            ? `Pin set · ${Number(coordinate.latitude).toFixed(5)}, ${Number(coordinate.longitude).toFixed(5)}`
            : 'Tap the map to drop a pin, or pick a search result.'}
        </Text>
        <TouchableOpacity onPress={confirm} style={styles.confirmButton}>
          <Text style={styles.confirmText}>Use this location</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#eef2f7',
  },
  topPanel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    paddingHorizontal: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  iconButton: {
    height: 40,
    width: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonSpacer: {
    height: 40,
    width: 40,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  modeRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 4,
    marginBottom: 10,
  },
  modeChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 12,
  },
  modeChipActive: {
    backgroundColor: PRIMARY_BLUE,
  },
  modeChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
  },
  modeChipTextActive: {
    color: '#fff',
  },
  searchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 18,
    paddingHorizontal: 12,
    minHeight: 48,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 16,
    color: '#111827',
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
  },
  suggestionsCard: {
    marginTop: 8,
    backgroundColor: '#fff',
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  suggestionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  suggestionSubtitle: {
    marginTop: 2,
    fontSize: 13,
    color: '#64748b',
  },
  emptyHint: {
    marginTop: 8,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  emptyHintText: {
    fontSize: 13,
    color: '#475569',
  },
  bottomPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: 'rgba(246,247,243,0.96)',
  },
  helpText: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 10,
  },
  confirmButton: {
    height: 52,
    borderRadius: 18,
    backgroundColor: PRIMARY_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  markerWrap: {
    alignItems: 'center',
  },
  markerDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 3,
  },
  markerStem: {
    width: 3,
    height: 14,
    marginTop: -2,
    borderRadius: 2,
  },
});

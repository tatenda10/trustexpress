import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
  Animated,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { findNearbyDrivers, getPassengerCurrentRide, getPassengerRideOptions, validatePassengerDiscount } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import { isCoordinateInBulawayoServiceArea } from '../../constants/serviceArea';
import { connectRealtime } from '../../realtime';

function getTierIconName(tier) {
  const tierName = String(tier?.tierName || '').toLowerCase();
  const tierKey = String(tier?.tierKey || '').toLowerCase();
  if (tierName.includes('lux') || tierKey.includes('lux')) return 'diamond-outline';
  if (tierName.includes('express') || tierKey.includes('express')) return 'flash-outline';
  return 'car-sport-outline';
}

function encodePolyline(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return '';
  let lastLat = 0;
  let lastLng = 0;
  const encodeValue = (value) => {
    let current = value < 0 ? ~(value << 1) : value << 1;
    let output = '';
    while (current >= 0x20) {
      output += String.fromCharCode((0x20 | (current & 0x1f)) + 63);
      current >>= 5;
    }
    output += String.fromCharCode(current + 63);
    return output;
  };
  return coordinates
    .map((point) => {
      const lat = Math.round(Number(point.latitude) * 1e5);
      const lng = Math.round(Number(point.longitude) * 1e5);
      const encoded = `${encodeValue(lat - lastLat)}${encodeValue(lng - lastLng)}`;
      lastLat = lat;
      lastLng = lng;
      return encoded;
    })
    .join('');
}

function getTierAmount(tier, distanceKm) {
  return Math.ceil(
    Math.max(
      Number(tier?.baseFare || 0) + Number(distanceKm || 0) * Number(tier?.pricePerKm || 0),
      Number(tier?.minimumFare || 0),
    ),
  );
}

function getDiscountedAmount(amount, discount) {
  const fare = Number(amount || 0);
  if (!(fare > 0) || !discount?.discountType || !(Number(discount?.discountValue || 0) > 0)) {
    return fare;
  }

  let reduction = 0;
  if (String(discount.discountType) === 'percent') {
    reduction = (fare * Number(discount.discountValue || 0)) / 100;
  } else {
    reduction = Number(discount.discountValue || 0);
  }

  if (Number(discount.maxDiscountAmount || 0) > 0) {
    reduction = Math.min(reduction, Number(discount.maxDiscountAmount || 0));
  }

  reduction = Math.min(reduction, fare);
  return Number((fare - reduction).toFixed(2));
}

function TierCard({ tier, selected, onPress, distanceKm, appliedDiscount }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const tierAmount = getTierAmount(tier, distanceKm);
  const visibleTierAmount = getDiscountedAmount(tierAmount, appliedDiscount);

  const iconName = getTierIconName(tier);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        style={[styles.tierCard, selected && styles.tierCardSelected]}
      >
        {/* Selected indicator bar */}
        {selected && <View style={styles.selectedBar} />}

        <View style={styles.tierInner}>
          {/* Icon */}
          <View style={[styles.tierIconWrap, selected && styles.tierIconWrapSelected]}>
            <Ionicons name={iconName} size={26} color={selected ? '#fff' : PRIMARY_BLUE} />
          </View>

          {/* Info */}
          <View style={styles.tierInfo}>
            <Text style={styles.tierName}>{tier.tierName}</Text>
            <Text style={styles.tierSub}>
              {tier.regionName || `${Number(distanceKm || 0).toFixed(1)} km trip`}
            </Text>
            {tier.estimatedArrival && (
              <View style={styles.etaBadge}>
                <Ionicons name="time-outline" size={11} color={PRIMARY_BLUE} />
                <Text style={styles.etaText}>{tier.estimatedArrival}</Text>
              </View>
            )}
          </View>

          {/* Price */}
          <View style={styles.tierPriceWrap}>
            <Text style={styles.tierPrice}>${visibleTierAmount.toFixed(2)}</Text>
            {tier.surgeMultiplier && Number(tier.surgeMultiplier) > 1 && (
              <View style={styles.surgeBadge}>
                <Text style={styles.surgeText}>{tier.surgeMultiplier}×</Text>
              </View>
            )}
          </View>
        </View>

        {selected && (
          <View style={styles.checkmarkWrap}>
            <Ionicons name="checkmark-circle" size={20} color={PRIMARY_BLUE} />
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function PassengerChooseRideScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const {
    pickupCoordinate,
    dropoffCoordinate,
    intermediateStops = [],
    pickupLabel,
    dropoffLabel,
    routeCoordinates = [],
    distanceKm = 0,
    estimatedMinutes = 0,
  } = route.params || {};

  const [loadingTiers, setLoadingTiers] = useState(true);
  const [tiersError, setTiersError] = useState('');
  const [tiers, setTiers] = useState([]);
  const [selectedTierKey, setSelectedTierKey] = useState('');
  const [isSubmittingRide, setIsSubmittingRide] = useState(false);
  const [appliedDiscount, setAppliedDiscount] = useState(null);

  const slideAnim = useRef(new Animated.Value(40)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const lastDiscountTierKeyRef = useRef('');
  const realtimeResumeInFlightRef = useRef(false);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    let active = true;
    const loadTiers = async () => {
      setLoadingTiers(true);
      setTiersError('');
      try {
        let token = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          token = await getTokenRef.current();
          if (token) break;
          await new Promise((resolve) => setTimeout(resolve, 450));
        }
        if (!token) throw new Error('We are still finishing your sign-in. Please wait a moment and try again.');
        const data = await getPassengerRideOptions(token);
        if (!active) return;
        const nextTiers = Array.isArray(data?.tiers) ? data.tiers : [];
        setTiers(nextTiers);
        setSelectedTierKey(nextTiers[0]?.tierKey || '');
        if (!nextTiers.length) {
          setTiersError('No ride tiers are configured yet. Please ask the admin to add pricing tiers.');
        } else {
          Animated.parallel([
            Animated.timing(slideAnim, { toValue: 0, duration: 380, useNativeDriver: true }),
            Animated.timing(fadeAnim, { toValue: 1, duration: 380, useNativeDriver: true }),
          ]).start();
        }
      } catch (error) {
        if (!active) return;
        setTiers([]);
        setSelectedTierKey('');
        setTiersError(error?.message || 'Could not load ride tiers right now.');
      } finally {
        if (active) setLoadingTiers(false);
      }
    };
    loadTiers();
    return () => { active = false; };
  }, []);

  const selectedTier = useMemo(
    () => tiers.find((t) => t.tierKey === selectedTierKey) || null,
    [selectedTierKey, tiers],
  );

  const estimatedAmount = useMemo(
    () => getTierAmount(selectedTier, distanceKm),
    [distanceKm, selectedTier],
  );

  useEffect(() => {
    if (!selectedTierKey) return;
    if (lastDiscountTierKeyRef.current && lastDiscountTierKeyRef.current !== selectedTierKey) {
      setAppliedDiscount(null);
    }
    lastDiscountTierKeyRef.current = selectedTierKey;
  }, [selectedTierKey]);

  useEffect(() => {
    let active = true;

    const maybeApplyAutoDiscount = async () => {
      if (!selectedTier || !(originalEstimatedAmount > 0)) {
        if (active) setAppliedDiscount(null);
        return;
      }

      try {
        const token = await getTokenRef.current();
        if (!token) throw new Error('Not signed in');
        const data = await validatePassengerDiscount(token, {
          autoApply: true,
          selectedTier,
          originalFareAmount: originalEstimatedAmount,
        });
        if (!active) return;
        setAppliedDiscount(data?.discount || null);
      } catch {
        if (active) setAppliedDiscount(null);
      }
    };

    maybeApplyAutoDiscount();
    return () => {
      active = false;
    };
  }, [selectedTier, originalEstimatedAmount]);

  const originalEstimatedAmount = Number(estimatedAmount || 0);
  const finalEstimatedAmount = Number(appliedDiscount?.finalFareAmount || estimatedAmount || 0);

  const navigateToActiveRide = (data) => {
    const ride = data?.rideRequest;
    if (!ride?.id) return false;
    const activeTier = ride.requestedTierKey || ride.requestedTierName
      ? { tierKey: ride.requestedTierKey || '', tierName: ride.requestedTierName || 'Ride' }
      : null;
    const rideStatus = String(ride?.status || '').toLowerCase();
    if (rideStatus === 'requested' || rideStatus === 'driver_found') {
      navigation.replace('PassengerNearbyCars', {
        pickupCoordinate: ride.pickupCoordinate,
        dropoffCoordinate: ride.dropoffCoordinate,
        intermediateStops: ride.intermediateStops || intermediateStops,
        pickupLabel: ride.pickupLabel,
        dropoffLabel: ride.dropoffLabel,
        distanceKm: Number(ride?.estimatedDistanceKm || 0),
        estimatedMinutes: Number(ride?.estimatedMinutes || 0),
        estimatedAmount: Number(ride?.estimatedAmount || 0),
        selectedTier: activeTier,
        rideRequest: { ...ride, remainingSecondsCapturedAt: Date.now() },
        nearbyDrivers: Array.isArray(data?.acceptedDrivers) ? data.acceptedDrivers : [],
      });
      return true;
    }
    navigation.replace('PassengerRideTracking', {
      pickupCoordinate: ride.pickupCoordinate,
      dropoffCoordinate: ride.dropoffCoordinate,
      intermediateStops: ride.intermediateStops || intermediateStops,
      pickupLabel: ride.pickupLabel,
      dropoffLabel: ride.dropoffLabel,
      estimatedAmount: Number(ride.estimatedAmount || 0),
      selectedTier: activeTier,
      driver: data?.assignedDriver || null,
      rideRequestId: ride.id,
    });
    return true;
  };

  useEffect(() => {
    let active = true;
    let localSocket = null;

    const refreshCurrentRideFromRealtime = async () => {
      if (realtimeResumeInFlightRef.current) return;
      realtimeResumeInFlightRef.current = true;
      try {
        const token = await getTokenRef.current?.();
        if (!token || !active) return;
        const currentRideData = await getPassengerCurrentRide(token);
        if (navigateToActiveRide(currentRideData)) return;
      } catch {
        // Ignore and leave normal screen state in place.
      } finally {
        realtimeResumeInFlightRef.current = false;
      }
    };

    const initRealtime = async () => {
      try {
        const token = await getTokenRef.current?.();
        if (!token || !active) return;
        localSocket = connectRealtime(token);
        if (!localSocket) return;

        const handleRideUpdate = (payload = {}) => {
          const rideStatus = String(payload?.status || '').toLowerCase();
          if (!['driver_found', 'driver_assigned', 'driver_arrived', 'in_progress'].includes(rideStatus)) return;
          refreshCurrentRideFromRealtime();
        };

        localSocket.on('ride_status:updated', handleRideUpdate);
        localSocket.__passengerChooseCleanup = () => {
          localSocket?.off('ride_status:updated', handleRideUpdate);
        };
      } catch {
        // Manual and polling flows remain as fallback.
      }
    };

    initRealtime();

    return () => {
      active = false;
      realtimeResumeInFlightRef.current = false;
      localSocket?.__passengerChooseCleanup?.();
    };
  }, []);

  const handleFindRide = async () => {
    if (!pickupCoordinate || !dropoffCoordinate || !selectedTier) {
      Alert.alert('Missing route', 'Set your pickup, destination, and ride tier first.');
      return;
    }
    if (!isCoordinateInBulawayoServiceArea(pickupCoordinate) || !isCoordinateInBulawayoServiceArea(dropoffCoordinate)) {
      Alert.alert('Outside Bulawayo', 'Trust Express currently supports rides within Bulawayo only.');
      return;
    }
    if (!(Number(distanceKm) > 0)) {
      Alert.alert('Calculating road distance', 'Please wait for the road distance to finish calculating, then choose your ride.');
      return;
    }
    setIsSubmittingRide(true);
    let token = null;
    try {
      token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      const currentRideData = await getPassengerCurrentRide(token);
      if (navigateToActiveRide(currentRideData)) return;
      const data = await findNearbyDrivers(token, {
        pickupCoordinate,
        dropoffCoordinate,
        intermediateStops,
        pickupLabel,
        dropoffLabel,
        routePolyline: encodePolyline(routeCoordinates),
        routeDistanceKm: Number(distanceKm || 0),
        routeDurationMinutes: Number(estimatedMinutes || 0),
        distanceKm,
        estimatedMinutes,
        estimatedAmount: finalEstimatedAmount,
        selectedTier,
      });
      const serverRide = data?.rideRequest || null;
      const nextDistanceKm = Number(serverRide?.estimatedDistanceKm || distanceKm || 0);
      const nextEstimatedMinutes = Number(serverRide?.estimatedMinutes || estimatedMinutes || 0);
      const nextEstimatedAmount = Number(serverRide?.estimatedAmount || finalEstimatedAmount || 0);
      const nextSelectedTier = serverRide?.requestedTierKey || serverRide?.requestedTierName
        ? { ...selectedTier, tierKey: serverRide.requestedTierKey || selectedTier.tierKey, tierName: serverRide.requestedTierName || selectedTier.tierName }
        : selectedTier;
      navigation.navigate('PassengerNearbyCars', {
        pickupCoordinate,
        dropoffCoordinate,
        intermediateStops,
        pickupLabel,
        dropoffLabel,
        routeCoordinates,
        distanceKm: nextDistanceKm,
        estimatedMinutes: nextEstimatedMinutes,
        estimatedAmount: nextEstimatedAmount,
        selectedTier: nextSelectedTier,
        tiers,
        rideRequest: serverRide ? { ...serverRide, remainingSecondsCapturedAt: Date.now() } : null,
        nearbyDrivers: Array.isArray(data?.nearbyDrivers) ? data.nearbyDrivers : [],
      });
    } catch (error) {
      if (error?.status === 409 && token) {
        try {
          const currentRideData = await getPassengerCurrentRide(token);
          if (navigateToActiveRide(currentRideData)) return;
        } catch { /* fall through */ }
      }
      Alert.alert('Ride request failed', error?.message || 'Could not create the ride request.');
    } finally {
      setIsSubmittingRide(false);
    }
  };

  const isDisabled = loadingTiers || isSubmittingRide || tiers.length === 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Choose a ride</Text>
        <View style={styles.backBtn} />
      </View>

      {/* ── Route Summary ── */}
      <View style={styles.routeCard}>
        {/* Destination row */}
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.routeRow} activeOpacity={0.7}>
          <View style={styles.routeDot}>
            <View style={styles.routeDotInnerDest} />
          </View>
          <Text numberOfLines={1} style={styles.routeLabel}>
            {dropoffLabel?.replace('Drop-off: ', '') || 'Destination'}
          </Text>
          <Ionicons name="pencil-outline" size={15} color="#9ca3af" style={{ marginLeft: 4 }} />
        </TouchableOpacity>

        <View style={styles.routeDivider} />

        {/* Trip meta row */}
        <View style={styles.routeMetaRow}>
          <View style={styles.routeMeta}>
            <Ionicons name="navigate-circle-outline" size={15} color={PRIMARY_BLUE} />
            <Text style={styles.routeMetaText}>{Number(distanceKm || 0).toFixed(1)} km</Text>
          </View>
          <View style={styles.routeMetaDot} />
          <View style={styles.routeMeta}>
            <Ionicons name="time-outline" size={15} color={PRIMARY_BLUE} />
            <Text style={styles.routeMetaText}>{estimatedMinutes} min</Text>
          </View>
          <View style={styles.routeMetaDot} />
          <Text style={styles.routeMetaPrice}>${finalEstimatedAmount.toFixed(2)}</Text>
        </View>
        {Array.isArray(intermediateStops) && intermediateStops.length ? (
          <View style={styles.discountSummaryWrap}>
            <Text style={styles.discountSummaryTextStrong}>
              {intermediateStops.length} stop{intermediateStops.length === 1 ? '' : 's'} added
            </Text>
          </View>
        ) : null}
      </View>

      {/* ── Tiers ── */}
      <View style={styles.tiersSection}>
        <Text style={styles.sectionLabel}>Available options</Text>

        {loadingTiers ? (
          <View style={styles.loadingWrap}>
            {[1, 2, 3].map((i) => (
              <View key={i} style={[styles.skeletonCard, { opacity: 1 - i * 0.2 }]} />
            ))}
            <ActivityIndicator size="small" color={PRIMARY_BLUE} style={{ marginTop: 12 }} />
          </View>
        ) : tiersError ? (
          <View style={styles.errorCard}>
            <View style={styles.errorIconWrap}>
              <Ionicons name="warning-outline" size={26} color="#f59e0b" />
            </View>
            <Text style={styles.errorTitle}>Unavailable</Text>
            <Text style={styles.errorBody}>{tiersError}</Text>
          </View>
        ) : (
          <Animated.ScrollView
            style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
            contentContainerStyle={styles.tierList}
            showsVerticalScrollIndicator={false}
          >
            {tiers.map((tier) => (
              <TierCard
                key={tier.tierKey}
                tier={tier}
                selected={selectedTierKey === tier.tierKey}
                onPress={() => setSelectedTierKey(tier.tierKey)}
                distanceKm={distanceKm}
                appliedDiscount={appliedDiscount}
              />
            ))}
          </Animated.ScrollView>
        )}
      </View>

      {/* ── CTA ── */}
      <View
        style={[
          styles.ctaContainer,
          { paddingBottom: Math.max(tabBarHeight + insets.bottom + 8, 36) },
        ]}
      >
        {/* Promo / info pill */}
        {selectedTier && !loadingTiers && (
          <View style={styles.infoPill}>
            <Ionicons name="shield-checkmark-outline" size={13} color={PRIMARY_BLUE} />
            <Text style={styles.infoPillText}>Price locked in • No surge pricing</Text>
          </View>
        )}

        <TouchableOpacity
          onPress={handleFindRide}
          disabled={isDisabled}
          style={[styles.ctaBtn, isDisabled && styles.ctaBtnDisabled]}
          activeOpacity={0.88}
        >
          {isSubmittingRide ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <View style={styles.ctaInner}>
              <Text style={styles.ctaText}>
                {selectedTier ? `Request ${selectedTier.tierName}` : 'Find a driver'}
              </Text>
              {selectedTier && !isDisabled && (
                <View style={styles.ctaChevron}>
                  <Ionicons name="arrow-forward" size={18} color={PRIMARY_BLUE} />
                </View>
              )}
            </View>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f2f2f7',
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#f2f2f7',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4 },
      android: { elevation: 2 },
    }),
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    letterSpacing: -0.3,
  },

  // ── Route Card ──
  routeCard: {
    marginHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 20,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 10 },
      android: { elevation: 3 },
    }),
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
  },
  routeDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  routeDotInnerDest: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#111827',
  },
  routeLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    letterSpacing: -0.2,
  },
  routeDivider: {
    height: 1,
    backgroundColor: '#f3f4f6',
    marginVertical: 12,
    marginLeft: 32,
  },
  routeMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 2,
  },
  routeMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  routeMetaText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6b7280',
  },
  routeMetaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#d1d5db',
    marginHorizontal: 8,
  },
  routeMetaPrice: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginLeft: 'auto',
  },
  discountSummaryWrap: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#eef2f7',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  discountSummaryText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
  },
  discountSummaryTextStrong: {
    fontSize: 12,
    fontWeight: '700',
    color: '#15803d',
  },

  // ── Tiers Section ──
  tiersSection: {
    flex: 1,
    paddingHorizontal: 16,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9ca3af',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 12,
    marginLeft: 4,
  },
  tierList: {
    paddingBottom: 8,
  },

  // ── Tier Card ──
  tierCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: '#f0f0f0',
    overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6 },
      android: { elevation: 1 },
    }),
  },
  tierCardSelected: {
    borderColor: PRIMARY_BLUE,
    ...Platform.select({
      ios: { shadowColor: PRIMARY_BLUE, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.15, shadowRadius: 10 },
      android: { elevation: 4 },
    }),
  },
  selectedBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: PRIMARY_BLUE,
    borderTopLeftRadius: 18,
    borderBottomLeftRadius: 18,
  },
  tierInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    paddingLeft: 18,
  },
  tierIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierIconWrapSelected: {
    backgroundColor: PRIMARY_BLUE,
  },
  tierInfo: {
    flex: 1,
    marginLeft: 14,
    paddingRight: 8,
  },
  tierName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    letterSpacing: -0.3,
  },
  tierSub: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
    fontWeight: '400',
  },
  etaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
    backgroundColor: '#eff6ff',
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 20,
    gap: 3,
  },
  etaText: {
    fontSize: 11,
    fontWeight: '600',
    color: PRIMARY_BLUE,
  },
  tierPriceWrap: {
    alignItems: 'flex-end',
  },
  tierPrice: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.5,
  },
  surgeBadge: {
    backgroundColor: '#fef3c7',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
  },
  surgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#d97706',
  },
  checkmarkWrap: {
    position: 'absolute',
    top: 10,
    right: 10,
  },

  // ── Loading ──
  loadingWrap: {
    gap: 10,
  },
  skeletonCard: {
    height: 80,
    borderRadius: 18,
    backgroundColor: '#e5e7eb',
  },

  // ── Error ──
  errorCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
  },
  errorIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#fef3c7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
  },
  errorBody: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
  },

  // ── CTA ──
  ctaContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: '#f2f2f7',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  infoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginBottom: 10,
  },
  infoPillText: {
    fontSize: 12,
    fontWeight: '500',
    color: PRIMARY_BLUE,
  },
  discountCard: {
    marginBottom: 14,
    borderRadius: 18,
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  discountCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 10,
  },
  discountHintText: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 10,
    lineHeight: 18,
  },
  discountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  discountInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: '#f9fafb',
    color: '#111827',
    fontSize: 14,
    fontWeight: '600',
  },
  discountApplyBtn: {
    marginLeft: 10,
    height: 44,
    minWidth: 78,
    borderRadius: 14,
    backgroundColor: PRIMARY_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  discountApplyBtnDisabled: {
    opacity: 0.65,
  },
  discountApplyBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  discountBreakdown: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eef2f7',
    paddingTop: 12,
    gap: 8,
  },
  discountBreakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  discountBreakdownLabel: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '600',
  },
  discountBreakdownValue: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '700',
  },
  discountBreakdownValueGreen: {
    color: '#15803d',
  },
  discountBreakdownTotalLabel: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '800',
  },
  discountBreakdownTotalValue: {
    fontSize: 16,
    color: '#111827',
    fontWeight: '900',
  },
  ctaBtn: {
    height: 56,
    backgroundColor: PRIMARY_BLUE,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: PRIMARY_BLUE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 12 },
      android: { elevation: 6 },
    }),
  },
  ctaBtnDisabled: {
    backgroundColor: '#93c5fd',
    shadowOpacity: 0,
    elevation: 0,
  },
  ctaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ctaText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.3,
  },
  ctaChevron: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

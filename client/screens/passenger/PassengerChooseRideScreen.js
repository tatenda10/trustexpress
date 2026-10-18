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
  BackHandler,
} from 'react-native';
import MapView, { Marker, Polyline } from '../../components/maps/MapViewCompat';
import { LetterMarker, PIN_COLORS, stopLetter } from '../../components/maps/LetterPin';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../auth/AuthProvider';
import { findNearbyDrivers, getPassengerCurrentRide, getPassengerRideOptions, validatePassengerDiscount } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import { PAYMENT_METHOD_CASH, PAYMENT_METHOD_ONLINE } from '../../constants/payment';
import { SERVICE_AREA_LABEL, isCoordinateInBulawayoServiceArea } from '../../constants/serviceArea';
import { connectRealtime } from '../../realtime';
import RideTierCarIcon from '../../components/RideTierCarIcon';

function getTierMaxPassengerCount(tier) {
  const tierKey = String(tier?.tierKey || '').toLowerCase();
  const tierName = String(tier?.tierName || '').toLowerCase();
  if (tierKey.includes('xl') || tierName.includes('xl') || tierName.includes('extra large')) {
    return 7;
  }
  return 4;
}

function getTierCapacityLabel(tier) {
  return `Fits up to ${getTierMaxPassengerCount(tier)} people`;
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

function placeLabel(label) {
  return String(label || '').replace(/^(Pickup|Drop-off):\s*/i, '').trim();
}

function TierRow({ tier, selected, onPress, distanceKm, appliedDiscount }) {
  const visibleTierAmount = getDiscountedAmount(getTierAmount(tier, distanceKm), appliedDiscount);
  const meta = [tier.estimatedArrival, `Fits ${getTierMaxPassengerCount(tier)}`].filter(Boolean).join(' · ');

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.tierRow, selected && styles.tierRowSelected]}
    >
      <View style={styles.tierIconWrap}>
        <RideTierCarIcon tier={tier} size={40} />
      </View>
      <View style={styles.tierInfo}>
        <Text style={styles.tierName}>{tier.tierName}</Text>
        <Text style={styles.tierSub}>{meta}</Text>
      </View>
      <View style={styles.tierPriceWrap}>
        <Text style={styles.tierPrice}>${visibleTierAmount.toFixed(2)}</Text>
        {tier.surgeMultiplier && Number(tier.surgeMultiplier) > 1 ? (
          <Text style={styles.surgeText}>{tier.surgeMultiplier}× busy</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

export default function PassengerChooseRideScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
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
  const [passengerCount, setPassengerCount] = useState(null);
  const [isSubmittingRide, setIsSubmittingRide] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [appliedDiscount, setAppliedDiscount] = useState(null);
  const [step, setStep] = useState('options');
  const mapRef = useRef(null);

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
  const maxPassengerCount = getTierMaxPassengerCount(selectedTier);
  const passengerCountOptions = useMemo(
    () => Array.from({ length: maxPassengerCount }, (_, index) => index + 1),
    [maxPassengerCount],
  );

  useEffect(() => {
    if (passengerCount && passengerCount > maxPassengerCount) {
      setPassengerCount(null);
    }
  }, [maxPassengerCount, passengerCount]);

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
    if (!passengerCount) {
      Alert.alert('How many people?', 'Confirm how many people are riding before requesting a driver.');
      return;
    }
    if (passengerCount > maxPassengerCount) {
      Alert.alert(
        'Too many people',
        `This ${selectedTier.tierName} fits up to ${maxPassengerCount} people. Choose a larger tier or reduce the group size.`,
      );
      return;
    }
    if (!isCoordinateInBulawayoServiceArea(pickupCoordinate) || !isCoordinateInBulawayoServiceArea(dropoffCoordinate)) {
      Alert.alert('Outside service area', `Trust Express currently supports rides within ${SERVICE_AREA_LABEL}.`);
      return;
    }
    if (!(Number(distanceKm) > 0)) {
      Alert.alert('Calculating road distance', 'Please wait for the road distance to finish calculating, then choose your ride.');
      return;
    }
    if (!paymentMethod) {
      Alert.alert('Payment method', 'Tick cash or pay online before requesting a driver.');
      return;
    }
    setIsSubmittingRide(true);
    let token = null;
    try {
      token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      // find-driver already rejects open rides with 409; skip a serial current-ride round-trip.
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
        passengerCount,
        paymentMethod,
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

  const isDisabled = loadingTiers || isSubmittingRide || tiers.length === 0 || !passengerCount || !paymentMethod;
  const hasDiscount = finalEstimatedAmount > 0 && finalEstimatedAmount < originalEstimatedAmount;

  useEffect(() => {
    if (step !== 'confirm') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setStep('options');
      return true;
    });
    return () => subscription.remove();
  }, [step]);

  const fitMap = () => {
    const fitCoordinates = [
      pickupCoordinate,
      dropoffCoordinate,
      ...(Array.isArray(intermediateStops) ? intermediateStops.map((stop) => stop?.coordinate) : []),
      ...(Array.isArray(routeCoordinates) ? routeCoordinates.filter((_, index) => index % 10 === 0) : []),
    ].filter(Boolean);
    if (fitCoordinates.length < 2) return;
    try {
      mapRef.current?.fitToCoordinates?.(fitCoordinates, {
        edgePadding: { top: insets.top + 70, right: 50, bottom: 40, left: 50 },
        animated: false,
      });
    } catch {
      // initialRegion keeps the route roughly in view.
    }
  };

  const initialRegion = pickupCoordinate && dropoffCoordinate
    ? {
      latitude: (Number(pickupCoordinate.latitude) + Number(dropoffCoordinate.latitude)) / 2,
      longitude: (Number(pickupCoordinate.longitude) + Number(dropoffCoordinate.longitude)) / 2,
      latitudeDelta: Math.max(Math.abs(pickupCoordinate.latitude - dropoffCoordinate.latitude) * 1.8, 0.02),
      longitudeDelta: Math.max(Math.abs(pickupCoordinate.longitude - dropoffCoordinate.longitude) * 1.8, 0.02),
    }
    : undefined;

  const handleBack = () => {
    if (step === 'confirm') setStep('options');
    else navigation.goBack();
  };

  return (
    <View style={styles.screen}>
      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          initialRegion={initialRegion}
          onMapReady={fitMap}
          onLayout={fitMap}
          showsCompass={false}
          toolbarEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
        >
          {Array.isArray(routeCoordinates) && routeCoordinates.length > 1 ? (
            <Polyline coordinates={routeCoordinates} strokeColor={PRIMARY_BLUE} strokeWidth={5} />
          ) : null}
          {pickupCoordinate ? (
            <LetterMarker coordinate={pickupCoordinate} title="Pickup" letter="A" color={PIN_COLORS.start} />
          ) : null}
          {(Array.isArray(intermediateStops) ? intermediateStops : []).map((stop, index) => (
            stop?.coordinate ? (
              <LetterMarker
                key={`stop-${index}`}
                coordinate={stop.coordinate}
                title={stop.label || `Stop ${index + 1}`}
                letter={stopLetter(index)}
                color={PIN_COLORS.stop}
              />
            ) : null
          ))}
          {dropoffCoordinate ? (
            <LetterMarker coordinate={dropoffCoordinate} title="Drop-off" letter="B" color={PIN_COLORS.finish} />
          ) : null}
        </MapView>

        <TouchableOpacity
          onPress={handleBack}
          style={[styles.backBtn, { top: insets.top + 10 }]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={22} color="#111827" />
        </TouchableOpacity>
      </View>

      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 4 }]}>
        <View style={styles.handle} />

        {step === 'options' ? (
          <>
            <Text style={styles.sheetTitle}>Choose a ride</Text>
            <Text style={styles.sheetSub}>
              {Number(distanceKm || 0).toFixed(1)} km · {estimatedMinutes} min
              {Array.isArray(intermediateStops) && intermediateStops.length
                ? ` · ${intermediateStops.length} stop${intermediateStops.length === 1 ? '' : 's'}`
                : ''}
            </Text>

            {loadingTiers ? (
              <View style={styles.loadingWrap}>
                {[1, 2, 3].map((i) => (
                  <View key={i} style={[styles.skeletonRow, { opacity: 1 - i * 0.2 }]} />
                ))}
              </View>
            ) : tiersError ? (
              <View style={styles.errorCard}>
                <Ionicons name="warning-outline" size={24} color="#f59e0b" />
                <Text style={styles.errorTitle}>Unavailable</Text>
                <Text style={styles.errorBody}>{tiersError}</Text>
              </View>
            ) : (
              <Animated.ScrollView
                style={[styles.tierList, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
                showsVerticalScrollIndicator={false}
              >
                {tiers.map((tier) => (
                  <TierRow
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

            <TouchableOpacity
              onPress={() => setStep('confirm')}
              disabled={loadingTiers || !selectedTier}
              style={[styles.ctaBtn, (loadingTiers || !selectedTier) && styles.ctaBtnDisabled]}
              activeOpacity={0.88}
            >
              <Text style={styles.ctaText}>
                {selectedTier ? `Continue with ${selectedTier.tierName}` : 'Continue'}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.sheetTitle}>Confirm your ride</Text>

            <View style={styles.summaryCard}>
              <View style={styles.summaryTop}>
                <View style={styles.summaryIcon}>
                  <RideTierCarIcon tier={selectedTier} size={36} />
                </View>
                <Text style={[styles.summaryName, { flex: 1 }]}>{selectedTier?.tierName || 'Ride'}</Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.summaryPrice}>${finalEstimatedAmount.toFixed(2)}</Text>
                  {hasDiscount ? (
                    <Text style={styles.summaryOldPrice}>${originalEstimatedAmount.toFixed(2)}</Text>
                  ) : null}
                </View>
              </View>
              {[
                { letter: 'A', color: PIN_COLORS.start, label: placeLabel(pickupLabel) || 'Pickup' },
                ...(Array.isArray(intermediateStops) ? intermediateStops : [])
                  .filter((stop) => stop?.label)
                  .map((stop, index) => ({ letter: stopLetter(index), color: PIN_COLORS.stop, label: placeLabel(stop.label) })),
                { letter: 'B', color: PIN_COLORS.finish, label: placeLabel(dropoffLabel) || 'Destination' },
              ].map((point) => (
                <View key={point.letter} style={styles.summaryPoint}>
                  <View style={[styles.summaryBadge, { backgroundColor: point.color }]}>
                    <Text style={styles.summaryBadgeText}>{point.letter}</Text>
                  </View>
                  <Text style={styles.summaryRoute} numberOfLines={1}>{point.label}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.sectionLabel}>How many people?</Text>
            <View style={styles.peopleRow}>
              {passengerCountOptions.map((count) => {
                const selected = passengerCount === count;
                return (
                  <TouchableOpacity
                    key={count}
                    onPress={() => setPassengerCount(count)}
                    style={[styles.peopleChip, selected && styles.peopleChipSelected]}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.peopleChipText, selected && styles.peopleChipTextSelected]}>{count}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.sectionLabel}>How will you pay?</Text>
            {[
              { value: PAYMENT_METHOD_CASH, label: 'Cash', hint: 'Pay the driver at the end', icon: 'cash-outline' },
              { value: PAYMENT_METHOD_ONLINE, label: 'Pay online', hint: 'Card or Smile&Pay after the trip', icon: 'card-outline' },
            ].map((option) => {
              const active = paymentMethod === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  onPress={() => setPaymentMethod(option.value)}
                  style={[styles.payRow, active && styles.payRowActive]}
                  activeOpacity={0.85}
                >
                  <View style={styles.payIcon}>
                    <Ionicons name={option.icon} size={20} color={active ? PRIMARY_BLUE : '#374151'} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.payLabel}>{option.label}</Text>
                    <Text style={styles.payHint}>{option.hint}</Text>
                  </View>
                  <Ionicons
                    name={active ? 'radio-button-on' : 'radio-button-off'}
                    size={22}
                    color={active ? PRIMARY_BLUE : '#c0c4cc'}
                  />
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              onPress={handleFindRide}
              disabled={isDisabled}
              style={[styles.ctaBtn, isDisabled && styles.ctaBtnDisabled]}
              activeOpacity={0.88}
            >
              {isSubmittingRide ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.ctaText}>
                  {selectedTier ? `Request ${selectedTier.tierName}` : 'Request ride'}
                </Text>
              )}
            </TouchableOpacity>
            {!passengerCount || !paymentMethod ? (
              <Text style={styles.ctaHint}>
                {!passengerCount ? 'Choose how many people are riding' : 'Choose how you will pay'}
              </Text>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#ffffff' },
  mapWrap: { flex: 1, minHeight: 220, backgroundColor: '#eef4ff' },
  backBtn: {
    position: 'absolute',
    left: 16,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  sheet: {
    marginTop: -24,
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e5e7eb',
    marginBottom: 12,
  },
  sheetTitle: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  sheetSub: { marginTop: 2, fontSize: 13, color: '#6b7280' },

  tierList: { maxHeight: 290, marginTop: 12 },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'transparent',
    marginBottom: 6,
  },
  tierRowSelected: { borderColor: PRIMARY_BLUE, backgroundColor: '#eef4ff' },
  tierIconWrap: { width: 60, height: 44, alignItems: 'center', justifyContent: 'center' },
  tierInfo: { flex: 1, marginLeft: 10 },
  tierName: { fontSize: 16, fontWeight: '700', color: '#111827' },
  tierSub: { marginTop: 2, fontSize: 13, color: '#6b7280' },
  tierPriceWrap: { alignItems: 'flex-end' },
  tierPrice: { fontSize: 17, fontWeight: '800', color: '#111827' },
  surgeText: { marginTop: 2, fontSize: 11, fontWeight: '700', color: '#d97706' },

  loadingWrap: { marginTop: 12, gap: 8 },
  skeletonRow: { height: 64, borderRadius: 16, backgroundColor: '#f3f4f6' },
  errorCard: { marginTop: 12, alignItems: 'center', padding: 20, borderRadius: 16, backgroundColor: '#fffbeb' },
  errorTitle: { marginTop: 6, fontSize: 16, fontWeight: '700', color: '#111827' },
  errorBody: { marginTop: 4, fontSize: 14, color: '#6b7280', textAlign: 'center' },

  summaryCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: '#f9fafb',
  },
  summaryTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  summaryIcon: { width: 54, alignItems: 'center', marginRight: 10 },
  summaryName: { fontSize: 16, fontWeight: '700', color: '#111827' },
  summaryPoint: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  summaryBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  summaryBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  summaryRoute: { flex: 1, fontSize: 14, color: '#374151' },
  summaryPrice: { fontSize: 18, fontWeight: '800', color: '#111827' },
  summaryOldPrice: { fontSize: 12, color: '#9ca3af', textDecorationLine: 'line-through' },

  sectionLabel: { marginTop: 18, marginBottom: 8, fontSize: 15, fontWeight: '700', color: '#111827' },
  peopleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  peopleChip: {
    minWidth: 46,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  peopleChipSelected: { borderColor: PRIMARY_BLUE, backgroundColor: '#eef4ff' },
  peopleChipText: { fontSize: 16, fontWeight: '700', color: '#374151' },
  peopleChipTextSelected: { color: PRIMARY_BLUE },

  payRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    marginBottom: 8,
  },
  payRowActive: { borderColor: PRIMARY_BLUE, backgroundColor: '#eef4ff' },
  payIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#f3f4f6',
  },
  payLabel: { fontSize: 15, fontWeight: '700', color: '#111827' },
  payHint: { marginTop: 1, fontSize: 12, color: '#6b7280' },

  ctaBtn: {
    marginTop: 14,
    height: 54,
    borderRadius: 16,
    backgroundColor: PRIMARY_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaBtnDisabled: { backgroundColor: '#93c5fd' },
  ctaText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  ctaHint: { marginTop: 8, textAlign: 'center', fontSize: 12, color: '#6b7280' },
});

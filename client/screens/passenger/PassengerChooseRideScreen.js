import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { findNearbyDrivers, getPassengerRideOptions } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

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
    let current = value < 0 ? ~(value << 1) : (value << 1);
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

export default function PassengerChooseRideScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const {
    pickupCoordinate,
    dropoffCoordinate,
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
    return () => {
      active = false;
    };
  }, []);

  const selectedTier = useMemo(
    () => tiers.find((tier) => tier.tierKey === selectedTierKey) || null,
    [selectedTierKey, tiers]
  );

  const estimatedAmount = useMemo(() => {
    if (!selectedTier || !distanceKm) return 0;
    const baseFare = Number(selectedTier.baseFare || 0);
    const perKm = Number(selectedTier.pricePerKm || 0);
    const minimumFare = Number(selectedTier.minimumFare || 0);
    return Math.ceil(Math.max(baseFare + (distanceKm * perKm), minimumFare));
  }, [distanceKm, selectedTier]);

  const handleFindRide = async () => {
    if (!pickupCoordinate || !dropoffCoordinate || !selectedTier) {
      Alert.alert('Missing route', 'Set your pickup, destination, and ride tier first.');
      return;
    }

    setIsSubmittingRide(true);
    try {
      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');

      const data = await findNearbyDrivers(token, {
        pickupCoordinate,
        dropoffCoordinate,
        pickupLabel,
        dropoffLabel,
        routePolyline: encodePolyline(routeCoordinates),
        routeDistanceKm: Number(distanceKm || 0),
        routeDurationMinutes: Number(estimatedMinutes || 0),
        distanceKm,
        estimatedMinutes,
        estimatedAmount,
        selectedTier,
      });

      navigation.navigate('PassengerNearbyCars', {
        pickupCoordinate,
        dropoffCoordinate,
        pickupLabel,
        dropoffLabel,
        distanceKm,
        estimatedMinutes,
        estimatedAmount,
        selectedTier,
        tiers,
        rideRequest: data?.rideRequest
          ? {
              ...data.rideRequest,
              remainingSecondsCapturedAt: Date.now(),
            }
          : null,
        nearbyDrivers: Array.isArray(data?.nearbyDrivers) ? data.nearbyDrivers : [],
      });
    } catch (error) {
      Alert.alert('Ride request failed', error?.message || 'Could not create the ride request.');
    } finally {
      setIsSubmittingRide(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-[#f8f8f6]" edges={['top', 'left', 'right']}>
      <View className="flex-row items-center justify-between px-5 pb-4" style={{ paddingTop: insets.top + 8 }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          className="h-11 w-11 items-center justify-center rounded-full bg-white"
        >
          <Ionicons name="arrow-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text className="text-[16px] font-semibold text-gray-950">Choose a ride</Text>
        <View className="h-11 w-11" />
      </View>

      <View className="px-5">
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          activeOpacity={0.85}
          className="rounded-[16px] bg-white px-4 py-4"
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-4">
              <Text className="text-sm font-medium text-gray-400">Drop-off</Text>
              <Text numberOfLines={1} className="mt-1 text-[16px] font-medium text-gray-950">
                {dropoffLabel?.replace('Drop-off: ', '')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#111827" />
          </View>
        </TouchableOpacity>

        <View className="mt-3 rounded-[16px] bg-white px-4 py-4">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-4">
              <Text className="text-sm font-semibold uppercase tracking-[1px] text-gray-400">Trip</Text>
              <Text className="mt-1 text-sm font-medium text-gray-900">
                {Number(distanceKm || 0).toFixed(1)} km • {estimatedMinutes} min
              </Text>
            </View>
            <Text className="text-[24px] font-bold text-gray-950">${estimatedAmount.toFixed(2)}</Text>
          </View>
        </View>
      </View>

      <View className="mt-4 flex-1 px-5">
        {loadingTiers ? (
          <View className="rounded-[16px] bg-white px-4 py-5">
            <ActivityIndicator size="small" color={PRIMARY_BLUE} />
          </View>
        ) : tiersError ? (
          <View className="rounded-[16px] bg-white px-4 py-5">
            <Text className="text-base font-semibold text-gray-900">Ride option unavailable</Text>
            <Text className="mt-2 text-sm text-gray-500">{tiersError}</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
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
                  className="mb-3 rounded-[16px] bg-white px-4 py-4"
                  style={{ borderWidth: selected ? 2 : 1, borderColor: selected ? PRIMARY_BLUE : '#dbeafe' }}
                >
                  <View className="flex-row items-center">
                    <View className="h-14 w-14 items-center justify-center rounded-[18px] bg-[#eff6ff]">
                      <Ionicons name={getTierIconName(tier)} size={28} color={PRIMARY_BLUE} />
                    </View>
                    <View className="ml-4 flex-1 pr-3">
                      <Text className="text-[18px] font-medium text-gray-950">{tier.tierName}</Text>
                      <Text className="mt-1 text-sm text-gray-500">
                        {tier.regionName || `${Number(distanceKm || 0).toFixed(1)} km trip`}
                      </Text>
                    </View>
                    <Text className="text-[20px] font-bold text-gray-950">${tierAmount.toFixed(2)}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>

      <View
        className="border-t border-gray-200 bg-[#f8f8f6] px-5 pt-4"
        style={{ paddingBottom: Math.max(tabBarHeight + insets.bottom + 8, 36) }}
      >
        <TouchableOpacity
          onPress={handleFindRide}
          disabled={loadingTiers || isSubmittingRide || tiers.length === 0}
          className="h-14 items-center justify-center rounded-[16px]"
          style={{ backgroundColor: loadingTiers || isSubmittingRide || tiers.length === 0 ? '#93c5fd' : PRIMARY_BLUE }}
        >
          {isSubmittingRide ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text className="text-lg font-bold text-white">
              {selectedTier ? `Choose ${selectedTier.tierName}` : 'Find a driver'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { createHireRequest, getDirectionsRoute, getHireFareEstimate, getHireVehicleTypes } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import {
  HIRE_CARGO_TYPES,
  HIRE_EXTRA_OPTIONS,
  HIRE_HELP_OPTIONS,
  HIRE_VEHICLE_CATEGORIES,
  formatHireJobNotes,
  hireTypesToCategories,
  inferHireTripType,
} from '../../constants/hire';
import { PAYMENT_METHOD_ONLINE } from '../../constants/payment';
import { calculateDistanceKm } from '../../lib/mapVehicleHeading';

function defaultStartAtLocal() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function sameCoordinate(left, right) {
  const leftLat = Number(left?.latitude ?? left?.lat);
  const leftLng = Number(left?.longitude ?? left?.lng);
  const rightLat = Number(right?.latitude ?? right?.lat);
  const rightLng = Number(right?.longitude ?? right?.lng);
  if (![leftLat, leftLng, rightLat, rightLng].every(Number.isFinite)) return false;
  return Math.abs(leftLat - rightLat) < 0.00001 && Math.abs(leftLng - rightLng) < 0.00001;
}

const FALLBACK_HIRE_RATES = {
  delivery: 0.8,
  sedan: 0.8,
  suv: 1,
  van: 1.1,
  pickup: 1.1,
  sprinter: 1.2,
  iveco: 1.2,
  hiace: 1.1,
  eighteen_seater_plus: 1.4,
  bus: 1.5,
  moving_van: 1.2,
  truck: 1,
  lorry: 1.5,
  other: 1,
};

function formatOfferFigure(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

function estimateOfferFromRoute(pricePerKm, distanceKm) {
  const rate = Number(pricePerKm);
  const km = Number(distanceKm);
  if (!(rate > 0) || !(km > 0)) return '';
  return formatOfferFigure(Math.max(1, Math.round(rate * km * 100) / 100));
}

function coordinateKey(coordinate) {
  const latitude = Number(coordinate?.latitude ?? coordinate?.lat);
  const longitude = Number(coordinate?.longitude ?? coordinate?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '';
  return `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
}

function toggleValue(values, value) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export default function PassengerHireCreateScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { getToken } = useAuth();
  const params = route?.params || {};
  const preferredVehicle = params.preferredVehicle || null;
  const offerEditedRef = useRef(false);
  const getTokenRef = useRef(getToken);
  const lastEstimateKeyRef = useRef('');

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const [pickupLabel, setPickupLabel] = useState(
    String(params.pickupLabel || '').replace(/^Pickup:\s*/i, '')
  );
  const [dropoffLabel, setDropoffLabel] = useState(
    String(params.dropoffLabel || '').replace(/^Drop-off:\s*/i, '')
  );
  const [pickupCoordinate, setPickupCoordinate] = useState(params.pickupCoordinate || null);
  const [dropoffCoordinate, setDropoffCoordinate] = useState(params.dropoffCoordinate || null);
  const [startAt, setStartAt] = useState(defaultStartAtLocal());
  const [title, setTitle] = useState(
    preferredVehicle?.title
      ? `Hire ${preferredVehicle.title}`
      : ''
  );
  const [passengerCount, setPassengerCount] = useState('1');
  const [category, setCategory] = useState(
    String(preferredVehicle?.category || params.category || 'truck').toLowerCase()
  );
  const [tripType, setTripType] = useState(
    inferHireTripType(params.distanceKm)
  );
  const [passengerOfferAmount, setPassengerOfferAmount] = useState(() => {
    if (preferredVehicle?.dailyRate != null) return formatOfferFigure(preferredVehicle.dailyRate);
    const initialCategory = String(preferredVehicle?.category || params.category || 'truck').toLowerCase();
    return estimateOfferFromRoute(
      FALLBACK_HIRE_RATES[initialCategory] || FALLBACK_HIRE_RATES.other,
      params.distanceKm
    );
  });
  const [cargoTypes, setCargoTypes] = useState([]);
  const [jobNeeds, setJobNeeds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [vehicleTypes, setVehicleTypes] = useState(HIRE_VEHICLE_CATEGORIES);
  const [routeDistanceKm, setRouteDistanceKm] = useState(
    Number(params.distanceKm) > 0 ? Number(params.distanceKm) : null
  );

  const heading = useMemo(
    () => (preferredVehicle ? 'Request this vehicle' : 'Hire request details'),
    [preferredVehicle]
  );
  const hasRoute = !!(pickupCoordinate && dropoffCoordinate);
  const includesPeople = cargoTypes.includes('people');
  const selectedType = useMemo(
    () => vehicleTypes.find((item) => item.value === category) || null,
    [category, vehicleTypes]
  );
  const selectedRate = Number(selectedType?.pricePerKm) > 0
    ? Number(selectedType.pricePerKm)
    : (FALLBACK_HIRE_RATES[category] || FALLBACK_HIRE_RATES.other);
  const pickupKey = coordinateKey(pickupCoordinate);
  const dropoffKey = coordinateKey(dropoffCoordinate);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await getTokenRef.current?.({ skipCache: true });
        if (!token) return;
        const data = await getHireVehicleTypes(token);
        const nextTypes = hireTypesToCategories(data?.types);
        if (!active || !nextTypes.length) return;
        setVehicleTypes(nextTypes);
        setCategory((current) => (
          nextTypes.some((item) => item.value === current) ? current : nextTypes[0].value
        ));
      } catch {
        /* keep fallback types */
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!pickupKey || !dropoffKey) {
      setRouteDistanceKm(null);
      return undefined;
    }

    const fallbackKm = calculateDistanceKm(pickupCoordinate, dropoffCoordinate);
    const paramKm = Number(params.distanceKm);
    const sameAsHomeRoute = (
      sameCoordinate(pickupCoordinate, params.pickupCoordinate)
      && sameCoordinate(dropoffCoordinate, params.dropoffCoordinate)
      && paramKm > 0
    );
    const nextKm = sameAsHomeRoute ? paramKm : fallbackKm;
    if (nextKm > 0) {
      setRouteDistanceKm((current) => (current === nextKm ? current : nextKm));
      setTripType(inferHireTripType(nextKm));
    }
    if (sameAsHomeRoute) return undefined;

    let cancelled = false;
    (async () => {
      try {
        const token = await getTokenRef.current?.({ skipCache: true });
        if (!token) return;
        const data = await getDirectionsRoute(token, {
          origin: pickupCoordinate,
          destination: dropoffCoordinate,
          cacheTtlSeconds: 1800,
        });
        const km = Number(data?.route?.distanceKm || 0);
        if (cancelled || !(km > 0)) return;
        setRouteDistanceKm((current) => (current === km ? current : km));
        setTripType(inferHireTripType(km));
      } catch {
        /* keep the local distance already shown */
      }
    })();
    return () => { cancelled = true; };
  }, [dropoffKey, pickupKey]);

  useEffect(() => {
    if (offerEditedRef.current) return;
    const localOffer = estimateOfferFromRoute(selectedRate, routeDistanceKm);
    if (localOffer) {
      setPassengerOfferAmount((current) => (current === localOffer ? current : localOffer));
    }

    const estimateKey = `${category}:${Number(routeDistanceKm || 0).toFixed(2)}`;
    if (!hasRoute || !category || !(routeDistanceKm > 0) || lastEstimateKeyRef.current === estimateKey) {
      return undefined;
    }
    lastEstimateKeyRef.current = estimateKey;

    let active = true;
    (async () => {
      try {
        const token = await getTokenRef.current?.({ skipCache: true });
        if (!token) return;
        const data = await getHireFareEstimate(token, {
          category,
          distanceKm: routeDistanceKm,
        });
        if (!active || offerEditedRef.current || data?.estimate?.min == null) return;
        const nextOffer = formatOfferFigure(data.estimate.min);
        if (nextOffer) {
          setPassengerOfferAmount((current) => (current === nextOffer ? current : nextOffer));
        }
      } catch {
        /* keep the local figure already shown */
      }
    })();
    return () => { active = false; };
  }, [category, hasRoute, routeDistanceKm, selectedRate]);

  useEffect(() => {
    const selected = route?.params?.selectedLocation;
    if (!selected?.field || !selected?.label) return;

    const nextPickupLabel = selected.field === 'pickup'
      ? String(selected.label).trim()
      : String(selected.pickupLabel ?? pickupLabel ?? '').trim();
    const nextDropoffLabel = selected.field === 'dropoff'
      ? String(selected.label).trim()
      : String(selected.dropoffLabel ?? dropoffLabel ?? '').trim();
    const nextPickupCoordinate = selected.field === 'pickup'
      ? (selected.coordinate || null)
      : (selected.pickupCoordinate ?? pickupCoordinate ?? null);
    const nextDropoffCoordinate = selected.field === 'dropoff'
      ? (selected.coordinate || null)
      : (selected.dropoffCoordinate ?? dropoffCoordinate ?? null);

    setPickupLabel(nextPickupLabel);
    setDropoffLabel(nextDropoffLabel);
    setPickupCoordinate(nextPickupCoordinate);
    setDropoffCoordinate(nextDropoffCoordinate);

    navigation.setParams({
      selectedLocation: undefined,
      pickupLabel: nextPickupLabel,
      dropoffLabel: nextDropoffLabel,
      pickupCoordinate: nextPickupCoordinate,
      dropoffCoordinate: nextDropoffCoordinate,
    });
  }, [navigation, route?.params?.selectedLocation]);

  const openLocationPicker = (field) => {
    navigation.setParams({
      pickupLabel,
      dropoffLabel,
      pickupCoordinate,
      dropoffCoordinate,
    });
    navigation.navigate('PassengerHireLocationPicker', {
      field,
      label: field === 'pickup' ? pickupLabel : dropoffLabel,
      coordinate: field === 'pickup' ? pickupCoordinate : dropoffCoordinate,
      pickupLabel,
      dropoffLabel,
      pickupCoordinate,
      dropoffCoordinate,
    });
  };

  const handleCreate = async () => {
    try {
      if (!title.trim()) {
        Alert.alert('Name required', 'Give this hire request a short name, e.g. Office move or Airport transfer.');
        return;
      }
      if (!pickupLabel.trim()) {
        Alert.alert('Pickup required', 'Choose a start point on the map or enter it manually.');
        return;
      }
      if (!dropoffLabel.trim()) {
        Alert.alert('Destination required', 'Choose an end point on the map or enter it manually.');
        return;
      }
      if (!pickupCoordinate || !dropoffCoordinate) {
        Alert.alert('Map pins required', 'Open each location and drop a pin (or pick a search result) so drivers can find you.');
        return;
      }
      if (!startAt.trim()) {
        Alert.alert('Start time required', 'Use format YYYY-MM-DD HH:MM');
        return;
      }
      const parsedStart = new Date(startAt.replace(' ', 'T'));
      if (Number.isNaN(parsedStart.getTime())) {
        Alert.alert('Invalid time', 'Use format YYYY-MM-DD HH:MM');
        return;
      }
      const offerAmount = Number(passengerOfferAmount);
      if (!(offerAmount > 0)) {
        Alert.alert('Offer required', 'Enter the amount you want to offer.');
        return;
      }
      if (!cargoTypes.length) {
        Alert.alert('Cargo required', 'Tick the type of cargo for this job.');
        return;
      }

      setSaving(true);
      const token = await getToken({ skipCache: true });
      await createHireRequest(token, {
        title: title.trim(),
        pickupLabel: pickupLabel.trim(),
        dropoffLabel: dropoffLabel.trim(),
        startAt: parsedStart.toISOString(),
        passengerCount: includesPeople ? (Number(passengerCount) || 1) : 1,
        category: category || 'truck',
        tripType,
        estimatedDistanceKm: routeDistanceKm ? Number(routeDistanceKm) : undefined,
        passengerOfferAmount: offerAmount,
        fareCurrency: preferredVehicle?.currency || 'USD',
        notes: formatHireJobNotes({ cargoTypes, jobNeeds }),
        paymentMethod: PAYMENT_METHOD_ONLINE,
        preferredHireVehicleId: preferredVehicle?.id || undefined,
        pickupLat: pickupCoordinate?.latitude,
        pickupLng: pickupCoordinate?.longitude,
        dropoffLat: dropoffCoordinate?.latitude,
        dropoffLng: dropoffCoordinate?.longitude,
      });
      const resetAt = Date.now();
      const tabNavigation = navigation.getParent();
      const routeNames = navigation.getState()?.routeNames || [];
      if (routeNames.includes('PassengerBookingHome')) {
        navigation.reset({
          index: 0,
          routes: [{ name: 'PassengerBookingHome', params: { resetRideDraftAt: resetAt } }],
        });
      } else if (routeNames.includes('PassengerHireHome')) {
        navigation.reset({
          index: 0,
          routes: [{ name: 'PassengerHireHome', params: { initialTab: 'jobs', refreshAt: resetAt } }],
        });
      }
      tabNavigation?.navigate('PassengerHome', {
        screen: 'PassengerBookingHome',
        params: { resetRideDraftAt: resetAt },
      });
      tabNavigation?.navigate('PassengerHiring', {
        screen: 'PassengerHireHome',
        params: { initialTab: 'jobs', refreshAt: resetAt },
      });
      Alert.alert('Request sent', 'Drivers can now send offers for your hire job.');
    } catch (err) {
      Alert.alert('Could not create request', err?.message || 'Try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="flex-1 bg-[#f6f7f3]">
      <View
        className="flex-row items-center justify-between"
        style={{ paddingTop: insets.top + 6, paddingHorizontal: 20, paddingBottom: 14 }}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          className="h-10 w-10 items-center justify-center rounded-full bg-white"
        >
          <Ionicons name="chevron-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text className="text-[18px] font-bold text-gray-900">{heading}</Text>
        <View className="h-10 w-10" />
      </View>

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        bottomOffset={tabBarHeight + 24}
        extraKeyboardSpace={tabBarHeight + 140}
        disableScrollOnKeyboardHide
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: tabBarHeight + insets.bottom + 48,
        }}
      >
          <View className="rounded-[28px] bg-white px-5 py-5">
            {preferredVehicle ? (
              <View className="mb-4 rounded-[18px] bg-blue-50 px-4 py-3">
                <Text className="text-sm font-bold text-blue-950">{preferredVehicle.title}</Text>
                <Text className="mt-1 text-sm text-blue-800">
                  {[preferredVehicle.category, preferredVehicle.make, preferredVehicle.model].filter(Boolean).join(' · ')}
                  {preferredVehicle.dailyRate != null
                    ? ` · from ${preferredVehicle.currency || 'USD'} ${Number(preferredVehicle.dailyRate).toFixed(0)}`
                    : ''}
                </Text>
              </View>
            ) : null}

            <Field
              label="Request name"
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Office move, Airport transfer"
              autoCapitalize="sentences"
            />

            <LocationRow
              label="Start point"
              value={pickupLabel}
              pinned={!!pickupCoordinate}
              placeholder="Search or pin on map"
              onPress={() => openLocationPicker('pickup')}
            />
            <LocationRow
              label="End point"
              value={dropoffLabel}
              pinned={!!dropoffCoordinate}
              placeholder="Search or pin on map"
              onPress={() => openLocationPicker('dropoff')}
            />

            {hasRoute ? (
              <View className="mt-4">
                <Text className="mb-2 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">
                  Your offer (USD)
                </Text>
                <View className="flex-row items-center rounded-[18px] border border-gray-200 bg-[#f8fafc] px-4">
                  <Text className="text-2xl font-bold text-gray-900">$</Text>
                  <TextInput
                    value={passengerOfferAmount}
                    onChangeText={(value) => {
                      offerEditedRef.current = true;
                      setPassengerOfferAmount(value);
                    }}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    className="ml-2 h-14 flex-1 text-2xl font-bold text-gray-900"
                  />
                </View>
              </View>
            ) : (
              <Text className="mt-4 text-sm text-gray-500">
                Set start and end points to see your offer.
              </Text>
            )}

            <Field
              label="Start date & time"
              value={startAt}
              onChangeText={setStartAt}
              placeholder="2026-09-20 08:00"
              autoCapitalize="none"
            />

            <TickSection
              label="Type of cargo"
              options={HIRE_CARGO_TYPES}
              values={cargoTypes}
              onToggle={(value) => setCargoTypes((current) => toggleValue(current, value))}
            />
            <TickSection
              label="Need help"
              options={HIRE_HELP_OPTIONS}
              values={jobNeeds}
              onToggle={(value) => setJobNeeds((current) => toggleValue(current, value))}
            />
            <TickSection
              label="Extra details"
              options={HIRE_EXTRA_OPTIONS}
              values={jobNeeds}
              onToggle={(value) => setJobNeeds((current) => toggleValue(current, value))}
            />

            {includesPeople ? (
              <Field
                label="How many people"
                value={passengerCount}
                onChangeText={setPassengerCount}
                keyboardType="number-pad"
                placeholder="1"
              />
            ) : null}

            <Text className="mb-2 mt-4 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">Trip type</Text>
            <View className="flex-row flex-wrap gap-2">
              {[
                { value: 'local', label: 'Local' },
                { value: 'intercity', label: 'Intercity' },
              ].map((item) => (
                <TouchableOpacity
                  key={item.value}
                  onPress={() => setTripType(item.value)}
                  className="rounded-full px-3 py-2"
                  style={{ backgroundColor: tripType === item.value ? PRIMARY_BLUE : '#f1f5f9' }}
                >
                  <Text
                    className="text-xs font-semibold"
                    style={{ color: tripType === item.value ? '#fff' : '#334155' }}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text className="mb-2 mt-4 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">Vehicle type</Text>
            <View className="flex-row flex-wrap gap-2">
              {vehicleTypes.map((item) => (
                <TouchableOpacity
                  key={item.value}
                  onPress={() => setCategory(item.value)}
                  className="rounded-full px-3 py-2"
                  style={{ backgroundColor: category === item.value ? PRIMARY_BLUE : '#f1f5f9' }}
                >
                  <Text
                    className="text-xs font-semibold"
                    style={{ color: category === item.value ? '#fff' : '#334155' }}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              onPress={handleCreate}
              disabled={saving}
              className="mt-6 h-14 items-center justify-center rounded-[18px]"
              style={{ backgroundColor: PRIMARY_BLUE, opacity: saving ? 0.7 : 1 }}
            >
              {saving ? <ActivityIndicator color="#fff" /> : (
                <Text className="text-sm font-bold uppercase text-white">Send hire request</Text>
              )}
            </TouchableOpacity>
          </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

function TickSection({ label, options, values, onToggle }) {
  return (
    <View className="mt-4">
      <Text className="mb-2 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">
        {label}
      </Text>
      <TickGroup options={options} values={values} onToggle={onToggle} />
    </View>
  );
}

function TickGroup({ options, values, onToggle }) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((item) => {
        const selected = values.includes(item.value);
        return (
          <TouchableOpacity
            key={item.value}
            onPress={() => onToggle(item.value)}
            className="flex-row items-center rounded-full px-3 py-2"
            style={{ backgroundColor: selected ? PRIMARY_BLUE : '#f1f5f9' }}
          >
            <Ionicons
              name={selected ? 'checkbox' : 'square-outline'}
              size={16}
              color={selected ? '#fff' : '#334155'}
            />
            <Text
              className="ml-2 text-xs font-semibold"
              style={{ color: selected ? '#fff' : '#334155' }}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function LocationRow({ label, value, placeholder, pinned, onPress }) {
  return (
    <View className="mt-4">
      <Text className="mb-2 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">{label}</Text>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.85}
        className="rounded-[18px] border border-gray-200 bg-[#f8fafc] px-4 py-3"
      >
        <View className="flex-row items-center">
          <Ionicons name="location-outline" size={18} color={PRIMARY_BLUE} />
          <View className="ml-3 flex-1">
            <Text className={`text-base ${value ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>
              {value || placeholder}
            </Text>
            <Text className="mt-1 text-xs text-slate-500">
              {pinned ? 'Map pin set · tap to change' : 'Search, map pin, or type manually'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
        </View>
      </TouchableOpacity>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
}) {
  return (
    <View className="mt-4">
      <Text className="mb-2 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        className="h-12 rounded-[18px] border border-gray-200 bg-[#f8fafc] px-4 text-base text-gray-900"
      />
    </View>
  );
}

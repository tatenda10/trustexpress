import React, { useEffect, useMemo, useState } from 'react';
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
import { createHireRequest } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

const CATEGORIES = [
  { value: 'truck', label: 'Truck' },
  { value: 'moving_van', label: 'Moving van' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'van', label: 'Van' },
  { value: 'suv', label: 'SUV' },
  { value: 'bus', label: 'Bus' },
  { value: 'sedan', label: 'Sedan' },
];

function defaultStartAtLocal() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function PassengerHireCreateScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { getToken } = useAuth();
  const params = route?.params || {};
  const preferredVehicle = params.preferredVehicle || null;

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
  const [passengerOfferAmount, setPassengerOfferAmount] = useState(
    preferredVehicle?.dailyRate != null ? String(preferredVehicle.dailyRate) : ''
  );
  const [notes, setNotes] = useState(
    preferredVehicle
      ? `Requesting ${preferredVehicle.title}${preferredVehicle.make || preferredVehicle.model ? ` (${[preferredVehicle.make, preferredVehicle.model].filter(Boolean).join(' ')})` : ''}.`
      : ''
  );
  const [saving, setSaving] = useState(false);

  const heading = useMemo(
    () => (preferredVehicle ? 'Request this vehicle' : 'Hire request details'),
    [preferredVehicle]
  );

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
    // Persist current points on the route before leaving, so returning cannot wipe them.
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
      const offerAmount = passengerOfferAmount.trim() ? Number(passengerOfferAmount) : null;
      if (offerAmount != null && !(offerAmount > 0)) {
        Alert.alert('Invalid fee', 'Enter a valid offer fee, or leave it blank.');
        return;
      }
      if (!notes.trim()) {
        Alert.alert('Specs required', 'Add notes such as load size, helpers needed, or special instructions.');
        return;
      }

      setSaving(true);
      const token = await getToken({ skipCache: true });
      await createHireRequest(token, {
        title: title.trim(),
        pickupLabel: pickupLabel.trim(),
        dropoffLabel: dropoffLabel.trim(),
        startAt: parsedStart.toISOString(),
        passengerCount: Number(passengerCount) || 1,
        category: category || 'truck',
        passengerOfferAmount: offerAmount,
        fareCurrency: preferredVehicle?.currency || 'USD',
        notes: notes.trim(),
        preferredHireVehicleId: preferredVehicle?.id || undefined,
        pickupLat: pickupCoordinate?.latitude,
        pickupLng: pickupCoordinate?.longitude,
        dropoffLat: dropoffCoordinate?.latitude,
        dropoffLng: dropoffCoordinate?.longitude,
      });
      Alert.alert('Request sent', 'Drivers can now send offers for your hire job.');
      navigation.navigate('PassengerHiring', {
        screen: 'PassengerHireHome',
        params: { initialTab: 'jobs', refreshAt: Date.now() },
      });
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

            {(params.distanceKm || params.estimatedMinutes) ? (
              <View className="mb-4 rounded-[18px] bg-slate-50 px-4 py-3">
                <Text className="text-sm text-slate-600">
                  Route ready
                  {params.distanceKm ? ` · ${Number(params.distanceKm).toFixed(1)} km` : ''}
                  {params.estimatedMinutes ? ` · ~${params.estimatedMinutes} min` : ''}
                </Text>
              </View>
            ) : null}

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

            <View className="mt-4 rounded-[18px] border border-blue-100 bg-blue-50 px-4 py-4">
              <Text className="text-xs font-semibold uppercase tracking-[1.2px] text-blue-800">
                Your offer (USD)
              </Text>
              <Text className="mt-1 text-sm text-blue-900">
                Add what you are willing to pay when you create this request. Drivers will see it with your job.
              </Text>
              <TextInput
                value={passengerOfferAmount}
                onChangeText={setPassengerOfferAmount}
                keyboardType="decimal-pad"
                placeholder="e.g. 120"
                className="mt-3 h-12 rounded-[14px] border border-blue-100 bg-white px-4 text-base text-gray-900"
              />
            </View>

            <Field
              label="Start date & time"
              value={startAt}
              onChangeText={setStartAt}
              placeholder="2026-09-20 08:00"
              autoCapitalize="none"
            />
            <Field
              label="People / helpers"
              value={passengerCount}
              onChangeText={setPassengerCount}
              keyboardType="number-pad"
              placeholder="1"
            />

            <Text className="mb-2 mt-4 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">Vehicle type</Text>
            <View className="flex-row flex-wrap gap-2">
              {CATEGORIES.map((item) => (
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

            <Field
              label="Specs & notes"
              value={notes}
              onChangeText={setNotes}
              placeholder="Load type, size, helpers, waiting time, etc."
              multiline
            />

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
  multiline = false,
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
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        scrollEnabled={multiline}
        className={`${multiline ? 'min-h-[120px] py-3' : 'h-12'} rounded-[18px] border border-gray-200 bg-[#f8fafc] px-4 text-base text-gray-900`}
      />
    </View>
  );
}

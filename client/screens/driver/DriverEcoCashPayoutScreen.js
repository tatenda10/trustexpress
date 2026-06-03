import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUser, useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { updateDriverPayoutDetails } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import { useDriverStatus } from '../../context/DriverStatusContext';

export default function DriverEcoCashPayoutScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { getToken } = useAuth();
  const { driverStatus, refetchDriverStatus } = useDriverStatus();
  const getTokenRef = useRef(getToken);
  const refetchRef = useRef(refetchDriverStatus);
  const [ecocashNumber, setEcocashNumber] = useState('');
  const [ecocashRegisteredName, setEcocashRegisteredName] = useState('');
  const [saving, setSaving] = useState(false);

  getTokenRef.current = getToken;
  refetchRef.current = refetchDriverStatus;

  useEffect(() => {
    setEcocashNumber(String(driverStatus?.driverProfile?.ecocashNumber || '').trim());
    setEcocashRegisteredName(
      String(
        driverStatus?.driverProfile?.ecocashRegisteredName ||
        [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
        ''
      ).trim()
    );
  }, [driverStatus?.driverProfile?.ecocashNumber, driverStatus?.driverProfile?.ecocashRegisteredName, user?.firstName, user?.lastName]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const token = await getTokenRef.current({ skipCache: true });
      if (!token) throw new Error('Not signed in');
      await updateDriverPayoutDetails(token, {
        ecocashNumber,
        ecocashRegisteredName,
      });
      await refetchRef.current();
      Alert.alert('Saved', 'Your EcoCash payout details were updated.');
      navigation.goBack();
    } catch (error) {
      Alert.alert('Save failed', error?.message || 'Could not save your EcoCash payout details.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="flex-1 bg-[#f6f7f3]">
      <View
        className="flex-row items-center justify-between bg-[#f6f7f3]"
        style={{ paddingTop: insets.top + 6, paddingHorizontal: 20, paddingBottom: 14 }}
      >
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => navigation.goBack()}
          className="h-10 w-10 items-center justify-center rounded-full bg-white"
        >
          <Ionicons name="chevron-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text className="text-[18px] font-bold text-gray-900">EcoCash details</Text>
        <View className="h-10 w-10" />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="rounded-[28px] bg-white px-5 py-5">
          <View className="flex-row items-center">
            <View className="h-11 w-11 items-center justify-center rounded-full bg-[#eff6ff]">
              <Ionicons name="cash-outline" size={20} color={PRIMARY_BLUE} />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-[15px] font-bold text-gray-900">Driver payout details</Text>
              <Text className="mt-1 text-sm text-gray-500">
                Enter the EcoCash number that is registered in your own legal name.
              </Text>
            </View>
          </View>

          <View className="mt-5">
            <Text className="mb-2 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">EcoCash Number</Text>
            <TextInput
              value={ecocashNumber}
              onChangeText={setEcocashNumber}
              placeholder="07XXXXXXXX or 2637XXXXXXXX"
              keyboardType="phone-pad"
              autoCapitalize="none"
              className="h-12 rounded-[18px] border border-gray-200 bg-[#f8fafc] px-4 text-base text-gray-900"
            />
          </View>

          <View className="mt-4">
            <Text className="mb-2 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">Registered Name</Text>
            <TextInput
              value={ecocashRegisteredName}
              onChangeText={setEcocashRegisteredName}
              placeholder="Name registered on EcoCash"
              className="h-12 rounded-[18px] border border-gray-200 bg-[#f8fafc] px-4 text-base text-gray-900"
            />
          </View>

          <View className="mt-4 rounded-[18px] bg-amber-50 px-4 py-3">
            <Text className="text-sm text-amber-800">
              Note: this EcoCash number must be registered in your own name. Admin may hold or reject disbursement if the name does not match.
            </Text>
          </View>

          <TouchableOpacity
            onPress={handleSave}
            disabled={saving}
            className="mt-5 h-12 items-center justify-center rounded-[18px]"
            style={{ backgroundColor: PRIMARY_BLUE, opacity: saving ? 0.7 : 1 }}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text className="text-sm font-bold uppercase text-white">Save EcoCash Details</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

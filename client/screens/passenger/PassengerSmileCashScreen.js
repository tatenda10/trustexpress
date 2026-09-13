import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getMe, linkPassengerSmileCash, openPassengerSmileCash } from '../../api';
import SmileCashIdentityFields from '../../components/smile/SmileCashIdentityFields';
import { PRIMARY_BLUE } from '../../constants/colors';

export default function PassengerSmileCashScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const [profile, setProfile] = useState(null);
  const [mobile, setMobile] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  getTokenRef.current = getToken;

  const identity = profile?.passengerIdentity || {};
  const isActive = String(identity.smileCashStatus || '').toLowerCase() === 'active';

  const load = async () => {
    try {
      setLoading(true);
      const token = await getTokenRef.current({ skipCache: true });
      if (!token) throw new Error('Not signed in');
      const data = await getMe(token);
      setProfile(data);
      const nextIdentity = data?.passengerIdentity || {};
      setMobile(String(nextIdentity.smileCashMobile || user?.primaryPhoneNumber?.phoneNumber || '').trim());
      setIdNumber(String(nextIdentity.nationalIdNumber || '').trim());
      setDateOfBirth(String(nextIdentity.dateOfBirth || '').trim());
      setGender(String(nextIdentity.gender || '').trim().toUpperCase());
    } catch (error) {
      Alert.alert('Online wallet', error?.message || 'Could not load online wallet details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpen = async () => {
    const payload = {
      mobile,
      idNumber,
      dateOfBirth,
      gender,
    };
    try {
      setSaving(true);
      const token = await getTokenRef.current({ skipCache: true });
      if (!token) throw new Error('Not signed in');
      await openPassengerSmileCash(token, payload);
      await load();
      Alert.alert('Online wallet', 'Your online wallet registration was submitted successfully.');
    } catch (error) {
      if (error?.code === 'SMILE_CASH_MOBILE_ALREADY_TAKEN') {
        Alert.alert(
          'Online wallet already exists',
          'This mobile number already has an online wallet. If it belongs to you, link it to your Trust Express account.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Link existing',
              onPress: async () => {
                try {
                  setSaving(true);
                  const token = await getTokenRef.current({ skipCache: true });
                  if (!token) throw new Error('Not signed in');
                  await linkPassengerSmileCash(token, payload);
                  await load();
                  Alert.alert('Online wallet', 'Your existing online wallet has been linked.');
                } catch (linkError) {
                  Alert.alert('Online wallet', linkError?.message || 'Could not link online wallet.');
                } finally {
                  setSaving(false);
                }
              },
            },
          ]
        );
        return;
      }
      Alert.alert('Online wallet', error?.message || 'Could not open online wallet.');
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
        <Text className="text-[18px] font-bold text-gray-900">Online wallet</Text>
        <View className="h-10 w-10" />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={PRIMARY_BLUE} />
          <Text className="mt-3 text-sm text-gray-500">Loading wallet details...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        >
          <View>
            {isActive ? (
              <View className="mb-4 rounded-[18px] bg-emerald-50 px-4 py-3">
                <Text className="text-sm font-semibold text-emerald-800">
                  Active on {identity.smileCashMobile}
                </Text>
              </View>
            ) : null}

            {identity.smileCashLastError && !isActive ? (
              <View className="mb-4 rounded-[18px] bg-rose-50 px-4 py-3">
                <Text className="text-sm text-rose-800">{identity.smileCashLastError}</Text>
              </View>
            ) : null}

            <View>
              <Text className="mb-2 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">Mobile number</Text>
              <TextInput
                value={mobile}
                onChangeText={setMobile}
                placeholder="07XXXXXXXX or 2637XXXXXXXX"
                keyboardType="phone-pad"
                editable={!isActive}
                className="h-12 rounded-[18px] border border-gray-200 bg-white px-4 text-base text-gray-900"
              />
            </View>

            <View className="mt-4">
              <Text className="mb-2 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">National ID number</Text>
              <TextInput
                value={idNumber}
                onChangeText={setIdNumber}
                placeholder="Enter national ID"
                autoCapitalize="characters"
                editable={!isActive}
                className="h-12 rounded-[18px] border border-gray-200 bg-white px-4 text-base text-gray-900"
              />
            </View>

            <SmileCashIdentityFields
              dateOfBirth={dateOfBirth}
              gender={gender}
              disabled={isActive}
              onDateOfBirthChange={setDateOfBirth}
              onGenderChange={setGender}
            />

            {!isActive ? (
              <TouchableOpacity
                onPress={handleOpen}
                disabled={saving}
                className="mt-5 h-12 items-center justify-center rounded-[18px]"
                style={{ backgroundColor: PRIMARY_BLUE, opacity: saving ? 0.7 : 1 }}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-sm font-bold uppercase text-white">Open online wallet</Text>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

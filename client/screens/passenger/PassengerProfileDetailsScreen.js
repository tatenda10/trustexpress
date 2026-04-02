import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/clerk-expo';
import { getMe, updateMe } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

export default function PassengerProfileDetailsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    if (!isFocused) return undefined;
    let active = true;

    const loadProfile = async () => {
      try {
        setLoading(true);
        const token = await getTokenRef.current();
        if (!token) throw new Error('Not signed in');
        const data = await getMe(token);
        if (!active) return;
        setFirstName(data?.first_name || '');
        setLastName(data?.last_name || '');
        setEmail(data?.email || '');
      } catch (error) {
        if (!active) return;
        Alert.alert('Profile unavailable', error?.message || 'Could not load your profile details.');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadProfile();
    return () => {
      active = false;
    };
  }, [isFocused]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      await updateMe(token, { firstName, lastName });
      Alert.alert('Profile updated', 'Your passenger profile has been saved.');
      navigation.goBack();
    } catch (error) {
      Alert.alert('Save failed', error?.message || 'Could not update your profile.');
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
        <TouchableOpacity onPress={() => navigation.goBack()} className="h-10 w-10 items-center justify-center rounded-full bg-white">
          <Ionicons name="chevron-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text className="text-[18px] font-bold text-gray-900">Profile details</Text>
        <View className="h-10 w-10" />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center px-5">
          <ActivityIndicator size="large" color={PRIMARY_BLUE} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 32 }} showsVerticalScrollIndicator={false}>
          <View className="rounded-[28px] bg-white px-5 py-5">
            <Text className="mb-2 text-sm font-medium text-gray-700">Email</Text>
            <View className="rounded-[18px] bg-[#f8fafc] px-4 py-3">
              <Text className="text-base text-gray-500">{email || 'No email connected'}</Text>
            </View>

            <Text className="mb-2 mt-4 text-sm font-medium text-gray-700">First name</Text>
            <TextInput
              value={firstName}
              onChangeText={setFirstName}
              placeholder="First name"
              placeholderTextColor="#9ca3af"
              className="rounded-[18px] border border-gray-200 px-4 py-3 text-base text-gray-900"
            />

            <Text className="mb-2 mt-4 text-sm font-medium text-gray-700">Last name</Text>
            <TextInput
              value={lastName}
              onChangeText={setLastName}
              placeholder="Last name"
              placeholderTextColor="#9ca3af"
              className="rounded-[18px] border border-gray-200 px-4 py-3 text-base text-gray-900"
            />

            <TouchableOpacity
              onPress={handleSave}
              disabled={saving}
              className="mt-5 h-12 items-center justify-center rounded-[18px]"
              style={{ backgroundColor: PRIMARY_BLUE, opacity: saving ? 0.7 : 1 }}
            >
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-base font-bold text-white">Save profile</Text>}
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

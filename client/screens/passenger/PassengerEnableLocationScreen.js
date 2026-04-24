import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { PRIMARY_BLUE } from '../../constants/colors';

const PassengerEnableLocationScreen = ({ onGranted }) => {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);

  const handleEnableLocation = async () => {
    try {
      setLoading(true);
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status === 'granted') {
        onGranted?.();
        return;
      }
      Alert.alert(
        'Location required',
        'TrustCars needs your location to set pickups, match you with drivers, and estimate fares. Allow location access in Settings, then return and tap Continue again.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ],
      );
    } catch (error) {
      Alert.alert('Location failed', error?.message || 'Could not request location permission.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 bg-white px-6" style={{ paddingTop: insets.top + 20, paddingBottom: insets.bottom + 24 }}>
      <View className="flex-1 items-center justify-center">
        <View className="h-24 w-24 items-center justify-center rounded-full bg-[#dbeafe]">
          <Ionicons name="location" size={44} color={PRIMARY_BLUE} />
        </View>
        <Text className="mt-8 text-center text-3xl font-bold text-gray-900">Enable location</Text>
        <Text className="mt-4 text-center text-base leading-7 text-gray-500">
          We use your location to set pickup points, show nearby drivers, and calculate fares. Foreground access is
          required before you can continue — you can enable it here or in system Settings.
        </Text>
      </View>

      <TouchableOpacity
        onPress={handleEnableLocation}
        disabled={loading}
        className="h-14 items-center justify-center rounded-[20px]"
        style={{ backgroundColor: PRIMARY_BLUE, opacity: loading ? 0.7 : 1 }}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text className="text-lg font-bold text-white">Continue</Text>
        )}
      </TouchableOpacity>
    </View>
  );
};

export default PassengerEnableLocationScreen;

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ROLE_STORAGE_KEY = 'trust_express_role';

const RoleSelectionScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();

  const setRoleAndNavigate = (role, screen) => {
    AsyncStorage.setItem(ROLE_STORAGE_KEY, role).catch(() => {});
    navigation.navigate(screen);
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1">
        {/* App Logo - Top */}
        <View className="pt-12 items-center">
          <Image
            source={require('../../assets/logo.png')}
            className="w-64 h-64"
            resizeMode="contain"
          />
        </View>

        {/* Header - Below Logo */}
        <View className="items-center mb-8">
          <Text className="text-4xl font-bold text-gray-900 mb-2">Trust Express</Text>
          <Text className="text-sm text-gray-600 uppercase tracking-wider">RELIABLE RIDES. ZIMBABWE</Text>
        </View>

        {/* Spacer */}
        <View className="flex-1" />

        {/* Role Selection Buttons - Bottom, Side by Side, Within SafeAreaView */}
        <View 
          className="w-full px-5 flex-row gap-4"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <TouchableOpacity
            className="flex-1 p-4 rounded-full items-center bg-primary shadow-lg"
            onPress={() => setRoleAndNavigate('passenger', 'PassengerWelcome')}
          >
            <Text className="text-lg font-semibold text-white">Passenger</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="flex-1 p-4 rounded-full items-center bg-primary shadow-lg"
            onPress={() => setRoleAndNavigate('driver', 'DriverWelcome')}
          >
            <Text className="text-lg font-semibold text-white">Driver</Text>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View 
          className="items-center"
          style={{ paddingBottom: Math.max(insets.bottom, 8) }}
        >
          <Text className="text-xs text-gray-500">Powered by Trust Express</Text>
        </View>
      </View>
    </SafeAreaView>
  );
};

export default RoleSelectionScreen;


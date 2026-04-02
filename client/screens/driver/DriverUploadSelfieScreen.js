import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useUser } from '@clerk/clerk-expo';

const STORAGE_KEY_PREFIX = 'trust_express_driver_docs_';

const DriverUploadSelfieScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { user } = useUser();

  const handleContinue = async () => {
    try {
      const key = `${STORAGE_KEY_PREFIX}${user?.id || 'default'}`;
      await AsyncStorage.setItem(key, 'true');
    } catch (e) {
      // ignore
    }
    navigation.replace('DriverHome');
  };

  return (
    <View className="flex-1 bg-white">
      <View
        className="flex-row items-center border-b border-gray-100 bg-white"
        style={{ paddingTop: insets.top, paddingHorizontal: 20, paddingBottom: 12 }}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} className="p-2 -ml-2">
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: Math.max(insets.bottom, 24) }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-2xl font-bold text-gray-900 mb-2">Upload selfie</Text>
        <Text className="text-sm text-gray-600 mb-8">
          Take a clear selfie for your driver profile. (Static screen – upload coming later.)
        </Text>

        <View className="border-2 border-dashed border-gray-300 rounded-2xl aspect-square max-h-72 items-center justify-center mb-8 bg-gray-50">
          <Ionicons name="camera-outline" size={64} color="#9ca3af" />
          <Text className="text-gray-500 mt-3 text-center px-4">Selfie placeholder</Text>
        </View>

        <TouchableOpacity
          className="p-4 rounded-xl bg-primary items-center"
          onPress={handleContinue}
        >
          <Text className="text-white text-lg font-semibold">Continue</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

export default DriverUploadSelfieScreen;

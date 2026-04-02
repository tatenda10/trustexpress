import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  SafeAreaView,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

const SplashScreen = ({ route }) => {
  const navigation = useNavigation();
  const [progress, setProgress] = useState(0);
  const redirectTo = route?.params?.redirectTo || null;

  useEffect(() => {
    let redirectTimeout = null;
    // Simulate loading progress
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          if (redirectTo) {
            redirectTimeout = setTimeout(() => {
              const state = navigation.getState?.();
              const routeNames = state?.routeNames || [];
              if (routeNames.includes(redirectTo)) {
                navigation.replace(redirectTo);
              }
            }, 500);
          }
          return 100;
        }
        return prev + 2;
      });
    }, 50);

    return () => {
      clearInterval(interval);
      if (redirectTimeout) clearTimeout(redirectTimeout);
    };
  }, [navigation, redirectTo]);

  return (
    <SafeAreaView className="flex-1 bg-primary">
      <View className="flex-1 justify-center items-center px-5">
        {/* Logo */}
        <View className="mb-8 items-center">
          <View className="mb-6">
            <Image
              source={require('../../assets/logo.png')}
              className="w-32 h-32"
              resizeMode="contain"
            />
          </View>
          <Text className="text-4xl font-bold text-white mb-2">Trust Express</Text>
          <Text className="text-sm text-white uppercase tracking-wider">RELIABLE RIDES. ZIMBABWE</Text>
        </View>

        {/* Loading Indicator */}
        <View className="w-full max-w-xs items-center mt-16">
          {/* Progress Bar Container */}
          <View className="w-full relative mb-2">
            {/* Progress Bar Background */}
            <View className="w-full h-1 bg-white/30 rounded-full" />
            {/* Progress Bar Fill */}
            <View 
              className="h-1 bg-white rounded-full absolute left-0 top-0"
              style={{ width: `${progress}%` }}
            />
            {/* Spinner positioned centered above the progress bar */}
            <View className="absolute -top-3 w-full items-center">
              <ActivityIndicator size="small" color="white" />
            </View>
          </View>
          
          {/* INITIALIZING text */}
          <View className="w-full items-center mt-1">
            <Text className="text-white uppercase text-sm font-semibold">INITIALIZING</Text>
          </View>
        </View>

        {/* Footer */}
        <View className="absolute bottom-8">
          <Text className="text-xs text-white/70">Powered by Trust Express</Text>
        </View>
      </View>
    </SafeAreaView>
  );
};

export default SplashScreen;

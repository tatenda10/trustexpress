import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  ImageBackground,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const PassengerWelcomeScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ImageBackground
        source={require('../../assets/passenger-welcome.png')}
        className="flex-1"
        resizeMode="cover"
        style={styles.imageBackground}
      >
        {/* Darkened overlay for better text readability */}
        <View className="absolute inset-0 bg-black/50" />
        
        <View
          className="flex-1 justify-between px-5"
          style={{
            paddingTop: Math.max(insets.top, 16),
            paddingBottom: Math.max(insets.bottom, 80),
          }}
        >
          {/* Title - upper part of screen, ~1/4 down, not at very top */}
          <View className="flex-1 justify-center">
            <View className="items-center">
              <Text className="text-4xl font-bold text-white mb-3 text-center">
                Welcome to Trust Express
              </Text>
              <Text className="text-lg text-white/90 text-center px-4">
                Book your ride in minutes
              </Text>
            </View>
          </View>

          {/* Buttons - same spacing from bottom as role selection (moved up) */}
          <View
            className="w-full flex-row gap-4"
            style={{ marginBottom: 24 }}
          >
            <TouchableOpacity
              className="flex-1 p-4 rounded-full items-center justify-center flex-row gap-2 bg-primary shadow-lg"
              onPress={() => navigation.navigate('PassengerOnboarding')}
            >
              <Ionicons name="rocket-outline" size={22} color="#fff" />
              <Text className="text-white text-lg font-semibold">Get Started</Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="flex-1 p-4 rounded-full items-center justify-center flex-row gap-2 bg-white/90 shadow-lg"
              onPress={() => navigation.navigate('PassengerLogin')}
            >
              <Ionicons name="log-in-outline" size={22} color="#1f2937" />
              <Text className="text-gray-900 text-lg font-semibold">Login</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ImageBackground>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  imageBackground: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
});

export default PassengerWelcomeScreen;


import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Dimensions,
} from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PRIMARY_BLUE } from '../../../constants/colors';

const { width } = Dimensions.get('window');

const onboardingData = [
  {
    title: 'Reliable Rides',
    description: 'Get a professional driver at your doorstep in minutes.',
    icon: 'car-sport',
  },
  {
    title: 'Real-Time Tracking',
    description: 'Track your ride in real-time with live GPS',
    icon: 'navigate',
  },
  {
    title: 'Transparent Fixed Pricing',
    description: 'Know your fare upfront. No surprises, no negotiation',
    icon: 'pricetag',
  },
  {
    title: 'Safe & Secure',
    description: 'Verified drivers and emergency support',
    icon: 'shield-checkmark',
  },
];

const PassengerOnboardingScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [locationPermission, setLocationPermission] = useState(null);

  const handleNext = () => {
    if (currentIndex < onboardingData.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      requestPermissions();
    }
  };

  const handleSkip = () => {
    requestPermissions();
  };

  const requestPermissions = async () => {
    try {
      // Request location permission
      const { status } = await Location.requestForegroundPermissionsAsync();
      setLocationPermission(status);

      // Request notification permission (optional)
      // You can add notification permission request here

      // Navigate to create account after permissions
      navigation.navigate('PassengerCreateAccount');
    } catch (error) {
      console.error('Error requesting permissions:', error);
      // Still navigate even if permission denied
      navigation.navigate('PassengerCreateAccount');
    }
  };

  const scrollViewRef = React.useRef(null);

  useEffect(() => {
    if (scrollViewRef.current) {
      scrollViewRef.current.scrollTo({
        x: currentIndex * width,
        animated: true,
      });
    }
  }, [currentIndex]);

  const iconContainerStyle = { backgroundColor: 'rgba(32, 110, 255, 0.12)', borderColor: 'rgba(32, 110, 255, 0.25)' };

  const renderIllustration = (slide) => (
    <View className="w-full items-center justify-center mb-10">
      <View className="w-44 h-44 rounded-[28px] items-center justify-center border" style={iconContainerStyle}>
        <Ionicons name={slide.icon} size={72} color={PRIMARY_BLUE} />
      </View>
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-white">
      {/* Skip button - safe area */}
      <View
        className="absolute right-5 z-10"
        style={{ top: Math.max(insets.top, 12) + 8 }}
      >
        <TouchableOpacity onPress={handleSkip} className="py-2 px-1">
          <Text className="text-gray-500 text-base font-medium">Skip</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}
      >
        {onboardingData.map((slide, index) => (
          <View key={index} style={{ width, paddingTop: Math.max(insets.top, 12) + 48 }} className="flex-1 justify-center items-center px-6">
            <View className="items-center w-full max-w-sm">
              {renderIllustration(slide)}
              <Text className="text-2xl font-bold text-gray-900 mb-2 text-center">{slide.title}</Text>
              <Text className="text-base text-gray-600 text-center leading-6">{slide.description}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <View
        className="px-5 pt-2"
        style={{ paddingBottom: Math.max(insets.bottom, 24) + 8 }}
      >
        {/* Pagination dots */}
        <View className="flex-row justify-center mb-6 gap-2">
          {onboardingData.map((_, index) => (
            <View
              key={index}
              className={`h-2 rounded-full ${
                index === currentIndex
                  ? 'bg-primary w-6'
                  : 'bg-gray-300 w-2'
              }`}
            />
          ))}
        </View>

        {/* Next button */}
        <TouchableOpacity
          className="p-4 rounded-xl items-center bg-primary flex-row justify-center gap-2 shadow-lg"
          onPress={handleNext}
        >
          <Text className="text-white text-lg font-semibold">Next</Text>
          <Ionicons name="arrow-forward" size={20} color="white" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

export default PassengerOnboardingScreen;


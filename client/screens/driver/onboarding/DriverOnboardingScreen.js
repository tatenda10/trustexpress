import React, { useState, useRef, useEffect } from 'react';
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
import { useAgentInvite } from '../../../context/AgentInviteContext';

const { width } = Dimensions.get('window');

const onboardingData = [
  {
    title: 'Drive with Trust Express',
    description: 'Earn on your schedule',
    icon: 'car-sport',
  },
  {
    title: 'Flexible Earnings',
    description: 'Set your own hours and earn competitive rates',
    icon: 'wallet',
  },
  {
    title: '24/7 Support',
    description: 'Get help whenever you need it from our support team',
    icon: 'headset',
  },
  {
    title: 'Verified Drivers',
    description: 'Join our community of verified, trusted drivers',
    icon: 'shield-checkmark',
  },
];

const DriverOnboardingScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { inviteData } = useAgentInvite();
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollViewRef = useRef(null);

  useEffect(() => {
    if (scrollViewRef.current) {
      scrollViewRef.current.scrollTo({
        x: currentIndex * width,
        animated: true,
      });
    }
  }, [currentIndex]);

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
      // Request location permission (required for drivers)
      const { status } = await Location.requestForegroundPermissionsAsync();
      
      // Request notification permission (required for drivers)
      // You can add notification permission request here

      // Navigate to create account after permissions
      navigation.navigate('DriverCreateAccount');
    } catch (error) {
      console.error('Error requesting permissions:', error);
      // Still navigate even if permission denied
      navigation.navigate('DriverCreateAccount');
    }
  };

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
              {index === 0 && inviteData?.agentName ? (
                <View className="mb-6 w-full rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3">
                  <Text className="text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-700">Agent Invite</Text>
                  <Text className="mt-1 text-center text-sm font-medium text-blue-900">
                    You were invited by {inviteData.agentName}{inviteData.agentCode ? ` (${inviteData.agentCode})` : ''}.
                  </Text>
                </View>
              ) : null}
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

export default DriverOnboardingScreen;


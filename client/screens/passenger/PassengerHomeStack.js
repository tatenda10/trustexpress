import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import PassengerHomeScreen from './PassengerHomeScreen.js';
import PassengerChooseRideScreen from './PassengerChooseRideScreen.js';
import PassengerNearbyCarsScreen from './PassengerNearbyCarsScreen.js';
import PassengerRideTrackingScreen from './PassengerRideTrackingScreen.js';
import RideChatScreen from '../shared/RideChatScreen.js';
import PassengerHireHomeScreen from './PassengerHireHomeScreen.js';
import PassengerHireCreateScreen from './PassengerHireCreateScreen.js';
import PassengerHireDetailScreen from './PassengerHireDetailScreen.js';
import PassengerHireLocationPickerScreen from './PassengerHireLocationPickerScreen.js';
import PassengerHireTrackingScreen from './PassengerHireTrackingScreen.js';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary.js';

const Stack = createNativeStackNavigator();

function withPassengerBoundary(Component, screenName) {
  return function PassengerBoundedScreen(props) {
    return (
      <ScreenErrorBoundary
        navigation={props.navigation}
        resetKey={props.route?.key}
        screenName={screenName}
      >
        <Component {...props} />
      </ScreenErrorBoundary>
    );
  };
}

const PassengerBookingHome = withPassengerBoundary(PassengerHomeScreen, 'PassengerBookingHome');
const PassengerChooseRide = withPassengerBoundary(PassengerChooseRideScreen, 'PassengerChooseRide');
const PassengerNearbyCars = withPassengerBoundary(PassengerNearbyCarsScreen, 'PassengerNearbyCars');
const PassengerRideTracking = withPassengerBoundary(PassengerRideTrackingScreen, 'PassengerRideTracking');
const PassengerRideChat = withPassengerBoundary(RideChatScreen, 'RideChat');
const PassengerHireHome = withPassengerBoundary(PassengerHireHomeScreen, 'PassengerHireHome');
const PassengerHireCreate = withPassengerBoundary(PassengerHireCreateScreen, 'PassengerHireCreate');
const PassengerHireDetail = withPassengerBoundary(PassengerHireDetailScreen, 'PassengerHireDetail');
const PassengerHireLocationPicker = withPassengerBoundary(PassengerHireLocationPickerScreen, 'PassengerHireLocationPicker');
const PassengerHireTracking = withPassengerBoundary(PassengerHireTrackingScreen, 'PassengerHireTracking');

export default function PassengerHomeStack({ registrationCountryCode }) {
  const isSouthAfrica = String(registrationCountryCode || '').toUpperCase() === 'ZA';
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="PassengerBookingHome" component={PassengerBookingHome} />
      <Stack.Screen name="PassengerChooseRide" component={PassengerChooseRide} />
      <Stack.Screen name="PassengerNearbyCars" component={PassengerNearbyCars} />
      <Stack.Screen name="PassengerRideTracking" component={PassengerRideTracking} />
      <Stack.Screen name="RideChat" component={PassengerRideChat} />
      {!isSouthAfrica ? <Stack.Screen name="PassengerHireHome" component={PassengerHireHome} /> : null}
      {!isSouthAfrica ? <Stack.Screen name="PassengerHireCreate" component={PassengerHireCreate} /> : null}
      {!isSouthAfrica ? <Stack.Screen name="PassengerHireDetail" component={PassengerHireDetail} /> : null}
      {!isSouthAfrica ? <Stack.Screen name="PassengerHireLocationPicker" component={PassengerHireLocationPicker} /> : null}
      {!isSouthAfrica ? <Stack.Screen name="PassengerHireTracking" component={PassengerHireTracking} /> : null}
    </Stack.Navigator>
  );
}

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import PassengerHomeScreen from './PassengerHomeScreen.js';
import PassengerChooseRideScreen from './PassengerChooseRideScreen.js';
import PassengerNearbyCarsScreen from './PassengerNearbyCarsScreen.js';
import PassengerRideTrackingScreen from './PassengerRideTrackingScreen.js';
import RideChatScreen from '../shared/RideChatScreen.js';

const Stack = createNativeStackNavigator();

export default function PassengerHomeStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="PassengerBookingHome" component={PassengerHomeScreen} />
      <Stack.Screen name="PassengerChooseRide" component={PassengerChooseRideScreen} />
      <Stack.Screen name="PassengerNearbyCars" component={PassengerNearbyCarsScreen} />
      <Stack.Screen name="PassengerRideTracking" component={PassengerRideTrackingScreen} />
      <Stack.Screen name="RideChat" component={RideChatScreen} />
    </Stack.Navigator>
  );
}

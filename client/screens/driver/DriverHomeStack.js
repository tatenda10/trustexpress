import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import DriverHomeScreen from './DriverHomeScreen';
import DriverTripScreen from './DriverTripScreen';
import RideChatScreen from '../shared/RideChatScreen';

const Stack = createNativeStackNavigator();

export default function DriverHomeStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="DriverHomeMain" component={DriverHomeScreen} />
      <Stack.Screen name="DriverTrip" component={DriverTripScreen} />
      <Stack.Screen name="RideChat" component={RideChatScreen} />
    </Stack.Navigator>
  );
}

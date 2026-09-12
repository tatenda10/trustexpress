import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import PassengerHireHomeScreen from './PassengerHireHomeScreen.js';
import PassengerHireCreateScreen from './PassengerHireCreateScreen.js';
import PassengerHireDetailScreen from './PassengerHireDetailScreen.js';
import PassengerHireLocationPickerScreen from './PassengerHireLocationPickerScreen.js';
import PassengerHireTrackingScreen from './PassengerHireTrackingScreen.js';

const Stack = createNativeStackNavigator();

export default function PassengerHireStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="PassengerHireHome" component={PassengerHireHomeScreen} />
      <Stack.Screen name="PassengerHireCreate" component={PassengerHireCreateScreen} />
      <Stack.Screen name="PassengerHireDetail" component={PassengerHireDetailScreen} />
      <Stack.Screen name="PassengerHireLocationPicker" component={PassengerHireLocationPickerScreen} />
      <Stack.Screen name="PassengerHireTracking" component={PassengerHireTrackingScreen} />
    </Stack.Navigator>
  );
}

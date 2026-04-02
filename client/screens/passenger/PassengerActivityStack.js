import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import PassengerActivityScreen from './PassengerActivityScreen';
import PassengerRideDetailScreen from './PassengerRideDetailScreen';

const Stack = createNativeStackNavigator();

export default function PassengerActivityStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="PassengerActivityMain" component={PassengerActivityScreen} />
      <Stack.Screen name="PassengerRideDetail" component={PassengerRideDetailScreen} />
    </Stack.Navigator>
  );
}

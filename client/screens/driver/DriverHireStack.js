import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import DriverHireOpenRequestsScreen from './DriverHireOpenRequestsScreen';
import DriverHireDetailScreen from './DriverHireDetailScreen';

const Stack = createNativeStackNavigator();

export default function DriverHireStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="DriverHireOpenRequests" component={DriverHireOpenRequestsScreen} />
      <Stack.Screen name="DriverHireDetail" component={DriverHireDetailScreen} />
    </Stack.Navigator>
  );
}

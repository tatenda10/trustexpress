import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import DriverIncomeScreen from './DriverIncomeScreen';
import DriverActivityScreen from './DriverActivityScreen';

const Stack = createNativeStackNavigator();

export default function DriverActivityStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="DriverIncome" component={DriverIncomeScreen} />
      <Stack.Screen name="DriverTripHistory" component={DriverActivityScreen} />
    </Stack.Navigator>
  );
}

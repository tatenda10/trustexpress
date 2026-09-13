import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import DriverWalletScreen from './DriverWalletScreen';
import DriverWalletTransactionDetailScreen from './DriverWalletTransactionDetailScreen';
import DriverActivityScreen from './DriverActivityScreen';

const Stack = createNativeStackNavigator();

export default function DriverWalletStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="DriverWalletMain" component={DriverWalletScreen} />
      <Stack.Screen name="DriverWalletTransactionDetail" component={DriverWalletTransactionDetailScreen} />
      <Stack.Screen name="DriverRideHistory" component={DriverActivityScreen} />
    </Stack.Navigator>
  );
}

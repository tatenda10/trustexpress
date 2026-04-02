import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import DriverHomeStack from './DriverHomeStack';
import DriverWalletScreen from './DriverWalletScreen';
import DriverActivityScreen from './DriverActivityScreen';
import DriverAccountStack from './DriverAccountStack';
import { PRIMARY_BLUE } from '../../constants/colors';

const Tab = createBottomTabNavigator();
const ICON_SIZE = 24;

export default function DriverTabNavigator({ route }) {
  const driverStatus = route?.params?.driverStatus ?? null;
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: PRIMARY_BLUE,
        tabBarInactiveTintColor: '#9ca3af',
        tabBarStyle: { borderTopColor: '#f3f4f6' },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '500' },
      }}
    >
      <Tab.Screen
        name="DriverHome"
        component={DriverHomeStack}
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <Ionicons name="home-outline" size={ICON_SIZE} color={color} />,
        }}
      />
      <Tab.Screen
        name="DriverWallet"
        component={DriverWalletScreen}
        options={{
          title: 'Wallet',
          tabBarIcon: ({ color }) => <Ionicons name="wallet-outline" size={ICON_SIZE} color={color} />,
        }}
      />
      <Tab.Screen
        name="DriverActivity"
        component={DriverActivityScreen}
        options={{
          title: 'Activity',
          tabBarIcon: ({ color }) => <Ionicons name="time-outline" size={ICON_SIZE} color={color} />,
        }}
      />
      <Tab.Screen
        name="DriverAccount"
        component={DriverAccountStack}
        initialParams={{ driverStatus }}
        options={{
          title: 'Account',
          tabBarIcon: ({ color }) => <Ionicons name="person-outline" size={ICON_SIZE} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

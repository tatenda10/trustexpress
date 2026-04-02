import React from 'react';
import { View, Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PassengerHomeStack from './PassengerHomeStack';
import PassengerActivityStack from './PassengerActivityStack';
import PassengerAccountStack from './PassengerAccountStack';
import { PRIMARY_BLUE } from '../../constants/colors';

const Tab = createBottomTabNavigator();

function TabLabel({ label, focused, color }) {
  return (
    <View className="items-center">
      <Text
        style={{
          color,
          fontSize: 11,
          fontWeight: '800',
          paddingBottom: 3,
          borderBottomWidth: focused ? 3 : 0,
          borderBottomColor: focused ? PRIMARY_BLUE : 'transparent',
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export default function PassengerTabNavigator() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: PRIMARY_BLUE,
        tabBarInactiveTintColor: '#9ca3af',
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: Math.max(insets.bottom, 6),
          height: 30 + Math.max(insets.bottom, 1),
          borderTopColor: '#f3f4f6',
          borderTopWidth: 1,
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          backgroundColor: 'rgba(255,255,255,0.96)',
          paddingTop: 0,
          paddingBottom: Math.max(insets.bottom, 0),
          elevation: 12,
          shadowColor: '#0f172a',
          shadowOpacity: 0.08,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
        },
      }}
    >
      <Tab.Screen
        name="PassengerHome"
        component={PassengerHomeStack}
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <Ionicons name="home-outline" size={20} color={color} />,
          tabBarLabel: ({ focused, color }) => <TabLabel label="Home" focused={focused} color={color} />,
        }}
      />
      <Tab.Screen
        name="PassengerActivity"
        component={PassengerActivityStack}
        options={{
          title: 'Activity',
          tabBarIcon: ({ color }) => <Ionicons name="time-outline" size={20} color={color} />,
          tabBarLabel: ({ focused, color }) => <TabLabel label="Activity" focused={focused} color={color} />,
        }}
      />
      <Tab.Screen
        name="PassengerAccount"
        component={PassengerAccountStack}
        options={{
          title: 'Account',
          tabBarIcon: ({ color }) => <Ionicons name="person-outline" size={20} color={color} />,
          tabBarLabel: ({ focused, color }) => <TabLabel label="Account" focused={focused} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/clerk-expo';

export default function BlockedAccountScreen() {
  const { signOut } = useAuth();

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 px-6 py-8 justify-center">
        <View className="items-center">
          <View className="h-16 w-16 items-center justify-center rounded-sm bg-rose-50 border border-rose-200">
            <Text className="text-2xl font-bold text-rose-600">!</Text>
          </View>
          <Text className="mt-5 text-2xl font-bold text-slate-900 text-center">Account blocked</Text>
          <Text className="mt-3 text-sm leading-6 text-slate-600 text-center">
            Your account has been blocked. You cannot use Trust Express right now. If you think this is a mistake,
            please contact support.
          </Text>

          <Pressable
            onPress={() => signOut().catch(() => {})}
            className="mt-8 bg-slate-900 px-5 py-3 rounded-sm"
          >
            <Text className="text-sm font-semibold text-white">Sign out</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

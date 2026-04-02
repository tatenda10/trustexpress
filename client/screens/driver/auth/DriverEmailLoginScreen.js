import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Alert,
} from 'react-native';
import { useSignIn } from '@clerk/clerk-expo';

const DriverEmailLoginScreen = ({ navigation }) => {
  const { signIn, setActive, isLoaded } = useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    if (!isLoaded) return;

    if (!email || !password) {
      Alert.alert('Error', 'Please enter both email and password');
      return;
    }

    setLoading(true);
    try {
      const result = await signIn.create({
        identifier: email,
        password,
      });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        // Check if driver account is verified (you'll need to implement this)
        navigation.navigate('DriverHome');
      }
    } catch (error) {
      Alert.alert('Error', error.errors?.[0]?.message || 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView contentContainerStyle={{ flex: 1, padding: 20 }}>
        <View className="mb-8 mt-5">
          <Text className="text-3xl font-bold text-gray-900 mb-2">Sign In</Text>
          <Text className="text-base text-gray-600">Sign in to your driver account</Text>
        </View>

        <View className="gap-4 mb-6">
          <TextInput
            className="border border-gray-300 rounded-xl p-4 text-base bg-gray-50"
            placeholder="Email Address"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />

          <TextInput
            className="border border-gray-300 rounded-xl p-4 text-base bg-gray-50"
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
          />

          <TouchableOpacity
            className="self-end -mt-2"
            onPress={() => {
              Alert.alert('Info', 'Forgot password feature coming soon');
            }}
          >
            <Text className="text-green-500 text-sm">Forgot Password?</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className={`bg-green-500 p-4 rounded-xl items-center mt-2 ${loading ? 'opacity-60' : ''}`}
            onPress={handleSignIn}
            disabled={loading}
          >
            <Text className="text-white text-lg font-semibold">
              {loading ? 'Signing In...' : 'Sign In'}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          className="items-center p-4"
          onPress={() => navigation.navigate('DriverCreateAccount')}
        >
          <Text className="text-green-500 text-base">
            Don't have an account? Sign Up
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

export default DriverEmailLoginScreen;


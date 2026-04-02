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
import { useSignUp } from '@clerk/clerk-expo';

const PassengerEmailSignUpScreen = ({ navigation }) => {
  const { signUp, setActive, isLoaded } = useSignUp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignUp = async () => {
    if (!isLoaded) return;

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    if (password.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      await signUp.create({
        emailAddress: email,
        password: password,
        firstName: name || undefined,
      });

      // Send email verification code
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });

      navigation.navigate('PassengerEmailVerification', {
        email,
      });
    } catch (error) {
      Alert.alert('Error', error.errors?.[0]?.message || 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView contentContainerStyle={{ flex: 1, padding: 20 }}>
        <View className="mb-8 mt-5">
          <Text className="text-3xl font-bold text-gray-900 mb-2">Create Account</Text>
          <Text className="text-base text-gray-600">Sign up with your email</Text>
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
            placeholder="Name (Optional)"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />

          <TextInput
            className="border border-gray-300 rounded-xl p-4 text-base bg-gray-50"
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password-new"
          />

          <TextInput
            className="border border-gray-300 rounded-xl p-4 text-base bg-gray-50"
            placeholder="Confirm Password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            autoCapitalize="none"
          />

          <TouchableOpacity
            className={`bg-blue-500 p-4 rounded-xl items-center mt-2 ${loading ? 'opacity-60' : ''}`}
            onPress={handleSignUp}
            disabled={loading}
          >
            <Text className="text-white text-lg font-semibold">
              {loading ? 'Creating Account...' : 'Create Account'}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          className="items-center p-4"
          onPress={() => navigation.navigate('PassengerLogin')}
        >
          <Text className="text-blue-500 text-base">
            Already have an account? Login
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

export default PassengerEmailSignUpScreen;


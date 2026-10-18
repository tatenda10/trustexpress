import { Alert, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const credentialsKey = (role) => `trust_biometric_credentials_${role}`;
const accountKey = (role) => `trust_biometric_account_${role}`;
const declinedKey = (role) => `trust_biometric_declined_${role}`;

export const BIOMETRIC_LABEL = Platform.OS === 'ios' ? 'Face ID / Touch ID' : 'fingerprint';

const normalizeIdentifier = (identifier) => String(identifier || '').trim().toLowerCase();

export function isBiometricSignInSupported() {
  try {
    return SecureStore.canUseBiometricAuthentication();
  } catch {
    return false;
  }
}

/** Saved account email for this role, read without prompting for biometrics. */
export async function getBiometricAccount(role) {
  if (!isBiometricSignInSupported()) return null;
  try {
    return (await SecureStore.getItemAsync(accountKey(role))) || null;
  } catch {
    return null;
  }
}

export async function clearBiometricCredentials(role) {
  await Promise.all([
    SecureStore.deleteItemAsync(credentialsKey(role)).catch(() => {}),
    SecureStore.deleteItemAsync(accountKey(role)).catch(() => {}),
  ]);
}

export async function saveBiometricCredentials(role, identifier, password) {
  const normalized = normalizeIdentifier(identifier);
  await SecureStore.setItemAsync(
    credentialsKey(role),
    JSON.stringify({ identifier: normalized, password }),
    {
      requireAuthentication: true,
      authenticationPrompt: `Confirm ${BIOMETRIC_LABEL} to enable quick sign-in`,
      keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
    }
  );
  await SecureStore.setItemAsync(accountKey(role), normalized);
  await AsyncStorage.removeItem(declinedKey(role)).catch(() => {});
}

/**
 * Prompts for biometrics and returns the stored { identifier, password }.
 * Returns null if the user cancelled. Throws { code: 'biometric_reset' } if the
 * stored item can no longer be decrypted (e.g. biometrics changed on the device).
 */
export async function readBiometricCredentials(role) {
  try {
    const raw = await SecureStore.getItemAsync(credentialsKey(role), {
      requireAuthentication: true,
      authenticationPrompt: 'Sign in to Trust Express',
      keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
    });
    if (!raw) {
      await clearBiometricCredentials(role);
      throw Object.assign(new Error('Biometric sign-in is not set up'), { code: 'biometric_reset' });
    }
    const parsed = JSON.parse(raw);
    if (!parsed?.identifier || !parsed?.password) {
      await clearBiometricCredentials(role);
      throw Object.assign(new Error('Biometric sign-in is not set up'), { code: 'biometric_reset' });
    }
    return parsed;
  } catch (error) {
    if (error?.code === 'biometric_reset') throw error;
    const message = String(error?.message || '');
    if (/cancel/i.test(message)) return null;
    await clearBiometricCredentials(role);
    throw Object.assign(new Error('Biometric sign-in needs to be set up again'), { code: 'biometric_reset' });
  }
}

const askYesNo = (title, message) =>
  new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Enable', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });

/**
 * After a successful password sign-in (before setActive), offer to remember the
 * login for biometric sign-in. Never throws.
 */
export async function offerBiometricSignIn(role, identifier, password) {
  try {
    if (!identifier || !password || !isBiometricSignInSupported()) return;
    const normalized = normalizeIdentifier(identifier);
    const savedAccount = await getBiometricAccount(role);
    if (savedAccount === normalized) return;
    const declined = await AsyncStorage.getItem(declinedKey(role)).catch(() => null);
    if (!savedAccount && declined === normalized) return;

    const accepted = await askYesNo(
      `Sign in with ${BIOMETRIC_LABEL}?`,
      `Next time you can sign in with ${BIOMETRIC_LABEL} instead of typing your password.`
    );
    if (!accepted) {
      await AsyncStorage.setItem(declinedKey(role), normalized).catch(() => {});
      return;
    }
    await saveBiometricCredentials(role, normalized, password);
  } catch {
    // Enabling is optional; a cancelled prompt must not block sign-in.
  }
}

export function isWrongPasswordError(error) {
  return error?.code === 'INVALID_CREDENTIALS';
}

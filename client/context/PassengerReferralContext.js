import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'trust_passenger_referrer_email';

const PassengerReferralContext = createContext({
  referrerEmail: '',
  loadingReferral: true,
  hasReferrerEmail: false,
  setReferrerEmailFromDeepLink: async () => {},
  hydrateStoredReferral: async () => null,
  clearReferral: async () => {},
});

export function PassengerReferralProvider({ children }) {
  const [referrerEmail, setReferrerEmail] = useState('');
  const [loadingReferral, setLoadingReferral] = useState(true);

  const persistReferrerEmail = useCallback(async (nextEmail) => {
    const normalized = String(nextEmail || '').trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) {
      await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
      setReferrerEmail('');
      return '';
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ email: normalized }));
    setReferrerEmail(normalized);
    return normalized;
  }, []);

  const hydrateStoredReferral = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setReferrerEmail('');
        return null;
      }
      const parsed = JSON.parse(raw);
      const email = String(parsed?.email || '').trim().toLowerCase();
      setReferrerEmail(email);
      return email || null;
    } catch {
      setReferrerEmail('');
      return null;
    } finally {
      setLoadingReferral(false);
    }
  }, []);

  const setReferrerEmailFromDeepLink = useCallback(async (nextEmail) => {
    return persistReferrerEmail(nextEmail);
  }, [persistReferrerEmail]);

  const clearReferral = useCallback(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    setReferrerEmail('');
  }, []);

  const value = useMemo(() => ({
    referrerEmail,
    loadingReferral,
    hasReferrerEmail: !!referrerEmail,
    setReferrerEmailFromDeepLink,
    hydrateStoredReferral,
    clearReferral,
  }), [referrerEmail, loadingReferral, setReferrerEmailFromDeepLink, hydrateStoredReferral, clearReferral]);

  return (
    <PassengerReferralContext.Provider value={value}>
      {children}
    </PassengerReferralContext.Provider>
  );
}

export function usePassengerReferral() {
  return useContext(PassengerReferralContext);
}
